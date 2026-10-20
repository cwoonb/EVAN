"""Personal access-code authentication; all credentials stay on the Mac."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import time
import uuid

import jwt

from server.news_gateway import RequestError


class CodeAuth:
    SESSION_SECONDS = 8 * 60 * 60
    ISSUER = "evan-code-gateway"
    AUDIENCE = "evan-news"

    def __init__(self, value: dict):
        try:
            self.salt = bytes.fromhex(value["salt"])
            self.digest = bytes.fromhex(value["digest"])
            self.key = value["signingKey"]
            self.owner = str(uuid.UUID(value["owner"]))
            if value["version"] != 1 or len(self.salt) != 32 or len(self.digest) != 64 or len(self.key) < 48:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise ValueError("Invalid private access-code credentials") from None

    @classmethod
    def load(cls, path: Path) -> "CodeAuth":
        if path.stat().st_mode & 0o077:
            raise ValueError("Access-code credentials must have mode 0600")
        return cls(json.loads(path.read_text(encoding="utf-8")))

    @classmethod
    def provision(cls, path: Path) -> str:
        """Create once. Return the code only to the private local setup caller."""
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        code = "-".join(secrets.token_hex(3) for _ in range(4))
        salt = secrets.token_bytes(32)
        value = {"version": 1, "salt": salt.hex(), "digest": cls._hash(code, salt).hex(),
                 "signingKey": secrets.token_urlsafe(48), "owner": str(uuid.uuid4())}
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            json.dump(value, output)
        return code

    @staticmethod
    def _hash(code: str, salt: bytes) -> bytes:
        return hashlib.scrypt(code.strip().encode(), salt=salt, n=16384, r=8, p=1, dklen=64)

    def login(self, code: str) -> dict:
        if not isinstance(code, str) or not 1 <= len(code) <= 200 or not hmac.compare_digest(self._hash(code, self.salt), self.digest):
            raise RequestError("접속 코드가 올바르지 않습니다.")
        now = int(time.time())
        expires = now + self.SESSION_SECONDS
        claims = {"iss": self.ISSUER, "aud": self.AUDIENCE, "sub": self.owner,
                  "iat": now, "exp": expires, "role": "evan_code"}
        return {"accessToken": jwt.encode(claims, self.key, algorithm="HS256"),
                "expiresAt": expires, "owner": self.owner}

    def verify(self, token: str) -> str:
        try:
            if len(token) > 8192:
                raise ValueError()
            claims = jwt.decode(token, self.key, algorithms=["HS256"], issuer=self.ISSUER,
                                audience=self.AUDIENCE, options={"require": ["exp", "iat", "sub", "iss", "aud", "role"]})
            if claims["sub"] != self.owner or claims["role"] != "evan_code":
                raise ValueError()
            return self.owner
        except (jwt.PyJWTError, ValueError, KeyError, TypeError):
            raise RequestError("접속이 만료됐습니다. 접속 코드를 다시 입력해주세요.") from None

    def client_key(self, address: str) -> str:
        # Avoid persisting raw IP addresses in the quota database.
        return hmac.new(self.key.encode(), address.encode(), hashlib.sha256).hexdigest()
