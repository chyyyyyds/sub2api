//go:build unit

package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type stage8qAtomicRecorder struct {
	service.UsageBillingRepository
	commands  []*service.UsageBillingCommand
	rows      []*service.UsageLog
	ctxErrors []error
}

func (r *stage8qAtomicRecorder) ApplyWithUsage(ctx context.Context, cmd *service.UsageBillingCommand, row *service.UsageLog) (*service.UsageBillingApplyResult, error) {
	r.commands = append(r.commands, cmd)
	r.rows = append(r.rows, row)
	r.ctxErrors = append(r.ctxErrors, ctx.Err())
	return &service.UsageBillingApplyResult{Applied: true}, nil
}

type stage8qClientWriter struct {
	*httptest.ResponseRecorder
	cancel     context.CancelFunc
	disconnect bool
	once       sync.Once
}

func (w *stage8qClientWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseRecorder.Write(data)
	if bytes.Contains(data, []byte(`"input_tokens":2`)) {
		w.once.Do(w.cancel)
		if w.disconnect {
			return n, io.ErrClosedPipe
		}
	}
	return n, err
}

// 真实 TLS/TCP、正式 Handler/Forward/RecordUsage，账务边界捕获后另交独立 PG 核验。
func TestStage8QResponsesHandlerSettlement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, scenario := range []string{"normal", "rst", "cancel", "client_disconnect", "no_usage", "partial_usage", "duplicate_usage", "queue_full", "pool_stopped"} {
		t.Run(scenario, func(t *testing.T) {
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				w.Header().Set("Content-Type", "text/event-stream")
				w.Header().Set("X-Request-Id", "stage8q-"+scenario)
				_, _ = fmt.Fprint(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":\"synthetic\"}\n\n")
				usage := "data: {\"type\":\"response.in_progress\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n"
				if scenario == "partial_usage" {
					usage = "data: {\"type\":\"response.in_progress\",\"response\":{\"usage\":{\"input_tokens\":99}}}\n\n"
				}
				if scenario != "no_usage" {
					_, _ = fmt.Fprint(w, usage)
				}
				if scenario == "duplicate_usage" {
					_, _ = fmt.Fprint(w, usage)
				}
				w.(http.Flusher).Flush()
				if scenario == "cancel" || scenario == "client_disconnect" {
					select {
					case <-r.Context().Done():
					case <-time.After(3 * time.Second):
					}
					return
				}
				if scenario != "normal" {
					stage7R1Reset(w)
					return
				}
				_, _ = fmt.Fprint(w, "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":3}}}\n\n")
			}))
			defer upstream.Close()
			client := upstream.Client()
			client.Timeout = 5 * time.Second
			transport := &stage7R1Transport{client: client}
			groupID := int64(2)
			repo := &stage7R1Repo{}
			repo.accounts = []service.Account{{ID: 1, Name: "stage8q-synthetic", GroupIDs: []int64{groupID}, Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey, Status: service.StatusActive, Schedulable: true, Concurrency: 1, Credentials: map[string]any{"api_key": "fixture-only", "base_url": upstream.URL}, Extra: map[string]any{"openai_responses_mode": "force_responses"}}}
			cfg := &config.Config{}
			billing := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, &config.Config{RunMode: config.RunModeSimple}, nil)
			defer billing.Stop()
			billRepo := &stage8qAtomicRecorder{}
			gateway := service.NewOpenAIGatewayService(repo, &stage7R1UsageRepo{}, billRepo, nil, nil, nil, nil, cfg, nil, nil, service.NewBillingService(cfg, nil), nil, billing, transport, &service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil)
			cache := &concurrencyCacheMock{acquireUserSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }, acquireAccountSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }}
			h := NewOpenAIGatewayHandler(gateway, service.NewConcurrencyService(cache), billing, &service.APIKeyService{}, nil, nil, nil, nil, cfg)
			if scenario == "queue_full" || scenario == "pool_stopped" {
				pool := service.NewUsageRecordWorkerPoolWithOptions(service.UsageRecordWorkerPoolOptions{WorkerCount: 1, QueueSize: 1, TaskTimeout: time.Second, OverflowPolicy: "drop", AutoScaleEnabled: false})
				h.usageRecordWorkerPool = pool
				defer pool.Stop()
				if scenario == "pool_stopped" {
					pool.Stop()
				} else {
					started, release := make(chan struct{}), make(chan struct{})
					pool.Submit(func(context.Context) { close(started); <-release })
					<-started
					defer close(release)
					pool.Submit(func(context.Context) {})
				}
			}
			key := &service.APIKey{ID: 902, Quota: 100, GroupID: &groupID, User: &service.User{ID: 903, Status: service.StatusActive}, Group: &service.Group{ID: groupID, RateMultiplier: 1, Platform: service.PlatformOpenAI, Status: service.StatusActive}}
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(string(middleware.ContextKeyAPIKey), key)
				c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 903, Concurrency: 1})
				c.Next()
			})
			router.POST("/v1/responses", h.Responses)
			req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewBufferString(`{"model":"gpt-6-sol","input":"fixture","stream":true}`))
			req.Header.Set("Content-Type", "application/json")
			ctx, cancel := context.WithCancel(req.Context())
			defer cancel()
			writer := &stage8qClientWriter{ResponseRecorder: httptest.NewRecorder(), cancel: func() {}, disconnect: scenario == "client_disconnect"}
			if scenario == "cancel" || scenario == "client_disconnect" {
				writer.cancel = cancel
			}
			router.ServeHTTP(writer, req.WithContext(ctx))
			if scenario == "cancel" || scenario == "client_disconnect" {
				require.ErrorIs(t, ctx.Err(), context.Canceled)
			}
			require.Len(t, transport.attempts, 1, "异常收尾不得重复采购")
			if scenario == "no_usage" || scenario == "partial_usage" {
				require.Empty(t, billRepo.commands, "未知或不完整用量不得自动扣款")
				return
			}
			require.Len(t, billRepo.commands, 1, "Handler 每次可信采购只调度一次原子结算")
			require.Len(t, billRepo.rows, 1)
			require.NoError(t, billRepo.ctxErrors[0], "客户端取消不能取消必要结算")
			require.Equal(t, 2, billRepo.commands[0].InputTokens)
			require.Equal(t, 3, billRepo.commands[0].OutputTokens)
			require.Equal(t, billRepo.commands[0].RequestID, billRepo.rows[0].RequestID)
			require.Greater(t, billRepo.commands[0].BalanceCost, 0.0)
			if dir := os.Getenv("STAGE8Q_EXPORT_DIR"); dir != "" {
				data, err := json.Marshal(map[string]any{"command": billRepo.commands[0], "usage": billRepo.rows[0]})
				require.NoError(t, err)
				require.NoError(t, os.WriteFile(filepath.Join(dir, scenario+".json"), data, 0600))
			}
		})
	}
}
