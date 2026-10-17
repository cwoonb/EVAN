"""Synchronization tests use temporary files and mocked GitHub calls only."""

import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from install_news_sync import make_plist
from sync_news import GitHub, SyncError, run_sync, validate_feed


FEED = {
    "version": 1,
    "revision": "a" * 64,
    "generatedAt": "2026-10-17T00:00:00Z",
    "latestPublishedAt": "2026-10-16T12:00:00Z",
    "stats": {"inputRows": 1, "articles": 1, "issues": 1, "duplicates": 0, "skipped": 0},
    "issues": [{
        "id": "example", "title": "Example announcement", "summary": "A public summary.",
        "importance": 3, "category": "AI", "eventType": "release",
        "publishedAt": "2026-10-16T12:00:00Z", "updatedAt": "2026-10-16T12:00:00Z",
        "keywords": ["Example"], "searchKeywords": ["Example"], "newTechnologies": [],
        "event": {"subject": "Example", "action": "release", "object": "model", "version": "",
                  "date": "2026-10-16", "summary": "A public event summary."},
        "sources": [{"id": "article-example", "title": "Example announcement", "source": "Example",
                     "url": "https://example.com/news", "publishedAt": "2026-10-16T12:00:00Z",
                     "summary": "A public summary.", "searchKeywords": ["Example"]}],
        "analysis": {"status": "ready", "summaryMethod": "extractive", "groupingMethod": "conservative"},
    }],
}


class FakeGitHub:
    def __init__(self):
        self.remote = None
        self.calls = []
        self.fail_dispatch = False

    def request(self, method, endpoint, payload=None, **_kwargs):
        self.calls.append((method, endpoint, payload))
        if method == "GET":
            return self.remote
        if method == "PUT":
            self.remote = {"sha": "remote-sha", "encoding": "base64", "content": payload["content"]}
            return {"content": {"sha": "remote-sha"}}
        if method == "POST" and self.fail_dispatch:
            raise SyncError("Dispatch failed.")
        return None


class NewsSyncTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.csv_path = self.directory / "private.csv"
        self.csv_path.write_text("title,url\nExample,https://example.com/news\n", encoding="utf-8")
        self.state_dir = self.directory / "state"
        self.github = FakeGitHub()

    def builder(self, command, **kwargs):
        self.assertIn("--csv", command)
        self.assertNotIn(self.csv_path.read_text(encoding="utf-8"), command)
        self.assertEqual(kwargs["timeout"], 90)
        Path(command[command.index("--output") + 1]).write_text(json.dumps(FEED), encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    def synchronize(self):
        return run_sync(self.csv_path, "owner/private-data", "owner/site", self.state_dir,
                        self.github, stability_seconds=0)

    @patch("sync_news.subprocess.run")
    def test_uploads_only_projection_and_then_dispatches(self, run):
        run.side_effect = self.builder
        self.assertIn("Published news revision", self.synchronize())
        self.assertEqual([call[0] for call in self.github.calls], ["GET", "PUT", "POST"])
        payload = self.github.calls[1][2]
        projection = json.loads(base64.b64decode(payload["content"]))
        self.assertEqual(projection, FEED)
        state = json.loads((self.state_dir / "state.json").read_text())
        self.assertEqual(state["revision"], FEED["revision"])
        self.assertEqual(sorted(path.name for path in self.state_dir.iterdir()), ["state.json", "sync.lock"])

    @patch("sync_news.subprocess.run")
    def test_unchanged_revision_does_not_call_github(self, run):
        run.side_effect = self.builder
        self.synchronize()
        self.github.calls.clear()
        self.assertEqual(self.synchronize(), "News is unchanged.")
        self.assertEqual(self.github.calls, [])

    @patch("sync_news.subprocess.run")
    def test_invalid_csv_preserves_last_state_and_remote(self, run):
        run.side_effect = self.builder
        self.synchronize()
        before = (self.state_dir / "state.json").read_bytes()
        self.github.calls.clear()
        run.side_effect = None
        run.return_value = subprocess.CompletedProcess([], 1, "", "Private source content")
        with self.assertRaisesRegex(SyncError, "Feed validation failed"):
            self.synchronize()
        self.assertEqual((self.state_dir / "state.json").read_bytes(), before)
        self.assertEqual(self.github.calls, [])

    @patch("sync_news.subprocess.run")
    def test_dispatch_failure_retries_without_uploading_again(self, run):
        run.side_effect = self.builder
        self.github.fail_dispatch = True
        with self.assertRaisesRegex(SyncError, "Dispatch failed"):
            self.synchronize()
        self.assertFalse((self.state_dir / "state.json").exists())
        self.github.fail_dispatch = False
        self.synchronize()
        self.assertEqual(sum(call[0] == "PUT" for call in self.github.calls), 1)
        self.assertEqual(sum(call[0] == "POST" for call in self.github.calls), 2)
        self.assertTrue((self.state_dir / "state.json").exists())

    @patch("sync_news.subprocess.run")
    def test_upload_uses_existing_sha(self, run):
        run.side_effect = self.builder
        old = deepcopy(FEED)
        old["revision"] = "b" * 64
        self.github.remote = {"sha": "previous-sha", "encoding": "base64",
                              "content": base64.b64encode(json.dumps(old).encode()).decode()}
        self.synchronize()
        self.assertEqual(self.github.calls[1][2]["sha"], "previous-sha")

    @patch("sync_news.time.sleep")
    def test_csv_changing_before_validation_is_not_published(self, sleep):
        sleep.side_effect = lambda _seconds: self.csv_path.write_text("partial", encoding="utf-8")
        with self.assertRaisesRegex(SyncError, "source CSV is changing"):
            self.synchronize()
        self.assertEqual(self.github.calls, [])

    @patch("sync_news.subprocess.run")
    def test_csv_changing_during_validation_is_not_published(self, run):
        def changing_builder(command, **kwargs):
            result = self.builder(command, **kwargs)
            self.csv_path.write_text("partial", encoding="utf-8")
            return result
        run.side_effect = changing_builder
        with self.assertRaisesRegex(SyncError, "changed during validation"):
            self.synchronize()
        self.assertEqual(self.github.calls, [])

    def test_unsafe_public_url_is_rejected(self):
        for url in ("file:///private.csv", "https://user:password@example.com/private",
                    "javascript:alert(1)", "https://example.com:bad/news", "https://example.com/a b"):
            with self.subTest(url=url):
                feed = deepcopy(FEED)
                feed["issues"][0]["sources"][0]["url"] = url
                with self.assertRaises(SyncError):
                    validate_feed(feed)

    def test_unknown_fields_at_every_level_are_rejected(self):
        for level in ("root", "issue", "source", "event", "analysis", "stats"):
            with self.subTest(level=level):
                feed = deepcopy(FEED)
                issue = feed["issues"][0]
                target = {"root": feed, "issue": issue, "source": issue["sources"][0],
                          "event": issue["event"], "analysis": issue["analysis"], "stats": feed["stats"]}[level]
                target["rawContent"] = "This field must never be published."
                with self.assertRaises(SyncError):
                    validate_feed(feed)

    def test_empty_feed_is_rejected(self):
        feed = deepcopy(FEED)
        feed["issues"] = []
        with self.assertRaisesRegex(SyncError, "at least one"):
            validate_feed(feed)

    def test_latest_date_uses_newest_source_after_a_group_is_updated(self):
        feed = deepcopy(FEED)
        feed["issues"][0]["publishedAt"] = "2026-10-15T12:00:00Z"
        self.assertEqual(validate_feed(feed), feed)
        feed["latestPublishedAt"] = "2026-10-15T12:00:00Z"
        with self.assertRaisesRegex(SyncError, "latest publication date"):
            validate_feed(feed)

    def test_invalid_values_and_mismatched_counts_are_rejected(self):
        for field, value in (("importance", 0), ("importance", True), ("publishedAt", "2026-99-50"),
                             ("updatedAt", "2026-10-16T12:00:00"), ("id", "/private/local.csv"),
                             ("summary", "x" * 1201)):
            with self.subTest(field=field, value=value):
                feed = deepcopy(FEED)
                feed["issues"][0][field] = value
                with self.assertRaises(SyncError):
                    validate_feed(feed)
        for count in ("inputRows", "articles", "issues", "duplicates", "skipped"):
            with self.subTest(count=count):
                feed = deepcopy(FEED)
                feed["stats"][count] += 1
                with self.assertRaises(SyncError):
                    validate_feed(feed)

    @patch("sync_news.subprocess.run")
    def test_large_remote_feed_uses_blob_fallback_without_reupload(self, run):
        run.side_effect = self.builder
        blob = {"encoding": "base64", "content": base64.b64encode(json.dumps(FEED).encode()).decode()}
        with patch.object(self.github, "request", side_effect=[{"sha": "large-file", "encoding": "none"},
                                                               blob, None]) as request:
            self.synchronize()
        self.assertEqual([call.args[0] for call in request.call_args_list], ["GET", "GET", "POST"])
        self.assertIn("/git/blobs/large-file", request.call_args_list[1].args[1])

    @patch("sync_news.subprocess.run")
    def test_malformed_generated_json_does_not_call_github(self, run):
        def malformed_builder(command, **_kwargs):
            Path(command[command.index("--output") + 1]).write_text('{"rawContent":"private"}')
            return subprocess.CompletedProcess(command, 0, "", "")
        run.side_effect = malformed_builder
        with self.assertRaises(SyncError):
            self.synchronize()
        self.assertEqual(self.github.calls, [])
        self.assertFalse((self.state_dir / "state.json").exists())

    @patch("sync_news.subprocess.run")
    def test_github_payload_is_passed_through_stdin(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, "{}", "")
        GitHub("/usr/local/bin/gh").request("PUT", "repos/owner/data/contents/data/news.json",
                                         {"content": "sensitive-projection"})
        command = run.call_args.args[0]
        self.assertNotIn("sensitive-projection", command)
        self.assertEqual(command[-2:], ["--input", "-"])
        self.assertIn("sensitive-projection", run.call_args.kwargs["input"])

    @patch("sync_news.subprocess.run", side_effect=subprocess.TimeoutExpired("gh", 90))
    def test_github_timeout_is_bounded(self, _run):
        with self.assertRaisesRegex(SyncError, "next run will retry"):
            GitHub("/usr/local/bin/gh").request("GET", "repos/owner/data")

    def test_launch_agent_uses_absolute_paths_and_one_check(self):
        plist = make_plist(self.csv_path, "owner/data", "owner/site", "/opt/homebrew/bin/gh", self.state_dir)
        self.assertTrue(Path(plist["ProgramArguments"][0]).is_absolute())
        self.assertIn("--once", plist["ProgramArguments"])
        self.assertEqual(plist["StartInterval"], 60)
        self.assertTrue(plist["RunAtLoad"])
        self.assertNotIn("KeepAlive", plist)
        self.assertEqual(Path(plist["StandardOutPath"]).parent, self.state_dir)


if __name__ == "__main__":
    unittest.main()
