import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileView from '@/views/user/ProfileView.vue'

const {
  fetchPublicSettingsMock,
  refreshUserMock,
  authState
} = vi.hoisted(() => ({
  fetchPublicSettingsMock: vi.fn(),
  refreshUserMock: vi.fn(),
  authState: {
    user: null as Record<string, unknown> | null,
    refreshUser: vi.fn()
  }
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    fetchPublicSettings: fetchPublicSettingsMock
  })
}))

vi.mock('@/utils/format', () => ({
  formatDate: () => 'April 2026'
}))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key
    })
  }
})

describe('ProfileView', () => {
  beforeEach(() => {
    refreshUserMock.mockReset()
    fetchPublicSettingsMock.mockReset()
    refreshUserMock.mockResolvedValue(undefined)
    authState.refreshUser = refreshUserMock
    authState.user = {
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      role: 'user',
      balance: 10,
      concurrency: 2,
      status: 'active',
      allowed_groups: null,
      balance_notify_enabled: true,
      balance_notify_threshold: null,
      balance_notify_extra_emails: [],
      created_at: '2026-04-20T00:00:00Z',
      updated_at: '2026-04-20T00:00:00Z'
    }
    fetchPublicSettingsMock.mockResolvedValue({
      contact_info: '',
      balance_low_notify_enabled: false,
      balance_low_notify_threshold: 0,
      linuxdo_oauth_enabled: true,
      wechat_oauth_enabled: true,
      wechat_oauth_open_enabled: true,
      wechat_oauth_mp_enabled: false,
      oidc_oauth_enabled: true,
      oidc_oauth_provider_name: 'OIDC'
    })
  })

  it('renders the responsive profile composition with all security controls', async () => {
    const wrapper = mount(ProfileView, {
      global: {
        stubs: {
          AppLayout: { template: '<div><slot /></div>' },
          StatCard: { template: '<div class="stat-card" />' },
          ProfileInfoCard: { template: '<div data-testid="profile-info-card" />' },
          ProfileBalanceNotifyCard: { template: '<div data-testid="profile-balance-notify-card" />' },
          ProfilePasswordForm: { template: '<div data-testid="profile-password-form" />' },
          ProfilePasskeyCard: { template: '<div data-testid="profile-passkey-card" />' },
          ProfileTotpCard: { template: '<div data-testid="profile-totp-card" />' },
          Icon: true
        }
      }
    })

    await flushPromises()

    expect(wrapper.findAll('.stat-card')).toHaveLength(0)
    expect(wrapper.get('[data-testid="profile-shell"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="profile-shell"]').html()).toContain('profile-info-card')
    expect(wrapper.get('[data-testid="profile-shell"]').html()).toContain('profile-password-form')
    expect(wrapper.get('[data-testid="profile-shell"]').html()).toContain('profile-totp-card')
  })
  function render() {
    return mount(ProfileView, { global: { stubs: {
      AppLayout: { template: '<div class="user-console"><slot /></div>' }, Icon: true,
      ProfileInfoCard: true, ProfileBalanceNotifyCard: true, ProfilePasswordForm: true,
      ProfileTotpCard: true, ProfilePasskeyCard: true,
    } } })
  }
  it('首次读取完成之前不挂载可修改表单', async () => {
    let resolve!: () => void
    refreshUserMock.mockReturnValue(new Promise<void>(yes => { resolve = yes }))
    const w = render(); await flushPromises()
    expect(w.findComponent({ name: 'ProfileInfoCard' }).exists()).toBe(false)
    expect(w.get('[role="status"]').text()).toBe('common.loading')
    resolve(); await flushPromises(); expect(w.findComponent({ name: 'ProfileInfoCard' }).exists()).toBe(true); w.unmount()
  })
  it('资料读取失败撤下表单并可重试', async () => {
    refreshUserMock.mockRejectedValueOnce(new Error('offline'))
    const w = render(); await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('profileV1.loadFailed')
    expect(w.findComponent({ name: 'ProfileInfoCard' }).exists()).toBe(false)
    await w.get('button').trigger('click'); await flushPromises()
    expect(refreshUserMock).toHaveBeenCalledTimes(2); expect(w.findComponent({ name: 'ProfileInfoCard' }).exists()).toBe(true); w.unmount()
  })
  it.each([null, 'reject'])('功能设置失败不开放绑定入口：%s', async (result) => {
    if (result === 'reject') fetchPublicSettingsMock.mockRejectedValue(new Error('denied'))
    else fetchPublicSettingsMock.mockResolvedValue(null)
    const w = render(); await flushPromises(); expect(w.get('[role="alert"]').text()).toContain('profileV1.settingsFailed')
    expect(w.findComponent({ name: 'ProfileInfoCard' }).exists()).toBe(false); w.unmount()
  })
  it('功能开关决定余额提醒和 Passkey 注册能力', async () => {
    fetchPublicSettingsMock.mockResolvedValue({ balance_low_notify_enabled: true, passkey_enabled: true, dingtalk_oauth_enabled: true })
    const w = render(); await flushPromises()
    expect(w.getComponent({ name: 'ProfileBalanceNotifyCard' }).exists()).toBe(true)
    expect(w.getComponent({ name: 'ProfilePasskeyCard' }).attributes('enabled')).toBe('true')
    expect(w.getComponent({ name: 'ProfileInfoCard' }).attributes('dingtalkenabled')).toBe('true'); w.unmount()
  })
  it('管理员使用相同共享资料组合且保留原角色', async () => {
    authState.user!.role = 'admin'
    const w = render(); await flushPromises()
    expect(w.getComponent({ name: 'ProfileInfoCard' }).props('user').role).toBe('admin')
    expect(w.find('.up-security-grid').exists()).toBe(true); w.unmount()
  })

})
