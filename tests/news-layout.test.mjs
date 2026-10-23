import test from "node:test";
import assert from "node:assert/strict";
import {
  briefingHref,
  filterBriefingIssues,
  groupNewsByImportance,
  importanceLabel,
  issueDateKey,
  newsDateKey,
  normalizeNewsImportance,
} from "../lib/news-layout.ts";

function issue(id, grade = 3, extra = {}) {
  return {
    id,
    title: `Issue ${id}`,
    summary: "Existing Qwen analysis",
    importance: grade,
    category: "기술",
    eventType: "출시",
    publishedAt: "2026-10-20T10:00:00Z",
    updatedAt: "2026-10-20T10:00:00Z",
    keywords: ["Reasoning"],
    searchKeywords: ["OpenAI"],
    newTechnologies: ["Example SDK"],
    event: { subject: "Example Company", action: "출시", object: "Orion 2", version: "2", date: "2026-10-20", summary: "새 모델 공개" },
    sources: [{ id: `article_${id}`, title: "Actual source title", source: "Actual Publisher", url: `https://example.com/${id}`, publishedAt: "2026-10-20T10:00:00Z", summary: "Source analysis", searchKeywords: [] }],
    analysis: { status: "ok", summaryMethod: "existing-qwen", groupingMethod: "verified-event" },
    ...extra,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("explicit numeric grades and Korean aliases preserve original 1–5 values", () => {
  const examples = new Map([
    [1, 1], [2, 2], [3, 3], [4, 4], [5, 5],
    ["1", 1], [" 2 ", 2], ["3.0", 3], ["04", 4], ["+5", 5],
    ["일반", 1], ["관심", 2], ["중요", 3], ["매우중요", 4], ["매우 중요", 4], ["최고중요", 5], ["최고 중요", 5],
  ]);
  for (const [input, expected] of examples) assert.equal(normalizeNewsImportance(input), expected, String(input));
});

test("unknown grades and 0–100 scores are never rescaled or guessed", () => {
  for (const input of [undefined, null, true, false, {}, [], NaN, Infinity, -Infinity, -1, 0, 6, 10, 20, 40, 60, 80, 99, 100, 2.5, "", " ", "NaN", "null", "80", "100", "3/5", "중요도 5", "최상", "urgent", "critical", "1e0", "0x5", "constructor", "toString", "__proto__"]) {
    assert.equal(normalizeNewsImportance(input), null, String(input));
  }
  assert.equal(importanceLabel(5), "5 · 최고중요");
  assert.equal(importanceLabel("매우 중요"), "4 · 매우중요");
  assert.equal(importanceLabel(3), "3 · 중요");
  assert.equal(importanceLabel(2), "2 · 관심");
  assert.equal(importanceLabel(1), "1 · 일반");
  assert.equal(importanceLabel(80), "미분류");
});

test("KST calendar dates change at 15:00 UTC and explicit offsets remain equivalent", () => {
  assert.equal(newsDateKey("2026-10-20T14:59:59.999Z"), "2026-10-20");
  assert.equal(newsDateKey("2026-10-20T15:00:00Z"), "2026-10-21");
  assert.equal(newsDateKey("2026-10-21T00:00:00+09:00"), "2026-10-21");
  assert.equal(newsDateKey("2026-10-20T08:00:00-07:00"), "2026-10-21");
  assert.equal(newsDateKey("2026-10-20T15:00:00"), "2026-10-21");
  assert.equal(newsDateKey("2026-10-21"), "2026-10-21");
});

test("invalid calendar dates and ambiguous non-ISO input stay invalid", () => {
  for (const input of ["", "not-a-date", "2026-02-29", "2026-02-30T12:00:00Z", "2026-13-01", "2026-10-00", "2026-10-20T24:00:00Z", "2026-10-20T10:60:00Z", "2026-10-20T10:00:60Z", "2026-10-20T10:00:00+24:00", "10/21/2026", "0000-01-01"]) {
    assert.equal(newsDateKey(input), "", input);
  }
  assert.equal(newsDateKey("2024-02-29T15:00:00Z"), "2024-03-01");
});

test("issue day uses latest source time, then first-source time, never synchronization time", () => {
  const item = issue("a", 5, { updatedAt: "2026-10-20T15:00:00Z", publishedAt: "2026-10-18T10:00:00Z", generatedAt: "2026-10-25T10:00:00Z" });
  assert.equal(issueDateKey(item), "2026-10-21");
  assert.equal(issueDateKey({ ...item, updatedAt: "invalid" }), "2026-10-18");
  assert.equal(issueDateKey({ ...item, updatedAt: "", publishedAt: "invalid" }), "");
});

test("date filters use the issue's KST day and exact grades include lower groups", () => {
  const before = issue("before", 5, { updatedAt: "2026-10-20T14:59:59Z" });
  const atMidnight = issue("midnight", 2, { updatedAt: "2026-10-20T15:00:00Z" });
  const later = issue("later", 1, { updatedAt: "2026-10-21T03:00:00Z" });
  const items = [before, atMidnight, later];
  assert.deepEqual(filterBriefingIssues(items, { date: "2026-10-21" }).map((item) => item.id), ["later", "midnight"]);
  assert.deepEqual(filterBriefingIssues(items, { grade: 2 }).map((item) => item.id), ["midnight"]);
  assert.deepEqual(filterBriefingIssues(items, { grade: 1 }).map((item) => item.id), ["later"]);
  assert.equal(filterBriefingIssues(items, { grade: 4 }).length, 0);
  assert.equal(filterBriefingIssues(items, { grade: 100 }).length, 0);
  assert.equal(filterBriefingIssues(items, { date: "2026-02-30" }).length, 0);
  assert.equal(filterBriefingIssues(items, { date: "2026-10-21T00:00:00Z" }).length, 0);
});

test("search matches existing issue, event, tag and real-source fields with AND words", () => {
  const item = issue("a", 4);
  for (const query of ["Issue a", "existing qwen", "기술 출시", "reasoning", "OPENAI", "example sdk", "example company orion", "새 모델", "actual publisher", "actual source title"]) {
    assert.deepEqual(filterBriefingIssues([item], { query }), [item], query);
  }
  assert.equal(filterBriefingIssues([item], { query: "OpenAI missing-word" }).length, 0);
  assert.deepEqual(filterBriefingIssues([item], { keyword: " reasoning " }), [item]);
  assert.deepEqual(filterBriefingIssues([item], { keyword: "openai" }), [item]);
  assert.deepEqual(filterBriefingIssues([item], { keyword: "EXAMPLE SDK" }), [item]);
  assert.equal(filterBriefingIssues([item], { keyword: "reason" }).length, 0);
  assert.equal(filterBriefingIssues([item], { keyword: "actual publisher" }).length, 0);
});

test("stored Korean display titles are searchable without dropping original-source fields", () => {
  const item = issue("translated", 4);
  item.sources[0].display = { titleKo: "양자나침반 전용탐색문구", event: { subject: "", action: "", object: "" } };
  item.sources.push({ ...item.sources[0], id: "article_second", title: "Different original heading", display: { titleKo: "보조기사 연결추적문구", event: { subject: "", action: "", object: "" } } });
  const before = JSON.stringify(item);
  deepFreeze(item);
  for (const query of ["양자나침반", "보조기사 연결추적문구", "양자나침반 actual publisher", "different original heading", "actual source title", "existing qwen"]) {
    assert.deepEqual(filterBriefingIssues([item], { query }), [item], query);
  }
  assert.equal(JSON.stringify(item), before);
});

test("same-grade order uses latest time, published fallback and stable ID", () => {
  const items = [
    issue("z", 5, { updatedAt: "invalid", publishedAt: "2026-10-20T11:00:00Z" }),
    issue("b", 5, { updatedAt: "2026-10-20T10:00:00Z" }),
    issue("a", 5, { updatedAt: "2026-10-20T10:00:00Z" }),
    issue("bad", 5, { updatedAt: "invalid", publishedAt: "invalid" }),
    issue("low", 1, { updatedAt: "2026-10-22T10:00:00Z" }),
  ];
  assert.deepEqual(filterBriefingIssues(items, { sort: "latest" }).map((item) => item.id), ["low", "z", "a", "b", "bad"]);
  assert.deepEqual(filterBriefingIssues(items, { sort: "importance" }).map((item) => item.id), ["z", "a", "b", "bad", "low"]);
});

test("an empty grade-5 day never borrows lower grades or another date's lead", () => {
  const earlierLead = issue("earlier-five", 5, { updatedAt: "2026-10-20T14:59:59Z" });
  const major = issue("today-four", 4, { updatedAt: "2026-10-20T15:00:00Z" });
  const update = issue("today-three", 3, { updatedAt: "2026-10-21T01:00:00Z" });
  const minor = issue("today-two", 2, { updatedAt: "2026-10-21T02:00:00Z" });
  const grouped = groupNewsByImportance(filterBriefingIssues([earlierLead, major, update, minor], { date: "2026-10-21", sort: "importance" }));
  assert.deepEqual(grouped[5], []);
  assert.deepEqual(grouped[4], [major]);
  assert.deepEqual(grouped[3], [update]);
  assert.deepEqual(grouped[2], [minor]);
  assert.equal(major.importance, 4);
  assert.equal(update.importance, 3);
});

test("every grade-5 issue survives grouping without a six-card limit or company merge", () => {
  const items = Array.from({ length: 19 }, (_, index) => issue(`event-${index}`, 5, { title: "Same company announces something", event: { subject: "Same Company", action: "출시", object: `Different product ${index}`, version: "", date: "", summary: "" } }));
  const grouped = groupNewsByImportance(filterBriefingIssues(items));
  assert.equal(grouped[5].length, 19);
  assert.equal(new Set(grouped[5].map((item) => item.id)).size, 19);
  assert.equal(grouped[4].length, 0);
  assert.equal(grouped.unclassified.length, 0);
});

test("buckets preserve grades and deduplicate only matching issue IDs", () => {
  const first = issue("duplicate", 5);
  const sharedSource = issue("separate-event", 4, { title: first.title, sources: first.sources });
  const items = [first, issue("duplicate", 1), sharedSource, issue("three", "3"), issue("two", 2), issue("one", 1), issue("unknown", 80), issue("none", null)];
  const grouped = groupNewsByImportance(items);
  assert.deepEqual(grouped[5], [first]);
  assert.deepEqual(grouped[4], [sharedSource]);
  assert.equal(grouped[3][0].id, "three");
  assert.equal(grouped[2][0].id, "two");
  assert.equal(grouped[1][0].id, "one");
  assert.deepEqual(grouped.unclassified.map((item) => item.id), ["unknown", "none"]);
});

test("filters precede grouping and never mutate issues, source lists or related article IDs", () => {
  const selected = issue("selected", 4, { updatedAt: "2026-10-20T15:00:00Z", relatedIds: ["article_related_1", "article_related_2"] });
  const items = deepFreeze([selected, issue("other", 5)]);
  const before = JSON.stringify(items);
  const filtered = filterBriefingIssues(items, { date: "2026-10-21", query: "OpenAI", keyword: "reasoning", grade: 4 });
  const grouped = groupNewsByImportance(filtered);
  assert.equal(grouped[4][0], selected);
  assert.equal(grouped[4][0].sources, selected.sources);
  assert.equal(grouped[4][0].sources[0].id, "article_selected");
  assert.equal(grouped[4][0].relatedIds, selected.relatedIds);
  assert.equal(JSON.stringify(items), before);
  assert.notEqual(filtered, items);
});

test("briefing URLs retain exact grade and filter state with safe encoding", () => {
  assert.equal(briefingHref(), "/news");
  assert.equal(briefingHref({ grade: 4, date: "2026-10-21", query: " OpenAI & agents ", keyword: " GPT-5.2 ", sort: "importance" }), "/news?grade=4&date=2026-10-21&q=OpenAI+%26+agents&keyword=GPT-5.2&sort=importance");
  assert.equal(briefingHref({ grade: 2, sort: "latest" }), "/news?grade=2");
  assert.equal(briefingHref({ grade: 100, date: "2026-02-30", query: " " }), "/news");
});
