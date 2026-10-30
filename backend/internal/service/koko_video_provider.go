package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf16"
)

const OpenAIEndpointCapabilityKokoVideo OpenAIEndpointCapability = "koko_video"

// ValidateKokoAccountConfiguration 校验显式 KOKO 账号，其他供应商保持原有行为。
func ValidateKokoAccountConfiguration(a *Account) error {
	if a == nil {
		return nil
	}
	configured, _ := a.openAIEndpointCapabilitySet()
	if a.Platform != PlatformVideo && !configured["koko_video"] {
		return nil
	}
	base, e := url.Parse(strings.TrimRight(a.GetCredential("base_url"), "/"))
	if (a.Platform != PlatformVideo && a.Platform != PlatformOpenAI) || a.Type != AccountTypeAPIKey || a.ParentAccountID != nil || a.GetCredential("api_key") == "" || (a.Platform != PlatformVideo && len(configured) != 1) || e != nil || base.Scheme != "https" || base.Host == "" || base.Path != "/openapi/v1" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return infraerrors.BadRequest("KOKO_ACCOUNT_CONFIGURATION_INVALID", "视频创作必须使用独立 API Key 账号、HTTPS 和完整 /openapi/v1 地址")
	}
	if a.Extra == nil {
		a.Extra = map[string]any{}
	}
	a.Extra["video_provider"] = "koko"
	return nil
}

// KokoMediaCapability 为上游目录声明的参考素材能力。
type KokoMediaCapability struct {
	// Supported 是否支持该种素材。
	Supported bool `json:"supported"`
	// Max 素材数量上限。
	Max int `json:"max"`
	// Formats 上游明确支持的格式。
	Formats []string `json:"formats"`
}

// KokoVideoModel 保存实时能力；缺失模式不能从模型名称推断。
type KokoVideoModel struct {
	// IntegrationSupported 是否已实现该模型的创作协议，未接入项只供管理员查看。
	IntegrationSupported bool `json:"integration_supported"`
	// StudioEnabled 是否已在此账号开放创作。
	StudioEnabled bool `json:"studio_enabled"`
	// ID 实际上游模型标识。
	ID string `json:"id"`
	// Name 模型显示名称。
	Name string `json:"name"`
	// Type 模型类型。
	Type string `json:"type"`
	// Enabled 上游是否启用。
	Enabled bool `json:"enabled"`
	// Maintenance 上游是否处于维护状态。
	Maintenance bool `json:"maintenance"`
	// MaxPromptLength 提示词 UTF-16 单元上限，0 表示不限。
	MaxPromptLength int `json:"max_prompt_length"`
	// Duration 上游默认时长。
	Duration int `json:"duration"`
	// Durations 支持的秒数。
	Durations []int `json:"durations"`
	// Ratios 支持的宽高比。
	Ratios []string `json:"ratio"`
	// Resolutions 支持的分辨率原值。
	Resolutions []string `json:"resolutions"`
	// Images 参考图片能力。
	Images KokoMediaCapability `json:"reference_images"`
	// Audios 参考音频能力。
	Audios KokoMediaCapability `json:"reference_audios"`
	// DurationPrices 上游各时长积分，绝不作为美元价格。
	DurationPrices map[string]json.Number `json:"duration_prices"`
	// Modes 仅接受实时目录或管理员已核实合同声明的模式。
	Modes []string `json:"modes,omitempty"`
	// RequiresImage 图片必需规则；未知时为 null。
	RequiresImage *bool `json:"requires_image"`
	// EvidenceSource 实时能力和管理员合同的来源说明。
	EvidenceSource string `json:"evidence_source,omitempty"`
}

// VideoCreateRequest 为规范视频请求，不允许一次提交多个视频。
type VideoCreateRequest struct {
	// PricingUpstreamModel 仅供服务端定价解析，不接受或输出 JSON。
	PricingUpstreamModel string `json:"-" swaggerignore:"true"`
	// Model 用户请求的模型名称。
	Model string `json:"model" binding:"required" example:"oo-sd25-1080p"`
	// Prompt 中文或其他语言的提示词。
	Prompt string `json:"prompt" binding:"required" example:"一只小狗在草地上奔跑"`
	// Duration 视频秒数。
	Duration int `json:"duration" example:"30"`
	// Ratio 宽高比。
	Ratio string `json:"ratio" example:"16:9"`
	// Resolution 分辨率，以目录原值为准。
	Resolution string `json:"resolution" example:"1080p"`
	// Mode 经过能力核实的生成模式。
	Mode string `json:"mode,omitempty" example:"reference"`
	// Count 一次只允许一个视频。
	Count int `json:"count" example:"1"`
	// Images HTTPS 或 data URL 图片参考素材。
	Images []string `json:"image_urls,omitempty"`
	// Audios HTTPS 或 data URL 音频参考素材。
	Audios []string `json:"audio_urls,omitempty"`
}

// KokoAccountStatus 仅向管理员返回状态与积分，不包含身份和凭据。
type KokoAccountStatus struct {
	// Status 上游账号状态。
	Status string `json:"status"`
	// Balance 上游积分余额，十进制字符串。
	Balance string `json:"balance"`
	// Currency 积分单位。
	Currency      string `json:"currency"`
	ScopeIdentity string `json:"-"`
}

// KokoTaskResult 是私有上游响应，禁止直接作为用户 API 输出。
type KokoTaskResult struct {
	ID             string      `json:"id"`
	Status         string      `json:"status"`
	Model          string      `json:"model"`
	VideoURL       string      `json:"video_url"`
	Points         json.Number `json:"points"`
	ExpiresAt      *string     `json:"retention_expires_at"`
	Prompt         string      `json:"prompt"`
	PromptComplete bool        `json:"prompt_complete"`
}

// KokoProviderError 明确区分确定拒绝与可能已经受理。
type KokoProviderError struct {
	Code       string
	Rejected   bool
	HTTPStatus int
}

func (e *KokoProviderError) Error() string { return e.Code }

type KokoVideoProvider struct {
	Client        *http.Client
	Upstream      HTTPUpstream
	BeforeRequest func(context.Context, *Account) error
}

var newKokoVideoHTTPClient = NewVideoSafeClient

func NewKokoVideoProvider() *KokoVideoProvider {
	return &KokoVideoProvider{Client: newKokoVideoHTTPClient()}
}

var videoSegment = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)
var VideoIdempotencyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,100}$`)

func (p *KokoVideoProvider) request(ctx context.Context, a *Account, method, path string, body any, key string, result any) error {
	// 高峰提交可能超过一百秒；只有收费提交放宽到十分钟，查询仍限制一分钟。
	timeout := 60 * time.Second
	if method == http.MethodPost {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if a == nil || !a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo) {
		return errors.New("KOKO_ACCOUNT_REQUIRED")
	}
	if p.BeforeRequest != nil {
		if e := p.BeforeRequest(ctx, a); e != nil {
			return &KokoProviderError{Code: "KOKO_REQUEST_BUDGET_WAIT", Rejected: true}
		}
	}
	base, err := url.Parse(strings.TrimRight(a.GetCredential("base_url"), "/"))
	if err != nil || base.User != nil || base.RawQuery != "" || base.Fragment != "" || base.Path != "/openapi/v1" || base.Scheme != "https" {
		return errors.New("KOKO_BASE_URL_INVALID")
	}
	var payload io.Reader
	if body != nil {
		raw, e := json.Marshal(body)
		if e != nil {
			return e
		}
		payload = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, base.String()+path, payload)
	if err != nil {
		return errors.New("KOKO_REQUEST_INVALID")
	}
	req.Header.Set("Authorization", "Bearer "+a.GetCredential("api_key"))
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	var res *http.Response
	if a.ProxyID != nil {
		res, err = p.proxyRequest(req, a)
	} else {
		res, err = p.Client.Do(req)
	}
	if err != nil {
		return &KokoProviderError{Code: "KOKO_TRANSPORT_UNKNOWN"}
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var failure struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&failure)
		// 只有合同明确声明未受理的业务码允许解冻，网关错误与鉴权错误均留待核对。
		rejected := slices.Contains([]string{"INVALID_JSON", "MODEL_NOT_SUPPORTED", "INVALID_PROMPT", "INVALID_DURATION", "INVALID_RATIO", "INVALID_RESOLUTION", "INVALID_MODE", "INVALID_COUNT", "INVALID_IDEMPOTENCY_KEY", "INVALID_REFERENCE_MEDIA", "CHARGE_REJECTED", "INSUFFICIENT_POINTS", "MODEL_MAINTENANCE"}, failure.Error.Code)
		return &KokoProviderError{Code: "KOKO_HTTP_ERROR", Rejected: rejected, HTTPStatus: res.StatusCode}
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(result); err != nil {
		return &KokoProviderError{Code: "KOKO_RESPONSE_UNKNOWN"}
	}
	return nil
}

// proxyRequest 复用原账号代理与 HTTP 池；关闭重定向，内容请求仍由调用方逐跳剥离凭据。
func (p *KokoVideoProvider) proxyRequest(req *http.Request, a *Account) (*http.Response, error) {
	if p.Upstream == nil || a.Proxy == nil || !a.Proxy.IsActive() || a.Proxy.IsExpired(time.Now()) {
		return nil, errors.New("KOKO_PROXY_UNAVAILABLE")
	}
	if e := validateVideoPublicHost(req.Context(), req.URL.Hostname()); e != nil {
		return nil, e
	}
	req = req.WithContext(WithHTTPUpstreamRedirectsDisabled(WithHTTPUpstreamPublicHostsOnly(req.Context())))
	return p.Upstream.Do(req, a.Proxy.URL(), a.ID, a.Concurrency)
}

func (p *KokoVideoProvider) Models(ctx context.Context, a *Account) ([]KokoVideoModel, error) {
	var response struct {
		Models []KokoVideoModel `json:"models"`
	}
	if err := p.request(ctx, a, http.MethodGet, "/models", nil, "", &response); err != nil {
		return nil, err
	}
	if response.Models == nil {
		return nil, errors.New("KOKO_CAPABILITIES_MISSING")
	}
	return response.Models, nil
}
func (p *KokoVideoProvider) Account(ctx context.Context, a *Account) (*KokoAccountStatus, error) {
	var response struct {
		Balance  json.Number `json:"balance"`
		Currency string      `json:"currency"`
		User     struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"user"`
	}
	if err := p.request(ctx, a, http.MethodGet, "/account", nil, "", &response); err != nil {
		return nil, err
	}
	if response.User.ID == "" || response.Balance == "" {
		return nil, errors.New("KOKO_ACCOUNT_RESPONSE_INVALID")
	}
	return &KokoAccountStatus{Status: response.User.Status, Balance: string(response.Balance), Currency: response.Currency, ScopeIdentity: response.User.ID}, nil
}
func (p *KokoVideoProvider) Submit(ctx context.Context, a *Account, req VideoCreateRequest, key string) (*KokoTaskResult, error) {
	if !VideoIdempotencyPattern.MatchString(key) {
		return nil, errors.New("INVALID_IDEMPOTENCY_KEY")
	}
	var result KokoTaskResult
	// mode 是本站的工作台参数；上游公开协议只接收素材、时长和画面参数。
	payload := map[string]any{"model": req.Model, "prompt": req.Prompt, "duration": req.Duration, "ratio": req.Ratio, "resolution": req.Resolution, "count": req.Count, "image_urls": req.Images, "audio_urls": req.Audios}
	if err := p.request(ctx, a, http.MethodPost, "/videos", payload, key, &result); err != nil {
		return nil, err
	}
	if !videoSegment.MatchString(result.ID) {
		return nil, &KokoProviderError{Code: "KOKO_SUBMISSION_NO_ID"}
	}
	return &result, nil
}
func (p *KokoVideoProvider) Query(ctx context.Context, a *Account, id string) (*KokoTaskResult, error) {
	if !videoSegment.MatchString(id) {
		return nil, errors.New("INVALID_UPSTREAM_TASK_ID")
	}
	var result KokoTaskResult
	if err := p.request(ctx, a, http.MethodGet, "/videos/"+url.PathEscape(id), nil, "", &result); err != nil {
		return nil, err
	}
	if result.ID != id {
		return nil, errors.New("KOKO_TASK_ID_MISMATCH")
	}
	return &result, nil
}

func ValidateKokoVideo(m KokoVideoModel, r *VideoCreateRequest) error {
	if len(m.ID) > 100 || len(r.Model) > 100 {
		return errors.New("VIDEO_MODEL_ID_TOO_LONG")
	}
	if m.MaxPromptLength < 0 || r.Duration <= 0 {
		return errors.New("VIDEO_CAPABILITY_INVALID")
	}
	if !m.Enabled || m.Maintenance || m.Type != "video" {
		return errors.New("VIDEO_MODEL_DISABLED")
	}
	r.Prompt = strings.TrimSpace(r.Prompt)
	if r.Prompt == "" || (m.MaxPromptLength > 0 && len(utf16.Encode([]rune(r.Prompt))) > m.MaxPromptLength) {
		return errors.New("INVALID_PROMPT")
	}
	if !slices.Contains(m.Durations, r.Duration) || !slices.Contains(m.Ratios, r.Ratio) || !slices.Contains(m.Resolutions, r.Resolution) {
		return errors.New("INVALID_VIDEO_PARAMETERS")
	}
	if r.Count == 0 {
		r.Count = 1
	}
	if r.Count != 1 {
		return errors.New("INVALID_COUNT")
	}
	if len(m.Modes) == 0 || m.RequiresImage == nil {
		return errors.New("VIDEO_CAPABILITY_UNCONFIRMED")
	}
	if !slices.Contains(m.Modes, r.Mode) {
		return errors.New("INVALID_MODE")
	}
	if *m.RequiresImage && len(r.Images) == 0 {
		return errors.New("REFERENCE_IMAGE_REQUIRED")
	}
	for _, media := range []struct {
		Values     []string
		Capability KokoMediaCapability
		Kind       string
	}{{r.Images, m.Images, "image"}, {r.Audios, m.Audios, "audio"}} {
		if len(media.Values) > 0 && (!media.Capability.Supported || len(media.Values) > media.Capability.Max || r.Mode != "reference") {
			return errors.New("INVALID_REFERENCE_MEDIA")
		}
		for _, value := range media.Values {
			u, e := url.Parse(value)
			if e != nil || (u.Scheme != "https" && !strings.HasPrefix(value, "data:"+media.Kind+"/")) || u.User != nil {
				return fmt.Errorf("INVALID_REFERENCE_%s", strings.ToUpper(media.Kind))
			}
			if u.Scheme == "https" && u.Hostname() == "" {
				return errors.New("INVALID_REFERENCE_MEDIA")
			}
			if strings.HasPrefix(value, "data:") {
				// 本地素材逐个流式校验，遵守上游 50MB 限制且不额外分配完整解码副本。
				header, data, ok := strings.Cut(value, ",")
				format := map[string]string{"data:image/jpeg;base64": "jpeg", "data:image/png;base64": "png", "data:image/webp;base64": "webp", "data:audio/mpeg;base64": "mp3", "data:audio/wav;base64": "wav", "data:audio/mp4;base64": "m4a", "data:audio/aac;base64": "aac", "data:audio/flac;base64": "flac"}[header]
				if !ok || format == "" || (len(media.Capability.Formats) > 0 && !slices.Contains(media.Capability.Formats, format)) {
					return errors.New("INVALID_REFERENCE_MEDIA")
				}
				n, err := io.Copy(io.Discard, io.LimitReader(base64.NewDecoder(base64.StdEncoding, strings.NewReader(data)), 50*1024*1024+1))
				if err != nil || n == 0 || n > 50*1024*1024 {
					return errors.New("INVALID_REFERENCE_MEDIA")
				}
			}
		}
	}
	return nil
}
