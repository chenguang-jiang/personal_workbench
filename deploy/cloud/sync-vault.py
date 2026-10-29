#!/usr/bin/env python3
"""本地文档到云端的单向同步；不改写 Obsidian 源文件。"""
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess

STATE = Path.home() / ".config/dawnkb-cloud"
CONFIG = json.loads((STATE / "sync.json").read_text())
SOURCE = Path(CONFIG["source"]).resolve()
STAGING = STATE / "staging"
ALLOWED = {".md", ".txt", ".pdf", ".docx", ".xlsx", ".csv", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif", ".mp3", ".m4a", ".mp4", ".webm", ".canvas", ".base"}
SKIP_DIRS = {"node_modules", "__pycache__", "GitHub-Repos", "codex-doc-sync", "cache", "logs"}
SECRET = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bglpat-[A-Za-z0-9_-]{20,}|(?:postgres(?:ql)?|mysql)://[^\s/:]+:[^\s@]+@")


def main():
    if CONFIG.get("enabled", True) is False:
        print("本地到云端同步已停用；云端知识库独立维护", flush=True)
        return
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STATE / "sync.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if not SOURCE.is_dir():
            raise RuntimeError("源知识库不可用，停止同步，保留云端数据")
        STAGING.mkdir(mode=0o700, exist_ok=True)
        expected, skipped = set(), []
        for base, dirs, files in os.walk(SOURCE):
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS and not (Path(base) / d).is_symlink()]
            for name in files:
                source = Path(base) / name
                if name.startswith(".") or source.is_symlink() or source.suffix.lower() not in ALLOWED:
                    continue
                relative = source.relative_to(SOURCE)
                if source.suffix.lower() in {".md", ".txt", ".csv", ".svg", ".canvas", ".base"}:
                    if SECRET.search(source.read_text(errors="replace")):
                        skipped.append(str(relative))
                        continue
                target = STAGING / relative
                expected.add(target)
                target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists() or source.stat().st_mtime_ns != target.stat().st_mtime_ns or source.stat().st_size != target.stat().st_size:
                    shutil.copy2(source, target)
                target.chmod(0o644)
        if not any(p.suffix.lower() == ".md" for p in expected):
            raise RuntimeError("未找到 Markdown 文档，停止同步，保留云端数据")
        for target in STAGING.rglob("*"):
            if target.is_file() and target not in expected:
                target.unlink()
            elif target.is_dir():
                target.chmod(0o755)
        (STATE / "excluded-documents.json").write_text(json.dumps(skipped, ensure_ascii=False, indent=2))
        ssh = ["/usr/bin/ssh", "-i", str(STATE / "sync-key"), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", f"UserKnownHostsFile={STATE / 'known_hosts'}", "-o", "ConnectTimeout=15"]
        rsync = CONFIG.get("rsync", "/opt/homebrew/bin/rsync")
        subprocess.run([rsync, "-rltz", "--delete-after", "--max-delete=50", "--delay-updates", "-e", shlex.join(ssh), f"{STAGING}/", CONFIG["destination"]], check=True, timeout=600)
        print(f"{datetime.datetime.now().isoformat(timespec='seconds')} 已同步 {len(expected)} 个文件，排除 {len(skipped)} 个含疑似密钥的文档", flush=True)


if __name__ == "__main__":
    main()
