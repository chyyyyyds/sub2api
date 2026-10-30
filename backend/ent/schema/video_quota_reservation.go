package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoQuotaReservation 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoQuotaReservation struct{ ent.Schema }

func (VideoQuotaReservation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_quota_reservations"}}
}
func (VideoQuotaReservation) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("task_id").Comment("视频持久化字段：task_id"),
		field.String("scope_type").Comment("视频持久化字段：scope_type"),
		field.String("scope_key").Comment("视频持久化字段：scope_key"),
		field.String("amount").SchemaType(map[string]string{dialect.Postgres: "numeric(20,8)"}).Comment("视频持久化字段：amount"),
		field.String("state").Comment("视频持久化字段：state"),
		field.JSON("snapshot", json.RawMessage{}).Comment("视频持久化字段：snapshot"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
		field.Time("finalized_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：finalized_at"),
	}
}
