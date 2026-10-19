#!/usr/bin/env python3
"""Build a public, deterministic news feed from existing analyzer CSV output.

No analyzer modules, raw article content, model weights, or credentials are loaded.
The grouping is conservative structured evidence matching, not a new LLM analysis.
"""

from __future__ import annotations

import argparse
import ast
import csv
from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
from difflib import SequenceMatcher
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

IMPORTANCE = {"일반": 1, "관심": 2, "중요": 3, "매우중요": 4, "최고중요": 5}
EMPTY_VALUES = {"", "nan", "none", "null", "nat", "<na>"}
TRACKING_KEYS = {
    "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid",
    "_ga", "_gl", "ref_src", "ref_url", "srsltid", "mkt_tok",
}
SECRET_QUERY_KEYS = {
    "token", "access_token", "api_key", "apikey", "key", "secret", "signature",
    "sig", "auth", "authorization", "password", "session", "sessionid",
}
PRIVATE_TEXT = re.compile(
    r"(?:/Users/|/home/|/private/var/|/var/folders/)[^\s\"'<>]+"
    r"|[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s\"'<>]+"
    r"|\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b"
    r"|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
)
STOP_WORDS = {
    "ai", "llm", "the", "a", "an", "and", "or", "to", "of", "in", "on", "for",
    "with", "from", "by", "at", "its", "new", "as", "is", "has", "it", "that",
    "모델", "기술", "서비스", "제품", "발표", "공개", "출시", "관련", "기반", "대한",
    "새로운", "및", "등", "위한", "통한", "통해", "위해", "하는", "개발", "기능",
    "인공지능", "artificial", "intelligence", "research", "technology", "company",
    "platform", "startup", "시장", "업계", "연구", "전략", "회사",
}
TARGET_CONFLICTS = (
    {"consumer", "enterprise"}, {"무료", "유료"}, {"iphone", "android"},
    {"ios", "android"}, {"인수", "매각"}, {"인상", "인하"},
)
GROUPING_METHOD = "structured-event-complete-link-v1"


def clean_text(value: object, limit: int = 1600) -> str:
    if value is None or isinstance(value, (list, dict, tuple, set)):
        return ""
    if isinstance(value, float) and not math.isfinite(value):
        return ""
    text = unicodedata.normalize("NFKC", str(value)).strip()
    if text.casefold() in EMPTY_VALUES:
        return ""
    text = PRIVATE_TEXT.sub("[비공개 정보 제거]", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    return re.sub(r"\s+", " ", text)[:limit]


def normalize(value: str) -> str:
    return re.sub(r"[^\w]+", "", value.casefold(), flags=re.UNICODE)


def parse_list(value: object, limit: int = 80) -> tuple[str, ...]:
    """Accept JSON/Python lists and legacy pipe-separated cells, never eval code."""
    if isinstance(value, (list, tuple)):
        values = value
    else:
        text = clean_text(value, 16000)
        if not text:
            return ()
        if text[:1] in "[{(":
            try:
                parsed = json.loads(text)
            except (ValueError, TypeError):
                try:
                    parsed = ast.literal_eval(text)
                except (ValueError, SyntaxError, TypeError, RecursionError):
                    return ()
            if not isinstance(parsed, (list, tuple)):
                return ()
            values = parsed
        else:
            values = text.split("|")
    # Sorted, normalized de-duplication makes input ordering irrelevant.
    unique: dict[str, str] = {}
    for value in values[:1000]:
        if not isinstance(value, (str, int, float)) or isinstance(value, bool):
            continue
        item = clean_text(value, 100)
        key = item.casefold().strip()
        if key and (key not in unique or item < unique[key]):
            unique[key] = item
    return tuple(unique[key] for key in sorted(unique)[:limit])


def union_values(*values: tuple[str, ...], limit: int = 80) -> tuple[str, ...]:
    return parse_list([item for group in values for item in group], limit=limit)


def analysis_points(value: object, *, fact_objects: bool = False) -> tuple[str, ...]:
    """Publish existing analysis text, never raw evidence quotes or other keys."""
    if isinstance(value, (list, tuple)):
        values = value
    else:
        text = clean_text(value, 16000)
        if not text:
            return ()
        if text[:1] in "[{(":
            try:
                values = json.loads(text)
            except (ValueError, TypeError):
                try:
                    values = ast.literal_eval(text)
                except (ValueError, SyntaxError, TypeError, RecursionError):
                    return ()
        else:
            values = text.split("|")
    if not isinstance(values, (list, tuple)):
        return ()
    result = []
    seen = set()
    for value in values[:40]:
        if fact_objects and isinstance(value, dict):
            value = value.get("text")
        if not isinstance(value, str):
            continue
        text = clean_text(value, 600)
        if text and text.casefold() not in seen:
            result.append(text)
            seen.add(text.casefold())
        if len(result) >= 8:
            break
    return tuple(result)


def typed_keywords(value: object) -> tuple[str, ...]:
    """Flatten only the analyzer's five known keyword classes into public tags."""
    if isinstance(value, dict):
        parsed = value
    else:
        text = clean_text(value, 16000)
        try:
            parsed = json.loads(text)
        except (ValueError, TypeError):
            try:
                parsed = ast.literal_eval(text)
            except (ValueError, SyntaxError, TypeError, RecursionError):
                return ()
    if not isinstance(parsed, dict):
        return ()
    return union_values(*(parse_list(parsed.get(name)) for name in ("company", "model", "product", "technology", "framework")))


def importance_value(label: object, score: object = None) -> int:
    for candidate in (score, label):
        try:
            number = float(str(candidate).strip())
        except (ValueError, TypeError):
            continue
        if math.isfinite(number) and number.is_integer() and 1 <= number <= 5:
            return int(number)
    return IMPORTANCE.get(clean_text(label).replace(" ", ""), 1)


def parse_datetime(value: object) -> datetime | None:
    text = clean_text(value, 100)
    if not text:
        return None
    try:
        result = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def iso_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def event_date(value: object) -> str:
    text = clean_text(value, 100)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return ""
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return ""


def canonical_url(value: object) -> str:
    text = clean_text(value, 4000)
    if not text or re.search(r"[\s<>\\]", text):
        return ""
    try:
        parts = urlsplit(text)
        host = (parts.hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
        if parts.scheme.lower() not in {"http", "https"} or not host:
            return ""
        if parts.username or parts.password or host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            return ""
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            if "." not in host or not re.fullmatch(r"[a-z0-9.-]+", host) or re.fullmatch(r"[\d.]+", host):
                return ""
        port = parts.port
        scheme = parts.scheme.lower()
        authority = f"[{host}]" if ":" in host else host
        if port and not (scheme == "http" and port == 80 or scheme == "https" and port == 443):
            authority += f":{port}"
        query = sorted(
            (key, val) for key, val in parse_qsl(parts.query, keep_blank_values=True)
            if not key.casefold().startswith("utm_")
            and key.casefold() not in TRACKING_KEYS | SECRET_QUERY_KEYS
        )
        return urlunsplit((scheme, authority, parts.path or "/", urlencode(query), ""))
    except (ValueError, UnicodeError):
        return ""


def url_identity(url: str) -> str:
    parts = urlsplit(url)
    host = parts.netloc.removeprefix("www.")
    # HTTP/HTTPS, a leading www, fragments, trackers, and a final slash do not
    # create another article. Functional query arguments remain part of identity.
    return urlunsplit(("", host, parts.path.rstrip("/") or "/", parts.query, ""))


def stable_id(prefix: str, text: str) -> str:
    return prefix + hashlib.sha256(text.encode("utf-8")).hexdigest()[:20]


def display_fingerprint(row: dict[str, object]) -> str:
    fields = {name: clean_text(row.get(name), limit) for name, limit in (
        ("title", 500), ("summary", 1000), ("event_subject", 250),
        ("event_action", 250), ("event_object", 700))}
    text = json.dumps(fields, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Article:
    id: str
    title: str
    source: str
    url: str
    published: datetime
    summary: str
    importance: int
    category: str
    event_type: str
    keywords: tuple[str, ...]
    search_keywords: tuple[str, ...]
    new_technologies: tuple[str, ...]
    subject: str
    action: str
    object: str
    version: str
    date: str
    event_summary: str
    analysis_status: str
    qwen_status: str
    cluster_ids: tuple[str, ...]
    why_it_matters: str = ""
    developer_impact: str = ""
    key_facts: tuple[str, ...] = ()
    watch_points: tuple[str, ...] = ()
    content_status: str = "unknown"
    display_key: str = ""


def article_from_row(row: dict[str, object]) -> Article | None:
    title = clean_text(row.get("title"), 500)
    url = canonical_url(row.get("article_url"))
    published = parse_datetime(row.get("published"))
    if not title or not url or published is None:
        return None
    cluster = clean_text(row.get("cluster_id"), 100)
    return Article(
        id=stable_id("article_", url_identity(url)), title=title,
        source=clean_text(row.get("source"), 160) or (urlsplit(url).hostname or "출처"),
        url=url, published=published, summary=clean_text(row.get("summary"), 1000),
        importance=importance_value(row.get("important"), row.get("important_score")),
        category=clean_text(row.get("category"), 80) or "기타",
        event_type=clean_text(row.get("event_type"), 80) or "기타",
        keywords=union_values(parse_list(row.get("keywords")), typed_keywords(row.get("keyword_types"))),
        search_keywords=union_values(parse_list(row.get("search_keywords")), parse_list(row.get("search_keyword"))),
        new_technologies=parse_list(row.get("new_technologies")),
        subject=clean_text(row.get("event_subject"), 250),
        action=clean_text(row.get("event_action"), 250),
        object=clean_text(row.get("event_object"), 700),
        version=clean_text(row.get("event_version"), 150),
        date=event_date(row.get("event_date")),
        event_summary=clean_text(row.get("event_summary"), 900),
        analysis_status=clean_text(row.get("analysis_status"), 60) or "unknown",
        qwen_status=clean_text(row.get("qwen_status"), 60) or "unknown",
        cluster_ids=(cluster,) if cluster else (),
        why_it_matters=clean_text(row.get("why_it_matters"), 1200),
        developer_impact=clean_text(row.get("developer_impact"), 1200),
        key_facts=analysis_points(row.get("key_facts"), fact_objects=True),
        watch_points=analysis_points(row.get("watch_points")),
        content_status=clean_text(row.get("content_status"), 60) or "unknown",
        display_key=display_fingerprint(row),
    )


def representative_key(article: Article) -> tuple:
    completeness = sum(bool(getattr(article, field)) for field in ("subject", "action", "object", "version", "date", "event_summary", "summary"))
    tie_breaker = (
        article.source, iso_timestamp(article.published), article.summary,
        article.category, article.event_type, article.subject, article.action,
        article.object, article.version, article.date, article.event_summary,
        article.analysis_status, article.qwen_status, article.keywords,
        article.search_keywords, article.new_technologies, article.cluster_ids,
        article.why_it_matters, article.developer_impact, article.key_facts,
        article.watch_points, article.content_status,
    )
    return (-int(article.qwen_status == "ok"), -completeness, -article.importance, -len(article.summary), article.id, article.url, article.title, tie_breaker)


def deduplicate(articles: list[Article]) -> list[Article]:
    by_url: dict[str, list[Article]] = {}
    for article in articles:
        by_url.setdefault(url_identity(article.url), []).append(article)
    result = []
    for key in sorted(by_url):
        copies = sorted(by_url[key], key=representative_key)
        primary = copies[0]
        result.append(replace(
            primary,
            keywords=union_values(*(item.keywords for item in copies)),
            search_keywords=union_values(*(item.search_keywords for item in copies)),
            new_technologies=union_values(*(item.new_technologies for item in copies)),
            cluster_ids=tuple(sorted({cluster for item in copies for cluster in item.cluster_ids})),
        ))
    return sorted(result, key=lambda article: (article.published, article.id))


def subject_key(value: str) -> str:
    text = re.sub(r"\b(?:incorporated|inc|corporation|corp|ltd)\.?\b", "", value.casefold())
    return normalize(text)


def action_key(value: str) -> str:
    text = value.casefold()
    # Negation, intention, delay, reversal, and reporting are not an executed
    # release/investment. Compound actions must have the same complete set.
    qualifiers = []
    for name, pattern in (
        ("delayed", r"연기|지연|delay|postpon"),
        ("planned", r"예정|계획|예고|협의|논의|협상|plan|intend|consider|talks"),
        ("denied", r"부인|해명|deni"),
        ("cancelled", r"취소|철회|중단|cancel|halt|withdraw"),
        ("rumored", r"루머|소문|보도|rumou?r|reportedly|alleged"),
    ):
        if re.search(pattern, text):
            qualifiers.append(name)
    actions = []
    for name, pattern in (
        ("release", r"출시|론칭|launch|releas|debut"),
        ("update", r"업데이트|개정|갱신|updat|revis"),
        ("investment", r"투자|invest"),
        ("acquisition", r"인수|acqui|merg"),
        ("price-rise", r"가격.{0,4}인상|price.{0,8}(?:rise|increas)"),
        ("price-cut", r"가격.{0,4}인하|price.{0,8}(?:cut|reduc)"),
        ("ban", r"금지|광고 차단|\bban\b"),
        ("buyback", r"자사주.{0,6}매입|buyback|repurchase"),
        ("earnings", r"실적.{0,4}발표|earnings"),
    ):
        if re.search(pattern, text):
            actions.append(name)
    if actions:
        return "+".join(sorted(actions + qualifiers))
    return normalize(value)


def tokens(value: str) -> set[str]:
    result = set()
    for token in re.findall(r"[a-z0-9]+(?:[.+-][a-z0-9]+)*|[가-힣]{2,}", value.casefold()):
        if re.search(r"[가-힣]", token):
            token = re.sub(r"(?:에서|으로|관련|용|의|을|를|과|와)$", "", token)
        if len(token) >= 2 and token not in STOP_WORDS:
            result.add(token)
    return result


def version_key(value: str) -> str:
    text = re.sub(r"(?i)^v(?:ersion)?\s*(?=\d)", "", value.strip())
    return re.sub(r"[^\w.]", "", text.casefold())


def inferred_versions(article: Article) -> set[str]:
    text = f"{article.object} {article.title}".casefold()
    patterns = (
        r"\b(?:gpt|gemini|qwen|deepseek|llama|claude|rtx)[ -]?[a-z]*[ -]?\d+(?:\.\d+)*(?:[ -](?:pro|flash|sol|astra|sonnet|opus|haiku|ultra))?",
        r"\b(?:version|v)\s*\d+(?:\.\d+)+\b",
        r"\b\d+\.\d+(?:\.\d+)+\b",
    )
    return {version_key(match) for pattern in patterns for match in re.findall(pattern, text)}


def similarity(first: set[str], second: set[str]) -> float:
    return len(first & second) / len(first | second) if first and second else 0.0


def title_text(article: Article) -> str:
    title = article.title
    for separator in (" - ", " — ", " – "):
        if separator in title and normalize(title.rsplit(separator, 1)[-1]) == normalize(article.source):
            return title.rsplit(separator, 1)[0]
    return title


def financial_transaction(article: Article) -> str:
    """A portfolio trade headline is not the issuer's background buyback event."""
    text = title_text(article).casefold()
    if not re.search(r"\b(?:shares?|stock|holdings?|position|stake)\b", text):
        return ""
    if not re.search(r"\b(?:sold|purchased|bought|cut|boosted|decreased|increased|acquired)\b", text):
        return ""
    actor = re.search(r"\bby\s+(.+)$", text)
    return normalize(actor.group(1)) if actor else normalize(text)


def object_amounts(article: Article) -> set[str]:
    pattern = r"(?:[$€£]\s*\d[\d,.]*\s*(?:billion|million|bn|m)?|\d[\d,.]*\s*(?:억|만|조|billion|million|percent|%|달러))"
    return {re.sub(r"[\s,]", "", value.casefold()) for value in re.findall(pattern, article.object, re.I)}


def same_event(first: Article, second: Article, window_hours: float = 72) -> bool:
    """Require compatible concrete event fields; keywords never establish a match."""
    if not all((first.subject, second.subject, first.action, second.action, first.object, second.object)):
        return False
    if subject_key(first.subject) != subject_key(second.subject) or action_key(first.action) != action_key(second.action):
        return False
    if abs((first.published - second.published).total_seconds()) > window_hours * 3600:
        return False
    if first.date and second.date and first.date != second.date:
        return False
    if first.version and second.version and version_key(first.version) != version_key(second.version):
        return False
    first_versions, second_versions = inferred_versions(first), inferred_versions(second)
    if first_versions and second_versions and first_versions != second_versions:
        return False
    first_trade, second_trade = financial_transaction(first), financial_transaction(second)
    if (first_trade or second_trade) and first_trade != second_trade:
        return False
    first_amounts, second_amounts = object_amounts(first), object_amounts(second)
    if first_amounts and second_amounts and first_amounts != second_amounts:
        return False
    first_tokens = tokens(first.object) - tokens(first.subject)
    second_tokens = tokens(second.object) - tokens(second.subject)
    if not first_tokens or not second_tokens:
        return False
    for conflict in TARGET_CONFLICTS:
        left, right = first_tokens & conflict, second_tokens & conflict
        if left and right and left != right:
            return False
    if normalize(first.object) == normalize(second.object):
        return True
    shared = first_tokens & second_tokens
    object_score = similarity(first_tokens, second_tokens)
    title_score = similarity(tokens(title_text(first)), tokens(title_text(second)))
    # Near-identical structured objects are sufficient. A weaker object match
    # needs independent title evidence and at least three shared object tokens.
    return (len(shared) >= 2 and object_score >= 0.8) or (
        len(shared) >= 3 and object_score >= 0.45 and title_score >= 0.5
    )


def group_articles(articles: list[Article], window_hours: float = 72) -> list[list[Article]]:
    groups: list[list[Article]] = []
    candidates: dict[tuple[str, str], list[int]] = {}
    for article in sorted(articles, key=lambda item: (item.published, item.id)):
        key = (subject_key(article.subject), action_key(article.action))
        match = None
        for index in candidates.get(key, []):
            # Complete linkage prevents A~B and B~C from hiding an A/C conflict.
            if all(same_event(article, member, window_hours) for member in groups[index]):
                match = index
                break
        if match is None:
            candidates.setdefault(key, []).append(len(groups))
            groups.append([article])
        else:
            groups[match].append(article)
    return groups


def extracted_summary(group: list[Article]) -> tuple[str, str]:
    pieces: list[str] = []
    analysis_origins = set()
    for article in sorted(group, key=representative_key):
        text = article.event_summary or article.summary
        if not text:
            continue
        if any(SequenceMatcher(None, normalize(text), normalize(existing)).ratio() >= 0.76 for existing in pieces):
            continue
        if sum(len(part) for part in pieces) + len(text) > 1100:
            continue
        pieces.append(text.rstrip(" .。") + ".")
        analysis_origins.add("qwen" if article.qwen_status == "ok" else "analysis")
        if len(pieces) == 3:
            break
    if not pieces:
        return title_text(sorted(group, key=representative_key)[0]), "source-title-fallback"
    prefix = "existing-" + (next(iter(analysis_origins)) if len(analysis_origins) == 1 else "mixed-analysis")
    return " ".join(pieces), f"{prefix}-extractive-v1"


def issue_from_group(group: list[Article]) -> dict:
    ordered = sorted(group, key=representative_key)
    primary = ordered[0]
    summary, summary_method = extracted_summary(group)
    clusters: dict[str, int] = {}
    for item in group:
        for cluster in item.cluster_ids:
            clusters[cluster] = clusters.get(cluster, 0) + 1
    verified_hint = any(count > 1 for count in clusters.values())
    statuses = sorted({item.analysis_status for item in group})
    status = statuses[0] if len(statuses) == 1 else "mixed:" + ",".join(statuses)
    return {
        "id": stable_id("issue_", "|".join(sorted(item.id for item in group))),
        "title": (primary.event_summary or title_text(primary)).rstrip(" .。")[:160],
        "summary": summary,
        "importance": max(item.importance for item in group),
        "category": primary.category, "eventType": primary.event_type,
        "publishedAt": iso_timestamp(min(item.published for item in group)),
        "updatedAt": iso_timestamp(max(item.published for item in group)),
        "keywords": list(union_values(*(item.keywords for item in group), limit=40)),
        "searchKeywords": list(union_values(*(item.search_keywords for item in group), limit=40)),
        "newTechnologies": list(union_values(*(item.new_technologies for item in group), limit=40)),
        "event": {
            "subject": primary.subject, "action": primary.action, "object": primary.object,
            "version": primary.version, "date": primary.date, "summary": primary.event_summary,
        },
        "sources": [{
            "id": item.id, "title": item.title, "source": item.source, "url": item.url,
            "publishedAt": iso_timestamp(item.published), "summary": item.summary or item.event_summary,
            "searchKeywords": list(item.search_keywords),
            "importance": item.importance,
            "analysis": {
                "whyItMatters": item.why_it_matters,
                "developerImpact": item.developer_impact,
                "keyFacts": list(item.key_facts),
                "watchPoints": list(item.watch_points),
                "contentStatus": item.content_status,
            },
        } for item in sorted(group, key=lambda item: (item.published, item.id), reverse=True)],
        "analysis": {
            "status": status,
            "summaryMethod": summary_method,
            "groupingMethod": GROUPING_METHOD + ("+verified-cluster-hint" if verified_hint else ""),
        },
    }


def build_feed(rows: list[dict[str, object]], *, window_hours: float = 72, generated_at: datetime | None = None,
               display: dict | None = None) -> dict:
    if not math.isfinite(window_hours) or window_hours <= 0:
        raise ValueError("게시 시간 범위는 0보다 큰 유한한 값이어야 합니다.")
    parsed = [article for row in rows if (article := article_from_row(row)) is not None]
    articles = deduplicate(parsed)
    issues = [issue_from_group(group) for group in group_articles(articles, window_hours)]
    if isinstance(display, dict) and display.get("version") == 1 and isinstance(display.get("articles"), dict):
        fingerprints = {item.id: item.display_key for item in articles}
        for issue in issues:
            for source in issue["sources"]:
                entry = display["articles"].get(source["id"])
                if not isinstance(entry, dict) or entry.get("fingerprint") != fingerprints.get(source["id"]):
                    continue
                title = clean_text(entry.get("titleKo"), 80)
                event = entry.get("event")
                if not title or not re.search(r"[가-힣]", title) or not isinstance(event, dict):
                    continue
                source["display"] = {"titleKo": title, "event": {
                    key: clean_text(event.get(key), 300) for key in ("subject", "action", "object")}}
    issues.sort(key=lambda issue: (-issue["importance"], -parse_datetime(issue["updatedAt"]).timestamp(), issue["id"]))
    payload = {
        "version": 1,
        "latestPublishedAt": iso_timestamp(max(item.published for item in articles)) if articles else None,
        "stats": {
            "inputRows": len(rows), "articles": len(articles), "issues": len(issues),
            "duplicates": len(parsed) - len(articles), "skipped": len(rows) - len(parsed),
        },
        "issues": issues,
    }
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return {
        "version": 1, "revision": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "generatedAt": iso_timestamp(generated_at or datetime.now(timezone.utc)),
        **{key: value for key, value in payload.items() if key != "version"},
    }


def read_csv(path: Path) -> list[dict[str, object]]:
    csv.field_size_limit(8_000_000)
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, strict=True)
        columns = reader.fieldnames or []
        if len(set(columns)) != len(columns):
            raise ValueError("CSV에 중복된 열 이름이 있습니다.")
        if not {"title", "published", "article_url"}.issubset(columns):
            raise ValueError("CSV 필수 열: title, published, article_url")
        rows = list(reader)
        if not rows:
            raise ValueError("CSV에 기사 행이 없습니다.")
        if any(None in row or any(value is None for value in row.values()) for row in rows):
            raise ValueError("CSV 열 개수가 맞지 않습니다. 잘린 파일인지 확인하세요.")
        return rows


def atomic_write(feed: dict, output: Path) -> None:
    encoded = (json.dumps(feed, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".news-feed-", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(encoded)
            destination.flush()
            os.fsync(destination.fileno())
        os.replace(temporary, output)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=os.environ.get("NEWS_CSV_PATH"), help="분석 CSV 경로. 기본: NEWS_CSV_PATH 환경 변수")
    parser.add_argument("--output", type=Path, default=Path("public/data/news.json"))
    parser.add_argument("--display-json", type=Path, default=None, help="선택적 한국어 표시 캐시. 없거나 손상되면 기존 분석을 유지합니다.")
    parser.add_argument("--window-hours", type=float, default=72, help="같은 사건의 최대 게시 시간 차이(기본 72시간)")
    args = parser.parse_args(argv)
    if args.csv is None:
        parser.error("--csv 또는 NEWS_CSV_PATH를 지정하세요.")
    try:
        display = None
        if args.display_json:
            try:
                display = json.loads(args.display_json.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        feed = build_feed(read_csv(Path(args.csv)), window_hours=args.window_hours, display=display)
        if not feed["stats"]["articles"]:
            raise ValueError("게시 가능한 기사가 없습니다. 기존 feed를 유지합니다.")
        atomic_write(feed, args.output)
    except (OSError, ValueError, csv.Error) as error:
        print(f"뉴스 feed 생성 실패: {type(error).__name__}", file=sys.stderr)
        return 1
    print(json.dumps({"revision": feed["revision"], **feed["stats"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
