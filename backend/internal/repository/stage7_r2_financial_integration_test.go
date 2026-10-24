//go:build integration

package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// 仅使用 integration_harness 自动新建的 PostgreSQL/Redis，不读取任何站点连接串。
func TestStage7R2PostgresAtomicConcurrency(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@r2.invalid", PasswordHash: "fixture", Balance: 100})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "r2-" + uuid.NewString(), Name: "R2", Quota: 100})
	account := mustCreateAccount(t, client, &service.Account{Name: "r2-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	repo := NewUsageBillingRepository(client, integrationDB).(service.AtomicUsageBillingRepository)
	rid := uuid.NewString()
	var wg sync.WaitGroup
	var applied atomic.Int64
	errs := make(chan error, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmd := &service.UsageBillingCommand{RequestID: rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, AccountType: account.Type, Model: "gpt-6-sol", InputTokens: 2, OutputTokens: 3, BalanceCost: 0.25, APIKeyQuotaCost: 0.25, APIKeyRateLimitCost: 0.25}
			row := &service.UsageLog{RequestID: rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, Model: cmd.Model, InputTokens: 2, OutputTokens: 3, ActualCost: 0.25, TotalCost: 0.25, RateMultiplier: 1}
			res, err := repo.ApplyWithUsage(ctx, cmd, row)
			if err != nil {
				errs <- err
				return
			}
			if res.Applied {
				applied.Add(1)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.EqualValues(t, 1, applied.Load())
	var balance, quota, window float64
	var logs int
	require.NoError(t, integrationDB.QueryRow(`SELECT u.balance,k.quota_used,k.usage_5h,(SELECT COUNT(*) FROM usage_logs WHERE request_id=$1 AND api_key_id=$2) FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.id=$2`, rid, key.ID).Scan(&balance, &quota, &window, &logs))
	require.Equal(t, 99.75, balance)
	require.Equal(t, 0.25, quota)
	require.Equal(t, 0.25, window)
	require.Equal(t, 1, logs)

	// 真实数据库拒绝 usage（超长模型）时，余额、Key、dedup 一并回滚；修复后可重试一次。
	rid = uuid.NewString()
	cmd := &service.UsageBillingCommand{RequestID: rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, BalanceCost: 0.5, APIKeyQuotaCost: 0.5}
	row := &service.UsageLog{RequestID: rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, Model: strings.Repeat("x", 1000), ActualCost: 0.5, RateMultiplier: 1}
	_, err := repo.ApplyWithUsage(ctx, cmd, row)
	require.Error(t, err)
	require.NoError(t, integrationDB.QueryRow(`SELECT balance FROM users WHERE id=$1`, user.ID).Scan(&balance))
	require.Equal(t, 99.75, balance)
	var dedup int
	require.NoError(t, integrationDB.QueryRow(`SELECT COUNT(*) FROM usage_billing_dedup WHERE request_id=$1`, rid).Scan(&dedup))
	require.Zero(t, dedup)
	row.Model = "gpt-6-sol"
	res, err := repo.ApplyWithUsage(ctx, cmd, row)
	require.NoError(t, err)
	require.True(t, res.Applied)
	require.NoError(t, integrationDB.QueryRow(`SELECT balance FROM users WHERE id=$1`, user.ID).Scan(&balance))
	require.Equal(t, 99.25, balance)
}

func TestStage7R2V2PostgresRecovery(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@v2-r2.invalid", PasswordHash: "fixture"})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "r2-" + uuid.NewString(), Name: "R2"})
	account := mustCreateAccount(t, client, &service.Account{Name: "r2-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	start := time.Now().UTC().Truncate(time.Minute).Add(-10 * time.Minute)
	end := start.Add(5 * time.Minute)
	for _, tc := range []struct {
		name, platform, events                          string
		status, successes, failures, affected, attempts int
		duplicate, billedFailure                        bool
	}{
		{"A失败B成功", "openai", `[{"account_id":1,"at_unix_ms":1,"kind":"request_error"}]`, 200, 1, 0, 1, 1, false, false},
		{"B失败A成功", "openai", `[{"account_id":3,"at_unix_ms":2,"kind":"failover"}]`, 200, 1, 0, 1, 1, false, false},
		{"两账号失败", "openai", `[{"account_id":1,"at_unix_ms":1},{"account_id":3,"at_unix_ms":2}]`, 502, 0, 1, 1, 2, false, false},
		{"单账号失败", "openai", `[{"account_id":1,"at_unix_ms":1}]`, 502, 0, 1, 1, 1, false, false},
		{"本地429", "openai", `[]`, 429, 0, 1, 0, 0, false, false},
		{"重复日志", "openai", `[{"account_id":1,"at_unix_ms":1},{"account_id":3,"at_unix_ms":2}]`, 200, 1, 0, 1, 2, true, false},
		{"独立失败事件合并", "openai", `[{"account_id":3,"at_unix_ms":2}]`, 200, 1, 0, 1, 2, false, false},
		{"90分钟边界", "openai", `[{"account_id":3,"at_unix_ms":2}]`, 200, 1, 0, 1, 2, false, false},
		{"HTTP200流式逻辑失败已计费", "openai", `[{"account_id":1,"at_unix_ms":1,"kind":"http_error"}]`, 502, 0, 1, 1, 1, false, true},
		{"其他平台模型分组隔离", "deepseek", `[{"account_id":2,"at_unix_ms":1}]`, 200, 1, 0, 1, 1, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			group := mustCreateGroup(t, client, &service.Group{Name: "r2-" + uuid.NewString(), Platform: tc.platform})
			rid := uuid.NewString()
			model := "r2-" + tc.platform
			if tc.successes > 0 || tc.billedFailure {
				_, err := NewUsageLogRepository(client, integrationDB).Create(ctx, &service.UsageLog{RequestID: "client:" + rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, GroupID: &group.ID, Model: model, InputTokens: 2, OutputTokens: 3, ActualCost: 0.25, TotalCost: 0.25, RateMultiplier: 1, CreatedAt: start.Add(time.Minute)})
				require.NoError(t, err)
			}
			insertOps := func(at time.Time, events string) {
				_, err := integrationDB.Exec(`INSERT INTO ops_error_logs(request_id,client_request_id,user_id,api_key_id,group_id,platform,model,status_code,error_phase,error_type,upstream_errors,created_at) VALUES($1,$1,$2,$3,$4,$5,$6,$7,'upstream','upstream_error',$8::jsonb,$9)`, rid, user.ID, key.ID, group.ID, tc.platform, model, tc.status, events, at)
				require.NoError(t, err)
			}
			insertOps(start.Add(time.Minute), tc.events)
			if tc.name == "独立失败事件合并" {
				insertOps(start.Add(30*time.Second), `[{"account_id":1,"at_unix_ms":1}]`)
			}
			if tc.name == "90分钟边界" {
				insertOps(start.Add(-90*time.Minute), `[{"account_id":1,"at_unix_ms":1}]`)
				insertOps(start.Add(-90*time.Minute-time.Microsecond), `[{"account_id":999,"at_unix_ms":9}]`)
			}
			if tc.duplicate {
				// 窗口前89分钟及当前分钟重复，只有最新逻辑请求与不同失败事件计数。
				insertOps(start.Add(-89*time.Minute), tc.events)
				insertOps(start.Add(time.Minute+time.Second), tc.events)
			}
			repo := NewChannelMonitorV2Repository(integrationDB)
			for round := 0; round < 2; round++ {
				require.NoError(t, repo.RecomputeRange(ctx, start, end))
				var successes, failures, affected, attempts, tokens int
				require.NoError(t, integrationDB.QueryRow(`SELECT COALESCE(SUM(success_requests),0),COALESCE(SUM(error_requests),0),COALESCE(SUM(upstream_affected_requests),0),COALESCE(SUM(upstream_attempt_count),0),COALESCE(SUM(input_tokens+output_tokens),0) FROM channel_monitor_v2_metrics_1m WHERE group_id=$1 AND platform=$2 AND model=$3`, group.ID, tc.platform, model).Scan(&successes, &failures, &affected, &attempts, &tokens))
				require.Equal(t, tc.successes, successes)
				require.Equal(t, tc.failures, failures)
				require.Equal(t, tc.affected, affected)
				require.Equal(t, tc.attempts, attempts)
				wantTokens := 0
				if tc.successes > 0 || tc.billedFailure {
					wantTokens = 5
				}
				require.Equal(t, wantTokens, tokens, "真实已收费Token保留且只计一次")
				var rollupAttempts int
				require.NoError(t, integrationDB.QueryRow(`SELECT COALESCE(SUM(upstream_attempt_count),0) FROM channel_monitor_v2_metrics_rollup WHERE bucket_seconds=300 AND group_id=$1`, group.ID).Scan(&rollupAttempts))
				require.Equal(t, tc.attempts, rollupAttempts, fmt.Sprintf("round=%d", round))
			}
		})
	}
}

func TestStage7R2CostReconciliationReadOnlySQL(t *testing.T) {
	query, err := os.ReadFile("../../../tools/stage7_cost_reconciliation.sql")
	require.NoError(t, err)
	start := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	end := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	sql := strings.ReplaceAll(string(query), ":'start_at'", "'"+start+"'")
	sql = strings.ReplaceAll(sql, ":'end_at'", "'"+end+"'")
	// 使用固定连接，确保只读事务和ROLLBACK落在同一会话；不向任何财务表写入。
	conn, err := integrationDB.Conn(context.Background())
	require.NoError(t, err)
	defer conn.Close()
	_, err = conn.ExecContext(context.Background(), sql)
	require.NoError(t, err)
}

// 以真实数据库验证不同采购倍率及统计定价覆盖；只读报告不能把官方价基数冒充实付成本。
func TestStage7R2CostReconciliationAccountRate(t *testing.T) {
	ctx := context.Background()
	client := testEntClient(t)
	user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@cost-r2.invalid", PasswordHash: "fixture"})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "r2-" + uuid.NewString(), Name: "R2"})
	account := mustCreateAccount(t, client, &service.Account{Name: "r2-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	query, err := os.ReadFile("../../../tools/stage7_cost_reconciliation.sql")
	require.NoError(t, err)
	sqlText := strings.ReplaceAll(string(query), "BEGIN READ ONLY;", "")
	sqlText = strings.ReplaceAll(sqlText, "ROLLBACK;", "")
	sqlText = strings.ReplaceAll(sqlText, ":'start_at'", "'2000-01-01T00:00:00Z'")
	sqlText = strings.ReplaceAll(sqlText, ":'end_at'", "'2100-01-01T00:00:00Z'")
	sqlText = strings.TrimSuffix(strings.TrimSpace(sqlText), ";")
	for _, tc := range []struct {
		name         string
		rate         float64
		stats        *float64
		wantEstimate float64
	}{
		{"账号1倍率", 0.065, func() *float64 { v := 0.0021934; return &v }(), 0.000142571},
		{"账号3倍率", 0.045, func() *float64 { v := 0.0021934; return &v }(), 0.000098703},
		{"历史空统计基数回落", 0.12, nil, 0.0012},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rid := uuid.NewString()
			_, err := NewUsageLogRepository(client, integrationDB).Create(ctx, &service.UsageLog{RequestID: "client:" + rid, UserID: user.ID, APIKeyID: key.ID, AccountID: account.ID, Model: "gpt-6-sol", InputTokens: 702, OutputTokens: 5, ActualCost: 0.0002, TotalCost: 0.01, RateMultiplier: 0.02, AccountRateMultiplier: &tc.rate, AccountStatsCost: tc.stats, CreatedAt: time.Now().UTC()})
			require.NoError(t, err)
			_, err = integrationDB.Exec(`INSERT INTO ops_error_logs(request_id,client_request_id,user_id,api_key_id,platform,model,status_code,error_phase,error_type,upstream_errors) VALUES($1,$1,$2,$3,'openai','gpt-6-sol',200,'upstream','upstream_error','[]'::jsonb)`, rid, user.ID, key.ID)
			require.NoError(t, err)
			var payload string
			err = integrationDB.QueryRowContext(ctx, "SELECT row_to_json(r)::text FROM ("+sqlText+") r WHERE r.request_id=$1", rid).Scan(&payload)
			require.NoError(t, err)
			var result struct {
				Charged  float64 `json:"local_charged_usd"`
				Estimate float64 `json:"pricing_based_upstream_estimate_usd"`
			}
			require.NoError(t, json.Unmarshal([]byte(payload), &result))
			require.InDelta(t, 0.0002, result.Charged, 1e-12, "对账不得改变用户实收")
			require.InDelta(t, tc.wantEstimate, result.Estimate, 1e-12)
		})
	}
}
