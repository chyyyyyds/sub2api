package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/Wei-Shaw/sub2api/internal/pkg/credentialcipher"
	"github.com/google/uuid"
)

type VideoService struct {
	sharedBudget  func(context.Context, string) error
	enabled       bool
	Repo          VideoRepository
	Accounts      AccountRepository
	Provider      *KokoVideoProvider
	cipher        *credentialcipher.Cipher
	secret        []byte
	billing       *BillingCacheService
	auth          APIKeyAuthCacheInvalidator
	now           func() time.Time
	cancel        context.CancelFunc
	done          chan struct{}
	once          sync.Once
	contentClient *http.Client
	rateMu        sync.Mutex
	accountScopes map[int64]string
	nextRequests  map[string]time.Time
}

func newVideoService(repo VideoRepository, accounts AccountRepository, cfg *config.Config, billing *BillingCacheService, auth APIKeyAuthCacheInvalidator, httpUpstream HTTPUpstream, budget func(context.Context, string) error) *VideoService {
	key := sha256.Sum256([]byte("sub2api:koko:request:v1:" + cfg.JWT.Secret))
	cipher, _ := credentialcipher.New("koko-v1", map[string][]byte{"koko-v1": key[:]})
	s := &VideoService{enabled: cfg.KokoVideoEnabled, Repo: repo, Accounts: accounts, Provider: NewKokoVideoProvider(), cipher: cipher, secret: key[:], billing: billing, auth: auth, now: time.Now, done: make(chan struct{})}
	s.Provider.Client.Timeout = 610 * time.Second
	s.contentClient = newVideoContentHTTPClient()
	s.Provider.Upstream = httpUpstream
	s.sharedBudget = budget
	s.Provider.BeforeRequest = s.throttle
	hasTasks, err := repo.HasTasks(context.Background())
	if s.enabled || hasTasks || err != nil {
		if keys, ok := auth.(*APIKeyService); ok {
			keys.videoQuota = repo
		}
		if billing != nil {
			billing.videoQuota = repo
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	go s.run(ctx)
	return s
}
func (s *VideoService) Stop() {
	if s == nil {
		return
	}
	s.once.Do(func() {
		s.cancel()
		<-s.done
		if s.Provider != nil && s.Provider.Client != nil {
			s.Provider.Client.CloseIdleConnections()
		}
		if s.contentClient != nil {
			s.contentClient.CloseIdleConnections()
		}
	})
}
func (s *VideoService) scope(identity string) string {
	m := hmac.New(sha256.New, s.secret)
	_, _ = m.Write([]byte(identity))
	return hex.EncodeToString(m.Sum(nil))
}
func (s *VideoService) rememberScope(account int64, scope string) {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	if s.accountScopes == nil {
		s.accountScopes = map[int64]string{}
	}
	s.accountScopes[account] = scope
}

// throttle 以原上游身份共享提交、查询、下载取址和管理员刷新预算。
func (s *VideoService) throttle(ctx context.Context, a *Account) error {
	s.rateMu.Lock()
	scope := s.accountScopes[a.ID]
	if scope == "" {
		scope = s.scope(a.GetCredential("api_key"))
	}
	s.rateMu.Unlock()
	if s.sharedBudget != nil {
		return s.sharedBudget(ctx, scope)
	}
	// 纯单元测试的无 Redis 实例保留本地预算；正式装配使用跨实例 Redis 原子预算。
	s.rateMu.Lock()
	if s.nextRequests == nil {
		s.nextRequests = map[string]time.Time{}
	}
	at := s.nextRequests[scope]
	if now := time.Now(); at.Before(now) {
		at = now
	}
	s.nextRequests[scope] = at.Add(time.Second)
	s.rateMu.Unlock()
	timer := time.NewTimer(time.Until(at))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// RefreshAccount 仅调用 GET /account、GET /models；不发送生成任务。
func (s *VideoService) RefreshAccount(ctx context.Context, id int64) (*KokoAccountStatus, []KokoVideoModel, error) {
	a, e := s.Accounts.GetByID(ctx, id)
	if e != nil {
		return nil, nil, e
	}
	account, e := s.Provider.Account(ctx, a)
	if e != nil {
		return nil, nil, e
	}
	s.rememberScope(a.ID, s.scope(account.ScopeIdentity))
	models, e := s.Provider.Models(ctx, a)
	if e != nil {
		return nil, nil, e
	}
	for i := range models {
		models[i].EvidenceSource = "GET /models"
		applyVideoProtocol(&models[i])
		_, models[i].IntegrationSupported = videoProtocolRegistry[models[i].ID]
		models[i].StudioEnabled = videoModelEnabled(a, models[i].ID)
	}
	// 模式缺失时只接受管理员保存的逐模型合同，不从旧插件或名称猜测。
	if raw, ok := a.Extra["koko_video_contracts"]; ok {
		var contracts map[string]struct {
			Modes         []string `json:"modes"`
			RequiresImage *bool    `json:"requires_image"`
			Evidence      string   `json:"evidence"`
		}
		b, _ := json.Marshal(raw)
		_ = json.Unmarshal(b, &contracts)
		for i := range models {
			if c, ok := contracts[models[i].ID]; ok && c.Evidence != "" {
				if len(models[i].Modes) == 0 {
					models[i].Modes = c.Modes
				}
				if models[i].RequiresImage == nil {
					models[i].RequiresImage = c.RequiresImage
				}
				models[i].EvidenceSource = "GET /models + 管理员已核实合同"
			}
		}
	}
	if e = s.Repo.SaveModels(ctx, id, s.scope(account.ScopeIdentity), models); e != nil {
		return nil, nil, e
	}
	return account, models, nil
}

func (s *VideoService) Initialize(ctx context.Context, req VideoInitializeRequest) (*VideoInitializeResult, error) {
	_, models, e := s.RefreshAccount(ctx, req.AccountID)
	if e != nil {
		return nil, e
	}
	a, e := s.Accounts.GetByID(ctx, req.AccountID)
	if e != nil {
		return nil, e
	}
	selected := make([]KokoVideoModel, 0, len(models))
	for _, model := range models {
		if videoModelEnabled(a, model.ID) {
			selected = append(selected, model)
		}
	}
	return s.Repo.Initialize(ctx, req, selected)
}

// VideoPublicModel 只向用户提供授权目录和参数，不含上游积分与账号标识。
type VideoPublicModel struct {
	// MaxPromptLength 提示词 UTF-16 单元上限，0 表示不限。
	MaxPromptLength int `json:"max_prompt_length"`
	// ID 用户可调用的模型。
	ID string `json:"id"`
	// Name 显示名称。
	Name string `json:"name"`
	// Durations 视频秒数列表。
	Durations []int `json:"durations"`
	// Ratios 比例列表。
	Ratios []string `json:"ratios"`
	// Resolutions 分辨率列表。
	Resolutions []string `json:"resolutions"`
	// Modes 已确认的模式。
	Modes []string `json:"modes"`
	// Images 参考图能力。
	Images KokoMediaCapability `json:"reference_images"`
	// Audios 参考音频能力。
	Audios KokoMediaCapability `json:"reference_audios"`
	// RequiresImage 是否必须提供参考图，未知时为 null。
	RequiresImage *bool `json:"requires_image"`
	// CreationEnabled 当前是否允许提交。
	CreationEnabled bool `json:"creation_enabled"`
	// Reason 未开放原因。
	Reason string `json:"reason"`
}

func (s *VideoService) Catalog(ctx context.Context, key *APIKey) ([]VideoPublicModel, error) {
	out := []VideoPublicModel{}
	if key == nil || key.GroupID == nil || key.Group == nil || key.Group.Platform != PlatformVideo {
		return out, nil
	}
	accounts, e := s.Accounts.ListByGroup(ctx, *key.GroupID)
	if e != nil {
		return nil, e
	}
	gate, e := s.Repo.GetGate(ctx, *key.GroupID)
	if e != nil {
		return nil, e
	}
	seen := map[string]bool{}
	for _, a := range accounts {
		if a.Status != StatusActive || !a.Schedulable || !a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo) {
			continue
		}
		// 工作台读取时同步实时目录；后续任务轮询只读本站记录，不反复拉取上游模型。
		_, models, e := s.RefreshAccount(ctx, a.ID)
		if e != nil {
			return nil, e
		}
		for _, m := range models {
			if !m.Enabled || m.Maintenance || m.Type != "video" || !videoModelEnabled(&a, m.ID) || seen[m.ID] {
				continue
			}
			if !(key.Group != nil && key.Group.ModelAllowlist.Allows(m.ID)) {
				continue
			}
			seen[m.ID] = true
			ready := len(m.Modes) > 0 && m.RequiresImage != nil && len(m.Durations) > 0 && len(m.Resolutions) > 0 && len(m.Ratios) > 0
			reason := ""
			if !ready {
				reason = "生成模式和必需素材规则待管理员核实"
			} else if !gate || !s.enabled {
				ready = false
				reason = "视频收费创建开关尚未开启"
			} else if key.Status != StatusAPIKeyActive || key.IsExpired() || key.IsQuotaExhausted() {
				ready = false
				reason = "该 Key 仅支持查看历史任务，不能新建视频"
			}
			out = append(out, VideoPublicModel{MaxPromptLength: m.MaxPromptLength, ID: m.ID, Name: m.Name, Durations: m.Durations, Ratios: m.Ratios, Resolutions: m.Resolutions, Modes: m.Modes, Images: m.Images, Audios: m.Audios, RequiresImage: m.RequiresImage, CreationEnabled: ready && s.enabled, Reason: reason})
		}
	}
	return out, nil
}

func (s *VideoService) IsModel(ctx context.Context, group int64, model string) bool {
	mapped, e := s.Repo.RouteModel(ctx, group, model)
	if e != nil {
		return false
	}
	accounts, e := s.Accounts.ListByGroup(ctx, group)
	if e != nil {
		return false
	}
	for _, a := range accounts {
		if !a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo) {
			continue
		}
		models, e := s.Repo.Models(ctx, a.ID)
		if e != nil {
			continue
		}
		for _, m := range models {
			if m.ID == a.GetMappedModel(mapped) {
				return true
			}
		}
	}
	return false
}

// VideoQuote 为用户显示的报价，不包含上游积分和账号统计成本。
type VideoQuote struct {
	// BasePrice 明确配置的美元基价。
	BasePrice string `json:"base_price"`
	// Multiplier 当前用户分组倍率。
	Multiplier string `json:"group_multiplier"`
	// Charge 本次预计冻结金额。
	Charge string `json:"charge"`
	// Currency 结算币种。
	Currency string `json:"currency"`
}

func (s *VideoService) Quote(ctx context.Context, key *APIKey, req VideoCreateRequest) (*VideoQuote, error) {
	if req.Mode == "" {
		req.Mode = "reference"
	}
	if key == nil || key.GroupID == nil || key.Group == nil || key.Group.Platform != PlatformVideo || !key.Group.ModelAllowlist.Allows(req.Model) {
		return nil, errors.New("VIDEO_MODEL_FORBIDDEN")
	}
	mapped, e := s.Repo.RouteModel(ctx, *key.GroupID, req.Model)
	if e != nil {
		return nil, e
	}
	accounts, e := s.Accounts.ListByGroup(ctx, *key.GroupID)
	if e != nil {
		return nil, e
	}
	for _, a := range accounts {
		if !a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo) || a.Status != StatusActive || !a.Schedulable {
			continue
		}
		models, e := s.Repo.Models(ctx, a.ID)
		if e != nil {
			return nil, e
		}
		for _, m := range models {
			if !videoModelEnabled(&a, m.ID) || m.ID != a.GetMappedModel(mapped) || !m.Enabled || m.Maintenance || req.Duration <= 0 || !slices.Contains(m.Durations, req.Duration) || !slices.Contains(m.Resolutions, req.Resolution) || (len(m.Modes) > 0 && !slices.Contains(m.Modes, req.Mode)) {
				continue
			}
			req.PricingUpstreamModel = m.ID
			price, _, e := s.Repo.Quote(ctx, *key.GroupID, key.UserID, req.Model, req)
			if e != nil {
				return nil, e
			}
			return &VideoQuote{BasePrice: price.BasePrice, Multiplier: price.Multiplier, Charge: price.Charge, Currency: price.Currency}, nil
		}
	}
	return nil, errors.New("VIDEO_MODEL_UNAVAILABLE")
}
func (s *VideoService) Create(ctx context.Context, key *APIKey, req VideoCreateRequest, idempotency string) (*VideoTask, error) {
	if key == nil || key.GroupID == nil || !VideoIdempotencyPattern.MatchString(idempotency) {
		return nil, errors.New("VIDEO_INVALID_REQUEST")
	}
	if key.Group == nil || key.Group.Platform != PlatformVideo {
		return nil, errors.New("VIDEO_PLATFORM_REQUIRED")
	}
	if req.Model == "oo-sd25-1080p" && req.Resolution != "1080p" {
		return nil, errors.New("INVALID_VIDEO_PARAMETERS")
	}
	if req.Mode == "" {
		req.Mode = "reference"
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Count == 0 {
		req.Count = 1
	}
	raw, _ := json.Marshal(req)
	hash := sha256.Sum256(raw)
	requestHash := hex.EncodeToString(hash[:])
	if existing, e := s.Repo.Replay(ctx, key.UserID, key.ID, *key.GroupID, idempotency, requestHash); e != nil {
		return nil, e
	} else if existing != nil {
		return existing, nil
	}
	if !s.enabled {
		return nil, errors.New("VIDEO_CREATION_DISABLED")
	}
	if !(key.Group != nil && key.Group.ModelAllowlist.Allows(req.Model)) {
		return nil, errors.New("VIDEO_MODEL_FORBIDDEN")
	}
	mapped, e := s.Repo.RouteModel(ctx, *key.GroupID, req.Model)
	if e != nil {
		return nil, e
	}
	accounts, e := s.Accounts.ListByGroup(ctx, *key.GroupID)
	if e != nil {
		return nil, e
	}
	var selected *Account
	var capability KokoVideoModel
	var scope string
	var validationError error
	for i := range accounts {
		a := &accounts[i]
		if a.Status != StatusActive || !a.Schedulable || !a.SupportsOpenAIEndpointCapability(OpenAIEndpointCapabilityKokoVideo) {
			continue
		}
		account, models, e := s.RefreshAccount(ctx, a.ID)
		if e != nil {
			continue
		}
		if account.Status != "active" {
			continue
		}
		for _, m := range models {
			if !videoModelEnabled(a, m.ID) || m.ID != a.GetMappedModel(mapped) {
				continue
			}
			candidate := req
			candidate.Model = m.ID
			if e = ValidateKokoVideo(m, &candidate); e != nil {
				validationError = e
				continue
			}
			selected = a
			capability = m
			scope = s.scope(account.ScopeIdentity)
			req.Prompt = candidate.Prompt
			req.Count = candidate.Count
			break
		}
		if selected != nil {
			break
		}
	}
	if selected == nil {
		if validationError != nil {
			return nil, validationError
		}
		return nil, errors.New("VIDEO_ACCOUNT_UNAVAILABLE")
	}
	req.PricingUpstreamModel = capability.ID
	price, channel, e := s.Repo.Quote(ctx, *key.GroupID, key.UserID, req.Model, req)
	if e != nil {
		return nil, e
	}
	actual := req
	actual.Model = capability.ID
	envelope, e := s.cipher.Encrypt(selected.ID, map[string]any{"request": actual})
	if e != nil {
		return nil, e
	}
	ciphertext, _ := json.Marshal(envelope)
	t := &VideoTaskRecord{PublicID: "vtsk_" + strings.ReplaceAll(uuid.NewString(), "-", ""), UserID: key.UserID, APIKeyID: key.ID, GroupID: *key.GroupID, ChannelID: channel, AccountID: selected.ID, Scope: scope, RequestedModel: req.Model, ChannelMappedModel: mapped, UpstreamModel: capability.ID, IdempotencyKey: idempotency, RequestHash: requestHash, Ciphertext: ciphertext, Capability: capability, Pricing: price}
	task, err := s.Repo.Create(ctx, t)
	if err == nil {
		// 冻结提交后立即失效共享余额/额度缓存，避免等待上游查询时旧聊天或图片读取冻结前余额。
		// 持久 CACHE_HOLD 事件仍保留，负责 Redis 故障后的可靠补偿；这里只做幂等失效，不增减余额。
		_ = s.invalidate(ctx, key.UserID, key.ID, *key.GroupID)
	}
	return task, err
}

// Reconcile 只验证并绑定已有原任务，永不重新发送收费 POST。
func (s *VideoService) Reconcile(ctx context.Context, id, upstreamID string, actor int64, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return errors.New("VIDEO_RECONCILIATION_REASON_REQUIRED")
	}
	t, e := s.Repo.Record(ctx, id)
	if e != nil {
		return e
	}
	if t.UpstreamID != "" {
		return errors.New("VIDEO_UPSTREAM_ALREADY_BOUND")
	}
	a, e := s.Accounts.GetByID(ctx, t.AccountID)
	if e != nil {
		return e
	}
	identity, e := s.Provider.Account(ctx, a)
	if e != nil || s.scope(identity.ScopeIdentity) != t.Scope {
		return errors.New("VIDEO_ACCOUNT_IDENTITY_REVIEW")
	}
	result, e := s.Provider.Query(ctx, a, upstreamID)
	if e != nil {
		return e
	}
	var envelope credentialcipher.Envelope
	if e = json.Unmarshal(t.Ciphertext, &envelope); e != nil {
		return e
	}
	fields, e := s.cipher.Decrypt(t.AccountID, &envelope)
	if e != nil {
		return e
	}
	raw, _ := json.Marshal(fields["request"])
	var request VideoCreateRequest
	if e = json.Unmarshal(raw, &request); e != nil {
		return e
	}
	if !result.PromptComplete || result.Prompt != request.Prompt || result.Model != t.UpstreamModel {
		return errors.New("VIDEO_UPSTREAM_EVIDENCE_MISMATCH")
	}
	return s.Repo.Reconcile(ctx, id, upstreamID, actor, reason)
}

func (s *VideoService) run(ctx context.Context) {
	defer close(s.done)
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	owner := uuid.NewString()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// 单次 HTTP 生命周期短于租约；生成总耗时不设一小时超时。
			for i := 0; i < 20; i++ {
				if ctx.Err() != nil {
					return
				}
				task, e := s.Repo.Claim(ctx, owner, s.now())
				if e != nil {
					break
				}
				s.process(ctx, task)
			}
			for i := 0; i < 20; i++ {
				ok, _ := s.Repo.SettleNext(ctx)
				if !ok {
					break
				}
			}
			for i := 0; i < 20; i++ {
				ok, e := s.Repo.CacheNext(ctx, s.invalidate)
				if !ok || e != nil {
					break
				}
			}
		}
	}
}
func (s *VideoService) invalidate(ctx context.Context, user, key, group int64) error {
	if s.billing != nil {
		if e := s.billing.InvalidateUserBalance(ctx, user); e != nil {
			return e
		}
		if e := s.billing.InvalidateAPIKeyRateLimit(ctx, key); e != nil {
			return e
		}
		if e := s.billing.InvalidateSubscription(ctx, user, group); e != nil {
			return e
		}
	}
	if s.auth != nil {
		s.auth.InvalidateAuthCacheByUserID(ctx, user)
	}
	return nil
}
func (s *VideoService) process(ctx context.Context, t *VideoTaskRecord) {
	// 提交加身份校验必须短于数据库租约，避免慢响应期间被其他实例抢走。
	opCtx, cancel := context.WithTimeout(ctx, 690*time.Second)
	defer cancel()
	// 仅首次租约且尚未进入提交时，能证明本次没有发送收费请求。
	firstUnsent := t.UpstreamID == "" && t.Status == "SUBMITTING" && t.LeaseEpoch == 1
	s.rememberScope(t.AccountID, t.Scope)
	account, e := s.Accounts.GetByID(opCtx, t.AccountID)
	if e != nil {
		_ = s.Repo.Observe(ctx, t, nil, "KOKO_ORIGINAL_ACCOUNT_UNAVAILABLE", firstUnsent, s.now())
		return
	}
	// 停用只阻止新创建，原任务继续使用原账号读取；上游身份必须仍相同。
	upstream, e := s.Provider.Account(opCtx, account)
	if e != nil || s.scope(upstream.ScopeIdentity) != t.Scope {
		_ = s.Repo.Observe(ctx, t, nil, "KOKO_ACCOUNT_IDENTITY_REVIEW", firstUnsent, s.now())
		return
	}
	var result *KokoTaskResult
	postAttempted := false
	if t.UpstreamID != "" {
		result, e = s.Provider.Query(opCtx, account, t.UpstreamID)
	} else if t.Status == "SUBMITTING" && t.LeaseEpoch == 1 {
		var envelope credentialcipher.Envelope
		e = json.Unmarshal(t.Ciphertext, &envelope)
		var fields map[string]any
		if e == nil {
			fields, e = s.cipher.Decrypt(t.AccountID, &envelope)
		}
		if e == nil {
			var req VideoCreateRequest
			raw, _ := json.Marshal(fields["request"])
			e = json.Unmarshal(raw, &req)
			if e == nil {
				postAttempted = true
				result, e = s.Provider.Submit(opCtx, account, req, t.PublicID)
			}
		}
	} else {
		e = errors.New("KOKO_SUBMISSION_REQUIRES_RECONCILIATION")
	}
	code := ""
	rejected := firstUnsent && !postAttempted && e != nil
	if e != nil {
		code = "KOKO_QUERY_RETRY"
		var pe *KokoProviderError
		if errors.As(e, &pe) {
			rejected = rejected || (pe.Rejected && t.UpstreamID == "")
			code = pe.Code
		}
	}
	_ = s.Repo.Observe(ctx, t, result, code, rejected, s.now())
}
