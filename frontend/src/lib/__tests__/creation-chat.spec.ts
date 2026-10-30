import { describe, expect, it } from 'vitest'
import { chatContext, chatError, chatProtocol, chatRequest, consumeChatSSE, type ChatMessage } from '../creation-chat'

const message = (role: ChatMessage['role'], content: string, status: ChatMessage['status'] = 'complete'): ChatMessage => ({ id: content, role, content, status, createdAt: 1 })
function response(text: string, split = 1) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split))
    controller.close()
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}
describe('聊天协议和上下文', () => {
  it('根据现有网关选择入口，未知别名使用兼容入口', () => {
    expect(chatProtocol('gpt-6')).toBe('chat')
    expect(chatProtocol('claude-sonnet')).toBe('messages')
    expect(chatProtocol('gpt-5-codex')).toBe('responses')
    expect(chatProtocol('private-alias')).toBe('chat')
  })
  it('保留 system 和完整轮次，排除中断回答、孤立问题及当前问题重复', () => {
    const history = [message('system', '系统'), message('user', '第一问'), message('assistant', '第一答'), message('user', '失败问题'), message('assistant', '半截', 'interrupted'), message('user', '孤立问题')]
    expect(chatContext(history, '新问题')).toEqual([{ role: 'system', content: '系统' }, { role: 'user', content: '第一问' }, { role: 'assistant', content: '第一答' }, { role: 'user', content: '新问题' }])
  })
  it('超长上下文阻止发送，不悄悄截断历史', () => expect(() => chatContext([], 'a'.repeat(48001))).toThrow('context'))
  it('Messages 提取 system；Responses 每次完整 input 且不续接 response id', () => {
    const context = chatContext([message('system', '系统')], '问题')
    expect(chatRequest('claude-sonnet', context).body).toMatchObject({ system: '系统', messages: [{ role: 'user', content: '问题' }], max_tokens: 4096 })
    const request = chatRequest('gpt-codex', context)
    expect(request.body).toMatchObject({ store: false, input: [{ role: 'system', content: [{ type: 'input_text', text: '系统' }] }, { role: 'user', content: [{ type: 'input_text', text: '问题' }] }] })
    expect(JSON.stringify(request.body)).not.toContain('previous_response_id')
  })
  it.each([['chat', 'max_completion_tokens'], ['responses', 'max_output_tokens'], ['messages', 'max_tokens']] as const)('%s 使用对应输出限额且不混入其他协议字段', (protocol, field) => {
    const body = chatRequest('model', chatContext([], '问题'), protocol, 128).body
    expect(body).toHaveProperty(field, 128)
    for (const other of ['max_completion_tokens', 'max_output_tokens', 'max_tokens']) {
      if (other !== field) expect(body).not.toHaveProperty(other)
    }
  })
  it('聊天与 Responses 默认使用高推理强度，非推理模型不附加参数', () => {
    const context = chatContext([], '问题')
    for (const model of ['gpt-6-sol', 'gpt-6.1-sol', 'gpt-5.4', 'o3']) {
      const body = chatRequest(model, context).body
      expect(body).toHaveProperty('reasoning_effort', 'high')
      expect(body).not.toHaveProperty('reasoning')
    }
    const responses = chatRequest('gpt-5-codex', context).body
    expect(responses).toHaveProperty('reasoning.effort', 'high')
    expect(responses).not.toHaveProperty('reasoning_effort')
    for (const model of ['gpt-4o', 'claude-sonnet', 'private-alias', 'gemini-3-flash']) {
      const body = chatRequest(model, context).body
      expect(body).not.toHaveProperty('reasoning_effort')
      expect(body).not.toHaveProperty('reasoning')
    }
  })
  it.each([0, -1, 1.5, NaN, Infinity])('无效输出限额 %s 在发出请求前拒绝', limit => {
    expect(() => chatRequest('gpt-6-sol', chatContext([], '问题'), 'chat', limit)).toThrow('configuration')
  })
})
describe('SSE', () => {
  it('逐字节中文、CRLF、心跳、多行 data 和无末尾空行', async () => {
    let text = ''
    await consumeChatSSE(response(': ping\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"你好🙂"}}]}\r\n\r\ndata: {"choices":[{"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]'), 'chat', value => { text += value })
    expect(text).toBe('你好🙂')
  })
  it('Messages 增量和 message_stop', async () => {
    let text = ''
    await consumeChatSSE(response('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"回答"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n'), 'messages', t => { text += t })
    expect(text).toBe('回答')
  })
  it('Responses 只消费文本 delta，不从 completed 重复追加', async () => {
    let text = ''
    await consumeChatSSE(response('data: {"type":"response.output_text.delta","delta":"回答"}\n\ndata: {"type":"response.completed","response":{"status":"completed","output_text":"回答"}}\n\n'), 'responses', t => { text += t })
    expect(text).toBe('回答')
  })
  it.each([
    ['data: {"choices":[{"delta":{"content":"半截"}}]}\n\n', 'chat', 'disconnected'],
    ['data: {bad}\n\n', 'chat', 'protocol'],
    ['data: {"error":{"type":"insufficient_quota"}}\n\n', 'chat', 'balance'],
    ['data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', 'chat', 'incomplete'],
    ['data: {"type":"response.incomplete"}\n\n', 'responses', 'incomplete'],
    ['data: {"type":"error","error":{"type":"overloaded_error"}}\n\n', 'messages', 'rateLimit'],
  ] as const)('异常流不会作为成功结束 %#', async (raw, protocol, code) => {
    await expect(consumeChatSSE(response(raw), protocol, () => undefined)).rejects.toThrow(code)
  })
  it('拒绝 HTML/JSON 响应', async () => { await expect(consumeChatSSE(new Response('html'), 'chat', () => undefined)).rejects.toThrow('protocol') })
})
describe('错误脱敏', () => {
  it.each([[401, 'unauthorized'], [403, 'forbidden'], [429, 'rateLimit'], [402, 'balance'], [413, 'context'], [404, 'model'], [503, 'server'], [400, 'request']] as const)('%i 映射分类', (status, code) => expect(chatError(status, { error: { message: 'secret-key-value' } }).message).toBe(code))
  it('余额不足优先于 403/429', () => expect(chatError(403, { error: { code: 'INSUFFICIENT_BALANCE' } }).code).toBe('balance'))
})
