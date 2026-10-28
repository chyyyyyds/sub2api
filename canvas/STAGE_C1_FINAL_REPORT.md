# Sub2API AI 创作中心 — Stage C1-Final 技术确认报告

核验日期：2026-10-27，时区 Asia/Shanghai。阶段：C1 方案验收，未进入 C2。

## 1. 结论、范围与验收边界

真实 KOKO 的 GET /models、GET /account 均返回 HTTP 200；当前账号目录列出 3 个视频模型，明确启用 2 个，另 1 个维护停用。账号 active，可见余额 275 points。没有调用 POST /videos，也没有查询或下载任何历史视频任务。因此“目录能力已核实”和“收费生成协议已端到端验证”是不同结论。

可以进入经用户批准的 C2 源码实施及 Mock 验收；目前不满足真实收费功能开放条件。上线前必须补齐：生成模式/必需素材规则、真实成片到期字段或可信期限起算规则、上游幂等重放的保留期限、下游正式价格配置。C2 可先完成持久化、Worker、账务、下载和 V5 接线，但缺失合同能力的模型保持提交关闭，不用旧值冒充实时结果。C2 的任何收费端到端测试仍须另行明确授权预算与模型。

本轮只新增本报告。未修改业务源码、数据库、New API、线上容器；未生成视频、构建、提交、推送或部署。Stage A/B 报告已读取，只采用既有交付事实，不重复审计 UI。工作区原有大量未提交/未跟踪修改均保留。

源码基准：

- Sub2API 根目录：D:/workspace/code/sub2api。
- New API 根目录：D:/workspace/code/new-api，仅只读。
- 下文源码相对路径均以对应根目录解析；第 12 节给出 C2 精确文件清单。
- 官方资料：[KOKO 当前文档](https://pay.kokoai.online/docs/SEEDANCE-OPENAPI.md?v=20261019-newapi)。页面自称最后更新 2026-10-24；URL 参数不是内容版本保证。

## 2. 实时 API 证据

### 2.1 请求范围、时间与脱敏

仅发送 Bearer 鉴权的 GET /openapi/v1/models、GET /openapi/v1/account；关闭自动重定向。用户补充凭证后使用当前凭证查询，没有尝试旧密钥。凭证不写入项目文件、报告或响应快照，不回显请求头。以下只保留已脱敏结果；账号 id、username、email 已移除。未保留任何 Authorization、Cookie 或签名视频 URL。

| 接口 | 北京时间 | HTTP | X-Request-Id |
| --- | --- | --- | --- |
| GET /models | 2026-10-27 22:54:15 | 200 | req_mvqt3gwn_44d38425 |
| GET /account | 2026-10-27 22:54:16 | 200 | req_mvqt3hgg_83e65d14 |

工具返回结果的中间处理发生过本地错误，之后重新执行了相同只读查询；上表是最终完整取得、可复核的一组响应。全部网络业务调用仍仅限以上两种 GET。没有把模型目录中的 created 当成任务时间、价格生效时间或保存期限。

### 2.2 脱敏的实际 JSON

GET /models：保留完整目录字段。注意 OpenAI 风格的 data 数组与详细 models 数组内容语义不同，必须以 models 中 enabled/maintenance 判定可创建性。

    {
      "object": "list",
      "data": [
        {
          "id": "minimax-h3-933",
          "object": "model",
          "created": 1793112853,
          "owned_by": "koko",
          "name": "minimax-h3 1k 933",
          "description": "15 秒视频 · 1K · 933 满血"
        },
        {
          "id": "oo-sd25-1080p",
          "object": "model",
          "created": 1793112853,
          "owned_by": "koko",
          "name": "OOseedance2.5 1080p超分 903参数",
          "description": "固定 30 秒 · 1080p · 903 参数 · 9 图 + 3 音频 · yingman 通道"
        },
        {
          "id": "mm-h3-768-stable",
          "object": "model",
          "created": 1793112853,
          "owned_by": "koko",
          "name": "minimaxh3 稳定版 参数903",
          "description": "固定 15/30 秒 · 768p · minimax H3 稳定通道"
        }
      ],
      "models": [
        {
          "id": "minimax-h3-933",
          "name": "minimax-h3 1k 933",
          "description": "15 秒视频 · 1K · 933 满血",
          "type": "video",
          "max_prompt_length": 10000,
          "duration": 15,
          "durations": [
            15
          ],
          "duration_prices": {
            "15": 20
          },
          "reference_images": {
            "supported": true,
            "max": 9,
            "formats": [
              "jpeg",
              "png",
              "webp"
            ]
          },
          "reference_audios": {
            "supported": false,
            "max": 0,
            "formats": [
              "mp3",
              "wav",
              "m4a",
              "aac",
              "flac"
            ]
          },
          "ratio": [
            "9:16",
            "1:1",
            "3:4",
            "4:3",
            "16:9"
          ],
          "resolutions": [
            "1K"
          ],
          "points": 20,
          "enabled": true,
          "maintenance": false
        },
        {
          "id": "oo-sd25-1080p",
          "name": "OOseedance2.5 1080p超分 903参数",
          "description": "固定 30 秒 · 1080p · 903 参数 · 9 图 + 3 音频 · yingman 通道",
          "type": "video",
          "max_prompt_length": 8000,
          "duration": 30,
          "durations": [
            30
          ],
          "duration_prices": {
            "30": 40
          },
          "reference_images": {
            "supported": true,
            "max": 9,
            "formats": [
              "jpeg",
              "png",
              "webp"
            ]
          },
          "reference_audios": {
            "supported": true,
            "max": 3,
            "formats": [
              "mp3",
              "wav",
              "m4a",
              "aac",
              "flac"
            ]
          },
          "ratio": [
            "9:16",
            "1:1",
            "3:4",
            "4:3",
            "16:9"
          ],
          "resolutions": [
            "1080p"
          ],
          "points": 40,
          "enabled": false,
          "maintenance": true
        },
        {
          "id": "mm-h3-768-stable",
          "name": "minimaxh3 稳定版 参数903",
          "description": "固定 15/30 秒 · 768p · minimax H3 稳定通道",
          "type": "video",
          "max_prompt_length": 15000,
          "duration": 30,
          "durations": [
            15,
            30
          ],
          "duration_prices": {
            "15": 20,
            "30": 40
          },
          "reference_images": {
            "supported": true,
            "max": 9,
            "formats": [
              "jpeg",
              "png",
              "webp"
            ]
          },
          "reference_audios": {
            "supported": true,
            "max": 3,
            "formats": [
              "mp3",
              "wav",
              "m4a",
              "aac",
              "flac"
            ]
          },
          "ratio": [
            "9:16",
            "1:1",
            "3:4",
            "4:3",
            "16:9"
          ],
          "resolutions": [
            "768p"
          ],
          "points": 40,
          "enabled": true,
          "maintenance": false
        }
      ]
    }

GET /account：身份字段脱敏，余额保留实际数值。

    {
      "user": {
        "id": "[已脱敏]",
        "username": "[已脱敏]",
        "email": "[已脱敏]",
        "balance": 275,
        "status": "active",
        "createdAt": "2026-09-20T08:53:34.309Z"
      },
      "balance": 275,
      "currency": "points"
    }

### 2.3 模型能力矩阵

验证级别：R = 本次实时响应直接证实；D = 当前文档声明；P = 本地 New API 插件实现；U = 未证实。R 指目录声明，不能等同已创建过视频。

| 模型 ID / 名称 | 启用状态 | 时长 / 默认 | 请求分辨率 | 比例 | 参考素材 | 单次积分 | 成片保存期限 | 来源、验证状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| minimax-h3-933 / minimax-h3 1k 933 | enabled=true，maintenance=false（R） | [15] / 15 秒（R） | [1K]（R） | 9:16、1:1、3:4、4:3、16:9（R） | 图 supported=true，最多 9；jpeg/png/webp；音频 supported=false/max=0；视频字段缺失（U） | duration_prices[15]=20，points=20（R） | 实时无字段；文档约 72h（D），起算点和绝对截止时间 U | R；文生 U，图参考能力 R，必须至少 1 图及仅 reference 为 D/P |
| oo-sd25-1080p / OOseedance2.5 1080p超分 903参数 | enabled=false，maintenance=true（R）；不得创建 | [30] / 30 秒（R） | [1080p]（R） | 同上（R） | 图最多 9；音频最多 3；视频未声明（U） | duration_prices[30]=40，points=40（R）；停用不代表能按此价格创建 | U | R（维护中）；纯文本/参考模式枚举 U |
| mm-h3-768-stable / minimaxh3 稳定版 参数903 | enabled=true，maintenance=false（R） | [15,30] / 30 秒（R） | [768p]（R） | 同上（R） | 图最多 9；音频最多 3；视频未声明（U） | 15 秒 20、30 秒 40；points=40 为默认档（R） | U | R；纯文本/模式枚举 U，图/音参考支持 R，实际调用未验证 |

两种支持音频的模型返回格式 mp3/wav/m4a/aac/flac；minimax 的同一 formats 数组虽也存在，但 supported=false，不能因此开放音频。图 supported=true 只证明参考图接收能力，不能证明首帧/尾帧控制，也不能证明图为可选。没有 reference_videos 字段，不应写成“实时明确禁用视频”，C2 对未声明的视频能力默认不开放。

以下实时字段均未返回：mode/modes、requiresImage、参考视频能力、图/音混合总数、单文件大小/时长、downloadTtlHours、成片绝对到期时间、签名 URL 到期时间、并发数、RPM、账号模型白名单/生成权限。账号接口仅返回 user 与余额/币种；没有 API Key scopes、OpenAPI 写权限或视频权限，不能仅凭 active 推断可收费提交。

积分变化目前只能证实 duration_prices 对时长的差异。没有按比例、分辨率之外的参数、图片张数或音频数量分别报价；不能推断这些维度永远免费或同价。对上游预算采用“目录预计积分”，实际扣/退积分必须来自后续任务响应或上游对账，不用账号总余额差推算单任务消耗。

### 2.4 三方差异表

| 项目 | 实时接口 R | 当前文档 D | New API 插件 P | C2 决策 |
| --- | --- | --- | --- | --- |
| 模型集合 | 以上 3 个，其中 2 个启用 | 页面有 seedance-2.0、seedance-2.5-30ref、KKWAN、kk-sd25-full-720p 等不同段落 | MODEL_RULES 为 pp-sd25-stable、minimax、oo、mm 四个 | 仅使用每账号实时 models；未出现不视为本账号可用，不推断平台全局删除 |
| pp-sd25-stable | 两数组均未出现 | 页面未检索到该 ID | 插件和 Canvas 都列出 | 新任务隐藏；历史任务按原绑定查询，不删历史 |
| oo 分辨率/状态 | 1080p、维护停用 | 旧表不能提供一致对应规则 | 固定 720p，可通过本地校验 | 不用旧规则；维护项禁提交 |
| mm 分辨率/默认时长 | 768p、默认 30 | 无一致的完整专属参数契约 | 720p、默认 15 | 原样支持 768p；不套 Grok 分辨率归一化 |
| minimax prompt | 10000（R） | 参数说明写 7000 | 10000 | 实时优先；长度单位仅文档声明为 JS UTF-16 code units |
| minimax 音频 | false / 0 | 一处表写不支持，另一旧段落写最多 3 | normalizeReferences 对全部模型放行最多 3 | supported=false 必须拒绝，不能静默丢弃 |
| oo/mm 音频 | true / 3 | 页面存在“2026-10-20 后仅图”的注记，同时又保留混合素材旧例 | 支持 3 | 按各账号实时字段；冲突作为文档风险记录 |
| 参考视频 | 缺字段 | 不同模型段落有 3/10/不支持等矛盾 | 全部拒绝非空视频 | C2 默认关闭，待逐模型证实 |
| 生成模式/必需图片 | 未返回 | minimax 表声明仅 reference 且必须带图；其余段落有 text-to-video/reference/first-frame | 仅两种模式，minimax 强制带图 | 缺失不能从名称猜；经版本化合同补充，未确认模型不开放创建 |
| 上游价格 | 20；oo30=40；mm15=20/mm30=40 | 示例金额不一致，并声明实时优先 | extractUsage 恒 video_count=1，下游价另算 | 上游 duration_prices 与下游价分离；绝不固定按 points 默认档算所有时长 |
| 成片保存 | 无 downloadTtlHours | minimax/旧 BB 约72h、seedance2约2h，并称应读实时 downloadTtlHours | 未建截止时间 | 不写48h，不据“首次发现完成”计算准确期限 |
| 下载签名 | 没有任务调用证据 | 签名入口约1h、最终 CDN 直链约30s，可能 307 | buildContentRequest 构建带 Bearer 的 content 请求 | 仅协议设计已确认；真实跳转链和 Range 未验 |
| 幂等 | GET 无法验证 | 同账号同 Idempotency-Key 返回原任务（202/200）；8–100 字符；未明确保存期/参数冲突规则 | 用 publicTaskId 派生幂等键 | 持久化账号、请求哈希、幂等键；未知保留期禁止无限重放 |
| 账户 | active、275 points | 示例余额185不代表本账号 | 插件不提供余额权限探测 | 真实余额只做管理员预算参考，不转换为用户美元价 |

插件路径：D:/workspace/code/new-api/plugins/tasks/koko/plugin.js，关键函数 normalizeVideoRequest、normalizeReferences、idempotencyKey、buildSubmitRequest、parseTaskResult、buildContentRequest。Canvas 的 video-model-config.ts 与 plugin.js 同源旧规则。它们不是实时合同。

## 3. 上游协议及 Provider 边界

以下提交/查询/下载协议来自当前文档和源码，未经本轮真实收费或历史任务调用验证：

| 操作 | 上游请求 | 已知响应/映射 |
| --- | --- | --- |
| 目录 | GET https://pay.kokoai.online/openapi/v1/models | 本次 200；分别解析 data 与 models，不只读 data[].id |
| 账号 | GET 同 base /account | 本次 200；balance、currency、user.status |
| 提交 | POST /videos，JSON，服务端 Bearer，Idempotency-Key | 文档 202 新受理/200 幂等原任务；id、status、model、prompt、prompt_complete、points、balance、video_url、failure_reason、created_at、updated_at |
| 查询 | GET /videos/{upstream_id}，原账号 Bearer | 文档 submitting/queued/running/completed/failed；上游只准原创建账号访问 |
| 下载 | GET/HEAD /videos/{upstream_id}/content，先使用原账号 Bearer | 文档可 307 到签名 URL/CDN，或直接文件；Range 200/206/416；不要把 307/JSON 保存为 MP4 |

请求字段选择单一规范：model、prompt、duration、ratio、resolution、mode、count=1、reference_images、reference_audios。Provider 将规范音频字段适配成文档支持的 audio_urls。别名 seconds/aspect_ratio 等只在入口归一化，冲突字段报 400；不能同时接受相互冲突的参数。提示词 trim 后按文档 UTF-16 code units 校验：Go 使用 utf16.Encode([]rune(prompt)) 的长度，不用字节数或 rune 数替代。文件本身仍 UTF-8 无 BOM，不能将文本存成 UTF-16。

实时字段缺失采用 unknown，不以 false/0 冒充：能力结构需要 nullable 值与 evidence_source。未知模式通过后台版本化合同配置补齐，记录来源/确认时间，不在 Provider 硬编码四个旧 ID。minimax 图必需规则当前只为文档声明，尚待接口方明确；mm 的模式合同尤其需要补齐。支持大小限制使用已确认合同与站内 MaxBodySize 的较小值；文档单文件50MB不等于允许总请求无限大，base64 还增加体积。

错误分类：

| 上游情况 | 本地处理 |
| --- | --- |
| 确定参数拒绝/维护/积分不足且可信结构明确未受理 | 记录拒绝证据，FAILED，写 RELEASE 事件；不能只凭 HTTP 数字认定没创建 |
| 200/202 且有合法 id | 绑定原账号及上游 id；即使响应 status 未知也禁止换号重提 |
| 200/202 无 id、读响应中断、连接/网关超时、语义不明 5xx | SUBMISSION_UNKNOWN；保留冻结，原账号、原请求、原幂等键核对 |
| 查询 401/403 | 查询凭证失效或权限异常，RECONCILING/人工处理；不是生成失败 |
| 查询 404 | 初期可见性延迟/错误账号/上游丢记录均可能；只记录疑点，不自动退款或重生成 |
| 查询 429/5xx/网络错误 | 退避并继续原任务；遵守 Retry-After，不改变资金终态 |
| completed 但缺下载地址 | 生成已成功，下载状态 UNAVAILABLE/UNKNOWN；不得改成生成失败退款 |
| failed 且可信终态 | FAILED + RELEASE 事件；上游退款状态单独留痕，不把下游退款依赖为同一笔上游操作 |
| 文档504写“已退积分”，但实际传输结果未知 | 未拿到可验证的终态就不自动释放；避免上游已执行、下游已退款 |

任务 ID 必须 PathEscape 且仅作为单路径段；控制字符、空 ID、URL/路径注入直接拒绝。不向客户端透传上游余额、身份、原始错误体、完整签名 URL、上游 id 或任何供应商密钥。

## 4. Sub2API 实际源码复用结论

| 能力/源码锚点 | 已有行为 | C2 分类和处理 |
| --- | --- | --- |
| internal/service/account.go：Account、GetCredential、GetMappedModel/ResolveMappedModel、Proxy/GroupIDs | credentials 含 api_key/base_url/model_mapping；关联 Proxy，优先级/并发/健康状态可复用 | 直接复用存储和代理；扩展显式 koko_video capability 与 provider=koko 标记；不按域名或模型名自动启用 |
| account.go：SupportsOpenAIEndpointCapability，约1916行 | Seedance 单独要求 OpenAI APIKey+自定义base+seedance能力；通用默认分支不认识 KOKO | 必须扩展白名单/归一化/管理 DTO 和 UI；仅 capability 被配置不等于实时模型启用 |
| service/channel.go；repository/channel_repo.go/channel_repo_pricing.go | Channel 绑定分组、模型映射、定价；SQL 表 channels/channel_model_pricing；不是 New API 凭据渠道 | 直接复用现有语义；Channel 不持 KOKO key，不新增 New API channels 表/JS 沙箱 |
| service/group.go；middleware/api_key_auth.go；group_model_allowlist.go | 用户身份、Key状态、IP、分组授权、白名单、余额/订阅/额度 | 直接复用身份和创建准入；新增 KOKO 组开关及可靠预留，查询不应被创建后余额耗尽阻断 |
| service/composite_route_resolver.go；routes/gateway.go：compositeTargetPlatformMiddleware | POST 可按模型改写目标；GET 无 model 不作解析；当前视频 endpoint 会落 Any | 扩展独立 videos endpoint 和 original-model 快照，防白名单/映射两次应用；GET 只查本地绑定 |
| service/openai_account_scheduler.go：OpenAIAccountScheduleRequest | RequiredCapability、RequestedModel、GroupID、ExcludedIDs、优先级/槽位/健康 | 扩展候选约束为实时账号能力及参数匹配；只创建时调度；受理后不调用随机调度 |
| handler/grok_media.go：handleGrokMedia、prepareGrokVideoCompletionBilling、recordGrokMediaUsage | Redis 绑定原账号；原账号查询不能 sticky escape；完成查询/下载触发一次费用，稳定 grok-video: ID | 保持 Grok 原行为；借鉴原账号安全思路，不沿用24h/48h缓存作为视频真相 |
| service/grok_media.go：Bind/ResolveGrokMediaVideoRequestAccount、Store/Claim/ReleaseGrokVideoBilling | pending快照TTL24h、claim48h，成功记录失败可释放claim后再试 | 可扩展思想；KOKO 必须 PostgreSQL 永久任务记录与账务幂等，不能依赖这两个TTL |
| handler/seedance.go、service/seedance.go：SeedanceTasks、ForwardSeedance | Ark原生 /api/v3/contents/generations/tasks，保留content；seedance:隔离；按 usage.completion_tokens完成收费，不按秒猜 | 保持接口/计费不变；KOKO 不复用 Ark DTO，也不因有seedance字样走Ark |
| handler/image_task_handler.go；service/image_task.go；repository/image_task_store.go | 普通图片任务Redis Set/Get；handler启动goroutine；30分钟执行timeout、24小时记录TTL；依赖图片对象存储开关 | 不能直接复用长期恢复/队列；不启动视频R2开关，不套图片执行超时 |
| service/batch_image_public.go、batch_image_worker*.go、batch_image_settlement.go；repository/batch_image_repo.go、batch_image_queue.go | 批量图片有PostgreSQL记录、价格快照、余额冻结、Redis队列/锁、心跳与恢复 | 可复用事务/生命周期模式；新视频用DB租约；不要复制图0.6冻结/折扣、图账号倍率、未提交超时直接失败的规则 |
| service/usage_billing.go；repository/usage_billing_repo.go | ApplyWithUsage同事务dedup+余额/配额+usage日志；reserve/capture/release已有资金SQL；NUMERIC(20,8) | 可扩展仓储内tx helper；现有公开方法各自BeginTx，不能串三个公开方法冒充一个事务 |
| repository/usage_billing_events.go | 文件明确是隔离验证、未接应用；validTokenBillingEvent只收确认Token，不接按次视频；tools/stage7_billing_events_schema.sql非正常迁移 | 不能宣称已有通用持久账务Worker；KOKO必须新建专用可重放事件，不能改造隔离原型替换现有队列 |
| service/billing_inflight_reservation.go | Redis在途预留15min，handler结束停止续租，可fail-open | 不适合一小时视频，不作为钱包/额度可靠冻结；KOKO DB事务失败必须拒绝创建 |
| ent/schema/*；ent/generate.go；migrations/migrations.go；repository/migrations_runner.go | Ent实体与手工嵌入SQL并存；支持sql/execquery、sql/lock；迁移校验和、PG advisory lock | 新表增加Ent schema与增量SQL；不改旧迁移，不启动程序意外执行迁移 |
| service/batch_image_worker_runtime.go：Start/Stop；cmd/server/wire.go：provideCleanup | Worker独立context；Wire注入，停止worker后关闭DB/Redis | 复用接线方式；新增视频runtime及stop，不复用HTTP请求生命周期 |

额外核对：Account 的 RateMultiplier 注释声明仅账号统计，不能直接变成 KOKO 用户倍率。批量图片 resolvePricingSnapshot 实际还乘账号倍率，属于其现有规则，KOKO不得照抄。Grok 的 video_model_prices 是 USD/秒，且 NormalizeVideoBillingResolution 只处理 Grok 档位；不能拿它给1K/768p补默认档。

New API 对照：

- relay/relay_task.go：RelayTaskSubmit 先 PreConsumeBilling 再提交；可借鉴预留/价快照，但不是本项目事务。
- model/task.go：TaskPrivateData.UpstreamTaskID 与公开TaskID分离、TaskBillingContext、UpdateWithStatus CAS；值得借鉴。
- service/task_polling.go：RunTaskPollingOnce、updateVideoSingleTask、recordPollFailure、sweepTimedOutTasks；有独立轮询、错误分类和终态CAS，但不能复制按总时长失败退款、空upstream ID直接失败或虚构100%进度。
- service/system_task.go：runWithLeaseHeartbeat；model/system_task.go：系统任务类型租约；新视频要按任务行租约，不能只靠全局单例避免双实例。
- service/task_billing.go：RefundTaskQuota 先调资金、令牌额度、统计再写task.Quota=0；这些是多步骤，代码自己提示最后写回失败存在重复退款风险。只借鉴流程，不宣称其跨表原子性。
- 插件extractUsage恒按1次只是下游用量模型，不证明不同duration同上游积分。

## 5. Go Provider、路由与授权方案

### 5.1 模块职责

新建 VideoProvider 接口：Models(ctx, account)、Account(ctx, account)、Validate(capability, request)、Submit(ctx, binding, request, stableKey)、Query(ctx, binding, upstreamID)、OpenContent(ctx, binding, upstreamID, range)。Submit/Query返回带“是否可能受理”的类型化结果，不返回gin.Context、不自行扣费。KokoVideoProvider仅负责Go协议适配；VideoTaskService负责本地记录/权限/状态；VideoWorker负责远端操作；VideoBillingService负责价快照/账务事件；VideoDownloadService负责安全取流。

Account采用 platform=openai、type=api_key、credentials.base_url=https://pay.kokoai.online/openapi/v1、credentials.api_key由现有后台安全配置、显式 openai_capabilities 包含 koko_video；extra.video_provider=koko。禁止OAuth、影子账号及不明供应商借默认“兼容OpenAI”进入KOKO。初版只认精确API base，不用字符串盲拼重复/v1。旧插件base是/openapi，这个差异须在管理员配置校验中提示。

Account及实时能力缓存按账号隔离；账号subject由/account身份生成服务端HMAC摘要，不在客户端暴露。多个Account行若实际同一个KOKO身份，也应共享provider_scope，避免幂等/配额误认。密钥轮换只能在确认同一上游身份后继续原任务，不能把Account行改绑成另一个KOKO账号后悄悄查询。任务不复制保存Bearer；账号停用禁止新任务，已有任务查询允许用原凭据恢复；凭据被撤销/删除则停查询并标待核对，不换号。

### 5.2 分发和兼容

- POST /v1/videos：入口先保留用户原始model；在现有身份/分组/白名单后解析授权目录中的provider及精确映射。明确KOKO才进新handler；现有Grok模型沿原handler。禁止“任何未知模型都先试KOKO”，不能靠ID前缀判断模型供应商。
- KOKO请求先规范化/验参，按group、user/key授权、channel映射、account映射、实时enabled且非maintenance、完整参数能力选账号，再冻结并建任务。记录requested_model/channel_mapped_model/upstream_model三者，映射各应用一次。
- Scheduler只完成HTTP操作时的槽位占用；异步生成期间不长期占用HTTP槽。若限制“进行中的视频数量”，必须另设DB中的账号活动任务容量，不能误用Account.Concurrency。KOKO未返回生成并发限制，正式上限待确认。
- GET /v1/videos/{id}、GET/HEAD /v1/videos/{id}/content：vtsk_保留命名空间只查新DB；找到记录再取原Account，不重新调度。未知vtsk_返回404，绝不回退旧Grok。其余历史ID按原分支保持旧行为；不迁移Grok/Ark历史任务。
- /v1/videos/generations、edits、extensions及根路径旧别名保持Grok逻辑；KOKO初版仅接本次三条接口与HEAD辅助。Ark /api/v3与/v3原生路由完全保留。
- 复合组新增CompositeRouteEndpointVideos；旧显式Any route继续遵循现有匹配优先级，但KOKO不得使用任何聊天transport降级/failover逻辑。

### 5.3 API契约及权限

对外创建返回202，仅说明本地可靠接收。Location指向本地任务；返回id=vtsk_随机UUID、object=video.task、status=created、model、created_at、billing_state=held、estimated_charge（美元十进制字符串）、retry_after_seconds。不暴露upstream_id。携带相同Key和Idempotency-Key、相同请求哈希时返回原任务；同键不同哈希409。UI生成稳定随机幂等键并保留到确认本地任务id；网络丢响应不能生成新幂等键自动重交。

新增目录 GET /v1/video-models：返回该用户Key可用的合成视频目录，保留各账号支持参数组合的可行性；不能把账号A时长与账号B分辨率作笛卡尔积。只读目录无上游余额/账号ID/密钥。现有 /v1/models 可追加安全的video能力标记，不改现有聊天列表语义；Vue视频选模从专用目录读取，避免依赖名字正则。自动/手动Key复用useCreationSelection行为。

新增列表 GET /v1/videos：限定当前user_id+api_key_id，游标分页，以created_at/id倒序，支持processing/downloadable/failed/expired筛选；不读取所有用户。刷新或关闭页面不影响Worker。为任务中心跨本人Key查看，增加JWT面板接口 GET /api/v1/user/video-tasks 及 /{id}，仅按当前登录UserID取本人记录，并允许按原KeyID过滤，返回原Key名称/已撤销标记，不读Key明文。JWT列表可在原Key已删除后保留历史和账单；默认删除/禁用Key不获得公共下载权限，需原Key有效或明确的用户面板授权下载策略，不能偷换为任一Key可读。

公共详情/下载必须同时匹配UserID、APIKeyID、任务归属GroupID与当前Key合法访问范围；同一用户另一Key默认不可读。客户端越权统一404。JWT面板跨Key只读历史属于独立明确授权面，不复用浏览器传UserID。创建后Key改组：旧组历史元数据仍可在JWT查看；公共读取拒绝组不匹配。Worker继续按创建快照结算，不随Key当前组修改。

新增isKokoVideoTaskRead检查只豁免本地KOKO目录/列表/保留前缀详情的余额/过期额度检查，复用异步图片skipBilling思路；仍检查Key存在、状态禁用、用户状态、IP、Group授权，不能把所有/v1/videos GET的Grok旧行为一并放宽。HEAD也要相同检查。下载路径本身只做只读查询，不触发新的视频提交或费用。

对外详情字段包括：status、billing_state、download_state、created_at、submitted_at、started_at、completed_at、last_checked_at、wait_seconds、next_check_at、upstream_status（受控枚举）、error.code/message、retention_expires_at、expiry_evidence/source、download_available。unknown字段为null，进度无真实数值就省略progress。上游updated_at不能直接冒充started/completed时间。

所有新增Go入参、出参DTO使用显式json/validate标签及中文字段说明；Handler写中文Swaggo @Summary/@Description/@Param/@Success/@Failure/@Router，生成OpenAPI定义和字段description。请求/响应不使用无schema的map充当正式接口；测试快照只用假凭证。Swagger注释、事务关键步骤、租约围栏和下载跨域凭据处理均中文注释。

## 6. PostgreSQL 数据设计与 Ent 迁移

### 6.1 数据边界

以下为 C2 要实现的 PostgreSQL DDL 设计，**本轮未创建迁移文件、未执行 SQL**。使用现有 users.balance / users.frozen_balance，不再增加另一套钱包余额。所有金额 NUMERIC(20,8)，JSON金额也保存十进制字符串，Go使用shopspring/decimal，最终按现有UsageBillingMonetaryScale=8进行确定性舍入。上游积分 NUMERIC(20,8)，单位points，不能与USD列相加。

新增表：

1. video_provider_models：每账号、每上游模型的最近能力证据，不保存账号余额或凭据。
2. video_tasks：任务事实、不可变请求/价格快照、原账号绑定、轮询租约。
3. video_financial_reservations：每任务一笔资金预留，wallet或subscription，互斥捕获/释放。
4. video_quota_reservations：跨请求/跨重启的额度预留，各scope可按需建多行。
5. video_billing_events：持久账务意图，处理成功与资金/usage日志同事务。
6. video_task_events：审计追加事件；记录状态/错误码和人工操作，不存提示词或签名URL。

由于现有实体用软删除，新表保留历史FK，ON DELETE RESTRICT避免硬删孤儿。新任务表不加自动TTL/级联删除。用户/Key软删不撤销已有上游执行，资金结算按原始归属处理，历史仍可审计。Account的有效凭据在仍需轮询/下载期间必须保留，删除/改绑前做活动任务检查；不能在删除后随机换Account。

### 6.2 DDL

    CREATE TABLE IF NOT EXISTS video_provider_models (
        id BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        provider VARCHAR(20) NOT NULL CHECK (provider = 'koko'),
        model_id VARCHAR(200) NOT NULL,
        display_name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL,
        maintenance BOOLEAN NOT NULL,
        capability JSONB NOT NULL CHECK (jsonb_typeof(capability) = 'object'),
        evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
        capability_hash CHAR(64) NOT NULL,
        contract_version INTEGER NOT NULL DEFAULT 1 CHECK (contract_version > 0),
        observed_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (account_id, provider, model_id)
    );

    CREATE TABLE IF NOT EXISTS video_tasks (
        id BIGSERIAL PRIMARY KEY,
        public_id VARCHAR(48) NOT NULL UNIQUE,
        provider VARCHAR(20) NOT NULL CHECK (provider = 'koko'),
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
        group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE RESTRICT,
        channel_id BIGINT NULL REFERENCES channels(id) ON DELETE RESTRICT,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        provider_scope CHAR(64) NOT NULL,
        requested_model VARCHAR(200) NOT NULL,
        channel_mapped_model VARCHAR(200) NOT NULL,
        upstream_model VARCHAR(200) NOT NULL,
        client_idempotency_key VARCHAR(100) NOT NULL,
        upstream_idempotency_key VARCHAR(100) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        request_ciphertext BYTEA NOT NULL,
        request_cipher_version INTEGER NOT NULL CHECK (request_cipher_version > 0),
        capability_snapshot JSONB NOT NULL,
        pricing_snapshot JSONB NOT NULL,
        pricing_snapshot_hash CHAR(64) NOT NULL,
        quoted_upstream_points NUMERIC(20,8) NULL,
        actual_upstream_points NUMERIC(20,8) NULL,
        upstream_refund_state VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
            CHECK (upstream_refund_state IN ('UNKNOWN','EXPECTED','CONFIRMED','REVIEW')),
        upstream_id TEXT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'CREATED'
            CHECK (status IN ('CREATED','SUBMITTING','SUBMISSION_UNKNOWN',
                              'QUEUED','RUNNING','RECONCILING','COMPLETED','FAILED')),
        upstream_status VARCHAR(64) NULL,
        previous_active_status VARCHAR(32) NULL,
        download_state VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN'
            CHECK (download_state IN ('UNKNOWN','NOT_READY','AVAILABLE',
                                      'TEMP_UNAVAILABLE','EXPIRED')),
        retention_expires_at TIMESTAMPTZ NULL,
        retention_evidence JSONB NULL,
        upstream_completed_at TIMESTAMPTZ NULL,
        last_content_checked_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        submitted_at TIMESTAMPTZ NULL,
        started_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        failed_at TIMESTAMPTZ NULL,
        last_checked_at TIMESTAMPTZ NULL,
        next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        review_required BOOLEAN NOT NULL DEFAULT false,
        last_error_code VARCHAR(80) NULL,
        upstream_request_id VARCHAR(128) NULL,
        submit_attempts INTEGER NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
        poll_attempts INTEGER NOT NULL DEFAULT 0 CHECK (poll_attempts >= 0),
        consecutive_errors INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_errors >= 0),
        lease_owner VARCHAR(64) NULL,
        lease_until TIMESTAMPTZ NULL,
        lease_epoch BIGINT NOT NULL DEFAULT 0 CHECK (lease_epoch >= 0),
        row_version BIGINT NOT NULL DEFAULT 0 CHECK (row_version >= 0),
        UNIQUE (id, user_id, api_key_id),
        UNIQUE (api_key_id, client_idempotency_key),
        UNIQUE (provider_scope, upstream_idempotency_key),
        CHECK (client_idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
        CHECK (upstream_idempotency_key ~ '^[A-Za-z0-9_-]{8,100}$'),
        CHECK (public_id ~ '^vtsk_[a-f0-9]{32}$'),
        CHECK (upstream_id IS NULL OR length(upstream_id) > 0),
        CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
        CHECK (quoted_upstream_points IS NULL OR quoted_upstream_points >= 0),
        CHECK (actual_upstream_points IS NULL OR actual_upstream_points >= 0),
        CHECK (jsonb_typeof(capability_snapshot) = 'object'),
        CHECK (jsonb_typeof(pricing_snapshot) = 'object'),
        CHECK (status NOT IN ('QUEUED','RUNNING','COMPLETED') OR upstream_id IS NOT NULL),
        CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
        CHECK ((status = 'FAILED') = (failed_at IS NOT NULL)),
        CHECK (download_state NOT IN ('AVAILABLE','EXPIRED') OR status = 'COMPLETED'),
        CHECK (retention_expires_at IS NULL OR retention_evidence IS NOT NULL)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_video_tasks_upstream
        ON video_tasks (provider_scope, upstream_id) WHERE upstream_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ix_video_tasks_due
        ON video_tasks (next_check_at, id)
        WHERE status NOT IN ('COMPLETED','FAILED');
    CREATE INDEX IF NOT EXISTS ix_video_tasks_lease
        ON video_tasks (lease_until) WHERE lease_owner IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ix_video_tasks_owner
        ON video_tasks (user_id, api_key_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ix_video_tasks_user
        ON video_tasks (user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ix_video_tasks_account_active
        ON video_tasks (account_id, status, id)
        WHERE status NOT IN ('COMPLETED','FAILED');
    CREATE INDEX IF NOT EXISTS ix_video_tasks_expiry
        ON video_tasks (retention_expires_at)
        WHERE status = 'COMPLETED' AND download_state <> 'EXPIRED';
    CREATE INDEX IF NOT EXISTS ix_video_tasks_review
        ON video_tasks (updated_at, id) WHERE review_required = true;

    CREATE TABLE IF NOT EXISTS video_financial_reservations (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL UNIQUE REFERENCES video_tasks(id) ON DELETE RESTRICT,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        api_key_id BIGINT NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
        funding_source VARCHAR(20) NOT NULL
            CHECK (funding_source IN ('wallet','subscription')),
        subscription_id BIGINT NULL REFERENCES user_subscriptions(id) ON DELETE RESTRICT,
        currency VARCHAR(8) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
        amount NUMERIC(20,8) NOT NULL CHECK (amount >= 0),
        captured_amount NUMERIC(20,8) NOT NULL DEFAULT 0,
        state VARCHAR(20) NOT NULL DEFAULT 'HELD'
            CHECK (state IN ('HELD','CAPTURED','RELEASED')),
        pricing_snapshot_hash CHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finalized_at TIMESTAMPTZ NULL,
        FOREIGN KEY (task_id, user_id, api_key_id)
            REFERENCES video_tasks(id, user_id, api_key_id) ON DELETE RESTRICT,
        CHECK ((funding_source = 'subscription') = (subscription_id IS NOT NULL)),
        CHECK (captured_amount >= 0 AND captured_amount <= amount),
        CHECK (state = 'CAPTURED' OR captured_amount = 0),
        CHECK ((state = 'HELD') = (finalized_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS ix_video_funding_held_user
        ON video_financial_reservations (user_id, id) WHERE state = 'HELD';
    CREATE INDEX IF NOT EXISTS ix_video_funding_held_subscription
        ON video_financial_reservations (subscription_id) WHERE state = 'HELD';

    CREATE TABLE IF NOT EXISTS video_quota_reservations (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
        scope_type VARCHAR(32) NOT NULL CHECK (scope_type IN
            ('key_total','key_windows','subscription','user_platform','account')),
        scope_key VARCHAR(180) NOT NULL,
        amount NUMERIC(20,8) NOT NULL CHECK (amount >= 0),
        state VARCHAR(20) NOT NULL DEFAULT 'HELD'
            CHECK (state IN ('HELD','CONSUMED','RELEASED')),
        snapshot JSONB NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finalized_at TIMESTAMPTZ NULL,
        UNIQUE (task_id, scope_type, scope_key),
        CHECK ((state = 'HELD') = (finalized_at IS NULL))
    );
    CREATE INDEX IF NOT EXISTS ix_video_quota_scope_held
        ON video_quota_reservations (scope_type, scope_key, task_id)
        WHERE state = 'HELD';

    -- 平台视频已用量单独从该账本聚合，不写入旧Redis快照覆盖的usage列。
    CREATE INDEX IF NOT EXISTS ix_video_quota_scope_consumed
        ON video_quota_reservations (scope_type, scope_key, finalized_at)
        WHERE state = 'CONSUMED';

    CREATE TABLE IF NOT EXISTS video_billing_events (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
        operation VARCHAR(20) NOT NULL CHECK (operation IN ('CAPTURE','RELEASE','CACHE_HOLD','CACHE_FINAL')),
        request_id VARCHAR(64) NOT NULL UNIQUE,
        payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        payload_hash CHAR(64) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
            CHECK (status IN ('PENDING','RETRY','APPLIED','REVIEW')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_error_code VARCHAR(80) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        applied_at TIMESTAMPTZ NULL,
        UNIQUE (task_id, operation),
        CHECK ((status = 'APPLIED') = (applied_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS ix_video_billing_due
        ON video_billing_events (next_attempt_at, id) WHERE status IN ('PENDING','RETRY');

    CREATE TABLE IF NOT EXISTS video_task_events (
        id BIGSERIAL PRIMARY KEY,
        task_id BIGINT NOT NULL REFERENCES video_tasks(id) ON DELETE RESTRICT,
        event_key VARCHAR(120) NOT NULL UNIQUE,
        event_type VARCHAR(64) NOT NULL,
        task_version BIGINT NOT NULL CHECK (task_version >= 0),
        payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
        actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('system','user','admin')),
        actor_id BIGINT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS ix_video_task_events_task
        ON video_task_events (task_id, id);

“冻结/结算失败”由账务事件RETRY/REVIEW表达，不伪装为预留已经RELEASED。新创建时任务、HELD预留和钱包移动必须同事务，因而不会留下“本地任务有HELD行但从未冻结资金”。为零价格也建零额HELD行，便于幂等审计；零价必须是明确配置，不是缺价回落。

任务初始化时账号已经选定、能力和价格快照已经确定。AccountID、provider_scope、user/key/group/channel、三个模型名、请求密文/哈希、幂等键和两个快照在首次INSERT后不可变。C2仓储不提供普通Update这些字段的方法；迁移增加BEFORE UPDATE触发器比较这些列的IS DISTINCT FROM，变化抛错，终态status也拒绝被普通更新改写（具体DDL见下）。租约/观察字段不在不可变集合中。人工调账不能修改原快照，必须追加独立补偿事件。

同一task的finance.user_id/api_key_id必须与video_tasks一致：仓储在锁任务后从任务赋值，上述UNIQUE(id,user_id,api_key_id)与finance复合外键避免仅靠独立FK关联错用户。quota.scope_key从锁定归属生成，不接受客户端提供scope。billing.payload不含密钥/实体对象，重放核对task、金额及快照哈希。


不可变字段与终态保护的迁移补充（同属248文件；DDL仅设计，未执行）：

    CREATE OR REPLACE FUNCTION guard_koko_video_task_update()
    RETURNS trigger LANGUAGE plpgsql AS $guard$
    BEGIN
        -- 归属、请求与价格一旦可靠接收就不再改写。
        IF ROW(NEW.public_id, NEW.provider, NEW.user_id, NEW.api_key_id,
               NEW.group_id, NEW.channel_id, NEW.account_id, NEW.provider_scope,
               NEW.requested_model, NEW.channel_mapped_model, NEW.upstream_model,
               NEW.client_idempotency_key, NEW.upstream_idempotency_key,
               NEW.request_hash, NEW.request_ciphertext, NEW.request_cipher_version,
               NEW.capability_snapshot, NEW.pricing_snapshot, NEW.pricing_snapshot_hash,
               NEW.quoted_upstream_points)
           IS DISTINCT FROM
           ROW(OLD.public_id, OLD.provider, OLD.user_id, OLD.api_key_id,
               OLD.group_id, OLD.channel_id, OLD.account_id, OLD.provider_scope,
               OLD.requested_model, OLD.channel_mapped_model, OLD.upstream_model,
               OLD.client_idempotency_key, OLD.upstream_idempotency_key,
               OLD.request_hash, OLD.request_ciphertext, OLD.request_cipher_version,
               OLD.capability_snapshot, OLD.pricing_snapshot, OLD.pricing_snapshot_hash,
               OLD.quoted_upstream_points) THEN
            RAISE EXCEPTION '视频任务的不可变快照不能修改';
        END IF;
        IF OLD.status IN ('COMPLETED','FAILED') AND NEW.status <> OLD.status THEN
            RAISE EXCEPTION '视频任务终态不能回退';
        END IF;
        -- 原上游ID只允许首次写入，后续更正必须经人工补偿流程。
        IF OLD.upstream_id IS NOT NULL AND NEW.upstream_id IS DISTINCT FROM OLD.upstream_id THEN
            RAISE EXCEPTION '视频任务的上游绑定不能替换';
        END IF;
        RETURN NEW;
    END;
    $guard$;

    DO $install$
    BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_guard_koko_video_task_update'
              AND tgrelid = 'video_tasks'::regclass
        ) THEN
            CREATE TRIGGER trg_guard_koko_video_task_update
            BEFORE UPDATE ON video_tasks
            FOR EACH ROW EXECUTE FUNCTION guard_koko_video_task_update();
        END IF;
    END;
    $install$;

    -- 249文件：默认关闭，仅用户验收后的明确配置才允许新建。
    ALTER TABLE groups
        ADD COLUMN IF NOT EXISTS allow_koko_video_generation BOOLEAN NOT NULL DEFAULT false;

finance和quota终结也必须条件更新WHERE state='HELD'并检查RowsAffected，event的身份/payload只INSERT、其余仅更新status/attempts；数据库应用角色不给业务端任意SQL能力。对账程序不能绕过guard改价或换上游任务；若错误绑定已存在，保留旧事实，记录异常并用独立受审计补偿处理。

### 6.3 Ent与迁移路径

建议分两个未占用编号：backend/migrations/248_koko_video_tasks.sql（六表、索引、约束、不可变触发器）和249_koko_video_group_gate.sql（groups.allow_koko_video_generation布尔字段，默认false）。当前最大SQL编号247，C2开始前重查，若被其他任务占用则顺延，绝不改旧文件/校验和。迁移使用IF NOT EXISTS；触发器通过pg_trigger检查存在后创建。新表均为空，普通事务内建索引即可，无需CONCURRENTLY。幂等不代表吞掉不兼容schema，结构一致性另作迁移测试。

新增六个ent/schema实体文件，注释/SQL类型与上述一致，金额采用与当前项目一致的SchemaType(NUMERIC)，新视频服务层保持decimal避免float往返。需要nullable时间/积分/未知能力；不使用通用SoftDeleteMixin自动清理账务记录。反向edge仅在确需ORM访问时添加，原User/Account/Group核心实体不额外搬表。Channel目前是SQL仓储，无ent/schema/channel.go；task.channel_id可只定义字段，FK由SQL维护，不为它引入虚假Ent实体。

生成命令沿backend/ent/generate.go的sql/upsert、intercept、sql/execquery、sql/lock与int64 ID；在C2执行go generate ./ent，并审查生成差异。资金原子操作继续用仓储内同一sql.Tx，不混用独立Ent事务和另一sql.DB连接。使用ApplyMigrations已有advisory lock和checksum框架；只在隔离PostgreSQL执行迁移测试。启动应用可能自动跑迁移，本轮没有启动后端。

## 7. 状态机、提交可靠性与 Worker

### 7.1 三条独立状态轴

生成状态：

    CREATED → SUBMITTING → QUEUED → RUNNING → COMPLETED
                  │          │        └────────→ FAILED（可信失败）
                  │          └─────────────────→ FAILED（可信失败）
                  ├→ SUBMISSION_UNKNOWN → 原任务恢复 → QUEUED/RUNNING/COMPLETED/FAILED
                  └→ FAILED（确定拒绝、没有生成）
    QUEUED/RUNNING/SUBMISSION_UNKNOWN → RECONCILING → 恢复原任务状态/可信终态

上游submitting映射SUBMITTING，但有upstream_id时后续只Query，不再Submit。QUEUED可直接到COMPLETED，RUNNING后迟到queued结果不能回退。RECONCILING保存previous_active_status；表示待核对，不能当成最终失败。未识别status保留原状态、记录安全错误码、安排复查。

账务状态：HELD → CAPTURED 或 HELD → RELEASED；“处理中/需人工处理”从对应event状态派生。生成终态与账务终态不同：COMPLETED+CAPTURE_PENDING、FAILED+RELEASE_PENDING都合法并要展示。文件下载状态独立UNKNOWN/NOT_READY/AVAILABLE/TEMP_UNAVAILABLE/EXPIRED；COMPLETED+EXPIRED仍为成功且已收费，不退款、不删账单。

### 7.2 事务边界

T1 本地创建事务，完全不调用KOKO：

1. 入口只读验参/权限/目录/选账号，获得不可变规范请求、能力版本及定价结果。
2. 事务首先插入video_tasks，以(api_key_id, client_idempotency_key)唯一键竞争；冲突读取原记录比请求哈希。此时尚未冻结，重复请求不会冻结两次。
3. 固定锁顺序取得user → APIKey → subscription（如有）→ user_platform → account额度行，再锁定/验证相关配置版本。重新检查Key/Group/User状态、余额、额度、账号身份、定价/能力版本；失效则回滚重算，仍未接触上游。
4. 钱包：balance -= price；frozen_balance += price；使用balance >= price的条件更新。订阅：不动钱包，在原subscription范围预留price并检查其剩余窗口；不切换资金来源。
5. 插入唯一finance HELD及各quota HELD，写CREATED审计事件。
6. COMMIT后才返回202。HTTP回包丢失时客户端按原幂等键取回原任务，不能新建替代任务。

受理任务行本身就是提交outbox，不依赖“提交后再写Redis队列”。可发送唤醒通知，但Worker只信DB；通知丢失仍会扫到CREATED。T1失败不产生上游费用。DB COMMIT回包未知则查幂等记录确认，不能凭异常判断没有冻结。

T2 Worker短事务claim到期任务，写SUBMITTING、submit_attempts、lease_epoch、审计，COMMIT。然后在事务外用稳定原账号、原body、原upstream_idempotency_key发起POST。T3用租约围栏更新上游id/状态；如已完成或失败，同事务写唯一CAPTURE/RELEASE账务事件。

POST后到T3前崩溃：数据库仍有SUBMITTING但没有upstream_id。新Worker不能当CREATED重分配账号；先转SUBMISSION_UNKNOWN。自动恢复只在上游明确保证该幂等键仍在有效重放期时，原账号、原请求、原幂等键重放；保存期尚未明确时进入人工核对。文档虽称可幂等重试，但没给保留期，不能保证无限期重放安全。本轮不通过POST试探该合同。

### 7.3 数据库租约与并发围栏

认领示意SQL（参数均绑定）：

    -- 短事务只认领本地处理权；外部请求必须在提交事务之后执行。
    WITH due AS (
        SELECT id
        FROM video_tasks
        WHERE status NOT IN ('COMPLETED','FAILED')
          AND next_check_at <= now()
          AND (lease_until IS NULL OR lease_until < now())
        ORDER BY next_check_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $1
    )
    UPDATE video_tasks AS t
    SET lease_owner = $2,
        lease_until = now() + ($3 * interval '1 second'),
        lease_epoch = t.lease_epoch + 1,
        row_version = t.row_version + 1,
        updated_at = now()
    FROM due
    WHERE t.id = due.id
    RETURNING t.*;

续租及结果写回都要求id、lease_owner、lease_epoch吻合且lease_until > now()；结果还检查读取时row_version。CAS无更新不覆盖新Worker结果。租约失效的旧Worker停止处理，绝不通过无条件UPDATE或另建新task补写。租约只保证本地处理权，不能撤回已发出的HTTP请求；外部重复提交安全依赖原账号稳定幂等键，不能宣称实现网络exactly-once。

终态处理锁任务并验证非终态/版本，写终态+唯一财务事件+审计一次；同时到达的轮询/未来回调只有一个胜出。未知或矛盾的第二终态进入审计告警，不反向改写已完成任务。C2没有已证实的KOKO回调协议，初版不增加公网webhook；未来如有回调，也必须鉴签并走相同CAS路径。

独立VideoWorkerRuntime使用context.Background派生生命周期context，Wire启动，Shutdown先停领取、取消并等待当前短操作，之后关闭DB/Redis。普通浏览器请求不拥有Worker；重启扫DB所有未终态、逾期租约和未完成账务事件即可恢复，不需浏览器IndexedDB重提。

### 7.4 拟议运行参数（仅方案，验收后才配置）

| 环节 | C2建议初值 | 边界及失败处理 |
| --- | --- | --- |
| DB扫描 | 每5秒、每批20条，可配置并发 | 分批claim；不是限制总任务数 |
| 单次上游Models/Account/Submit/Query HTTP | 60秒上限 | 网络操作失败进入恢复，不能作为生成总时限；提交超时视受理未知 |
| 任务租约 | 90秒，30秒续租 | 独立于视频耗时；失租围栏禁止写回 |
| 正常轮询 | 受理后15秒开始，逐渐到60秒并加随机抖动 | 全局按上游身份聚合限流；收到Retry-After优先遵守 |
| 同一上游身份请求预算 | 初始60次/分钟，预留下载/管理员查询余量 | 文档120RPM仅为文档声明；不能每Account各自用满导致同身份超限 |
| 连续错误 | 10次触发RECONCILING及告警，仍按较慢计划只读核对 | 不自动FAILED/退款；计数归零需成功响应 |
| 长时间等待 | 2小时提示“等待较久” | 提示不是超时；不设一小时生成失败阈值；人工核对保留冻结 |
| 账务失败 | 从5秒指数退避，封顶5分钟；20次转REVIEW | 事件不删除，资金不标成功，管理员可恢复原事件 |
| CDN跳转 | 最多5跳，单次短签名失效最多重新取址1次 | 超出返回可重试下载错误；不创建视频，不回退视频生成 |

以上改变实际行为的数值作为本次方案验收的一部分明确列出，不在C1落地；来自工程建议而非实时模型能力。正式并发、总输入体积和生成排队数量应结合上游合同/站点配置确认，不硬编码隐含上限。

### 7.5 安全重试和人工核对

- 还没发送任何提交字节：可以重做本地选账号，但必须回滚旧T1或明确取消尚未提交意图；C2简化为创建后固定账号，调度不可用就等待，不自动换号。
- 一旦T2标SUBMITTING，均视可能已发送；出现未知结果禁止换账号。明确拒绝后终结当前任务并解冻；用户主动重试是新任务、新幂等键、新报价与新冻结。
- 仍有原upstream_id：重试Query/Content就够了；不再次调用生成。
- 没有upstream_id：管理员凭上游后台订单、原幂等键、request-id等取证，绑定可验证原任务；不能凭余额减少推断哪一任务。更正绑定须专用受审计操作，在尚未绑定且无冲突时CAS允许写upstream_id。
- 无法确认上游受理：保留RECONCILING与HELD，向管理员暴露冻结金额/等待时长；未明确生成失败不能自动退款。人工最终放款/赔付必须写原因与上游证据，资金补偿走独立唯一操作ID。

## 8. 价格快照、冻结、结算与退款

### 8.1 四种数值必须分开

| 量 | 单位/来源 | 用途 |
| --- | --- | --- |
| quoted_upstream_points | points，账号GET /models的duration_prices优先，points仅该默认档 | 上游预算/展示管理员成本证据 |
| actual_upstream_points | points，可信任务响应/上游对账；没返回为null | 上游成本对账；不可用余额差冒充 |
| downstream_base_price | USD，站内明确模型/参数售价 | 用户收费基价，与KOKO积分无自动汇率 |
| final_charge | USD，创建时基价×当时生效的用户分组倍率，量化8位 | 冻结并在成功时捕获一次 |

KOKO定价解析新建专用KokoVideoPricingResolver，复用ModelPricingResolver的Group→Channel明确配置、BillingModeVideo/PerRequest、PricingInterval.Label以及GatewayService.ResolveUserGroupRateMultiplier。只接受来源group/channel且配置存在的按次价，不回落LiteLLM token价，也不把0当缺失；需要指针/配置存在标记区分明确免费与漏配。

参数价采用现有interval label能力：规范标签如duration=15;resolution=768p;mode=reference，精确命中后取相应PerRequestPrice。后台增加“视频参数档”输入辅助、严格校验唯一label、实际参数集合及完整覆盖，不能按token区间猜。可明确配置一个flat per_request_price用于所有获准参数；没有flat且无精确档则拒绝创建。若以后按素材数收费，必须扩展版本化价格规则与快照，不静默用旧flat覆盖新价格维度。已有GetRequestTierPrice把0当fallback的路径不能照抄，要保留明确0值。

用户分组倍率沿现有用户级覆盖逻辑：先用户GroupRate覆盖或Group.RateMultiplier；当Group.VideoRateIndependent=true时用Group.VideoRateMultiplier替代，避免叠乘两遍。snapshot记录base与effective、independent选择分支。KOKO按次收费不乘token高峰因子，不乘Account.RateMultiplier。渠道分时倍率如明确配置并适用于现有按次规则，需通过KOKO专用定价器在创建时解析为一个固定因子并冻结，不能完成时再读时钟。

示意：站内某参数档基价0.50 USD、用户有效倍率1.2，则hold=final_charge=0.60 USD；即使上游需要20积分，也不代表扣20美元或0.20美元。此例仅解释算法，不是本次正式售价。

pricing_snapshot至少保存：

    {
      "version": 1,
      "currency": "USD",
      "price_source": "group或channel",
      "pricing_record_id": "可追溯配置ID",
      "pricing_config_hash": "配置版本摘要",
      "requested_model": "用户所选别名",
      "billing_model": "本次冻结的计费模型",
      "upstream_model": "KOKO真实ID",
      "tariff_label": "duration=15;resolution=768p;mode=reference",
      "duration": 15,
      "resolution": "768p",
      "ratio": "16:9",
      "mode": "reference",
      "image_count": 1,
      "audio_count": 0,
      "count": 1,
      "base_unit_price": "示意，不填真实售价",
      "group_multiplier": "创建时值",
      "user_group_override": null,
      "video_independent": false,
      "effective_multiplier": "创建时值",
      "time_multiplier": "创建时解析值",
      "final_charge": "创建时量化金额",
      "hold_amount": "等于final_charge",
      "account_stats_multiplier": "仅统计，不参与用户收费",
      "quoted_upstream_points": "实时目录预计积分",
      "upstream_capability_hash": "证据摘要",
      "pricing_at": "创建时UTC",
      "rounding": "既有8位量化约定",
      "funding_source": "wallet或subscription",
      "subscription_id": null,
      "quota_platform": "openai"
    }

本例是字段说明，不是实际响应，不能当测试真实计费数据。实际JSON数值字符串必须是合法十进制，原始hash包含所有影响报价的参数。任务重启、改价、Key改组、倍率改变、账号下架，都不能重算原任务收费。

### 8.2 持久额度预留

只有冻结钱包余额仍不够：API Key总额度、5h/1d/7d金额窗口、订阅、user×platform以及账号额度都可能被并发任务穿透。video_quota_reservations为每笔任务留下原scope与金额，HELD不随HTTP/Redis TTL释放。

- key_total：scope为KeyID。创建时quota_used+其他HELD+本次金额<=quota；0额度上限沿既有“无限”语义。成功转真实quota_used，失败只释放预留。
- key_windows：scope为KeyID，snapshot保存创建时5h/1d/7d的窗口配置及金额。仍未完成的预留在任一当前活跃窗口都计pending，跨窗不自动消失；完成时按现有窗口重置规则计入当时窗口并释放pending。不能从已重置窗口硬减旧费用。
- subscription：scope为原SubscriptionID。T1锁原订阅、校验其激活和组限制；把HELD纳入日/周/月限额。成功在原订阅按既有窗口函数计用量，失败解除pending；订阅后来到期不把已接受任务改扣钱包。套餐删除/取消先检查HELD；不会因未加载“当前有效订阅”把历史费用记错人。
- user_platform：按创建时有效目标openai（复合组也如此）生成scope，与现有QuotaPlatform一致；nil无限、0禁用的语义不变。需要与user_platform_quotas的当前窗口和同步/flush机制对齐，成功只计一次。为避免旧Redis绝对值flush覆盖视频计费，视频已用量单独从该scope的CONSUMED账本按finalized_at聚合；既有user_platform_quotas及其Redis快照只代表旧业务用量，两者相加，不把视频再次写入旧usage列。
- account：使用站内账号额度所需USD统计成本快照，不直接用points塞入美元额度。没有明确成本换算且配置了成本额度/利润门槛时，拒绝新任务并报配置缺失；不假称上游积分等于USD。上游余额/积分预算检查与此分开。

共享准入增加只读的持久pending查询：对有KOKO记录的scope把HELD加到现有pending判断；平台维度还要加当前窗口内CONSUMED视频用量，即使已经没有HELD也不能跳过；其余请求既有价格、用量、最终扣费逻辑均不改。新增VideoQuotaReservationReader接入BillingCacheService与API Key认证总额度检查，不替换聊天/图片原结算队列。pending从DB真相读取；缓存只是加速，失效/Redis重启要回源，KOKO创建时DB不可用不放行。钱包balance已经减去hold，不再次减同一pending。

同一scope的新KOKO T1通过原实体行锁串行判限；固定锁序避免死锁。现有聊天的“未知最终Token费用”仍受既有在途估算/完成后计费行为约束，本次不承诺将旧系统全部改为严格事前计费。混合流量必须验证新的pending不会被忽略，也不能把旧Token请求估算当精确金额。若这一共享准入改动未完成，对受限/共享Key不开放KOKO，不能用“仅校验余额”绕过其他额度。

### 8.3 成功捕获事务 T4

账务Worker先只读选一个候选CAPTURE/RELEASE事件，然后在T4按固定归属锁顺序取锁，最后对该event执行FOR UPDATE SKIP LOCKED并复核待处理状态；未取得event锁即回滚本轮。全部资金操作在同一短数据库事务内完成，没有外部HTTP调用：

1. 按全局锁顺序锁归属实体，再锁task、finance、quota及event，核对task终态/operation、所有ID、payload_hash、snapshot_hash。
2. CAPTURE要求task=COMPLETED且finance=HELD；已CAPTURED且金额/指纹相同是幂等成功，不能再扣。
3. 钱包：frozen_balance -= hold；balance += hold - final_charge。本版hold=final_charge，通常只减少冻结。条件要求该task确有HELD且冻结总额足够，不能从另一任务冻结池“借款”。
4. 订阅：对原SubscriptionID执行一次窗口用量更新，无钱包移动；预留只能CONSUMED一次。
5. 以稳定request_id=video:cap:{public_id}调用同仓储包的applyWithinTx或新增视频专用tx helper：BalanceCost=0、已单独结订阅时SubscriptionCost=0，其余Key/窗口/账号用量按快照转换。写usage_billing_dedup与UsageLog和资金效果同事务。严禁捕获冻结后再走普通BalanceCost=final_charge扣第二次。
6. 同一条UsageLog：media_type=video、billing_mode=video、video_count=1、video_duration_seconds/分辨率原值、requested_model/upstream_model/group/account/key、total_cost基价和actual_cost用户实付、创建到完成E2E时间；不填伪造Token。上游points保存在task/财务审计，不填Token或美元成本字段。
7. finance→CAPTURED，quota→CONSUMED，event→APPLIED；插入唯一CACHE_FINAL失效事件；COMMIT。日志插入、计数、任一资金SQL失败全部ROLLBACK。

现有ApplyWithUsage是自行开事务的公开方法，不能在T4外先调用然后再写finance。C2在repository包内封装视频tx方法，保持现有公开方法和旧调用点语义不变。dedup命中而finance仍HELD属于不一致待核对，不能简单认定钱已扣或再扣一次。

免费明确配置仍记视频任务/财务事件，现有usage统计使用actual_cost>0筛成功，可能不把免费任务纳入成功用量统计；本次不改该历史规则，任务中心从video_tasks准确显示。

### 8.4 失败释放事务

RELEASE要求task=FAILED、finance=HELD且事件指纹一致。钱包balance += hold、frozen_balance -= hold；订阅不动钱包、不增加真实usage；quota→RELEASED；finance→RELEASED；event→APPLIED；审计写唯一video:rel:{public_id}；COMMIT。上游已退积分不意味着本地下游已经解冻，两者独立状态。

CAPTURE和RELEASE虽然可分别有唯一event，但二者竞争同一finance.state，只能从HELD走一个方向；即使错误地重复收到两类意图，失败那条转REVIEW并告警，不能把CAPTURED普通改成RELEASED。实际已结算任务的人工退款是新的受审计补偿，不重用“释放冻结”操作。

COMMIT返回丢失后先读event+finance+dedup；保持原request_id重放，不能新ID补扣/补退。资金已变而状态未变的中间态在一个PostgreSQL事务内不存在。软删用户仍保留账务行：视频专用tx helper允许对该原ID的已有HELD做释放/结算，不创建/激活用户；不会套用旧helper的deleted_at条件导致永久无法退钱。

账务事件失败后另一个短事务持久化attempts、next_attempt_at和安全错误码。不能因为原事务回滚而连重试记录一起丢失。可以用SAVEPOINT回滚效果后记录事件重试，或完整回滚再按event版本写重试；两种路径都需并发测试。

### 8.5 账务恢复、缓存与人工对账

创建冻结后T1写CACHE_HOLD事件，最终结算后T4写CACHE_FINAL事件，分别唯一，重放做“失效后重新加载”，不做可重复相加/相减的缓存增量。余额、Key认证、速率窗口、订阅、平台额度、模型目录等按涉及维度失效。DB已提交但Redis失效失败不重做资金SQL；缓存事件可反复执行直至成功。

已进一步核实service/user_platform_quota_flusher.go与repository/user_platform_quota_repo.go：BatchSnapshotUsage是Redis绝对值覆盖，代码已注明admin写入交错的竞态。最终选择不修改它：KOKO的平台用量以video_quota_reservations的CONSUMED账本为独立增量来源，按站内相同自然日/周/月起点用finalized_at求和；现有预检读取legacy usage + 视频已结 + 视频HELD。T4不对旧平台usage列/Redis累加，禁止双计，也不让legacy flusher覆盖视频账本。新增独立查询接口和索引，其他Key/订阅/账号仍使用已有真实计数。平台额度展示/管理员重置必须明确包含视频账本；初版重置视频计数需显式受审计操作，不因清旧Redis快照而抹掉视频消费。C2需用flusher交错/窗口切换验证这一边界。

巡检输出：未终态且无下次检查、逾期租约、SUBMISSION_UNKNOWN、终态无finance终结、HELD超长、CAPTURE与RELEASE冲突、UsageLog/dedup缺失、缓存事件未完成、上游积分退款未核实。对账基于task_id/稳定request_id/快照，不扫描历史聊天账单重收费。

用户总frozen_balance是批量图片等共享合计，不能直接重置为SUM(video HELD)。人工修复需核对各来源预留账本，写独立唯一操作ID、操作者、原因、证据；只补偿差异，不改原价快照或原终态。管理员只允许恢复原event、确认原上游绑定、标记核对证据和执行显式补偿；后台不提供“重试生成”一键隐含收费。

## 9. 下载、期限与凭据隔离

### 9.1 不存成片

Sub2API不落盘MP4、不写对象存储、不接R2、不自动转码，也不把成片Blob保存IndexedDB/Canvas资产库。浏览器用户主动下载到本机不受此限制。服务端保留任务、参数摘要、财务与到期证据；敏感请求体只存加密重放载荷，保留策略独立于视频文件期限。

推荐本地鉴权content入口采用流式中继，既不存储MP4，也避免浏览器携带用户Bearer跨域。它会消耗网关带宽，但符合不保存文件的决定；上线资源评估需包含这部分带宽。不要直接把307交给携带用户API Key的浏览器fetch，避免浏览器自动转发链路不可控。

### 9.2 三类有效期

1. retention_expires_at：上游实际成片可取的保存截止。优先读取上游明确的绝对时间；若未来返回downloadTtlHours，还必须有可信起算时刻（真实completed_at或接口方明确规则），并保存原字段、来源、观察时间。第一次轮询看到completed只是发现时间，不一定是生成完成时间，不能精确倒推。
2. 任务查询返回的video_url签名期限：文档约1小时，属于链接凭证期限，过期可用原任务重新取得。
3. 307最终Location的CDN短链：文档约30秒，需要立即取流，不能入库作为永久地址，也不能据其expires参数推断成片保存截止。

本次models/account没有任何到期字段，任务接口亦未获准实测。因此当前只能设计展示“临时保存，截止时间上游未提供，请及时下载”，不能展示72h/48h倒计时。用户要求的“成功后可验证截止时间”仍未满足，属于收费开放阻塞；若上游补齐可靠字段/合同，C2接入后才显示绝对北京时间及证据说明。

明确retention已过期或上游可信错误明确文件永久过期时download_state=EXPIRED；保留COMPLETED和CAPTURED。单次401/403可能短签名失效，404也可能临时/权限/文件问题，不能直接判成片过期；刷新原任务后确认，不明则TEMP_UNAVAILABLE，不伪造已过期。

### 9.3 安全取流步骤

1. 校验原任务归属及生成完成；尚未完成409 VIDEO_NOT_READY；可信已过期410 VIDEO_EXPIRED。先Query原upstream_id取得当前地址；必要时调用原任务/content，绝不POST生成。
2. 向可信KOKO API origin请求时只装服务端KOKO Bearer；不复制用户Authorization、x-api-key、Cookie、Referer或任意Account.ApplyHeaderOverrides到内容CDN。
3. 复用service.WithHTTPUpstreamRedirectsDisabled及repository/http_upstream.go支持的ErrUseLastResponse，显式读取每次307/302/303/308 Location，解析相对地址，重新验证HTTPS、端口、host、公共IP和DNS结果；固定最大跳数和环路检测。只允许已审核的KOKO签名入口及实际CDN列表，域名后缀匹配要有点边界，不能用contains。
4. 每一跳都新建请求，headers白名单仅Range、If-Range、Accept等必需内容头。即使回到KOKO域，也不要自动复制上一次请求的Bearer；只有明确的API content端点通过单独鉴权构建函数才可装KOKO Key。CDN请求不带任何Bearer/Cookie，禁用cookie jar；清除Proxy-Authorization以外不相关头，代理认证仅由Transport到代理处理。
5. 使用WithHTTPUpstreamPublicHostsOnly或等效逐跳公共IP验证，阻断localhost、私网、metadata、IPv6本地、DNS rebinding。注意两个context flag同时设置时http_upstream.go当前switch优先“禁跳转”，所以新建每一跳时仍需先做目标验证，不能以为自动redirect checker会继续运行。
6. 支持GET与HEAD；Range单段原样转发、If-Range强ETag/Last-Modified按客户端给定转发。保留200/206/416、Content-Range、Accept-Ranges、ETag、Last-Modified、准确Content-Length，不能把请求Range而上游200改成206；客户端收到200必须重下而不是追加。
7. 流式传输前核对Content-Type：video/*、application/octet-stream、binary/octet-stream可接受；有限前缀探测并回放，不整片缓存。JSON/HTML错误不得以video/mp4成功发回，不把307响应正文当视频。文件名使用本地public_id生成并清理，Content-Disposition=attachment，X-Content-Type-Options=nosniff，Cache-Control=private,no-store、Referrer-Policy=no-referrer。
8. 不透传Set-Cookie、上游鉴权头、内部Location、含签名响应头或原始错误正文。用户断开仅取消本次下载流，任务及账单不变。
9. 短签名失效在尚未输出body时可按方案有限刷新一次并重取原任务；已输出字节则结束并让客户端按Range重试，不能在同一响应悄悄拼接另一版本文件。断点需校验同一ETag/Last-Modified；没有稳定标识就完整重下。
10. 下载失败不修改生成终态，不触发二次费用；只更新last_content_checked_at/安全错误及download_state。预览不保证所有原始编码浏览器可播，无法播放时仍可提供符合条件的原文件下载。

任务列表不主动GET完整视频做可用性探测，也不在后台周期下载MP4；需要验证时使用HEAD或受控极小Range，须在C2授权的历史任务测试中执行。本轮未做。

## 10. V5 UI 接线与 Canvas 边界

沿用frontend/src/views/user/ImageStudioView.vue当前V5视频创建区、任务列表、统计、筛选和详情；可抽出CreationVideo.vue维持原DOM/布局职责。Midnight HUD、图片iframe、聊天SSE/IndexedDB继续保持。模型与Key自动匹配/手选保留useCreationSelection逻辑，视频目录从新服务读取，按能力禁用参数而不是把旧常量改成另一个静态数组。

任务列表来自服务端；本机只保留草稿、筛选和未确认提交的幂等键等小量偏好，不以localforage任务表充当真相。未确认提交的幂等键必须按UserID+KeyID隔离且不得保存密钥/完整大请求；刷新后通过本地任务列表/原幂等查询恢复。切账号清视图、取消旧读取、迟到响应校验user+key+task，不能因更换当前选择Key而把旧任务查询发给新Key。

无真实progress时仅显示排队/生成中、已等待时长、最新检查时间、下次检查及待核对原因。2小时等提示不结束任务。详情显示参数与已冻结/结算/释放金额，生成失败但退款处理中须明确区分。

下载可用需要COMPLETED、非已证实过期，并在点击时服务器重新核验；AVAILABLE只说明最近核验可取，不能保证未来网络。unknown期限明确提示，无虚假倒计时；过期条目保留账单和详情，移除下载按钮。账务暂时结算失败保持可追踪状态，不因重新查询重复扣费；是否在账务REVIEW时限制下载应作为产品策略明确，默认生成成功仍可取已预留资金对应文件，避免等待结算导致成片过期。

Canvas核对结论：

- canvas/web/src/pages/video/index.tsx保存本地GenerationLog并由浏览器poll；services/api/video.ts的waitForVideoGenerationTask最多120次×2.5秒（另加网络时间），不能承接服务端一小时生命周期。
- video-model-config.ts硬编码四模型及旧分辨率/默认时长；不能用于本轮动态参数。
- storeGeneratedVideo会调用uploadMediaFile，现有React页面成功后会自动存储；KOKO接入不得走这个自动保存路径。
- 当前宿主bridge.studio固定image，backend/internal/web/canvas.go也不开放/canvas/video；V5视频实际是Vue骨架，并非旧React VideoPage。C2直接给已验收V5 Vue视频区域接Sub2API三接口，不重写Infinite Canvas、不重新开放旧供应商直连页面。Infinite Canvas产品中的视频请求由该V5工作台统一发起；现有React旧视频实现保留为参考，不作为第二套上线任务中心。
- 如果后续明确要求在React视频节点内部调用，同样通过Sub2API受控适配器与服务端任务ID，不能重新引入KOKO密钥或自动存成片；这不是本次C2必须改桥接/开放旧路由的理由。

只读参考代码保留，不执行旧测试里的真实供应商调用。C2回归要断言V5视频不会触发storeGeneratedVideo、对象存储、旧前端model-plugin或pay.kokoai.online直连。

## 11. Mock、故障注入与验收标准

本节是C2测试计划，本轮没有编写或执行这些业务测试。使用httptest本机假KOKO服务、临时PostgreSQL、现有Redis测试设施；禁止测试访问真实域名、真实Bearer或POST生成。Mock的时间由可注入Clock控制，不实际等待一小时；金额使用明确十进制断言。

| 场景 | 必须断言的结果 |
| --- | --- |
| /models两数组不一致 | data列出oo但models.enabled=false时不能创建；pp缺失不能作为有效候选 |
| 缺失TTL、modes、视频素材字段 | 返回unknown及证据来源；不设48h、不把空字段变成支持 |
| 实时mm15/30积分不同 | quoted20/40；下游分别采用站内规则，不把points40套15秒 |
| 768p/1K/1080p及别名 | 原值传递；不走Grok 480p/720p归一化；requested/mapped/upstream分离 |
| unicode prompt边界 | 汉字、换行、emoji按UTF-16单元校验，文件/JSON保持UTF-8中文 |
| 音频false/max0、维护、未知视频 | 明确拒绝，不静默剥离素材；不调用上游 |
| 提交幂等并发20次 | 一个本地task、一次冻结、一组额度预留；同键异body409 |
| T1 COMMIT前断电 | 无任务/无冻结/无上游请求 |
| T1成功、202回包丢失 | 原幂等重查同task，不二次冻结 |
| T2后、POST前崩溃 | 恢复进入unknown；只按经证实幂等合同重放，不换Account |
| POST已受理、TCP超时/响应无id | SUBMISSION_UNKNOWN+HELD，不退款、不换号；Mock验证多次同键只建一个远端任务 |
| 上游id到达但本地T3写入失败 | 恢复原账号/稳定键核对；不从CREATED再随机调度 |
| 双实例租约/慢旧Worker | SKIP LOCKED无重复持有；epoch较旧的响应无法覆盖较新状态 |
| 重启/浏览器关闭/Redis清空 | Worker从PG继续；冻结、原价、绑定与任务不丢 |
| 持续运行超过1h/2h | 状态仍RUNNING或RECONCILING；只提醒，不自动失败退款 |
| 查询429、401、404、未知status | 正确分类/退避/待核对；无第二次提交，无终态推断 |
| completed与failed并发/重复回调模拟 | 条件更新只接受一个终态；一个资金方向；无伪造进度 |
| 资金已改但usage插入报错 | 全事务回滚，HELD可重试；不出现先扣后无账单 |
| CAPTURE成功回包丢失 | 同事件重放不再扣，UsageLog和dedup恰好一条 |
| RELEASE成功回包丢失 | 同事件重放余额只归还一次；CAPTURED不能用release解冻 |
| 账务多次失败/人工恢复 | 事件进入RETRY/REVIEW但未删除；恢复后原价结算 |
| 改价/改倍率/Key改组/原订阅过期 | 原任务快照不变；不改资金来源；新创建重新授权报价 |
| 钱包、Key总额、窗口、平台、订阅并发 | DB足额预留；窗口跨越仍计HELD；已结与legacy平台用量不双计 |
| 平台dirty flusher与视频成功交错 | legacy覆盖写不会丢视频CONSUMED；预检读合计；重启仍一致 |
| 用户/Key软删、Account删改 | 不可越权；已有资金可结束；凭据丢失明确待核对，不换号 |
| CDN 307多跳、同父域恶意域/私网/DNS变更 | 每跳验证，任何第三方抓包均无KOKO Bearer/用户Key/Cookie |
| Range/HEAD/If-Range/416及上游200 | HTTP语义不改写，不拼错文件；307/JSON/HTML不冒充视频 |
| 链接过期但成片仍在 | 对原任务刷新链接，仅下载；不改COMPLETED/CAPTURED |
| 成片明确过期/未知期限 | 410与无下载按钮；未知显示unknown；账单/任务保留 |
| 服务端文件写入/R2间谍 | 生成/查询/下载全过程无MP4落盘、无R2调用、无自动存Canvas资产 |
| 原Grok/Ark/聊天/图片回归 | 原URL、调度、费用、退款与UI行为不变 |

C2数据库测试至少包含：从空库迁移、重复应用、外键/唯一/金额/终态约束、不可变字段触发器、两条连接竞争、重启恢复、提交COMMIT确认丢失、SKIP LOCKED与租约围栏。只在临时测试库执行，不触碰本机/线上业务库。

HTTP契约测试验证公开DTO、OpenAPI字段说明和JSON字符串金额；授权测试覆盖另一用户、本人另一Key、改组、禁用Key、耗尽Key、已删除Key与JWT列表。下载测试至少一个假CDN端点记录所收到的全部header，明确断言所有敏感头为空。避免把真实响应完整原文/客户提示词写入golden。

前端沿现有Stage A/B浏览器Mock设施扩展：四种尺寸、自动/手动Key切换、动态组合参数、创建后刷新/换页、处理中/下载/失败/过期、详情、unknown期限、迟到响应丢弃、登录换号；模拟生成不下载真文件、不连KOKO。页面没有百分比占位，不改HUD高度/图片工作台。

## 12. C2 精确文件清单及实施步骤

### 12.1 新增文件（均相对于D:/workspace/code/sub2api）

| 路径 | 职责 |
| --- | --- |
| backend/internal/service/video_provider.go | Provider接口、规范请求/结果、确定拒绝/受理未知类型 |
| backend/internal/service/koko_video_provider.go | KOKO Go适配、原账号HTTP、实时字段解析、参数校验 |
| backend/internal/service/video_model_catalog.go | 每账号能力证据、目录合成、缺失字段与版本 |
| backend/internal/service/video_task.go | 任务生命周期、归属授权、创建幂等、服务接口 |
| backend/internal/service/video_pricing.go | 参数价、用户倍率、decimal快照、显式缺价处理 |
| backend/internal/service/video_billing.go | HELD/CAPTURE/RELEASE事件与恢复/对账 |
| backend/internal/service/video_quota.go | 持久HELD读取、平台独立已结用量合并，不改旧flusher |
| backend/internal/service/video_worker.go | Claim、Submit/Query、退避、围栏、恢复 |
| backend/internal/service/video_worker_runtime.go | Start/Stop及生命周期接线 |
| backend/internal/service/video_download.go | 即时取址、凭据隔离、逐跳校验、Range取流与期限 |
| backend/internal/repository/video_task_repo.go | 同事务创建/幂等/租约/CAS/列表/审计 |
| backend/internal/repository/video_model_repo.go | 能力与合同快照 |
| backend/internal/repository/video_billing_repo.go | 资金/额度/日志事务及账务事件重放 |
| backend/internal/repository/video_quota_repo.go | scope预留/已结求和与现有额度的合并查询 |
| backend/internal/handler/video_handler.go | 三个目标端点、HEAD、列表与目录 |
| backend/internal/handler/user_video_handler.go | JWT本人跨Key历史列表/详情 |
| backend/internal/handler/admin/video_handler.go | 能力刷新、异常队列、核对/恢复/补偿，不隐式重生成 |
| backend/internal/handler/dto/video.go | 中文Swagger字段说明、校验、响应脱敏 |
| backend/ent/schema/video_provider_model.go | 能力实体 |
| backend/ent/schema/video_task.go | 任务实体 |
| backend/ent/schema/video_financial_reservation.go | 资金预留实体 |
| backend/ent/schema/video_quota_reservation.go | 额度预留/独立已结平台账本 |
| backend/ent/schema/video_billing_event.go | 账务事件实体 |
| backend/ent/schema/video_task_event.go | 审计实体 |
| backend/migrations/248_koko_video_tasks.sql | 六表/索引/约束/触发器；编号C2重查 |
| backend/migrations/249_koko_video_group_gate.sql | KOKO专用组开关，默认false |
| backend/docs/koko-video.openapi.yaml | 新视频接口OpenAPI、字段description与错误示例 |
| frontend/src/lib/creation-video.ts | 同源API客户端、模型能力/任务DTO、受控错误 |
| frontend/src/composables/useCreationVideo.ts | V5创建/列表/详情/Key归属/前端轮询 |
| frontend/src/components/video/CreationVideo.vue | 迁入已有V5视频骨架并接真实数据 |
| frontend/src/components/video/VideoTaskDetail.vue | 原布局风格的任务/账务/期限详情 |
| tools/creation-stage-c-preview.mjs | 本地Mock，无真实供应商转发 |
| tools/creation-stage-c-browser-test.cjs | V5交互、安全、布局回归 |
| canvas/STAGE_C2_REPORT.md | 实施后交付与实际测试证据 |

相应新增测试文件：service/koko_video_provider_test.go、video_task_test.go、video_pricing_test.go、video_worker_test.go、video_billing_test.go、video_download_test.go、video_quota_test.go；repository/video_task_repo_integration_test.go、video_billing_repo_integration_test.go、video_quota_repo_integration_test.go；handler/video_handler_test.go；frontend/src/lib/__tests__/creation-video.spec.ts、composables/__tests__/useCreationVideo.spec.ts、components/video/__tests__/CreationVideo.spec.ts。后端前三组目录前缀分别为backend/internal/service、backend/internal/repository、backend/internal/handler；完整路径据此前缀拼接。测试只使用Mock密钥。

### 12.2 修改既有文件

| 精确路径 | 限定修改范围 |
| --- | --- |
| backend/internal/server/routes/gateway.go | 仅新增KOKO POST分发、保留前缀GET/HEAD分发、目录/列表；Grok/Ark路由保留 |
| backend/internal/server/routes/user.go | 增加JWT本人历史列表/详情 |
| backend/internal/server/routes/admin.go | 新视频管理/核对入口挂载，沿既有管理员审计 |
| backend/internal/server/middleware/api_key_auth.go | KOKO只读端点有限skipBilling、Key总额持久pending；不放宽Grok旧路径 |
| backend/internal/service/account.go | 显式koko_video能力与APIKey/平台限制；不用默认true |
| backend/internal/service/admin_account.go | 凭据scope/活动任务改绑删除保护、能力配置校验 |
| backend/internal/handler/admin/account_handler.go | 对接上述安全配置及只读能力刷新 |
| backend/internal/service/openai_account_scheduler.go | 能力及完整参数可行账号候选；不改原模型评分语义 |
| backend/internal/service/openai_gateway_scheduling.go | 调度入口传KOKO能力/候选过滤；本轮已确认文件存在 |
| backend/internal/service/composite_model_route.go | videos端点常量及规范化支持 |
| backend/internal/service/composite_route_resolver.go | 精确视频路由解析，保存原model，避免重复映射 |
| backend/internal/service/group.go | AllowKokoVideoGeneration，与旧Video配置区分 |
| backend/ent/schema/group.go | KOKO专用开关，默认false |
| backend/internal/service/admin_group.go | 开关校验和更新；不清除/改写Grok/Ark定价 |
| backend/internal/repository/group_repo.go | 新开关字段读写/缓存快照 |
| backend/internal/handler/admin/group_handler.go | 管理DTO开关 |
| backend/internal/handler/dto/types.go、mappers.go | Group开关/必要管理字段中文说明；不增加凭据输出 |
| backend/internal/service/billing_cache_service.go | 现有准入增加视频pending/平台独立已结用量，既有定价/结算不变 |
| backend/internal/repository/usage_billing_repo.go | 仅必要的tx helper复用点；原公开方法/旧分支不改规则 |
| backend/internal/handler/gateway_handler.go | /models可选安全video标记或目录过滤；保持聊天目录兼容 |
| backend/internal/service/gateway_service.go | 模型目录缓存与新video目录失效接点，不改聊天转发 |
| backend/internal/config/config.go | 视频功能开关、轮询/租约/取流等经过验收的配置 |
| backend/internal/service/wire.go、repository/wire.go、handler/wire.go | Provider/Repo/Handler/Worker依赖注册 |
| backend/internal/handler/handler.go | Handlers新增字段 |
| backend/cmd/server/wire.go | runtime启动/cleanup；先停Worker再关基础连接 |
| backend/cmd/server/wire_gen.go及backend/ent生成代码 | 使用仓库命令生成、限定生成差异，不手工编辑生成器结果 |
| frontend/src/views/user/ImageStudioView.vue | 用CreationVideo接入已验收视频区 |
| frontend/src/composables/useCreationSelection.ts | 视频授权目录/模型与Key匹配，其他两工作台行为不变 |
| frontend/src/styles/creation-studio.css | 只补原V5任务状态/详情必要样式 |
| frontend/src/i18n/locales/zh/imageStudio.ts、en/imageStudio.ts | 状态/期限/账务/错误文案 |
| frontend/src/views/admin/AccountsView.vue | 显式KOKO能力、维护/目录刷新展示 |
| frontend/src/components/account/CreateAccountModal.vue、EditAccountModal.vue、credentialsBuilder.ts | 新能力的安全配置控件/构建字段 |
| frontend/src/views/admin/GroupsView.vue | KOKO组开关、使用现有模型按次价/参数档输入辅助 |
| frontend/src/views/admin/ChannelsView.vue | 必要的视频参数档定价辅助，不改渠道凭据模型 |
| frontend/src/api/admin/accounts.ts、groups.ts | 管理类型/字段；两文件已核对存在 |
| frontend/src/api/admin/index.ts | 必要管理客户端导出；文件已核对存在，不新建平行API层 |

本表是C2计划，不是C1修改清单。表内既有管理客户端、调度入口、路由及仓储路径均已核对存在；C2开始仍需核对用户后续改动，禁止根据旧摘要覆盖文件。OpenAPI当前未发现全局Swaggo生成命令，因此先在DTO/handler保留兼容注释，并交付独立OpenAPI文件及契约校验，不声称已有Swagger运行时；若新增生成工具应单独评估依赖，而非顺手全仓集成。

以下文件为C2明确保护对象：handler/grok_media.go、service/grok_media.go、handler/seedance.go、service/seedance.go、service/image_task.go、repository/image_task_store.go、普通聊天和图片计费分支、canvas/web/src/pages/video/index.tsx、services/api/video.ts、lib/video-model-config.ts、图片Canvas源代码和canvas-host-bridge.ts。原代码作为回归对象，不重新开放旧React视频业务路径。确需跨模块调整时必须证明不会改变既有协议/账务，不能借C2修复无关事项。

### 12.3 分步骤实施与关卡

1. **锁定工作区与合同**：C2获批后记录Stage A/B及现有未提交改动摘要，核对本报告精确路径；确认KOKO账号配置、生成模式/素材必需规则、期限字段、幂等重放期、正式售价和本报告运行参数。缺失的模型设置capability_unknown并禁创建，仍可做Mock。初版功能默认关闭。
2. **DDL/Ent/仓储**：新增迁移与实体，实施唯一约束、复合FK、不可变触发器、租约CAS，完成隔离PG并发与迁移测试。此时不接真实KOKO提交。
3. **Go Provider与动态目录**：实现Models/Account/Validate/Submit/Query接口，用本次脱敏字段制作Mock，明确缺字段行为；配置base和proxy只在服务端。只读真实目录可按原范围验证，不自动扩展为创建授权。
4. **报价与T1原子预留**：明确站内价格，snapshot+finance+quota+task同事务；接共享pending准入和平台独立已结账本；测试重复创建、资金不足、跨窗/多Key/混合旧业务。
5. **Worker与恢复**：claim/续租/围栏、T2/T3、unknown/reconciling，重启/双实例/提交不确定测试；未知提交不换号。
6. **结算/退款/对账**：实现T4和持久事件、UsageLog/dedup同事务、CACHE_HOLD/FINAL失效恢复、人工审计；故障注入验证既不重复扣退也不漏费用意图。
7. **下载与期限**：流式中继、逐跳无凭据、SSRF/Range/HEAD/错误识别；绝对截止证据尚缺则保留unknown并关闭需要精确期限承诺的生产放行，不能修改成固定天数凑验收。
8. **V5前端接线**：保留既有工作台/选择器；接动态参数、任务中心/详情/筛选、到期提醒、账务状态。服务端为真相，不开旧Canvas自动存片路径。
9. **全套Mock与范围回归**：运行上述PG/服务/契约/浏览器故障测试及原Grok/Ark/聊天/图片回归；只构建必要产物，不部署、不改线上。汇总真实执行结果与未验证边界。
10. **C2交付停点**：提交开发报告给用户验收，保持生产开关关闭。收费验证需单独获得模型/次数/预算授权；历史任务下载验证也应使用用户授权的既有task。未经明确批准不自动创建真实收费任务、提交、推送或部署。

每步前置依赖明确：没有T1资金原子性不得启用Submit；没有原账号持久化/unknown恢复不得实发；没有T4幂等不得收费开放；未有可核验期限不得假装完成到期提示要求。UI可与后端Mock开发交错，但不能用UI通过掩盖账务或合同未闭环。

## 13. 风险、阻塞与进入 C2 判定

| 事项 | 当前证据/风险 | 对开发及放行的影响 |
| --- | --- | --- |
| 密钥与只读连通 | 本次Models/Account 200，active，275 points | 只读核验已解除阻塞；不证明收费权限/充足并发 |
| 启用模型 | minimax、mm启用；oo维护；pp未返回 | 实时目录可作为C2输入；oo/pp不得开放新任务 |
| 模式与必需素材 | 实时不返回modes/requiresImage；旧文档/插件互有冲突 | Provider与UI可做unknown；具体模型创建在合同补齐前保持关闭 |
| 成片期限 | 实时无downloadTtlHours/绝对到期；mm/oo文档无可靠值，minimax72h也仅文档 | “可验证下载截止时间”尚未满足，是收费开放阻塞；不能写固定48h |
| 幂等保留期 | 文档声明同账号重放，但未说明保留期/参数冲突/账号scope精确定义 | Unknown自动重放需明确合同；未获确认采用人工核对，不无限自动POST |
| 实际任务响应 | 本轮未查任何已有任务，更未创建 | 提交、完成、退款、307链/Range仍为待C2 Mock及后续授权真实验证 |
| 下游售价 | 未指定正式模型/参数售价、倍率策略待本方案验收 | 可实现价格引擎；正式收费前必须明确配置，缺价拒绝 |
| 站内资金与额度 | 有批量图片SQL可借鉴，但不是通用视频事务；平台Redis绝对值覆盖 | 独立视频账本+共享准入是必做，不直接复制异步图片/Stage7隔离事件 |
| 账号凭据安全 | 本轮不改账号存储；现有Account.Credentials为JSONB，不能据有credentialcipher目录就声称已全量加密 | 任务不复制Key；部署应确认现有后台凭据保护/日志脱敏与轮换过程 |
| 请求素材重放 | URL可过期，base64较大；提交未知时必须重放完全相同请求 | 加密、限体积持久载荷；材料到期不能换新URL重放同幂等键，转人工 |
| 下载流式带宽 | 不保存MP4但中继仍耗网关带宽；CDN域与Range未经本轮实测 | C2按可配置白名单/Mock实现；上线前授权既有task验证 |
| 历史UI任务中心 | Stage A是Vue V5骨架，旧React本地日志并非可靠后台任务 | 沿V5接新服务，避免双任务中心与自动上传成片 |
| 多实例与长等待 | 旧缓存TTL/进程goroutine不足 | PG租约/epoch围栏、没有生成总超时、异常冻结需可见可恢复 |
| 收费/发布授权 | 用户明确要求停在C1 | 本报告完成后停止，待批准C2；未获准任何真实生成或发布动作 |

最终判断：C1已完成所允许的真实只读核验及本地技术分析，报告给出可执行的C2实现边界、数据库事务与故障验收方案。**进入C2源码实施：有条件具备，须用户批准；开放真实收费视频：尚不具备。** 缺失上游字段已经明确列为合同阻塞，而不是用旧插件或推测值填补。C2可以从持久化/Provider Mock开始，不必为等真实视频而突破本轮禁止收费限制。

## 14. 本轮文件保护与交付检查

- 实际唯一新增文件：D:/workspace/code/sub2api/canvas/STAGE_C1_FINAL_REPORT.md。
- 对Sub2API的backend/internal、backend/ent/schema、backend/migrations、backend/cmd、frontend/src、canvas/web/src及Stage A/B报告，以及New API的plugins/tasks/koko、service、model、relay建立并复核SHA-256摘要，共4,676个文件，差异0。此项是上述指定范围核对，不冒充整盘或整个New API仓库审计；未扫描target、.idea、node_modules、bin、obj等缓存目录。
- 报告可按严格UTF-8解码、无BOM、无替换字符/空字节，凭证格式扫描通过。没有密钥、原账号身份或带签名视频URL写入报告。
- 未执行业务测试或构建；第11节所有测试均为C2待实施计划，不表述为本轮已通过。
- 未执行任何数据库连接/迁移、收费生成、历史任务内容请求、线上容器操作、Git提交/推送或部署。Git中的既有修改保留，停在C1-Final方案验收点。

