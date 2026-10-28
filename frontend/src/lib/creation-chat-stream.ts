import { ChatFailure, chatError } from './creation-chat'
import type { ChatProtocol } from './creation-chat-config'
import type { ChatActivity } from './creation-chat-timeout'

/** @description 流解析的可选观察器，只传受控活动枚举，不输出推理原文。 */
export interface ChatStreamOptions {
  /** @description 网络字节、有效进展、推理或正文事件。 */
  activity?: (value: ChatActivity) => void
  /** @description 用户停止或超时取消信号。 */
  signal?: AbortSignal
}

/** @description 三种协议分别验证完成语义，HTTP 200、心跳或 EOF 均不等于完成。 */
export async function consumeChatSSE(response: Response, protocol: ChatProtocol, onText: (text: string) => void, options: ChatStreamOptions = {}) {
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new ChatFailure('protocol')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = '', event = '', data: string[] = [], eventSize = 0, ended = false, finish = '', textReceived = false
  const activity = (value: ChatActivity) => options.activity?.(value)
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  options.signal?.addEventListener('abort', cancel, { once: true })
  const emit = (text: unknown) => {
    if (typeof text !== 'string') throw new ChatFailure('protocol')
    if (text) { textReceived = true; activity('text'); onText(text) }
  }
  const unsupported = () => { throw new ChatFailure('unsupported') }
  // 只接收文本 message 与不展示的 reasoning；任何工具/音频/图像结果都明确受限。
  function inspectItem(item: any) {
    if (!item || typeof item.type !== 'string') throw new ChatFailure('protocol')
    if (item.type === 'reasoning') return
    if (item.type !== 'message') unsupported()
    if (item.status && !['in_progress', 'completed'].includes(item.status)) throw new ChatFailure('incomplete')
    if (item.content !== undefined && !Array.isArray(item.content)) throw new ChatFailure('protocol')
    for (const part of item.content || []) if (part.type !== 'output_text') unsupported()
  }
  function dispatch() {
    const raw = data.join('\n'), name = event
    data = []; event = ''; eventSize = 0
    if (!raw || ended) return
    if (raw === '[DONE]') {
      if (protocol !== 'chat') throw new ChatFailure('protocol')
      if (finish !== 'stop') throw new ChatFailure(finish ? 'incomplete' : 'disconnected')
      ended = true; return
    }
    let value
    try { value = JSON.parse(raw) } catch { throw new ChatFailure('protocol') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatFailure('protocol')
    const type = value.type || name
    if (value.error || name === 'error' || type === 'error' || type === 'response.failed') throw chatError(0, value)
    if (protocol === 'chat') {
      if (!Array.isArray(value.choices)) throw new ChatFailure('protocol')
      if (value.choices.length > 1) unsupported()
      const choice = value.choices[0], delta = choice?.delta
      if (delta?.tool_calls?.length || delta?.function_call || delta?.audio || delta?.refusal) unsupported()
      if (delta?.content != null) {
        if (typeof delta.content === 'object') unsupported()
        emit(delta.content)
      }
      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) activity('reasoning')
      if (typeof delta?.reasoning === 'string' && delta.reasoning) activity('reasoning')
      if (delta?.role === 'assistant') activity('progress')
      if (choice?.finish_reason) {
        finish = choice.finish_reason
        if (['tool_calls', 'function_call'].includes(finish)) unsupported()
        if (finish !== 'stop') throw new ChatFailure('incomplete')
      }
    } else if (protocol === 'messages') {
      if (name && value.type && name !== value.type) throw new ChatFailure('protocol')
      if (type === 'message_start') {
        if (value.message?.content?.length) for (const block of value.message.content) if (!['text', 'thinking', 'redacted_thinking'].includes(block.type)) unsupported()
        activity('progress')
      }
      if (type === 'content_block_start') {
        const block = value.content_block
        if (!block || !['text', 'thinking', 'redacted_thinking'].includes(block.type)) unsupported()
        if (block.type === 'text') emit(block.text ?? '')
        else activity('reasoning')
      }
      if (type === 'content_block_delta') {
        const delta = value.delta
        if (delta?.type === 'text_delta') emit(delta.text)
        else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) activity('reasoning')
        else if (delta?.type === 'signature_delta') activity('progress')
        else if (delta?.type !== 'thinking_delta') unsupported()
      }
      if (type === 'message_delta' && value.delta?.stop_reason) {
        finish = value.delta.stop_reason
        if (finish === 'tool_use') unsupported()
        if (!['end_turn', 'stop_sequence'].includes(finish)) throw new ChatFailure('incomplete')
        activity('progress')
      }
      if (type === 'message_stop') {
        if (!['end_turn', 'stop_sequence'].includes(finish)) throw new ChatFailure('incomplete')
        ended = true
      }
    } else {
      if (name && value.type && name !== value.type) throw new ChatFailure('protocol')
      if (type === 'response.output_text.delta') emit(value.delta)
      else if (/^response\.reasoning(?:_summary)?_text\.delta$/.test(type) && typeof value.delta === 'string' && value.delta) activity('reasoning')
      else if (['response.created', 'response.in_progress', 'response.queued'].includes(type)) activity('progress')
      else if (['response.output_item.added', 'response.output_item.done'].includes(type)) { inspectItem(value.item); activity(value.item.type === 'reasoning' ? 'reasoning' : 'progress') }
      else if (['response.content_part.added', 'response.content_part.done'].includes(type)) {
        if (value.part?.type !== 'output_text') unsupported()
        activity('progress')
      }
      else if (type === 'response.incomplete' || type === 'response.cancelled') throw new ChatFailure('incomplete')
      else if (type === 'response.completed') {
        const result = value.response
        if (!result || result.status !== 'completed' || result.error || result.incomplete_details) throw new ChatFailure('incomplete')
        if (result.output != null && !Array.isArray(result.output)) throw new ChatFailure('protocol')
        for (const item of result.output || []) { inspectItem(item); if (item.status && item.status !== 'completed') throw new ChatFailure('incomplete') }
        ended = true
      }
      else if (/^response\.(?:function_call|custom_tool_call|web_search_call|file_search_call|code_interpreter_call|mcp_call|image_generation_call|audio|output_audio|refusal)/.test(type)) unsupported()
      // 未知事件不算有效进展；保留向前兼容，但不会延长业务等待预算。
    }
  }
  function line(value: string) {
    if (!value) { dispatch(); return }
    if (value.startsWith(':')) return
    const colon = value.indexOf(':'), field = colon < 0 ? value : value.slice(0, colon)
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '')
    if (field === 'data') {
      eventSize += content.length + 1
      if (eventSize > 2_000_000) throw new ChatFailure('protocol')
      data.push(content)
    }
    if (field === 'event') event = content
  }
  try {
    while (!ended) {
      if (options.signal?.aborted) throw new ChatFailure('stopped')
      const { value, done } = await reader.read()
      if (options.signal?.aborted) throw new ChatFailure('stopped')
      if (value?.byteLength) activity('network')
      try { buffer += decoder.decode(value, { stream: !done }) } catch { throw new ChatFailure('protocol') }
      let index = 0
      while (index < buffer.length && !ended) {
        const next = buffer.slice(index).search(/[\r\n]/)
        if (next < 0) break
        const end = index + next
        if (!done && buffer[end] === '\r' && end === buffer.length - 1) break
        line(buffer.slice(index, end))
        index = end + (buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1)
      }
      buffer = buffer.slice(index)
      if (!ended && buffer.length > 2_000_000) throw new ChatFailure('protocol')
      if (done) { if (buffer && !ended) line(buffer); dispatch(); break }
    }
    if (!ended) throw new ChatFailure('disconnected')
    if (!textReceived) throw new ChatFailure('empty')
  } finally {
    options.signal?.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
