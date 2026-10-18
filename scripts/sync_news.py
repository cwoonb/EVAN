#!/usr/bin/env python3
"""Publish a validated public news projection without uploading the source CSV."""

from __future__ import annotations

import argparse
import base64
from datetime import date, datetime
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
REVISION = re.compile(r"[0-9a-f]{64}\Z")
COMMAND_TIMEOUT = 90


class SyncError(RuntimeError):
    """An error safe to show in the local synchronization log."""


def _object(value: Any, fields: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != fields:
        raise SyncError(f"The public feed has invalid {label} fields.")


def _text(value: Any, label: str, *, maximum: int = 1200, empty: bool = False) -> str:
    if (not isinstance(value, str) or len(value) > maximum
            or (not empty and not value.strip())
            or any(ord(character) < 32 and character not in "\n\r\t" for character in value)):
        raise SyncError(f"The public feed has invalid {label} text.")
    return value


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,200}", value):
        raise SyncError(f"The public feed has an invalid {label} identifier.")
    return value


def _date(value: Any, label: str, *, nullable: bool = False) -> datetime | None:
    if nullable and value is None:
        return None
    _text(value, label, maximum=50)
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError("A timezone is required.")
        return result
    except ValueError as error:
        raise SyncError(f"The public feed has an invalid {label} date.") from error


def _terms(value: Any, label: str) -> None:
    if not isinstance(value, list) or len(value) > 256:
        raise SyncError(f"The public feed has an invalid {label} array.")
    for term in value:
        _text(term, label, maximum=200)


def validate_feed(value: Any) -> dict[str, Any]:
    """Fail closed before publication, including when private data is malformed."""
    _object(value, {"version", "revision", "generatedAt", "latestPublishedAt", "stats", "issues"}, "root")
    if type(value["version"]) is not int or value["version"] != 1:
        raise SyncError("The public feed has an invalid version.")
    if not isinstance(value["revision"], str) or not REVISION.fullmatch(value["revision"]):
        raise SyncError("The public feed has an invalid revision.")
    _date(value["generatedAt"], "generation")
    latest = _date(value["latestPublishedAt"], "latest publication", nullable=True)
    stats = value["stats"]
    _object(stats, {"inputRows", "articles", "issues", "duplicates", "skipped"}, "statistics")
    if any(type(count) is not int or count < 0 for count in stats.values()):
        raise SyncError("The public feed has invalid statistics counts.")
    if not isinstance(value["issues"], list) or not value["issues"]:
        raise SyncError("The public feed must contain at least one validated issue.")
    issue_ids: set[str] = set()
    source_ids: set[str] = set()
    source_count = 0
    published_dates: list[datetime] = []
    for issue in value["issues"]:
        _object(issue, {"id", "title", "summary", "importance", "category", "eventType", "publishedAt",
                        "updatedAt", "keywords", "searchKeywords", "newTechnologies", "event", "sources",
                        "analysis"}, "issue")
        identifier = _identifier(issue["id"], "issue")
        if identifier in issue_ids:
            raise SyncError("The public feed has duplicate issue identifiers.")
        issue_ids.add(identifier)
        _text(issue["title"], "issue title", maximum=600)
        _text(issue["summary"], "issue summary")
        _text(issue["category"], "category", maximum=100)
        _text(issue["eventType"], "event type", maximum=100)
        if type(issue["importance"]) is not int or issue["importance"] not in range(1, 6):
            raise SyncError("The public feed has an invalid importance value.")
        published_dates.append(_date(issue["publishedAt"], "issue publication"))
        _date(issue["updatedAt"], "issue update")
        for field in ("keywords", "searchKeywords", "newTechnologies"):
            _terms(issue[field], field)
        event = issue["event"]
        _object(event, {"subject", "action", "object", "version", "date", "summary"}, "event")
        for field in ("subject", "action", "object", "version", "date"):
            _text(event[field], f"event {field}", maximum=700 if field == "object" else 300, empty=True)
        if event["date"]:
            try:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", event["date"]):
                    raise ValueError("An ISO calendar date is required.")
                date.fromisoformat(event["date"])
            except ValueError as error:
                raise SyncError("The public feed has an invalid event date.") from error
        _text(event["summary"], "event summary", empty=True)
        analysis = issue["analysis"]
        _object(analysis, {"status", "summaryMethod", "groupingMethod"}, "analysis")
        for field in analysis:
            _text(analysis[field], "analysis method", maximum=200)
        if not isinstance(issue["sources"], list) or not issue["sources"]:
            raise SyncError("The public feed issue must contain a validated source.")
        for source in issue["sources"]:
            _object(source, {"id", "title", "source", "url", "publishedAt", "summary", "searchKeywords"}, "source")
            identifier = _identifier(source["id"], "source")
            if identifier in source_ids:
                raise SyncError("The public feed has duplicate source identifiers.")
            source_ids.add(identifier)
            _text(source["title"], "source title", maximum=600)
            _text(source["source"], "source name", maximum=200)
            # Articles whose body could not be collected have no analysis yet.
            # Preserve that absence instead of rejecting all other valid news.
            _text(source["summary"], "source summary", empty=True)
            _terms(source["searchKeywords"], "source search keywords")
            published_dates.append(_date(source["publishedAt"], "source publication"))
            _text(source["url"], "source URL", maximum=4000)
            try:
                url = urlsplit(source["url"])
                if (url.scheme not in {"https", "http"} or not url.hostname or url.username or url.password
                        or any(character.isspace() for character in source["url"])):
                    raise ValueError("An absolute public HTTP(S) URL is required.")
                url.port
            except ValueError as error:
                raise SyncError("The public feed contains an unsafe source URL.") from error
            source_count += 1
    if (stats["issues"] != len(value["issues"]) or stats["articles"] != source_count
            or stats["inputRows"] != stats["articles"] + stats["duplicates"] + stats["skipped"]):
        raise SyncError("The public feed statistics do not match its records.")
    if latest is None or latest != max(published_dates):
        raise SyncError("The public feed latest publication date does not match its records.")
    return value


def signature(path: Path) -> tuple[int, int, int, int]:
    stat = path.stat()
    if not path.is_file() or stat.st_size == 0:
        raise SyncError("The source CSV must be a nonempty regular file.")
    return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns


class GitHub:
    def __init__(self, executable: str):
        self.executable = executable

    def request(self, method: str, endpoint: str, payload: dict[str, Any] | None = None,
                *, allow_missing: bool = False) -> Any:
        command = [self.executable, "api", "--method", method, endpoint,
                   "--header", "Accept: application/vnd.github+json",
                   "--header", "X-GitHub-Api-Version: 2022-11-28"]
        if payload is not None:
            command.extend(["--input", "-"])
        try:
            result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                                    capture_output=True, text=True, timeout=COMMAND_TIMEOUT, check=False)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise SyncError("The GitHub request could not finish; the next run will retry.") from error
        if result.returncode:
            if allow_missing and re.search(r"\bHTTP 404\b", result.stderr):
                return None
            raise SyncError(f"GitHub {method} failed; verify gh authentication and repository access.")
        if not result.stdout.strip():
            return None
        try:
            return json.loads(result.stdout)
        except ValueError as error:
            raise SyncError("GitHub returned an invalid response.") from error


def read_state(path: Path) -> dict[str, Any]:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(path: Path, state: dict[str, Any]) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def remote_revision(github: GitHub, repo: str, remote: dict[str, Any]) -> str | None:
    content = remote
    if remote.get("encoding") != "base64":
        content = github.request("GET", f"repos/{repo}/git/blobs/{remote['sha']}")
    try:
        decoded = base64.b64decode(content["content"], validate=False)
        return validate_feed(json.loads(decoded))["revision"]
    except (KeyError, ValueError, TypeError, SyncError):
        return None


def run_sync(csv_path: Path, repo: str, site_repo: str, state_dir: Path,
             github: GitHub, *, stability_seconds: float = 1.0) -> str:
    if not REPOSITORY.fullmatch(repo) or not REPOSITORY.fullmatch(site_repo):
        raise SyncError("Repository names must use OWNER/NAME.")
    state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_path = state_dir / "state.json"
    with (state_dir / "sync.lock").open("a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "Another synchronization is running."
        before = signature(csv_path)
        time.sleep(stability_seconds)
        if signature(csv_path) != before:
            raise SyncError("The source CSV is changing; the next run will retry.")
        with tempfile.TemporaryDirectory(prefix=".feed-", dir=state_dir) as temporary:
            output = Path(temporary) / "news.json"
            try:
                result = subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("build_news_feed.py")),
                     "--csv", str(csv_path), "--output", str(output)],
                    capture_output=True, text=True, timeout=COMMAND_TIMEOUT, check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise SyncError("Feed validation could not finish; nothing was published.") from error
            if result.returncode:
                raise SyncError("Feed validation failed; the previous published feed is preserved.")
            if signature(csv_path) != before:
                raise SyncError("The source CSV changed during validation; nothing was published.")
            try:
                feed = validate_feed(json.loads(output.read_text(encoding="utf-8")))
            except (OSError, ValueError) as error:
                raise SyncError("Feed generation did not produce valid JSON.") from error
            revision = feed["revision"]
            expected = {"repo": repo, "siteRepo": site_repo, "revision": revision}
            if read_state(state_path) == expected:
                return "News is unchanged."
            endpoint = f"repos/{repo}/contents/data/news.json"
            remote = github.request("GET", endpoint, allow_missing=True)
            if remote is not None and (not isinstance(remote, dict) or not isinstance(remote.get("sha"), str)):
                raise SyncError("GitHub returned invalid file metadata; nothing was published.")
            if remote is None or remote_revision(github, repo, remote) != revision:
                serialized = json.dumps(feed, ensure_ascii=False, allow_nan=False,
                                        sort_keys=True, separators=(",", ":")).encode("utf-8")
                payload = {"message": f"Update public news projection {revision[:12]}",
                           "content": base64.b64encode(serialized + b"\n").decode("ascii")}
                if remote is not None:
                    payload["sha"] = remote["sha"]
                github.request("PUT", endpoint, payload)
            # Do not save state until dispatch succeeds. A failed dispatch retries without another upload.
            github.request("POST", f"repos/{site_repo}/dispatches",
                           {"event_type": "news-updated", "client_payload": {"revision": revision}})
            write_state(state_path, expected)
            return f"Published news revision {revision[:12]} and requested deployment."


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="Absolute local source CSV path.")
    parser.add_argument("--repo", default="cwoonb/EVAN-news-data", help="Private sanitized data repository.")
    parser.add_argument("--site-repo", default="cwoonb/EVAN", help="Public Pages source repository.")
    parser.add_argument("--state-dir", type=Path, default=ROOT / ".news-sync")
    parser.add_argument("--gh", default=shutil.which("gh"), help="Absolute path to the authenticated gh CLI.")
    parser.add_argument("--once", action="store_true", help="Run one check (the default).")
    args = parser.parse_args()
    if not args.gh:
        parser.error("gh was not found. Install and authenticate GitHub CLI first.")
    try:
        print(run_sync(args.csv.expanduser().resolve(), args.repo, args.site_repo,
                       args.state_dir.expanduser().resolve(), GitHub(args.gh)))
    except (SyncError, OSError) as error:
        # The CSV contents, generated JSON and authentication output never enter the log.
        print(f"News sync failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
