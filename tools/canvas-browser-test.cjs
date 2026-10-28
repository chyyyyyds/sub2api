// 仅连接本机 mock 服务；外部请求全部拒绝，防止测试触发收费供应商。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18084'
const out = path.resolve(__dirname, '../.codex/canvas-phase1-evidence')
fs.mkdirSync(out, { recursive: true })

let browser
async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const checks = []
  const check = (name, fn) => Promise.resolve().then(fn).then(() => checks.push(name))
  await check('未登录路由进入登录页', async () => {
    await page.goto(base + '/ai-creation/image')
    await page.waitForURL(/\/login/)
  })
  await check('通过现有登录表单进入图片创作', async () => {
    await page.evaluate(() => { localStorage.setItem('user_guide_101', 'true'); localStorage.setItem('sub2api_locale', 'zh') })
    await page.locator('#email').fill('canvas101@example.test')
    await page.locator('#password').fill('CanvasPreviewOnly123!')
    await page.locator('button[type=submit]').click()
    await page.waitForURL('**/ai-creation/image')
    await page.getByText('画布已连接', { exact: true }).waitFor()
  })
  async function login(id) {
    await page.evaluate(id => {
      localStorage.setItem('auth_token', `canvas-fixture-jwt-${id}`)
      localStorage.setItem('auth_user', JSON.stringify({ id, email: `canvas${id}@example.test`, username: `本地验收用户${id}`, role: 'user', status: 'active', balance: 100, frozen_balance: 0 }))
      localStorage.setItem(`user_guide_${id}`, 'true')
      localStorage.setItem('sub2api_locale', 'zh')
    }, id)
    await page.goto(base + '/ai-creation/image')
    await page.getByText('画布已连接', { exact: true }).waitFor()
    const frame = page.frames().find(frame => frame.url() === base + '/canvas/image')
    assert(frame)
    await frame.locator('textarea').first().waitFor()
    return frame
  }
  let frame = await login(101)
  await check('握手后图片页面可用且保留HUD', async () => {
    assert.equal(await page.locator('.user-console').count(), 1)
    assert.equal(await page.locator('.uc-nav [aria-current=page]').innerText(), 'AI 创作')
    assert.equal(await frame.getByText('视频创作', { exact: true }).count(), 0)
  })
  await check('切换模型重新创建桥接会话', async () => {
    await page.locator('#studio-model').click()
    await page.locator('.canvas-studio-dropdown').getByText('gpt-image-2', { exact: true }).click()
    await page.getByText('画布已连接', { exact: true }).waitFor()
    frame = page.frames().find(frame => frame.url() === base + '/canvas/image')
    await frame.locator('textarea').first().waitFor()
  })
  await page.screenshot({ path: path.join(out, 'image-studio.png'), fullPage: true })
  await check('模拟图片生成', async () => {
    await frame.locator('textarea').first().fill('用户101的隔离图片')
    const response = page.waitForResponse(response => response.url().endsWith('/v1/images/generations'))
    await frame.getByRole('button', { name: /开始生成|生成图片|生成$/ }).last().click()
    assert.equal((await response).status(), 200)
    await frame.getByText('图片已生成', { exact: false }).first().waitFor({ timeout: 15000 })
  })
  await check('模拟参考图编辑', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII=', 'base64')
    await frame.locator('input[type=file]').first().setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png })
    await frame.getByText('暂无参考图，可将图片拖到这里', { exact: true }).waitFor({ state: 'hidden' })
    const response = page.waitForResponse(response => response.url().endsWith('/v1/images/edits'))
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    assert.equal((await response).status(), 200)
  })
  await check('图片保存为本地素材', async () => {
    await frame.getByRole('button', { name: '加入我的资产', exact: true }).first().click()
    await frame.getByText('已加入我的资产', { exact: true }).waitFor()
  })
  await check('刷新后重新握手', async () => {
    await page.reload()
    await page.getByText('画布已连接', { exact: true }).waitFor()
    frame = page.frames().find(frame => frame.url() === base + '/canvas/image')
    await frame.locator('textarea').first().waitFor()
  })
  await check('凭证不进入浏览器持久化', async () => {
    const values = await page.evaluate(async () => {
      const results = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(info.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
        for (const store of db.objectStoreNames) {
          const all = await new Promise((resolve, reject) => { const request = db.transaction(store).objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
          results.push(JSON.stringify(all))
        }
        db.close()
      }
      return results.join('\n')
    })
    assert(!values.includes('canvas-fixture-key-'))
  })
  await check('本地项目保存及iframe独立刷新', async () => {
    await frame.goto(base + '/canvas/canvas')
    await frame.getByRole('button', { name: '新建画布', exact: true }).first().waitFor()
    await frame.getByRole('button', { name: '新建画布', exact: true }).first().click()
    await frame.waitForURL(/\/canvas\/canvas\/.+/)
    await frame.goto(frame.url())
    await frame.locator('svg').first().waitFor()
  })
  await check('直接访问不加载业务存储', async () => {
    const direct = await context.newPage()
    await direct.goto(base + '/canvas/image')
    await direct.getByText('请从 Sub2API', { exact: false }).waitFor()
    assert.equal(await direct.locator('textarea').count(), 0)
    await direct.close()
  })
  await check('换用户创建独立数据库', async () => {
    frame = await login(202)
    assert(!(await frame.locator('body').innerText()).includes('用户101的隔离图片'))
    const names = await page.evaluate(async () => (await indexedDB.databases()).map(info => info.name))
    assert(names.some(name => name.includes('sub2api-user-101')))
    assert(names.some(name => name.includes('sub2api-user-202')))
    const hasForeignData = await page.evaluate(async () => {
      for (const info of await indexedDB.databases()) {
        if (!info.name.includes('sub2api-user-202')) continue
        const db = await new Promise(resolve => { const r = indexedDB.open(info.name); r.onsuccess = () => resolve(r.result) })
        for (const name of db.objectStoreNames) {
          const values = await new Promise(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) })
          if (JSON.stringify(values).includes('用户101的隔离图片')) return true
          if (['image_files', 'image_previews', 'media_files', 'image_generation_logs'].includes(name) && values.length) return true
          for (const value of values) {
            let stored = value
            try { if (typeof value === 'string') stored = JSON.parse(value) } catch { /* 非 JSON 媒体不按业务列表解析。 */ }
            if (stored?.state?.assets?.length || stored?.state?.projects?.length) return true
          }
        }
        db.close()
      }
      return false
    })
    assert(!hasForeignData)
  })
  await check('生成响应迟到不写入新账户', async () => {
    let release
    const pending = new Promise(resolve => { release = resolve })
    const intercept = async route => {
      await pending
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }) } catch { /* 已销毁 iframe 的请求允许被浏览器取消。 */ }
    }
    await context.route('**/v1/images/generations', intercept)
    await frame.locator('textarea').first().fill('用户202迟到响应')
    const submitted = page.waitForRequest(request => request.url().endsWith('/v1/images/generations'))
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    await submitted
    const other = await context.newPage(); await other.goto(base + '/canvas/image')
    await other.evaluate(() => {
      localStorage.setItem('auth_user', JSON.stringify({ id: 101, role: 'user' }))
      localStorage.setItem('auth_token', 'canvas-fixture-jwt-101')
    })
    await page.getByRole('alert').filter({ hasText: '登录账户已变化' }).waitFor()
    release()
    await context.unroute('**/v1/images/generations', intercept)
    await other.close()
    frame = await login(101)
    assert(!(await frame.locator('body').innerText()).includes('用户202迟到响应'))
  })
  await check('手机布局没有页面级横向溢出', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(out, 'image-studio-mobile.png'), fullPage: true })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
  await check('另一标签退出使旧iframe失效', async () => {
    const other = await context.newPage(); await other.goto(base + '/canvas/image')
    await other.evaluate(() => localStorage.removeItem('auth_token'))
    await page.getByRole('alert').filter({ hasText: '登录账户已变化' }).waitFor()
    assert.equal(await page.locator('iframe').count(), 0)
    await other.close()
  })
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ checks, errors }, null, 2))
  await browser.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: checks.length, checks }))
}
main().catch(async error => { console.error(error.message); if (browser) await browser.close(); process.exitCode = 1 })
