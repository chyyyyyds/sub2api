-- 视频独立平台迁移：只处理明确标记为 KOKO 的专用账号及其专用分组。
-- 保留用户 Key、余额、原任务、定价金额和分组倍率。
SET LOCAL lock_timeout = '5s';
-- 原绑定保护会阻止平台名称变更；事务内持有表锁，仅本迁移改平台分类，凭据和账号 ID 不变。
ALTER TABLE accounts DISABLE TRIGGER trg_koko_video_account_binding;
UPDATE accounts SET platform='video', updated_at=now()
WHERE deleted_at IS NULL AND platform='openai'
  AND (extra->>'video_provider'='koko' OR credentials->'openai_capabilities' ? 'koko_video');
ALTER TABLE accounts ENABLE TRIGGER trg_koko_video_account_binding;

UPDATE groups g SET platform='video', name=CASE WHEN g.name='KOKO 视频' THEN '视频创作' ELSE g.name END,
  description='视频创作 · oo-sd25-1080p · 1080P', updated_at=now()
WHERE g.deleted_at IS NULL AND g.platform='openai'
  AND EXISTS(SELECT 1 FROM account_groups ag JOIN accounts a ON a.id=ag.account_id WHERE ag.group_id=g.id AND a.platform='video' AND a.deleted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM account_groups ag JOIN accounts a ON a.id=ag.account_id WHERE ag.group_id=g.id AND a.platform<>'video' AND a.deleted_at IS NULL);

UPDATE video_quota_reservations q SET scope_key=t.user_id::text||':video'
FROM video_tasks t JOIN groups g ON g.id=t.group_id
WHERE q.task_id=t.id AND q.scope_type='user_platform' AND g.platform='video';

UPDATE channels c SET model_mapping=jsonb_set(COALESCE(c.model_mapping,'{}'::jsonb),'{video}',c.model_mapping->'openai',true)
WHERE c.model_mapping ? 'openai' AND NOT c.model_mapping ? 'video'
  AND EXISTS(SELECT 1 FROM channel_groups cg JOIN groups g ON g.id=cg.group_id WHERE cg.channel_id=c.id AND g.platform='video');

-- 渠道若被普通 OpenAI 分组复用则复制视频定价，避免影响聊天渠道。
INSERT INTO channel_model_pricing(channel_id,platform,models,billing_mode,per_request_price)
SELECT p.channel_id,'video',p.models,p.billing_mode,p.per_request_price
FROM channel_model_pricing p
WHERE p.platform='openai' AND p.billing_mode='video'
  AND p.models ? 'oo-sd25-1080p'
  AND EXISTS(SELECT 1 FROM channel_groups cg JOIN groups g ON g.id=cg.group_id WHERE cg.channel_id=p.channel_id AND g.platform='video')
  AND NOT EXISTS(SELECT 1 FROM channel_model_pricing v WHERE v.channel_id=p.channel_id AND v.platform='video' AND v.models ? 'oo-sd25-1080p');

INSERT INTO channel_pricing_intervals(pricing_id,min_tokens,max_tokens,tier_label,per_request_price,sort_order)
SELECT v.id,i.min_tokens,i.max_tokens,i.tier_label,i.per_request_price,i.sort_order
FROM channel_pricing_intervals i JOIN channel_model_pricing p ON p.id=i.pricing_id
JOIN channel_model_pricing v ON v.channel_id=p.channel_id AND v.platform='video' AND v.models=p.models
WHERE p.platform='openai' AND p.billing_mode='video' AND p.models ? 'oo-sd25-1080p'
  AND NOT EXISTS(SELECT 1 FROM channel_pricing_intervals n WHERE n.pricing_id=v.id);
