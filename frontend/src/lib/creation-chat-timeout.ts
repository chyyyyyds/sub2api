/** @description 客户端等待预算（毫秒），与生产网关超时配置无关。 */
export interface ChatTimeouts {
  /** @description 请求开始至 HTTP 响应头的等待，浏览器无法单独区分 DNS/TLS。 */
  headers: number
  /** @description 响应头之后完全没有网络字节的最长时间。 */
  idle: number
  /** @description 没有正文、有效推理或有效进度事件的最长时间，心跳不重置。 */
  progress: number
  /** @description 含持续推理和心跳在内的总时长硬上限。 */
  total: number
}
/** @description 可注入单调时钟，Mock 无需实际等待。 */
export interface ChatClock {
  /** @description 当前单调时间（毫秒）。 */
  now: () => number
  /** @description 安排截止回调。 */
  set: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  /** @description 清除截止回调。 */
  clear: (id: ReturnType<typeof setTimeout>) => void
}
/** @description 网络活动、业务进展及显示状态；禁止传入上游事件原文。 */
export type ChatActivity = 'headers' | 'network' | 'progress' | 'reasoning' | 'text'
export const CHAT_TIMEOUT_DEFAULTS: Readonly<ChatTimeouts> = { headers: 120000, idle: 120000, progress: 600000, total: 1800000 }
export const CHAT_TIMEOUT_MAX: Readonly<ChatTimeouts> = { headers: 300000, idle: 300000, progress: 1800000, total: 3600000 }

/** @description 显式构建配置非法时阻止请求；范围 1 秒至字段上限，防止无限等待。 */
export function chatTimeouts(config?: Partial<ChatTimeouts>): ChatTimeouts {
  if (!config) {
    try { config = JSON.parse(import.meta.env.VITE_CREATION_CHAT_TIMEOUTS || '{}') }
    catch { throw new Error('configuration') }
  }
  if (!config || Array.isArray(config) || typeof config !== 'object' || Object.keys(config).some(key => !Object.prototype.hasOwnProperty.call(CHAT_TIMEOUT_DEFAULTS, key))) throw new Error('configuration')
  const result = { ...CHAT_TIMEOUT_DEFAULTS, ...config }
  for (const key of Object.keys(result) as (keyof ChatTimeouts)[]) {
    if (!Number.isFinite(result[key]) || result[key] < 1000 || result[key] > CHAT_TIMEOUT_MAX[key]) throw new Error('configuration')
  }
  return result
}

/** @description 分别维护网络、进展、首响应及总时长截止点；心跳只能延长网络预算。 */
export function chatWatchdog(onTimeout: (code: string) => void, limits: ChatTimeouts, clock: ChatClock = {
  now: () => performance.now(), set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id)
}) {
  const start = clock.now()
  let network = start, progress = start, headers = false, closed = false
  let timer: ReturnType<typeof setTimeout>
  function deadline() {
    const deadlines: [number, string][] = [[start + limits.total, 'timeoutTotal']]
    if (headers) deadlines.push([network + limits.idle, 'timeoutIdle'], [progress + limits.progress, 'timeoutProgress'])
    else deadlines.push([start + limits.headers, 'timeoutHeaders'])
    deadlines.sort((a, b) => a[0] - b[0])
    return deadlines[0]!
  }
  function arm() {
    clock.clear(timer)
    if (closed) return
    const [time, code] = deadline()
    timer = clock.set(() => { closed = true; onTimeout(code) }, Math.max(0, time - clock.now()))
  }
  arm()
  return {
    activity(value: ChatActivity) {
      if (closed) return
      const now = clock.now()
      // 后台标签页计时器可能被节流，迟到事件不能复活已经超过截止点的请求。
      const [time, code] = deadline()
      if (now >= time) { closed = true; clock.clear(timer); onTimeout(code); return }
      if (value === 'headers') { headers = true; network = now; progress = now }
      if (value === 'network') network = now
      if (['progress', 'reasoning', 'text'].includes(value)) progress = now
      arm()
    },
    close() { closed = true; clock.clear(timer) }
  }
}
