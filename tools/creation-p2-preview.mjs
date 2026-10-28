// P2 专用本地预览：全部响应固定，只有本机监听，绝不转发真实生成请求。
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')
const prototype = 'D:/download/sub2api_ai_creation_prototype_v5.html'
const png = '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'
const user = id => ({ id, email: `canvas${id}@example.test`, username: `本地验收用户${id}`, role: 'user', status: 'active', balance: 100, frozen_balance: 0, concurrency: 5, run_mode: 'standard', allowed_groups: [], created_at: '2026-10-27T00:00:00Z' })
const fixtureKey = (owner, index) => ({ id: owner * 10 + index, user_id: owner, name: ['团队通用 Key', '图片创作 Key', '聊天专用 Key', '受限图片 Key'][index - 1], key: `stage-a-fixture-${owner}-${index}`, group_id: index, status: 'active', quota: 0, quota_used: 0, expires_at: null, group: { id: index, name: ['通用分组', '图片分组', '聊天分组', '禁止生图'][index - 1], platform: 'openai', allow_image_generation: index !== 4 } })
const catalog = { 1: ['gpt-image-2', 'gpt-6', 'gpt-5-codex'], 2: ['gpt-image-2', 'gpt-image-1.5', 'custom-image-alias'], 3: ['gpt-6', 'claude-sonnet', 'gpt-5-codex', 'private-claude-alias'], 4: ['gpt-image-2'] }
const metrics = { generations: 0, edits: 0, forbidden: 0, chats: [], images: [] }
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' }

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const authorization = req.headers.authorization || ''
  const owner = authorization.includes('202') ? 202 : 101
  const json = (data, status = 200, envelope = true) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(envelope ? { code: 0, data } : data)) }
  if (path === '/__creation_preview') return json({ mode: 'mock-only', ...metrics })
  if (path === '/__v5_prototype') { res.writeHead(200, { 'Content-Type': mime['.html'] }); return res.end(readFileSync(prototype)) }
  if (path === '/setup/status') return json({ needs_setup: false })
  if (path === '/api/v1/settings/public') return json({ site_name: 'Sub2API P2 本地模拟验收', registration_enabled: false, backend_mode_enabled: false, subscription_enabled: false, announcement_enabled: false })
  if (path === '/api/v1/auth/login') {
    let body = ''; for await (const chunk of req) body += chunk
    const id = body.includes('202') ? 202 : 101
    return json({ access_token: `canvas-fixture-jwt-${id}`, token_type: 'Bearer', expires_in: 86400, user: user(id) })
  }
  if (path === '/api/v1/auth/me') return json(user(owner))
  if (path === '/api/v1/auth/logout') return json({ message: 'ok' })
  if (path.startsWith('/api/v1/announcements')) return json([])
  if (path === '/api/v1/keys') return json({ items: [1, 2, 3, 4].map(index => fixtureKey(owner, index)), total: 4, page: 1, page_size: 100, pages: 1 })
  if (/^\/api\/v1\/keys\/\d+$/.test(path)) {
    const id = Number(path.split('/').pop())
    if (Math.floor(id / 10) !== owner || ![1, 2, 3, 4].includes(id % 10)) return json({ message: '无权访问该 Key' }, 403)
    return json(fixtureKey(owner, id % 10))
  }
  const match = /^Bearer stage-a-fixture-(101|202)-([1-4])$/.exec(authorization)
  if (path.startsWith('/v1/') && !match) return json({ error: { message: '本地预览仅接受模拟 Key' } }, 403, false)
  if (path === '/v1/models') return json({ data: catalog[Number(match[2])].map(id => ({ id })) }, 200, false)
  if (req.method === 'POST' && ['/v1/chat/completions', '/v1/messages', '/v1/responses'].includes(path)) {
    let raw = ''; for await (const chunk of req) raw += chunk
    let body; try { body = JSON.parse(raw) } catch { return json({ error: { message: 'invalid JSON' } }, 400, false) }
    const history = body.messages || body.input || []
    const last = history.filter(m => m.role === 'user').at(-1)
    const question = typeof last?.content === 'string' ? last.content : last?.content?.map(p => p.text).join('') || ''
    // 验收记录只包含模型、Key ID 和消息；不记录 Authorization 或明文模拟 Key。
    metrics.chats.push({ owner, keyId: owner * 10 + Number(match[2]), path, body })
    const status = /\[http:(\d+)\]/.exec(question)?.[1]
    if (status) return json({ error: { code: Number(status) === 402 ? 'INSUFFICIENT_BALANCE' : 'mock_error' } }, Number(status), false)
    if (!catalog[Number(match[2])].includes(body.model)) return json({ error: { code: 'model_not_found' } }, 404, false)
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' })
    res.write(': 本地 Mock 心跳\r\n\r\n')
    const answer = question.includes('[xss]') ? '<img src=x onerror="window.__chatXss=1"><script>window.__chatXss=1</script>\n\n[危险链接](javascript:alert(1))\n\n![外部图片](https://evil.example/tracking)' : `已收到：${question.replace(/\[slow\]|\[disconnect\]|\[stream-error\]/g, '')}\n\n这是 **P2 本地模拟回答**，未调用真实模型。上下文共 ${history.length} 条消息。\n\n\`\`\`java\npublic class Hello {\n    // 示例代码仅用于本地验收\n    public static void main(String[] args) {\n        System.out.println("你好，Sub2API");\n    }\n}\n\`\`\`\n\n可以继续追问，或切换模型和 Key。`
    const chunks = answer.match(/[\s\S]{1,16}/g) || []
    let i = 0
    const event = value => res.write(`data: ${JSON.stringify(value)}\r\n\r\n`)
    let steps = 0
    if (path.endsWith('/messages')) event({ type: 'message_start', message: { role: 'assistant', content: [] } })
    if (path.endsWith('/responses')) event({ type: 'response.created', response: { status: 'in_progress' } })
    const timer = setInterval(() => {
      if (question.includes('[reasoning]') && steps++ < 8) {
        if (path.endsWith('/messages')) event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '本机模拟推理，不作为正文保存' } })
        else if (path.endsWith('/responses')) event({ type: 'response.reasoning_summary_text.delta', delta: '本机模拟推理' })
        else event({ choices: [{ delta: { reasoning_content: '本机模拟推理' } }] })
        return
      }
      if (question.includes('[heartbeat]')) { res.write(': ping\n\n'); return }
      if (question.includes('[idle]')) return
      if (question.includes('[tool]') && i === 2) {
        clearInterval(timer)
        if (path.endsWith('/messages')) event({ type: 'content_block_start', content_block: { type: 'tool_use', name: 'mock' } })
        else if (path.endsWith('/responses')) event({ type: 'response.output_item.added', item: { type: 'function_call', name: 'mock' } })
        else event({ choices: [{ delta: { tool_calls: [{ type: 'function' }] } }] })
        return res.end()
      }

      if (res.destroyed) { clearInterval(timer); return }
      if (i >= chunks.length) {
        clearInterval(timer)
        if (path.endsWith('/messages')) { event({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }); event({ type: 'message_stop' }) }
        else if (path.endsWith('/responses')) event({ type: 'response.completed', response: { status: 'completed', output: [] } })
        else { event({ choices: [{ delta: {}, finish_reason: 'stop' }] }); res.write('data: [DONE]\r\n\r\n') }
        return res.end()
      }
      if (i === 2 && question.includes('[disconnect]')) { clearInterval(timer); return res.end() }
      if (i === 2 && question.includes('[stream-error]')) { clearInterval(timer); event({ error: { type: 'overloaded_error' } }); return res.end() }
      const text = chunks[i++]
      if (path.endsWith('/messages')) event({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
      else if (path.endsWith('/responses')) event({ type: 'response.output_text.delta', delta: text })
      else event({ choices: [{ delta: { content: text } }] })
    }, /\[slow\]|\[reasoning\]/.test(question) ? 180 : 12)
    res.on('close', () => clearInterval(timer))
    return
  }
  if (path === '/v1/images/generations' || path === '/v1/images/edits') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks)
    let body, files = []
    try {
      if ((req.headers['content-type'] || '').includes('multipart/form-data')) {
        const form = await new Request('http://localhost', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData()
        body = Object.fromEntries([...form.entries()].filter(([, value]) => typeof value === 'string'))
        files = [...form.entries()].filter(([, value]) => typeof value !== 'string').map(([field, value]) => ({ field, size: value.size, type: value.type }))
      } else body = JSON.parse(raw.toString('utf8'))
    } catch { return json({ error: { message: 'invalid body' } }, 400, false) }
    const keyIndex = Number(match[2])
    if (keyIndex === 4) return json({ error: { message: '禁止生图' } }, 403, false)
    if (!catalog[keyIndex].includes(body.model)) return json({ error: { message: '模型不属于此 Key' } }, 403, false)
    metrics.images.push({ owner: Number(match[1]), keyId: Number(match[1]) * 10 + keyIndex, path, body, files, channel: '本机 Mock，不代表真实渠道', usage: null, charge: 0 })
    metrics[path.endsWith('edits') ? 'edits' : 'generations']++
    if (body.prompt.includes('[partial]') && metrics.images.filter(item => item.body.prompt === body.prompt).length === 2) return json({ error: { message: 'mock partial' } }, 500, false)
    const status = /\[http:(\d+)\]/.exec(body.prompt)?.[1]
    if (status) return json({ error: { message: 'secret-upstream-key-and-private-url' } }, Number(status), false)
    if (body.prompt.includes('[drop]')) return req.socket.destroy()
    const result = body.prompt.includes('[empty]') ? { data: [] } : body.prompt.includes('[invalid-image]') ? { data: [{ b64_json: 'broken' }] } : body.prompt.includes('[error200]') ? { error: { message: 'secret-upstream-key' }, data: [{ b64_json: png }] } : { created: 1, data: [{ b64_json: png }] }
    if (body.prompt.includes('[slow]')) return setTimeout(() => { if (!res.destroyed) json(result, 200, false) }, 1500)
    return json(result, 200, false)
  }
  if (path.startsWith('/v1/')) { metrics.forbidden++; return json({ error: { message: 'P2 Mock 未开放该接口（含视频）' } }, 403, false) }
  if (path.startsWith('/api/')) return json({ items: [], total: 0 })
  let name = resolve(root, `.${path}`)
  if (!name.startsWith(root + sep) && name !== root) { res.writeHead(404); return res.end() }
  const canvas = path === '/canvas' || path.startsWith('/canvas/')
  if (!existsSync(name) || statSync(name).isDirectory()) {
    if (canvas && !['/canvas', '/canvas/', '/canvas/image', '/canvas/assets', '/canvas/canvas'].includes(path) && !path.startsWith('/canvas/canvas/')) { res.writeHead(404); return res.end() }
    if (extname(path) && !path.endsWith('.html')) { res.writeHead(404); return res.end() }
    name = resolve(root, canvas ? 'canvas/index.html' : 'index.html')
  }
  if (!existsSync(name)) { res.writeHead(503); return res.end('请先构建双前端资源') }
  const headers = { 'Content-Type': mime[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Frame-Options': canvas ? 'SAMEORIGIN' : 'DENY' }
  if (canvas && name.endsWith('.html')) headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: blob: data:; frame-ancestors 'self'; object-src 'none'; media-src 'self' blob: data:; worker-src 'self' blob:"
  res.writeHead(200, headers); res.end(readFileSync(name))
}).listen(18088, '127.0.0.1', () => process.stdout.write('P2 mock-only: http://127.0.0.1:18088/ai-creation/image\n'))
