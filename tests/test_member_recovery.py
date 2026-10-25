"""Recovery credentials and opt-in browser login never bypass account ownership."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import sqlite3
import tempfile
import unittest
import uuid

from server.member_store import MemberError, MemberStore, RECOVERY_CODE
from tests.test_members import ARTICLE, PASSWORD, signup


class MemberRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "members.sqlite3"
        self.now = datetime.fromisoformat("2026-10-25T10:00:00+09:00").timestamp()
        self.store = MemberStore(self.path, clock=lambda: self.now)
        self.session = self.store.signup(signup())
        self.user = self.session["user"]["id"]
        self.client_id = str(uuid.uuid4())

    def remembered_login(self):
        return self.store.login("reader_one", PASSWORD, True, self.client_id)

    def test_default_is_not_remembered_and_codes_are_private_hashes(self):
        self.assertNotIn("rememberToken", self.session)
        self.assertTrue(self.session["recoveryReady"])
        self.assertTrue(RECOVERY_CODE.fullmatch(self.session["recoveryCode"]))
        self.assertNotIn("recoveryCode", self.store.me(self.user))
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM member_remember").fetchone()[0], 0)
            code_hash = db.execute("SELECT digest FROM member_recovery").fetchone()[0]
            self.assertEqual(len(code_hash), 64)
            self.assertNotEqual(code_hash, self.session["recoveryCode"])
        self.assertNotIn(self.session["recoveryCode"].encode(), self.path.read_bytes())
        restarted = MemberStore(self.path, clock=lambda: self.now)
        self.assertEqual(restarted.server_id, self.session["serverId"])
        self.assertEqual(restarted.recover_username(self.session["recoveryCode"].lower())["username"], "reader_one")

    def test_remember_requires_matching_random_client_and_keeps_absolute_expiry(self):
        session = self.remembered_login()
        expiry = int(self.now + 30 * 86400)
        self.assertEqual(session["rememberExpiresAt"], expiry)
        self.assertEqual(session["expiresAt"], int(self.now + 8 * 3600))
        with sqlite3.connect(self.path) as db:
            digest, client_digest = db.execute("SELECT digest,client_digest FROM member_remember").fetchone()
        self.assertNotEqual(digest, session["rememberToken"])
        self.assertNotEqual(client_digest, self.client_id)
        with self.assertRaises(MemberError):
            self.store.remember(session["rememberToken"], str(uuid.uuid4()))
        self.now += 29 * 86400 + 23 * 3600
        restored = self.store.remember(session["rememberToken"], self.client_id)
        self.assertEqual(restored["rememberExpiresAt"], expiry)
        self.assertEqual(restored["expiresAt"], expiry)
        self.assertNotIn("rememberToken", restored)
        self.now = expiry
        for action in (lambda: self.store.remember(session["rememberToken"], self.client_id), lambda: self.store.verify(restored["accessToken"])):
            with self.assertRaises(MemberError):
                action()
        self.store.prune()
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM member_remember").fetchone()[0], 0)

    def test_logout_revokes_entire_saved_browser_but_not_other_browser(self):
        saved = self.remembered_login()
        restored = self.store.remember(saved["rememberToken"], self.client_id)
        other_client = str(uuid.uuid4())
        other = self.store.login("reader_one", PASSWORD, True, other_client)
        self.store.logout(restored["accessToken"])
        for token in (saved["accessToken"], restored["accessToken"]):
            with self.assertRaises(MemberError):
                self.store.verify(token)
        with self.assertRaises(MemberError):
            self.store.remember(saved["rememberToken"], self.client_id)
        self.assertEqual(self.store.verify(other["accessToken"]), self.user)
        self.assertEqual(self.store.verify(self.session["accessToken"]), self.user)

    def test_expired_access_can_forget_browser_and_new_login_replaces_same_client(self):
        first = self.remembered_login()
        newer = self.remembered_login()
        with self.assertRaises(MemberError):
            self.store.remember(first["rememberToken"], self.client_id)
        self.now += 8 * 3600 + 1
        with self.assertRaises(MemberError):
            self.store.verify(newer["accessToken"])
        self.store.forget(newer["rememberToken"], self.client_id)
        self.store.forget(newer["rememberToken"], self.client_id)
        with self.assertRaises(MemberError):
            self.store.remember(newer["rememberToken"], self.client_id)

    def test_malformed_remember_options_do_not_create_device_or_session(self):
        options = ((True, None), ("true", self.client_id), (False, self.client_id), (True, "127.0.0.1"), (True, "00000000-0000-0000-0000-000000000000"))
        for remember, client in options:
            with self.subTest(remember=remember, client=client), self.assertRaises(MemberError):
                self.store.login("reader_one", PASSWORD, remember, client)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM member_remember").fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM member_sessions").fetchone()[0], 1)

    def test_reset_rotates_one_use_code_and_preserves_quota_comments_history(self):
        self.store.finish_question(self.store.reserve_question(self.user))
        self.store.set_privacy(self.user, True)
        self.store.record_history(self.user, ARTICLE)
        self.store.create_comment(self.user, ARTICLE, "비밀번호를 바꿔도 보존할 의견")
        saved = self.remembered_login()
        code = self.session["recoveryCode"]
        self.assertEqual(self.store.recover_username(code)["username"], "reader_one")
        reset = self.store.reset_password("READER_ONE", code, "Az!7k2")
        self.assertNotIn("accessToken", reset)
        self.assertNotEqual(reset["recoveryCode"], code)
        for action in (lambda: self.store.recover_username(code), lambda: self.store.reset_password("reader_one", code, "another password"), lambda: self.store.verify(self.session["accessToken"]), lambda: self.store.verify(saved["accessToken"]), lambda: self.store.remember(saved["rememberToken"], self.client_id), lambda: self.store.login("reader_one", PASSWORD)):
            with self.assertRaises(MemberError):
                action()
        self.assertEqual(self.store.login("reader_one", "Az!7k2")["quota"]["remaining"], 9)
        self.assertEqual(self.store.history(self.user)["history"][0]["articleId"], ARTICLE)
        self.assertEqual(self.store.comments(ARTICLE)["comments"][0]["body"], "비밀번호를 바꿔도 보존할 의견")
        self.assertEqual(self.store.recover_username(reset["recoveryCode"])["username"], "reader_one")

    def test_recovery_code_rotation_requires_password_and_never_crosses_accounts(self):
        code = self.session["recoveryCode"]
        other = self.store.signup(signup("reader_two"))
        with self.assertRaises(MemberError):
            self.store.recovery_code(self.user, "wrong password")
        self.assertEqual(self.store.recover_username(code)["username"], "reader_one")
        for username in ("reader_one", "unknown_reader"):
            with self.assertRaises(MemberError) as error:
                self.store.reset_password(username, other["recoveryCode"], "Az!7k2")
            self.assertEqual(error.exception.code, "RECOVERY_INVALID")
        rotated = self.store.recovery_code(self.user, PASSWORD)["recoveryCode"]
        with self.assertRaises(MemberError):
            self.store.recover_username(code)
        self.assertEqual(self.store.recover_username(rotated)["username"], "reader_one")
        self.assertEqual(self.store.verify(self.session["accessToken"]), self.user)
        self.store.delete_account(self.user, PASSWORD)
        with self.assertRaises(MemberError):
            self.store.recover_username(rotated)
        self.assertEqual(self.store.recover_username(other["recoveryCode"])["username"], "reader_two")

    def test_concurrent_reset_only_accepts_the_recovery_code_once(self):
        def reset(_):
            try:
                return self.store.reset_password("reader_one", self.session["recoveryCode"], "Az!7k2")
            except MemberError as error:
                self.assertEqual(error.code, "RECOVERY_INVALID")
                return None
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(filter(None, pool.map(reset, range(2))))
        self.assertEqual(len(results), 1)
        self.assertEqual(self.store.login("reader_one", "Az!7k2")["user"]["id"], self.user)

    def test_recovery_guessing_is_limited_and_never_stores_ip(self):
        for _ in range(5):
            self.store.limit_auth("192.0.2.45", "recovery")
        with self.assertRaises(MemberError) as error:
            self.store.limit_auth("192.0.2.45", "recovery")
        self.assertEqual(error.exception.status, 429)
        with sqlite3.connect(self.path) as db:
            self.assertNotIn("192.0.2.45", str(db.execute("SELECT key FROM member_limits").fetchall()))

    def test_legacy_database_migration_preserves_existing_login_without_fake_recovery(self):
        self.store.finish_question(self.store.reserve_question(self.user))
        legacy_path = Path(self.folder.name) / "legacy" / "members.sqlite3"
        legacy_path.parent.mkdir()
        with sqlite3.connect(self.path) as source, sqlite3.connect(legacy_path) as legacy:
            for table in ("members", "member_question_reservations"):
                schema = source.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone()[0]
                legacy.execute(schema)
                for row in source.execute("SELECT * FROM " + table):
                    legacy.execute("INSERT INTO " + table + " VALUES (" + ",".join("?" for _ in row) + ")", row)
            legacy.execute("CREATE TABLE member_sessions(digest TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,created_at REAL NOT NULL,expires_at REAL NOT NULL)")
            row = source.execute("SELECT digest,user_id,created_at,expires_at FROM member_sessions").fetchone()
            legacy.execute("INSERT INTO member_sessions VALUES (?,?,?,?)", row)
        migrated = MemberStore(legacy_path, clock=lambda: self.now)
        self.assertEqual(migrated.verify(self.session["accessToken"]), self.user)
        self.assertEqual(migrated.login("reader_one", PASSWORD)["quota"]["remaining"], 9)
        self.assertFalse(migrated.me(self.user)["recoveryReady"])
        code = migrated.recovery_code(self.user, PASSWORD)["recoveryCode"]
        self.assertTrue(migrated.me(self.user)["recoveryReady"])
        self.assertEqual(migrated.recover_username(code)["username"], "reader_one")


if __name__ == "__main__":
    unittest.main()
