-- 新视频收费创建默认关闭；价格沿用现有 Channel 配置。
SET LOCAL lock_timeout = '5s';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS allow_koko_video_generation BOOLEAN NOT NULL DEFAULT false;

-- 禁用账号允许继续核对；仍有任务时禁止删除或替换原始凭据，防止绑定漂移。
CREATE OR REPLACE FUNCTION guard_koko_video_account_binding() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM video_tasks WHERE account_id=OLD.id AND (status NOT IN('COMPLETED','FAILED') OR (status='COMPLETED' AND download_state <> 'EXPIRED' AND (retention_expires_at IS NULL OR retention_expires_at>now())))) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'KOKO 账号仍有视频历史或任务，不能删除'; END IF;
  IF NEW.credentials IS DISTINCT FROM OLD.credentials OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.platform IS DISTINCT FROM OLD.platform OR NEW.type IS DISTINCT FROM OLD.type THEN
   RAISE EXCEPTION 'KOKO 账号仍有任务或待下载视频，禁止更换绑定';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
DROP TRIGGER IF EXISTS trg_koko_video_account_binding ON accounts;
CREATE TRIGGER trg_koko_video_account_binding BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION guard_koko_video_account_binding();
