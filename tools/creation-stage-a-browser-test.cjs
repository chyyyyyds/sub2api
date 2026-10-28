// 浏览器验证仅访问本机 Mock，所有外部网络默认拒绝，绝不触发收费接口。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18085'
const out = path.resolve(__dirname, '../.codex/creation-stage-a-evidence')
fs.mkdirSync(out, { recursive: true })
let browser

async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 } })
  await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort())
  const page = await context.newPage()
  const errors = [], checks = [], geometry = []
  page.on('pageerror', error => errors.push(error.message))
  const check = async (name, fn) => { await fn(); checks.push(name) }
  async function ready() {
    // 手机为工具栏节省空间时隐藏连接文案，仍需等待真实握手完成。
    await page.getByText('画布已连接', { exact: true }).waitFor({ state: 'attached' })
    const frame = page.frames().find(item => item.url() === base + '/canvas/image')
    assert(frame)
    await frame.locator('textarea').first().waitFor()
    return frame
  }
  await check('未登录沿用登录守卫', async () => {
    await page.goto(base + '/ai-creation/chat')
    await page.waitForURL(/\/login/)
  })
  await check('现有登录表单进入 Stage A', async () => {
    await page.evaluate(() => { localStorage.setItem('user_guide_101', 'true'); localStorage.setItem('sub2api_locale', 'zh') })
    await page.locator('#email').fill('canvas101@example.test')
    await page.locator('#password').fill('CanvasPreviewOnly123!')
    await page.locator('button[type=submit]').click()
    await page.waitForURL('**/ai-creation/chat')
    await page.locator('#studio-model').filter({ hasText: 'gpt-6' }).waitFor()
    await page.locator('.creation-tabs a[href$="/image"]').click()
    await ready()
  })
  await check('自动匹配显示实际 Key 名称且没有额外状态框', async () => {
    assert.match(await page.locator('#studio-key').innerText(), /自动匹配（.*Key）/)
    assert.equal(await page.locator('.autokey').count(), 0)
  })
  await check('图片模型由 Vue 单独选择，Canvas 保留画质比例参数', async () => {
    const frame = await ready()
    assert.equal(await frame.locator('.canvas-composer-model-picker').count(), 0)
    assert(await frame.getByText('质量', { exact: true }).count())
    assert(await frame.getByText('宽高比', { exact: true }).count())
  })
  async function select(id, label) {
    await page.locator(id).click()
    await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: label }).first().click()
  }
  await check('自动模式跨本人 Key 匹配图片模型', async () => {
    await select('#studio-model', 'flux-1')
    await ready()
    assert.match(await page.locator('#studio-key').innerText(), /自动匹配（图片创作 Key）/)
  })
  await check('手动 Key 重新获取模型并保持选择', async () => {
    await select('#studio-key', '团队通用 Key')
    await ready()
    assert.match(await page.locator('#studio-key').innerText(), /^团队通用 Key/)
    assert.match(await page.locator('#studio-model').innerText(), /gpt-image-2/)
    await page.locator('#studio-model').click()
    assert.equal(await page.locator('.canvas-studio-dropdown .select-option').count(), 1)
    await page.keyboard.press('Escape')
  })
  await check('不兼容 Key 保留手动选择且阻止画布', async () => {
    await select('#studio-key', '受限图片 Key')
    await page.getByRole('alert').filter({ hasText: '不兼容' }).waitFor()
    assert.match(await page.locator('#studio-key').innerText(), /^受限图片 Key/)
    assert.equal(await page.locator('iframe').count(), 0)
    await select('#studio-key', '自动匹配（推荐）')
    await ready()
  })
  await check('本地固定 PNG 生图并保存生成记录', async () => {
    const frame = await ready()
    await frame.locator('textarea').first().fill('Stage A 本地模拟作品，不调用上游')
    const response = page.waitForResponse(item => item.url().endsWith('/v1/images/generations'))
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    assert.equal((await response).status(), 200)
    await frame.getByText('图片已生成', { exact: false }).first().waitFor()
    assert(await frame.getByRole('button', { name: '加入我的资产', exact: true }).count())
  })
  await check('参考图编辑复用原引擎', async () => {
    const frame = await ready()
    await frame.locator('input[type=file]').first().setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2N0UAAAAASUVORK5CYII=', 'base64') })
    await frame.getByText('暂无参考图，可将图片拖到这里', { exact: true }).waitFor({ state: 'hidden' })
    const response = page.waitForResponse(item => item.url().endsWith('/v1/images/edits'))
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    assert.equal((await response).status(), 200)
  })
  await check('参数选中态可交互，完整尺寸和张数可展开', async () => {
    const frame = await ready()
    await frame.locator('[data-setting=quality] button').filter({ hasText: /^高$/ }).click()
    assert.equal(await frame.locator('[data-setting=quality] button[aria-pressed=true]').innerText(), '高')
    await frame.locator('[data-setting=ratio] button').filter({ hasText: /^16:9$/ }).click()
    assert.equal(await frame.locator('[data-setting=ratio] button[aria-pressed=true]').innerText(), '16:9')
    await frame.locator('.host-advanced-toggle').click()
    assert(await frame.locator('[data-setting=count]').isVisible())
    assert(await frame.locator('[data-setting=size]').isVisible())
    await frame.locator('.host-advanced-toggle').click()
  })
  await check('回看旧记录不会覆盖 Vue 选中的模型', async () => {
    await select('#studio-model', 'flux-1')
    const frame = await ready()
    await frame.locator('.host-image-grid>aside').getByText('Stage A 本地模拟作品，不调用上游'.slice(0, 12), { exact: true }).first().click()
    const response = page.waitForResponse(item => /\/v1\/images\/(generations|edits)$/.test(item.url()))
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    const result = await response
    const request = result.request()
    const body = request.postData()
    assert(body.includes('flux-1'))
    assert.match(await page.locator('#studio-model').innerText(), /flux-1/)
  })
  await check('聊天草稿在切换 Key 和模型后保持，发送仍关闭', async () => {
    await page.locator('.creation-tabs a[href$="/chat"]').click()
    await page.locator('.creation-composer textarea').fill('Stage B 验收前只保存页面草稿')
    await select('#studio-key', '聊天专用 Key')
    await select('#studio-model', 'claude-sonnet')
    assert.equal(await page.locator('.creation-composer textarea').inputValue(), 'Stage B 验收前只保存页面草稿')
    assert(await page.getByRole('button', { name: /待接入聊天/ }).isDisabled())
  })
  await check('视频外壳无未验证模型、无虚构任务，状态筛选可切换', async () => {
    await page.locator('.creation-tabs a[href$="/video"]').click()
    assert(await page.locator('#studio-model').isDisabled())
    assert(await page.getByRole('button', { name: /待接入视频生成/ }).isDisabled())
    await page.locator('.creation-task-controls nav button').filter({ hasText: '失败 / 已过期' }).click()
    assert.equal(await page.locator('.creation-task-controls button[aria-pressed=true]').innerText(), '失败 / 已过期')
    assert.equal(await page.locator('.uc-nav [aria-current=page]').innerText(), 'AI 创作')
  })
  const prototype = await context.newPage()
  for (const [width, height] of [[1920, 1080], [1536, 864], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await prototype.setViewportSize({ width, height })
    for (const mode of ['chat', 'image', 'video']) {
      await page.goto(base + '/ai-creation/' + mode)
      if (mode === 'image') await ready()
      else {
        await page.waitForFunction(() => { const key = document.getElementById('studio-key'); return key && !key.disabled })
        if (mode === 'chat') await page.locator('#studio-key').filter({ hasText: /自动匹配（团队通用 Key）/ }).waitFor()
      }
      await page.screenshot({ path: path.join(out, `actual-${mode}-${width}x${height}.png`) })
      await prototype.goto(base + '/__v5_prototype?tab=' + mode)
      await prototype.screenshot({ path: path.join(out, `v5-${mode}-${width}x${height}.png`) })
      const measure = await page.evaluate(() => {
        const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom } }
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, tabs: box('.creation-tabs'), toolbar: box('.creation-toolbar'), stage: box('.creation-stage'), fields: [...document.querySelectorAll('.creation-field')].map(field => { const a = field.querySelector('label').getBoundingClientRect(), b = field.querySelector('button').getBoundingClientRect(); return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 2 }), composer: document.querySelector('.creation-composer') ? box('.creation-composer') : null }
      })
      assert(measure.scrollWidth <= width + 1, `${mode} ${width} 横向溢出`)
      assert(measure.stage.bottom <= height + 1, `${mode} ${width} 工作台溢出`)
      assert(measure.fields.every(Boolean), `${mode} ${width} 标签选择框非同一行`)
      if (measure.composer) assert(measure.composer.bottom <= height && measure.composer.y > measure.toolbar.bottom, `${width} 聊天输入框不可见`)
      geometry.push({ mode, ...measure })
    }
    checks.push(`${width}×${height} 三工作台截图、标签单行、输入框及无横向溢出`)
  }
  await prototype.close()
  await check('聊天消息容器独立滚动（仅浏览器注入布局测试内容）', async () => {
    await page.goto(base + '/ai-creation/chat')
    const before = await page.locator('.creation-composer').boundingBox()
    await page.evaluate(() => {
      const messages = document.querySelector('.creation-messages')
      messages.style.display = 'block'
      messages.innerHTML = '<div style="height:3000px">布局测试内容，非聊天记录</div>'
      messages.scrollTop = 2000
    })
    assert.equal((await page.locator('.creation-composer').boundingBox()).y, before.y)
    assert(await page.locator('.creation-messages').evaluate(el => el.scrollTop > 0))
  })
  await check('浏览器持久化无明文用户 Key', async () => {
    const data = await page.evaluate(async () => {
      const values = [JSON.stringify(localStorage), JSON.stringify(sessionStorage)]
      for (const info of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open(info.name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
        for (const store of db.objectStoreNames) values.push(JSON.stringify(await new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })))
        db.close()
      }
      return values.join('\n')
    })
    assert(!data.includes('stage-a-fixture-'))
  })
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ checks, errors, geometry }, null, 2), 'utf8')
  assert.deepEqual(errors, [])
  await browser.close()
  console.log(JSON.stringify({ passed: checks.length, checks }))
}
main().catch(async error => { console.error(error.stack); if (browser) await browser.close(); process.exitCode = 1 })
