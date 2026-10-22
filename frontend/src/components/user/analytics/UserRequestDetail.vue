<template>
  <dialog ref="dialog" class="ua-dialog" aria-modal="true" aria-labelledby="ua-request-detail-title" @cancel.prevent="emit('close')" @keydown.tab="trapFocus" @click="outside">
    <header><h2 id="ua-request-detail-title">{{ t('userAnalytics.requestDetail') }} #{{ row?.id }}</h2><button type="button" class="ua-button" :aria-label="t('common.close')" @click="emit('close')"><Icon name="x" size="sm" /></button></header>
    <div class="ua-dialog-body">
      <div v-if="loading" role="status">{{ t('common.loading') }}</div>
      <div v-else-if="failed" class="ua-error" role="alert">{{ t('userAnalytics.loadFailed') }}<button class="ua-button" type="button" @click="load">{{ t('userAnalytics.retry') }}</button></div>
      <dl v-else-if="detail" class="ua-details"><div v-for="field in fields" :key="field.label"><dt>{{ field.label }}</dt><dd>{{ field.value ?? '—' }}</dd></div></dl>
    </div>
    <footer><button type="button" class="ua-button ua-primary" @click="emit('close')">{{ t('common.close') }}</button></footer>
  </dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usageAPI } from '@/api/usage'
import type { UsageLog } from '@/types'
import Icon from '@/components/icons/Icon.vue'
import { formatDateTime, formatReasoningEffort } from '@/utils/format'
import { getBillingModeLabel, getDisplayBillingMode } from '@/utils/billingMode'
import { resolveUsageRequestType } from '@/utils/usageRequestType'
import { duration, money } from './analytics'
const props = defineProps<{ row: UsageLog | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const dialog = ref<HTMLDialogElement | null>(null)
const detail = ref<UsageLog | null>(null)
const loading = ref(false)
const failed = ref(false)
let version = 0
let previousFocus: HTMLElement | null = null
let previousOverflow = ''
const fields = computed(() => {
  const r = detail.value
  if (!r) return []
  return [
    { label: t('usage.time'), value: formatDateTime(r.created_at) }, { label: t('usage.apiKeyFilter'), value: r.api_key?.name },
    { label: t('usage.model'), value: r.model },
    { label: t('usage.reasoningEffort'), value: formatReasoningEffort(r.reasoning_effort) }, { label: t('usage.endpoint'), value: r.inbound_endpoint },
    { label: 'IP', value: r.ip_address }, { label: t('admin.usage.group'), value: r.group?.name },
    { label: t('usage.type'), value: resolveUsageRequestType(r) }, { label: t('admin.usage.billingMode'), value: getBillingModeLabel(getDisplayBillingMode(r), t) },
    { label: t('userAnalytics.input'), value: r.input_tokens?.toLocaleString() }, { label: t('userAnalytics.output'), value: r.output_tokens?.toLocaleString() },
    { label: t('userAnalytics.cacheRead'), value: r.cache_read_tokens?.toLocaleString() }, { label: t('userAnalytics.cacheWrite'), value: r.cache_creation_tokens?.toLocaleString() },
    { label: `${t('userAnalytics.cacheWrite')} 5m`, value: r.cache_creation_5m_tokens?.toLocaleString() }, { label: `${t('userAnalytics.cacheWrite')} 1h`, value: r.cache_creation_1h_tokens?.toLocaleString() },
    { label: t('userAnalytics.actualCost'), value: money(r.actual_cost, 8) }, { label: t('userAnalytics.standardCost'), value: money(r.total_cost, 8) },
    { label: t('userAnalytics.rateMultiplier'), value: r.rate_multiplier }, { label: t('usage.latencyFirstToken'), value: duration(r.first_token_ms) },
    { label: t('usage.latencyDuration'), value: duration(r.duration_ms) }, { label: t('userAnalytics.requestId'), value: r.request_id },
    { label: t('usage.userAgent'), value: r.user_agent },
  ]
})
async function load() {
  const id = props.row?.id
  if (id == null) return
  const current = ++version
  loading.value = true; failed.value = false; detail.value = null
  try { const data = await usageAPI.getById(id); if (current === version) detail.value = data }
  catch { if (current === version) failed.value = true }
  finally { if (current === version) loading.value = false }
}
function restore() {
  dialog.value?.close()
  if (previousFocus) { document.body.style.overflow = previousOverflow; previousFocus.focus(); previousFocus = null }
}
watch(() => props.row, async row => {
  if (row) {
    if (!previousFocus) { previousFocus = document.activeElement as HTMLElement; previousOverflow = document.body.style.overflow }
    await nextTick()
    if (!props.row) return
    dialog.value?.showModal(); document.body.style.overflow = 'hidden'; void load()
  } else { version++; restore() }
})
function outside(event: MouseEvent) { if (event.target === dialog.value) { const r = dialog.value!.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) emit('close') } }
// 显式环绕首尾焦点，防止 Shift+Tab 从原生 dialog 进入浏览器工具栏。
function trapFocus(event: KeyboardEvent) {
  const nodes = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')
  if (!nodes?.length) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
onBeforeUnmount(() => { version++; restore() })
</script>
