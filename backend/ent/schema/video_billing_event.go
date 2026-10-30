package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoBillingEvent 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoBillingEvent struct{ ent.Schema }

func (VideoBillingEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_billing_events"}}
}
func (VideoBillingEvent) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("task_id").Comment("视频持久化字段：task_id"),
		field.String("operation").Comment("视频持久化字段：operation"),
		field.String("request_id").Comment("视频持久化字段：request_id"),
		field.JSON("payload", json.RawMessage{}).Comment("视频持久化字段：payload"),
		field.String("payload_hash").Comment("视频持久化字段：payload_hash"),
		field.String("status").Comment("视频持久化字段：status"),
		field.Int64("attempts").Comment("视频持久化字段：attempts"),
		field.Time("next_attempt_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：next_attempt_at"),
		field.String("last_error_code").Optional().Comment("视频持久化字段：last_error_code"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
		field.Time("applied_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：applied_at"),
	}
}
