package service

import (
	"net/http/httptrace"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const ccProcurementAttemptKey = "openai_cc_procurement_attempt"

// UpstreamProcurementAudit 是 Ops 失败链中的采购证据；逻辑ID、分组和最终客户端结果沿用父日志。
// 供应商金额只接受外部账单证据，此处不以模型目录价格或售价冒充已确认采购。
type UpstreamProcurementAudit struct {
	AccountID       int64        `json:"account_id" example:"3"`                                                               // 实际执行本次尝试的上游账号。
	AttemptID       string       `json:"attempt_id" example:"9c7e5b86-4a9d-4d69-9691-49fdf203ab00"`                            // 本地上游尝试唯一标识。
	Model           string       `json:"model" example:"gpt-6-sol"`                                                            // 实际请求的上游模型。
	StartedAtUnixMs int64        `json:"started_at_unix_ms" example:"1792771200000"`                                           // 本次发送阶段开始时间，毫秒。
	EndedAtUnixMs   int64        `json:"ended_at_unix_ms" example:"1792771200500"`                                             // 失败被记录的时间，毫秒。
	Stage           string       `json:"stage" enums:"dispatch,headers_written,request_written,response_headers,stream_usage"` // 已观察到的最远网络阶段，不能推断供应商是否执行。
	FailureKind     string       `json:"failure_kind" example:"request_error"`                                                 // 当前失败分类。
	CostStatus      string       `json:"cost_status" enums:"unknown,pending_reconciliation,confirmed"`                         // 采购金额状态，与真实用量状态独立。
	SupplierCostUSD *float64     `json:"supplier_cost_usd" example:"0.000403468"`                                              // 已确认采购金额；未知必须为 null。
	UsageStatus     string       `json:"usage_status" enums:"unknown,confirmed"`                                               // 是否收到可解析的上游真实用量。
	Usage           *OpenAIUsage `json:"usage,omitempty"`                                                                      // 已确认累计用量快照，重复帧不会求和。
}

type ccProcurementAttempt struct {
	mu    sync.Mutex
	audit UpstreamProcurementAudit
}

func beginCCProcurementAttempt(c *gin.Context, accountID int64, model string) (*ccProcurementAttempt, *httptrace.ClientTrace) {
	a := &ccProcurementAttempt{audit: UpstreamProcurementAudit{AttemptID: uuid.NewString(), Model: model, StartedAtUnixMs: time.Now().UnixMilli(), Stage: "dispatch", CostStatus: "unknown", UsageStatus: "unknown"}}
	if c != nil {
		c.Set(ccProcurementAttemptKey, a)
	}
	a.audit.AccountID = accountID
	trace := &httptrace.ClientTrace{
		WroteHeaders: func() { a.setStage("headers_written") },
		WroteRequest: func(info httptrace.WroteRequestInfo) {
			if info.Err == nil {
				a.setStage("request_written")
			}
		},
	}
	return a, trace
}

func (a *ccProcurementAttempt) setStage(stage string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	// 回调可能并发到达；已到响应阶段后不能被较晚回调降级。
	rank := map[string]int{"dispatch": 0, "headers_written": 1, "request_written": 2, "response_headers": 3, "stream_usage": 4}
	if rank[stage] > rank[a.audit.Stage] {
		a.audit.Stage = stage
	}
}

func ccProcurementFromContext(c *gin.Context) *ccProcurementAttempt {
	if c == nil {
		return nil
	}
	v, _ := c.Get(ccProcurementAttemptKey)
	a, _ := v.(*ccProcurementAttempt)
	return a
}

func observeCCProcurementUsage(c *gin.Context, usage OpenAIUsage) {
	a := ccProcurementFromContext(c)
	if a == nil {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.audit.Stage = "stream_usage"
	a.audit.UsageStatus = "confirmed"
	a.audit.CostStatus = "pending_reconciliation"
	a.audit.Usage = &usage
}

func snapshotCCProcurement(c *gin.Context, accountID int64, kind string) *UpstreamProcurementAudit {
	a := ccProcurementFromContext(c)
	if a == nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.audit.AccountID != accountID {
		return nil
	}
	copy := a.audit
	copy.EndedAtUnixMs = time.Now().UnixMilli()
	copy.FailureKind = kind
	if copy.Usage != nil {
		usage := *copy.Usage
		copy.Usage = &usage
	}
	return &copy
}
