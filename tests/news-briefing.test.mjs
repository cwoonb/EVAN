import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const compiledModules = new Map();

function compiledSource(path) {
  if (!compiledModules.has(path)) {
    const result = ts.transpileModule(readFileSync(path, "utf8"), {
      fileName: path,
      reportDiagnostics: true,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    });
    assert.equal(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0);
    compiledModules.set(path, result.outputText);
  }
  return compiledModules.get(path);
}

/** Execute the real TSX and local helpers; only the feed hook, Next link and image are replaced. */
function renderBriefing(issues) {
  const modules = new Map();
  const feed = {
    version: 1,
    revision: "test-fixture",
    generatedAt: "2026-10-23T10:00:00Z",
    latestPublishedAt: issues[0]?.updatedAt || null,
    stats: { inputRows: issues.length, articles: issues.reduce((total, item) => total + item.sources.length, 0), issues: issues.length, duplicates: 0, skipped: 0 },
    issues,
  };
  const before = JSON.stringify(feed);
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const loadedModule = { exports: {} };
    modules.set(path, loadedModule);
    function importModule(name) {
      if (name === "next/link") return function TestLink({ href, children, ...props }) {
        assert.equal(typeof href, "string");
        return React.createElement("a", { ...props, href }, children);
      };
      if (name === "@/components/NewsImage") return function TestImage({ news, className }) {
        return React.createElement("span", { className, "data-news-image-id": news.id, "aria-hidden": true });
      };
      // Styles do not affect SSR content assertions; the actual CSS is reviewed separately.
      if (name.endsWith(".css")) return {};
      if (name.startsWith("@/")) {
        const exports = load(resolve(root, `${name.slice(2)}.ts`));
        if (name === "@/lib/news-feed") return { ...exports, useNewsFeed: () => ({ feed, loading: false, error: null, refresh: async () => {} }) };
        return exports;
      }
      return nodeRequire(name);
    }
    const execute = runInThisContext(`(function(require, module, exports) {\n${compiledSource(path)}\n})`, { filename: path });
    execute(importModule, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const NewsSection = load(resolve(root, "components/NewsSection.tsx")).default;
  const html = renderToStaticMarkup(React.createElement(NewsSection));
  assert.equal(JSON.stringify(feed), before, "rendering must preserve the feed and article sources");
  return html;
}

function issue(id, grade = 5, options = {}) {
  const title = `핵심 보도 제목 ${id}`;
  const summary = `원문 ${id}의 평가 조건과 검증 자료가 공개되어 있습니다. 실제 적용 범위와 기술적인 제약을 함께 설명합니다.`;
  const publishedAt = "2026-10-23T01:00:00Z";
  return {
    id: `issue_${id}`,
    title,
    summary,
    importance: grade,
    category: "기술",
    eventType: "출시",
    publishedAt,
    updatedAt: publishedAt,
    keywords: ["검증 자료"],
    searchKeywords: ["AI"],
    newTechnologies: [],
    event: { subject: "보도 대상", action: "공개", object: `제품 ${id}`, version: "", date: "2026-10-23", summary: "" },
    sources: [{ id: `article_${id}`, title: `Original reporting ${id}`, source: "검증 출처", url: `https://example.com/news/${id}`, publishedAt, summary, searchKeywords: [], display: { titleKo: title, event: { subject: "", action: "", object: "" } } }],
    analysis: { status: "ok", summaryMethod: "existing-qwen-extractive-v1", groupingMethod: "verified-event" },
    ...options,
  };
}

function occurrences(text, value) {
  return text.split(value).length - 1;
}

function section(html, id) {
  const opening = new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`).exec(html);
  assert.ok(opening, `missing section ${id}`);
  const tags = /<\/?section\b[^>]*>/g;
  tags.lastIndex = opening.index + opening[0].length;
  let depth = 1;
  let match;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(opening.index, tags.lastIndex);
  }
  assert.fail(`unclosed section ${id}`);
}

function articleLink(html, articleId) {
  const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  const entry = links.find((match) => {
    const href = /\bhref="([^"]*)"/.exec(match[1])?.[1].replace(/&amp;/g, "&");
    return href && new URLSearchParams(href.split("?")[1]).get("article") === articleId;
  });
  assert.ok(entry, `missing article link ${articleId}`);
  return entry[0];
}

test("all six grade-5 reports render their titles and summaries by default without duplicating the lead", () => {
  const issues = Array.from({ length: 6 }, (_, index) => issue(`core-${index + 1}`));
  const html = section(renderBriefing(issues), "briefing-grade-5");
  for (const item of issues) {
    const card = articleLink(html, item.sources[0].id);
    assert.equal(occurrences(html, item.sources[0].display.titleKo), 1, item.id);
    assert.equal(occurrences(card, item.sources[0].summary), 1, item.id);
    assert.match(card, /<p\b[^>]*class="[^"]*\bbriefing-core-summary\b[^"]*"/, "every core summary must use its readable body-text style");
    assert.doesNotMatch(card, /<details\b|\shidden(?:="[^"]*")?(?:\s|>)/, "reading a core summary must not require expanding the card");
  }
});

test("the core section does not borrow lower grades or a previous date's grade-5 report", () => {
  const older = issue("previous-day-five", 5, { updatedAt: "2026-10-22T01:00:00Z", publishedAt: "2026-10-22T01:00:00Z" });
  const major = issue("current-four", 4);
  const update = issue("current-three", 3);
  const rendered = renderBriefing([older, major, update]);
  const core = section(rendered, "briefing-grade-5");
  for (const item of [older, major, update]) assert.equal(core.includes(item.sources[0].display.titleKo), false);
  assert.match(core, /최고중요 뉴스가 없습니다/);
  assert.ok(section(rendered, "briefing-grade-4").includes(major.sources[0].display.titleKo));
  assert.ok(section(rendered, "briefing-grade-3").includes(update.sources[0].display.titleKo));
});

test("missing or title-duplicate summaries produce no invented or empty description paragraphs", () => {
  const missing = issue("missing");
  missing.sources[0].summary = "";
  missing.summary = missing.sources[0].display.titleKo;
  missing.analysis.summaryMethod = "source-title-fallback";
  const repeated = issue("repeated");
  repeated.sources[0].summary = repeated.sources[0].display.titleKo;
  repeated.summary = repeated.sources[0].display.titleKo;
  const core = section(renderBriefing([missing, repeated]), "briefing-grade-5");
  for (const item of [missing, repeated]) {
    const card = articleLink(core, item.sources[0].id);
    assert.equal(occurrences(card, item.sources[0].display.titleKo), 1);
    assert.doesNotMatch(card, /<p\b/, "no summary exists to display");
  }
});

test("an existing extra detail survives after the duplicated headline sentence is removed", () => {
  const item = issue("additional-detail");
  const detail = "공개 저장소에는 평가 조건과 재현 방법이 함께 제공됩니다.";
  item.sources[0].summary = `${item.sources[0].display.titleKo}. ${detail}`;
  const card = articleLink(section(renderBriefing([item]), "briefing-grade-5"), item.sources[0].id);
  assert.equal(occurrences(card, item.sources[0].display.titleKo), 1);
  assert.equal(occurrences(card, detail), 1);
});

test("a single-article core card prefers its actual source analysis over an issue fallback", () => {
  const item = issue("single-source");
  item.summary = "이슈의 대체 설명은 단일 원문 분석을 덮어쓰지 않아야 합니다.";
  const card = articleLink(section(renderBriefing([item]), "briefing-grade-5"), item.sources[0].id);
  assert.equal(occurrences(card, item.sources[0].summary), 1);
  assert.equal(card.includes(item.summary), false);
});

test("a grouped core issue retains its existing integrated summary instead of borrowing another source's summary", () => {
  const item = issue("multiple-sources");
  const integrated = "여러 출처의 분석은 동일한 발표 조건과 남아 있는 검증 과제를 정리합니다.";
  item.summary = integrated;
  item.sources.push({ ...item.sources[0], id: "article_multiple-other", source: "두 번째 출처", url: "https://example.org/other-report", summary: "다른 원문만의 개별 설명입니다." });
  const card = articleLink(section(renderBriefing([item]), "briefing-grade-5"), item.sources[0].id);
  assert.equal(occurrences(card, integrated), 1);
  assert.equal(card.includes(item.sources[0].summary), false);
  assert.equal(card.includes(item.sources[1].summary), false);
});
