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
DISPLAY_LABEL = "com.evan.news-display"


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


def make_display_plist(csv_path: Path, state_dir: Path, interval: int = 300) -> dict:
    """A separate bounded worker never delays ordinary news publication."""
    return {
        "Label": DISPLAY_LABEL,
        "ProgramArguments": [str(Path(sys.executable).resolve()), str(ROOT / "scripts/build_news_display.py"),
                             "--csv", str(csv_path), "--output", str(state_dir / "display-ko.json"),
                             "--limit", "12"],
        "WorkingDirectory": str(ROOT), "RunAtLoad": True, "StartInterval": interval,
        "ProcessType": "Background", "LowPriorityIO": True,
        "StandardOutPath": str(state_dir / "display.log"),
        "StandardErrorPath": str(state_dir / "display-error.log"),
        "EnvironmentVariables": {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "PYTHONUNBUFFERED": "1"},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--repo", default="cwoonb/EVAN-news-data")
    parser.add_argument("--site-repo", default="cwoonb/EVAN")
    parser.add_argument("--state-dir", type=Path, default=ROOT / ".news-sync")
    parser.add_argument("--interval", type=int, default=None)
    parser.add_argument("--display", action="store_true", help="Prepare the separate cached Korean display worker (300s default).")
    parser.add_argument("--install", action="store_true", help="Write and load the user LaunchAgent.")
    args = parser.parse_args()
    gh = shutil.which("gh")
    csv_path = args.csv.expanduser().resolve()
    state_dir = args.state_dir.expanduser().resolve()
    if not gh and not args.display:
        parser.error("Install and authenticate gh before preparing the job.")
    if not csv_path.is_file():
        parser.error("The local CSV file does not exist.")
    interval = args.interval if args.interval is not None else (300 if args.display else 60)
    if interval < (300 if args.display else 60):
        parser.error("The interval must be at least 300 seconds for display or 60 seconds for sync.")
    plist = (make_display_plist(csv_path, state_dir, interval) if args.display else
             make_plist(csv_path, args.repo, args.site_repo, str(Path(gh).absolute()), state_dir, interval))
    label = plist["Label"]
    if not args.install:
        sys.stdout.buffer.write(plistlib.dumps(plist))
        return 0
    if sys.platform != "darwin":
        parser.error("LaunchAgent installation requires macOS.")
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    agents = Path.home() / "Library/LaunchAgents"
    agents.mkdir(parents=True, exist_ok=True)
    destination = agents / f"{label}.plist"
    descriptor, temporary = tempfile.mkstemp(prefix=f".{label}-", dir=agents)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            plistlib.dump(plist, handle)
        os.replace(temporary, destination)
        domain = f"gui/{os.getuid()}"
        launchctl("bootout", f"{domain}/{label}", check=False)
        launchctl("enable", f"{domain}/{label}")
        launchctl("bootstrap", domain, str(destination))
    except (OSError, subprocess.SubprocessError):
        print("LaunchAgent could not be loaded. Check the saved plist and launchctl status.", file=sys.stderr)
        return 1
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f"Installed {destination}; checks run every {interval} seconds while logged in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
