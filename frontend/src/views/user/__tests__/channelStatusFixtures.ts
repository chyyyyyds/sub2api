import type { Group, ApiKey } from '@/types'
import type { UserAvailableChannel, UserSupportedModelPricing } from '@/api/channels'
import type { MonitorCoverage, MonitorMatrixResponse, MonitorMatrixRow } from '@/api/channelMonitorV2'
import type { ModelPlazaGroup } from '@/api/modelPlaza'

export const group = (id: number, platform = 'openai') => ({ id, name: '同名分组', platform, rate_multiplier: id === 1 ? .05 : .1, subscription_type: 'standard', peak_rate_enabled: id === 2, peak_start: '18:00', peak_end: '23:00', peak_rate_multiplier: 1.5 }) as Group
export const pricing: UserSupportedModelPricing = { billing_mode: 'token', input_price: .000002, output_price: .000008, cache_read_price: .0000002, cache_write_price: .0000025, cache_write_1h_price: .000004, image_input_price: null, image_output_price: null, per_request_price: null, intervals: [] }
export const channels = (): UserAvailableChannel[] => [{ name: '渠道', description: '', platforms: [
  { platform: 'openai', groups: [group(1), group(2), group(3, 'composite')] as never[], supported_models: [{ name: 'model-X', platform: 'openai', pricing: { ...pricing } }, { name: 'no-samples', platform: 'openai', pricing: null }, { name: 'no-association', platform: 'openai', pricing: null }] },
  { platform: 'gemini', groups: [group(3, 'composite')] as never[], supported_models: [{ name: 'model-X', platform: 'gemini', pricing: { ...pricing } }] }
] }]
export const coverage = (overrides: Partial<MonitorCoverage> = {}): MonitorCoverage => ({ requested_start: new Date(Date.now() - 86400000).toISOString(), requested_end: new Date().toISOString(), coverage_start: new Date(Date.now() - 86400000).toISOString(), data_through: new Date(Date.now() - 30000).toISOString(), computed_at: new Date().toISOString(), aggregation_lag_seconds: 30, coverage_complete: true, bucket_seconds: 3600, ...overrides })
export function row(id = 1, platform = 'openai', model = 'model-X', state: 'healthy' | 'warning' | 'unknown' = 'healthy'): MonitorMatrixRow {
  const health = { overall: state, error_rate: state, ttft: state, score: state === 'unknown' ? null : id === 2 ? 68 : 96, minimum_sample: 50 }
  const metrics = { request_count: 0, success_requests: 0, error_requests: 0, token_count: 0, rpm: 0, tpm: 0, error_rate: id === 2 ? .018 : 0, cache_rate: .6, cache_rate_numerator: 0, cache_rate_denominator: 0, ttft: { sample_count: 0, p50_ms: 320, p95_ms: 480, avg_ms: 350 }, duration: { sample_count: 0, p50_ms: 1200, p95_ms: 1800, avg_ms: 1250 } }
  return { platform, group_id: id, group_name: '同名分组', model, health, metrics, buckets: [{ bucket_start: new Date(Date.now() - 3600000).toISOString(), health, metrics }] }
}
export const matrix = (items: MonitorMatrixRow[] = [row(1), row(2, 'openai', 'model-X', 'warning'), { ...row(1, 'openai', 'no-samples', 'unknown'), buckets: [] }]): MonitorMatrixResponse => ({ group_by: 'platform_group_model', coverage: coverage(), items })
export const key = (id: number, groupId: number, status = 'active') => ({ id, user_id: 2, name: `密钥-${id}`, key: `sk-fixture-00000000000000000000${id}`, group_id: groupId, group: group(groupId, groupId === 3 ? 'composite' : 'openai'), status, quota: 0, quota_used: 0 }) as ApiKey
export const plaza = (): ModelPlazaGroup[] => [{ ...group(2), image_rate_independent: true, image_rate_multiplier: .7, video_rate_independent: true, video_rate_multiplier: .8, long_context_pricing_enabled: true, models: [{ name: 'model-X', platform: 'openai', pricing: { ...pricing, intervals: [{ min_tokens: 128000, max_tokens: null, input_price: null, output_price: null, input_multiplier: 2, cache_write_price: null, cache_read_price: null, per_request_price: null }] }, official_pricing: null, time_pricing: { timezone: 'Asia/Shanghai', weekdays_only: true, periods: [{ start_time: '18:00', end_time: '23:00', multiplier: 1.2 }] }, long_context_basis: 'whole_request' }] }] as ModelPlazaGroup[]
