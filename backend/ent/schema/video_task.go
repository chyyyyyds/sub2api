package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoTask 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoTask struct{ ent.Schema }

func (VideoTask) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_tasks"}}
}
func (VideoTask) Fields() []ent.Field {
	return []ent.Field{
		field.String("public_id").Comment("视频持久化字段：public_id"),
		field.String("provider").Comment("视频持久化字段：provider"),
		field.Int64("user_id").Comment("视频持久化字段：user_id"),
		field.Int64("api_key_id").Comment("视频持久化字段：api_key_id"),
		field.Int64("group_id").Comment("视频持久化字段：group_id"),
		field.Int64("channel_id").Optional().Comment("视频持久化字段：channel_id"),
		field.Int64("account_id").Comment("视频持久化字段：account_id"),
		field.String("provider_scope").Comment("视频持久化字段：provider_scope"),
		field.String("requested_model").Comment("视频持久化字段：requested_model"),
		field.String("channel_mapped_model").Comment("视频持久化字段：channel_mapped_model"),
		field.String("upstream_model").Comment("视频持久化字段：upstream_model"),
		field.String("client_idempotency_key").Comment("视频持久化字段：client_idempotency_key"),
		field.String("upstream_idempotency_key").Comment("视频持久化字段：upstream_idempotency_key"),
		field.String("request_hash").Comment("视频持久化字段：request_hash"),
		field.Bytes("request_ciphertext").Comment("视频持久化字段：request_ciphertext"),
		field.Int64("request_cipher_version").Comment("视频持久化字段：request_cipher_version"),
		field.JSON("capability_snapshot", json.RawMessage{}).Comment("视频持久化字段：capability_snapshot"),
		field.JSON("pricing_snapshot", json.RawMessage{}).Comment("视频持久化字段：pricing_snapshot"),
		field.String("pricing_snapshot_hash").Comment("视频持久化字段：pricing_snapshot_hash"),
		field.String("quoted_upstream_points").SchemaType(map[string]string{dialect.Postgres: "numeric(20,8)"}).Optional().Comment("视频持久化字段：quoted_upstream_points"),
		field.String("actual_upstream_points").SchemaType(map[string]string{dialect.Postgres: "numeric(20,8)"}).Optional().Comment("视频持久化字段：actual_upstream_points"),
		field.String("upstream_refund_state").Comment("视频持久化字段：upstream_refund_state"),
		field.String("upstream_id").Optional().Comment("视频持久化字段：upstream_id"),
		field.String("status").Comment("视频持久化字段：status"),
		field.String("upstream_status").Optional().Comment("视频持久化字段：upstream_status"),
		field.String("previous_active_status").Optional().Comment("视频持久化字段：previous_active_status"),
		field.String("download_state").Comment("视频持久化字段：download_state"),
		field.Time("retention_expires_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：retention_expires_at"),
		field.JSON("retention_evidence", json.RawMessage{}).Optional().Comment("视频持久化字段：retention_evidence"),
		field.Time("upstream_completed_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：upstream_completed_at"),
		field.Time("last_content_checked_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：last_content_checked_at"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
		field.Time("updated_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：updated_at"),
		field.Time("submitted_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：submitted_at"),
		field.Time("started_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：started_at"),
		field.Time("completed_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：completed_at"),
		field.Time("failed_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：failed_at"),
		field.Time("last_checked_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：last_checked_at"),
		field.Time("next_check_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：next_check_at"),
		field.Bool("review_required").Comment("视频持久化字段：review_required"),
		field.String("last_error_code").Optional().Comment("视频持久化字段：last_error_code"),
		field.String("upstream_request_id").Optional().Comment("视频持久化字段：upstream_request_id"),
		field.Int64("submit_attempts").Comment("视频持久化字段：submit_attempts"),
		field.Int64("poll_attempts").Comment("视频持久化字段：poll_attempts"),
		field.Int64("consecutive_errors").Comment("视频持久化字段：consecutive_errors"),
		field.String("lease_owner").Optional().Comment("视频持久化字段：lease_owner"),
		field.Time("lease_until").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：lease_until"),
		field.Int64("lease_epoch").Comment("视频持久化字段：lease_epoch"),
		field.Int64("row_version").Comment("视频持久化字段：row_version"),
	}
}
