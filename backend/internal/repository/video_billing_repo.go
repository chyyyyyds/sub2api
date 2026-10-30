package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/shopspring/decimal"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

func (r *videoRepository) CacheNext(ctx context.Context, invalidate func(context.Context, int64, int64, int64) error) (bool, error) {
	var event, user, key, group int64
	e := r.db.QueryRowContext(ctx, `SELECT b.id,t.user_id,t.api_key_id,t.group_id FROM video_billing_events b JOIN video_tasks t ON t.id=b.task_id WHERE b.operation IN('CACHE_HOLD','CACHE_FINAL') AND b.status IN('PENDING','RETRY') ORDER BY b.id LIMIT 1`).Scan(&event, &user, &key, &group)
	if errors.Is(e, sql.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	if e = invalidate(ctx, user, key, group); e != nil {
		return true, e
	}
	_, e = r.db.ExecContext(ctx, `UPDATE video_billing_events SET status='APPLIED',applied_at=now() WHERE id=$1 AND status IN('PENDING','RETRY')`, event)
	return true, e
}

func (r *videoRepository) SettleNext(ctx context.Context) (bool, error) {
	var event, task int64
	var operation, publicID string
	e := r.db.QueryRowContext(ctx, `SELECT b.id,b.task_id,b.operation,t.public_id FROM video_billing_events b JOIN video_tasks t ON t.id=b.task_id WHERE b.operation IN('CAPTURE','RELEASE') AND b.status IN('PENDING','RETRY') AND b.next_attempt_at<=now() ORDER BY b.id LIMIT 1`).Scan(&event, &task, &operation, &publicID)
	if errors.Is(e, sql.ErrNoRows) {
		return false, nil
	}
	if e != nil {
		return false, e
	}
	e = r.settleVideo(ctx, event, task, publicID, operation)
	if e != nil {
		// 效果事务已回滚；重试状态另行持久化，绝不因重试再发生成请求。
		_, _ = r.db.ExecContext(ctx, `UPDATE video_billing_events SET attempts=attempts+1,status=CASE WHEN attempts>=19 THEN 'REVIEW' ELSE 'RETRY' END,next_attempt_at=now()+interval '5 minutes',last_error_code='VIDEO_SETTLEMENT_RETRY' WHERE id=$1 AND status IN('PENDING','RETRY')`, event)
	}
	return true, e
}

func (r *videoRepository) settleVideo(ctx context.Context, event, task int64, id, operation string) error {
	record, e := r.Record(ctx, id)
	if e != nil {
		return e
	}
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// 与冻结相同的锁序；已软删除的原用户也能完成原任务账务。
	for _, lock := range []struct {
		query string
		id    int64
	}{{`SELECT id FROM users WHERE id=$1 FOR UPDATE`, record.UserID}, {`SELECT id FROM api_keys WHERE id=$1 FOR UPDATE`, record.APIKeyID}, {`SELECT id FROM accounts WHERE id=$1 FOR UPDATE`, record.AccountID}, {`SELECT id FROM video_tasks WHERE id=$1 FOR UPDATE`, task}} {
		var n int64
		if e = tx.QueryRowContext(ctx, lock.query, lock.id).Scan(&n); e != nil {
			return e
		}
	}
	if record.SubscriptionID != nil {
		var n int64
		if e = tx.QueryRowContext(ctx, `SELECT id FROM user_subscriptions WHERE id=$1 FOR UPDATE`, *record.SubscriptionID).Scan(&n); e != nil {
			return e
		}
	}
	var state, amount, fingerprint, status, eventHash string
	var completed *time.Time
	var created time.Time
	var pricingRaw []byte
	if e = tx.QueryRowContext(ctx, `SELECT f.state,f.amount::text,f.pricing_snapshot_hash,t.status,t.created_at,t.completed_at,t.pricing_snapshot FROM video_financial_reservations f JOIN video_tasks t ON t.id=f.task_id WHERE f.task_id=$1 AND f.user_id=$2 AND f.api_key_id=$3 FOR UPDATE OF f`, task, record.UserID, record.APIKeyID).Scan(&state, &amount, &fingerprint, &status, &created, &completed, &pricingRaw); e != nil {
		return e
	}
	var eventStatus, requestID string
	if e = tx.QueryRowContext(ctx, `SELECT status,request_id,payload_hash FROM video_billing_events WHERE id=$1 FOR UPDATE SKIP LOCKED`, event).Scan(&eventStatus, &requestID, &eventHash); e != nil {
		return e
	}
	if eventStatus == "APPLIED" {
		return nil
	}
	var pricing service.VideoPriceSnapshot
	if e = json.Unmarshal(pricingRaw, &pricing); e != nil {
		return e
	}
	expected, e := decimal.NewFromString(pricing.Charge)
	if e != nil {
		return e
	}
	held, e := decimal.NewFromString(amount)
	if e != nil {
		return e
	}
	if state != "HELD" || eventHash != fingerprint || videoHash(videoJSON(pricing)) != fingerprint || !expected.Equal(held) {
		return errors.New("VIDEO_FINANCIAL_CONFLICT")
	}

	if (operation == "CAPTURE" && status != "COMPLETED") || (operation == "RELEASE" && status != "FAILED") {
		return errors.New("VIDEO_TERMINAL_CONFLICT")
	}
	if record.SubscriptionID == nil {
		res, e := tx.ExecContext(ctx, `UPDATE users SET frozen_balance=frozen_balance-$2::numeric,balance=balance+CASE WHEN $3::text='RELEASE' THEN $2::numeric ELSE 0 END,updated_at=now() WHERE id=$1 AND frozen_balance >= $2::numeric`, record.UserID, amount, operation)
		if e != nil {
			return e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return errors.New("VIDEO_FROZEN_BALANCE_CONFLICT")
		}
	} else if operation == "CAPTURE" {
		var sub service.UserSubscription
		if e = tx.QueryRowContext(ctx, `SELECT starts_at,expires_at,daily_window_start,weekly_window_start,monthly_window_start FROM user_subscriptions WHERE id=$1 AND user_id=$2 AND group_id=$3`, *record.SubscriptionID, record.UserID, record.GroupID).Scan(&sub.StartsAt, &sub.ExpiresAt, &sub.DailyWindowStart, &sub.WeeklyWindowStart, &sub.MonthlyWindowStart); e != nil {
			return e
		}
		plan := service.PlanVideoSubscriptionWindows(sub, time.Now())
		_, e = tx.ExecContext(ctx, `UPDATE user_subscriptions SET daily_usage_usd=CASE WHEN $3 THEN $2::numeric ELSE daily_usage_usd+$2::numeric END,weekly_usage_usd=CASE WHEN $4 THEN $2::numeric ELSE weekly_usage_usd+$2::numeric END,monthly_usage_usd=CASE WHEN $5 THEN $2::numeric ELSE monthly_usage_usd+$2::numeric END,daily_window_start=$6,weekly_window_start=$7,monthly_window_start=$8,updated_at=now() WHERE id=$1`, *record.SubscriptionID, amount, plan.ResetDaily, plan.ResetWeekly, plan.ResetMonthly, plan.Daily, plan.Weekly, plan.Monthly)
		if e != nil {
			return e
		}
	}

	target, quotaState := "RELEASED", "RELEASED"
	if operation == "CAPTURE" {
		applied, e := (&usageBillingRepository{db: r.db}).claimUsageBillingRequest(ctx, tx, requestID, record.APIKeyID, fingerprint)
		if e != nil {
			return e
		}
		if !applied {
			return errors.New("VIDEO_DEDUP_CONFLICT")
		}
		// 余额已于创建时冻结，此处只捕获冻结与累计 Key 额度，不能再扣钱包。
		_, e = tx.ExecContext(ctx, `UPDATE api_keys SET quota_used=quota_used+$2::numeric,status=CASE WHEN quota>0 AND status='active' AND quota_used+$2::numeric>=quota THEN 'quota_exhausted' ELSE status END,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, record.APIKeyID, amount)
		if e != nil {
			return e
		}
		if _, e = tx.ExecContext(ctx, usageBillingAPIKeyRateLimitSQL, amount, record.APIKeyID); e != nil {
			return e
		}

		// 复用既有账号配额窗口表达式，但以十进制字符串绑定金额。
		if _, e = tx.ExecContext(ctx, `UPDATE accounts SET extra=`+accountQuotaTotalIncrementExpr+accountQuotaDailyIncrementExpr+accountQuotaWeeklyIncrementExpr+`,updated_at=now() WHERE id=$2`, pricing.AccountCost, record.AccountID); e != nil {
			return e
		}
		// 标准 UsageLog 与捕获、dedup、财务终态处于同一 PostgreSQL 事务。
		// decimal 字符串直接绑定 NUMERIC，不经 float 计算或二次扣费队列。
		_, e = tx.ExecContext(ctx, `INSERT INTO usage_logs(user_id,api_key_id,account_id,group_id,channel_id,request_id,model,requested_model,upstream_model,media_type,billing_mode,video_count,video_duration_seconds,video_resolution,total_cost,actual_cost,rate_multiplier,billing_type,request_type,stream,duration_ms,created_at,subscription_id,account_rate_multiplier,account_stats_cost,billing_tier,video_task_id,video_pricing_snapshot)
 VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,'video','video',1,$9,$10,$11::numeric,$12::numeric,$13::numeric,$16,1,false,$14,$15,$17,$18::numeric,$19::numeric,$20,$21,$22::jsonb)`, record.UserID, record.APIKeyID, record.AccountID, record.GroupID, record.ChannelID, requestID, record.RequestedModel, record.UpstreamModel, pricing.Duration, pricing.Resolution, pricing.BasePrice, amount, pricing.Multiplier, int(completed.Sub(created).Milliseconds()), *completed, func() int {
			if record.SubscriptionID != nil {
				return 1
			}
			return 0
		}(), record.SubscriptionID, pricing.AccountMultiplier, pricing.AccountCost, pricing.Tier, id, videoJSON(pricing))
		if e != nil {
			return e
		}
		target = "CAPTURED"
		quotaState = "CONSUMED"
	}
	_, e = tx.ExecContext(ctx, `UPDATE video_financial_reservations SET state=$2::text,captured_amount=CASE WHEN $2::text='CAPTURED' THEN amount ELSE 0 END,finalized_at=now() WHERE task_id=$1 AND state='HELD'`, task, target)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE video_quota_reservations SET state=$2::text,finalized_at=now() WHERE task_id=$1 AND state='HELD'`, task, quotaState); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE video_billing_events SET status='APPLIED',applied_at=now() WHERE id=$1`, event); e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO video_billing_events(task_id,operation,request_id,payload,payload_hash) VALUES($1,'CACHE_FINAL',$2,$4,$3) ON CONFLICT(task_id,operation) DO NOTHING`, task, "video:cache:"+id, fingerprint, videoJSON(pricing)); e != nil {
		return e
	}
	if e = videoEvent(ctx, tx, task, requestID, target); e != nil {
		return e
	}
	return tx.Commit()
}
