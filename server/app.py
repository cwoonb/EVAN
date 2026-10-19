"""Authenticated API gateway. Run behind an HTTPS reverse proxy, never expose vLLM."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import os
from pathlib import Path
import uuid
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jwt import PyJWKClient

from server.news_gateway import (
    MAX_BODY_BYTES, NewsStore, RateLimiter, RequestError,
    model_messages, render_answer, retrieve, validate_request,
)


def integer_setting(name: str, default: int, maximum: int) -> int:
    value = int(os.getenv(name, str(default)))
    if not 1 <= value <= maximum:
        raise ValueError(f"{name} is outside its permitted range")
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    csv_path: Path | None
    allowed_origins: tuple[str, ...]
    model_url: str
    model_name: str
    model_key: str
    state_path: Path
    per_minute: int = 6
    per_day: int = 100

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.csv_path)

    @classmethod
    def from_env(cls) -> "Settings":
        auth_url = os.getenv("SUPABASE_URL", "").rstrip("/")
        if auth_url:
            parsed = urlsplit(auth_url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path:
                raise ValueError("SUPABASE_URL must be an HTTPS project origin")
        origins = tuple(item.strip().rstrip("/") for item in os.getenv("ALLOWED_ORIGINS", "https://cwoonb.github.io").split(",") if item.strip())
        if not origins or any(origin == "*" or urlsplit(origin).scheme not in {"https", "http"} or not urlsplit(origin).netloc or urlsplit(origin).path for origin in origins):
            raise ValueError("ALLOWED_ORIGINS must contain explicit origins")
        model_url = os.getenv("VLLM_BASE_URL", "http://127.0.0.1:8000/v1").rstrip("/")
        parsed_model = urlsplit(model_url)
        if parsed_model.scheme not in {"http", "https"} or not parsed_model.hostname or parsed_model.username or parsed_model.password or parsed_model.query or parsed_model.fragment:
            raise ValueError("VLLM_BASE_URL is invalid")
        csv = os.getenv("NEWS_CSV_PATH", "")
        return cls(auth_url, Path(csv).expanduser().resolve() if csv else None, origins,
                   model_url, os.getenv("QWEN_MODEL", "qwen3.8-27b"), os.getenv("VLLM_API_KEY", ""),
                   Path(os.getenv("RATE_LIMIT_DB", "server/.state/rate-limits.sqlite3")).expanduser().resolve(),
                   integer_setting("CHAT_REQUESTS_PER_MINUTE", 6, 60),
                   integer_setting("CHAT_REQUESTS_PER_DAY", 100, 1_000))


class SupabaseVerifier:
    def __init__(self, project_url: str):
        self.issuer = project_url + "/auth/v1"
        self.keys = PyJWKClient(self.issuer + "/.well-known/jwks.json", cache_keys=True, lifespan=300, timeout=5)

    def verify(self, token: str) -> str:
        try:
            if len(token) > 8_192:
                raise ValueError("Token too long")
            header = jwt.get_unverified_header(token)
            # No shared admin/JWT secret or algorithm selected by the browser.
            if header.get("alg") not in {"ES256", "RS256"}:
                raise ValueError("Asymmetric signing key required")
            key = self.keys.get_signing_key_from_jwt(token)
            claims = jwt.decode(token, key.key, algorithms=["ES256", "RS256"],
                                audience="authenticated", issuer=self.issuer,
                                options={"require": ["exp", "iat", "sub", "aud", "iss"]}, leeway=10)
            if claims.get("role") != "authenticated" or claims.get("is_anonymous") is True:
                raise ValueError("Authenticated member required")
            return str(uuid.UUID(claims["sub"]))
        except (jwt.PyJWTError, ValueError, KeyError, TypeError):
            raise RequestError("로그인이 만료됐거나 유효하지 않습니다. 다시 로그인해주세요.") from None


class BodyLimitMiddleware:
    """Limit streamed bodies as well as declared Content-Length before JSON parsing."""
    def __init__(self, app, maximum: int = MAX_BODY_BYTES):
        self.app, self.maximum = app, maximum

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            await self.app(scope, receive, send)
            return
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.maximum:
                response = JSONResponse({"detail": "요청 크기가 너무 큽니다."}, status_code=413)
                await response(scope, receive, send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def limited_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()
        await self.app(scope, limited_receive, send)


async def ask_model(settings: Settings, request: dict, evidence: list) -> dict:
    headers = {"Authorization": "Bearer " + settings.model_key} if settings.model_key else {}
    async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=5), follow_redirects=False) as client:
        response = await client.post(settings.model_url + "/chat/completions", headers=headers,
                                     json={"model": settings.model_name, "messages": model_messages(request, evidence),
                                           "temperature": 0.15, "max_tokens": 1_800, "stream": False,
                                           "response_format": {"type": "json_object"},
                                           "chat_template_kwargs": {"enable_thinking": False}})
        response.raise_for_status()
        # Bound provider output independently of the model token setting.
        if len(response.content) > 100_000:
            raise RuntimeError("AI 응답 크기가 너무 큽니다.")
        try:
            raw = response.json()["choices"][0]["message"]["content"]
            if not isinstance(raw, str):
                raise ValueError("No text answer")
        except (ValueError, KeyError, IndexError, TypeError):
            raise RuntimeError("AI 응답을 확인하지 못했습니다. 다시 질문해주세요.") from None
    return render_answer(raw, evidence)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(title="EVAN private news API", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins),
                       allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"],
                       expose_headers=["Retry-After"], max_age=600)
    store = NewsStore(settings.csv_path) if settings.csv_path else None
    verifier = SupabaseVerifier(settings.supabase_url) if settings.supabase_url else None
    limiter = RateLimiter(settings.state_path, settings.per_minute, settings.per_day) if settings.configured else None
    slots = asyncio.Semaphore(2)

    @app.middleware("http")
    async def private_response_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/healthz")
    async def health():
        return JSONResponse({"status": "configured" if settings.configured else "setup_required"}, status_code=200 if settings.configured else 503)

    @app.post("/v1/chat")
    async def chat(request: Request):
        if not settings.configured or store is None or verifier is None or limiter is None:
            return JSONResponse({"detail": "AI 서버 설정이 완료되지 않았습니다."}, status_code=503)
        origin = request.headers.get("origin")
        if origin and origin not in settings.allowed_origins:
            return JSONResponse({"detail": "허용되지 않은 사이트입니다."}, status_code=403)
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            return JSONResponse({"detail": "AI 질문은 로그인 후 사용할 수 있습니다."}, status_code=401)
        try:
            user_id = await asyncio.to_thread(verifier.verify, authorization[7:])
        except RequestError as error:
            return JSONResponse({"detail": str(error)}, status_code=401)
        retry_after = await asyncio.to_thread(limiter.consume, user_id)
        if retry_after:
            return JSONResponse({"detail": "질문 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요."}, status_code=429, headers={"Retry-After": str(retry_after)})
        if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
            return JSONResponse({"detail": "JSON 형식으로 요청해주세요."}, status_code=415)
        try:
            payload = validate_request(await request.json())
        except (RequestError, ValueError, UnicodeDecodeError, TypeError):
            return JSONResponse({"detail": "질문 형식이나 길이를 확인해주세요."}, status_code=400)
        acquired = False
        try:
            await asyncio.wait_for(slots.acquire(), timeout=0.1)
            acquired = True
            corpus, revision = await asyncio.to_thread(store.snapshot)
            evidence = retrieve(corpus, payload)
            if not evidence:
                return {"answer": "현재 EVAN 뉴스 데이터에서 질문과 관련된 기사를 찾지 못했습니다. 회사·모델·기술 이름을 구체적으로 입력해주세요.", "sources": [], "scope": payload["scope"], "revision": revision}
            if all(item.kind == "title" for item in evidence):
                return {"answer": "현재 검색된 기사는 본문을 수집하지 못했고 기존 AI 분석도 없습니다. 제목과 출처만 확인할 수 있어 질문의 구체적인 사실을 검증할 수 없습니다. 아래 원문 출처를 확인해주세요.", "sources": [item.public_source(index + 1) for index, item in enumerate(evidence)], "scope": payload["scope"], "revision": revision}
            answer = await ask_model(settings, payload, evidence)
            return {**answer, "scope": payload["scope"], "revision": revision}
        except asyncio.TimeoutError:
            return JSONResponse({"detail": "AI가 다른 질문에 답하고 있습니다. 잠시 후 다시 시도해주세요."}, status_code=503, headers={"Retry-After": "10"})
        except RequestError as error:
            return JSONResponse({"detail": str(error)}, status_code=404)
        except (httpx.HTTPError, OSError):
            return JSONResponse({"detail": "AI 모델에 연결하지 못했습니다. 잠시 후 다시 시도해주세요."}, status_code=502)
        except RuntimeError as error:
            return JSONResponse({"detail": str(error)}, status_code=502)
        finally:
            if acquired:
                slots.release()
    return app


app = create_app()
