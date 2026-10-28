"""打包最终双前端及完整源码摘要，用于在已验证后端副本上更新嵌入资源。"""
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.codex/creation-production-evidence'
archive = OUT / 'frontend-final.tar.gz'
with tarfile.open(archive, 'w:gz') as bundle:
    bundle.add(OUT / 'release-manifest.json', arcname='release-manifest.json')
    for file in (ROOT / 'backend/internal/web/dist').rglob('*'):
        if file.is_file():
            info = bundle.gettarinfo(str(file), arcname='source-final/' + file.relative_to(ROOT).as_posix())
            info.mode = 0o644
            with file.open('rb') as source:
                bundle.addfile(info, source)
print(json.dumps({'archive': archive.name, 'bytes': archive.stat().st_size}, ensure_ascii=False))
