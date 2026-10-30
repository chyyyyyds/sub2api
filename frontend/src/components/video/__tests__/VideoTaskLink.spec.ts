import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VideoTaskLink from '../VideoTaskLink.vue'
const state = vi.hoisted(() => ({ role: 'admin', get: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { role: state.role } }) }))
vi.mock('@/api/client', () => ({ apiClient: { get: state.get } }))
const id = 'vtsk_' + 'a'.repeat(32)
describe('视频使用记录任务链接', () => {
  beforeEach(() => { state.role = 'admin'; state.get.mockReset(); state.get.mockResolvedValue({ data: null }) })
  it('管理员省略可选标志时读取管理任务和财务接口', async () => {
    const wrapper = mount(VideoTaskLink, { props: { requestId: `video:cap:${id}` }, global: { stubs: { BaseDialog: true } } })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(state.get.mock.calls.map(c => c[0])).toEqual([`/admin/video-tasks/${id}/audit`, `/admin/video-tasks/${id}`])
  })
  it('普通用户只读取自己的任务，不请求管理审计', async () => {
    state.role = 'user'
    const wrapper = mount(VideoTaskLink, { props: { requestId: `video:cap:${id}` }, global: { stubs: { BaseDialog: true } } })
    await wrapper.get('button').trigger('click'); await flushPromises()
    expect(state.get.mock.calls.map(c => c[0])).toEqual([`/user/video-tasks/${id}`])
  })
  it('旧聊天和图片记录不显示视频入口', () => {
    const wrapper = mount(VideoTaskLink, { props: { requestId: 'chat-original' }, global: { stubs: { BaseDialog: true } } })
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
