<template>
  <div class="ua-stats" :class="{ 'ua-five-stats': overview }" :aria-busy="loading">
    <article v-if="overview" class="ua-stat ua-cyan" data-stat="balance"><span class="ua-stat-icon"><Icon name="wallet" size="lg" /></span><div class="ua-stat-copy"><span>{{ t('userAnalytics.balance') }}</span><strong>{{ money(balance, 2) }}</strong><small>{{ t('userAnalytics.currentBalance') }}</small></div></article>
    <article v-for="card in cards" :key="card.key" class="ua-stat" :class="card.tone" :data-stat="card.key"><span class="ua-stat-icon"><Icon :name="card.key === 'cost' ? 'coins' : card.key === 'response' ? (overview ? 'zap' : 'timer') : card.key === 'requests' ? (overview ? 'chart' : 'file') : 'cube'" size="lg" /></span><div class="ua-stat-copy"><span>{{ card.label }}</span><strong :title="card.exact">{{ loading ? '…' : card.value }}</strong><small>{{ card.detail }}</small></div></article>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/components/user/visual/ConsoleMetricIcon.vue'
import type { UsageStatsResponse } from '@/types'
import { duration, money, tokens } from './analytics'
const props = defineProps<{ stats: UsageStatsResponse | null; balance?: number; overview?: boolean; loading?: boolean }>()
const { t } = useI18n()
const cards = computed(() => {
  const s = props.stats
  const range = t('userAnalytics.selectedRange')
  const cost = { key: 'cost', icon: 'creditCard' as const, tone: 'ua-indigo', label: props.overview ? t('userAnalytics.actualCost') : t('usage.totalCost'), value: money(s?.total_actual_cost), exact: money(s?.total_actual_cost, 8), detail: `${t('userAnalytics.standardCost')} ${money(s?.total_cost, 8)}` }
  const requests = { key: 'requests', icon: 'chart' as const, tone: 'ua-blue', label: t('usage.totalRequests'), value: s?.total_requests.toLocaleString() ?? '—', exact: '', detail: range }
  const token = { key: 'tokens', icon: 'cube' as const, tone: 'ua-amber', label: t('userAnalytics.tokenUsage'), value: tokens(s?.total_tokens), exact: s?.total_tokens.toLocaleString(), detail: s ? `${t('userAnalytics.input')} ${tokens(s.total_input_tokens)} / ${t('userAnalytics.output')} ${tokens(s.total_output_tokens)} · ${t('userAnalytics.cacheRead')} ${tokens(s.total_cache_read_tokens)} / ${t('userAnalytics.cacheWrite')} ${tokens(s.total_cache_creation_tokens)}` : range }
  const response = { key: 'response', icon: 'clock' as const, tone: 'ua-purple', label: t('userAnalytics.avgResponse'), value: s?.total_requests ? duration(s.average_duration_ms) : '—', exact: '', detail: range }
  return props.overview ? [cost, requests, token, response] : [requests, token, cost, response]
})
</script>
