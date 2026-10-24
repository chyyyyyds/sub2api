//go:build unit

package service

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 用量是累计快照；回答完成、网络结束和资金证据分别断言。
func TestStage7R2RawStreamFinancialBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	content := `data: {"choices":[{"delta":{"content":"部分正文"}}]}` + "\n\n"
	usage := `data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}` + "\n\n"
	finish := `data: {"choices":[{"delta":{},"finish_reason":"stop"}]}` + "\n\n"
	for _, tc := range []struct {
		name, tail string
		readErr    error
		failed     bool
		tokens     int
	}{
		{"完整成功", usage + finish + "data: [DONE]\n\n", nil, false, 5},
		{"用量后RST", usage, syscall.ECONNRESET, true, 5},
		{"无用量RST", "", syscall.ECONNRESET, true, 0},
		{"重复用量后RST", usage + usage, syscall.ECONNRESET, true, 5},
		{"重复用量完成", usage + usage + finish, nil, false, 5},
		{"finish正常EOF", finish, nil, false, 0},
		{"usage正常EOF兼容", usage, nil, false, 5},
		{"DONE正常EOF", "data: [DONE]\n\n", nil, false, 0},
		{"finish之后TLS关闭异常", usage + finish, syscall.ECONNRESET, false, 5},
		{"DONE之后TLS关闭异常", usage + "data: [DONE]\n\n", syscall.ECONNRESET, false, 5},
		{"确认完成后重复usage", finish + usage + usage, nil, false, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
			svc := &OpenAIGatewayService{cfg: rawChatCompletionsTestConfig()}
			readErr := tc.readErr
			if readErr == nil {
				readErr = io.EOF
			}
			resp := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}, "X-Request-Id": {"r2-fixture"}}, Body: &openAIChatStreamReadErrorCloser{payload: []byte(content + tc.tail), err: readErr}}
			res, err := svc.streamRawChatCompletions(c, resp, rawChatCompletionsTestAccount(), "gpt-6-sol", "gpt-6-sol", "gpt-6-sol", nil, nil, time.Now(), 2)
			if tc.failed {
				require.Error(t, err)
				_, _, typed := OpenAIUpstreamStreamReadErrorDetails(err)
				require.True(t, typed)
				require.NotContains(t, rec.Body.String(), "[DONE]")
			} else {
				require.NoError(t, err)
			}
			require.NotNil(t, res)
			require.Equal(t, tc.tokens, res.Usage.InputTokens+res.Usage.OutputTokens)
			// 不把错误 result 变成 failover；已写正文不会向备用账号再采购。
			var fo *UpstreamFailoverError
			require.False(t, errors.As(err, &fo))
		})
	}
}
