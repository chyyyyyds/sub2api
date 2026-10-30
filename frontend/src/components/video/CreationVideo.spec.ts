import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { webcrypto } from 'node:crypto'
import CreationVideo from './CreationVideo.vue'
import VideoReferenceInput from './VideoReferenceInput.vue'
import { videoAPI } from '@/lib/creation-video'

vi.mock('@/lib/creation-video', () => ({
  videoAPI: { models: vi.fn(), history: vi.fn(), quote: vi.fn(), recover: vi.fn(), create: vi.fn(), preview: vi.fn(), download: vi.fn() },
  videoStatus: (status: string) => status,
  videoBilling: (status: string) => status,
  videoError: () => '请求失败',
}))
const credential = { userId: 71, keyId: 7, keyName: '视频 Key', apiKey: 'test-only-memory', model: 'oo-sd25-1080p', models: ['oo-sd25-1080p'] }
const model = { id: 'oo-sd25-1080p', name: '视频', durations: [30], resolutions: ['1080p'], ratios: ['9:16', '4:3', '16:9'], modes: ['reference'], reference_images: { supported: true, max: 9, formats: ['jpeg','png','webp'] }, reference_audios: { supported: true, max: 3, formats: ['mp3','wav'] }, max_prompt_length: 8000, creation_enabled: true, requires_image: false }
const task = { id: 'vtsk_test', model: model.id, actual_model: model.id, status: 'SUBMITTING', billing_state: 'HELD', charge: '8', api_key_id: 7, download_state: 'PENDING', duration: 30, resolution: '1080p', created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', completed_at: null, retention_expires_at: null, error_code: '' }
let wrapper: ReturnType<typeof mount> | undefined
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); vi.stubGlobal('crypto', webcrypto)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.mocked(videoAPI.models).mockResolvedValue([model])
  vi.mocked(videoAPI.history).mockResolvedValue({ data: [] })
  vi.mocked(videoAPI.quote).mockResolvedValue({ charge: '8', base_price: '8', group_multiplier: '1', currency: 'USD' })
  vi.mocked(videoAPI.create).mockResolvedValue(task)
  vi.mocked(videoAPI.recover).mockResolvedValue(undefined as never)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks() })
async function render() { wrapper = mount(CreationVideo, { props: { credential, userId: 71, locked: false }, global: { stubs: { Icon: true, VideoReferenceInput: true } } }); await flushPromises(); return wrapper }

describe('可直接创作的视频工作台', () => {
  it('素材读取完成前阻止生成，避免大文件尚未进入请求就提交', async () => {
    const w = await render(); await w.get('#video-prompt').setValue('静谧的湖面')
    w.findAllComponents(VideoReferenceInput)[0].vm.$emit('reading', true); await flushPromises()
    expect(w.get('.video-generate').attributes('disabled')).toBeDefined()
    w.findAllComponents(VideoReferenceInput)[0].vm.$emit('reading', false); await flushPromises()
    expect(w.get('.video-generate').attributes('disabled')).toBeUndefined()
  })
  it('按上游参数提交 1080P，保留 4:3，费用就绪后允许生成', async () => {
    const w = await render()
    expect(w.text()).toContain('4:3')
    expect(w.get('.video-generate').attributes('disabled')).toBeDefined()
    await w.get('#video-prompt').setValue('小船穿过清晨的湖面')
    await w.get('.video-generate').trigger('click'); await flushPromises()
    expect(videoAPI.create).toHaveBeenCalledOnce()
    expect(vi.mocked(videoAPI.create).mock.calls[0][1]).toEqual({ model: model.id, prompt: '小船穿过清晨的湖面', duration: 30, ratio: '16:9', resolution: '1080p', mode: 'reference', count: 1, image_urls: [], audio_urls: [] })
    expect(w.text()).toContain('视频正在制作中')
  })
  it('仅有进行中任务时每分钟读取一次本站记录，空列表不轮询', async () => {
    await render(); const initial = vi.mocked(videoAPI.history).mock.calls.length
    await vi.advanceTimersByTimeAsync(60000); expect(videoAPI.history).toHaveBeenCalledTimes(initial)
    vi.mocked(videoAPI.history).mockResolvedValue({ data: [task] })
    await wrapper!.get('[aria-label="刷新生成记录"]').trigger('click'); await flushPromises()
    const afterRefresh = vi.mocked(videoAPI.history).mock.calls.length
    await vi.advanceTimersByTimeAsync(59999); expect(videoAPI.history).toHaveBeenCalledTimes(afterRefresh)
    await vi.advanceTimersByTimeAsync(1); expect(videoAPI.history).toHaveBeenCalledTimes(afterRefresh + 1)
    expect(videoAPI.models).toHaveBeenCalledOnce()
  })
  it('提交未确认时固定原幂等键和参数，重复点击不会创建第二单', async () => {
    const w = await render(); vi.mocked(videoAPI.create).mockRejectedValueOnce(new Error('network'))
    await w.get('#video-prompt').setValue('春日山谷'); await w.get('.video-generate').trigger('click'); await flushPromises()
    const first = vi.mocked(videoAPI.create).mock.calls[0]
    expect(w.text()).toContain('确认上次提交')
    await w.get('.video-generate').trigger('click'); await flushPromises()
    expect(vi.mocked(videoAPI.create).mock.calls[1]).toEqual(first)
  })
  it('切换 Key 后不允许用其他 Key 预览原任务', async () => {
    vi.mocked(videoAPI.history).mockResolvedValue({ data: [{ ...task, status: 'COMPLETED', api_key_id: 99 }] })
    const w = await render(); await w.get('.video-history-item').trigger('click'); await flushPromises()
    expect(w.text()).toContain('请在顶部切换到')
    expect(videoAPI.preview).not.toHaveBeenCalled()
  })
})
