import { describe, expect, it, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

const isV1 = vi.fn(() => false)

vi.mock('@/utils/featureFlags', () => ({
  isChannelMonitorV1Mode: () => isV1(),
}))

vi.mock('../ChannelStatusV1View.vue', () => ({
  default: defineComponent({ name: 'ChannelStatusV1View', setup: () => () => h('div', { 'data-testid': 'v1' }) }),
}))
vi.mock('../ChannelStatusV2View.vue', () => ({
  default: defineComponent({ name: 'ChannelStatusV2View', setup: () => () => h('div', { 'data-testid': 'v2' }) }),
}))
vi.mock('../UserChannelStatus.vue', () => ({
  default: defineComponent({ name: 'UserChannelStatus', setup: () => () => h('div', { 'data-testid': 'user-passive-monitor' }) }),
}))

import ChannelStatusView from '../ChannelStatusView.vue'

describe('ChannelStatusView mode switch', () => {
  beforeEach(() => {
    isV1.mockReset()
  })

  it('V2 模式使用新版普通用户界面', () => {
    isV1.mockReturnValue(false)
    const wrapper = mount(ChannelStatusView)
    expect(wrapper.find('[data-testid="user-passive-monitor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="v1"]').exists()).toBe(false)
  })

  it('V1 模式仍使用新版界面明确停用状态，不回退展示主动探测', () => {
    isV1.mockReturnValue(true)
    const wrapper = mount(ChannelStatusView)
    expect(wrapper.find('[data-testid="user-passive-monitor"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="v1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="v2"]').exists()).toBe(false)
  })
})
