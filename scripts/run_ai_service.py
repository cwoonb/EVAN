#!/usr/bin/env python3
"""Supervise the private EVAN API and a temporary HTTPS tunnel at user login.

Only this supervisor's child processes are stopped. Existing vLLM processes and
configuration are never inspected, started, or modified.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import plistlib
import queue
import re
import shlex
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent
LABEL = "com.evan.ai-service"
PORT = 8787
ORIGIN = f"http://127.0.0.1:{PORT}"
ENV_KEYS = {
    "AI_CODE_AUTH_FILE", "SUPABASE_URL", "NEWS_CSV_PATH", "ALLOWED_ORIGINS",
    "VLLM_BASE_URL", "QWEN_MODEL", "VLLM_API_KEY", "RATE_LIMIT_DB",
    "CHAT_REQUESTS_PER_MINUTE", "CHAT_REQUESTS_PER_DAY",
    "MEMBER_AUTH_DB",
}
TUNNEL_ORIGIN = re.compile(r"https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com(?![A-Za-z0-9.-])")


class ServiceError(RuntimeError):
    """Messages are fixed operator guidance, never raw subprocess/config output."""


def secure_file(path: Path, maximum: int = 65_536) -> str:
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > maximum:
            raise ServiceError("Private configuration must be a regular user-owned file with mode 600.")
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        raise ServiceError("Private configuration cannot be read.") from None


def load_environment(path: Path) -> dict[str, str]:
    """Parse dotenv assignments without shell execution, substitution, or eval."""
    values: dict[str, str] = {}
    for raw in secure_file(path).splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        name, separator, value = line.partition("=")
        name = name.strip()
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
            raise ServiceError("Private configuration contains an invalid assignment.")
        if name not in ENV_KEYS:
            raise ServiceError("Private configuration contains an unsupported setting.")
        try:
            pieces = shlex.split(value, comments=True, posix=True)
        except ValueError:
            raise ServiceError("Private configuration contains an invalid value.") from None
        if len(pieces) > 1:
            raise ServiceError("Quote configuration values that contain spaces.")
        values[name] = pieces[0] if pieces else ""
    if not values.get("NEWS_CSV_PATH") or not (values.get("MEMBER_AUTH_DB") or values.get("AI_CODE_AUTH_FILE") or values.get("SUPABASE_URL")):
        raise ServiceError("Configure the private CSV and an authentication method before starting.")
    try:
        with Path(values["NEWS_CSV_PATH"]).expanduser().open("rb") as handle:
            handle.read(1)
    except OSError:
        raise ServiceError("Private CSV cannot be read by this service process.") from None
    if values.get("AI_CODE_AUTH_FILE"):
        secure_file(Path(values["AI_CODE_AUTH_FILE"]).expanduser().absolute())
    return values


def base_environment() -> dict[str, str]:
    allowed = ("HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR")
    result = {key: os.environ[key] for key in allowed if key in os.environ}
    result.update(PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", PYTHONUNBUFFERED="1", GH_PROMPT_DISABLED="1")
    return result


def safe_origin(value: str) -> str | None:
    if not TUNNEL_ORIGIN.fullmatch(value):
        return None
    url = urlsplit(value)
    return value if url.scheme == "https" and not url.username and not url.password and not url.path and not url.query and not url.fragment else None


def prepare_state(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ServiceError("Service state must be a user-owned directory.")
    path.chmod(0o700)
    # launchd opens these before Python can set its umask.
    for name in ("launcher.log", "launcher-error.log"):
        descriptor = os.open(path / name, os.O_CREAT | os.O_APPEND | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        os.fchmod(descriptor, 0o600)
        os.close(descriptor)


def write_state(path: Path, state: dict) -> None:
    state["updatedAt"] = datetime.now(timezone.utc).isoformat()
    descriptor, temporary = tempfile.mkstemp(prefix=".status-", dir=path)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), 0o600)
            json.dump(state, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path / "status.json")
    finally:
        Path(temporary).unlink(missing_ok=True)


def read_state(path: Path) -> dict:
    try:
        value = json.loads(secure_file(path / "status.json"))
        return value if isinstance(value, dict) else {}
    except (ServiceError, ValueError):
        return {}


def stop_child(child: subprocess.Popen | None) -> None:
    if child is None or child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=3)
        except (OSError, subprocess.SubprocessError):
            pass
    except OSError:
        pass


def health_ready(origin: str) -> bool:
    try:
        with urlopen(origin + "/healthz", timeout=5) as response:
            value = json.loads(response.read(4096))
            return response.status == 200 and value.get("status") in {"configured", "ok", "ready"}
    except (OSError, HTTPError, URLError, ValueError, AttributeError):
        return False


def capture_origin(stream, origins: queue.Queue) -> None:
    # Consume and discard cloudflared output. Persist only a validated public URL.
    try:
        for line in iter(stream.readline, ""):
            for match in TUNNEL_ORIGIN.finditer(line):
                origin = safe_origin(match.group(0))
                if origin:
                    origins.put(origin)
    finally:
        stream.close()


def publish_origin(args: argparse.Namespace, origin: str, state: dict, log: logging.Logger) -> bool:
    if state.get("appliedOrigin") == origin:
        return True
    if args.no_publish:
        state.update(appliedOrigin=origin, dispatchStatus="disabled")
        write_state(args.state_dir, state)
        return True
    environment = base_environment()
    try:
        result = subprocess.run([args.gh, "variable", "set", "EVAN_API_URL", "--repo", args.repo, "--body", origin],
                                env=environment, capture_output=True, timeout=10, check=False)
        if result.returncode:
            log.warning("Public API variable update failed; retry scheduled.")
            return False
        if args.no_initial_dispatch and not state.get("initialSuppressionUsed"):
            state.update(initialSuppressionUsed=True, dispatchStatus="initial_manual_deploy")
            log.info("Public API variable updated; initial deployment is reserved for the operator.")
        else:
            result = subprocess.run([args.gh, "workflow", "run", "deploy.yml", "--repo", args.repo, "--ref", "main"],
                                    env=environment, capture_output=True, timeout=10, check=False)
            if result.returncode:
                log.warning("Pages deployment request failed; retry scheduled.")
                return False
            state["dispatchStatus"] = "requested"
            log.info("Public API variable updated and Pages deployment requested.")
        state["appliedOrigin"] = origin
        write_state(args.state_dir, state)
        return True
    except (OSError, subprocess.SubprocessError):
        log.warning("GitHub publication unavailable; retry scheduled.")
        return False


def supervise(args: argparse.Namespace) -> int:
    prepare_state(args.state_dir)
    lock = os.open(args.state_dir / "service.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(lock)
        raise ServiceError("An EVAN AI supervisor already owns this state directory.") from None
    log = logging.getLogger("evan.ai-service")
    log.setLevel(logging.INFO)
    handler = RotatingFileHandler(args.state_dir / "service.log", maxBytes=1_000_000, backupCount=2)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(handler)
    shutdown = threading.Event()
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, lambda _number, _frame: shutdown.set())
    state = read_state(args.state_dir)
    state.update(supervisorPid=os.getpid(), status="starting", origin=None)
    write_state(args.state_dir, state)
    gateway = tunnel = None
    delay = 5
    try:
        while not shutdown.is_set():
            try:
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    probe.bind(("127.0.0.1", PORT))
            except OSError:
                raise ServiceError("Port 8787 is already occupied; no existing process was stopped.") from None
            environment = base_environment()
            environment.update(load_environment(args.env_file))
            gateway = subprocess.Popen([str(args.python), "-m", "uvicorn", "server.app:app", "--host", "127.0.0.1",
                                        "--port", str(PORT), "--workers", "1", "--no-access-log", "--log-level", "warning"],
                                       cwd=ROOT, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                       stderr=subprocess.DEVNULL, start_new_session=True)
            state.update(status="gateway_starting", gatewayPid=gateway.pid, tunnelPid=None, origin=None)
            write_state(args.state_dir, state)
            deadline = time.monotonic() + 45
            while not shutdown.is_set() and gateway.poll() is None and time.monotonic() < deadline:
                if health_ready(ORIGIN):
                    break
                shutdown.wait(1)
            else:
                log.warning("Gateway did not become ready; restart scheduled.")
                stop_child(gateway)
                gateway = None
                shutdown.wait(delay)
                delay = min(delay * 2, 60)
                continue
            if shutdown.is_set():
                break
            origins: queue.Queue = queue.Queue()
            tunnel = subprocess.Popen([args.cloudflared, "tunnel", "--config", "/dev/null", "--no-autoupdate",
                                       "--metrics", "127.0.0.1:0", "--url", ORIGIN, "--loglevel", "info"],
                                      cwd=ROOT, env=base_environment(), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                      stderr=subprocess.PIPE, text=True, bufsize=1, start_new_session=True)
            threading.Thread(target=capture_origin, args=(tunnel.stderr, origins), daemon=True).start()
            state.update(status="tunnel_starting", tunnelPid=tunnel.pid)
            write_state(args.state_dir, state)
            log.info("Gateway ready; temporary HTTPS tunnel starting.")
            deadline = time.monotonic() + 120
            origin = None
            retry_publish = 0.0
            while not shutdown.is_set() and gateway.poll() is None and tunnel.poll() is None:
                if origin is None:
                    try:
                        origin = origins.get(timeout=1)
                    except queue.Empty:
                        if time.monotonic() > deadline:
                            log.warning("Temporary tunnel did not provide an origin; restart scheduled.")
                            break
                        continue
                if state.get("origin") != origin:
                    if not health_ready(origin):
                        if time.monotonic() > deadline:
                            log.warning("Temporary HTTPS health check failed; restart scheduled.")
                            break
                        shutdown.wait(2)
                        continue
                    state.update(origin=origin, status="ready")
                    write_state(args.state_dir, state)
                    log.info("Authenticated API is reachable through temporary HTTPS.")
                    delay = 5
                if time.monotonic() >= retry_publish and not publish_origin(args, origin, state, log):
                    retry_publish = time.monotonic() + 60
                shutdown.wait(2)
            stop_child(tunnel)
            stop_child(gateway)
            tunnel = gateway = None
            if not shutdown.is_set():
                state.update(status="restarting", origin=None, gatewayPid=None, tunnelPid=None)
                write_state(args.state_dir, state)
                log.warning("Owned gateway or tunnel stopped; restart scheduled.")
                shutdown.wait(delay)
                delay = min(delay * 2, 60)
    finally:
        stop_child(tunnel)
        stop_child(gateway)
        state.update(status="stopped", origin=None, gatewayPid=None, tunnelPid=None)
        write_state(args.state_dir, state)
        log.info("Supervisor stopped; owned child processes cleaned up.")
        handler.close()
        log.removeHandler(handler)
        os.close(lock)
    return 0


def agent_plist(args: argparse.Namespace) -> dict:
    arguments = [str(args.supervisor_python), str(ROOT / "scripts/run_ai_service.py"), "run", "--env-file", str(args.env_file),
                 "--state-dir", str(args.state_dir), "--python", str(args.python), "--cloudflared", args.cloudflared,
                 "--repo", args.repo]
    if args.gh:
        arguments += ["--gh", args.gh]
    if args.no_initial_dispatch:
        arguments.append("--no-initial-dispatch")
    if args.no_publish:
        arguments.append("--no-publish")
    return {
        "Label": LABEL, "ProgramArguments": arguments, "WorkingDirectory": str(ROOT),
        "RunAtLoad": True, "KeepAlive": True, "ThrottleInterval": 30,
        "ProcessType": "Background", "ExitTimeOut": 90,
        "StandardOutPath": str(args.state_dir / "launcher.log"),
        "StandardErrorPath": str(args.state_dir / "launcher-error.log"),
        "EnvironmentVariables": base_environment(),
    }


def main() -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("run", "launch-agent", "status", "check"))
    parser.add_argument("--env-file", type=Path, default=ROOT / "server/.env")
    parser.add_argument("--state-dir", type=Path, default=ROOT / "server/.state/ai-service")
    parser.add_argument("--python", type=Path, default=ROOT / "server/.venv/bin/python")
    known_macos_python = Path("/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9")
    parser.add_argument("--supervisor-python", type=Path, default=known_macos_python if sys.platform == "darwin" and known_macos_python.is_file() else Path(sys.executable),
                        help="Standard-library supervisor executable; the API still uses --python's virtualenv.")
    parser.add_argument("--cloudflared", default=shutil.which("cloudflared"))
    parser.add_argument("--gh", default=shutil.which("gh"))
    parser.add_argument("--repo", default="cwoonb/EVAN")
    parser.add_argument("--no-initial-dispatch", action="store_true", help="Update the first origin but reserve its first deployment for the operator; subsequent origins deploy automatically.")
    parser.add_argument("--no-publish", action="store_true", help="Never update GitHub variables or request a deployment.")
    parser.add_argument("--install", action="store_true", help="Only with launch-agent: write and bootstrap the login job. Omit to preview its plist.")
    args = parser.parse_args()
    args.env_file = args.env_file.expanduser().absolute()
    args.state_dir = args.state_dir.expanduser().absolute()
    args.python = args.python.expanduser().absolute()
    args.supervisor_python = args.supervisor_python.expanduser().absolute()
    if args.command == "status":
        print(json.dumps(read_state(args.state_dir) or {"status": "not_started"}, ensure_ascii=False, indent=2))
        return 0
    if args.install and args.command != "launch-agent":
        parser.error("--install is only valid with launch-agent.")
    if not args.cloudflared or not args.python.is_file() or not args.supervisor_python.is_file() or (not args.no_publish and not args.gh):
        parser.error("Install cloudflared, prepare the gateway virtualenv, and authenticate gh first.")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("Use an owner/repository GitHub identity.")
    try:
        load_environment(args.env_file)
        if args.command == "check":
            print("Private configuration and required executable paths are ready. No services were started.")
            return 0
        if args.command == "run":
            return supervise(args)
        if sys.platform != "darwin":
            raise ServiceError("LaunchAgent preparation requires macOS.")
        plist = agent_plist(args)
        if not args.install:
            sys.stdout.buffer.write(plistlib.dumps(plist))
            return 0
        prepare_state(args.state_dir)
        agents = Path.home() / "Library/LaunchAgents"
        agents.mkdir(parents=True, exist_ok=True)
        destination = agents / f"{LABEL}.plist"
        descriptor, temporary = tempfile.mkstemp(prefix=f".{LABEL}-", dir=agents)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                plistlib.dump(plist, handle)
            os.replace(temporary, destination)
            domain = f"gui/{os.getuid()}"
            for arguments in (("bootout", f"{domain}/{LABEL}"), ("enable", f"{domain}/{LABEL}")):
                result = subprocess.run(["/bin/launchctl", *arguments], capture_output=True, timeout=30, check=False)
                if arguments[0] != "bootout" and result.returncode:
                    raise ServiceError("LaunchAgent registration failed; inspect launchctl status.")
            # bootout can return before launchd has removed the old registration.
            for attempt in range(15):
                result = subprocess.run(["/bin/launchctl", "bootstrap", domain, str(destination)], capture_output=True, timeout=30, check=False)
                if not result.returncode:
                    break
                if attempt == 14:
                    raise ServiceError("LaunchAgent registration failed; inspect launchctl status.")
                time.sleep(1)
        finally:
            Path(temporary).unlink(missing_ok=True)
        print("Installed the EVAN AI login job. Service logs contain lifecycle events only.")
        return 0
    except ServiceError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, subprocess.SubprocessError):
        print("AI service operation failed. Check private file permissions, executable paths, and launchctl status.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
