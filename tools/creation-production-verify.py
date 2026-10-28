"""复用已有交付摘要核对保护范围，并保存本次精确回滚原件。"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.codex' / 'creation-production-evidence'
original = OUT / 'original'


def digest(data):
    return hashlib.sha256(data).hexdigest()


records = json.loads((ROOT / '.codex/creation-p2-evidence/owned-files.json').read_text(encoding='utf8'))
source_path = 'frontend/src/lib/creation-chat.ts'
source = (ROOT / source_path).read_text(encoding='utf8')
# 对本次极小变更做逆向替换，并用已有 P2 最终摘要验证，避免把更早阶段原件当成本次基线。
before = source.replace(', maxOutputTokens = 4096) {', ') {')
before = before.replace("  // 各协议使用各自支持的输出限额字段；无效配置在发出收费请求前拒绝。\n  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new ChatFailure('configuration')\n", '')
before = before.replace('max_tokens: maxOutputTokens', 'max_tokens: 4096')
before = before.replace(', max_output_tokens: maxOutputTokens', '')
before = before.replace(', max_completion_tokens: maxOutputTokens', '')
before = before.replace('  /** @description 单次请求输出 Token 限额，默认 4096；不等同于费用硬封顶。 */\n  maxOutputTokens?: number\n', '')
before = before.replace(', options.maxOutputTokens)', ')')
expected = next(row['after_sha256'] for row in records if row['path'] == source_path)
candidates = [before.encode('utf8'), before.replace('\n', '\r\n').encode('utf8')]
verified = next((value for value in candidates if digest(value) == expected), None)
if verified is None:
    raise SystemExit('聊天源文件回滚原件未匹配 P2 摘要，拒绝生成不准确基线')
target = original / source_path
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(verified)
test_path = 'frontend/src/lib/__tests__/creation-chat.spec.ts'
test_source = (ROOT / test_path).read_text(encoding='utf8')
start = test_source.index("  it.each([['chat', 'max_completion_tokens']")
end = start + re.search(r'\n\}\)\n+(?=describe)', test_source[start:]).start()
test_before = test_source[:start] + test_source[end + 1:]
test_expected = next(row['after_sha256'] for row in records if row['path'] == test_path)
test_verified = next((value for value in [test_before.encode('utf8'), test_before.replace('\n', '\r\n').encode('utf8')] if digest(value) == test_expected), None)
if test_verified is None:
    raise SystemExit('新增测试的回滚原件未匹配 P2 摘要')
target = original / test_path
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(test_verified)
for path in ['frontend/src/composables/useCreationSelection.ts', 'frontend/src/composables/__tests__/useCreationSelection.spec.ts']:
    baseline = original / path
    expected = next(row['after_sha256'] for row in records if row['path'] == path)
    if not baseline.exists() or digest(baseline.read_bytes()) != expected:
        raise SystemExit('模型选择器回滚原件与既有 P2 摘要不一致')
preserved = []
for row in records:
    if row['path'] == source_path:
        continue
    file = ROOT / row['path']
    preserved.append({'path': row['path'], 'matches_p2_delivery': file.is_file() and digest(file.read_bytes()) == row['after_sha256']})
release = json.loads((OUT / 'release-manifest.json').read_text(encoding='utf8'))['manifest']
go = json.loads((ROOT / '.codex/creation-p3a-evidence/go-source-manifest.json').read_text(encoding='utf8'))
backend_diff = [name for name, sha in go.items() if release.get('backend/' + name) != sha]
result = {'chat_rollback_matches_p2_sha256': True, 'test_rollback_matches_p2_sha256': True, 'p2_files': preserved, 'backend_files_checked': len(go), 'backend_changes_since_p3a': backend_diff}
(OUT / 'source-protection.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
for name in ['canvas/CHANGELOG.md', 'canvas/docs/content/docs/progress/todo.mdx', 'canvas/docs/content/docs/progress/pending-test.mdx']:
    target = original / name
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / name).read_bytes())
print(json.dumps({'rollback_verified': True, 'backend_changes': len(backend_diff), 'p2_preserved': sum(row['matches_p2_delivery'] for row in preserved), 'p2_checked': len(preserved)}, ensure_ascii=False))
