"""The login service must not execute configuration or publish untrusted URLs."""
from argparse import Namespace
import json
import logging
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.run_ai_service import (
    ServiceError, base_environment, load_environment, prepare_state,
    publish_origin, safe_origin, secure_file, write_state,
)


class AiServiceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.csv = self.root / "news.csv"
        self.csv.write_text("title\nActual news\n")
        self.env = self.root / "server.env"
        self.env.write_text(f'NEWS_CSV_PATH="{self.csv}"\nSUPABASE_URL=https://example.supabase.co\n')
        self.env.chmod(0o600)

    def test_private_configuration_rejects_public_permissions_and_symlinks(self):
        self.env.chmod(0o644)
        with self.assertRaises(ServiceError):
            secure_file(self.env)
        self.env.chmod(0o600)
        link = self.root / "link"
        link.symlink_to(self.env)
        with self.assertRaises(ServiceError):
            secure_file(link)

    def test_configuration_is_data_and_never_shell_code(self):
        sentinel = self.root / "should-not-exist"
        with self.env.open("a") as output:
            output.write(f'VLLM_API_KEY="$(touch {sentinel})"\n')
        self.assertEqual(load_environment(self.env)["VLLM_API_KEY"], f"$(touch {sentinel})")
        self.assertFalse(sentinel.exists())

    def test_unknown_environment_names_and_missing_csv_fail_closed(self):
        with self.env.open("a") as output:
            output.write("PATH=/tmp\n")
        with self.assertRaises(ServiceError):
            load_environment(self.env)
        self.env.write_text("NEWS_CSV_PATH=/does/not/exist\nSUPABASE_URL=https://example.supabase.co\n")
        with self.assertRaises(ServiceError):
            load_environment(self.env)

    def test_secrets_are_not_inherited_by_tunnel_or_github(self):
        with patch.dict(os.environ, {"VLLM_API_KEY": "secret", "AI_CODE_AUTH_FILE": "private", "GH_TOKEN": "secret"}):
            values = base_environment()
            for name in ("VLLM_API_KEY", "AI_CODE_AUTH_FILE", "GH_TOKEN"):
                self.assertNotIn(name, values)

    def test_only_valid_quick_tunnel_origins_can_be_published(self):
        self.assertEqual(safe_origin("https://real-tunnel.trycloudflare.com"), "https://real-tunnel.trycloudflare.com")
        for url in ("http://real.trycloudflare.com", "https://real.trycloudflare.com/path", "https://real.trycloudflare.com.evil.example", "https://user:secret@real.trycloudflare.com", "https://127.0.0.1", "https://real.trycloudflare.com?key=secret"):
            self.assertIsNone(safe_origin(url))

    def test_status_file_is_atomic_and_private(self):
        path = self.root / "state"
        prepare_state(path)
        write_state(path, {"status": "ready", "origin": "https://real.trycloudflare.com"})
        self.assertEqual(path.stat().st_mode & 0o777, 0o700)
        self.assertEqual((path / "status.json").stat().st_mode & 0o777, 0o600)
        self.assertEqual(json.loads((path / "status.json").read_text())["status"], "ready")
        self.assertEqual(len(list(path.glob(".status-*"))), 0)

    def test_first_deploy_skip_is_once_and_next_origin_dispatches(self):
        state_dir = self.root / "state"
        prepare_state(state_dir)
        args = Namespace(state_dir=state_dir, no_publish=False, no_initial_dispatch=True, gh="gh", repo="cwoonb/EVAN")
        state = {}
        with patch("scripts.run_ai_service.subprocess.run") as run:
            run.return_value.returncode = 0
            self.assertTrue(publish_origin(args, "https://first.trycloudflare.com", state, logging.getLogger("test")))
            self.assertEqual(run.call_count, 1)
            self.assertEqual(state["dispatchStatus"], "initial_manual_deploy")
            self.assertTrue(publish_origin(args, "https://second.trycloudflare.com", state, logging.getLogger("test")))
            self.assertEqual(run.call_count, 3)
            self.assertEqual(state["dispatchStatus"], "requested")
            self.assertIn("workflow", run.call_args.args[0])

    def test_failed_publication_preserves_previous_success_for_retry(self):
        path = self.root / "state"
        prepare_state(path)
        args = Namespace(state_dir=path, no_publish=False, no_initial_dispatch=False, gh="gh", repo="cwoonb/EVAN")
        state = {"appliedOrigin": "https://previous.trycloudflare.com"}
        with patch("scripts.run_ai_service.subprocess.run") as run:
            run.return_value.returncode = 1
            self.assertFalse(publish_origin(args, "https://new.trycloudflare.com", state, logging.getLogger("test")))
        self.assertEqual(state["appliedOrigin"], "https://previous.trycloudflare.com")


if __name__ == "__main__":
    unittest.main()
