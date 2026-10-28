"""验证来源未变，以及本轮没有覆盖受保护的既有工作区文件。"""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parents[1]
baseline = json.loads((root / '.codex/canvas-phase1-baseline/baseline.json').read_text(encoding='utf-8'))
allowed = {
    '.gitignore', '.dockerignore', '.github/workflows/backend-ci.yml', '.github/workflows/release.yml',
    'Dockerfile', 'Makefile', 'backend/internal/web/embed_on.go', 'frontend/package.json',
    'frontend/vite.config.ts', 'frontend/src/components/layout/userConsoleNavigation.ts',
    'frontend/src/components/layout/__tests__/userConsole.spec.ts', 'frontend/src/router/index.ts',
    'frontend/src/components/layout/UserConsoleHeader.vue',
    'frontend/src/i18n/locales/zh/index.ts', 'frontend/src/i18n/locales/en/index.ts',
}
unexpected = [name for name, digest in baseline['hashes'].items()
              if name not in allowed and (not (root / name).is_file() or hashlib.sha256((root / name).read_bytes()).hexdigest() != digest)]
source = Path(r'D:\workspace\code\new-api\canvas')
lock = json.loads((root / 'canvas/SOURCE_LOCK.json').read_text(encoding='utf-8'))
source_changed = [name for name, digest in lock['files'].items()
                  if hashlib.sha256((source / name).read_bytes()).hexdigest() != digest]
missing = [name for name in lock['files'] if not (root / 'canvas' / name).is_file()]
ignored = subprocess.run(['git', 'check-ignore', '-z', '--stdin'], cwd=root,
                         input=b'\0'.join(('canvas/' + name).encode() for name in lock['files']) + b'\0', capture_output=True).stdout.decode().split('\0')
ignored = [name for name in ignored if name]
original_package = json.loads((root / '.codex/canvas-phase1-baseline/original/frontend/package.json').read_text(encoding='utf-8'))
package = json.loads((root / 'frontend/package.json').read_text(encoding='utf-8'))
for key, value in original_package.items():
    if key != 'scripts':
        assert package[key] == value, '原有前端依赖或设置被改变'
for key, value in original_package['scripts'].items():
    assert package['scripts'][key] == value, '原有前端脚本被覆盖'
report = {'protected_workspace_files_changed': unexpected, 'readonly_source_files_changed': source_changed,
          'missing_vendor_source_files': missing, 'ignored_vendor_source_files': ignored, 'source_file_count': len(lock['files']), 'source_sha256': lock['snapshot_sha256']}
output = root / '.codex/canvas-phase1-evidence/protection.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
assert not unexpected and not source_changed and not missing and not ignored, report
print(json.dumps(report, ensure_ascii=False))
