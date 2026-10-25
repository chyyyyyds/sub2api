//go:build integration && stage8q

package repository

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/lib/pq"
	redisclient "github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

const stage8qDSN = "host=127.0.0.1 port=18448 user=postgres password=postgres dbname=stage8q_synthetic sslmode=disable connect_timeout=2"

type stage8qReadOnlyDriver struct{}
type stage8qReadOnlyConnection struct{ driver.Conn }

func (stage8qReadOnlyDriver) Open(dsn string) (driver.Conn, error) {
	c, err := (&pq.Driver{}).Open(dsn)
	if err != nil {
		return nil, err
	}
	return &stage8qReadOnlyConnection{c}, nil
}
func (c *stage8qReadOnlyConnection) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	opts.ReadOnly = true
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, opts)
}
func init() {
	sql.Register("stage8q-readonly", stage8qReadOnlyDriver{})
	integrationStage8QMain = stage8qMain
}

// 真实 PG/Redis 仅限专用端口与全新合成库；正式迁移只应用于本次空库。
func stage8qMain(m *testing.M) {
	if err := timezone.Init("UTC"); err != nil {
		log.Fatal(err)
	}
	var err error
	integrationDB, err = sql.Open("postgres", stage8qDSN)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var database string
	if err = integrationDB.QueryRowContext(ctx, "SELECT current_database()").Scan(&database); err != nil || database != "stage8q_synthetic" {
		log.Fatalf("隔离库身份校验失败: %s %v", database, err)
	}
	if err = ApplyMigrations(ctx, integrationDB); err != nil {
		log.Fatal(err)
	}
	integrationEntClient = dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, integrationDB)))
	integrationRedis = redisclient.NewClient(&redisclient.Options{Addr: "127.0.0.1:18449"})
	if err = integrationRedis.Ping(ctx).Err(); err != nil {
		log.Fatal(err)
	}
	code := m.Run()
	_ = integrationRedis.Close()
	_ = integrationEntClient.Close()
	os.Exit(code)
}

func stage8qFinancialFixture(t *testing.T, request string) (*service.UsageBillingCommand, *service.UsageLog) {
	t.Helper()
	client := testEntClient(t)
	u := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@stage8q.invalid", PasswordHash: "synthetic", Balance: 100})
	k := mustCreateApiKey(t, client, &service.APIKey{UserID: u.ID, Key: "fixture-" + uuid.NewString(), Name: "stage8q", Quota: 100})
	a := mustCreateAccount(t, client, &service.Account{Name: "stage8q-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	cmd := &service.UsageBillingCommand{RequestID: "stage8q-" + request + uuid.NewString(), APIKeyID: k.ID, UserID: u.ID, AccountID: a.ID, AccountType: service.AccountTypeAPIKey, Model: "gpt-6-sol", InputTokens: 2, OutputTokens: 3, BalanceCost: 0.25, APIKeyQuotaCost: 0.25}
	row := &service.UsageLog{RequestID: cmd.RequestID, UserID: u.ID, APIKeyID: k.ID, AccountID: a.ID, Model: cmd.Model, InputTokens: 2, OutputTokens: 3, ActualCost: 0.25, TotalCost: 0.25, RateMultiplier: 1}
	return cmd, row
}

func stage8qAssertFunds(t *testing.T, cmd *service.UsageBillingCommand, balance, quota string, counts int) {
	t.Helper()
	var b, q string
	require.NoError(t, integrationDB.QueryRow("SELECT balance::text FROM users WHERE id=$1", cmd.UserID).Scan(&b))
	require.NoError(t, integrationDB.QueryRow("SELECT quota_used::text FROM api_keys WHERE id=$1", cmd.APIKeyID).Scan(&q))
	require.Equal(t, balance, b)
	require.Equal(t, quota, q)
	for _, table := range []string{"usage_logs", "usage_billing_dedup"} {
		var n int
		require.NoError(t, integrationDB.QueryRow("SELECT count(*) FROM "+table+" WHERE request_id=$1 AND api_key_id=$2", cmd.RequestID, cmd.APIKeyID).Scan(&n))
		require.Equal(t, counts, n, table)
	}
}

func TestStage8QFinancialFaults(t *testing.T) {
	repo := NewUsageBillingRepository(integrationEntClient, integrationDB).(stage8qAtomicBilling)
	t.Run("concurrent_and_completed_duplicate", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "parallel")
		var applied atomic.Int32
		var wg sync.WaitGroup
		for range 12 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				c, r := *cmd, *row
				res, err := repo.ApplyWithUsage(context.Background(), &c, &r)
				require.NoError(t, err)
				if err == nil && res.Applied {
					applied.Add(1)
				}
			}()
		}
		wg.Wait()
		require.EqualValues(t, 1, applied.Load())
		res, err := repo.ApplyWithUsage(context.Background(), cmd, row)
		require.NoError(t, err)
		require.False(t, res.Applied)
		stage8qAssertFunds(t, cmd, "99.75000000", "0.25000000", 1)
	})
	t.Run("temporary_pg_write_failure_same_id_recovery", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "writefault")
		_, err := integrationDB.Exec(`CREATE FUNCTION stage8q_reject_usage() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id LIKE 'stage8q-writefault%' THEN RAISE EXCEPTION 'stage8q synthetic temporary write failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER stage8q_reject_usage BEFORE INSERT ON usage_logs FOR EACH ROW EXECUTE FUNCTION stage8q_reject_usage()`)
		require.NoError(t, err)
		defer func() {
			_, _ = integrationDB.Exec("DROP TRIGGER IF EXISTS stage8q_reject_usage ON usage_logs; DROP FUNCTION IF EXISTS stage8q_reject_usage()")
		}()
		_, err = repo.ApplyWithUsage(context.Background(), cmd, row)
		require.Error(t, err)
		stage8qAssertFunds(t, cmd, "100.00000000", "0.00000000", 0)
		_, err = integrationDB.Exec("DROP TRIGGER stage8q_reject_usage ON usage_logs; DROP FUNCTION stage8q_reject_usage()")
		require.NoError(t, err)
		res, err := repo.ApplyWithUsage(context.Background(), cmd, row)
		require.NoError(t, err)
		require.True(t, res.Applied)
		stage8qAssertFunds(t, cmd, "99.75000000", "0.25000000", 1)
	})
	t.Run("read_only_select_is_not_writable", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "readonly")
		// lib/pq 默认 BeginTx 会显式 READ WRITE，故在驱动边界注入真实 READ ONLY 事务。
		db, err := sql.Open("stage8q-readonly", stage8qDSN)
		require.NoError(t, err)
		defer db.Close()
		var one int
		require.NoError(t, db.QueryRow("SELECT 1").Scan(&one))
		_, err = NewUsageBillingRepository(nil, db).(stage8qAtomicBilling).ApplyWithUsage(context.Background(), cmd, row)
		require.Error(t, err)
		var pgError *pq.Error
		require.ErrorAs(t, err, &pgError)
		require.Equal(t, pq.ErrorCode("25006"), pgError.Code)
		stage8qAssertFunds(t, cmd, "100.00000000", "0.00000000", 0)
	})
	t.Run("connection_refused", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "refused")
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		require.NoError(t, err)
		port := listener.Addr().(*net.TCPAddr).Port
		require.NoError(t, listener.Close())
		db, err := sql.Open("postgres", strings.Replace(stage8qDSN, "port=18448", fmt.Sprintf("port=%d", port), 1))
		require.NoError(t, err)
		defer db.Close()
		_, err = NewUsageBillingRepository(nil, db).(stage8qAtomicBilling).ApplyWithUsage(context.Background(), cmd, row)
		require.Error(t, err)
		stage8qAssertFunds(t, cmd, "100.00000000", "0.00000000", 0)
	})
	t.Run("pool_exhausted_then_recover", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "pool")
		db, err := sql.Open("postgres", stage8qDSN)
		require.NoError(t, err)
		defer db.Close()
		db.SetMaxOpenConns(1)
		conn, err := db.Conn(context.Background())
		require.NoError(t, err)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		r := NewUsageBillingRepository(nil, db).(stage8qAtomicBilling)
		_, err = r.ApplyWithUsage(ctx, cmd, row)
		require.ErrorIs(t, err, context.DeadlineExceeded)
		require.NoError(t, conn.Close())
		res, err := r.ApplyWithUsage(context.Background(), cmd, row)
		require.NoError(t, err)
		require.True(t, res.Applied)
		stage8qAssertFunds(t, cmd, "99.75000000", "0.25000000", 1)
	})
	t.Run("redis_unavailable_pg_still_atomic", func(t *testing.T) {
		cmd, row := stage8qFinancialFixture(t, "redis")
		r := redisclient.NewClient(&redisclient.Options{Addr: "127.0.0.1:1", DialTimeout: 100 * time.Millisecond, MaxRetries: -1})
		defer r.Close()
		require.Error(t, r.Ping(context.Background()).Err())
		res, err := repo.ApplyWithUsage(context.Background(), cmd, row)
		require.NoError(t, err)
		require.True(t, res.Applied)
		_, err = repo.ApplyWithUsage(context.Background(), cmd, row)
		require.NoError(t, err)
		stage8qAssertFunds(t, cmd, "99.75000000", "0.25000000", 1)
	})
}

type stage8qAtomicBilling interface {
	ApplyWithUsage(context.Context, *service.UsageBillingCommand, *service.UsageLog) (*service.UsageBillingApplyResult, error)
}

type stage8qWarmCache struct{ service.BillingCache }

func (*stage8qWarmCache) GetUserBalance(context.Context, int64) (float64, error) { return 100, nil }

func stage8qContainerAction(t *testing.T, name, action string) {
	t.Helper()
	require.Equal(t, "isolated-compose-only", os.Getenv("STAGE8Q_FIXTURE"))
	require.Contains(t, []string{"sub2api-stage8q-pg", "sub2api-stage8q-redis"}, name)
	require.Contains(t, []string{"stop", "start"}, action)
	label, err := exec.Command("docker", "inspect", "--format", "{{index .Config.Labels \"com.docker.compose.project\"}}", name).Output()
	require.NoError(t, err)
	require.Equal(t, "sub2api-stage8q", strings.TrimSpace(string(label)))
	require.NoError(t, exec.Command("docker", action, name).Run())
}

// 这是现状反例：暖缓存可绕过故障PG。通过表示复现风险，不代表新增准入保护。
func TestStage8QPGAdmissionAudit(t *testing.T) {
	cmd, _ := stage8qFinancialFixture(t, "admission")
	user := &service.User{ID: cmd.UserID}
	check := func(db *sql.DB, cache service.BillingCache) error {
		client := dbent.NewClient(dbent.Driver(entsql.OpenDB(dialect.Postgres, db)))
		svc := service.NewBillingCacheService(cache, NewUserRepository(client, db), nil, nil, nil, nil, &config.Config{}, nil)
		defer svc.Stop()
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		return svc.CheckBillingEligibility(ctx, user, nil, nil, nil, "")
	}
	t.Run("normal_cold_and_warm", func(t *testing.T) {
		require.NoError(t, check(integrationDB, nil))
		require.NoError(t, check(integrationDB, &stage8qWarmCache{}))
	})
	t.Run("read_only_cold_select_still_allows", func(t *testing.T) {
		db, err := sql.Open("postgres", stage8qDSN+" options='-c default_transaction_read_only=on'")
		require.NoError(t, err)
		defer db.Close()
		require.NoError(t, check(db, nil), "普通资格SELECT不能证明可写")
	})
	t.Run("pool_exhausted_cold_reject_warm_allow", func(t *testing.T) {
		db, err := sql.Open("postgres", stage8qDSN)
		require.NoError(t, err)
		defer db.Close()
		db.SetMaxOpenConns(1)
		conn, err := db.Conn(context.Background())
		require.NoError(t, err)
		defer conn.Close()
		require.Error(t, check(db, nil))
		require.NoError(t, check(db, &stage8qWarmCache{}))
	})
	t.Run("pg_stop_cold_reject_warm_allow_then_recover", func(t *testing.T) {
		stage8qContainerAction(t, "sub2api-stage8q-pg", "stop")
		defer stage8qContainerAction(t, "sub2api-stage8q-pg", "start")
		require.Error(t, check(integrationDB, nil))
		require.NoError(t, check(integrationDB, &stage8qWarmCache{}))
		stage8qContainerAction(t, "sub2api-stage8q-pg", "start")
		require.Eventually(t, func() bool { return integrationDB.Ping() == nil }, 15*time.Second, 200*time.Millisecond)
		require.NoError(t, check(integrationDB, nil))
	})
	t.Run("redis_stop_pg_balance_and_settlement_work", func(t *testing.T) {
		stage8qContainerAction(t, "sub2api-stage8q-redis", "stop")
		defer stage8qContainerAction(t, "sub2api-stage8q-redis", "start")
		require.Error(t, integrationRedis.Ping(context.Background()).Err())
		require.NoError(t, check(integrationDB, nil))
		c, r := stage8qFinancialFixture(t, "actualredisdown")
		res, err := NewUsageBillingRepository(nil, integrationDB).(stage8qAtomicBilling).ApplyWithUsage(context.Background(), c, r)
		require.NoError(t, err)
		require.True(t, res.Applied)
		stage8qAssertFunds(t, c, "99.75000000", "0.25000000", 1)
	})
}

// 代理在 PG 已完成 COMMIT 后丢弃确认帧，验证真实提交不确定窗口及同键重试。
func TestStage8QCommitReplyLost(t *testing.T) {
	cmd, row := stage8qFinancialFixture(t, "commit")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	defer listener.Close()
	finished := make(chan struct{})
	dropped := make(chan struct{})
	go func() {
		defer close(finished)
		client, err := listener.Accept()
		if err != nil {
			return
		}
		defer client.Close()
		server, err := net.DialTimeout("tcp", "127.0.0.1:18448", 2*time.Second)
		if err != nil {
			return
		}
		defer server.Close()
		go func() { _, _ = io.Copy(server, client) }()
		for {
			var header [5]byte
			if _, err := io.ReadFull(server, header[:]); err != nil {
				return
			}
			length := int(binary.BigEndian.Uint32(header[1:]))
			if length < 4 || length > 16*1024*1024 {
				return
			}
			payload := make([]byte, length-4)
			if _, err := io.ReadFull(server, payload); err != nil {
				return
			}
			if header[0] == 'C' && string(payload) == "COMMIT\x00" {
				close(dropped)
				return
			}
			if _, err := client.Write(append(header[:], payload...)); err != nil {
				return
			}
		}
	}()
	port := listener.Addr().(*net.TCPAddr).Port
	db, err := sql.Open("postgres", strings.Replace(stage8qDSN, "port=18448", fmt.Sprintf("port=%d", port), 1))
	require.NoError(t, err)
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = NewUsageBillingRepository(nil, db).(stage8qAtomicBilling).ApplyWithUsage(ctx, cmd, row)
	require.Error(t, err)
	select {
	case <-dropped:
	case <-time.After(5 * time.Second):
		t.Fatal("没有捕获真实 COMMIT 确认帧")
	}
	<-finished
	res, err := NewUsageBillingRepository(nil, integrationDB).(stage8qAtomicBilling).ApplyWithUsage(context.Background(), cmd, row)
	require.NoError(t, err)
	require.False(t, res.Applied)
	stage8qAssertFunds(t, cmd, "99.75000000", "0.25000000", 1)
}

// 真实 Handler 快照仅重绑定合成实体ID；价格、Token、财务关联ID沿用原 RecordUsage 输出。
func TestStage8QHandlerSnapshotsAgainstPG(t *testing.T) {
	if os.Getenv("STAGE8Q_FIXTURE") != "isolated-compose-only" {
		t.Skip("仅固定合成夹具读取 Handler 快照")
	}
	for _, name := range []string{"normal", "rst", "cancel", "client_disconnect", "duplicate_usage", "queue_full", "pool_stopped"} {
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(os.Getenv("STAGE8Q_EXPORT_DIR"), name+".json"))
			require.NoError(t, err)
			var snapshot struct {
				Command service.UsageBillingCommand `json:"command"`
				Usage   service.UsageLog            `json:"usage"`
			}
			require.NoError(t, json.Unmarshal(data, &snapshot))
			ids, _ := stage8qFinancialFixture(t, "snapshot")
			c, r := &snapshot.Command, &snapshot.Usage
			c.UserID, c.APIKeyID, c.AccountID = ids.UserID, ids.APIKeyID, ids.AccountID
			r.UserID, r.APIKeyID, r.AccountID = c.UserID, c.APIKeyID, c.AccountID
			group := mustCreateGroup(t, testEntClient(t), &service.Group{Name: "stage8q-snapshot-" + uuid.NewString(), Platform: service.PlatformOpenAI, RateMultiplier: 1})
			r.GroupID = &group.ID
			_, err = integrationDB.Exec("UPDATE api_keys SET group_id=$1 WHERE id=$2", group.ID, c.APIKeyID)
			require.NoError(t, err)
			c.RequestFingerprint = ""
			c.Normalize()
			require.Equal(t, 2, c.InputTokens)
			require.Equal(t, 3, c.OutputTokens)
			repo := NewUsageBillingRepository(nil, integrationDB).(stage8qAtomicBilling)
			res, err := repo.ApplyWithUsage(context.Background(), c, r)
			require.NoError(t, err)
			require.True(t, res.Applied)
			res, err = repo.ApplyWithUsage(context.Background(), c, r)
			require.NoError(t, err)
			require.False(t, res.Applied)
			var balance, quota string
			require.NoError(t, integrationDB.QueryRow("SELECT (100::numeric-$1::numeric)::numeric(20,8)::text, $2::numeric(20,8)::text", c.BalanceCost, c.APIKeyQuotaCost).Scan(&balance, &quota))
			stage8qAssertFunds(t, c, balance, quota, 1)
		})
	}
}
