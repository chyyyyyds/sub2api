package service

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

// logOpenAIStreamUsageOutcome 只输出分类和关联ID，不记录请求、凭据或响应正文。
// unknown 只表示无法确定采购用量，不据此推算 Token 或补扣。
func logOpenAIStreamUsageOutcome(ctx context.Context, account *Account, requestID string, usage *OpenAIUsage, err error) {
	state, outcome := "unknown", "upstream_missing_usage"
	if openAIUsageHasTokens(usage) {
		state, outcome = "trusted", "upstream_usage_received"
	}
	if err != nil {
		var networkErr net.Error
		switch {
		case ctx != nil && errors.Is(ctx.Err(), context.Canceled), errors.Is(err, context.Canceled):
			outcome = "client_interrupted"
		case errors.Is(err, context.DeadlineExceeded), errors.As(err, &networkErr) && networkErr.Timeout():
			outcome = "upstream_timeout"
		case errors.Is(err, bufio.ErrTooLong):
			outcome = "sse_parse_failed"
		default:
			outcome = "upstream_interrupted"
		}
	}
	accountID := int64(0)
	if account != nil {
		accountID = account.ID
	}
	log := logger.FromContext(ctx).With(zap.String("component", "service.openai_gateway"), zap.Int64("account_id", accountID), zap.String("upstream_request_id", requestID), zap.String("usage_state", state), zap.String("outcome", outcome), zap.Bool("unknown_procurement_risk", state == "unknown"))
	if state == "unknown" || err != nil {
		log.Warn("openai_usage.stream_outcome")
	} else {
		log.Debug("openai_usage.stream_outcome")
	}
}

// trustedOpenAIStreamUsage 仅接受完整、非负整数的流式 Token 快照。
// 缺失字段不能当成零；可选明细对象允许缺失或 null，实际计量值仍必须为整数。
// 非流式与图片专用解析继续使用原有入口，不改变这些产品的收费规则。
func trustedOpenAIStreamUsage(data []byte) (OpenAIUsage, bool) {
	if !gjson.ValidBytes(data) {
		logger.L().Warn("openai_usage.sse_parse_failed")
		return OpenAIUsage{}, false
	}
	for _, candidate := range []struct{ usage, image string }{
		{"usage", "tool_usage.image_gen"},
		{"response.usage", "response.tool_usage.image_gen"},
		{"data.usage", "data.tool_usage.image_gen"},
		{"data.response.usage", "data.response.tool_usage.image_gen"},
	} {
		value := gjson.GetBytes(data, candidate.usage)
		if !value.IsObject() {
			continue
		}
		validInteger := func(v gjson.Result) bool {
			if v.Type != gjson.Number {
				return false
			}
			n, err := strconv.ParseInt(v.Raw, 10, strconv.IntSize)
			return err == nil && n >= 0
		}
		pair := (validInteger(value.Get("input_tokens")) && validInteger(value.Get("output_tokens"))) ||
			(validInteger(value.Get("prompt_tokens")) && validInteger(value.Get("completion_tokens")))
		if !pair {
			logger.L().Warn("openai_usage.untrusted_stream_snapshot", zap.String("reason", "incomplete_token_pair"))
			return OpenAIUsage{}, false
		}
		// 仅检查协议和现有映射认识的计量字段，不能把供应商元数据当作 Token。
		validCounters := func(object gjson.Result, fields []string) bool {
			for _, field := range fields {
				v := object.Get(field)
				if v.Exists() && !validInteger(v) {
					return false
				}
			}
			return true
		}
		validUsage := func(object gjson.Result) bool {
			if !validCounters(object, []string{"input_tokens", "output_tokens", "prompt_tokens", "completion_tokens", "total_tokens", "cache_read_input_tokens", "cache_read_tokens", "cached_tokens", "cache_write_tokens", "cache_creation_input_tokens", "cache_write_input_tokens", "cache_creation_tokens"}) {
				return false
			}
			for _, field := range []string{"input_tokens_details", "output_tokens_details", "prompt_tokens_details", "completion_tokens_details"} {
				detail := object.Get(field)
				if !detail.Exists() || detail.Type == gjson.Null {
					continue
				}
				if !detail.IsObject() || !validCounters(detail, []string{"cached_tokens", "cache_write_tokens", "cache_creation_tokens", "reasoning_tokens", "image_tokens", "audio_tokens", "text_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens"}) {
					return false
				}
			}
			return true
		}
		imageUsage := gjson.GetBytes(data, candidate.image)
		if !validUsage(value) {
			logger.L().Warn("openai_usage.untrusted_stream_snapshot", zap.String("reason", "invalid_token_counter"))
			return OpenAIUsage{}, false
		}
		// 只映射刚校验的同一对象，图片工具计量也先校验，避免再次扫描绕过边界。
		usage, ok := openAIUsageFromGJSON(value)
		if ok && imageUsage.IsObject() && validUsage(imageUsage) {
			mergeHostedImageGenToolUsage(imageUsage, &usage)
		}
		return usage, ok
	}
	return OpenAIUsage{}, false
}

const (
	grokMissingUsageErrorCode = "grok_missing_usage"
	grokMissingUsageMessage   = "xAI upstream returned a successful chat completion without billable usage"
)

// hasBillableGrokChatUsage stays aligned with the aggregate token buckets used
// to account for chat completions. Detail fields alone do not prove that the
// successful response can be settled safely.
func hasBillableGrokChatUsage(usage OpenAIUsage) bool {
	return usage.InputTokens > 0 ||
		usage.OutputTokens > 0 ||
		usage.CacheCreationInputTokens > 0 ||
		usage.CacheReadInputTokens > 0
}

// requiresBillableGrokChatUsage identifies Grok traffic by both account
// platform and model identity. Grok models may be served through generic
// OpenAI-compatible accounts, so account.Platform alone is not a safe billing
// boundary.
func requiresBillableGrokChatUsage(account *Account, models ...string) bool {
	if account != nil && account.Platform == PlatformGrok {
		return true
	}
	for _, model := range models {
		normalized := strings.ToLower(strings.TrimSpace(model))
		if separator := strings.LastIndex(normalized, "/"); separator >= 0 {
			normalized = strings.TrimSpace(normalized[separator+1:])
		}
		if normalized == "grok" || strings.HasPrefix(normalized, "grok-") {
			return true
		}
	}
	return false
}

func newGrokMissingUsageFailoverError(c *gin.Context, account *Account, upstreamRequestID string) *UpstreamFailoverError {
	accountID := int64(0)
	accountName := ""
	if account != nil {
		accountID = account.ID
		accountName = account.Name
	}

	setOpsUpstreamError(c, http.StatusBadGateway, grokMissingUsageMessage, "")
	appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
		ProxyID:            opsUpstreamProxyID(account),
		ProxyName:          opsUpstreamProxyName(account),
		Platform:           PlatformGrok,
		AccountID:          accountID,
		AccountName:        accountName,
		UpstreamStatusCode: http.StatusBadGateway,
		UpstreamRequestID:  strings.TrimSpace(upstreamRequestID),
		Kind:               "failover",
		Message:            grokMissingUsageMessage,
	})

	body, _ := json.Marshal(gin.H{
		"error": gin.H{
			"type":    "upstream_error",
			"code":    grokMissingUsageErrorCode,
			"message": grokMissingUsageMessage,
		},
	})
	headers := http.Header{}
	if requestID := strings.TrimSpace(upstreamRequestID); requestID != "" {
		headers.Set("x-request-id", requestID)
	}
	return &UpstreamFailoverError{
		StatusCode:      http.StatusBadGateway,
		ResponseBody:    body,
		ResponseHeaders: headers,
	}
}
