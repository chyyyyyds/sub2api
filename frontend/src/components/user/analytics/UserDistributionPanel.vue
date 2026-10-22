<template>
  <section class="ua-panel ua-distribution" :aria-busy="loading">
    <div class="ua-panel-head"><h3>{{ title }}</h3><span class="ua-metric-label">{{ t('userAnalytics.byRequests') }}</span></div>
    <div v-if="loading" class="ua-chart-state" role="status">{{ t('common.loading') }}</div><div v-else-if="!total" class="ua-chart-state">{{ t('userAnalytics.noData') }}</div>
    <div v-else class="ua-donut-content"><div class="ua-donut" :style="{ background: gradient }" role="img" :aria-label="`${title}: ${total.toLocaleString()} ${t('usage.totalRequests')}`"><div><strong>{{ tokens(total) }}</strong><span>{{ t('usage.totalRequests') }}</span></div></div>
      <div class="ua-distribution-list"><div class="ua-legend-row ua-legend-heading"><span>{{ nameLabel }}</span><span>{{ t('userAnalytics.requests') }}</span><span>{{ t('userAnalytics.spend') }}</span><span>{{ t('userAnalytics.share') }}</span></div>
        <div class="ua-legend-scroll"><div v-for="(item, i) in items" :key="item.name" class="ua-legend-row"><span class="ua-legend-name" :title="item.name"><i :style="{ background: analyticsPalette[i % analyticsPalette.length] }"></i>{{ item.name }}</span><span>{{ item.requests.toLocaleString() }}</span><span :title="money(item.actualCost, 8)">{{ money(item.actualCost) }}</span><span>{{ (item.requests / total * 100).toFixed(1) }}%</span></div></div>
        <div class="ua-donut-total"><span>{{ t('userAnalytics.actualCost') }}</span><strong :title="money(cost, 8)">{{ money(cost) }}</strong></div>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { analyticsPalette, money, tokens, type DistributionItem } from './analytics'
const props = defineProps<{ title: string; nameLabel: string; items: DistributionItem[]; loading?: boolean }>()
const { t } = useI18n()
const total = computed(() => props.items.reduce((n, item) => n + item.requests, 0))
const cost = computed(() => props.items.reduce((n, item) => n + item.actualCost, 0))
const gradient = computed(() => { let position = 0; return `conic-gradient(${props.items.map((item, i) => { const start = position; position += item.requests / total.value * 100; return `${analyticsPalette[i % analyticsPalette.length]} ${start}% ${position}%` }).join(',')})` })
</script>
