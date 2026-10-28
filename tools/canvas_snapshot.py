"""只读导入定制 Canvas，并记录来源与本轮修改前的工作区基线。"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"D:\workspace\code\new-api\canvas")
DEST = ROOT / "canvas"
BACKUP = ROOT / ".codex" / "canvas-phase1-baseline"


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    if DEST.exists() or BACKUP.exists():
        raise SystemExit("目标或基线已存在，拒绝覆盖")
    # 修改前保存所有已跟踪文件的字节摘要，以及当前有改动的文件原件。
    files = git(ROOT, "ls-files", "-z").decode("utf-8").split("\0")
    hashes = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
              for name in files if name and (ROOT / name).is_file()}
    changed = git(ROOT, "diff", "--name-only", "-z").decode("utf-8").split("\0")
    for name in changed:
        if name and (ROOT / name).is_file():
            target = BACKUP / "original" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
    write_json(BACKUP / "baseline.json", {"head": git(ROOT, "rev-parse", "HEAD").decode().strip(),
               "status": git(ROOT, "status", "--porcelain=v1", "-uall").decode("utf-8"), "hashes": hashes})
    (BACKUP / "working-tree.patch").write_bytes(git(ROOT, "diff", "--binary"))
    source_files = sorted(filter(None, git(SOURCE, "ls-files", "-z").decode("utf-8").split("\0")))
    source_hashes = {}
    for name in source_files:
        data = (SOURCE / name).read_bytes()
        source_hashes[name] = hashlib.sha256(data).hexdigest()
        target = DEST / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    fingerprint = hashlib.sha256("".join(f"{name}\t{digest}\n" for name, digest in source_hashes.items()).encode()).hexdigest()
    write_json(DEST / "SOURCE_LOCK.json", {"repository": "https://github.com/chyyyyyds/infinite-canvas.git",
               "commit": git(SOURCE, "rev-parse", "HEAD").decode().strip(), "snapshot_sha256": fingerprint,
               "fingerprint_method": "Ordinal 路径排序；路径 TAB 原始字节SHA256 LF；UTF-8无BOM",
               "dirty_files": git(SOURCE, "diff", "--name-only").decode().splitlines(), "files": source_hashes})
    (DEST / "SOURCE_WORKTREE.patch").write_bytes(git(SOURCE, "diff", "--binary"))
    assert all(hashlib.sha256((DEST / n).read_bytes()).hexdigest() == d for n, d in source_hashes.items())
    print(f"Step 1：{len(source_hashes)} 个文件复制并逐字节校验通过；指纹 {fingerprint}")


if __name__ == "__main__":
    main()
