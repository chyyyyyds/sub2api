package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/shopspring/decimal"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
)

// CheckAdmission 在现有共享准入中叠加视频持久预留与独立平台账本。
func (r *videoRepository) CheckAdmission(ctx context.Context, user, key, group int64, amount string) error {
	var exists bool
	if e := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM video_tasks WHERE user_id=$1)`, user).Scan(&exists); e != nil {
		return e
	}
	if !exists {
		return nil
	}
	tx, e := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return e
	}
	defer tx.Rollback()
	if e = videoKeyQuota(ctx, tx, key, amount); e != nil {
		return e
	}
	if e = videoPlatformQuota(ctx, tx, user, group, amount); e != nil {
		return e
	}
	return videoSubscriptionQuota(ctx, tx, user, group, amount, 0)
}
func videoKeyQuota(ctx context.Context, tx *sql.Tx, key int64, amount string) error {
	var allowed bool
	query := `WITH pending AS(SELECT COALESCE(SUM(amount),0) amount FROM video_quota_reservations WHERE scope_type='key_total' AND scope_key=($1::bigint)::text AND state='HELD')
 SELECT (k.quota<=0 OR k.quota_used+p.amount+$2::numeric<=k.quota)
 AND (k.rate_limit_5h<=0 OR (CASE WHEN k.window_5h_start>now()-interval '5 hours' THEN k.usage_5h ELSE 0 END)+p.amount+$2::numeric<=k.rate_limit_5h)
 AND (k.rate_limit_1d<=0 OR (CASE WHEN k.window_1d_start>now()-interval '1 day' THEN k.usage_1d ELSE 0 END)+p.amount+$2::numeric<=k.rate_limit_1d)
 AND (k.rate_limit_7d<=0 OR (CASE WHEN k.window_7d_start>now()-interval '7 days' THEN k.usage_7d ELSE 0 END)+p.amount+$2::numeric<=k.rate_limit_7d)
 FROM api_keys k CROSS JOIN pending p WHERE k.id=$1::bigint`
	if amount == "0" {
		query = strings.ReplaceAll(query, "+p.amount+$2::numeric<=", "+p.amount+$2::numeric<")
	}
	e := tx.QueryRowContext(ctx, query, key, amount).Scan(&allowed)
	if e != nil {
		return e
	}
	if !allowed {
		return errors.New("VIDEO_KEY_QUOTA_EXCEEDED")
	}
	return nil
}
func videoPlatformQuota(ctx context.Context, tx *sql.Tx, user, group int64, amount string) error {
	var platform string
	if err := tx.QueryRowContext(ctx, `SELECT platform FROM groups WHERE id=$1`, group).Scan(&platform); err != nil {
		return err
	}
	now := timezone.Now()
	starts := []any{timezone.StartOfDay(now), timezone.StartOfWeek(now), timezone.StartOfMonth(now)}
	for i, unit := range []string{"daily", "weekly", "monthly"} {
		var allowed bool
		query := fmt.Sprintf(`SELECT NOT EXISTS(SELECT 1 FROM user_platform_quotas p WHERE p.user_id=$1 AND p.platform=(SELECT platform FROM groups WHERE id=$5) AND p.deleted_at IS NULL AND p.%[1]s_limit_usd IS NOT NULL AND
 (CASE WHEN p.%[1]s_window_start >= $3 THEN p.%[1]s_usage_usd ELSE 0 END)+$2::numeric+
 COALESCE((SELECT SUM(q.amount) FROM video_quota_reservations q WHERE q.scope_type='user_platform' AND q.scope_key=$4 AND (q.state='HELD' OR(q.state='CONSUMED' AND q.finalized_at >= $3))),0)>p.%[1]s_limit_usd)`, unit)
		if amount == "0" {
			query = strings.ReplaceAll(query, ">p.", ">=p.")
		}
		if e := tx.QueryRowContext(ctx, query, user, amount, starts[i], fmt.Sprintf("%d:%s", user, platform), group).Scan(&allowed); e != nil {
			return e
		}
		if !allowed {
			return errors.New("VIDEO_PLATFORM_QUOTA_EXCEEDED")
		}
	}
	return nil
}
func videoSubscriptionQuota(ctx context.Context, tx *sql.Tx, user, group int64, amount string, subscription int64) error {
	rows, e := tx.QueryContext(ctx, `SELECT s.starts_at,s.expires_at,s.daily_window_start,s.weekly_window_start,s.monthly_window_start,s.daily_usage_usd::text,s.weekly_usage_usd::text,s.monthly_usage_usd::text,g.daily_limit_usd::text,g.weekly_limit_usd::text,g.monthly_limit_usd::text,COALESCE((SELECT SUM(q.amount) FROM video_quota_reservations q WHERE q.scope_type='subscription' AND q.scope_key=s.id::text AND q.state='HELD'),0)::text FROM user_subscriptions s JOIN groups g ON g.id=s.group_id WHERE s.user_id=$1 AND s.group_id=$2 AND ($3::bigint=0 OR s.id=$3) AND s.status='active' AND s.deleted_at IS NULL`, user, group, subscription)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		var sub service.UserSubscription
		var usages [3]string
		var limits [3]sql.NullString
		var held string
		if e = rows.Scan(&sub.StartsAt, &sub.ExpiresAt, &sub.DailyWindowStart, &sub.WeeklyWindowStart, &sub.MonthlyWindowStart, &usages[0], &usages[1], &usages[2], &limits[0], &limits[1], &limits[2], &held); e != nil {
			return e
		}
		plan := service.PlanVideoSubscriptionWindows(sub, time.Now())
		reset := []bool{plan.ResetDaily, plan.ResetWeekly, plan.ResetMonthly}
		pending, e := decimal.NewFromString(held)
		if e != nil {
			return e
		}
		charge, e := decimal.NewFromString(amount)
		if e != nil {
			return e
		}
		for i, limit := range limits {
			if !limit.Valid {
				continue
			}
			max, e := decimal.NewFromString(limit.String)
			if e != nil {
				return e
			}
			if !max.IsPositive() {
				continue
			}
			used, e := decimal.NewFromString(usages[i])
			if e != nil {
				return e
			}
			if reset[i] {
				used = decimal.Zero
			}
			sum := used.Add(pending).Add(charge)
			if sum.GreaterThan(max) || (amount == "0" && sum.Equal(max)) {
				return errors.New("VIDEO_SUBSCRIPTION_QUOTA_EXCEEDED")
			}
		}
	}
	return rows.Err()
}

func videoAccountQuota(ctx context.Context, tx *sql.Tx, account int64, amount string) error {
	var allowed bool
	query := `SELECT (COALESCE((extra->>'quota_limit')::numeric,0)<=0 OR COALESCE((extra->>'quota_used')::numeric,0)+p.amount+$2::numeric <= (extra->>'quota_limit')::numeric)
 AND (COALESCE((extra->>'quota_daily_limit')::numeric,0)<=0 OR (CASE WHEN ` + dailyExpiredExpr + ` THEN 0 ELSE COALESCE((extra->>'quota_daily_used')::numeric,0) END)+p.amount+$2::numeric <= (extra->>'quota_daily_limit')::numeric)
 AND (COALESCE((extra->>'quota_weekly_limit')::numeric,0)<=0 OR (CASE WHEN ` + weeklyExpiredExpr + ` THEN 0 ELSE COALESCE((extra->>'quota_weekly_used')::numeric,0) END)+p.amount+$2::numeric <= (extra->>'quota_weekly_limit')::numeric)
 FROM accounts CROSS JOIN(SELECT COALESCE(SUM(amount),0) amount FROM video_quota_reservations WHERE scope_type='account' AND scope_key=($1::bigint)::text AND state='HELD') p WHERE id=$1::bigint`
	if e := tx.QueryRowContext(ctx, query, account, amount).Scan(&allowed); e != nil {
		return e
	}
	if !allowed {
		return errors.New("VIDEO_ACCOUNT_QUOTA_EXCEEDED")
	}
	return nil
}
