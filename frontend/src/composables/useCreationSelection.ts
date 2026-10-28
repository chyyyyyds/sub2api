import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import { keysAPI } from '@/api/keys'
import { useAuthStore } from '@/stores/auth'
import type { ApiKey } from '@/types'
import { imageModelCandidates } from '@/lib/canvas-host-bridge'

/** @description 创作工作台类型；视频能力在 C1 核实后接入。 */
export type CreationKind = 'chat' | 'image' | 'video'
/** @description 仅保存本人密钥的显示元数据与网关授权模型，不保存明文凭证。 */
interface KeyCatalog {
  /** @description 是否为当前用户有效且额度未耗尽的密钥；不可用项仅展示，不允许选择。 */
  available: boolean
  /** @description 用户密钥 ID。 */
  id: number
  /** @description 用户密钥名称。 */
  name: string
  /** @description 所属分组显示名称。 */
  groupName: string
  /** @description 该密钥通过现有网关实际读取的模型。 */
  models: string[]
  /** @description 是否允许图片生成。 */
  imageAllowed: boolean
  /** @description 模型目录是否读取失败，失败时禁止自动匹配。 */
  failed: boolean
}
/** @description 只驻留组件内存的已验证配置；禁止日志、持久化或导出。 */
export interface CreationCredential {
  /** @description 当前登录用户 ID。 */
  userId: number
  /** @description 已验证所属权的用户密钥 ID。 */
  keyId: number
  /** @description 用户密钥显示名称。 */
  keyName: string
  /** @description 仅用于同源网关和可信画布桥接的明文用户密钥。 */
  apiKey: string
  /** @description 当前工作台已授权模型列表。 */
  models: string[]
  /** @description 由 Vue 宿主选择的模型。 */
  model: string
}

/** @description 复用原服务端权限；本地只排除已失效或耗尽的密钥。 */
function isAvailable(key: ApiKey, owner: number) {
  return key.user_id === owner && key.status === 'active' &&
    (!key.expires_at || Date.parse(key.expires_at) > Date.now()) &&
    !(key.quota > 0 && key.quota_used >= key.quota)
}

/** @description 三个工作台共用的模型与用户 Key 选择规则；不改变后端读取权限。 */
export function useCreationSelection(kind: Ref<CreationKind>) {
  const auth = useAuthStore()
  const { t } = useI18n()
  const keys = ref<KeyCatalog[]>([])
  // 只在当前挂载生命周期记住每个工作台的手动选择，不存明文 Key。
  const preferences = ref<Record<CreationKind, { key: number | 'auto'; model: string }>>({
    chat: { key: 0, model: '' }, image: { key: 0, model: '' }, video: { key: 0, model: '' }
  })
  const credential = shallowRef<CreationCredential | null>(null)
  const loadingKeys = ref(false)
  const loadingModels = ref(false)
  const locked = ref(false)
  const error = ref('')
  const notice = ref('')
  let epoch = 0
  let discoveryEpoch = 0
  let controller = new AbortController()
  let discovery = new AbortController()
  let disposed = false
  // 初次发现目录的结果仅在本次选择前驻留内存，使用后立即清空，避免重复查询同一 Key。
  const discoveredCatalogs = new Map<number, { catalog: KeyCatalog; secret: string }>()

  // 旧会话中的 auto 只触发一次默认选择，界面和后续请求始终绑定具体 Key。
  const selectedKey = computed({ get: () => preferences.value[kind.value].key, set: value => { preferences.value[kind.value].key = value === 'auto' ? 0 : value } })
  const selectedModel = computed({ get: () => preferences.value[kind.value].model, set: value => { preferences.value[kind.value].model = value } })
  function candidates(key: KeyCatalog) {
    if (!key.available || key.failed || kind.value === 'video') return []
    if (kind.value === 'image') return key.imageAllowed ? imageModelCandidates(key.models) : []
    return key.models.filter(model => !/image|flux|seedream|dall|video|seedance|sora|veo|kling|hailuo|tts|whisper|audio|pp-sd25|oo-sd25|minimax-h3|mm-h3/i.test(model))
  }
  const models = computed(() => keys.value.filter(key => key.id === selectedKey.value).flatMap(candidates))
  const modelOptions = computed(() => models.value.map(value => ({ value, label: value })))
  const keyOptions = computed(() => keys.value.map(key => ({ value: key.id,
    label: `${key.name}${key.groupName ? ` · ${key.groupName}` : ''}${!key.available ? ` · ${t('imageStudio.keyUnavailable')}` : key.failed ? ` · ${t('imageStudio.catalogFailed')}` : ''}`,
    disabled: !key.available || key.failed })))

  function invalidate() {
    epoch++
    controller.abort()
    controller = new AbortController()
    credential.value = null
    loadingModels.value = false
  }
  /** @description 用本人 Key 调用现有模型网关；返回值只在调用期间包含明文凭证。 */
  async function readCatalog(id: number, signal: AbortSignal, owner: number) {
    const key = await keysAPI.getById(id)
    if (signal.aborted || disposed || auth.user?.id !== owner || !auth.isAuthenticated || !isAvailable(key, owner)) throw new Error('invalid-key')
    const response = await axios.get<{ data?: { id: string }[] }>('/v1/models', {
      signal, timeout: 30000, headers: { Authorization: `Bearer ${key.key}` }
    })
    const catalog: KeyCatalog = {
      available: true,
      id: key.id, name: key.name, groupName: key.group?.name || '', imageAllowed: key.group?.allow_image_generation !== false,
      models: [...new Set((response.data.data || []).map(item => item.id).filter(id => typeof id === 'string' && id.trim()))], failed: false
    }
    return { catalog, secret: key.key }
  }

  async function loadKeys() {
    invalidate()
    discoveredCatalogs.clear()
    discovery.abort()
    discovery = new AbortController()
    const signal = discovery.signal
    const current = ++discoveryEpoch
    keys.value = []
    error.value = ''
    notice.value = ''
    const owner = auth.user?.id
    if (!owner || !auth.isAuthenticated || locked.value) return
    loadingKeys.value = true
    try {
      let page = 1
      const catalogs: KeyCatalog[] = []
      let foundPreferred = false
      while (true) {
        const result = await keysAPI.list(page, 100, undefined, { signal })
        if (signal.aborted || current !== discoveryEpoch) return
        // 目录只保留 ID 和权限元数据，列表里的 Key 不进入响应缓存或持久化。
        for (const key of result.items.filter(key => key.user_id === owner)) {
          if (!isAvailable(key, owner)) {
            catalogs.push({ id: key.id, name: key.name, groupName: key.group?.name || '', available: false, imageAllowed: false, models: [], failed: false })
            continue
          }
          // 已找到默认可用 Key 后，其余目录按选择加载；手动刷新也只核实所选 Key。
          if (foundPreferred || (selectedKey.value && selectedKey.value !== 'auto' && selectedKey.value !== key.id)) {
            catalogs.push({ id: key.id, name: key.name, groupName: key.group?.name || '', available: true, imageAllowed: key.group?.allow_image_generation !== false, models: [], failed: false })
            continue
          }
          try {
            const verified = await readCatalog(key.id, signal, owner)
            if (signal.aborted) return
            catalogs.push(verified.catalog)
            discoveredCatalogs.set(key.id, verified)
            foundPreferred = candidates(verified.catalog).length > 0 && verified.catalog.imageAllowed && imageModelCandidates(verified.catalog.models).some(model => /image|flux|seedream|dall/i.test(model))
          } catch {
            if (signal.aborted) return
            catalogs.push({ id: key.id, name: key.name, groupName: key.group?.name || '', available: true, imageAllowed: false, models: [], failed: true })
          }
        }
        if (page * 100 >= result.total || !result.items.length) break
        page++
      }
      if (signal.aborted || current !== discoveryEpoch || auth.user?.id !== owner) return
      keys.value = catalogs
      if (!catalogs.some(key => key.available)) error.value = t('imageStudio.noKeys')
    } catch { if (!signal.aborted) error.value = t('imageStudio.failed'); return }
    finally { if (current === discoveryEpoch) loadingKeys.value = false }
    await selectCredential()
    discoveredCatalogs.clear()
  }

  /** 每次切换都重新检查本人密钥及网关目录，不能用旧目录绕过白名单、额度或分组权限。 */
  async function selectCredential() {
    invalidate()
    if (loadingKeys.value || locked.value || !auth.user?.id || !auth.isAuthenticated) return
    const current = epoch
    const signal = controller.signal
    const owner = auth.user.id
    const type = kind.value
    const choice = selectedKey.value
    notice.value = ''
    if (!keys.value.length) { error.value = t('imageStudio.noKeys'); return }
    // 视频只提供 Stage A 外壳，绝不将未验证的旧模型作为真实能力展示。
    if (type === 'video') { error.value = ''; return }
    if (!choice || choice === 'auto') {
      const compatible = keys.value.filter(key => candidates(key).length)
      // 按用户 Key 顺序优先选择有明确图片模型的 Key；不把未知别名当成已确认的生图能力。
      const first = compatible.find(key => key.imageAllowed && imageModelCandidates(key.models).some(model => /image|flux|seedream|dall/i.test(model))) || compatible[0] || keys.value.find(key => key.available && !key.failed)
      if (!first) { error.value = t('imageStudio.noKeys'); return }
      selectedKey.value = first.id
      return
    }
    if (!keys.value.some(key => key.id === choice && key.available)) { error.value = t('imageStudio.savedKeyUnavailable'); return }
    if (!selectedModel.value && models.value.length) {
      // 仅为尚无偏好的聊天选择已授权主流模型，不覆盖已有会话或用户手动选择。
      const preferred = type === 'chat' ? ['gpt-6-sol', 'gpt-6.1-sol'].find(model => models.value.includes(model)) : undefined
      selectedModel.value = preferred || models.value[0]
      return
    }
    const eligible = keys.value.filter(key => key.id === choice)
    loadingModels.value = true
    error.value = ''
    try {
      for (const entry of eligible) {
        try {
          const verified = discoveredCatalogs.get(entry.id)
          discoveredCatalogs.clear()
          const { catalog, secret } = verified || await readCatalog(entry.id, signal, owner)
          if (signal.aborted || current !== epoch) return
          keys.value = keys.value.map(item => item.id === entry.id ? catalog : item)
          const allowed = candidates(catalog)
          if (!allowed.includes(selectedModel.value)) {
            if (allowed.length) {
              selectedModel.value = allowed[0]
              notice.value = t('imageStudio.modelAdjusted')
              return
            }
            continue
          }
          credential.value = { userId: owner, keyId: catalog.id, keyName: catalog.name, apiKey: secret, models: allowed, model: selectedModel.value }
          return
        } catch {
          if (signal.aborted) return
          // 当前 Key 目录读取失败时清空旧候选，避免把缓存模型误当成刚核实的权限。
          keys.value = keys.value.map(key => key.id === entry.id ? { ...key, models: [], failed: true } : key)
        }
      }
      error.value = t('imageStudio.incompatible')
    } finally { if (current === epoch) loadingModels.value = false }
  }

  function checkSession() {
    let valid = false
    try { valid = !!localStorage.getItem('auth_token') && JSON.parse(localStorage.getItem('auth_user') || 'null')?.id === auth.user?.id } catch { /* 无法确认登录身份时按失效处理。 */ }
    if (!valid) {
      invalidate()
      discovery.abort()
      discoveredCatalogs.clear()
      keys.value = []
      locked.value = true
      loadingKeys.value = false
      error.value = t('imageStudio.sessionChanged')
    }
  }
  watch([kind, selectedKey, selectedModel], () => { void selectCredential() }, { flush: 'sync' })
  // 多源监听分别比较身份值；同一用户的余额等资料刷新不能被误判成换号。
  watch([() => auth.user?.id, () => auth.isAuthenticated], () => {
    locked.value = false
    preferences.value = { chat: { key: 0, model: '' }, image: { key: 0, model: '' }, video: { key: 0, model: '' } }
    void loadKeys()
  })
  onMounted(() => { window.addEventListener('storage', checkSession); void loadKeys() })
  onBeforeUnmount(() => { disposed = true; invalidate(); discovery.abort(); discoveredCatalogs.clear(); window.removeEventListener('storage', checkSession) })
  return { selectedKey, selectedModel, credential, keys, modelOptions, keyOptions, loadingKeys, loadingModels, locked, error, notice, reload: loadKeys }
}
