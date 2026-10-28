"""根据本轮脱敏证据生成最终交付报告，不将 Mock、构建或中断请求冒充真实成功。"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.codex/creation-production-evidence'


def read(name):
    return json.loads((OUT / name).read_text(encoding='utf8'), parse_float=Decimal)


def short(value):
    if not value:
        return '未提供'
    return value[:15] + '…' + value[-4:]


def main():
    """只有最终部署和线上免费检查均通过后才输出完成报告。"""
    deployment = read('oracle-final-output/deployment.json')
    browser = read('real-browser-online-final-verified.json')
    assert deployment['health'] == 'healthy'
    assert len(browser['checks']) >= 18 and all(item['success'] for item in browser['checks'])
    assert not browser['errors'] and not browser['resourceErrors']
    online = read('real-browser-online.json')
    assert any(item['name'] == 'ONLINE-chat' and item['success'] for item in online['checks'])
    accounting = read('accounting-final.json')
    actions = {
        175: '首笔工具超时，服务端成功、客户端正文未保存',
        176: '网页首轮聊天', 177: '同会话第二轮追问',
        178: '单张真实文生图', 179: '单张真实参考图编辑',
        180: '主流模型 Responses 流式', 181: '切回普通模型继续上下文',
        182: '首段后主动停止', 183: '手动重新生成，消息数量不变',
        184: '生产域名上线后最小真实聊天',
    }
    usage = [row for row in accounting['usage'] if row['id'] in actions]
    assert len(usage) == len(actions)
    total = sum((row['actual_cost'] for row in usage), Decimal(0))
    remaining = Decimal('0.50') - total
    assert remaining >= 0
    go = read('oracle-output/go-results.json')['results']
    assert len(go) == 3 and all(item['exit_code'] == 0 and item['passed'] > 0 for item in go)
    vue = read('vue-final-results.json')
    assert vue['numFailedTests'] == 0
    image_hashes = read('real-image-reuse-hashes.json')
    assert image_hashes[0]['sha256'] == image_hashes[1]['sha256']
    rows = []
    for item in usage:
        protocol = 'Chat→Responses' if item['inbound_endpoint'].endswith('chat/completions') else 'Responses' if item['inbound_endpoint'].endswith('responses') else 'Images/编辑' if item['inbound_endpoint'].endswith('edits') else 'Images/生成'
        rows.append(f"| {item['id']} | {actions[item['id']]} | {item['model']} / {protocol} | {short(item['request_id'])} | {item['input_tokens']} / {item['output_tokens']} / {item['cache_read_tokens']} | {item['image_count']} | {item['actual_cost']:.9f} | C*{item['channel_id']} / A*{item['account_id']} |")
    final_health = read('final-health.json')
    assert final_health['container_health'] == 'healthy' and final_health['public_health']['status'] == 'ok'
    now = datetime.fromisoformat(final_health['checked_at']).astimezone(timezone(timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S（北京时间）')
    source_files = ['frontend/src/lib/creation-chat.ts', 'frontend/src/lib/__tests__/creation-chat.spec.ts', 'frontend/src/composables/useCreationSelection.ts', 'frontend/src/composables/__tests__/useCreationSelection.spec.ts']
    doc_files = ['canvas/CHANGELOG.md', 'canvas/docs/content/docs/progress/todo.mdx', 'canvas/docs/content/docs/progress/pending-test.mdx']
    tool_files = sorted(file.relative_to(ROOT).as_posix() for file in (ROOT / 'tools').glob('creation-production-*'))
    file_list = '\n'.join('- `' + path + '`' for path in source_files + doc_files + tool_files)
    report = f'''# Sub2API AI 创作中心正式交付报告

最终核对：{now}。**已正式部署，版本保持 6.6.6，生产容器 healthy。**

## 1. 聊天实际结果

- 真实网页首轮、多轮口令追问、Responses 流式、切模型继续上下文、主动停止和手动重新生成均通过；重新生成未重复用户消息。
- 新会话仅在本人授权目录中优先选择 `gpt-6-sol`、其次 `gpt-6.1-sol`。既有会话与手动偏好保留，不更改目录、Key、分组或权限。
- 当前用户只有一枚有效 Key；已真实验证自动匹配与手动选择该本人 Key。多个不同 Key、跨用户 IndexedDB 隔离、Markdown/高亮/复制及三种 SSE 错误场景由本轮单测与 Mock 浏览器回归覆盖，没有创建第二个真实用户或 Key。
- 生产域名真实聊天返回“就绪”；聊天刷新恢复、IndexedDB 无明文用户 Key 检查通过。

## 2. 图片与 Infinite Canvas 实际结果

- `gpt-image-2` 真实文生图与 multipart 参考图编辑均成功，均为 `n=1`、请求 `1024×1024`，下载的两份 PNG 均实际解码为 `1024×1024`。
- 生成蓝色圆形，再编辑为圆形中心白色五角星，已查看实际输出，参考图主体得到保留。
- 图片返回、展示和下载已真实验证。界面缩略图上限为 768px，不能把缩略图尺寸当成原图尺寸。
- 入画布、刷新恢复及切模型保留项目通过；最后的持久化及线上检查复用此前实际生成的编辑图片，通过明确标记的本地响应回放恢复测试浏览器作品，没有新增上游图片请求。回放下载 SHA256 与原编辑图片完全相同：`{image_hashes[0]['sha256']}`。这部分不冒充新的真实推理或再次上线生成成功。
- 参数、空结果、HTTP 200 内错误、断网、超时、存储故障、批量部分失败、不同 Key 和用户隔离均完成 Mock 回归。

## 3. 真实模型与协议

| 模型 | 入站接口 | 实际上游接口 | 结果 |
| --- | --- | --- | --- |
| gpt-6-sol | /v1/chat/completions | /v1/responses | 首轮、多轮、切回、停止、重生成及生产聊天通过 |
| gpt-6.1-sol | /v1/responses | /v1/responses | Responses 正常终止并输出正文 |
| gpt-image-2 | /v1/images/generations、/v1/images/edits | 对应原有 Images 网关路径 | 生成与编辑各一张通过 |
| gpt-5.3-codex-spark | /v1/responses | /v1/responses | 原方案指定的一笔遇到上游 502；按用户最新要求退出后续测试，不重试 |

`gpt-6.1-sol` 使用已核对的精确构建规则：用户尾号2、Key尾号1、协议 responses；不扩大任何授权。实际请求模型与计费上游模型同名，未为测试增加别名映射。所有收费模型请求均通过 `https://sub2api.chyyds.com/v1/*`。

## 4. 请求、用量、账单与归属

全部本轮账单归属用户 U*2、Key K*1、分组 G*2。渠道及 Account 用尾号表示，完整非敏感请求关联记录保存在本机忽略目录的脱敏证据中。下表费用保留账单原始九位，避免逐行显示舍入造成误差；Token 列依次为非缓存输入 / 输出 / 缓存读。

| 账单 | 操作 | 模型 / 协议 | 请求 ID（脱敏） | Token | 张数 | actual_cost USD | 渠道 / Account |
| --- | --- | --- | --- | --- | --- | --- | --- |
{chr(10).join(rows)}

失败的 Spark 请求：错误记录69，请求 `cb65b1ba…e9f8`，客户端关联 `037efcae…40a5`；网关记499，上游502，网关记录可见一次 Account A*1 尝试，无对应 usage 账单。用户提供上游成功记录截图并明确确认该失败未扣费后，才恢复后续收费测试。没有把“账单缺失”自行认定为免费。上游 request_id 未提供，保留为空，没有虚构。

## 5. 预算、价格与尝试次数

- **本轮总实际下游费用 ${total:.8f}；预算 $0.50；剩余 ${remaining:.8f}。** 共10笔成功入账，另有1笔确认未收费的 Spark 失败。图片合计 $0.16，其余为聊天。
- 最初余额 $9.72041527；完成收费测试后 $9.55744945，余额差与本轮实际费用一致。其后免费检查没有新增本轮模型账单。
- 组文本倍率0.085；图片独立倍率1，1K单张 $0.08，两笔图片账单均为 image 按张计费，图片 Token 保留统计，未再次按 Token 重复收费。未修改任何价格、倍率、余额或 Key 限额。
- 收费请求逐笔串行、先估价、后对账。客户端和本地联调代理均无自动收费重试；网关配置的原有探测、重试及调度规则未改。候选账号 Responses 能力已标记支持、pool 重试未配置；日志未观察到本轮同账号重试或切 Account，失败明细也只记录一次尝试。供应商内部尝试数不在网关可见范围，不能宣称全链路重试已经硬禁用。
- Chat Completions 使用 `max_completion_tokens`、Responses 使用 `max_output_tokens`、Messages 使用 `max_tokens`；产品默认4096，短测试收紧至256，重生成2048。**停止测试虽然客户端发送256，既有生产链路最终记账输出1339 Token**；因此不把客户端参数、停止、断流或超时当成上游硬封顶或免单证明。该笔实际费用已经核对并计入总预算。

## 6. 本轮修复及文件清单

产品改动仅为：补齐三协议输出参数和参数校验；新会话默认选择已授权的主流模型并保留手动选择。保持 V5 / Midnight HUD，不重新设计；后端业务源码没有修改。

{file_list}
- `canvas/CREATION_PRODUCTION_RELEASE_REPORT.md`（本报告）

逐文件前后摘要、原件和本轮补丁：`.codex/creation-production-evidence/owned-files.json`、`original/`、`production-changes.patch`。四份本轮源码/测试原件已与 P2 最终 SHA256 核对；3,304份后端输入与 P3-A 摘要一致。既有 Stage A/B、P1/P2/P3-A 报告和原有未提交修改保留，未提交或推送远端 Git。

## 7. 测试与构建验证

| 检查 | 实际结果 |
| --- | --- |
| Vue 创作模块、协议、存储、控制器、选择器、登录与导航定向回归 | {vue['numPassedTests']}项通过，0失败 |
| Canvas 完整单测 | 57项通过，10个文件，含原有视频纯单测；未调用视频接口 |
| P2 聊天浏览器 Mock | 25组通过，三类 SSE、上下文、停止、重生成、Markdown、安全和隔离 |
| P1 图片 / Canvas 浏览器 Mock | 25组通过，生成、编辑、存储及项目完整回归 |
| 最终正式域名免费浏览器检查 | {len(browser['checks'])}项通过，运行异常0、静态资源HTTP错误0 |
| 四尺寸 | 聊天和图片均检查1920×1080、1536×864、1366×768、390×844；输入区可见，无页面横向溢出 |
| Vue / Canvas TypeScript | Vue生产构建含 vue-tsc；Canvas独立 typecheck 通过 |
| ESLint | 创作模块定向检查及最终四个修改TS文件通过 |
| 双前端生产构建 | build:all通过；保留既有chunk大小、config.js及Browserslist等构建提示 |
| Go 1.27.3 unit：apicompat / openai / web | {go[0]['passed']}个通过事件 |
| Go 1.27.3 unit：协议路由 / 图片定价等 service 定向测试 | {go[1]['passed']}个通过事件 |
| Go 1.27.3 unit：Key计费信息 handler 定向测试 | {go[2]['passed']}个通过事件 |

Go合计{sum(item['passed'] for item in go)}个测试及子测试通过事件、0失败，不等同于全部后端集成测试。执行时无外网、无生产DB/Redis/凭证挂载；4GB、2CPU上限，单包编译、较高GC频率。最终默认模型补版只改变前端，已逐项验证与这些Go测试相同的后端源码，没有冒称重新执行全部Go测试。

首轮构建曾因产物目录权限失败，改用独立Docker卷导出；补版曾因新静态输入权限失败，修正专用构建副本中公开静态文件权限后成功。首轮Canvas与图片页手动Key的测试等待条件也曾超时；修正工具等待条件后免费复测通过，历史失败记录保留，不冒充首次全绿。

## 8. Oracle ARM64 发布结果

- 当前镜像：`{deployment['image']}`。
- 镜像 ID：`{deployment['image_id']}`。
- 二进制 SHA256：`{deployment['binary_sha256']}`。
- 版本：6.6.6；linux/arm64，CGO关闭，实际镜像内 `-version` 执行通过。最终编译限制2GB/1CPU，不挂载生产业务数据。
- 发布目录：`/home/ubuntu/sub2api-creation-mainstream-release-20261028`。
- 实际生产Compose：`/home/ubuntu/sub2api-v11-prod/compose.yaml`；项目 `sub2api-v11-prod`；服务 `app`。
- 已用当前源码构建Go嵌入双前端；候选镜像先在无网络、无生产挂载容器启动，核对Canvas同源CSP、主站路由及200个JS/CSS资源摘要，然后使用原Compose方式仅更新app。
- 298个已应用迁移全部按运行器算法校验匹配，无待执行迁移；本轮没有增加或强行修改迁移、数据库或Redis持久卷。

## 9. 生产健康与兼容检查

容器 healthy，公网 `/health` 返回ok；首页、聊天、图片、Canvas、dashboard、usage、keys、profile、login、admin静态路由均200并匹配当前构建。Cloudflare HTML为DYNAMIC，未见旧入口缓存、404或502；200个双前端JS/CSS逐项摘要一致。

正式域名普通用户登录、模型与本人Key加载、默认主流模型、用户中心、Canvas iframe及项目恢复通过。普通用户访问管理员API仍403；管理员静态入口正常，没有使用管理员身份进行写操作或伪造登录。原环境变量、挂载、网络及其他既有容器ID/启动时间均保持一致。未修改New API、Grok、Seedance Ark或KOKO Video实现；视频入口默认隐藏。

## 10. 访问地址

- https://sub2api.chyyds.com
- https://sub2api.chyyds.com/ai-creation/chat
- https://sub2api.chyyds.com/ai-creation/image
- https://sub2api.chyyds.com/canvas/image （正常使用通过图片工作台iframe进入）

## 11. 回滚材料与方法

上一健康镜像：`sub2api-v11-prod:creation-mainstream-rollback-20261028`（首版创作中心）。任务开始前原镜像另保留为 `sub2api-v11-prod:creation-rollback-20261028`，原始镜像ID `sha256:0b3b33fa49c394e78181241e82c91a0ca43e09deeaa9b951c60461837246dd6e`。两层Compose原件均留在服务器对应发布目录的 `rollback/` 下，含凭证的配置未导入本机证据或报告。

在服务器运行：

```bash
python3 /home/ubuntu/sub2api-creation-mainstream-release-20261028/rollback.py --check
python3 /home/ubuntu/sub2api-creation-mainstream-release-20261028/rollback.py
# 需要恢复任务开始前服务时使用：
python3 /home/ubuntu/sub2api-creation-mainstream-release-20261028/rollback.py --original
```

默认与 `--original --check` 的只读核验均通过；未在健康生产上执行回滚演练。脚本先验证Compose发布后摘要及目标镜像ID，遇后续配置改动拒绝覆盖，只重建app，不重建DB/Redis、不删除数据卷；正式切换脚本另有关键检查失败自动恢复路径。本轮未触发生产回滚。

## 12. 凭证、数据与编码保护

最终3548个源码/产物文件扫描未见完整用户Key；真实聊天浏览器IndexedDB检查未见明文Key，图片存储的凭证排除另有完整Mock回归覆盖。登录密码只通过临时Windows DPAPI保护文件交给隔离验收进程，临时凭证在验收后清理。报告、源码和新工具使用UTF-8无BOM、中文直接写入；不导出Authorization、HAR、管理员或供应商凭证。未修改系统或Java环境变量。

聊天、图片和画布仍为当前浏览器按用户隔离的本地存储，不承诺云同步；测试浏览器中的作品不自动同步到用户其他浏览器。

## 13. 遗留边界及证据位置

本轮目标使用已验证的 `gpt-6-sol`、`gpt-6.1-sol`、`gpt-image-2` 完成。Spark原上游502已如实记录，用户要求不再用它测试；它仍来自原授权目录，本轮没有为此禁用模型或改权限，也不承诺目录内所有其他型号已真实验收。没有新增生产发布阻塞。

完整脱敏证据在 `.codex/creation-production-evidence/`：账单 `accounting-final.json`；真实界面 `real-browser*.json`；最终线上 `real-browser-online-final-verified.json`；真实图片 `real-generated.png` / `real-edited.png`；构建与发布 `oracle-output/`、`oracle-final-output/`；最终源码摘要 `release-manifest.json`；费用确认 `provider-cost-confirmation.json`。Go原始日志保存在 `oracle-output/go-*.log`，与最终相同后端源码的证明见 `oracle-final-output/source-verification.json`。
'''
    path = ROOT / 'canvas/CREATION_PRODUCTION_RELEASE_REPORT.md'
    path.write_text(report, encoding='utf8')
    owned = []
    patches = []
    for name in source_files + doc_files + tool_files + [path.relative_to(ROOT).as_posix()]:
        file = ROOT / name
        data = file.read_bytes()
        assert not data.startswith(b'\xef\xbb\xbf')
        data.decode('utf8')
        backup = OUT / 'original' / name
        old = backup.read_bytes() if backup.exists() else None
        owned.append({'path': name, 'new': old is None, 'before_sha256': hashlib.sha256(old).hexdigest() if old else None, 'after_sha256': hashlib.sha256(data).hexdigest()})
        if old:
            patches.extend(difflib.unified_diff(old.decode('utf8').splitlines(True), data.decode('utf8').splitlines(True), fromfile='before/' + name, tofile='after/' + name))
    (OUT / 'owned-files.json').write_text(json.dumps(owned, ensure_ascii=False, indent=2), encoding='utf8')
    (OUT / 'production-changes.patch').write_text(''.join(patches), encoding='utf8')
    print(json.dumps({'report': str(path), 'total_usd': str(total), 'remaining_usd': str(remaining), 'online_checks': len(browser['checks']), 'owned_files': len(owned)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
