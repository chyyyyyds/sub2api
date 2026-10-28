# Sub2API 图片创作集成

此目录是定制 Infinite Canvas 的源码快照，原 New API 与 Canvas 仓库始终只读。

## 来源与范围

- 来源提交：`b7da44325e08e70663ab47ec2ae97a6f159d4b42`，叠加 `SOURCE_WORKTREE.patch`。
- `SOURCE_LOCK.json` 记录全部 510 个来源文件的原始字节摘要。来源快照指纹：`3c5f73865cb8eb9eaf97ecae0907c1ff6ee11c3c7b5980c5e40f796e4da57ddb`。
- 保留四个 KOKO 模型、参考音频、视频页面与现有测试源码。宿主构建只开放图片工作台、本地素材与项目；不提供视频适配器、云端作品库或新数据库迁移。
- Vue 的 `/ai-creation/image` 使用现有 Midnight HUD，iframe 为同源 `/canvas/image`。
- 图片生成、编辑、分组权限、鉴权、余额和计费继续使用现有网关。

## 开发与构建

主站使用现有 pnpm 锁文件，画布使用 Bun 1.4.0 与自己的锁文件，两者不混装依赖。

1. `pnpm --dir frontend install --frozen-lockfile`
2. 在此目录的 `web` 中运行 `bun install --frozen-lockfile`。
3. 根目录执行 `pnpm --dir frontend run build:all`；它先构建 Vue，再构建并合并画布。
4. 本地 Bun 不在 PATH 时，为该命令进程设置 `CANVAS_BUN` 为可执行文件完整路径。
5. Dockerfile 独立构建两份前端，并以 `embed` 构建 Go 二进制。

开发时主站 Vite 代理 `/canvas` 到 `http://127.0.0.1:3001`，可用 `VITE_CANVAS_SERVER_URL` 覆盖。画布开发服务需要设置 `VITE_BASE=/canvas/`、`VITE_SUB2API_HOST=true`，然后运行 `bun run dev --port 3001`。

## 凭证与用户数据

- 完整用户 Key 只从已有 `/api/v1/keys` 与详情接口取得，保留原有服务端所有权检查；不调用管理员渠道凭证接口。
- 配置仅驻留当前 iframe 内存，不写入 localStorage、sessionStorage、IndexedDB、配置导出或同步数据。
- `ready/config/configured` 复用原协议，增加实例与会话关联，校验窗口和同源地址。
- 在加载 React 和任何业务 store 前完成宿主与用户校验。直接访问画布只显示打开方式提示。
- IndexedDB 名称绑定 `sub2api-user-{id}`，记录、素材、图片原件、媒体、预览和项目均通过同一个存储包装器。失败时不回退到共享存储。
- 切换 Key/模型重建 iframe；退出、跨标签换号中止请求并销毁旧会话。异步存储目标在启动时固定。
- 同源画布属于可信主站代码，不是操作系统或浏览器安全沙箱；本地数据不宣称加密或云同步。

## 验收与回滚

`node tools/canvas-preview.mjs` 在本机 `127.0.0.1:18084` 提供明确的 mock-only 验收服务，所有图片响应均为固定测试图片，绝不转发到真实供应商。

在 `/login` 使用 `canvas101@example.test` 或 `canvas202@example.test` 和任意非空测试密码登录。它们只是模拟身份，不是线上账户。可从 `/ai-creation/image` 验收图片生成、上传参考图编辑、模型切换和本地保存。

`node tools/canvas-browser-test.cjs` 自动检查登录路由、图片生成/编辑、素材与项目保存、刷新、持久化扫描、用户隔离与迟到响应。测试所有外部网络请求默认拒绝。

`python tools/canvas-verify.py` 校验原来源未改变、510 个来源文件未遗漏，以及受保护工作区没有被覆盖。

实施前原文件位于 `.codex/canvas-phase1-baseline/original/`，摘要与原有 Git 差异一并保存。本轮文件清单和证据位于 `.codex/canvas-phase1-evidence/`。回滚应只恢复本轮修改文件并按清单移除新增内容；禁止整仓 reset/clean，禁止覆盖原有未提交修改。不自动提交、推送或部署。

## 后续视频阶段

KOKO 收费功能上线之前，Phase 2 必须完成数据库任务、独立后台轮询、重启恢复、账号归属绑定、价格快照、资金冻结、结算/退款幂等与故障重试验收。Phase 3 再完善作品管理和云端项目，不能承接这些上线前提。
