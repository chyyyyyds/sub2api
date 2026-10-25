import { describe, expect, it } from 'vitest'
import { cardTokenPrices, filterMonitoredCatalog, historyPositions, monitorMessages } from '../monitorPresentation'
import { buildCatalog } from '../channelStatusConsole'
import { channels, coverage, group, plaza, pricing, row } from './channelStatusFixtures'

const start = '2026-10-24T00:00:00Z'
const window = coverage({ requested_start: start, requested_end: '2026-10-25T00:00:00Z', bucket_seconds: 3600 })
const bucket = (hour: number, state: 'healthy' | 'warning' | 'unknown' = 'unknown') => ({ ...row(1, 'openai', 'model-X', state).buckets[0], bucket_start: new Date(Date.parse(start) + hour * 3600000).toISOString() })

describe('渠道状态纯展示映射', () => {
  it('原生24h窗口填充24个真实时间位置，只保留对应桶的原始健康', () => {
    const slots = historyPositions([bucket(3, 'healthy'), bucket(9, 'warning'), bucket(23)], window)
    expect(slots).toHaveLength(24)
    expect(slots.filter(slot => slot.observed)).toHaveLength(3)
    expect(slots.filter(slot => slot.state === 'healthy')).toHaveLength(1)
    expect(slots[0]).toMatchObject({ state: 'unknown', observed: false })
    expect(slots[3].state).toBe('healthy')
    expect(slots[9].state).toBe('warning')
    expect(slots[23]).toMatchObject({ state: 'unknown', observed: true })
    expect(slots[23].end).toBe('2026-10-25T00:00:00.000Z')
  })
  it('7d使用14个原生12小时位置，未填造32段绿条', () => {
    expect(historyPositions([], { ...window, requested_end: '2026-10-31T00:00:00Z', bucket_seconds: 43200 })).toHaveLength(14)
    expect(historyPositions([], window).every(slot => slot.state === 'unknown')).toBe(true)
  })
  it('过期数据撤下绿色，失败不复用旧健康', () => {
    expect(historyPositions([bucket(0, 'healthy')], window, true).every(slot => slot.state === 'unknown')).toBe(true)
  })
  it('缺少边界或非原生对齐时保留真实数量，不强行合并', () => {
    const raw = [bucket(1), bucket(2, 'warning')]
    expect(historyPositions(raw, { ...window, requested_end: undefined })).toHaveLength(2)
    expect(historyPositions(raw, { ...window, requested_start: '2026-10-24T00:30:00Z' })).toHaveLength(2)
    expect(historyPositions(raw, { ...window, bucket_seconds: 0 })).toHaveLength(2)
  })
  it('重复区间的健康不覆盖为绿色', () => {
    expect(historyPositions([bucket(0, 'healthy'), bucket(0)], window)[0]).toMatchObject({ state: 'unknown', observed: false })
  })
  it('最低档价格可显示，独立一小时缓存和分时规则仍原样保留', () => {
    const entry = buildCatalog([], [group(2)], plaza())[0]
    expect(cardTokenPrices(entry, .085)).toMatchObject({ input_price: '$0.17', output_price: '$0.68', cache_read_price: '$0.017', cache_write_price: '$0.2125' })
    expect(entry.plaza!.model.pricing!.intervals).toHaveLength(1)
    expect(entry.plaza!.model.time_pricing).toBeDefined()
    expect(cardTokenPrices(entry, .085, false)).toBeUndefined()
  })
  it('广场关闭时使用渠道普通单价乘分组倍率，用户专属倍率优先且零倍率有效', () => {
    const entry = buildCatalog(channels(), [group(1)], [])[0]
    expect(cardTokenPrices(entry)).toMatchObject({ input_price: '$0.1', output_price: '$0.4', cache_read_price: '$0.01', cache_write_price: '$0.125' })
    expect(cardTokenPrices(entry, .2)?.input_price).toBe('$0.4')
    expect(cardTokenPrices(entry, 0)?.input_price).toBe('$0')
  })
  it('分档按上下文最小档而不是金额最便宜档取价，并解析区间倍率', () => {
    const entry = buildCatalog(channels(), [group(1)], [])[0]
    const base = entry.sources[0].model.pricing!
    const interval = { min_tokens: 0, max_tokens: 272000, input_price: 5e-6, output_price: null, output_multiplier: 3, cache_read_price: null, cache_write_price: null, per_request_price: null }
    base.intervals = [{ ...interval, min_tokens: 272000, max_tokens: null, input_price: 1e-6 }, interval]
    expect(cardTokenPrices(entry, .85)).toMatchObject({ input_price: '$4.25', output_price: '$20.4', cache_read_price: '$0.17', cache_write_price: '$2.125' })
    expect(base.intervals[0].min_tokens).toBe(272000)
  })
  it('缓存未配置保持缺失，明确配置的零价才显示零，不用一小时价冒充通用缓存写入', () => {
    const entry = buildCatalog(channels(), [group(1)], [])[0]
    entry.sources[0].model.pricing = { ...pricing, cache_read_price: 0, cache_write_price: null }
    expect(cardTokenPrices(entry, 1)).toMatchObject({ cache_read_price: '$0', cache_write_price: null })
    entry.sources[0].model.pricing = null
    expect(Object.values(cardTokenPrices(entry)!)).toEqual([null, null, null, null])
  })
  it('冲突来源和非Token规则不伪造唯一Token单价', () => {
    const entry = buildCatalog(channels(), [group(1)], [])[0]
    entry.sources.push({ ...entry.sources[0], model: { ...entry.sources[0].model, pricing: { ...pricing, input_price: 9e-6 } } })
    expect(cardTokenPrices(entry)).toBeUndefined()
    entry.sources.pop()
    entry.sources[0].model.pricing!.billing_mode = 'per_request'
    expect(cardTokenPrices(entry)).toBeUndefined()
  })
  it('只裁剪页面显示，按平台、分组和完整模型名称取交集，不改变原目录', () => {
    const catalog = buildCatalog(channels(), [group(1), group(2), group(3, 'composite')], [])
    const original = JSON.stringify(catalog)
    const scope = { group_ids: [1], platforms: [{ platform: 'openai', models: ['MODEL X', 'private-model', '__other__'] }] }
    expect(filterMonitoredCatalog(catalog, scope).map(entry => [entry.group.id, entry.platform, entry.model])).toEqual([[1, 'openai', 'model-X']])
    expect(filterMonitoredCatalog(catalog, { ...scope, platforms: [{ platform: 'openai', models: ['model'] }] })).toEqual([])
    expect(filterMonitoredCatalog(catalog, null)).toEqual([])
    expect(filterMonitoredCatalog(catalog, { group_ids: [], platforms: [] })).toEqual([])
    expect(filterMonitoredCatalog(catalog, { group_ids: [1], platforms: [{ platform: 'openai', models: [] }] })).toHaveLength(3)
    expect(JSON.stringify(catalog)).toBe(original)
  })
  it('页面专属新增中英文展示键完整', () => {
    expect(Object.keys(monitorMessages.zh.monitorDisplay).sort()).toEqual(Object.keys(monitorMessages.en.monitorDisplay).sort())
    expect(monitorMessages.zh.monitorDisplay.cache_write_price).toBe('缓存写入')
    expect(monitorMessages.zh.monitorDisplay.unconfigured).toBe('未配置')
  })
})
