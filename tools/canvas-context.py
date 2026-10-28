"""打包当前源码到隔离 Docker 验证目录，不包含配置、密钥、缓存或现有测试产物。"""
from pathlib import Path
import subprocess
import tarfile

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=root).decode().split('\0')
executable = set()
for entry in subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=root).decode().split('\0'):
    if entry.startswith('100755 '):
        executable.add(entry.split('\t', 1)[1])
with tarfile.open(root / '.codex/canvas-phase1-context.tar.gz', 'w:gz') as archive:
    for name in sorted(set(paths)):
        if not name or name.startswith(('.codex/', '.stage', '.release', 'plugins/')) or '/node_modules/' in name or '/dist/' in name:
            continue
        path = root / name
        if path.is_file() and not name.endswith(('.env', '.key', '.pem')) and not name.startswith('deploy/config'):
            info = archive.gettarinfo(str(path), arcname=name)
            # Windows 文件系统没有 Unix 可执行位，使用 Git 索引里的原始权限。
            info.mode = 0o755 if name in executable else 0o644
            with path.open('rb') as data:
                archive.addfile(info, data)
print('隔离构建上下文已生成')
