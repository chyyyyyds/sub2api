// 独立浏览器 + 本地 Mock：外网全部阻断，最终请求断言不触发真实计费。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18096'
const out = path.resolve(__dirname, '../.codex/image-v6-evidence')
fs.mkdirSync(out, { recursive: true })
const checks = [], errors = [], layout = [], blocked = []
let browser, page, frame, context
const metrics = async () => (await (await context.request.get(base + '/__creation_preview')).json()).data
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name) }
async function ready() {
  await page.getByText('画布已连接', { exact: true }).waitFor({ state: 'attached' })
  frame = page.frames().find(f => f.url().startsWith(base + '/canvas/'))
  assert(frame)
  if (new URL(frame.url()).pathname === '/canvas/image') await frame.locator('textarea').first().waitFor()
}
async function select(id, label) {
  await page.locator(id).click()
  await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: label }).first().click()
  await ready()
}
const group = name => frame.getByRole('group', { name, exact: true })
const click = (name, button) => group(name).getByRole('button', { name: button, exact: true }).click()
async function generate(prompt) {
  await frame.locator('textarea').first().fill(prompt)
  await frame.getByRole('button', { name: '开始生成', exact: true }).click()
  await frame.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('开始生成') && !b.disabled))
}
async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  context = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true })
  await context.route('**/*', route => {
    const url = route.request().url()
    if (url.startsWith(base) || /^(blob|data):/.test(url)) return route.continue()
    blocked.push(url); return route.abort()
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  // 由浏览器生成三种真实编码的本地示意图片，以验证 MIME、存储和下载格式。
  const samples = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 960; c.height = 600
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 600)
    g.addColorStop(0, '#174854'); g.addColorStop(1, '#040e19'); x.fillStyle = g; x.fillRect(0, 0, 960, 600)
    x.fillStyle = '#25c2b5'; x.beginPath(); x.arc(690, 150, 65, 0, 2 * Math.PI); x.fill()
    for (let i = 0; i < 12; i++) {
      const h = 100 + (i * 73) % 200; x.fillStyle = '#071925'; x.fillRect(i * 85, 400 - h, 65, h)
      x.fillStyle = '#286877'; for (let y = 420 - h; y < 380; y += 28) x.fillRect(i * 85 + 8, y, 46, 4)
    }
    x.fillStyle = '#9cdbd6'; x.font = '18px sans-serif'; x.fillText('V6 LOCAL MOCK · NO PAID API REQUEST', 250, 540)
    return Object.fromEntries(['png', 'jpeg', 'webp'].map(f => [f, c.toDataURL('image/' + f, .85).split(',')[1]]))
  })
  for (const [format, b64] of Object.entries(samples)) fs.writeFileSync(path.join(out, 'mock-output.' + format), Buffer.from(b64, 'base64'))
  await page.goto(base + '/ai-creation/image')
  await page.evaluate(() => {
    localStorage.setItem('auth_token', 'canvas-fixture-jwt-101')
    localStorage.setItem('auth_user', JSON.stringify({ id: 101, email: 'canvas101@example.test', role: 'user', balance: 100 }))
    localStorage.setItem('user_guide_101', 'true'); localStorage.setItem('sub2api_locale', 'zh')
  })
  await page.goto(base + '/ai-creation/image'); await ready()
  await check('Image 2 四档质量、默认一张、自动尺寸与 PNG 请求', async () => {
    assert.equal(await group('生成质量').getByRole('button').count(), 4)
    await generate('V6 默认参数')
    const record = (await metrics()).images.at(-1)
    assert.deepEqual(record.body, { model: 'gpt-image-2', n: 1, output_format: 'png', prompt: 'V6 默认参数' })
    assert.equal(record.keyId, 1011)
    await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
  })
  await check('Image 2.5 六档质量、Flare 能力、展示名原样请求', async () => {
    await select('#studio-model', 'gpt-image-2.5')
    assert.equal(await group('生成质量').getByRole('button').count(), 6)
    await frame.getByText('GPT Image 2.5 · Flare', { exact: true }).waitFor()
    await click('生成质量', '极致')
    await click('画布尺寸', '预设'); await click('画布尺寸', '2K'); await click('画布尺寸', '16:9')
    await click('输出设置', 'WEBP')
    await frame.getByLabel('输出压缩率', { exact: true }).fill('72')
    await generate('V6 Flare 参数')
    const body = (await metrics()).images.at(-1).body
    assert.deepEqual(body, { model: 'gpt-image-2.5', quality: 'max', size: '2048x1152', n: 1, output_format: 'webp', output_compression: 72, prompt: 'V6 Flare 参数' })
  })
  await check('模型切换修正不兼容质量并提示，保留草稿、参考和结果', async () => {
    const previous = frame
    await frame.locator('textarea').first().fill('切换后保留的提示词')
    await select('#studio-model', 'gpt-image-2')
    assert.equal(frame, previous)
    await frame.getByText('已将不兼容参数恢复为自动。', { exact: true }).waitFor()
    assert.equal(await group('生成质量').getByRole('button', { name: '自动', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await frame.locator('textarea').first().inputValue(), '切换后保留的提示词')
    assert.equal(await frame.getByRole('button', { name: '下载', exact: true }).count(), 1)
  })
  await check('尺寸单一来源：预设、自定义、自动及摘要和请求一致', async () => {
    await click('画布尺寸', '自定义')
    await frame.getByLabel('图片宽度', { exact: true }).fill('1360')
    await frame.getByLabel('图片高度', { exact: true }).fill('768')
    await frame.getByLabel('图片高度', { exact: true }).blur()
    await generate('V6 自定义尺寸')
    assert.equal((await metrics()).images.at(-1).body.size, '1360x768')
    await click('画布尺寸', '自动')
    await generate('V6 自动尺寸')
    assert(!('size' in (await metrics()).images.at(-1).body))
    await click('画布尺寸', '预设'); await click('画布尺寸', '4K'); await click('画布尺寸', '9:16')
    await generate('V6 4K 竖图')
    assert.equal((await metrics()).images.at(-1).body.size, '2160x3840')
  })
  await check('非法尺寸阻止提交，自动对齐开关生效', async () => {
    const before = (await metrics()).images.length
    await click('画布尺寸', '自定义')
    await group('画布尺寸').getByRole('switch').uncheck()
    for (const [w, h] of [['1025', '1024'], ['4096', '1024'], ['3840', '512'], ['256', '256'], ['3840', '3840']]) {
      await frame.getByLabel('图片宽度', { exact: true }).fill(w)
      await frame.getByLabel('图片高度', { exact: true }).fill(h)
      assert(await frame.getByRole('button', { name: '开始生成', exact: true }).isDisabled())
    }
    assert.equal((await metrics()).images.length, before)
    await frame.getByLabel('图片宽度', { exact: true }).fill('1025')
    await frame.getByLabel('图片高度', { exact: true }).fill('1024')
    await group('画布尺寸').getByRole('switch').check()
    await frame.getByLabel('图片宽度', { exact: true }).focus(); await frame.getByLabel('图片宽度', { exact: true }).blur()
    assert.equal(await frame.getByLabel('图片宽度', { exact: true }).inputValue(), '1040')
    assert(await frame.getByRole('button', { name: '开始生成', exact: true }).isEnabled())
  })
  await check('JPEG/WebP 压缩字段与真实 MIME 下载，PNG 不发送压缩率', async () => {
    for (const format of ['JPEG', 'WEBP', 'PNG']) {
      await click('输出设置', format)
      assert.equal(await frame.getByLabel('输出压缩率', { exact: true }).count(), format === 'PNG' ? 0 : 1)
      assert(await frame.getByLabel('透明背景', { exact: true }).isDisabled())
      await generate('V6 格式 ' + format)
      const body = (await metrics()).images.at(-1).body
      assert.equal(body.output_format, format.toLowerCase())
      assert.equal('output_compression' in body, format !== 'PNG')
      const pending = page.waitForEvent('download')
      await frame.getByRole('button', { name: '下载', exact: true }).first().click()
      const download = await pending
      assert(download.suggestedFilename().endsWith('.' + (format === 'JPEG' ? 'jpg' : format.toLowerCase())))
      await download.saveAs(path.join(out, download.suggestedFilename()))
    }
  })
  await check('参考图编辑保持 FormData、图片字段和全部参数', async () => {
    await select('#studio-model', 'gpt-image-2.5'); await click('生成质量', '超高')
    await frame.locator('input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(out, 'mock-output.png')) })
    await frame.locator('img[alt="reference.png"]').waitFor()
    await click('输出设置', 'JPEG')
    await generate('V6 参考图编辑')
    const record = (await metrics()).images.at(-1)
    assert.equal(record.path, '/v1/images/edits'); assert.equal(record.body.model, 'gpt-image-2.5')
    assert.equal(record.body.quality, 'xhigh'); assert.equal(record.body.output_format, 'jpeg')
    assert.equal(record.body.size, '1040x1024')
    assert.equal(Number(record.body.n), 1); assert.equal(Number(record.body.output_compression), 72)
    assert.equal(record.files.length, 1); assert.equal(record.files[0].field, 'image')
  })
  await check('Key 热更新保持 iframe、参数、草稿、参考图和结果，账单归属正确', async () => {
    const previous = frame
    await select('#studio-key', '图片创作 Key')
    assert.equal(frame, previous)
    assert.equal(await frame.locator('textarea').first().inputValue(), 'V6 参考图编辑')
    assert.equal(await frame.locator('img[alt="reference.png"]').count(), 1)
    await generate('V6 Key 切换编辑')
    assert.equal((await metrics()).images.at(-1).keyId, 1012)
    assert.equal((await metrics()).images.at(-1).body.output_format, 'jpeg')
  })
  await check('快捷与更多张数逐张请求，部分失败不自动重试', async () => {
    await click('生成张数', '3 张')
    const before = (await metrics()).images.length
    await generate('V6 [partial] 批量 ' + Date.now())
    assert.equal((await metrics()).images.length, before + 3)
    assert((await metrics()).images.slice(-3).every(record => Number(record.body.n) === 1))
    assert.equal(await frame.getByRole('button', { name: /重\s*试$/ }).count(), 1)
    await page.waitForTimeout(500)
    assert.equal((await metrics()).images.length, before + 3)
    await click('生成张数', '更多 · 5～10 张')
    await frame.getByLabel('生成张数', { exact: true }).fill('11')
    assert(await frame.getByRole('button', { name: '开始生成', exact: true }).isDisabled())
    await frame.getByLabel('生成张数', { exact: true }).fill('5')
    const more = (await metrics()).images.length
    await generate('V6 更多五张')
    assert.equal((await metrics()).images.length, more + 5)
    assert((await metrics()).images.slice(-5).every(record => Number(record.body.n) === 1))
    await click('生成张数', '1 张')
  })
  await check('错误响应仅发一次请求', async () => {
    const before = (await metrics()).images.length
    await generate('V6 [http:500] 不自动重试')
    await frame.getByRole('button', { name: /重\s*试$/ }).first().waitFor()
    await page.waitForTimeout(500)
    assert.equal((await metrics()).images.length, before + 1)
  })
  await check('历史恢复输出参数和图片，刷新仍保留 IndexedDB 记录', async () => {
    await page.reload(); await ready()
    const log = frame.locator('.host-generation-log').filter({ hasText: 'V6 Key 切换编辑' }).first()
    await log.click()
    assert.equal(await group('输出设置').getByRole('button', { name: 'JPEG', exact: true }).getAttribute('aria-pressed'), 'true')
    assert.equal(await frame.locator('textarea').first().inputValue(), 'V6 Key 切换编辑')
    assert.equal(await frame.getByRole('button', { name: '下载', exact: true }).count(), 1)
    assert.equal(await frame.getByLabel('图片宽度', { exact: true }).inputValue(), '1040')
  })
  await check('结果放入 Infinite Canvas，刷新恢复，Key 切换保留画布', async () => {
    await frame.getByRole('button', { name: '放入画布', exact: true }).first().click()
    await frame.getByRole('button', { name: '放入画布', exact: true }).last().click()
    await frame.waitForURL(/\/canvas\/canvas\/.+/)
    const canvasUrl = frame.url()
    await frame.locator('img').first().waitFor()
    await page.screenshot({ path: path.join(out, 'canvas-regression.png'), fullPage: true })
    await select('#studio-key', '团队通用 Key')
    assert.equal(frame.url(), canvasUrl)
    await page.reload(); await ready(); await frame.goto(canvasUrl)
    await frame.locator('img').first().waitFor()
    assert(await frame.locator('img').first().evaluate(img => img.complete && img.naturalWidth > 0))
    await frame.goto(base + '/canvas/image'); await frame.locator('textarea').first().waitFor()
  })
  await select('#studio-model', 'gpt-image-2.5')
  await click('画布尺寸', '预设'); await click('画布尺寸', '2K'); await click('画布尺寸', '16:9')
  await click('生成质量', '高'); await click('输出设置', 'PNG')
  await generate('未来城市天际线，暮色中的霓虹灯光，电影摄影，精致建筑细节，蓝绿色与深紫色层次')
  // 等成功提示完整消失后再留档，避免过渡动画或浮层遮住参数标题。
  await frame.getByText('图片已生成', { exact: true }).first().waitFor({ state: 'visible' })
  await frame.getByText('图片已生成', { exact: true }).first().waitFor({ state: 'hidden' })
  for (const [width, height] of [[1920, 1080], [1536, 864], [1366, 768], [390, 844]]) {
    await check(`独立滚动、按钮固定、无溢出 ${width}×${height}`, async () => {
      await page.setViewportSize({ width, height })
      if (width < 800) await frame.getByRole('button', { name: '创作参数', exact: true }).click()
      const scroll = frame.locator('[class*="_scroll_"]')
      await scroll.evaluate(el => { el.scrollTop = 0 })
      await page.screenshot({ path: path.join(out, `actual-${width}x${height}-top.png`), fullPage: true })
      if (width === 1536) await frame.locator('[class*="_editor_"]').first().screenshot({ path: path.join(out, 'actual-parameter-panel.png') })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      const measure = async () => frame.evaluate(() => {
        const scroll = document.querySelector('[class*="_scroll_"]'), footer = document.querySelector('[class*="_footer_"]')
        const button = [...footer.querySelectorAll('button')].find(b => b.textContent.includes('开始生成'))
        const s = scroll.getBoundingClientRect(), f = footer.getBoundingClientRect(), b = button.getBoundingClientRect()
        const editor = footer.parentElement, title = editor.querySelector('h1').getBoundingClientRect()
        return { scrollTop: scroll.scrollTop, scroll: { top: s.top, bottom: s.bottom, height: s.height }, footer: { top: f.top, bottom: f.bottom }, button: { top: b.top, bottom: b.bottom }, titleTop: title.top, viewport: innerHeight, outerScroll: editor.scrollHeight > editor.clientHeight + 1 }
      })
      const top = await measure()
      assert(top.scroll.height > 100); assert(top.titleTop >= top.scroll.top - 1)
      assert(top.scroll.bottom <= top.footer.top + 1)
      assert(top.button.top >= 0 && top.button.bottom <= top.viewport + 1)
      assert.equal(top.outerScroll, false)
      await scroll.evaluate(el => { el.scrollTop = el.scrollHeight })
      const bottom = await measure()
      assert(bottom.scrollTop > 0)
      assert(Math.abs(bottom.button.top - top.button.top) < 1)
      await page.screenshot({ path: path.join(out, `actual-${width}x${height}-bottom.png`), fullPage: true })
      await group('画布尺寸').evaluate(el => {
        const scroll = document.querySelector('[class*="_scroll_"]')
        scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12
      })
      await page.screenshot({ path: path.join(out, `actual-${width}x${height}-sizes.png`), fullPage: true })
      await scroll.evaluate(el => { el.scrollTop = 0 })
      layout.push({ width, height, top, bottom })
      if (width < 800) {
        await frame.getByRole('button', { name: /生成结果/ }).first().click()
        await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
        await page.screenshot({ path: path.join(out, `actual-${width}x${height}-results.png`), fullPage: true })
      }
    })
  }
  const proto = await context.newPage()
  await proto.setViewportSize({ width: 1536, height: 864 })
  await proto.goto(base + '/__v6_prototype')
  await proto.locator('#model').selectOption('gpt-image-2.5')
  await proto.screenshot({ path: path.join(out, 'prototype-1536x864.png'), fullPage: true })
  await proto.locator('.editor').screenshot({ path: path.join(out, 'prototype-parameter-panel.png') })
  await check('跨用户 IndexedDB 历史隔离', async () => {
    await page.setViewportSize({ width: 1536, height: 864 })
    await page.evaluate(() => { localStorage.setItem('auth_token', 'canvas-fixture-jwt-202'); localStorage.setItem('auth_user', JSON.stringify({ id: 202, email: 'canvas202@example.test', role: 'user', balance: 100 })) })
    await page.goto(base + '/ai-creation/image'); await ready()
    assert(!(await frame.locator('body').innerText()).includes('V6 Key 切换编辑'))
    assert.equal(await frame.locator('.host-generation-log').count(), 0)
  })
  assert.deepEqual(errors, [])
  const report = { passed: checks.length, checks, errors, layout, blockedExternal: blocked, metrics: await metrics(), realRequests: 0 }
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2), 'utf8')
  await browser.close()
  console.log(JSON.stringify({ passed: checks.length, errors, realRequests: 0 }))
}
main().catch(async error => {
  console.error(error.stack)
  if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  fs.writeFileSync(path.join(out, 'browser-failure.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2), 'utf8')
  if (browser) await browser.close()
  process.exitCode = 1
})
