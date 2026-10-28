// 复用既有本机 Mock；独立端口，不代理生产模型或读取真实凭证。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
let source = readFileSync(resolve(root, 'tools/creation-p1-preview.mjs'), 'utf8')
source = source.replace("const root = resolve(fileURLToPath(new URL('../', import.meta.url)), 'backend/internal/web/dist')", `const root = ${JSON.stringify(resolve(root, 'backend/internal/web/dist'))}`)
source = source.replaceAll('18087', '18106')
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
