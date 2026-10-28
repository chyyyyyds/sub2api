# AI 创作中心 P1 图片创作交付报告

本轮完成图片链路加固及本机 Mock 验收，停在 **P1 用户验收点**。没有进入 P2/P3，没有收费生成、提交、推送、部署或生产操作。保留 Infinite Canvas、视频源码、视频直达路由、C1 报告及数据库设计；没有修改 KOKO Provider、New API 原项目或现有网关业务。

## Stage A/B 针对性只读检查

以下检查针对图片入口、共享选择器、桥接、图片请求、存储以及聊天协议/SSE/会话生命周期，没有重新开展全面审计。

| 分类 | 检查结果 |
| --- | --- |
| 已实现且有自动化覆盖 | 用户 Key 所属权、失效/耗尽过滤、模型目录刷新、自动/手动选择、窗口来源和会话握手、跨标签换号销毁；聊天上下文、重生成去重、停止保留部分输出、IndexedDB 分用户、Markdown 安全均已有单测，本轮相关回归 74 项通过。 |
| 已实现但只有 Mock 端到端证据 | 图片生成、编辑、下载和历史；聊天三种协议请求与 SSE、停止和会话操作。既有 Stage A/B 报告及本轮测试都不能作为真实供应商或扣费验收。 |
| 真实使用可能出问题 | 图片切换配置重建 iframe、统一图片参数、请求模型编码未统一转换、存储异常静默/未捕获、删除日志误删共享图片。P1 已处理。聊天按名称选协议、120 秒仅文本增量超时、长推理事件/心跳处理不足，留待 P2。 |
| 正式可用性仍需补齐 | 自定义别名/其他图片型号的明确能力与网关映射核对；聊天明确协议能力来源和可配置超时；真实模型结果、渠道、用量及扣费核对。未知能力不展示为已验证支持。 |

## P1 行为变化

- 同一用户热更新模型和 Key，不重建 iframe，保留提示词、结果、当前画布 URL 和节点。重新鉴权时暂停旧凭证和请求；换号仍销毁旧文档。每次配置使用新的会话标识，迟到响应不能覆盖新配置。
- 沿用当前用户 Key 的 `/v1/models` 目录和原有匹配规则。手动 Key 只显示其授权目录；不兼容时调整模型或明确提示。没有读取管理员渠道凭证。
- 宿主图片请求单独进入同源 `/v1/images/generations` 或 `/v1/images/edits`，不执行模型脚本、供应商原生直连或本地代理。将 Canvas 内部的渠道编码转换为真实模型名，并检查提交模型、Key、宿主会话一致。单项取消信号与宿主失效信号合并。
- 已核对能力配置覆盖 `gpt-image-1`、`gpt-image-1-mini`、`gpt-image-1.5`、`gpt-image-2`、`gpt-image-2-2026-04-21`。这是参数配置和 Mock 通过范围，**不是这些型号已通过真实请求验收**。未来版本和自定义别名必须明确增加配置，不能靠名称前缀自动继承能力。
- 旧型号只提供自动与三种标准尺寸；GPT Image 2 沿用网关已覆盖的自定义尺寸约束。质量和像素分辨率分开设置；自动值省略。透明背景只在已核对的旧型号开放并发送 PNG，GPT Image 2 暂不宣称已验证透明支持。切换模型时调整不兼容参数并提示，提交前再次校验。
- 保持原工作台 1～10 张的批量范围，每张单独请求、单独进入原有计费链。部分失败记录为 `partial`，显示实际成功/失败张数，不把空结果、无效图片、HTTP 失败或 HTTP 200 内错误当作成功。不自动重试收费请求。
- 参考图按已核对协议限制为最多 16 张 PNG/JPEG/WebP；上传参考图和将结果再次加入参考图，使用原 `/images/edits` 接口。没有新增遮罩涂抹编辑器，也没有替换 Infinite Canvas。
- 生成记录增加提交时的用户空间、Key ID/名称与透明背景参数；保留实际模型名。旧记录缺少归属时显示“归属未记录”。这些字段均不是明文 Key。
- 结果可下载，并可选择新项目或已有项目“放入画布”；仅追加图片节点。删除生成日志不再删除可能被画布/素材共享的底层图片。主页面刷新后从项目列表可恢复已有项目，切换模型/Key 保留当前项目。
- IndexedDB 使用固定用户空间且禁止退回其他持久化存储。故障显示持续、脱敏提示；读失败或画布状态损坏后阻止覆盖历史。生成成功但存储写满时保留可下载的内存作品，明确提示尚未保存；恢复存储后刷新重试。宿主项目保存不再等待原来的 400ms 防抖。
- 视频入口默认隐藏，可通过 `VITE_CREATION_VIDEO_ENABLED=true` 恢复；`/ai-creation/video` 仍可直达原外壳，不提交任务。

能力依据：本仓库 `backend/internal/service/openai_images.go`、图片适配/尺寸测试，以及 [OpenAI 图片指南](https://developers.openai.com/api/docs/guides/image-generation) 和 [Images 接口定义](https://developers.openai.com/api/reference/resources/images/methods/generate)、[编辑接口定义](https://developers.openai.com/api/reference/resources/images/methods/edit)。供应商能力不等于某条实际渠道已开通；实际渠道能力待 P3 验证。

## 权限、费用与错误

没有改动网关、白名单、分组、倍率、余额、额度或调度。只读核对确认 Images 路由仍经过 API Key 鉴权、分组模型准入及原有路由分发；`openai_images.go` handler 保留计费资格检查、在途余额预留，以及成功转发后的强制用量记账任务。常规转发错误返回原有失败分支；取消/超时可能与上游执行或记账完成竞态，不能据此推断一定不收费或退款。

沿用既有图片请求 10 分钟超时，没有新设生产超时值。HTTP 错误、网络断开、超时、配置切换和无效响应分别提示；不展示上游正文、私有 URL、凭证或堆栈。浏览器下载/存储失败也不代表网关生成失败或退款。

Mock 证据中的 `usage: null`、`charge: 0` 和“本机 Mock”渠道只表示模拟器没有收费，**不能用于证明生产计费正确**。

## 自动化与构建

| 检查 | 结果 |
| --- | --- |
| Vue 图片桥接、共享选择、聊天协议/上下文/IndexedDB/控制器/Markdown、HUD 导航回归 | 7 文件，74 项通过 |
| Canvas 原有回归、新增参数能力及存储保护测试 | 10 文件，57 项通过；包含既有视频纯单测，未调用 Provider |
| 图片浏览器验收 | 25 组通过，运行时异常 0，外网全部阻断 |
| Vue / Canvas TypeScript、改动 Vue/TS 文件 ESLint | 通过 |
| 双前端生产构建 | `pnpm --dir frontend run build:all` 通过；保留既有 chunk 大小、config.js、重复导入及 Browserslist 提示 |
| 源码保护、回滚原件、UTF-8 无 BOM | 见 `protection.json`，逐文件验证 |

浏览器覆盖：文生图、单参考图编辑、透明 PNG 请求、真实模型名/Key 归属、下载、批量部分失败、非法尺寸/未知能力阻止提交、401/402/403/429/500、空结果、HTTP 200 内错误、坏图片、断网、超时、切 Key 取消、存储写满、读失败、图片入画布、原项目追加节点、删除日志后项目图片仍可读、刷新恢复、换号隔离，以及 1536×864、390×844、844×390 布局。模拟超时只在测试浏览器中缩短 XHR 等待，生产仍为原 10 分钟。

证据目录：`D:/workspace/code/sub2api/.codex/creation-p1-evidence/`。其中 `browser-results.json` 保存脱敏模拟请求的模型、Key ID、参数与文件类型/大小。构建和单测日志也汇总在该目录。

## 本地验收

地址：[P1 图片创作](http://127.0.0.1:18087/ai-creation/image)。预览仅监听本机，无任何向外转发逻辑；未开放接口拒绝处理，真实 Key 不被模拟器接受。

账号：`canvas101@example.test` 或 `canvas202@example.test`，密码 `CanvasPreviewOnly123!`。新浏览器先通过现有登录表单进入。

普通提示词返回固定本地 PNG；输入 `[http:401]` / `[http:402]` / `[http:403]` / `[http:429]` / `[http:500]`、`[empty]`、`[error200]`、`[invalid-image]`、`[drop]`、`[slow]` 可验收相应异常。张数设为 3、输入 `[partial]` 可观察第二张模拟失败。存储故障通过独立自动化浏览器注入，不能把演示脚本用于正式浏览器。

重启：在仓库根目录运行 `node tools/creation-p1-preview.mjs`。构建与测试使用既有本地 Bun 路径，仅设置当前 PowerShell 进程的 `CANVAS_BUN`，不修改系统环境变量。

截图：

- [桌面](../.codex/creation-p1-evidence/image-1536x864.png)
- [手机](../.codex/creation-p1-evidence/image-390x844.png)
- [横屏](../.codex/creation-p1-evidence/image-844x390.png)
- [画布项目](../.codex/creation-p1-evidence/canvas-project.png)
- [存储写满](../.codex/creation-p1-evidence/storage-warning.png)
- [存储读取失败](../.codex/creation-p1-evidence/storage-unavailable.png)

截图中的图片和余额均为本机 Mock 数据；布局继续沿用 V5 与 Midnight HUD。已检查截图，无页面横向溢出；手机图片工作台内容采用滚动，未改造聊天布局。

## 修改文件与回滚

精确文件列表、前后 SHA-256、新增标记见 `.codex/creation-p1-evidence/owned-files.json`；本轮差异见 `p1.patch`。

| 范围 | 文件（相对仓库根目录） |
| --- | --- |
| Vue 入口与桥接 | `frontend/src/views/user/ImageStudioView.vue`、`frontend/src/components/canvas/EmbeddedCanvasStudio.vue`、`frontend/src/lib/canvas-host-bridge.ts`、桥接组件测试 |
| Canvas 配置与请求 | `canvas/web/src/lib/sub2api-context.ts`、`sub2api-bootstrap.ts`、`host-image-capabilities.ts` 及测试、`canvas/web/src/services/api/image.ts` |
| 图片和存储交互 | `canvas/web/src/components/image-settings-panel.tsx`、`canvas/web/src/pages/image/index.tsx`、`canvas/web/src/services/image-storage.ts`、`canvas/web/src/stores/canvas/use-canvas-store.ts` |
| 本地存储与提示 | `canvas/web/src/lib/scoped-localforage.ts`、`localforage-storage.ts`、`host-storage-status.ts` 及测试、`canvas/web/src/components/layout/app-providers.tsx` |
| 验收与文档 | 三个 `tools/creation-p1-*` 脚本、本报告、Canvas CHANGELOG、pending-test、todo |

原有文件在改动前逐份备份到 `.codex/creation-p1-baseline/original/`；全范围源码摘要在 `manifest.json`。范围外源码、C1 报告、视频实现和后端源码保持原样；生成的 dist、TypeScript 缓存和证据目录单独排除。

回滚前先确认每个待恢复文件当前摘要仍等于 `owned-files.json` 的 `after_sha256`；已有后续编辑则先另存，禁止覆盖。只恢复清单中原有文件对应的备份、移除本轮新增文件，再重新构建；不要整仓 reset/clean。回滚不自动删除 IndexedDB 用户作品。检查命令：`python -X utf8 tools/creation-p1-verify.py`。

## 遗留边界及 P2/P3 建议

1. 自定义图片别名、Flux、DALL·E、Gemini、Grok 等没有本轮可确认的完整能力映射，目录可见但明确未验证并阻止生成。不能仅凭别名猜测后端实际模型；后续应由现有网关明确映射或受控能力配置解锁，不能放宽服务端权限。
2. 没有真实图片输出、实际用量、分组倍率、渠道可用性和取消费用验收。只读后端检查及 Mock 不能替代这些结论。本机没有可用 `go` 命令，本轮没有执行后端测试；后端无修改。
3. 作品仅在当前浏览器，无云同步；浏览器进程崩溃、清理数据或尚未完成的 IndexedDB 事务仍可能造成未保存内容丢失。存储失败时内存图片须及时下载。删除日志保留共享媒体可能增加本地空间占用，后续垃圾回收必须核对项目和素材引用。
4. P2 再处理聊天协议：复用现有模型映射/渠道及明确能力，不自动按别名猜测或换协议重发。区分网络空闲、SSE 心跳/推理进度与总时长；先明确可配置策略，再实现，不静默增加超时默认值。补充长思考、停止、重生成、旧会话迟到响应和 Key 切换的异常 Mock。
5. P3 仅在用户分别给出测试 Key、模型、允许接口和费用预算后执行。每次串行短请求：图片文生图→参考图编辑→下载；聊天普通文本→Responses/Codex→自定义别名→多轮→停止与切 Key。逐笔比对请求 ID、用户/Key ID、请求模型、映射模型、分组与渠道/账户、输入输出用量、倍率、余额/额度前后差和实际账单。取消/失败/超时单列核对，达到预算立即停止，不自动重试。

**当前等待 P1 验收，不自动进入 P2 或真实接口测试。**
