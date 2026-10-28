// P3-A 真实网关准备入口：所有收费及业务写入请求永久阻断，没有收费解锁参数。
import http from 'node:http'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist'))
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
let forwardedReads = 0
let blockedWrites = 0

/** @description 只返回准备环境状态；没有凭证、请求体或上游错误原文。 */
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

http.createServer((req, res) => {
  let path
  try { path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname) }
  catch { return json(res, 400, { error: 'invalid_path' }) }
  if (path === '/__creation_p3a' && req.method === 'GET') {
    return json(res, 200, {
      /** @description 环境为真实 Stage7 网关只读准备，不提供 Mock 结果。 */
      mode: 'real-stage7-readonly',
      /** @description 收费门禁固定关闭，没有环境变量或命令行开关。 */
      paidRequestsAllowed: false,
      /** @description 已转发的白名单 GET 数量。 */
      forwardedReads,
      /** @description 被本地门禁拦截的非只读请求数量。 */
      blockedWrites,
    })
  }
  // 关键步骤：鉴权、Key 创建、推理、图片、探针及一切非 GET 在网络转发前拒绝。
  if (!['GET', 'HEAD'].includes(req.method || '') || path.startsWith('/api/v1/admin')) {
    blockedWrites++
    req.resume()
    return json(res, 403, { error: { type: 'p3a_paid_gate_closed', message: 'P3-A 只读门禁：此请求未转发；登录与测试 Key 准备仍需独立完成。' } })
  }
  const allowedRead = ['/v1/models', '/v1/sub2api/billing', '/api/v1/settings/public', '/api/v1/auth/me', '/api/v1/api-keys', '/api/v1/usage', '/api/v1/usage/stats', '/setup/status'].includes(path) || /^\/api\/v1\/api-keys\/\d+$/.test(path)
  if (path.startsWith('/v1') || path.startsWith('/api') || path.startsWith('/setup')) {
    if (!allowedRead || req.method !== 'GET') return json(res, 403, { error: { type: 'p3a_read_not_allowed' } })
    forwardedReads++
    // 关键步骤：目标固定为 SSH 隧道的 Stage7 端口，不能通过 URL、Host 或环境变量切到生产。
    const upstream = http.request({ hostname: '127.0.0.1', port: 18092, method: 'GET', path: req.url, headers: { ...req.headers, host: '127.0.0.1:18082' }, timeout: 30000 }, response => {
      const headers = { ...response.headers, 'cache-control': 'no-store' }
      delete headers['set-cookie']
      res.writeHead(response.statusCode || 502, headers)
      response.pipe(res)
    })
    upstream.on('timeout', () => upstream.destroy())
    upstream.on('error', () => { if (!res.headersSent) json(res, 502, { error: { type: 'p3a_stage7_tunnel_unavailable' } }); else res.destroy() })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    upstream.end()
    return
  }
  let file = resolve(root, '.' + path)
  if (!file.startsWith(root + sep)) file = resolve(root, 'index.html')
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(root, 'index.html')
  if (!realpathSync(file).startsWith(root + sep)) return json(res, 403, { error: 'invalid_path' })
  let content = readFileSync(file)
  if (extname(file) === '.html') content = Buffer.from(content.toString('utf8').replace('</body>', '<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#854d0e;color:white;text-align:center;font:12px sans-serif;pointer-events:none">P3-A · 真实 Stage7 只读准备 · 收费请求与登录均被阻断 · 非 Mock</div></body>'))
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "connect-src 'self'; form-action 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'" })
  res.end(req.method === 'HEAD' ? undefined : content)
}).listen(18090, '127.0.0.1', () => console.log('P3-A 只读准备：http://127.0.0.1:18090；Stage7 隧道端口18092；收费门禁关闭；无凭证日志。'))
