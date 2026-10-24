package service

import (
	"encoding/json"
	"math"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// ProcurementPriceSnapshot 是已人工核实账号、模型和有效期的采购基础价，不参与用户扣费。
type ProcurementPriceSnapshot struct {
	// AccountID 为已验证的上游账号，不按相同倍率猜测所属模型组。
	AccountID int64 `json:"account_id" example:"2"`
	// Model 为供应商实际计费模型，必须精确匹配。
	Model string `json:"model" example:"deepseek-v4.1-flash"`
	// Evidence 为价格与认证倍率的核验凭据标识，不包含密钥。
	Evidence string `json:"evidence" example:"vendor-window-20261024"`
	// ValidFrom 为证据适用起点，不能用今天的价格无条件重算历史。
	ValidFrom time.Time `json:"valid_from"`
	// ValidUntil 为证据适用终点，区间右端不包含。
	ValidUntil time.Time `json:"valid_until"`
	// EffectiveRate 为该账号 Key 认证生效倍率，只乘一次；nil 表示未知。
	EffectiveRate *float64 `json:"effective_rate" example:"0.12"`
	// Pricing 来自渠道 pricing，单位 USD/Token；不接收 official_pricing 作为采购价。
	Pricing *ChannelModelPricing `json:"pricing"`
}

// ProcurementCostResult 将供应商实付、可信估算与未知成本分开，金额使用十进制字符串。
type ProcurementCostResult struct {
	// Status 为 confirmed、estimate 或 unknown。
	Status string `json:"status" example:"estimate"`
	// CostUSD 为采购金额；未知时必须为 null。
	CostUSD *decimal.Decimal `json:"cost_usd" swaggertype:"string" example:"0.00001284"`
	// Evidence 为此次计算实际采用的证据标识。
	Evidence string `json:"evidence"`
	// Reason 为未知或拒绝估算的原因，不含凭据。
	Reason string `json:"reason,omitempty"`
}

// ParseProcurementModel 只解析模型实际渠道 pricing，官方参考价故意不进入结构。
func ParseProcurementModel(raw []byte) (*ChannelModelPricing, error) {
	var model struct {
		Pricing *ChannelModelPricing `json:"pricing"`
	}
	if err := json.Unmarshal(raw, &model); err != nil {
		return nil, err
	}
	return model.Pricing, nil
}

// EstimateProcurementCost 不读取下游分组售价，也不再次乘账号统计倍率。
// confirmedCost 仅允许调用方提供已确认供应商账单；本函数不伪造账单归属。
func EstimateProcurementCost(accountID int64, model string, at time.Time, tokens UsageTokens, snapshot *ProcurementPriceSnapshot, confirmedCost *decimal.Decimal, statementEvidence string) ProcurementCostResult {
	unknown := func(reason string) ProcurementCostResult {
		return ProcurementCostResult{Status: "unknown", Reason: reason}
	}
	if confirmedCost != nil {
		if confirmedCost.IsNegative() || strings.TrimSpace(statementEvidence) == "" {
			return unknown("invalid_supplier_statement")
		}
		cost := *confirmedCost
		return ProcurementCostResult{Status: "confirmed", CostUSD: &cost, Evidence: statementEvidence}
	}
	if snapshot == nil || snapshot.AccountID != accountID || snapshot.Model != model || strings.TrimSpace(snapshot.Evidence) == "" {
		return unknown("unverified_price_scope")
	}
	if at.IsZero() || snapshot.ValidFrom.IsZero() || !snapshot.ValidUntil.After(snapshot.ValidFrom) || at.Before(snapshot.ValidFrom) || !at.Before(snapshot.ValidUntil) {
		return unknown("price_outside_verified_window")
	}
	if snapshot.EffectiveRate == nil || !finiteNonnegative(*snapshot.EffectiveRate) {
		return unknown("missing_or_invalid_effective_rate")
	}
	p := snapshot.Pricing
	if p == nil || (p.BillingMode != "" && p.BillingMode != BillingModeToken) || p.TimePricing != nil {
		return unknown("unsupported_or_missing_channel_price")
	}
	counts := []int{tokens.InputTokens, tokens.OutputTokens, tokens.CacheCreationTokens, tokens.CacheReadTokens, tokens.CacheCreation5mTokens, tokens.CacheCreation1hTokens, tokens.ImageOutputTokens}
	for _, n := range counts {
		if n < 0 {
			return unknown("invalid_usage")
		}
	}
	if tokens.InputTokens == 0 && tokens.OutputTokens == 0 && tokens.CacheCreationTokens == 0 && tokens.CacheReadTokens == 0 && tokens.ImageOutputTokens == 0 {
		return unknown("usage_not_confirmed")
	}
	// 采用供应商区间契约 (min,max]；多重匹配或缺口一律未知，不回落短上下文价。
	if len(p.Intervals) > 0 {
		total := int64(tokens.InputTokens) + int64(tokens.OutputTokens) + int64(tokens.CacheReadTokens) + int64(tokens.CacheCreationTokens)
		var match *PricingInterval
		for i := range p.Intervals {
			iv := &p.Intervals[i]
			if iv.MinTokens < 0 || (iv.MaxTokens != nil && *iv.MaxTokens <= iv.MinTokens) {
				return unknown("invalid_price_interval")
			}
			if (total > int64(iv.MinTokens) || total == 0 && iv.MinTokens == 0) && (iv.MaxTokens == nil || total <= int64(*iv.MaxTokens)) {
				if match != nil {
					return unknown("ambiguous_price_interval")
				}
				match = iv
			}
		}
		if match == nil {
			return unknown("missing_price_interval")
		}
		if match.InputMultiplier != nil || match.OutputMultiplier != nil || match.CacheWriteMultiplier != nil || match.CacheReadMultiplier != nil {
			return unknown("unresolved_interval_multiplier")
		}
		p = &ChannelModelPricing{InputPrice: match.InputPrice, OutputPrice: match.OutputPrice, CacheReadPrice: match.CacheReadPrice, CacheWritePrice: match.CacheWritePrice, CacheWrite1hPrice: match.CacheWrite1hPrice, ImageOutputPrice: p.ImageOutputPrice}
	}
	if tokens.CacheCreation5mTokens+tokens.CacheCreation1hTokens > tokens.CacheCreationTokens {
		return unknown("inconsistent_cache_usage")
	}
	cache1h := tokens.CacheCreation1hTokens
	cache5m := tokens.CacheCreationTokens - cache1h
	items := []struct {
		n     int
		price *float64
	}{{tokens.InputTokens, p.InputPrice}, {tokens.OutputTokens, p.OutputPrice}, {tokens.CacheReadTokens, p.CacheReadPrice}, {cache5m, p.CacheWritePrice}, {cache1h, p.CacheWrite1hPrice}, {tokens.ImageOutputTokens, p.ImageOutputPrice}}
	cost := decimal.Zero
	for _, item := range items {
		if item.price != nil && !finiteNonnegative(*item.price) {
			return unknown("invalid_channel_price")
		}
		if item.n == 0 {
			continue
		}
		if item.price == nil {
			return unknown("missing_consumed_token_price")
		}
		cost = cost.Add(decimal.NewFromInt(int64(item.n)).Mul(decimal.NewFromFloat(*item.price)))
	}
	// 不提前舍入；账务八位量化仍由原资金代码负责。
	cost = cost.Mul(decimal.NewFromFloat(*snapshot.EffectiveRate))
	return ProcurementCostResult{Status: "estimate", CostUSD: &cost, Evidence: snapshot.Evidence}
}

func finiteNonnegative(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 }
