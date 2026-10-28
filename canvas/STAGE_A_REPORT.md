# AI 创作中心 V5 · Stage A 交付

本阶段仅实现公共工作台框架、统一模型与用户 Key 选择、现有图片创作优化。聊天业务等待 Stage B；KOKO 实时能力核对、可靠任务和账务等待 Stage C1/C2。停在用户 UI 验收点，不自动进入下一阶段。

## 功能

- 以 `D:/download/sub2api_ai_creation_prototype_v5.html` 为视觉基准，转换为 Vue 工作台；保留原 Midnight HUD 导航。三个横向入口复用同一动态路由组件，支持直接访问、返回和切换。
- 桌面切换条 43px、工具栏 56px；手机切换条 40px、工具栏 52px。标签与模型/Key 选择框始终同一行，没有额外大标题或自动使用状态卡。
- 共享选择模块分页读取当前用户有效 Key，用每个本人 Key 查询已有 `/v1/models`，合并授权目录。默认按模型自动匹配，并在选项内显示实际 Key 名称。
- 手动 Key 保持选择，重新读取该 Key 的模型目录；兼容模型优先保留，不兼容时切到该 Key 可用模型并提示。无兼容模型时保持手动 Key，停止配置画布并明确报错。
- 过期、禁用、额度耗尽、非本人 Key 不参与匹配。图片分组关闭时不能生成；后续切换重新验证目录，服务端鉴权、白名单、路由和计费仍是最终权限边界。
- 明文用户 Key 仅驻留组件与 iframe 内存；不修改后台读取权限，不读取管理员渠道凭证，不新增服务端接口或数据库表。请求取消、迟到响应丢弃、跨标签换号销毁继续生效。
- 图片复用 React Infinite Canvas：生成、参考图、质量、比例、本地记录、素材和项目均保留；移除工作台内重复选模。旧记录只恢复提示词、图片及参数，不覆盖 Vue 选定模型。
- 图片参数按 V5 紧凑展示：质量与常用比例直接可见；展开“尺寸 / 分辨率 / 生成张数”可使用完整比例、自定义尺寸、分辨率、透明背景和张数。生成引擎与 IndexedDB 用户隔离未替换。
- 聊天采用原生 Vue 骨架，保留左侧历史区、独立消息滚动区和可视底部输入框；可编辑草稿、填写快捷提示词、切换模型/Key。发送和会话管理明确等待 Stage B。
- 视频采用 V5 的创建区、临时存储提醒、统计区和任务筛选骨架。模型与参数等待 C1 验证，提交关闭；没有硬编码旧 KOKO 模型、价格、倒计时或虚构任务。

## 修改文件

本轮精确清单与前后摘要见 `.codex/creation-stage-a-evidence/owned-files.json`：

| 范围 | 文件 |
| --- | --- |
| Vue 工作台 | `frontend/src/views/user/ImageStudioView.vue`、`frontend/src/styles/creation-studio.css` |
| 选择与桥接 | `frontend/src/composables/useCreationSelection.ts`、`frontend/src/components/canvas/EmbeddedCanvasStudio.vue`、`frontend/src/lib/canvas-host-bridge.ts` |
| 路由与外壳 | `frontend/src/router/index.ts`、`frontend/src/components/layout/UserConsoleLayout.vue`、`frontend/src/components/layout/userConsoleNavigation.ts`、`frontend/src/components/icons/Icon.vue` |
| 文案 | `frontend/src/i18n/locales/zh/imageStudio.ts`、`frontend/src/i18n/locales/en/imageStudio.ts` |
| Canvas | `canvas/web/src/pages/image/index.tsx`、`canvas/web/src/components/image-settings-panel.tsx`、`canvas/web/src/components/layout/app-providers.tsx`、`canvas/web/src/app.tsx`、`canvas/web/src/styles/sub2api-host.css` |
| 回归 | `frontend/src/components/canvas/__tests__/EmbeddedCanvasStudio.spec.ts`、`frontend/src/lib/__tests__/canvas-host-bridge.spec.ts`、`frontend/src/components/layout/__tests__/userConsole.spec.ts` |
| 本地验收 | `tools/creation-stage-a-preview.mjs`、`tools/creation-stage-a-browser-test.cjs`、`tools/creation-stage-a-verify.py`、本报告 |

## 本地验收

地址：<http://127.0.0.1:18085/ai-creation/image>。聊天和视频分别为 `/ai-creation/chat`、`/ai-creation/video`。原型对照：<http://127.0.0.1:18085/__v5_prototype?tab=image>。

模拟账号：`canvas101@example.test` 或 `canvas202@example.test`，测试密码可填 `CanvasPreviewOnly123!`。均为本地模拟身份，不能访问真实供应商。下拉包含通用、图片、聊天和受限分组的模拟 Key，可实际验收联动。

预览仅监听 `127.0.0.1:18085`。生成/编辑只返回固定本地 PNG，全部服务处理均不转发外网；聊天、视频提交被拒绝。测试进一步在浏览器阻断所有外部网络。

重启预览：在项目根目录执行 `node tools/creation-stage-a-preview.mjs`。重新构建时在当前 PowerShell 进程设置：

```powershell
$env:CANVAS_BUN = 'D:\workspace\code\sub2api\.codex\canvas-tools\package\bin\bun.exe'
pnpm --dir frontend run build:all
```

## 测试与截图

| 检查 | 结果 |
| --- | --- |
| Vue 工作台、选择桥接、导航、路由、登录、首页、语言键回归 | 10 个文件，118 项通过 |
| Canvas 原有回归（含 KOKO/Seedance 固定参数测试） | 34 项通过，未执行真实生成 |
| Stage A 浏览器交互与四尺寸布局 | 19 项通过，运行时错误 0 |
| Phase 1 浏览器安全、存储与生成回归 | 15 项通过，运行时错误 0 |
| Vue / Canvas TypeScript | 通过 |
| 本轮 Vue/TypeScript 修改文件 ESLint | 通过 |
| 双前端生产构建 | `pnpm --dir frontend run build:all` 通过；保留原有构建提示 |
| 文件保护 | 16,303 个范围外基线文件无变化；New API Canvas 510 个来源文件无变化 |
| 编码与回滚 | 本轮 23 个文件为 UTF-8 无 BOM，16 份已有文件原件摘要核对通过 |

最终结果和截图见 `.codex/creation-stage-a-evidence/`。四种尺寸的三工作台均保存实际浏览器截图和原型截图，命名为 `actual-{chat|image|video}-{宽}x{高}.png` 和 `v5-{chat|image|video}-{宽}x{高}.png`。结果明细见 `browser-results.json`，Phase 1 安全、生成与隔离回归见 `phase1-regression/browser-results.json`。

1536×864 的并排对照图：`comparison-chat.png`、`comparison-image.png`、`comparison-video.png`；左侧 V5，右侧 Stage A。它们只拼接原始浏览器截图，没有更改实际页面内容。

验收区分：原型带静态示例画面、示例聊天和视频任务；正式 Stage A 不复制示例业务数据。实际页面保留现有 HUD 的 74px 桌面、108px 手机导航，因此相对原型 64px/55px 顶栏存在高度差；其下工作台按剩余视口布局。手机保留原已验收 HUD 横向导航滚动，不重做为原型隐藏导航。

## 边界与后续

- 未进行真实图片收费测试，未调用 KOKO，也未读取正式上游凭证。
- 聊天的真实发送、流式、停止、Markdown 与 IndexedDB 会话管理，以及视频实际任务中心、长任务持久化、计费和下载均未进入开发，符合本次阶段停点。
- `/v1/models` 未提供统一的模型能力字段。图片目录排除已知纯聊天/音视频名称，同时保留 Phase 1 的自定义模型别名兼容；未知别名是否支持图片仍由原网关与供应商能力决定。自动匹配不代替实际请求时的余额、IP、模型权限或额度检查。
- 模型与 Key 偏好在当前页面生命周期内记忆；本轮未增加跨刷新偏好持久化。图片本地记录、素材、项目仍可跨刷新恢复，并按用户隔离。
- 构建保留现有 chunk 大小、静态 config.js 和重复静动态导入提示，没有为此重构无关模块。
- UI 验收通过后建议进入 Stage B。C1 仍须另行核实 KOKO 最新文档、服务端安全凭证和非收费实时模型/账户响应。

## 保护与回滚

实施前摘要和逐文件原件保存在 `.codex/creation-stage-a-baseline/`，本轮差异补丁为 `.codex/creation-stage-a-evidence/stage-a.patch`。运行 `python -X utf8 tools/creation-stage-a-verify.py` 可核对原件摘要、范围外文件、只读 New API Canvas 来源以及 UTF-8 无 BOM。

回滚先按 `owned-files.json` 检查 `after_sha256`，避免覆盖验收后的其他修改。仅恢复清单中已有文件对应的 `baseline/original/` 原件，并移除清单中 `new=true` 的新增文件，再按 Phase 1 流程重建。禁止整仓 reset/clean。未提交、未推送、未部署；生产容器与数据库没有操作。
