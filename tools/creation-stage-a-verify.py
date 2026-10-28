"""核对 Stage A 文件边界、UTF-8 编码、只读来源与逐文件回滚原件。"""
from pathlib import Path
import difflib
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[1]
baseline = root / '.codex/creation-stage-a-baseline'
output = root / '.codex/creation-stage-a-evidence'
output.mkdir(parents=True, exist_ok=True)
before = json.loads((baseline / 'manifest.json').read_text(encoding='utf-8'))
owned = [
    'frontend/src/views/user/ImageStudioView.vue',
    'frontend/src/components/canvas/EmbeddedCanvasStudio.vue',
    'frontend/src/components/canvas/__tests__/EmbeddedCanvasStudio.spec.ts',
    'frontend/src/composables/useCreationSelection.ts',
    'frontend/src/components/layout/UserConsoleLayout.vue',
    'frontend/src/components/layout/userConsoleNavigation.ts',
    'frontend/src/components/layout/__tests__/userConsole.spec.ts',
    'frontend/src/components/icons/Icon.vue',
    'frontend/src/router/index.ts',
    'frontend/src/lib/canvas-host-bridge.ts',
    'frontend/src/lib/__tests__/canvas-host-bridge.spec.ts',
    'frontend/src/i18n/locales/zh/imageStudio.ts',
    'frontend/src/i18n/locales/en/imageStudio.ts',
    'frontend/src/styles/creation-studio.css',
    'canvas/web/src/pages/image/index.tsx',
    'canvas/web/src/components/image-settings-panel.tsx',
    'canvas/web/src/components/layout/app-providers.tsx',
    'canvas/web/src/app.tsx',
    'canvas/web/src/styles/sub2api-host.css',
    'tools/creation-stage-a-preview.mjs',
    'tools/creation-stage-a-browser-test.cjs',
    'tools/creation-stage-a-verify.py',
    'canvas/STAGE_A_REPORT.md',
]
# 后补原件按完整路径归档，并用实施前摘要确认原件没有混入本轮修改。
for name in owned:
    if name not in before:
        continue
    original = baseline / 'original' / name
    if not original.exists():
        source = baseline / Path(name).name
        assert source.exists(), f'缺少回滚原件：{name}'
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, original)
    assert hashlib.sha256(original.read_bytes()).hexdigest() == before[name], f'回滚原件摘要不符：{name}'

unexpected = []
for name, digest in before.items():
    if name in owned:
        continue
    file = root / name
    if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
        unexpected.append(name)
assert not unexpected, f'本轮范围外文件变化：{unexpected}'

patch = []
manifest = []
for name in owned:
    file = root / name
    data = file.read_bytes()
    assert not data.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')), f'禁止 BOM 或 UTF-16：{name}'
    text = data.decode('utf-8')
    assert '\x00' not in text, f'文本含空字节：{name}'
    old = (baseline / 'original' / name).read_text(encoding='utf-8') if name in before else ''
    patch.extend(difflib.unified_diff(old.splitlines(keepends=True), text.splitlines(keepends=True), fromfile='before/' + name, tofile='after/' + name))
    manifest.append({'path': name, 'new': name not in before, 'before_sha256': before.get(name), 'after_sha256': hashlib.sha256(data).hexdigest()})

lock = json.loads((root / 'canvas/SOURCE_LOCK.json').read_text(encoding='utf-8'))
source = Path('D:/workspace/code/new-api/canvas')
source_changed = [name for name, digest in lock['files'].items() if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest]
missing = [name for name in lock['files'] if not (root / 'canvas' / name).is_file()]
assert not source_changed and not missing, '只读来源发生变化或快照文件缺失'
result = {'owned_file_count': len(owned), 'protected_baseline_files': len(before) - sum(name in before for name in owned), 'unexpected_changes': unexpected, 'source_files': len(lock['files']), 'readonly_source_changes': source_changed, 'missing_source_files': missing, 'encoding': 'UTF-8 without BOM', 'rollback_originals_verified': True}
(output / 'owned-files.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(output / 'protection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(output / 'stage-a.patch').write_text(''.join(patch), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
