"""归档当前后端源码和双前端产物，不包含凭证、缓存或生产数据。"""
import hashlib
import json
import os
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.codex' / 'creation-production-evidence'
OUT.mkdir(parents=True, exist_ok=True)
manifest = {}
archive = OUT / 'release-source.tar.gz'
with tarfile.open(archive, 'w:gz') as bundle:
    for directory, folders, files in os.walk(ROOT / 'backend'):
        # 双前端 dist 是本次发布的显式输入；其他数据、缓存和本地配置不进入归档。
        folders[:] = [name for name in folders if name not in {'.git', 'node_modules', 'target', 'bin', 'obj', 'data', '.idea', 'vendor'}]
        for name in files:
            file = Path(directory) / name
            relative = file.relative_to(ROOT).as_posix()
            if name.startswith('.env') or name in {'config.yaml', 'config.local.yaml'} or file.suffix in {'.key', '.pem', '.log', '.exe'}:
                continue
            manifest[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
            info = bundle.gettarinfo(str(file), arcname=relative)
            info.mode = 0o755 if file.suffix == '.sh' else 0o644
            with file.open('rb') as source:
                bundle.addfile(info, source)
    for name in ['canvas/LICENSE']:
        file = ROOT / name
        manifest[name] = hashlib.sha256(file.read_bytes()).hexdigest()
        bundle.add(file, arcname=name)
for expected in ['backend/internal/web/dist/index.html', 'backend/internal/web/dist/canvas/index.html']:
    if expected not in manifest:
        raise SystemExit('发布归档缺少双前端产物')
summary = {'files': len(manifest), 'archive': archive.name, 'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'manifest': manifest}
(OUT / 'release-manifest.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf8')
print(json.dumps({key: value for key, value in summary.items() if key != 'manifest'}, ensure_ascii=False))
