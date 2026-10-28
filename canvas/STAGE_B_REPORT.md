# AI 创作中心 V5 · Stage B 交付

本阶段实现原生 Vue「AI 聊天」，沿用 Stage A 的 V5 工作台、模型与用户 Key 选择以及 Midnight HUD 外壳。停在 Stage B 用户验收点，不进入 Stage C。

## 功能清单

- 接入现有同源聊天网关，支持 SSE 增量输出、停止、重新生成和多轮追问。Enter 发送，Shift+Enter 换行，兼容中文输入法组合输入；生成中阻止重复发送，仍允许编辑下一条草稿。
- 会话新建、切换、自动标题、手动重命名、确认删除和刷新恢复。历史按登录用户 ID 使用独立 IndexedDB 数据库；打开另一用户或跨标签换号时立即清空旧视图、中止请求并重新加载本人数据。
- 保存会话的模型 ID、Key ID 和自动/手动选择偏好，切换或刷新后由 Stage A 重新验证。切换模型或 Key 保留当前会话与草稿；每次请求固定发送时的用户、模型、Key 和会话，旧请求不能写入新会话。
- Markdown、表格、列表、代码块、常见语言高亮、复制代码及复制完整回答。使用独立 Marked 实例和 DOMPurify，原始 HTML 显示为文本，危险链接被清洗，Markdown 远程图片不自动加载。
- 生成中、等待响应、完成、中断、失败均有明确状态。停止、EOF 提前结束、流内错误、超时和截断均保留已收到的文本，并标记中断；刷新恢复时遗留 streaming 状态也转为中断。
- HTTP 401、403、429、余额/额度不足、模型/接口不可用、网络异常、非法响应和流内错误按受控中文分类提示。网关错误原文、Authorization 和明文 Key 不写入日志或持久化；失败不自动重发。
- 桌面左侧历史区、中间独立滚动消息区、底部输入框与顶部紧凑模型/Key 选择保持 V5 结构；手机通过紧凑历史入口打开左侧抽屉，输入框始终可见。没有右侧设置面板或新增介绍区。

## 网关与上下文

已读取 `backend/internal/server/routes/gateway.go`、`backend/internal/handler/gateway_handler_chat_completions.go`、`backend/internal/handler/openai_chat_completions.go` 和 `backend/internal/server/middleware/api_key_auth.go`。既有入口按平台分发，检查 Key 所属、分组、模型白名单、订阅/余额/额度及并发；聊天处理器继续检查计费资格并沿用现有调度与费用记录。本阶段没有修改任何后端文件。

| 模型标识 | 最小兼容入口 | 请求内容 |
| --- | --- | --- |
| 包含 Claude | `/v1/messages` | 顶层 system 与完整 user/assistant 历史，`max_tokens=4096` |
| 包含 Codex | `/v1/responses` | 完整 input，按角色区分 input_text/output_text，`store=false` |
| 其他授权文本模型与自定义别名 | `/v1/chat/completions` | 标准 system/user/assistant messages，复用网关既有协议转换 |

`/v1/models` 没有统一协议能力字段，因此已知模型家族使用对应入口，自定义别名使用现有兼容入口；不声称目录中的所有模型都支持相同协议。网关拒绝或模型不可用时明确提示，绝不自动换协议重发。别名和受限分组是否可用仍由既有网关与上游最终判断。没有加入网关重构或权限放宽。

每次请求由客户端重新组织完整上下文，不使用 `previous_response_id`。只发送完整 user/assistant 轮次和当前问题，保留 system；中断/失败回答及其旧问题不混入完整轮次。重新生成只替换最后一轮助手回答，最后一个用户问题只发送一次，早期完整轮次保持不变。

本地上下文上限为 48,000 字符，超限阻止本次发送并保留草稿，提示新建会话和粘贴摘要；不静默删除历史，不将字符数称作 token 数。模型自身上下文限制可能更低，服务端返回超限时同样提示。单次回答最多保留 500,000 字符，超出标中断；120 秒没有收到文本增量时取消等待并提示超时。SSE 单事件缓冲上限为 2,000,000 字符；大代码块超过 30,000 字符时保留可复制纯文本，避免同步高亮阻塞。

历史每约 600ms 保存一次流式检查点，停止和完成时立即排队保存；页面崩溃可能丢失最后一个尚未提交的检查点。存储不可用或额度不足时显示提示并继续内存对话，提醒复制重要内容。当前采用单页面状态与 IndexedDB 持久化，同一账户多标签同时编辑同一会话采用最后写入结果，未实现多标签内容合并。

## 修改文件清单

共 19 个文件。既有文件在实施前逐份备份，本清单不包含原有 Stage A 与其他未提交修改。

| 范围 | 文件 |
| --- | --- |
| 聊天页面入口 | `frontend/src/views/user/ImageStudioView.vue` |
| 聊天控制器 | `frontend/src/composables/useCreationChat.ts` |
| 聊天与安全 Markdown 组件 | `frontend/src/components/chat/CreationChat.vue`、`frontend/src/components/chat/ChatMarkdown.vue` |
| 协议、SSE、上下文与错误分类 | `frontend/src/lib/creation-chat.ts` |
| 用户隔离 IndexedDB | `frontend/src/lib/creation-chat-db.ts` |
| 页面私有样式 | `frontend/src/styles/creation-chat.css` |
| 中英文文案 | `frontend/src/i18n/locales/zh/imageStudio.ts`、`frontend/src/i18n/locales/en/imageStudio.ts` |
| 测试 | `frontend/src/lib/__tests__/creation-chat.spec.ts`、`frontend/src/lib/__tests__/creation-chat-db.spec.ts`、`frontend/src/composables/__tests__/useCreationChat.spec.ts`、`frontend/src/components/chat/__tests__/ChatMarkdown.spec.ts` |
| 依赖 | `frontend/package.json`、`frontend/pnpm-lock.yaml`：生产依赖 highlight.js，测试依赖 fake-indexeddb；原有脚本与依赖保留 |
| 本地 Mock / 浏览器验收 / 保护检查 | `tools/creation-stage-b-preview.mjs`、`tools/creation-stage-b-browser-test.cjs`、`tools/creation-stage-b-verify.py` |
| 报告 | `canvas/STAGE_B_REPORT.md` |

`useCreationSelection.ts`、图片画布源代码、视频与 KOKO 功能、网关、鉴权、计费、账号调度和用户中心/后台业务代码均无修改。

## 本地验收

地址：<http://127.0.0.1:18086/ai-creation/chat>。V5 原型：<http://127.0.0.1:18086/__v5_prototype?tab=chat>。

模拟账号：`canvas101@example.test` 或 `canvas202@example.test`；密码：`CanvasPreviewOnly123!`。这是本机 Mock 登录身份。新打开的浏览器需要先登录，再进入聊天地址。

预览仅监听 `127.0.0.1:18086`，只接受固定模拟用户 Key。聊天与图片响应全部在本机生成，没有外网转发代码；未实现的 `/v1/*` 接口全部拒绝，视频提交仍关闭。浏览器自动化另行拦截所有非本机请求。重新启动：

```powershell
node tools/creation-stage-b-preview.mjs
```

可使用以下输入验证异常：`[slow]` 慢速流、`[disconnect]` 提前 EOF、`[stream-error]` 流内错误、`[http:401]` / `[http:403]` / `[http:429]` / `[http:402]` / `[http:404]`、`[xss]` 恶意 HTML。普通输入返回带 Markdown 和 Java 代码的固定本地回答。

## 测试与构建

| 检查 | 结果 |
| --- | --- |
| 聊天协议/上下文/SSE/错误、IndexedDB、生命周期与并发归属、Markdown 安全、语言键及既有外壳/登录/首页/图片桥接回归 | 10 个文件，92 项通过 |
| Canvas 原有回归，含 KOKO/Seedance 固定参数测试 | 8 个文件，34 项通过，没有真实生成 |
| 本机浏览器综合验收 | 21 组通过，运行时异常 0 |
| 四尺寸布局 | 1920×1080、1536×864、1366×768、390×844：无页面横向/纵向溢出、消息独立滚动、输入框可见，手机历史抽屉可用 |
| Vue TypeScript 与修改文件 ESLint | 通过 |
| 双前端生产构建 | 使用本地 Bun 路径运行 `pnpm --dir frontend run build:all` 通过，退出码 0；完整输出见 `build.log` |
| 保护核对 | 10,675 个范围外文件无变化，3 个 TypeScript 构建缓存排除；所有本轮源文件 UTF-8 无 BOM，回滚原件摘要通过 |

初次双前端构建因系统 PATH 中没有 Bun，在 Vue 构建完成后停止；改用 Stage A 已有的本地 Bun 绝对路径重跑。只设置当前命令进程的 `CANVAS_BUN`，没有修改系统环境变量。构建保留原有 chunk 大小、config.js 静态脚本及重复静动态导入提示。

```powershell
$env:CANVAS_BUN = 'D:\workspace\code\sub2api\.codex\canvas-tools\package\bin\bun.exe'
pnpm --dir frontend run build:all
```

详细证据：`.codex/creation-stage-b-evidence/unit-results.json`、`browser-results.json`、`build.log`、`protection.json`。

## V5 与实际 UI 对照

四种尺寸均保留原型和实际浏览器截图，位于 `.codex/creation-stage-b-evidence/`：`v5-chat-{宽}x{高}.png`、`actual-chat-{宽}x{高}.png`。

并排图左侧 V5、右侧 Stage B，只拼接原始截图，不修改画面：

![桌面对照](D:/workspace/code/sub2api/.codex/creation-stage-b-evidence/comparison-chat-1536x864.png)

![手机对照](D:/workspace/code/sub2api/.codex/creation-stage-b-evidence/comparison-chat-390x844.png)

保留 Stage A 已验收的 HUD 导航高度、工作台框架与模型/Key 行。实际消息内容来自本机 Mock，不复制原型的静态示例记录；手机增加紧凑历史抽屉入口用于实际会话管理。

## 遗留边界与真实请求计划

- 所有发送验收均使用 Mock，未执行真实收费请求；实际供应商能力、首字延迟、错误细节和最终计费尚未端到端验证。
- 本阶段仅文本聊天；不支持附件、模型工具调用、推理过程展示或多模态内容。工具调用/过滤/长度截断不会伪装为正常文本完成。自定义模型别名的协议仍需用用户授权的实际模型确认。
- 历史只在当前浏览器，清理网站数据会移除记录。未实现导出 UI、云端同步或同账户多标签内容合并。存储结构采用显式字段，后续可在此基础上增加导出。
- 得到用户额外批准后，使用用户指定的测试账号、模型、Key 和预算，每种入口逐个进行一轮短提示词、一次多轮追问；确认前端请求与网关使用记录中的模型、Key、路由和费用归属一致。
- 随后单独验证真实停止、断流和重新生成：核对部分回答状态及上下文排除，核对停止是否及时取消上游与实际费用。停止浏览器读取并不等于保证上游已停止计费；这必须由真实网关记录验证。
- 对自定义别名、Claude Code 限制组、IP 白名单、余额与额度边界，仅按授权范围逐项验证，沿用服务端拒绝结果，不修改权限或路由。

## 保护与回滚

实施前文件摘要与既有文件原件保存在 `.codex/creation-stage-b-baseline/`。本轮文件前后摘要与差异保存在 `.codex/creation-stage-b-evidence/owned-files.json` 和 `stage-b.patch`。运行 `python -X utf8 tools/creation-stage-b-verify.py` 可重查范围与编码。

回滚前必须逐项确认当前摘要仍等于清单的 `after_sha256`；若已有后续修改，先单独保存。只恢复清单中 `new=false` 文件对应的 `baseline/original/` 原件，删除清单中 `new=true` 的新增文件，再重新安装前端依赖和构建。禁止整仓 reset/clean。回滚仅针对代码，默认保留浏览器本地会话数据。

没有操作 New API 原项目、甲骨文线上服务、生产容器或数据库；没有提交、推送或部署。等待 Stage B 用户验收。
