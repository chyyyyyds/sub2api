package service_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/ent/enttest"
	"github.com/Wei-Shaw/sub2api/ent/redeemcode"
	"github.com/Wei-Shaw/sub2api/internal/handler"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/pagination"
	"github.com/Wei-Shaw/sub2api/internal/repository"
	"github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	_ "modernc.org/sqlite"
)

// 使用真实数据库及正式 Repository，不用内存资产替身验证资金一致性。
type walletDBFixture struct {
	client  *dbent.Client
	db      *sql.DB
	codes   service.RedeemCodeRepository
	users   service.UserRepository
	svc     *service.RedeemService
	userID  int64
	groupID int64
}

func newWalletDBFixture(t *testing.T) *walletDBFixture {
	t.Helper()
	driver, dsn, dialectName := "sqlite", fmt.Sprintf("file:wallet-%d?mode=memory&cache=shared", time.Now().UnixNano()), dialect.SQLite
	if postgresDSN := os.Getenv("SUB2API_WALLET_TEST_POSTGRES_DSN"); postgresDSN != "" {
		// 显式接入独立测试库，每个用例使用唯一 schema，禁止复用业务表。
		admin, err := sql.Open("postgres", postgresDSN)
		require.NoError(t, err)
		schema := fmt.Sprintf("wallet_stage5_%d", time.Now().UnixNano())
		_, err = admin.Exec(`CREATE SCHEMA ` + schema)
		require.NoError(t, err)
		t.Cleanup(func() { _, _ = admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`); _ = admin.Close() })
		parsed, err := url.Parse(postgresDSN)
		require.NoError(t, err)
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		driver, dsn, dialectName = "postgres", parsed.String(), dialect.Postgres
	}
	db, err := sql.Open(driver, dsn)
	require.NoError(t, err)
	if driver == "sqlite" {
		db.SetMaxOpenConns(1)
		_, err = db.Exec("PRAGMA foreign_keys = ON")
		require.NoError(t, err)
	} else {
		db.SetMaxOpenConns(12)
	}
	client := enttest.NewClient(t, enttest.WithOptions(dbent.Driver(entsql.OpenDB(dialectName, db))))
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	user, err := client.User.Create().SetEmail("wallet@example.test").SetPasswordHash("test").SetBalance(10).SetConcurrency(2).Save(ctx)
	require.NoError(t, err)
	group, err := client.Group.Create().SetName("wallet-subscription").SetSubscriptionType(service.SubscriptionTypeSubscription).Save(ctx)
	require.NoError(t, err)
	codes := repository.NewRedeemCodeRepository(client)
	users := repository.NewUserRepository(client, db)
	subs := service.NewSubscriptionService(repository.NewGroupRepository(client, db), repository.NewUserSubscriptionRepository(client), nil, client, nil)
	t.Cleanup(subs.Stop)
	return &walletDBFixture{client, db, codes, users, service.NewRedeemService(codes, users, subs, nil, nil, client, nil, nil), user.ID, group.ID}
}
func (f *walletDBFixture) code(t *testing.T, kind, status string, expires *time.Time) *service.RedeemCode {
	t.Helper()
	c := &service.RedeemCode{Code: fmt.Sprintf("W-%d", time.Now().UnixNano()), Type: kind, Status: status, Value: 20, ExpiresAt: expires, GroupID: &f.groupID, ValidityDays: 5}
	require.NoError(t, f.codes.Create(context.Background(), c))
	return c
}
func (f *walletDBFixture) unchanged(t *testing.T, c *service.RedeemCode) {
	t.Helper()
	ctx := context.Background()
	got, err := f.codes.GetByID(ctx, c.ID)
	require.NoError(t, err)
	require.Equal(t, c.Status, got.Status)
	require.Nil(t, got.UsedBy)
	require.Nil(t, got.UsedAt)
	user, err := f.users.GetByID(ctx, f.userID)
	require.NoError(t, err)
	require.Equal(t, float64(10), user.Balance)
	require.Equal(t, 2, user.Concurrency)
	count, err := f.client.UserSubscription.Query().Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	_, history, err := f.svc.GetUserHistoryPaginated(ctx, f.userID, pagination.PaginationParams{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.Zero(t, history.Total)
}
func TestWalletRejectsInvalidUsedExpiredAndNonBalanceWithoutAssets(t *testing.T) {
	for _, tc := range []struct {
		name, kind, status, reason string
		expired                    bool
	}{
		{"invalid", service.RedeemTypeBalance, service.StatusUnused, "REDEEM_CODE_NOT_FOUND", false},
		{"used", service.RedeemTypeBalance, service.StatusUsed, "REDEEM_CODE_USED", false},
		{"expired", service.RedeemTypeBalance, service.StatusUnused, "REDEEM_CODE_EXPIRED", true},
		{"concurrency", service.RedeemTypeConcurrency, service.StatusUnused, "REDEEM_BALANCE_ONLY", false},
		{"subscription", service.RedeemTypeSubscription, service.StatusUnused, "REDEEM_BALANCE_ONLY", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newWalletDBFixture(t)
			var expiry *time.Time
			if tc.expired {
				past := time.Now().Add(-time.Hour)
				expiry = &past
			}
			c := f.code(t, tc.kind, tc.status, expiry)
			input := c.Code
			if tc.name == "invalid" {
				input = "MISSING"
			}
			result, err := f.svc.Redeem(context.Background(), f.userID, input)
			require.Nil(t, result)
			require.Equal(t, tc.reason, infraerrors.Reason(err))
			f.unchanged(t, c)
		})
	}
}
func TestWalletBalanceCommitsAndRetryCannotCreditTwice(t *testing.T) {
	f := newWalletDBFixture(t)
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	got, err := f.svc.Redeem(context.Background(), f.userID, c.Code)
	require.NoError(t, err)
	require.Equal(t, service.StatusUsed, got.Status)
	require.Equal(t, f.userID, *got.UsedBy)
	require.NotNil(t, got.UsedAt)
	user, err := f.users.GetByID(context.Background(), f.userID)
	require.NoError(t, err)
	require.Equal(t, float64(30), user.Balance)
	require.Equal(t, 2, user.Concurrency)
	_, err = f.svc.Redeem(context.Background(), f.userID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemCodeUsed)
	user, err = f.users.GetByID(context.Background(), f.userID)
	require.NoError(t, err)
	require.Equal(t, float64(30), user.Balance)
	history, page, err := f.svc.GetUserHistoryPaginated(context.Background(), f.userID, pagination.PaginationParams{Page: 1, PageSize: 7})
	require.NoError(t, err)
	require.EqualValues(t, 1, page.Total)
	require.Len(t, history, 1)
	require.Equal(t, c.ID, history[0].ID)
}

type walletFailBalanceRepo struct{ service.UserRepository }

func (r walletFailBalanceRepo) UpdateBalance(ctx context.Context, id int64, delta float64) error {
	if err := r.UserRepository.UpdateBalance(ctx, id, delta); err != nil {
		return err
	}
	return errors.New("injected failure after actual asset write")
}
func TestWalletRollsBackCodeAndActualBalanceWrite(t *testing.T) {
	f := newWalletDBFixture(t)
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	svc := service.NewRedeemService(f.codes, walletFailBalanceRepo{f.users}, nil, nil, nil, f.client, nil, nil)
	_, err := svc.Redeem(context.Background(), f.userID, c.Code)
	require.ErrorContains(t, err, "injected failure")
	f.unchanged(t, c)
	// 回滚后原码仍可正常兑换，不遗留失败的成功记录。
	_, err = f.svc.Redeem(context.Background(), f.userID, c.Code)
	require.NoError(t, err)
}

type walletBarrierRepo struct {
	service.RedeemCodeRepository
	ready   sync.WaitGroup
	release chan struct{}
}

func (r *walletBarrierRepo) GetByCode(ctx context.Context, code string) (*service.RedeemCode, error) {
	got, err := r.RedeemCodeRepository.GetByCode(ctx, code)
	r.ready.Done()
	select {
	case <-r.release:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return got, err
}
func TestWalletConcurrentSameCodeCreditsOnceWithoutRedis(t *testing.T) {
	f := newWalletDBFixture(t)
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	repo := &walletBarrierRepo{RedeemCodeRepository: f.codes, release: make(chan struct{})}
	const count = 8
	repo.ready.Add(count)
	svc := service.NewRedeemService(repo, f.users, nil, nil, nil, f.client, nil, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	results := make(chan error, count)
	for i := 0; i < count; i++ {
		go func() { _, err := svc.Redeem(ctx, f.userID, c.Code); results <- err }()
	}
	done := make(chan struct{})
	go func() { repo.ready.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("concurrent read barrier timed out")
	}
	close(repo.release)
	successes := 0
	for i := 0; i < count; i++ {
		err := <-results
		if err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, service.ErrRedeemCodeUsed)
		}
	}
	require.Equal(t, 1, successes)
	user, err := f.users.GetByID(ctx, f.userID)
	require.NoError(t, err)
	require.Equal(t, float64(30), user.Balance)
	used, err := f.client.RedeemCode.Query().Where(redeemcode.StatusEQ(service.StatusUsed)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, used)
}

type walletLockCache struct {
	locked   atomic.Bool
	failures int
}

func (c *walletLockCache) GetRedeemAttemptCount(context.Context, int64) (int, error) {
	return c.failures, nil
}
func (c *walletLockCache) IncrementRedeemAttemptCount(context.Context, int64) error {
	c.failures++
	return nil
}
func (c *walletLockCache) AcquireRedeemLock(context.Context, string, time.Duration) (bool, error) {
	return c.locked.CompareAndSwap(false, true), nil
}
func (c *walletLockCache) ReleaseRedeemLock(context.Context, string) error {
	c.locked.Store(false)
	return nil
}
func TestWalletRetainsFailureRateLimitAndCodeLock(t *testing.T) {
	f := newWalletDBFixture(t)
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	cache := &walletLockCache{failures: 30}
	svc := service.NewRedeemService(f.codes, f.users, nil, cache, nil, f.client, nil, nil)
	_, err := svc.Redeem(context.Background(), f.userID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemRateLimited)
	f.unchanged(t, c)
	cache.failures = 0
	cache.locked.Store(true)
	_, err = svc.Redeem(context.Background(), f.userID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemCodeLocked)
	f.unchanged(t, c)
}
func TestWalletAdminFulfillmentPreservesConcurrencyAndSubscription(t *testing.T) {
	for _, kind := range []string{service.RedeemTypeConcurrency, service.RedeemTypeSubscription} {
		t.Run(kind, func(t *testing.T) {
			f := newWalletDBFixture(t)
			f.db.SetMaxOpenConns(4)
			c := f.code(t, kind, service.StatusUnused, nil)
			_, err := f.svc.Redeem(context.Background(), f.userID, c.Code)
			require.ErrorIs(t, err, service.ErrRedeemBalanceOnly)
			f.unchanged(t, c)
			// 同一码经可信管理员入口履约，非余额类型分支仍保留。
			got, err := f.svc.RedeemForAdminFulfillment(context.Background(), f.userID, c.Code)
			require.NoError(t, err)
			require.Equal(t, service.StatusUsed, got.Status)
			user, err := f.users.GetByID(context.Background(), f.userID)
			require.NoError(t, err)
			require.Equal(t, float64(10), user.Balance)
			if kind == service.RedeemTypeConcurrency {
				require.Equal(t, 22, user.Concurrency)
			} else {
				require.Equal(t, 2, user.Concurrency)
				subs, err := f.client.UserSubscription.Query().All(context.Background())
				require.NoError(t, err)
				require.Len(t, subs, 1)
				require.Equal(t, f.groupID, subs[0].GroupID)
				require.InDelta(t, 5, subs[0].ExpiresAt.Sub(subs[0].StartsAt).Hours()/24, .01)
			}
		})
	}
}

func TestWalletPublicHTTPUsesAuthenticatedUserAndRejectsTypeBypass(t *testing.T) {
	for _, kind := range []string{service.RedeemTypeBalance, service.RedeemTypeConcurrency, service.RedeemTypeSubscription} {
		t.Run(kind, func(t *testing.T) {
			f := newWalletDBFixture(t)
			c := f.code(t, kind, service.StatusUnused, nil)
			h := handler.NewRedeemHandler(f.svc)
			w := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(w)
			ctx.Request = httptest.NewRequest("POST", "/api/v1/redeem", strings.NewReader(fmt.Sprintf(`{"code":%q,"type":"balance","user_id":999,"admin":true}`, c.Code)))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set(string(middleware.ContextKeyUser), middleware.AuthSubject{UserID: f.userID})
			h.Redeem(ctx)
			if kind == service.RedeemTypeBalance {
				require.Equal(t, 200, w.Code)
				var out struct {
					Data struct {
						ID     int64  `json:"id"`
						Type   string `json:"type"`
						UsedBy int64  `json:"used_by"`
					} `json:"data"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
				require.Equal(t, c.ID, out.Data.ID)
				require.Equal(t, f.userID, out.Data.UsedBy)
				require.Equal(t, "balance", out.Data.Type)
				user, err := f.users.GetByID(context.Background(), f.userID)
				require.NoError(t, err)
				require.Equal(t, float64(30), user.Balance)
			} else {
				require.Equal(t, 400, w.Code)
				require.Contains(t, w.Body.String(), "REDEEM_BALANCE_ONLY")
				f.unchanged(t, c)
			}
		})
	}
}
func TestWalletPublicHTTPRequiresAuthenticationBeforeAnyUse(t *testing.T) {
	f := newWalletDBFixture(t)
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Request = httptest.NewRequest("POST", "/api/v1/redeem", strings.NewReader(fmt.Sprintf(`{"code":%q}`, c.Code)))
	ctx.Request.Header.Set("Content-Type", "application/json")
	handler.NewRedeemHandler(f.svc).Redeem(ctx)
	require.Equal(t, 401, w.Code)
	f.unchanged(t, c)
}

// 连接显式指定的隔离 Redis，验证正式分布式锁与失败计数器。
func TestWalletRealRedisLockAndFailureLimit(t *testing.T) {
	addr := os.Getenv("SUB2API_WALLET_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("未指定独立 Redis 测试依赖")
	}
	f := newWalletDBFixture(t)
	client := redis.NewClient(&redis.Options{Addr: addr, DB: 15})
	defer client.Close()
	ctx := context.Background()
	require.NoError(t, client.Ping(ctx).Err())
	cache := repository.NewRedeemCache(client)
	userID := f.userID
	// PG 各 schema 的用户 ID 会重复，以唯一测试 ID 隔离限流键。
	limiterID := time.Now().UnixNano()
	defer client.Del(ctx, fmt.Sprintf("redeem:ratelimit:v2:%d", limiterID))
	for i := 0; i < 30; i++ {
		_, err := service.NewRedeemService(f.codes, f.users, nil, cache, nil, f.client, nil, nil).Redeem(ctx, limiterID, "MISSING")
		require.ErrorIs(t, err, service.ErrRedeemCodeNotFound)
	}
	c := f.code(t, service.RedeemTypeBalance, service.StatusUnused, nil)
	svc := service.NewRedeemService(f.codes, f.users, nil, cache, nil, f.client, nil, nil)
	_, err := svc.Redeem(ctx, limiterID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemRateLimited)
	f.unchanged(t, c)
	acquired, err := cache.AcquireRedeemLock(ctx, c.Code, time.Second*10)
	require.NoError(t, err)
	require.True(t, acquired)
	_, err = svc.Redeem(ctx, userID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemCodeLocked)
	f.unchanged(t, c)
	require.NoError(t, cache.ReleaseRedeemLock(ctx, c.Code))
	_, err = svc.Redeem(ctx, userID, c.Code)
	require.NoError(t, err)
	user, err := f.users.GetByID(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, float64(30), user.Balance)
	_, err = svc.Redeem(ctx, userID, c.Code)
	require.ErrorIs(t, err, service.ErrRedeemCodeUsed)
	user, err = f.users.GetByID(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, float64(30), user.Balance)
	count, err := cache.GetRedeemAttemptCount(ctx, userID)
	require.NoError(t, err)
	require.Equal(t, 1, count)
	defer client.Del(ctx, fmt.Sprintf("redeem:ratelimit:v2:%d", userID))
}
