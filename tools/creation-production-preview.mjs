// 正式联调入口：静态文件来自当前构建，身份、模型与推理均经现有公网 Sub2API。
import http from 'node:http'
import https from 'node:https'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname, sep } from 'node:path'
import { randomUUID } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'backend/internal/web/dist')
const evidence = resolve(root, '.codex/creation-production-evidence')
const permitPath = resolve(evidence, 'request-permit.json')
const recordPath = resolve(evidence, 'proxy-requests.json')
const records = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : []
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' }
const paidPaths = ['/v1/chat/completions', '/v1/responses', '/v1/images/generations', '/v1/images/edits']
const save = () => writeFileSync(resolve(evidence, 'proxy-requests.json'), JSON.stringify(records, null, 2), 'utf8')

http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  const fail = status => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'test_gate', message: '本轮请求尚未获逐笔对账放行' } })) }
  if (path.startsWith('/api/') || path.startsWith('/v1/') || path === '/setup/status') {
    // 只接受用户已有登录流程及只读接口；模型 POST 必须消费单次许可，失败也不退回许可。
    if (path.startsWith('/api/v1/admin/')) return fail(403)
    if (!['GET', 'HEAD'].includes(req.method) && path !== '/api/v1/auth/login' && !paidPaths.includes(path)) return fail(403)
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    let record
    if (paidPaths.includes(path) && req.method === 'POST') {
      let permit
      try { permit = JSON.parse(readFileSync(permitPath, 'utf8')) } catch { return fail(403) }
      if (!permit.allowed || permit.path !== path || permit.expiresAt < Date.now()) return fail(403)
      let model, n, size, maxOutputTokens
      try {
        if (path.endsWith('/edits')) {
          const form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': req.headers['content-type'] }, body }).formData()
          model = form.get('model'); n = Number(form.get('n') || 1); size = form.get('size')
        } else {
          const value = JSON.parse(body.toString('utf8'))
          model = value.model; n = value.n; size = value.size
          maxOutputTokens = value.max_completion_tokens ?? value.max_output_tokens
        }
      } catch { return fail(400) }
      if (model !== permit.model || (path.includes('/images/') ? n !== 1 || size !== '1024x1024' : !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens > 4096 || maxOutputTokens <= 0)) return fail(403)
      writeFileSync(permitPath, JSON.stringify({ ...permit, allowed: false, consumedAt: Date.now() }), 'utf8')
      record = { label: permit.label, clientId: randomUUID(), path, model, n, size, maxOutputTokens, estimatedUSD: permit.estimatedUSD, startedAt: new Date().toISOString(), requestBytes: body.length }
      records.push(record); save()
    }
    const headers = { 'User-Agent': 'Mozilla/5.0', Accept: req.headers.accept || '*/*' }
    for (const name of ['authorization', 'content-type', 'anthropic-version']) if (req.headers[name]) headers[name] = req.headers[name]
    if (record) headers['X-Client-Request-ID'] = record.clientId
    // https.request 不具有应用级重试或自动跳转；客户端断开时销毁本次代理连接。
    const upstream = https.request('https://sub2api.chyyds.com' + req.url, { method: req.method, headers }, response => {
      if (record) { record.httpStatus = response.statusCode; record.requestId = response.headers['x-request-id']; record.gatewayClientId = response.headers['x-client-request-id']; record.contentType = response.headers['content-type']; save() }
      const forwarded = {}
      for (const name of ['content-type', 'cache-control', 'x-request-id', 'x-client-request-id', 'x-accel-buffering']) if (response.headers[name]) forwarded[name] = response.headers[name]
      res.writeHead(response.statusCode, forwarded)
      response.on('end', () => { if (record) { record.endedAt = new Date().toISOString(); record.complete = true; save() } })
      response.pipe(res)
    })
    upstream.on('error', () => { if (record) { record.transportError = true; save() }; if (!res.headersSent) res.writeHead(502); res.end() })
    res.on('close', () => { if (!res.writableEnded) { if (record) { record.clientClosed = true; save() }; upstream.destroy() } })
    upstream.end(body)
    return
  }
  let file = resolve(dist, '.' + path)
  if (file !== dist && !file.startsWith(dist + sep)) return fail(403)
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(dist, path.startsWith('/canvas') ? 'canvas/index.html' : 'index.html')
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
}).listen(18095, '127.0.0.1', () => console.log('真实联调入口 http://127.0.0.1:18095；收费请求逐笔许可，默认拒绝。'))
