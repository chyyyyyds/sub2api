# Sub2API AI 创作中心 · P2 聊天稳定性交付

本轮仅实施 P2，停在用户验收点。所有生成验证均为本机 Mock，没有发起真实收费聊天或图片请求，没有进入 P3、开发视频、修改 New API 或甲骨文环境，也没有提交、推送、部署或改动生产超时、权限与计费规则。

## 本轮完成内容

- 协议选择优先采用部署审核的用户、Key、模型精确映射；标准 Claude、GPT Codex、codex-mini-latest 等保留既有入口，未知别名明确提示 Chat Completions 兼容性待验证。失败绝不自动换协议重发。
- 三类 SSE 分别核验终止语义，处理 UTF-8 跨块、CR/LF、注释、心跳、多行 data、推理、错误及分块正文。工具调用、拒答或非文本结果明确标记受限，不纳入完整历史。
- 将旧“120 秒无正文”计时替换为首响应、网络空闲、有效进展及总时长四种预算，支持部署配置和注入时钟。持续推理不会因为没有正文而触发旧超时，只有心跳也不能无限等待。
- 请求固定模型、Key、协议、用户和会话；完整客户端历史继续按 system/user/assistant 组织，不使用 previous_response_id。停止、失败和中断回答排除出完整上下文，重新生成仅替换最后一个助手回答。
- 保留按用户隔离的 IndexedDB。增加打开数据库的 5 秒失败保护、迟到连接关闭、版本变更关闭连接、读事务中止和损坏记录错误处理。持久化使用字段及错误分类白名单，协议枚举可恢复，推理原文和凭证不落库。
- 流式检查点约 600ms 保存，停止立即排队保存部分文本；本地写入等待不再阻塞网络发送和主动停止。重命名等待保存结束再关闭弹窗，避免界面确认后立即刷新丢失标题。
- 失效或删除的已保存手动 Key 明确提示，不静默替换成其他 Key。跨标签换号清空凭证、历史和弹窗标题草稿，取消旧请求，迟到片段不能进入新会话。
- 沿用 V5 / Midnight HUD 结构。补充等待、推理、生成阶段及 15 秒慢首字反馈，停止立即显示中断；Markdown 生成期每约 100ms 节流，超过 30,000 字符暂以安全纯文本显示，完成后恢复 Markdown。历史气泡缓存和屏外绘制优化减少长回答开销。
- 手机监听 VisualViewport，给键盘遮挡预留空间；保留左侧历史抽屉、顶部模型和 Key、底部输入框，没有新增右侧设置栏或顶部大标题。

## 网关核对与协议能力来源

本轮读取并核对现有实现，没有重做 Stage A/B 全面审计，也没有修改后端：

| 源码 | 结论 |
| --- | --- |
| `backend/internal/server/routes/gateway.go` | 三种入站路径先执行 Key 鉴权、模型白名单及合成路由，再按分组平台分派处理器。入站协议与上游协议是两个概念。 |
| `backend/internal/handler/gateway_handler.go` 的 Models | 普通 `/v1/models` 返回当前 Key 的授权模型目录，可能来自映射、白名单、默认列表或合成分组，没有可直接信赖的统一用户协议字段。 |
| `backend/internal/handler/gateway_handler_chat_completions.go`、`openai_chat_completions.go` | Chat Completions 具有既有转换链，仍检查模型、分组、Claude Code/Codex 限制和计费资格，前端不能用协议配置绕过。 |
| `backend/internal/service/upstream_protocol_routing.go`、`model_protocol_catalog.go` | 上游协议依账号的显式 api_protocol、protocol_rules、供应商目录、adaptive 模式及 Responses 支持标记决定，最终还与调度账号有关。 |
| `backend/internal/service/account.go`、`openai_gateway_chat_completions.go`、`openai_gateway_messages.go`、`openai_account_scheduler.go` | 渠道模型映射、账号映射和调度能力确实存在，但属于管理员配置及运行期账号信息，不能直接提供给普通用户，也不能仅凭模型名称还原。 |

因此采用最小前端受控配置 `VITE_CREATION_CHAT_PROTOCOLS`，构建时由维护者在核对实际网关配置后提供。匹配顺序为：用户 ID + Key ID + 精确模型名的显式规则 → 标准模型默认入口 → 未知别名的 Chat Completions 兼容入口。标准默认入口仅保留 Stage B 行为，不宣称对应渠道已通过真实验收；即使别名长得像标准模型，维护者也可用精确规则覆盖。

配置形状示例（仅说明字段，本轮没有把此示例加入实际构建配置）：

```json
[
  { "userId": 123, "keyId": 456, "model": "my-text-alias", "protocol": "responses" }
]
```

protocol 只接受 chat、messages、responses。禁止通配符，规则重复或配置非法时阻止发送。构建配置会随公开前端资源分发，只允许上述非敏感枚举和显示标识，严禁填入管理员渠道详情、供应商凭证、地址或任何 API Key。默认规则为空，新增别名需要维护者核对后重新构建；这不是自动探测能力的接口。

目录过滤和每次选择后的 Key 所属权复核继续沿用 Stage A。配置不会扩充模型目录、修改白名单、分组、路由或账号权限；每次发送仍只调用一个原有网关入口。浏览器不会在失败后切协议、换 Key 或自动重试。现有网关内部已有的调度、探测和重试策略保持原样，本轮不声称消除了服务端既有重试行为。

## SSE 与完成状态

| 协议 | 正文和进展 | 完整完成条件 |
| --- | --- | --- |
| Chat Completions | delta.content；reasoning_content/reasoning 字符串仅更新推理状态，不加入正文或存储 | finish_reason 为 stop，并收到 `[DONE]`；缺少 finish、缺少结束标记、length、过滤、工具及空正文均不算完整回答 |
| Responses | response.output_text.delta；created/in_progress/queued、reasoning item 和 reasoning 文本事件更新阶段；completed 内正文不重复追加 | 收到 response.completed，response.status 必须为 completed，且没有 error/incomplete_details；检查最终 output 项和状态，工具、非文本、拒答、incomplete、failed、cancelled 分别进入受控错误或受限状态 |
| Anthropic Messages | content_block_start 的 text、content_block_delta 的 text_delta；thinking/redacted_thinking、thinking_delta/signature_delta 更新活动；ping 仅维持网络活动 | message_delta 中 stop_reason 为 end_turn 或 stop_sequence，随后 message_stop；只有 message_stop 不能成功，tool_use、max_tokens 等不作为完整文本回答 |

对应的官方协议依据：[OpenAI Responses 流事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[Anthropic Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)。实现与本项目网关转换后的 SSE 一并核对，未据此宣称真实供应商兼容性已验收。

解析使用流式严格 UTF-8 解码；支持多行 data、注释、UTF-8 字符跨块、CR/LF 跨块和无末尾空行。单事件累计 data 与未结束行均有 2,000,000 字符保护。非法 JSON、乱码、非 SSE 响应、提前 EOF、网络错误和上游错误均保留已有文本，标记失败或中断。HTTP 200 和连接关闭本身不等于成功。

未知事件不延长有效进展预算；已知工具、音频、图片或其他非文本输出项明确受限。当前没有工具执行、多模态回答或思维链展示；不会把推理文本混为正文。接收到的流事件和敏感上游错误原文不写入持久化，仅保存白名单内的错误代码。

## 超时配置与依据

配置入口为构建变量 `VITE_CREATION_CHAT_TIMEOUTS`，JSON 对象，单位毫秒；只覆盖指定字段。未配置时使用下表，非法字段或超出范围时阻止发送。每个字段最小 1 秒，可单测注入 ChatClock，生产使用 performance.now 单调时间。

| 配置字段 | 默认值 | 配置上限 | 重置条件 |
| --- | --- | --- | --- |
| headers | 120,000（2 分钟） | 300,000（5 分钟） | 不重置，从发送至 HTTP 响应头；浏览器 Fetch 无法再独立拆分 DNS、TCP、TLS 和上游首响应 |
| idle | 120,000（2 分钟） | 300,000（5 分钟） | 响应头后收到任何实际网络字节，包括心跳、注释和非文本事件 |
| progress | 600,000（10 分钟） | 1,800,000（30 分钟） | 有效正文、非空推理或已识别的进展事件；普通心跳、注释及未知事件不重置 |
| total | 1,800,000（30 分钟） | 3,600,000（60 分钟） | 从请求开始的硬上限，任何活动都不重置 |

这些默认值和上限是本轮客户端保护策略，不是供应商 SLA 或模型运行时长保证：首响应和网络空闲保留旧 120 秒保护量级；进展等待放宽至 10 分钟，允许推理期间没有正文；总时长限制防止持续事件无限占用前台请求。上限用于限制维护者误配置造成的长时间等待。到达任一最早截止点即取消本次读取；后台标签页导致计时器延迟时，迟到事件也不能复活已经过期的请求。

配置示例：`{"headers":120000,"idle":120000,"progress":600000,"total":1800000}`。本轮没有修改实际生产环境变量、网关配置或用户 Java 环境变量；构建仅在临时命令进程使用既有 CANVAS_BUN 路径。用户可随时主动停止，立即标记部分回答中断；这是浏览器端取消，不代表已经获得上游停止扣费的确认。

## 上下文与本地数据保护

每次请求重新组织完整历史，只包含完整 system、完整 user/assistant 轮次和一次当前问题。中断、失败、未完成回答及其旧问题被排除。重新生成仅替换最后一轮助手消息，保留原问题及更早轮次；切换模型、Key 后继续同一会话，但在途请求仍使用原快照。

保留 48,000 字符的发送保护和 500,000 字符的单回答上限；字符数不等于 Token 数，模型真实窗口可能更低。超限明确提示并保留草稿，不静默删除用户历史。Messages 保留 max_tokens=4096 的既有请求参数，本轮没有加入新的输出长度设置或续接 ID。

保留数据库 `sub2api-creation-chat-v1-user-{用户ID}` 和原 schema，不迁移到云端。保存模型、Key ID、自动/手动偏好和请求协议枚举，不保存密钥、Authorization、请求对象或推理原文。恢复时 streaming 统一变为 interrupted/disconnected，不能变为 complete。写入事务仍按顺序提交，删除排在旧写入之后，避免被迟到保存复活。

存储读写失败展示提示，并保留当前内存对话；不能保证在浏览器崩溃、磁盘损坏或存储被清理后仍恢复全部内容。检查点间及尚未提交事务内的内容可能丢失。同账户多标签同时编辑同一会话仍采用最后写入结果，没有实现内容合并；这与跨用户隔离是不同边界。

## 验证结果与证据

| 检查 | 结果 |
| --- | --- |
| Vue 定向 Mock 和既有界面/登录/图片桥接/语言回归 | 13 个测试文件，143 项通过，0 失败；`unit-results.json` |
| Canvas 原有完整测试 | 10 个文件，57 项通过，0 失败，包含 P1 参数、存储、桥接及既有视频纯单测；没有调用视频接口 |
| P2 本机浏览器综合验收 | 25 组通过，运行时异常 0；`browser-results.json`，涵盖三协议、推理/工具受限、会话、换 Key、换号、Markdown、四尺寸和键盘模拟 |
| P1 图片完整浏览器回归 | 25 组通过，运行时异常 0；`p1-regression/browser-results.json`，独立本机 Mock 端口 18089 |
| 类型与构建 | Vue TypeScript 随生产构建通过，最终双前端 `pnpm --dir frontend run build:all` 完成；`build-final.log` |
| ESLint | 本轮修改的 TypeScript、Vue、测试与语言文件通过；`lint-final.log` |
| 后端 Go | 后端业务源码未修改；当前 PATH 没有可用 Go，本轮未执行 Go 测试，不宣称后端测试通过 |
| 编码与保护 | 本轮源码 UTF-8 无 BOM；范围外文件与回滚原件通过 SHA-256 核对，见 `protection.json` |

Mock 覆盖三类正常流，心跳/注释/分块/多行 data/跨块 UTF-8，非文本推理和状态、只有心跳、慢首字、真实网络空闲、总时长、正常完成/提前 EOF/网络异常/上游错误，停止保留部分回答、停止后重生成、多轮去重、显式别名规则、模型/Key 快照、会话旧请求隔离、用户/IndexedDB/跨标签隔离、401/403/429/余额不足/非法响应以及 Markdown XSS。超时用注入时钟或浏览器时钟快进，未实际等待数分钟。

P1 完整回归包括文生图、参考图编辑、下载、透明 PNG/质量/尺寸参数、批量部分失败、无效图片与 HTTP 200 错误、401/403/429/余额不足/断网/超时、Key 热切换、画布节点刷新恢复、共享媒体删除保护、存储写满/读取不可用以及用户隔离。原 P1 报告、脚本、截图和回滚材料均保留，新结果放在 P2 证据目录。

构建保留原有 chunk 大小、Browserslist、Canvas config.js 以及静态/动态重复导入提示。本地迭代曾在单独 Vue 构建后缺少 Canvas 产物，已通过最终双前端构建恢复；验收以最终完整输出为准。

### 界面截图

1920×1080、1536×864、1366×768、390×844 均检查消息独立滚动、输入框可见和页面无横向/纵向溢出；同目录保留 V5 原型截图。手机键盘通过 VisualViewport 高度 544 的遮挡模拟验证，不替代真实 iOS/Android 键盘验收。

![P2 桌面聊天](D:/workspace/code/sub2api/.codex/creation-p2-evidence/actual-chat-1536x864.png)

![P2 手机聊天](D:/workspace/code/sub2api/.codex/creation-p2-evidence/actual-chat-390x844.png)

![P2 手机键盘遮挡模拟](D:/workspace/code/sub2api/.codex/creation-p2-evidence/keyboard-mobile.png)

慢首字与超时截图：[首字较慢](D:/workspace/code/sub2api/.codex/creation-p2-evidence/slow-first-text.png)、[网络空闲超时](D:/workspace/code/sub2api/.codex/creation-p2-evidence/network-idle-timeout.png)。

![P2 推理状态](D:/workspace/code/sub2api/.codex/creation-p2-evidence/reasoning-desktop.png)

P1 本轮回归截图：[桌面图片工作台](D:/workspace/code/sub2api/.codex/creation-p2-evidence/p1-regression/image-1536x864.png)、[手机图片工作台](D:/workspace/code/sub2api/.codex/creation-p2-evidence/p1-regression/image-390x844.png)、[横屏](D:/workspace/code/sub2api/.codex/creation-p2-evidence/p1-regression/image-844x390.png)。截图的图片、模型回答及余额均是本机 Mock 数据。

### 本地验收入口

[P2 Mock 聊天](http://127.0.0.1:18088/ai-creation/chat)。模拟账号 canvas101@example.test 或 canvas202@example.test，密码 CanvasPreviewOnly123!；新浏览器先通过现有登录表单进入。

启动：`node tools/creation-p2-preview.mjs`。预览仅监听 127.0.0.1:18088，只接受固定模拟 Key，未开放的 `/v1/*` 一律拒绝，没有外网转发逻辑。浏览器脚本另行阻断全部非本机请求。

可输入 `[reasoning]`、`[heartbeat]`、`[idle]`、`[tool]`、`[slow]`、`[disconnect]`、`[stream-error]`、`[http:401]`、`[http:403]`、`[http:429]`、`[http:402]`、`[xss]` 验收相应状态；该 Mock 不证明真实模型可用。

## 修改文件清单

以下路径均相对于 `D:\workspace\code\sub2api`，精确前后摘要与新增标记见 `.codex/creation-p2-evidence/owned-files.json`。

| 范围 | 文件 |
| --- | --- |
| 协议/请求/上下文 | `frontend/src/lib/creation-chat.ts`、`frontend/src/lib/creation-chat-config.ts` |
| SSE/超时 | `frontend/src/lib/creation-chat-stream.ts`、`frontend/src/lib/creation-chat-timeout.ts` |
| 会话与选择 | `frontend/src/composables/useCreationChat.ts`、`frontend/src/composables/useCreationSelection.ts`、`frontend/src/lib/creation-chat-db.ts` |
| UI 与 Markdown | `frontend/src/components/chat/CreationChat.vue`、`frontend/src/components/chat/ChatMarkdown.vue`、`frontend/src/styles/creation-chat.css` |
| 文案 | `frontend/src/i18n/locales/zh/imageStudio.ts`、`frontend/src/i18n/locales/en/imageStudio.ts` |
| 协议/存储/超时测试 | `frontend/src/lib/__tests__/creation-chat.spec.ts`、`creation-chat-p2.spec.ts`、`creation-chat-timeout.spec.ts`、`creation-chat-db.spec.ts` |
| 生命周期/选择/渲染测试 | `frontend/src/composables/__tests__/useCreationChat.spec.ts`、`useCreationSelection.spec.ts`、`frontend/src/components/chat/__tests__/ChatMarkdown.spec.ts` |
| 本机验收与保护 | `tools/creation-p2-preview.mjs`、`tools/creation-p2-browser-test.cjs`、`tools/creation-p2-verify.py` |
| 报告 | `canvas/P2_REPORT.md` |

共 23 个范围内文件；未增加依赖，没有修改图片业务源码、V5 外壳、用户中心、视频或 KOKO 实现。共享选择器仅新增已保存 Key 失效提示和本地登录信息读取失败处理，已包含在 P1 回归中。

## Mock 不能证明的范围与 P3 建议

1. 本轮无法证明真实供应商首字延迟、所有别名、调度账号、转换后完整输出及真实用量/扣费正确。标准家族默认入口和显式规则必须在维护者核对实际配置后，再按获准范围进行真实验收。
2. 客户端超时或取消不能证明网关/上游已停止计算或计费，也不能证明服务端既有重试行为不会产生费用。生产反向代理、CDN、浏览器后台节流和长连接策略可能更早终止流，本轮没有改变这些配置。
3. 浏览器虚拟尺寸和 VisualViewport 模拟不能替代真实手机输入法、旋转、缩放、系统挂起和断网恢复测试。长文本优化是渲染策略及 Mock 验证，不是对所有低端设备的性能承诺。
4. 当前只支持文本对话。工具、非文本、拒答或截断均保留部分文本并明确受限；未实现工具执行、附件、云同步、导出界面或同账户多标签合并。
5. P3 必须另行获得测试用户、Key、模型、允许接口及预算授权。先为测试 Key 设置独立额度和小并发，书面确定单笔与总预算；只串行请求，每笔结束核对账单后再继续，失败不自动重试。
6. 建议先每种协议执行一个短问题和一次多轮追问，再分别验证一个明确配置别名、一次停止、一次重生成与切 Key；图片仅按另行批准范围做一张文生图和一张参考图编辑。优先选择允许低输出上限的模型，按已核实接口参数限制输出，不用超长推理作为首个收费案例。
7. 每笔记录请求 ID、用户/Key ID、请求模型、映射模型、分组与实际调度账号、输入输出及推理用量、倍率、余额/额度前后差与账单。开始下一笔前估算其最坏费用，无法估算则暂停；达到预算、结果不确定或取消费用不明时立即停止，不自动进入下一项。

上述仅为 P3 验收建议，本轮没有执行任何一项真实请求。

## 回滚与保护

实施前原件位于 `.codex/creation-p2-baseline/original/`，全范围源码摘要位于同目录 `manifest.json`；本轮补丁为 `.codex/creation-p2-evidence/p2.patch`。保护检查命令：`python -X utf8 tools/creation-p2-verify.py`。

回滚前逐文件确认当前 SHA-256 仍等于 `owned-files.json` 的 after_sha256；如有后续修改，先另存，禁止覆盖。只恢复 new=false 文件对应的 P2 原件，只移除清单中 new=true 的本轮新增文件；保留报告、补丁及所有历史备份作为回滚材料，再执行双前端构建。不要使用整仓 reset/clean，也不要恢复到 Stage A/B 或 P1 之前的状态。回滚默认不删除 IndexedDB 会话和图片作品。

范围核对排除依赖、构建 dist、证据目录和三项 TypeScript 构建缓存；其他源码以本轮开始前的摘要为准。没有覆盖既有未提交修改，Stage A/B、P1、Midnight HUD、后端既有修改和全部历史回滚材料均保留。

**P2 已交付至本地用户验收点，等待验收；不会自动进入 P3。**
