"""newapi 到 sub2api 的只读取数、预检、幂等导入及对账工具。

只在甲骨文服务器执行。源库连接强制为只读；秘钥和密码哈希仅保存在服务器私有快照中。
默认只做预检，只有显式传入 --apply 才写入目标库。
"""

import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

SOURCE_CONTAINER = "new-api-postgres"
SOURCE_USER = SOURCE_DB = "newapi"
SOURCE_SYSTEM = "oracle-newapi-main"
EXCLUDED_IDS = {1, 2}
EXCLUDED_EMAIL = "chenhanyu987@gmail.com"
GROUPS = {
    "ClaudeCode": (2, "openAI 特惠组"),
    "独立池+混合池": (2, "openAI 特惠组"),
    "team/plus/bugpro全自动号池": (2, "openAI 特惠组"),
    "正价plus/pro稳定组": (3, "openAI 性价比组"),
    "openai不降智": (4, "openAI 尊享组"),
    "OpenAI官key": (4, "openAI 尊享组"),
    "生图": (3, "openAI 性价比组"),
}
VIDEO_GROUPS = {"seedance视频生成", "视频生成（稳定版）"}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def psql(container, user, db, sql, log_dir, readonly=True):
    command = ["docker", "exec", "-i"]
    if readonly:
        command += ["-e", "PGOPTIONS=-c default_transaction_read_only=on"]
    command += [container, "psql", "-X", "-qAt", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1"]
    result = subprocess.run(command, input=sql, text=True, encoding="utf-8", capture_output=True)
    if result.returncode:
        # 唯一约束错误可能携带 Key 或兑换码，诊断只写入私有文件，不能直接输出。
        path = log_dir / "private-database-error.log"
        path.write_text(result.stderr, encoding="utf-8")
        raise RuntimeError("数据库操作失败，私有诊断文件：" + str(path))
    return result.stdout.strip()


def export_snapshot(directory):
    sql = """
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s';
SELECT json_build_object(
  'source_system','oracle-newapi-main', 'snapshot_at',now(),
  'quota_per_unit',coalesce((SELECT value::numeric FROM options WHERE key='QuotaPerUnit'),500000),
  'unsupported_features',json_build_object(
    'oauth_bindings',(SELECT count(*) FROM user_oauth_bindings),
    'external_identities',(SELECT count(*) FROM external_identity_claims),
    'enabled_two_fa',(SELECT count(*) FROM two_fas WHERE is_enabled=true AND deleted_at IS NULL),
    'passkeys',(SELECT count(*) FROM passkey_credentials),
    'subscriptions',(SELECT count(*) FROM user_subscriptions)),
  'inflight_tasks',(SELECT count(*) FROM tasks WHERE status NOT IN ('SUCCESS','FAILURE')),
  'users',(SELECT coalesce(json_agg(x ORDER BY x.id),'[]') FROM
    (SELECT id,username,password,email,display_name,role,status,quota,created_at,last_login_at FROM users WHERE deleted_at IS NULL) x),
  'keys',(SELECT coalesce(json_agg(x ORDER BY x.id),'[]') FROM
    (SELECT id,user_id,key,status,name,created_time,accessed_time,expired_time,remain_quota,unlimited_quota,used_quota,"group",model_limits_enabled,allow_ips FROM tokens WHERE deleted_at IS NULL) x),
  'codes',(SELECT coalesce(json_agg(x ORDER BY x.id),'[]') FROM
    (SELECT id,key,status,quota,created_time,redeemed_time,used_user_id,expired_time FROM redemptions WHERE deleted_at IS NULL) x));
COMMIT;
"""
    content = psql(SOURCE_CONTAINER, SOURCE_USER, SOURCE_DB, sql, directory)
    data = json.loads(content)
    path = directory / "source-snapshot.private.json"
    path.write_text(canonical(data) + "\n", encoding="utf-8")
    return path


def money(quota):
    return format(Decimal(quota) / Decimal(500000), ".8f")


def prepare(snapshot):
    if snapshot["source_system"] != SOURCE_SYSTEM or snapshot["quota_per_unit"] != 500000:
        raise ValueError("来源标识或额度单位不符合已确认规则")
    if any(snapshot.get("unsupported_features", {}).values()):
        raise ValueError("来源新增了 OAuth、双因素认证、Passkey 或订阅，需先扩展迁移规则")
    users, keys, codes = [], [], []
    seen_emails, seen_names, seen_keys, seen_codes = set(), set(), set(), set()
    for source in snapshot["users"]:
        if source["id"] in EXCLUDED_IDS or source["email"].strip().lower() == EXCLUDED_EMAIL:
            continue
        email, username = source["email"].strip(), source["username"]
        if not email or not username or username != username.strip() or len(username.encode("utf-8")) > 100:
            raise ValueError("用户邮箱或原用户名不满足登录规则，源用户 ID=" + str(source["id"]))
        if email.lower() in seen_emails or username in seen_names:
            raise ValueError("来源中存在重复邮箱或用户名")
        if source["role"] != 1:
            raise ValueError("存在未获授权迁移的管理员")
        hashed = source["password"]
        if not (hashed.startswith("$argon2id$v=19$m=19456,t=2,p=1$") and len(hashed) == 97):
            if not hashed.startswith(("$2a$", "$2b$", "$2y$")):
                raise ValueError("存在不支持的密码哈希格式")
        seen_emails.add(email.lower())
        seen_names.add(username)
        users.append(dict(source_id=source["id"], email=email, username=username,
                          password_hash=hashed, balance=money(source["quota"]),
                          status="active" if source["status"] == 1 else "disabled",
                          created_at=source["created_at"], last_login_at=source["last_login_at"]))
    eligible = {user["source_id"] for user in users}
    skipped = {"excluded_user_keys": 0, "empty_group_keys": 0, "video_keys": 0}
    for source in snapshot["keys"]:
        if source["user_id"] not in eligible:
            skipped["excluded_user_keys"] += 1
            continue
        group = (source["group"] or "").strip()
        if not group:
            skipped["empty_group_keys"] += 1
            continue
        if group in VIDEO_GROUPS:
            skipped["video_keys"] += 1
            continue
        if group not in GROUPS:
            raise ValueError("存在未确认的旧分组：" + group)
        if (source.get("allow_ips") or "").strip():
            raise ValueError("来源新增了 IP 限制，需先补齐限制转换，拒绝静默丢弃")
        credential = source["key"]
        if not credential.startswith("sk-"):
            credential = "sk-" + credential
        if len(credential) > 128 or credential in seen_keys:
            raise ValueError("Key 长度异常或来源重复")
        seen_keys.add(credential)
        statuses = {1: "active", 2: "disabled", 3: "expired", 4: "quota_exhausted"}
        if source["status"] not in statuses:
            raise ValueError("存在未知 Key 状态")
        keys.append(dict(source_id=source["id"], user_source_id=source["user_id"],
                         key=credential, name=source["name"] or "迁移的 API Key",
                         group_id=GROUPS[group][0], old_group=group, status=statuses[source["status"]],
                         quota="0.00000000" if source["unlimited_quota"] else money(source["remain_quota"] + source["used_quota"]),
                         quota_used="0.00000000" if source["unlimited_quota"] else money(source["used_quota"]),
                         created_at=source["created_time"], expires_at=source["expired_time"]))
    for source in snapshot["codes"]:
        code = source["key"].strip()
        if not code or len(code.encode("utf-8")) > 32 or code in seen_codes:
            raise ValueError("兑换码长度异常或来源重复")
        seen_codes.add(code)
        statuses = {1: "unused", 2: "disabled", 3: "used"}
        if source["status"] not in statuses:
            raise ValueError("存在未知兑换码状态")
        # 已被排除账号使用过的码保留已用状态，但不导入该账号及其关联信息。
        codes.append(dict(source_id=source["id"], code=code, value=money(source["quota"]),
                          status=statuses[source["status"]],
                          user_source_id=source["used_user_id"] if source["used_user_id"] in eligible else None,
                          created_at=source["created_time"], used_at=source["redeemed_time"], expires_at=source["expired_time"]))
    entities = []
    for kind, rows in [("user", users), ("key", keys), ("code", codes)]:
        for row in rows:
            entities.append(dict(kind=kind, source_id=row["source_id"], payload=row, payload_hash=digest(row)))
    return entities, dict(users=len(users), keys=len(keys), codes=len(codes), skipped=skipped,
                          user_balance_total=str(sum((Decimal(u["balance"]) for u in users), Decimal(0))),
                          unused_code_value_total=str(sum((Decimal(c["value"]) for c in codes if c["status"] == "unused"), Decimal(0))),
                          disabled_keys=sum(k["status"] == "disabled" for k in keys),
                          model_limits_removed=sum(k["model_limits_enabled"] for k in snapshot["keys"] if k["id"] in {x["source_id"] for x in keys}))


IMPORT_SQL = """
-- 整批原子导入；任何冲突、金额差异或排除规则不符均回滚。
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(261026247);
CREATE TABLE IF NOT EXISTS newapi_migration_batches (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('test','formal')),
    snapshot_sha256 CHAR(64) NOT NULL, snapshot_at TIMESTAMPTZ NOT NULL,
    summary JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS newapi_migration_entities (
    source_system TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('user','key','code')),
    source_id BIGINT NOT NULL, target_id BIGINT NOT NULL, payload_hash CHAR(64) NOT NULL,
    first_batch_id TEXT NOT NULL REFERENCES newapi_migration_batches(id),
    latest_batch_id TEXT NOT NULL REFERENCES newapi_migration_batches(id),
    PRIMARY KEY(source_system,kind,source_id), UNIQUE(kind,target_id)
);
CREATE TEMP TABLE incoming_migration (kind TEXT, source_id BIGINT, payload JSONB, payload_hash TEXT) ON COMMIT DROP;
INSERT INTO incoming_migration SELECT * FROM jsonb_to_recordset(__ENTITIES__::jsonb)
AS x(kind TEXT, source_id BIGINT, payload JSONB, payload_hash TEXT);
INSERT INTO newapi_migration_batches(id,mode,snapshot_sha256,snapshot_at,summary)
VALUES (__BATCH__,__MODE__,__SHA__,__TIME__::timestamptz,__SUMMARY__::jsonb)
ON CONFLICT(id) DO NOTHING;

DO $migration$
DECLARE
    r RECORD; prior RECORD; target BIGINT; owner_id BIGINT; row_data JSONB;
    refresh BOOLEAN := __REFRESH__; batch TEXT := __BATCH__;
BEGIN
    IF (SELECT count(*) FROM groups WHERE deleted_at IS NULL AND platform='openai' AND status='active'
        AND allow_messages_dispatch=true AND ((id=2 AND name='openAI 特惠组') OR
        (id=3 AND name='openAI 性价比组') OR (id=4 AND name='openAI 尊享组'))) <> 3 THEN
        RAISE EXCEPTION '新分组或 Claude Code 开关不符合迁移前提';
    END IF;
    IF EXISTS (SELECT 1 FROM newapi_migration_entities m WHERE m.source_system='oracle-newapi-main'
               AND NOT EXISTS(SELECT 1 FROM incoming_migration i WHERE i.kind=m.kind AND i.source_id=m.source_id)) THEN
        RAISE EXCEPTION '新快照已删除或排除了旧测试对象，必须先审查清理，禁止遗留可用旧 Key 或资产';
    END IF;
    FOR r IN SELECT * FROM incoming_migration ORDER BY CASE kind WHEN 'user' THEN 1 WHEN 'key' THEN 2 ELSE 3 END,source_id LOOP
        row_data := r.payload;
        SELECT * INTO prior FROM newapi_migration_entities
        WHERE source_system='oracle-newapi-main' AND kind=r.kind AND source_id=r.source_id FOR UPDATE;
        IF FOUND THEN
            IF prior.payload_hash=r.payload_hash AND NOT refresh THEN CONTINUE; END IF;
            IF NOT refresh THEN RAISE EXCEPTION '旧批次数据已变化，请明确使用 refresh-test 模式'; END IF;
            IF NOT EXISTS (SELECT 1 FROM newapi_migration_batches WHERE id=prior.latest_batch_id AND mode='test') THEN
                RAISE EXCEPTION '禁止以测试刷新方式覆盖正式迁移数据';
            END IF;
            target := prior.target_id;
        ELSE
            target := NULL;
        END IF;
        IF r.kind='user' THEN
            IF r.source_id IN (1,2) OR lower(row_data->>'email')='chenhanyu987@gmail.com' THEN
                RAISE EXCEPTION '排除账号进入待导入集合';
            END IF;
            IF EXISTS (SELECT 1 FROM users WHERE deleted_at IS NULL AND lower(trim(email))=lower(row_data->>'email') AND id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '目标已有同邮箱账号，拒绝自动合并';
            END IF;
            IF EXISTS (SELECT 1 FROM users WHERE deleted_at IS NULL AND username=row_data->>'username' AND id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '目标已有同名账号，拒绝自动合并';
            END IF;
            IF EXISTS (SELECT 1 FROM users WHERE deleted_at IS NULL AND lower(trim(email))=lower(row_data->>'username') AND id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '旧用户名与其他账号邮箱冲突，拒绝产生登录歧义';
            END IF;
            IF EXISTS (SELECT 1 FROM auth_identities WHERE provider_type='email' AND provider_key='email'
                       AND provider_subject=lower(row_data->>'email') AND user_id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '邮箱登录身份已属于其他账号';
            END IF;
            IF target IS NULL THEN
                INSERT INTO users(email,password_hash,role,balance,concurrency,status,username,notes,
                                  created_at,last_login_at,signup_source,balance_notify_enabled)
                VALUES (row_data->>'email',row_data->>'password_hash','user',(row_data->>'balance')::numeric,5,
                        row_data->>'status',row_data->>'username','newapi 迁移；批次 '||batch,
                        CASE WHEN (row_data->>'created_at')::bigint>0 THEN to_timestamp((row_data->>'created_at')::bigint) ELSE now() END,
                        CASE WHEN (row_data->>'last_login_at')::bigint>0 THEN to_timestamp((row_data->>'last_login_at')::bigint) END,'email',__MODE__='formal')
                RETURNING id INTO target;
            ELSE
                IF NOT EXISTS (SELECT 1 FROM users WHERE id=target AND role='user' AND deleted_at IS NULL) THEN
                    RAISE EXCEPTION '目标账号不再是本次测试导入的普通用户';
                END IF;
                IF EXISTS (SELECT 1 FROM users WHERE id=target AND lower(trim(email))<>lower(row_data->>'email')) THEN
                    RAISE EXCEPTION '来源邮箱已变化，需先审查旧邮箱登录身份的回收，禁止遗留旧绑定';
                END IF;
                UPDATE users SET email=row_data->>'email',password_hash=row_data->>'password_hash',
                    balance=(row_data->>'balance')::numeric,frozen_balance=0,status=row_data->>'status',
                    balance_notify_enabled=(__MODE__='formal'),
                    updated_at=now(),notes='newapi 迁移刷新；批次 '||batch WHERE id=target;
            END IF;
            INSERT INTO legacy_login_usernames(username,user_id,source_system,source_user_id)
            VALUES(row_data->>'username',target,'oracle-newapi-main',r.source_id)
            ON CONFLICT(user_id) DO UPDATE SET username=excluded.username;
            INSERT INTO auth_identities(user_id,provider_type,provider_key,provider_subject,verified_at,metadata)
            VALUES(target,'email','email',lower(row_data->>'email'),now(),
                   jsonb_build_object('source','newapi_migration','batch',batch))
            ON CONFLICT(provider_type,provider_key,provider_subject) DO NOTHING;
        ELSIF r.kind='key' THEN
            SELECT target_id INTO STRICT owner_id FROM newapi_migration_entities
            WHERE source_system='oracle-newapi-main' AND kind='user' AND source_id=(row_data->>'user_source_id')::bigint;
            IF EXISTS (SELECT 1 FROM api_keys WHERE key=row_data->>'key' AND id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '目标 Key 冲突，拒绝覆盖';
            END IF;
            IF target IS NULL THEN
                INSERT INTO api_keys(user_id,key,name,group_id,status,quota,quota_used,created_at,expires_at)
                VALUES(owner_id,row_data->>'key',row_data->>'name',(row_data->>'group_id')::bigint,row_data->>'status',
                       (row_data->>'quota')::numeric,(row_data->>'quota_used')::numeric,
                       CASE WHEN (row_data->>'created_at')::bigint>0 THEN to_timestamp((row_data->>'created_at')::bigint) ELSE now() END,
                       CASE WHEN (row_data->>'expires_at')::bigint>0 THEN to_timestamp((row_data->>'expires_at')::bigint) END)
                RETURNING id INTO target;
            ELSE
                UPDATE api_keys SET user_id=owner_id,key=row_data->>'key',name=row_data->>'name',
                    group_id=(row_data->>'group_id')::bigint,status=row_data->>'status',
                    quota=(row_data->>'quota')::numeric,quota_used=(row_data->>'quota_used')::numeric,
                    rate_limit_5h=0,rate_limit_1d=0,rate_limit_7d=0,usage_5h=0,usage_1d=0,usage_7d=0,
                    window_5h_start=NULL,window_1d_start=NULL,window_7d_start=NULL,ip_whitelist=NULL,ip_blacklist=NULL,
                    expires_at=CASE WHEN (row_data->>'expires_at')::bigint>0 THEN to_timestamp((row_data->>'expires_at')::bigint) END,
                    deleted_at=NULL,updated_at=now() WHERE id=target;
                IF NOT FOUND THEN RAISE EXCEPTION '测试 Key 已被删除，拒绝隐式重建'; END IF;
            END IF;
            PERFORM enqueue_auth_cache_invalidation(row_data->>'key');
        ELSE
            owner_id := NULL;
            IF row_data->>'user_source_id' IS NOT NULL THEN
                SELECT target_id INTO STRICT owner_id FROM newapi_migration_entities
                WHERE source_system='oracle-newapi-main' AND kind='user' AND source_id=(row_data->>'user_source_id')::bigint;
            END IF;
            IF EXISTS (SELECT 1 FROM redeem_codes WHERE code=row_data->>'code' AND id IS DISTINCT FROM target) THEN
                RAISE EXCEPTION '目标兑换码冲突，拒绝覆盖';
            END IF;
            IF target IS NULL THEN
                INSERT INTO redeem_codes(code,type,value,status,used_by,used_at,notes,created_at,expires_at)
                VALUES(row_data->>'code','balance',(row_data->>'value')::numeric,row_data->>'status',owner_id,
                       CASE WHEN (row_data->>'used_at')::bigint>0 THEN to_timestamp((row_data->>'used_at')::bigint) END,
                       'newapi 迁移；批次 '||batch,
                       CASE WHEN (row_data->>'created_at')::bigint>0 THEN to_timestamp((row_data->>'created_at')::bigint) ELSE now() END,
                       CASE WHEN (row_data->>'expires_at')::bigint>0 THEN to_timestamp((row_data->>'expires_at')::bigint) END)
                RETURNING id INTO target;
            ELSE
                UPDATE redeem_codes SET value=(row_data->>'value')::numeric,status=row_data->>'status',used_by=owner_id,
                    used_at=CASE WHEN (row_data->>'used_at')::bigint>0 THEN to_timestamp((row_data->>'used_at')::bigint) END,
                    expires_at=CASE WHEN (row_data->>'expires_at')::bigint>0 THEN to_timestamp((row_data->>'expires_at')::bigint) END
                WHERE id=target;
                IF NOT FOUND THEN RAISE EXCEPTION '测试兑换码已被删除，拒绝隐式重建'; END IF;
            END IF;
        END IF;
        INSERT INTO newapi_migration_entities(source_system,kind,source_id,target_id,payload_hash,first_batch_id,latest_batch_id)
        VALUES('oracle-newapi-main',r.kind,r.source_id,target,r.payload_hash,batch,batch)
        ON CONFLICT(source_system,kind,source_id) DO UPDATE
        SET payload_hash=excluded.payload_hash,latest_batch_id=excluded.latest_batch_id;
    END LOOP;
    IF EXISTS (SELECT 1 FROM incoming_migration i JOIN newapi_migration_entities m ON
        m.source_system='oracle-newapi-main' AND m.kind=i.kind AND m.source_id=i.source_id
        LEFT JOIN users u ON u.id=m.target_id AND i.kind='user'
        WHERE i.kind='user' AND (u.id IS NULL OR u.balance<>(i.payload->>'balance')::numeric OR u.password_hash<>i.payload->>'password_hash')) THEN
        RAISE EXCEPTION '用户余额或原密码哈希对账失败';
    END IF;
END;
$migration$;
COMMIT;
SELECT json_build_object('result','ok','batch',__BATCH__,'counts',
    (SELECT json_object_agg(kind,n) FROM (SELECT kind,count(*) AS n FROM newapi_migration_entities
    WHERE source_system='oracle-newapi-main' GROUP BY kind) x));
"""


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--target-container", default="sub2api-v11-prod-postgres")
    parser.add_argument("--target-user", default="sub2api_v11")
    parser.add_argument("--target-db", default="sub2api_v11")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--refresh-test", action="store_true", help="显式用新快照刷新以前导入的测试数据")
    parser.add_argument("--mode", choices=["test", "formal"], default="test")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.target_container == SOURCE_CONTAINER or args.target_db == SOURCE_DB:
        raise ValueError("禁止将来源 newapi 作为写入目标")
    path = args.snapshot or export_snapshot(args.directory)
    snapshot = json.loads(path.read_text(encoding="utf-8"))
    entities, summary = prepare(snapshot)
    sha = digest(snapshot)
    batch = args.mode + "-" + sha[:16]
    report = dict(batch=batch, mode=args.mode, snapshot_at=snapshot["snapshot_at"], snapshot_sha256=sha, **summary)
    (args.directory / "preflight-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    if not args.apply:
        return
    if args.mode == "formal" and not (args.directory / "source-frozen.confirmed").exists():
        raise ValueError("正式模式需要 source-frozen.confirmed 记录旧站停止扣款及最终快照的确认")
    if args.mode == "formal" and snapshot.get("inflight_tasks", 0):
        raise ValueError("正式快照仍有未结算异步任务，拒绝导入最终余额")
    # 导入之前保存整个目标库；备份仅用于验收站回退，正式站有新流水时禁止直接整库恢复。
    backup = args.directory / (batch + ".before.dump")
    if not backup.exists():
        with backup.open("xb") as output:
            result = subprocess.run(["docker", "exec", args.target_container, "pg_dump", "-U", args.target_user,
                                     "-d", args.target_db, "-Fc"], stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError("目标库备份失败，未开始导入")
    text = IMPORT_SQL
    values = {"__ENTITIES__": literal(canonical(entities)), "__BATCH__": literal(batch), "__MODE__": literal(args.mode),
              "__SHA__": literal(sha), "__TIME__": literal(snapshot["snapshot_at"]),
              "__SUMMARY__": literal(canonical(summary)), "__REFRESH__": "true" if args.refresh_test else "false"}
    # 一次替换模板，避免来源文本中恰好包含标记时被二次解释。
    text = re.sub("|".join(re.escape(marker) for marker in values), lambda match: values[match.group()], text)
    output = psql(args.target_container, args.target_user, args.target_db, text, args.directory, readonly=False)
    result = json.loads(output.splitlines()[-1])
    (args.directory / "import-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
