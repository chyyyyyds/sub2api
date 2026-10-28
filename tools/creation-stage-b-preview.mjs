// Stage B 专用本地预览：全部响应固定，只有本机监听，绝不转发真实生成请求。
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')
const prototype = 'D:/download/sub2api_ai_creation_prototype_v5.html'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII='
const user = id => ({ id, email: `canvas${id}@example.test`, username: `本地验收用户${id}`, role: 'user', status: 'active', balance: 100, frozen_balance: 0, concurrency: 5, run_mode: 'standard', allowed_groups: [], created_at: '2026-10-27T00:00:00Z' })
const fixtureKey = (owner, index) => ({ id: owner * 10 + index, user_id: owner, name: ['团队通用 Key', '图片创作 Key', '聊天专用 Key', '受限图片 Key'][index - 1], key: `stage-a-fixture-${owner}-${index}`, group_id: index, status: 'active', quota: 0, quota_used: 0, expires_at: null, group: { id: index, name: ['通用分组', '图片分组', '聊天分组', '禁止生图'][index - 1], platform: 'openai', allow_image_generation: index !== 4 } })
const catalog = { 1: ['gpt-image-2', 'gpt-6', 'gpt-5-codex'], 2: ['gpt-image-2', 'custom-image-alias', 'flux-1'], 3: ['gpt-6', 'claude-sonnet', 'gpt-5-codex'], 4: ['gpt-image-2'] }
const metrics = { generations: 0, edits: 0, forbidden: 0, chats: [] }
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' }

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const authorization = req.headers.authorization || ''
  const owner = authorization.includes('202') ? 202 : 101
  const json = (data, status = 200, envelope = true) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(envelope ? { code: 0, data } : data)) }
  if (path === '/__creation_preview') return json({ mode: 'mock-only', ...metrics })
  if (path === '/__v5_prototype') { res.writeHead(200, { 'Content-Type': mime['.html'] }); return res.end(readFileSync(prototype)) }
  if (path === '/setup/status') return json({ needs_setup: false })
  if (path === '/api/v1/settings/public') return json({ site_name: 'Sub2API Stage B 本地模拟验收', registration_enabled: false, backend_mode_enabled: false, subscription_enabled: false, announcement_enabled: false })
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
    const answer = question.includes('[xss]') ? '<img src=x onerror="window.__chatXss=1"><script>window.__chatXss=1</script>\n\n[危险链接](javascript:alert(1))\n\n![外部图片](https://evil.example/tracking)' : `已收到：${question.replace(/\[slow\]|\[disconnect\]|\[stream-error\]/g, '')}\n\n这是 **Stage B 本地模拟回答**，未调用真实模型。上下文共 ${history.length} 条消息。\n\n\`\`\`java\npublic class Hello {\n    // 示例代码仅用于本地验收\n    public static void main(String[] args) {\n        System.out.println("你好，Sub2API");\n    }\n}\n\`\`\`\n\n可以继续追问，或切换模型和 Key。`
    const chunks = answer.match(/[\s\S]{1,16}/g) || []
    let i = 0
    const event = value => res.write(`data: ${JSON.stringify(value)}\r\n\r\n`)
    const timer = setInterval(() => {
      if (res.destroyed) { clearInterval(timer); return }
      if (i >= chunks.length) {
        clearInterval(timer)
        if (path.endsWith('/messages')) event({ type: 'message_stop' })
        else if (path.endsWith('/responses')) event({ type: 'response.completed' })
        else { event({ choices: [{ delta: {}, finish_reason: 'stop' }] }); res.write('data: [DONE]\r\n\r\n') }
        return res.end()
      }
      if (i === 2 && question.includes('[disconnect]')) { clearInterval(timer); return res.end() }
      if (i === 2 && question.includes('[stream-error]')) { clearInterval(timer); event({ error: { type: 'overloaded_error' } }); return res.end() }
      const text = chunks[i++]
      if (path.endsWith('/messages')) event({ type: 'content_block_delta', delta: { type: 'text_delta', text } })
      else if (path.endsWith('/responses')) event({ type: 'response.output_text.delta', delta: text })
      else event({ choices: [{ delta: { content: text } }] })
    }, question.includes('[slow]') ? 180 : 12)
    res.on('close', () => clearInterval(timer))
    return
  }
  if (path === '/v1/images/generations' || path === '/v1/images/edits') {
    let body = ''; for await (const chunk of req) body += chunk
    if (match[2] === '4') return json({ error: { message: '模拟分组禁止图片生成' } }, 403, false)
    metrics[path.endsWith('edits') ? 'edits' : 'generations']++
    // 只返回本地固定 PNG；不读取上游地址，也没有外部网络调用。
    return json({ created: 1, data: [{ b64_json: png }] }, 200, false)
  }
  if (path.startsWith('/v1/')) { metrics.forbidden++; return json({ error: { message: 'Stage B Mock 未开放该接口（含视频）' } }, 403, false) }
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
}).listen(18086, '127.0.0.1', () => process.stdout.write('Stage B mock-only: http://127.0.0.1:18086/ai-creation/chat\n'))
