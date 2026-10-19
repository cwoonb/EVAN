import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { articlePresentation, articleTitle, sourceIntroduction, uniqueSentences } from "../lib/news-presentation.ts";

const source = {
  id: "article_5e4063b2c7d9ad7b02e6", title: "The Italian gelato maker using AI to invent new flavours - BBC",
  source: "BBC", url: "https://www.bbc.com/reel/video/p0pcvxbn/watch", publishedAt: "2026-10-19T09:12:32Z",
  summary: "이탈리아 장인이 AI를 활용해 새로운 젤라토 맛을 개발했다. AI는 예상치 못한 레시피와 맛 조합을 제안한다.", searchKeywords: ["AI"],
  display: { titleKo: "AI로 새로운 젤라토 맛을 개발한 이탈리아 장인", event: { subject: "지안프랑코 삼포", action: "AI를 활용해 새로운 젤라토 맛 개발", object: "젤라토 맛" } },
  analysis: { whyItMatters: "식품 산업의 제품 개발과 창의적 영감에 활용할 수 있음을 보여준다.", developerImpact: "AI 기반 생성형 기술이 식품 레시피 개발 및 맛 조합 최적화에 적용될 수 있는 가능성을 시사한다.", keyFacts: [], watchPoints: [], contentStatus: "success" },
};
const issue = {
  id: "issue_example", title: "기존 한국어 사건 제목", summary: "통합 요약은 단일 기사에서 반복하면 안 된다.",
  event: { subject: "Gianfranco Sampo", action: "used AI", object: "gelato flavours", version: "2", date: "2026-10-19", summary: "반복 사건 요약" }, sources: [source],
};

test("gelato case uses one cached Korean title and one article summary, preserving original data", () => {
  const before = JSON.stringify(issue);
  const result = articlePresentation(issue, source);
  assert.equal(result.title, source.display.titleKo);
  assert.deepEqual(result.summary, source.summary.match(/[^.]+\./g).map((text) => text.trim()));
  assert.equal(result.developerImpact.length, 0);
  assert.deepEqual(result.event.map(({ label }) => label), ["주체", "행동", "대상"]);
  assert.ok(result.event.every(({ value }) => /[가-힣]/.test(value)));
  assert.equal(JSON.stringify(issue), before);
});
test("multiple reports choose the integrated summary, never all summaries", () => {
  const multiple = { ...issue, sources: [source, { ...source, id: "second" }] };
  assert.deepEqual(articlePresentation(multiple, source).summary, [issue.summary]);
});
test("repeated sentences and source introductions disappear while additional information survives", () => {
  const fresh = source.summary + " 원문에 공개 코드 저장소 링크가 있다.";
  assert.deepEqual(uniqueSentences(fresh, [source.summary]), ["원문에 공개 코드 저장소 링크가 있다."]);
  assert.equal(sourceIntroduction(source, [source.summary]), "");
  assert.equal(sourceIntroduction({ ...source, summary: fresh }, [source.summary]), "원문에 공개 코드 저장소 링크가 있다.");
});
test("empty rows and empty analysis are hidden; usable developer instructions remain", () => {
  const data = { ...source, display: undefined, analysis: { ...source.analysis, whyItMatters: "NaN", developerImpact: "개발자는 공개 SDK를 서비스에 통합할 수 있다." } };
  const result = articlePresentation({ ...issue, event: { ...issue.event, subject: "", action: "", object: "NaN" } }, data);
  assert.equal(result.event.length, 0);
  assert.equal(result.why.length, 0);
  assert.equal(result.developerImpact.length, 1);
});
test("missing translation uses existing Korean analysis and never invents a title", () => {
  assert.equal(articleTitle(issue, { ...source, display: undefined }), issue.title);
  assert.equal(articleTitle({ ...issue, title: "English only", event: { ...issue.event, summary: "English only" } }, { ...source, display: undefined }), "한국어 제목 준비 중");
  assert.equal(articlePresentation({ ...issue, summary: source.title, analysis: { summaryMethod: "source-title-fallback" } }, { ...source, summary: "" }).summary.length, 0);
});

function contrast(a, b) {
  const luminance = (hex) => hex.match(/[a-f0-9]{2}/gi).map((value) => parseInt(value, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}
test("shared reading tokens meet AA on page and card; important control borders meet 3:1", async () => {
  const css = await readFile(new URL("../app/news/detail.css", import.meta.url), "utf8");
  const colors = Object.fromEntries([...css.matchAll(/--news-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]));
  for (const surface of [colors.bg, colors.card]) {
    for (const text of [colors.text, colors.muted, colors.accent]) assert.ok(contrast(text, surface) >= 4.5, `${text} against ${surface}`);
    assert.ok(contrast(colors.control, surface) >= 3);
  }
});
