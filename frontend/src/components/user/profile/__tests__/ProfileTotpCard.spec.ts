import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileTotpCard from '../ProfileTotpCard.vue'
const api = vi.hoisted(() => ({ getStatus: vi.fn() }))
vi.mock('@/api', () => ({ totpAPI: api }))
vi.mock('@/stores/app', () => ({ useAppStore: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
beforeEach(() => { api.getStatus.mockReset() })
const render = () => mount(ProfileTotpCard, { global: { stubs: { TotpSetupModal: true, TotpDisableDialog: true } } })
describe('TOTP 状态与流程入口', () => {
  it('状态尚未读取时不开放启用入口', () => { api.getStatus.mockReturnValue(new Promise(() => {})); const w = render(); expect(w.find('button').exists()).toBe(false); w.unmount() })
  it('功能关闭时保留说明且无启用按钮', async () => { api.getStatus.mockResolvedValue({ feature_enabled: false, enabled: false }); const w = render(); await flushPromises(); expect(w.text()).toContain('profile.totp.featureDisabled'); expect(w.find('button').exists()).toBe(false); w.unmount() })
  it('失败不伪装为未启用，可重新读取', async () => { api.getStatus.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ feature_enabled: true, enabled: false }); const w = render(); await flushPromises(); expect(w.text()).toContain('profileV1.statusFailed'); expect(w.text()).not.toContain('profile.totp.notEnabled'); await w.get('button').trigger('click'); await flushPromises(); expect(w.text()).toContain('profile.totp.notEnabled'); w.unmount() })
  it('设置成功后重新查询真实状态', async () => { api.getStatus.mockResolvedValueOnce({ feature_enabled: true, enabled: false }).mockResolvedValue({ feature_enabled: true, enabled: true }); const w = render(); await flushPromises(); await w.get('button').trigger('click'); w.getComponent({ name: 'TotpSetupModal' }).vm.$emit('success'); await flushPromises(); expect(api.getStatus).toHaveBeenCalledTimes(2); expect(w.text()).toContain('profile.totp.disable'); w.unmount() })
  it('禁用成功后重新查询真实状态', async () => { api.getStatus.mockResolvedValueOnce({ feature_enabled: true, enabled: true }).mockResolvedValue({ feature_enabled: true, enabled: false }); const w = render(); await flushPromises(); await w.get('button').trigger('click'); w.getComponent({ name: 'TotpDisableDialog' }).vm.$emit('success'); await flushPromises(); expect(w.text()).toContain('profile.totp.enable'); w.unmount() })
})
