"""打包候选后端源码与已构建前端，排除缓存和历史发布目录。"""
import tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
out=root/'.codex/video-studio'
out.mkdir(exist_ok=True)
with tarfile.open(out/'source.tgz','w:gz') as archive:
 for file in (root/'backend').rglob('*'):
  if not file.is_file() or any(part in {'node_modules','.git','target','bin','obj','.cache'} for part in file.relative_to(root).parts): continue
  if 'internal/web/dist' in file.as_posix(): continue
  if file.suffix in {'.exe','.test'}: continue
  archive.add(file,arcname=file.relative_to(root).as_posix())
 archive.add(root/'frontend/src/constants/platformCatalog.builtin.json',arcname='frontend/src/constants/platformCatalog.builtin.json')
 if (out/'frontend.tgz').exists(): archive.add(out/'frontend.tgz',arcname='frontend.tgz')
print((out/'source.tgz').stat().st_size)
