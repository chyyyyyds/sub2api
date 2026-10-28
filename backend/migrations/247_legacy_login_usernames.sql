-- 原登录名独立于可编辑的展示昵称；只有经过迁移确认的旧用户名才获得登录能力。
CREATE TABLE IF NOT EXISTS legacy_login_usernames (
    username VARCHAR(100) PRIMARY KEY CHECK (length(username) > 0),
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    source_system VARCHAR(32) NOT NULL,
    source_user_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_system, source_user_id)
);

COMMENT ON TABLE legacy_login_usernames IS '迁移确认的旧用户名登录标识，不随展示昵称变更';
