"""主站构建后恢复现有画布静态资源并打包。"""
from pathlib import Path
import shutil
import tarfile
root=Path(__file__).resolve().parents[1]
dist=root/'backend/internal/web/dist'
shutil.copytree(root/'canvas/web/dist',dist/'canvas',dirs_exist_ok=True)
with tarfile.open(root/'.codex/video-studio/frontend.tgz','w:gz') as archive:
 for file in dist.rglob('*'):
  if file.is_file(): archive.add(file,arcname=file.relative_to(dist).as_posix())
print('assets packaged')
