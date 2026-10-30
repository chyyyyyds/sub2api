package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/shopspring/decimal"
)

type videoRepository struct{ db *sql.DB }

func NewVideoRepository(db *sql.DB) service.VideoRepository { return &videoRepository{db: db} }
func (r *videoRepository) HasTasks(ctx context.Context) (bool, error) {
	var exists bool
	e := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM video_tasks)`).Scan(&exists)
	return exists, e
}
func videoJSON(v any) []byte    { b, _ := json.Marshal(v); return b }
func videoHash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func (r *videoRepository) SaveModels(ctx context.Context, account int64, scope string, models []service.KokoVideoModel) error {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	// 刷新必须使目录中已消失的模型立即停用，不能沿用上次能力。
	if _, e = tx.ExecContext(ctx, `UPDATE video_provider_models SET enabled=false,observed_at=now(),updated_at=now() WHERE account_id=$1`, account); e != nil {
		return e
	}
	for _, m := range models {
		raw := videoJSON(m)
		_, e = tx.ExecContext(ctx, `INSERT INTO video_provider_models(account_id,provider,model_id,display_name,enabled,maintenance,capability,evidence,capability_hash,observed_at)
 VALUES($1,'koko',$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT(account_id,provider,model_id) DO UPDATE SET display_name=EXCLUDED.display_name,enabled=EXCLUDED.enabled,maintenance=EXCLUDED.maintenance,capability=EXCLUDED.capability,evidence=EXCLUDED.evidence,capability_hash=EXCLUDED.capability_hash,observed_at=now(),updated_at=now()`, account, m.ID, m.Name, m.Enabled, m.Maintenance, raw, videoJSON(map[string]string{"source": "GET /models", "scope": scope}), videoHash(raw))
		if e != nil {
			return e
		}
	}
	return tx.Commit()
}
func (r *videoRepository) Models(ctx context.Context, account int64) ([]service.KokoVideoModel, error) {
	rows, e := r.db.QueryContext(ctx, `SELECT capability,enabled,maintenance FROM video_provider_models WHERE account_id=$1 ORDER BY model_id`, account)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []service.KokoVideoModel{}
	for rows.Next() {
		var raw []byte
		var enabled, maintenance bool
		if e = rows.Scan(&raw, &enabled, &maintenance); e != nil {
			return nil, e
		}
		var m service.KokoVideoModel
		if e = json.Unmarshal(raw, &m); e != nil {
			return nil, e
		}
		m.Enabled = enabled
		m.Maintenance = maintenance
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *videoRepository) Initialize(ctx context.Context, req service.VideoInitializeRequest, models []service.KokoVideoModel) (*service.VideoInitializeResult, error) {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	// 初始化按数据库事务锁串行；重复点击或多实例都复用原有配置。
	if _, e = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(749249)`); e != nil {
		return nil, e
	}
	out := &service.VideoInitializeResult{AccountID: req.AccountID, GroupID: req.GroupID, ChannelID: req.ChannelID, Models: []string{}}
	if out.GroupID == 0 {
		var count int
		if e = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MIN(g.id),0) FROM groups g JOIN account_groups ag ON ag.group_id=g.id WHERE ag.account_id=$1 AND g.platform='video' AND g.deleted_at IS NULL`, req.AccountID).Scan(&count, &out.GroupID); e != nil {
			return nil, e
		}
		if count > 1 {
			return nil, errors.New("KOKO_GROUP_SELECTION_REQUIRED")
		}
	}
	if out.GroupID == 0 {
		e = tx.QueryRowContext(ctx, `SELECT g.id FROM groups g JOIN account_groups ag ON ag.group_id=g.id WHERE ag.account_id=$1 AND g.name='视频创作' AND g.deleted_at IS NULL ORDER BY g.id LIMIT 1`, req.AccountID).Scan(&out.GroupID)
		if errors.Is(e, sql.ErrNoRows) {
			e = tx.QueryRowContext(ctx, `INSERT INTO groups(name,description,platform,status,rate_multiplier,allow_koko_video_generation) VALUES('视频创作','视频创作','video','disabled',1,false) ON CONFLICT(name) WHERE deleted_at IS NULL DO UPDATE SET name=EXCLUDED.name RETURNING id`).Scan(&out.GroupID)
		}
		if e != nil {
			return nil, e
		}
	}
	var platform string
	if e = tx.QueryRowContext(ctx, `SELECT platform,allow_koko_video_generation FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, out.GroupID).Scan(&platform, &out.CreationEnabled); e != nil {
		return nil, e
	}
	if platform != "video" {
		return nil, errors.New("KOKO_GROUP_PLATFORM_REQUIRED")
	}
	var linked int64
	e = tx.QueryRowContext(ctx, `SELECT channel_id FROM channel_groups WHERE group_id=$1`, out.GroupID).Scan(&linked)
	if e != nil && !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	if linked > 0 {
		if out.ChannelID > 0 && out.ChannelID != linked {
			return nil, errors.New("GROUP_CHANNEL_CONFLICT")
		}
		out.ChannelID = linked
	}
	if out.ChannelID == 0 {
		e = tx.QueryRowContext(ctx, `INSERT INTO channels(name,description,status) VALUES('KOKO Video','KOKO 视频按次定价','active') ON CONFLICT(name) DO UPDATE SET name=EXCLUDED.name RETURNING id`).Scan(&out.ChannelID)
		if e != nil {
			return nil, e
		}
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO account_groups(account_id,group_id,priority) VALUES($1,$2,50) ON CONFLICT(account_id,group_id) DO NOTHING`, req.AccountID, out.GroupID); e != nil {
		return nil, e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO channel_groups(channel_id,group_id) VALUES($1,$2) ON CONFLICT(group_id) DO NOTHING`, out.ChannelID, out.GroupID); e != nil {
		return nil, e
	}
	var existingPricing []byte
	if e = tx.QueryRowContext(ctx, `SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM channel_model_pricing p WHERE channel_id=$1 AND platform='video'`, out.ChannelID).Scan(&existingPricing); e != nil {
		return nil, e
	}
	for _, m := range models {
		if !m.Enabled || m.Maintenance || m.Type != "video" || !service.VideoModelIntegrationSupported(m.ID) {
			continue
		}
		out.Models = append(out.Models, m.ID)
		_, matched, priceError := service.ResolveKokoConfiguredPrice(existingPricing, m.ID, "")
		if matched && (priceError == nil || priceError.Error() == "VIDEO_PRICE_REQUIRED") {
			continue
		}
		// 用户已授权统一初始售价 $8/个；已有正式配置一律保留，避免初始化覆盖改价。
		_, e = tx.ExecContext(ctx, `INSERT INTO channel_model_pricing(channel_id,platform,models,billing_mode,per_request_price)
 SELECT $1,'video',$2,'video',8 WHERE NOT EXISTS(SELECT 1 FROM channel_model_pricing WHERE channel_id=$1 AND platform='video' AND models ? $3)`, out.ChannelID, videoJSON([]string{m.ID}), m.ID)
		if e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}

func (r *videoRepository) Quote(ctx context.Context, group, user int64, model string, req service.VideoCreateRequest) (service.VideoPriceSnapshot, int64, error) {
	return quoteVideo(ctx, r.db, group, user, model, req)
}

type videoQuerier interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func quoteVideo(ctx context.Context, q videoQuerier, group, user int64, model string, req service.VideoCreateRequest) (service.VideoPriceSnapshot, int64, error) {
	var p service.VideoPriceSnapshot
	var channel int64
	tier := fmt.Sprintf("duration=%d;resolution=%s;mode=%s", req.Duration, req.Resolution, req.Mode)
	if len(tier) > 50 {
		return p, 0, errors.New("VIDEO_PRICING_TIER_TOO_LONG")
	}
	var groupPricing, channelPricing []byte
	var source, mapped string
	e := q.QueryRowContext(ctx, `SELECT cg.channel_id,g.model_pricing,COALESCE(c.billing_model_source,'channel_mapped'),COALESCE(c.model_mapping->g.platform->>$2,$2),COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('intervals',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.sort_order,i.id) FROM channel_pricing_intervals i WHERE i.pricing_id=p.id),'[]'::jsonb)) ORDER BY p.id) FROM channel_model_pricing p WHERE p.channel_id=c.id AND p.platform=g.platform),'[]'::jsonb),COALESCE((SELECT rate_multiplier FROM user_group_rate_multipliers WHERE user_id=$3 AND group_id=g.id),g.rate_multiplier)::text
 FROM groups g JOIN channel_groups cg ON cg.group_id=g.id JOIN channels c ON c.id=cg.channel_id WHERE g.id=$1 AND g.deleted_at IS NULL AND c.status='active'`, group, model, user).Scan(&channel, &groupPricing, &source, &mapped, &channelPricing, &p.Multiplier)
	if e != nil {
		return p, 0, errors.New("VIDEO_PRICE_REQUIRED")
	}
	billingModel := mapped
	switch source {
	case "requested":
		billingModel = model
	case "upstream":
		if req.PricingUpstreamModel == "" {
			return p, 0, errors.New("VIDEO_PRICE_MODEL_UNRESOLVED")
		}
		billingModel = req.PricingUpstreamModel
	case "response_model":
		return p, 0, errors.New("VIDEO_RESPONSE_MODEL_PRICING_UNAVAILABLE")
	}
	price, matched, e := service.ResolveKokoConfiguredPrice(groupPricing, billingModel, tier)
	if e != nil {
		return p, 0, e
	}
	p.Source = "group"
	if !matched {
		price, matched, e = service.ResolveKokoConfiguredPrice(channelPricing, billingModel, tier)
		p.Source = "channel"
	}
	if e != nil {
		return p, 0, e
	}
	if !matched {
		return p, 0, errors.New("VIDEO_PRICE_REQUIRED")
	}
	p.BasePrice = price

	base, e := decimal.NewFromString(p.BasePrice)
	if e != nil || base.IsNegative() {
		return p, 0, errors.New("VIDEO_PRICE_INVALID")
	}
	rate, e := decimal.NewFromString(p.Multiplier)
	if e != nil || rate.IsNegative() {
		return p, 0, errors.New("VIDEO_MULTIPLIER_INVALID")
	}
	p.Charge = base.Mul(rate).Round(8).StringFixed(8)
	p.Currency = "USD"
	p.Duration = req.Duration
	p.Resolution = req.Resolution
	p.Tier = tier
	p.AccountMultiplier = "1"
	p.AccountCost = base.Round(8).StringFixed(8)
	return p, channel, nil
}

func (r *videoRepository) Create(ctx context.Context, t *service.VideoTaskRecord) (*service.VideoTask, error) {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	// 统一锁序：用户→Key→分组→账号；并发幂等请求只会冻结一次。
	var userStatus, keyStatus, groupStatus, subscriptionType string
	var keyGroup int64
	if e = tx.QueryRowContext(ctx, `SELECT status FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, t.UserID).Scan(&userStatus); e != nil {
		return nil, e
	}
	if e = tx.QueryRowContext(ctx, `SELECT status,COALESCE(group_id,0) FROM api_keys WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at>now()) FOR UPDATE`, t.APIKeyID, t.UserID).Scan(&keyStatus, &keyGroup); e != nil {
		return nil, e
	}
	var oldID, oldHash string
	e = tx.QueryRowContext(ctx, `SELECT public_id,request_hash FROM video_tasks WHERE api_key_id=$1 AND client_idempotency_key=$2`, t.APIKeyID, t.IdempotencyKey).Scan(&oldID, &oldHash)
	if e == nil {
		if oldHash != t.RequestHash {
			return nil, errors.New("VIDEO_IDEMPOTENCY_CONFLICT")
		}
		_ = tx.Rollback()
		return r.Get(ctx, oldID, t.UserID, t.APIKeyID, t.GroupID)
	}
	if !errors.Is(e, sql.ErrNoRows) {
		return nil, e
	}
	var enabled bool
	if e = tx.QueryRowContext(ctx, `SELECT status,subscription_type,allow_koko_video_generation FROM groups WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, t.GroupID).Scan(&groupStatus, &subscriptionType, &enabled); e != nil {
		return nil, e
	}
	if userStatus != "active" || keyStatus != "active" || keyGroup != t.GroupID || groupStatus != "active" || !enabled {
		return nil, errors.New("VIDEO_CREATION_DISABLED")
	}
	// 未接通的资金来源必须拒绝，绝不把订阅请求悄悄切换到钱包。
	if subscriptionType == "subscription" {
		var subscription int64
		if e = tx.QueryRowContext(ctx, `SELECT id FROM user_subscriptions WHERE user_id=$1 AND group_id=$2 AND status='active' AND expires_at>now() AND deleted_at IS NULL ORDER BY id LIMIT 1 FOR UPDATE`, t.UserID, t.GroupID).Scan(&subscription); e != nil {
			return nil, errors.New("VIDEO_SUBSCRIPTION_REQUIRED")
		}
		t.SubscriptionID = &subscription
	}
	var accountOK bool
	if e = tx.QueryRowContext(ctx, `SELECT status='active' AND schedulable AND EXISTS(SELECT 1 FROM account_groups WHERE account_id=a.id AND group_id=$2) FROM accounts a WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, t.AccountID, t.GroupID).Scan(&accountOK); e != nil || !accountOK {
		return nil, errors.New("VIDEO_ACCOUNT_DISABLED")
	}
	var modelRaw []byte
	var actualScope string
	if e = tx.QueryRowContext(ctx, `SELECT capability,evidence->>'scope' FROM video_provider_models WHERE account_id=$1 AND model_id=$2 AND enabled AND NOT maintenance FOR SHARE`, t.AccountID, t.UpstreamModel).Scan(&modelRaw, &actualScope); e != nil {
		return nil, errors.New("VIDEO_MODEL_DISABLED")
	}
	if actualScope != t.Scope || videoHash(modelRaw) != videoHash(videoJSON(t.Capability)) { // JSONB 序列化顺序不固定，按结构重新比对。
		var current service.KokoVideoModel
		_ = json.Unmarshal(modelRaw, &current)
		if actualScope != t.Scope || videoHash(videoJSON(current)) != videoHash(videoJSON(t.Capability)) {
			return nil, errors.New("VIDEO_CAPABILITY_CHANGED")
		}
	}
	req := service.VideoCreateRequest{Duration: t.Pricing.Duration, Resolution: t.Pricing.Resolution}
	// 对最终金额重新读取配置，创建阶段不接受客户端传入的金额。
	var p service.VideoPriceSnapshot
	var channel int64
	req.PricingUpstreamModel = t.UpstreamModel
	req.Mode = ""
	for _, mode := range t.Capability.Modes {
		if t.Pricing.Tier == fmt.Sprintf("duration=%d;resolution=%s;mode=%s", req.Duration, req.Resolution, mode) {
			req.Mode = mode
		}
	}
	p, channel, e = quoteVideo(ctx, tx, t.GroupID, t.UserID, t.RequestedModel, req)
	if e != nil {
		return nil, e
	}
	var accountRate string
	if e = tx.QueryRowContext(ctx, `SELECT COALESCE(rate_multiplier,1)::text FROM accounts WHERE id=$1`, t.AccountID).Scan(&accountRate); e != nil {
		return nil, e
	}
	ar, e := decimal.NewFromString(accountRate)
	if e != nil || ar.IsNegative() {
		return nil, errors.New("VIDEO_ACCOUNT_RATE_INVALID")
	}
	bp, _ := decimal.NewFromString(p.BasePrice)
	p.AccountMultiplier = ar.String()
	p.AccountCost = bp.Mul(ar).Round(8).StringFixed(8)
	t.Pricing = p
	t.ChannelID = channel
	if e = checkVideoQuota(ctx, tx, t, p.Charge); e != nil {
		return nil, e
	}
	priceRaw := videoJSON(p)
	priceHash := videoHash(priceRaw)
	_, e = tx.ExecContext(ctx, `INSERT INTO video_tasks(public_id,provider,user_id,api_key_id,group_id,channel_id,account_id,provider_scope,requested_model,channel_mapped_model,upstream_model,client_idempotency_key,upstream_idempotency_key,request_hash,request_ciphertext,request_cipher_version,capability_snapshot,pricing_snapshot,pricing_snapshot_hash,quoted_upstream_points)
 VALUES($1,'koko',$2,$3,$4,$5,$6,$7,$8,$16,$9,$10,$1,$11,$12,1,$13,$14,$15,$17::numeric)`, t.PublicID, t.UserID, t.APIKeyID, t.GroupID, t.ChannelID, t.AccountID, t.Scope, t.RequestedModel, t.UpstreamModel, t.IdempotencyKey, t.RequestHash, t.Ciphertext, videoJSON(t.Capability), priceRaw, priceHash, func() string {
		if t.ChannelMappedModel != "" {
			return t.ChannelMappedModel
		}
		return t.RequestedModel
	}(), func() any {
		value := t.Capability.DurationPrices[fmt.Sprint(p.Duration)]
		if value == "" {
			return nil
		}
		return value.String()
	}())
	if e != nil {
		return nil, e
	}
	if e = tx.QueryRowContext(ctx, `SELECT id FROM video_tasks WHERE public_id=$1`, t.PublicID).Scan(&t.DBID); e != nil {
		return nil, e
	}
	if t.SubscriptionID == nil {
		res, e := tx.ExecContext(ctx, `UPDATE users SET balance=balance-$2::numeric,frozen_balance=frozen_balance+$2::numeric WHERE id=$1 AND balance >= $2::numeric`, t.UserID, p.Charge)
		if e != nil {
			return nil, e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return nil, errors.New("VIDEO_INSUFFICIENT_BALANCE")
		}
	}
	funding := "wallet"
	if t.SubscriptionID != nil {
		funding = "subscription"
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO video_financial_reservations(task_id,user_id,api_key_id,funding_source,subscription_id,amount,pricing_snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,$7)`, t.DBID, t.UserID, t.APIKeyID, funding, t.SubscriptionID, p.Charge, priceHash)
	if e != nil {
		return nil, e
	}
	if t.SubscriptionID != nil {
		if _, e = tx.ExecContext(ctx, `INSERT INTO video_quota_reservations(task_id,scope_type,scope_key,amount,snapshot) VALUES($1,'subscription',$2,$3,'{}')`, t.DBID, fmt.Sprint(*t.SubscriptionID), p.Charge); e != nil {
			return nil, e
		}
	}

	for _, scope := range []struct{ kind, key string }{{"key_total", fmt.Sprint(t.APIKeyID)}, {"key_windows", fmt.Sprint(t.APIKeyID)}, {"user_platform", fmt.Sprintf("%d:video", t.UserID)}, {"account", fmt.Sprint(t.AccountID)}} {
		reserved := p.Charge
		if scope.kind == "account" {
			reserved = p.AccountCost
		}
		if _, e = tx.ExecContext(ctx, `INSERT INTO video_quota_reservations(task_id,scope_type,scope_key,amount,snapshot) VALUES($1,$2,$3,$4,'{}')`, t.DBID, scope.kind, scope.key, reserved); e != nil {
			return nil, e
		}
	}
	if e = videoEvent(ctx, tx, t.DBID, t.PublicID+":created", "CREATED"); e != nil {
		return nil, e
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO video_billing_events(task_id,operation,request_id,payload,payload_hash) VALUES($1,'CACHE_HOLD',$2,$4,$3)`, t.DBID, "video:hold:"+t.PublicID, priceHash, priceRaw); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return r.Get(ctx, t.PublicID, t.UserID, t.APIKeyID, t.GroupID)
}

func checkVideoQuota(ctx context.Context, tx *sql.Tx, t *service.VideoTaskRecord, amount string) error {
	if e := videoKeyQuota(ctx, tx, t.APIKeyID, amount); e != nil {
		return e
	}
	if e := videoPlatformQuota(ctx, tx, t.UserID, t.GroupID, amount); e != nil {
		return e
	}
	if e := videoAccountQuota(ctx, tx, t.AccountID, t.Pricing.AccountCost); e != nil {
		return e
	}
	sub := int64(0)
	if t.SubscriptionID != nil {
		sub = *t.SubscriptionID
	}
	return videoSubscriptionQuota(ctx, tx, t.UserID, t.GroupID, amount, sub)
}

const videoViewSQL = `SELECT t.public_id,t.requested_model,t.upstream_model,t.status,f.state,f.amount::text,CASE WHEN t.status='COMPLETED' AND t.retention_expires_at<=now() THEN 'EXPIRED' ELSE t.download_state END,(t.pricing_snapshot->>'duration')::int,t.pricing_snapshot->>'resolution',t.created_at,t.updated_at,t.completed_at,t.retention_expires_at,t.api_key_id,COALESCE(t.last_error_code,''),COALESCE(k.name,''),CASE WHEN k.deleted_at IS NOT NULL THEN 'deleted' ELSE COALESCE(k.status,'deleted') END FROM video_tasks t JOIN video_financial_reservations f ON f.task_id=t.id LEFT JOIN api_keys k ON k.id=t.api_key_id`

func scanVideoView(s interface{ Scan(...any) error }) (*service.VideoTask, error) {
	var v service.VideoTask
	e := s.Scan(&v.ID, &v.Model, &v.ActualModel, &v.Status, &v.BillingState, &v.Charge, &v.DownloadState, &v.Duration, &v.Resolution, &v.CreatedAt, &v.UpdatedAt, &v.CompletedAt, &v.ExpiresAt, &v.APIKeyID, &v.ErrorCode, &v.APIKeyName, &v.APIKeyStatus)
	return &v, e
}
func (r *videoRepository) Get(ctx context.Context, id string, user, key, group int64) (*service.VideoTask, error) {
	return scanVideoView(r.db.QueryRowContext(ctx, videoViewSQL+` WHERE t.public_id=$1 AND ($2::bigint=0 OR t.user_id=$2) AND ($3::bigint=0 OR t.api_key_id=$3) AND ($4::bigint=0 OR t.group_id=$4)`, id, user, key, group))
}
func (r *videoRepository) List(ctx context.Context, user, key int64) ([]service.VideoTask, error) {
	return r.ListPage(ctx, user, key, 0, "")
}
func (r *videoRepository) ListPage(ctx context.Context, user, key, group int64, before string) ([]service.VideoTask, error) {
	rows, e := r.db.QueryContext(ctx, videoViewSQL+` WHERE ($1::bigint=0 OR t.user_id=$1) AND ($2::bigint=0 OR t.api_key_id=$2) AND ($3::bigint=0 OR t.group_id=$3)
 AND ($4::text='' OR (t.created_at,t.id)<(SELECT created_at,id FROM video_tasks WHERE public_id=$4 AND ($1::bigint=0 OR user_id=$1) AND ($2::bigint=0 OR api_key_id=$2) AND ($3::bigint=0 OR group_id=$3))) ORDER BY t.created_at DESC,t.id DESC LIMIT 100`, user, key, group, before)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []service.VideoTask{}
	for rows.Next() {
		v, e := scanVideoView(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (r *videoRepository) Record(ctx context.Context, id string) (*service.VideoTaskRecord, error) {
	var t service.VideoTaskRecord
	var cap, price []byte
	e := r.db.QueryRowContext(ctx, `SELECT id,public_id,user_id,api_key_id,group_id,COALESCE(channel_id,0),account_id,provider_scope,requested_model,upstream_model,client_idempotency_key,request_hash,request_ciphertext,capability_snapshot,pricing_snapshot,status,COALESCE(upstream_id,''),COALESCE(lease_owner,''),lease_epoch FROM video_tasks WHERE public_id=$1`, id).Scan(&t.DBID, &t.PublicID, &t.UserID, &t.APIKeyID, &t.GroupID, &t.ChannelID, &t.AccountID, &t.Scope, &t.RequestedModel, &t.UpstreamModel, &t.IdempotencyKey, &t.RequestHash, &t.Ciphertext, &cap, &price, &t.Status, &t.UpstreamID, &t.LeaseOwner, &t.LeaseEpoch)
	if e != nil {
		return nil, e
	}
	if e = r.db.QueryRowContext(ctx, `SELECT subscription_id FROM video_financial_reservations WHERE task_id=$1`, t.DBID).Scan(&t.SubscriptionID); e != nil {
		return nil, e
	}
	if e = json.Unmarshal(cap, &t.Capability); e != nil {
		return nil, e
	}
	if e = json.Unmarshal(price, &t.Pricing); e != nil {
		return nil, e
	}
	return &t, nil
}
func (r *videoRepository) Claim(ctx context.Context, owner string, now time.Time) (*service.VideoTaskRecord, error) {
	var id string
	// 首次认领即记录 SUBMITTING；崩溃后的无上游 ID 任务绝不再次自动 POST。
	e := r.db.QueryRowContext(ctx, `WITH due AS(SELECT id FROM video_tasks WHERE status NOT IN('COMPLETED','FAILED') AND next_check_at<=$2 AND (lease_until IS NULL OR lease_until<$2) ORDER BY next_check_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE video_tasks t SET lease_owner=$1,lease_until=$2::timestamptz+interval '780 seconds',lease_epoch=lease_epoch+1,row_version=row_version+1,status=CASE WHEN status='CREATED' THEN 'SUBMITTING' ELSE status END,submit_attempts=CASE WHEN status='CREATED' THEN submit_attempts+1 ELSE submit_attempts END,updated_at=$2 FROM due WHERE t.id=due.id RETURNING public_id`, owner, now).Scan(&id)
	if e != nil {
		return nil, e
	}
	return r.Record(ctx, id)
}
func videoEvent(ctx context.Context, tx *sql.Tx, id int64, key, kind string) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO video_task_events(task_id,event_key,event_type,task_version,payload,actor_type) VALUES($1,$2,$3,0,'{}','system') ON CONFLICT(event_key) DO NOTHING`, id, key, kind)
	return e
}

func (r *videoRepository) Observe(ctx context.Context, t *service.VideoTaskRecord, result *service.KokoTaskResult, code string, rejected bool, now time.Time) error {
	tx, e := r.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var status string
	if e = tx.QueryRowContext(ctx, `SELECT status FROM video_tasks WHERE id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND lease_until>$4 FOR UPDATE`, t.DBID, t.LeaseOwner, t.LeaseEpoch, now).Scan(&status); e != nil {
		return e
	}
	next := status
	upstream := t.UpstreamID
	download := "NOT_READY"
	if result != nil {
		upstream = result.ID
		switch result.Status {
		case "completed":
			next = "COMPLETED"
			download = "UNKNOWN"
			if result.VideoURL != "" {
				download = "AVAILABLE"
			}
		case "failed":
			next = "FAILED"
		case "running":
			next = "RUNNING"
		case "queued", "submitting":
			if status != "RUNNING" {
				next = "QUEUED"
			}
		default:
			next = "RECONCILING"
			code = "KOKO_UNKNOWN_STATUS"
		}
	} else if rejected {
		next = "FAILED"
	} else if upstream == "" {
		next = "SUBMISSION_UNKNOWN"
	} else {
		next = "RECONCILING"
	}
	_, e = tx.ExecContext(ctx, `UPDATE video_tasks SET upstream_id=NULLIF($2,''),status=$3::text,download_state=$4::text,completed_at=CASE WHEN $3::text='COMPLETED' THEN $5::timestamptz ELSE NULL END,failed_at=CASE WHEN $3::text='FAILED' THEN $5::timestamptz ELSE NULL END,last_checked_at=$5,next_check_at=$5::timestamptz+interval '60 seconds',updated_at=$5,lease_owner=NULL,lease_until=NULL,last_error_code=NULLIF($6,''),review_required=$3::text IN('RECONCILING','SUBMISSION_UNKNOWN'),poll_attempts=poll_attempts+1,row_version=row_version+1 WHERE id=$1`, t.DBID, upstream, next, download, now, code)
	if e != nil {
		return e
	}
	if result != nil {
		var expires *time.Time
		var evidence any
		if result.ExpiresAt != nil {
			if parsed, err := time.Parse(time.RFC3339, *result.ExpiresAt); err == nil {
				expires = &parsed
				evidence = videoJSON(map[string]string{"source": "upstream.retention_expires_at", "value": *result.ExpiresAt})
			}
		}
		var points any
		if result.Points != "" {
			if d, err := decimal.NewFromString(string(result.Points)); err == nil && !d.IsNegative() {
				points = d.String()
			}
		}
		_, e = tx.ExecContext(ctx, `UPDATE video_tasks SET upstream_status=$2,actual_upstream_points=$3::numeric,retention_expires_at=$4,retention_evidence=$5::jsonb WHERE id=$1`, t.DBID, result.Status, points, expires, evidence)
		if e != nil {
			return e
		}
	}
	if next == "COMPLETED" || next == "FAILED" {
		op := "CAPTURE"
		prefix := "cap"
		if next == "FAILED" {
			op = "RELEASE"
			prefix = "rel"
		}
		raw := videoJSON(t.Pricing)
		_, e = tx.ExecContext(ctx, `INSERT INTO video_billing_events(task_id,operation,request_id,payload,payload_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id,operation) DO NOTHING`, t.DBID, op, "video:"+prefix+":"+t.PublicID, raw, videoHash(raw))
		if e != nil {
			return e
		}
	}
	if e = videoEvent(ctx, tx, t.DBID, fmt.Sprintf("%s:%d", t.PublicID, t.LeaseEpoch), next); e != nil {
		return e
	}
	return tx.Commit()
}
func (r *videoRepository) Audit(ctx context.Context, id string) (json.RawMessage, error) {
	var raw []byte
	e := r.db.QueryRowContext(ctx, `SELECT jsonb_build_object('task',t.public_id,'account_id',t.account_id,'group_id',t.group_id,'channel_id',t.channel_id,'pricing_snapshot',t.pricing_snapshot,'financial',(SELECT to_jsonb(f)||jsonb_build_object('amount',f.amount::text,'captured_amount',f.captured_amount::text) FROM video_financial_reservations f WHERE f.task_id=t.id),'billing_events',COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM video_billing_events b WHERE b.task_id=t.id),'[]'),'task_events',COALESCE((SELECT jsonb_agg(to_jsonb(e)) FROM video_task_events e WHERE e.task_id=t.id),'[]')) FROM video_tasks t WHERE t.public_id=$1`, id).Scan(&raw)
	return raw, e
}
func (r *videoRepository) SetGate(ctx context.Context, group int64, enabled bool) error {
	_, e := r.db.ExecContext(ctx, `UPDATE groups SET allow_koko_video_generation=$2,updated_at=now() WHERE id=$1 AND deleted_at IS NULL`, group, enabled)
	return e
}
func (r *videoRepository) GetGate(ctx context.Context, group int64) (bool, error) {
	var enabled bool
	e := r.db.QueryRowContext(ctx, `SELECT allow_koko_video_generation FROM groups WHERE id=$1 AND deleted_at IS NULL`, group).Scan(&enabled)
	return enabled, e
}
func (r *videoRepository) Replay(ctx context.Context, user, key, group int64, idempotency, hash string) (*service.VideoTask, error) {
	var id, storedHash string
	e := r.db.QueryRowContext(ctx, `SELECT public_id,request_hash FROM video_tasks WHERE user_id=$1 AND api_key_id=$2 AND group_id=$3 AND client_idempotency_key=$4`, user, key, group, idempotency).Scan(&id, &storedHash)
	if errors.Is(e, sql.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	if hash != "" && hash != storedHash {
		return nil, errors.New("VIDEO_IDEMPOTENCY_CONFLICT")
	}
	return r.Get(ctx, id, user, key, group)
}
func (r *videoRepository) RouteModel(ctx context.Context, group int64, model string) (string, error) {
	var mapped string
	e := r.db.QueryRowContext(ctx, `SELECT COALESCE(c.model_mapping->g.platform->>$2,$2) FROM channel_groups cg JOIN channels c ON c.id=cg.channel_id JOIN groups g ON g.id=cg.group_id WHERE cg.group_id=$1`, group, model).Scan(&mapped)
	return mapped, e
}
