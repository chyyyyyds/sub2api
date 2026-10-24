import { describe, expect, it } from 'vitest'
import { cardTokenPrices, historyPositions, monitorMessages } from '../monitorPresentation'
import { buildCatalog } from '../channelStatusConsole'
import { coverage, group, plaza, row } from './channelStatusFixtures'

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
  it('独立缓存写入、阶梯、分时等复杂计费均交给原价格详情', () => {
    const entry = buildCatalog([], [group(2)], plaza())[0]
    expect(cardTokenPrices(entry, .085)).toBeUndefined()
    entry.plaza!.model.time_pricing = undefined
    entry.plaza!.model.pricing!.intervals = []
    expect(cardTokenPrices(entry, .085)).toBeUndefined()
    entry.plaza!.model.pricing!.cache_write_1h_price = null
    expect(cardTokenPrices(entry, .085)).toMatchObject({ input_price: '$0.17', output_price: '$0.68', cache_read_price: '$0.017', cache_write_price: '$0.2125' })
    expect(cardTokenPrices(entry, .085, false)).toBeUndefined()
  })
  it('页面专属新增中英文展示键完整', () => {
    expect(Object.keys(monitorMessages.zh.monitorDisplay).sort()).toEqual(Object.keys(monitorMessages.en.monitorDisplay).sort())
  })
})
