<template>
  <section class="ua-panel ua-trend" :aria-busy="loading">
    <div class="ua-panel-head">
      <h3>{{ t('admin.dashboard.tokenUsageTrend') }}</h3>
      <Select class="ua-granularity uc-console-select" :model-value="granularity" :aria-label="t('admin.dashboard.granularity')" :options="granularityOptions" :searchable="false" dropdown-class="uc-console-select-menu" @update:model-value="emit('update:granularity', $event as 'day' | 'hour')" />
    </div>
    <div v-if="loading" class="ua-chart-state" role="status">{{ t('common.loading') }}</div><div v-else-if="!trend.length" class="ua-chart-state">{{ t('userAnalytics.noData') }}</div><div v-else class="ua-trend-canvas"><Line :data="data" :options="options" :plugins="[neonGlow]" :aria-label="t('admin.dashboard.tokenUsageTrend')" role="img" /></div>
    <details v-if="trend.length" class="ua-trend-data"><summary>{{ t('userAnalytics.exactTrend') }}</summary><div class="ua-trend-table"><table><thead><tr><th>{{ t('usage.time') }}</th><th>{{ t('userAnalytics.input') }}</th><th>{{ t('userAnalytics.output') }}</th><th>{{ t('userAnalytics.cacheRead') }}</th><th>{{ t('userAnalytics.cacheWrite') }}</th></tr></thead><tbody><tr v-for="point in trend" :key="point.date"><td>{{ point.date }}</td><td>{{ point.input_tokens.toLocaleString() }}</td><td>{{ point.output_tokens.toLocaleString() }}</td><td>{{ point.cache_read_tokens.toLocaleString() }}</td><td>{{ point.cache_creation_tokens.toLocaleString() }}</td></tr></tbody></table></div></details>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Line } from 'vue-chartjs'
import Select from '@/components/common/Select.vue'
import '@/styles/user-console-select.css'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, type ChartOptions, type ScriptableContext, type Plugin } from 'chart.js'
import type { TrendDataPoint } from '@/types'
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)
const props = defineProps<{ trend: TrendDataPoint[]; loading?: boolean; granularity: 'day' | 'hour' }>()
const emit = defineEmits<{ 'update:granularity': [value: 'day' | 'hour'] }>()
const { t } = useI18n()
const granularityOptions = computed(() => [
  { value: 'day', label: t('admin.dashboard.day') },
  { value: 'hour', label: t('admin.dashboard.hour') },
])
const data = computed(() => ({ labels: props.trend.map(p => p.date), datasets: [
  { label: t('userAnalytics.input'), key: 'input_tokens', color: '#258aff' }, { label: t('userAnalytics.output'), key: 'output_tokens', color: '#0beee2' }, { label: t('userAnalytics.cacheRead'), key: 'cache_read_tokens', color: '#cc4af0' }, { label: t('userAnalytics.cacheWrite'), key: 'cache_creation_tokens', color: '#dea633' },
].map(series => ({ label: series.label, data: props.trend.map(p => p[series.key as keyof TrendDataPoint] as number), borderColor: series.color,
  // 只调整画布渐变和插值；不补点、不合并缓存字段、不改变真实时间序列。
  backgroundColor: (context: ScriptableContext<'line'>) => {
    const { ctx, chartArea } = context.chart
    if (!chartArea) return `${series.color}22`
    const fill = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
    fill.addColorStop(0, `${series.color}69`)
    fill.addColorStop(1, `${series.color}03`)
    return fill
  }, fill: true, borderWidth: 2.9, pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#0a2035', pointBorderWidth: 2, tension: 0.4, cubicInterpolationMode: 'monotone' as const })) }))
// 插件仅绑定当前图表，画布状态成对恢复，避免影响管理员或其他图表。
const neonGlow: Plugin<'line'> = {
  id: 'user-console-neon',
  beforeDatasetDraw(chart, { index }) { chart.ctx.save(); chart.ctx.shadowColor = String(chart.data.datasets[index].borderColor); chart.ctx.shadowBlur = 8 },
  afterDatasetDraw(chart) { chart.ctx.restore() }
}
// 不写 ChartJS.defaults，用户图表主题不会影响管理员。
const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { intersect: false, mode: 'index' }, plugins: { legend: { align: 'end', labels: { color: '#c9d1df', usePointStyle: true, boxWidth: 7, boxHeight: 7, font: { size: 10 } } }, tooltip: { backgroundColor: '#06121def', borderColor: '#2a6176', borderWidth: 1, titleColor: '#f1f8ff', bodyColor: '#d8ecf9', callbacks: { label: context => `${context.dataset.label}: ${Number(context.raw).toLocaleString()}` } } }, scales: { x: { grid: { color: '#24405440' }, ticks: { color: '#aeb9cb', maxTicksLimit: 7, maxRotation: 0, font: { size: 10 } } }, y: { beginAtZero: true, grid: { color: '#29415466' }, ticks: { color: '#aeb9cb', maxTicksLimit: 5, font: { size: 10 } } } } }
</script>
