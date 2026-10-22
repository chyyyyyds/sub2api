import { formatDateLocalInput } from '@/utils/format'

/** 用户分布展示项，金额只在渲染时格式化。 */
export interface DistributionItem {
  /** 模型、分组或端点名称。 */
  name: string
  /** 所选自然日范围的请求数。 */
  requests: number
  /** 所选范围的实际消费，单位美元。 */
  actualCost: number
}
export const analyticsPalette = ['#278aff', '#11c7b5', '#e3ad35', '#8b82d9', '#5c7793', '#db7b91']
export const analyticsTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
export const money = (value: number | null | undefined, digits = 4) => value == null || !Number.isFinite(value) ? '—' : `$${value.toFixed(digits)}`
export const tokens = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
export const duration = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : value < 1000 ? `${value.toFixed(0)}ms` : `${(value / 1000).toFixed(2)}s`
/** 按日历回退，避免夏令时使用固定毫秒数造成偏移。 */
export function naturalDayRange(days = 7) {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  return { start: formatDateLocalInput(start), end: formatDateLocalInput(end) }
}
