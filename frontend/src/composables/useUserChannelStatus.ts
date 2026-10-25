import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import userChannelsAPI from '@/api/channels'
import userGroupsAPI from '@/api/groups'
import { modelPlazaAPI } from '@/api/modelPlaza'
import * as monitorAPI from '@/api/channelMonitorV2'
import type { MonitorMatrixRow, MonitorRange, MonitorCoverage } from '@/api/channelMonitorV2'
import { useAppStore } from '@/stores/app'
import type { ApiKey } from '@/types'
import { collectKeys } from '@/views/user/keysConsole'
import { buildCatalog, dimensionKey, indexMatrix, monitorFailure, relatedKeys, type CatalogModel, type MonitorFailure } from '@/views/user/channelStatusConsole'
import { filterMonitoredCatalog } from '@/views/user/monitorPresentation'

/** 用户页面只读适配，管理员身份访问此页也始终使用普通用户端点。 */
export function useUserChannelStatus() {
  const app = useAppStore()
  const range = ref<MonitorRange>('24h')
  const platform = ref('')
  const groupId = ref<number | null>(null)
  const model = ref('')
  const catalog = ref<CatalogModel[]>([])
  const keys = ref<ApiKey[]>([])
  const rates = ref<Record<number, number>>({})
  const rows = ref(new Map<string, MonitorMatrixRow>())
  const coverage = ref<MonitorCoverage>()
  const loading = ref(false)
  const failure = ref<MonitorFailure | null>(null)
  const issues = ref<string[]>([])
  const refreshSeconds = ref(300)
  const now = ref(Date.now())
  const enabled = computed(() => app.cachedPublicSettings?.channel_monitor_enabled !== false && app.cachedPublicSettings?.channel_monitor_mode === 'v2')
  const vendors = computed(() => [...new Set(catalog.value.map(item => item.platform))])
  const groups = computed(() => [...new Map(catalog.value.filter(item => item.platform === platform.value).map(item => [item.group.id, item.group])).values()])
  const models = computed(() => catalog.value.filter(item => item.platform === platform.value && item.group.id === groupId.value))
  const selected = computed(() => models.value.find(item => item.model === model.value))
  const linked = computed(() => relatedKeys(keys.value, selected.value))
  const rowFor = (entry: CatalogModel) => rows.value.get(dimensionKey(entry.platform, entry.group.id, entry.model))
  let sequence = 0
  let controller: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  function choosePlatform(value: string) {
    platform.value = value
    if (!groups.value.some(group => group.id === groupId.value)) groupId.value = groups.value[0]?.id ?? null
    chooseGroup(groupId.value)
  }
  function chooseGroup(value: number | null) {
    groupId.value = value
    if (!models.value.some(item => item.model === model.value)) model.value = models.value[0]?.model ?? ''
  }
  async function reload() {
    controller?.abort()
    clearTimeout(timer)
    const request = new AbortController()
    controller = request
    const id = ++sequence
    loading.value = true
    // 切换时间或刷新时先撤下旧健康值，不让旧结果冒充新范围。
    rows.value = new Map(); coverage.value = undefined; failure.value = null; issues.value = []
    const settings = app.cachedPublicSettings
    const filter: monitorAPI.MonitorFilter = { range: range.value, platforms: [], groupIds: [], models: [] }
    const withSignal = { signal: request.signal }
    const deadline = setTimeout(() => request.abort(), 30000)
    let finishAbort: (() => void) | undefined
    const aborted = new Promise<null>(resolve => {
      finishAbort = () => resolve(null)
      request.signal.addEventListener('abort', finishAbort, { once: true })
    })
    try {
      const results = await Promise.race([Promise.allSettled([
        userChannelsAPI.getAvailable(withSignal), userGroupsAPI.getAvailable(withSignal), userGroupsAPI.getUserGroupRates(withSignal),
        settings?.model_plaza_enabled === true ? modelPlazaAPI.getModelPlaza(withSignal) : Promise.resolve({ groups: [] }),
        collectKeys({}, request.signal),
        enabled.value ? monitorAPI.getMatrix(filter, 'platform_group_model', false, request.signal) : Promise.resolve(null),
        enabled.value ? monitorAPI.getSnapshot(filter, false, request.signal) : Promise.resolve(null),
        enabled.value ? monitorAPI.getDisplayScope(request.signal) : Promise.resolve(null)
      ] as const), aborted])
      if (disposed || id !== sequence) return
      if (!results || request.signal.aborted) { catalog.value = []; keys.value = []; rates.value = {}; issues.value = ['timeout']; failure.value = 'unavailable'; return }
      const [channels, allowed, userRates, plaza, keyResult, matrix, snapshot, scope] = results
      issues.value = results.flatMap((result, index) => result.status === 'rejected' && index < 5 ? [['channels', 'groups', 'rates', 'pricing', 'keys'][index]] : [])
      catalog.value = allowed.status === 'fulfilled' ? buildCatalog(channels.status === 'fulfilled' ? channels.value : [], allowed.value, plaza.status === 'fulfilled' ? plaza.value.groups : []) : []
      // 仅裁剪此页面的展示目录，原渠道目录、API 密钥及模型调用授权保持不变。
      catalog.value = filterMonitoredCatalog(catalog.value, scope.status === 'fulfilled' ? scope.value : null)
      rates.value = userRates.status === 'fulfilled' ? userRates.value : {}
      keys.value = keyResult.status === 'fulfilled' ? keyResult.value : []
      if (!enabled.value) failure.value = 'disabled'
      else if (scope.status === 'rejected') failure.value = monitorFailure(scope.reason)
      else if (matrix.status === 'rejected') failure.value = monitorFailure(matrix.reason)
      else if (matrix.value) {
        try { rows.value = indexMatrix(matrix.value); coverage.value = matrix.value.coverage } catch { failure.value = 'unavailable' }
      }
      // snapshot 仅提供刷新节奏；健康与趋势一律取精确三维行，禁止用全局摘要填充模型。
      if (snapshot.status === 'fulfilled' && snapshot.value) refreshSeconds.value = snapshot.value.config.refresh_interval_seconds || 300
      else if (snapshot.status === 'rejected') issues.value.push('snapshot')
      if (!vendors.value.includes(platform.value)) platform.value = vendors.value.includes('openai') ? 'openai' : vendors.value[0] || ''
      choosePlatform(platform.value)
    } finally {
      clearTimeout(deadline)
      if (finishAbort) request.signal.removeEventListener('abort', finishAbort)
      if (!disposed && id === sequence) {
        loading.value = false; now.value = Date.now()
        timer = setTimeout(() => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void reload(); else schedule() }, Math.max(60, refreshSeconds.value) * 1000)
      }
    }
  }
  function schedule() { timer = setTimeout(() => { void reload() }, Math.max(60, refreshSeconds.value) * 1000) }
  watch([range, enabled, () => app.cachedPublicSettings?.model_plaza_enabled, () => app.cachedPublicSettings?.available_channels_enabled], () => { void reload() })
  onMounted(() => { void reload() })
  onBeforeUnmount(() => { disposed = true; sequence++; controller?.abort(); clearTimeout(timer); keys.value = []; catalog.value = []; rows.value.clear() })
  return { range, platform, groupId, model, catalog, rates, rows, coverage, loading, failure, issues, refreshSeconds, now, vendors, groups, models, selected, linked, rowFor, choosePlatform, chooseGroup, reload }
}
