"""仅在源码未被其他工作修改时，同步已经验收版本的 Go 格式化结果。"""
import tarfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
copied=[];skipped=[]
with tarfile.open(root/'.codex/video-studio/source.tgz') as before,tarfile.open(root/'.codex/video-studio/formatted-go.tgz') as formatted:
 for member in formatted.getmembers():
  path=root/member.name
  if before.extractfile(member.name).read()!=path.read_bytes():skipped.append(member.name);continue
  path.write_bytes(formatted.extractfile(member).read());copied.append(member.name)
print('已同步格式化文件',len(copied),'跳过其他修改',len(skipped))
