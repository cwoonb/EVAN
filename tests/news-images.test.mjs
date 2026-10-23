import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assetPath } from "../lib/asset-path.ts";
import {
  NEWS_IMAGE_DIRECTORY, NEWS_IMAGE_MAPPING_VERSION, DEFAULT_NEWS_IMAGE, categoryImageManifest,
  approvedArticleImagePolicy, registeredLocalArticleImages, normalizeCategory, newsImageIdentity,
  resolveNewsImage, nextNewsImage, approvedArticleImage, isPublicImageUrl,
  failedNewsImages, rememberNewsImageFailure, subscribeNewsImageFailures, newsImageFailureRevision,
} from "../lib/news-images.ts";

const article = { id: "article_0123456789abcdef0123", title: "실제 데이터의 기술 기사", category: "기술", publishedAt: "2026-10-21T09:00:00Z", url: "https://publisher.example.com/news/one" };
const permittedImage = "https://images.example.com/owned-photo.webp";
const approval = { url: permittedImage, rightsNote: "Publisher explicitly permitted this exact image for this test fixture.", approvedAt: "2026-10-21T09:00:00Z" };
const policy = { approvedImages: [approval] };

test("all seven categories have three unique final local files, plus one shared image", async () => {
  assert.equal(Object.keys(categoryImageManifest).length, 7);
  const files = [...Object.values(categoryImageManifest).flat().map((name) => NEWS_IMAGE_DIRECTORY + name), DEFAULT_NEWS_IMAGE];
  assert.equal(files.length, 22);
  assert.equal(new Set(files).size, 22);
  let totalBytes = 0;
  for (const path of files) {
    const data = await readFile(new URL(`../public${path}`, import.meta.url));
    assert.equal(data.toString("ascii", 0, 4), "RIFF");
    assert.equal(data.toString("ascii", 8, 12), "WEBP");
    assert.ok(data.length < 150 * 1024, `${path} exceeds the thumbnail asset budget`);
    let width, height;
    for (let offset = 12; offset + 8 < data.length;) {
      const kind = data.toString("ascii", offset, offset + 4);
      const size = data.readUInt32LE(offset + 4), start = offset + 8;
      if (kind === "VP8 ") { width = data.readUInt16LE(start + 6) & 0x3fff; height = data.readUInt16LE(start + 8) & 0x3fff; break; }
      if (kind === "VP8X") { width = data.readUIntLE(start + 4, 3) + 1; height = data.readUIntLE(start + 7, 3) + 1; break; }
      if (kind === "VP8L") { const bits = data.readUInt32LE(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; break; }
      offset = start + size + (size % 2);
    }
    assert.deepEqual([width, height], [1200, 675], path);
    totalBytes += data.length;
  }
  for (const path of registeredLocalArticleImages) assert.ok((await stat(new URL(`../public${path}`, import.meta.url))).isFile(), path);
  assert.ok(totalBytes < 1_500_000);
});

test("empty image approval policy never treats a URL as usage permission", () => {
  assert.deepEqual(approvedArticleImagePolicy, []);
  assert.equal(approvedArticleImage(permittedImage), null);
  for (const image of [undefined, null, "", "   ", {}, [permittedImage], 123, permittedImage]) {
    assert.equal(resolveNewsImage({ ...article, image }).kind, "category");
  }
});

test("a reviewed exact public HTTPS URL takes precedence; rights note and date are required", () => {
  assert.equal(resolveNewsImage({ ...article, image: permittedImage }, new Set(), policy).src, permittedImage);
  for (const incomplete of [{ ...approval, rightsNote: "" }, { ...approval, approvedAt: "not-a-date" }]) {
    assert.equal(approvedArticleImage(permittedImage, { approvedImages: [incomplete] }), null);
  }
  assert.equal(approvedArticleImage(permittedImage + "?unreviewed=1", policy), null);
});

test("HTTP, private hosts, user information, secret URLs and unreviewed local paths are rejected", () => {
  for (const url of ["http://images.example.com/a.webp", "https://127.0.0.1/a.webp", "https://10.0.0.2/a.webp", "https://2130706433/a.webp", "https://[::1]/a.webp", "https://localhost/a.webp", "https://a.local/a.webp", "https://a.internal/a.webp", "https://a.internal./a.webp", "https://a.localhost./a.webp", "https://u:p@images.example.com/a.webp", permittedImage + "?token=secret", permittedImage + "?api_key=secret", permittedImage + "#secret", "data:image/png;base64,abc", "javascript:alert(1)"]) {
    assert.equal(isPublicImageUrl(url), false, url);
    assert.equal(approvedArticleImage(url, { approvedImages: [{ ...approval, url }] }), null, url);
  }
  assert.equal(approvedArticleImage("/images/nonexistent.webp", { approvedImages: [{ ...approval, url: "/images/nonexistent.webp" }] }), null);
  const registered = DEFAULT_NEWS_IMAGE;
  assert.equal(approvedArticleImage(registered, { approvedImages: [{ ...approval, url: registered }], localArticlePaths: [registered] }), registered);
});

test("only explicit category aliases map; missing, unknown and prototype keys use neutral other", () => {
  for (const [input, expected] of [["기술", "technology"], [" Tech ", "technology"], ["제품", "product"], ["business", "business"], ["시장", "market"], ["정책", "policy"], ["보안", "security"], ["기타", "other"]]) assert.equal(normalizeCategory(input), expected);
  for (const input of [null, undefined, "", "기업전략", "NVIDIA", "__proto__", "constructor", "toString", "valueOf", {}]) assert.equal(normalizeCategory(input), "other");
});

test("company names, event types and keywords do not choose category art", () => {
  const product = { ...article, category: "제품" };
  const reference = resolveNewsImage(product).src;
  assert.equal(resolveNewsImage({ ...product, title: "NVIDIA security policy", keywords: ["보안"], eventType: "market", company: "Apple" }).src, reference);
});

test("403/404/network failures advance actual image, category, default, CSS without a loop", () => {
  const news = { ...article, image: permittedImage }, failures = new Set();
  let current = resolveNewsImage(news, failures, policy);
  assert.equal(current.kind, "article");
  current = nextNewsImage(news, current, failures, policy); // external 403
  assert.equal(current.kind, "category");
  current = nextNewsImage(news, current, failures, policy); // local 404
  assert.deepEqual([current.kind, current.src], ["default", DEFAULT_NEWS_IMAGE]);
  current = nextNewsImage(news, current, failures, policy); // network failure
  assert.deepEqual([current.kind, current.src], ["css", null]);
  for (let index = 0; index < 10; index += 1) current = nextNewsImage(news, current, failures, policy);
  assert.equal(current.kind, "css");
  assert.equal(failures.size, 3);
  assert.equal(news.title, article.title);
  assert.equal(news.url, article.url);
});

test("known failures are skipped at first render, including missing category and common files", () => {
  const initial = resolveNewsImage(article), failedCategory = new Set([initial.src]);
  assert.equal(resolveNewsImage(article, failedCategory).kind, "default");
  failedCategory.add(DEFAULT_NEWS_IMAGE);
  assert.equal(resolveNewsImage(article, failedCategory).kind, "css");
});

test("article IDs are stable across keyword contexts, sorting, filtering and added articles", () => {
  const items = Array.from({ length: 30 }, (_, number) => ({ ...article, id: `article_${String(number).padStart(20, "0")}` }));
  const original = new Map(items.map((item) => [item.id, resolveNewsImage(item).src]));
  assert.equal(new Set(original.values()).size, 3);
  const changed = [{ ...article, id: "new-article" }, ...items.slice().reverse()];
  for (const item of changed.filter((item) => original.has(item.id))) {
    assert.equal(resolveNewsImage({ ...item, searchKeywords: ["different filter"], keywords: ["another topic"] }).src, original.get(item.id));
  }
});

test("identity prefers stable ID, then canonical source URL, then stable title and publication", () => {
  assert.equal(newsImageIdentity({ ...article, title: "changed display title", url: "https://different.example.com" }), newsImageIdentity(article));
  const a = { url: "https://publisher.example.com/a?b=2&a=1#section", title: "one" };
  const b = { url: "https://publisher.example.com/a?a=1&b=2", title: "two" };
  assert.equal(newsImageIdentity(a), newsImageIdentity(b));
  assert.equal(newsImageIdentity({ title: "  같은   기사  ", publishedAt: article.publishedAt }), newsImageIdentity({ title: "같은 기사", publishedAt: article.publishedAt }));
});

test("fresh module loads choose the same fixed mapping version and artwork", async () => {
  const fresh = await import("../lib/news-images.ts?news-images-reload-test");
  assert.equal(fresh.NEWS_IMAGE_MAPPING_VERSION, NEWS_IMAGE_MAPPING_VERSION);
  assert.deepEqual(fresh.resolveNewsImage(article), resolveNewsImage(article));
});

test("shared failure memory notifies once and avoids repeated failing sources across cards", () => {
  const key = "https://images.example.com/shared-failure-test.webp";
  let notices = 0;
  const unsubscribe = subscribeNewsImageFailures(() => { notices += 1; });
  const initialRevision = newsImageFailureRevision();
  rememberNewsImageFailure(key); rememberNewsImageFailure(key);
  unsubscribe();
  assert.equal(notices, 1);
  assert.equal(newsImageFailureRevision(), initialRevision + 1);
  assert.equal(failedNewsImages().has(key), true);
  assert.equal(resolveNewsImage({ ...article, image: key }, failedNewsImages(), { approvedImages: [{ ...approval, url: key }] }).kind, "category");
});

test("server and client deployments use the same assetPath under root and /EVAN", () => {
  for (const base of ["", "/EVAN"]) {
    const script = "import {assetPath} from './lib/asset-path.ts'; import {resolveNewsImage} from './lib/news-images.ts'; console.log(assetPath(resolveNewsImage(" + JSON.stringify(article) + ").src))";
    const server = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("..", import.meta.url), env: { ...process.env, NEXT_PUBLIC_BASE_PATH: base }, encoding: "utf8" });
    assert.equal(server.status, 0, server.stderr);
    const previous = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = base;
    try { assert.equal(server.stdout.trim(), assetPath(resolveNewsImage(article).src)); }
    finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH; else process.env.NEXT_PUBLIC_BASE_PATH = previous; }
  }
});

test("component keeps decorative semantics, reserved geometry, static export and only lead preload", async () => {
  const component = await readFile(new URL("../components/NewsImage.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/news/news-image.css", import.meta.url), "utf8");
  assert.match(component, /alt=""/);
  assert.match(component, /assetPath\(image\.src\)/);
  assert.match(component, /preload=\{priority\}/);
  assert.match(component, /loading=\{priority \? undefined : "lazy"\}/);
  assert.match(component, /unoptimized/);
  assert.match(component, /분류 이미지/);
  assert.match(css, /\.news-media\s*\{[^}]*position:\s*relative[^}]*aspect-ratio:\s*16\s*\/\s*9/);
  assert.doesNotMatch(component, /Math\.random\(|Date\.now\(/);
});

test("generation manifest documents every real final asset, prompt and optimized byte size", async () => {
  const manifest = JSON.parse(await readFile(new URL("../docs/news-image-prompts.json", import.meta.url), "utf8"));
  assert.equal(manifest.images.length, 22);
  assert.match(manifest.provider, /Built-in image_gen/);
  assert.ok(manifest.basePrompt.includes("NO text"));
  for (const item of manifest.images) {
    assert.ok(item.subject.length > 20);
    assert.deepEqual([item.width, item.height], [1200, 675]);
    assert.equal((await stat(new URL(`../public${NEWS_IMAGE_DIRECTORY}${item.file}`, import.meta.url))).size, item.bytes);
  }
});
