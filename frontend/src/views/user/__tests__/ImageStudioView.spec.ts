import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createI18n } from 'vue-i18n'
import ImageStudioView from '../ImageStudioView.vue'
import zh from '@/i18n/locales/zh'

const mocks = vi.hoisted(() => ({ selection: vi.fn(), reload: vi.fn() }))
vi.mock('@/composables/useCreationSelection', () => ({ useCreationSelection: mocks.selection }))
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  mocks.selection.mockReturnValue({ userId: ref(1), selectedKey: ref(0), selectedModel: ref(''), credential: ref(null), modelOptions: ref([]), keyOptions: ref([]), loadingKeys: ref(false), loadingModels: ref(false), locked: ref(false), error: ref('暂无可用 API Key，请先在密钥管理中创建。'), notice: ref(''), noAvailableKeys: ref(true), reload: mocks.reload })
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))
async function render(kind = 'image') {
  const router = createRouter({ history: createMemoryHistory(), routes: ['/ai-creation/chat', '/ai-creation/image', '/ai-creation/video', '/keys'].map(path => ({ path, component: { template: '<div />' } })) })
  await router.push(`/ai-creation/${kind}`)
  const wrapper = mount(ImageStudioView, { global: {
    plugins: [router, createI18n({ legacy: false, locale: 'zh', messages: { zh }, messageCompiler: message => () => typeof message === 'string' ? message : '' })],
    stubs: { AppLayout: { template: '<main><slot /></main>' }, Select: true, EmbeddedCanvasStudio: true, CreationChat: true, CreationVideo: true },
  } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
describe('创作页无密钥引导', () => {
  it.each(['chat', 'image', 'video'])('%s 工作台复用创建引导，链接默认选择 OpenAI', async kind => {
    const wrapper = await render(kind)
    const banner = wrapper.get('.creation-key-empty')
    expect(banner.text()).toContain('暂无可用 API Key')
    expect(banner.text()).toContain(kind === 'video' ? '创建视频创作平台的 Key' : '先创建一个 API Key')
    expect(banner.get('.creation-key-create').attributes('href')).toBe(`/keys?action=create&vendor=${kind === 'video' ? 'video' : 'openai'}`)
    expect(wrapper.find('.creation-error').exists()).toBe(false)
    await banner.get('.creation-key-refresh').trigger('click')
    expect(mocks.reload).toHaveBeenCalledOnce()
  })
  it('列表读取失败保留原错误和重试，不展示创建引导', async () => {
    const state = mocks.selection()
    state.noAvailableKeys.value = false
    state.error.value = '连接失败，请重试。'
    const wrapper = await render()
    expect(wrapper.find('.creation-key-empty').exists()).toBe(false)
    expect(wrapper.get('.creation-error').text()).toContain('连接失败')
  })
  it('视频创作开放导航并保留原组件', async () => {
    const wrapper = await render('video')
    expect(wrapper.find('.creation-tabs a[href="/ai-creation/video"]').exists()).toBe(true)
    expect(wrapper.find('.creation-tabs a[href="/ai-creation/chat"]').exists()).toBe(true)
    expect(wrapper.find('.creation-tabs a[href="/ai-creation/image"]').exists()).toBe(true)
    expect(wrapper.find('creation-video-stub').exists()).toBe(true)
  })
})
