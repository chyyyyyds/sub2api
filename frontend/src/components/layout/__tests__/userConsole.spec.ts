import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import { authAPI } from '@/api'
import type { User, PublicSettings } from '@/types'
import zh from '@/i18n/locales/zh'
import en from '@/i18n/locales/en'
import AppLayout from '../AppLayout.vue'
import UserConsoleHeader from '../UserConsoleHeader.vue'
import { isUserConsoleRoute, userConsoleActivePath, userConsoleNavigation } from '../userConsoleNavigation'

const onboarding = vi.hoisted(() => vi.fn(() => ({ replayTour: vi.fn() })))
vi.mock('@/composables/useOnboardingTour', () => ({ useOnboardingTour: onboarding }))

const state = { authenticated: true, admin: false, simple: false, backend: false, monitor: true }
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

async function render(path = '/dashboard', admin = false, component = AppLayout) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { id: 1, username: '真实账号', email: 'stage1@example.test', role: admin ? 'admin' : 'user', balance: 12.34, frozen_balance: 5 } as User
  auth.token = 'local-test-token'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/dashboard', '/usage', '/monitor', '/keys', '/ai-creation/image', '/redeem', '/profile', '/affiliate', '/admin/dashboard', '/login'].map(path => ({
      path, component: { template: '<div />' },
      meta: { requiresAuth: path !== '/login', requiresAdmin: path.startsWith('/admin/') },
    })),
  })
  await router.push(path)
  const wrapper = mount(component, {
    attachTo: document.body,
    slots: { default: '<div data-test="business-content">原有业务</div>' },
    global: {
      plugins: [pinia, router, createI18n({ legacy: false, locale: 'zh', messages: { zh, en }, messageCompiler: message => () => typeof message === 'string' ? message : '' })],
      stubs: { AppSidebar: { template: '<aside data-test="admin-sidebar" />' }, AppHeader: { template: '<header data-test="admin-header" />' }, AnnouncementBell: { template: '<button data-test="real-bell">公告</button>' } },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router, auth, app: useAppStore() }
}

describe('Stage 1 用户外壳契约', () => {
  it('使用记录位于仪表盘和渠道状态之间，使用原有路径', () => {
    expect(userConsoleNavigation(state).map(item => item.path)).toEqual(['/dashboard', '/usage', '/monitor', '/keys', '/ai-creation/image', '/redeem', '/profile'])
    expect(userConsoleActivePath('/usage')).toBe('/usage')
    expect(userConsoleActivePath('/keys')).toBe('/keys')
    expect(userConsoleActivePath('/ai-creation/chat')).toBe('/ai-creation/image')
    expect(userConsoleActivePath('/ai-creation/video')).toBe('/ai-creation/image')
  })
  it('功能关闭、简易模式、未登录和后台模式只收窄菜单', () => {
    expect(userConsoleNavigation({ ...state, monitor: false, simple: true }).map(item => item.path)).toEqual(['/dashboard', '/keys', '/ai-creation/image', '/profile'])
    expect(userConsoleNavigation({ ...state, authenticated: false })).toEqual([])
    expect(userConsoleNavigation({ ...state, backend: true })).toEqual([])
    expect(userConsoleNavigation({ ...state, backend: true, admin: true })).toHaveLength(7)
  })
  it('外壳选择依据路由元数据，管理员角色不参与判断', () => {
    expect(isUserConsoleRoute({ meta: { requiresAdmin: false } })).toBe(true)
    expect(isUserConsoleRoute({ meta: { requiresAdmin: true } })).toBe(false)
    expect(isUserConsoleRoute({ meta: {} })).toBe(false)
  })
  it.each([false, true])('共享页面无重复外壳，仪表盘与使用记录独立高亮（admin=%s）', async admin => {
    const { wrapper, router } = await render('/dashboard', admin)
    expect(wrapper.findAll('.user-console')).toHaveLength(1)
    expect(wrapper.find('[data-test="admin-sidebar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="business-content"]').text()).toBe('原有业务')
    expect(wrapper.find('.uc-nav [aria-current="page"]').text()).toBe('仪表盘')
    expect(wrapper.find('.uc-tabs').exists()).toBe(false)
    expect(onboarding).toHaveBeenLastCalledWith({ storageKey: admin ? 'admin_guide' : 'user_guide', autoStart: !admin })
    await router.push('/usage')
    expect(wrapper.find('.uc-nav [aria-current="page"]').text()).toBe('使用记录')
    expect(wrapper.find('.uc-tabs').exists()).toBe(false)
  })
  it('管理员后台 → 共享用户页 → 后台保留原有外壳与全局主题', async () => {
    document.documentElement.classList.add('dark')
    const { wrapper, router } = await render('/admin/dashboard', true)
    expect(wrapper.find('[data-test="admin-sidebar"]').exists()).toBe(true)
    expect(onboarding).toHaveBeenLastCalledWith({ storageKey: 'admin_guide', autoStart: true })
    expect(wrapper.find('.uc-header').exists()).toBe(false)
    await router.push('/keys')
    expect(wrapper.find('.uc-header').exists()).toBe(true)
    expect(wrapper.find('[data-test="admin-header"]').exists()).toBe(false)
    await wrapper.find('.uc-account').trigger('click')
    expect(wrapper.find('a[href="/admin/dashboard"]').exists()).toBe(true)
    await router.push('/admin/dashboard')
    expect(wrapper.findAll('[data-test="admin-sidebar"]')).toHaveLength(1)
    expect(wrapper.find('.user-console').exists()).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    document.documentElement.classList.remove('dark')
  })
  it('真实余额随 store 更新，账号菜单在 Escape、焦点离开和换页后关闭', async () => {
    const { wrapper, auth, router } = await render()
    expect(wrapper.find('.uc-balance').text()).toBe('$12.34')
    auth.user!.balance = 98.76
    await flushPromises()
    expect(wrapper.find('.uc-balance').text()).toBe('$98.76')
    await wrapper.find('.uc-balance').trigger('click')
    expect(wrapper.find('.uc-balance-details').text()).toContain('$5.00')
    expect(wrapper.find('.uc-balance-details').text()).toContain('$103.76')
    await wrapper.find('.uc-account').trigger('click')
    expect(wrapper.find('.uc-balance-details').exists()).toBe(false)
    expect(wrapper.find('.uc-identity').text()).toContain('stage1@example.test')
    await wrapper.find('.uc-account').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.uc-account-menu').exists()).toBe(false)
    await wrapper.find('.uc-account').trigger('click')
    await router.push('/profile')
    expect(wrapper.find('.uc-account-menu').exists()).toBe(false)
    await wrapper.find('.uc-account').trigger('click')
    document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    await flushPromises()
    expect(wrapper.find('.uc-account-menu').exists()).toBe(false)
  })
  it('响应现有功能开关及简易模式，不展示受限使用记录和钱包快捷入口', async () => {
    const { wrapper, app, auth } = await render()
    app.cachedPublicSettings = { channel_monitor_enabled: false } as PublicSettings
    vi.spyOn(authAPI, 'getCurrentUser').mockResolvedValue({ data: { ...auth.user, run_mode: 'simple' } } as Awaited<ReturnType<typeof authAPI.getCurrentUser>>)
    await auth.refreshUser()
    await flushPromises()
    expect(wrapper.findAll('.uc-nav-link').map(link => link.text())).toEqual(['仪表盘', 'API 密钥', 'AI 创作', '个人资料'])
    expect(wrapper.find('.uc-tabs').exists()).toBe(false)
    await wrapper.find('.uc-account').trigger('click')
    expect(wrapper.find('.uc-account-menu a[href="/redeem"]').exists()).toBe(false)
  })
  it('退出复用认证 store 并返回原登录路由', async () => {
    const { wrapper, auth, router } = await render('/keys', false, UserConsoleHeader)
    const logout = vi.spyOn(auth, 'logout').mockResolvedValue()
    await wrapper.find('.uc-account').trigger('click')
    await wrapper.find('.uc-logout').trigger('click')
    await flushPromises()
    expect(logout).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.path).toBe('/login')
  })
  it('管理员分支模板保持 HEAD 原样，用户 CSS 所有选择器均带命名空间', () => {
    const root = resolve(import.meta.dirname, '../../../../..')
    // 固定 Stage 1 前基线，避免创建检查点后 HEAD 改变导致自我比较。
    const before = execFileSync('git', ['show', '7da09cab4e875463baa79fc150adde700c5438df:frontend/src/components/layout/AppLayout.vue'], { cwd: root, encoding: 'utf8' })
    const after = readFileSync(resolve(root, 'frontend/src/components/layout/AppLayout.vue'), 'utf8')
    const template = (source: string) => source.slice(0, source.indexOf('</template>')).replace(/\r\n/g, '\n')
    expect(template(after).replace('  <UserConsoleLayout v-if="isUserConsole"><slot /></UserConsoleLayout>\n', '').replace('<div v-else ', '<div ')).toBe(template(before))
    const css = readFileSync(resolve(root, 'frontend/src/styles/user-console.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of css.matchAll(/([^{}]+)\{/g)) {
      const selector = match[1].trim()
      if (!selector.startsWith('@')) expect(selector.startsWith('.user-console')).toBe(true)
    }
    expect(css).not.toMatch(/(?:^|[},])\s*(?::root|body|html|\.dark)\b/)
  })
})
