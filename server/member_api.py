"""Member and community routes on the existing private gateway, never on Pages."""
import asyncio
import ipaddress
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from server.member_store import MemberStore, MemberError, ARTICLE_ID


def create_member_router(store: MemberStore, article_exists, allowed_origins=()):
    router = APIRouter()

    def token(request):
        value = request.headers.get("authorization", "")
        if not value.startswith("Bearer "):
            raise MemberError("먼저 로그인을 해주세요.", 401, "LOGIN_REQUIRED")
        return value[7:]

    def address(request):
        value = request.client.host if request.client else "unknown"
        if value in {"127.0.0.1", "::1"}:
            try:
                value = str(ipaddress.ip_address(request.headers.get("cf-connecting-ip", value)))
            except ValueError:
                pass
        return value

    async def payload(request, required=(), optional=()):
        if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/json":
            raise MemberError("JSON 형식으로 요청해주세요.", 415)
        try:
            value = await request.json()
        except (ValueError, UnicodeDecodeError):
            raise MemberError("입력 형식을 확인해주세요.") from None
        if not isinstance(value, dict) or not set(required) <= set(value) or set(value) - set(required) - set(optional):
            raise MemberError("입력 항목을 확인해주세요.")
        return value

    async def known_article(value):
        if not isinstance(value, str) or not ARTICLE_ID.fullmatch(value):
            raise MemberError("기사 식별자를 확인해주세요.")
        try:
            exists = await asyncio.to_thread(article_exists, value)
        except RuntimeError:
            raise MemberError("뉴스 데이터를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.", 503) from None
        if not exists:
            raise MemberError("현재 뉴스에서 기사를 찾을 수 없습니다.", 404)

    # Keep all handlers behind one origin check and one safe error boundary.
    def route(path, method="POST", public=False):
        def decorate(handler):
            async def wrapped(request: Request):
                try:
                    origin = request.headers.get("origin")
                    if origin and origin not in allowed_origins:
                        raise MemberError("허용되지 않은 사이트입니다.", 403)
                    user_id = None if public else await asyncio.to_thread(store.verify, token(request))
                    result = await handler(request, user_id)
                    return result if result is not None else {"ok": True}
                except MemberError as error:
                    value = {"detail": error.detail}
                    if error.code:
                        value["code"] = error.code
                    if error.quota is not None:
                        value["quota"] = error.quota
                    return JSONResponse(value, status_code=error.status,
                        headers={"Retry-After": str(error.retry_after)} if error.retry_after else None)
                except (UnicodeError, TypeError, ValueError):
                    return JSONResponse({"detail": "입력 형식이나 문자를 확인해주세요."}, status_code=400)
            router.add_api_route(path, wrapped, methods=[method])
            return handler
        return decorate

    @route("/v1/members/signup", public=True)
    async def signup(request, _):
        await asyncio.to_thread(store.limit_auth, address(request), "signup")
        body = await payload(request, ("username", "password", "name", "birthDate", "privacyAccepted", "historyConsent"))
        return await asyncio.to_thread(store.signup, body)

    @route("/v1/members/login", public=True)
    async def login(request, _):
        body = await payload(request, ("username", "password"))
        username = body["username"] if isinstance(body["username"], str) else ""
        await asyncio.to_thread(store.limit_auth, address(request), "login", username[:24])
        return await asyncio.to_thread(store.login, body["username"], body["password"])

    @route("/v1/members/me", "GET")
    async def me(request, user_id):
        return await asyncio.to_thread(store.me, user_id)

    @route("/v1/members/logout")
    async def logout(request, _):
        await payload(request)
        await asyncio.to_thread(store.logout, token(request))

    @route("/v1/members/privacy")
    async def privacy(request, user_id):
        body = await payload(request, ("historyConsent",))
        return await asyncio.to_thread(store.set_privacy, user_id, body["historyConsent"])

    @route("/v1/members/history", "GET")
    async def history(request, user_id):
        return await asyncio.to_thread(store.history, user_id)

    @route("/v1/members/history")
    async def record(request, user_id):
        body = await payload(request, ("articleId",))
        await known_article(body["articleId"])
        return await asyncio.to_thread(store.record_history, user_id, body["articleId"])

    @route("/v1/members/history/clear")
    async def clear(request, user_id):
        await payload(request)
        await asyncio.to_thread(store.clear_history, user_id)

    @route("/v1/members/delete")
    async def delete_account(request, user_id):
        body = await payload(request, ("password",))
        await asyncio.to_thread(store.limit_auth, address(request), "login", user_id)
        await asyncio.to_thread(store.delete_account, user_id, body["password"])

    @route("/v1/comments", "GET", public=True)
    async def comments(request, _):
        article_id = request.query_params.get("articleId", "")
        try:
            offset = int(request.query_params.get("offset", "0"))
        except ValueError:
            raise MemberError("댓글 페이지를 확인해주세요.") from None
        # Already published comments remain readable even after a CSV retention change.
        return await asyncio.to_thread(store.comments, article_id, offset)

    @route("/v1/comments")
    async def create(request, user_id):
        body = await payload(request, ("articleId", "body"), ("parentId",))
        await known_article(body["articleId"])
        return await asyncio.to_thread(store.create_comment, user_id, body["articleId"], body["body"], body.get("parentId"))

    @route("/v1/comments/{comment_id}/edit")
    async def edit(request, user_id):
        body = await payload(request, ("body",))
        return await asyncio.to_thread(store.edit_comment, user_id, request.path_params["comment_id"], body["body"])

    @route("/v1/comments/{comment_id}/delete")
    async def delete(request, user_id):
        await payload(request)
        await asyncio.to_thread(store.delete_comment, user_id, request.path_params["comment_id"])

    @route("/v1/comments/{comment_id}/report")
    async def report(request, user_id):
        body = await payload(request, ("reason",), ("detail",))
        await asyncio.to_thread(store.report_comment, user_id, request.path_params["comment_id"], body["reason"], body.get("detail", ""))

    return router
