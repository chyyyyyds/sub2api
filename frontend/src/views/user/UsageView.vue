<template>
  <AppLayout>
    <div class="uc-analytics ua-requests">
      <div class="ua-range-header">
        <p class="ua-scope">{{ t('userAnalytics.naturalDays') }} · {{ analyticsTimezone() }} · {{ t('userAnalytics.successStatsScope') }}</p>
        <div class="ua-toolbar"><UserDateRangePicker v-model:start-date="startDate" v-model:end-date="endDate" @change="onDateRangeChange" /><button class="ua-button ua-refresh" type="button" :aria-label="t('common.refresh')" :disabled="loading || errorLoading" @click="refreshData"><Icon name="refresh" size="sm" /></button></div>
      </div>
      <div v-if="statsFailed || logsFailed || errorsFailed" class="ua-error" role="alert">{{ t('userAnalytics.loadFailed') }}<button class="ua-button" type="button" @click="refreshData">{{ t('userAnalytics.retry') }}</button></div>
      <UserAnalyticsStats :stats="usageStats" :loading="statsLoading" />
      <section class="ua-panel ua-filter-panel">
        <div class="ua-filter-layout">
          <div v-if="activeTab === 'errors'" class="ua-filter-grid">
            <div class="ua-field">
              <label class="input-label">{{ t('usage.errors.keyName') }}</label>
              <Select v-model="errorFilter.api_key_id" dropdown-class="ua-select-menu" :aria-label="t('usage.errors.keyName')" :options="errorKeyOptions" @change="applyErrorFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.errors.model') }}</label>
              <Select
                v-model="errorFilter.model" dropdown-class="ua-select-menu" :aria-label="t('usage.errors.model')"
                :options="errorModelOptions"
                searchable
                creatable
                clearable
                :placeholder="t('usage.errors.modelPlaceholder')"
                @change="applyErrorFilters"
              />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.errors.category') }}</label>
              <Select v-model="errorFilter.category" dropdown-class="ua-select-menu" :aria-label="t('usage.errors.category')" :options="errorCategoryOptions" @change="applyErrorFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.errors.status') }}</label>
              <Select v-model="errorFilter.status_code" dropdown-class="ua-select-menu" :aria-label="t('usage.errors.status')" :options="errorStatusOptions" @change="applyErrorFilters" />
            </div>
          </div>
          <div v-else class="ua-filter-grid">
            <div class="ua-field">
              <label class="input-label">{{ t('usage.apiKeyFilter') }}</label>
              <Select v-model="filters.api_key_id" :placeholder="t('usage.allApiKeys')" dropdown-class="ua-select-menu" :aria-label="t('usage.apiKeyFilter')" :options="apiKeyOptions" @change="applyFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.model') }}</label>
              <Select v-model="filters.model" :placeholder="t('admin.usage.allModels')" dropdown-class="ua-select-menu" :aria-label="t('usage.model')" :options="modelOptions" searchable @change="applyFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('admin.usage.group') }}</label>
              <Select v-model="filters.group_id" :placeholder="t('admin.usage.allGroups')" dropdown-class="ua-select-menu" :aria-label="t('admin.usage.group')" :options="groupOptions" searchable @change="applyFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.type') }}</label>
              <Select v-model="filters.request_type" :placeholder="t('admin.usage.allTypes')" dropdown-class="ua-select-menu" :aria-label="t('usage.type')" :options="requestTypeOptions" @change="applyFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('usage.compactionFilter') }}</label>
              <Select v-model="filters.native_compaction_v2" dropdown-class="ua-select-menu" :aria-label="t('usage.compactionFilter')" :options="compactionOptions" @change="applyFilters" />
            </div>
            <div v-if="subscriptionFeatureEnabled" class="ua-field">
              <label class="input-label">{{ t('admin.usage.billingType') }}</label>
              <Select v-model="filters.billing_type" dropdown-class="ua-select-menu" :aria-label="t('admin.usage.billingType')" :options="billingTypeOptions" @change="applyFilters" />
            </div>
            <div class="ua-field">
              <label class="input-label">{{ t('admin.usage.billingMode') }}</label>
              <Select v-model="filters.billing_mode" dropdown-class="ua-select-menu" :aria-label="t('admin.usage.billingMode')" :options="billingModeOptions" @change="applyFilters" />
            </div>
          </div>

          <div class="ua-filter-actions">
            <button type="button" @click="refreshData" :disabled="activeTab === 'errors' ? errorLoading : loading" class="ua-button">
              {{ t('common.refresh') }}
            </button>
            <button type="button" @click="resetFilters" class="ua-button">
              {{ t('common.reset') }}
            </button>
            <div class="relative" ref="columnDropdownRef">
              <button
                type="button"
                data-testid="usage-column-settings"
                @click="showColumnDropdown = !showColumnDropdown"
                :aria-expanded="showColumnDropdown"
                class="ua-button"
                :title="t('admin.users.columnSettings')"
              >
                <Icon name="grid" size="sm" />
                <span class="hidden md:inline">{{ t('admin.users.columnSettings') }}</span>
              </button>
              <div
                v-if="showColumnDropdown"
                class="ua-column-menu" @keydown.esc="showColumnDropdown = false"
              >
                <button
                  v-for="col in currentToggleableColumns"
                  :key="col.key"
                  type="button"
                  :data-testid="`usage-column-toggle-${col.key}`"
                  :aria-pressed="isCurrentColumnVisible(col.key)"
                  @click="toggleCurrentColumn(col.key)"
                  class="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-dark-700"
                >
                  <span>{{ col.label }}</span>
                  <Icon v-if="isCurrentColumnVisible(col.key)" name="check" size="sm" class="text-primary-500" />
                </button>
              </div>
            </div>
            <button v-if="activeTab !== 'errors'" type="button" @click="exportToCSV" :disabled="exporting" class="ua-button ua-primary">
              {{ exporting ? t('usage.exporting') : t('usage.exportCsv') }}
            </button>
          </div>
        </div>
      </section>

      <div v-if="errorViewEnabled" class="ua-record-switch" role="group" :aria-label="t('userAnalytics.recordKind')">
        <button class="ua-button" :aria-pressed="activeTab === 'usage'" @click="activeTab = 'usage'">
          {{ t('usage.tabs.usage') }}
        </button>
        <button class="ua-button" :aria-pressed="activeTab === 'errors'" @click="switchToErrors">
          {{ t('usage.tabs.errors') }}
        </button>
      </div>

      <template v-if="activeTab === 'usage'">
        <UsageTable
          :data="usageLogs"
          :loading="loading"
          :columns="visibleColumns"
          :server-side-sort="true"
          :show-account-billing="false"
          :show-upstream-endpoint="false"
          default-sort-key="created_at"
          default-sort-order="desc"
          @sort="handleSort"
          @ipGeoBatchFailed="handleIpGeoBatchFailed"
        >
          <template #cell-status><span class="ua-success">{{ t('userAnalytics.success') }}</span></template>
          <template #cell-actions="{ row }"><button type="button" class="ua-detail-button" @click="selectedRequest = row">{{ t('userAnalytics.viewDetail') }} <span aria-hidden="true">›</span></button></template>
        </UsageTable>

        <Pagination
          v-if="pagination.total > 0"
          :page="pagination.page"
          :total="pagination.total"
          :page-size="pagination.page_size"
          @update:page="handlePageChange"
          @update:pageSize="handlePageSizeChange"
        />
      </template>

      <UserErrorRequestsTable
        v-else-if="errorViewEnabled"
        :rows="errorRows"
        :total="errorTotal"
        :loading="errorLoading"
        :page="errorPage"
        :page-size="errorPageSize"
        :visible-column-keys="errVisibleColumnKeys"
        @sort="onErrorSort"
        @update:page="onErrorPage"
        @update:pageSize="onErrorPageSize"
        @ipGeoBatchFailed="handleIpGeoBatchFailed"
      />
      <UserRequestDetail :row="selectedRequest" @close="selectedRequest = null" />
    </div>
  </AppLayout>

</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { FeatureFlags, resolveFeatureFlag } from '@/utils/featureFlags'
import { keysAPI, usageAPI, userGroupsAPI } from '@/api'
import AppLayout from '@/components/layout/AppLayout.vue'
import Pagination from '@/components/common/Pagination.vue'
import Select, { type SelectOption } from '@/components/common/Select.vue'
import UserDateRangePicker from '@/components/user/analytics/UserDateRangePicker.vue'
import UserAnalyticsStats from '@/components/user/analytics/UserAnalyticsStats.vue'
import UserRequestDetail from '@/components/user/analytics/UserRequestDetail.vue'
import { analyticsTimezone, naturalDayRange } from '@/components/user/analytics/analytics'
import '@/styles/user-analytics.css'
import '@/styles/stage7d-visual.css'
import UsageTable from '@/components/admin/usage/UsageTable.vue'
import Icon from '@/components/icons/Icon.vue'
import UserErrorRequestsTable from '@/components/user/UserErrorRequestsTable.vue'
import { getPersistedPageSize } from '@/composables/usePersistedPageSize'
import { formatReasoningEffort } from '@/utils/format'
import { getBillingModeLabel, getDisplayBillingMode as resolveDisplayBillingMode } from '@/utils/billingMode'
import { resolveUsageRequestType, requestTypeToLegacyStream } from '@/utils/usageRequestType'
import type {
  ApiKey,
  Group,
  ModelStat,
  UsageLog,
  UsageQueryParams,
  UsageStatsResponse,
  UserErrorRequest,
} from '@/types'
import type { Column } from '@/components/common/types'
import { COMMON_ERROR_STATUS_CODES } from '@/utils/errorBadges'

const { t } = useI18n()
const appStore = useAppStore()


const usageStats = ref<UsageStatsResponse | null>(null)
const usageLogs = ref<UsageLog[]>([])
const loading = ref(false)
const statsLoading = ref(false)
const statsFailed = ref(false)
const logsFailed = ref(false)
const errorsFailed = ref(false)
const selectedRequest = ref<UsageLog | null>(null)
const exporting = ref(false)
const errorRows = ref<UserErrorRequest[]>([])
const errorLoading = ref(false)
const errorPage = ref(1)
const errorPageSize = ref(20)
const errorSortBy = ref('created_at')
const errorSortOrder = ref<'asc' | 'desc'>('desc')
const errorTotal = ref(0)
const errorFilter = ref<{ model: string | null; category: string; api_key_id: number | null; status_code: number | null }>({
  model: '',
  category: '',
  api_key_id: null,
  status_code: null,
})

const errorKeyOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('usage.errors.allKeys') },
  ...apiKeys.value.map((k) => ({ value: k.id, label: k.name })),
])

// 模型候选取自当前已加载错误中出现过的模型；creatable 允许输入任意片段做后端模糊。
const errorModelOptions = computed<SelectOption[]>(() => {
  const seen = new Set<string>()
  const opts: SelectOption[] = []
  for (const r of errorRows.value) {
    if (r.model && !seen.has(r.model)) {
      seen.add(r.model)
      opts.push({ value: r.model, label: r.model })
    }
  }
  return opts
})

const errorCategoryCodes = ['auth', 'rate_limit', 'quota', 'invalid_request', 'service_unavailable', 'upstream', 'internal', 'cyber']

const errorCategoryOptions = computed<SelectOption[]>(() => [
  { value: '', label: t('usage.errors.allCategories') },
  ...errorCategoryCodes.map((c) => ({ value: c, label: t('usage.errors.categories.' + c) })),
])

// 状态码候选用固定常用列表(与管理端 UsageFilters 共用常量),不受当前页数据限制:
// 后端 status_code 过滤对全量生效,若只列当前页出现过的码,用户就选不到仅在后续页的码。
const errorStatusOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('usage.errors.allStatuses') },
  ...COMMON_ERROR_STATUS_CODES.map((c) => ({ value: c, label: String(c) })),
])

const applyErrorFilters = () => {
  errorPage.value = 1
  void loadErrors()
}

let abortController: AbortController | null = null
let statsReqSeq = 0
let modelStatsReqSeq = 0
let errorController: AbortController | null = null
let statsController: AbortController | null = null
let disposed = false

// 请求明细默认今天，日期参数表示自然日闭区间，不冒充滚动 24 小时。
const defaultRange = naturalDayRange(1)
const startDate = ref(defaultRange.start)
const endDate = ref(defaultRange.end)
const activeTab = ref<'usage' | 'errors'>('usage')
const errorViewEnabled = computed(() => appStore.cachedPublicSettings?.allow_user_view_error_requests ?? false)

const filters = ref<UsageQueryParams>({
  start_date: startDate.value,
  end_date: endDate.value,
  request_type: undefined,
  native_compaction_v2: null,
  billing_type: null,
  billing_mode: null,
})

const pagination = reactive({
  page: 1,
  page_size: getPersistedPageSize(),
  total: 0,
})
const sortState = reactive({
  sort_by: 'created_at',
  sort_order: 'desc' as 'asc' | 'desc',
})

const requestTypeOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('admin.usage.allTypes') },
  { value: 'ws_v2', label: t('usage.ws') },
  { value: 'live', label: t('usage.live') },
  { value: 'stream', label: t('usage.stream') },
  { value: 'sync', label: t('usage.sync') },
])
const compactionOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('usage.allCompactionTypes') },
  { value: true, label: t('usage.compactionOnly') },
])
// 订阅功能关闭后只剩余额计费，「计费类型」筛选（余额/订阅）失去意义，整块隐藏。
const subscriptionFeatureEnabled = computed(() => resolveFeatureFlag(appStore.cachedPublicSettings, FeatureFlags.subscription))
const billingTypeOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('admin.usage.allBillingTypes') },
  { value: 0, label: t('admin.usage.billingTypeBalance') },
  { value: 1, label: t('admin.usage.billingTypeSubscription') },
])
const billingModeOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('admin.usage.allBillingModes') },
  { value: 'token', label: t('admin.usage.billingModeToken') },
  { value: 'per_request', label: t('admin.usage.billingModePerRequest') },
  { value: 'image', label: t('admin.usage.billingModeImage') },
  { value: 'video', label: t('admin.usage.billingModeVideo') },
])

const apiKeys = ref<ApiKey[]>([])
const groups = ref<Group[]>([])
const modelOptionValues = ref<string[]>([])

const apiKeyOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('usage.allApiKeys') },
  ...apiKeys.value.map((key) => ({ value: key.id, label: key.name })),
])
const groupOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('admin.usage.allGroups') },
  ...groups.value.map((group) => ({ value: group.id, label: group.name })),
])
const modelOptions = computed<SelectOption[]>(() => [
  { value: null, label: t('admin.usage.allModels') },
  ...modelOptionValues.value.map((model) => ({ value: model, label: model })),
])

const normalizedFilters = computed<UsageQueryParams>(() => {
  const requestType = filters.value.request_type
  const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : filters.value.stream
  return {
    ...filters.value,
    timezone: analyticsTimezone(),
    start_date: startDate.value,
    end_date: endDate.value,
    stream: legacyStream === null ? undefined : legacyStream,
  }
})

const buildUsageListParams = (page: number, pageSize: number): UsageQueryParams => ({
  page,
  page_size: pageSize,
  ...normalizedFilters.value,
  sort_by: sortState.sort_by,
  sort_order: sortState.sort_order,
})

const loadLogs = async () => {
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller
  loading.value = true
  logsFailed.value = false
  usageLogs.value = []
  pagination.total = 0
  try {
    const res = await usageAPI.query(buildUsageListParams(pagination.page, pagination.page_size), {
      signal: controller.signal,
    })
    if (!controller.signal.aborted && !disposed) {
      usageLogs.value = res.items
      pagination.total = res.total
    }
  } catch (error: any) {
    if (error?.name !== 'AbortError' && error?.code !== 'ERR_CANCELED') {
      if (controller.signal.aborted || disposed) return
      logsFailed.value = true
      appStore.showError(t('usage.failedToLoad'))
    }
  } finally {
    if (abortController === controller) loading.value = false
  }
}

const loadStats = async () => {
  const seq = ++statsReqSeq
  statsController?.abort()
  const controller = new AbortController()
  statsController = controller
  statsLoading.value = true; statsFailed.value = false; usageStats.value = null
  try {
    const stats = await usageAPI.getStats(normalizedFilters.value, undefined, { signal: controller.signal })
    if (seq === statsReqSeq && !controller.signal.aborted && !disposed) usageStats.value = stats
  } catch {
    if (seq === statsReqSeq && !controller.signal.aborted && !disposed) statsFailed.value = true
  } finally { if (seq === statsReqSeq && !disposed) statsLoading.value = false }
}

const loadModelStats = async () => {
  const seq = ++modelStatsReqSeq
  try {
    const response = await usageAPI.getDashboardModels({
      ...normalizedFilters.value,
      model_source: 'requested',
    })
    if (seq !== modelStatsReqSeq) return
    refreshModelOptions(response.models || [])
  } catch (error) {
    if (seq !== modelStatsReqSeq) return
    console.error('Failed to load model stats:', error)
  }
}

const refreshModelOptions = (models: ModelStat[]) => {
  const current = filters.value.model
  const set = new Set(modelOptionValues.value)
  models.forEach((item) => {
    if (item.model) set.add(item.model)
  })
  if (current) set.add(current)
  modelOptionValues.value = Array.from(set).sort()
}

const applyFilters = () => {
  pagination.page = 1
  void loadLogs()
  void loadStats()
  void loadModelStats()
  resetErrorRows()
}

const refreshData = () => {
  void loadLogs()
  void loadStats()
  void loadModelStats()
  if (activeTab.value === 'errors') void loadErrors()
}

const resetFilters = () => {
  const range = naturalDayRange(1)
  startDate.value = range.start
  endDate.value = range.end
  filters.value = {
    start_date: range.start,
    end_date: range.end,
    request_type: undefined,
    native_compaction_v2: null,
    billing_type: null,
    billing_mode: null,
  }
  applyFilters()
  if (activeTab.value === 'errors') {
    errorFilter.value = { model: '', category: '', api_key_id: null, status_code: null }
    applyErrorFilters()
  }
}

const onDateRangeChange = (range: { startDate: string; endDate: string; preset: string | null }) => {
  startDate.value = range.startDate
  endDate.value = range.endDate
  filters.value.start_date = range.startDate
  filters.value.end_date = range.endDate
  applyFilters()
}

const handlePageChange = (page: number) => {
  pagination.page = page
  void loadLogs()
}

const handlePageSizeChange = (pageSize: number) => {
  pagination.page_size = pageSize
  pagination.page = 1
  void loadLogs()
}

const handleSort = (key: string, order: 'asc' | 'desc') => {
  sortState.sort_by = key
  sortState.sort_order = order
  pagination.page = 1
  void loadLogs()
}

const handleIpGeoBatchFailed = () => {
  appStore.showError(t('usage.ipGeo.batchFailed'))
}

const getRequestTypeExportText = (log: UsageLog): string => {
  const requestType = resolveUsageRequestType(log)
  if (requestType === 'cyber') return 'Cyber'
  if (requestType === 'live') return 'Live'
  if (requestType === 'ws_v2') return 'WS'
  if (requestType === 'stream') return 'Stream'
  if (requestType === 'sync') return 'Sync'
  return 'Unknown'
}

const getDisplayBillingMode = (
  row: Pick<UsageLog, 'billing_mode' | 'image_count'> | null | undefined
): string | null | undefined => resolveDisplayBillingMode(row)

const escapeCSVValue = (value: unknown): string => {
  if (value == null) return ''
  const str = String(value)
  const escaped = str.replace(/"/g, '""')
  if (str === '-') return str
  if (/^[=+\-@\t\r]/.test(str)) return `"\'${escaped}"`
  if (/[,"\n\r]/.test(str)) return `"${escaped}"`
  return str
}

const exportToCSV = async () => {
  if (pagination.total === 0) {
    appStore.showWarning(t('usage.noDataToExport'))
    return
  }
  exporting.value = true
  appStore.showInfo(t('usage.preparingExport'))
  try {
    const allLogs: UsageLog[] = []
    const pageSize = 100
    const exportParams = buildUsageListParams(1, pageSize)
    const totalPages = Math.ceil(pagination.total / pageSize)
    for (let page = 1; page <= totalPages; page++) {
      const response = await usageAPI.query({ ...exportParams, page })
      allLogs.push(...response.items)
    }
    if (allLogs.length === 0) {
      appStore.showWarning(t('usage.noDataToExport'))
      return
    }
    const headers = [
      'Time',
      'API Key Name',
      'Model',
      'Reasoning Effort',
      'Inbound Endpoint',
      'IP Address',
      'Type',
      'Billing Mode',
      'Input Tokens',
      'Output Tokens',
      'Cache Read Tokens',
      'Cache Creation Tokens',
      'Rate Multiplier',
      'Billed Cost',
      'Original Cost',
      'First Token (ms)',
      'Duration (ms)',
    ]
    const rows = allLogs.map((log) => [
      log.created_at,
      log.api_key?.name || '',
      log.model,
      formatReasoningEffort(log.reasoning_effort),
      log.inbound_endpoint || '',
      log.ip_address || '',
      getRequestTypeExportText(log),
      getBillingModeLabel(getDisplayBillingMode(log), t),
      log.input_tokens,
      log.output_tokens,
      log.cache_read_tokens,
      log.cache_creation_tokens,
      log.rate_multiplier,
      log.actual_cost.toFixed(8),
      log.total_cost.toFixed(8),
      log.first_token_ms ?? '',
      log.duration_ms ?? '',
    ].map(escapeCSVValue))
    const csvContent = [
      headers.map(escapeCSVValue).join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `usage_${exportParams.start_date}_to_${exportParams.end_date}.csv`
    link.click()
    window.URL.revokeObjectURL(url)
    appStore.showSuccess(t('usage.exportSuccess'))
  } catch (error) {
    console.error('CSV Export failed:', error)
    appStore.showError(t('usage.exportFailed'))
  } finally {
    exporting.value = false
  }
}

const ALWAYS_VISIBLE = ['created_at', 'actions']
const DEFAULT_HIDDEN_COLUMNS = ['user_agent']
const HIDDEN_COLUMNS_KEY = 'user-usage-hidden-columns'

const allColumns = computed<Column[]>(() => [
  { key: 'api_key', label: t('usage.apiKeyFilter'), sortable: false },
  { key: 'model', label: t('usage.model'), sortable: true },
  { key: 'reasoning_effort', label: t('usage.reasoningEffort'), sortable: false },
  { key: 'endpoint', label: t('usage.endpoint'), sortable: false },
  { key: 'ip_address', label: 'IP', sortable: false },
  { key: 'group', label: t('admin.usage.group'), sortable: false },
  { key: 'stream', label: t('usage.type'), sortable: false },
  { key: 'billing_mode', label: t('admin.usage.billingMode'), sortable: false },
  { key: 'tokens', label: t('usage.tokens'), sortable: false },
  { key: 'cost', label: t('usage.cost'), sortable: false },
  { key: 'latency', label: t('usage.latency'), sortable: false },
  { key: 'created_at', label: t('usage.time'), sortable: true },
  { key: 'user_agent', label: t('usage.userAgent'), sortable: false },
  { key: 'status', label: t('userAnalytics.status'), sortable: false },
  { key: 'actions', label: t('common.actions'), sortable: false },
])

const hiddenColumns = reactive<Set<string>>(new Set())
const toggleableColumns = computed(() => allColumns.value.filter((col) => !ALWAYS_VISIBLE.includes(col.key)))
const visibleColumns = computed(() =>
  allColumns.value.filter((col) => ALWAYS_VISIBLE.includes(col.key) || !hiddenColumns.has(col.key))
)
const isColumnVisible = (key: string) => !hiddenColumns.has(key)
const toggleColumn = (key: string) => {
  if (hiddenColumns.has(key)) hiddenColumns.delete(key)
  else hiddenColumns.add(key)
  localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify([...hiddenColumns]))
}
const loadSavedColumns = () => {
  try {
    const saved = localStorage.getItem(HIDDEN_COLUMNS_KEY)
    const values = saved ? JSON.parse(saved) as string[] : DEFAULT_HIDDEN_COLUMNS
    values.forEach((key) => hiddenColumns.add(key))
  } catch {
    DEFAULT_HIDDEN_COLUMNS.forEach((key) => hiddenColumns.add(key))
  }
}

// 错误请求 tab 独立列设置(机制同用量列设置,存储互不影响)
const ERR_ALWAYS_VISIBLE = ['status', 'created_at']
const ERR_DEFAULT_HIDDEN_COLUMNS = ['user_agent']
const ERR_HIDDEN_COLUMNS_KEY = 'user-usage-error-hidden-columns'

// key 须与 UserErrorRequestsTable 的 allColumns 一致
const errAllColumns = computed<Column[]>(() => [
  { key: 'key_name', label: t('usage.errors.keyName') },
  { key: 'model', label: t('usage.errors.model') },
  { key: 'endpoint', label: t('usage.errors.endpoint') },
  { key: 'client_ip', label: 'IP' },
  { key: 'group', label: t('admin.usage.group') },
  { key: 'type', label: t('usage.type') },
  { key: 'platform', label: t('usage.errors.platform') },
  { key: 'category', label: t('usage.errors.category') },
  { key: 'status', label: t('usage.errors.status') },
  { key: 'message', label: t('usage.errors.message') },
  { key: 'created_at', label: t('usage.errors.time') },
  { key: 'user_agent', label: t('usage.userAgent') },
])

const errHiddenColumns = reactive<Set<string>>(new Set())
const errToggleableColumns = computed(() =>
  errAllColumns.value.filter((col) => !ERR_ALWAYS_VISIBLE.includes(col.key))
)
const errVisibleColumnKeys = computed(() =>
  errAllColumns.value
    .filter((col) => ERR_ALWAYS_VISIBLE.includes(col.key) || !errHiddenColumns.has(col.key))
    .map((col) => col.key)
)
const isErrColumnVisible = (key: string) => !errHiddenColumns.has(key)
const toggleErrColumn = (key: string) => {
  if (errHiddenColumns.has(key)) errHiddenColumns.delete(key)
  else errHiddenColumns.add(key)
  localStorage.setItem(ERR_HIDDEN_COLUMNS_KEY, JSON.stringify([...errHiddenColumns]))
}
const loadSavedErrColumns = () => {
  try {
    const saved = localStorage.getItem(ERR_HIDDEN_COLUMNS_KEY)
    const values = saved ? (JSON.parse(saved) as string[]) : ERR_DEFAULT_HIDDEN_COLUMNS
    values.forEach((key) => errHiddenColumns.add(key))
  } catch {
    ERR_DEFAULT_HIDDEN_COLUMNS.forEach((key) => errHiddenColumns.add(key))
  }
}

// 列设置下拉按当前 tab 分发
const currentToggleableColumns = computed(() =>
  activeTab.value === 'errors' ? errToggleableColumns.value : toggleableColumns.value
)
const isCurrentColumnVisible = (key: string) =>
  activeTab.value === 'errors' ? isErrColumnVisible(key) : isColumnVisible(key)
const toggleCurrentColumn = (key: string) => {
  if (activeTab.value === 'errors') toggleErrColumn(key)
  else toggleColumn(key)
}

const showColumnDropdown = ref(false)
const columnDropdownRef = ref<HTMLElement | null>(null)
const handleColumnClickOutside = (event: MouseEvent) => {
  if (columnDropdownRef.value && !columnDropdownRef.value.contains(event.target as HTMLElement)) {
    showColumnDropdown.value = false
  }
}

const loadApiKeys = async () => {
  const firstPage = await keysAPI.list(1, 100)
  const keys = [...firstPage.items]
  for (let page = 2; page <= firstPage.pages && keys.length > 0; page++) {
    const response = await keysAPI.list(page, 100)
    if (response.items.length === 0) break
    keys.push(...response.items)
  }
  return keys
}

const loadFilterOptions = async () => {
  try {
    const [keys, availableGroups] = await Promise.all([
      loadApiKeys(),
      userGroupsAPI.getAvailable(),
    ])
    apiKeys.value = keys
    groups.value = availableGroups
  } catch (error) {
    console.error('Failed to load usage filter options:', error)
  }
}

const resetErrorRows = () => {
  // 筛选变化使缓存的错误列表失效，同时中止旧范围请求。
  errorController?.abort()
  errorsFailed.value = false
  errorRows.value = []
  errorTotal.value = 0
  errorLoading.value = false
  errorPage.value = 1
  if (activeTab.value === 'errors') {
    void loadErrors()
  } else {
    errorRows.value = []
    errorTotal.value = 0
  }
}

const loadErrors = async () => {
  errorController?.abort()
  const controller = new AbortController()
  errorController = controller
  errorLoading.value = true; errorsFailed.value = false
  errorRows.value = []; errorTotal.value = 0
  try {
    const resp = await usageAPI.listMyErrorRequests({
      page: errorPage.value,
      page_size: errorPageSize.value,
      start_date: startDate.value,
      end_date: endDate.value,
      model: (errorFilter.value.model ?? '').trim() || undefined,
      category: errorFilter.value.category || undefined,
      api_key_id: errorFilter.value.api_key_id ?? undefined,
      status_code: errorFilter.value.status_code ?? undefined,
      sort_by: errorSortBy.value,
      sort_order: errorSortOrder.value,
      timezone: analyticsTimezone(),
    }, { signal: controller.signal })
    if (controller.signal.aborted || disposed) return
    errorRows.value = resp.items
    errorTotal.value = resp.total
  } catch (error) {
    if (controller.signal.aborted || disposed) return
    errorsFailed.value = true
    console.error('[UsageView] loadErrors failed:', error)
    appStore.showError(t('usage.errors.failedToLoad'))
  } finally {
    if (errorController === controller && !disposed) errorLoading.value = false
  }
}

const onErrorSort = (sortBy: string, sortOrder: 'asc' | 'desc') => {
  errorSortBy.value = sortBy
  errorSortOrder.value = sortOrder
  errorPage.value = 1
  void loadErrors()
}

const onErrorPage = (page: number) => {
  errorPage.value = page
  void loadErrors()
}

const onErrorPageSize = (pageSize: number) => {
  errorPageSize.value = pageSize
  errorPage.value = 1
  void loadErrors()
}

const switchToErrors = () => {
  activeTab.value = 'errors'
  if (errorRows.value.length === 0) void loadErrors()
}

watch(errorViewEnabled, enabled => { if (!enabled) { activeTab.value = 'usage'; errorController?.abort(); errorRows.value = []; errorTotal.value = 0; errorLoading.value = false } })

onMounted(() => {
  loadSavedColumns()
  loadSavedErrColumns()
  document.addEventListener('click', handleColumnClickOutside)
  void loadFilterOptions()
  refreshData()
})

onUnmounted(() => {
  disposed = true; statsReqSeq++; modelStatsReqSeq++
  abortController?.abort(); errorController?.abort(); statsController?.abort()
  document.removeEventListener('click', handleColumnClickOutside)
})

</script>
