# newapi → sub2api 用户资产迁移指南

本文是本次测试迁移的执行记录，也是下一次正式迁移的操作依据。正式迁移必须重新读取旧站最终数据，不能复用本次测试余额快照。

> 2026-10-27 15:41 当前验收结论：资产迁移对账通过，Messages 续接 400 已定位、修复并上线；同一 Key/同一上游修复后 10 轮、70 次请求全部通过，本机 Claude Code 连续对话及 Read 工具回传通过。旧 newapi 及旧库未修改、未重启。详细对照、费用和剩余监控问题见 [迁移后测试报告](NEWAPI_MIGRATION_TEST_REPORT_20261027.md) 文末。

> 必须保留本修复：当前 Flux HTTP Responses 不兼容自动 previous_response_id 续接，sub2api 已改为默认保留完整历史及工具结果。不要重新发布修复前的迁移兼容镜像，否则此前连续 30 次续接全部 400 的问题会重新出现。

## 一、本次测试结果

| 项目 | 结果 |
| --- | --- |
| 验收地址 | https://sub2api.chyyds.com/login |
| 迁移模式 | 测试迁移，旧 newapi 继续独立运行 |
| 源快照时间 | 2026-10-26 23:37:57，Asia/Shanghai |
| 批次 | `test-75bbedc6ef6a0648` |
| 快照 SHA-256 | `75bbedc6ef6a064802d59b2673a7f1736643f1a14912c444b3c3558c884e77d0` |
| 迁入用户 | 24 个，均为普通用户 |
| 迁入 API Key | 40 个，其中 39 个启用、1 个禁用 |
| 迁入兑换码 | 400 个，其中 393 个未使用、7 个已使用 |
| 迁入余额合计 | 119.90186000，按快照时点计算 |
| 未使用兑换码面值合计 | 17640.00000000 |
| 新站原有数据 | 原有 2 个用户、1 个 Key、1 个兑换码保留 |
| 导入后总数 | 26 个用户、41 个 Key、401 个兑换码 |
| 应用版本 | 保持 6.6.6 |
| 当前应用镜像 | `sub2api-v11-prod:messages-stateless-fix-20261027` |

测试余额与旧站余额在取数后不会同步。新站的测试消费、充值和兑换不会反向更新 newapi。两个站点也没有共享扣款系统。本次没有修改旧站入口、支付、兑换配置、数据库记录或容器。

## 二、用户已确认的迁移规则

### 用户与登录

- 排除旧站管理员 `chyyds`，当前源用户 ID 为 1。
- 排除邮箱 `chenhanyu987@gmail.com` 的旧站账号，当前源用户 ID 为 2。
- 上述排除针对来源账号，不删除或覆盖新站已有的管理员；不要混淆两个数据库的用户 ID。
- 其余普通用户迁移原邮箱、原用户名、原密码哈希、剩余余额和账号状态。
- 用户可使用原用户名或邮箱，加原密码登录。用户无需重置密码。
- 浏览器旧登录态不迁移，需要在新站重新登录。
- 不迁移邀请码、邀请关系、返利余额、返利历史及返利流水。
- 不迁移旧调用日志、请求统计、历史订单和旧登录会话。
- 不通过注册接口导入，因此不发放注册赠金、默认套餐或首次绑定赠送。
- 迁入账号为 `user` 角色，并发初始为 5、RPM 初始为 0；不直接继承当前全局极高的默认并发配置。
- 测试模式关闭迁入账号的余额邮件提醒，避免给真实用户发送验收邮件；正式模式导入/刷新时开启正常提醒。

### API Key

- 保留原完整 Key；当前旧库保存的是不含 `sk-` 的 48 位部分，导入时恢复 `sk-` 前缀。
- 跳过被排除账号的所有 Key。
- 跳过空分组 Key。
- 跳过两个视频分组的 Key。
- 用户明确同意取消原 Key 的模型限制，不复制旧 `model_limits`。
- 保留启用/禁用状态，禁用 Key 不能在迁移时复活。
- 保留到期时间和有限额度语义。当前待迁 Key 均不限额且无到期时间，故配额上限和已用配额为 0。
- 不复制旧分组 ID，严格按下表关联新分组。

| 旧分组 | 新分组 | 当前新分组 ID |
| --- | --- | --- |
| ClaudeCode | openAI 特惠组 | 2 |
| 独立池+混合池 | openAI 特惠组 | 2 |
| team/plus/bugpro全自动号池 | openAI 特惠组 | 2 |
| 正价plus/pro稳定组 | openAI 性价比组 | 3 |
| 生图 | openAI 性价比组 | 3 |
| openai不降智 | openAI 尊享组 | 4 |
| OpenAI官key | openAI 尊享组 | 4 |
| seedance视频生成、视频生成（稳定版） | 不迁移 | — |
| 空分组 | 不迁移 | — |

三个 GPT 分组的 `allow_messages_dispatch` 均已开启。旧 ClaudeCode 分组是让 Claude Code 客户端调用 GPT，其 Key 迁至 OpenAI 特惠组，不迁至 Anthropic 分组。

如果客户端发送 GPT 模型名，走对应 GPT 调度；若发送 Claude 模型名，依赖组内的 Claude→GPT 映射。本次保留当前映射和定价，不擅自更换默认模型。生图使用新组现有独立计费，用户已知悉价格变化。

### 余额与兑换码

金额转换必须使用十进制运算：

```text
sub2api.balance = newapi.users.quota / 500000
sub2api.redeem_codes.value = newapi.redemptions.quota / 500000
```

不再乘分组倍率，不把人民币支付金额直接当成美元余额。脚本检查源额度单位仍为 500000，变化时中止。

- 兑换码是站点资产，不因创建者是被排除的管理员就全部丢弃。
- 保留原兑换码、面值、已用/未用/禁用状态、有效期和已用时间。
- 已使用码不再次给用户入账，余额以用户剩余额度为准。
- 已被排除账号使用过的码仍保持 `used`，但 `used_by` 留空，不建立被排除账号的关联。
- 已使用码的原兑换人属于迁移用户时，按用户映射转换为新用户 ID。
- 当前原码均为 32 位，新站可以原样容纳。

本次快照跳过 Key 的数量为：被排除账号持有 11 个、其余用户空分组 3 个、其余用户视频分组 48 个。这三个计数按顺序分类，不重复计数。

## 三、登录兼容实现

涉及源码：

- `backend/internal/pkg/passwordhash/verify.go`：统一校验 bcrypt 与旧站固定参数的 Argon2id。
- `backend/internal/service/auth_service.go`、`user.go`：登录、旧密码验证和敏感身份操作使用同一个校验器。
- `backend/internal/service/auth_legacy_username.go`：先按原有规则查邮箱，再查迁移用户名。
- `backend/internal/repository/user_legacy_username.go`：按唯一旧用户名定位新用户。
- `backend/migrations/247_legacy_login_usernames.sql`：独立保存经过迁移确认的旧用户名。
- `backend/internal/handler/auth_handler.go`：登录请求的 `email` 字段兼容邮箱或旧用户名，已有客户端字段不变；参数和响应有中文说明及 Swagger 注释。
- `frontend/src/views/auth/LoginView.vue`：输入框改为“邮箱或用户名”，使用文本输入，不再强制套用邮箱格式校验。

保留原 Argon2id 哈希，不对哈希再做 bcrypt，不批量修改密码。只接受旧站实际使用的 `argon2id/v=19/m=19456,t=2,p=1`，校验盐、摘要长度及输入大小，再以恒定时间比较摘要。密码不裁剪空格、不改变字符大小写，也兼容旧站超过 bcrypt 72 字节限制的长密码。

原用户名与展示昵称分离：修改展示昵称不会夺走其他人的登录名，也不会改变迁移前的登录名。旧用户名区分大小写，邮箱继续使用新站现有查找规则。新注册账号仍以邮箱登录，不能仅修改展示昵称就取得同名登录身份。

登录仍经过原有验证码、每 IP 登录限流、账号状态、双因素认证和会话校验，不增加绕过入口。密码更改后旧访问令牌继续失效。

参考：[OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。本次仅验证所影响的控制，不声称完成整站安全认证。

## 四、连接、部署和文件位置

Windows 11 / PowerShell，必须走 Tailscale：

```powershell
ssh -i "$env:USERPROFILE\Desktop\ssh-key-2026-08-08.key" ubuntu@100.65.138.78
```

| 用途 | 容器或位置 |
| --- | --- |
| 旧 newapi 应用 | `new-api` |
| 旧 newapi PostgreSQL | `new-api-postgres`，库/用户均为 `newapi` |
| 新 sub2api 应用 | `sub2api-v11-prod-app` |
| 新 sub2api PostgreSQL | `sub2api-v11-prod-postgres`，库/用户均为 `sub2api_v11` |
| 新 sub2api Redis | `sub2api-v11-prod-redis` |
| 新站 Compose | `/home/ubuntu/sub2api-v11-prod/compose.yaml` |
| 本次服务器工作目录 | `/home/ubuntu/sub2api-newapi-migration-20261026` |
| 本次本地构建记录 | `D:\workspace\code\sub2api\.codex\newapi-migration-20261026` |
| 通用迁移工具 | `tools/newapi_migration.py` |
| 通用只读核验工具 | `tools/newapi_migration_verify.py` |
| 目标缓存刷新工具 | `tools/newapi_migration_invalidate.py` |
| 转换规则测试 | `tools/newapi_migration_test.py` |

服务器私有工作目录包含：

- `latest-test-snapshot/source-snapshot.private.json`：本次最终采用的原始快照，含密码哈希、Key 和兑换码。
- `target-test-import/test-75bbedc6ef6a0648.before.dump`：导入前的新站完整备份。
- `target-immediately-before-feature.private.dump`：部署兼容版本前的新站完整备份。
- `compose.before-feature.private.yaml`：原应用 Compose 配置。
- `native-before.private.json`：原有账号/Key/兑换码的私有比对基线。
- `feature-deployment-report.json`、`target-verification-report.json`：不含可用凭据的执行结果。
- `target-test-import/preflight-report.json`、`import-result.json`、`verification-report.json`：批次预检和数据对账。
- `rehearsal-http-report.json`：隔离环境登录、改密、兑换和 Key 鉴权验收记录。
- `release.json`、构建日志和本轮部署脚本：兼容版本的构建与回退信息。

私有目录权限 700，文件按 umask 077 创建；快照和备份不得提交 Git、公开分享或复制到普通报告中。密码哈希不是明文密码，但仍需按凭据保护。公开指南和结果报告不包含实际 Key、兑换码及用户明细。

## 五、本次实际执行顺序

1. 记录旧站、新站的容器 ID、启动时间和镜像；核对线上三个 GPT 分组及原有数据。
2. 读取源用户、Key、兑换码，使用 `REPEATABLE READ READ ONLY` 在同一一致性快照内取数。源连接额外以 `PGOPTIONS` 强制默认只读，不在源库建表、改状态或加锁停写。
3. 在当前生产源码副本上，只叠加本次登录兼容文件；保留已有后端修复及前端样式。版本固定 6.6.6。
4. 执行密码兼容单测、登录服务测试、现有登录相关 Handler 测试、前端登录测试和 TypeScript 检查，并完成前后端构建。
5. 创建独立 Docker 内部网络、PostgreSQL 和 Redis；复制新站备份到隔离库，不让演练应用访问外网。隔离库使用独立 JWT 密钥。
6. 在克隆库导入、再次导入、用更新快照刷新测试批次，验证数量不增加、余额不叠加。
7. 逐条核对 24 个用户、40 个 Key、400 个兑换码。用独立已知密码样本验证完整 HTTP 登录和改密路径；只在克隆库兑换原码，确认不能重复入账。
8. 备份新站，替换 `sub2api-v11-prod-app` 应用镜像，不重启数据库、Redis、Nginx 或 newapi。检查原生账号及资源未变。启动时执行幂等 SQL 迁移 247。
9. 在当前新站执行测试快照导入。整个导入是单个事务，任何冲突或对账异常均回滚。
10. 只读逐条核验；对迁入 Key 调用 `/v1/usage` 检查鉴权，对三个组的 Messages 入口提交无模型的空请求，确认通过开关后在参数校验处返回 400。本次验证不调用真实上游模型。
11. 定向清理迁入用户的余额缓存、Key 用量及鉴权缓存，检查持久化缓存失效队列处理完毕、新站健康、旧 newapi 状态接口正常，并确认旧站容器 ID 与启动时间未变化。没有执行整库 Redis 清空。

### 本次已通过的验证

- 24 份密码哈希与源快照逐字节一致，24 个原用户名映射正确。
- 中文、空格和超过 72 字节的 Argon2id 密码样本可按用户名、邮箱登录。
- 原生 bcrypt 邮箱登录正常，错误密码/未知用户名/禁用账号被拒绝。
- 改展示昵称不改变旧登录名；以原密码修改密码后，旧密码和旧访问令牌失效。
- 克隆库中兑换原码仅入账一次。
- 40 个原 Key 的实际鉴权状态一致；原禁用 Key 仍被拒绝。
- 三个 GPT 分组的 `/v1/messages`、`/v1/messages/count_tokens` 均通过开关检查。
- 新站原有 2 个用户、1 个 Key、1 个兑换码的重要字段保持原样。
- 旧 newapi 应用与数据库未重启、未替换；状态接口正常。
- 公网登录页和登录脚本已核对为本次新版本，输入框支持用户名。

演练结束后，仅清理本次带 `com.chyyds.migration=rehearsal` 标签的 3 个隔离容器及其独立网络，不保留后台运行的克隆站。演练报告、私有备份和源码构建记录保留在服务器私有工作目录。

说明：不知道真实用户明文密码，因此不会猜密码或重置真实用户密码。本次对全部真实哈希做一致性核验，并用同算法已知密码样本完成端到端验证。真实用户的原密码登录由用户验收。完整 Claude Code 工具调用、模型生成和图片费用也属于业务验收，本次自动检查没有产生模型消费。

## 六、下次正式迁移操作

### 1. 开始前核对

先读本指南和最新批次记录，不要仅凭上次数量直接导入。重新核实：

- 排除账号、分组名称/ID、视频和空分组策略是否仍有效。
- 新站兼容镜像及 SQL 247 是否仍然存在，三个 Messages 开关是否开启。
- 新增用户、Key、余额、兑换码以及账号状态变化。
- 旧站是否新增第三方登录、MFA、Passkey、订阅或 Key IP 限制。当前工具遇到这些未支持的情况会中止，必须先扩展并演练，不能静默丢弃。
- 同邮箱、同用户名、邮箱登录身份、Key 和兑换码冲突。不得自动覆盖新站原生账号，尤其是管理员。
- 源账号邮箱如在测试后更改，工具会拒绝直接刷新，必须先审查旧邮箱身份的回收，防止遗留可登录绑定。
- 本次验收产生的测试调用、充值、订单、异步任务和新增 Key 要如何处理。工具只刷新映射到旧站的对象，不会自动删除所有验收历史或额外创建的资源。

如果新快照删除或排除了此前已导入的测试对象，工具会在写入前中止。必须先审查旧测试对象的清理策略，避免遗留原站已删除的可用 Key 或资产。

### 2. 停止旧站资金变动，取最终快照

这一步属于正式切换，不能在本次测试中执行。按用户届时授权和切换方案：

1. 停止旧站新的消费，包括仍留在旧站的视频消费。
2. 处理旧站充值入口、支付回调和兑换入口，保证余额只有一个权威来源。
3. 同时暂停新站验收消费/充值/兑换，等待两边流式请求及异步任务完成结算；当前工具正式模式会拒绝含未完成异步任务的源快照。目标站在途扣费及缓存写入也必须先排空。
4. 核实旧站待支付订单是否已关闭或有明确回调去向。本次讨论时旧站有 4 笔较早的 pending 订单，正式时重新查询。
5. 记录停止变动的时间及处理结果，再生成新快照。若旧站恢复扣款，必须重新取数，不能使用之前的冻结确认。

### 3. 先预检，再导入

以下命令在服务器上运行；下次应选新的私有目录，例如 `/home/ubuntu/sub2api-newapi-formal-日期`，不要覆盖本次快照。

```bash
python3 /home/ubuntu/sub2api-newapi-migration-20261026/newapi_migration.py \
  --directory /home/ubuntu/sub2api-newapi-formal-日期
```

默认只导出快照和预检，不写目标库。核对报告和最终资产金额，保存新站备份。正式冻结确认文件应记录本轮实际的源停扣款时间、订单/回调处理、异步结算结果和快照 SHA-256，文件名为新目录内的 `source-frozen.confirmed`。这个文件是防误操作的运行门槛，不会自动证明源站已经停止写入；执行者仍要核实实际状态。

本次验收站已经有测试批次，正式刷新必须显式指定：

```bash
python3 /home/ubuntu/sub2api-newapi-migration-20261026/newapi_migration.py \
  --directory /home/ubuntu/sub2api-newapi-formal-日期 \
  --snapshot /home/ubuntu/sub2api-newapi-formal-日期/source-snapshot.private.json \
  --mode formal --refresh-test --apply
```

`--refresh-test` 只允许覆盖以前属于测试批次的对象，不允许这样覆盖已经正式迁移的数据。用户余额、原密码、Key 状态/额度和兑换码状态以新的源快照为准，不叠加旧余额，不发注册赠金；新站原生账号不覆盖。所有测试消费及额外创建资源的处理，应在刷新前完成审查。

若下次部署位置、容器或数据库名称变化，使用 `--target-container`、`--target-user`、`--target-db` 指定新目标。工具禁止以旧 `new-api-postgres` 或 `newapi` 数据库为写入目标。

### 4. 刷新目标缓存，逐条对账与业务验收

导入/刷新提交后，在目标暂停写入期间定向清缓存，避免 Redis 沿用测试余额或用量。工具先核对目标应用实际连接的数据库和 Redis；只处理有迁移映射的用户和 Key，不清空整库 Redis：

```bash
python3 /home/ubuntu/sub2api-newapi-migration-20261026/newapi_migration_invalidate.py \
  --directory /home/ubuntu/sub2api-newapi-formal-日期 \
  --target-app sub2api-v11-prod-app \
  --target-redis sub2api-v11-prod-redis
```

确认缓存刷新成功及鉴权失效队列收敛后再开放正式流量。若目标容器变化，三个工具必须使用相同目标，不能把克隆库导入结果与生产 Redis 混用。

```bash
python3 /home/ubuntu/sub2api-newapi-migration-20261026/newapi_migration_verify.py \
  --directory /home/ubuntu/sub2api-newapi-formal-日期 \
  --snapshot /home/ubuntu/sub2api-newapi-formal-日期/source-snapshot.private.json
```

除了数量和总金额，还需逐条核对密码哈希、旧用户名、Key 凭据及归属/分组/状态/额度/到期时间、兑换码面值/状态/兑换人/时间。验证管理员原账号仍可登录、原生资产未变、已用码无法再次兑换、禁用 Key 不可调用。

最后用真实业务客户端验收用户名/邮箱登录、文本流式、Responses、Claude Code 工具调用与上下文处理、图片模型名和费用。切换原 API 域名时验证 DNS、Nginx、证书和路径；如更换域名，通知用户修改 Base URL。旧 Key 保留并不自动解决域名或旧管理查询接口的差异。

正式业务开始后，应只保留一套权威余额和兑换状态。旧库可以保留只读历史查询，但不能继续消费、入账或兑换相同资产。

## 七、批次、重复执行与回退

- `newapi_migration_batches` 保存模式、快照哈希、时间与无凭据汇总。
- `newapi_migration_entities` 保存来源 ID→目标 ID、转换后载荷哈希和首/最近批次，避免靠邮箱猜测归属。
- `legacy_login_usernames` 保存登录别名，与可编辑的展示昵称隔离。
- 对同一未发生业务变化的快照再次导入不会重复建用户、Key 或兑换码，也不会重复加余额。
- 普通导入发现不同源载荷会中止；明确刷新测试批次需要 `--refresh-test`。
- 若目标余额已因验收改变，重复普通导入的余额对账也会拒绝；不能误以为重复运行会自动恢复测试状态。
- 源数据、原 Key 和兑换码不会写进批次汇总报告，私有快照另行保护。

回退分两种：

1. 仅兼容镜像发布失败：本轮部署脚本自动恢复原 Compose 应用镜像。SQL 247 是新增兼容表，不改原密码或用户数据。
2. 测试数据导入后回退：先停止验收站写入并核实没有需保留的新业务，再选择恢复导入前的目标库备份，或按映射审查后清理。不要误恢复旧 newapi 数据库；本次从未对它做迁移写入。

**一旦新站开始正式消费、充值或兑换，禁止直接恢复旧余额快照或整库备份。**先核对切换后的流水、在途请求及支付回调，制定增量回退或补偿方案。测试资产能覆盖刷新，不代表正式资金可以随意覆盖。

## 八、构建复现和源码状态

初始迁移兼容版本以 `/home/ubuntu/sub2api-console-release-20261026/source/backend` 为基线，叠加本次列出的 9 个后端源码/迁移文件和登录框前端改动。随后 Messages 修复在该线上源码副本上仅修改两个生产 Go 文件、更新一个原测试文件并新增一个回归文件，没有混入工作区其他未提交的修改。

**当前生产后端源码为 `/home/ubuntu/sub2api-ccfix-20261027/source/backend`，镜像为 `sub2api-v11-prod:messages-stateless-fix-20261027`。** 原 `/home/ubuntu/sub2api-newapi-migration-20261026/source/backend` 是修复前的基线，不应直接用它重新发版。迁移脚本和私有源快照仍留在原工作目录，文中的导入命令不需要改路径。

服务器复用的工具链为：

```text
/tmp/sub2api-cooldown-modcache/golang.org/toolchain@v0.0.1-go1.27.3.linux-arm64/bin/go
```

使用进程级 `CGO_ENABLED=0`、`GOTOOLCHAIN=local`、`GOMAXPROCS=2` 和较低 CPU 优先级构建，不修改系统环境变量。版本通过链接参数固定 `main.Version=6.6.6`。下次应先定位当前正在运行镜像对应的源码，不要直接用已经发生其他改动的工作区全量覆盖生产。

源码、通用工具和指南已保留在当前工作区，未自动提交 Git。所有新写入文本使用 UTF-8 无 BOM。

## 九、Messages 修复的复用与回归

1. 保留 `openai_messages_continuation.go` 的显式能力门槛，以及 `openai_gateway_messages.go` 对无状态请求保留完整历史的判断。不能仅关闭 previous_response_id，却继续截掉早期用户内容或工具调用。
2. 保留 `openai_messages_stateless_test.go`；覆盖超过 12 条消息的完整历史、同步/流式、同请求重复及工具调用/结果配对。原有续接相关测试夹具通过显式能力字段进入有状态分支，仍验证旧功能的回退保护。
3. 默认不设置 `extra.openai_messages_continuation_supported=true`。该字段只有对当前账号/上游确实验证兼容后才可启用；支持 Responses 或 WebSocket 不能自动证明 HTTP previous_response_id 可用。
4. 发布前保留目标 Compose、目标库备份及旧镜像，检查版本 6.6.6；只替换新站 app。环境比较应按键值比较，不能因 Docker 改变变量排列顺序误触发回滚。
5. 发布后至少检查 Messages 首轮、同会话第二轮、重复流式和工具结果回传；同时检查实际内容及结束事件，不只看 HTTP 200。必要时使用本机 Claude Code 的临时配置与测试目录，不覆盖用户现有配置，也不加载外部 MCP。
6. 本次修复构建与部署脚本、备份、70 次对照及 CLI 证据保留在 `/home/ubuntu/sub2api-ccfix-20261027`。脚本记录的是当时的镜像/容器基线，不可在未来不更新基线就盲目重跑；参考步骤，重新核对当时生产状态。

2026-10-27 15:41 再次资产复核仍为迁入 24 用户、40 Key、400 兑换码，余额合计 119.90186000。全站有效用户现为 27，其中新增原生用户创建于当日 13:09:29，并非修复新增；不得为凑首次统计数而删除该用户。
