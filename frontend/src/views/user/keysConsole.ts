import { keysAPI } from '@/api/keys'
import type { ApiKey } from '@/types'

/** 完整集合读取失败时拒绝显示部分结果，不输出密钥或响应内容。 */
export class KeyCollectionError extends Error {
  constructor(public reason: 'changed' | 'slow' | 'invalid') { super(reason) }
}
type Filters = NonNullable<Parameters<typeof keysAPI.list>[2]>
type List = typeof keysAPI.list
/** 稳定字段用于检测跨页增删改；并发数本身是实时采样，不参与一致性判定。 */
const signature = (keys: ApiKey[]) => JSON.stringify(keys.map(k => [k.id, k.updated_at, k.name, k.status, k.group_id, k.group?.platform, k.group?.name]))

/** 读取全部分页并复核第二遍；持续变化、超时、取消和页失败都不会交付部分集合。 */
export async function collectKeys(filters: Filters, signal: AbortSignal, list: List = keysAPI.list): Promise<ApiKey[]> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, 20000)
  const scan = async () => {
    const all: ApiKey[] = []
    const seen = new Set<number>()
    let total = -1
    let pageSize = 0
    for (let page = 1; ; page++) {
      controller.signal.throwIfAborted()
      const res = await list(page, 1000, { ...filters, sort_by: 'id', sort_order: 'asc' }, { signal: controller.signal })
      controller.signal.throwIfAborted()
      // 后端空列表仍保留第 1 页，不能把合法的空集合误判为加载失败。
      if (!Number.isSafeInteger(res.total) || res.total < 0 || res.page !== page || res.page_size <= 0 || res.page_size > 1000 || res.pages !== Math.max(1, Math.ceil(res.total / res.page_size))) throw new KeyCollectionError('invalid')
      if (total !== -1 && total !== res.total) throw new KeyCollectionError('changed')
      if (pageSize && pageSize !== res.page_size) throw new KeyCollectionError('changed')
      pageSize = res.page_size
      total = res.total
      if (res.items.length !== Math.min(res.page_size, Math.max(0, total - (page - 1) * res.page_size))) throw new KeyCollectionError('changed')
      for (const key of res.items) {
        if (!Number.isSafeInteger(key.id) || seen.has(key.id) || (all.length && key.id <= all[all.length - 1].id)) throw new KeyCollectionError('changed')
        seen.add(key.id); all.push(key)
      }
      if (all.length === total) return all
      if (page >= res.pages) throw new KeyCollectionError('changed')
    }
  }
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const first = await scan()
        const second = await scan()
        if (signature(first) === signature(second)) return second
      } catch (error) {
        if (!(error instanceof KeyCollectionError) || error.reason !== 'changed') throw error
      }
    }
    throw new KeyCollectionError('changed')
  } catch (error) {
    if (timedOut && !signal.aborted) throw new KeyCollectionError('slow')
    throw error
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}

/** 厂商来自真实分组平台；没有关联信息时不猜测厂商。 */
export const keyVendor = (key: ApiKey) => key.group?.platform || ''
/** 只有完整集合才可进入此函数；完成全部筛选和排序后，由调用方切页。 */
export function filterAndSortKeys(keys: ApiKey[], vendor: string, filters: Filters): ApiKey[] {
  const query = filters.search?.trim().toLocaleLowerCase() || ''
  const result = keys.filter(k => (!vendor || keyVendor(k) === vendor) && (!query || `${k.name}\n${k.key}`.toLocaleLowerCase().includes(query)) && (!filters.status || k.status === filters.status) && (filters.group_id === undefined || (Number(filters.group_id) === 0 ? k.group_id == null : k.group_id === Number(filters.group_id))))
  const dir = filters.sort_order === 'asc' ? 1 : -1
  const field = filters.sort_by || 'created_at'
  const value = (key: ApiKey): string | number | null | undefined => field === 'group' ? key.group?.name : key[field as keyof ApiKey] as string | number | null | undefined
  return result.sort((a, b) => {
    const av = value(a), bv = value(b)
    // 分组空值始终在末尾；其他字段沿用 PostgreSQL 默认空值顺序。
    const nullOrder = field === 'group' ? 1 : dir
    if (av == null && bv != null) return nullOrder
    if (bv == null && av != null) return -nullOrder
    if (av === bv) return (a.id - b.id) * dir
    return (av! < bv! ? -1 : 1) * dir
  })
}

/** 到期与额度耗尽优先说明；开关不能把它们误展示为手动禁用。 */
export function effectiveKeyStatus(key: ApiKey, now = Date.now()): string {
  if (key.status === 'inactive') return 'inactive'
  if (key.status === 'expired' || (key.expires_at && Date.parse(key.expires_at) <= now)) return 'expired'
  if (key.status === 'quota_exhausted' || (key.quota > 0 && key.quota_used >= key.quota)) return 'quota_exhausted'
  return key.status
}
