package service

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"
)

const openAITransientProbeBackoff = 2 * time.Second

type openAITransientProbeGroupKey struct {
	groupID int64
	model   string
}

type openAITransientProbe struct {
	state   *openAIAccountModelTransientState
	group   openAITransientProbeGroupKey
	account openAIAccountModelKey
	active  bool
	nextAt  time.Time
}

type openAITransientProbeContextKey struct{}
type openAITransientProbeEligibilityKey struct{}

// transientProbeAllowed 仅允许持有探测名额的请求绕过对应账号和模型的内置冷却。
// eligibility 上下文仅供候选资格检查使用，不会交给正常选号或上游转发。
func transientProbeAllowed(ctx context.Context, accountID int64, model string) bool {
	if ctx == nil {
		return false
	}
	if checking, _ := ctx.Value(openAITransientProbeEligibilityKey{}).(bool); checking {
		return true
	}
	probe, _ := ctx.Value(openAITransientProbeContextKey{}).(*openAITransientProbe)
	if probe == nil || probe.state == nil {
		return false
	}
	key, ok := openAIAccountModelTransientKey(accountID, model)
	probe.state.mu.Lock()
	defer probe.state.mu.Unlock()
	return ok && probe.active && probe.account == key
}

// claimProbe 不清除失败计数和冷却，只授予一个请求临时探测权限。
// 分组和模型限制一个在途探测；共享账号的其他分组也不能重复探测同一上游模型。
func (s *openAIAccountModelTransientState) claimProbe(groupID int64, requestedModel string, accountID int64, model string, now time.Time) *openAITransientProbe {
	key, ok := openAIAccountModelTransientKey(accountID, model)
	if s == nil || !ok {
		return nil
	}
	group := openAITransientProbeGroupKey{groupID: groupID, model: normalizeOpenAIAccountModelTransientModel(requestedModel)}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, exists := s.entries[key]
	if !exists || !now.Before(entry.blockUntil) || now.Sub(entry.lastFailure) < openAITransientProbeBackoff {
		return nil
	}
	if previous := s.probes[group]; previous != nil && (previous.active || now.Before(previous.nextAt)) {
		return nil
	}
	for _, probe := range s.probes {
		if probe.active && probe.account == key {
			return nil
		}
	}
	if s.probes == nil {
		s.probes = make(map[openAITransientProbeGroupKey]*openAITransientProbe)
	}
	// 回收已结束且退避期已过的名额，防止大量分组或模型使状态无限增长。
	for k, probe := range s.probes {
		if !probe.active && !now.Before(probe.nextAt) {
			delete(s.probes, k)
		}
	}
	if len(s.probes) >= s.maxEntries {
		return nil
	}
	probe := &openAITransientProbe{state: s, group: group, account: key, active: true, nextAt: now.Add(openAITransientProbeBackoff)}
	s.probes[group] = probe
	return probe
}

func (p *openAITransientProbe) release() {
	if p == nil || p.state == nil {
		return
	}
	p.state.mu.Lock()
	p.active = false
	// 探测结束后仍退避两秒，避免快速失败使后续请求连续冲击故障上游。
	p.nextAt = time.Now().Add(openAITransientProbeBackoff)
	p.state.mu.Unlock()
}

func (s *openAIAccountModelTransientState) probeDeadline(accountID int64, model string) time.Time {
	key, _ := openAIAccountModelTransientKey(accountID, model)
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.entries[key].blockUntil
}

// trySelectOpenAITransientProbe 在正常选号失败后复用全部准入规则。
// 只接管全部合格候选均处于内置冷却的情况；本请求已尝试过账号时不再开第二轮。
func (s *OpenAIGatewayService) trySelectOpenAITransientProbe(
	ctx context.Context, req OpenAIAccountScheduleRequest,
	selectOnce func(context.Context) (*AccountSelectionResult, OpenAIAccountScheduleDecision, error),
) (*AccountSelectionResult, OpenAIAccountScheduleDecision, bool) {
	if ctx.Err() != nil || len(req.ExcludedIDs) > 0 || req.Platform != PlatformOpenAI || req.RequiredImageCapability != "" {
		return nil, OpenAIAccountScheduleDecision{}, false
	}
	ctx = s.withOpenAIQuotaAutoPauseContext(ctx)
	ctx = s.withOpenAIGroupPrivacyRequirement(ctx, req.GroupID)
	ctx = s.withOpenAIProfitControlGate(ctx, req.GroupID)
	if s.checkChannelPricingRestriction(ctx, req.GroupID, req.RequestedModel) {
		return nil, OpenAIAccountScheduleDecision{}, false
	}
	req.RequirePrivacySet = s.openAIGroupRequiresPrivacySet(ctx, req.GroupID)
	accounts, err := s.listSchedulableAccounts(ctx, req.GroupID, req.Platform)
	if err != nil {
		return nil, OpenAIAccountScheduleDecision{}, false
	}
	eligibilityCtx := context.WithValue(ctx, openAITransientProbeEligibilityKey{}, true)
	scheduler := &defaultOpenAIAccountScheduler{service: s}
	state := s.getOpenAIAccountModelTransientState()
	candidates := make([]*Account, 0, len(accounts))
	for i := range accounts {
		account := &accounts[i]
		if !account.IsSchedulable() || account.Platform != PlatformOpenAI || !s.openAIAccountMatchesSchedulingGroup(account, req.GroupID) {
			continue
		}
		if !scheduler.isAccountRequestCompatible(eligibilityCtx, account, req) || !scheduler.isAccountTransportCompatible(account, req.RequiredTransport) {
			continue
		}
		account = s.recheckSelectedOpenAIAccountFromDB(eligibilityCtx, account, req.GroupID, req.Platform, req.RequestedModel, req.RequireCompact, req.RequiredCapability)
		if account == nil || !account.IsSchedulable() || !scheduler.isAccountRequestCompatible(eligibilityCtx, account, req) || !scheduler.isAccountTransportCompatible(account, req.RequiredTransport) {
			continue
		}
		if req.RequireCompact && openAICompactSupportTier(account) == 0 {
			continue
		}
		// 有未冷却的合格账号时，失败应由正常容量或其他准入规则处理，不能触发探测。
		if !s.isOpenAIAccountModelRuntimeBlocked(account, req.RequestedModel) {
			return nil, OpenAIAccountScheduleDecision{}, false
		}
		candidates = append(candidates, account)
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		x := state.probeDeadline(a.ID, canonicalOpenAIAccountSchedulingModel(a, req.RequestedModel))
		y := state.probeDeadline(b.ID, canonicalOpenAIAccountSchedulingModel(b, req.RequestedModel))
		if x.Equal(y) {
			return a.ID < b.ID
		}
		return x.Before(y)
	})
	for _, account := range candidates {
		probe := state.claimProbe(derefGroupID(req.GroupID), req.RequestedModel, account.ID, canonicalOpenAIAccountSchedulingModel(account, req.RequestedModel), time.Now())
		if probe == nil {
			continue
		}
		probeCtx := context.WithValue(ctx, openAITransientProbeContextKey{}, probe)
		selection, decision, selectErr := selectOnce(probeCtx)
		if selectErr != nil || selection == nil || selection.Account == nil {
			probe.release()
			return nil, OpenAIAccountScheduleDecision{}, false
		}
		if selection.Account.ID != account.ID || !selection.Acquired {
			probe.release()
			if selection.Account.ID == account.ID {
				// 故障探测不排队占位；没有并发槽时保留原来的无可用账号结果。
				if selection.ReleaseFunc != nil {
					selection.ReleaseFunc()
				}
				return nil, OpenAIAccountScheduleDecision{}, false
			}
			return selection, decision, true
		}
		selection.transientProbe = probe
		releaseSlot := selection.ReleaseFunc
		var once sync.Once
		release := func() {
			once.Do(func() {
				if releaseSlot != nil {
					releaseSlot()
				}
				probe.release()
			})
		}
		stop := context.AfterFunc(ctx, release)
		selection.ReleaseFunc = func() { stop(); release() }
		slog.Info("openai_model_transient_probe_selected", "group_id", derefGroupID(req.GroupID), "account_id", account.ID, "model", probe.account.Model, "backoff_ms", openAITransientProbeBackoff.Milliseconds())
		return selection, decision, true
	}
	return nil, OpenAIAccountScheduleDecision{}, false
}
