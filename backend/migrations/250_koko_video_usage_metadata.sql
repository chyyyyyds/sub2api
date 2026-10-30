-- 视频标准消费记录的关联和价格快照；旧行保持 NULL，不回填旧业务。
SET LOCAL lock_timeout = '5s';
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS media_type VARCHAR(16);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS video_task_id VARCHAR(48) REFERENCES video_tasks(public_id) ON DELETE RESTRICT;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS video_pricing_snapshot JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS ux_usage_logs_video_task ON usage_logs(video_task_id) WHERE video_task_id IS NOT NULL;
COMMENT ON COLUMN usage_logs.media_type IS '媒体类型：新 KOKO 视频成功结算为 video，历史业务不回填';
COMMENT ON COLUMN usage_logs.video_task_id IS '本地视频任务编号，每个任务最多一条最终消费记录';
COMMENT ON COLUMN usage_logs.video_pricing_snapshot IS '视频创建时的十进制价格、分组倍率和账号统计快照';
