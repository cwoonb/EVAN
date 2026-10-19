# Optional Korean news display cache

`build_news_display.py` translates the presentation title and structured event fields with the existing local Qwen vLLM service. It does not modify the collector, LAYA/Qwen article analysis, CSV, event clustering, or public feed generation. The website continues to use its existing article analysis when no matching display cache is available.

## Run a bounded batch

Run from the website checkout:

```sh
python3 scripts/build_news_display.py \
  --csv /absolute/path/to/news_analysis.csv \
  --output .news-sync/display-ko.json \
  --limit 12
```

`--limit` accepts 1–12 requests; the default is 12. Newer articles are considered first. Already valid entries with the same fingerprint do not call the model or rewrite the cache. Running another batch processes the remaining missing or changed entries. A failed translation is retried on a later run, while a successful cached translation is retained.

Generate or check one article with its stable ID:

```sh
python3 scripts/build_news_display.py \
  --csv /absolute/path/to/news_analysis.csv \
  --article article_5e4063b2c7d9ad7b02e6 \
  --limit 1
```

The default output is this checkout's `.news-sync/display-ko.json`, regardless of the working directory. Keep that ignored directory private. Do not commit the cache or CSV to the public repository.

## Model connection

The default endpoint is `http://127.0.0.1:8000/v1`; the default model is `qwen3.8-27b`. Configuration precedence is:

- Endpoint: `--base-url`, `NEWS_DISPLAY_BASE_URL`, `VLLM_BASE_URL`, default.
- Model: `--model`, `NEWS_DISPLAY_MODEL`, `QWEN_MODEL`, default.
- API key: `VLLM_API_KEY`, inherited only by the server process.
- Input: `--csv` or `NEWS_CSV_PATH`.
- Timeout: `--timeout`, default 45 seconds per request, allowed range 1–120 seconds.

The request uses the OpenAI-compatible `/chat/completions` endpoint with temperature zero, JSON output, and Qwen thinking disabled. No browser calls the model. The key is sent only in the authorization header and is not logged or cached.

## Cache and publication contract

```json
{
  "version": 1,
  "articles": {
    "article_00000000000000000000": {
      "fingerprint": "64 lowercase hexadecimal characters",
      "titleKo": "60자 이하의 한국어 제목",
      "event": { "subject": "", "action": "", "object": "" }
    }
  }
}
```

Article IDs use the same canonical URL identity as `article_from_row`. Duplicate rows select the same minimum `representative_key` as the existing builder. The cache imports `display_fingerprint` from `build_news_feed.py`; that fingerprint covers the cleaned original title, summary, event subject, action, and object. Changed source analysis invalidates the old translation for publication.

Only those five original fields enter the model request. Full article `content`, URLs, API keys, local paths, comments, and other analysis columns are not included. The response whitelist accepts only `titleKo` and the three event fields. Absent source event fields remain empty. Titles must contain Korean and fit 60 characters. New numeric claims, malformed output, extra fields, and known ambiguous flavour translation are rejected.

The optional public-feed integration reads this private cache and exports only matching display fields; it does not export fingerprints or the rest of the cache. Display translations remain AI-generated presentation text, not new evidence. Review terminology and meaning when evaluating a new model or prompt. A reviewed correction based on the original article title and collected Korean analysis can replace a cache entry while retaining its unchanged fingerprint. For example, `new flavours` means `새로운 맛`, not `신맛`.

## Failure handling

A nonblocking lock prevents concurrent writers. Each successful entry is written through a private temporary file and atomically replaces the cache. An invalid model response never overwrites the previous successful cache entry. A failed model connection leaves ordinary news publication available.

Runtime CSV, cache, filesystem, or model failures are optional enrichment failures: the script returns zero and prints only a failure class or aggregate counts. Invalid command-line arguments return the normal argument-parser error. Malformed existing cache files are preserved for inspection rather than silently replaced. Logs do not include response bodies, source CSV paths, or credentials.

## Tests

```sh
python3 -m unittest discover -s tests -p 'test_news_display.py' -v
```

The tests cover unchanged-cache reuse, changed fingerprints, failed-response preservation, request limits, stable article selection, duplicate representatives, missing event fields, schema validation, the flavour translation regression, private data boundaries, request timeout configuration, nonfatal runtime failures, and CSV overwrite prevention.

## Automatic refresh on macOS

The normal sync worker automatically reads `<state-dir>/display-ko.json`. Prepare the separate optional translation worker from the same checkout and state directory used by that worker:

```sh
python3 scripts/install_news_sync.py --csv /absolute/path/to/news_analysis.csv --display --install
```

This installs the user LaunchAgent `com.evan.news-display`, running at login and every 300 seconds with at most 12 requests per batch. The existing `com.evan.news-sync` job continues its ordinary 60-second publication checks independently. A failed or busy translation cannot delay news publication. Both workers require the Mac to be awake and the user logged in; previously published news remains available through GitHub Pages.

The worker uses the default local model endpoint and model unless the generated local plist is deliberately configured otherwise. Never put a model API key in the plist or browser environment. See the connection settings above for running a configured batch manually.
