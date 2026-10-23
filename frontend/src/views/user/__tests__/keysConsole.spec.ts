import { describe, expect, it, vi, afterEach } from 'vitest'
import { collectKeys, effectiveKeyStatus, filterAndSortKeys, KeyCollectionError } from '../keysConsole'
import type { ApiKey } from '@/types'

const key = (id: number, overrides: Partial<ApiKey> = {}) => ({ id, key: `fixture-${id}`, name: `Key ${id}`, status: 'active', updated_at: '2026-10-22', created_at: '2026-10-01', group_id: id % 2 + 1, group: { id: id % 2 + 1, name: `Group ${id % 2}`, platform: 'openai' }, current_concurrency: 0, quota: 0, quota_used: 0, ...overrides }) as ApiKey
const pageOf = (all: ApiKey[], page: number, size = 1000) => ({ items: all.slice((page - 1) * size, page * size), total: all.length, page, page_size: size, pages: Math.ceil(all.length / size) })
afterEach(() => vi.useRealTimers())

describe('完整集合与混合筛选数据契约', () => {
  it('读取并二次复核超过 1000 条，跨组过滤后再计算总数和分页', async () => {
    const all = Array.from({ length: 2017 }, (_, i) => key(i + 1))
    const list = vi.fn(async (page: number) => pageOf(all, page))
    const result = await collectKeys({}, new AbortController().signal, list)
    expect(result).toHaveLength(2017)
    expect(list.mock.calls.map(c => c[0])).toEqual([1, 2, 3, 1, 2, 3])
    const filtered = filterAndSortKeys(result, 'openai', { group_id: 1, sort_by: 'id', sort_order: 'asc' })
    expect(filtered).toHaveLength(1008)
    expect(filtered.slice(10, 20).map(k => k.id)).toEqual([22,24,26,28,30,32,34,36,38,40])
  })
  it('发现重复、总数变化或同数改绑后重试，只交付稳定完整集合', async () => {
    let pass = 0
    const list = vi.fn(async () => { pass++; return pageOf([key(1, { group_id: pass === 1 ? 1 : 2 })], 1) })
    const result = await collectKeys({}, new AbortController().signal, list)
    expect(list).toHaveBeenCalledTimes(4)
    expect(result[0].group_id).toBe(2)
    const duplicates = vi.fn(async () => pageOf([key(1), key(1)], 1))
    await expect(collectKeys({}, new AbortController().signal, duplicates)).rejects.toMatchObject({ reason: 'changed' })
  })
  it('页失败、非法总数、持续变化都拒绝部分结果', async () => {
    const all = Array.from({ length: 1001 }, (_, i) => key(i + 1))
    await expect(collectKeys({}, new AbortController().signal, vi.fn(async p => { if (p === 2) throw new Error('page failed'); return pageOf(all, p) }))).rejects.toThrow('page failed')
    await expect(collectKeys({}, new AbortController().signal, vi.fn(async () => ({ ...pageOf([], 1), total: -1 })))).rejects.toBeInstanceOf(KeyCollectionError)
    let revision = 0
    await expect(collectKeys({}, new AbortController().signal, vi.fn(async () => pageOf([key(1, { name: String(revision++) })], 1)))).rejects.toMatchObject({ reason: 'changed' })
  })
  it('取消后不返回迟到响应，20 秒预算超出时报告慢查询', async () => {
    const controller = new AbortController()
    const list = vi.fn(async () => { controller.abort(); return pageOf([key(1)], 1) })
    await expect(collectKeys({}, controller.signal, list)).rejects.toMatchObject({ name: 'AbortError' })
    vi.useFakeTimers()
    const slow = collectKeys({}, new AbortController().signal, vi.fn(async (_p, _s, _f, options) => new Promise((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))) })))
    const expectation = expect(slow).rejects.toMatchObject({ reason: 'slow' })
    await vi.advanceTimersByTimeAsync(20001)
    await expectation
  })
  it('真实平台关系覆盖多个组、历史组、无分组和不同倍率，不修改授权目录', () => {
    const historical = key(1, { group: { id: 99, name: '历史 OpenAI', platform: 'openai', rate_multiplier: 3 } as ApiKey['group'], group_id: 99 })
    const all = [historical, key(2), key(3, { group: null, group_id: null }), key(4, { group: { id: 4, platform: 'gemini', name: 'Gemini' } as ApiKey['group'] })]
    expect(filterAndSortKeys(all, 'openai', {}).map(k => k.id)).toEqual([2,1])
    expect(filterAndSortKeys(all, '', { group_id: 0 }).map(k => k.id)).toEqual([3])
    expect(filterAndSortKeys(all, 'gemini', {}).map(k => k.id)).toEqual([4])
    expect(filterAndSortKeys(all, '', { search: 'fixture-1' }).map(k => k.id)).toEqual([1])
  })
  it('区分手动禁用、时间到期、额度耗尽；并发仅为单数字采样', () => {
    expect(effectiveKeyStatus(key(1, { status: 'inactive' }))).toBe('inactive')
    expect(effectiveKeyStatus(key(1, { expires_at: '2000-01-01' }))).toBe('expired')
    expect(effectiveKeyStatus(key(1, { quota: 1, quota_used: 1 }))).toBe('quota_exhausted')
    expect(effectiveKeyStatus(key(1))).toBe('active')
    expect(filterAndSortKeys([key(1, { current_concurrency: 9 }), key(2)], '', { sort_by: 'current_concurrency', sort_order: 'desc' })[0].id).toBe(1)
  })
})
