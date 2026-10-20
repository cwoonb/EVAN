"""Access-code sessions must remain private, signed, throttled, and revocable."""
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest

HAS_API = all(importlib.util.find_spec(name) is not None for name in ("fastapi", "httpx", "jwt"))


@unittest.skipUnless(HAS_API, "Install server/requirements.txt")
class CodeAuthTests(unittest.TestCase):
    def setUp(self):
        from server.code_auth import CodeAuth
        from server.app import Settings, create_app
        from fastapi.testclient import TestClient
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "credentials.json"
        self.code = CodeAuth.provision(self.path)
        self.auth = CodeAuth.load(self.path)
        settings = Settings("", Path(self.folder.name) / "news.csv", ("https://cwoonb.github.io",),
                            "http://127.0.0.1:8000/v1", "qwen3.8-27b", "", Path(self.folder.name) / "rate.sqlite3", code_auth_path=self.path)
        self.client = TestClient(create_app(settings))

    def test_credentials_are_hashed_private_and_never_overwritten(self):
        from server.code_auth import CodeAuth
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertNotIn(self.code, self.path.read_text())
        with self.assertRaises(FileExistsError):
            CodeAuth.provision(self.path)
        self.path.chmod(0o644)
        with self.assertRaises(ValueError):
            CodeAuth.load(self.path)

    def test_valid_login_returns_short_lived_signed_session_and_no_code(self):
        response = self.client.post("/v1/auth/session", json={"code": self.code})
        self.assertEqual(response.status_code, 200)
        value = response.json()
        self.assertEqual(set(value), {"accessToken", "expiresAt", "owner"})
        self.assertEqual(self.auth.verify(value["accessToken"]), self.auth.owner)
        self.assertLessEqual(value["expiresAt"] - time.time(), 8 * 60 * 60)
        self.assertNotIn(self.code, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        config = self.client.get("/v1/auth/config")
        self.assertEqual(config.json(), {"configured": True, "mode": "code"})

    def test_forged_expired_wrong_audience_and_other_user_tokens_rejected(self):
        import jwt
        from server.news_gateway import RequestError
        token = self.auth.login(self.code)["accessToken"]
        claims = jwt.decode(token, self.auth.key, algorithms=["HS256"], audience=self.auth.AUDIENCE)
        for update in ({"exp": 1}, {"aud": "other"}, {"iss": "other"}, {"sub": "other"}, {"role": "admin"}):
            with self.assertRaises(RequestError):
                self.auth.verify(jwt.encode({**claims, **update}, self.auth.key, algorithm="HS256"))
        with self.assertRaises(RequestError):
            self.auth.verify(jwt.encode(claims, "another-long-key" * 4, algorithm="HS256"))

    def test_rotation_invalidates_existing_sessions(self):
        from server.code_auth import CodeAuth
        from server.news_gateway import RequestError
        token = self.auth.login(self.code)["accessToken"]
        second = self.path.with_name("rotated.json")
        CodeAuth.provision(second)
        with self.assertRaises(RequestError):
            CodeAuth.load(second).verify(token)

    def test_login_rejects_untrusted_origins_and_malformed_codes(self):
        self.assertEqual(self.client.post("/v1/auth/session", json={"code": self.code}, headers={"Origin": "https://evil.example"}).status_code, 403)
        for value in ({"code": "wrong"}, {"code": None}, {"code": "x" * 201}):
            self.assertEqual(self.client.post("/v1/auth/session", json=value).status_code, 401)
        self.assertEqual(self.client.post("/v1/auth/session", json={"code": self.code, "role": "admin"}).status_code, 400)
        self.assertEqual(self.client.post("/v1/auth/session", content="code").status_code, 415)

    def test_login_is_rate_limited_and_raw_addresses_not_persisted(self):
        for _ in range(10):
            self.assertEqual(self.client.post("/v1/auth/session", json={"code": "wrong"}).status_code, 401)
        response = self.client.post("/v1/auth/session", json={"code": self.code})
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        self.assertNotIn(b"testclient", self.path.with_name("login-limits.sqlite3").read_bytes())

    def test_code_token_cannot_bypass_article_binding(self):
        token = self.auth.login(self.code)["accessToken"]
        response = self.client.post("/v1/chat", json={"articleId": None, "issueId": None, "scope": "article", "messages": [{"role": "user", "content": "test"}]}, headers={"Authorization": "Bearer " + token})
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
