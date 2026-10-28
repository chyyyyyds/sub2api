// 独立真实浏览器验收；每条收费命令均由操作者对账后单独触发，禁止重试。
const { chromium } = require(process.env.CANVAS_PLAYWRIGHT || 'C:/Users/chyyds/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const readline = require('node:readline')
const assert = require('node:assert/strict')
const base = process.env.CREATION_E2E_BASE || 'http://127.0.0.1:18095'
const out = path.resolve(__dirname, '../.codex/creation-production-evidence')
const run = process.env.CREATION_E2E_RUN || 'initial'
const checks = [], errors = [], resourceErrors = [], parameterChecks = []
let browser, context, page, frame, projectUrl, outputLimit = 256
const save = () => fs.writeFileSync(path.join(out, run === 'initial' ? 'real-browser.json' : `real-browser-${run}.json`), JSON.stringify({ base, checks, errors, resourceErrors, parameterChecks }, null, 2), 'utf8')
const grant = (label, endpoint, model, estimatedUSD) => fs.writeFileSync(path.join(out, 'request-permit.json'), JSON.stringify({ allowed: true, label, path: endpoint, model, estimatedUSD, expiresAt: Date.now() + 60000 }), 'utf8')
async function select(id, label) {
  await page.locator(id).click()
  await page.locator('.canvas-studio-dropdown .select-option').filter({ hasText: label }).first().click()
}
async function readyChat() {
  await page.locator('.creation-composer textarea').waitFor()
  await page.waitForFunction(() => !document.querySelector('#studio-model')?.disabled && !document.querySelector('#studio-key')?.disabled)
}
async function readyImage() {
  await page.getByText('画布已连接', { exact: true }).waitFor({ state: 'attached' })
  frame = page.frames().find(f => f.url().startsWith(base + '/canvas/'))
  assert(frame)
  await frame.locator('textarea').first().waitFor()
}
async function chat(label, question, model = 'gpt-6-sol', stop = false, regenerate = false) {
  await select('#studio-model', model); await readyChat()
  const endpoint = model === 'gpt-6.1-sol' ? '/v1/responses' : '/v1/chat/completions'
  const countBefore = await page.locator('.creation-message').count()
  outputLimit = regenerate ? 2048 : 256
  grant(label, endpoint, model, regenerate ? 0.005 : 0.003)
  if (regenerate) await page.getByRole('button', { name: '↻ 重新生成', exact: true }).click()
  else {
    await page.locator('.creation-composer textarea').fill(question)
    await page.getByRole('button', { name: '发送 ↗', exact: true }).click()
  }
  if (stop) {
    await page.waitForFunction(() => !!document.querySelector('.creation-message.is-assistant:last-child .creation-markdown')?.textContent?.trim())
    await page.getByRole('button', { name: '■ 停止生成' }).click()
  }
  await page.getByRole('button', { name: '■ 停止生成' }).waitFor({ state: 'hidden', timeout: 180000 })
  const last = page.locator('.creation-message.is-assistant').last()
  const error = await last.locator('.creation-message-error').allTextContents()
  const text = await last.locator('.creation-markdown').innerText().catch(() => '')
  if (regenerate) assert.equal(await page.locator('.creation-message').count(), countBefore)
  checks.push({ name: label, model, success: stop ? error.join('').includes('已停止') : !error.length && !!text.trim(), error, text, messageCount: await page.locator('.creation-message').count() })
  save()
}
async function image(label, edit, reuse = false) {
  await page.goto(base + '/ai-creation/image'); await readyImage()
  await select('#studio-model', 'gpt-image-2'); await readyImage()
  await frame.getByLabel('自定义像素', { exact: true }).fill('1024x1024')
  await frame.getByLabel('生成张数', { exact: true }).fill('1')
  if (edit) await frame.locator('input[type=file]').setInputFiles(path.join(out, 'real-generated.png'))
  if (!reuse) grant(label, edit ? '/v1/images/edits' : '/v1/images/generations', 'gpt-image-2', 0.08)
  await frame.locator('textarea').first().fill(edit ? '保留蓝色圆形，在圆形中心添加一个小白色五角星。背景保持纯浅灰色，不要文字。' : '一个居中的纯蓝色圆形，纯浅灰色背景，简洁平面图形，不要文字，不要渐变。')
  await frame.getByRole('button', { name: '开始生成', exact: true }).click()
  await frame.getByRole('button', { name: '下载', exact: true }).first().waitFor({ timeout: 600000 })
  await frame.waitForFunction(() => [...document.querySelectorAll('.ant-image-img')].some(image => image.complete && image.naturalWidth > 0))
  const download = page.waitForEvent('download')
  await frame.getByRole('button', { name: '下载', exact: true }).first().click()
  const file = await download
  const filename = path.join(out, reuse ? 'reused-real-image.png' : edit ? 'real-edited.png' : 'real-generated.png')
  await file.saveAs(filename)
  checks.push({ name: label, success: fs.statSync(filename).size > 0, reusedExistingOutput: reuse, bytes: fs.statSync(filename).size, imageSize: await frame.locator('.ant-image-img').first().evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight })) })
  await page.screenshot({ path: path.join(out, label + '.png'), fullPage: true }); save()
}
async function command(name) {
  if (name === 'first') await chat('UI1', '请记住本会话口令“蓝鲸松果”。只回复“已记住”。')
  else if (name === 'online-chat') await chat('ONLINE-chat', '上线验收，请只回复“就绪”。')
  else if (name === 'follow') { await chat('UI2', '刚才要求你记住的口令是什么？只回复口令。'); assert(checks.at(-1).text.includes('蓝鲸松果')) }
  else if (name === 'mainstream') await chat('UI3-mainstream', '请记住本会话口令“蓝鲸松果”。只回复“已记住”。', 'gpt-6.1-sol')
  else if (name === 'switch') await chat('UI4', '切换回普通聊天后，只回复之前的口令。')
  else if (name === 'stop') await chat('UI5-stop', '请从1开始，每行一个数字，连续列出到200，每行附上中文数字说明。', 'gpt-6-sol', true)
  else if (name === 'regenerate') await chat('UI6-regenerate', '', 'gpt-6-sol', false, true)
  else if (name === 'manual') {
    const name = await page.locator('#studio-key').innerText()
    await page.locator('#studio-key').click()
    const choices = page.locator('.canvas-studio-dropdown .select-option')
    const options = await choices.allTextContents()
    const choice = choices.filter({ hasNotText: '自动' }).first()
    await choice.click()
    if (new URL(page.url()).pathname.endsWith('/image')) await readyImage(); else await readyChat()
    checks.push({ name: '自动匹配及手动选择现有本人Key', success: true, previous: name, options: options.map(value => value.trim()) }); save()
  } else if (name === 'generate') await image('UI7-generation', false)
  else if (name === 'edit') await image('UI8-edit', true)
  else if (name === 'reuse-image') {
    // 明确标记已生成真实图片的本地回放，仅检验恢复、渲染、下载与画布；不当成新的真实推理。
    fs.writeFileSync(path.join(out, 'request-permit.json'), JSON.stringify({ allowed: false }), 'utf8')
    const matcher = '**/v1/images/generations'
    await context.route(matcher, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: fs.readFileSync(path.join(out, 'real-edited.png')).toString('base64') }] }) }), { times: 1 })
    await image('已生成真实作品本地恢复回放', false, true)
  }
  else if (name === 'canvas') {
    if (!await frame.getByRole('button', { name: '放入画布', exact: true }).count()) {
      await frame.locator('.host-generation-log').first().click()
      await frame.getByRole('button', { name: '放入画布', exact: true }).first().waitFor()
    }
    await frame.getByRole('button', { name: '放入画布', exact: true }).first().click()
    await frame.getByRole('button', { name: '放入画布', exact: true }).last().click()
    await frame.waitForURL(/\/canvas\/canvas\/.+/); await frame.locator('svg').first().waitFor()
    projectUrl = frame.url(); await page.reload(); await readyImage()
    await frame.goto(projectUrl); await frame.locator('svg image, img').first().waitFor()
    const oldFrame = frame
    await select('#studio-model', 'gpt-image-2.5'); await page.waitForTimeout(500)
    assert.equal(frame, oldFrame); assert.equal(frame.url(), projectUrl)
    await select('#studio-model', 'gpt-image-2'); await page.waitForTimeout(500)
    checks.push({ name: '真实图片入画布、刷新恢复及切换模型保留项目', success: true, projectUrl, imageCount: await frame.locator('svg image, img').count() }); save()
    await page.screenshot({ path: path.join(out, 'real-canvas-restored.png'), fullPage: true })
  } else if (name === 'storage') {
    await page.goto(base + '/ai-creation/chat'); await readyChat()
    const count = await page.locator('.creation-message').count()
    assert(count >= 2)
    await page.reload(); await readyChat()
    assert.equal(await page.locator('.creation-message').count(), count)
    const token = await page.evaluate(() => localStorage.getItem('auth_token'))
    const response = await page.request.get(base + '/api/v1/keys/1', { headers: { Authorization: 'Bearer ' + token } })
    assert.equal(response.status(), 200)
    const key = (await response.json()).data.key
    const result = await page.evaluate(async () => {
      const names = [], values = []
      for (const info of await indexedDB.databases()) {
        names.push(info.name)
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open(info.name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
        for (const name of db.objectStoreNames) values.push(JSON.stringify(await new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })))
        db.close()
      }
      return { names, data: values.join('\n') }
    })
    assert(key && !result.data.includes(key))
    checks.push({ name: '真实聊天刷新恢复及 IndexedDB 无明文用户Key', success: true, messageCount: count, databases: result.names }); save()
  } else if (name === 'centers') {
    for (const route of ['/dashboard', '/usage', '/profile', '/keys']) {
      await page.goto(base + route); await page.locator('.user-console').waitFor()
      checks.push({ name: '原用户中心 ' + route, success: true })
    }
    const token = await page.evaluate(() => localStorage.getItem('auth_token'))
    const forbidden = await page.request.get(base + '/api/v1/admin/dashboard/stats', { headers: { Authorization: 'Bearer ' + token } })
    assert.equal(forbidden.status(), 403)
    checks.push({ name: '普通用户仍不能访问管理员API', success: true, status: 403 }); save()
  } else if (name === 'screens') {
    for (const route of ['/ai-creation/chat', '/ai-creation/image']) {
      await page.goto(base + route)
      if (route.endsWith('chat')) await readyChat(); else await readyImage()
      for (const [width, height] of [[1920, 1080], [1536, 864], [1366, 768], [390, 844]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(400)
        const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight }))
        assert(metrics.scrollWidth <= width + 1)
        await page.screenshot({ path: path.join(out, `real-${route.split('/').pop()}-${width}x${height}.png`), fullPage: true })
        checks.push({ name: route + ' ' + width + 'x' + height, success: true, metrics })
      }
    }
    await page.setViewportSize({ width: 1536, height: 864 }); save()
  } else if (name === 'finish') { save(); await browser.close(); process.exit(0) }
  else if (name === 'status') console.log(JSON.stringify({ checks: checks.map(c => ({ name: c.name, success: c.success })), errors }))
  else throw new Error('未知验收命令')
}
async function main() {
  browser = await chromium.launch({ headless: true, channel: 'chrome' })
  context = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true })
  // 测试仅将产品输出限额收紧；不更改生产模型价格、权限、账号或服务端重试配置。
  await context.route('**/v1/chat/completions', route => {
    const body = route.request().postDataJSON(); assert.equal(body.max_completion_tokens, 4096)
    parameterChecks.push({ path: '/v1/chat/completions', productLimit: body.max_completion_tokens, testLimit: outputLimit })
    route.continue({ postData: JSON.stringify({ ...body, max_completion_tokens: outputLimit, reasoning_effort: 'low' }) })
  })
  await context.route('**/v1/responses', route => {
    const body = route.request().postDataJSON(); assert.equal(body.max_output_tokens, 4096)
    parameterChecks.push({ path: '/v1/responses', productLimit: body.max_output_tokens, testLimit: outputLimit })
    route.continue({ postData: JSON.stringify({ ...body, max_output_tokens: outputLimit, reasoning: { effort: 'low' } }) })
  })
  page = await context.newPage(); page.on('pageerror', error => { errors.push(error.name); save() })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.origin === new URL(base).origin && /\.(js|css|png|webp|svg|woff2?)$/.test(url.pathname) && response.status() >= 400) { resourceErrors.push({ path: url.pathname, status: response.status() }); save() }
  })
  await page.goto(base + '/login')
  await page.evaluate(() => { localStorage.setItem('sub2api_locale', 'zh'); localStorage.setItem('user_guide_2', 'true') })
  await page.reload()
  const email = process.env.SUB2API_E2E_EMAIL
  if (!email) throw new Error('缺少本次安全提供的登录邮箱')
  await page.locator('#email').fill(email)
  const password = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'creation-production-password.ps1')], { encoding: 'utf8', windowsHide: true })
  await page.locator('#password').fill(password)
  await page.locator('button[type=submit]').click(); await page.waitForURL(url => !url.pathname.startsWith('/login'))
  await page.goto(base + '/ai-creation/chat'); await readyChat()
  if (process.env.CREATION_ASSERT_MAINSTREAM_DEFAULT === 'true') {
    await page.waitForFunction(() => document.querySelector('#studio-model')?.textContent?.includes('gpt-6-sol'))
    checks.push({ name: '新会话默认已授权 gpt-6-sol', success: true })
  }
  await select('#studio-model', 'gpt-6-sol'); await readyChat()
  checks.push({ name: '真实普通用户正常登录、模型目录及本人Key加载', success: true }); save()
  console.log('READY：只接受逐笔验收命令，尚未提交新的收费请求。')
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  for await (const line of input) {
    const name = line.trim(); if (!name) continue
    try { await command(name); console.log('DONE ' + name); save() }
    catch (error) { checks.push({ name, success: false, failure: error.name, diagnostic: String(error.message || '').replace(/sk-[\w-]+/g, '[已隐藏]').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[已隐藏]').split('\n').slice(0, 5).join('\n') }); save(); if (name !== 'centers') await page.screenshot({ path: path.join(out, `failure-${run}-${name}.png`), fullPage: true }).catch(() => {}); console.log('FAILED ' + name + ' ' + error.name + '（已隐藏异常原文，不自动重试）') }
  }
}
main().catch(error => { save(); console.log('START_FAILED ' + error.name + '（已隐藏异常原文）'); process.exitCode = 1 })
