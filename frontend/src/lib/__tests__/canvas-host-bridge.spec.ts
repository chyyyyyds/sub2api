import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { canvasConfig, imageModelCandidates, parseCanvasMessage } from '../canvas-host-bridge'

describe('Canvas 宿主协议', () => {
  it('拒绝无版本、无实例或未知类型的消息', () => {
    expect(parseCanvasMessage(null)).toBeNull()
    expect(parseCanvasMessage({ type: 'new-api:canvas-ready', version: 2, frameId: 'f' })).toBeNull()
    expect(parseCanvasMessage({ type: 'new-api:canvas-ready', version: 1 })).toBeNull()
    expect(parseCanvasMessage({ type: 'unknown', version: 1, frameId: 'f' })).toBeNull()
  })
  it('保留握手的实例与会话关联', () => {
    expect(parseCanvasMessage({ type: 'new-api:canvas-configured', version: 1, frameId: 'f', sessionId: 's' })).toEqual({ type: 'new-api:canvas-configured', frameId: 'f', sessionId: 's' })
  })
  it('自定义 Key 原样传入，配置只使用同源网关和图片模式', () => {
    const config = canvasConfig(42, 'custom-key', '我的令牌', ['alias'], 'alias', 'f', 's')
    expect(config.apiKey).toBe('custom-key')
    expect(config.baseUrl).toBe(location.origin)
    expect(config.historyScope).toBe('sub2api-user-42')
    expect(config.studio).toBe('image')
  })
  it('图片模型优先，保留自定义别名，排除音视频并去重', () => {
    expect(imageModelCandidates(['custom-alias', 'gpt-image-2', 'pp-sd25-stable', 'grok-imagine-video', 'tts-1', 'custom-alias'])).toEqual(['gpt-image-2', 'custom-alias'])
  })
  it('Vue 响应式模型列表转换成可被 postMessage 复制的普通数组', () => {
    const config = canvasConfig(1, 'custom-key', '图片', reactive(['alias']), 'alias', 'f', 's')
    expect(structuredClone(config).models).toEqual(['alias'])
  })
  it('通用 Key 的已知纯聊天模型不会进入图片目录', () => {
    expect(imageModelCandidates(['gpt-6', 'claude-sonnet', 'o3', 'deepseek-chat', 'gemini-3-flash', 'gemini-3-image', 'gpt-image-2', '自定义别名'])).toEqual(['gemini-3-image', 'gpt-image-2', '自定义别名'])
  })
  it('明确排除不能生图的 codex-auto-review，不影响真正的图片模型', () => {
    expect(imageModelCandidates(['codex-auto-review', 'CODEX-AUTO-REVIEW', 'gpt-image-2', 'gpt-image-2.5'])).toEqual(['gpt-image-2', 'gpt-image-2.5'])
  })
})
