# EVAN private news gateway

The static GitHub Pages site sends authenticated requests to this separately hosted HTTPS API. The gateway reads the existing private analyzer CSV and calls the existing Qwen vLLM. The collector, LAYA, Qwen analysis jobs, and public JSON generator are unchanged. Article bodies remain on the server; responses contain short answers and source metadata only. Reader comments are never included as news evidence.

## Start locally

Use Python 3.10 or newer. From the repository root:

```sh
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt
cp server/.env.example server/.env
```

Set either `AI_CODE_AUTH_FILE` or `SUPABASE_URL`, the existing CSV path, allowed website origins, and the model settings. The managed runner loads the private environment file without executing shell expressions. See [managed Mac service](../docs/ai-service.md) for startup, temporary HTTPS, and endpoint synchronization.

For manual operation, supply the reviewed settings as process environment variables and run `server/.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8787 --no-access-log`.

The verified existing analyzer configuration uses `http://127.0.0.1:8000/v1` and `qwen3.8-27b`. This API never starts or reconfigures the existing model. `GET /healthz` returns `configured` when required settings are present (this is not a model connectivity check), or `setup_required` with HTTP 503 when required settings are absent. No browser calls the local vLLM address.

## Authentication and public hosting

Personal-code mode uses `AI_CODE_AUTH_FILE`, a mode-0600 local credentials file. `CodeAuth.provision(path)` creates a random code once and returns it only to the local setup caller. The server stores its scrypt hash and a separate signing key; the plaintext code belongs in a private user file outside the repository. `POST /v1/auth/session` exchanges the code for an eight-hour signed bearer session. The browser never stores the code; it keeps the session token in this tab's sessionStorage. Per-client and global login quotas limit attempts; raw IP addresses are hashed before quota storage. All code sessions share one owner and chat quota, so creating sessions does not reset limits. Replacing the credential file revokes existing sessions after restarting the gateway. `GET /v1/auth/config` publishes only the configured authentication mode.

Alternatively, use the same Supabase project as the comments system. Configure its asymmetric JWT signing key (ES256 or RS256); legacy Supabase HS256 tokens are deliberately rejected. The gateway resolves only that project's JWKS and verifies the signature, issuer, authenticated audience, expiry, member role, and UUID subject. Anonymous Supabase sessions cannot ask the model. No service-role, JWT signing, or administrator key is required. Code mode takes precedence when configured and does not change comments authentication.

Keep the API listener on loopback. Give it a public HTTPS origin through an authenticated reverse proxy/tunnel on the Mac, or deploy this gateway on a server with private access to the CSV and vLLM. The proxy must forward `Authorization`, enforce a 32 KB body limit and a 100-second request timeout, and avoid logging request/response bodies or tokens. Do not expose port 8000. Restrict network access to vLLM to trusted server processes. Protect the server environment and CSV permissions.

Build the Pages client with `NEXT_PUBLIC_EVAN_API_URL=https://YOUR_API_ORIGIN`. Add the shared Supabase public URL and publishable key only for Supabase mode. A public API origin and Supabase publishable key are discoverable by design; local model addresses and secret keys never enter the client. Allowed CORS origins are origins only, such as `https://cwoonb.github.io`, without `/EVAN/`. The frontend rejects HTTP/non-public API origins.

The gateway runs separately from the Pages workflow. Without a configured HTTPS API origin and either authentication mode, the UI explicitly reports that setup is required. It does not provide simulated answers. When the Mac or model is offline, static news remains readable and AI requests report a connection error. Temporary tunnel URLs change on restart; the managed runner updates the public repository variable and requests a Pages rebuild after endpoint changes.

## Request and retrieval policy

`POST /v1/chat` accepts a verified code-session or Supabase bearer access token and JSON:

```json
{"articleId":"article_<20 hex chars>","issueId":"issue_<20 hex chars>","scope":"article","messages":[{"role":"user","content":"이 뉴스의 핵심은 뭐야?"}]}
```

Scopes are `article`, `issue`, `all`, and `auto`. Global chat sends both `articleId` and `issueId` as `null` and requires `all` or `auto`; partial anchors are rejected. With a valid article anchor, `auto` uses that article first and expands to the related issue for comparison, related-news, or financial-impact questions. Without an anchor, `auto` searches all stored news. The response `scope` reports the scope actually used. Coreferential follow-up searches reuse the previous two user questions, never entity names invented by an earlier AI answer. The server validates the selected article against its own current CSV snapshot. It reuses the public generator's URL IDs and conservative verified event groups; a raw cluster hint or shared company name never merges unrelated events. The issue scope includes that verified event plus earlier articles with at least two non-company anchor terms. The all scope lexically searches the current private corpus. If the CSV only retains recent rows, older news that is no longer present cannot be retrieved; the gateway never claims otherwise. New CSV snapshots replace the in-memory index only after a complete stable read. Failed/partial writes preserve the last valid snapshot.

The gateway reuses existing successful LAYA classification from CSV (`laya_status=ok`, `category`, `event_type`, `important_score`) as labeled context metadata and a search tie-break. It does not load another LAYA instance, generate embeddings, or change the existing MPS/vLLM processes. Qwen summaries, facts, developer impact, and watch points are existing analyzer results, not newly verified primary reporting. LAYA importance is not a financial rating.

Stock questions distinguish reported companies/contracts/products from conditional industry scenarios. A generic use of AI does not establish a supplier relationship or direct stock beneficiary. There is no live market-data or securities database. The model policy forbids inventing ticker symbols, listing status, current prices, targets, or returns. A server-side filter drops unsupported major supplier names, ungrounded instrument/price/listing statements, and guaranteed-benefit claims; the answer discloses these limits. This is a conservative grounding check, not a guarantee that model reasoning or every company reference is correct.

A request has at most 12 alternating messages, 2,000 characters per message, and 10,000 characters overall. The 32 KB streamed body limit also applies when Content-Length is omitted. SQLite atomically enforces rolling member quotas (default 6/minute and 100/day) across process restarts and workers. Two concurrent model calls per process are permitted; run one worker unless the model's capacity and global concurrency limit are separately configured. Proxy-level IP rate limiting is also recommended against unauthenticated floods. CORS is not treated as authentication.

Retrieval uses at most six bounded source excerpts. Article text and chat history are treated as untrusted data. System instructions require Korean answers, separate reporting from AI interpretation, acknowledge missing bodies, and avoid unsupported claims or full-article reproduction. When every result has only a title, the gateway returns an explicit insufficient-evidence message and real source links without calling the model. Structured model output must reference IDs from the selected evidence; unknown source IDs fail closed. Citations and their actual URLs are assembled by the server. These controls do not guarantee perfect model reasoning; readers should inspect the original sources.

No prompt, response, or full body is written to the rate-limit database. It stores member IDs and request timestamps only, purging entries after 24 hours. API responses use `Cache-Control: no-store`. Keep `.env`, `.state`, CSVs, and model files outside version control.

## Verification

```sh
python3 -m unittest discover -s tests -p 'test_news_gateway.py'
server/.venv/bin/python -m unittest discover -s tests -p 'test_news_gateway.py'
```

Core tests run without installing server dependencies. API tests require the gateway requirements and use in-process fake model/JWKS services; they never bypass authentication on a public listener. `tests/test_code_auth.py` verifies code hashing, private permissions, signed sessions, expiry, rotation, origin checks, and persistent login throttling. For a real model smoke test, use the authenticated HTTPS API or call `ask_model` from a local Python process with server-selected evidence. Browser verification uses the configured access code or Supabase login.
