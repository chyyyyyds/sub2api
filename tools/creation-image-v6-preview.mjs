// V6 验收只复用本机 Mock，绝不代理真实 API；构建输出与生产目录隔离。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../', import.meta.url)))
let source = readFileSync(resolve(root, 'tools/creation-p1-preview.mjs'), 'utf8')
source = source.replace("const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')", `const root = ${JSON.stringify(resolve(root, '.codex/image-v6-preview'))}`)
source = source.replace('sub2api_ai_creation_prototype_v5.html', 'sub2api_image_panel_v6.html')
source = source.replaceAll("['gpt-image-2',", "['gpt-image-2', 'gpt-image-2.5',")
source = source.replace("if (path === '/__v5_prototype')", "if (path === '/__v6_prototype')")
source = source.replace("const result = body.prompt.includes('[empty]')", `const resultImage = readFileSync(${JSON.stringify(resolve(root, '.codex/image-v6-evidence'))} + '/mock-output.' + (['png', 'jpeg', 'webp'].includes(body.output_format) ? body.output_format : 'png')).toString('base64')
    const result = body.prompt.includes('[empty]')`)
source = source.replace("{ created: 1, data: [{ b64_json: png }] }", "{ created: 1, data: [{ b64_json: resultImage, output_format: body.output_format || 'png' }] }")
source = source.replaceAll('18087', '18096')
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
