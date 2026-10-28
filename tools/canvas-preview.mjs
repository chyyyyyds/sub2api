// 仅本机验收：所有 API 均为固定模拟数据，绝不转发到真实供应商。
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII='
const user = id => ({ id, email: `canvas${id}@example.test`, username: `本地验收用户${id}`, role: 'user', status: 'active', balance: 100, frozen_balance: 0, concurrency: 5, run_mode: 'standard', allowed_groups: [], created_at: '2026-10-27T00:00:00Z' })
const key = id => ({ id, user_id: id, name: '本地模拟图片 Key', key: `canvas-fixture-key-${id}`, group_id: 1, status: 'active', quota: 0, quota_used: 0, expires_at: null, group: { id: 1, name: '模拟图片分组', platform: 'openai', allow_image_generation: true } })
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' }
const metrics = { generations: 0, edits: 0 }
http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const id = req.headers.authorization?.endsWith('202') ? 202 : 101
  const json = (data, status = 200, envelope = true) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(envelope ? { code: 0, data } : data)) }
  if (path === '/__canvas_preview') return json({ mode: 'mock-only', ...metrics })
  if (path === '/setup/status') return json({ needs_setup: false })
  if (path === '/api/v1/settings/public') return json({ site_name: 'Sub2API 本地模拟验收', registration_enabled: false, backend_mode_enabled: false, subscription_enabled: false, announcement_enabled: false })
  if (path === '/api/v1/auth/login') {
    let body = ''; for await (const chunk of req) body += chunk
    const loginId = body.includes('202') ? 202 : 101
    return json({ access_token: `canvas-fixture-jwt-${loginId}`, token_type: 'Bearer', expires_in: 86400, user: user(loginId) })
  }
  if (path === '/api/v1/auth/me') return json(user(id))
  if (path === '/api/v1/auth/logout') return json({ message: 'ok' })
  if (path.startsWith('/api/v1/announcements')) return json([])
  if (path === '/api/v1/keys') return json({ items: [key(id)], total: 1, page: 1, page_size: 100, pages: 1 })
  if (/^\/api\/v1\/keys\/\d+$/.test(path)) return json(key(id))
  if (path === '/v1/models') return json({ data: [{ id: 'gpt-image-2' }, { id: 'custom-image-alias' }, { id: 'grok-imagine-video' }] }, 200, false)
  if (path === '/v1/images/generations' || path === '/v1/images/edits') {
    for await (const _ of req) { /* 消费本地模拟请求，不记录提示词或凭证。 */ }
    metrics[path.endsWith('edits') ? 'edits' : 'generations']++
    return json({ created: 1, data: [{ b64_json: png }] }, 200, false)
  }
  if (path.startsWith('/v1/')) return json({ error: { message: '本地验收仅开放模拟图片接口' } }, 403, false)
  if (path.startsWith('/api/')) return json({ items: [], total: 0 })
  let name = resolve(root, `.${path}`)
  if (!name.startsWith(root + sep) && name !== root) { res.writeHead(404); return res.end() }
  const canvas = path === '/canvas' || path.startsWith('/canvas/')
  if (!existsSync(name) || statSync(name).isDirectory()) {
    if (canvas && !['/canvas', '/canvas/', '/canvas/image', '/canvas/assets', '/canvas/canvas'].includes(path) && !path.startsWith('/canvas/canvas/')) { res.writeHead(404); return res.end() }
    if (extname(path) && !path.endsWith('.html')) { res.writeHead(404); return res.end() }
    name = resolve(root, canvas ? 'canvas/index.html' : 'index.html')
  }
  const headers = { 'Content-Type': mime[extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Frame-Options': canvas ? 'SAMEORIGIN' : 'DENY' }
  // 与 Go 画布服务相同的能力范围；生产 nonce 由 Go 测试独立验证。
  if (canvas && name.endsWith('.html')) headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: blob: data:; frame-ancestors 'self'; object-src 'none'; media-src 'self' blob: data:; worker-src 'self' blob:"
  if (!existsSync(name)) { res.writeHead(503); return res.end('正在构建本地验收资源') }
  res.writeHead(200, headers); res.end(readFileSync(name))
}).listen(18084, '127.0.0.1', () => process.stdout.write('Mock-only preview: http://127.0.0.1:18084/ai-creation/image\n'))
