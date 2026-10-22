import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DashboardView from '../DashboardView.vue'
import UserDateRangePicker from '@/components/user/analytics/UserDateRangePicker.vue'
import UserDistributionPanel from '@/components/user/analytics/UserDistributionPanel.vue'
import UserTokenTrend from '@/components/user/analytics/UserTokenTrend.vue'

const { getStats, getDashboardSnapshotV2, getDashboardStats, refreshUser, auth } = vi.hoisted(() => ({
  getStats: vi.fn(), getDashboardSnapshotV2: vi.fn(), getDashboardStats: vi.fn(), refreshUser: vi.fn(), auth: { user: { balance: 128.56 } },
}))
vi.mock('@/api/usage', () => ({ usageAPI: { getStats, getDashboardSnapshotV2, getDashboardStats } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ ...auth, refreshUser }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const stats = { total_requests: 42, total_input_tokens: 100, total_output_tokens: 50, total_cache_read_tokens: 25, total_cache_creation_tokens: 5, total_tokens: 180, total_cost: 2.5, total_actual_cost: 1.25, average_duration_ms: 1410, endpoints: [{ endpoint: '/v1/responses', requests: 42, actual_cost: 1.25 }] }
const snapshot = { models: [{ model: 'real-model', requests: 42, actual_cost: 1.25 }], groups: [{ group_name: 'real-group', requests: 42, actual_cost: 1.25 }], trend: [{ date: '2026-10-22', input_tokens: 100, output_tokens: 50, cache_read_tokens: 25, cache_creation_tokens: 5 }] }
const wrappers: ReturnType<typeof mount>[] = []
function render() {
  const w = mount(DashboardView, { global: { stubs: { AppLayout: { template: '<div><slot /></div>' }, Icon: true, UserDateRangePicker: true, UserTokenTrend: true } } })
  wrappers.push(w); return w
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
afterEach(() => wrappers.splice(0).forEach(w => w.unmount()))
beforeEach(() => {
  vi.clearAllMocks()
  getStats.mockResolvedValue(stats); getDashboardSnapshotV2.mockResolvedValue(snapshot)
  // 故意提供不同的全历史统计，确认周期卡片不会误用它。
  getDashboardStats.mockResolvedValue({ total_requests: 987654, total_actual_cost: 999, average_duration_ms: 99999, rpm: 3, tpm: 1234 })
  refreshUser.mockResolvedValue(undefined)
})
describe('V1.1 用户总览真实统计契约', () => {
  it('显示五卡并区分周期、余额和近五分钟口径', async () => {
    const w = render(); await flushPromises()
    expect(w.findAll('.ua-stat')).toHaveLength(5)
    expect(w.find('[data-stat="requests"]').text()).toContain('42')
    expect(w.find('[data-stat="balance"]').text()).toContain('$128.56')
    expect(w.find('[data-stat="cost"]').text()).toContain('$1.2500')
    expect(w.find('[data-stat="cost"]').text()).toContain('$2.50000000')
    expect(w.find('[data-stat="response"]').text()).toContain('1.41s')
    expect(w.text()).not.toContain('987654')
    expect(w.findAllComponents(UserDistributionPanel).map(p => p.props('items'))).toEqual([
      [{ name: 'real-model', requests: 42, actualCost: 1.25 }], [{ name: 'real-group', requests: 42, actualCost: 1.25 }], [{ name: '/v1/responses', requests: 42, actualCost: 1.25 }],
    ])
    expect(getStats).toHaveBeenCalledWith(expect.objectContaining({ start_date: expect.any(String), end_date: expect.any(String), timezone: expect.any(String) }), undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(w.find('.ua-perf-grid').text()).toContain('19.2%')
  })
  it('日期和小时粒度传真实接口，日期变化不重复刷新余额', async () => {
    const w = render(); await flushPromises()
    const date = w.findComponent(UserDateRangePicker)
    date.vm.$emit('update:startDate', '2026-10-01'); date.vm.$emit('update:endDate', '2026-10-02'); date.vm.$emit('change', {})
    await flushPromises()
    expect(getStats).toHaveBeenLastCalledWith(expect.objectContaining({ start_date: '2026-10-01', end_date: '2026-10-02' }), undefined, expect.anything())
    expect(refreshUser).toHaveBeenCalledTimes(1)
    w.findComponent(UserTokenTrend).vm.$emit('update:granularity', 'hour'); await flushPromises()
    expect(getDashboardSnapshotV2).toHaveBeenLastCalledWith(expect.objectContaining({ granularity: 'hour', include_model_stats: true, include_group_stats: true }), expect.anything())
  })
  it('新请求取消旧请求，迟到数据不会覆盖当前日期', async () => {
    const old = deferred<typeof stats>(); getStats.mockReturnValueOnce(old.promise)
    const w = render(); await flushPromises()
    const signal = getStats.mock.calls[0][2].signal as AbortSignal
    w.findComponent(UserDateRangePicker).vm.$emit('change', {}); await flushPromises()
    expect(signal.aborted).toBe(true)
    old.resolve({ ...stats, total_requests: 999 }); await flushPromises()
    expect(w.find('[data-stat="requests"]').text()).toContain('42')
    w.unmount(); expect((getStats.mock.calls[1][2].signal as AbortSignal).aborted).toBe(true)
  })
  it('加载失败清除旧统计，可重试恢复；零请求时不制造平均耗时', async () => {
    const w = render(); await flushPromises()
    getStats.mockRejectedValueOnce(new Error('fixture'))
    w.findComponent(UserDateRangePicker).vm.$emit('change', {}); await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.find('[data-stat="requests"]').text()).not.toContain('42')
    getStats.mockResolvedValueOnce({ ...stats, total_requests: 0, average_duration_ms: 0 })
    await w.find('[role="alert"] button').trigger('click'); await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(w.find('[data-stat="response"] strong').text()).toBe('—')
  })
})
