import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatContext, streamChat } from '../creation-chat'
import { chatTimeouts, chatWatchdog, CHAT_TIMEOUT_DEFAULTS, type ChatClock } from '../creation-chat-timeout'

const clock: ChatClock = { now: () => Date.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) }
const credential = { userId: 1, keyId: 1, keyName: '模拟', apiKey: 'memory-only', model: 'gpt-6', models: ['gpt-6'] }
const event = (value: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

function setup() {
  let body!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({ start(c) { body = c }, cancel })
  const fetch = vi.fn().mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
  vi.stubGlobal('fetch', fetch)
  const controller = new AbortController(), text = vi.fn()
  const run = streamChat(credential, chatContext([], '问题'), controller.signal, text, { clock })
  // 立即观察拒绝，防止假时钟推进期间产生未处理 Promise。
  const result = run.then(() => 'complete', e => e.code || e.message)
  return { body, cancel, fetch, controller, text, result }
}
describe('P2 可注入时钟超时策略', () => {
  it('配置有默认值、上限和非法值拒绝，不允许无限等待', () => {
    expect(chatTimeouts()).toEqual(CHAT_TIMEOUT_DEFAULTS)
    expect(chatTimeouts({ progress: 1200000 }).progress).toBe(1200000)
    expect(() => chatTimeouts({ total: Infinity })).toThrow('configuration')
    expect(() => chatTimeouts({ total: 3600001 })).toThrow('configuration')
    expect(() => chatTimeouts({ idle: 0 })).toThrow('configuration')
    vi.stubEnv('VITE_CREATION_CHAT_TIMEOUTS', '{broken')
    expect(() => chatTimeouts()).toThrow('configuration')
  })
  it('HTTP 首响应未到有独立截止点；即使 fetch 忽略 AbortSignal 也解除 UI 等待', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const result = streamChat(credential, chatContext([], '问题'), new AbortController().signal, () => {}, { clock }).catch(e => e.code)
    await vi.advanceTimersByTimeAsync(120000)
    expect(await result).toBe('timeoutHeaders')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('真实网络空闲 120 秒终止并取消读取', async () => {
    const state = setup()
    await vi.advanceTimersByTimeAsync(120000)
    expect(await state.result).toBe('timeoutIdle')
    expect(state.cancel).toHaveBeenCalledTimes(1)
  })
  it('只有心跳仍在 10 分钟无有效进展时停止；不实际等待', async () => {
    const state = setup(); await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(90000)
      state.body.enqueue(new TextEncoder().encode(': ping\n\n'))
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(60000)
    expect(await state.result).toBe('timeoutProgress')
  })
  it('首字慢但持续有效推理超过旧 120 秒限制仍可完成', async () => {
    const state = setup(); await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 9; i++) {
      await vi.advanceTimersByTimeAsync(90000)
      state.body.enqueue(event({ choices: [{ delta: { reasoning_content: '思考' } }] }))
      await vi.advanceTimersByTimeAsync(0)
    }
    state.body.enqueue(event({ choices: [{ delta: { content: '最终正文' } }] }))
    state.body.enqueue(event({ choices: [{ delta: {}, finish_reason: 'stop' }] }))
    state.body.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
    await vi.advanceTimersByTimeAsync(0)
    expect(await state.result).toBe('complete'); expect(state.text).toHaveBeenCalledWith('最终正文')
  })
  it('持续有效事件也不能越过总时长硬上限', async () => {
    const state = setup(); await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < 19; i++) {
      await vi.advanceTimersByTimeAsync(90000)
      state.body.enqueue(event({ choices: [{ delta: { reasoning_content: '仍在推理' } }] }))
      await vi.advanceTimersByTimeAsync(0)
    }
    await vi.advanceTimersByTimeAsync(90000)
    expect(await state.result).toBe('timeoutTotal')
  })
  it('主动停止取消 reader、保留部分文本、清理所有计时器', async () => {
    const state = setup(); await vi.advanceTimersByTimeAsync(0)
    state.body.enqueue(event({ choices: [{ delta: { content: '部分正文' } }] }))
    await vi.advanceTimersByTimeAsync(0)
    state.controller.abort(); await vi.advanceTimersByTimeAsync(0)
    expect(await state.result).toBe('stopped'); expect(state.text).toHaveBeenCalledWith('部分正文')
    expect(state.cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('进度不等于网络活动，未知事件和心跳不重置进展时钟', async () => {
    const timeout = vi.fn(), watchdog = chatWatchdog(timeout, { headers: 1000, idle: 2000, progress: 4000, total: 6000 }, clock)
    watchdog.activity('headers')
    await vi.advanceTimersByTimeAsync(1500); watchdog.activity('network')
    await vi.advanceTimersByTimeAsync(1500); watchdog.activity('network')
    await vi.advanceTimersByTimeAsync(1000)
    expect(timeout).toHaveBeenCalledWith('timeoutProgress')
    watchdog.close()
  })
  it('后台标签计时器被延迟时，迟到事件不能复活超过截止点的请求', () => {
    let now = 0
    const timeout = vi.fn()
    const watchdog = chatWatchdog(timeout, { headers: 1000, idle: 2000, progress: 4000, total: 6000 }, { now: () => now, set: () => 1 as unknown as ReturnType<typeof setTimeout>, clear: () => {} })
    now = 1200; watchdog.activity('headers')
    expect(timeout).toHaveBeenCalledWith('timeoutHeaders')
    watchdog.activity('reasoning'); expect(timeout).toHaveBeenCalledTimes(1)
    watchdog.close()
  })
})
