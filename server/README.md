# EVAN private news gateway

The static GitHub Pages site sends authenticated requests to this separately hosted HTTPS API. The gateway reads the existing private analyzer CSV and calls the existing Qwen vLLM. The collector, LAYA, Qwen analysis jobs, and public JSON generator are unchanged. Article bodies remain on the server; responses contain short answers and source metadata only. Reader comments are never included as news evidence.

## Start locally

Use Python 3.10 or newer. From the repository root:

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
cp server/.env.example server/.env
```

Set `SUPABASE_URL`, the existing CSV path, allowed website origins, and the model settings. Load this file only into the gateway process environment. For example, after reviewing the file:

```sh
set -a
source server/.env
set +a
server/.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8787 --no-access-log
```

The verified existing analyzer configuration uses `http://127.0.0.1:8000/v1` and `qwen3.8-27b`. This API never starts or reconfigures the existing model. `GET /healthz` returns `configured` when required settings are present (this is not a model connectivity check), or `setup_required` with HTTP 503 when required settings are absent. No browser calls the local vLLM address.

## Authentication and public hosting

Use the same Supabase project as the comments system. Configure its asymmetric JWT signing key (ES256 or RS256); legacy HS256 tokens are deliberately rejected. The gateway resolves only that project's JWKS and verifies the signature, issuer, authenticated audience, expiry, member role, and UUID subject. Anonymous Supabase sessions cannot ask the model. No service-role, JWT signing, or administrator key is required.

Keep the API listener on loopback. Give it a public HTTPS origin through an authenticated reverse proxy/tunnel on the Mac, or deploy this gateway on a server with private access to the CSV and vLLM. The proxy must forward `Authorization`, enforce a 32 KB body limit and a 100-second request timeout, and avoid logging request/response bodies or tokens. Do not expose port 8000. Restrict network access to vLLM to trusted server processes. Protect the server environment and CSV permissions.

Build the Pages client with `NEXT_PUBLIC_EVAN_API_URL=https://YOUR_API_ORIGIN`, plus the shared Supabase public URL and publishable key. A public API origin and Supabase publishable key are discoverable by design; local model addresses and secret keys never enter the client. Allowed CORS origins are origins only, such as `https://cwoonb.github.io`, without `/EVAN/`. The frontend rejects HTTP/non-public API origins in production.

The gateway is not deployed by the Pages workflow. Without a configured HTTPS API origin and Supabase project, the UI explicitly reports that setup is required. It does not provide simulated answers. When the Mac or model is offline, static news remains readable and AI requests report a connection error.

## Request and retrieval policy

`POST /v1/chat` accepts a Supabase bearer access token and JSON:

```json
{"articleId":"article_<20 hex chars>","issueId":"issue_<20 hex chars>","scope":"article","messages":[{"role":"user","content":"이 뉴스의 핵심은 뭐야?"}]}
```

Scopes are `article`, `issue`, and `all`. The server validates the selected article against its own current CSV snapshot. It reuses the public generator's URL IDs and conservative verified event groups; a raw cluster hint or shared company name never merges unrelated events. The issue scope includes that verified event plus earlier articles with at least two non-company anchor terms. The all scope lexically searches the current private corpus. If the CSV only retains recent rows, older news that is no longer present cannot be retrieved; the gateway never claims otherwise. New CSV snapshots replace the in-memory index only after a complete stable read. Failed/partial writes preserve the last valid snapshot.

A request has at most 12 alternating messages, 2,000 characters per message, and 10,000 characters overall. The 32 KB streamed body limit also applies when Content-Length is omitted. SQLite atomically enforces rolling member quotas (default 6/minute and 100/day) across process restarts and workers. Two concurrent model calls per process are permitted; run one worker unless the model's capacity and global concurrency limit are separately configured. Proxy-level IP rate limiting is also recommended against unauthenticated floods. CORS is not treated as authentication.

Retrieval uses at most six bounded source excerpts. Article text and chat history are treated as untrusted data. System instructions require Korean answers, separate reporting from AI interpretation, acknowledge missing bodies, and avoid unsupported claims or full-article reproduction. When every result has only a title, the gateway returns an explicit insufficient-evidence message and real source links without calling the model. Structured model output must reference IDs from the selected evidence; unknown source IDs fail closed. Citations and their actual URLs are assembled by the server. These controls do not guarantee perfect model reasoning; readers should inspect the original sources.

No prompt, response, or full body is written to the rate-limit database. It stores member IDs and request timestamps only, purging entries after 24 hours. API responses use `Cache-Control: no-store`. Keep `.env`, `.state`, CSVs, and model files outside version control.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_news_gateway.py'
server/.venv/bin/python -m unittest discover -s tests -p 'test_news_gateway.py'
```

Core tests run without installing server dependencies. API tests require the gateway requirements and use in-process fake model/JWKS services; they never bypass authentication on a public listener. For a real model smoke test, call `ask_model` directly from a local Python process with a server-selected article. Real end-to-end browser login additionally requires the configured Supabase project and public HTTPS gateway.
