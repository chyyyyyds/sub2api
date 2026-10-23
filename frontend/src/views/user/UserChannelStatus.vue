<template>
  <AppLayout>
    <div class="um-console" :aria-busy="loading">
      <div class="um-layout">
        <div class="um-primary">
          <section class="um-panel um-filters">
            <div class="um-field"><span>{{ t('userMonitor.vendor') }}</span><div class="um-pills" role="group" :aria-label="t('userMonitor.vendor')"><button v-for="vendor in vendors" :key="vendor" :aria-pressed="platform === vendor" @click="choosePlatform(vendor)"><PlatformIcon :platform="vendor as GroupPlatform" size="sm" />{{ platformDisplayName(vendor) }}</button></div></div>
            <div class="um-field"><span>{{ t('userMonitor.group') }}</span><div class="um-pills" role="group" :aria-label="t('userMonitor.group')"><button v-for="group in groups" :key="group.id" :title="group.name" :aria-pressed="groupId === group.id" @click="chooseGroup(group.id)"><span class="um-ellipsis">{{ group.name }}</span><small>{{ issues.includes('rates') ? t('userMonitor.rateUnknown') : `${rates[group.id] ?? group.rate_multiplier}x` }}</small></button></div></div>
            <div class="um-toolbar"><label>{{ t('userMonitor.range') }}<select v-model="range"><option v-for="value in ranges" :key="value" :value="value">{{ t(`userMonitor.ranges.${value}`) }}</option></select></label><label>{{ t('userMonitor.filter') }}<select v-model="status"><option value="">{{ t('common.all') }}</option><option v-for="value in ['healthy','warning','critical','unknown']" :key="value" :value="value">{{ t(`userMonitor.health.${value}`) }}</option></select></label><button class="um-refresh" :aria-label="t('common.refresh')" :disabled="loading" @click="reload"><Icon name="refresh" size="sm" /></button></div>
          </section>

          <p v-if="loading" class="um-notice" role="status">{{ t('common.loading') }}</p>
          <p v-if="failure" class="um-notice um-alert" role="status" data-testid="monitor-failure">{{ t(`userMonitor.${failure}`) }}</p>
          <p v-for="issue in issues" :key="issue" class="um-notice um-alert" role="alert">{{ t(`userMonitor.issue.${issue}`) }}</p>
          <p v-if="!loading && !catalog.length" class="um-panel um-empty">{{ t('userMonitor.noDirectory') }}</p>

          <template v-if="selectedGroup">
            <section class="um-panel um-summary">
              <div class="um-summary-title"><PlatformIcon :platform="platform as GroupPlatform" size="lg" /><div><h2 :title="selectedGroup.name">{{ platformDisplayName(platform) }} · {{ selectedGroup.name }}</h2><GroupBadge :name="selectedGroup.name" :platform="selectedGroup.platform" :rate-multiplier="selectedGroup.rate_multiplier" :user-rate-multiplier="issues.includes('rates') ? null : rates[selectedGroup.id]" :peak-rate-enabled="selectedGroup.peak_rate_enabled" :peak-start="selectedGroup.peak_start" :peak-end="selectedGroup.peak_end" :peak-rate-multiplier="selectedGroup.peak_rate_multiplier" always-show-rate /><p>{{ t('userMonitor.passive') }}</p></div></div>
              <div class="um-summary-metrics"><div><strong>{{ models.length }}</strong><small>{{ t('userMonitor.authorizedModels') }}</small></div><div><strong>{{ measuredCount }}</strong><small>{{ t('userMonitor.observedModels') }}</small></div></div>
            </section>
            <div v-if="coverage && !failure" class="um-coverage"><span>{{ t('userMonitor.updated') }} {{ dateTime(coverage.data_through) }}</span><span>{{ t('userMonitor.computed') }} {{ dateTime(coverage.computed_at) }}</span><span>{{ t('userMonitor.lag', { seconds: coverage.aggregation_lag_seconds }) }}</span><span v-for="condition in conditions" :key="condition" class="um-warning">{{ t(`userMonitor.${condition}`) }}<template v-if="condition === 'bootstrap'"> {{ coverage.bootstrap?.progress_percent }}%</template></span></div>
            <div class="um-model-grid">
              <article v-for="entry in filteredModels" :key="dimensionKey(entry.platform, entry.group.id, entry.model)" class="um-panel um-model" :class="{ selected: model === entry.model }" :data-model="entry.model">
                <div class="um-model-head"><PlatformIcon :platform="entry.platform as GroupPlatform" size="md" /><button class="um-model-name" :title="entry.model" :aria-pressed="model === entry.model" @click="model = entry.model">{{ entry.model }}</button><span class="um-health" :class="health(entry)">{{ t(`userMonitor.health.${health(entry)}`) }}</span></div>
                <p class="um-model-context">{{ selectedGroup.name }} · {{ t(`userMonitor.ranges.${range}`) }}</p>
                <p v-if="sample(entry) !== 'measured' && !failure && !loading" class="um-sample">{{ t(`userMonitor.${sample(entry)}`) }}<template v-if="sample(entry) === 'insufficient'"> · {{ t('userMonitor.minimum', { count: rowFor(entry)?.health.minimum_sample }) }}</template></p>
                <div class="um-kpis"><div><strong>{{ score(entry) }}</strong><small>{{ t('userMonitor.score') }}</small></div><div><strong>{{ metric(entry, 'error') }}</strong><small>{{ t('userMonitor.errorRate') }}</small></div><div><strong>{{ metric(entry, 'duration') }}</strong><small>{{ t('userMonitor.duration') }}</small></div><div><strong>{{ metric(entry, 'ttft') }}</strong><small>{{ t('userMonitor.ttft') }}</small></div></div>
                <p v-if="hasSamples(entry)" class="um-percentile">{{ t('userMonitor.p95') }} {{ millis(rowFor(entry)?.metrics.ttft.p95_ms) }}</p>
                <div v-if="tokenPrices(entry)" class="um-card-prices"><small>{{ t('userMonitor.standardPrices') }}</small><div v-for="(value,field) in tokenPrices(entry)" :key="field"><span>{{ t(`userMonitor.priceFields.${field}`) }}</span><b>{{ value }}</b></div></div>
                <div class="um-price-preview"><span>{{ tokenPrices(entry) ? t('userMonitor.tokenUnit') : t('userMonitor.rulePricing') }}</span><button @click="priceEntry = entry">{{ t('userMonitor.priceDetails') }} <Icon name="chevronRight" size="sm" /></button></div>
                <div v-if="!failure && !loading && rowFor(entry)?.buckets.length" class="um-history" :aria-label="t('userMonitor.history')" role="img"><span v-for="bucket in rowFor(entry)!.buckets" :key="bucket.bucket_start" :class="bucket.health.overall" :title="`${dateTime(bucket.bucket_start)} · ${t(`userMonitor.health.${bucket.health.overall}`)} · ${bucket.health.score ?? '—'}`" /></div>
                <p v-else class="um-history-empty">{{ t('userMonitor.noTrend') }}</p>
                <div class="um-model-footer"><span>{{ t('userMonitor.history') }}</span><button :aria-pressed="model === entry.model" @click="model = entry.model">{{ t('userMonitor.selectKeys') }} <Icon name="chevronRight" size="sm" /></button></div>
              </article>
            </div>
            <p v-if="!filteredModels.length" class="um-panel um-empty">{{ t('userMonitor.emptyFilter') }}</p>
          </template>
        </div>
        <aside class="um-side">
          <section class="um-panel um-intro"><template v-if="selected"><div class="um-side-heading"><PlatformIcon :platform="platform as GroupPlatform" size="lg" /><div><h3>{{ platformDisplayName(platform) }} · {{ selected.group.name }}</h3><p :title="selected.model">{{ selected.model }}</p></div></div><p class="um-help">{{ t('userMonitor.authorizedKeys') }}</p><button class="um-primary-button" :disabled="issues.includes('groups') || issues.includes('rates')" @click="goKeys('create')"><Icon name="plus" size="sm" />{{ t('keys.createKey') }}</button><button class="um-secondary-button" @click="goKeys()">{{ t('userMonitor.viewKeys') }} <Icon name="externalLink" size="sm" /></button><div class="um-endpoint"><span>{{ t('userKeys.endpoint') }}</span><code>{{ endpoint }}</code><button :aria-label="t('common.copy')" @click="copy(endpoint)"><Icon name="clipboard" size="sm" /></button></div><p v-if="selected.group.platform === 'composite'" class="um-help">{{ t('userMonitor.composite') }}</p></template><p v-else class="um-help">{{ t('userMonitor.selectModel') }}</p></section>
          <section class="um-panel um-linked"><h3>{{ t('userMonitor.linkedKeys') }} <small>{{ issues.includes('keys') ? '—' : linked.length }}</small></h3><template v-if="!issues.includes('keys')"><div v-for="key in linked.slice(0,4)" :key="key.id" class="um-key"><span class="um-key-dot" :class="effectiveKeyStatus(key, now)" /><div><b :title="key.name">{{ key.name }}</b><code>{{ maskApiKey(key.key) }}</code><small>{{ t(`keys.status.${effectiveKeyStatus(key, now)}`) }}</small></div><button :aria-label="t('userMonitor.openKey', { name: key.name })" @click="goKeys(undefined, key.id)"><Icon name="chevronRight" size="sm" /></button></div><p v-if="!linked.length" class="um-help">{{ t('userMonitor.noKeys') }}</p><button v-if="linked.length > 4" class="um-text-button" @click="goKeys()">{{ t('userMonitor.viewKeys') }}</button></template></section>
        </aside>
      </div>
    </div>
    <BaseDialog :show="!!priceEntry" :title="`${priceEntry?.model || ''} · ${t('userMonitor.priceDetails')}`" width="wide" panel-class="um-dialog dark" trap-focus @close="priceEntry = null">
      <template v-if="priceEntry"><p class="um-price-note">{{ t('userMonitor.priceNote') }}</p><p v-if="priceEntry.group.peak_rate_enabled" class="um-price-note">{{ t('modelPlaza.detail.peakNote', { window: formatPeakRateWindow(priceEntry.group, serverTimezoneLabel(app.cachedPublicSettings?.server_utc_offset)), multiplier: priceEntry.group.peak_rate_multiplier }) }}</p><p v-if="priceEntry.plaza?.group.long_context_pricing_enabled === false" class="um-price-note">{{ t('modelPlaza.detail.longContextDisabledNote') }}</p><PlazaModelPricingTable v-if="priceEntry.plaza && !issues.includes('rates')" :models="[priceEntry.plaza.model]" :platform="priceEntry.platform" :rate-multiplier="priceEntry.plaza.group.rate_multiplier" :user-rate-multiplier="rates[priceEntry.group.id]" :image-rate-independent="priceEntry.plaza.group.image_rate_independent" :image-rate-multiplier="priceEntry.plaza.group.image_rate_multiplier" :video-rate-independent="priceEntry.plaza.group.video_rate_independent" :video-rate-multiplier="priceEntry.plaza.group.video_rate_multiplier" :peak-window="formatPeakRateWindow(priceEntry.group, serverTimezoneLabel(app.cachedPublicSettings?.server_utc_offset))" :peak-rate-multiplier="priceEntry.group.peak_rate_multiplier" />
        <template v-else><p>{{ t('userMonitor.basePriceOnly') }}</p><div v-for="source in priceEntry.sources" :key="source.channel" class="um-source-price"><h4>{{ source.channel }}</h4><ChannelPriceReference :model="source.model" /></div><p v-if="!priceEntry.sources.length">{{ t('userMonitor.priceUnknown') }}</p></template>
      </template>
    </BaseDialog>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import PlatformIcon from '@/components/common/PlatformIcon.vue'
import GroupBadge from '@/components/common/GroupBadge.vue'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import PlazaModelPricingTable from '@/components/modelPlaza/PlazaModelPricingTable.vue'
import ChannelPriceReference from './ChannelPriceReference.vue'
import { useUserChannelStatus } from '@/composables/useUserChannelStatus'
import { useAppStore } from '@/stores/app'
import { useClipboard } from '@/composables/useClipboard'
import { maskApiKey } from '@/utils/maskApiKey'
import { platformDisplayName } from '@/constants/platformCatalog'
import { formatPeakRateWindow, serverTimezoneLabel } from '@/utils/peak-rate'
import type { GroupPlatform } from '@/types'
import { effectiveKeyStatus } from './keysConsole'
import { coverageConditions, dimensionKey, keysQuery, sampleState, simpleTokenPrices, type CatalogModel } from './channelStatusConsole'
import '@/styles/user-channel-status.css'

const { t } = useI18n()
const router = useRouter()
const app = useAppStore()
const { copyToClipboard: copy } = useClipboard()
const { range, platform, groupId, model, catalog, rates, coverage, loading, failure, issues, refreshSeconds, now, vendors, groups, models, selected, linked, rowFor, choosePlatform, chooseGroup, reload } = useUserChannelStatus()
const status = ref('')
const priceEntry = ref<CatalogModel | null>(null)
const ranges = ['90m', '24h', '7d', '30d'] as const
const conditions = computed(() => coverageConditions(coverage.value, refreshSeconds.value, now.value))
const selectedGroup = computed(() => groups.value.find(group => group.id === groupId.value))
const endpoint = computed(() => app.cachedPublicSettings?.api_base_url || window.location.origin)
const sample = (entry: CatalogModel) => sampleState(rowFor(entry))
const tokenPrices = (entry: CatalogModel) => simpleTokenPrices(entry, rates.value[entry.group.id], !issues.value.includes('rates'))
const health = (entry: CatalogModel) => failure.value || loading.value || conditions.value.includes('stale') ? 'unknown' : rowFor(entry)?.health.overall || 'unknown'
const filteredModels = computed(() => models.value.filter(entry => !status.value || health(entry) === status.value))
const measuredCount = computed(() => failure.value || loading.value ? '—' : models.value.filter(entry => ['measured', 'insufficient'].includes(sample(entry))).length)
const dateTime = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—'
const millis = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? `${value.toLocaleString()} ms` : '—'
const hasSamples = (entry: CatalogModel) => !failure.value && !loading.value && ['measured', 'insufficient'].includes(sample(entry))
const score = (entry: CatalogModel) => hasSamples(entry) && rowFor(entry)?.health.overall !== 'unknown' && typeof rowFor(entry)?.health.score === 'number' ? `${rowFor(entry)!.health.score!.toFixed(1)} / 100` : '—'
function metric(entry: CatalogModel, field: 'error' | 'duration' | 'ttft') {
  if (!hasSamples(entry)) return '—'
  const metrics = rowFor(entry)!.metrics
  return field === 'error' ? Number.isFinite(metrics.error_rate) ? `${(metrics.error_rate * 100).toFixed(2)}%` : '—' : millis(field === 'duration' ? metrics.duration.avg_ms : metrics.ttft.p50_ms)
}
function goKeys(action?: 'create', keyId?: number) { if (selected.value) void router.push({ path: '/keys', query: keysQuery(selected.value, action, keyId) }) }
// 切换目录后关闭旧的价格弹窗，防止刷新后继续展示旧分组规则。
watch([catalog, platform, groupId], () => { priceEntry.value = null })
</script>
