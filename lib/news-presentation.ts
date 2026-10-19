import type { NewsIssue, NewsSource } from "../types/news";

const EMPTY = /^(?:nan|null|none|unknown|미상|없음|확인되지 않음)$/i;
const KOREAN = /[가-힣]/;

export function readableText(value: string | undefined): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return EMPTY.test(text) ? "" : text;
}

function comparable(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

/** A presentation-only check: the original feed and analysis remain untouched. */
export function repeatsText(candidate: string, shown: string): boolean {
  const left = comparable(candidate);
  const right = comparable(shown);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 12 && right.includes(left)) return true;
  const grams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 2) }, (_, index) => text.slice(index, index + 3)));
  const a = grams(left);
  const b = grams(right);
  const common = [...a].filter((gram) => b.has(gram)).length;
  // Conservative containment catches lightly rewritten copies without discarding
  // a new detail merely because it mentions the same company or technology.
  return Math.min(left.length, right.length) >= 24 &&
    (2 * common / (a.size + b.size) >= .7 || common / a.size >= .86);
}

export function uniqueSentences(value: string | undefined, shown: string[] = [], maximum = 3): string[] {
  const sentences = readableText(value).split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  const result: string[] = [];
  for (const sentence of sentences) {
    if ([...shown, ...result].some((previous) => repeatsText(sentence, previous))) continue;
    result.push(sentence);
    if (result.length >= maximum) break;
  }
  return result;
}

function removePublisher(title: string, publisher: string): string {
  const suffix = new RegExp(`\\s*[-–—|]\\s*${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
  return readableText(title).replace(suffix, "").replace(/[.。]$/, "");
}

export function articleTitle(issue: NewsIssue, source: NewsSource): string {
  const translated = readableText(source.display?.titleKo);
  if (KOREAN.test(translated)) return translated;
  const original = removePublisher(source.title, source.source);
  if (KOREAN.test(original)) return original;
  // Existing Korean event analysis is an honest fallback while the cached
  // translation is being prepared; never invent a title in the browser.
  for (const existing of [issue.title, issue.event.summary]) {
    if (KOREAN.test(existing)) return removePublisher(existing, source.source);
  }
  return "한국어 제목 준비 중";
}

export function compactNewsDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "Asia/Seoul",
  }).format(date);
}

export function articlePresentation(issue: NewsIssue, source: NewsSource) {
  const title = articleTitle(issue, source);
  const rawSummary = !source.summary && issue.analysis?.summaryMethod === "source-title-fallback" ? "" : issue.sources.length > 1
    ? issue.summary || source.summary || issue.event.summary
    : source.summary || issue.summary || issue.event.summary;
  const summary = uniqueSentences(rawSummary, [title], 3).filter((sentence) => KOREAN.test(sentence));
  const shown = [...summary];
  const why = uniqueSentences(source.analysis?.whyItMatters, shown);
  shown.push(...why);
  const impact = readableText(source.analysis?.developerImpact);
  const usefulImpact = /개발자|API|SDK|코드|통합|오픈소스|오픈 소스|배포|테스트|워크플로|구현|라이브러리|프레임워크|애플리케이션|파인튜닝|미세.?조정|도구를|활용할 수|사용할 수|구축|최적화/u.test(impact)
    && !/직접적.{0,15}(?:없|확인되지)|가능성을? 시사|간접적.{0,15}영향|구체적.{0,12}(?:없|확인되지)/u.test(impact);
  const developerImpact = usefulImpact ? uniqueSentences(impact, shown) : [];
  shown.push(...developerImpact);
  const facts = (source.analysis?.keyFacts || []).flatMap((text) => {
    const fresh = uniqueSentences(text, shown, 1);
    shown.push(...fresh);
    return fresh;
  });
  const watchPoints = (source.analysis?.watchPoints || []).flatMap((text) => {
    const fresh = uniqueSentences(text, shown, 1);
    shown.push(...fresh);
    return fresh;
  });
  const displayEvent = source.display?.event;
  const event = [
    { label: "주체", value: readableText(displayEvent?.subject || issue.event.subject) },
    { label: "행동", value: readableText(displayEvent?.action || issue.event.action) },
    { label: "대상", value: readableText(displayEvent?.object || issue.event.object) },
  ].filter(({ value }) => value);
  return { title, summary, why, developerImpact, facts, watchPoints, event };
}

export function sourceIntroduction(source: NewsSource, shown: string[]): string {
  return uniqueSentences(source.summary, shown, 2).filter((sentence) => KOREAN.test(sentence)).join(" ");
}
