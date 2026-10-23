import { describe, expect, it } from 'vitest'
import { buildCatalog, coverageConditions, dimensionKey, indexMatrix, keysQuery, monitorFailure, relatedKeys, sampleState, simpleTokenPrices } from '../channelStatusConsole'
import { channels, coverage, group, key, matrix, plaza, row } from './channelStatusFixtures'

describe('用户渠道状态三维及授权契约', () => {
  it('同厂商两个同名分组、同模型保留独立健康和真实倍率', () => {
    const entries = buildCatalog(channels(), [group(1), group(2)])
    const indexed = indexMatrix(matrix())
    const a = entries.find(e => e.group.id === 1 && e.model === 'model-X')!
    const b = entries.find(e => e.group.id === 2 && e.model === 'model-X')!
    expect(a.group.rate_multiplier).toBe(.05)
    expect(b.group.rate_multiplier).toBe(.1)
    expect(indexed.get(dimensionKey(a.platform, 1, a.model))?.health.overall).toBe('healthy')
    expect(indexed.get(dimensionKey(b.platform, 2, b.model))?.health.overall).toBe('warning')
  })
  it('Composite 具体平台分别关联，同名模型不串平台，密钥不限定单厂商', () => {
    const entries = buildCatalog(channels(), [group(3, 'composite')])
    const openai = entries.find(e => e.platform === 'openai' && e.model === 'model-X')!
    const gemini = entries.find(e => e.platform === 'gemini' && e.model === 'model-X')!
    const indexed = indexMatrix(matrix([row(3), row(3, 'gemini', 'model-X', 'warning')]))
    expect(indexed.get(dimensionKey(openai.platform, 3, openai.model))?.health.overall).toBe('healthy')
    expect(indexed.get(dimensionKey(gemini.platform, 3, gemini.model))?.health.overall).toBe('warning')
    expect(relatedKeys([key(1, 3), key(2, 2)], openai).map(k => k.id)).toEqual([1])
    expect(relatedKeys([key(1, 3)], gemini)).toHaveLength(1)
    expect(keysQuery(openai)).toEqual({ vendor: 'composite', group_id: '3' })
  })
  it('监控不扩张目录；无监控模型保留，历史/未授权分组不进入可用目录', () => {
    const entries = buildCatalog(channels(), [group(1)])
    expect(entries.every(e => e.group.id === 1)).toBe(true)
    expect(entries.some(e => e.model === 'no-association')).toBe(true)
    expect(buildCatalog([], [group(1)])).toEqual([])
    const indexed = indexMatrix(matrix([row(99, 'openai', 'private-model')]))
    expect(indexed.size).toBe(1)
    expect(entries.some(e => e.model === 'private-model')).toBe(false)
  })
  it('拒绝普通分组的跨平台投影和不一致的 section 模型', () => {
    const source = channels()
    source[0].platforms[0].supported_models.push({ name: 'wrong', platform: 'gemini', pricing: null })
    source[0].platforms[1].groups.push(group(1) as never)
    expect(buildCatalog(source, [group(1)]).some(e => e.platform === 'gemini' || e.model === 'wrong')).toBe(false)
  })
  it('模型广场按真实分组和平台补齐目录及复杂价格，不按显示名关联', () => {
    const entries = buildCatalog(channels(), [group(1), group(2)], plaza())
    expect(entries.find(e => e.group.id === 1 && e.model === 'model-X')?.plaza).toBeUndefined()
    const b = entries.find(e => e.group.id === 2 && e.model === 'model-X')!
    expect(b.plaza?.model.time_pricing?.periods[0].multiplier).toBe(1.2)
    expect(b.plaza?.model.pricing?.intervals[0].input_multiplier).toBe(2)
    expect(buildCatalog([], [group(2)], plaza())).toHaveLength(1)
    expect(buildCatalog([], [], plaza())).toEqual([])
  })
  it('同模型不同渠道保留各自报价，不能随意选一份价格', () => {
    const source = channels(); const second = structuredClone(source[0]); second.name = '不同报价渠道'
    second.platforms[0].supported_models[0].pricing!.input_price = .01
    const entry = buildCatalog([...source, second], [group(1)])[0]
    expect(entry.sources.map(s => s.channel)).toEqual(['渠道', '不同报价渠道'])
  })
  it('平坦 token 价使用真实专属倍率；复杂阶梯、峰时模型规则和未知倍率不折算单价', () => {
    const entry = buildCatalog([], [group(2)], plaza())[0]
    expect(simpleTokenPrices(entry, .085)).toBeUndefined()
    entry.plaza!.model.time_pricing = undefined
    entry.plaza!.model.pricing!.intervals = []
    expect(simpleTokenPrices(entry, .085)).toMatchObject({ input_price: '$0.17', output_price: '$0.68', cache_read_price: '$0.017', cache_write_price: '$0.2125' })
    expect(simpleTokenPrices(entry, .085, false)).toBeUndefined()
    entry.plaza!.model.pricing!.billing_mode = 'video'
    expect(simpleTokenPrices(entry, .085)).toBeUndefined()
  })
  it('错误维度与重复三维行拒绝展示，不覆盖或模糊合并', () => {
    expect(() => indexMatrix({ ...matrix(), group_by: 'platform_model' })).toThrow()
    expect(() => indexMatrix(matrix([row(), row()]))).toThrow()
    expect(() => indexMatrix(matrix([{ ...row(), group_id: undefined }]))).toThrow()
    expect(dimensionKey('a', 1, 'b:c')).not.toBe(dimensionKey('a:b', 1, 'c'))
  })
  it('脱敏计数为 0 仍显示后端健康，种子空行与少样本分别识别', () => {
    expect(row().metrics.request_count).toBe(0)
    expect(row().metrics.ttft.sample_count).toBe(0)
    expect(sampleState(row())).toBe('measured')
    expect(sampleState(row(1, 'openai', 'model-X', 'unknown'))).toBe('insufficient')
    expect(sampleState({ ...row(1, 'openai', 'model-X', 'unknown'), buckets: [] })).toBe('noSamples')
    expect(sampleState()).toBe('missing')
  })
  it('原生 coverage/bootstrap 区分未完成、延迟、覆盖不足和过期，可同时存在', () => {
    expect(coverageConditions(coverage())).toEqual([])
    expect(coverageConditions(coverage({ bootstrap: { active: true, progress_percent: 20 }, coverage_complete: false, aggregation_lag_seconds: 900 }))).toEqual(['bootstrap', 'partial', 'pending'])
    expect(coverageConditions(coverage({ computed_at: new Date(Date.now() - 3600000).toISOString() }))).toEqual(['stale'])
    expect(coverageConditions(coverage({ data_through: '' }))).toEqual(['pending'])
    expect(coverageConditions()).toEqual(['pending'])
  })
  it('未启用不与普通权限不足或接口失败混淆', () => {
    expect(monitorFailure({ status: 403, reason: 'CHANNEL_MONITOR_DISABLED' })).toBe('disabled')
    expect(monitorFailure({ status: 403, reason: 'CHANNEL_MONITOR_MODE_MISMATCH' })).toBe('disabled')
    expect(monitorFailure({ status: 403 })).toBe('forbidden')
    expect(monitorFailure({ status: 404 })).toBe('unavailable')
    expect(monitorFailure({ status: 503 })).toBe('unavailable')
  })
  it('跨页链接沿用 Stage 3 参数；无选择不关联；停用密钥保留真实状态', () => {
    const entry = buildCatalog(channels(), [group(1)])[0]
    expect(keysQuery(entry, 'create')).toEqual({ vendor: 'openai', group_id: '1', action: 'create' })
    expect(keysQuery(entry, undefined, 21)).toEqual({ vendor: 'openai', group_id: '1', key_id: '21' })
    expect(relatedKeys([key(1, 1, 'inactive'), key(2, 2)], entry)[0].status).toBe('inactive')
    expect(relatedKeys([key(1, 1)])).toEqual([])
  })
})
