import type { NewsImportance, NewsIssue } from "../types/news";

export interface BriefingFilters {
  date?: string;
  query?: string;
  keyword?: string;
  sort?: "latest" | "importance";
  grade?: number | null;
}

export type ImportanceGroups = Record<NewsImportance, NewsIssue[]> & {
  unclassified: NewsIssue[];
};

const gradeAliases: Readonly<Record<string, NewsImportance>> = {
  일반: 1,
  관심: 2,
  중요: 3,
  매우중요: 4,
  "매우 중요": 4,
  최고중요: 5,
  "최고 중요": 5,
};
const gradeNames: Readonly<Record<NewsImportance, string>> = {
  1: "일반",
  2: "관심",
  3: "중요",
  4: "매우중요",
  5: "최고중요",
};
const seoulCalendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Preserve the analyzer's explicit 1–5 grades; never rescale other score ranges. */
export function normalizeNewsImportance(value: unknown): NewsImportance | null {
  let score: number;
  if (typeof value === "number") score = value;
  else if (typeof value === "string") {
    const text = value.trim();
    const alias = Object.hasOwn(gradeAliases, text) ? gradeAliases[text] : undefined;
    if (alias !== undefined) return alias;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text)) return null;
    score = Number(text);
  } else return null;
  return Number.isInteger(score) && score >= 1 && score <= 5
    ? (score as NewsImportance)
    : null;
}

export function importanceLabel(value: unknown): string {
  const grade = normalizeNewsImportance(value);
  return grade === null ? "미분류" : `${grade} · ${gradeNames[grade]}`;
}

/** ISO input only. Missing time-zone offsets follow the CSV pipeline's UTC rule. */
function newsTimestamp(value: string): number | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?([Zz]|[+-]\d{2}:\d{2})?)?$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) return null;
  const hasTime = match[4] !== undefined;
  if (hasTime && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59)) return null;
  const zone = match[7];
  if (zone && zone !== "Z" && zone !== "z") {
    const [hours, minutes] = zone.slice(1).split(":").map(Number);
    if (hours > 23 || minutes > 59) return null;
  }
  const normalized = hasTime
    ? text.replace("t", "T").replace(/z$/, "Z") + (zone ? "" : "Z")
    : `${text}T00:00:00Z`;
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : null;
}

export function newsDateKey(value: string): string {
  const timestamp = newsTimestamp(value);
  if (timestamp === null) return "";
  const parts = seoulCalendar.formatToParts(timestamp);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year.padStart(4, "0")}-${month}-${day}` : "";
}

/** updatedAt is the latest article in an issue; generatedAt is never a news date. */
export function issueDateKey(issue: Pick<NewsIssue, "updatedAt" | "publishedAt">): string {
  return newsDateKey(issue.updatedAt) || newsDateKey(issue.publishedAt);
}

function issueTimestamp(issue: NewsIssue): number {
  return newsTimestamp(issue.updatedAt) ?? newsTimestamp(issue.publishedAt) ?? Number.NEGATIVE_INFINITY;
}

function selectedDate(value: string | undefined): string {
  const date = value?.trim() || "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && newsDateKey(date) === date ? date : "";
}

/** Filter the complete input before grouping. Returned issues and sources retain identity. */
export function filterBriefingIssues(
  issues: readonly NewsIssue[],
  options: BriefingFilters = {},
): NewsIssue[] {
  const requestedDate = options.date?.trim() || "";
  const date = selectedDate(requestedDate);
  if (requestedDate && !date) return [];
  const hasGrade = options.grade !== undefined && options.grade !== null;
  const grade = normalizeNewsImportance(options.grade);
  if (hasGrade && grade === null) return [];
  const words = options.query?.trim().toLocaleLowerCase("ko").split(/\s+/).filter(Boolean) || [];
  const keyword = options.keyword?.trim().toLocaleLowerCase("ko");
  return issues.filter((issue) => {
    if (date && issueDateKey(issue) !== date) return false;
    if (hasGrade && normalizeNewsImportance(issue.importance) !== grade) return false;
    const tags = [...issue.keywords, ...issue.searchKeywords, ...issue.newTechnologies];
    if (keyword && !tags.some((tag) => tag.toLocaleLowerCase("ko") === keyword)) return false;
    const searchable = [
      issue.title,
      issue.summary,
      issue.category,
      issue.eventType,
      ...tags,
      ...Object.values(issue.event),
      ...issue.sources.map((source) => `${source.title} ${source.source} ${source.display?.titleKo || ""}`),
    ].join(" ").toLocaleLowerCase("ko");
    return words.every((word) => searchable.includes(word));
  }).sort((left, right) => {
    if (options.sort === "importance") {
      const leftGrade = normalizeNewsImportance(left.importance) ?? 0;
      const rightGrade = normalizeNewsImportance(right.importance) ?? 0;
      if (leftGrade !== rightGrade) return rightGrade - leftGrade;
    }
    const leftTime = issueTimestamp(left);
    const rightTime = issueTimestamp(right);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

/** Only duplicate issue IDs are removed. Shared titles, companies, or articles do not merge events. */
export function groupNewsByImportance(issues: readonly NewsIssue[]): ImportanceGroups {
  const groups: ImportanceGroups = { 5: [], 4: [], 3: [], 2: [], 1: [], unclassified: [] };
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.id && seen.has(issue.id)) continue;
    if (issue.id) seen.add(issue.id);
    const grade = normalizeNewsImportance(issue.importance);
    if (grade === null) groups.unclassified.push(issue);
    else groups[grade].push(issue);
  }
  return groups;
}

/** Produce a base-path-independent Next link; the app applies /EVAN/ itself. */
export function briefingHref(options: BriefingFilters = {}): string {
  const params = new URLSearchParams();
  const grade = normalizeNewsImportance(options.grade);
  if (grade !== null) params.set("grade", String(grade));
  const date = selectedDate(options.date);
  if (date) params.set("date", date);
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.keyword?.trim()) params.set("keyword", options.keyword.trim());
  if (options.sort === "importance") params.set("sort", "importance");
  return `/news${params.size ? `?${params.toString()}` : ""}`;
}
