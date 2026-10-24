//go:build unit

package handler

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type stage7TLSUpstream struct {
	client *http.Client
	hits   []int64
}

func (u *stage7TLSUpstream) Do(r *http.Request, _ string, id int64, _ int) (*http.Response, error) {
	u.hits = append(u.hits, id)
	return u.client.Do(r)
}

func (u *stage7TLSUpstream) DoWithTLS(r *http.Request, p string, id int64, n int, _ *tlsfingerprint.Profile) (*http.Response, error) {
	return u.Do(r, p, id, n)
}

// 通过真实 Handler、正式调度器和本地 TLS 上游验证请求内切换；不调用任何付费供应商。
func TestStage7OpenAIRequestInternalFailover(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name     string
		status   int
		allFail  bool
		stream   bool
		partial  bool
		wantHits int
	}{
		{name: "503_跨账号", status: 503, wantHits: 2},
		{name: "429_零同账号重试", status: 429, wantHits: 2},
		{name: "529_跨账号", status: 529, wantHits: 2},
		{name: "502_跨账号", status: 502, wantHits: 2},
		{name: "504_跨账号", status: 504, wantHits: 2},
		{name: "401_认证响应", status: 401, wantHits: 2},
		{name: "402_余额响应", status: 402, wantHits: 2},
		{name: "403_权限响应", status: 403, wantHits: 2},
		{name: "普通400不切换", status: 400, wantHits: 1},
		{name: "两个账号失败达到一次切换上限", status: 503, allFail: true, wantHits: 2},
		{name: "流式写出前503允许切换", status: 503, stream: true, wantHits: 2},
		{name: "流式部分输出后禁止重放", stream: true, partial: true, wantHits: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				first := r.Header.Get("Authorization") == "Bearer stage7-fixture-A"
				if tc.partial && first {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprint(w, "data: {\"model\":\"gpt-6-sol\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"partial\"}}]}\n\n")
					w.(http.Flusher).Flush()
					return
				}
				if first || tc.allFail {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(tc.status)
					_, _ = fmt.Fprint(w, `{"error":{"type":"server_error","message":"isolated fixture error"}}`)
					return
				}
				if tc.stream {
					w.Header().Set("Content-Type", "text/event-stream")
					_, _ = fmt.Fprint(w, "data: {\"model\":\"gpt-6-sol\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"STAGE7_OK\"}}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n")
				} else {
					w.Header().Set("Content-Type", "application/json")
					_, _ = fmt.Fprint(w, `{"id":"stage7-ok","model":"gpt-6-sol","choices":[{"index":0,"message":{"role":"assistant","content":"STAGE7_OK"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
				}
			}))
			defer upstream.Close()
			groupID := int64(2)
			repo := &grokCredentialHandlerRepo{}
			for i, key := range []string{"stage7-fixture-A", "stage7-fixture-B"} {
				repo.accounts = append(repo.accounts, service.Account{ID: int64(801 + i), Name: key, Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey, Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: i + 1, Credentials: map[string]any{"api_key": key, "base_url": upstream.URL, "pool_mode": true, "pool_mode_retry_count": 0}, Extra: map[string]any{"openai_responses_mode": "force_chat_completions"}})
			}
			cfg := &config.Config{RunMode: config.RunModeSimple}
			cfg.Gateway.MaxAccountSwitches = 1
			cfg.Gateway.OpenAIWS.LBTopK = 1
			cfg.Gateway.OpenAIWS.SchedulerScoreWeights.Priority = 100
			billingCache := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, cfg, nil)
			defer billingCache.Stop()
			transport := &stage7TLSUpstream{client: upstream.Client()}
			gateway := service.NewOpenAIGatewayService(repo, nil, nil, nil, nil, nil, nil, cfg, nil, nil, service.NewBillingService(cfg, nil), nil, billingCache, transport, &service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil)
			cache := &concurrencyCacheMock{acquireUserSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }, acquireAccountSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }}
			h := NewOpenAIGatewayHandler(gateway, service.NewConcurrencyService(cache), billingCache, &service.APIKeyService{}, nil, nil, nil, nil, cfg)
			key := &service.APIKey{ID: 902, GroupID: &groupID, User: &service.User{ID: 903, Status: service.StatusActive}, Group: &service.Group{ID: groupID, Platform: service.PlatformOpenAI, Status: service.StatusActive}}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(string(middleware.ContextKeyAPIKey), key)
				c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 903, Concurrency: 1})
				c.Next()
			})
			router.POST("/v1/chat/completions", h.ChatCompletions)
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(fmt.Sprintf(`{"model":"gpt-6-sol","messages":[{"role":"user","content":"hi"}],"stream":%t}`, tc.stream)))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			require.Len(t, transport.hits, tc.wantHits, rec.Body.String())
			require.Equal(t, int64(801), transport.hits[0])
			if tc.wantHits == 2 {
				require.Equal(t, int64(802), transport.hits[1])
			}
			if tc.partial {
				require.Contains(t, rec.Body.String(), "partial")
				require.NotContains(t, rec.Body.String(), "STAGE7_OK")
			} else if !tc.allFail && tc.wantHits == 2 {
				require.Equal(t, 200, rec.Code)
				require.Contains(t, rec.Body.String(), "STAGE7_OK")
			} else {
				require.GreaterOrEqual(t, rec.Code, 400)
			}
		})
	}
}
