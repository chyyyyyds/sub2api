package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

// hydrateKokoUsage 仅补充 KOKO 行的新元数据，保持旧扫描器和各旧平台查询形状不变。
func (r *usageLogRepository) hydrateKokoUsage(ctx context.Context, logs []service.UsageLog) error {
	for i := range logs {
		log := &logs[i]
		if !strings.HasPrefix(log.RequestID, "video:cap:vtsk_") {
			continue
		}
		rows, e := r.sql.QueryContext(ctx, `SELECT media_type,video_task_id,video_pricing_snapshot FROM usage_logs WHERE id=$1`, log.ID)
		if e != nil {
			return e
		}
		var media, task sql.NullString
		var raw []byte
		if rows.Next() {
			e = rows.Scan(&media, &task, &raw)
		}
		if e == nil {
			e = rows.Err()
		}
		_ = rows.Close()
		if e != nil {
			return e
		}
		if media.Valid {
			log.MediaType = &media.String
		}
		if task.Valid {
			log.VideoTaskID = &task.String
		}
		if len(raw) > 0 {
			var price service.VideoPriceSnapshot
			if e = json.Unmarshal(raw, &price); e != nil {
				return e
			}
			log.VideoPricingSnapshot = &price
		}
	}
	return nil
}
