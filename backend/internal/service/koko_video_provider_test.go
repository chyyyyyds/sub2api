package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type kokoTestTransport func(*http.Request) (*http.Response, error)

func (f kokoTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func kokoTestAccount() *Account {
	return &Account{ID: 1, Platform: PlatformOpenAI, Type: AccountTypeAPIKey, Credentials: map[string]any{"api_key": "mock-only", "base_url": "https://pay.kokoai.online/openapi/v1", "openai_capabilities": []string{"koko_video"}}}
}
func kokoTestModel() KokoVideoModel {
	optional := false
	return KokoVideoModel{ID: "mock-video", Name: "Mock 视频", Type: "video", Enabled: true, MaxPromptLength: 20, Durations: []int{5, 15}, Ratios: []string{"16:9"}, Resolutions: []string{"768p"}, Modes: []string{"text-to-video", "reference"}, RequiresImage: &optional, Images: KokoMediaCapability{Supported: true, Max: 2}, DurationPrices: map[string]json.Number{"5": "20", "15": "40"}}
}
func TestKokoVideoCapabilities(t *testing.T) {
	cases := []struct {
		name   string
		change func(*KokoVideoModel, *VideoCreateRequest)
		want   string
	}{
		{"valid", func(*KokoVideoModel, *VideoCreateRequest) {}, ""},
		{"maintenance", func(m *KokoVideoModel, r *VideoCreateRequest) { m.Maintenance = true }, "VIDEO_MODEL_DISABLED"},
		{"disabled", func(m *KokoVideoModel, r *VideoCreateRequest) { m.Enabled = false }, "VIDEO_MODEL_DISABLED"},
		{"duration", func(m *KokoVideoModel, r *VideoCreateRequest) { r.Duration = 30 }, "INVALID_VIDEO_PARAMETERS"},
		{"resolution", func(m *KokoVideoModel, r *VideoCreateRequest) { r.Resolution = "720p" }, "INVALID_VIDEO_PARAMETERS"},
		{"unknown modes", func(m *KokoVideoModel, r *VideoCreateRequest) { m.Modes = nil }, "VIDEO_CAPABILITY_UNCONFIRMED"},
		{"unknown required image", func(m *KokoVideoModel, r *VideoCreateRequest) { m.RequiresImage = nil }, "VIDEO_CAPABILITY_UNCONFIRMED"},
		{"utf16", func(m *KokoVideoModel, r *VideoCreateRequest) { m.MaxPromptLength = 3; r.Prompt = "中文😀" }, "INVALID_PROMPT"},
		{"unlimited prompt", func(m *KokoVideoModel, r *VideoCreateRequest) {
			m.MaxPromptLength = 0
			r.Prompt = strings.Repeat("中文", 10000)
		}, ""},
		{"audio unsupported", func(m *KokoVideoModel, r *VideoCreateRequest) {
			r.Mode = "reference"
			r.Audios = []string{"https://cdn.example/a.mp3"}
		}, "INVALID_REFERENCE_MEDIA"},
		{"images too many", func(m *KokoVideoModel, r *VideoCreateRequest) {
			r.Mode = "reference"
			r.Images = []string{"https://a/a.png", "https://a/b.png", "https://a/c.png"}
		}, "INVALID_REFERENCE_MEDIA"},
		{"required image", func(m *KokoVideoModel, r *VideoCreateRequest) { yes := true; m.RequiresImage = &yes }, "REFERENCE_IMAGE_REQUIRED"},
		{"count", func(m *KokoVideoModel, r *VideoCreateRequest) { r.Count = 2 }, "INVALID_COUNT"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := kokoTestModel()
			req := VideoCreateRequest{Model: m.ID, Prompt: "中文画面", Duration: 5, Ratio: "16:9", Resolution: "768p", Mode: "text-to-video", Count: 1}
			c.change(&m, &req)
			e := ValidateKokoVideo(m, &req)
			if c.want == "" {
				require.NoError(t, e)
			} else {
				require.EqualError(t, e, c.want)
			}
		})
	}
}
func TestKokoProviderProtocol(t *testing.T) {
	calls := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		require.Equal(t, "Bearer mock-only", r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("Cookie"))
		switch r.URL.Path {
		case "/openapi/v1/models":
			io.WriteString(w, `{"data":[{"id":"wrong"}],"models":[{"id":"live","enabled":false,"maintenance":true,"max_prompt_length":0}]}`)
		case "/openapi/v1/account":
			io.WriteString(w, `{"user":{"id":"mock-subject","status":"active"},"balance":155,"currency":"points"}`)
		case "/openapi/v1/videos":
			require.Equal(t, "stable_key_123", r.Header.Get("Idempotency-Key"))
			w.WriteHeader(202)
			io.WriteString(w, `{"id":"upstream_mock","status":"running"}`)
		case "/openapi/v1/videos/upstream_mock":
			io.WriteString(w, `{"id":"upstream_mock","status":"completed","video_url":"https://cdn.dola.com/file"}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	target, _ := url.Parse(server.URL)
	p := NewKokoVideoProvider()
	transport := server.Client().Transport
	p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
		clone := req.Clone(req.Context())
		clone.URL.Host = target.Host
		return transport.RoundTrip(clone)
	})
	a := kokoTestAccount()
	models, e := p.Models(context.Background(), a)
	require.NoError(t, e)
	require.Len(t, models, 1)
	require.True(t, models[0].Maintenance)
	require.Nil(t, models[0].RequiresImage)
	status, e := p.Account(context.Background(), a)
	require.NoError(t, e)
	require.Equal(t, "155", status.Balance)
	raw, _ := json.Marshal(status)
	require.NotContains(t, string(raw), "mock-subject")
	result, e := p.Submit(context.Background(), a, VideoCreateRequest{Model: "mock"}, "stable_key_123")
	require.NoError(t, e)
	require.Equal(t, "upstream_mock", result.ID)
	result, e = p.Query(context.Background(), a, result.ID)
	require.NoError(t, e)
	require.Equal(t, "completed", result.Status)
	_, e = p.Query(context.Background(), a, "../other")
	require.Error(t, e)
	require.Equal(t, 4, calls)
}
func TestKokoSubmissionUncertainty(t *testing.T) {
	for _, c := range []struct {
		status   int
		body     string
		rejected bool
	}{{200, `{"status":"running"}`, false}, {401, `{"error":{"code":"INVALID_API_KEY"}}`, false}, {403, `{}`, false}, {429, `{}`, false}, {500, `{}`, false}, {503, `{"error":{"code":"MODEL_MAINTENANCE"}}`, true}, {400, `{"error":{"code":"INVALID_DURATION"}}`, true}} {
		p := NewKokoVideoProvider()
		p.Client.Transport = kokoTestTransport(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: c.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(c.body))}, nil
		})
		_, e := p.Submit(context.Background(), kokoTestAccount(), VideoCreateRequest{}, "stable_mock_key")
		var pe *KokoProviderError
		require.ErrorAs(t, e, &pe)
		require.Equal(t, c.rejected, pe.Rejected)
	}
}
func TestVideoDownloadSecurity(t *testing.T) {
	for _, host := range []string{"https://evil.example/a", "http://pay.kokoai.online/a", "https://pay.kokoai.online.evil/a", "https://user:pass@pay.kokoai.online/a", "https://cdn.dola.com:444/a", "https://127.0.0.1/a"} {
		u, _ := url.Parse(host)
		require.False(t, validVideoDownloadURL(u), host)
	}
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "100.65.138.78", "169.254.169.254", "::1", "::ffff:127.0.0.1", "192.168.1.1", "fc00::1"} {
		require.False(t, publicVideoIP(netip.MustParseAddr(ip)), ip)
	}
	require.True(t, publicVideoIP(netip.MustParseAddr("8.8.8.8")))
	res := &http.Response{StatusCode: 206, Header: http.Header{"Content-Type": []string{"video/mp4"}, "Content-Range": []string{"bytes 0-3/10"}, "Set-Cookie": []string{"secret"}, "Location": []string{"https://secret"}}, Body: io.NopCloser(strings.NewReader("mock"))}
	w := httptest.NewRecorder()
	require.NoError(t, StreamVideoContent(w, res, "vtsk_mock", "GET"))
	require.Equal(t, 206, w.Code)
	require.Equal(t, "mock", w.Body.String())
	require.Empty(t, w.Header().Get("Set-Cookie"))
	require.Empty(t, w.Header().Get("Location"))
}

// 预算阶段尚未发送 HTTP，明确未受理可安全释放，不能与 POST 后超时混淆。
func TestKokoBudgetFailureHasNoUpstreamAcceptance(t *testing.T) {
	p := NewKokoVideoProvider()
	called := false
	p.BeforeRequest = func(context.Context, *Account) error { return context.DeadlineExceeded }
	p.Client.Transport = kokoTestTransport(func(*http.Request) (*http.Response, error) { called = true; return nil, context.DeadlineExceeded })
	_, err := p.Submit(context.Background(), kokoTestAccount(), VideoCreateRequest{Model: "mock"}, "vtsk_mock_submit")
	var providerErr *KokoProviderError
	require.ErrorAs(t, err, &providerErr)
	require.True(t, providerErr.Rejected)
	require.False(t, called)
}
