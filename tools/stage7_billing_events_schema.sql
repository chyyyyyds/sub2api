-- 仅供全新隔离数据库验证，不在应用迁移目录，不会在 Stage7 或生产自动执行。
CREATE TABLE stage7_billing_events (
  id bigserial PRIMARY KEY,
  request_id text NOT NULL,
  api_key_id bigint NOT NULL,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  UNIQUE(request_id,api_key_id)
);
CREATE INDEX stage7_billing_events_pending ON stage7_billing_events(next_attempt_at,id) WHERE status='pending';
