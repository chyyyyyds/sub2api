//go:build unit

package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 没有响应时供应商费用必须为 unknown，不能把 HTTP 错误推断成零采购。
func TestStage7R2UnknownProcurementAudit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{}`))
	svc := &OpenAIGatewayService{cfg: rawChatCompletionsTestConfig(), httpUpstream: &httpUpstreamRecorder{err: errors.New("fixture connection reset")}}
	account := rawChatCompletionsTestAccount()
	_, err := svc.sendCCUpstreamRequest(context.Background(), c, account, "https://fixture.invalid/v1/chat/completions", []byte(`{"model":"gpt-6-sol"}`), true, "fixture-secret-never-record", "", "")
	require.Error(t, err)
	v, _ := c.Get(OpsUpstreamErrorsKey)
	data, err := json.Marshal(v)
	require.NoError(t, err)
	var events []map[string]any
	require.NoError(t, json.Unmarshal(data, &events))
	require.Len(t, events, 1)
	procurement, ok := events[0]["procurement"].(map[string]any)
	require.True(t, ok, "每次失败尝试必须留下独立采购风险")
	require.NotEmpty(t, procurement["attempt_id"])
	require.Equal(t, "unknown", procurement["cost_status"])
	require.Nil(t, procurement["supplier_cost_usd"])
	require.Equal(t, "gpt-6-sol", procurement["model"])
	require.NotContains(t, string(data), "fixture-secret-never-record")
}
