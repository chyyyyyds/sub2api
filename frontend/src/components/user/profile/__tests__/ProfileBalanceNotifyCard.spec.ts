import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ProfileBalanceNotifyCard from '../ProfileBalanceNotifyCard.vue'

const { sendNotifyEmailCode, verifyNotifyEmail, getProfile, updateProfile, toggleNotifyEmail, removeNotifyEmail, authState, showError, showSuccess } = vi.hoisted(() => ({
  sendNotifyEmailCode: vi.fn(),
  verifyNotifyEmail: vi.fn(),
  getProfile: vi.fn(), updateProfile: vi.fn(), toggleNotifyEmail: vi.fn(), removeNotifyEmail: vi.fn(),
  authState: { user: null as Record<string, unknown> | null }, showError: vi.fn(), showSuccess: vi.fn()
}))

vi.mock('@/api', () => ({
  userAPI: { sendNotifyEmailCode, verifyNotifyEmail, getProfile, updateProfile, toggleNotifyEmail, removeNotifyEmail, authState, showError, showSuccess }
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => authState }))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showSuccess, showError })
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

enableAutoUnmount(afterEach)

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const pendingRows = (wrapper: VueWrapper) => wrapper.findAll('.bg-yellow-50')
const pendingEmails = (wrapper: VueWrapper) => pendingRows(wrapper).map(row => row.get('span').text())

const button = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find(item => item.text() === text)!

describe('ProfileBalanceNotifyCard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    authState.user = null
    updateProfile.mockResolvedValue({ balance_notify_extra_emails: [] })
    toggleNotifyEmail.mockResolvedValue({ balance_notify_extra_emails: [] })
    sendNotifyEmailCode.mockResolvedValue({})
    getProfile.mockResolvedValue({ balance_notify_extra_emails: [] })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it.each(['remove', 'unmount'])('does not start a pending email timer after %s', async (action) => {
    const request = deferred()
    sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: { enabled: true, threshold: null, extraEmails: [], systemDefaultThreshold: 5, userEmail: '' }
    })
    await wrapper.get('input[type="email"]').setValue('new@example.com')
    await button(wrapper, 'common.add').trigger('click')
    await button(wrapper, 'profile.balanceNotify.sendCode').trigger('click')
    if (action === 'remove') await button(wrapper, 'profile.balanceNotify.removeEmail').trigger('click')
    else wrapper.unmount()

    request.resolve()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a saved email timer after unmount', async () => {
    const request = deferred()
    sendNotifyEmailCode.mockReturnValueOnce(request.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: {
        enabled: true, threshold: null, systemDefaultThreshold: 5, userEmail: '',
        extraEmails: [{ email: 'saved@example.com', disabled: false, verified: false }]
      }
    })
    await button(wrapper, 'profile.balanceNotify.verify').trigger('click')
    wrapper.unmount()
    request.resolve()
    await flushPromises()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, 1])('removes only verified emails when request %i finishes first', async (first) => {
    const emails = ['first@example.com', 'second@example.com', 'third@example.com']
    const requests = [deferred(), deferred()]
    verifyNotifyEmail.mockImplementation((email: string) => requests[emails.indexOf(email)]!.promise)
    const wrapper = mount(ProfileBalanceNotifyCard, {
      props: { enabled: true, threshold: null, extraEmails: [], systemDefaultThreshold: 5, userEmail: '' }
    })

    for (const email of emails) {
      await wrapper.get('input[type="email"]').setValue(email)
      await button(wrapper, 'common.add').trigger('click')
    }
    for (const row of pendingRows(wrapper)) {
      await row.findAll('button').find(item => item.text() === 'profile.balanceNotify.sendCode')!.trigger('click')
    }
    await flushPromises()
    for (const row of pendingRows(wrapper)) {
      await row.get('input').setValue('123456')
    }
    for (const row of pendingRows(wrapper).slice(0, 2)) {
      await row.findAll('button').find(item => item.text() === 'profile.balanceNotify.verify')!.trigger('click')
    }
    expect(verifyNotifyEmail.mock.calls).toEqual(emails.slice(0, 2).map(email => [email, '123456']))

    requests[first]!.resolve()
    await flushPromises()
    expect(pendingEmails(wrapper)).toEqual(emails.filter((_, index) => index !== first))

    requests[1 - first]!.resolve()
    await flushPromises()
    expect(pendingEmails(wrapper)).toEqual([emails[2]])
    expect((pendingRows(wrapper)[0]!.get('input').element as HTMLInputElement).value).toBe('123456')
    expect(getProfile).toHaveBeenCalledTimes(2)
  })
  const render = () => mount(ProfileBalanceNotifyCard, { props: { enabled: true, threshold: 5, extraEmails: [{ email: 'saved@example.test', verified: true, disabled: false }], systemDefaultThreshold: 10, userEmail: '' } })
  it('余额提醒开关保存真实接口结果', async () => {
    const w = render(); await w.get('input[type=checkbox]').setValue(false); await flushPromises()
    expect(updateProfile).toHaveBeenCalledWith({ balance_notify_enabled: false }); expect(authState.user).toEqual({ balance_notify_extra_emails: [] })
  })
  it('余额提醒保存失败恢复原开关', async () => {
    updateProfile.mockRejectedValue({ message: 'permission denied' }); const w = render(); await w.get('input[type=checkbox]').setValue(false); await flushPromises()
    expect((w.get('input[type=checkbox]').element as HTMLInputElement).checked).toBe(true); expect(showError).toHaveBeenCalledWith('permission denied')
  })
  it('提醒阈值走真实资料接口并同步 Store', async () => {
    const w = render(); await w.get('input[type=number]').setValue('12.5'); await button(w, 'common.save').trigger('click'); await flushPromises()
    expect(updateProfile).toHaveBeenCalledWith({ balance_notify_threshold: 12.5 }); expect(showSuccess).toHaveBeenCalledWith('common.saved')
  })
  it('阈值保存期间拦截重复提交', async () => {
    const pending = deferred(); updateProfile.mockReturnValue(pending.promise); const w = render(); const save = button(w, 'common.save'); await save.trigger('click'); await save.trigger('click')
    expect(updateProfile).toHaveBeenCalledOnce(); pending.resolve(); await flushPromises()
  })
  it('通知邮箱开关与删除保留正式 API', async () => {
    removeNotifyEmail.mockResolvedValue(undefined); const w = render(); await w.findAll('input[type=checkbox]')[1]!.setValue(false); await flushPromises()
    expect(toggleNotifyEmail).toHaveBeenCalledWith('saved@example.test', true)
    const w2 = render(); await button(w2, 'profile.balanceNotify.removeEmail').trigger('click'); await flushPromises()
    expect(removeNotifyEmail).toHaveBeenCalledWith('saved@example.test'); expect(getProfile).toHaveBeenCalled()
  })
  it('发送验证码启动倒计时并在卸载时清理', async () => {
    const w = render(); await w.get('input[type=email]').setValue('new@example.test'); await button(w, 'common.add').trigger('click'); await button(w, 'profile.balanceNotify.sendCode').trigger('click'); await flushPromises()
    expect(w.text()).toContain('60s'); vi.advanceTimersByTime(1000); await flushPromises(); expect(w.text()).toContain('59s'); w.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('验证码错误保留待验证邮箱且不显示验证成功', async () => {
    verifyNotifyEmail.mockRejectedValue({ message: '验证码已过期' }); const w = render(); await w.get('input[type=email]').setValue('new@example.test'); await button(w, 'common.add').trigger('click'); await button(w, 'profile.balanceNotify.sendCode').trigger('click'); await flushPromises()
    await pendingRows(w)[0]!.get('input').setValue('111111'); await button(w, 'profile.balanceNotify.verify').trigger('click'); await flushPromises()
    expect(pendingEmails(w)).toContain('new@example.test'); expect(showError).toHaveBeenCalledWith('验证码已过期'); expect(showSuccess).not.toHaveBeenCalledWith('profile.balanceNotify.verifySuccess')
  })

})
