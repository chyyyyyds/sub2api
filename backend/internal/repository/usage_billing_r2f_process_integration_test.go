//go:build integration

package repository

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// 子进程只连接父测试新建的本机 testcontainers 库，不启动应用或读取账号凭据。
func runStage7R2FChild() bool {
	if os.Getenv("SUB2API_R2F_CHILD") != "isolated-fixture-only" {
		return false
	}
	u, err := url.Parse(os.Getenv("SUB2API_R2F_DSN"))
	if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") || u.Path != "/sub2api_test" || u.User == nil || u.User.Username() != "postgres" {
		os.Exit(41)
	}
	password, _ := u.User.Password()
	if password != "postgres" {
		os.Exit(42)
	}
	db, err := sql.Open("postgres", u.String())
	if err != nil {
		os.Exit(43)
	}
	defer db.Close()
	var event billingEventPayload
	if err = json.Unmarshal([]byte(os.Getenv("SUB2API_R2F_EVENT")), &event); err != nil {
		os.Exit(44)
	}
	ctx := context.Background()
	store := NewUsageBillingEventStore(db)
	mode := os.Getenv("SUB2API_R2F_MODE")
	switch mode {
	case "received":
		// usage 已在进程内，但尚未首次持久化，杀进程应暴露真实丢账窗口。
	case "persisted":
		err = store.Enqueue(ctx, &event.Command, &event.Usage)
	case "replay", "committed":
		_, err = store.ReplayOne(ctx)
	default:
		os.Exit(45)
	}
	if err != nil {
		os.Exit(46)
	}
	fmt.Println("R2F_READY")
	if mode != "replay" {
		// 父进程通过 Process.Kill 真正终止，不用新建仓储对象冒充进程重启。
		for {
			time.Sleep(time.Hour)
		}
	}
	return true
}

func TestStage7R2FProcessRecovery(t *testing.T) {
	ctx := context.Background()
	schema, err := os.ReadFile("../../../tools/stage7_billing_events_schema.sql")
	require.NoError(t, err)
	_, err = integrationDB.ExecContext(ctx, string(schema))
	require.NoError(t, err)
	t.Cleanup(func() { _, e := integrationDB.Exec(`DROP TABLE stage7_billing_events`); require.NoError(t, e) })
	client := testEntClient(t)
	user := mustCreateUser(t, client, &service.User{Email: uuid.NewString() + "@r2f.invalid", PasswordHash: "fixture", Balance: 100})
	key := mustCreateApiKey(t, client, &service.APIKey{UserID: user.ID, Key: "fixture-" + uuid.NewString(), Name: "R2F", Quota: 100})
	account := mustCreateAccount(t, client, &service.Account{Name: "fixture-" + uuid.NewString(), Type: service.AccountTypeAPIKey})
	fixture := func() billingEventPayload {
		rid := uuid.NewString()
		return billingEventPayload{
			Command: service.UsageBillingCommand{RequestID: rid, APIKeyID: key.ID, UserID: user.ID, AccountID: account.ID, Model: "fixture", InputTokens: 2, OutputTokens: 3, BalanceCost: 0.25, APIKeyQuotaCost: 0.25},
			Usage:   service.UsageLog{RequestID: rid, APIKeyID: key.ID, UserID: user.ID, AccountID: account.ID, Model: "fixture", InputTokens: 2, OutputTokens: 3, ActualCost: 0.25, TotalCost: 0.25, RateMultiplier: 1},
		}
	}
	start := func(mode string, event billingEventPayload) (*exec.Cmd, <-chan error) {
		t.Helper()
		payload, e := json.Marshal(event)
		require.NoError(t, e)
		exe, e := os.Executable()
		require.NoError(t, e)
		cmd := exec.Command(exe, "-test.run=^$")
		cmd.Env = append(os.Environ(), "SUB2API_R2F_CHILD=isolated-fixture-only", "SUB2API_R2F_DSN="+integrationFixtureDSN, "SUB2API_R2F_MODE="+mode, "SUB2API_R2F_EVENT="+string(payload))
		stdout, e := cmd.StdoutPipe()
		require.NoError(t, e)
		require.NoError(t, cmd.Start())
		done := make(chan error, 1)
		go func() {
			line, readErr := bufio.NewReader(stdout).ReadString('\n')
			if readErr == nil && strings.TrimSpace(line) != "R2F_READY" {
				readErr = fmt.Errorf("unexpected child marker")
			}
			done <- readErr
		}()
		t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
		return cmd, done
	}
	waitReady := func(ready <-chan error) {
		t.Helper()
		select {
		case e := <-ready:
			require.NoError(t, e)
		case <-time.After(15 * time.Second):
			t.Fatal("隔离子进程未到达指定故障阶段")
		}
	}
	assertMoney := func(event billingEventPayload, expectedLogs int, expectedBalance float64) {
		t.Helper()
		var balance, quota float64
		var logs int
		require.NoError(t, integrationDB.QueryRow(`SELECT balance FROM users WHERE id=$1`, user.ID).Scan(&balance))
		require.NoError(t, integrationDB.QueryRow(`SELECT quota_used FROM api_keys WHERE id=$1`, key.ID).Scan(&quota))
		require.NoError(t, integrationDB.QueryRow(`SELECT count(*) FROM usage_logs WHERE request_id=$1`, event.Command.RequestID).Scan(&logs))
		require.Equal(t, expectedLogs, logs)
		require.Equal(t, expectedBalance, balance)
		require.Equal(t, 100-expectedBalance, quota)
	}
	balance := 100.0
	t.Run("无可信usage拒绝入队", func(t *testing.T) {
		event := fixture()
		event.Command.InputTokens = 0
		event.Command.OutputTokens = 0
		event.Usage.InputTokens = 0
		event.Usage.OutputTokens = 0
		require.Error(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		assertMoney(event, 0, balance)
	})
	t.Run("命令与用量不一致拒绝入队", func(t *testing.T) {
		event := fixture()
		event.Usage.OutputTokens++
		require.Error(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		assertMoney(event, 0, balance)
	})
	t.Run("负Token拒绝入队", func(t *testing.T) {
		event := fixture()
		event.Command.InputTokens = -1
		event.Usage.InputTokens = -1
		require.Error(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		assertMoney(event, 0, balance)
	})
	t.Run("存量非法负载永久失败且不扣款", func(t *testing.T) {
		event := fixture()
		store := NewUsageBillingEventStore(integrationDB)
		require.NoError(t, store.Enqueue(ctx, &event.Command, &event.Usage))
		_, e := integrationDB.Exec(`UPDATE stage7_billing_events SET payload='{}'::jsonb WHERE request_id=$1`, event.Command.RequestID)
		require.NoError(t, e)
		processed, e := store.ReplayOne(ctx)
		require.NoError(t, e)
		require.True(t, processed)
		var status, code string
		require.NoError(t, integrationDB.QueryRow(`SELECT status,last_error_code FROM stage7_billing_events WHERE request_id=$1`, event.Command.RequestID).Scan(&status, &code))
		require.Equal(t, "failed", status)
		require.Equal(t, "invalid_token_usage", code)
		processed, e = store.ReplayOne(ctx)
		require.NoError(t, e)
		require.False(t, processed)
		assertMoney(event, 0, balance)
	})
	t.Run("收到usage后首次持久化前杀进程", func(t *testing.T) {
		event := fixture()
		cmd, ready := start("received", event)
		waitReady(ready)
		require.NoError(t, cmd.Process.Kill())
		require.Error(t, cmd.Wait())
		processed, e := NewUsageBillingEventStore(integrationDB).ReplayOne(ctx)
		require.NoError(t, e)
		require.False(t, processed)
		assertMoney(event, 0, balance)
	})
	t.Run("持久化后杀进程并由新进程恢复", func(t *testing.T) {
		event := fixture()
		cmd, ready := start("persisted", event)
		waitReady(ready)
		require.NoError(t, cmd.Process.Kill())
		require.Error(t, cmd.Wait())
		assertMoney(event, 0, balance)
		restarted, recovered := start("replay", event)
		waitReady(recovered)
		require.NoError(t, restarted.Wait())
		balance -= 0.25
		assertMoney(event, 1, balance)
	})
	t.Run("事务持有中杀worker并回滚后恢复", func(t *testing.T) {
		event := fixture()
		require.NoError(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		// 真实行锁让子进程停在资金更新阶段，终止后由 PostgreSQL 回滚整个未提交事务。
		lock, e := integrationDB.BeginTx(ctx, nil)
		require.NoError(t, e)
		defer lock.Rollback()
		_, e = lock.Exec(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, user.ID)
		require.NoError(t, e)
		cmd, _ := start("replay", event)
		require.Eventually(t, func() bool {
			var count int
			e := integrationDB.QueryRow(`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%UPDATE users%'`).Scan(&count)
			return e == nil && count > 0
		}, 10*time.Second, 20*time.Millisecond)
		require.NoError(t, cmd.Process.Kill())
		require.Error(t, cmd.Wait())
		require.NoError(t, lock.Rollback())
		assertMoney(event, 0, balance)
		restarted, recovered := start("replay", event)
		waitReady(recovered)
		require.NoError(t, restarted.Wait())
		balance -= 0.25
		assertMoney(event, 1, balance)
	})
	t.Run("提交后尚未确认时杀进程不会再次扣费", func(t *testing.T) {
		event := fixture()
		require.NoError(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		cmd, ready := start("committed", event)
		waitReady(ready)
		require.NoError(t, cmd.Process.Kill())
		require.Error(t, cmd.Wait())
		balance -= 0.25
		assertMoney(event, 1, balance)
		restarted, recovered := start("replay", event)
		waitReady(recovered)
		require.NoError(t, restarted.Wait())
		assertMoney(event, 1, balance)
	})
	t.Run("真实COMMIT响应丢失后按持久状态恢复", func(t *testing.T) {
		event := fixture()
		require.NoError(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		dsn, dropped := stage7R2FDropCommitProxy(t, integrationFixtureDSN)
		db, e := sql.Open("postgres", dsn)
		require.NoError(t, e)
		defer db.Close()
		deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		_, e = NewUsageBillingEventStore(db).ReplayOne(deadline)
		require.Error(t, e, "提交已生效但客户端必须收到不确定结果")
		select {
		case <-dropped:
		case <-time.After(time.Second):
			t.Fatal("未捕获真实 PostgreSQL COMMIT 完成响应")
		}
		balance -= 0.25
		assertMoney(event, 1, balance)
		processed, e := NewUsageBillingEventStore(integrationDB).ReplayOne(ctx)
		require.NoError(t, e)
		require.False(t, processed)
		assertMoney(event, 1, balance)
	})
	t.Run("真实Redis暂停不阻止PG结算", func(t *testing.T) {
		event := fixture()
		require.NoError(t, NewUsageBillingEventStore(integrationDB).Enqueue(ctx, &event.Command, &event.Usage))
		// 暂停仅本轮新建容器，保留映射端口；避免 stop/start 的随机端口改变污染后续测试。
		rdbID := integrationFixtureRedis.GetContainerID()
		require.NoError(t, exec.CommandContext(ctx, "docker", "pause", rdbID).Run())
		defer func() { require.NoError(t, exec.CommandContext(ctx, "docker", "unpause", rdbID).Run()) }()
		probe, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		require.Error(t, integrationRedis.Ping(probe).Err())
		processed, e := NewUsageBillingEventStore(integrationDB).ReplayOne(ctx)
		require.NoError(t, e)
		require.True(t, processed)
		balance -= 0.25
		assertMoney(event, 1, balance)
	})
	t.Run("真实PG多次不可用后恢复", func(t *testing.T) {
		event := fixture()
		store := NewUsageBillingEventStore(integrationDB)
		require.NoError(t, store.Enqueue(ctx, &event.Command, &event.Usage))
		pgID := integrationFixturePG.GetContainerID()
		defer func() { _ = exec.CommandContext(ctx, "docker", "unpause", pgID).Run() }()
		unavailable := func(action func(context.Context) error) {
			t.Helper()
			require.NoError(t, exec.CommandContext(ctx, "docker", "pause", pgID).Run())
			// 驱动的取消握手可能也依赖 PG 响应；恢复看门狗必须独立于被测调用。
			resumed := make(chan error, 1)
			time.AfterFunc(1500*time.Millisecond, func() {
				restore, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				resumed <- exec.CommandContext(restore, "docker", "unpause", pgID).Run()
			})
			probe, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			err := action(probe)
			cancel()
			select {
			case restoreErr := <-resumed:
				require.NoError(t, restoreErr)
			case <-time.After(10 * time.Second):
				t.Fatal("隔离PG恢复看门狗未完成")
			}
			require.Error(t, err)
		}
		for range 3 {
			unavailable(func(probe context.Context) error { _, e := store.ReplayOne(probe); return e })
			// 使用稳定幂等 ID；超时不代表服务端必未写入，不能换 ID 生成第二份事实。
			unavailable(func(probe context.Context) error { return store.Enqueue(probe, &event.Command, &event.Usage) })
		}
		require.Eventually(t, func() bool { return integrationDB.PingContext(ctx) == nil }, 30*time.Second, 100*time.Millisecond)
		assertMoney(event, 0, balance)
		processed, e := store.ReplayOne(ctx)
		require.NoError(t, e)
		require.True(t, processed)
		balance -= 0.25
		assertMoney(event, 1, balance)
	})
	t.Run("真实事务失败回滚后安全重试", func(t *testing.T) {
		event := fixture()
		store := NewUsageBillingEventStore(integrationDB)
		require.NoError(t, store.Enqueue(ctx, &event.Command, &event.Usage))
		_, e := integrationDB.Exec(`CREATE FUNCTION stage7_r2f_reject_usage() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture_write_unavailable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER stage7_r2f_reject_usage BEFORE INSERT ON usage_logs FOR EACH ROW EXECUTE FUNCTION stage7_r2f_reject_usage()`)
		require.NoError(t, e)
		defer integrationDB.Exec(`DROP TRIGGER IF EXISTS stage7_r2f_reject_usage ON usage_logs; DROP FUNCTION IF EXISTS stage7_r2f_reject_usage()`)
		processed, e := store.ReplayOne(ctx)
		require.NoError(t, e)
		require.True(t, processed)
		assertMoney(event, 0, balance)
		var status string
		var attempts int
		require.NoError(t, integrationDB.QueryRow(`SELECT status,attempts FROM stage7_billing_events WHERE request_id=$1`, event.Command.RequestID).Scan(&status, &attempts))
		require.Equal(t, "pending", status)
		require.Equal(t, 1, attempts)
		_, e = integrationDB.Exec(`DROP TRIGGER stage7_r2f_reject_usage ON usage_logs; DROP FUNCTION stage7_r2f_reject_usage()`)
		require.NoError(t, e)
		_, e = integrationDB.Exec(`UPDATE stage7_billing_events SET next_attempt_at=now() WHERE request_id=$1`, event.Command.RequestID)
		require.NoError(t, e)
		processed, e = store.ReplayOne(ctx)
		require.NoError(t, e)
		require.True(t, processed)
		balance -= 0.25
		assertMoney(event, 1, balance)
		processed, e = store.ReplayOne(ctx)
		require.NoError(t, e)
		require.False(t, processed)
		assertMoney(event, 1, balance)
	})
	t.Run("迁移可回滚且既有账务不受影响", func(t *testing.T) {
		_, e := integrationDB.Exec(`DROP TABLE stage7_billing_events`)
		require.NoError(t, e)
		_, e = integrationDB.Exec(string(schema))
		require.NoError(t, e)
		var current float64
		require.NoError(t, integrationDB.QueryRow(`SELECT balance FROM users WHERE id=$1`, user.ID).Scan(&current))
		require.Equal(t, balance, current)
	})
}

// 只代理新建 fixture 的本机 PostgreSQL。服务器完成 COMMIT 后丢掉响应，绝不连接在线站点。
func stage7R2FDropCommitProxy(t *testing.T, fixtureDSN string) (string, <-chan struct{}) {
	t.Helper()
	u, err := url.Parse(fixtureDSN)
	require.NoError(t, err)
	require.Equal(t, "/sub2api_test", u.Path)
	require.Contains(t, []string{"localhost", "127.0.0.1"}, u.Hostname())
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	t.Cleanup(func() { _ = listener.Close() })
	dropped := make(chan struct{})
	go func() {
		client, e := listener.Accept()
		if e != nil {
			return
		}
		server, e := net.DialTimeout("tcp", u.Host, 5*time.Second)
		if e != nil {
			_ = client.Close()
			return
		}
		_ = client.SetDeadline(time.Now().Add(15 * time.Second))
		_ = server.SetDeadline(time.Now().Add(15 * time.Second))
		var armed atomic.Bool
		go func() {
			defer client.Close()
			defer server.Close()
			// PostgreSQL 启动包没有消息类型字节，之后才是标准 type+length 帧。
			var size [4]byte
			if _, e := io.ReadFull(client, size[:]); e != nil {
				return
			}
			n := int(binary.BigEndian.Uint32(size[:]))
			if n < 4 || n > 1<<20 {
				return
			}
			body := make([]byte, n-4)
			if _, e := io.ReadFull(client, body); e != nil {
				return
			}
			if _, e := server.Write(append(size[:], body...)); e != nil {
				return
			}
			for {
				kind, frame, e := stage7R2FReadPGFrame(client)
				if e != nil {
					return
				}
				if kind == 'Q' && strings.TrimSpace(strings.TrimRight(string(frame[5:]), "\x00")) == "COMMIT" {
					armed.Store(true)
				}
				if _, e = server.Write(frame); e != nil {
					return
				}
			}
		}()
		defer client.Close()
		defer server.Close()
		for {
			kind, frame, e := stage7R2FReadPGFrame(server)
			if e != nil {
				return
			}
			if armed.Load() && kind == 'C' && string(frame[5:]) == "COMMIT\x00" {
				close(dropped)
				return
			}
			if _, e = client.Write(frame); e != nil {
				return
			}
		}
	}()
	copyURL := *u
	copyURL.Host = listener.Addr().String()
	return copyURL.String(), dropped
}

func stage7R2FReadPGFrame(reader io.Reader) (byte, []byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return 0, nil, err
	}
	n := int(binary.BigEndian.Uint32(header[1:]))
	if n < 4 || n > 16<<20 {
		return 0, nil, fmt.Errorf("invalid fixture frame length")
	}
	frame := make([]byte, n+1)
	copy(frame, header[:])
	_, err := io.ReadFull(reader, frame[5:])
	return header[0], frame, err
}
