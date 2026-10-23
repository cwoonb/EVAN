import type { NewsIssue, NewsSource } from "../types/news";

export interface ArticleReference {
  issue: NewsIssue;
  source: NewsSource;
}

export interface RelatedArticle extends ArticleReference {
  matchingTerms: string[];
}

export interface RelatedNews {
  sameEvent: ArticleReference[];
  related: RelatedArticle[];
  past: RelatedArticle[];
}

const PAST_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Company or industry names alone do not establish a shared news topic.
const BROAD_TERMS = new Set([
  "ai",
  "llm",
  "agi",
  "인공지능",
  "생성형 ai",
  "생성형ai",
  "언어 모델",
  "대규모 언어 모델",
  "대규모언어모델",
  "machine learning",
  "artificial intelligence",
  "generative ai",
  "agentic ai",
  "에이전틱 ai",
  "에이전틱ai",
  "artificial intelligence ai",
  "ai agent",
  "ai agents",
  "ai 에이전트",
  "에이전트",
  "모델",
  "기술",
  "연구",
  "뉴스",
  "투자",
  "산업",
  "기업",
  "플랫폼",
  "데이터",
  "서비스",
  "openai",
  "오픈ai",
  "오픈에이아이",
  "google",
  "구글",
  "alphabet",
  "알파벳",
  "microsoft",
  "마이크로소프트",
  "meta",
  "메타",
  "anthropic",
  "앤트로픽",
  "nvidia",
  "엔비디아",
  "apple",
  "애플",
  "amazon",
  "아마존",
  "aws",
  "ibm",
  "samsung",
  "삼성",
  "삼성전자",
  "lg",
  "네이버",
  "naver",
  "카카오",
  "kakao",
  "alibaba",
  "알리바바",
  "tencent",
  "텐센트",
  "bytedance",
  "바이트댄스",
  "deepseek",
  "딥시크",
  "xai",
  "x ai",
  "tesla",
  "테슬라",
  "intel",
  "인텔",
  "amd",
  "arm",
  "qualcomm",
  "퀄컴",
  "huawei",
  "화웨이",
  "baidu",
  "바이두",
  "claude",
  "클로드",
  "gemini",
  "제미나이",
  "gpt",
  "chatgpt",
  "챗gpt",
  "llama",
  "라마",
  "qwen",
  "큐웬",
  "grok",
  "그록",
]);

function normalizeTerm(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTerm(value: string): string | null {
  const normalized = normalizeTerm(value);
  return normalized.length >= 2 && !BROAD_TERMS.has(normalized)
    ? normalized
    : null;
}

function articleTerms({
  issue,
  source,
}: ArticleReference): Map<string, string> {
  const values = [
    ...issue.keywords,
    ...issue.newTechnologies,
    ...source.searchKeywords,
  ];
  const terms = new Map<string, string>();
  const subject = normalizeTerm(issue.event.subject);
  for (const value of values) {
    const normalized = meaningfulTerm(value);
    if (normalized && normalized !== subject) terms.set(normalized, value);
  }
  return terms;
}

function specificTerms(issue: NewsIssue): Set<string> {
  const terms = new Set(
    issue.newTechnologies
      .map(meaningfulTerm)
      .filter((term): term is string => !!term),
  );
  // Named, versioned models are more specific than their vendor or model family.
  for (const value of [...issue.keywords, issue.title]) {
    const matches = value.match(
      /\b(?:gpt|claude|gemini|llama|qwen|grok|deepseek|mistral|phi)[\s-]*(?:(?:sonnet|opus|haiku|flash|pro)[\s-]*)?\d+(?:\.\d+)*(?:[\s-]*(?:sonnet|opus|haiku|flash|pro|ultra|lite|mini|nano|turbo|thinking|coder))?/gi,
    );
    for (const match of matches || []) {
      const term = meaningfulTerm(match);
      if (term) terms.add(term);
    }
  }
  return terms;
}

/** Resolve article IDs first so regrouping never changes the selected article. */
export function findArticle(
  issues: NewsIssue[],
  issueId: string | null,
  articleId?: string | null,
): ArticleReference | null {
  const exactId = articleId || issueId;
  if (!exactId) return null;
  for (const issue of issues) {
    const source = issue.sources.find((entry) => entry.id === exactId);
    if (source) return { issue, source };
  }
  if (articleId) return null;
  const issue = issues.find((entry) => entry.id === issueId);
  return issue?.sources[0] ? { issue, source: issue.sources[0] } : null;
}

/** Query routes retain list filters while selecting the exact article on static Pages. */
export function articleHref(issue: NewsIssue, source: NewsSource, listHref?: string): string {
  const params = new URLSearchParams();
  if (listHref) {
    const queryStart = listHref.indexOf("?");
    if (queryStart !== -1) {
      const listParams = new URLSearchParams(listHref.slice(queryStart + 1).split("#", 1)[0]);
      for (const name of ["date", "grade", "q", "keyword", "sort", "importance"]) {
        const value = listParams.get(name);
        if (value !== null) params.set(name, value);
      }
    }
  }
  params.set("issue", issue.id);
  params.set("article", source.id);
  return `/news?${params.toString()}`;
}

/** Association is navigation only; it never changes verified event clusters. */
export function relatedNews(
  issues: NewsIssue[],
  current: ArticleReference,
): RelatedNews {
  const currentTerms = articleTerms(current);
  const currentSpecific = specificTerms(current.issue);
  const sameEvent = current.issue.sources
    .filter((source) => source.id !== current.source.id)
    .map((source) => ({ issue: current.issue, source }))
    .sort(
      (a, b) =>
        Date.parse(b.source.publishedAt) - Date.parse(a.source.publishedAt),
    );
  const scored: Array<RelatedArticle & { score: number }> = [];
  const seen = new Set([
    current.source.id,
    ...sameEvent.map(({ source }) => source.id),
  ]);

  for (const issue of issues) {
    if (issue.id === current.issue.id) continue;
    const candidateSpecific = specificTerms(issue);
    for (const source of issue.sources) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      const candidateTerms = articleTerms({ issue, source });
      const overlap = [...currentTerms.keys()].filter((term) =>
        candidateTerms.has(term),
      );
      const specificOverlap = [...currentSpecific].filter((term) =>
        candidateSpecific.has(term),
      );
      const namedPhrase = overlap.some(
        (term) => term.split(" ").length >= 3 && term.length >= 8,
      );
      if (!specificOverlap.length && overlap.length < 2 && !namedPhrase)
        continue;
      const matchingTerms = [
        ...new Set([
          ...specificOverlap.map((term) => currentTerms.get(term) || term),
          ...overlap.map((term) => currentTerms.get(term) || term),
        ]),
      ];
      scored.push({
        issue,
        source,
        matchingTerms,
        score: specificOverlap.length * 4 + overlap.length,
      });
    }
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Date.parse(b.source.publishedAt) - Date.parse(a.source.publishedAt),
  );
  const currentTime = Date.parse(current.source.publishedAt);
  const output: RelatedNews = { sameEvent, related: [], past: [] };
  for (const candidate of scored) {
    const article = {
      issue: candidate.issue,
      source: candidate.source,
      matchingTerms: candidate.matchingTerms,
    };
    if (currentTime - Date.parse(article.source.publishedAt) >= PAST_AGE_MS)
      output.past.push(article);
    else output.related.push(article);
  }
  return output;
}
