# 图片创作参数面板 V6 验收

本次只修改 AI 创作 → 图片创作的参数面板及必要布局。保留 Infinite Canvas、生成/编辑请求、参考图、生成历史、IndexedDB、模型/Key 选择和 Sub2API 计费归属。未修改聊天、视频、后台、账号模型映射和版本号，未部署。

所有浏览器生成与编辑请求均发送到 `127.0.0.1:18096` 的本机 Mock。独立验收浏览器阻断外网，使用无效的测试 Key。截图中的城市图为本机示意图片；真实收费请求为 **0**。

## 修改文件

| 文件 | 用途 |
| --- | --- |
| `web/src/pages/image/index.tsx` | 参数独立滚动、固定生成区、手机面板切换、参数摘要、输出参数随历史恢复、下载扩展名 |
| `web/src/pages/image/components/host-image-settings.tsx` | V6 参数分组、能力联动、尺寸模式、质量/格式/数量按钮 |
| `web/src/pages/image/image-editor.module.css` | 限定工作台参数区的 V6 样式与交互状态 |
| `web/src/styles/sub2api-host.css` | 三栏比例及手机单滚动面板布局 |
| `web/src/lib/host-image-capabilities.ts` | 两模型能力、格式与压缩率、统一请求校验 |
| `web/src/lib/host-image-capabilities.test.ts` | 107 项参数与尺寸断言 |
| `web/src/stores/use-config-store.ts` | 在原配置源补充尺寸编辑模式、格式和压缩率 |
| `web/src/services/api/image.ts` | 沿用原请求，仅按所选输出格式解析 Base64 MIME |
| `web/src/components/image-settings-panel.tsx` | 补充共享画布设置中超高/极致的中文标签，避免进入 Canvas 后空白 |
| `CHANGELOG.md`、`docs/content/docs/progress/pending-test.mdx` | 变更与待用户确认的视觉验收记录 |
| `../tools/creation-image-v6-preview.mjs` | 复用原有本机 Mock，独立构建目录，无真实 API 代理 |
| `../tools/creation-image-v6-browser-test.cjs` | 请求、历史、Canvas、Key、布局及截图验收 |
| `../tools/creation-image-v6-report.py`、本文 | 截图拼排、编码检查和交付记录 |

已检查 `docs/content/docs/progress/todo.mdx`，本次没有需要迁移或新增的独立待办，无需修改。

## 原型与实际页面

原型只提供视觉和交互基准。实际页面保留原有提示词库、素材、剪贴板、上传与真实生成入口，不接入原型模拟生成、示例 SVG 下载或前端演示账单。

![原型与实际参数面板对照](../.codex/image-v6-evidence/v6-comparison.png)

![四种分辨率实际页面](../.codex/image-v6-evidence/viewport-contact-sheet.png)

原始截图存放在 `../.codex/image-v6-evidence/`：

- `prototype-1536x864.png`：原型全页。
- `actual-1920x1080-{top,sizes,bottom}.png`。
- `actual-1536x864-{top,sizes,bottom}.png`。
- `actual-1366x768-{top,sizes,bottom}.png`。
- `actual-390x844-{top,sizes,bottom,results}.png`。
- `canvas-regression.png`：结果放入 Infinite Canvas。

## 参数来源和实际请求

`config.size` 是唯一尺寸值；界面不额外保存档位、宽高比、宽度和高度。分辨率和比例从该值推导，切换预设将已有尺寸表中的像素值写回，手动宽高也直接修改该字段。`imageSizeMode` 只控制编辑器展示。

选择自动时提交不含 `size`；从自动进入预设时使用 1K/1:1，选择比例后产生明确像素尺寸。1K/2K/4K 不作为 API 参数发送。所有 54 组两模型预设组合均经过与真实请求相同的校验：16 倍数、最大边长 3840、最大比例 3:1、总像素 655360～8294400。非法自定义值会提示并禁用生成。

| 模型 | 界面质量 | 最终请求模型 |
| --- | --- | --- |
| Image 2 | auto / low / medium / high | `gpt-image-2` |
| Image 2.5 Flare | auto / low / medium / high / xhigh / max | `gpt-image-2.5` |

能力表按照用户确认的当前账号映射，将展示名 `gpt-image-2.5` 解析为 Flare 能力配置。不会将请求、授权模型列表、历史或账单模型永久替换为上游名称；实际映射仍由现有 Sub2API 机制执行。未来账号映射改变时，应同步能力配置，不能由未知模型前缀猜测能力。

PNG 不发送压缩字段；JPEG/WebP 发送 `output_format` 和整数 `output_compression`。切换 JPEG 会关闭透明背景。Image 2 和 2.5 的透明背景尚未独立确认，均保持禁用；现有明确支持透明的旧模型可在 PNG/WebP 下使用，JPEG 始终禁用。

浏览器已经断言下面的最终 JSON 请求：

```json
{
  "model": "gpt-image-2.5",
  "n": 1,
  "quality": "max",
  "size": "2048x1152",
  "output_format": "webp",
  "output_compression": 72,
  "prompt": "V6 Flare 参数"
}
```

参考图编辑保留 FormData，已断言 `model=gpt-image-2.5`、`quality=xhigh`、`size=1040x1024`、`output_format=jpeg`、`output_compression=72`、`n=1` 和原有 `image` 文件字段。

生成张数默认 1，快捷 1～4 张，更多 5～10 张。3 张和 5 张操作分别发出 3 次和 5 次 `n=1` 请求，保留原有逐张计费与失败槽。错误和部分失败均不自动重试。费用区只显示每张独立计费及使用记录说明，不按分辨率推算价格。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 图片参数单元测试 | 107 通过 |
| 宿主 iframe 与 Key/模型选择回归 | 28 通过 |
| 独立 Chrome 浏览器回归 | 17 项通过，页面异常 0 |
| Canvas TypeScript 检查 | 通过 |
| 主站和 Canvas 隔离目录构建 | 通过，保留既有大包与动态导入警告 |
| 文件编码 | 修改文件 UTF-8，无 BOM |
| 真实收费生成或编辑 | 0 次 |
| 生产部署 | 未执行 |

17 项浏览器验收包括两模型质量、映射与请求断言、模型切换纠正、尺寸单一来源、非法尺寸阻止提交、PNG/JPEG/WebP 下载、参考图编辑、Key 热切换、批量逐张和部分失败、错误不重试、历史与参数刷新恢复、Infinite Canvas 图片恢复与换 Key 保留、四种尺寸布局，以及跨用户 IndexedDB 隔离。

四种尺寸均检查主站与 iframe 无横向溢出、顶部标题可见、参数滚动区不与底部生成区重叠、生成按钮始终位于 iframe 可视区域、滚动前后按钮纵坐标不变、参数外层没有第二个纵向滚动条。手机使用参数/结果切换与记录抽屉，避免上下叠放的表单与结果产生双重滚动。

详细断言与布局测量见 `../.codex/image-v6-evidence/browser-results.json`；构建、测试和编码汇总位于同一证据目录。

这些结果验证本地源码与现有链路的兼容性；不等同于真实上游生图效果或新产生的生产账单验收。下一步先由用户确认实际页面截图。
