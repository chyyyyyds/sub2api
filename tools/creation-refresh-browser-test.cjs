// 独立浏览器验证：图片挂起期间触发实际 auth/me 定时刷新，全部使用本机 Mock。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18106'
const out = path.resolve(__dirname, '../.codex/image-refresh-fix')
const checks = [], errors = [], blocked = [], images = [], counts = {}
const scriptDownloads = []
let browser
async function main() {
  fs.mkdirSync(out, { recursive: true })
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(base) || /^(blob|data):/.test(url)) return route.continue()
    blocked.push(url); return route.abort()
  })
  await context.addInitScript(() => {
    localStorage.setItem('auth_token', 'canvas-fixture-jwt-101')
    localStorage.setItem('auth_user', JSON.stringify({ id: 101, email: 'canvas101@example.test', role: 'user', balance: 100 }))
    localStorage.setItem('user_guide_101', 'true')
    localStorage.setItem('sub2api_locale', 'zh')
    window.__creationBridgeTypes = []
    window.addEventListener('message', event => {
      if (event.origin === location.origin && typeof event.data?.type === 'string') window.__creationBridgeTypes.push(event.data.type)
    })
  })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    const name = new URL(response.url()).pathname
    if (name.startsWith('/canvas/') && name.endsWith('.js')) scriptDownloads.push(response.body().then(body => ({ name, bytes: body.length })))
  })
  page.on('request', request => {
    const key = new URL(request.url()).pathname
    if (/^\/(api\/v1\/|v1\/)/.test(key)) counts[key] = (counts[key] || 0) + 1
  })
  await page.clock.install()
  let releaseCatalog
  const catalogGate = new Promise(resolve => { releaseCatalog = resolve })
  await context.route('**/v1/models', async route => { await catalogGate; await route.continue() })
  await page.goto(base + '/ai-creation/image')
  await page.locator('iframe').waitFor()
  await page.waitForFunction(() => window.__creationBridgeTypes.includes('new-api:canvas-ready'))
  assert.equal(await page.locator('iframe').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  checks.push('模型目录尚未返回时，空画布已并行下载并发出 ready，且未启用凭证')
  releaseCatalog()
  await page.getByText('画布已连接', { exact: true }).waitFor()
  const frame = page.frames().find(item => item.url().startsWith(base + '/canvas/'))
  assert(frame)
  await frame.locator('textarea').first().waitFor()
  assert.equal(counts['/api/v1/keys'], 1)
  assert.equal(counts['/api/v1/keys/1011'], 1)
  assert.equal(counts['/v1/models'], 1)
  checks.push('首屏只读取一次所选 Key 及模型目录，其余 Key 未提前查询')
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1536
    const pen = canvas.getContext('2d'); pen.fillStyle = '#168c8a'; pen.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  let releaseImages
  const imageGate = new Promise(resolve => { releaseImages = resolve })
  await context.route('**/v1/images/generations', async route => {
    images.push(route.request().postDataJSON())
    await imageGate
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: 1, data: [{ b64_json: png }] }) })
  })
  const group = name => frame.getByRole('group', { name, exact: true })
  await group('生成张数').getByRole('button', { name: '2 张', exact: true }).click()
  await group('生成质量').getByRole('button', { name: '高', exact: true }).click()
  for (const name of ['预设', '1K', '2:3']) await group('画布尺寸').getByRole('button', { name, exact: true }).click()
  await frame.locator('textarea').first().fill('给我画一个 穿着背带裤 打篮球的鸡')
  await frame.getByRole('button', { name: '开始生成', exact: true }).click()
  await page.waitForFunction(() => true)
  for (let attempt = 0; images.length < 2 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(images.length, 2)
  assert(images.every(body => body.n === 1 && body.model === 'gpt-image-2' && body.quality === 'high' && body.size === '1024x1536' && body.output_format === 'png'))
  const before = { ...counts }
  const bridgeBefore = await frame.evaluate(() => window.__creationBridgeTypes.length)
  const refresh = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
  // 使用浏览器虚拟时钟触发原有 60 秒自动刷新，无需真实等待或收费请求。
  await page.clock.fastForward(61_000)
  await (await refresh).finished()
  await new Promise(resolve => setTimeout(resolve, 200))
  assert((counts['/api/v1/auth/me'] || 0) > (before['/api/v1/auth/me'] || 0))
  for (const key of ['/api/v1/keys', '/api/v1/keys/1011', '/v1/models']) assert.equal(counts[key], before[key], key)
  assert.equal(await frame.evaluate(() => window.__creationBridgeTypes.length), bridgeBefore)
  assert.equal(await page.locator('iframe').evaluate(el => getComputedStyle(el).pointerEvents), 'auto')
  assert.equal(await page.locator('iframe').evaluate(el => getComputedStyle(el).opacity), '1')
  assert.equal(await page.getByText('画布已连接', { exact: true }).count(), 1)
  checks.push('两张图片等待期间触发 auth/me 刷新：无 Key/目录重查、无 suspend、画面不变暗且保持可操作')
  releaseImages()
  await frame.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('开始生成') && !button.disabled))
  await frame.waitForFunction(() => document.querySelectorAll('img').length >= 2)
  assert.equal(await frame.getByText('生成失败', { exact: true }).count(), 0)
  assert.equal(images.length, 2)
  checks.push('原来的两个 n=1 请求正常完成、展示两张图片，没有取消或自动重试')
  await page.screenshot({ path: path.join(out, 'refresh-generation-success.png'), fullPage: true })
  // 虚拟时钟不提供资源 PerformanceEntry，直接读取浏览器已接收的脚本响应做首屏断言。
  const resources = await Promise.all(scriptDownloads)
  assert(resources.length > 0)
  assert(!resources.some(item => /mermaid|project-|agent-panel|local-agent-panel/.test(item.name)))
  checks.push('图片首屏未加载 Mermaid、画布编辑器和独立 Agent 面板资源')
  await frame.getByRole('button', { name: '放入画布', exact: true }).first().click()
  await frame.getByRole('button', { name: '放入画布', exact: true }).last().click()
  await frame.waitForURL(/\/canvas\/canvas\/.+/)
  await frame.locator('img').first().waitFor()
  const canvasUrl = frame.url()
  await page.locator('#studio-key').click()
  await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: '图片创作 Key' }).click()
  await page.getByText('画布已连接', { exact: true }).waitFor()
  assert.equal(frame.url(), canvasUrl)
  await frame.locator('img').first().waitFor()
  assert.equal(images.length, 2)
  checks.push('按需加载的画布编辑器可打开生成结果；手动切 Key 重新校验且保留同一画布，无额外图片请求')
  assert.deepEqual(errors, [])
  // 现有支付 SDK 和画布插件索引的静态请求也被阻断，任何模型或未知外网请求均失败。
  assert(blocked.every(url => ['static.airwallex.com', 'checkout.airwallex.com', 'raw.githubusercontent.com'].includes(new URL(url).hostname)), JSON.stringify(blocked.map(url => new URL(url).origin)))
  const result = { checks, requests: counts, images: images.length, startup_scripts: resources, page_errors: errors, blocked_external_requests: blocked, paid_requests: 0 }
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2), 'utf8')
  console.log(JSON.stringify(result, null, 2))
}
main().catch(error => { console.error(error.stack); process.exitCode = 1 }).finally(async () => { await browser?.close() })
