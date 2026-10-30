package middleware

import "testing"

func TestKokoReadBillingExemptionIsNarrow(t *testing.T) {
	for _, test := range []struct {
		method, path string
		allowed      bool
	}{{"GET", "/v1/videos", true}, {"GET", "/v1/video-models", true}, {"HEAD", "/v1/videos/vtsk_123/content", true}, {"GET", "/v1/videos/grok_existing", false}, {"GET", "/v1/videos/generations/grok_existing", false}, {"POST", "/v1/videos", false}, {"GET", "/v1/chat/completions", false}, {"DELETE", "/v1/videos/vtsk_123", false}} {
		if isKokoVideoTaskRead(test.method, test.path) != test.allowed {
			t.Errorf("unexpected billing exemption: %s %s", test.method, test.path)
		}
	}
}
