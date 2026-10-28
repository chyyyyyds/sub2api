"""P1 原件备份、范围外保护与 UTF-8 无 BOM 检查；不执行回滚。"""
from pathlib import Path
import hashlib
import json
import shutil
import sys
import difflib

root = Path(__file__).resolve().parents[1]
baseline = root / '.codex/creation-p1-baseline'
out = root / '.codex/creation-p1-evidence'
owned = ['canvas/web/src/lib/localforage-storage.ts', 'canvas/web/src/services/image-storage.ts', 'canvas/web/src/lib/sub2api-context.ts', 'frontend/src/components/canvas/EmbeddedCanvasStudio.vue', 'frontend/src/lib/canvas-host-bridge.ts', 'frontend/src/components/canvas/__tests__/EmbeddedCanvasStudio.spec.ts', 'frontend/src/views/user/ImageStudioView.vue', 'canvas/web/src/lib/sub2api-bootstrap.ts', 'canvas/web/src/lib/scoped-localforage.ts', 'canvas/web/src/lib/host-image-capabilities.ts', 'canvas/web/src/lib/host-image-capabilities.test.ts', 'canvas/web/src/services/api/image.ts', 'canvas/web/src/components/image-settings-panel.tsx', 'canvas/web/src/pages/image/index.tsx', 'canvas/web/src/stores/canvas/use-canvas-store.ts', 'canvas/web/src/components/layout/app-providers.tsx', 'canvas/web/src/lib/host-storage-status.ts', 'canvas/web/src/lib/host-storage-status.test.ts', 'canvas/CHANGELOG.md', 'canvas/docs/content/docs/progress/pending-test.mdx', 'canvas/docs/content/docs/progress/todo.mdx', 'canvas/P1_REPORT.md', 'tools/creation-p1-preview.mjs', 'tools/creation-p1-browser-test.cjs', 'tools/creation-p1-verify.py']
skip = {'.git', '.codex', 'node_modules', 'target', '.idea', 'bin', 'obj', 'dist', '__pycache__', '.vite', 'coverage'}
def files(folder):
    for p in folder.iterdir():
        if p.is_dir():
            if p.name not in skip and not p.name.startswith(('.release-', '.stage')):
                yield from files(p)
        elif p.is_file():
            yield p
def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()
if '--init' in sys.argv:
    assert not baseline.exists(), '备份已存在，禁止覆盖'
    baseline.mkdir(parents=True)
    manifest = {p.relative_to(root).as_posix(): sha(p) for p in files(root)}
    for name in owned:
        if name in manifest:
            dest = baseline / 'original' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / name, dest)
    (baseline / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'已保护 {len(manifest)} 个文件，保留现有未提交内容')
    sys.exit()
before = json.loads((baseline / 'manifest.json').read_text(encoding='utf-8'))
generated = [n for n in before if n.endswith('.tsbuildinfo')]
unexpected = [n for n, digest in before.items() if n not in owned and n not in generated and (not (root/n).exists() or sha(root/n) != digest)]
unexpected += [p.relative_to(root).as_posix() for p in files(root) if p.relative_to(root).as_posix() not in before and p.relative_to(root).as_posix() not in owned and not p.name.endswith(".tsbuildinfo")]
assert not unexpected, unexpected
out.mkdir(parents=True, exist_ok=True)
records, patch = [], []
for name in owned:
    p = root / name
    if not p.exists():
        continue
    data = p.read_bytes()
    assert not data.startswith((b'\xef\xbb\xbf', b'\xff\xfe', b'\xfe\xff')), name
    content = data.decode('utf-8')
    assert '\x00' not in content, name
    old = ''
    if name in before:
        original = baseline / 'original' / name
        assert sha(original) == before[name], name
        old = original.read_text(encoding='utf-8')
    records.append(dict(path=name, new=name not in before, before_sha256=before.get(name), after_sha256=sha(p)))
    patch.extend(difflib.unified_diff(old.splitlines(True), content.splitlines(True), fromfile='before/'+name, tofile='after/'+name))
(out/'owned-files.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
(out/'p1.patch').write_text(''.join(patch), encoding='utf-8')
result = dict(owned_files=len(records), protected_files=len(before)-sum(n in before for n in owned)-len(generated), generated_cache_excluded=generated, unexpected_changes=unexpected, encoding='UTF-8 without BOM', rollback_originals_verified=True)
(out/'protection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
