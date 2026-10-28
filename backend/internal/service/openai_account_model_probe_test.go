package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/config"
	"github.com/stretchr/testify/require"
)

func newTransientProbeTestService(t *testing.T, advanced bool) (*OpenAIGatewayService, int64) {
	t.Helper()
	resetOpenAIAdvancedSchedulerSettingCacheForTest()
	t.Cleanup(resetOpenAIAdvancedSchedulerSettingCacheForTest)
	groupID := int64(901)
	accounts := []Account{}
	for _, id := range []int64{9011, 9012} {
		accounts = append(accounts, Account{ID: id, Platform: PlatformOpenAI, Type: AccountTypeAPIKey,
			Status: StatusActive, Schedulable: true, Concurrency: 10, GroupIDs: []int64{groupID},
			Credentials: map[string]any{"model_mapping": map[string]any{"probe-model": "upstream-model"}}})
	}
	cfg := &config.Config{}
	cfg.Gateway.Scheduling.LoadBatchEnabled = false
	svc := &OpenAIGatewayService{cfg: cfg, accountRepo: schedulerGroupAwareOpenAIAccountRepo{schedulerTestOpenAIAccountRepo{accounts: accounts}}}
	if advanced {
		svc.rateLimitService = newOpenAIAdvancedSchedulerRateLimitService("true")
	}
	return svc, groupID
}

func coolTransientProbeTestAccounts(svc *OpenAIGatewayService, ids ...int64) {
	base := time.Now().Add(-4 * time.Second)
	for _, id := range ids {
		state := svc.getOpenAIAccountModelTransientState()
		state.recordFailure(id, "upstream-model", base)
		state.recordFailure(id, "upstream-model", base.Add(time.Second))
	}
}

func TestOpenAITransientProbe_AllCooledCanRecoverWithoutClearingOtherAccounts(t *testing.T) {
	for _, advanced := range []bool{false, true} {
		t.Run(map[bool]string{false: "legacy", true: "advanced"}[advanced], func(t *testing.T) {
			svc, groupID := newTransientProbeTestService(t, advanced)
			coolTransientProbeTestAccounts(svc, 9011, 9012)
			selection, _, err := svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
			require.NoError(t, err)
			require.NotNil(t, selection.transientProbe)
			t.Cleanup(selection.ReleaseFunc)
			account := selection.Account
			require.True(t, svc.isOpenAIAccountModelRuntimeBlocked(account, "probe-model"), "探测不得先清空冷却")
			probeCtx := ContextWithSelectionProfitGate(context.Background(), selection)
			require.False(t, svc.isOpenAIAccountRequestRuntimeBlocked(account, "probe-model", probeCtx))
			other := &Account{ID: 9012, Platform: PlatformOpenAI, Credentials: account.Credentials}
			if other.ID == account.ID {
				other.ID = 9011
			}
			require.True(t, svc.isOpenAIAccountRequestRuntimeBlocked(other, "probe-model", probeCtx))
			svc.ReportOpenAIAccountScheduleResult(account, "upstream-model", true, nil)
			selection.ReleaseFunc()
			require.False(t, svc.isOpenAIAccountModelRuntimeBlocked(account, "probe-model"))
			require.True(t, svc.isOpenAIAccountModelRuntimeBlocked(other, "probe-model"))
		})
	}
}

func TestOpenAITransientProbe_HealthyAccountKeepsNormalPath(t *testing.T) {
	svc, groupID := newTransientProbeTestService(t, false)
	coolTransientProbeTestAccounts(svc, 9011)
	selection, _, err := svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.NoError(t, err)
	require.Equal(t, int64(9012), selection.Account.ID)
	require.Nil(t, selection.transientProbe)
	selection.ReleaseFunc()
}

func TestOpenAITransientProbe_OneInflightAndNoRequestLocalSecondRound(t *testing.T) {
	svc, groupID := newTransientProbeTestService(t, false)
	coolTransientProbeTestAccounts(svc, 9011, 9012)
	selection, _, err := svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.NoError(t, err)
	t.Cleanup(selection.ReleaseFunc)
	_, _, err = svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.Error(t, err, "同组同模型只能有一个在途探测")
	svc.getOpenAIAccountModelTransientState().recordFailure(selection.Account.ID, "upstream-model", time.Now())
	selection.ReleaseFunc()
	_, _, err = svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.Error(t, err, "探测失败后必须退避")
	_, _, err = svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", map[int64]struct{}{selection.Account.ID: {}}, OpenAIUpstreamTransportAny, false)
	require.Error(t, err, "同一请求不得重置已尝试账号再次轮询")
}

func TestOpenAITransientProbe_ManualPauseQuotaAndUnsupportedModelRemainBlocked(t *testing.T) {
	for _, gate := range []string{"disabled", "temp_unschedulable", "rate_limited", "model_paused", "overloaded", "unsupported", "other_group"} {
		t.Run(gate, func(t *testing.T) {
			svc, groupID := newTransientProbeTestService(t, false)
			repo := svc.accountRepo.(schedulerGroupAwareOpenAIAccountRepo)
			until := time.Now().Add(time.Hour)
			for i := range repo.accounts {
				a := &repo.accounts[i]
				switch gate {
				case "disabled":
					a.Schedulable = false
				case "temp_unschedulable":
					a.TempUnschedulableUntil = &until
				case "rate_limited":
					a.RateLimitResetAt = &until
				case "model_paused":
					a.Extra = map[string]any{modelRateLimitsKey: map[string]any{"upstream-model": map[string]any{"rate_limit_reset_at": until.Format(time.RFC3339)}}}
				case "overloaded":
					a.OverloadUntil = &until
				case "unsupported":
					a.Credentials = map[string]any{"model_mapping": map[string]any{"other": "other"}}
				case "other_group":
					a.GroupIDs = []int64{902}
				}
			}
			svc.accountRepo = repo
			coolTransientProbeTestAccounts(svc, 9011, 9012)
			_, _, err := svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
			require.Error(t, err)
			require.Empty(t, svc.getOpenAIAccountModelTransientState().probes)
		})
	}
}

func TestOpenAITransientProbe_ConcurrentClaimsAndSharedAccountIsolation(t *testing.T) {
	state := newOpenAIAccountModelTransientState(128)
	base := time.Now().Add(-4 * time.Second)
	for _, id := range []int64{1, 2} {
		state.recordFailure(id, "m", base)
		state.recordFailure(id, "m", base.Add(time.Second))
	}
	var winners atomic.Int64
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			if state.claimProbe(1, "public", id, "m", time.Now()) != nil {
				winners.Add(1)
			}
		}(int64(i%2 + 1))
	}
	wg.Wait()
	require.Equal(t, int64(1), winners.Load())
	var active *openAITransientProbe
	for _, p := range state.probes {
		if p.active {
			active = p
		}
	}
	require.NotNil(t, active)
	require.Nil(t, state.claimProbe(2, "alias", active.account.AccountID, "m", time.Now()), "共享账号不能跨组重复探测")
	active.release()
	require.False(t, transientProbeAllowed(context.WithValue(context.Background(), openAITransientProbeContextKey{}, active), active.account.AccountID, "m"))
}

func TestOpenAITransientProbe_RecentFailureAndCanceledRequestDoNotProbe(t *testing.T) {
	svc, groupID := newTransientProbeTestService(t, false)
	for _, id := range []int64{9011, 9012} {
		state := svc.getOpenAIAccountModelTransientState()
		state.recordFailure(id, "upstream-model", time.Now())
		state.recordFailure(id, "upstream-model", time.Now())
	}
	_, _, err := svc.SelectAccountWithScheduler(context.Background(), &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.Error(t, err)
	coolTransientProbeTestAccounts(svc, 9011, 9012)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err = svc.SelectAccountWithScheduler(ctx, &groupID, "", "", "probe-model", nil, OpenAIUpstreamTransportAny, false)
	require.Error(t, err)
	require.Empty(t, svc.getOpenAIAccountModelTransientState().probes)
}
