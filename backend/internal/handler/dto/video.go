package dto

import "github.com/Wei-Shaw/sub2api/internal/service"

// VideoUserPricingSnapshot 只展示用户结算价格，不暴露账号统计成本或上游积分。
type VideoUserPricingSnapshot struct {
	// BasePrice 创建时美元基价。
	BasePrice string `json:"base_price"`
	// GroupMultiplier 创建时用户分组倍率。
	GroupMultiplier string `json:"group_multiplier"`
	// Charge 实际结算美元金额。
	Charge string `json:"charge"`
	// Currency 结算币种。
	Currency string `json:"currency"`
	// Duration 视频秒数。
	Duration int `json:"duration"`
	// Resolution 分辨率原值。
	Resolution string `json:"resolution"`
	// Tier 命中的参数档。
	Tier string `json:"tier"`
}

func videoUserPrice(p *service.VideoPriceSnapshot) *VideoUserPricingSnapshot {
	if p == nil {
		return nil
	}
	return &VideoUserPricingSnapshot{BasePrice: p.BasePrice, GroupMultiplier: p.Multiplier, Charge: p.Charge, Currency: p.Currency, Duration: p.Duration, Resolution: p.Resolution, Tier: p.Tier}
}
