// 只允许本机 Mock；测试 Key 无法用于任何真实生成，外部网络全部阻断。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18087'
const out = path.resolve(__dirname, '../.codex/creation-p1-evidence')
fs.mkdirSync(out, { recursive: true })
let browser, page, frame
const checks = [], errors = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII=', 'base64')
async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true })
  await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort())
  await context.addInitScript(() => {
    // 故障注入仅存在于独立自动化浏览器，不改变产品超时和存储策略。
    const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'timeout')
    Object.defineProperty(XMLHttpRequest.prototype, 'timeout', { get: descriptor.get, set(value) { descriptor.set.call(this, globalThis.__p1Timeout && value === 600000 ? 30 : value) } })
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { if (globalThis.__p1Quota) throw new DOMException('mock quota', 'QuotaExceededError'); return put.apply(this, args) }
  })
  page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  async function check(name, work) { await work(); checks.push(name); console.log('PASS ' + name) }
  async function ready() {
    await page.getByText('画布已连接', { exact: true }).waitFor({ state: 'attached' })
    frame = page.frames().find(f => f.url().startsWith(base + '/canvas/'))
    assert(frame)
    return frame
  }
  async function login(owner) {
    await page.evaluate(owner => {
      localStorage.setItem('auth_token', `canvas-fixture-jwt-${owner}`)
      localStorage.setItem('auth_user', JSON.stringify({ id: owner, email: `canvas${owner}@example.test`, role: 'user', balance: 100 }))
      localStorage.setItem(`user_guide_${owner}`, 'true'); localStorage.setItem('sub2api_locale', 'zh')
    }, owner)
    await page.goto(base + '/ai-creation/image'); await ready(); await frame.locator('textarea').first().waitFor()
  }
  async function select(id, label) {
    await page.locator(id).click()
    await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: label }).first().click()
    await ready()
  }
  const metrics = async () => (await (await context.request.get(base + '/__creation_preview')).json()).data
  async function generate(prompt, wait = true) {
    await frame.locator('textarea').first().fill(prompt)
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    if (wait) await frame.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('开始生成') && !button.disabled))
  }
  await page.goto(base + '/ai-creation/image')
  await page.waitForURL(/\/login/)
  await login(101)
  await check('保留 HUD、单一模型选择器、默认隐藏视频入口', async () => {
    assert.equal(await page.locator('.user-console').count(), 1)
    assert.equal(await page.locator('.creation-tabs a[href$="/video"]').count(), 0)
    assert.equal(await frame.locator('.canvas-composer-model-picker').count(), 0)
  })
  await check('真实图片请求形状经同源网关，生成与下载成功', async () => {
    await generate('P1 用户101 文生图')
    await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
    await frame.waitForFunction(() => [...document.querySelectorAll('.ant-image-img')].some(image => image.complete && image.naturalWidth === 640 && image.getBoundingClientRect().width > 100))
    const record = (await metrics()).images.at(-1)
    assert.equal(record.keyId, 1011); assert.equal(record.body.model, 'gpt-image-2')
    assert.deepEqual(Object.keys(record.body).sort(), ['model', 'n', 'prompt'])
    const download = page.waitForEvent('download')
    await frame.getByRole('button', { name: '下载', exact: true }).first().click()
    const file = await download; await file.saveAs(path.join(out, 'mock-output.png'))
    assert(fs.statSync(path.join(out, 'mock-output.png')).size > 0)
  })
  await check('切换模型 / Key 热更新保留草稿、结果和 iframe', async () => {
    const previous = frame
    await frame.locator('textarea').first().fill('切换后仍然保留的草稿')
    await select('#studio-model', 'gpt-image-1.5')
    assert.equal(frame, previous)
    assert.equal(await frame.locator('textarea').first().inputValue(), '切换后仍然保留的草稿')
    assert(await frame.getByRole('button', { name: '下载', exact: true }).count())
    assert.match(await page.locator('#studio-key').innerText(), /图片创作 Key/)
    await select('#studio-key', '图片创作 Key')
    assert.equal(frame, previous)
  })
  await check('旧模型尺寸、透明背景、质量、参考图编辑正确提交', async () => {
    await frame.getByLabel('尺寸 / 宽高比', { exact: true }).selectOption('1536x1024')
    await frame.getByLabel('质量', { exact: true }).selectOption('high')
    await frame.getByLabel('透明背景', { exact: true }).check()
    await frame.locator('input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
    await frame.locator('img[alt="reference.png"]').waitFor()
    await generate('P1 参考图编辑')
    await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
    const record = (await metrics()).images.at(-1)
    assert.equal(record.path, '/v1/images/edits'); assert.equal(record.keyId, 1012)
    assert.equal(record.body.background, 'transparent'); assert.equal(record.body.output_format, 'png')
    assert.equal(record.body.size, '1536x1024'); assert.equal(record.body.quality, 'high')
    assert.equal(record.files.length, 1); assert.equal(record.files[0].size, png.length)
  })
  await check('新版不发送透明背景，非法尺寸和未知别名不触发请求', async () => {
    await select('#studio-model', 'gpt-image-2')
    assert(await frame.getByLabel('透明背景', { exact: true }).isDisabled())
    await frame.getByLabel('自定义像素', { exact: true }).fill('4096x4096')
    let count = (await metrics()).images.length
    await generate('不应提交的无效尺寸')
    await frame.getByText('当前模型不支持此尺寸', { exact: false }).waitFor()
    assert.equal((await metrics()).images.length, count)
    await select('#studio-model', 'custom-image-alias')
    await generate('不应提交的未知能力')
    await frame.getByText('图片能力未验证', { exact: false }).first().waitFor()
    assert.equal((await metrics()).images.length, count)
    await select('#studio-model', 'gpt-image-2')
    await frame.getByLabel('自定义像素', { exact: true }).fill('1024x1024')
  })
  await check('生成日志刷新恢复且准确记录 Key ID，不持久化明文 Key', async () => {
    await page.reload(); await ready(); await frame.locator('textarea').first().waitFor()
    await frame.getByText('P1 参考图编辑', { exact: true }).first().waitFor()
    const values = await page.evaluate(async () => {
      const result = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open(info.name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
        for (const name of db.objectStoreNames) result.push(JSON.stringify(await new Promise(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) })))
        db.close()
      }
      return result.join('\n')
    })
    assert(!values.includes('stage-a-fixture-'))
    assert(values.includes('"keyId":1012'))
  })
  await check('多张生成逐张请求，部分失败明确展示且记录 partial', async () => {
    await frame.getByLabel('生成张数', { exact: true }).fill('3')
    const before = (await metrics()).images.length
    await generate('P1 [partial] 批量生成 ' + Date.now())
    assert.equal((await metrics()).images.length, before + 3)
    assert((await metrics()).images.slice(-3).every(item => item.body.n === 1))
    assert.equal(await frame.getByRole('button', { name: '下载', exact: true }).count(), 2)
    assert.equal(await frame.getByRole('button', { name: /重\s*试$/ }).count(), 1)
    await frame.getByLabel('生成张数', { exact: true }).fill('1')
  })
  for (const marker of ['[http:401]', '[http:402]', '[http:403]', '[http:429]', '[http:500]', '[empty]', '[error200]', '[invalid-image]', '[drop]']) {
    await check('失败不伪装成功并脱敏 ' + marker, async () => {
      await generate('P1 异常 ' + marker)
      await frame.getByRole('button', { name: /重\s*试$/ }).first().waitFor()
      assert.equal(await frame.getByRole('button', { name: '下载', exact: true }).count(), 0)
      assert(!(await frame.locator('body').innerText()).includes('secret-upstream'))
    })
  }
  await check('请求超时有明确提示，不自动重试', async () => {
    const before = (await metrics()).images.length
    await frame.evaluate(() => { globalThis.__p1Timeout = true })
    await generate('P1 [slow] 超时')
    await frame.getByText('图片请求超时', { exact: false }).first().waitFor()
    assert.equal((await metrics()).images.length, before + 1)
    await frame.evaluate(() => { globalThis.__p1Timeout = false })
  })
  await check('生成进行中切换 Key，旧响应不污染新结果', async () => {
    const request = page.waitForRequest(r => r.url().endsWith('/v1/images/generations'))
    await generate('P1 [slow] 切换凭证取消', false)
    await request
    await select('#studio-key', '图片创作 Key')
    await frame.getByText('生成已取消或配置已切换', { exact: false }).first().waitFor()
    assert.equal(await frame.getByRole('button', { name: '下载', exact: true }).count(), 0)
  })
  await check('额度不足时保留已生成图片，持续提示存储异常', async () => {
    await frame.evaluate(() => { globalThis.__p1Quota = true })
    await generate('P1 存储写满')
    await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
    await frame.getByRole('alert').filter({ hasText: '作品可能尚未保存' }).waitFor()
    await frame.evaluate(() => { globalThis.__p1Quota = false })
    await page.screenshot({ path: path.join(out, 'storage-warning.png'), fullPage: true })
    await page.reload(); await ready(); await frame.locator('textarea').first().waitFor()
  })
  await check('生成图片放入画布，刷新恢复并保留项目节点', async () => {
    await generate('P1 放入画布')
    await frame.getByRole('button', { name: '放入画布', exact: true }).first().click()
    await frame.getByRole('button', { name: '放入画布', exact: true }).last().click()
    await frame.waitForURL(/\/canvas\/canvas\/.+/)
    await frame.locator('svg').first().waitFor()
    await page.screenshot({ path: path.join(out, 'canvas-project.png'), fullPage: true })
    const url = frame.url()
    await page.reload(); await ready()
    // 主页面刷新默认进入图片页，从项目列表重新打开原项目验证持久化。
    await frame.goto(url); await frame.locator('svg').first().waitFor()
    await frame.locator('img').first().waitFor()
    const previous = frame
    await select('#studio-model', 'gpt-image-1.5')
    assert.equal(frame, previous); assert.equal(frame.url(), url)
    assert(await frame.locator('img').count())
    await frame.goto(base + '/canvas/image'); await frame.locator('textarea').first().waitFor()
    await generate('P1 第二张追加')
    await frame.getByRole('button', { name: '放入画布', exact: true }).first().click()
    await frame.getByRole('button', { name: '放入画布', exact: true }).last().click()
    await frame.waitForURL(url)
    await frame.waitForFunction(() => document.querySelectorAll('img').length >= 2)
    await frame.goto(base + '/canvas/image'); await frame.locator('textarea').first().waitFor()
    await frame.locator('.host-generation-log').filter({ hasText: 'P1 第二张追加' }).first().locator('input[type=checkbox]').check()
    await frame.getByRole('button', { name: /删\s*除$/ }).first().click()
    await frame.getByRole('button', { name: /删\s*除$/ }).last().click()
    await frame.locator('.host-generation-log').filter({ hasText: 'P1 第二张追加' }).waitFor({ state: 'hidden' })
    await frame.goto(url)
    await frame.waitForFunction(() => document.querySelectorAll('img').length >= 2)
    assert(await frame.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)))
  })
  await frame.goto(base + '/canvas/image'); await frame.locator('textarea').first().waitFor()
  await generate('P1 截图用 Mock 图片')
  for (const [width, height] of [[1536, 864], [390, 844], [844, 390]]) {
    await check(`布局与截图 ${width}x${height}`, async () => {
      await page.setViewportSize({ width, height })
      await page.screenshot({ path: path.join(out, `image-${width}x${height}.png`), fullPage: true })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    })
  }
  await check('用户隔离及换号销毁旧窗口', async () => {
    await page.setViewportSize({ width: 1536, height: 864 })
    await login(202)
    assert(!(await frame.locator('body').innerText()).includes('P1 用户101'))
    assert(!(await frame.locator('body').innerText()).includes('P1 参考图编辑'))
    const other = await context.newPage(); await other.goto(base + '/canvas/image')
    await other.evaluate(() => localStorage.removeItem('auth_token'))
    await page.getByRole('alert').filter({ hasText: '登录账户已变化' }).waitFor()
    assert.equal(await page.locator('iframe').count(), 0)
    await other.close()
  })
  await check('IndexedDB 读取不可用时提示且禁止静默覆盖', async () => {
    await login(101)
    await context.addInitScript(() => { if (location.pathname.startsWith('/canvas/')) indexedDB.open = () => { throw new DOMException('mock unavailable', 'SecurityError') } })
    await page.reload(); await ready()
    await frame.getByRole('alert').filter({ hasText: '阻止覆盖历史' }).waitFor()
    await page.screenshot({ path: path.join(out, 'storage-unavailable.png'), fullPage: true })
  })
  const result = { passed: checks.length, checks, errors, metrics: await metrics(), realRequests: 0 }
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2))
  assert.deepEqual(errors, [])
  await browser.close()
  console.log(JSON.stringify({ passed: checks.length, errors }))
}
main().catch(async error => {
  console.error(error.stack)
  if (page) await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  fs.writeFileSync(path.join(out, 'browser-failure.json'), JSON.stringify({ checks, errors, error: error.stack }, null, 2))
  if (browser) await browser.close()
  process.exitCode = 1
})
