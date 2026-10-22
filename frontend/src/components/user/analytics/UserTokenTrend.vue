<template>
  <section class="ua-panel ua-trend" :aria-busy="loading">
    <div class="ua-panel-head"><h3>{{ t('admin.dashboard.tokenUsageTrend') }}</h3><label class="ua-granularity">{{ t('admin.dashboard.granularity') }}<select :value="granularity" @change="emit('update:granularity', ($event.target as HTMLSelectElement).value as 'day' | 'hour')"><option value="day">{{ t('admin.dashboard.day') }}</option><option value="hour">{{ t('admin.dashboard.hour') }}</option></select></label></div>
    <div v-if="loading" class="ua-chart-state" role="status">{{ t('common.loading') }}</div><div v-else-if="!trend.length" class="ua-chart-state">{{ t('userAnalytics.noData') }}</div><div v-else class="ua-trend-canvas"><Line :data="data" :options="options" :aria-label="t('admin.dashboard.tokenUsageTrend')" role="img" /></div>
    <details v-if="trend.length" class="ua-trend-data"><summary>{{ t('userAnalytics.exactTrend') }}</summary><div class="ua-trend-table"><table><thead><tr><th>{{ t('usage.time') }}</th><th>{{ t('userAnalytics.input') }}</th><th>{{ t('userAnalytics.output') }}</th><th>{{ t('userAnalytics.cacheRead') }}</th><th>{{ t('userAnalytics.cacheWrite') }}</th></tr></thead><tbody><tr v-for="point in trend" :key="point.date"><td>{{ point.date }}</td><td>{{ point.input_tokens.toLocaleString() }}</td><td>{{ point.output_tokens.toLocaleString() }}</td><td>{{ point.cache_read_tokens.toLocaleString() }}</td><td>{{ point.cache_creation_tokens.toLocaleString() }}</td></tr></tbody></table></div></details>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Line } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, type ChartOptions } from 'chart.js'
import type { TrendDataPoint } from '@/types'
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)
const props = defineProps<{ trend: TrendDataPoint[]; loading?: boolean; granularity: 'day' | 'hour' }>()
const emit = defineEmits<{ 'update:granularity': [value: 'day' | 'hour'] }>()
const { t } = useI18n()
const data = computed(() => ({ labels: props.trend.map(p => p.date), datasets: [
  { label: t('userAnalytics.input'), key: 'input_tokens', color: '#278aff' }, { label: t('userAnalytics.output'), key: 'output_tokens', color: '#19e5d2' }, { label: t('userAnalytics.cacheRead'), key: 'cache_read_tokens', color: '#8b82d9' }, { label: t('userAnalytics.cacheWrite'), key: 'cache_creation_tokens', color: '#dea633' },
].map(series => ({ label: series.label, data: props.trend.map(p => p[series.key as keyof TrendDataPoint] as number), borderColor: series.color, backgroundColor: `${series.color}16`, fill: true, borderWidth: 2, pointRadius: 2, tension: 0.25 })) }))
// 不写 ChartJS.defaults，用户图表主题不会影响管理员。
const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { labels: { color: '#a7b9ce', usePointStyle: true, boxWidth: 7, boxHeight: 7, font: { size: 11 } } }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${Number(context.raw).toLocaleString()}` } } }, scales: { x: { grid: { color: '#26394a55' }, ticks: { color: '#8c9eb2', maxTicksLimit: 7, maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: '#26394a88' }, ticks: { color: '#8c9eb2', maxTicksLimit: 5, font: { size: 10 } } } } }
</script>
