package service

import "time"

// VideoFinancialAudit 保留原资金来源及十进制金额。
type VideoFinancialAudit struct {
	// ID 预留记录编号。
	ID int64 `json:"id"`
	// UserID 原用户。
	UserID int64 `json:"user_id"`
	// APIKeyID 原用户 Key。
	APIKeyID int64 `json:"api_key_id"`
	// FundingSource wallet 或 subscription。
	FundingSource string `json:"funding_source"`
	// SubscriptionID 原订阅编号。
	SubscriptionID *int64 `json:"subscription_id"`
	// Currency 下游结算币种。
	Currency string `json:"currency"`
	// Amount 原冻结额。
	Amount string `json:"amount"`
	// CapturedAmount 实际结算额。
	CapturedAmount string `json:"captured_amount"`
	// State HELD、CAPTURED 或 RELEASED。
	State string `json:"state"`
	// FinalizedAt 账务终结时间。
	FinalizedAt *time.Time `json:"finalized_at"`
}

// VideoBillingAudit 为持久且唯一的资金意图。
type VideoBillingAudit struct {
	// ID 账务事件编号。
	ID int64 `json:"id"`
	// Operation CAPTURE、RELEASE 或缓存失效操作。
	Operation string `json:"operation"`
	// RequestID 稳定的账务幂等键。
	RequestID string `json:"request_id"`
	// Status PENDING、RETRY、APPLIED 或 REVIEW。
	Status string `json:"status"`
	// Attempts 已尝试次数。
	Attempts int `json:"attempts"`
	// LastErrorCode 受控错误码。
	LastErrorCode *string `json:"last_error_code"`
	// PayloadHash 原价格快照指纹。
	PayloadHash string `json:"payload_hash"`
	// AppliedAt 实际应用时间。
	AppliedAt *time.Time `json:"applied_at"`
}

// VideoAuditEvidence 为管理恢复操作的依据，不保存提示词和签名地址。
type VideoAuditEvidence struct {
	// Reason 管理员核对或恢复原因。
	Reason string `json:"reason,omitempty"`
	// Evidence 服务器验证的证据说明。
	Evidence string `json:"evidence,omitempty"`
}

// VideoStateAudit 为追加的任务状态记录。
type VideoStateAudit struct {
	// EventType 状态或管理操作类型。
	EventType string `json:"event_type"`
	// EventKey 事件唯一键。
	EventKey string `json:"event_key"`
	// ActorType system、user 或 admin。
	ActorType string `json:"actor_type"`
	// ActorID 操作者编号。
	ActorID *int64 `json:"actor_id"`
	// CreatedAt 事件发生时间。
	CreatedAt time.Time `json:"created_at"`
	// Payload 恢复依据。
	Payload VideoAuditEvidence `json:"payload"`
}

// VideoAuditRecord 为管理员完整任务账务视图。
type VideoAuditRecord struct {
	// Task 本地任务编号。
	Task string `json:"task"`
	// AccountID 原账号。
	AccountID int64 `json:"account_id"`
	// GroupID 原分组。
	GroupID int64 `json:"group_id"`
	// ChannelID 原渠道。
	ChannelID int64 `json:"channel_id"`
	// PricingSnapshot 原价格、分组倍率与账号统计快照。
	PricingSnapshot VideoPriceSnapshot `json:"pricing_snapshot"`
	// Financial 唯一资金预留。
	Financial VideoFinancialAudit `json:"financial"`
	// BillingEvents 结算、退款及缓存恢复事件。
	BillingEvents []VideoBillingAudit `json:"billing_events"`
	// TaskEvents 原任务状态和人工核对记录。
	TaskEvents []VideoStateAudit `json:"task_events"`
}
