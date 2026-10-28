import { mount } from '@vue/test-utils'
import { defineComponent, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { keysAPI } from '@/api/keys'
import { useCreationSelection, type CreationKind } from '../useCreationSelection'
import type { ApiKey } from '@/types'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))
vi.mock('@/api/keys', () => ({ keysAPI: { list: vi.fn(), getById: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const auth = reactive({ user: { id: 71 }, isAuthenticated: true })
const key = (id: number, status = 'active') => ({ id, user_id: auth.user.id, name: `Key ${id}`, key: `memory-${id}`, status, quota: 0, quota_used: 0, expires_at: null, group: { name: '本人分组', allow_image_generation: true } }) as ApiKey
function setup() {
  let selection!: ReturnType<typeof useCreationSelection>
  const wrapper = mount(defineComponent({ setup() { selection = useCreationSelection(ref<CreationKind>('chat')); return () => null } }))
  return { selection, wrapper }
}
beforeEach(() => {
  auth.user.id = 71; auth.isAuthenticated = true
  vi.mocked(keysAPI.list).mockReset().mockResolvedValue({ items: [key(1), key(2)], total: 2 } as never)
  vi.mocked(keysAPI.getById).mockReset().mockImplementation(async id => key(id))
  vi.mocked(axios.get).mockReset().mockResolvedValue({ data: { data: [{ id: 'gpt-6' }, { id: 'claude-sonnet' }, { id: 'private-alias' }] } })
})
describe('P2 模型与 Key 偏好重新验证', () => {
  it.each([
    [['codex-auto-review', 'gpt-6.1-sol', 'gpt-6-sol'], 'gpt-6-sol'],
    [['private-alias', 'gpt-6.1-sol'], 'gpt-6.1-sol'],
    [['private-alias', 'claude-sonnet'], 'private-alias'],
  ])('新会话仅在本人目录中选择默认模型 %#', async (catalog, expected) => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: (catalog as string[]).map(id => ({ id })) } })
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.model).toBe(expected))
    wrapper.unmount()
  })
  it('目录刷新不覆盖用户已手动选择的模型', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { data: ['private-alias', 'gpt-6-sol'].map(id => ({ id })) } })
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.model).toBe('gpt-6-sol'))
    s.selectedModel.value = 'private-alias'
    await vi.waitFor(() => expect(s.credential.value?.model).toBe('private-alias'))
    await s.reload()
    await vi.waitFor(() => expect(s.credential.value?.model).toBe('private-alias'))
    wrapper.unmount()
  })
  it('恢复手动偏好并重新读取本人目录；切 Key 不丢模型', async () => {
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value).not.toBeNull())
    s.selectedKey.value = 2; s.selectedModel.value = 'claude-sonnet'
    await vi.waitFor(() => expect(s.credential.value).toMatchObject({ keyId: 2, model: 'claude-sonnet' }))
    s.selectedKey.value = 1
    await vi.waitFor(() => expect(s.credential.value).toMatchObject({ keyId: 1, model: 'claude-sonnet' }))
    expect(s.modelOptions.value.some(o => o.value === 'private-alias')).toBe(true)
    wrapper.unmount()
  })
  it('已删除或禁用的旧 Key 不自动换成收费 Key，提示后等待用户选择', async () => {
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value).not.toBeNull())
    s.selectedKey.value = 999
    expect(s.credential.value).toBeNull()
    expect(s.error.value).toBe('imageStudio.savedKeyUnavailable')
    expect(s.selectedKey.value).toBe(999)
    s.selectedKey.value = 2
    vi.mocked(keysAPI.getById).mockResolvedValue(key(2, 'disabled'))
    await s.reload()
    expect(s.credential.value).toBeNull()
    wrapper.unmount()
  })
  it('目录变化保留服务端权限边界，不能通过协议配置绕过目录', async () => {
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value).not.toBeNull())
    s.selectedModel.value = 'not-authorized'
    await vi.waitFor(() => expect(s.selectedModel.value).toBe('gpt-6'))
    expect(s.credential.value?.models).not.toContain('not-authorized')
    wrapper.unmount()
  })
  it('模型只来自所选 Key，并用该 Key 的 Authorization 重新获取目录', async () => {
    vi.mocked(axios.get).mockImplementation(async (_url, config) => ({ data: { data: (config?.headers?.Authorization === 'Bearer memory-1' ? ['gpt-6-sol'] : ['claude-sonnet']).map(id => ({ id })) } }))
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.keyId).toBe(1))
    expect(s.modelOptions.value.map(option => option.value)).toEqual(['gpt-6-sol'])
    expect(s.keyOptions.value.map(option => option.value)).toEqual([1, 2])
    s.selectedKey.value = 2
    await vi.waitFor(() => expect(s.credential.value?.keyId).toBe(2))
    expect(s.modelOptions.value.map(option => option.value)).toEqual(['claude-sonnet'])
    expect(axios.get).toHaveBeenLastCalledWith('/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer memory-2' } }))
    wrapper.unmount()
  })
  it('默认选择首个有生图目录且支持当前聊天的本人 Key', async () => {
    vi.mocked(axios.get).mockImplementation(async (_url, config) => ({ data: { data: (config?.headers?.Authorization === 'Bearer memory-1' ? ['gpt-6-sol', 'private-alias', 'codex-auto-review'] : ['gpt-image-2', 'gpt-6-sol']).map(id => ({ id })) } }))
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.keyId).toBe(2))
    expect(s.selectedKey.value).toBe(2)
    expect(s.modelOptions.value.map(option => option.value)).toEqual(['gpt-6-sol'])
    wrapper.unmount()
  })
  it('列出本人不可用 Key 但禁用选择，不读取其明文或模型目录', async () => {
    vi.mocked(keysAPI.list).mockResolvedValue({ items: [key(1, 'inactive'), key(2), { ...key(3), user_id: 999 }], total: 3 } as never)
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.keyId).toBe(2))
    expect(s.keyOptions.value.map(option => [option.value, option.disabled])).toEqual([[1, true], [2, false]])
    expect(keysAPI.getById).not.toHaveBeenCalledWith(1)
    expect(keysAPI.getById).not.toHaveBeenCalledWith(3)
    wrapper.unmount()
  })
  it('旧会话的 auto 偏好恢复为具体 Key，目录故障不继续显示旧模型', async () => {
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value?.keyId).toBe(1))
    s.selectedKey.value = 'auto'
    await vi.waitFor(() => expect(s.selectedKey.value).toBe(1))
    vi.mocked(axios.get).mockRejectedValue(new Error('offline'))
    s.selectedModel.value = 'claude-sonnet'
    await vi.waitFor(() => expect(s.error.value).toBe('imageStudio.incompatible'))
    expect(s.modelOptions.value).toEqual([])
    expect(s.credential.value).toBeNull()
    wrapper.unmount()
  })
  it('跨标签换号 storage 事件锁定凭证，旧用户目录立即清空', async () => {
    const { selection: s, wrapper } = setup()
    await vi.waitFor(() => expect(s.credential.value).not.toBeNull())
    localStorage.setItem('auth_token', 'mock')
    localStorage.setItem('auth_user', '{"id":72}')
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_user' }))
    expect(s.locked.value).toBe(true); expect(s.credential.value).toBeNull(); expect(s.keys.value).toEqual([])
    wrapper.unmount(); localStorage.clear()
  })
})
