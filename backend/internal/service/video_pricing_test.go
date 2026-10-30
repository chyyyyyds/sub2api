package service

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestKokoPricingUsesExplicitDecimalAndExistingMatchOrder(t *testing.T) {
	raw := []byte(`[{"models":["mock-*"],"billing_mode":"video","per_request_price":12},{"models":["mock-video"],"billing_mode":"video","per_request_price":8,"intervals":[{"tier_label":"duration=15;resolution=768p;mode=reference","per_request_price":9.123456789}]}]`)
	price, matched, e := ResolveKokoConfiguredPrice(raw, "mock-video", "duration=15;resolution=768p;mode=reference")
	require.NoError(t, e)
	require.True(t, matched)
	require.Equal(t, "9.123456789", price)
	price, matched, e = ResolveKokoConfiguredPrice(raw, "mock-video", "other")
	require.NoError(t, e)
	require.True(t, matched)
	require.Equal(t, "8", price)
	_, matched, e = ResolveKokoConfiguredPrice(raw, "missing", "other")
	require.NoError(t, e)
	require.False(t, matched)
	price, matched, e = ResolveKokoConfiguredPrice([]byte(`[{"models":["mock"],"billing_mode":"video","per_request_price":0}]`), "mock", "")
	require.NoError(t, e)
	require.True(t, matched)
	require.Equal(t, "0", price)
	_, _, e = ResolveKokoConfiguredPrice([]byte(`[{"models":["mock"],"billing_mode":"token","input_price":8}]`), "mock", "")
	require.EqualError(t, e, "VIDEO_PRICE_MODE_REQUIRED")
}
