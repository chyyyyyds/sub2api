package repository

import (
	"context"
	"errors"
)

func (r *videoRepository) Reconcile(ctx context.Context, id, upstream string, actor int64, reason string) error {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var task int64
	e = tx.QueryRowContext(ctx, `UPDATE video_tasks SET upstream_id=$2,status='RECONCILING',review_required=false,next_check_at=now(),updated_at=now(),row_version=row_version+1 WHERE public_id=$1 AND upstream_id IS NULL AND status IN('SUBMITTING','SUBMISSION_UNKNOWN','RECONCILING') AND (lease_until IS NULL OR lease_until<now()) RETURNING id`, id, upstream).Scan(&task)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO video_task_events(task_id,event_key,event_type,task_version,payload,actor_type,actor_id) VALUES($1,$2,'ADMIN_RECONCILIATION',0,$3,'admin',$4)`, task, id+":bind", videoJSON(map[string]string{"reason": reason, "evidence": "原账号任务完整提示词及实际模型核对一致"}), actor)
	if e != nil {
		return e
	}
	return tx.Commit()
}
func (r *videoRepository) RetryBilling(ctx context.Context, id string, actor int64, reason string) error {
	if reason == "" {
		return errors.New("VIDEO_AUDIT_REASON_REQUIRED")
	}
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var task int64
	if e = tx.QueryRowContext(ctx, `SELECT t.id FROM video_tasks t JOIN video_financial_reservations f ON f.task_id=t.id WHERE t.public_id=$1 AND t.status IN('COMPLETED','FAILED') AND f.state='HELD' FOR UPDATE OF t,f`, id).Scan(&task); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `UPDATE video_billing_events SET status='RETRY',attempts=0,next_attempt_at=now() WHERE task_id=$1 AND status IN('REVIEW','RETRY') AND operation IN('CAPTURE','RELEASE')`, task)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO video_task_events(task_id,event_key,event_type,task_version,payload,actor_type,actor_id) VALUES($1,$2||':'||clock_timestamp()::text,'ADMIN_BILLING_RETRY',0,$3,'admin',$4)`, task, id, videoJSON(map[string]string{"reason": reason}), actor)
	if e != nil {
		return e
	}
	return tx.Commit()
}
