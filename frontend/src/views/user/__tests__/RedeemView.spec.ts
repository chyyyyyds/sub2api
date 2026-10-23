import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import zh from '@/i18n/locales/zh'
import en from '@/i18n/locales/en'
import RedeemView from '../RedeemView.vue'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), redeem: vi.fn(), getHistory: vi.fn(), refreshUser: vi.fn(), getPublicSettings: vi.fn(), showError: vi.fn(), showSuccess: vi.fn(), holder: { store: undefined as unknown } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/api', () => ({ redeemAPI: { redeem: mocks.redeem, getHistory: mocks.getHistory }, authAPI: { getPublicSettings: mocks.getPublicSettings } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.holder.store }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: mocks.showError, showSuccess: mocks.showSuccess }) }))
const row = (type = 'balance', value = 20, extra = {}) => ({ id: 1, code: 'SENSITIVE-FULL-CODE', type, value, status: 'used', used_at: '2026-10-23T02:00:00Z', created_at: '2026-10-20T00:00:00Z', ...extra })
const wrappers: VueWrapper[] = []
let store: { isSimpleMode: boolean; isAdmin: boolean; user: { balance: number; concurrency: number }; refreshUser: typeof mocks.refreshUser }
async function mountView(locale = 'zh') {
  const wrapper = mount(RedeemView, { global: { plugins: [createI18n({ legacy: false, locale, messages: { zh, en }, messageCompiler: message => context => typeof message === 'string' ? message.replace(/\{(\w+)\}/g, (_, name) => String(context.named(name))) : '' })], stubs: { AppLayout: { template: '<div><slot /></div>' }, Icon: true } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
async function submit(wrapper: VueWrapper, code = ' BALANCE-CODE ') {
  await wrapper.get('#code').setValue(code)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}
const button = (wrapper: VueWrapper, text: string) => wrapper.findAll('button').find(b => b.text().includes(text))!

beforeEach(() => {
  vi.clearAllMocks()
  store = reactive({ isSimpleMode: false, isAdmin: false, user: { balance: 10, concurrency: 2 }, refreshUser: mocks.refreshUser })
  mocks.holder.store = store
  mocks.refreshUser.mockResolvedValue({ balance: 10 })
  mocks.redeem.mockResolvedValue(row())
  mocks.getHistory.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 7, pages: 0 })
  mocks.getPublicSettings.mockResolvedValue({ contact_info: 'support@example.test' })
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('钱包真实余额与兑换', () => {
  it.each([false, true])('简易模式不展示钱包或请求兑换，沿用原重定向目标（admin=%s）', async admin => {
    store.isSimpleMode = true; store.isAdmin = admin
    const w = await mountView()
    expect(w.find('.uw-wallet').exists()).toBe(false)
    expect(mocks.replace).toHaveBeenCalledWith(admin ? '/admin/dashboard' : '/dashboard')
    expect(mocks.redeem).not.toHaveBeenCalled()
    expect(mocks.getHistory).not.toHaveBeenCalled()
  })
  it('认证刷新晚到的简易模式同样撤下钱包并重定向', async () => {
    const w = await mountView()
    store.isSimpleMode = true; await flushPromises()
    expect(w.find('.uw-wallet').exists()).toBe(false)
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard')
  })
  it('使用 Store 余额，成功后重新读取服务端值，不本地累加面值', async () => {
    const w = await mountView()
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$10.00')
    mocks.refreshUser.mockImplementationOnce(async () => { store.user.balance = 83.76; return store.user })
    await submit(w)
    expect(mocks.redeem).toHaveBeenCalledWith('BALANCE-CODE')
    expect(mocks.refreshUser).toHaveBeenCalledTimes(2)
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$83.76')
    expect(w.text()).toContain('余额兑换成功：$20.00')
    expect(w.text()).not.toContain('SENSITIVE-FULL-CODE')
    expect((w.get('#code').element as HTMLInputElement).value).toBe('')
    expect(mocks.getHistory).toHaveBeenLastCalledWith(1, 7)
  })
  it('支持 Handler 实际返回结构及旧版附加字段', async () => {
    mocks.redeem.mockResolvedValue({ ...row(), message: 'legacy', new_balance: 9999 })
    const w = await mountView(); await submit(w)
    expect(w.text()).toContain('余额兑换成功')
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$10.00')
  })
  it('在等待响应期间拒绝连续双击和直接重复 submit，完成后恢复', async () => {
    let resolve!: (value: unknown) => void
    mocks.redeem.mockReturnValue(new Promise(r => { resolve = r }))
    const w = await mountView()
    await w.get('#code').setValue('CODE')
    await w.get('form').trigger('submit'); await w.get('form').trigger('submit')
    expect(mocks.redeem).toHaveBeenCalledOnce()
    expect(w.get('#code').attributes('disabled')).toBeDefined()
    expect(w.get('.uw-primary').text()).toContain('兑换中')
    resolve(row()); await flushPromises()
    expect(w.get('#code').attributes('disabled')).toBeUndefined()
  })
  it('空白输入不会请求', async () => { const w = await mountView(); await submit(w, '   '); expect(mocks.redeem).not.toHaveBeenCalled() })
  it.each([
    ['REDEEM_CODE_NOT_FOUND', '兑换码无效'], ['REDEEM_CODE_USED', '已使用'], ['REDEEM_CODE_EXPIRED', '已过期'],
    ['REDEEM_BALANCE_ONLY', '钱包仅支持余额兑换码'], ['REDEEM_RATE_LIMITED', '失败次数过多'], ['REDEEM_CODE_LOCKED', '正在处理中']
  ])('保留服务端错误 %s 和恢复输入', async (reason, message) => {
    mocks.redeem.mockRejectedValue({ reason, message: 'server message' })
    const w = await mountView(); await submit(w)
    expect(w.get('[role="alert"]').text()).toContain(message)
    expect(mocks.refreshUser).toHaveBeenCalledOnce()
    expect(store.user.balance).toBe(10)
    expect((w.get('#code').element as HTMLInputElement).value).toBe(' BALANCE-CODE ')
    expect(w.get('#code').attributes('disabled')).toBeUndefined()
    expect(mocks.showSuccess).not.toHaveBeenCalled()
  })
  it.each([{ status: 0 }, { status: 503, message: '接口暂不可用' }, { response: { data: { detail: 'Invalid code' } } }])('网络与 API 异常可恢复 %j', async error => {
    mocks.redeem.mockRejectedValue(error)
    const w = await mountView(); await submit(w)
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.get('#code').attributes('disabled')).toBeUndefined()
    mocks.redeem.mockResolvedValue(row()); await submit(w)
    expect(w.text()).toContain('余额兑换成功')
  })
  it('兑换已完成但余额刷新失败时明确提示，并支持独立重读', async () => {
    const w = await mountView()
    mocks.refreshUser.mockRejectedValueOnce(new Error('offline'))
    await submit(w)
    expect(w.text()).toContain('余额兑换成功')
    expect(w.text()).toContain('余额信息刷新失败')
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$10.00')
    mocks.refreshUser.mockImplementationOnce(async () => { store.user.balance = 30 })
    await button(w, '刷新余额').trigger('click'); await flushPromises()
    expect(w.text()).not.toContain('余额信息刷新失败')
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$30.00')
    expect(mocks.redeem).toHaveBeenCalledOnce()
  })
  it('网络结果未确认时可以重读余额与活动，不自动重试兑换', async () => {
    const w = await mountView()
    mocks.redeem.mockRejectedValueOnce({ status: 0 })
    await submit(w)
    expect(w.text()).toContain('兑换结果尚未确认')
    mocks.refreshUser.mockImplementationOnce(async () => { store.user.balance = 30 })
    await button(w, '刷新余额与活动').trigger('click'); await flushPromises()
    expect(w.get('[data-testid="wallet-balance"]').text()).toBe('$30.00')
    expect(mocks.getHistory).toHaveBeenLastCalledWith(1, 7)
    expect(mocks.redeem).toHaveBeenCalledOnce()
  })
  it('初始余额请求尚未完成时，成功兑换仍等待并再次刷新', async () => {
    let finish!: () => void
    mocks.refreshUser.mockReturnValueOnce(new Promise<void>(r => { finish = r }))
    const w = await mountView(); await submit(w)
    expect(mocks.refreshUser).toHaveBeenCalledOnce()
    finish(); await flushPromises()
    expect(mocks.refreshUser).toHaveBeenCalledTimes(2)
  })
  it('异常非余额成功响应不作为钱包充值成功，仍刷新事实', async () => {
    mocks.redeem.mockResolvedValue(row('subscription'))
    const w = await mountView(); await submit(w)
    expect(w.text()).toContain('不符合钱包约定')
    expect(mocks.showSuccess).not.toHaveBeenCalled()
    expect(mocks.refreshUser).toHaveBeenCalledTimes(2)
  })
})

describe('活动、客服与页面内帮助', () => {
  it('服务端分页切换与每页大小，成功兑换回第一页', async () => {
    mocks.getHistory.mockResolvedValue({ items: [row()], total: 25 })
    const w = await mountView()
    expect(mocks.getHistory).toHaveBeenLastCalledWith(1, 7)
    await button(w, '下一页').trigger('click'); await flushPromises()
    expect(mocks.getHistory).toHaveBeenLastCalledWith(2, 7)
    await w.get('select').setValue('20'); await flushPromises()
    expect(mocks.getHistory).toHaveBeenLastCalledWith(1, 20)
    await submit(w)
    expect(mocks.getHistory).toHaveBeenLastCalledWith(1, 20)
  })
  it('区分资产类型和正负单位，未知类型不猜测，隐藏敏感兑换码', async () => {
    mocks.getHistory.mockResolvedValue({ total: 7, items: [row(), row('admin_balance', -2, { id: 2 }), row('concurrency', 3, { id: 3 }), row('admin_concurrency', -1, { id: 4 }), row('subscription', 999, { id: 5, validity_days: -5, group: { name: '订阅组' } }), row('future_type', 999, { id: 6 }), row('subscription', 999, { id: 7, validity_days: 0 })] })
    const w = await mountView()
    expect(w.text()).toContain('−$2.00'); expect(w.text()).toContain('+3'); expect(w.text()).toContain('−1')
    expect(w.text()).toContain('-5'); expect(w.text()).toContain('订阅权益扣减'); expect(w.text()).toContain('其他活动（future_type）')
    expect(w.text()).not.toContain('999'); expect(w.text()).not.toContain('SENSITIVE')
    expect(w.findAll('time')).toHaveLength(7)
  })
  it('活动失败隐藏旧列表，允许重试请求的页码', async () => {
    mocks.getHistory.mockResolvedValueOnce({ items: [row()], total: 25 }).mockRejectedValueOnce(new Error('offline'))
    const w = await mountView(); await button(w, '下一页').trigger('click'); await flushPromises()
    expect(w.findAll('.uw-activity')).toHaveLength(0)
    expect(w.text()).toContain('加载兑换记录失败')
    await button(w, '重试').trigger('click'); await flushPromises()
    expect(mocks.getHistory).toHaveBeenLastCalledWith(2, 7)
  })
  it('空活动时两侧分页禁用', async () => { const w = await mountView(); expect(w.text()).toContain('暂无活动'); expect(button(w, '下一页').attributes('disabled')).toBeDefined(); expect(button(w, '上一页').attributes('disabled')).toBeDefined() })
  it('客服使用真实文本安全展示，不将邮箱标为 QQ，店铺未配置没有错误链接', async () => {
    mocks.getPublicSettings.mockResolvedValue({ contact_info: '<script>alert(1)</script> support@example.test', subscription_url: 'https://wrong.example.test', balance_low_notify_recharge_url: 'https://wrong.example.test' })
    const w = await mountView()
    expect(w.get('.uw-contact').text()).toContain('<script>'); expect(w.find('script').exists()).toBe(false)
    expect(w.text()).not.toContain('QQ'); expect(w.findAll('a')).toHaveLength(0)
    expect(button(w, '云猫寄售店铺尚未配置').attributes('disabled')).toBeDefined()
  })
  it('客服加载失败可重试，空配置明确展示', async () => {
    mocks.getPublicSettings.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({})
    const w = await mountView(); expect(w.text()).toContain('客服信息加载失败')
    await button(w, '重试').trigger('click'); await flushPromises(); expect(w.text()).toContain('暂未配置客服信息')
  })
  it.each([false, true])('帮助滚动、焦点、高亮复位与减少动态效果 %s', async reduced => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: reduced }))
    const w = await mountView(); vi.useFakeTimers()
    await button(w, '如何获取兑换码').trigger('click'); await flushPromises()
    expect(w.get('.uw-store').classes()).toContain('uw-highlighted')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    await vi.advanceTimersByTimeAsync(1801)
    expect(w.get('.uw-store').classes()).not.toContain('uw-highlighted')
  })
  it('卸载后忽略迟到活动响应', async () => {
    let finish!: (value: unknown) => void
    mocks.getHistory.mockReturnValueOnce(new Promise(r => { finish = r }))
    const w = await mountView(); w.unmount(); finish({ items: [row()], total: 1 }); await flushPromises()
    expect(mocks.showError).not.toHaveBeenCalled()
  })
  it('英文完整文案', async () => { const w = await mountView('en'); expect(w.text()).toContain('Get a redeem code'); expect(w.text()).toContain('Yunmao store is not configured'); expect(w.text()).not.toContain('userWallet.') })
})
