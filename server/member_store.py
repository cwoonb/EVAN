"""Private persistent member accounts, quotas, comments, and consented reading history.

Only this server accesses the SQLite database. No credential, name, birth date, IP
address, reading history, or moderation report belongs in the public news feed.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, time as daytime, timedelta, timezone
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
import uuid
from zoneinfo import ZoneInfo

from server.news_gateway import RequestError

SEOUL = ZoneInfo("Asia/Seoul")
USERNAME = re.compile(r"[A-Za-z0-9_]{4,24}\Z")
ARTICLE_ID = re.compile(r"article_[a-f0-9]{20}\Z")
PRIVACY_VERSION = "2026-10-24"
PASSWORD_MINIMUM = 6
SCRYPT_N = 1 << 17


class MemberError(RequestError):
    def __init__(self, detail: str, status: int = 400, code: str | None = None,
                 retry_after: int | None = None, quota: dict | None = None):
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code
        self.retry_after, self.quota = retry_after, quota


def iso_timestamp(value: float) -> str:
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class MemberStore:
    SESSION_SECONDS = 8 * 60 * 60
    QUESTION_LIMIT = 10
    HISTORY_DAYS = 90
    COMMENT_LIMIT = 50
    # Bound scrypt's aggregate memory usage even during concurrent public requests.
    _password_slots = threading.BoundedSemaphore(2)

    def __init__(self, path: Path, clock=time.time):
        self.path, self.clock = Path(path), clock
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path.parent.chmod(0o700)
        if self.path.is_symlink():
            raise ValueError("Member database must not be a symlink")
        descriptor = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        os.close(descriptor)
        self.path.chmod(0o600)
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS member_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS members (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_salt BLOB NOT NULL, password_hash BLOB NOT NULL,
                    name TEXT NOT NULL, birth_date TEXT NOT NULL,
                    privacy_version TEXT NOT NULL, privacy_accepted_at REAL NOT NULL,
                    history_consent INTEGER NOT NULL DEFAULT 0,
                    history_consent_at REAL, created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS member_sessions (
                    digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                    created_at REAL NOT NULL, expires_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS member_sessions_user ON member_sessions(user_id);
                CREATE TABLE IF NOT EXISTS member_question_reservations (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                    day TEXT NOT NULL, state TEXT NOT NULL, created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS member_question_day ON member_question_reservations(user_id, day, state);
                CREATE TABLE IF NOT EXISTS member_limits (
                    key TEXT NOT NULL, bucket TEXT NOT NULL, count INTEGER NOT NULL,
                    expires_at REAL NOT NULL, PRIMARY KEY(key, bucket)
                );
                CREATE TABLE IF NOT EXISTS member_history (
                    user_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                    article_id TEXT NOT NULL, viewed_at REAL NOT NULL,
                    PRIMARY KEY(user_id, article_id)
                );
                CREATE TABLE IF NOT EXISTS member_comments (
                    id TEXT PRIMARY KEY, article_id TEXT NOT NULL,
                    parent_id TEXT REFERENCES member_comments(id),
                    user_id TEXT REFERENCES members(id) ON DELETE SET NULL,
                    body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
                    created_at REAL NOT NULL, updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS member_comments_article ON member_comments(article_id, created_at);
                CREATE TABLE IF NOT EXISTS member_reports (
                    comment_id TEXT NOT NULL REFERENCES member_comments(id) ON DELETE CASCADE,
                    user_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
                    reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at REAL NOT NULL,
                    PRIMARY KEY(comment_id, user_id)
                );
            """)
            db.execute("INSERT OR IGNORE INTO member_meta(key,value) VALUES ('ip_salt',?)", (secrets.token_hex(32),))
            self._ip_salt = bytes.fromhex(db.execute("SELECT value FROM member_meta WHERE key='ip_salt'").fetchone()[0])
        self._dummy_salt = secrets.token_bytes(32)
        self._dummy_hash = self._hash(secrets.token_urlsafe(32), self._dummy_salt)

    @contextmanager
    def _connection(self, *, write: bool = False):
        db = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("PRAGMA secure_delete=ON")
            db.execute("PRAGMA busy_timeout=15000")
            if write:
                db.execute("BEGIN IMMEDIATE")
            yield db
            if write:
                db.commit()
        except BaseException:
            if write:
                db.rollback()
            raise
        finally:
            db.close()

    @classmethod
    def _hash(cls, password: str, salt: bytes) -> bytes:
        with cls._password_slots:
            return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N,
                                  r=8, p=1, dklen=64, maxmem=192 * 1024 * 1024)

    def client_key(self, address: str) -> str:
        return hmac.new(self._ip_salt, address.encode("utf-8"), hashlib.sha256).hexdigest()

    def _limit(self, db, key: str, count: int, seconds: int, now: float):
        bucket_start = int(now) // seconds * seconds
        bucket = str(seconds) + ":" + str(bucket_start)
        row = db.execute("SELECT count FROM member_limits WHERE key=? AND bucket=?", (key, bucket)).fetchone()
        if row and row[0] >= count:
            raise MemberError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429,
                              "RATE_LIMITED", max(1, int(bucket_start + seconds - now) + 1))
        db.execute("INSERT INTO member_limits(key,bucket,count,expires_at) VALUES (?,?,1,?) "
                   "ON CONFLICT(key,bucket) DO UPDATE SET count=count+1", (key, bucket, bucket_start + seconds))

    def limit_auth(self, address: str, action: str, username: str = ""):
        if action not in {"signup", "login"}:
            raise ValueError("Invalid authentication action")
        now = self.clock()
        with self._connection(write=True) as db:
            db.execute("DELETE FROM member_limits WHERE expires_at<?", (now - 86400,))
            # HMAC identifiers prevent either raw IPs or attempted usernames appearing in this table.
            ip_key = action + ":ip:" + self.client_key(address)
            self._limit(db, ip_key, 3 if action == "signup" else 10, 3600 if action == "signup" else 60, now)
            self._limit(db, ip_key, 20 if action == "signup" else 100, 86400, now)
            self._limit(db, action + ":global", 30 if action == "signup" else 120, 60, now)
            if action == "login" and username:
                self._limit(db, "login:user:" + self.client_key(username.casefold()), 20, 900, now)

    def _profile(self, row) -> dict:
        today = datetime.fromtimestamp(self.clock(), SEOUL).date()
        born = date.fromisoformat(row["birth_date"])
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        return {"id": row["id"], "username": row["username"], "name": row["name"],
                "birthDate": row["birth_date"], "age": age, "historyConsent": bool(row["history_consent"])}

    @staticmethod
    def _require_user(db, user_id: str):
        row = db.execute("SELECT * FROM members WHERE id=?", (user_id,)).fetchone()
        if row is None:
            raise MemberError("먼저 로그인을 해주세요.", 401, "LOGIN_REQUIRED")
        return row

    def signup(self, payload: dict) -> dict:
        if not isinstance(payload, dict) or set(payload) != {"username", "password", "name", "birthDate", "privacyAccepted", "historyConsent"}:
            raise MemberError("회원가입 입력 항목을 확인해주세요.")
        username, password, name, born = (payload[key] for key in ("username", "password", "name", "birthDate"))
        if not isinstance(username, str) or not USERNAME.fullmatch(username):
            raise MemberError("아이디는 영문·숫자·밑줄 4~24자로 입력해주세요.")
        if not isinstance(password, str) or not PASSWORD_MINIMUM <= len(password) <= 128 or len(password.encode("utf-8")) > 512:
            raise MemberError("비밀번호는 6~128자로 입력해주세요.")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 50 or any(unicodedata.category(ch).startswith("C") for ch in name):
            raise MemberError("이름은 1~50자로 입력해주세요.")
        if payload["privacyAccepted"] is not True or not isinstance(payload["historyConsent"], bool):
            raise MemberError("필수 개인정보 수집·이용 동의를 확인해주세요.")
        try:
            if not isinstance(born, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", born):
                raise ValueError()
            birthday = date.fromisoformat(born)
            today = datetime.fromtimestamp(self.clock(), SEOUL).date()
            age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))
            if not 14 <= age <= 120:
                raise ValueError()
        except ValueError:
            raise MemberError("생년월일을 확인해주세요. 임시 회원가입은 만 14세 이상만 가능합니다.") from None
        salt, now, user_id = secrets.token_bytes(32), self.clock(), str(uuid.uuid4())
        digest = self._hash(password, salt)
        try:
            with self._connection(write=True) as db:
                db.execute("INSERT INTO members VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                           (user_id, username, salt, digest, name.strip(), born, PRIVACY_VERSION,
                            now, int(payload["historyConsent"]), now if payload["historyConsent"] else None, now))
        except sqlite3.IntegrityError:
            raise MemberError("사용할 수 없는 아이디입니다. 다른 아이디를 입력해주세요.", 409) from None
        return self._new_session(user_id)

    def login(self, username, password) -> dict:
        valid = isinstance(username, str) and USERNAME.fullmatch(username) and isinstance(password, str) and 1 <= len(password) <= 128
        with self._connection() as db:
            row = db.execute("SELECT * FROM members WHERE username=? COLLATE NOCASE", (username if isinstance(username, str) else "",)).fetchone()
        salt = row["password_salt"] if row else self._dummy_salt
        expected = row["password_hash"] if row else self._dummy_hash
        actual = self._hash(password if valid else "invalid-password", salt)
        if not hmac.compare_digest(actual, expected) or not row or not valid:
            raise MemberError("아이디 또는 비밀번호를 확인해주세요.", 401, "INVALID_CREDENTIALS")
        return self._new_session(row["id"])

    def _new_session(self, user_id: str) -> dict:
        token, now = secrets.token_urlsafe(48), self.clock()
        with self._connection(write=True) as db:
            row = self._require_user(db, user_id)
            db.execute("DELETE FROM member_sessions WHERE expires_at<=?", (now,))
            db.execute("INSERT INTO member_sessions VALUES (?,?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, now, now + self.SESSION_SECONDS))
            # A member may keep at most ten concurrent sessions; the newest always works.
            db.execute("DELETE FROM member_sessions WHERE user_id=? AND digest NOT IN "
                       "(SELECT digest FROM member_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 10)", (user_id, user_id))
            profile = self._profile(row)
        return {"accessToken": token, "expiresAt": int(now + self.SESSION_SECONDS), "user": profile, "quota": self.quota(user_id)}

    def verify(self, token: str) -> str:
        if not isinstance(token, str) or not 40 <= len(token) <= 128:
            raise MemberError("먼저 로그인을 해주세요.", 401, "LOGIN_REQUIRED")
        with self._connection() as db:
            row = db.execute("SELECT user_id FROM member_sessions WHERE digest=? AND expires_at>?",
                             (hashlib.sha256(token.encode()).hexdigest(), self.clock())).fetchone()
        if row is None:
            raise MemberError("로그인이 만료됐습니다. 다시 로그인해주세요.", 401, "LOGIN_REQUIRED")
        return row[0]

    def me(self, user_id: str) -> dict:
        with self._connection() as db:
            user = self._profile(self._require_user(db, user_id))
        return {"user": user, "quota": self.quota(user_id)}

    def logout(self, token: str):
        with self._connection(write=True) as db:
            db.execute("DELETE FROM member_sessions WHERE digest=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def _day(self, now: float) -> tuple[str, str]:
        today = datetime.fromtimestamp(now, SEOUL).date()
        reset = datetime.combine(today + timedelta(days=1), daytime.min, SEOUL)
        return today.isoformat(), reset.isoformat(timespec="seconds")

    def _quota(self, db, user_id: str, now: float) -> dict:
        day, reset = self._day(now)
        used = db.execute("SELECT COUNT(*) FROM member_question_reservations WHERE user_id=? AND day=? AND (state='success' OR (state='pending' AND created_at>?))", (user_id, day, now - 600)).fetchone()[0]
        return {"limit": self.QUESTION_LIMIT, "used": used, "remaining": max(0, self.QUESTION_LIMIT - used), "resetAt": reset}

    def quota(self, user_id: str) -> dict:
        with self._connection() as db:
            self._require_user(db, user_id)
            return self._quota(db, user_id, self.clock())

    def reserve_question(self, user_id: str) -> str:
        now, reservation = self.clock(), secrets.token_hex(24)
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            # Recover a worker that died before returning any answer (model timeout is 90s).
            db.execute("UPDATE member_question_reservations SET state='refunded' WHERE state='pending' AND created_at<?", (now - 600,))
            db.execute("DELETE FROM member_question_reservations WHERE created_at<?", (now - 8 * 86400,))
            quota = self._quota(db, user_id, now)
            if quota["remaining"] <= 0:
                reset_seconds = datetime.fromisoformat(quota["resetAt"]).timestamp() - now
                raise MemberError("오늘의 AI 질문 10회를 모두 사용했습니다. 한국 시간 자정 이후 다시 이용해주세요.",
                                  429, "DAILY_QUOTA_EXCEEDED", max(1, int(reset_seconds) + 1), quota)
            self._limit(db, "question:" + user_id, 6, 60, now)
            db.execute("INSERT INTO member_question_reservations VALUES (?,?,?,?,?)", (reservation, user_id, self._day(now)[0], "pending", now))
        return reservation

    def finish_question(self, reservation_id: str, success: bool = True) -> dict:
        with self._connection(write=True) as db:
            row = db.execute("SELECT user_id,state FROM member_question_reservations WHERE id=?", (reservation_id,)).fetchone()
            if row is None:
                raise MemberError("질문 처리 정보를 찾지 못했습니다.", 404)
            db.execute("UPDATE member_question_reservations SET state=? WHERE id=? AND state='pending'", ("success" if success else "refunded", reservation_id))
            return self._quota(db, row["user_id"], self.clock())

    def set_privacy(self, user_id: str, history_consent: bool) -> dict:
        if not isinstance(history_consent, bool):
            raise MemberError("열람 기록 동의 값을 확인해주세요.")
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            db.execute("UPDATE members SET history_consent=?,history_consent_at=? WHERE id=?", (int(history_consent), self.clock(), user_id))
            if not history_consent:
                db.execute("DELETE FROM member_history WHERE user_id=?", (user_id,))
        return self.me(user_id)

    def history(self, user_id: str) -> dict:
        now = self.clock()
        with self._connection(write=True) as db:
            user = self._require_user(db, user_id)
            db.execute("DELETE FROM member_history WHERE viewed_at<?", (now - self.HISTORY_DAYS * 86400,))
            rows = db.execute("SELECT article_id,viewed_at FROM member_history WHERE user_id=? ORDER BY viewed_at DESC LIMIT 100", (user_id,)).fetchall() if user["history_consent"] else []
        return {"history": [{"articleId": row[0], "viewedAt": iso_timestamp(row[1])} for row in rows],
                "historyConsent": bool(user["history_consent"]), "retentionDays": self.HISTORY_DAYS}

    def record_history(self, user_id: str, article_id: str) -> dict:
        if not isinstance(article_id, str) or not ARTICLE_ID.fullmatch(article_id):
            raise MemberError("기사 식별자를 확인해주세요.")
        now = self.clock()
        with self._connection(write=True) as db:
            user = self._require_user(db, user_id)
            if not user["history_consent"]:
                return {"ok": True, "recorded": False}
            self._limit(db, "history:" + user_id, 60, 60, now)
            db.execute("DELETE FROM member_history WHERE viewed_at<?", (now - self.HISTORY_DAYS * 86400,))
            db.execute("INSERT INTO member_history VALUES (?,?,?) ON CONFLICT(user_id,article_id) DO UPDATE SET viewed_at=excluded.viewed_at", (user_id, article_id, now))
        return {"ok": True, "recorded": True}

    def clear_history(self, user_id: str):
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            db.execute("DELETE FROM member_history WHERE user_id=?", (user_id,))

    def delete_account(self, user_id: str, password):
        with self._connection() as db:
            user = self._require_user(db, user_id)
        valid = isinstance(password, str) and 1 <= len(password) <= 128
        actual = self._hash(password if valid else "invalid-password", user["password_salt"])
        if not valid or not hmac.compare_digest(actual, user["password_hash"]):
            raise MemberError("비밀번호를 확인해주세요.", 401)
        with self._connection(write=True) as db:
            db.execute("UPDATE member_comments SET body='',status='deleted',updated_at=? WHERE user_id=?", (self.clock(), user_id))
            db.execute("DELETE FROM members WHERE id=?", (user_id,))
            # Remove member-specific throttling identifiers along with the account.
            for prefix in ("question:", "history:", "comment:", "edit:", "report:"):
                db.execute("DELETE FROM member_limits WHERE key=?", (prefix + user_id,))

    @staticmethod
    def _comment_body(value) -> str:
        if not isinstance(value, str) or not 1 <= len(value.strip()) <= 2000:
            raise MemberError("댓글은 1~2,000자로 입력해주세요.")
        value = value.strip()
        if any(unicodedata.category(ch).startswith("C") and ch not in "\n\t" for ch in value):
            raise MemberError("댓글에 사용할 수 없는 문자가 있습니다.")
        if re.search(r"<\s*/?\s*[a-z][^>]*>|javascript\s*:", value, re.I) or len(re.findall(r"https?://", value, re.I)) > 2:
            raise MemberError("HTML 또는 과도한 링크는 댓글에 사용할 수 없습니다.")
        if re.search(r"(.)\1{19,}", value) or re.search(r"(불법\s*도박|카지노\s*가입|대출\s*상담|성인\s*만남)", value):
            raise MemberError("스팸으로 의심되는 내용을 확인해주세요.")
        return value

    @staticmethod
    def _public_comment(row) -> dict:
        active = row["status"] == "active"
        return {"id": row["id"], "articleId": row["article_id"], "parentId": row["parent_id"],
                "authorId": row["user_id"] if active else None,
                "username": row["username"] if active else "", "body": row["body"] if active else "",
                "status": row["status"], "createdAt": iso_timestamp(row["created_at"]), "updatedAt": iso_timestamp(row["updated_at"])}

    def comments(self, article_id: str, offset: int = 0) -> dict:
        if not isinstance(article_id, str) or not ARTICLE_ID.fullmatch(article_id):
            raise MemberError("기사 식별자를 확인해주세요.")
        if isinstance(offset, bool) or not isinstance(offset, int) or not 0 <= offset <= 100000:
            raise MemberError("댓글 페이지를 확인해주세요.")
        with self._connection() as db:
            total = db.execute("SELECT COUNT(*) FROM member_comments WHERE article_id=?", (article_id,)).fetchone()[0]
            rows = db.execute("SELECT c.*, m.username FROM member_comments c LEFT JOIN members m ON c.user_id=m.id WHERE c.article_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?", (article_id, self.COMMENT_LIMIT, offset)).fetchall()
        return {"comments": [self._public_comment(row) for row in rows], "total": total, "offset": offset,
                "limit": self.COMMENT_LIMIT, "hasMore": offset + len(rows) < total}

    def create_comment(self, user_id: str, article_id: str, body, parent_id=None) -> dict:
        body, now, comment_id = self._comment_body(body), self.clock(), str(uuid.uuid4())
        if not isinstance(article_id, str) or not ARTICLE_ID.fullmatch(article_id):
            raise MemberError("기사 식별자를 확인해주세요.")
        if parent_id is not None and (not isinstance(parent_id, str) or len(parent_id) > 64):
            raise MemberError("답글 대상을 확인해주세요.")
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            self._limit(db, "comment:" + user_id, 3, 60, now)
            self._limit(db, "comment:" + user_id, 30, 86400, now)
            if parent_id:
                parent = db.execute("SELECT * FROM member_comments WHERE id=? AND article_id=?", (parent_id, article_id)).fetchone()
                if not parent:
                    raise MemberError("답글 대상을 찾을 수 없습니다.", 404)
                depth = 0
                while parent and parent["parent_id"]:
                    depth += 1
                    if depth >= 3:
                        raise MemberError("답글은 3단계까지 작성할 수 있습니다.")
                    parent = db.execute("SELECT * FROM member_comments WHERE id=?", (parent["parent_id"],)).fetchone()
            if db.execute("SELECT 1 FROM member_comments WHERE user_id=? AND body=? AND created_at>?", (user_id, body, now - 3600)).fetchone():
                raise MemberError("같은 댓글이 이미 등록되어 있습니다.", 409)
            db.execute("INSERT INTO member_comments VALUES (?,?,?,?,?,'active',?,?)", (comment_id, article_id, parent_id, user_id, body, now, now))
            row = db.execute("SELECT c.*,m.username FROM member_comments c LEFT JOIN members m ON c.user_id=m.id WHERE c.id=?", (comment_id,)).fetchone()
            return {"comment": self._public_comment(row)}

    def edit_comment(self, user_id: str, comment_id: str, body) -> dict:
        body, now = self._comment_body(body), self.clock()
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            self._limit(db, "edit:" + user_id, 10, 60, now)
            self._limit(db, "edit:" + user_id, 100, 86400, now)
            row = db.execute("SELECT * FROM member_comments WHERE id=?", (comment_id,)).fetchone()
            if not row:
                raise MemberError("댓글을 찾을 수 없습니다.", 404)
            if row["user_id"] != user_id:
                raise MemberError("본인 댓글만 수정할 수 있습니다.", 403)
            if row["status"] != "active":
                raise MemberError("수정할 수 없는 댓글입니다.", 409)
            db.execute("UPDATE member_comments SET body=?,updated_at=? WHERE id=?", (body, now, comment_id))
            row = db.execute("SELECT c.*,m.username FROM member_comments c LEFT JOIN members m ON c.user_id=m.id WHERE c.id=?", (comment_id,)).fetchone()
            return {"comment": self._public_comment(row)}

    def delete_comment(self, user_id: str, comment_id: str):
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            row = db.execute("SELECT user_id FROM member_comments WHERE id=?", (comment_id,)).fetchone()
            if not row:
                raise MemberError("댓글을 찾을 수 없습니다.", 404)
            if row[0] != user_id:
                raise MemberError("본인 댓글만 삭제할 수 있습니다.", 403)
            db.execute("UPDATE member_comments SET body='',status='deleted',updated_at=? WHERE id=?", (self.clock(), comment_id))

    def report_comment(self, user_id: str, comment_id: str, reason, detail=""):
        if not isinstance(reason, str) or reason not in {"spam", "abuse", "misinformation", "privacy", "other"} or not isinstance(detail, str) or len(detail) > 500:
            raise MemberError("신고 사유를 확인해주세요.")
        now = self.clock()
        with self._connection(write=True) as db:
            self._require_user(db, user_id)
            row = db.execute("SELECT * FROM member_comments WHERE id=?", (comment_id,)).fetchone()
            if not row or row["status"] != "active":
                raise MemberError("신고할 댓글을 찾을 수 없습니다.", 404)
            if row["user_id"] == user_id:
                raise MemberError("본인 댓글은 신고할 수 없습니다.")
            self._limit(db, "report:" + user_id, 10, 86400, now)
            try:
                db.execute("INSERT INTO member_reports VALUES (?,?,?,?,?)", (comment_id, user_id, reason, detail.strip(), now))
            except sqlite3.IntegrityError:
                raise MemberError("이미 신고한 댓글입니다.", 409) from None
            count = db.execute("SELECT COUNT(*) FROM member_reports WHERE comment_id=?", (comment_id,)).fetchone()[0]
            if count >= 3:
                db.execute("UPDATE member_comments SET status='hidden',updated_at=? WHERE id=?", (now, comment_id))

    def prune(self):
        """Run on startup and hourly; no reading history is retained beyond 90 days while online."""
        now = self.clock()
        with self._connection(write=True) as db:
            db.execute("DELETE FROM member_history WHERE viewed_at<?", (now - self.HISTORY_DAYS * 86400,))
            db.execute("DELETE FROM member_sessions WHERE expires_at<=?", (now,))
            db.execute("DELETE FROM member_limits WHERE expires_at<?", (now - 86400,))
            db.execute("DELETE FROM member_question_reservations WHERE created_at<?", (now - 8 * 86400,))
