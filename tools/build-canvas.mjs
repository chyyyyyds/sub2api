import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const bun = process.env.CANVAS_BUN || 'bun'
// 画布保持独立锁文件；必须在主站清空输出目录之后合并。
const result = spawnSync(bun, ['run', 'build'], {
  cwd: resolve(root, 'canvas/web'), stdio: 'inherit',
  env: { ...process.env, VITE_BASE: '/canvas/', VITE_SUB2API_HOST: 'true' },
})
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
const output = resolve(root, 'backend/internal/web/dist/canvas')
mkdirSync(output, { recursive: true })
cpSync(resolve(root, 'canvas/web/dist'), output, { recursive: true })
