//go:build unit

package service

import (
	"context"
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

// 全部正文、请求ID与用量均为合成数据，不连接真实供应商。
func stage8qContext() *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	return c
}

func TestStage8QRawUsageIntegrity(t *testing.T) {
	good := `data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":3}}` + "\n\n"
	content := `data: {"choices":[{"delta":{"content":"fixture"}}]}` + "\n\n"
	for _, tc := range []struct {
		name, data string
		want       int
	}{
		{"normal", good, 5},
		{"duplicate", good + good, 5},
		{"empty_after_trusted", good + "data: {\"usage\":{}}\n\n", 5},
		{"zero_after_trusted", good + "data: {\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":0}}\n\n", 5},
		{"partial_after_trusted", good + "data: {\"usage\":{\"prompt_tokens\":99}}\n\n", 5},
		{"missing", "", 0},
		{"partial_only", "data: {\"usage\":{\"prompt_tokens\":99}}\n\n", 0},
		{"string_tokens", "data: {\"usage\":{\"prompt_tokens\":\"99\",\"completion_tokens\":3}}\n\n", 0},
		{"negative", "data: {\"usage\":{\"prompt_tokens\":-1,\"completion_tokens\":3}}\n\n", 0},
		{"fractional", "data: {\"usage\":{\"prompt_tokens\":2.5,\"completion_tokens\":3}}\n\n", 0},
		{"broken_json", "data: {\"usage\":{\"prompt_tokens\":99,\"completion_tokens\":3}\n\n", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := &http.Response{Header: http.Header{"X-Request-Id": {"stage8q-raw"}}, Body: io.NopCloser(strings.NewReader(content + tc.data + "data: [DONE]\n\n"))}
			s := &OpenAIGatewayService{cfg: rawChatCompletionsTestConfig()}
			res, err := s.streamRawChatCompletions(stage8qContext(), resp, rawChatCompletionsTestAccount(), "gpt-6-sol", "gpt-6-sol", "gpt-6-sol", nil, nil, time.Now(), 2)
			require.NoError(t, err)
			require.NotNil(t, res)
			require.Equal(t, tc.want, res.Usage.InputTokens+res.Usage.OutputTokens)
		})
	}
}

func TestStage8QResponsesForwardRetainsUsage(t *testing.T) {
	content := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\n"
	usage := "data: {\"type\":\"response.in_progress\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n"
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"rst", syscall.ECONNRESET},
		{"cancel", context.Canceled},
		{"timeout", context.DeadlineExceeded},
		{"parser_line_limit", errors.New("fixture SSE parse failure")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := stage8qContext()
			up := &httpUpstreamRecorder{resp: &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}, "X-Request-Id": {"stage8q-responses"}}, Body: &openAIChatStreamReadErrorCloser{payload: []byte(content + usage), err: tc.err}}}
			s := &OpenAIGatewayService{cfg: rawChatCompletionsTestConfig(), httpUpstream: up}
			res, err := s.Forward(context.Background(), c, rawChatCompletionsTestAccount(), []byte(`{"model":"gpt-6-sol","stream":true,"input":"synthetic"}`))
			require.Error(t, err)
			require.NotNil(t, res, "外层 Forward 不得丢弃解析器已取得的可信用量")
			require.Equal(t, 5, res.Usage.InputTokens+res.Usage.OutputTokens)
			require.Equal(t, "stage8q-responses", res.RequestID)
		})
	}
}

func TestStage8QBridgeTerminalRetainsUsage(t *testing.T) {
	for _, terminal := range []string{`{"type":"response.completed","response":{"usage":{}}}`, `{"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}`} {
		c := stage8qContext()
		data := "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\n" + "data: {\"type\":\"response.in_progress\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n" + "data: " + terminal + "\n\n"
		s := &OpenAIGatewayService{cfg: rawChatCompletionsTestConfig()}
		res, err := s.handleChatStreamingResponse(&http.Response{Header: http.Header{}, Body: io.NopCloser(strings.NewReader(data))}, c, rawChatCompletionsTestAccount(), "gpt-6-sol", "gpt-6-sol", "gpt-6-sol", time.Now(), 2)
		require.NoError(t, err)
		require.Equal(t, 5, res.Usage.InputTokens+res.Usage.OutputTokens)
	}
}

func TestStage8QUsageBeforeSemanticOutput(t *testing.T) {
	usage := "data: {\"type\":\"response.in_progress\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n"
	for _, name := range []string{"rst", "first_output_timeout", "sse_line_too_long", "terminal_then_line_too_long"} {
		t.Run(name, func(t *testing.T) {
			cfg := rawChatCompletionsTestConfig()
			var body io.ReadCloser
			if name == "first_output_timeout" {
				cfg.Gateway.OpenAIFirstOutputTimeoutSeconds = 1
				reader, writer := io.Pipe()
				body = reader
				defer reader.Close()
				go func() {
					_, _ = io.WriteString(writer, usage)
					defer writer.Close()
					time.Sleep(1200 * time.Millisecond)
				}()
			} else if name == "sse_line_too_long" || name == "terminal_then_line_too_long" {
				cfg.Gateway.MaxLineSize = 64 * 1024
				prefix := usage
				if name == "terminal_then_line_too_long" {
					prefix = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\n" + usage + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n"
				}
				body = io.NopCloser(strings.NewReader(prefix + "data: " + strings.Repeat("x", 128*1024) + "\n\n"))
			} else {
				body = &openAIChatStreamReadErrorCloser{payload: []byte(usage), err: syscall.ECONNRESET}
			}
			s := &OpenAIGatewayService{cfg: cfg}
			c := stage8qContext()
			res, err := s.handleStreamingResponse(context.Background(), &http.Response{StatusCode: 200, Header: http.Header{}, Body: body}, c, rawChatCompletionsTestAccount(), time.Now(), "gpt-6-sol", "gpt-6-sol")
			if name == "terminal_then_line_too_long" {
				require.NoError(t, err, "已完成后的读错不能改变既有成功语义")
			} else {
				require.Error(t, err)
			}
			require.NotNil(t, res)
			require.Equal(t, 5, res.usage.InputTokens+res.usage.OutputTokens)
			var failover *UpstreamFailoverError
			require.False(t, errors.As(err, &failover), "已有可信用量的异常收尾不能抹掉当前采购")
		})
	}
}
