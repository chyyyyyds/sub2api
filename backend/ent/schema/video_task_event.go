package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoTaskEvent 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoTaskEvent struct{ ent.Schema }

func (VideoTaskEvent) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_task_events"}}
}
func (VideoTaskEvent) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("task_id").Comment("视频持久化字段：task_id"),
		field.String("event_key").Comment("视频持久化字段：event_key"),
		field.String("event_type").Comment("视频持久化字段：event_type"),
		field.Int64("task_version").Comment("视频持久化字段：task_version"),
		field.JSON("payload", json.RawMessage{}).Comment("视频持久化字段：payload"),
		field.String("actor_type").Comment("视频持久化字段：actor_type"),
		field.Int64("actor_id").Optional().Comment("视频持久化字段：actor_id"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
	}
}
