//go:build integration

package repository

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestStage7R2EDurableBillingEvents(t *testing.T) {
	ctx := context.Background()
	schema, err := os.ReadFile("../../../tools/stage7_billing_events_schema.sql")
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, string(schema))
	require.NoError(t, err)
	t.Cleanup(func() { _, e := integrationDB.Exec(`DROP TABLE stage7_billing_events`); require.NoError(t, e) })
	client := testEntClient(t)
	user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@r2e.invalid", PasswordHash: "fixture", Balance: 100})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "fixture-" + uuid.NewString(), Name: "R2E", Quota: 100})
	account := mustCreateAccount(t, client, &service.Account{Name: "fixture-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	store := NewUsageBillingEventStore(integrationDB)
	fixture := func() (*service.UsageBillingCommand, *service.UsageLog) {
		rid := uuid.NewString()
		cmd := &service.UsageBillingCommand{RequestID: rid, APIKeyID: key.ID, UserID: user.ID, AccountID: account.ID, Model: "fixture", InputTokens: 2, OutputTokens: 3, BalanceCost: 0.25, APIKeyQuotaCost: 0.25}
		row := &service.UsageLog{RequestID: rid, APIKeyID: key.ID, UserID: user.ID, AccountID: account.ID, Model: "fixture", InputTokens: 2, OutputTokens: 3, ActualCost: 0.25, TotalCost: 0.25, RateMultiplier: 1}
		return cmd, row
	}
	state := func(rid string) (string, int, int) {
		var status string
		var attempts, logs int
		require.NoError(t, integrationDB.QueryRow(`SELECT status,attempts,(SELECT count(*) FROM usage_logs WHERE request_id=$1) FROM stage7_billing_events WHERE request_id=$1`, rid).Scan(&status, &attempts, &logs))
		return status, attempts, logs
	}
	t.Run("持久化前崩溃仍有窗口", func(t *testing.T) {
		cmd, _ := fixture()
		var count int
		require.NoError(t, integrationDB.QueryRow(`SELECT count(*) FROM stage7_billing_events WHERE request_id=$1`, cmd.RequestID).Scan(&count))
		require.Zero(t, count)
	})
	t.Run("重启恢复与重复投递", func(t *testing.T) {
		cmd, row := fixture()
		row.Account = &service.Account{Credentials: map[string]any{"api_key": "must-never-persist"}}
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		var payload string
		require.NoError(t, integrationDB.QueryRow(`SELECT payload::text FROM stage7_billing_events WHERE request_id=$1`, cmd.RequestID).Scan(&payload))
		require.NotContains(t, payload, "must-never-persist")
		// 新实例仅从数据库读取，不复用任何内存回调。
		processed, err := NewUsageBillingEventStore(integrationDB).ReplayOne(ctx)
		require.NoError(t, err)
		require.True(t, processed)
		status, attempts, logs := state(cmd.RequestID)
		require.Equal(t, "settled", status)
		require.Equal(t, 1, attempts)
		require.Equal(t, 1, logs)
		processed, err = store.ReplayOne(ctx)
		require.NoError(t, err)
		require.False(t, processed)
	})
	t.Run("资金提交完成但事件仍待确认", func(t *testing.T) {
		cmd, row := fixture()
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		// 模拟旧处理路径已经提交/COMMIT 回包丢失：事件重放只能命中原 dedup。
		res, err := NewUsageBillingRepository(client, integrationDB).(service.AtomicUsageBillingRepository).ApplyWithUsage(ctx, cmd, row)
		require.NoError(t, err)
		require.True(t, res.Applied)
		processed, err := store.ReplayOne(ctx)
		require.NoError(t, err)
		require.True(t, processed)
		status, _, logs := state(cmd.RequestID)
		require.Equal(t, "settled", status)
		require.Equal(t, 1, logs)
	})
	t.Run("两个worker与相同事件", func(t *testing.T) {
		cmd, row := fixture()
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		var wg sync.WaitGroup
		errs := make(chan error, 2)
		for range 2 {
			wg.Add(1)
			go func() { defer wg.Done(); _, err := store.ReplayOne(ctx); errs <- err }()
		}
		wg.Wait()
		close(errs)
		for e := range errs {
			require.NoError(t, e)
		}
		status, _, logs := state(cmd.RequestID)
		require.Equal(t, "settled", status)
		require.Equal(t, 1, logs)
	})
	t.Run("持续账务故障有限重试", func(t *testing.T) {
		cmd, row := fixture()
		row.Model = strings.Repeat("x", 1000)
		cmd.Model = row.Model // 保持事件内一致，继续触发真实数据库字段长度错误。
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		for i := 1; i <= 3; i++ {
			_, err := integrationDB.Exec(`UPDATE stage7_billing_events SET next_attempt_at=now() WHERE request_id=$1`, cmd.RequestID)
			require.NoError(t, err)
			processed, err := store.ReplayOne(ctx)
			require.NoError(t, err)
			require.True(t, processed)
			status, attempts, logs := state(cmd.RequestID)
			require.Equal(t, i, attempts)
			require.Zero(t, logs)
			if i == 3 {
				require.Equal(t, "failed", status)
			} else {
				require.Equal(t, "pending", status)
			}
		}
		processed, err := store.ReplayOne(ctx)
		require.NoError(t, err)
		require.False(t, processed)
	})
	t.Run("指纹冲突不覆盖待结算事实", func(t *testing.T) {
		cmd, row := fixture()
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		row.ActualCost = 1
		require.ErrorIs(t, store.Enqueue(ctx, cmd, row), service.ErrUsageBillingRequestConflict)
		_, err := store.ReplayOne(ctx)
		require.NoError(t, err)
		status, _, logs := state(cmd.RequestID)
		require.Equal(t, "settled", status)
		require.Equal(t, 1, logs)
	})
	t.Run("余额与Key额度变化沿用已消费结算", func(t *testing.T) {
		cmd, row := fixture()
		require.NoError(t, store.Enqueue(ctx, cmd, row))
		_, err := integrationDB.Exec(`UPDATE users SET balance=0 WHERE id=$1`, user.ID)
		require.NoError(t, err)
		_, err = integrationDB.Exec(`UPDATE api_keys SET quota=0.01 WHERE id=$1`, key.ID)
		require.NoError(t, err)
		_, err = store.ReplayOne(ctx)
		require.NoError(t, err)
		var balance float64
		require.NoError(t, integrationDB.QueryRow(`SELECT balance FROM users WHERE id=$1`, user.ID).Scan(&balance))
		require.Equal(t, -0.25, balance)
		status, _, logs := state(cmd.RequestID)
		require.Equal(t, "settled", status)
		require.Equal(t, 1, logs)
	})
	t.Run("PG不可用不能伪称入队完成", func(t *testing.T) {
		db, err := sql.Open("postgres", "host=127.0.0.1 port=1 user=fixture dbname=fixture sslmode=disable connect_timeout=1")
		require.NoError(t, err)
		defer db.Close()
		cmd, row := fixture()
		require.Error(t, NewUsageBillingEventStore(db).Enqueue(ctx, cmd, row))
		_, err = NewUsageBillingEventStore(db).ReplayOne(ctx)
		require.Error(t, err)
	})
}
