import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, reactive } from 'vue'
import { channels, coverage, group, key, matrix, plaza, row } from './channelStatusFixtures'
import type { MonitorMatrixResponse } from '@/api/channelMonitorV2'
import UserChannelStatus from '../UserChannelStatus.vue'
import Select from '@/components/common/Select.vue'

const mock = vi.hoisted(() => ({ channels: vi.fn(), groups: vi.fn(), rates: vi.fn(), plaza: vi.fn(), keys: vi.fn(), matrix: vi.fn(), snapshot: vi.fn(), scope: vi.fn(), push: vi.fn(), app: {} as { cachedPublicSettings: Record<string, unknown> } }))
vi.mock('@/api/channels', () => ({ default: { getAvailable: mock.channels } }))
vi.mock('@/api/groups', () => ({ default: { getAvailable: mock.groups, getUserGroupRates: mock.rates } }))
vi.mock('@/api/modelPlaza', () => ({ modelPlazaAPI: { getModelPlaza: mock.plaza } }))
vi.mock('@/api/channelMonitorV2', () => ({ getMatrix: mock.matrix, getSnapshot: mock.snapshot, getDisplayScope: mock.scope }))
vi.mock('../keysConsole', async () => ({ ...await vi.importActual('../keysConsole'), collectKeys: mock.keys }))
vi.mock('@/stores/app', () => ({ useAppStore: () => mock.app }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mock.push }) }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/composables/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: vi.fn() }) }))

const wrappers: VueWrapper[] = []
const createView = () => {
  const wrapper = mount(UserChannelStatus, { global: { stubs: {
    AppLayout: { template: '<div class="user-console"><slot /></div>' }, PlatformIcon: true, Icon: true, GroupBadge: true,
    BaseDialog: defineComponent({ props: ['show'], template: '<section v-if="show" class="test-dialog"><slot /></section>' }),
    PlazaModelPricingTable: true
  } } })
  wrappers.push(wrapper)
  return wrapper
}
const card = (wrapper: VueWrapper, name = 'model-X') => wrapper.get(`[data-model="${name}"]`)
const settle = async () => { await flushPromises(); await flushPromises() }
const selectControl = (wrapper: VueWrapper, id: string) => wrapper.findAllComponents(Select).find(control => control.props('id') === id)!
const clickGroup = async (wrapper: VueWrapper, index: number) => { selectControl(wrapper, 'monitor-group').vm.$emit('update:modelValue', index + 1); await settle() }
beforeEach(() => {
  vi.useRealTimers(); vi.clearAllMocks()
  mock.app = reactive({ cachedPublicSettings: { channel_monitor_enabled: true, channel_monitor_mode: 'v2', model_plaza_enabled: true, available_channels_enabled: true, api_base_url: 'https://api.example.test', server_utc_offset: '+08:00' } })
  mock.channels.mockResolvedValue(channels()); mock.groups.mockResolvedValue([group(1), group(2), group(3, 'composite')]); mock.rates.mockResolvedValue({ 2: .085 })
  mock.plaza.mockResolvedValue({ groups: plaza() }); mock.keys.mockResolvedValue([key(1, 1)])
  mock.matrix.mockResolvedValue(matrix()); mock.snapshot.mockResolvedValue({ config: { refresh_interval_seconds: 300 }, coverage: coverage() })
  mock.scope.mockResolvedValue({ group_ids: [1, 2, 3], platforms: [{ platform: 'openai', models: [] }, { platform: 'gemini', models: [] }] })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.useRealTimers() })

describe('新版普通用户渠道状态业务和生命周期', () => {
  it('优先有 Key 的厂商，多厂商有 Key 时优先 OpenAI，分组按实际倍率降序', async () => {
    mock.keys.mockResolvedValue([key(1, 1), key(2, 2), key(3, 3)])
    const wrapper = createView(); await settle()
    expect(selectControl(wrapper, 'monitor-vendor').props('modelValue')).toBe('openai')
    expect(selectControl(wrapper, 'monitor-group').props('options').map(option => option.value)).toEqual([3, 2, 1])
    expect(selectControl(wrapper, 'monitor-group').props('modelValue')).toBe(3)
    mock.rates.mockResolvedValue({ 1: .38, 2: .085 })
    await wrapper.get('.um-refresh').trigger('click'); await settle()
    // 刷新只更新排序，保留用户当前有效选择。
    expect(selectControl(wrapper, 'monitor-group').props('options').map(option => option.value)).toEqual([1, 3, 2])
    expect(selectControl(wrapper, 'monitor-group').props('modelValue')).toBe(3)
  })
  it('OpenAI 无 Key 时选择有 Key 的其他厂商，无 Key 时回退 OpenAI', async () => {
    const source = channels()
    source[0].platforms[1].groups = [group(4, 'gemini')] as never[]
    mock.channels.mockResolvedValue(source)
    mock.groups.mockResolvedValue([group(1), group(2), group(4, 'gemini')])
    mock.keys.mockResolvedValue([key(4, 4)])
    mock.scope.mockResolvedValue({ group_ids: [1, 2, 4], platforms: [{ platform: 'openai', models: [] }, { platform: 'gemini', models: [] }] })
    const wrapper = createView(); await settle()
    expect(selectControl(wrapper, 'monitor-vendor').props('modelValue')).toBe('gemini')
    expect(selectControl(wrapper, 'monitor-vendor').props('options').map(option => option.value)).toEqual(['gemini', 'openai'])
    mock.keys.mockResolvedValue([])
    const noKeys = createView(); await settle()
    expect(selectControl(noKeys, 'monitor-vendor').props('modelValue')).toBe('openai')
    expect(selectControl(noKeys, 'monitor-group').props('modelValue')).toBe(2)
  })
  it('模型卡片按监控配置顺序展示，刷新后同步新顺序并移除关联密钥按钮', async () => {
    const orderedModels = ['no-samples', 'model-X', 'no-association']
    mock.scope.mockResolvedValue({ group_ids: [1, 2], platforms: [{ platform: 'openai', models: orderedModels }] })
    const wrapper = createView(); await settle()
    const visibleModels = () => wrapper.findAll('.um-model').map(el => el.attributes('data-model'))
    expect(visibleModels()).toEqual(orderedModels)
    expect(card(wrapper).get('.um-model-footer').findAll('button')).toHaveLength(1)
    expect(card(wrapper).text()).not.toContain('userMonitor.selectKeys')
    await clickGroup(wrapper, 1)
    expect(visibleModels()).toEqual(orderedModels)

    mock.scope.mockResolvedValue({ group_ids: [1, 2], platforms: [{ platform: 'openai', models: [...orderedModels].reverse() }] })
    await wrapper.get('.um-refresh').trigger('click'); await settle()
    expect(visibleModels()).toEqual([...orderedModels].reverse())
  })

  it('仅展示监控范围的模型并更新数量；不改动原渠道或调用目录', async () => {
    const source = channels()
    mock.channels.mockResolvedValue(source)
    mock.scope.mockResolvedValue({ group_ids: [1], platforms: [{ platform: 'openai', models: ['model-X'] }] })
    const wrapper = createView(); await settle()
    expect(wrapper.findAll('.um-model')).toHaveLength(1)
    expect(wrapper.find('[data-model="no-samples"]').exists()).toBe(false)
    expect(source[0].platforms[0].supported_models).toHaveLength(3)
    expect(selectControl(wrapper, 'monitor-group').props('options')).toHaveLength(1)
    mock.scope.mockRejectedValue({ status: 503 })
    await wrapper.get('.um-refresh').trigger('click'); await settle()
    expect(wrapper.findAll('.um-model')).toHaveLength(0)
    expect(wrapper.text()).toContain('userMonitor.unavailable')
  })
  it('广场关闭仍显示渠道价格和四个指定字段，缺失缓存显示未配置', async () => {
    mock.app.cachedPublicSettings.model_plaza_enabled = false
    const source = channels()
    source[0].platforms[0].supported_models[0].pricing!.cache_write_price = null
    mock.channels.mockResolvedValue(source)
    const wrapper = createView(); await settle()
    const prices = card(wrapper).get('.um-card-prices')
    expect(prices.findAll('span').map(el => el.text())).toEqual(['monitorDisplay.input_price', 'monitorDisplay.output_price', 'monitorDisplay.cache_read_price', 'monitorDisplay.cache_write_price'])
    expect(prices.findAll('b').map(el => el.text())).toEqual(['$0.1', '$0.4', '$0.01', 'monitorDisplay.unconfigured'])
    expect(prices.text()).not.toContain('5 分钟')
    expect(card(wrapper, 'no-samples').get('.um-card-prices').findAll('b').map(el => el.text())).toEqual(Array(4).fill('monitorDisplay.unconfigured'))
  })
  it('显式三维普通用户请求；切组后同模型独立健康、倍率、关联密钥联动', async () => {
    const wrapper = createView(); await settle()
    expect(mock.matrix).toHaveBeenCalledWith(expect.objectContaining({ range: '24h' }), 'platform_group_model', false, expect.any(AbortSignal))
    expect(mock.snapshot.mock.calls[0][1]).toBe(false)
    expect(card(wrapper).text()).toContain('96.0 / 100')
    expect(wrapper.get('.um-linked').text()).toContain('密钥-1')
    await clickGroup(wrapper, 1)
    expect(card(wrapper).text()).toContain('68.0 / 100')
    expect(card(wrapper).text()).toContain('1.80%')
    expect(card(wrapper).text()).toContain('userMonitor.health.warning')
    expect(wrapper.findAll('.um-field')[1].text()).toContain('0.085x')
    mock.keys.mockResolvedValue([key(1, 1), key(2, 2, 'inactive')])
    await wrapper.get('.um-refresh').trigger('click'); await settle()
    expect(wrapper.get('.um-linked').text()).toContain('密钥-2')
    expect(wrapper.get('.um-linked').text()).toContain('keys.status.inactive')
    expect(wrapper.get('.um-linked').text()).not.toContain('密钥-1')
  })
  it('无样本不展示健康分或绿色历史，脱敏 0 不影响有样本健康', async () => {
    const wrapper = createView(); await settle()
    expect(card(wrapper).text()).toContain('96.0 / 100')
    const empty = card(wrapper, 'no-samples')
    expect(empty.text()).toContain('userMonitor.noSamples')
    expect(empty.find('.um-history').exists()).toBe(false)
    expect(empty.text()).not.toContain('100')
    expect(empty.findAll('.um-kpis strong').map(el => el.text())).toEqual(['—','—','—','—'])
    expect(card(wrapper, 'no-association').text()).toContain('userMonitor.missing')
  })
  it('有真实 bucket 但 health unknown 时明确样本不足，仅显示已有观测', async () => {
    mock.matrix.mockResolvedValue(matrix([row(1, 'openai', 'model-X', 'unknown')]))
    const wrapper = createView(); await settle()
    expect(card(wrapper).text()).toContain('userMonitor.insufficient')
    expect(card(wrapper).get('.um-kpis strong').text()).toBe('—')
    expect(card(wrapper).findAll('.um-history .healthy')).toHaveLength(0)
  })
  it.each(['v1', undefined])('模式为 %s 时不请求监控接口，也不退回全量目录', async mode => {
    mock.app.cachedPublicSettings.channel_monitor_mode = mode
    const wrapper = createView(); await settle()
    expect(mock.matrix).not.toHaveBeenCalled(); expect(mock.snapshot).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid=monitor-failure]').text()).toBe('userMonitor.disabled')
    expect(mock.scope).not.toHaveBeenCalled()
    expect(wrapper.findAll('.um-model')).toHaveLength(0)
  })
  it.each([[{ status: 403, reason: 'CHANNEL_MONITOR_DISABLED' }, 'disabled'], [{ status: 403 }, 'forbidden'], [{ status: 503 }, 'unavailable']])('后端读取失败按真实原因显示 %s', async (error, message) => {
    mock.matrix.mockRejectedValue(error)
    const wrapper = createView(); await settle()
    expect(wrapper.get('[data-testid=monitor-failure]').text()).toBe(`userMonitor.${message}`)
    expect(card(wrapper).text()).not.toContain('96.0')
    expect(card(wrapper).find('.um-history').exists()).toBe(false)
  })
  it('过期、覆盖不完整和聚合延迟同时可见，过期不冒充当前健康', async () => {
    mock.matrix.mockResolvedValue({ ...matrix(), coverage: coverage({ computed_at: new Date(Date.now()-3600000).toISOString(), coverage_complete: false, aggregation_lag_seconds: 900, bootstrap: { active: true, progress_percent: 20 } }) })
    const wrapper = createView(); await settle()
    expect(wrapper.get('.um-coverage').text()).toContain('userMonitor.stale')
    expect(wrapper.get('.um-coverage').text()).toContain('userMonitor.partial')
    expect(wrapper.get('.um-coverage').text()).toContain('userMonitor.pending')
    expect(wrapper.get('.um-coverage').text()).toContain('userMonitor.bootstrap')
    expect(card(wrapper).get('.um-health').text()).toBe('userMonitor.health.unknown')
  })
  it('Composite 保留跨平台能力和真实分组；切换厂商与模型更新右侧选择', async () => {
    mock.keys.mockResolvedValue([key(3, 3)])
    const wrapper = createView(); await settle(); await clickGroup(wrapper, 2)
    selectControl(wrapper, 'monitor-vendor').vm.$emit('update:modelValue', 'gemini'); await settle()
    expect(wrapper.get('.um-side-heading').text()).toContain('Gemini')
    expect(wrapper.get('.um-linked').text()).toContain('密钥-3')
    await wrapper.get('.um-secondary-button').trigger('click')
    expect(mock.push).toHaveBeenLastCalledWith({ path: '/keys', query: { vendor: 'composite', group_id: '3' } })
  })
  it('创建与已有密钥详情通过 Stage 3 URL 复用，完整 Key 不出现在页面', async () => {
    const wrapper = createView(); await settle()
    await wrapper.get('.um-primary-button').trigger('click')
    expect(mock.push).toHaveBeenLastCalledWith({ path: '/keys', query: { vendor: 'openai', group_id: '1', action: 'create' } })
    await wrapper.get('.um-key button').trigger('click')
    expect(mock.push).toHaveBeenLastCalledWith({ path: '/keys', query: { vendor: 'openai', group_id: '1', key_id: '1' } })
    expect(wrapper.text()).not.toContain(key(1,1).key)
  })
  it('完整价格规则原样传给正式组件，包含缓存、阶梯、峰时和独立媒体倍率', async () => {
    const wrapper = createView(); await settle(); await clickGroup(wrapper, 1)
    await card(wrapper).get('.um-price-preview button').trigger('click'); await settle()
    const table = wrapper.findComponent({ name: 'PlazaModelPricingTable' })
    expect(table.props('models')[0]).toEqual(plaza()[0].models[0])
    expect(table.props('userRateMultiplier')).toBe(.085)
    expect(table.props('peakWindow')).toContain('18:00-23:00')
    expect(table.props('peakRateMultiplier')).toBe(1.5)
    expect(table.props('imageRateIndependent')).toBe(true)
    expect(table.props('videoRateMultiplier')).toBe(.8)
  })
  it('倍率失败时不计算实付价，目录失败不以监控数据补齐权限', async () => {
    mock.rates.mockRejectedValue(new Error('rates'))
    const wrapper = createView(); await settle()
    expect(wrapper.get('.um-primary-button').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('userMonitor.issue.rates')
    await card(wrapper).get('.um-price-preview button').trigger('click'); await settle()
    expect(wrapper.findComponent({ name: 'PlazaModelPricingTable' }).exists()).toBe(false)
    expect(wrapper.text()).toContain('userMonitor.basePriceOnly')
    wrapper.unmount()
    mock.groups.mockRejectedValue(new Error('groups'))
    const failed = createView(); await settle()
    expect(failed.findAll('.um-model')).toHaveLength(0)
    expect(failed.text()).toContain('userMonitor.noDirectory')
  })
  it('关联密钥集合失败时不交付部分数据，目录与健康独立保留', async () => {
    mock.keys.mockRejectedValue(new Error('incomplete'))
    const wrapper = createView(); await settle()
    expect(wrapper.findAll('.um-key')).toHaveLength(0)
    expect(wrapper.text()).toContain('userMonitor.issue.keys')
    await clickGroup(wrapper, 0)
    expect(card(wrapper).text()).toContain('96.0')
  })
  it('四个真实时间范围可切换，切换时旧健康撤下，迟到响应不能污染新范围', async () => {
    const wrapper = createView(); await settle()
    let resolveOld!: (value: MonitorMatrixResponse) => void
    mock.matrix.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    selectControl(wrapper, 'monitor-range').vm.$emit('update:modelValue', '7d'); await settle()
    const oldSignal = mock.matrix.mock.calls.at(-1)![3] as AbortSignal
    expect(card(wrapper).text()).not.toContain('96.0')
    selectControl(wrapper, 'monitor-range').vm.$emit('update:modelValue', '30d'); await settle()
    expect(oldSignal.aborted).toBe(true)
    resolveOld(matrix([row(1, 'openai', 'model-X', 'warning')]))
    await settle()
    expect(card(wrapper).text()).toContain('userMonitor.ranges.30d')
    expect(card(wrapper).get('.um-health').text()).toContain('healthy')
    selectControl(wrapper, 'monitor-range').vm.$emit('update:modelValue', '90m'); await settle()
    expect(mock.matrix.mock.calls.at(-1)![0].range).toBe('90m')
  })
  it('重复刷新、卸载取消请求并清理定时器；迟到结果不复活界面', async () => {
    vi.useFakeTimers()
    const wrapper = createView(); await settle()
    await wrapper.get('.um-refresh').trigger('click'); await settle()
    expect(mock.matrix).toHaveBeenCalledTimes(2)
    expect((mock.matrix.mock.calls[0][3] as AbortSignal).aborted).toBe(true)
    const signal = mock.matrix.mock.calls.at(-1)![3] as AbortSignal
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    const count = mock.matrix.mock.calls.length
    await vi.advanceTimersByTimeAsync(600000)
    expect(mock.matrix).toHaveBeenCalledTimes(count)
  })
  it('原生开关关闭后自动撤下健康并取消在途请求', async () => {
    const wrapper = createView(); await settle()
    mock.app.cachedPublicSettings.channel_monitor_enabled = false
    await settle()
    expect(wrapper.get('[data-testid=monitor-failure]').text()).toBe('userMonitor.disabled')
    expect(wrapper.findAll('.um-model')).toHaveLength(0)
  })
  it('请求不响应时达到预算后退出加载，不保留过期健康', async () => {
    vi.useFakeTimers()
    mock.matrix.mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = createView(); await settle()
    await vi.advanceTimersByTimeAsync(30001); await settle()
    expect(wrapper.get('.um-console').attributes('aria-busy')).toBe('false')
    expect(wrapper.text()).toContain('userMonitor.issue.timeout')
    expect(wrapper.text()).not.toContain('96.0')
  })
})
