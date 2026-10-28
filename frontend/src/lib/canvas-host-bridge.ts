/** 宿主桥接不持有长期凭证；每次 iframe 重建都使用新的会话标识。 */
export const CANVAS_READY = 'new-api:canvas-ready'
export const CANVAS_CONFIG = 'new-api:canvas-config'
export const CANVAS_CONFIGURED = 'new-api:canvas-configured'

export function parseCanvasMessage(data: unknown): { type: string; frameId: string; sessionId?: string } | null {
  if (!data || typeof data !== 'object') return null
  const value = data as Record<string, unknown>
  if (value.version !== 1 || ![CANVAS_READY, CANVAS_CONFIGURED].includes(String(value.type))) return null
  if (typeof value.frameId !== 'string' || !value.frameId) return null
  if (value.sessionId !== undefined && typeof value.sessionId !== 'string') return null
  return { type: String(value.type), frameId: value.frameId, sessionId: value.sessionId as string | undefined }
}

/** @description 仅图片网关使用的配置；apiKey 禁止存入任何持久化或日志。 */
export function canvasConfig(userId: number, apiKey: string, channelName: string, models: string[], preferredModel: string, frameId: string, sessionId: string, keyId?: number) {
  return { type: CANVAS_CONFIG, version: 1, baseUrl: window.location.origin, apiKey, channelName,
    keyId, historyScope: `sub2api-user-${userId}`, studio: 'image', models: Array.from(models), preferredModel, frameId, sessionId }
}

/** 供应商别名可能没有 image 关键字，因此保留别名选择；视频/音频不进入图片候选。 */
export function imageModelCandidates(models: string[]) {
  return [...new Set(models)].filter(model => !/(video|seedance|sora|veo|kling|hailuo|tts|whisper|audio|pp-sd25|oo-sd25|minimax-h3|mm-h3)/i.test(model))
    // 已知纯对话模型不作为图片候选；保留未标注能力的自定义供应商别名。
    .filter(model => !/^(gpt-(?!image)|codex-auto-review$|claude-|o[134](?:-|$)|deepseek-(?:chat|reasoner)|gemini-(?!.*image))/i.test(model))
    .sort((a, b) => Number(/image|flux|seedream|dall/i.test(b)) - Number(/image|flux|seedream|dall/i.test(a)) || a.localeCompare(b))
}
