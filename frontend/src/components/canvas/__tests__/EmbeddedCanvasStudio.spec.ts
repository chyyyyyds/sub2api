import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { keysAPI } from '@/api/keys'
import axios from 'axios'
import EmbeddedCanvasStudio from '../EmbeddedCanvasStudio.vue'
import { defineComponent, ref } from 'vue'
import { useCreationSelection, type CreationKind } from '@/composables/useCreationSelection'

vi.mock('@/api/keys', () => ({ keysAPI: { list: vi.fn(), getById: vi.fn() } }))
vi.mock('vue-i18n', async load => ({ ...await load<typeof import('vue-i18n')>(), useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('axios', async importOriginal => {
  const actual = await importOriginal<typeof import('axios')>()
  return { ...actual, default: { ...actual.default, get: vi.fn() } }
})
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = { id: 101, role: 'user' } as typeof auth.user
  auth.token = 'fixture-jwt'
  localStorage.setItem('auth_user', JSON.stringify({ id: 101 }))
  localStorage.setItem('auth_token', 'fixture-jwt')
  vi.mocked(keysAPI.list).mockResolvedValue({ items: [{ id: 1, name: '图片', status: 'active', user_id: 101, key: 'fixture-user-key' }], total: 1 } as never)
  vi.mocked(keysAPI.getById).mockResolvedValue({ id: 1, name: '图片', user_id: 101, status: 'active', key: 'fixture-user-key' } as never)
  vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'gpt-image-2' }] } })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.clearAllMocks(); localStorage.clear() })

async function render() {
  // 通过真实共享选择器创建内存配置，继续覆盖 Phase 1 的权限和隔离边界。
  const Harness = defineComponent({
    components: { EmbeddedCanvasStudio },
    setup() {
      const kind = ref<CreationKind>('image')
      const selection = useCreationSelection(kind)
      const connected = ref(false)
      return { ...selection, kind, connected }
    },
    template: '<EmbeddedCanvasStudio :credential="credential" :locked="locked" :error="error" @connected="connected = $event" /><span>{{ error }} {{ connected ? "imageStudio.connected" : "" }}</span>'
  })
  const wrapper = mount(Harness, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('图片创作桥接与用户会话', () => {
  it('Key 查询期间提前加载空画布，记住 ready 并只发送随后验证通过的凭证', async () => {
    let finish!: (value: never) => void
    vi.mocked(keysAPI.getById).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = await render()
    const iframe = wrapper.find('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow!, data: { version: 1, type: 'new-api:canvas-ready', frameId: 'early-frame' } }))
    expect(post).not.toHaveBeenCalled()
    finish({ id: 1, user_id: 101, name: '图片', status: 'active', key: 'fixture-user-key' } as never)
    await flushPromises()
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toMatchObject({ type: 'new-api:canvas-config', frameId: 'early-frame', keyId: 1, preferredModel: 'gpt-image-2' })
    expect(keysAPI.getById).toHaveBeenCalledTimes(1)
  })
  it('同一用户资料刷新不清空选择、不重查目录、不暂停正在使用的画布', async () => {
    const wrapper = await render()
    const iframe = wrapper.find('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow!, data: { version: 1, type: 'new-api:canvas-ready', frameId: 'refresh-frame' } }))
    const vm = wrapper.vm as unknown as { credential: object; selectedModel: string; selectedKey: number }
    const credential = vm.credential
    const calls = [vi.mocked(keysAPI.list).mock.calls.length, vi.mocked(keysAPI.getById).mock.calls.length, vi.mocked(axios.get).mock.calls.length]
    post.mockClear()
    // 模拟 auth/me 周期性返回同一用户的新资料对象，ID 与登录状态均未变化。
    const auth = useAuthStore()
    auth.user = { ...auth.user!, balance: 9.5 }
    await flushPromises()
    expect(vm.credential).toBe(credential)
    expect(vm.selectedKey).toBe(1)
    expect(vm.selectedModel).toBe('gpt-image-2')
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(wrapper.find('iframe').attributes('style') || '').not.toContain('pointer-events: none')
    expect([vi.mocked(keysAPI.list).mock.calls.length, vi.mocked(keysAPI.getById).mock.calls.length, vi.mocked(axios.get).mock.calls.length]).toEqual(calls)
    expect(post).not.toHaveBeenCalled()
  })
  it('只读取用户Key接口，拒绝非所属Key', async () => {
    vi.mocked(keysAPI.getById).mockResolvedValue({ id: 1, user_id: 202, key: 'foreign-key', status: 'active' } as never)
    const wrapper = await render()
    // 无凭证框架可以提前下载，但未核实所属权时必须禁用且不能读取模型。
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(axios.get).not.toHaveBeenCalled()
  })
  it('验证窗口来源并关联握手，支持iframe独立刷新', async () => {
    const wrapper = await render()
    const iframe = wrapper.find('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
    const send = (data: object, source: Window = iframe.contentWindow!) => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source, data: { version: 1, ...data } }))
    send({ type: 'new-api:canvas-ready', frameId: 'evil' }, window)
    expect(post).not.toHaveBeenCalled()
    send({ type: 'new-api:canvas-ready', frameId: 'first' })
    const config = post.mock.calls[0][0] as Record<string, unknown>
    expect(config.apiKey).toBe('fixture-user-key')
    expect(config.baseUrl).toBe(location.origin)
    send({ type: 'new-api:canvas-configured', frameId: 'first', sessionId: 'old' })
    await flushPromises()
    expect(wrapper.text()).not.toContain('imageStudio.connected')
    send({ type: 'new-api:canvas-configured', frameId: 'first', sessionId: config.sessionId })
    await flushPromises()
    expect(wrapper.text()).toContain('imageStudio.connected')
    send({ type: 'new-api:canvas-ready', frameId: 'reloaded' })
    expect(post).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(localStorage)).not.toContain('fixture-user-key')
  })
  it('Key查询迟到时不为已退出用户加载模型', async () => {
    let complete!: (value: never) => void
    vi.mocked(keysAPI.getById).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const wrapper = await render()
    useAuthStore().user = null
    useAuthStore().token = null
    await flushPromises()
    complete({ id: 1, user_id: 101, status: 'active', key: 'old-key' } as never)
    await flushPromises()
    expect(axios.get).not.toHaveBeenCalled()
    expect(wrapper.find('iframe').exists()).toBe(false)
  })
  it('其他标签页退出立即销毁画布', async () => {
    const wrapper = await render()
    expect(wrapper.find('iframe').exists()).toBe(true)
    localStorage.removeItem('auth_token')
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', newValue: null }))
    await flushPromises()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('imageStudio.sessionChanged')
  })
  it('默认选中具体可生图 Key，不提供自动匹配选项', async () => {
    const wrapper = await render()
    const vm = wrapper.vm as unknown as { selectedKey: number; keyOptions: { label: string }[]; credential: { keyId: number } }
    expect(vm.selectedKey).toBe(1)
    expect(vm.keyOptions).toHaveLength(1)
    expect(vm.credential.keyId).toBe(1)
    expect(keysAPI.getById).toHaveBeenCalledTimes(1)
  })
  it('耗尽、过期和禁用 Key 不参与自动匹配', async () => {
    vi.mocked(keysAPI.list).mockResolvedValue({ items: [
      { id: 1, user_id: 101, status: 'active', quota: 2, quota_used: 2 },
      { id: 2, user_id: 101, status: 'active', expires_at: '2020-01-01' },
      { id: 3, user_id: 101, status: 'disabled' }
    ], total: 3 } as never)
    const wrapper = await render()
    expect(keysAPI.getById).not.toHaveBeenCalled()
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.text()).toContain('imageStudio.noKeys')
  })
  it('图片分组权限关闭时不能配置画布', async () => {
    vi.mocked(keysAPI.getById).mockResolvedValue({ id: 1, name: '受限', user_id: 101, status: 'active', key: 'fixture-user-key', group: { allow_image_generation: false } } as never)
    const wrapper = await render()
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.text()).toContain('imageStudio.incompatible')
  })
  it('模型目录仅包含视频时不能配置图片画布', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'seedance-2.0' }] } })
    const wrapper = await render()
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.text()).toContain('imageStudio.incompatible')
  })
  it('切换模型时重新核实目录，不沿用已撤销权限', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'gpt-image-2' }, { id: 'flux-1' }] } })
    const wrapper = await render()
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [] } })
    ;(wrapper.vm as unknown as { selectedModel: string }).selectedModel = 'gpt-image-2'
    await flushPromises()
    expect((wrapper.vm as unknown as { credential: unknown }).credential).toBeNull()
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.text()).toContain('imageStudio.incompatible')
  })
  it('视频外壳不展示旧模型、不创建任务', async () => {
    const wrapper = await render()
    const vm = wrapper.vm as unknown as { kind: CreationKind; modelOptions: unknown[]; credential: unknown }
    vm.kind = 'video'
    await flushPromises()
    expect(vm.modelOptions).toEqual([])
    expect(vm.credential).toBeNull()
  })
  it('只展示所选 Key 的模型，切模型不暗中跨 Key，手动切 Key 重新读取目录', async () => {
    const fixture = (id: number) => ({ id, name: `Key${id}`, user_id: 101, status: 'active', key: `fixture-key-${id}` })
    vi.mocked(keysAPI.list).mockResolvedValue({ items: [fixture(1), fixture(2)], total: 2 } as never)
    vi.mocked(keysAPI.getById).mockImplementation(async id => fixture(id) as never)
    vi.mocked(axios.get).mockImplementation(async (_url, config) => ({ data: { data: (config?.headers?.Authorization === 'Bearer fixture-key-1' ? ['gpt-image-2'] : ['flux-1', 'flux-2']).map(id => ({ id })) } }))
    const wrapper = await render()
    const vm = wrapper.vm as unknown as { selectedModel: string; selectedKey: number | string; credential: { keyId: number }; keyOptions: unknown[]; modelOptions: { value: string }[] }
    expect(vm.modelOptions.map(option => option.value)).toEqual(['gpt-image-2'])
    vm.selectedModel = 'flux-2'
    await flushPromises()
    expect(vm.credential.keyId).toBe(1)
    expect(vm.selectedModel).toBe('gpt-image-2')
    vm.selectedKey = 2
    await flushPromises()
    expect(vm.credential.keyId).toBe(2)
    expect(vm.selectedKey).toBe(2)
    expect(vm.modelOptions.map(option => option.value)).toEqual(['flux-1', 'flux-2'])
    vm.selectedKey = 1
    await flushPromises()
    expect(vm.selectedKey).toBe(1)
    expect(vm.selectedModel).toBe('gpt-image-2')
    expect(vm.credential.keyId).toBe(1)
    expect(vm.modelOptions.map(option => option.value)).toEqual(['gpt-image-2'])
    expect(vm.keyOptions).toHaveLength(2)
    expect(JSON.stringify(localStorage)).not.toContain('fixture-key-')
  })
  it('手动选择不兼容 Key 后保留选择并明确报错', async () => {
    const wrapper = await render()
    vi.mocked(keysAPI.getById).mockResolvedValue({ id: 1, name: '受限', user_id: 101, status: 'active', key: 'fixture-user-key', group: { allow_image_generation: false } } as never)
    const vm = wrapper.vm as unknown as { selectedKey: number | string; reload: () => Promise<void> }
    vm.selectedKey = 1
    await vm.reload()
    await flushPromises()
    expect(vm.selectedKey).toBe(1)
    expect((wrapper.vm as unknown as { credential: unknown }).credential).toBeNull()
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
    expect(wrapper.text()).toContain('imageStudio.incompatible')
  })
  it('快速切换时迟到的模型响应不能覆盖新选择', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'gpt-image-2' }, { id: 'flux-1' }] } })
    const wrapper = await render()
    let finish!: (value: never) => void
    vi.mocked(axios.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const vm = wrapper.vm as unknown as { selectedModel: string; credential: { model: string } }
    vm.selectedModel = 'gpt-image-2'
    await flushPromises()
    vm.selectedModel = 'flux-1'
    await flushPromises()
    finish({ data: { data: [{ id: 'gpt-image-2' }] } } as never)
    await flushPromises()
    expect(vm.credential.model).toBe('flux-1')
  })
  it('工作台切换保持各自手动 Key 偏好', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'gpt-image-2' }, { id: 'gpt-6' }] } })
    const wrapper = await render()
    const vm = wrapper.vm as unknown as { kind: CreationKind; selectedKey: number | string; credential: { model: string } }
    vm.selectedKey = 1
    await flushPromises()
    vm.kind = 'chat'
    await flushPromises()
    expect(vm.selectedKey).toBe(1)
    expect(vm.credential.model).toBe('gpt-6')
    vm.kind = 'image'
    await flushPromises()
    expect(vm.selectedKey).toBe(1)
    expect(vm.credential.model).toBe('gpt-image-2')
  })
  it('同一用户切换模型和 Key 不重建 iframe，鉴权间隙暂停旧配置', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: [{ id: 'gpt-image-2' }, { id: 'gpt-image-1.5' }] } })
    const wrapper = await render()
    const iframe = wrapper.find('iframe').element as HTMLIFrameElement
    const post = vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {})
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow!, data: { version: 1, type: 'new-api:canvas-ready', frameId: 'hot-frame' } }))
    const vm = wrapper.vm as unknown as { selectedModel: string; selectedKey: number | string }
    vm.selectedModel = 'gpt-image-2'
    await flushPromises()
    vm.selectedModel = 'gpt-image-1.5'
    await flushPromises()
    vm.selectedKey = 1
    await flushPromises()
    expect(wrapper.find('iframe').element).toBe(iframe)
    expect(post.mock.calls.some(([value]) => value.type === 'new-api:canvas-suspend')).toBe(true)
    const configs = post.mock.calls.map(([value]) => value).filter(value => value.type === 'new-api:canvas-config')
    expect(configs.at(-1).preferredModel).toBe('gpt-image-1.5')
    expect(configs.at(-1).keyId).toBe(1)
    // iframe 在重新读取 Key 时自行刷新，新的 ready 也应被记住，避免丢失一次性握手。
    let finish!: (value: never) => void
    vi.mocked(axios.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vm.selectedKey = 'auto'
    await flushPromises()
    window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: iframe.contentWindow!, data: { version: 1, type: 'new-api:canvas-ready', frameId: 'reloaded-during-auth' } }))
    finish({ data: { data: [{ id: 'gpt-image-1.5' }] } } as never)
    await flushPromises()
    const latest = post.mock.calls.map(([value]) => value).filter(value => value.type === 'new-api:canvas-config').at(-1)
    expect(latest.frameId).toBe('reloaded-during-auth')
  })
  it('密钥接口故障显示连接失败，不误报没有密钥', async () => {
    vi.mocked(keysAPI.list).mockRejectedValue(new Error('fixture-offline'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('imageStudio.failed')
    expect(wrapper.text()).not.toContain('imageStudio.noKeys')
    expect(wrapper.find('iframe').attributes('style')).toContain('pointer-events: none')
  })
})
