// Stage A 专用本地预览：全部响应固定，只有本机监听，绝不转发真实生成请求。
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')
const prototype = 'D:/download/sub2api_ai_creation_prototype_v5.html'
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII='
const user = id => ({ id, email: `canvas${id}@example.test`, username: `本地验收用户${id}`, role: 'user', status: 'active', balance: 100, frozen_balance: 0, concurrency: 5, run_mode: 'standard', allowed_groups: [], created_at: '2026-10-27T00:00:00Z' })
const fixtureKey = (owner, index) => ({ id: owner * 10 + index, user_id: owner, name: ['团队通用 Key', '图片创作 Key', '聊天专用 Key', '受限图片 Key'][index - 1], key: `stage-a-fixture-${owner}-${index}`, group_id: index, status: 'active', quota: 0, quota_used: 0, expires_at: null, group: { id: index, name: ['通用分组', '图片分组', '聊天分组', '禁止生图'][index - 1], platform: 'openai', allow_image_generation: index !== 4 } })
const catalog = { 1: ['gpt-image-2', 'gpt-6'], 2: ['gpt-image-2', 'custom-image-alias', 'flux-1'], 3: ['gpt-6', 'claude-sonnet'], 4: ['gpt-image-2'] }
const metrics = { generations: 0, edits: 0, forbidden: 0 }
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' }

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const authorization = req.headers.authorization || ''
  const owner = authorization.includes('202') ? 202 : 101
  const json = (data, status = 200, envelope = true) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(envelope ? { code: 0, data } : data)) }
  if (path === '/__creation_preview') return json({ mode: 'mock-only', ...metrics })
  if (path === '/__v5_prototype') { res.writeHead(200, { 'Content-Type': mime['.html'] }); return res.end(readFileSync(prototype)) }
  if (path === '/setup/status') return json({ needs_setup: false })
  if (path === '/api/v1/settings/public') return json({ site_name: 'Sub2API Stage A 本地模拟验收', registration_enabled: false, backend_mode_enabled: false, subscription_enabled: false, announcement_enabled: false })
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
  if (path === '/v1/images/generations' || path === '/v1/images/edits') {
    let body = ''; for await (const chunk of req) body += chunk
    if (match[2] === '4') return json({ error: { message: '模拟分组禁止图片生成' } }, 403, false)
    metrics[path.endsWith('edits') ? 'edits' : 'generations']++
    // 只返回本地固定 PNG；不读取上游地址，也没有外部网络调用。
    return json({ created: 1, data: [{ b64_json: png }] }, 200, false)
  }
  if (path.startsWith('/v1/')) { metrics.forbidden++; return json({ error: { message: 'Stage A 未开放聊天和视频生成' } }, 403, false) }
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
}).listen(18085, '127.0.0.1', () => process.stdout.write('Stage A mock-only: http://127.0.0.1:18085/ai-creation/image\n'))
