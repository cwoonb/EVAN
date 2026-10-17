#!/usr/bin/env python3
"""Prepare or install a login-scoped launchd job for local CSV synchronization."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent.parent
LABEL = "com.evan.news-sync"


def make_plist(csv_path: Path, repo: str, site_repo: str, gh: str,
               state_dir: Path, interval: int = 60) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [str(Path(sys.executable).resolve()), str(ROOT / "scripts/sync_news.py"),
                             "--csv", str(csv_path), "--repo", repo, "--site-repo", site_repo,
                             "--gh", gh, "--state-dir", str(state_dir), "--once"],
        "WorkingDirectory": str(ROOT),
        "RunAtLoad": True,
        "StartInterval": interval,
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "StandardOutPath": str(state_dir / "sync.log"),
        "StandardErrorPath": str(state_dir / "error.log"),
        "EnvironmentVariables": {"PATH": f"{Path(gh).parent}:/usr/bin:/bin:/usr/sbin:/sbin",
                                 "PYTHONUNBUFFERED": "1"},
    }


def launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["/bin/launchctl", *arguments], capture_output=True,
                          text=True, check=check, timeout=20)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--repo", default="cwoonb/EVAN-news-data")
    parser.add_argument("--site-repo", default="cwoonb/EVAN")
    parser.add_argument("--state-dir", type=Path, default=ROOT / ".news-sync")
    parser.add_argument("--interval", type=int, default=60)
    parser.add_argument("--install", action="store_true", help="Write and load the user LaunchAgent.")
    args = parser.parse_args()
    gh = shutil.which("gh")
    csv_path = args.csv.expanduser().resolve()
    state_dir = args.state_dir.expanduser().resolve()
    if not gh:
        parser.error("Install and authenticate gh before preparing the job.")
    if not csv_path.is_file():
        parser.error("The local CSV file does not exist.")
    if args.interval < 60:
        parser.error("The polling interval must be at least 60 seconds.")
    plist = make_plist(csv_path, args.repo, args.site_repo, str(Path(gh).absolute()),
                       state_dir, args.interval)
    if not args.install:
        sys.stdout.buffer.write(plistlib.dumps(plist))
        return 0
    if sys.platform != "darwin":
        parser.error("LaunchAgent installation requires macOS.")
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    agents = Path.home() / "Library/LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    destination = agents / f"{LABEL}.plist"
    descriptor, temporary = tempfile.mkstemp(prefix=f".{LABEL}-", dir=agents)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            plistlib.dump(plist, handle)
        os.replace(temporary, destination)
        domain = f"gui/{os.getuid()}"
        launchctl("bootout", f"{domain}/{LABEL}", check=False)
        launchctl("enable", f"{domain}/{LABEL}")
        launchctl("bootstrap", domain, str(destination))
    except (OSError, subprocess.SubprocessError):
        print("LaunchAgent could not be loaded. Check the saved plist and launchctl status.", file=sys.stderr)
        return 1
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f"Installed {destination}; checks run every {args.interval} seconds while logged in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
