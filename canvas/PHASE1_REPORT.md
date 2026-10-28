# Phase 1 图片创作交付记录

状态：代码、模拟验收及构建验证完成，等待用户验收。未进入 Phase 2。

## 实施范围

- 定制 Canvas 作为独立 React 应用，Vue 用户端新增 AI 创作与图片创作。
- 同源 iframe、独立 HTML 路由、开发代理、双前端生产构建和 Docker 构建。
- 保留 KOKO 模型、音频参考、视频页面及测试源码，宿主模式隐藏视频入口并限制请求能力。
- 用户 Key 复用既有所有权校验接口，不修改读取权限，不接触真实上游渠道密钥。
- 凭证只驻留内存；图片、媒体、预览、素材、项目和记录按用户隔离保存在 IndexedDB。
- 没有新增数据库迁移，没有修改现有计费、调度和鉴权核心逻辑。

## 修改清单

完整的机器可读清单位于 `D:/workspace/code/sub2api/.codex/canvas-phase1-evidence/owned-files.json`，包含每个新增或修改文件的摘要。主要入口如下：

| 模块 | 文件 |
| --- | --- |
| 来源与说明 | `D:/workspace/code/sub2api/canvas/SOURCE_LOCK.json`、`SOURCE_WORKTREE.patch`、`INTEGRATION.md` |
| 用户图片页面 | `D:/workspace/code/sub2api/frontend/src/views/user/ImageStudioView.vue` |
| Vue iframe 宿主 | `D:/workspace/code/sub2api/frontend/src/components/canvas/EmbeddedCanvasStudio.vue` |
| 宿主消息协议 | `D:/workspace/code/sub2api/frontend/src/lib/canvas-host-bridge.ts` |
| Midnight HUD 入口 | `D:/workspace/code/sub2api/frontend/src/components/layout/userConsoleNavigation.ts`、`UserConsoleHeader.vue` |
| 用户路由与文案 | `D:/workspace/code/sub2api/frontend/src/router/index.ts`、两个语言目录的 `imageStudio.ts` 与注册文件 |
| Canvas 启动门 | `D:/workspace/code/sub2api/canvas/web/src/main.tsx`、`app.tsx`、`lib/sub2api-bootstrap.ts`、`lib/sub2api-context.ts` |
| 本地隔离 | `D:/workspace/code/sub2api/canvas/web/src/lib/scoped-localforage.ts` 与所有原 localforage 入口 |
| 凭证保护 | `D:/workspace/code/sub2api/canvas/web/src/stores/use-config-store.ts`、`services/config-file.ts`、`services/app-sync.ts` |
| 图片范围与手机布局 | `D:/workspace/code/sub2api/canvas/web/src/router.tsx`、`layouts/user-layout.tsx`、图片页及画布工具栏/配置面板 |
| Go 静态路由 | `D:/workspace/code/sub2api/backend/internal/web/canvas.go`、`canvas_test.go`、`embed_on.go` |
| 构建与 CI | `D:/workspace/code/sub2api/Dockerfile`、`Makefile`、`.dockerignore`、`.gitignore`、前端脚本、Vite 代理、CI/发布产物工作流 |
| 工具与测试 | `D:/workspace/code/sub2api/tools/` 下的 `canvas-*`、`canvas_snapshot.py`、`build-canvas.mjs` 及新增前端/Canvas测试 |

现有用户样式文件、首页、登录页、后台模板与业务核心改动均保留。新增菜单导致的手机溢出通过用户 Header 的局部导航滚动处理，没有重写现有样式体系。

## 分步结果

| 步骤 | 结果 |
| --- | --- |
| Step 1 | 510 个来源文件逐字节复制校验，保留来源提交与工作区补丁；原工作区摘要、差异和待修改文件原件已备份 |
| Step 2 | 独立 SPA、HUD 导航、Vue/Canvas 构建通过；主站先构建、画布后合并 |
| Step 3 | 消息来源、实例/会话关联、自定义 Key 前缀、Key 所有权、模型加载、乱序与刷新测试通过 |
| Step 4 | 持久化扫描、直接访问限制、素材/图片/预览/项目/记录隔离、跨标签换号与迟到响应测试通过 |
| Step 5 | 155 项前端回归、34 项 Canvas 测试、15 项浏览器检查、Go 两组测试、双前端统一构建和 Docker 验证通过 |

## 测试证据

- 前端：155 项测试通过；手机导航修正后额外复跑 19 项受影响测试，通过；类型检查和修改文件 ESLint 通过。
- Canvas：类型检查通过，34 项测试通过，包含原有 KOKO/Seedance 参数测试。
- 浏览器：15 项检查通过，所有外部网络请求默认拒绝；生成与编辑使用固定测试 PNG。
- Go：普通构建测试和 `unit` 标签下的静态资源/中间件测试通过。
- 生产构建：`pnpm --dir frontend run build:all` 通过，两份资源合并到后端嵌入目录。
- Docker：在甲骨文独立目录完成 ARM64 镜像构建；6 项实际容器冒烟检查通过。
- 实际响应确认：Canvas 为 SAMEORIGIN、独立 nonce 和 no-store；哈希脚本可访问并有 immutable 缓存；视频入口、配置入口和缺失资源返回 404；后台继续 DENY 与 frame-ancestors none。
- 来源与工作区：只读来源未变化，无来源文件丢失或被 Git 忽略；受保护的既有跟踪文件未被覆盖。
- 文本编码：新增和修改文本 UTF-8 无 BOM 检查通过。

证据目录：`D:/workspace/code/sub2api/.codex/canvas-phase1-evidence/`。包括生产构建日志、浏览器 JSON、桌面/手机截图、Go 日志、Docker 日志与镜像摘要、保护校验报告。

甲骨文仅用于隔离构建和无网络容器测试。没有生产挂载、生产数据库连接、公开端口、现有服务重启或收费生成。测试容器验收后清理，镜像与构建证据保留在独立命名空间。

## 验收地址

本机 mock-only 服务：`http://127.0.0.1:18084/ai-creation/image`。

登录使用 `canvas101@example.test` 或 `canvas202@example.test`，测试密码可使用 `CanvasPreviewOnly123!`。这些都是模拟身份，模拟 Key 不能访问真实供应商。

原项目开发启动方式、构建方式与回滚约束见 `D:/workspace/code/sub2api/canvas/INTEGRATION.md`。

## 遗留与边界

- 未进行真实收费生成，因此供应商连通性与真实模型输出仍需用户另行明确批准后验证。
- Canvas 保留原有较大的公共 JS chunk，构建有 chunk 大小与静态 config.js 提示；均不阻断构建，未为此重构上游应用。
- 本地 Docker 故障未处理；本轮 Docker 验证按用户授权在甲骨文隔离完成。
- 本地作品不支持跨设备同步或云端恢复。IndexedDB 不可用时失败关闭，不切换到共享业务存储。
- 未执行提交、推送或生产部署。原分支 HEAD 保持不变。
- Phase 2 收费上线前必须完成视频任务持久化、后台轮询、重启恢复及结算/退款幂等。
