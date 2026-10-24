import type { HealthState, MonitorCoverage, MonitorMatrixBucket } from '@/api/channelMonitorV2'
import type { CatalogModel } from './channelStatusConsole'
import { simpleTokenPrices } from './channelStatusConsole'

/** 渠道页专属时间位置；仅用于绘制，不参与健康评分。 */
export interface HistoryPosition {
  /** @description 区间起点，ISO 时间字符串。 */
  start: string
  /** @description 区间终点；覆盖信息缺失时不推测。 */
  end?: string
  /** @description 后端原始健康状态，缺口及歧义保持 unknown。 */
  state: HealthState
  /** @description 是否存在唯一对应的真实时间桶。 */
  observed: boolean
}

/**
 * 按 V2 原生粒度补齐时间位置，不重采样、不复制最后一桶、不补造绿色。
 * @param buckets 后端精确平台、分组、模型维度的真实时间桶。
 * @param coverage 后端本次查询窗口及粒度。
 * @param unavailable 加载、失败或过期时撤下旧健康结论。
 * @returns 原生等宽时间位置；窗口不能可靠对齐时保留真实桶数量。
 */
export function historyPositions(buckets: MonitorMatrixBucket[], coverage?: MonitorCoverage, unavailable = false): HistoryPosition[] {
  const start = Date.parse(coverage?.requested_start || '')
  const end = Date.parse(coverage?.requested_end || '')
  const step = (coverage?.bucket_seconds || 0) * 1000
  const count = (end - start) / step
  const native = () => buckets.map(bucket => ({ start: bucket.bucket_start, state: unavailable ? 'unknown' as const : bucket.health.overall, observed: true }))
  if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0 || !Number.isInteger(count) || count < 1 || count > 100) return native()
  // 非原生边界或重复数据不能被悄悄放进另一个区间；回退到真实桶展示。
  if (buckets.some(bucket => {
    const time = Date.parse(bucket.bucket_start)
    return !Number.isFinite(time) || time < start || time >= end || !Number.isInteger((time - start) / step)
  })) return native()
  return Array.from({ length: count }, (_, index) => {
    const time = start + index * step
    const matches = buckets.filter(bucket => Date.parse(bucket.bucket_start) === time)
    const observed = matches.length === 1
    return {
      start: new Date(time).toISOString(), end: new Date(time + step).toISOString(), observed,
      state: unavailable || !observed ? 'unknown' : matches[0].health.overall
    }
  })
}

/**
 * 只展示原有平坦标准时段价；独立缓存档位等复杂规则继续使用既有详情。
 * @param entry 用户授权目录中已有的完整价格来源。
 * @param userRate 已有用户专属倍率，不额外叠加采购倍率。
 * @param ratesAvailable 用户倍率接口是否可用。
 * @returns 可安全展示的四项价格，否则返回 undefined 并显示详情提示。
 */
export function cardTokenPrices(entry: CatalogModel, userRate?: number, ratesAvailable = true): Record<string, string> | undefined {
  const pricing = entry.plaza?.model.pricing
  if (pricing?.cache_write_1h_price != null || pricing?.image_input_price != null || pricing?.image_output_price != null || pricing?.per_request_price != null) return
  return simpleTokenPrices(entry, userRate, ratesAvailable)
}

// 文案仅属于渠道状态页，避免修改共享语言包及其他五个页面。
export const monitorMessages = {
  zh: { monitorDisplay: {
    available: '可用模型', latency: '平均延迟', success: '请求成功率',
    availableNote: '当前厂商与分组中，用户授权目录内可选择的模型；不保证上游实时可调度。',
    latencyNote: '暂无可靠平均延迟：用户监控接口隐藏延迟样本数，无法按请求加权汇总。',
    successNote: '暂无可靠成功率：用户监控接口隐藏最终成功和失败计数，无法确认分母。',
    summaryNote: '— 表示暂无可靠统计；平均延迟缺少样本权重，请求成功率缺少最终请求计数。',
    uptime: '近7天可用率', uptimeNote: '暂无同模型、同分组的可靠近7天可用率数据。', uptimeMissing: '暂无可靠数据',
    rule: '详见规则', ruleNote: '存在复杂计费规则或缺少可靠单价，请查看价格详情。',
    history: '{range}健康历史', intervals: '{observed} / {total} 个区间有记录',
    missingInterval: '暂无监测数据', intervalNote: '每块对应一个原生时间区间；灰色表示未知或暂无记录，不代表渠道数量。',
    nativeDetails: '请求表现详情', noSamples: '暂无监测数据'
  } },
  en: { monitorDisplay: {
    available: 'Available models', latency: 'Average latency', success: 'Request success rate',
    availableNote: 'Selectable models in your authorized catalog for this vendor and group; live upstream scheduling is not guaranteed.',
    latencyNote: 'Unavailable: latency sample counts are hidden, so a request-weighted average cannot be computed.',
    successNote: 'Unavailable: final success and failure counts are hidden, so the denominator cannot be verified.',
    summaryNote: '— means unavailable: latency lacks sample weights; success rate lacks final request counts.',
    uptime: '7-day availability', uptimeNote: 'No reliable 7-day availability for this exact model and group.', uptimeMissing: 'No reliable data',
    rule: 'See rules', ruleNote: 'Complex billing or unavailable unit prices. Open pricing details.',
    history: '{range} health history', intervals: '{observed} / {total} intervals recorded',
    missingInterval: 'No monitoring data', intervalNote: 'Each block is one native time interval. Gray means unknown or no data, not a channel count.',
    nativeDetails: 'Request performance details', noSamples: 'No monitoring data'
  } }
}
