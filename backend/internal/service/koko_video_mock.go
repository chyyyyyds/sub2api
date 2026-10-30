//go:build kokomock

package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
)

// 此文件只编入显式 kokomock 验收二进制，正式镜像绝不包含 Mock transport。
type kokoMockTransport struct{}

func init() {
	newKokoVideoHTTPClient = func() *http.Client { return &http.Client{Transport: kokoMockTransport{}} }
}
func init() {
	newVideoContentHTTPClient = func() *http.Client {
		return &http.Client{Transport: kokoMockContentTransport{}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
}

type kokoMockContentTransport struct{}

func (kokoMockContentTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	for _, header := range []string{"Authorization", "Cookie", "X-Api-Key", "Referer"} {
		if req.Header.Get(header) != "" {
			return nil, &KokoProviderError{Code: "MOCK_CDN_CREDENTIAL_LEAK_BLOCKED"}
		}
	}
	res := &http.Response{StatusCode: 200, Header: make(http.Header), Request: req}
	if req.URL.Host == "mock.dola.com" {
		res.StatusCode = 307
		res.Header.Set("Location", "https://edge.douyinvod.com/mock.mp4")
		res.Body = io.NopCloser(strings.NewReader(""))
		return res, nil
	}
	if req.URL.Host != "edge.douyinvod.com" {
		return nil, &KokoProviderError{Code: "MOCK_REAL_NETWORK_BLOCKED"}
	}
	// 固定内存协议夹具，仅用于 Range/HEAD 下载验收，不代表真实可播放成片。
	data := []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'i', 's', 'o', 'm', 'm', 'p', '4', '2', 0, 0, 0, 8, 'm', 'd', 'a', 't'}
	total := len(data)
	res.Header.Set("Content-Type", "video/mp4")
	res.Header.Set("Accept-Ranges", "bytes")
	res.Header.Set("ETag", `"koko-mock-v1"`)
	if span := req.Header.Get("Range"); span != "" && (req.Header.Get("If-Range") == "" || req.Header.Get("If-Range") == `"koko-mock-v1"`) {
		parts := strings.Split(strings.TrimPrefix(span, "bytes="), "-")
		start, end := 0, total-1
		valid := len(parts) == 2
		if valid {
			var e error
			start, e = strconv.Atoi(parts[0])
			valid = e == nil
			if parts[1] != "" {
				end, e = strconv.Atoi(parts[1])
				valid = valid && e == nil
			}
			valid = valid && start >= 0 && start < total && end >= start
			if end >= total {
				end = total - 1
			}
		}
		if !valid {
			res.StatusCode = 416
			res.Header.Set("Content-Range", "bytes */"+strconv.Itoa(total))
			data = nil
		} else {
			res.StatusCode = 206
			res.Header.Set("Content-Range", "bytes "+strconv.Itoa(start)+"-"+strconv.Itoa(end)+"/"+strconv.Itoa(total))
			data = data[start : end+1]
		}
	}
	res.Header.Set("Content-Length", strconv.Itoa(len(data)))
	if req.Method == "HEAD" {
		data = nil
	}
	res.Body = io.NopCloser(strings.NewReader(string(data)))
	return res, nil
}
func (kokoMockTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	status := 200
	var payload any
	// 隔离验收只接受固定假域名和假凭据，任何真实供应商请求一律拒绝。
	if req.URL.Host != "koko.mock.invalid" || req.Header.Get("Authorization") != "Bearer koko_mock_local_only" {
		return nil, &KokoProviderError{Code: "MOCK_REAL_NETWORK_BLOCKED"}
	}
	switch {
	case req.URL.Path == "/openapi/v1/account":
		payload = map[string]any{"user": map[string]any{"id": "koko-mock-user", "status": "active"}, "balance": 10000, "currency": "points"}
	case req.URL.Path == "/openapi/v1/models":
		optional := false
		payload = map[string]any{"models": []KokoVideoModel{{ID: "mock-koko-video", Name: "Mock KOKO 视频", Type: "video", Enabled: true, MaxPromptLength: 10000, Durations: []int{5, 15, 30}, Ratios: []string{"16:9", "9:16", "1:1"}, Resolutions: []string{"768p", "1080p"}, Modes: []string{"text-to-video", "reference"}, RequiresImage: &optional, Images: KokoMediaCapability{Supported: true, Max: 9}, DurationPrices: map[string]json.Number{"5": "20", "15": "20", "30": "40"}}, {ID: "mock-maintenance", Name: "Mock 维护模型", Type: "video", Enabled: false, Maintenance: true}}}
	case req.URL.Path == "/openapi/v1/videos" && req.Method == "POST":
		var input VideoCreateRequest
		_ = json.NewDecoder(req.Body).Decode(&input)
		sum := sha256.Sum256([]byte(req.Header.Get("Idempotency-Key")))
		id := "mock_success_" + hex.EncodeToString(sum[:8])
		if strings.Contains(input.Prompt, "失败") {
			id = "mock_failed_" + hex.EncodeToString(sum[:8])
		}
		status = 202
		payload = map[string]any{"id": id, "status": "running", "model": input.Model, "points": 20}
	case strings.HasPrefix(req.URL.Path, "/openapi/v1/videos/"):
		id := strings.TrimPrefix(req.URL.Path, "/openapi/v1/videos/")
		state := "completed"
		if strings.HasPrefix(id, "mock_failed_") {
			state = "failed"
		}
		payload = map[string]any{"id": id, "status": state, "model": "mock-koko-video", "points": 20, "video_url": "https://mock.dola.com/video.mp4"}
	default:
		status = 404
		payload = map[string]any{"error": map[string]string{"code": "NOT_FOUND"}}
	}
	raw, _ := json.Marshal(payload)
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(string(raw))), Request: req}, nil
}
