import { afterEach, describe, expect, it, vi } from 'vitest'
import { chatCapability } from '../creation-chat-config'
import { chatContext, chatRequest, consumeChatSSE, streamChat } from '../creation-chat'

const event = (value: unknown, name = '') => `${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(value)}\n\n`
const completed = (output: unknown[] = []) => event({ type: 'response.completed', response: { status: 'completed', output } })
const stop = event({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n'
const response = (raw: string, split = 7) => {
  const bytes = new TextEncoder().encode(raw)
  return new Response(new ReadableStream({ start(c) {
    for (let i = 0; i < bytes.length; i += split) c.enqueue(bytes.slice(i, i + split))
    c.close()
  } }), { headers: { 'content-type': 'text/event-stream' } })
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('P2 精确协议能力', () => {
  it('显式规则覆盖模型名，严格隔离用户和 Key，并覆盖三种协议', () => {
    for (const protocol of ['chat', 'messages', 'responses'] as const) {
      const rules = [{ userId: 12, keyId: 7, model: '私有别名', protocol }]
      expect(chatCapability('私有别名', 12, 7, rules)).toEqual({ protocol, source: 'configured' })
      expect(chatCapability('私有别名', 13, 7, rules).source).toBe('compatibility')
      expect(chatCapability('私有别名', 12, 8, rules).source).toBe('compatibility')
      expect(chatRequest('私有别名', chatContext([], '问题'), protocol).protocol).toBe(protocol)
    }
  })
  it('名称中碰巧包含模型家族的别名不继承协议；标准模型保留原行为', () => {
    expect(chatCapability('private-claude-alias').source).toBe('compatibility')
    expect(chatCapability('private-codex-alias').source).toBe('compatibility')
    expect(chatCapability('claude-sonnet-4-5').protocol).toBe('messages')
    expect(chatCapability('claude-3-7-sonnet-20250219').protocol).toBe('messages')
    expect(chatCapability('gpt-5.2-codex').protocol).toBe('responses')
    expect(chatCapability('codex-mini-latest').protocol).toBe('responses')
    expect(chatCapability('gpt-6').protocol).toBe('chat')
  })
  it('部署配置非法或有重复规则时明确阻止，不能默默改用其他协议', () => {
    vi.stubEnv('VITE_CREATION_CHAT_PROTOCOLS', '{invalid')
    expect(() => chatCapability('alias')).toThrow('configuration')
    const rule = { userId: 1, keyId: 2, model: 'alias', protocol: 'messages' as const }
    expect(() => chatCapability('alias', 1, 2, [rule, rule])).toThrow('configuration')
  })
  it('发送只执行一次 fetch，失败不自动切协议或重发', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":{"message":"secret"}}', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    await expect(streamChat({ userId: 1, keyId: 2, keyName: '本地', apiKey: 'memory', model: 'alias', models: ['alias'] }, chatContext([], '问题'), new AbortController().signal, () => {}, { protocol: 'messages' })).rejects.toThrow('forbidden')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('/v1/messages')
  })
})

describe('P2 SSE 完成语义与受限能力', () => {
  it('Chat 心跳不算进展，非文本 reasoning 不混入正文，分块多行 UTF-8 正确', async () => {
    const activities: string[] = [], text: string[] = []
    await consumeChatSSE(response(': 心跳\r\n\r\n' + event({ choices: [{ delta: { reasoning_content: '不保存的思考' } }] }) + 'data: {"choices":\r\ndata: [{"delta":{"content":"你好🙂"}}]}\r\n\r\n' + stop, 1), 'chat', t => text.push(t), { activity: a => activities.push(a) })
    expect(text).toEqual(['你好🙂'])
    expect(activities).toContain('network'); expect(activities).toContain('reasoning')
  })
  it('Messages 验证真实事件结构、thinking/signature/ping 与 stop_reason', async () => {
    let text = ''; const activity = vi.fn()
    const raw = event({ type: 'message_start', message: { role: 'assistant', content: [] } }, 'message_start') +
      event({ type: 'ping' }, 'ping') + event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
      event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } }) +
      event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: '签名' } }) +
      event({ type: 'content_block_stop', index: 0 }) + event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }) +
      event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } }) + event({ type: 'content_block_stop', index: 1 }) +
      event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + event({ type: 'message_stop' })
    await consumeChatSSE(response(raw), 'messages', t => { text += t }, { activity })
    expect(text).toBe('答案'); expect(activity).toHaveBeenCalledWith('reasoning')
  })
  it('Responses 状态、reasoning、message part 与 completed 不重复追加正文', async () => {
    const item = { type: 'message', status: 'completed', content: [{ type: 'output_text', text: '答案' }] }
    let text = ''; const activity = vi.fn()
    await consumeChatSSE(response(event({ type: 'response.created', response: { status: 'in_progress' } }) +
      event({ type: 'response.output_item.added', item: { type: 'reasoning' } }) +
      event({ type: 'response.reasoning_summary_text.delta', delta: '思考' }) +
      event({ type: 'response.output_item.added', item: { ...item, status: 'in_progress', content: [] } }) +
      event({ type: 'response.content_part.added', part: { type: 'output_text', text: '' } }) +
      event({ type: 'response.output_text.delta', delta: '答案' }) + event({ type: 'response.output_item.done', item }) + completed([item])), 'responses', t => { text += t }, { activity })
    expect(text).toBe('答案'); expect(activity).toHaveBeenCalledWith('reasoning')
  })
  it.each([
    ['chat', 'data: [DONE]\n\n', 'disconnected'],
    ['chat', event({ choices: [{ delta: { content: '半截' } }] }), 'disconnected'],
    ['chat', event({ choices: [{ delta: { content: '半截' } }] }) + event({ choices: [{ finish_reason: 'stop' }] }), 'disconnected'],
    ['messages', event({ type: 'message_stop' }), 'incomplete'],
    ['messages', 'data: [DONE]\n\n', 'protocol'],
    ['responses', event({ type: 'response.completed' }), 'incomplete'],
    ['responses', event({ type: 'response.completed', response: { status: 'in_progress' } }), 'incomplete'],
    ['responses', event({ type: 'response.completed', response: { status: 'completed', incomplete_details: { reason: 'max_output_tokens' } } }), 'incomplete'],
    ['responses', event({ type: 'response.incomplete' }), 'incomplete'],
    ['responses', event({ type: 'response.failed', response: { error: { code: 'insufficient_quota', message: '私密' } } }), 'balance'],
    ['responses', completed(), 'empty'],
    ['chat', event({ choices: [{ delta: { content: 123 } }] }), 'protocol'],
    ['chat', 'data: null\n\n', 'protocol'],
  ] as const)('完成校验与非法响应 %s %#', async (protocol, raw, code) => {
    await expect(consumeChatSSE(response(raw), protocol, () => {})).rejects.toThrow(code)
  })
  it.each([
    ['chat', event({ choices: [{ delta: { tool_calls: [{ type: 'function' }] } }] })],
    ['chat', event({ choices: [{ delta: { audio: { data: '音频' } } }] })],
    ['chat', event({ choices: [{ delta: { content: [{ type: 'image', data: '图片' }] } }] })],
    ['messages', event({ type: 'content_block_start', content_block: { type: 'tool_use' } })],
    ['messages', event({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } })],
    ['responses', event({ type: 'response.output_item.added', item: { type: 'function_call' } })],
    ['responses', event({ type: 'response.output_text.delta', delta: '部分' }) + completed([{ type: 'web_search_call' }])],
    ['responses', event({ type: 'response.output_audio.delta', delta: '音频' })],
    ['responses', completed([{ type: 'message', content: [{ type: 'refusal', refusal: '拒答' }] }])],
  ] as const)('工具或非文本输出明确受限 %s %#', async (protocol, raw) => {
    await expect(consumeChatSSE(response(raw), protocol, () => {})).rejects.toThrow('unsupported')
  })
  it('网络中断保持已消费文本并取消 reader', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>, text = ''
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    const run = consumeChatSSE(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), 'chat', t => { text += t })
    controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: '部分' } }] })))
    await vi.waitFor(() => expect(text).toBe('部分'))
    const failed = expect(run).rejects.toThrow('mock network')
    controller.error(new Error('mock network')); await failed
    expect(text).toBe('部分')
  })
  it('SSE 多行 data 累积上限受保护；非法 UTF-8 拒绝而不替换乱码', async () => {
    const raw = ('data: ' + ' '.repeat(100000) + '\n').repeat(21)
    await expect(consumeChatSSE(response(raw, 100000), 'chat', () => {})).rejects.toThrow('protocol')
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff])); c.close() } })
    await expect(consumeChatSSE(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), 'chat', () => {})).rejects.toThrow('protocol')
  })
})
