"""整理 V6 实际页面截图、原型对照和 UTF-8 检查，不修改业务文件。"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / '.codex/image-v6-evidence'
result = json.loads((out / 'browser-results.json').read_text(encoding='utf-8'))
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 23)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)

# 对照只拼排浏览器原始截图，不改变产品画面。
comparison = Image.new('RGB', (1210, 900), '#07111a')
draw = ImageDraw.Draw(comparison)
draw.text((24, 16), 'V6 原型与实际工作台 · 参数面板对照', font=font, fill='#e1edf7')
for x, name, title in [(24, 'prototype-parameter-panel.png', 'V6 HTML 原型'), (620, 'actual-parameter-panel.png', '实际页面 · 本机 Mock 验收')]:
    image = Image.open(out / name).convert('RGB')
    image.thumbnail((566, 765), Image.Resampling.LANCZOS)
    draw.text((x, 61), title, font=small, fill='#63eddf')
    comparison.paste(image, (x, 100))
comparison.save(out / 'v6-comparison.png')

contact = Image.new('RGB', (1620, 1120), '#07111a')
draw = ImageDraw.Draw(contact)
draw.text((24, 16), '实际页面验收截图 · 图片为本机 Mock，无真实收费调用', font=font, fill='#e1edf7')
for x, y, width, height in [(24, 70, 1920, 1080), (818, 70, 1536, 864), (24, 570, 1366, 768), (818, 570, 390, 844)]:
    image = Image.open(out / f'actual-{width}x{height}-top.png').convert('RGB')
    image.thumbnail((770, 470), Image.Resampling.LANCZOS)
    draw.text((x, y), f'{width} × {height}', font=small, fill='#63eddf')
    contact.paste(image, (x, y + 30))
contact.save(out / 'viewport-contact-sheet.png')

files = [
    'canvas/web/src/pages/image/index.tsx',
    'canvas/web/src/pages/image/components/host-image-settings.tsx',
    'canvas/web/src/pages/image/image-editor.module.css',
    'canvas/web/src/styles/sub2api-host.css',
    'canvas/web/src/lib/host-image-capabilities.ts',
    'canvas/web/src/lib/host-image-capabilities.test.ts',
    'canvas/web/src/stores/use-config-store.ts',
    'canvas/web/src/services/api/image.ts',
    'canvas/web/src/components/image-settings-panel.tsx',
    'canvas/CHANGELOG.md',
    'canvas/docs/content/docs/progress/pending-test.mdx',
    'canvas/IMAGE_V6_REPORT.md',
    'tools/creation-image-v6-preview.mjs',
    'tools/creation-image-v6-browser-test.cjs',
    'tools/creation-image-v6-report.py',
]
for name in files:
    raw = (root / name).read_bytes()
    assert not raw.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')), name
    raw.decode('utf-8')

# 保留逐项请求与布局断言，便于审阅面板与最终请求的一致性。
assert result['passed'] == 17 and result['errors'] == [] and result['realRequests'] == 0
summary = {
    'parameterTests': 107, 'hostAndKeyTests': 28, 'browserChecks': 17,
    'realPaidRequests': 0, 'deployed': False, 'utf8NoBom': files,
    'viewports': [f"{v['width']}x{v['height']}" for v in result['layout']],
}
(out / 'verification-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False))
