package service

import (
	"context"
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"
)

func TestStage7R2EProcurementHistorical(t *testing.T) {
	for _, tc := range []struct {
		name, model, input, output, cache, want string
		account                                 int64
		rate                                    float64
		tokens                                  UsageTokens
	}{
		{"DeepSeek43+16", "deepseek-v4.1-flash", "0.000001", "0.000004", "0.00000002", "0.00001284", 2, 0.12, UsageTokens{InputTokens: 43, OutputTokens: 16}},
		{"GPT账号1", "gpt-6-sol", "0.000002", "0.00001", "0.0000002", "0.000142571", 1, 0.065, UsageTokens{InputTokens: 702, OutputTokens: 5, CacheReadTokens: 3697}},
		{"GPT账号3", "gpt-6-sol", "0.000002", "0.00001", "0.0000002", "0.000056016", 3, 0.045, UsageTokens{InputTokens: 175, OutputTokens: 5, CacheReadTokens: 4224}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := func(s string) *float64 { v := decimal.RequireFromString(s).InexactFloat64(); return &v }
			s := &ProcurementPriceSnapshot{AccountID: tc.account, Model: tc.model, Evidence: "R2D-window", ValidFrom: time.Unix(1, 0), ValidUntil: time.Unix(100, 0), EffectiveRate: &tc.rate, Pricing: &ChannelModelPricing{InputPrice: p(tc.input), OutputPrice: p(tc.output), CacheReadPrice: p(tc.cache)}}
			r := EstimateProcurementCost(tc.account, tc.model, time.Unix(50, 0), tc.tokens, s, nil, "")
			require.Equal(t, "estimate", r.Status)
			require.NotNil(t, r.CostUSD)
			require.True(t, decimal.RequireFromString(tc.want).Equal(*r.CostUSD), r.CostUSD.String())
			// 不传本地下游分组倍率，不会重复乘 0.12 或将售价作为采购价。
		})
	}
}

func TestStage7R2EProcurementSourceAndUnknown(t *testing.T) {
	p, err := ParseProcurementModel([]byte(`{"pricing":{"input_price":0.000001,"output_price":0.000004},"official_pricing":{"input_price":0.00000015,"output_price":0.0000006}}`))
	require.NoError(t, err)
	require.Equal(t, 0.000001, *p.InputPrice)
	base := ProcurementPriceSnapshot{AccountID: 2, Model: "model", Evidence: "verified", ValidFrom: time.Unix(1, 0), ValidUntil: time.Unix(100, 0), EffectiveRate: testPtrFloat64(0.12), Pricing: p}
	for _, tc := range []struct {
		name   string
		change func(*ProcurementPriceSnapshot)
		tokens UsageTokens
	}{
		{"缺倍率", func(s *ProcurementPriceSnapshot) { s.EffectiveRate = nil }, UsageTokens{InputTokens: 1}},
		{"负倍率", func(s *ProcurementPriceSnapshot) { s.EffectiveRate = testPtrFloat64(-1) }, UsageTokens{InputTokens: 1}},
		{"无穷倍率", func(s *ProcurementPriceSnapshot) { s.EffectiveRate = testPtrFloat64(math.Inf(1)) }, UsageTokens{InputTokens: 1}},
		{"缺采购价", func(s *ProcurementPriceSnapshot) { s.Pricing = nil }, UsageTokens{InputTokens: 1}},
		{"缺缓存价", func(s *ProcurementPriceSnapshot) {}, UsageTokens{InputTokens: 1, CacheReadTokens: 1}},
		{"账号不符", func(s *ProcurementPriceSnapshot) { s.AccountID = 3 }, UsageTokens{InputTokens: 1}},
		{"模型不符", func(s *ProcurementPriceSnapshot) { s.Model = "other" }, UsageTokens{InputTokens: 1}},
		{"缺证据", func(s *ProcurementPriceSnapshot) { s.Evidence = "" }, UsageTokens{InputTokens: 1}},
		{"已过期", func(s *ProcurementPriceSnapshot) { s.ValidUntil = time.Unix(50, 0) }, UsageTokens{InputTokens: 1}},
		{"负用量", func(s *ProcurementPriceSnapshot) {}, UsageTokens{InputTokens: -1}},
		{"没有确认用量", func(s *ProcurementPriceSnapshot) {}, UsageTokens{}},
		{"缓存矛盾", func(s *ProcurementPriceSnapshot) {}, UsageTokens{CacheCreationTokens: 1, CacheCreation1hTokens: 2}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := base
			tc.change(&s)
			r := EstimateProcurementCost(2, "model", time.Unix(50, 0), tc.tokens, &s, nil, "")
			require.Equal(t, "unknown", r.Status)
			require.Nil(t, r.CostUSD)
			data, e := json.Marshal(r)
			require.NoError(t, e)
			require.Contains(t, string(data), `"cost_usd":null`)
		})
	}
	p, err = ParseProcurementModel([]byte(`{"official_pricing":{"input_price":1}}`))
	require.NoError(t, err)
	require.Nil(t, p)
}

func TestStage7R2EAccountStatsConfiguredProcurement(t *testing.T) {
	ctx := context.Background()
	channel := &Channel{ID: 1, Status: StatusActive, ApplyPricingToAccountStats: false}
	get := func() *float64 {
		return resolveAccountStatsCost(ctx, newTestChannelServiceForStats(t, channel, 8, PlatformDeepseek), newTestBillingService(), 2, 8, "deepseek-v4.1-flash", UsageTokens{InputTokens: 43, OutputTokens: 16}, 1, 9999, "", time.Date(2026, 10, 23, 18, 0, 0, 0, time.UTC), true)
	}
	old := get()
	require.NotNil(t, old)
	require.InDelta(t, 0.000001926, *old*0.12, 1e-15)
	// 使用现有独立采购统计规则，不能将下游定价开关打开或改用户收费公式。
	channel.AccountStatsPricingRules = []AccountStatsPricingRule{{AccountIDs: []int64{2}, Pricing: []ChannelModelPricing{{Models: []string{"deepseek-v4.1-flash"}, Platform: PlatformDeepseek, BillingMode: BillingModeToken, InputPrice: testPtrFloat64(1e-6), OutputPrice: testPtrFloat64(4e-6), CacheReadPrice: testPtrFloat64(2e-8)}}}}
	fixed := get()
	require.NotNil(t, fixed)
	require.InDelta(t, 0.00001284, *fixed*0.12, 1e-15)
	require.False(t, channel.ApplyPricingToAccountStats)
}

func TestStage7R2EProcurementTiersAndStatements(t *testing.T) {
	limit := 272000
	price := &ChannelModelPricing{Intervals: []PricingInterval{
		{MinTokens: 0, MaxTokens: &limit, InputPrice: testPtrFloat64(2e-6), OutputPrice: testPtrFloat64(1e-5), CacheReadPrice: testPtrFloat64(2e-7), CacheWritePrice: testPtrFloat64(2.5e-6), CacheWrite1hPrice: testPtrFloat64(2.5e-6)},
		{MinTokens: 272000, InputPrice: testPtrFloat64(4e-6), OutputPrice: testPtrFloat64(1.5e-5), CacheReadPrice: testPtrFloat64(4e-7), CacheWritePrice: testPtrFloat64(5e-6), CacheWrite1hPrice: testPtrFloat64(5e-6)},
	}}
	s := &ProcurementPriceSnapshot{AccountID: 1, Model: "gpt", Evidence: "verified", ValidFrom: time.Unix(1, 0), ValidUntil: time.Unix(100, 0), EffectiveRate: testPtrFloat64(0.065), Pricing: price}
	for _, tc := range []struct {
		name, want string
		tokens     UsageTokens
	}{
		{"短档边界", "0.03536", UsageTokens{InputTokens: 272000}},
		{"长档边界", "0.07072026", UsageTokens{InputTokens: 272001}},
		{"缓存5m与1h", "0.00004875", UsageTokens{CacheCreationTokens: 300, CacheCreation5mTokens: 100, CacheCreation1hTokens: 200}},
		{"长档缓存", "0.007072026", UsageTokens{CacheReadTokens: 272001}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := EstimateProcurementCost(1, "gpt", time.Unix(50, 0), tc.tokens, s, nil, "")
			require.Equal(t, "estimate", r.Status)
			require.True(t, decimal.RequireFromString(tc.want).Equal(*r.CostUSD), r.CostUSD.String())
		})
	}
	statement := decimal.RequireFromString("0.0002")
	r := EstimateProcurementCost(1, "gpt", time.Unix(50, 0), UsageTokens{InputTokens: 1}, s, &statement, "confirmed-window")
	require.Equal(t, "confirmed", r.Status)
	require.True(t, statement.Equal(*r.CostUSD))
	// 新价只在新证据窗口生效；不会反写历史 usage 或本地消费。
	s.ValidFrom = time.Unix(60, 0)
	require.Equal(t, "unknown", EstimateProcurementCost(1, "gpt", time.Unix(50, 0), UsageTokens{InputTokens: 1}, s, nil, "").Status)
}
