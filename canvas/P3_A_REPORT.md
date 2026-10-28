# Sub2API AI 创作中心 P3-A 真实接口联调准备

**停在 P3-A 验收点；未进入 P3-B。真实收费聊天、图片生成、图片编辑请求均为 0，新增模型费用为 0。**

本轮只核对当前实现、实际 Sub2API 配置、授权目录和已有账单，准备只读入口及后续验证方案。没有调用供应商推理、模型健康探针或账号连接测试，没有修改任何业务数据库、生产渠道、用户余额、倍率、New API、视频实现，也没有提交、推送、部署。已有未提交修改保留。历史账单只作为配置和计量参考，不能算本轮生成验收。

## 1. 结论与证据范围

当前可以安全复核真实目录和倍率，但**没有已经满足全部条件、可以立即执行收费端到端测试的身份组合**。主要阻塞是：独立环境 Key 已过期或停用；生产可读 Key 未限额；独立环境没有图片渠道；工作台缺少聊天输出 Token 限额；服务端可能探测、重试或切换 Account。

读取 `P1_REPORT.md`、`P2_REPORT.md` 后，仅检查创作选择器、聊天请求及 SSE、宿主图片桥接/能力与存储、网关准入、协议转换、调度、模型映射和计费相关实现，没有重复全面 Stage A/B/P1/P2 审计。

主要依据：

- 前端：`frontend/src/composables/useCreationSelection.ts`、`frontend/src/lib/creation-chat{,-config,-stream,-timeout}.ts`、`frontend/src/components/canvas/EmbeddedCanvasStudio.vue`、`frontend/src/lib/canvas-host-bridge.ts`，以及 `canvas/web/src/lib/host-image-capabilities.ts`、`canvas/web/src/services/api/image.ts`。
- 网关：`backend/internal/server/routes/gateway.go`、Key/分组模型准入中间件、`account.go`、`upstream_protocol_routing.go`、`model_protocol_catalog.go`、`openai_model_mapping.go`、`openai_gateway_chat_completions.go`、`openai_gateway_messages.go`、`openai_gateway_response_handling.go`、图片 handler/service。
- 计费：`model_pricing_resolver.go`、`billing_service.go`、`openai_gateway_usage.go`、`channel_service.go`、`gateway_key_billing.go`、现有账单表和 Key 额度字段。
- 当前快照：`.codex/creation-p3a-evidence/readonly-snapshot.json`，含服务器 UTC 核对时间；数据库查询均使用 `BEGIN READ ONLY`、5 秒 statement timeout、`ROLLBACK`。不保存邮箱、密码、Token、完整 Key 或账号 credentials。
- 前后快照对比：`safety-checks.json`确认所核对的生产/Stage7用户与Key状态、余额、分组倍率、渠道/Account模型配置、价格及最近账单均保持一致；不是对其他用户全库并发活动的断言。实际拓扑、Nginx和Go镜像版本见`environment-checks.json`。

## 2. 当前实际模型清单

生产候选身份为**用户 ID 2 / Key ID 1 / 分组 ID 2**。服务器进程内读取该用户 Key 后，只发送以下两个 GET：

| 目标 | 结果 | 能证明的内容 |
| --- | --- | --- |
| `http://127.0.0.1:18083/v1/models` | HTTP 200 | 此 Key 当前目录可读 |
| `http://127.0.0.1:18083/v1/sub2api/billing` | HTTP 200 | 实际 token 倍率可读；不是价格表或余额接口 |

目录为：`codex-auto-review`、`gpt-5.3-codex-spark`、`gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-6-astra`、`gpt-6-sol`、`gpt-6.1-sol`、`gpt-image-2`、`gpt-image-2.5`。目录可见不保证上游此刻能成功推理。

| 用途 | 请求模型 → Account 映射模型 | 候选渠道 / Account | 目前状态 |
| --- | --- | --- | --- |
| 普通 Chat Completions | `gpt-6-sol → gpt-6-sol` | 渠道 1；Account 1 或 2 | 当前 Key 目录可见；候选首测模型，尚未真实调用 |
| Responses/Codex | `gpt-5.3-codex-spark → 同名` | 渠道 1；Account 1 或 2 | 目录可见；前端默认 Responses；尚未真实调用 |
| 其他短文本备选 | `gpt-5.6-terra → 同名` | 渠道 1；Account 1 或 2 | 已有历史 Messages→Responses 账单，不等于当前工作台验收 |
| 自定义别名 | `codex-auto-review → gpt-6.1-sol` | 渠道 1；Account 1 或 2 | 映射存在，但前端没有明确入站协议规则，**暂不执行** |
| 单张生成与编辑 | `gpt-image-2 → gpt-image-2` | 渠道 1；Account 9 | 图片权限及映射存在；两类图片接口均待真实验证 |
| 暂不选择 | `gpt-image-2.5 → gpt-image-2.5-flare` | 渠道 1；Account 9 | 前端 P1 显式能力清单未覆盖，不能因目录可见而解锁 |
| Claude Messages | 原生 Claude 渠道 5 / Account 8、分组 1；另有 Account 11、分组 6 | 当前 Key 所属分组 2 不覆盖这些原生 Claude 账号 | 不读取其他用户的 Key；不扩大当前用户权限；本次不安排原生 Claude 收费项 |

渠道 1 的 `model_mapping={}`，`billing_model_source=channel_mapped`，`restrict_models=false`。因此必须继续区分请求名、渠道映射名、账号映射名、上游响应自报模型和计费模型，不能认为三者一定相同。特别是别名：没有渠道改名也仍可能被 Account 改名。

## 3. 用户 Key、分组与健康核对（脱敏）

| 环境及身份 | 状态与金额（美元） | 权限与结论 |
| --- | --- | --- |
| 生产用户 2 / Key 1 / 组 2 | 用户 active；余额 `9.72041527`；冻结余额 0；Key active；无到期时间；`quota=0`，窗口限额也均为 0 | `quota=0` 表示未设置额度上限，不是零额度；**不能作为本轮受限测试 Key**。没有修改它或消耗余额 |
| 生产历史测试用户 27、29 | disabled 且软删除；相关 Key 42–47 disabled 且软删除 | 不恢复，不复用，不重置余额 |
| Stage7 用户 2 | 普通用户 active；已有余额 `0.74054397`；并发 3 | 独立测试库中的历史值；未充值、未伪造余额，余额来源/是否反映真实供应商结算仍需确认 |
| Stage7 Key 1 / 组 2 | 已删除、inactive、已过期 | 不可用 |
| Stage7 Key 2 / 组 2 | inactive，quota 0.05；到期 2026-10-30 16:08（北京时间） | 未过期但停用，不可用 |
| Stage7 Key 3 / 组 2 | active，quota 0.05，已用 0.00856283；已于 2026-10-24 到期 | 剩余额度不等于当前可调用；不可用 |
| Stage7 Key 4 / 组 3 | active，quota 0.05，已用 0.00086548；已于 2026-10-24 到期 | 不可用；可作为未来受限 Key 切换身份候选 |
| Stage7 Key 5 / 组 8 | active，quota 0.05，已用 0.00002772；已于 2026-10-24 到期 | DeepSeek 组；本轮不增加覆盖范围 |

生产组 2 为 OpenAI 特惠组：token 基础倍率 `0.085`；用户 2 没有专属分组倍率覆盖；高峰倍率关闭。倍率 GET 返回的 resolved/effective 倍率也是 `0.085`。`claude_code_only=false`，`allow_messages_dispatch=true`，fallback group 均为空，模型路由关闭。

现有模型准入主要绑定分组，Key本身的额度与IP字段不能代替模型白名单。Stage7组2/3已经限制为单一模型，适合作为最小聊天权限基础；不能给生产组2的Key只加额度后便宣称只允许一个模型。

组 2 的模型白名单保存了若干名称，但 `enabled=false`；这些名称不是一份已生效的准入白名单。本轮没有开启、扩大或重写它；实际展示仍按此 Key 的 `/v1/models` 结果。当前 Key 没有 IP 白名单/黑名单限制。

生产 Account 1、2、9 均 active、schedulable，无错误标记，无已配置的到期、限流恢复、overload 或临时不可调度时间。Account 1/2 的账号成本倍率分别为 0.042/0.048，Account 9 为 1；**账号成本倍率不能乘进用户扣费公式**。这些是静态状态快照，未执行实时供应商健康探针，不能宣称上游余额、资格或连通性已通过。

Stage7 组 2、3 的生效白名单均只允许 `gpt-6-sol`，倍率 `0.065`，没有图片权限；渠道 1 同名映射。Account 1/3 属于组 2，Account 1 属于组 3，均为静态可调度；目录能力标记不完整。本轮未改变任何准入。

## 4. 协议、SSE 和反向代理

### 前端当前配置

`frontend/.env.local` 只有 `VITE_DEV_PROXY_TARGET=http://127.0.0.1:18083`，没有 `VITE_CREATION_CHAT_PROTOCOLS` 或聊天超时覆盖。当前 PowerShell 未向构建注入协议规则，本轮也没有构建或更改配置；源码默认规则为 `[]`。生产构建资源不会运行时读取 `.env.local`，所以不能据此声称既有生产二进制已启用 P2 的协议规则；服务器现有镜像早于本轮准备，未经重新发布核验。

- `gpt-6-sol` 在当前前端使用 `/v1/chat/completions`。
- `gpt-5.3-codex-spark` 使用 `/v1/responses`。
- `codex-auto-review` 当前落入未知别名兼容入口 `chat`，**不存在已经明确配置协议的自定义别名测试项**。后续必须以真实测试用户 ID、Key ID、精确模型名配置经审核的 `responses` 规则，再使用测试构建验证；不把未分配的 ID 填成虚构 ID，也不靠失败后换协议试探。
- Stage7 的 `gpt-6-sol` 可规划普通聊天；如果要用它另测 Responses，需明确的用户/Key/模型规则和对应测试构建。不会把 Responses-only 的测试需求自动扩大到新模型或新渠道。

### 入站与上游转换

Account 1/2 为 OpenAI API Key，`api_protocol` 未显式固定，`openai_responses_supported=true`。按当前源码 `resolveUpstreamProtocol` 推导，普通 chat 入站将进入 Chat Completions↔Responses 转换，上游为 Responses；Codex Responses 入站走 Responses 路径。这里的推导来自账号配置和代码，不仅来自模型名称；现有发布镜像与当前未发布工作树并非同一交付物，运行期仍需用实际账单的入站/上游端点确认，不能把源码推导当成本轮实测。

历史用户 2 账单确有 `/v1/messages → /v1/responses`、请求/上游 `gpt-5.6-terra`、渠道 1 / Account 1、倍率 0.085 的记录。这证明历史转换曾记账，不证明本轮浏览器 SSE 已成功，也不等于原生 Claude Messages。

| 入站协议 | 已核对实现 | P3-B 完整成功条件 |
| --- | --- | --- |
| Chat Completions | 网关转换并刷新 SSE，正常末尾发送 `[DONE]`；错误路径也可能发送结束标记 | 正文非空、`finish_reason=stop` 且收到 `[DONE]`；不能只检查结束标记或 HTTP 200 |
| Responses | 网关提供 `text/event-stream`、`X-Accel-Buffering:no` 并转发/处理 Responses 事件 | 收到合法 `response.completed`、status completed、无 incomplete/error，文本输出完整；网关也识别 `response.done`，但当前前端不把仅有该事件当完整完成，须验证实际渠道事件形状 |
| Claude Messages | 现有转换器会生成 `message_delta`、`message_stop` | stop_reason 为 end_turn/stop_sequence 后出现 message_stop；工具、截断、裸 EOF 不算成功。本轮当前身份不安排原生 Claude 测试 |

图片只经宿主同源 `/v1/images/generations` 或 `/v1/images/edits`，分别 JSON / multipart；不经 Responses 图片工具、不直连供应商。`gpt-image-2` 的生成/编辑前端能力和上游路径在源码及价格目录中存在，真实 Account 9 是否支持参考图编辑仍待收费验收。固定 `n=1`、1024×1024、单张自有 PNG 参考图；不安排批量、透明或高分辨率首测。

### 实际 Nginx

通过运行中容器 `nginx -T` 核对有效 `/etc/nginx/conf.d/sub2api.conf`，上游为 `sub2api-v11-prod-app:8080`：

- `proxy_http_version 1.1`；`proxy_buffering off`；`proxy_request_buffering off`。
- connect timeout 10 秒，read/send timeout 各 3600 秒。read timeout 是相邻读取之间的等待，不是整次请求的总时长。
- 未在该站点或全局配置显式设置 `proxy_ignore_client_abort`、`proxy_next_upstream`；不宣称已禁用全部代理重试。不能拿同目录未被 `*.conf` include 的备份文件作为生效证据。
- gzip 类型列表未含 `text/event-stream`。全局 keepalive timeout 65 秒是连接空闲复用配置，不能解释为 SSE 65 秒硬截止。
- 浏览器默认 headers/idle 120 秒、progress 600 秒、total 1800 秒；图片客户端超时 10 分钟。任一层都可能先断开，尚未通过收费 SSE 实测延迟和断线表现；CDN/其他链路超时也未验证。

部分后端流式路径在客户端断开后继续 drain 上游以收集 usage，因此取消、超时、关闭浏览器均可能有费用。生产未覆盖的配置使用代码默认值：`gateway.max_account_switches=10`、Responses 探针未禁用。Stage7 显式 `MAX_ACCOUNT_SWITCHES=1`、`DISABLE_OPENAI_RESPONSES_PROBE=true`；**1 仍可能允许一次换账号**，并非零重试。handler 对非正数可能回落默认值，不能简单填 0 后宣称无切换。P3-B 前必须核对所有重试层与池模式，不能只保证浏览器不重发。

## 5. Go 环境和后端测试

项目 `backend/go.mod` 为 `go 1.27.3`，根 Dockerfile 默认 `golang:1.27.3-alpine`。本机 PATH 及常见 Go SDK 路径未发现可用 Go；Docker CLI 存在，desktop-linux 引擎管道不存在，未启动或更改用户 Docker/系统环境。

服务器已有 Go 镜像，实际 `go version go1.27.3 linux/arm64`。当前后端 3304 个源码/嵌入文件打包复制到 `/home/ubuntu/sub2api-p3a-isolated-696fb00230f4`，归档传输校验 SHA-256；不采用旧发布源码冒充当前源码。定向测试容器：

`--network none --read-only --cap-drop ALL --security-opt no-new-privileges`，源码及模块缓存只读；独立编译缓存和磁盘临时卷；不挂载数据库、站点数据、Docker socket 或任何凭证。测试容器限制4GB内存、2CPU，Go堆软限制2500MiB；没有扩大业务容器资源。`GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off CGO_ENABLED=0`，仅 `-tags=unit`，不启用 integration 或 stage8q，不执行仓库数据库集成测试。原模块缓存缺少服务层测试依赖，已另建P3-A模块卷；联网准备容器仅从官方Go代理下载并按go.sum校验依赖，不执行测试、不加入业务网络，测试阶段重新断网。

最终结果见 `.codex/creation-p3a-evidence/go-results.json`，通过记录见`go-apicompat.log`。阻塞诊断见`go-resource-diagnostic.json`：runner中止后未完整保留service原始日志，诊断摘要来自本轮工具已返回的stderr观察，不能作为测试执行通过的证据。

| 测试范围 | 结果 |
| --- | --- |
| `internal/pkg/apicompat`，unit标签 | **通过**；465个顶层测试，含子测试共595个通过事件，0失败 |
| `internal/service`，协议路由、模型目录、图片尺寸和定价定向单测 | **编译阻塞，测试未执行**；Ent生成包编译器报`signal: killed`。2GB容器还出现512MB临时空间不足；改为独立磁盘临时卷、4GB内存并限制Go堆后仍被杀，未继续提高资源。未保存独立OOM事件证明，因此准确结论是编译进程被杀，不能判断这些业务测试通过或失败 |
| `internal/handler`，Key倍率与账单信息定向单测 | **未通过/未完成**；最初缺少依赖，资源不足阶段被中止；最终重试在共享Ent依赖处阻塞后停止，不能宣称handler单测执行通过 |
| 数据库/供应商集成测试 | **未执行**；未启用integration标签，无真实数据库连接，无真实推理请求 |

初次执行还曾遇到容器`/tmp`不可执行及SSH正则引用问题，已修正测试启动参数；这些启动失败没有计为测试通过。依赖下载准备成功，后端源码3304个文件的前后摘要一致。当前可用工具链问题已经定位并部分解决，但**完整相关后端测试仍是P3-B前置阻塞**；需资源足够的隔离执行器完成剩余编译与测试，不能依据P1/P2 Mock结论替代。

## 6. 真实环境与 Mock 的区别及已准备入口

| 环境 | 地址/存储 | 现状 |
| --- | --- | --- |
| P2 Mock | `127.0.0.1:18088`；P1 回归 `18089` | 固定测试身份、图片、余额和 SSE，无供应商转发，不作真实价格依据 |
| Stage7 实际网关 | 服务器 loopback `18082`；独立 PostgreSQL/Redis/数据卷及网络 | 与生产数据库和 Redis 分离；已有真实上游账号，但测试 Key 均不可用，仅已核对模型范围可作为后续候选 |
| P3-A 本机准备入口 | `http://127.0.0.1:18090/ai-creation/chat` 或 `/ai-creation/image`；经 SSH tunnel `18092 → 服务器18082` | 提供当前工作台静态产物及固定白名单 GET；顶部显示“真实 Stage7 只读准备”，**无 Mock 生成结果，登录与所有写入也被阻断**；不是已经完成登录的端到端环境 |
| 生产实际网关 | `https://sub2api.chyyds.com`，服务器 loopback `18083` | 本轮服务器侧只读 GET 和只读 SQL；不用于浏览器收费测试，不向浏览器注入生产用户 Key 或管理员凭证 |

新增 `tools/creation-p3a-preview.mjs` 仅监听 127.0.0.1:18090；目标固定为 Stage7 隧道，不读取 `.env.local` 的生产代理目标。所有非 GET/HEAD、管理员接口、非白名单 API 均拒绝；五类生成 POST 与登录 POST 已检查返回本机 403，转发读取计数在这些检查前后保持 0。随后真实 Stage7 公共设置 GET 与聊天页静态 GET 均返回 200。证据 `gate-checks.json`。这些空体 POST 只到本机拒绝门禁，没有到达真实网关。

脚本没有收费解锁开关。批准 P3-B 之前不得移除门禁；不要把端口转到生产、扩大路由白名单或导入正式管理员登录态。当前入口有意不接受登录，无法借此绕过测试身份和输出限额前置条件。

重启准备入口需两个终端，仓库根目录运行：

```powershell
ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -N -L 127.0.0.1:18092:127.0.0.1:18082 -i "$env:USERPROFILE\Desktop\ssh-key-2026-08-08.key" ubuntu@100.65.138.78
```

```powershell
node tools/creation-p3a-preview.mjs
```

只读快照重核：`python -X utf8 tools/creation-p3a-readonly.py`。隔离 Go 测试复现：`python -X utf8 tools/creation-p3a-go-tests.py`。两个脚本均不提供收费推理解锁路径。证据不包含真实密钥。

## 7. 实际价格、单项测试矩阵与预算（仅计划）

### 当前费用依据

以下均为网关当前配置的**美元价格**，不是人民币，也不是供应商官网报价。组覆盖优先于渠道，渠道优先于价格目录/兜底；后续执行前应再读快照防止变价。

| 模型/范围 | 原价（每百万 Token 或每张） | 用户倍率/估价依据 |
| --- | --- | --- |
| 生产 `gpt-6-sol` | 输入 $2、输出 $10、缓存读 $0.20、缓存写 $2.50 | 0.085；仅使用低于272K输入的普通档估价 |
| 生产 `gpt-5.3-codex-spark` | 输入 $1.75、输出 $14、缓存读 $0.175 | 0.085 |
| 生产别名映射目标 `gpt-6.1-sol` | 输入 $2、输出 $10、缓存读 $0.10、缓存写 $2.50 | 0.085；别名自身也有更低的渠道定价，但不能把别名报价当映射后最终扣费承诺，先用较高目标价预算 |
| Stage7 `gpt-6-sol` | 组配置输入 $2、输出 $10、缓存读 $0.20、缓存写 $2.50 | 0.065；只用于现有测试组，不修改为生产倍率 |
| 生产 `gpt-image-2` 生成/编辑 | 组2的1K、2K、4K单张均 $0.08；独立图片倍率开启，倍率1 | 预计每张 $0.08；不是 $0.08×0.085。渠道1无该模型token覆盖；组媒体单价优先。编辑供应商成本及路由仍须实际核对 |

生产容器配置明确加载 `/app/data/model_pricing_overrides.json`，其中也有 `gpt-image-2` 按张 $0.08；基础目录仍保留图片输入/输出 Token 单价，但当前组按张路径优先，不能重复计费。`usage_logs` 中仍须保留实际图片/文本 Token 用于核对。Account 9 成本倍率1与用户图片倍率1恰好相同，概念仍不同。

普通首轮估算输入1000、输出128 Token；二轮输入2000、输出128；Responses/别名输入5000、输出128（给网关注入指令和推理留量）；停止情形按输入5000（最贵普通缓存写单价）、输出/推理合计4096估算。实际短提示也可能产生额外计量，历史已有这种现象；提示词“只答 OK”不是 Token 限制。

### 每项 P3-B 清单

**所有行当前均为未执行/阻塞。** 身份栏中的生产2/1仅是只读价格与映射参照，禁止把未限额的 Key 1 当成已获准收费 Key；实际执行用户/Key ID 必须由独立测试环境分配并填实。Stage7 现有2/3、2/4也是过期候选，须通过普通测试用户的正规 Key 管理流程配置新的受限测试 Key 或完成经审核的续期，不能伪造登录 JWT、重置真实用户密码或直写业务表绕过流程。

每行均应记录：网关 `X-Client-Request-ID`、可用时的 `X-Request-ID`、账单 `request_id` / `upstream_request_id`；**当前均为“未生成”**。实际渠道/Account 当前均为“未路由”，表中只列配置候选；不把 Account 1/2 中某个预写为真实结果。

| 编号/操作 | 用户/Key ID 与环境 | 请求 → 映射模型；目标接口 | 候选渠道/Account；倍率 | 预计费用 / 最高操作预算（USD） | 成功/失败/取消判断 |
| --- | --- | --- | --- | --- | --- |
| T1 普通短聊天 | Stage7用户2，Key3已过期；最终测试KeyID待落实。生产价格参照2/1 | `gpt-6-sol → 同名`；`/v1/chat/completions` | Stage7渠道1/Account1或3，0.065；若另建合规等价测试环境采用生产参照则渠道1/Account1或2，0.085 | Stage7 $0.00021320；生产参照 $0.00027880 / $0.01 | 完整正文+stop+[DONE]，恰好一笔账单；HTTP错误、工具/截断、缺终止为失败；主动取消标中断并待对账 |
| T2 第二轮追问 | 与T1同一落实后的用户/Key，禁止自动换Key | `gpt-6-sol → 同名`；`/v1/chat/completions` | 同T1，实际Account逐笔填写 | Stage7 $0.00034320；生产参照 $0.00044880 / $0.01 | 能复述T1合成随机短词，历史无重复；忘记/混入中断历史失败；取消不视为免费 |
| T3 Responses/Codex | 独立环境当前无可用该模型的测试Key；生产参照2/1，执行身份未分配 | `gpt-5.3-codex-spark → 同名`；`/v1/responses` | 生产参照渠道1/Account1或2，0.085；最终环境需逐字段核对 | $0.00089607 / $0.02 | output_text正常、response.completed合法且账单一致；incomplete/failed/cancelled、只收done/EOF为失败或中断 |
| T4 明确协议的别名 | 当前无明确前端规则与受限测试身份，**跳过直至前置条件满足**；价格参照2/1 | `codex-auto-review → gpt-6.1-sol`；计划 `/v1/responses`，不是当前已配置入口 | 渠道1/Account1或2，0.085；实际计费模型及映射链必填 | 保守 $0.00095880 / $0.02 | 明确规则命中、请求名/上游名/账单名可解释且SSE完成；回落未知兼容入口或映射漂移失败；不换协议补发 |
| T5 切换用户Key | Stage7同一用户2，Key3→Key4均已过期；需落实同用户的两个受限Key。不得使用不同用户Key拼接 | `gpt-6-sol → 同名`；`/v1/chat/completions`，**两笔顺序短请求** | A组2渠道1/Account1或3；B组3渠道1/Account1；0.065。生产等价参照0.085 | Stage7合计 $0.00042640；生产参照 $0.00055760 / 合计$0.02（每笔$0.01） | A结束并对账后手动选B，第二笔归属B且无自动替换；在途切换的取消语义留给T6；身份串用或旧输出串入失败 |
| T6 停止生成 | 与T1同一落实后的受限测试身份 | `gpt-6-sol → 同名`；`/v1/chat/completions` | 同T1；实际Account及全部尝试须追溯 | Stage7估算≤$0.00347490；生产参照≤$0.00454410，**仅在5000输入/4096总输出假设内** / $0.02 | 首段后手动停止，UI保留部分文本并中断、不得标complete；记账可非零。停止后继续入字/自动重试失败；账单未定不继续下一项 |
| T7 单张文生图 | 独立环境无图片权限/Account；受限图片测试KeyID未分配；生产价格参照2/1 | `gpt-image-2 → 同名`；`/v1/images/generations`；n=1，1024×1024 | 生产参照渠道1/Account9，图片倍率1；最终环境待落实 | $0.08 / $0.10 | 返回1张可解码图片、账单image_count=1且扣费一致；空/坏图/200内错误失败；超时/取消均先查上游和账单 |
| T8 单张参考图编辑 | 同T7；沿用合法自有PNG参考图，实际用户/KeyID待落实 | `gpt-image-2 → 同名`；`/v1/images/edits`；n=1，1024×1024 | 同T7；不能仅凭生成可用宣布编辑可用 | $0.08 / $0.10 | multipart被接受，输出1张可解码且符合合成编辑指令的图片、账单可核对；不支持/空/坏图失败；不自动回退文生图 |
| T9 下载/入画布/刷新 | 沿用T7/T8实际用户与生成记录的KeyID，不新增模型请求 | 沿用前两笔请求/映射模型与请求ID；仅下载已返回结果、IndexedDB/Canvas操作 | 沿用原实际渠道/Account/倍率，无新路由 | 新增模型费用 $0 / $0 | 文件可打开、节点/项目刷新仍在且归属正确，生成计数/账单不增加；丢失/错属/触发新生成失败；不因下载失败重跑生成 |

按生产参照累计预计约 **$0.16768417**（含可选别名及停止估算，两张图共$0.16）；若T4不满足则跳过并扣除对应预算。现有 Stage7 不具备两张图和Codex配置，不可把该合计宣称为已经可以在Stage7执行。

建议总授权预算 **$0.50**，上述逐项操作预算合计 **$0.30**，余下 **$0.20只作待定费用和计量偏差准备金，不自动增加请求次数或重试**。仅批准Stage7聊天子集T1/T2/T5/T6时建议先给总预算$0.06，四项操作上限合计$0.06，预计合计约$0.00445770。

这些“最高操作预算”是人工串行放行/停止阈值，**当前实现不具备可证明的单次硬扣费上限**。Chat/Responses请求未发送 max_tokens/max_completion_tokens/max_output_tokens，Messages固定4096；48,000字符限制也不等于Token上限。Key quota一般是准入与累计结算保护，不能假定会把一个在途请求截断在剩余额度内。输出/推理限额及计费路径不能落实时，即使预算获准也应保持该项阻塞，不执行。

## 8. 身份、日志、账单核对步骤

1. 先确认独立测试库、Redis、应用及账号配置。使用已有允许的模型/渠道，不新建虚构渠道，不把生产数据库迁移或恢复到测试库，也不启动会自动迁移生产库的应用。Stage7目前只能准备既有模型的子集。
2. 普通测试用户通过正规接口准备两枚受限聊天Key（建议每枚新增可用额度不超过$0.03、有效期24小时、串行1请求）；图片Key如另有合法隔离环境，建议额度$0.20、仅既有图片模型。**这些是待配置目标，本轮未创建Key、续期、增加余额或放宽模型权限**。新Key必须记录服务端实际ID；不用生产Key1替代。
3. 不从生产管理员登录浏览器。管理员核对只在服务器侧执行，用户工作台只持有本人测试Key；密钥不写脚本、报告、截图、HAR或控制台。只导出路径、模型、参数白名单、Key ID、响应状态和请求ID。
4. 每笔发送前记录用户/Key/组状态、quota与quota_used、余额/冻结额、rate窗口用量、`max(usage_logs.id)`、当前价格和所有倍率；记录实际测试构建的协议规则及输出上限。拒绝自动Key、自动模型切换，固定人工选择，其他标签不发送。
5. **只能从真实用户工作台点击发送/生成**。不以curl直调结果替代端到端。账单核对可使用服务器只读SQL或管理端只读视图；不把管理员Token注入页面。T9只复用已有输出。
6. 网络侧只采集 `X-Client-Request-ID` 和可用的 `X-Request-ID`；前端历史目前不持久化这些ID，不能把会话UUID当网关请求ID。通过脱敏应用日志的 client_request_id ↔ request_id、时间窗口及用户/Key关联账单；取消前无响应头则用本地测试序号+开始时间+Key查日志。不要导出包含Authorization的网络包。
7. 查询新增 `usage_logs`：user_id、api_key_id、group_id、channel_id、account_id、request_id、upstream_request_id、requested_model、upstream_model、upstream_response_model、model、model_mapping_chain、inbound_endpoint、upstream_endpoint、billing_mode、输入/输出/推理与缓存/图片用量、image_count/size、各分项cost、total_cost、actual_cost、rate_multiplier、account_rate_multiplier、service_tier。实际调度结果必须从这些记录填入T1–T9，不能用候选替代。
8. 文本按互斥输入、缓存读、缓存写、输出桶计算，核对倍率、长上下文/快慢档/推理附加倍率。图片先确认实际走image按张计费；当前组2预期0.08×1张×1。钱包核对按真实8位精度逐笔舍入，比较请求期间余额差与actual_cost；受限Key还应核对quota_used增加值。排除同用户其他操作及充值，隔离不成立就不能用余额差归因。
9. 同步检查 `billing_usage_entries`、`usage_billing_dedup` 的实际使用路径及失败日志，不假设未接入应用的 `UsageBillingEventStore` 自动重放。账单不等同于所有上游尝试的成本：服务端失败重试可能额外消耗供应商额度而没有等额用户账单，须另核实供应商可读用量/费用；本轮没有取得该证明。
10. 每笔后等待异步记账收敛，建议5/15/30/60秒只读复核（这是计划，不是结算保证）。取消、超时、连接失败或关页后保留“费用待定”；60秒仍不能确认则停止整组测试，后续只读查账，不重发、不退款补偿。账单缺失不是0费用证明。
11. 仅当前笔的输出、路由、所有尝试和账单均可解释且“已确认累计扣费+待定最高预留+下一项操作预算≤获准总预算”时，才手动开始下一笔。出现余额不足、未知费用、额外尝试、模型映射漂移或超预算立即停止，不自动换Key/换模型/重试。

## 9. 未满足的前置条件与P3-A验收点

| 前置条件 | 状态/后续动作 |
| --- | --- |
| 可用受限测试身份 | 未满足；Stage7 Key停用/过期，普通测试用户登录凭证未在本轮提供。现有管理员Key接口只支持分组/窗口重置，不能据此绕过用户流程配置总额度/续期；本轮没有修改身份或密码 |
| 独立库与实际网关 | 已确认分离，并提供只读入口；未完成普通测试用户登录或真实生成端到端验收 |
| 图片、Codex测试路由 | Stage7未配置图片或该Codex模型；不新建渠道/放宽权限。需用户安排现有合适的隔离环境或缩减P3-B范围 |
| 别名明确协议 | 未满足；当前规则为空。需在受限测试身份确定后审核精确规则及测试构建，不以模型名称猜测 |
| 硬费用边界 | 未满足；需要可验证输出/推理上限与受控服务端尝试次数。当前P3-A门禁继续关闭 |
| 实际供应商健康与成本 | 仅静态状态；没有实时探针、推理或供应商结算验证。失败/取消成本必须保留待定 |
| 后端测试 | 协议转换包通过；服务层Ent编译被杀、账单handler测试未完成，需在资源足够的隔离环境补齐；单测也不能替代实际SSE、调度和计费验收 |
| P3-B授权 | 尚未获得；$0.50/$0.06均为建议，未动用任何预算 |

本轮新增工具只有只读快照、隔离Go测试及永久禁收费的准备入口；没有修改P1/P2业务代码。`canvas/docs/content/docs/progress/todo.mdx`、`pending-test.mdx`仅同步准备状态；P1/P2报告与既有回滚材料保留。准备工作不增加正式产品功能，无需追加产品CHANGELOG。

**交付范围是只读核对结果、门禁准备和可核对的收费测试计划；存在上述阻塞，不能宣布真实联调已通过。等待P3-A验收，未经明确批准不进入P3-B。**
