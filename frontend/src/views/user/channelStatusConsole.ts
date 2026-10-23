import type { UserAvailableChannel, UserSupportedModel } from '@/api/channels'
import type { ModelPlazaGroup, PlazaModel } from '@/api/modelPlaza'
import type { MonitorCoverage, MonitorMatrixResponse, MonitorMatrixRow } from '@/api/channelMonitorV2'
import type { ApiKey, Group } from '@/types'
import { formatScaled } from '@/utils/pricing'

/** 用户目录的一条精确关联；所有字段仅来自用户读取接口。 */
export interface CatalogModel {
  /** @description 实际模型平台，Composite 投影时保留具体平台。 */
  platform: string
  /** @description 可绑定分组的真实记录。 */
  group: Group
  /** @description 授权目录中的原始模型名，不使用展示标签匹配。 */
  model: string
  /** @description 渠道基础报价，可能存在多个不同来源。 */
  sources: Array<{ channel: string; model: UserSupportedModel }>
  /** @description 同分组同平台同模型的正式完整价格规则。 */
  plaza?: { group: ModelPlazaGroup; model: PlazaModel }
}

/** 三维键使用结构化编码，避免分隔符及同名模型造成碰撞。 */
export const dimensionKey = (platform: string, groupId: number, model: string) => JSON.stringify([platform, groupId, model])

/** 仅完整的平坦 token 规则展示标准时段价，复杂计费始终交给正式详情组件。 */
export function simpleTokenPrices(entry: CatalogModel, userRate?: number, ratesAvailable = true): Record<string, string> | undefined {
  const pricing = entry.plaza?.model.pricing
  if (!ratesAvailable || !pricing || pricing.billing_mode !== 'token' || pricing.intervals?.length || entry.plaza?.model.time_pricing?.periods.length || Object.keys(pricing.reasoning_effort_multipliers || {}).length) return
  const rate = userRate ?? entry.plaza!.group.rate_multiplier
  if (!Number.isFinite(rate) || rate < 0) return
  return Object.fromEntries((['input_price', 'output_price', 'cache_read_price', 'cache_write_price'] as const).map(field => [field, formatScaled(pricing[field] == null ? null : pricing[field] * rate, 1000000)]))
}

/** 先建立授权目录，再叠加监控；绝不从历史监控数据扩张可调用模型。 */
export function buildCatalog(channels: UserAvailableChannel[], allowed: Group[], plaza: ModelPlazaGroup[] = []): CatalogModel[] {
  const groups = new Map(allowed.map(g => [g.id, g]))
  const result = new Map<string, CatalogModel>()
  const ensure = (platform: string, id: number, model: string) => {
    const group = groups.get(id)
    if (!group || !platform || !model || (group.platform !== 'composite' && group.platform !== platform)) return
    const key = dimensionKey(platform, id, model)
    if (!result.has(key)) result.set(key, { platform, group, model, sources: [] })
    return result.get(key)!
  }
  for (const channel of channels) for (const section of channel.platforms) {
    for (const group of section.groups) for (const model of section.supported_models) {
      // Composite 的跨平台能力只信任后端提供的具体 section，不自行推演。
      if (model.platform !== section.platform) continue
      ensure(section.platform, group.id, model.name)?.sources.push({ channel: channel.name, model })
    }
  }
  for (const group of plaza) for (const model of group.models) {
    const entry = ensure(model.platform, group.id, model.name)
    if (entry) entry.plaza = { group, model }
  }
  return [...result.values()].sort((a, b) => a.platform.localeCompare(b.platform) || a.group.id - b.group.id || a.model.localeCompare(b.model))
}

/** 重复三维行或错误聚合维度不能拿来展示，避免覆盖成一个看似正确的健康值。 */
export function indexMatrix(matrix: MonitorMatrixResponse): Map<string, MonitorMatrixRow> {
  if (matrix.group_by !== 'platform_group_model') throw new Error('invalid matrix dimension')
  const result = new Map<string, MonitorMatrixRow>()
  for (const row of matrix.items) {
    if (!row.platform || !Number.isSafeInteger(row.group_id) || row.group_id! <= 0 || !row.model) throw new Error('invalid matrix identity')
    const key = dimensionKey(row.platform, row.group_id!, row.model)
    if (result.has(key)) throw new Error('duplicate matrix identity')
    result.set(key, row)
  }
  return result
}

export type DataCondition = 'bootstrap' | 'pending' | 'partial' | 'stale'
/** 覆盖提示可以并存，延迟不是健康阈值；过期按实际刷新周期的三倍判断。 */
export function coverageConditions(coverage: MonitorCoverage | undefined, refreshSeconds = 300, now = Date.now()): DataCondition[] {
  if (!coverage) return ['pending']
  const result: DataCondition[] = []
  if (coverage.bootstrap?.active) result.push('bootstrap')
  if (!coverage.data_through || !Number.isFinite(Date.parse(coverage.data_through))) result.push('pending')
  if (!coverage.coverage_complete) result.push('partial')
  if (coverage.aggregation_lag_seconds > Math.max(60, refreshSeconds * 2)) result.push('pending')
  const computed = Date.parse(coverage.computed_at)
  if (!Number.isFinite(computed) || now - computed > Math.max(180, refreshSeconds * 3) * 1000) result.push('stale')
  return [...new Set(result)]
}

export type SampleState = 'missing' | 'noSamples' | 'insufficient' | 'measured'
/** 普通用户计数已被置零：用真实 bucket 存在性及后端 health 判断样本，不读取 request_count。 */
export function sampleState(row?: MonitorMatrixRow): SampleState {
  if (!row) return 'missing'
  if (row.health.overall !== 'unknown') return 'measured'
  return row.buckets.length ? 'insufficient' : 'noSamples'
}

/** 仅精确的授权目录能力与真实 group_id 关联，不声称密钥曾请求过所选模型。 */
export function relatedKeys(keys: ApiKey[], entry?: CatalogModel): ApiKey[] {
  return entry ? keys.filter(key => key.group_id === entry.group.id) : []
}

/** Composite 跳转沿用 Stage 3 的真实分组平台筛选，不把密钥限制成单厂商。 */
export function keysQuery(entry: CatalogModel, action?: 'create', keyId?: number): Record<string, string> {
  return { vendor: entry.group.platform, group_id: String(entry.group.id), ...(action ? { action } : {}), ...(keyId ? { key_id: String(keyId) } : {}) }
}

export type MonitorFailure = 'disabled' | 'forbidden' | 'unavailable'
/** 只识别后端明确定义的停用原因，普通 403/404 不冒充未启用。 */
export function monitorFailure(error: unknown): MonitorFailure {
  const value = error as { status?: number; reason?: string; code?: string }
  if (['CHANNEL_MONITOR_DISABLED', 'CHANNEL_MONITOR_MODE_MISMATCH'].includes(value?.reason || value?.code || '')) return 'disabled'
  return value?.status === 401 || value?.status === 403 ? 'forbidden' : 'unavailable'
}
