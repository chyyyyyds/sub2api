package schema

import (
	"encoding/json"
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoProviderModel 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoProviderModel struct{ ent.Schema }

func (VideoProviderModel) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_provider_models"}}
}
func (VideoProviderModel) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("account_id").Comment("视频持久化字段：account_id"),
		field.String("provider").Comment("视频持久化字段：provider"),
		field.String("model_id").Comment("视频持久化字段：model_id"),
		field.String("display_name").Comment("视频持久化字段：display_name"),
		field.Bool("enabled").Comment("视频持久化字段：enabled"),
		field.Bool("maintenance").Comment("视频持久化字段：maintenance"),
		field.JSON("capability", json.RawMessage{}).Comment("视频持久化字段：capability"),
		field.JSON("evidence", json.RawMessage{}).Comment("视频持久化字段：evidence"),
		field.String("capability_hash").Comment("视频持久化字段：capability_hash"),
		field.Int64("contract_version").Comment("视频持久化字段：contract_version"),
		field.Time("observed_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：observed_at"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
		field.Time("updated_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：updated_at"),
	}
}
