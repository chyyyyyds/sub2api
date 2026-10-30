//go:build integration && koko

package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

// 固定隔离库入口不接受生产 DSN，必须显式选择 koko 构建标签和夹具标记。
func init() {
	integrationKokoMain = func(m *testing.M) {
		ctx := context.Background()
		_ = timezone.Init("UTC")
		var e error
		integrationDB, e = sql.Open("postgres", "postgres://postgres:koko-test-only@sub2api-koko-c2-pg:5432/koko_c2?sslmode=disable")
		if e != nil {
			log.Fatal(e)
		}
		if e = ApplyMigrations(ctx, integrationDB); e != nil {
			log.Fatal(e)
		}
		// 隔离夹具库允许重复运行：历史待核对测试样本不参与本轮 Worker 认领。
		if _, e = integrationDB.ExecContext(ctx, `UPDATE video_tasks SET next_check_at='infinity',lease_owner=NULL,lease_until=NULL WHERE status NOT IN('COMPLETED','FAILED')`); e != nil {
			log.Fatal(e)
		}
		integrationEntClient = dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, integrationDB)))
		code := m.Run()
		_ = integrationDB.Close()
		os.Exit(code)
	}
}

type kokoFixture struct {
	repo                               *videoRepository
	record                             service.VideoTaskRecord
	user, key, group, account, channel int64
}

func newKokoFixture(t *testing.T) *kokoFixture {
	t.Helper()
	ctx := context.Background()
	f := &kokoFixture{repo: &videoRepository{db: integrationDB}}
	suffix := uuid.NewString()
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO users(email,password_hash,balance) VALUES($1,'mock-password',100) RETURNING id`, suffix+"@mock.invalid").Scan(&f.user))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO groups(name,platform,status,allow_koko_video_generation) VALUES($1,'video','active',true) RETURNING id`, suffix).Scan(&f.group))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO accounts(name,platform,type,credentials) VALUES($1,'video','apikey','{"api_key":"mock-only","base_url":"https://pay.kokoai.online/openapi/v1","openai_capabilities":["koko_video"]}') RETURNING id`, suffix).Scan(&f.account))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO api_keys(user_id,key,name,group_id) VALUES($1,$2,'Mock 视频 Key',$3) RETURNING id`, f.user, "sk-mock-"+suffix, f.group).Scan(&f.key))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO channels(name) VALUES($1) RETURNING id`, suffix).Scan(&f.channel))
	_, e := integrationDB.ExecContext(ctx, `INSERT INTO account_groups(account_id,group_id) VALUES($1,$2)`, f.account, f.group)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `INSERT INTO channel_groups(channel_id,group_id) VALUES($1,$2)`, f.channel, f.group)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `INSERT INTO channel_model_pricing(channel_id,platform,models,billing_mode,per_request_price) VALUES($1,'video','["oo-sd25-1080p"]','video',8)`, f.channel)
	require.NoError(t, e)
	optional := false
	model := service.KokoVideoModel{ID: "oo-sd25-1080p", Name: "Mock 视频", Type: "video", Enabled: true, Durations: []int{5}, Ratios: []string{"16:9"}, Resolutions: []string{"768p"}, Modes: []string{"text-to-video"}, RequiresImage: &optional, DurationPrices: map[string]json.Number{"5": "20"}}
	scope := strings.Repeat("a", 64)
	require.NoError(t, f.repo.SaveModels(ctx, f.account, scope, []service.KokoVideoModel{model}))
	price, _, e := f.repo.Quote(ctx, f.group, f.user, "oo-sd25-1080p", service.VideoCreateRequest{Duration: 5, Resolution: "768p", Mode: "text-to-video"})
	require.NoError(t, e)
	f.record = service.VideoTaskRecord{PublicID: "vtsk_" + strings.ReplaceAll(uuid.NewString(), "-", ""), UserID: f.user, APIKeyID: f.key, GroupID: f.group, ChannelID: f.channel, AccountID: f.account, Scope: scope, RequestedModel: "oo-sd25-1080p", UpstreamModel: "oo-sd25-1080p", IdempotencyKey: "mock_" + strings.ReplaceAll(uuid.NewString(), "-", ""), RequestHash: strings.Repeat("b", 64), Ciphertext: []byte("encrypted-mock"), Capability: model, Pricing: price}
	t.Cleanup(func() {
		// 只调整当前隔离测试样本的调度，不修改资金或业务终态。
		_, _ = integrationDB.ExecContext(context.Background(), `UPDATE video_tasks SET next_check_at='infinity',lease_owner=NULL,lease_until=NULL WHERE user_id=$1 AND status NOT IN('COMPLETED','FAILED')`, f.user)
	})
	return f
}
func (f *kokoFixture) create(t *testing.T) *service.VideoTask {
	t.Helper()
	task, e := f.repo.Create(context.Background(), &f.record)
	require.NoError(t, e)
	return task
}
func (f *kokoFixture) finish(t *testing.T, status string, now time.Time) {
	t.Helper()
	ctx := context.Background()
	task, e := f.repo.Claim(ctx, "mock-worker", now)
	require.NoError(t, e)
	require.Equal(t, f.record.PublicID, task.PublicID)
	require.NoError(t, f.repo.Observe(ctx, task, &service.KokoTaskResult{ID: "upstream_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Status: status}, "", false, now))
	var event int64
	op := "CAPTURE"
	if status == "failed" {
		op = "RELEASE"
	}
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT id FROM video_billing_events WHERE task_id=$1 AND operation=$2`, task.DBID, op).Scan(&event))
	require.NoError(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, op))
	require.NoError(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, op))
}
func TestKokoConcurrentIdempotencyAndCapture(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); record := f.record; _, e := f.repo.Create(ctx, &record); errs <- e }()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		require.NoError(t, e)
	}
	var balance, frozen string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text,frozen_balance::text FROM users WHERE id=$1`, f.user).Scan(&balance, &frozen))
	require.Equal(t, "92.00000000", balance)
	require.Equal(t, "8.00000000", frozen)
	// 通过可控任务时钟模拟两小时，不实际等待，也不触发超时退款。
	f.finish(t, "completed", time.Now().Add(2*time.Hour))
	var count int
	var charged string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT COUNT(*),MAX(actual_cost)::text FROM usage_logs WHERE user_id=$1 AND media_type='video' AND billing_mode='video' AND video_count=1`, f.user).Scan(&count, &charged))
	require.Equal(t, 1, count)
	require.Equal(t, "8.0000000000", charged)
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text,frozen_balance::text FROM users WHERE id=$1`, f.user).Scan(&balance, &frozen))
	require.Equal(t, "92.00000000", balance)
	require.Equal(t, "0.00000000", frozen)
	record := f.record
	record.RequestHash = strings.Repeat("c", 64)
	_, e := f.repo.Create(ctx, &record)
	require.EqualError(t, e, "VIDEO_IDEMPOTENCY_CONFLICT")
}
func TestKokoFailureRefundAndOwnership(t *testing.T) {
	f := newKokoFixture(t)
	task := f.create(t)
	ctx := context.Background()
	_, e := f.repo.Get(ctx, task.ID, f.user, f.key+1, f.group)
	require.ErrorIs(t, e, sql.ErrNoRows)
	f.finish(t, "failed", time.Now().Add(time.Second))
	task, e = f.repo.Get(ctx, task.ID, f.user, f.key, f.group)
	require.NoError(t, e)
	require.Equal(t, "RELEASED", task.BillingState)
	var balance, frozen string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text,frozen_balance::text FROM users WHERE id=$1`, f.user).Scan(&balance, &frozen))
	require.Equal(t, "100.00000000", balance)
	require.Equal(t, "0.00000000", frozen)
	var count int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM usage_logs WHERE user_id=$1`, f.user).Scan(&count))
	require.Zero(t, count)
	audit, e := f.repo.Audit(ctx, task.ID)
	require.NoError(t, e)
	require.Contains(t, string(audit), "RELEASED")
	require.Contains(t, string(audit), "APPLIED")
}
func TestKokoLeaseFenceAndUnknown(t *testing.T) {
	f := newKokoFixture(t)
	f.create(t)
	ctx := context.Background()
	now := time.Now().Add(time.Second)
	first, e := f.repo.Claim(ctx, "worker-a", now)
	require.NoError(t, e)
	_, e = f.repo.Claim(ctx, "worker-b", now)
	require.ErrorIs(t, e, sql.ErrNoRows)
	second, e := f.repo.Claim(ctx, "worker-b", now.Add(14*time.Minute))
	require.NoError(t, e)
	require.Greater(t, second.LeaseEpoch, first.LeaseEpoch)
	require.Error(t, f.repo.Observe(ctx, first, &service.KokoTaskResult{ID: "mock_upstream", Status: "completed"}, "", false, now.Add(14*time.Minute)))
	require.NoError(t, f.repo.Observe(ctx, second, nil, "KOKO_SUBMISSION_UNKNOWN", false, now.Add(14*time.Minute)))
	view, e := f.repo.Get(ctx, f.record.PublicID, f.user, f.key, f.group)
	require.NoError(t, e)
	require.Equal(t, "SUBMISSION_UNKNOWN", view.Status)
	require.Equal(t, "HELD", view.BillingState)
	// 测试结束时明确留待核对，再由下一条测试认领顺序隔离。
	_, e = integrationDB.ExecContext(ctx, `UPDATE video_tasks SET next_check_at=now()+interval '1 year' WHERE public_id=$1`, view.ID)
	require.NoError(t, e)
}
func TestKokoInitializationAndDynamicModels(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	models, e := f.repo.Models(ctx, f.account)
	require.NoError(t, e)
	req := service.VideoInitializeRequest{AccountID: f.account, GroupID: f.group, ChannelID: f.channel}
	one, e := f.repo.Initialize(ctx, req, models)
	require.NoError(t, e)
	two, e := f.repo.Initialize(ctx, req, models)
	require.NoError(t, e)
	require.Equal(t, one, two)
	var count int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT COUNT(*) FROM channel_model_pricing WHERE channel_id=$1`, f.channel).Scan(&count))
	require.Equal(t, 1, count)
	models[0].Maintenance = true
	require.NoError(t, f.repo.SaveModels(ctx, f.account, f.record.Scope, models))
	_, e = f.repo.Create(ctx, &f.record)
	require.EqualError(t, e, "VIDEO_MODEL_DISABLED")
	require.NoError(t, f.repo.SaveModels(ctx, f.account, f.record.Scope, nil))
	models, e = f.repo.Models(ctx, f.account)
	require.NoError(t, e)
	require.False(t, models[0].Enabled)
}
func TestKokoFinancialRollbackRecovery(t *testing.T) {
	f := newKokoFixture(t)
	f.create(t)
	ctx := context.Background()
	task, e := f.repo.Claim(ctx, "worker", time.Now().Add(time.Second))
	require.NoError(t, e)
	require.NoError(t, f.repo.Observe(ctx, task, &service.KokoTaskResult{ID: "mock_billing_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Status: "completed"}, "", false, time.Now().Add(time.Second)))
	var event int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT id FROM video_billing_events WHERE task_id=$1 AND operation='CAPTURE'`, task.DBID).Scan(&event))
	_, e = integrationDB.ExecContext(ctx, `CREATE OR REPLACE FUNCTION koko_test_fail_usage() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'mock usage insert failure';END;$$; CREATE TRIGGER koko_test_fail_usage BEFORE INSERT ON usage_logs FOR EACH ROW EXECUTE FUNCTION koko_test_fail_usage()`)
	require.NoError(t, e)
	require.Error(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, "CAPTURE"))
	_, e = integrationDB.ExecContext(ctx, `DROP TRIGGER koko_test_fail_usage ON usage_logs;DROP FUNCTION koko_test_fail_usage()`)
	require.NoError(t, e)
	view, e := f.repo.Get(ctx, task.PublicID, f.user, f.key, f.group)
	require.NoError(t, e)
	require.Equal(t, "HELD", view.BillingState)
	require.NoError(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, "CAPTURE"))
	view, e = f.repo.Get(ctx, task.PublicID, f.user, f.key, f.group)
	require.NoError(t, e)
	require.Equal(t, "CAPTURED", view.BillingState)
}

func TestKokoDefaultInitializationIsDisabledAndIdempotent(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	models, e := f.repo.Models(ctx, f.account)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `DELETE FROM account_groups WHERE account_id=$1`, f.account)
	require.NoError(t, e)
	first, e := f.repo.Initialize(ctx, service.VideoInitializeRequest{AccountID: f.account}, models)
	require.NoError(t, e)
	second, e := f.repo.Initialize(ctx, service.VideoInitializeRequest{AccountID: f.account}, models)
	require.NoError(t, e)
	require.Equal(t, first, second)
	require.False(t, first.CreationEnabled)
	var status string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT status FROM groups WHERE id=$1`, first.GroupID).Scan(&status))
	require.Equal(t, "disabled", status)
	_, e = integrationDB.ExecContext(ctx, `UPDATE channel_model_pricing SET per_request_price=9 WHERE channel_id=$1`, first.ChannelID)
	require.NoError(t, e)
	_, e = f.repo.Initialize(ctx, service.VideoInitializeRequest{AccountID: f.account}, models)
	require.NoError(t, e)
	var price string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT per_request_price::text FROM channel_model_pricing WHERE channel_id=$1 LIMIT 1`, first.ChannelID).Scan(&price))
	require.Equal(t, "9", decimal.RequireFromString(price).String())
	require.NoError(t, ApplyMigrations(ctx, integrationDB))
}
func TestKokoQuotaHoldsAndAccountBindingProtection(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	_, e := integrationDB.ExecContext(ctx, `UPDATE api_keys SET quota=8 WHERE id=$1`, f.key)
	require.NoError(t, e)
	f.create(t)
	require.EqualError(t, f.repo.CheckAdmission(ctx, f.user, f.key, f.group, "0"), "VIDEO_KEY_QUOTA_EXCEEDED")
	second := f.record
	second.PublicID = "vtsk_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	second.IdempotencyKey = "another_mock_key"
	_, e = f.repo.Create(ctx, &second)
	require.EqualError(t, e, "VIDEO_KEY_QUOTA_EXCEEDED")
	_, e = integrationDB.ExecContext(ctx, `UPDATE accounts SET status='disabled' WHERE id=$1`, f.account)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `UPDATE accounts SET credentials='{}' WHERE id=$1`, f.account)
	require.Error(t, e)
	_, e = integrationDB.ExecContext(ctx, `UPDATE video_tasks SET account_id=$2 WHERE public_id=$1`, f.record.PublicID, f.account+1)
	require.Error(t, e)
	f.finish(t, "failed", time.Now().Add(time.Second))
}
func TestKokoPlatformLedgerSurvivesLegacySnapshots(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	_, e := integrationDB.ExecContext(ctx, `INSERT INTO user_platform_quotas(user_id,platform,daily_limit_usd,daily_usage_usd,daily_window_start) VALUES($1,'video',16,2,date_trunc('day',now()))`, f.user)
	require.NoError(t, e)
	f.create(t)
	require.EqualError(t, f.repo.CheckAdmission(ctx, f.user, f.key, f.group, "7"), "VIDEO_PLATFORM_QUOTA_EXCEEDED")
	f.finish(t, "completed", time.Now().Add(time.Second))
	// 模拟旧平台 dirty flusher 的绝对值写回；视频消费仍从独立账本合并。
	_, e = integrationDB.ExecContext(ctx, `UPDATE user_platform_quotas SET daily_usage_usd=2 WHERE user_id=$1`, f.user)
	require.NoError(t, e)
	require.EqualError(t, f.repo.CheckAdmission(ctx, f.user, f.key, f.group, "7"), "VIDEO_PLATFORM_QUOTA_EXCEEDED")
}
func TestKokoSubscriptionReserveAndCapture(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	_, e := integrationDB.ExecContext(ctx, `UPDATE groups SET subscription_type='subscription',daily_limit_usd=10 WHERE id=$1`, f.group)
	require.NoError(t, e)
	var sub int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO user_subscriptions(user_id,group_id,starts_at,expires_at,status,daily_window_start,weekly_window_start,monthly_window_start) VALUES($1,$2,now(),now()+interval '30 days','active',date_trunc('day',now()),now(),now()) RETURNING id`, f.user, f.group).Scan(&sub))
	f.create(t)
	var balance, frozen string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text,frozen_balance::text FROM users WHERE id=$1`, f.user).Scan(&balance, &frozen))
	require.Equal(t, "100.00000000", balance)
	require.Equal(t, "0.00000000", frozen)
	require.EqualError(t, f.repo.CheckAdmission(ctx, f.user, f.key, f.group, "3"), "VIDEO_SUBSCRIPTION_QUOTA_EXCEEDED")
	f.finish(t, "completed", time.Now().Add(time.Second))
	var daily string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT daily_usage_usd::text FROM user_subscriptions WHERE id=$1`, sub).Scan(&daily))
	require.Equal(t, "8", decimal.RequireFromString(daily).String())
	var billingType int
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT billing_type FROM usage_logs WHERE user_id=$1`, f.user).Scan(&billingType))
	require.Equal(t, 1, billingType)
}

func TestKokoUsageSnapshotSurvivesPriceAndGroupChanges(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	f.create(t)
	var newGroup int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `INSERT INTO groups(name,platform) VALUES($1,'video') RETURNING id`, uuid.NewString()).Scan(&newGroup))
	_, e := integrationDB.ExecContext(ctx, `UPDATE channel_model_pricing SET per_request_price=99 WHERE channel_id=$1`, f.channel)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `UPDATE groups SET rate_multiplier=2 WHERE id=$1`, f.group)
	require.NoError(t, e)
	_, e = integrationDB.ExecContext(ctx, `UPDATE api_keys SET group_id=$2 WHERE id=$1`, f.key, newGroup)
	require.NoError(t, e)
	f.finish(t, "completed", time.Now().Add(time.Second))
	_, e = f.repo.Get(ctx, f.record.PublicID, f.user, f.key, newGroup)
	require.ErrorIs(t, e, sql.ErrNoRows)
	var usageID int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT id FROM usage_logs WHERE user_id=$1`, f.user).Scan(&usageID))
	log, e := (&usageLogRepository{sql: integrationDB, db: integrationDB}).GetByID(ctx, usageID)
	require.NoError(t, e)
	require.Equal(t, "video", *log.MediaType)
	require.Equal(t, f.record.PublicID, *log.VideoTaskID)
	require.Equal(t, "8.00000000", log.VideoPricingSnapshot.Charge)
	require.Equal(t, 8.0, log.ActualCost)
	require.Equal(t, 1, log.VideoCount)
	require.Equal(t, 5, *log.VideoDurationSeconds)
	require.Equal(t, f.group, *log.GroupID)
}

func TestKokoRefundTransactionFailureRecovery(t *testing.T) {
	f := newKokoFixture(t)
	ctx := context.Background()
	f.create(t)
	task, e := f.repo.Claim(ctx, "refund-worker", time.Now().Add(time.Second))
	require.NoError(t, e)
	require.NoError(t, f.repo.Observe(ctx, task, &service.KokoTaskResult{ID: "mock_refund_" + strings.ReplaceAll(uuid.NewString(), "-", ""), Status: "failed"}, "", false, time.Now().Add(time.Second)))
	var event int64
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT id FROM video_billing_events WHERE task_id=$1 AND operation='RELEASE'`, task.DBID).Scan(&event))
	_, e = integrationDB.ExecContext(ctx, `CREATE OR REPLACE FUNCTION koko_test_fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.state='RELEASED' THEN RAISE EXCEPTION 'mock refund failure';END IF;RETURN NEW;END;$$;CREATE TRIGGER koko_test_fail_refund BEFORE UPDATE ON video_financial_reservations FOR EACH ROW EXECUTE FUNCTION koko_test_fail_refund()`)
	require.NoError(t, e)
	require.Error(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, "RELEASE"))
	var balance string
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text FROM users WHERE id=$1`, f.user).Scan(&balance))
	require.Equal(t, "92.00000000", balance)
	_, e = integrationDB.ExecContext(ctx, `DROP TRIGGER koko_test_fail_refund ON video_financial_reservations;DROP FUNCTION koko_test_fail_refund()`)
	require.NoError(t, e)
	require.NoError(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, "RELEASE"))
	require.NoError(t, f.repo.settleVideo(ctx, event, task.DBID, task.PublicID, "RELEASE"))
	require.NoError(t, integrationDB.QueryRowContext(ctx, `SELECT balance::text FROM users WHERE id=$1`, f.user).Scan(&balance))
	require.Equal(t, "100.00000000", balance)
}
