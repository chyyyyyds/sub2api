-- KOKO 视频任务、预留和审计；不改写已有业务数据。
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS video_provider_models (
    id BIGSERIAL PRIMARY KEY,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    provider VARCHAR(20) NOT NULL CHECK (provider = 'koko'),
    model_id VARCHAR(200) NOT NULL,
    display_name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL,
    maintenance BOOLEAN NOT NULL,
    capability JSONB NOT NULL CHECK (jsonb_typeof(capability) = 'object'),
    evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    capability_hash CHAR(64) NOT NULL,
    contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version > 0),
    observed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, provider, model_id)
);

CREATE TABLE IF NOT EXISTS video_tasks (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(48) NOT NULL UNIQUE,
    provider VARCHAR(20) NOT NULL CHECK (provider = 'koko'),
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
    group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
    channel_id BIGINT NULL REFERENCES channels(id) ON DELETE RESTRICT,
    account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    provider_scope CHAR(64) NOT NULL,
    requested_model VARCHAR(200) NOT NULL,
    channel_mapped_model VARCHAR(200) NOT NULL,
    upstream_model VARCHAR(200) NOT NULL,
    client_idempotency_key VARCHAR(100) NOT NULL,
    upstream_idempotency_key VARCHAR(100) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    request_ciphertext BYTEA NOT NULL,
    request_cipher_version INTEGER NOT NULL CHECK (request_cipher_version > 0),
    capability_snapshot JSONB NOT NULL,
    pricing_snapshot JSONB NOT NULL,
    pricing_snapshot_hash CHAR(64) NOT NULL,
    quoted_upstream_points NUMERIC(20,8) NULL,
    actual_upstream_points NUMERIC(20,8) NULL,
    upstream_refund_state VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (upstream_refund_state IN ('UNKNOWN','EXPECTED','CONFIRMED','REVIEW')),
    upstream_id TEXT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED','SUBMITTING','SUBMISSION_UNKNOWN',
                          'QUEUED','RUNNING','RECONCILING','COMPLETED','FAILED')),
    upstream_status VARCHAR(64) NULL,
    previous_active_status VARCHAR(32) NULL,
    download_state VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN'
        CHECK (download_state IN ('UNKNOWN','NOT_READY','AVAILABLE',
                                  'TEMP_UNAVAILABLE','EXPIRED')),
    retention_expires_at TIMESTAMPTZ NULL,
    retention_evidence JSONB NULL,
    upstream_completed_at TIMESTAMPTZ NULL,
    last_content_checked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    submitted_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    last_checked_at TIMESTAMPTZ NULL,
    next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    review_required BOOLEAN NOT NULL DEFAULT false,
    last_error_code VARCHAR(80) NULL,
    upstream_request_id VARCHAR(128) NULL,
    submit_attempts INTEGER NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
    poll_attempts INTEGER NOT NULL DEFAULT 0 CHECK (poll_attempts >= 0),
    consecutive_errors INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_errors >= 0),
    lease_owner VARCHAR(64) NULL,
    lease_until TIMESTAMPTZ NULL,
    lease_epoch BIGINT NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
    row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
    UNIQUE (id, user_id, api_key_id),
    UNIQUE (api_key_id, client_idempotency_key),
    UNIQUE (provider_scope, upstream_idempotency_key),
    CHECK (client_idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
    CHECK (upstream_idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
    CHECK (public_id ~ '^vtsk_[a-f0-9]{32}$'),
    CHECK (upstream_id IS NULL OR length(upstream_id) > 0),
    CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
    CHECK (quoted_upstream_points IS NULL OR quoted_upstream_points >= 0),
    CHECK (actual_upstream_points IS NULL OR actual_upstream_points >= 0),
    CHECK (jsonb_typeof(capability_snapshot) = 'object'),
    CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
    CHECK (status NOT IN ('QUEUED','RUNNING','COMPLETED') OR upstream_id IS NOT NULL),
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CHECK ((status = 'FAILED') = (failed_at IS NOT NULL)),
    CHECK (download_state NOT IN ('AVAILABLE','EXPIRED') OR status = 'COMPLETED'),
    CHECK (retention_expires_at IS NULL OR retention_evidence IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_video_tasks_upstream
    ON video_tasks (provider_scope, upstream_id) WHERE upstream_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_video_tasks_due
    ON video_tasks (next_check_at, id)
    WHERE status NOT IN ('COMPLETED','FAILED');
CREATE INDEX IF NOT EXISTS ix_video_tasks_lease
    ON video_tasks (lease_until) WHERE lease_owner IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_video_tasks_owner
    ON video_tasks (user_id, api_key_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_video_tasks_user
    ON video_tasks (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_video_tasks_account_active
    ON video_tasks (account_id, status, id)
    WHERE status NOT IN ('COMPLETED','FAILED');
CREATE INDEX IF NOT EXISTS ix_video_tasks_expiry
    ON video_tasks (retention_expires_at)
    WHERE status = 'COMPLETED' AND download_state <> 'EXPIRED';
CREATE INDEX IF NOT EXISTS ix_video_tasks_review
    ON video_tasks (updated_at, id) WHERE review_required = true;

CREATE TABLE IF NOT EXISTS video_financial_reservations (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL UNIQUE REFERENCES video_tasks(id) ON DELETE RESTRICT,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
    funding_source VARCHAR(20) NOT NULL
        CHECK (funding_source IN ('wallet','subscription')),
    subscription_id BIGINT NULL REFERENCES user_subscriptions(id) ON DELETE RESTRICT,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
    amount NUMERIC(20,8) NOT NULL CHECK (amount >= 0),
    captured_amount NUMERIC(20,8) NOT NULL DEFAULT 0,
    state VARCHAR(20) NOT NULL DEFAULT 'HELD'
        CHECK (state IN ('HELD','CAPTURED','RELEASED')),
    pricing_snapshot_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ NULL,
    FOREIGN KEY (task_id, user_id, api_key_id)
        REFERENCES video_tasks(id, user_id, api_key_id) ON DELETE RESTRICT,
    CHECK ((funding_source = 'subscription') = (subscription_id IS NOT NULL)),
    CHECK (captured_amount >= 0 AND captured_amount <= amount),
    CHECK (state = 'CAPTURED' OR captured_amount = 0),
    CHECK ((state = 'HELD') = (finalized_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_video_funding_held_user
    ON video_financial_reservations (user_id, id) WHERE state = 'HELD';
CREATE INDEX IF NOT EXISTS ix_video_funding_held_subscription
    ON video_financial_reservations (subscription_id) WHERE state = 'HELD';

CREATE TABLE IF NOT EXISTS video_quota_reservations (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
    scope_type VARCHAR(32) NOT NULL CHECK (scope_type IN
        ('key_total','key_windows','subscription','user_platform','account')),
    scope_key VARCHAR(180) NOT NULL,
    amount NUMERIC(20,8) NOT NULL CHECK (amount >= 0),
    state VARCHAR(20) NOT NULL DEFAULT 'HELD'
        CHECK (state IN ('HELD','CONSUMED','RELEASED')),
    snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ NULL,
    UNIQUE (task_id, scope_type, scope_key),
    CHECK ((state = 'HELD') = (finalized_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_video_quota_scope_held
    ON video_quota_reservations (scope_type, scope_key, task_id)
    WHERE state = 'HELD';

-- 平台视频已用量单独从该账本聚合，不写入旧Redis快照覆盖的usage列。
CREATE INDEX IF NOT EXISTS ix_video_quota_scope_consumed
    ON video_quota_reservations (scope_type, scope_key, finalized_at)
    WHERE state = 'CONSUMED';

CREATE TABLE IF NOT EXISTS video_billing_events (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
    operation VARCHAR(20) NOT NULL CHECK (operation IN ('CAPTURE','RELEASE','CACHE_HOLD','CACHE_FINAL')),
    request_id VARCHAR(64) NOT NULL UNIQUE,
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    payload_hash CHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','RETRY','APPLIED','REVIEW')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error_code VARCHAR(80) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at TIMESTAMPTZ NULL,
    UNIQUE (task_id, operation),
    CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_video_billing_due
    ON video_billing_events (next_attempt_at, id) WHERE status IN ('PENDING','RETRY');

CREATE TABLE IF NOT EXISTS video_task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
    event_key VARCHAR(120) NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    task_version BIGINT NOT NULL CHECK (task_version >= 0),
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('system','user','admin')),
    actor_id BIGINT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_video_task_events_task
    ON video_task_events (task_id, id);
CREATE OR REPLACE FUNCTION guard_koko_video_task_update()
RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
    -- 归属、请求与价格一旦可靠接收就不再改写。
    IF ROW(NEW.public_id, NEW.provider, NEW.user_id, NEW.api_key_id,
           NEW.group_id, NEW.channel_id, NEW.account_id, NEW.provider_scope,
           NEW.requested_model, NEW.channel_mapped_model, NEW.upstream_model,
           NEW.client_idempotency_key, NEW.upstream_idempotency_key,
           NEW.request_hash, NEW.request_ciphertext, NEW.request_cipher_version,
           NEW.capability_snapshot, NEW.pricing_snapshot, NEW.pricing_snapshot_hash,
           NEW.quoted_upstream_points)
       IS DISTINCT FROM
       ROW(OLD.public_id, OLD.provider, OLD.user_id, OLD.api_key_id,
           OLD.group_id, OLD.channel_id, OLD.account_id, OLD.provider_scope,
           OLD.requested_model, OLD.channel_mapped_model, OLD.upstream_model,
           OLD.client_idempotency_key, OLD.upstream_idempotency_key,
           OLD.request_hash, OLD.request_ciphertext, OLD.request_cipher_version,
           OLD.capability_snapshot, OLD.pricing_snapshot, OLD.pricing_snapshot_hash,
           OLD.quoted_upstream_points) THEN
        RAISE EXCEPTION '视频任务的不可变快照不能修改';
    END IF;
    IF OLD.status IN ('COMPLETED','FAILED') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION '视频任务终态不能回退';
    END IF;
    -- 原上游ID只允许首次写入，后续更正必须经人工补偿流程。
    IF OLD.upstream_id IS NOT NULL AND NEW.upstream_id IS DISTINCT FROM OLD.upstream_id THEN
        RAISE EXCEPTION '视频任务的上游绑定不能替换';
    END IF;
    RETURN NEW;
END;
$guard$;

DO $install$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_guard_koko_video_task_update'
          AND tgrelid = 'video_tasks'::regclass
    ) THEN
        CREATE TRIGGER trg_guard_koko_video_task_update
        BEFORE UPDATE ON video_tasks
        FOR EACH ROW EXECUTE FUNCTION guard_koko_video_task_update();
    END IF;
END;
$install$;


CREATE INDEX IF NOT EXISTS ix_video_tasks_account_history ON video_tasks(account_id);
