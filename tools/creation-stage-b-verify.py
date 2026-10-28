"""Stage B 原件备份、范围外保护与 UTF-8 无 BOM 检查；不执行回滚。"""
from pathlib import Path
import hashlib
import json
import shutil
import sys
import difflib

root = Path(__file__).resolve().parents[1]
baseline = root / '.codex/creation-stage-b-baseline'
out = root / '.codex/creation-stage-b-evidence'
owned = [
    'frontend/package.json', 'frontend/pnpm-lock.yaml',
    'frontend/src/views/user/ImageStudioView.vue',
    'frontend/src/composables/useCreationChat.ts',
    'frontend/src/components/chat/CreationChat.vue',
    'frontend/src/components/chat/ChatMarkdown.vue',
    'frontend/src/lib/creation-chat.ts',
    'frontend/src/lib/creation-chat-db.ts',
    'frontend/src/lib/__tests__/creation-chat.spec.ts',
    'frontend/src/lib/__tests__/creation-chat-db.spec.ts',
    'frontend/src/composables/__tests__/useCreationChat.spec.ts',
    'frontend/src/components/chat/__tests__/ChatMarkdown.spec.ts',
    'frontend/src/styles/creation-chat.css',
    'frontend/src/i18n/locales/zh/imageStudio.ts',
    'frontend/src/i18n/locales/en/imageStudio.ts',
    'tools/creation-stage-b-preview.mjs',
    'tools/creation-stage-b-browser-test.cjs',
    'tools/creation-stage-b-verify.py',
    'canvas/STAGE_B_REPORT.md',
]
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
(out/'stage-b.patch').write_text(''.join(patch), encoding='utf-8')
result = dict(owned_files=len(records), protected_files=len(before)-sum(n in before for n in owned)-len(generated), generated_cache_excluded=generated, unexpected_changes=unexpected, encoding='UTF-8 without BOM', rollback_originals_verified=True)
(out/'protection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(result, ensure_ascii=False))
