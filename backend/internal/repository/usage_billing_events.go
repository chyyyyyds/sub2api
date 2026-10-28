package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

// UsageBillingEventStore 是未接入应用的隔离验证实现，不自动扫描历史账单。
// 必须先将已定价命令和真实用量持久化，再由显式调用者重放；原内存队列尚未替换。
type UsageBillingEventStore struct{ db *sql.DB }

type billingEventPayload struct {
	Command service.UsageBillingCommand
	Usage   service.UsageLog
}

func NewUsageBillingEventStore(db *sql.DB) *UsageBillingEventStore {
	return &UsageBillingEventStore{db: db}
}

// Enqueue 只接受已确认用量和原计费管线生成的命令，不重新读取当前售价或额度。
func (s *UsageBillingEventStore) Enqueue(ctx context.Context, command *service.UsageBillingCommand, usage *service.UsageLog) error {
	if s == nil || s.db == nil || command == nil || usage == nil {
		return errors.New("invalid billing event")
	}
	cmd := *command
	cmd.Normalize()
	if !validTokenBillingEvent(&cmd, usage) {
		return errors.New("billing event lacks consistent confirmed token usage")
	}
	row := *usage
	// 关联实体可能包含完整账号密钥，禁止进入财务事件；仅保留用量行本身。
	row.ID = 0
	row.User = nil
	row.APIKey = nil
	row.Account = nil
	row.Group = nil
	row.Subscription = nil
	payload, err := json.Marshal(billingEventPayload{Command: cmd, Usage: row})
	if err != nil {
		return err
	}
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	var existing string
	err = s.db.QueryRowContext(ctx, `INSERT INTO stage7_billing_events(request_id,api_key_id,payload_hash,payload) VALUES($1,$2,$3,$4::jsonb)
	ON CONFLICT(request_id,api_key_id) DO UPDATE SET request_id=EXCLUDED.request_id RETURNING payload_hash`, cmd.RequestID, cmd.APIKeyID, hash, string(payload)).Scan(&existing)
	if err != nil {
		return err
	}
	if existing != hash {
		return service.ErrUsageBillingRequestConflict
	}
	return nil
}

// ReplayOne 在同一事务中锁定一条事件、调用原资金逻辑并标记完成。
// 进程崩溃或 COMMIT 回包丢失后，按持久状态和既有 dedup 判断，禁止换新 ID。
func (s *UsageBillingEventStore) ReplayOne(ctx context.Context) (bool, error) {
	if s == nil || s.db == nil {
		return false, errors.New("billing event db unavailable")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var id int64
	var payload []byte
	var attempts int
	err = tx.QueryRowContext(ctx, `SELECT id,payload,attempts FROM stage7_billing_events WHERE status='pending' AND attempts<3 AND next_attempt_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&id, &payload, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var event billingEventPayload
	if err = json.Unmarshal(payload, &event); err != nil || !validTokenBillingEvent(&event.Command, &event.Usage) {
		// 非法历史负载不得扣款或永久占据队首，保留事实并标记永久失败供审计。
		if _, err = tx.ExecContext(ctx, `UPDATE stage7_billing_events SET attempts=attempts+1,status='failed',last_error_code='invalid_token_usage' WHERE id=$1`, id); err != nil {
			return false, err
		}
		return true, tx.Commit()
	}
	if _, err = tx.ExecContext(ctx, `SAVEPOINT billing_effects`); err != nil {
		return false, err
	}
	result, applyErr := (&usageBillingRepository{db: s.db}).applyWithinTx(ctx, tx, &event.Command, &event.Usage)
	if applyErr != nil {
		// 回滚本次资金效果后，单独持久化有限重试状态；不保存可能含敏感内容的原始 SQL 错误。
		if _, err = tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT billing_effects`); err != nil {
			return false, err
		}
		status := "pending"
		code := "billing_apply_failed"
		if attempts+1 >= 3 || errors.Is(applyErr, service.ErrUsageBillingRequestConflict) {
			status = "failed"
		}
		if errors.Is(applyErr, service.ErrUsageBillingRequestConflict) {
			code = "fingerprint_conflict"
		}
		_, err = tx.ExecContext(ctx, `UPDATE stage7_billing_events SET attempts=attempts+1,status=$2,last_error_code=$3,next_attempt_at=now()+interval '30 seconds' WHERE id=$1`, id, status, code)
	} else {
		// 历史归档 dedup 命中时撤销 claim 的临时插入，保持旧仓储行为。
		if !result.Applied {
			if _, err = tx.ExecContext(ctx, `ROLLBACK TO SAVEPOINT billing_effects`); err != nil {
				return false, err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE stage7_billing_events SET attempts=attempts+1,status='settled',last_error_code=NULL,settled_at=now() WHERE id=$1`, id)
	}
	if err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

// 隔离原型仅接收可信 Token 用量，不接收图像/次数收费或根据输出猜测的用量。
// 同时在写入和重放时核对快照，防止缺失或错配的用量变成用户账单。
func validTokenBillingEvent(cmd *service.UsageBillingCommand, usage *service.UsageLog) bool {
	if cmd == nil || usage == nil || cmd.RequestID == "" || cmd.APIKeyID <= 0 || cmd.UserID <= 0 || cmd.AccountID <= 0 || cmd.Model == "" || usage.RequestID != cmd.RequestID || usage.APIKeyID != cmd.APIKeyID || usage.UserID != cmd.UserID || usage.AccountID != cmd.AccountID || usage.Model != cmd.Model {
		return false
	}
	confirmed := false
	for _, pair := range [][2]int{{cmd.InputTokens, usage.InputTokens}, {cmd.OutputTokens, usage.OutputTokens}, {cmd.CacheReadTokens, usage.CacheReadTokens}, {cmd.CacheCreationTokens, usage.CacheCreationTokens}} {
		if pair[0] < 0 || pair[0] != pair[1] {
			return false
		}
		confirmed = confirmed || pair[0] > 0
	}
	for _, amount := range []float64{cmd.BalanceCost, cmd.SubscriptionCost, cmd.APIKeyQuotaCost, cmd.APIKeyRateLimitCost, cmd.AccountQuotaCost, usage.ActualCost, usage.TotalCost} {
		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount < 0 {
			return false
		}
	}
	return confirmed && cmd.ImageCount == 0
}
