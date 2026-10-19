import test from "node:test";
import assert from "node:assert/strict";
import { articleHref, findArticle, relatedNews } from "../lib/related-news.ts";

function source(id, publishedAt = "2026-10-18T10:00:00Z") {
  return {
    id,
    title: `Article ${id}`,
    source: "Actual publisher",
    url: `https://example.com/${id}`,
    publishedAt,
    summary: "Collected analysis",
    searchKeywords: [],
  };
}
function issue(id, keywords = [], options = {}) {
  return {
    id,
    title: `Issue ${id}`,
    summary: "Collected event summary",
    importance: 3,
    category: "AI",
    eventType: "발표",
    publishedAt: "2026-10-18T10:00:00Z",
    updatedAt: "2026-10-18T10:00:00Z",
    keywords,
    searchKeywords: [],
    newTechnologies: [],
    event: {
      subject: "",
      action: "",
      object: "",
      version: "",
      date: "",
      summary: "",
    },
    analysis: {
      status: "ok",
      summaryMethod: "qwen",
      groupingMethod: "structured-event",
    },
    sources: [source(id)],
    ...options,
  };
}

test("article identity survives issue regrouping and legacy source links", () => {
  const item = issue("new-cluster", [], {
    sources: [source("a"), source("b")],
  });
  assert.equal(findArticle([item], "outdated-cluster", "b")?.source.id, "b");
  assert.equal(findArticle([item], "b")?.source.id, "b");
  assert.equal(findArticle([item], "new-cluster")?.source.id, "a");
  assert.equal(findArticle([item], "new-cluster", "missing"), null);
});

test("detail links preserve both issue and exact article with safe encoding", () => {
  const item = issue("cluster x");
  const article = source("article&one");
  assert.equal(
    articleHref(item, article),
    "/news?issue=cluster+x&article=article%26one",
  );
});

test("only verified cluster members are same event and never duplicate related", () => {
  const item = issue("event", ["OpenAI", "inference", "reasoning"], {
    sources: [source("a"), source("b")],
  });
  const separate = issue("separate", ["OpenAI", "inference", "reasoning"]);
  const result = relatedNews([item, separate], {
    issue: item,
    source: item.sources[0],
  });
  assert.deepEqual(
    result.sameEvent.map(({ source }) => source.id),
    ["b"],
  );
  assert.deepEqual(
    result.related.map(({ source }) => source.id),
    ["separate"],
  );
  assert.equal(result.past.length, 0);
});

test("same company, two company names, or one generic keyword do not establish association", () => {
  const item = issue("a", ["OpenAI", "Google", "AI", "LLM", "reasoning"]);
  const onlyCompany = issue("b", ["OpenAI", "Google", "AI"]);
  const oneKeyword = issue("c", ["OpenAI", "reasoning"]);
  const result = relatedNews([item, onlyCompany, oneKeyword], {
    issue: item,
    source: item.sources[0],
  });
  assert.equal(result.related.length, 0);
  assert.equal(result.past.length, 0);
});

test("a specific technology establishes association but does not merge different events", () => {
  const item = issue("a", ["Apple"], { newTechnologies: ["MLX"] });
  const sharedTechnology = issue("b", ["Meta"], { newTechnologies: ["mlx"] });
  const companyOnlyTechnology = issue("c", [], { newTechnologies: ["Apple"] });
  const result = relatedNews([item, sharedTechnology, companyOnlyTechnology], {
    issue: item,
    source: item.sources[0],
  });
  assert.deepEqual(
    result.related.map(({ source }) => source.id),
    ["b"],
  );
  assert.equal(result.sameEvent.length, 0);
});

test("versioned model overlap is specific; different versions alone do not match", () => {
  const item = issue("a", ["GPT-5.2"], {
    title: "OpenAI releases GPT-5.2 today",
  });
  const sameModel = issue("b", ["GPT-5.2"], {
    title: "How GPT-5.2 supports developers",
  });
  const anotherModel = issue("c", ["GPT-5.3"], { title: "GPT-5.3 launch" });
  const result = relatedNews([item, sameModel, anotherModel], {
    issue: item,
    source: item.sources[0],
  });
  assert.deepEqual(
    result.related.map(({ source }) => source.id),
    ["b"],
  );
});

test("past association uses selected article publication date, not a mutable issue date", () => {
  const item = issue("a", ["inference", "reasoning"], {
    sources: [source("a", "2026-10-18T10:00:00Z")],
  });
  const old = issue("old", ["inference", "reasoning"], {
    updatedAt: "2026-10-18T10:00:00Z",
    sources: [source("old", "2026-10-11T10:00:00Z")],
  });
  const recent = issue("recent", ["inference", "reasoning"], {
    sources: [source("recent", "2026-10-17T10:00:00Z")],
  });
  const result = relatedNews([item, old, recent], {
    issue: item,
    source: item.sources[0],
  });
  assert.deepEqual(
    result.past.map(({ source }) => source.id),
    ["old"],
  );
  assert.deepEqual(
    result.related.map(({ source }) => source.id),
    ["recent"],
  );
});

test("case and punctuation normalize without changing source data", () => {
  const item = issue("a", ["OpenAI", "NIST Curve Seeds"]);
  const related = issue("b", ["NIST curve-seeds"]);
  const before = JSON.stringify([item, related]);
  const result = relatedNews([item, related], {
    issue: item,
    source: item.sources[0],
  });
  assert.equal(result.related.length, 1);
  assert.equal(JSON.stringify([item, related]), before);
});
