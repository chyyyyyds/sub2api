package service

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// VideoTask 是可公开的持久任务视图；不含上游 ID、凭据、素材及签名地址。
type VideoTask struct {
	// ID 本地公开任务编号。
	ID string `json:"id"`
	// Model 用户请求模型。
	Model string `json:"model"`
	// ActualModel 实际调用模型。
	ActualModel string `json:"actual_model"`
	// Status 生成状态。
	Status string `json:"status"`
	// BillingState HELD/CAPTURED/RELEASED。
	BillingState string `json:"billing_state"`
	// Charge 创建时冻结的美元金额。
	Charge string `json:"charge"`
	// DownloadState 文件可用性。
	DownloadState string `json:"download_state"`
	// Duration 视频秒数。
	Duration int `json:"duration"`
	// Resolution 分辨率。
	Resolution string `json:"resolution"`
	// CreatedAt 创建时间。
	CreatedAt time.Time `json:"created_at"`
	// UpdatedAt 最近状态更新时间。
	UpdatedAt time.Time `json:"updated_at"`
	// CompletedAt 完成时间，未完成时为 null。
	CompletedAt *time.Time `json:"completed_at"`
	// ExpiresAt 可信上游文件到期时间；未知时为 null。
	ExpiresAt *time.Time `json:"retention_expires_at"`
	// APIKeyID 任务原始用户 Key 编号。
	APIKeyID int64 `json:"api_key_id"`
	// APIKeyName 原 Key 显示名称，不包含密钥明文。
	APIKeyName string `json:"api_key_name"`
	// APIKeyStatus 原 Key 当前状态；已删除时为 deleted。
	APIKeyStatus string `json:"api_key_status"`
	// ErrorCode 受控错误码。
	ErrorCode string `json:"error_code"`
}

type VideoTaskRecord struct {
	DBID                                                                                  int64
	PublicID                                                                              string
	UserID, APIKeyID, GroupID, AccountID                                                  int64
	ChannelID                                                                             int64
	Scope, RequestedModel, ChannelMappedModel, UpstreamModel, IdempotencyKey, RequestHash string
	SubscriptionID                                                                        *int64
	Ciphertext                                                                            []byte
	Capability                                                                            KokoVideoModel
	Pricing                                                                               VideoPriceSnapshot
	Status, UpstreamID, LeaseOwner                                                        string
	LeaseEpoch                                                                            int64
}

// VideoPriceSnapshot 固定创建时的价格与倍率，所有金额均为十进制字符串。
type VideoPriceSnapshot struct {
	// BasePrice 站内明确配置的每个视频美元基价。
	BasePrice string `json:"base_price"`
	// Multiplier 生效分组倍率。
	Multiplier string `json:"group_multiplier"`
	// Charge 最终冻结和实际收费。
	Charge string `json:"charge"`
	// Currency 下游结算币种。
	Currency string `json:"currency"`
	// Duration 秒数。
	Duration int `json:"duration"`
	// Resolution 分辨率。
	Resolution string `json:"resolution"`
	// Tier 参数价格档标签。
	Tier string `json:"tier"`
	// AccountMultiplier 原账号统计倍率快照。
	AccountMultiplier string `json:"account_multiplier"`
	// AccountCost 账号统计美元成本，不等于上游积分。
	AccountCost string `json:"account_cost"`
	// Source 正式价格来源，只允许 group 或 channel。
	Source string `json:"source"`
}

// VideoInitializeRequest 使用现有账号、分组及渠道，缺失关联时补齐。
type VideoInitializeRequest struct {
	// AccountID 管理员已配置的 KOKO Account。
	AccountID int64 `json:"account_id" binding:"required"`
	// GroupID 可选已有分组；为零时复用或创建专属关闭分组。
	GroupID int64 `json:"group_id"`
	// ChannelID 可选已有渠道；为零时复用或创建专属渠道。
	ChannelID int64 `json:"channel_id"`
}

// VideoInitializeResult 返回幂等初始化的真实关联结果。
type VideoInitializeResult struct {
	// AccountID 已关联的账号。
	AccountID int64 `json:"account_id"`
	// GroupID 已关联的分组。
	GroupID int64 `json:"group_id"`
	// ChannelID 已关联的渠道。
	ChannelID int64 `json:"channel_id"`
	// Models 本次关联的实时启用视频模型。
	Models []string `json:"models"`
	// CreationEnabled 收费创建开关，初始化不自动开启。
	CreationEnabled bool `json:"creation_enabled"`
}

type VideoRepository interface {
	SaveModels(context.Context, int64, string, []KokoVideoModel) error
	Models(context.Context, int64) ([]KokoVideoModel, error)
	Initialize(context.Context, VideoInitializeRequest, []KokoVideoModel) (*VideoInitializeResult, error)
	Quote(context.Context, int64, int64, string, VideoCreateRequest) (VideoPriceSnapshot, int64, error)
	Create(context.Context, *VideoTaskRecord) (*VideoTask, error)
	Get(context.Context, string, int64, int64, int64) (*VideoTask, error)
	List(context.Context, int64, int64) ([]VideoTask, error)
	ListPage(context.Context, int64, int64, int64, string) ([]VideoTask, error)
	Record(context.Context, string) (*VideoTaskRecord, error)
	Claim(context.Context, string, time.Time) (*VideoTaskRecord, error)
	Observe(context.Context, *VideoTaskRecord, *KokoTaskResult, string, bool, time.Time) error
	SettleNext(context.Context) (bool, error)
	Audit(context.Context, string) (json.RawMessage, error)
	SetGate(context.Context, int64, bool) error
	GetGate(context.Context, int64) (bool, error)
	RouteModel(context.Context, int64, string) (string, error)
	Replay(context.Context, int64, int64, int64, string, string) (*VideoTask, error)
	Reconcile(context.Context, string, string, int64, string) error
	RetryBilling(context.Context, string, int64, string) error
	CheckAdmission(context.Context, int64, int64, int64, string) error
	CacheNext(context.Context, func(context.Context, int64, int64, int64) error) (bool, error)
	HasTasks(context.Context) (bool, error)
}

var ErrVideoUnavailable = errors.New("VIDEO_UNAVAILABLE")
