import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'
import type { PublicSettings, User } from '@/types'
import zh from '@/i18n/locales/zh'
import AuthLayout from '../AuthLayout.vue'
import SpaceAuthLayout from '@/components/space/SpaceAuthLayout.vue'
import ModelPlazaView from '@/views/ModelPlazaView.vue'

vi.mock('@/api/modelPlaza', () => ({ getModelPlaza: vi.fn().mockResolvedValue({ groups: [] }) }))
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.restoreAllMocks() })

async function render(component: typeof AuthLayout | typeof SpaceAuthLayout | typeof ModelPlazaView, { authenticated = false, admin = false, enabled = true, path = '/model-plaza' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const app = useAppStore()
  app.cachedPublicSettings = { model_plaza_enabled: enabled, site_name: '天启星', site_logo: '/custom-logo.png' } as PublicSettings
  app.publicSettingsLoaded = true
  vi.spyOn(app, 'fetchPublicSettings').mockResolvedValue(app.cachedPublicSettings)
  const auth = useAuthStore()
  if (authenticated) { auth.token = 'fixture-token'; auth.user = { id: 1, role: admin ? 'admin' : 'user' } as User }
  const router = createRouter({ history: createMemoryHistory(), routes: ['/login', '/register', '/model-plaza', '/home', '/dashboard'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push(path)
  const wrapper = mount(component, { global: {
    plugins: [pinia, router, createI18n({ legacy: false, locale: 'zh', messages: { zh }, messageCompiler: message => () => typeof message === 'string' ? message : '' })],
    stubs: { AppLayout: { template: '<div data-test="authenticated-layout"><slot /></div>' }, ModelPlazaContent: { template: '<div data-test="plaza-content" />' } },
  } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('认证页与模型广场导航', () => {
  it.each([AuthLayout, SpaceAuthLayout])('登录与注册布局按开关展示模型广场和四宫格图标', async component => {
    const wrapper = await render(component)
    const link = wrapper.get('a[href="/model-plaza"]')
    expect(link.text()).toBe('模型广场')
    expect(link.find('svg').exists()).toBe(true)
    useAppStore().cachedPublicSettings = { model_plaza_enabled: false } as PublicSettings
    await flushPromises()
    expect(wrapper.find('a[href="/model-plaza"]').exists()).toBe(false)
  })
  it.each(['/model-plaza', '/model-plaza?embedded=1'])('访客访问 %s 保留品牌和登录按钮', async path => {
    const wrapper = await render(ModelPlazaView, { path })
    expect(wrapper.find('[data-test="authenticated-layout"]').exists()).toBe(false)
    expect(wrapper.get('header').text()).toContain('天启星')
    expect(wrapper.get('header a').attributes('href')).toContain('/login?redirect=/model-plaza')
    expect(wrapper.find('[data-test="plaza-content"]').exists()).toBe(true)
  })
  it.each([false, true])('登录后直接访问与 embedded 链接均使用系统导航（admin=%s）', async admin => {
    for (const path of ['/model-plaza', '/model-plaza?embedded=1']) {
      const wrapper = await render(ModelPlazaView, { authenticated: true, admin, path })
      expect(wrapper.find('[data-test="authenticated-layout"]').exists()).toBe(true)
      expect(wrapper.find('header').exists()).toBe(false)
      expect(wrapper.find('[data-test="plaza-content"]').exists()).toBe(true)
    }
  })
})
