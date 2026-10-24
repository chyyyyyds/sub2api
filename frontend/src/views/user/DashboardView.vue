<template>
  <AppLayout>
    <div class="uc-analytics ua-overview">
      <!-- 统计口径与日期筛选同一行，位于总览卡片上方。 -->
      <div class="ua-range-header">
        <p class="ua-scope">{{ t('userAnalytics.naturalDays') }} · {{ analyticsTimezone() }}</p>
        <div class="ua-toolbar"><UserDateRangePicker v-model:start-date="startDate" v-model:end-date="endDate" @change="refreshRange" /><button class="ua-button ua-refresh" type="button" :aria-label="t('common.refresh')" :disabled="loading" @click="refreshAll"><Icon name="refresh" size="sm" /></button></div>
      </div>
      <div v-if="failed || realtimeFailed || balanceFailed" class="ua-error" role="alert">{{ t('userAnalytics.loadFailed') }}<button class="ua-button" type="button" @click="refreshAll">{{ t('userAnalytics.retry') }}</button></div>
      <UserAnalyticsStats :stats="stats" :balance="balanceFailed ? undefined : user?.balance" :loading="loading" overview />
      <div class="ua-overview-mid"><UserTokenTrend v-model:granularity="granularity" :trend="trend" :loading="loading" @update:granularity="refreshRange" /><UserDistributionPanel :title="t('userAnalytics.modelDistribution')" :name-label="t('usage.model')" :items="models" :loading="loading" /></div>
      <div class="ua-overview-bottom">
        <UserDistributionPanel variant="group" :title="t('userAnalytics.groupDistribution')" :name-label="t('admin.usage.group')" :items="groups" :loading="loading" />
        <UserDistributionPanel variant="endpoint" :title="t('usage.endpointDistribution')" :name-label="t('usage.endpoint')" :items="endpoints" :loading="loading" />
        <section class="ua-panel ua-performance"><h3>{{ t('userAnalytics.performance') }}</h3><p>{{ t('userAnalytics.avgResponse') }}</p><strong class="ua-response">{{ loading ? '…' : stats?.total_requests ? duration(stats.average_duration_ms) : '—' }}</strong><small>{{ t('userAnalytics.selectedRange') }}</small><div class="ua-perf-grid"><div><strong>{{ realtime?.rpm ?? '—' }}</strong><span>RPM</span></div><div><strong>{{ realtime?.tpm?.toLocaleString() ?? '—' }}</strong><span>TPM</span></div><div><strong>{{ cacheRate }}</strong><span>{{ t('userAnalytics.cacheReadShare') }}</span></div></div><p class="ua-scope">{{ t('userAnalytics.performanceScope') }}</p><p class="ua-scope">{{ t('userAnalytics.noPerformanceTrend') }}</p></section>
      </div>
    </div>
  </AppLayout>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { usageAPI, type UserDashboardStats } from '@/api/usage'
import type { TrendDataPoint, UsageStatsResponse } from '@/types'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import UserAnalyticsStats from '@/components/user/analytics/UserAnalyticsStats.vue'
import UserDateRangePicker from '@/components/user/analytics/UserDateRangePicker.vue'
import UserDistributionPanel from '@/components/user/analytics/UserDistributionPanel.vue'
import UserTokenTrend from '@/components/user/analytics/UserTokenTrend.vue'
import { analyticsTimezone, duration, naturalDayRange, type DistributionItem } from '@/components/user/analytics/analytics'
import '@/styles/user-analytics.css'
import '@/styles/stage7d-visual.css'
const { t } = useI18n()
const authStore = useAuthStore()
const user = computed(() => authStore.user)
const initialRange = naturalDayRange()
const startDate = ref(initialRange.start)
const endDate = ref(initialRange.end)
const granularity = ref<'day' | 'hour'>('day')
const stats = ref<UsageStatsResponse | null>(null)
const realtime = ref<UserDashboardStats | null>(null)
const trend = ref<TrendDataPoint[]>([])
const models = ref<DistributionItem[]>([])
const groups = ref<DistributionItem[]>([])
const endpoints = computed<DistributionItem[]>(() => (stats.value?.endpoints ?? []).map(item => ({ name: item.endpoint || t('usage.unknown'), requests: item.requests, actualCost: item.actual_cost })))
const loading = ref(false)
const failed = ref(false)
const realtimeFailed = ref(false)
const balanceFailed = ref(false)
let controller: AbortController | null = null
let realtimeController: AbortController | null = null
let disposed = false
const cacheRate = computed(() => {
  const s = stats.value
  if (!s?.total_requests) return '—'
  const prompt = s.total_input_tokens + s.total_cache_read_tokens + s.total_cache_creation_tokens
  return prompt ? `${(s.total_cache_read_tokens / prompt * 100).toFixed(1)}%` : '—'
})
async function refreshRange() {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  failed.value = false
  // 同一日期快照加载；先清空旧周期，防止把旧数据标成新日期。
  stats.value = null; trend.value = []; models.value = []; groups.value = []
  const params = { start_date: startDate.value, end_date: endDate.value, timezone: analyticsTimezone() }
  try {
    const [summary, snapshot] = await Promise.all([
      usageAPI.getStats(params, undefined, { signal: current.signal }),
      usageAPI.getDashboardSnapshotV2({ ...params, granularity: granularity.value, include_trend: true, include_model_stats: true, include_group_stats: true }, { signal: current.signal }),
    ])
    if (current.signal.aborted || disposed) return
    stats.value = summary; trend.value = [...(snapshot.trend ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    models.value = (snapshot.models ?? []).map(item => ({ name: item.model, requests: item.requests, actualCost: item.actual_cost }))
    groups.value = (snapshot.groups ?? []).map(item => ({ name: item.group_name, requests: item.requests, actualCost: item.actual_cost }))
  } catch { if (!current.signal.aborted && !disposed) failed.value = true }
  finally { if (controller === current && !disposed) loading.value = false }
}
async function refreshRealtime() {
  realtimeController?.abort()
  const current = new AbortController()
  realtimeController = current
  realtimeFailed.value = false; realtime.value = null
  try { const result = await usageAPI.getDashboardStats({ signal: current.signal }); if (!current.signal.aborted && !disposed) realtime.value = result }
  catch { if (!current.signal.aborted && !disposed) realtimeFailed.value = true }
}
async function refreshBalance() {
  balanceFailed.value = false
  try { await authStore.refreshUser() } catch { if (!disposed) balanceFailed.value = true }
}
function refreshAll() { void refreshRange(); void refreshRealtime(); void refreshBalance() }
onMounted(refreshAll)
onBeforeUnmount(() => { disposed = true; controller?.abort(); realtimeController?.abort() })
</script>
