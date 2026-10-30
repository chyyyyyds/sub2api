import type { CreationCredential } from '@/composables/useCreationSelection'
import { chatCapability, type ChatProtocol } from './creation-chat-config'
import { consumeChatSSE } from './creation-chat-stream'
import { chatTimeouts, chatWatchdog, type ChatActivity, type ChatTimeouts, type ChatClock } from './creation-chat-timeout'
export { consumeChatSSE } from './creation-chat-stream'
export type { ChatProtocol } from './creation-chat-config'

/** @description 本地等待、推理、正文及停止反馈阶段，不持久化推理原文。 */
export type ChatPhase = 'waiting' | 'reasoning' | 'generating' | 'stopping'
/** @description 本地消息的生成状态，中断内容不作为完整回答进入下一轮上下文。 */
export type ChatStatus = 'complete' | 'streaming' | 'interrupted' | 'error'
/** @description 可导出的消息结构，只包含文本与非敏感选择元数据。 */
export interface ChatMessage {
  /** @description 消息唯一 ID。 */
  id: string
  /** @description 消息角色。 */
  role: 'system' | 'user' | 'assistant'
  /** @description 消息纯文本，渲染前必须清洗。 */
  content: string
  /** @description 完成、生成中、中断或失败。 */
  status: ChatStatus
  /** @description 创建时间戳（毫秒）。 */
  createdAt: number
  /** @description 本次请求固定的模型 ID。 */
  model?: string
  /** @description 本次请求固定的用户 Key ID，禁止包含明文 Key。 */
  keyId?: number
  /** @description 发送时冻结的网关入站协议，不含渠道信息。 */
  protocol?: ChatProtocol
  /** @description 当前生成阶段，仅用于状态反馈。 */
  phase?: ChatPhase
  /** @description 已脱敏的错误分类。 */
  error?: string
}
/** @description 对话选择偏好，禁止添加明文密钥。 */
export interface ChatPreference {
  /** @description 模型 ID。 */
  model: string
  /** @description 手动 Key ID 或自动匹配模式。 */
  key: number | 'auto'
}
/** @description 仅在浏览器按登录用户隔离保存的会话。 */
export interface ChatConversation {
  /** @description 会话 ID。 */
  id: string
  /** @description 登录用户 ID。 */
  userId: number
  /** @description 用户可修改的会话标题。 */
  title: string
  /** @description 最近更新时间戳。 */
  updatedAt: number
  /** @description 创建时间戳。 */
  createdAt: number
  /** @description 消息列表。 */
  messages: ChatMessage[]
  /** @description 不含密钥的选择偏好。 */
  preference?: ChatPreference
}

/** @description 只返回受控错误分类，禁止将网关原文或请求头写入历史和日志。 */
export class ChatFailure extends Error {
  constructor(public readonly code: string) { super(code) }
}

/** @description 标准模型保留既有入口；别名优先用部署审核的精确规则。 */
export function chatProtocol(model: string, userId = 0, keyId = 0): ChatProtocol {
  return chatCapability(model, userId, keyId).protocol
}

/** @description 只发送完整轮次及当前问题；保留 system，跳过中断回答和未完成的旧问题。 */
export function chatContext(history: ChatMessage[], question: string) {
  const context: { role: ChatMessage['role']; content: string }[] = []
  let pending: ChatMessage | undefined
  for (const message of history) {
    if (message.role === 'system' && message.status === 'complete') context.push({ role: 'system', content: message.content })
    if (message.role === 'user') pending = message
    if (message.role === 'assistant' && pending) {
      if (pending.status === 'complete' && message.status === 'complete' && message.content) {
        context.push({ role: 'user', content: pending.content }, { role: 'assistant', content: message.content })
      }
      pending = undefined
    }
  }
  context.push({ role: 'user', content: question })
  // 目录没有上下文窗口字段，使用保守的字符上限，不声称它等于模型 token 上限。
  if (context.reduce((n, m) => n + m.content.length, 0) > 48000) throw new ChatFailure('context')
  return context
}

/** @description 纯文本协议请求构造；Responses 每次发送完整 input，禁止 previous_response_id。 */
export function chatRequest(model: string, context: ReturnType<typeof chatContext>, protocol: ChatProtocol = chatProtocol(model), maxOutputTokens = 4096) {
  // 各协议使用各自支持的输出限额字段；无效配置在发出收费请求前拒绝。
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new ChatFailure('configuration')
  if (protocol === 'messages') return {
    protocol, path: '/v1/messages', body: { model, stream: true, max_tokens: maxOutputTokens,
      system: context.filter(m => m.role === 'system').map(m => m.content).join('\n'),
      messages: context.filter(m => m.role !== 'system') }
  }
  if (protocol === 'responses') return {
    protocol, path: '/v1/responses', body: { model, stream: true, store: false, max_output_tokens: maxOutputTokens,
      reasoning: { effort: 'high' },
      input: context.map(m => ({ role: m.role, content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }] })) }
  }
  // OpenAI 推理模型默认使用高强度；其他模型不附加不支持的推理参数。
  const reasoning = /^(?:gpt-(?:[5-9]|\d{2,})(?:[.-]|$)|o[134](?:[.-]|$))/i.test(model) ? { reasoning_effort: 'high' } : {}
  return { protocol, path: '/v1/chat/completions', body: { model, stream: true, max_completion_tokens: maxOutputTokens, messages: context, ...reasoning } }
}

/** @description 从状态码及上游错误类型映射用户可理解的错误；不返回上游原文。 */
export function chatError(status: number, data: unknown): ChatFailure {
  const text = JSON.stringify(data || '').toLowerCase()
  if (/insufficient|balance|quota|余额|额度/.test(text) || status === 402) return new ChatFailure('balance')
  if (status === 401) return new ChatFailure('unauthorized')
  if (status === 403) return new ChatFailure('forbidden')
  if (status === 429 || /rate_limit|overloaded/.test(text)) return new ChatFailure('rateLimit')
  if (status === 413 || /context_length|too many tokens|context.*exceed/.test(text)) return new ChatFailure('context')
  if (status === 404 || /model_not_found|model.*unavailable|not supported|unsupported/.test(text)) return new ChatFailure('model')
  return new ChatFailure(status >= 500 ? 'server' : 'request')
}

/** @description 请求选项仅驻留内存，协议与等待预算在发送前冻结。 */
export interface ChatRunOptions {
  /** @description 单次请求输出 Token 限额，默认 4096；不等同于费用硬封顶。 */
  maxOutputTokens?: number
  /** @description 明确解析后的入站协议。 */
  protocol?: ChatProtocol
  /** @description 受控活动回调，不含上游事件原文或推理正文。 */
  activity?: (value: ChatActivity) => void
  /** @description 可配置等待预算。 */
  timeouts?: Partial<ChatTimeouts>
  /** @description 单测可注入的单调时钟。 */
  clock?: ChatClock
}

/** @description 只向同源网关发送一次；超时或失败绝不换协议重发。 */
export async function streamChat(credential: CreationCredential, context: ReturnType<typeof chatContext>, signal: AbortSignal, onText: (text: string) => void, options: ChatRunOptions = {}) {
  const request = chatRequest(credential.model, context, options.protocol ?? chatProtocol(credential.model, credential.userId, credential.keyId), options.maxOutputTokens)
  const limits = chatTimeouts(options.timeouts)
  const controller = new AbortController()
  let rejectAbort!: (error: ChatFailure) => void
  const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abort = (code: string) => { rejectAbort(new ChatFailure(code)); controller.abort() }
  const stop = () => abort('stopped')
  const watchdog = chatWatchdog(abort, limits, options.clock)
  const activity = (value: ChatActivity) => { watchdog.activity(value); options.activity?.(value) }
  signal.addEventListener('abort', stop, { once: true })
  const run = async () => {
    if (signal.aborted) throw new ChatFailure('stopped')
    const response = await fetch(request.path, {
      method: 'POST', signal: controller.signal, redirect: 'error', credentials: 'omit',
      headers: { Authorization: `Bearer ${credential.apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(request.protocol === 'messages' ? { 'anthropic-version': '2023-06-01' } : {}) },
      body: JSON.stringify(request.body)
    })
    activity('headers')
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => undefined); throw new ChatFailure('stopped') }
    if (!response.ok) {
      const value = await response.json().catch(() => null)
      throw chatError(response.status, value)
    }
    await consumeChatSSE(response, request.protocol, onText, { activity, signal: controller.signal })
  }
  try { await Promise.race([run(), cancelled]) }
  finally { watchdog.close(); signal.removeEventListener('abort', stop); controller.abort() }
}
