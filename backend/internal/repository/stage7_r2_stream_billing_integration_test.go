//go:build integration

package repository

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/ctxkey"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// 正式 HTTP 转发、真实 TCP 断开、RecordUsage 和 PostgreSQL 资金事务贯通验证。
func TestStage7R2RealStreamToPostgresBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, mode := range []string{"完整成功", "usage后RST", "无usage的RST", "重复usage完成", "已扣费缓存异常"} {
		t.Run(mode, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("X-Request-Id", "fixture-"+mode)
				_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"隔离回答\"}}]}\n\n")
				usage := "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2000,\"completion_tokens\":3000}}\n\n"
				if mode != "无usage的RST" {
					_, _ = fmt.Fprint(w, usage)
				}
				if mode == "重复usage完成" {
					_, _ = fmt.Fprint(w, usage)
				}
				if strings.Contains(mode, "RST") {
					w.(http.Flusher).Flush()
					time.Sleep(20 * time.Millisecond)
					conn, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						panic(err)
					}
					tcp := conn.(*net.TCPConn)
					_ = tcp.SetLinger(0)
					_ = tcp.Close()
					return
				}
				_, _ = fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer upstream.Close()
			client := testEntClient(t)
			user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@stream-r2.invalid", PasswordHash: "fixture", Balance: 100})
			group := mustCreateGroup(t, client, &service.Group{Name: "r2-" + uuid.NewString(), Platform: service.PlatformOpenAI, RateMultiplier: 2})
			key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, GroupID: &group.ID, Key: "r2-" + uuid.NewString(), Name: "R2", Quota: 100})
			key.Group = group
			account := mustCreateAccount(t, client, &service.Account{Name: "r2-" + uuid.NewString(), Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey})
			account.Credentials = map[string]any{"base_url": upstream.URL, "api_key": "fixture-only"}
			account.Extra = map[string]any{"openai_responses_mode": "force_chat_completions"}
			cfg := &config.Config{}
			cfg.Default.RateMultiplier = 1
			cfg.Security.URLAllowlist.AllowPrivateHosts = true
			cfg.Security.URLAllowlist.AllowInsecureHTTP = true
			var billingCache *service.BillingCacheService
			if mode == "已扣费缓存异常" {
				rdb := testRedis(t)
				require.NoError(t, rdb.Ping(context.Background()).Err())
				billingCache = service.NewBillingCacheService(NewBillingCache(rdb), nil, nil, nil, nil, nil, cfg, nil)
				t.Cleanup(billingCache.Stop)
				// 只关闭新建测试客户端，模拟缓存不可用，不停止Redis容器或改变其他测试。
				require.NoError(t, rdb.Close())
			}
			svc := service.NewOpenAIGatewayService(nil, NewUsageLogRepository(client, integrationDB), NewUsageBillingRepository(client, integrationDB), nil, nil, nil, nil, cfg, nil, nil, service.NewBillingService(cfg, nil), nil, billingCache, NewHTTPUpstream(cfg), &service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil)
			rid := uuid.NewString()
			ctx := context.WithValue(context.Background(), ctxkey.ClientRequestID, rid)
			body := []byte(`{"model":"gpt-6-sol","stream":true,"messages":[{"role":"user","content":"隔离夹具"}]}`)
			rec := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(rec)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(string(body))).WithContext(ctx)
			res, forwardErr := svc.ForwardAsChatCompletions(ctx, c, account, body, "", "")
			if strings.Contains(mode, "RST") {
				require.Error(t, forwardErr)
				_, _, typed := service.OpenAIUpstreamStreamReadErrorDetails(forwardErr)
				require.True(t, typed)
			} else {
				require.NoError(t, forwardErr)
			}
			require.NotNil(t, res)
			input := &service.OpenAIRecordUsageInput{Result: res, APIKey: key, User: user, Account: account, APIKeyService: &service.APIKeyService{}, RequestPayloadHash: service.HashUsageRequestPayload(body)}
			// 重复送达同一财务事件不重复扣费、不重复写财务成功行。
			require.NoError(t, svc.RecordUsage(ctx, input))
			require.NoError(t, svc.RecordUsage(ctx, input))
			var balance, quota, charged float64
			var logs, tokens int
			require.NoError(t, integrationDB.QueryRow(`SELECT u.balance,k.quota_used,(SELECT COUNT(*) FROM usage_logs WHERE request_id=$1 AND api_key_id=k.id),(SELECT COALESCE(SUM(actual_cost),0) FROM usage_logs WHERE request_id=$1 AND api_key_id=k.id),(SELECT COALESCE(SUM(input_tokens+output_tokens),0) FROM usage_logs WHERE request_id=$1 AND api_key_id=k.id) FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.id=$2`, "client:"+rid, key.ID).Scan(&balance, &quota, &logs, &charged, &tokens))
			require.Equal(t, 1, logs)
			if mode == "无usage的RST" {
				require.Zero(t, charged)
				require.Zero(t, tokens)
			} else {
				require.Greater(t, charged, 0.0)
				require.Equal(t, 5000, tokens)
			}
			require.InDelta(t, 100-balance, charged, 0.00000001)
			require.InDelta(t, quota, charged, 0.00000001)
			if strings.Contains(mode, "RST") {
				require.NotContains(t, rec.Body.String(), "[DONE]")
			}
		})
	}
}
