package service

import (
	"encoding/json"
	"errors"
)

// videoDecimalPricing 仅改变资金值的读取类型，匹配顺序仍复用现有 Group 定价解析器。
type videoDecimalPricing struct {
	Models      []string     `json:"models"`
	BillingMode BillingMode  `json:"billing_mode"`
	Price       *json.Number `json:"per_request_price"`
	Intervals   []struct {
		Label string       `json:"tier_label"`
		Price *json.Number `json:"per_request_price"`
	} `json:"intervals"`
}

// ResolveKokoConfiguredPrice 只接受明确的按次配置，禁止回落到 token 价格或上游积分。
func ResolveKokoConfiguredPrice(raw []byte, model, tier string) (string, bool, error) {
	var entries []videoDecimalPricing
	if len(raw) == 0 {
		return "", false, nil
	}
	if e := json.Unmarshal(raw, &entries); e != nil {
		return "", false, e
	}
	cards := make([]ChannelModelPricing, len(entries))
	for i, entry := range entries {
		cards[i] = ChannelModelPricing{ID: int64(i + 1), Models: entry.Models, BillingMode: entry.BillingMode}
	}
	matched := matchGroupModelPricing(&Group{ModelPricing: cards}, model)
	if matched == nil {
		return "", false, nil
	}
	entry := entries[matched.ID-1]
	if entry.BillingMode != BillingModeVideo && entry.BillingMode != BillingModePerRequest {
		return "", true, errors.New("VIDEO_PRICE_MODE_REQUIRED")
	}
	price := entry.Price
	found := false
	for _, interval := range entry.Intervals {
		if interval.Label == tier {
			if found {
				return "", true, errors.New("VIDEO_PRICE_TIER_AMBIGUOUS")
			}
			found = true
			price = interval.Price
		}
	}
	if price == nil {
		return "", true, errors.New("VIDEO_PRICE_REQUIRED")
	}
	return price.String(), true, nil
}
