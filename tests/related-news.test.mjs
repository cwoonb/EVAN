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

test("related article links preserve list conditions through consecutive detail views", () => {
  const first = issue("new event");
  const article = source("article&two");
  const originalArticleUrl = article.url;
  const listHref = "/news?date=2026-10-20&grade=4&q=OpenAI+%26+agents&keyword=GPT-5.2&sort=importance";
  const firstHref = articleHref(first, article, listHref);
  const firstParams = new URLSearchParams(firstHref.split("?")[1]);
  for (const [name, value] of new URLSearchParams(listHref.split("?")[1])) {
    assert.equal(firstParams.get(name), value, name);
  }
  assert.equal(firstParams.get("issue"), "new event");
  assert.equal(firstParams.get("article"), "article&two");
  const next = issue("next event");
  const nextArticle = source("next article");
  const nextParams = new URLSearchParams(articleHref(next, nextArticle, firstHref).split("?")[1]);
  for (const [name, value] of new URLSearchParams(listHref.split("?")[1])) {
    assert.equal(nextParams.get(name), value, name);
  }
  assert.deepEqual(nextParams.getAll("issue"), ["next event"]);
  assert.deepEqual(nextParams.getAll("article"), ["next article"]);
  assert.equal(article.url, originalArticleUrl);
});

test("related navigation retains legacy minimum importance but excludes unrelated parameters", () => {
  const item = issue("event");
  const article = source("article");
  const href = articleHref(item, article, "/news?importance=4&date=2026-10-20&issue=old&article=old&token=private&redirect=https%3A%2F%2Fexample.org#heading");
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("importance"), "4");
  assert.equal(params.get("date"), "2026-10-20");
  assert.equal(params.get("issue"), item.id);
  assert.equal(params.get("article"), article.id);
  assert.equal(params.has("token"), false);
  assert.equal(params.has("redirect"), false);
  assert.equal(href.includes("#"), false);
  assert.ok(href.startsWith("/news?"));
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

test("generic AI phrases do not connect a training report to unrelated security appointments", () => {
  const training = issue("training", ["Agentic AI", "AI Security", "Global Skills Report 2026"]);
  const appointment = issue("appointment", ["Agentic AI", "Identity Security"]);
  const security = issue("security", ["Agentic AI", "AI Security", "Project Perception"]);
  assert.equal(relatedNews([training, appointment, security], { issue: training, source: training.sources[0] }).related.length, 0);
});

test("a multiword event subject alone is not a specific news topic", () => {
  const company = issue("company", ["The Example Company"]);
  company.event.subject = "The Example Company";
  const other = issue("other", ["The Example Company"]);
  other.event.subject = "The Example Company";
  assert.equal(relatedNews([company, other], { issue: company, source: company.sources[0] }).related.length, 0);
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
