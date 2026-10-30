package service

import (
	"github.com/Wei-Shaw/sub2api/internal/pkg/timezone"
	"time"
)

// VideoSubscriptionWindowPlan 复用现有订阅窗口规则，只计算时间，不计算资金。
type VideoSubscriptionWindowPlan struct {
	Daily, Weekly, Monthly                time.Time
	ResetDaily, ResetWeekly, ResetMonthly bool
}

func PlanVideoSubscriptionWindows(sub UserSubscription, now time.Time) VideoSubscriptionWindowPlan {
	plan := VideoSubscriptionWindowPlan{}
	if sub.DailyWindowStart == nil {
		value := timezone.StartOfDay(sub.StartsAt)
		sub.DailyWindowStart = &value
		plan.ResetDaily = true
	}
	if sub.WeeklyWindowStart == nil {
		value := sub.StartsAt
		sub.WeeklyWindowStart = &value
		plan.ResetWeekly = true
	}
	if sub.MonthlyWindowStart == nil {
		value := sub.StartsAt
		sub.MonthlyWindowStart = &value
		plan.ResetMonthly = true
	}
	plan.Daily = *sub.DailyWindowStart
	plan.Weekly = *sub.WeeklyWindowStart
	plan.Monthly = *sub.MonthlyWindowStart
	if value, ok := sub.automaticDailyWindowStartAt(now); ok {
		plan.Daily = value
		plan.ResetDaily = true
	}
	if value, ok := sub.automaticWindowStartAt(sub.WeeklyWindowStart, 7*24*time.Hour, now); ok {
		plan.Weekly = value
		plan.ResetWeekly = true
	}
	if value, ok := sub.automaticWindowStartAt(sub.MonthlyWindowStart, 30*24*time.Hour, now); ok {
		plan.Monthly = value
		plan.ResetMonthly = true
	}
	return plan
}
