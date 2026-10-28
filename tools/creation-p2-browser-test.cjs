// 只使用本机 Mock；所有非本机网络一律拦截，禁止真实收费请求。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = 'http://127.0.0.1:18088'
const out = path.resolve(__dirname, '../.codex/creation-p2-evidence')
fs.mkdirSync(out, { recursive: true })
let browser
async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, permissions: ['clipboard-read', 'clipboard-write'] })
  await context.route('**/*', route => new URL(route.request().url()).origin === base || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort())
  const page = await context.newPage(), errors = [], checks = [], geometry = []
  page.on('pageerror', error => errors.push(error.message))
  const check = async (name, fn) => { await fn(); checks.push(name); process.stdout.write('通过：' + name + '\n') }
  const input = () => page.locator('.creation-composer textarea')
  const messages = () => page.locator('.creation-message')
  const metric = async () => (await (await page.request.get(base + '/__creation_preview')).json()).data
  const select = async (id, label) => {
    await page.locator(id).click()
    await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: label }).first().click()
  }
  const waitReady = async () => { await input().fill('配置验证'); await page.getByRole('button', { name: '发送 ↗', exact: true }).waitFor(); await page.waitForFunction(() => !document.querySelector('.creation-compose-actions>button:last-child')?.disabled); await input().fill('') }
  const send = async (question, wait = true) => {
    await input().fill(question)
    await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
    if (wait) { await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' }); await page.locator('.creation-message.is-assistant').last().waitFor() }
  }
  async function login(owner) {
    await page.goto(base + '/login')
    await page.evaluate(id => { localStorage.clear(); localStorage.setItem('sub2api_locale', 'zh'); localStorage.setItem('user_guide_' + id, 'true') }, owner)
    await page.reload()
    await page.locator('#email').fill(`canvas${owner}@example.test`)
    await page.locator('#password').fill('CanvasPreviewOnly123!')
    await page.locator('button[type=submit]').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'))
    await page.goto(base + '/ai-creation/chat'); await waitReady()
  }
  await check('现有登录守卫与登录表单', async () => {
    await page.goto(base + '/ai-creation/chat'); await page.waitForURL(/\/login/)
    await login(101)
    assert.equal(await messages().count(), 0)
  })
  await check('Enter 发送、SSE、代码高亮与复制', async () => {
    await input().fill('讲解 Java 示例'); await input().press('Enter')
    await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' })
    await page.locator('.creation-markdown .hljs-keyword').first().waitFor()
    assert.equal(await messages().count(), 2)
    await page.getByRole('button', { name: '复制代码', exact: true }).click()
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /public class Hello/)
    await page.getByRole('button', { name: '复制回答', exact: true }).click()
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /本地模拟回答/)
    assert.match(await page.locator('.creation-history-select').first().innerText(), /讲解 Java 示例/)
  })
  await check('Shift+Enter 换行、第二轮完整上下文', async () => {
    await input().fill('第二轮'); await input().press('Shift+Enter'); await input().type('继续解释')
    assert.match(await input().inputValue(), /\n/)
    await input().press('Enter'); await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' })
    const request = (await metric()).chats.at(-1)
    assert.deepEqual(request.body.messages.map(m => m.role), ['user', 'assistant', 'user'])
    assert.equal(request.body.messages[0].content, '讲解 Java 示例')
  })
  await check('手动重命名、刷新恢复历史与上下文', async () => {
    await page.getByRole('button', { name: '重命名会话', exact: true }).click()
    await page.locator('#chat-title').fill('P2 本地验收')
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await page.locator('.creation-dialog-backdrop').waitFor({ state: 'hidden' })
    await page.reload(); await waitReady()
    assert.equal(await messages().count(), 4)
    assert.match(await page.locator('.creation-history-select').first().innerText(), /P2 本地验收/)
    await send('刷新后继续')
    assert.equal((await metric()).chats.at(-1).body.messages.length, 5)
  })
  await check('生成中换模型和 Key 固定当前请求，下一轮改用 Messages', async () => {
    await send('[slow] 固定请求配置', false)
    await page.locator('.creation-message.is-assistant').last().getByText(/已收到/).waitFor()
    const previous = (await metric()).chats.at(-1)
    await select('#studio-key', '聊天专用 Key'); await select('#studio-model', 'claude-sonnet')
    await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' })
    assert.equal(previous.body.model, 'gpt-6'); assert.equal(previous.keyId, 1011)
    assert.match(await page.locator('.creation-message-meta').last().innerText(), /gpt-6[\s\S]*1011/)
    await send('换模型后继续')
    const next = (await metric()).chats.at(-1)
    assert.equal(next.path, '/v1/messages'); assert.equal(next.body.model, 'claude-sonnet'); assert.equal(next.keyId, 1013)
    assert.equal(await messages().count(), 10)
  })
  await check('停止保留部分内容，重新生成不会重复用户消息', async () => {
    await send('[slow] 停止和重生成', false)
    await page.locator('.creation-message.is-assistant').last().getByText(/已收到/).waitFor()
    await page.getByRole('button', { name: '■ 停止生成' }).click()
    assert.match(await page.locator('.creation-message-error').last().innerText(), /已中断.*已停止/)
    const count = await messages().count()
    await page.getByRole('button', { name: '↻ 重新生成', exact: true }).click()
    await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' })
    assert.equal(await messages().count(), count)
    assert.equal((await metric()).chats.at(-1).body.messages.filter(m => m.content === '[slow] 停止和重生成').length, 1)
  })
  await check('Responses 完整 input、不使用 previous_response_id', async () => {
    await select('#studio-model', 'gpt-5-codex'); await waitReady(); await send('使用 Responses 继续')
    const last = (await metric()).chats.at(-1)
    assert.equal(last.path, '/v1/responses'); assert(last.body.input.length > 1); assert(!('previous_response_id' in last.body))
  })
  await check('新建和切换会话中止旧请求，迟到结果不污染', async () => {
    await send('[slow] 旧会话中断', false)
    await page.locator('.creation-message.is-assistant').last().getByText(/已收到/).waitFor()
    await page.locator('.creation-pane-title button').click()
    assert.equal(await messages().count(), 0)
    await page.waitForTimeout(400)
    assert.equal(await messages().count(), 0)
    await page.locator('.creation-history-select').filter({ hasText: 'P2 本地验收' }).click()
    assert.match(await page.locator('.creation-message-error').last().innerText(), /已中断/)
    await page.locator('.creation-pane-title button').click()
  })
  await check('发送中 Enter 防止重复提交', async () => {
    const before = (await metric()).chats.length
    await send('[slow] 防重复发送', false)
    await input().fill('不应提交'); await input().press('Enter'); await input().press('Enter')
    assert.equal((await metric()).chats.length, before + 1)
    await page.getByRole('button', { name: '■ 停止生成' }).click()
    await input().fill('')
  })
  await check('HTTP 401/403/429、余额不足和模型不可用', async () => {
    for (const [status, text] of [[401, 'Key 无效'], [403, '没有访问权限'], [429, '请求过于频繁'], [402, '余额或 Key 额度不足'], [404, '模型或接口不可用']]) {
      await send(`[http:${status}]`)
      assert.match(await page.locator('.creation-message-error').last().innerText(), new RegExp(text))
    }
  })
  await check('流式 EOF 和 SSE error 都标为中断', async () => {
    await send('[disconnect] 流式中断')
    assert.match(await page.locator('.creation-message-error').last().innerText(), /已中断.*提前结束/)
    await send('[stream-error] 流式错误')
    assert.match(await page.locator('.creation-message-error').last().innerText(), /已中断.*请求过于频繁/)
  })
  await check('网络失败与恢复不丢历史', async () => {
    await context.route('**/v1/responses', route => route.abort('internetdisconnected'))
    await send('模拟断网')
    assert.match(await page.locator('.creation-message-error').last().innerText(), /网络连接异常/)
    await context.unroute('**/v1/responses')
    await send('网络恢复')
    assert.match(await page.locator('.creation-message.is-assistant').last().innerText(), /网络恢复/)
  })
  await check('恶意 HTML/XSS、外部图片与危险链接均被阻止', async () => {
    await send('[xss]')
    const last = page.locator('.creation-markdown').last()
    assert.equal(await last.locator('script,img,svg,iframe,[onerror]').count(), 0)
    assert.equal(await last.locator('a[href^="javascript:"]').count(), 0)
    assert.equal(await page.evaluate(() => window.__chatXss), undefined)
  })
  await check('模型列表失败时禁止发送，重新获取可以恢复', async () => {
    await context.route('**/v1/models', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"mock catalog failure"}}' }))
    await page.reload(); await input().fill('目录失败')
    await page.getByRole('alert').filter({ hasText: /匹配|兼容/ }).waitFor()
    assert(await page.getByRole('button', { name: '发送 ↗', exact: true }).isDisabled())
    await context.unroute('**/v1/models')
    await page.getByRole('button', { name: '重新获取', exact: true }).click(); await waitReady()
  })
  await check('快速切换 Key 迟到目录不能覆盖最后选择', async () => {
    await context.route('**/v1/models', async route => { if (route.request().headers().authorization.endsWith('-1')) await new Promise(resolve => setTimeout(resolve, 350)); await route.continue().catch(() => {}) })
    await select('#studio-key', '团队通用 Key')
    await select('#studio-key', '聊天专用 Key')
    await waitReady(); await page.waitForTimeout(500)
    assert.match(await page.locator('#studio-key').innerText(), /^聊天专用 Key/)
    await send('快速切换后的请求')
    assert.equal((await metric()).chats.at(-1).keyId, 1013)
    await context.unroute('**/v1/models')
  })
  await check('未知 Claude 别名明确兼容性提示且只请求 Chat Completions', async () => {
    await select('#studio-model', 'private-claude-alias'); await waitReady()
    await page.locator('.creation-protocol-notice').filter({ hasText: '尚未配置协议能力' }).waitFor()
    const count = (await metric()).chats.length
    await send('未知别名兼容入口')
    assert.equal((await metric()).chats.length, count + 1)
    assert.equal((await metric()).chats.at(-1).path, '/v1/chat/completions')
  })
  await check('三协议推理状态与工具受限保留部分文本', async () => {
    for (const model of ['gpt-6', 'claude-sonnet', 'gpt-5-codex']) {
      await select('#studio-model', model); await waitReady()
      await input().fill('[reasoning] 先推理再正文'); await input().press('Enter')
      await page.locator('.creation-stream-status').filter({ hasText: '模型正在推理' }).waitFor()
      if (model === 'gpt-5-codex') await page.screenshot({ path: path.join(out, 'reasoning-desktop.png'), fullPage: true })
      await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden' })
      assert.equal(await page.locator('.creation-message.is-assistant').last().locator('.creation-message-error').count(), 0)
      await send('[tool] 受限输出')
      assert.match(await page.locator('.creation-message-error').last().innerText(), /工具调用.*非文本/)
    }
  })
  await check('按用户 ID 隔离、同浏览器换号看不到其他用户历史', async () => {
    await login(202)
    assert.equal(await messages().count(), 0); assert.equal(await page.locator('.creation-history-row').count(), 0)
    await send('仅属于用户202的消息')
    await login(101)
    assert.equal(await page.getByText('仅属于用户202的消息', { exact: true }).count(), 0)
    assert(await page.locator('.creation-history-row').count() > 0)
  })
  await check('IndexedDB 与 localStorage 没有明文 API Key', async () => {
    const data = await page.evaluate(async () => {
      const values = []
      for (const info of await indexedDB.databases()) {
        if (!info.name?.startsWith('sub2api-creation-chat-')) continue
        const db = await new Promise((resolve, reject) => { const r = indexedDB.open(info.name); r.onsuccess = () => resolve(r.result); r.onerror = reject })
        values.push(await new Promise((resolve, reject) => { const r = db.transaction('conversations').objectStore('conversations').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = reject })); db.close()
      }
      return JSON.stringify({ values, storage: { ...localStorage } })
    })
    assert(!data.includes('stage-a-fixture-'))
    assert(!data.includes('apiKey'))
  })
  await check('删除会话持久化生效', async () => {
    await page.locator('.creation-pane-title button').click(); await send('即将删除的会话')
    const row = page.locator('.creation-history-row').filter({ hasText: '即将删除的会话' })
    await row.getByRole('button', { name: '删除会话', exact: true }).click()
    await page.getByRole('button', { name: '确定', exact: true }).click()
    await page.waitForTimeout(150); await page.reload(); await waitReady()
    assert.equal(await page.locator('.creation-history-row').filter({ hasText: '即将删除的会话' }).count(), 0)
  })
  await check('图片、视频入口与原工作台保持可用', async () => {
    await page.locator('.creation-tabs a[href$="/image"]').click()
    await page.getByText('画布已连接', { exact: true }).waitFor({ state: 'attached' })
    const frame = page.frames().find(f => f.url() === base + '/canvas/image'); assert(frame)
    await frame.locator('textarea').first().fill('P2 图片回归 Mock')
    await frame.getByRole('button', { name: '开始生成', exact: true }).click()
    await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor()
    await page.goto(base + '/ai-creation/video')
    assert(await page.getByRole('button', { name: /待接入视频生成/ }).isDisabled())
    await page.goto(base + '/ai-creation/chat'); await waitReady()
  })
  await check('跨标签换号立即锁定并清空当前历史视图', async () => {
    await page.getByRole('button', { name: '重命名会话', exact: true }).first().click()
    await page.locator('#chat-title').waitFor()
    const other = await context.newPage(); await other.goto(base + '/ai-creation/chat')
    await other.evaluate(() => { localStorage.setItem('auth_user', JSON.stringify({ id: 202 })); localStorage.setItem('auth_token', 'canvas-fixture-jwt-202') })
    await page.getByRole('alert').filter({ hasText: '登录账户已变化' }).waitFor()
    assert.equal(await messages().count(), 0)
    assert.equal(await page.locator('.creation-dialog-backdrop').count(), 0)
    await other.close(); await login(101)
  })
  const prototype = await context.newPage()
  await check('四种尺寸 V5 对照、独立消息滚动与输入框可见', async () => {
    await page.locator('.creation-pane-title button').click()
    await send('帮我写一段 Java Hello World，并解释实现')
    for (const [width, height] of [[1920, 1080], [1536, 864], [1366, 768], [390, 844]]) {
      await page.setViewportSize({ width, height }); await prototype.setViewportSize({ width, height })
      await page.screenshot({ path: path.join(out, `actual-chat-${width}x${height}.png`), fullPage: true })
      await prototype.goto(base + '/__v5_prototype?tab=chat')
      await prototype.screenshot({ path: path.join(out, `v5-chat-${width}x${height}.png`), fullPage: true })
      const box = await input().boundingBox(); assert(box && box.y >= 0 && box.y + box.height <= height)
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollHeight <= innerHeight + 2, horizontal: document.documentElement.scrollWidth <= innerWidth + 2, messages: getComputedStyle(document.querySelector('.creation-messages')).overflowY }))
      assert(overflow.page); assert(overflow.horizontal); assert.equal(overflow.messages, 'auto')
      geometry.push({ width, height, input: box, ...overflow })
      if (width < 800) { await page.getByRole('button', { name: '☰ 历史会话' }).click(); assert(await page.locator('.creation-history.is-open').isVisible()); await page.locator('.creation-mobile-close').click() }
    }
  })
  await check('手机 VisualViewport 键盘遮挡模拟，输入框仍可见', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 544 })
      window.visualViewport.dispatchEvent(new Event('resize'))
    })
    await input().focus(); await page.waitForTimeout(100)
    const box = await input().boundingBox()
    assert(box && box.y + box.height <= 544, JSON.stringify(box))
    await page.screenshot({ path: path.join(out, 'keyboard-mobile.png'), fullPage: true })
    await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')) })
  })
  await check('慢首字提示与网络空闲超时使用浏览器时钟快进，不等待数分钟', async () => {
    await page.setViewportSize({ width: 1536, height: 864 })
    await page.clock.install()
    await send('[idle] 慢首字与网络空闲', false)
    await page.locator('.creation-stream-status').filter({ hasText: '正在等待模型响应' }).waitFor()
    await page.clock.fastForward(16000)
    await page.locator('.creation-stream-status').filter({ hasText: '首字较慢' }).waitFor()
    await page.screenshot({ path: path.join(out, 'slow-first-text.png'), fullPage: true })
    await page.clock.fastForward(120001)
    await page.locator('.creation-message-error').last().filter({ hasText: '网络长时间没有任何数据' }).waitFor()
    await page.screenshot({ path: path.join(out, 'network-idle-timeout.png'), fullPage: true })
  })
  assert.deepEqual(errors, [])
  const metrics = await metric()
  const result = { checks, geometry, runtimeErrors: errors, mockRequests: metrics.chats.length, imageGenerations: metrics.generations, mode: 'mock-only; all external browser requests blocked' }
  fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n', 'utf8')
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  await browser.close()
}
main().catch(async error => { process.stderr.write(String(error.stack || error)); if (browser) await browser.close(); process.exitCode = 1 })
