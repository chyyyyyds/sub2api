//go:build unit

package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

type stage7R2AtomicRepo struct {
	openAIRecordUsageBillingRepoStub
	logs []*UsageLog
}

func (r *stage7R2AtomicRepo) ApplyWithUsage(ctx context.Context, cmd *UsageBillingCommand, row *UsageLog) (*UsageBillingApplyResult, error) {
	r.logs = append(r.logs, row)
	return r.openAIRecordUsageBillingRepoStub.Apply(ctx, cmd)
}

func TestStage7R2RecordUsageAtomicBoundary(t *testing.T) {
	for _, failed := range []bool{false, true} {
		t.Run(map[bool]string{false: "原子成功不再异步写日志", true: "原子失败不写零金额占位"}[failed], func(t *testing.T) {
			usage := &openAIRecordUsageLogRepoStub{inserted: true}
			repo := &stage7R2AtomicRepo{}
			if failed {
				repo.err = errors.New("隔离事务故障")
			}
			svc := newOpenAIRecordUsageServiceWithBillingRepoForTest(usage, repo, &openAIRecordUsageUserRepoStub{}, &openAIRecordUsageSubRepoStub{}, nil)
			err := svc.RecordUsage(context.Background(), &OpenAIRecordUsageInput{Result: &OpenAIForwardResult{RequestID: "r2-atomic-record", Model: "gpt-6-sol", Usage: OpenAIUsage{InputTokens: 2, OutputTokens: 3}}, User: &User{ID: 1}, APIKey: &APIKey{ID: 2}, Account: &Account{ID: 3, Type: AccountTypeAPIKey}})
			if failed {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.Zero(t, usage.calls)
			require.Len(t, repo.logs, 1)
			require.Greater(t, repo.logs[0].ActualCost, 0.0, "真实费用不因错误被清零")
			require.Equal(t, repo.logs[0].RequestID, repo.lastCmd.RequestID)
			require.Equal(t, 2, repo.lastCmd.InputTokens)
			require.Equal(t, 3, repo.lastCmd.OutputTokens)
		})
	}
}
