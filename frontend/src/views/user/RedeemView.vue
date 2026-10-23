<template>
  <AppLayout v-if="!authStore.isSimpleMode">
    <div class="uw-wallet">
      <section class="uw-hero" :aria-label="t('redeem.currentBalance')">
        <div class="uw-hero-icon"><Icon name="creditCard" size="xl" /></div>
        <p>{{ t('redeem.currentBalance') }}</p>
        <strong data-testid="wallet-balance">{{ money(authStore.user?.balance) }}</strong>
        <span>{{ t('redeem.concurrency') }}: {{ authStore.user?.concurrency ?? '—' }} {{ t('redeem.requests') }}</span>
        <i class="uw-arc uw-left" aria-hidden="true"></i><i class="uw-arc uw-right" aria-hidden="true"></i>
      </section>
      <section class="uw-panel uw-code">
        <div class="uw-heading">
          <h2><Icon name="gift" size="md" />{{ t('userWallet.code') }}</h2>
          <button type="button" class="uw-link" @click="highlightStore">{{ t('userWallet.help') }}</button>
        </div>
        <form :aria-busy="submitting" @submit.prevent="handleRedeem">
          <label for="code" class="sr-only">{{ t('redeem.redeemCodeLabel') }}</label>
          <div class="uw-input"><Icon name="gift" size="md" /><input id="code" v-model="redeemCode" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" :placeholder="t('redeem.redeemCodePlaceholder')" :disabled="submitting" aria-describedby="wallet-code-hint" /></div>
          <p id="wallet-code-hint" class="sr-only">{{ t('userWallet.balanceOnly') }}</p>
          <button class="uw-primary" type="submit" :disabled="!redeemCode.trim() || submitting"><Icon :name="submitting ? 'refresh' : 'arrowRight'" size="md" :class="{ 'animate-spin': submitting }" />{{ submitting ? t('redeem.redeeming') : t('userWallet.redeem') }}</button>
        </form>
        <p v-if="redeemAmount !== null" class="uw-notice uw-success" role="status">{{ t('userWallet.success', { amount: money(redeemAmount) }) }}</p>
        <div v-if="errorMessage" class="uw-notice uw-error" role="alert">{{ errorMessage }} <button v-if="resultUnconfirmed" class="uw-link" type="button" :disabled="submitting || refreshingBalance || loadingHistory" @click="reconcileAssets">{{ t('userWallet.checkAssets') }}</button></div>
        <div v-if="balanceRefreshFailed" class="uw-notice uw-warning" role="alert">{{ t('userWallet.refreshFailed') }} <button class="uw-link" type="button" :disabled="refreshingBalance || submitting" @click="refreshBalance">{{ t('userWallet.retryBalance') }}</button></div>
      </section>
      <section ref="storeCard" class="uw-panel uw-store" :class="{ 'uw-highlighted': storeHighlighted }" tabindex="-1" aria-labelledby="wallet-store-title">
        <div class="uw-store-icon"><Icon name="gift" size="xl" /></div>
        <div class="uw-store-text"><h2 id="wallet-store-title">{{ t('userWallet.getCode') }}</h2><p>{{ t('userWallet.storeDescription') }}</p></div>
        <!-- 无明确店铺配置时禁用入口，禁止挪用订阅或余额通知 URL。 -->
        <button type="button" class="uw-secondary" disabled>{{ t('userWallet.storeUnconfigured') }}</button>
        <Icon name="gift" class="uw-watermark" size="xl" aria-hidden="true" />
      </section>
      <section class="uw-panel uw-info">
        <h2><Icon name="infoCircle" size="md" />{{ t('redeem.aboutCodes') }}</h2>
        <ul><li>{{ t('userWallet.once') }}</li><li>{{ t('userWallet.balanceOnly') }}</li><li>{{ t('userWallet.contact') }}<span v-if="contactInfo" class="uw-contact">{{ contactInfo }}</span><span v-else-if="settingsFailed">{{ t('userWallet.contactFailed') }} <button class="uw-link" type="button" :disabled="loadingSettings" @click="loadContact">{{ t('userWallet.retry') }}</button></span><span v-else>{{ loadingSettings ? t('common.loading') : t('userWallet.contactUnconfigured') }}</span></li><li>{{ t('userWallet.serverBalance') }}</li></ul>
        <Icon name="gift" class="uw-watermark" size="xl" aria-hidden="true" />
      </section>
      <section class="uw-panel uw-recent" :aria-busy="loadingHistory" aria-labelledby="wallet-history-title">
        <div class="uw-heading"><h2 id="wallet-history-title"><Icon name="clock" size="md" />{{ t('redeem.recentActivity') }}</h2><span class="uw-muted">{{ t('userWallet.activityCount', { total: historyTotal }) }}</span></div>
        <p v-if="loadingHistory" class="uw-empty" role="status">{{ t('common.loading') }}</p>
        <div v-else-if="historyFailed" class="uw-empty uw-error" role="alert">{{ t('redeem.historyLoadFailed') }} <button type="button" class="uw-link" @click="fetchHistory(requestedHistoryPage)">{{ t('userWallet.retry') }}</button></div>
        <div v-else-if="history.length" class="uw-activities">
          <div v-for="item in history" :key="item.id" class="uw-activity">
            <span class="uw-activity-icon" aria-hidden="true"><Icon :name="isBalance(item.type) ? 'dollar' : item.type === 'subscription' ? 'badge' : knownType(item.type) ? 'bolt' : 'clock'" size="sm" /></span>
            <div class="uw-activity-description"><strong>{{ activityTitle(item) }}</strong><time :datetime="item.used_at || undefined">{{ activityTime(item.used_at) }}</time></div>
            <b :class="{ 'uw-negative': activityNegative(item), 'uw-muted': !knownType(item.type) }">{{ activityValue(item) }}</b>
          </div>
        </div>
        <p v-else class="uw-empty">{{ t('userWallet.empty') }}</p>
        <div class="uw-pagination">
          <span>{{ t('pagination.pageOf', { page: historyPage, total: Math.max(1, Math.ceil(historyTotal / loadedHistoryPageSize)) }) }}</span>
          <label>{{ t('pagination.perPage') }}<select v-model.number="historyPageSize" :disabled="loadingHistory || submitting" @change="fetchHistory(1)"><option v-for="size in [7, 20, 50]" :key="size" :value="size">{{ size }}</option></select></label>
          <button type="button" class="uw-secondary" :disabled="loadingHistory || submitting || historyPage <= 1" @click="fetchHistory(historyPage - 1)">{{ t('pagination.previous') }}</button>
          <button type="button" class="uw-secondary" :disabled="loadingHistory || submitting || historyPage * loadedHistoryPageSize >= historyTotal" @click="fetchHistory(historyPage + 1)">{{ t('pagination.next') }}</button>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { redeemAPI, authAPI, type RedeemHistoryItem } from '@/api'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import { formatDateTime } from '@/utils/format'
import '@/styles/user-wallet.css'

const { t } = useI18n()
const authStore = useAuthStore()
const appStore = useAppStore()
const router = useRouter()
const redeemCode = ref('')
const submitting = ref(false)
const redeemAmount = ref<number | null>(null)
const errorMessage = ref('')
const resultUnconfirmed = ref(false)
const balanceRefreshFailed = ref(false)
const refreshingBalance = ref(false)
const history = ref<RedeemHistoryItem[]>([])
const historyPage = ref(1)
const historyPageSize = ref(7)
const loadedHistoryPageSize = ref(7)
const historyTotal = ref(0)
const loadingHistory = ref(false)
const historyFailed = ref(false)
const requestedHistoryPage = ref(1)
const contactInfo = ref('')
const settingsFailed = ref(false)
const loadingSettings = ref(false)
const storeCard = ref<HTMLElement | null>(null)
const storeHighlighted = ref(false)
let historyRequest = 0
let disposed = false
let flashTimer: ReturnType<typeof setTimeout> | undefined

// 与已验收顶栏使用相同 USD、两位小数格式，余额仅来自认证 Store。
function money(value: number | null | undefined) { return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—' }
const isBalance = (type: string) => ['balance', 'admin_balance'].includes(type)
const knownType = (type: string) => ['balance', 'admin_balance', 'concurrency', 'admin_concurrency', 'subscription'].includes(type)
const activityNegative = (item: RedeemHistoryItem) => (item.type === 'subscription' ? item.validity_days ?? 0 : item.value) < 0
function activityTitle(item: RedeemHistoryItem) {
  const key = item.type === 'balance' ? 'balanceAddedRedeem' : item.type === 'admin_balance' ? item.value < 0 ? 'balanceDeductedAdmin' : 'balanceAddedAdmin' : item.type === 'concurrency' ? 'concurrencyAddedRedeem' : item.type === 'admin_concurrency' ? item.value < 0 ? 'concurrencyReducedAdmin' : 'concurrencyAddedAdmin' : ''
  if (key) return t(`redeem.${key}`)
  if (item.type === 'subscription') return t(activityNegative(item) ? 'userWallet.subscriptionReduced' : 'redeem.subscriptionAssigned')
  return t('userWallet.unknownActivity', { type: item.type })
}
function activityValue(item: RedeemHistoryItem) {
  if (!knownType(item.type)) return '—'
  if (item.type === 'subscription') {
    // 不把金额猜作订阅天数，也不补造缺失的权益值。
    const days = item.validity_days
    return `${days ? `${days > 0 ? '+' : ''}${days} ${t('redeem.days')}` : '—'}${item.group?.name ? ` · ${item.group.name}` : ''}`
  }
  if (!Number.isFinite(item.value)) return '—'
  const sign = item.value >= 0 ? '+' : '−'
  return isBalance(item.type) ? `${sign}${money(Math.abs(item.value))}` : `${sign}${Math.abs(item.value)} ${t('redeem.requests')}`
}
function activityTime(value: string | null) { return value && Number.isFinite(Date.parse(value)) ? formatDateTime(value) : '—' }

// 每次成功兑换必须发起一次新的服务端资料读取，不用响应面值本地累加余额。
let balanceRequest: Promise<void> | undefined
function refreshBalance(): Promise<void> {
  if (balanceRequest) return balanceRequest
  refreshingBalance.value = true
  balanceRequest = authStore.refreshUser().then(() => { if (!disposed) balanceRefreshFailed.value = false }).catch(() => { if (!disposed) balanceRefreshFailed.value = true }).finally(() => { balanceRequest = undefined; if (!disposed) refreshingBalance.value = false })
  return balanceRequest
}
async function loadContact() {
  if (loadingSettings.value) return
  loadingSettings.value = true
  try {
    const settings = await authAPI.getPublicSettings()
    if (!disposed) { contactInfo.value = settings.contact_info || ''; settingsFailed.value = false }
  } catch { if (!disposed) settingsFailed.value = true }
  finally { if (!disposed) loadingSettings.value = false }
}
async function fetchHistory(page = 1) {
  const request = ++historyRequest
  const size = historyPageSize.value
  requestedHistoryPage.value = page
  loadingHistory.value = true
  historyFailed.value = false
  try {
    const result = await redeemAPI.getHistory(page, size)
    if (disposed || request !== historyRequest) return
    history.value = result.items
    historyTotal.value = result.total
    historyPage.value = page
    loadedHistoryPageSize.value = size
  } catch {
    if (disposed || request !== historyRequest) return
    historyPageSize.value = loadedHistoryPageSize.value
    history.value = []
    historyFailed.value = true
  } finally { if (!disposed && request === historyRequest) loadingHistory.value = false }
}
async function handleRedeem() {
  // 在请求前同步置位；程序触发两次 submit 也只会发送一次。
  if (authStore.isSimpleMode || submitting.value || !redeemCode.value.trim()) return
  submitting.value = true
  errorMessage.value = ''
  resultUnconfirmed.value = false
  redeemAmount.value = null
  try {
    const result = await redeemAPI.redeem(redeemCode.value.trim())
    if (disposed) return
    redeemCode.value = ''
    await balanceRequest
    await refreshBalance()
    if (disposed) return
    if (result.type === 'balance' && Number.isFinite(result.value)) {
      redeemAmount.value = result.value
      appStore.showSuccess(t('redeem.codeRedeemSuccess'))
    } else { errorMessage.value = t('userWallet.unexpectedResult') }
    await fetchHistory(1)
  } catch (error: unknown) {
    if (disposed) return
    const failure = error as { reason?: string; message?: string; status?: number; response?: { data?: { detail?: string } } }
    resultUnconfirmed.value = failure.status === 0 || (failure.status ?? 0) >= 500
    const errors: Record<string, string> = { REDEEM_BALANCE_ONLY: 'balanceOnlyError', REDEEM_CODE_NOT_FOUND: 'invalidCode', REDEEM_CODE_USED: 'usedCode', REDEEM_CODE_EXPIRED: 'expiredCode', REDEEM_RATE_LIMITED: 'rateLimited', REDEEM_CODE_LOCKED: 'locked' }
    errorMessage.value = errors[failure.reason || ''] ? t(`userWallet.${errors[failure.reason || '']}`) : failure.status === 0 ? t('userWallet.networkError') : failure.message || failure.response?.data?.detail || t('redeem.failedToRedeem')
    appStore.showError(t('redeem.redeemFailed'))
  } finally { if (!disposed) submitting.value = false }
}
async function reconcileAssets() {
  // 网络错误可能发生在事务提交之后，只读取事实，绝不自动重试兑换。
  await balanceRequest
  await Promise.all([refreshBalance(), fetchHistory(1)])
}
async function highlightStore() {
  if (flashTimer) clearTimeout(flashTimer)
  storeHighlighted.value = false
  await nextTick()
  if (disposed) return
  storeHighlighted.value = true
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  storeCard.value?.focus({ preventScroll: true })
  storeCard.value?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  flashTimer = setTimeout(() => { storeHighlighted.value = false }, 1800)
}
// 首次认证刷新可能晚于路由守卫，模式补齐后立即撤下钱包并沿用原重定向目标。
watch(() => authStore.isSimpleMode, simple => {
  if (simple) void router.replace(authStore.isAdmin ? '/admin/dashboard' : '/dashboard')
}, { immediate: true })
onMounted(() => { if (authStore.isSimpleMode) return; void refreshBalance(); void fetchHistory(); void loadContact() })
onUnmounted(() => { disposed = true; historyRequest++; if (flashTimer) clearTimeout(flashTimer) })
</script>
