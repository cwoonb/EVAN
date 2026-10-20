import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aiApiOrigin,
  conversationKey,
  requestHistory,
  responseAnswer,
} from "../lib/ai-conversation.ts";

const source = {
  id: "article_12345678901234567890",
  title: "Actual article",
  source: "Actual publisher",
  url: "https://example.com/news",
  publishedAt: "2026-10-21T00:00:00Z",
  evidenceKind: "analysis",
  citationNumber: 1,
};
const answer = {
  answer: "기사에 근거한 답변입니다. [1]",
  sources: [source],
  scope: "article",
  revision: "revision",
};

function withApi(value, action) {
  const before = process.env.NEXT_PUBLIC_EVAN_API_URL;
  if (value === undefined) delete process.env.NEXT_PUBLIC_EVAN_API_URL;
  else process.env.NEXT_PUBLIC_EVAN_API_URL = value;
  try {
    return action();
  } finally {
    if (before === undefined) delete process.env.NEXT_PUBLIC_EVAN_API_URL;
    else process.env.NEXT_PUBLIC_EVAN_API_URL = before;
  }
}

test("only public HTTPS gateway origins can enter a static frontend", () => {
  for (const invalid of [
    undefined,
    "",
    "not-a-url",
    "http://api.example.com",
    "https://api.example.com/v1",
    "https://user:secret@api.example.com",
    "https://api.example.com?key=secret",
    "https://api.example.com#secret",
    "http://127.0.0.1:8000",
    "https://localhost",
    "https://localhost.localhost",
    "https://192.168.1.2",
    "https://10.0.0.4",
    "https://172.16.0.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://model.local",
    "https://model.internal",
  ]) {
    assert.equal(withApi(invalid, aiApiOrigin), null, String(invalid));
  }
  assert.equal(
    withApi("https://api.example.com/", aiApiOrigin),
    "https://api.example.com",
  );
  assert.equal(
    withApi("https://temporary.trycloudflare.com", aiApiOrigin),
    "https://temporary.trycloudflare.com",
  );
});

test("article and global conversations use stable separate owner keys", () => {
  const article = { articleId: source.id, issueId: "issue_one" };
  assert.equal(
    conversationKey("user-one", article),
    conversationKey("user-one", { ...article, issueId: "regrouped-issue" }),
  );
  assert.notEqual(
    conversationKey("user-one", article),
    conversationKey("user-two", article),
  );
  assert.notEqual(
    conversationKey("user-one", article),
    conversationKey("user-one", { articleId: null, issueId: null }),
  );
});

test("request history strips citations and limits prior turns without mutating messages", () => {
  const messages = Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: String(index),
    sources: [source],
  }));
  const before = JSON.stringify(messages);
  const result = requestHistory(messages, "새 질문");
  assert.equal(result.length, 9);
  assert.equal(result[0].content, "12");
  assert.deepEqual(result.at(-1), { role: "user", content: "새 질문" });
  assert.ok(result.every((message) => !Object.hasOwn(message, "sources")));
  assert.equal(JSON.stringify(messages), before);
});

test("long history remains within server budget and oversized new input is rejected", () => {
  const messages = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: "가".repeat(12_000),
  }));
  const result = requestHistory(messages, "나".repeat(2_000));
  assert.ok(
    result.reduce((size, message) => size + message.content.length, 0) <=
      10_000,
  );
  assert.ok(result.every((message) => message.content.length <= 2_000));
  assert.equal(result[0].role, "user");
  assert.throws(() => requestHistory([], "가".repeat(2_001)));
});

test("valid citations remain actual source links; zero-evidence answers are allowed", () => {
  assert.deepEqual(responseAnswer(answer), answer);
  assert.deepEqual(
    responseAnswer({
      ...answer,
      answer: "현재 데이터에 관련 근거가 없습니다.",
      sources: [],
    }).sources,
    [],
  );
});

test("unsafe or malformed source URLs and evidence kinds are rejected", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/plain,secret",
    "file:///private/news.csv",
    "http://127.0.0.1/article",
    "http://192.168.1.2/article",
    "http://[::ffff:127.0.0.1]/article",
    "https://user:pass@example.com/article",
  ]) {
    assert.throws(
      () => responseAnswer({ ...answer, sources: [{ ...source, url }] }),
      url,
    );
  }
  for (const change of [
    { evidenceKind: "read-everything" },
    { citationNumber: 0 },
    { citationNumber: "1" },
  ])
    assert.throws(() =>
      responseAnswer({ ...answer, sources: [{ ...source, ...change }] }),
    );
});

test("oversized or structurally invalid model answers do not reach rendering", () => {
  for (const invalid of [
    null,
    {},
    { ...answer, answer: "" },
    { ...answer, answer: "가".repeat(12_001) },
    { ...answer, sources: Array.from({ length: 7 }, () => source) },
    { ...answer, sources: null },
  ])
    assert.throws(() => responseAnswer(invalid));
});

test("conversation content stays in memory and request payload never persists browser storage", async () => {
  const code = await readFile(
    new URL("../lib/ai-conversation.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code),
  );
  assert.ok(code.includes('credentials: "omit"'));
  assert.ok(code.includes("requests.delete(key)"));
  assert.ok(code.includes('controller.abort("timeout")'));
});
