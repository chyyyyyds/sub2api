package service

import (
	"context"
	"encoding/json"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestVideoStudioProtocolUsesLiveParameters(t *testing.T) {
	m := KokoVideoModel{ID: "oo-sd25-1080p", Durations: []int{30}, Resolutions: []string{"1080p"}, Ratios: []string{"4:3", "16:9"}, Images: KokoMediaCapability{Supported: true, Max: 9}, Audios: KokoMediaCapability{Supported: true, Max: 3}}
	applyVideoProtocol(&m)
	require.Equal(t, []string{"reference"}, m.Modes)
	require.NotNil(t, m.RequiresImage)
	require.False(t, *m.RequiresImage)
	require.Equal(t, []string{"4:3", "16:9"}, m.Ratios)
	require.Equal(t, 9, m.Images.Max)
	require.False(t, VideoModelInitiallyEnabled("pp-sd25-stable"))
	require.True(t, videoModelEnabled(nil, m.ID))
	require.False(t, videoModelEnabled(&Account{Extra: map[string]any{"video_enabled_models": []any{}}}, m.ID))
	require.False(t, videoModelEnabled(&Account{Extra: map[string]any{"video_enabled_models": []any{"pp-sd25-stable"}}}, "pp-sd25-stable"))
}

func TestVideoStudioSlowSubmissionContract(t *testing.T) {
	a := kokoTestAccount()
	a.Platform = PlatformVideo
	delete(a.Credentials, "openai_capabilities")
	require.NoError(t, ValidateKokoAccountConfiguration(a))
	require.True(t, a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo))
	p := NewKokoVideoProvider()
	p.Client.Transport = kokoTestTransport(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		require.True(t, ok)
		if req.Method == http.MethodPost {
			// 不真实等待十分钟，验证收费请求的时限能完整覆盖高峰期慢响应。
			require.Greater(t, time.Until(deadline), 599*time.Second)
			require.Equal(t, "video_studio_stable_key", req.Header.Get("Idempotency-Key"))
			var body map[string]any
			require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
			require.Equal(t, "1080p", body["resolution"])
			require.Equal(t, "4:3", body["ratio"])
			require.NotContains(t, body, "mode")
			require.Equal(t, float64(30), body["duration"])
			return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"original_task","status":"running"}`))}, nil
		}
		require.Less(t, time.Until(deadline), 61*time.Second)
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"original_task","status":"completed"}`))}, nil
	})
	_, e := p.Submit(context.Background(), a, VideoCreateRequest{Model: "oo-sd25-1080p", Prompt: "中文画面", Duration: 30, Ratio: "4:3", Resolution: "1080p", Mode: "reference", Count: 1}, "video_studio_stable_key")
	require.NoError(t, e)
	_, e = p.Query(context.Background(), a, "original_task")
	require.NoError(t, e)
}
