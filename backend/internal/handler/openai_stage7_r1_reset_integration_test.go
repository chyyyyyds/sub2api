//go:build unit

package handler

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/tlsfingerprint"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// 独立仓储按真实组关联过滤，避免复用旧夹具忽略 group_id 而掩盖跨组借号。
type stage7R1Repo struct{ grokCredentialHandlerRepo }

type stage7R1UsageRepo struct {
	service.UsageLogRepository
	logs []*service.UsageLog
}

func (r *stage7R1UsageRepo) Create(_ context.Context, row *service.UsageLog) (bool, error) {
	r.logs = append(r.logs, row)
	return true, nil
}

// 账务事务边界用内存账本代替数据库，保留正式 RecordUsage 与计费命令构造。
type stage7R1BillingRepo struct {
	service.UsageBillingRepository
	commands []*service.UsageBillingCommand
}

func (r *stage7R1BillingRepo) Apply(_ context.Context, cmd *service.UsageBillingCommand) (*service.UsageBillingApplyResult, error) {
	r.commands = append(r.commands, cmd)
	return &service.UsageBillingApplyResult{Applied: true}, nil
}

func (r *stage7R1Repo) ListSchedulableByGroupIDAndPlatform(ctx context.Context, group int64, platform string) ([]service.Account, error) {
	all, err := r.ListSchedulableByPlatform(ctx, platform)
	var out []service.Account
	for _, a := range all {
		for _, id := range a.GroupIDs {
			if id == group {
				out = append(out, a)
				break
			}
		}
	}
	return out, err
}

// 证据只包含夹具账号、协议阶段与错误类型，不含真实凭据。
type stage7R1Attempt struct {
	AccountID int64  `json:"account_id"`             // 实际选择的夹具账号。
	Wrote     bool   `json:"request_written"`        // Transport 确认请求写出。
	Status    int    `json:"upstream_http_status"`   // 读取到的上游状态，0 表示没有响应。
	Error     string `json:"error,omitempty"`        // 原始网络错误。
	Reset     bool   `json:"typed_connection_reset"` // 底层错误是否为 ECONNRESET。
}

type stage7R1Transport struct {
	client   *http.Client
	mu       sync.Mutex
	attempts []*stage7R1Attempt
}

type stage7R1Body struct {
	io.ReadCloser
	attempt *stage7R1Attempt
}

// Windows 的 Winsock 使用 WSAECONNRESET(10054)，Linux 使用 ECONNRESET；均检查真实类型。
func stage7R1IsReset(err error) bool {
	return errors.Is(err, syscall.ECONNRESET) || (runtime.GOOS == "windows" && errors.Is(err, syscall.Errno(10054)))
}

func (b *stage7R1Body) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	if err != nil && err != io.EOF {
		b.attempt.Error = err.Error()
		b.attempt.Reset = stage7R1IsReset(err)
	}
	return n, err
}

func (u *stage7R1Transport) Do(r *http.Request, _ string, id int64, _ int) (*http.Response, error) {
	a := &stage7R1Attempt{AccountID: id}
	u.mu.Lock()
	u.attempts = append(u.attempts, a)
	u.mu.Unlock()
	trace := &httptrace.ClientTrace{WroteRequest: func(i httptrace.WroteRequestInfo) { a.Wrote = i.Err == nil }}
	resp, err := u.client.Do(r.WithContext(httptrace.WithClientTrace(r.Context(), trace)))
	if err != nil {
		a.Error, a.Reset = err.Error(), stage7R1IsReset(err)
	} else {
		a.Status = resp.StatusCode
		resp.Body = &stage7R1Body{ReadCloser: resp.Body, attempt: a}
	}
	return resp, err
}

func (u *stage7R1Transport) DoWithTLS(r *http.Request, p string, id int64, n int, _ *tlsfingerprint.Profile) (*http.Response, error) {
	return u.Do(r, p, id, n)
}

// 在 TLS 已建立且 HTTP 请求体已读完之后，对底层 TCP 使用 SO_LINGER=0 发送 RST。
// 直接关闭底层 socket，避免 tls.Close 先发送 close_notify 变成正常 EOF。
func stage7R1Reset(w http.ResponseWriter) {
	conn, _, err := w.(http.Hijacker).Hijack()
	if err != nil {
		panic(err)
	}
	if encrypted, ok := conn.(*tls.Conn); ok {
		conn = encrypted.NetConn()
	}
	tcp := conn.(*net.TCPConn)
	if err := tcp.SetLinger(0); err != nil {
		panic(err)
	}
	_ = tcp.Close()
}

// 使用正式 Handler 与账号选择器验证连接、响应头、流式内容边界，完全不访问供应商。
func TestStage7R1TCPResetFailover(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, fault string
		group       int64
		first       int64
		allFail     bool
		wantStatus  int
		wantHits    int
	}{
		{"F1_建立连接失败", "dial", 2, 1, false, 200, 2},
		{"F2_单账号不能跨组借号", "headers", 3, 1, false, 502, 1},
		{"F2_A到B_读响应头RST", "headers", 2, 1, false, 200, 2},
		{"F2_B到A_读响应头RST", "headers", 2, 3, false, 200, 2},
		{"F2_模拟A已发生采购而响应丢失_B成功", "headers_paid", 2, 1, false, 200, 2},
		{"F2_双失败停止", "headers", 2, 1, true, 502, 2},
		{"F3_只有响应头_没有下游提交", "empty", 2, 1, false, 200, 2},
		{"F3_角色事件已提交则禁止换号", "role", 2, 1, false, 200, 1},
		{"F4_已输出内容禁止换号", "partial", 2, 1, false, 200, 1},
		{"F4_用量后RST报错但保留真实消费", "usage", 2, 1, false, 200, 1},
		{"F5_HTTP502", "502", 2, 1, false, 200, 2},
		{"F5_HTTP503", "503", 2, 1, false, 200, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var upstreamIDs []int64
			// 单位为纳美元的虚拟供应商账本，仅用于展示采购与业务计费的独立口径。
			var procurement []map[string]int64
			var upstreamMu sync.Mutex
			upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Request-Id", "r1-fixture-upstream")
				id := int64(1)
				if r.Header.Get("Authorization") == "Bearer stage7-r1-B" {
					id = 3
				}
				// 完整消费请求体，保证 F2 发生在读取响应，而非发送请求阶段。
				_, err := io.Copy(io.Discard, r.Body)
				if err != nil {
					panic(err)
				}
				upstreamMu.Lock()
				upstreamIDs = append(upstreamIDs, id)
				if tc.fault == "headers_paid" && id == tc.first {
					procurement = append(procurement, map[string]int64{"account_id": id, "virtual_cost_nano_usd": 403468})
				} else if id != tc.first && !tc.allFail {
					procurement = append(procurement, map[string]int64{"account_id": id, "virtual_cost_nano_usd": 10000})
				}
				upstreamMu.Unlock()
				if id == tc.first || tc.allFail {
					switch tc.fault {
					case "headers", "headers_paid":
						stage7R1Reset(w)
						return
					case "502", "503":
						status := 502
						if tc.fault == "503" {
							status = 503
						}
						w.WriteHeader(status)
						_, _ = fmt.Fprint(w, `{"error":{"message":"隔离夹具故障"}}`)
						return
					case "empty", "role", "partial", "usage":
						w.Header().Set("Content-Type", "text/event-stream")
						w.WriteHeader(200)
						w.(http.Flusher).Flush()
						if tc.fault == "role" {
							_, _ = fmt.Fprint(w, "data: {\"model\":\"gpt-6-sol\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"}}]}\n\n")
						}
						if tc.fault == "partial" || tc.fault == "usage" {
							_, _ = fmt.Fprint(w, "data: {\"model\":\"gpt-6-sol\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"PARTIAL_R1\"}}]}\n\n")
						}
						if tc.fault == "usage" {
							_, _ = fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3}}\n\n")
						}
						w.(http.Flusher).Flush()
						// 给读取端接收已发送记录的机会，再做真正 RST；不产生付费调用。
						time.Sleep(20 * time.Millisecond)
						stage7R1Reset(w)
						return
					}
				}
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = fmt.Fprint(w, "data: {\"id\":\"r1-ok\",\"model\":\"gpt-6-sol\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"R1_OK\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n")
			}))
			defer upstream.Close()
			client := upstream.Client() // 仅信任 httptest 的独立证书，不关闭系统证书验证。
			client.Timeout = 5 * time.Second
			client.Transport.(*http.Transport).DisableKeepAlives = true
			transport := &stage7R1Transport{client: client}
			repo := &stage7R1Repo{}
			for _, id := range []int64{1, 3} {
				key := "stage7-r1-A"
				groups := []int64{2, 3}
				if id == 3 {
					key = "stage7-r1-B"
					groups = []int64{2}
				}
				url := upstream.URL
				if tc.fault == "dial" && id == tc.first {
					closed := httptest.NewTLSServer(http.NotFoundHandler())
					url = closed.URL
					closed.Close()
				}
				priority := 2
				if id == tc.first {
					priority = 1
				}
				repo.accounts = append(repo.accounts, service.Account{ID: id, Name: key, GroupIDs: groups, Platform: service.PlatformOpenAI, Type: service.AccountTypeAPIKey, Status: service.StatusActive, Schedulable: true, Concurrency: 1, Priority: priority, Credentials: map[string]any{"api_key": key, "base_url": url, "pool_mode": true, "pool_mode_retry_count": 0}, Extra: map[string]any{"openai_responses_mode": "force_chat_completions"}})
			}
			// 网关保留标准分组选择语义；仅账务预检使用隔离 simple 配置，不接真实钱包。
			cfg := &config.Config{}
			cfg.Gateway.MaxAccountSwitches = 1
			cfg.Gateway.OpenAIWS.LBTopK = 1
			cfg.Gateway.OpenAIWS.SchedulerScoreWeights.Priority = 100
			billingCfg := &config.Config{RunMode: config.RunModeSimple}
			billing := service.NewBillingCacheService(nil, nil, nil, nil, nil, nil, billingCfg, nil)
			defer billing.Stop()
			usageRepo := &stage7R1UsageRepo{}
			billRepo := &stage7R1BillingRepo{}
			gateway := service.NewOpenAIGatewayService(repo, usageRepo, billRepo, nil, nil, nil, nil, cfg, nil, nil, service.NewBillingService(cfg, nil), nil, billing, transport, &service.DeferredService{}, nil, nil, nil, nil, nil, nil, nil)
			cache := &concurrencyCacheMock{acquireUserSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }, acquireAccountSlotFn: func(context.Context, int64, int, string) (bool, error) { return true, nil }}
			h := NewOpenAIGatewayHandler(gateway, service.NewConcurrencyService(cache), billing, &service.APIKeyService{}, nil, nil, nil, nil, cfg)
			key := &service.APIKey{ID: 902, GroupID: &tc.group, User: &service.User{ID: 903, Status: service.StatusActive}, Group: &service.Group{ID: tc.group, RateMultiplier: 1, Platform: service.PlatformOpenAI, Status: service.StatusActive}}
			var events []*service.OpsUpstreamErrorEvent
			router := gin.New()
			router.Use(func(c *gin.Context) {
				c.Set(string(middleware.ContextKeyAPIKey), key)
				c.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: 903, Concurrency: 1})
				c.Next()
				v, _ := c.Get(service.OpsUpstreamErrorsKey)
				events, _ = v.([]*service.OpsUpstreamErrorEvent)
			})
			router.POST("/v1/chat/completions", h.ChatCompletions)
			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(`{"model":"gpt-6-sol","messages":[{"role":"user","content":"hi"}],"stream":true,"stream_options":{"include_usage":true}}`))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req) // 一个客户端请求，客户端没有重试循环。
			require.Equal(t, tc.wantStatus, rec.Code, rec.Body.String())
			require.Len(t, transport.attempts, tc.wantHits, rec.Body.String())
			require.Equal(t, tc.first, transport.attempts[0].AccountID)
			if tc.wantHits == 2 {
				require.NotEqual(t, transport.attempts[0].AccountID, transport.attempts[1].AccountID)
			}
			if tc.fault == "headers" || tc.fault == "headers_paid" || tc.fault == "empty" || tc.fault == "role" || tc.fault == "partial" || tc.fault == "usage" {
				require.True(t, transport.attempts[0].Wrote)
				require.True(t, transport.attempts[0].Reset, transport.attempts[0].Error)
				require.Contains(t, strings.ToLower(transport.attempts[0].Error), "read")
			}
			if tc.fault == "partial" || tc.fault == "usage" || tc.fault == "role" {
				if tc.fault != "role" {
					require.Contains(t, rec.Body.String(), "PARTIAL_R1")
				}
				require.NotContains(t, rec.Body.String(), "R1_OK")
				if tc.fault == "usage" {
					// R2 修复：业务失败与真实 Token 结算独立，不能输出假的完成事件。
					require.Contains(t, rec.Body.String(), "upstream_stream_read_error")
					require.NotContains(t, rec.Body.String(), "[DONE]")
				} else {
					require.Contains(t, rec.Body.String(), "upstream_stream_read_error")
				}
				require.LessOrEqual(t, strings.Count(rec.Body.String(), "data: [DONE]"), 1)
			} else if tc.wantStatus == 200 {
				require.Contains(t, rec.Body.String(), "R1_OK")
				require.Equal(t, 1, strings.Count(rec.Body.String(), "data: [DONE]"))
			}
			if tc.fault == "headers" || tc.fault == "headers_paid" {
				require.Equal(t, 0, transport.attempts[0].Status)
			}
			if tc.fault == "empty" || tc.fault == "role" {
				require.Equal(t, 200, transport.attempts[0].Status)
			}
			require.NotEmpty(t, events)
			for _, event := range events {
				require.NotNil(t, event.Procurement)
				require.NotEmpty(t, event.Procurement.AttemptID)
				require.Equal(t, event.AccountID, event.Procurement.AccountID)
				require.Nil(t, event.Procurement.SupplierCostUSD, "夹具没有供应商真实账单，金额不能填零或猜测")
				if tc.fault == "usage" {
					require.Equal(t, "confirmed", event.Procurement.UsageStatus)
					require.Equal(t, "pending_reconciliation", event.Procurement.CostStatus)
					require.Equal(t, 2, event.Procurement.Usage.InputTokens)
					require.Equal(t, 3, event.Procurement.Usage.OutputTokens)
				} else {
					require.Equal(t, "unknown", event.Procurement.CostStatus)
				}
			}
			if tc.wantStatus >= 400 {
				require.Empty(t, usageRepo.logs)
				require.Empty(t, billRepo.commands)
			} else {
				require.Len(t, usageRepo.logs, 1)
				row := usageRepo.logs[0]
				if tc.fault == "partial" || tc.fault == "role" {
					require.Zero(t, row.InputTokens)
					require.Zero(t, row.OutputTokens)
					require.Zero(t, row.ActualCost)
				} else {
					require.Len(t, billRepo.commands, 1)
					require.Greater(t, billRepo.commands[0].BalanceCost, 0.0)
					wantInput, wantOutput := 1, 1
					if tc.fault == "usage" {
						wantInput, wantOutput = 2, 3
					}
					require.Equal(t, wantInput, row.InputTokens)
					require.Equal(t, wantOutput, row.OutputTokens)
				}
			}
			if tc.fault == "dial" && runtime.GOOS != "windows" {
				require.Equal(t, []int64{tc.first}, repo.setTempIDs)
			} else {
				require.Empty(t, repo.setTempIDs)
			}
			require.Empty(t, repo.setErrorIDs)
			if tc.fault == "headers_paid" {
				require.Len(t, procurement, 2)
				require.Len(t, billRepo.commands, 1)
				require.Equal(t, int64(3), billRepo.commands[0].AccountID)
				require.InDelta(t, 0.000012, billRepo.commands[0].BalanceCost, 1e-12)
			}
			if tc.fault == "dial" && runtime.GOOS != "windows" {
				// 不睡十分钟：让隔离仓储中的冷却时间过期，核实正式选择器恢复首选账号。
				selectNext := func() int64 {
					selected, _, err := gateway.SelectAccountWithSchedulerForCapability(context.Background(), &tc.group, "", "", "gpt-6-sol", nil, service.OpenAIUpstreamTransportAny, service.OpenAIEndpointCapabilityChatCompletions, false, false, true, service.PlatformOpenAI)
					require.NoError(t, err)
					return selected.Account.ID
				}
				require.Equal(t, int64(3), selectNext())
				past := time.Now().Add(-time.Second)
				repo.accounts[0].TempUnschedulableUntil = &past
				require.Equal(t, int64(1), selectNext())
			}
			summary, _ := json.Marshal(map[string]any{"client_requests": 1, "client_retries": 0, "group_id": tc.group, "attempts": transport.attempts, "upstream_received": upstreamIDs, "virtual_procurement": procurement, "ops_events": events, "client_http": rec.Code, "sse": rec.Body.String(), "usage_rows": usageRepo.logs, "billing_commands": billRepo.commands})
			t.Log("R1_EVIDENCE " + string(summary))
		})
	}
}
