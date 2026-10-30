package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema"
	"entgo.io/ent/schema/field"
)

// VideoFinancialReservation 对应 C1 设计的视频持久化表；外键和围栏约束由 SQL 迁移维护。
type VideoFinancialReservation struct{ ent.Schema }

func (VideoFinancialReservation) Annotations() []schema.Annotation {
	return []schema.Annotation{entsql.Annotation{Table: "video_financial_reservations"}}
}
func (VideoFinancialReservation) Fields() []ent.Field {
	return []ent.Field{
		field.Int64("task_id").Comment("视频持久化字段：task_id"),
		field.Int64("user_id").Comment("视频持久化字段：user_id"),
		field.Int64("api_key_id").Comment("视频持久化字段：api_key_id"),
		field.String("funding_source").Comment("视频持久化字段：funding_source"),
		field.Int64("subscription_id").Optional().Comment("视频持久化字段：subscription_id"),
		field.String("currency").Comment("视频持久化字段：currency"),
		field.String("amount").SchemaType(map[string]string{dialect.Postgres: "numeric(20,8)"}).Comment("视频持久化字段：amount"),
		field.String("captured_amount").SchemaType(map[string]string{dialect.Postgres: "numeric(20,8)"}).Comment("视频持久化字段：captured_amount"),
		field.String("state").Comment("视频持久化字段：state"),
		field.String("pricing_snapshot_hash").Comment("视频持久化字段：pricing_snapshot_hash"),
		field.Time("created_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Comment("视频持久化字段：created_at"),
		field.Time("finalized_at").SchemaType(map[string]string{dialect.Postgres: "timestamptz"}).Optional().Comment("视频持久化字段：finalized_at"),
	}
}
