import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import UserRequestDetail from '../analytics/UserRequestDetail.vue'
import type { UsageLog } from '@/types'
const { getById } = vi.hoisted(() => ({ getById: vi.fn() }))
vi.mock('@/api/usage', () => ({ usageAPI: { getById } }))
vi.mock('vue-i18n', async () => ({ ...await vi.importActual<typeof import('vue-i18n')>('vue-i18n'), useI18n: () => ({ t: (key: string) => key }) }))
const row = { id: 7, model: 'real', input_tokens: 1234567, output_tokens: 234, cache_read_tokens: 300, cache_creation_tokens: 400, cache_creation_5m_tokens: 100, cache_creation_1h_tokens: 300, actual_cost: .12345678, total_cost: .23456789, rate_multiplier: .8, request_type: 'ws_v2', created_at: '2026-10-22T00:00:00Z' } as UsageLog
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  getById.mockReset(); getById.mockResolvedValue(row)
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); vi.restoreAllMocks() })
function render() { const w = mount(UserRequestDetail, { props: { row: null }, attachTo: document.body, global: { stubs: { Icon: true } } }); wrappers.push(w); return w }
describe('成功请求详情', () => {
  it('加载正式详情，保留八位费用及 5m / 1h 缓存精度', async () => {
    const w = render(); await w.setProps({ row }); await flushPromises()
    expect(getById).toHaveBeenCalledWith(7)
    expect(w.text()).toContain('$0.12345678'); expect(w.text()).toContain('$0.23456789')
    expect(w.text()).toContain('1,234,567'); expect(w.text()).toContain('5m'); expect(w.text()).toContain('1h')
    const buttons = w.findAll('button')
    ;(buttons[0].element as HTMLButtonElement).focus()
    await buttons[0].trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1)!.element)
    await buttons.at(-1)!.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(buttons[0].element)
    await w.find('dialog').trigger('cancel'); expect(w.emitted('close')).toHaveLength(1)
    await w.setProps({ row: null }); expect(document.body.style.overflow).toBe('')
  })
  it('失败可重试，关闭后迟到响应不会回填', async () => {
    getById.mockRejectedValueOnce(new Error('fixture'))
    const w = render(); await w.setProps({ row }); await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    await w.find('[role="alert"] button').trigger('click'); await flushPromises()
    expect(w.text()).toContain('$0.12345678')
    let resolve!: (value: UsageLog) => void
    getById.mockReturnValueOnce(new Promise(r => { resolve = r }))
    await w.setProps({ row: { ...row, id: 8 } }); await flushPromises()
    await w.setProps({ row: null }); resolve({ ...row, model: 'stale' }); await flushPromises()
    expect(w.text()).not.toContain('stale')
  })
})
