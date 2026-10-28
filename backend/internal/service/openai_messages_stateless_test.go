package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestOpenAICompatContinuationRequiresExplicitCapability(t *testing.T) {
	for _, value := range []any{nil, false, "true", 1, true} {
		t.Run(fmt.Sprint(value), func(t *testing.T) {
			account := &Account{Type: AccountTypeAPIKey, Extra: map[string]any{"openai_messages_continuation_supported": value}}
			require.Equal(t, value == true, openAICompatContinuationEnabled(account, "gpt-5.6-terra"))
			require.False(t, openAICompatContinuationEnabled(account, "gpt-4o"))
			account.Type = AccountTypeOAuth
			require.False(t, openAICompatContinuationEnabled(account, "gpt-5.6-terra"))
		})
	}
}

func TestForwardAsAnthropic_UnverifiedAPIKeyKeepsFullHistoryAndTools(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, stream := range []bool{false, true} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			account := &Account{ID: 912, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Concurrency: 1,
				Credentials: map[string]any{"api_key": "sk-test", "base_url": "https://upstream.example/v1"}}
			upstream := &httpUpstreamRecorder{}
			svc := &OpenAIGatewayService{httpUpstream: upstream,
				cfg: &config.Config{Security: config.SecurityConfig{URLAllowlist: config.URLAllowlistConfig{Enabled: false}}}}
			// 即使同一会话已有旧续接 ID，也不能让未知能力账号自动发送该 ID。
			svc.bindOpenAICompatSessionResponseID(context.Background(), nil, account, "same-session", "resp_stale")
			messages := []map[string]any{{"role": "user", "content": "remember CODE123"}}
			// 超过原滑动窗口，断言第一轮仍被保留，而不只是短对话恰好通过。
			for i := 0; i < 16; i++ {
				role := "assistant"
				if i%2 == 1 {
					role = "user"
				}
				messages = append(messages, map[string]any{"role": role, "content": fmt.Sprintf("turn-%d", i)})
			}
			messages = append(messages,
				map[string]any{"role": "assistant", "content": []map[string]any{{"type": "tool_use", "id": "call_qa", "name": "qa_ping", "input": map[string]any{}}}},
				map[string]any{"role": "user", "content": []map[string]any{{"type": "tool_result", "tool_use_id": "call_qa", "content": "PONG123"}}})
			body, err := json.Marshal(map[string]any{"model": "gpt-5.6-terra", "stream": stream, "max_tokens": 128,
				"messages": messages, "tools": []map[string]any{{"name": "qa_ping", "input_schema": map[string]any{"type": "object"}}}})
			require.NoError(t, err)
			// 重复同一请求也应保持同样完整的无状态输入。
			for i := 0; i < 2; i++ {
				upstream.resp = openAICompatSSECompletedResponse(fmt.Sprintf("resp_%d", i), "gpt-5.6-terra")
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", bytes.NewReader(body))
				result, err := svc.ForwardAsAnthropic(context.Background(), c, account, body, "same-session", "")
				require.NoError(t, err)
				require.NotNil(t, result)
				sent := upstream.lastBody
				require.False(t, gjson.GetBytes(sent, "previous_response_id").Exists())
				require.Equal(t, "same-session", gjson.GetBytes(sent, "prompt_cache_key").String())
				require.False(t, gjson.GetBytes(sent, "store").Bool())
				require.Contains(t, string(sent), "remember CODE123")
				require.Equal(t, int64(len(messages)+1), gjson.GetBytes(sent, "input.#").Int())
				require.Equal(t, "function_call", gjson.GetBytes(sent, "input.18.type").String())
				require.Equal(t, "call_qa", gjson.GetBytes(sent, "input.18.call_id").String())
				require.Equal(t, "function_call_output", gjson.GetBytes(sent, "input.19.type").String())
				require.Equal(t, "call_qa", gjson.GetBytes(sent, "input.19.call_id").String())
				require.Equal(t, "PONG123", gjson.GetBytes(sent, "input.19.output").String())
			}
		})
	}
}
