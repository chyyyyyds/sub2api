// procurement-audit 从标准输入读取脱敏用量及价格证据，输出只读采购核算，不连接任何数据库。
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/shopspring/decimal"
)

type auditRow struct {
	// RequestID 为逻辑账务标识，仅用于结果关联。
	RequestID string `json:"request_id"`
	// AccountID 为实际结算的上游账号。
	AccountID int64 `json:"account_id"`
	// Model 为上游实际模型。
	Model string `json:"model"`
	// At 为消费时刻，用于核验价格有效期。
	At time.Time `json:"at"`
	// Tokens 为已确认的互斥 Token 分类，普通输入不包含缓存。
	Tokens service.UsageTokens `json:"tokens"`
	// RevenueUSD 为本地实际入账消费，不参与采购估算。
	RevenueUSD decimal.Decimal `json:"revenue_usd"`
	// Snapshot 为核实后的渠道价格与认证倍率。
	Snapshot *service.ProcurementPriceSnapshot `json:"snapshot"`
	// SupplierCostUSD 为供应商已确认费用；无账单时为 null。
	SupplierCostUSD *decimal.Decimal `json:"supplier_cost_usd"`
	// StatementEvidence 为已确认账单的证据标识。
	StatementEvidence string `json:"statement_evidence"`
}

type auditResult struct {
	// RequestID 为逻辑账务标识。
	RequestID string `json:"request_id"`
	// Procurement 将实际采购、估算采购与未知区分。
	Procurement service.ProcurementCostResult `json:"procurement"`
	// RevenueUSD 为本地实际消费。
	RevenueUSD decimal.Decimal `json:"revenue_usd"`
	// ConfirmedMarginUSD 仅在双方金额已确认时输出。
	ConfirmedMarginUSD *decimal.Decimal `json:"confirmed_margin_usd"`
	// EstimatedMarginUSD 为基于价格证据的估计利润，不能称为已确认毛利。
	EstimatedMarginUSD *decimal.Decimal `json:"estimated_margin_usd"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "采购审计输入无效:", err)
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	var rows []auditRow
	decoder := json.NewDecoder(io.LimitReader(input, 32<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&rows); err != nil {
		return err
	}
	results := make([]auditResult, 0, len(rows))
	for _, row := range rows {
		cost := service.EstimateProcurementCost(row.AccountID, row.Model, row.At, row.Tokens, row.Snapshot, row.SupplierCostUSD, row.StatementEvidence)
		result := auditResult{RequestID: row.RequestID, Procurement: cost, RevenueUSD: row.RevenueUSD}
		if cost.CostUSD != nil {
			margin := row.RevenueUSD.Sub(*cost.CostUSD)
			if cost.Status == "confirmed" {
				result.ConfirmedMarginUSD = &margin
			} else {
				result.EstimatedMarginUSD = &margin
			}
		}
		results = append(results, result)
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	encoder.SetEscapeHTML(false)
	return encoder.Encode(results)
}
