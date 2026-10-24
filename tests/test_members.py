"""Member security, durable Korean calendar quotas, privacy, and API integration."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import csv
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from server.member_store import MemberStore, MemberError, SCRYPT_N
from server.news_gateway import build_corpus
HAS_API = all(importlib.util.find_spec(name) for name in ("fastapi", "httpx", "jwt"))
if HAS_API:
    from fastapi.testclient import TestClient
    from server.app import Settings, create_app

PASSWORD = "a private testing passphrase 2026"
ARTICLE = "article_" + "a" * 20
OTHER = "article_" + "b" * 20


def signup(username="reader_one", **extra):
    return {"username": username, "password": PASSWORD, "name": "검증 사용자", "birthDate": "1990-05-10", "privacyAccepted": True, "historyConsent": False, **extra}


class MemberStoreTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.now = datetime.fromisoformat("2026-10-24T23:50:00+09:00").timestamp()
        self.path = Path(self.folder.name) / "private" / "members.sqlite3"
        self.store = MemberStore(self.path, clock=lambda: self.now)
        self.session = self.store.signup(signup())
        self.user = self.session["user"]["id"]

    def test_password_hash_token_storage_and_private_permissions(self):
        self.assertEqual(SCRYPT_N, 1 << 17)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.path.parent.stat().st_mode & 0o777, 0o700)
        with sqlite3.connect(self.path) as db:
            salt, digest = db.execute("SELECT password_salt,password_hash FROM members").fetchone()
            token = db.execute("SELECT digest FROM member_sessions").fetchone()[0]
        self.assertEqual(len(salt), 32)
        self.assertEqual(len(digest), 64)
        self.assertNotEqual(token, self.session["accessToken"])
        self.assertNotIn(PASSWORD.encode(), self.path.read_bytes())
        self.assertEqual(self.store.login("READER_ONE", PASSWORD)["user"]["id"], self.user)

    def test_bad_password_unknown_user_and_token_are_rejected(self):
        for username in ("reader_one", "not_a_member"):
            with self.assertRaises(MemberError) as error:
                self.store.login(username, "wrong password")
            self.assertEqual(error.exception.status, 401)
            self.assertEqual(error.exception.detail, "아이디 또는 비밀번호를 확인해주세요.")
        with self.assertRaises(MemberError):
            self.store.verify("forged" * 10)

    def test_signup_validation_and_duplicate_identity(self):
        for values in ({"username": "../etc"}, {"password": "short"}, {"name": "\x00bad"}, {"birthDate": "2020-01-01"}, {"birthDate": "2000-02-30"}, {"privacyAccepted": False}, {"historyConsent": "yes"}):
            with self.subTest(values=values), self.assertRaises(MemberError):
                self.store.signup({**signup("other_reader"), **values})
        with self.assertRaises(MemberError) as error:
            self.store.signup(signup("READER_ONE"))
        self.assertEqual(error.exception.status, 409)

    def test_logout_expiry_and_restart(self):
        restarted = MemberStore(self.path, clock=lambda: self.now)
        self.assertEqual(restarted.verify(self.session["accessToken"]), self.user)
        restarted.logout(self.session["accessToken"])
        with self.assertRaises(MemberError):
            self.store.verify(self.session["accessToken"])
        token = self.store.login("reader_one", PASSWORD)["accessToken"]
        self.now += 8 * 3600 + 1
        with self.assertRaises(MemberError):
            self.store.verify(token)

    def test_tenth_allowed_eleventh_rejected_and_kst_midnight_resets(self):
        for index in range(10):
            if index == 6:
                self.now += 61
            reservation = self.store.reserve_question(self.user)
            self.assertEqual(self.store.finish_question(reservation)["remaining"], 9 - index)
        with self.assertRaises(MemberError) as error:
            self.store.reserve_question(self.user)
        self.assertEqual(error.exception.code, "DAILY_QUOTA_EXCEEDED")
        self.assertEqual(error.exception.quota["remaining"], 0)
        self.assertTrue(error.exception.quota["resetAt"].endswith("00:00:00+09:00"))
        restarted = MemberStore(self.path, clock=lambda: self.now)
        self.assertEqual(restarted.quota(self.user)["used"], 10)
        self.now = datetime.fromisoformat("2026-10-25T00:00:00+09:00").timestamp()
        self.assertEqual(self.store.quota(self.user)["remaining"], 10)

    def test_failed_answer_refund_and_idempotent_finalization(self):
        reservation = self.store.reserve_question(self.user)
        self.assertEqual(self.store.quota(self.user)["remaining"], 9)
        self.assertEqual(self.store.finish_question(reservation, False)["remaining"], 10)
        self.assertEqual(self.store.finish_question(reservation, True)["remaining"], 10)
        pending = self.store.reserve_question(self.user)
        self.now += 601
        self.assertEqual(self.store.quota(self.user)["remaining"], 10)
        self.assertIsInstance(pending, str)

    def test_concurrent_reservations_never_exceed_daily_limit(self):
        def reserve(_):
            try:
                return self.store.reserve_question(self.user)
            except MemberError:
                return None
        with ThreadPoolExecutor(max_workers=12) as pool:
            first = list(filter(None, pool.map(reserve, range(20))))
        self.assertEqual(len(first), 6)
        self.now += 61
        with ThreadPoolExecutor(max_workers=12) as pool:
            second = list(filter(None, pool.map(reserve, range(20))))
        self.assertEqual(len(first + second), 10)
        self.assertEqual(self.store.quota(self.user)["remaining"], 0)

    def test_history_requires_consent_and_can_be_withdrawn(self):
        self.assertFalse(self.store.record_history(self.user, ARTICLE)["recorded"])
        self.assertEqual(self.store.history(self.user)["history"], [])
        self.store.set_privacy(self.user, True)
        self.assertTrue(self.store.record_history(self.user, ARTICLE)["recorded"])
        self.assertEqual(self.store.history(self.user)["history"][0]["articleId"], ARTICLE)
        self.store.set_privacy(self.user, False)
        self.assertEqual(self.store.history(self.user)["history"], [])

    def test_history_expiry_and_account_data_isolation(self):
        other = self.store.signup(signup("reader_two", historyConsent=True))["user"]["id"]
        self.store.record_history(other, OTHER)
        self.assertEqual(self.store.history(self.user)["history"], [])
        self.now += 91 * 86400
        self.store.prune()
        self.assertEqual(self.store.history(other)["history"], [])

    def test_comments_public_fields_ownership_reply_and_deletion(self):
        comment = self.store.create_comment(self.user, ARTICLE, "원문 근거를 더 살펴보겠습니다.")["comment"]
        self.assertNotIn("birthDate", comment)
        self.assertNotIn("name", comment)
        self.assertEqual(comment["username"], "reader_one")
        other = self.store.signup(signup("reader_two"))["user"]["id"]
        for action in (lambda: self.store.edit_comment(other, comment["id"], "changed"), lambda: self.store.delete_comment(other, comment["id"])):
            with self.assertRaises(MemberError) as error:
                action()
            self.assertEqual(error.exception.status, 403)
        with self.assertRaises(MemberError):
            self.store.create_comment(other, OTHER, "다른 기사에 답글", comment["id"])
        self.store.create_comment(other, ARTICLE, "관련 근거가 흥미롭습니다.", comment["id"])
        self.store.edit_comment(self.user, comment["id"], "수정한 의견입니다.")
        self.store.delete_comment(self.user, comment["id"])
        removed = next(item for item in self.store.comments(ARTICLE)["comments"] if item["id"] == comment["id"])
        self.assertEqual(removed["status"], "deleted")
        self.assertEqual(removed["body"], "")

    def test_spam_duplicate_report_and_account_deletion(self):
        for body in ("<script>alert(1)</script>", "javascript:alert(1)", "a" * 25):
            with self.assertRaises(MemberError):
                self.store.create_comment(self.user, ARTICLE, body)
        comment = self.store.create_comment(self.user, ARTICLE, "검증을 위한 고유 의견")["comment"]
        with self.assertRaises(MemberError):
            self.store.create_comment(self.user, ARTICLE, "검증을 위한 고유 의견")
        other = self.store.signup(signup("reader_two"))["user"]["id"]
        self.store.report_comment(other, comment["id"], "privacy", "개인정보 노출 우려")
        with self.assertRaises(MemberError):
            self.store.report_comment(other, comment["id"], "spam")
        self.store.set_privacy(self.user, True)
        self.store.record_history(self.user, ARTICLE)
        self.store.delete_account(self.user, PASSWORD)
        with self.assertRaises(MemberError):
            self.store.verify(self.session["accessToken"])
        self.assertEqual(self.store.comments(ARTICLE)["comments"][0]["body"], "")
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM member_history WHERE user_id=?", (self.user,)).fetchone()[0], 0)

    def test_auth_throttling_never_stores_raw_ip(self):
        for _ in range(3):
            self.store.limit_auth("192.0.2.123", "signup")
        with self.assertRaises(MemberError) as error:
            self.store.limit_auth("192.0.2.123", "signup")
        self.assertEqual(error.exception.status, 429)
        with sqlite3.connect(self.path) as db:
            keys = str(db.execute("SELECT key FROM member_limits").fetchall())
        self.assertNotIn("192.0.2.123", keys)


@unittest.skipUnless(HAS_API, "Install server/requirements.txt for API integration tests")
class MemberApiTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        row = {"title": "Acme Orion 출시", "article_url": "https://example.com/actual", "published": "2026-10-24T00:00:00Z", "source": "Example", "summary": "새 모델이 출시됐다.", "analysis_status": "ok", "qwen_status": "ok"}
        path = root / "news.csv"
        with path.open("w") as output:
            writer = csv.DictWriter(output, fieldnames=list(row))
            writer.writeheader(); writer.writerow(row)
        corpus, _ = build_corpus([row])
        evidence = next(iter(corpus.values()))
        self.article = evidence.id
        self.question = {"articleId": evidence.id, "issueId": evidence.issue_id, "scope": "article", "messages": [{"role": "user", "content": "핵심이 뭐야?"}]}
        self.settings = Settings("", path, ("https://cwoonb.github.io",), "http://127.0.0.1:8000/v1", "qwen3.8-27b", "", root / "rates.sqlite3", member_db_path=root / "members" / "members.sqlite3")
        self.client = TestClient(create_app(self.settings))
        self.addCleanup(self.client.close)
        self.headers = {"Origin": "https://cwoonb.github.io"}
        response = self.client.post("/v1/members/signup", json=signup(), headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.token = response.json()["accessToken"]
        self.auth = {**self.headers, "Authorization": "Bearer " + self.token}

    def test_guest_reads_news_comments_but_cannot_write_or_ask(self):
        self.assertEqual(self.client.get("/v1/auth/config").json()["mode"], "member")
        self.assertEqual(self.client.get("/v1/comments", params={"articleId": self.article}).status_code, 200)
        for path, value in (("/v1/chat", self.question), ("/v1/comments", {"articleId": self.article, "body": "guest"}), ("/v1/members/me", {})):
            response = self.client.get(path) if path.endswith("me") else self.client.post(path, json=value)
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.client.post("/v1/auth/session", json={"code": "legacy"}).status_code, 503)

    def test_rejects_origin_extra_fields_and_unknown_article(self):
        self.assertEqual(self.client.post("/v1/members/login", json={"username": "reader_one", "password": PASSWORD}, headers={"Origin": "https://evil.example"}).status_code, 403)
        self.assertEqual(self.client.post("/v1/members/privacy", json={"historyConsent": True, "userId": "other"}, headers=self.auth).status_code, 400)
        self.assertEqual(self.client.post("/v1/comments", json={"articleId": ARTICLE, "body": "없는 기사"}, headers=self.auth).status_code, 404)
        self.assertEqual(self.client.post("/v1/members/privacy", content="{}", headers=self.auth).status_code, 415)
        self.assertEqual(self.client.post("/v1/members/login", content=json.dumps({"username": "reader_one", "password": "\ud800" * 15}), headers={**self.headers, "Content-Type": "application/json"}).status_code, 400)

    def test_chat_failure_does_not_consume_daily_quota_and_private_profile_not_sent(self):
        async def failed(*args):
            self.assertEqual(set(args[1]), {"articleId", "issueId", "scope", "messages"})
            raise RuntimeError("모델 연결 오류")
        with patch("server.app.ask_model", failed):
            response = self.client.post("/v1/chat", json=self.question, headers=self.auth)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self.client.get("/v1/members/me", headers=self.auth).json()["quota"]["remaining"], 10)
        async def answer(*_):
            return {"answer": "저장된 분석에 따르면 모델이 출시됐습니다.", "sources": []}
        with patch("server.app.ask_model", answer):
            response = self.client.post("/v1/chat", json=self.question, headers=self.auth)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["quota"]["remaining"], 9)
        self.assertNotIn("birthDate", response.text)
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_comment_api_and_logout_revocation(self):
        response = self.client.post("/v1/comments", json={"articleId": self.article, "body": "실제 기사 근거를 확인합니다."}, headers=self.auth)
        self.assertEqual(response.status_code, 200, response.text)
        comment_id = response.json()["comment"]["id"]
        self.assertEqual(self.client.post(f"/v1/comments/{comment_id}/edit", json={"body": "수정한 의견입니다."}, headers=self.auth).status_code, 200)
        self.assertEqual(self.client.post(f"/v1/comments/{comment_id}/delete", json={}, headers=self.auth).status_code, 200)
        self.assertEqual(self.client.post("/v1/members/logout", json={}, headers=self.auth).status_code, 200)
        self.assertEqual(self.client.get("/v1/members/me", headers=self.auth).status_code, 401)

    def test_daily_quota_is_enforced_by_api_not_browser(self):
        store = MemberStore(self.settings.member_db_path)
        user_id = store.verify(self.token)
        # Isolate the daily policy here; minute limiting has separate concurrent tests.
        with patch.object(store, "_limit"):
            for _ in range(10):
                store.finish_question(store.reserve_question(user_id))
        with patch("server.app.ask_model") as model:
            response = self.client.post("/v1/chat", json=self.question, headers=self.auth)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["code"], "DAILY_QUOTA_EXCEEDED")
        self.assertEqual(response.json()["quota"]["remaining"], 0)
        model.assert_not_called()


if __name__ == "__main__":
    unittest.main()
