import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfilePasswordForm from '../ProfilePasswordForm.vue'
import ProfileEditForm from '../ProfileEditForm.vue'
const api = vi.hoisted(() => ({ updateProfile: vi.fn(), changePassword: vi.fn() }))
const app = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }))
const auth = vi.hoisted(() => ({ user: { username: 'old' } }))
vi.mock('@/api', () => ({ userAPI: api }))
vi.mock('@/stores/app', () => ({ useAppStore: () => app }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const wrappers: VueWrapper[] = []
function renderPassword() { const w = mount(ProfilePasswordForm); wrappers.push(w); return w }
function renderName() { const w = mount(ProfileEditForm, { props: { initialUsername: 'old' } }); wrappers.push(w); return w }
async function fill(w: VueWrapper, old = 'test-current', value = 'test-new-value', confirm = value) { await w.get('#old_password').setValue(old); await w.get('#new_password').setValue(value); await w.get('#confirm_password').setValue(confirm) }
beforeEach(() => { vi.clearAllMocks(); auth.user = { username: 'old' }; api.updateProfile.mockResolvedValue({ username: 'server-name' }); api.changePassword.mockResolvedValue({ message: 'ok' }) })
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()) })
describe('正式资料与密码表单', () => {
  it.each([['', 'test-new-value', 'test-new-value', 'auth.passwordRequired'], ['test-current', 'short', 'short', 'profile.passwordTooShort'], ['test-current', 'test-new-value', 'different', 'profile.passwordsNotMatch']])('保留密码校验分支 %#', async (old, value, confirm, key) => { const w = renderPassword(); await fill(w, old, value, confirm); await w.get('form').trigger('submit'); expect(api.changePassword).not.toHaveBeenCalled(); expect(app.showError).toHaveBeenCalledWith(key) })
  it('密码保存成功清除明文输入与可见状态', async () => { const w = renderPassword(); await fill(w); await w.get('input[type=checkbox]').setValue(true); expect(w.get('#old_password').attributes('type')).toBe('text'); await w.get('form').trigger('submit'); await flushPromises(); expect(api.changePassword).toHaveBeenCalledWith('test-current', 'test-new-value'); expect((w.get('#new_password').element as HTMLInputElement).value).toBe(''); expect(w.get('#new_password').attributes('type')).toBe('password'); expect(app.showSuccess).toHaveBeenCalledWith('profile.passwordChangeSuccess') })
  it('密码直接重复 submit 只有一次 API 请求', async () => { let resolve!: (v: unknown) => void; api.changePassword.mockReturnValue(new Promise(yes => { resolve = yes })); const w = renderPassword(); await fill(w); await w.get('form').trigger('submit'); await w.get('form').trigger('submit'); expect(api.changePassword).toHaveBeenCalledOnce(); expect(w.get('#old_password').attributes('disabled')).toBeDefined(); resolve({}); await flushPromises() })
  it('密码失败不显示成功且恢复可提交状态', async () => { api.changePassword.mockRejectedValue({ message: '旧密码错误' }); const w = renderPassword(); await fill(w); await w.get('form').trigger('submit'); await flushPromises(); expect(app.showSuccess).not.toHaveBeenCalled(); expect(app.showError).toHaveBeenCalledWith('旧密码错误'); expect(w.get('button').attributes('disabled')).toBeUndefined() })
  it('卸载后密码迟到响应不显示成功', async () => { let resolve!: (v: unknown) => void; api.changePassword.mockReturnValue(new Promise(yes => { resolve = yes })); const w = renderPassword(); await fill(w); await w.get('form').trigger('submit'); w.unmount(); resolve({}); await flushPromises(); expect(app.showSuccess).not.toHaveBeenCalled() })
  it('空白用户名不提交', async () => { const w = renderName(); await w.get('#username').setValue('  '); await w.get('form').trigger('submit'); expect(api.updateProfile).not.toHaveBeenCalled(); expect(app.showError).toHaveBeenCalledWith('profile.usernameRequired') })
  it('用户名保存采用服务端规范化结果刷新 Store', async () => { const w = renderName(); await w.get('#username').setValue('new-name'); await w.get('form').trigger('submit'); await flushPromises(); expect(api.updateProfile).toHaveBeenCalledWith({ username: 'new-name' }); expect(auth.user.username).toBe('server-name'); expect((w.get('#username').element as HTMLInputElement).value).toBe('server-name') })
  it('用户名直接重复 submit 只有一次请求', async () => { let resolve!: (v: unknown) => void; api.updateProfile.mockReturnValue(new Promise(yes => { resolve = yes })); const w = renderName(); await w.get('form').trigger('submit'); await w.get('form').trigger('submit'); expect(api.updateProfile).toHaveBeenCalledOnce(); resolve({ username: 'new' }); await flushPromises() })
  it('卸载后用户名迟到响应不回写 Store', async () => { let resolve!: (v: unknown) => void; api.updateProfile.mockReturnValue(new Promise(yes => { resolve = yes })); const w = renderName(); await w.get('form').trigger('submit'); w.unmount(); resolve({ username: 'late' }); await flushPromises(); expect(auth.user.username).toBe('old'); expect(app.showSuccess).not.toHaveBeenCalled() })
})
