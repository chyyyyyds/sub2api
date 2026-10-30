import axios from 'axios'
import { apiClient } from '@/api/client'
import type { CreationCredential } from '@/composables/useCreationSelection'

/** @description 当前 Key 可见的视频能力，不含上游凭据和积分。 */
export interface VideoModel {
  /** @description 上游提示词字符上限。 */ max_prompt_length: number
  /** @description 用户模型名称。 */ id: string
  /** @description 显示名称。 */ name: string
  /** @description 支持秒数。 */ durations: number[]
  /** @description 支持比例。 */ ratios: string[]
  /** @description 支持分辨率。 */ resolutions: string[]
  /** @description 已确认模式。 */ modes: string[]
  /** @description 是否必须参考图，未知为 null。 */ requires_image?: boolean | null
  /** @description 是否允许创建。 */ creation_enabled: boolean
  /** @description 关闭原因。 */ reason: string
  /** @description 图片能力。 */ reference_images: { supported: boolean; max: number; formats?: string[] }
  /** @description 音频能力。 */ reference_audios: { supported: boolean; max: number; formats?: string[] }
}
/** @description 持久任务视图。 */
export interface VideoTask {
  /** @description 本地任务编号。 */ id: string
  /** @description 请求模型。 */ model: string
  /** @description 实际模型。 */ actual_model: string
  /** @description 生成状态。 */ status: string
  /** @description 账务状态。 */ billing_state: string
  /** @description 美元收费。 */ charge: string
  /** @description 原用户 Key 编号。 */ api_key_id: number
  /** @description 原 Key 名称。 */ api_key_name?: string
  /** @description 原 Key 状态。 */ api_key_status?: string
  /** @description 文件状态。 */ download_state: string
  /** @description 秒数。 */ duration: number
  /** @description 分辨率。 */ resolution: string
  /** @description 创建时间。 */ created_at: string
  /** @description 更新时间。 */ updated_at: string
  /** @description 完成时间。 */ completed_at: string | null
  /** @description 可信到期时间。 */ retention_expires_at: string | null
  /** @description 安全错误码。 */ error_code: string
}
/** @description 规范创建参数。 */
export interface VideoInput {
  /** @description 模型。 */ model: string
  /** @description 提示词。 */ prompt: string
  /** @description 秒数。 */ duration: number
  /** @description 比例。 */ ratio: string
  /** @description 分辨率。 */ resolution: string
  /** @description 模式。 */ mode: string
  /** @description 图片 URL。 */ image_urls: string[]
  /** @description 音频 URL。 */ audio_urls: string[]
  /** @description 生成一个视频。 */ count: number
}
function headers(c: CreationCredential) { return { Authorization: `Bearer ${c.apiKey}` } }
/** @description 只读报价，不包含账号统计成本。 */
export interface VideoQuote {
  /** @description 美元基价。 */ base_price: string
  /** @description 用户分组倍率。 */ group_multiplier: string
  /** @description 预计冻结美元金额。 */ charge: string
  /** @description 结算币种。 */ currency: string
}
export const videoAPI = {
  async quote(c: CreationCredential, params: Pick<VideoInput, 'model' | 'duration' | 'resolution' | 'mode'>, signal?: AbortSignal) { return (await axios.get<VideoQuote>('/v1/video-quote', { headers: headers(c), timeout: 60000, params, signal })).data },
  async history(signal?: AbortSignal, before?: string) { return (await apiClient.get<{ data: VideoTask[]; next_cursor?: string }>('/user/video-tasks', { signal, params: { before } })).data },
  async models(c: CreationCredential, signal?: AbortSignal) { return (await axios.get<{ data: VideoModel[] }>('/v1/video-models', { headers: headers(c), timeout: 180000, signal })).data.data },
  async list(c: CreationCredential, signal?: AbortSignal) { return (await axios.get<{ data: VideoTask[] }>('/v1/videos', { headers: headers(c), timeout: 60000, signal })).data.data },
  async recover(c: CreationCredential, key: string, signal?: AbortSignal) { return (await axios.get<{ data: VideoTask[] }>('/v1/videos', { headers: headers(c), timeout: 60000, params: { idempotency_key: key }, signal })).data.data[0] },
  async create(c: CreationCredential, input: VideoInput, key: string) { return (await axios.post<VideoTask>('/v1/videos', input, { timeout: 180000, headers: { ...headers(c), 'Idempotency-Key': key } })).data },
  /** @description 经原 Key 授权读取视频，浏览器只持有内存地址，不泄露上游链接。 */
  async preview(c: CreationCredential, id: string, signal?: AbortSignal) {
    const response = await fetch(`/v1/videos/${encodeURIComponent(id)}/content`, { headers: headers(c), redirect: 'error', signal })
    if (!response.ok) throw new Error('预览暂不可用')
    return URL.createObjectURL(await response.blob())
  },
  /** @description 原生响应流直接交给文件系统，不持久化到 IndexedDB 或对象存储。 */
  async download(c: CreationCredential, id: string) {
    // 先在用户点击的有效手势内选择文件，避免慢下载取址后浏览器拒绝弹出保存窗口。
    const browser = window as unknown as { showSaveFilePicker?: (options: unknown) => Promise<{ createWritable(): Promise<WritableStream> }> }
    const handle = browser.showSaveFilePicker ? await browser.showSaveFilePicker({ suggestedName: `${id}.mp4` }) : null
    const response = await fetch(`/v1/videos/${encodeURIComponent(id)}/content`, { headers: headers(c), redirect: 'error' })
    if (!response.ok || !response.body) throw new Error('视频暂不可下载，请稍后重试')
    if (browser.showSaveFilePicker) {
      await response.body.pipeTo(await handle!.createWritable())
    } else {
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = `${id}.mp4`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  },
}

/** @description 将可公开的业务错误转换为创作提示，不展示上游内部信息。 */
export function videoError(code?: string): string {
  const messages: Record<string, string> = {
    VIDEO_INSUFFICIENT_BALANCE: '余额不足，请充值后再生成。',
    VIDEO_KEY_QUOTA_EXCEEDED: '此 Key 的可用额度不足，请调整额度或更换视频 Key。',
    VIDEO_PLATFORM_QUOTA_EXCEEDED: '视频平台额度不足，请联系管理员调整。',
    VIDEO_PRICE_REQUIRED: '视频费用尚未配置，请联系管理员。',
    VIDEO_MODEL_UNAVAILABLE: '模型暂不可用，请稍后重试。',
    VIDEO_ACCOUNT_UNAVAILABLE: '视频上游暂不可用，请稍后重试。',
    VIDEO_MODEL_FORBIDDEN: '当前 Key 未获此模型权限，请选择视频创作 Key。',
    VIDEO_PLATFORM_REQUIRED: '请选择视频创作平台的 Key。',
    INVALID_PROMPT: '请检查提示词是否为空或超过长度限制。',
    INVALID_VIDEO_PARAMETERS: '模型参数已变化，请刷新后重试。',
    INVALID_REFERENCE_MEDIA: '参考素材不符合要求，请检查格式、大小和数量。',
    REFERENCE_IMAGE_REQUIRED: '当前模型需要至少一张参考图片。',
    VIDEO_CREATION_DISABLED: '视频创建暂未开放，请稍后重试。',
    VIDEO_REQUEST_TOO_LARGE: '素材总量过大，请减少文件或改用 HTTPS 链接。',
  }
  return messages[code || ''] || '视频请求未完成，请检查参数或稍后重试。'
}
export function videoStatus(status: string) { return ({ CREATED: '排队中', SUBMITTING: '提交中', QUEUED: '排队中', RUNNING: '生成中', SUBMISSION_UNKNOWN: '待核对', RECONCILING: '待核对', COMPLETED: '已完成', FAILED: '生成失败' } as Record<string, string>)[status] || status }
export function videoBilling(status: string, taskStatus?: string) { if (status === 'HELD' && taskStatus === 'FAILED') return '退款处理中'; if (status === 'HELD' && taskStatus === 'COMPLETED') return '结算处理中'; return ({ HELD: '已冻结 / 等待结算', CAPTURED: '已结算', RELEASED: '已退款 / 解冻' } as Record<string, string>)[status] || status }
