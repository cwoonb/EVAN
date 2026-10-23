"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import NewsImage from "@/components/NewsImage";
import { formatNewsDate, useNewsFeed } from "@/lib/news-feed";
import { repeatsText, uniqueSentences } from "@/lib/news-presentation";
import {
  briefingHref,
  filterBriefingIssues,
  groupNewsByImportance,
  importanceLabel,
  issueDateKey,
} from "@/lib/news-layout";
import type { NewsIssue } from "@/types/news";
import "@/app/news/briefing.css";

type BriefingFilters = {
  date?: string;
  query: string;
  keyword: string;
};

function displayDay(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${value}T12:00:00+09:00`));
}

function headline(issue: NewsIssue) {
  return (
    issue.sources[0]?.display?.titleKo ||
    issue.title ||
    issue.sources[0]?.title ||
    ""
  );
}

/** Detail links retain the current date and search conditions on static Pages. */
function detailHref(issue: NewsIssue, filters: BriefingFilters) {
  const params = new URLSearchParams(briefingHref(filters).split("?")[1] || "");
  const source = issue.sources[0];
  params.set("issue", source?.id || issue.id);
  if (source) params.set("article", source.id);
  return `/news?${params.toString()}`;
}

function articleImage(issue: NewsIssue) {
  const source = issue.sources[0];
  return {
    id: source?.id || issue.id,
    url: source?.url,
    title: headline(issue),
    category: issue.category,
    publishedAt: issue.updatedAt,
    image: source?.image || issue.image,
  };
}

function summary(issue: NewsIssue) {
  if (
    issue.analysis.summaryMethod === "source-title-fallback" &&
    !issue.sources[0]?.summary
  )
    return "";
  const text =
    issue.sources.length > 1
      ? issue.summary
      : issue.sources[0]?.summary || issue.summary;
  return uniqueSentences(text, [headline(issue)], 2)
    .filter((sentence) => !repeatsText(sentence, headline(issue)))
    .join(" ");
}

function NewsMeta({ issue }: { issue: NewsIssue }) {
  const timestamp = Number.isFinite(Date.parse(issue.updatedAt))
    ? issue.updatedAt
    : issue.publishedAt;
  return (
    <div className="briefing-meta">
      <span>{issue.sources[0]?.source || "출처 미상"}</span>
      <time dateTime={timestamp}>{formatNewsDate(timestamp)}</time>
      {issue.sources.length > 1 && <span>원문 {issue.sources.length}개</span>}
    </div>
  );
}

function FeatureCard({
  issue,
  filters,
}: {
  issue: NewsIssue;
  filters: BriefingFilters;
}) {
  const description = summary(issue);
  return (
    <Link href={detailHref(issue, filters)} className="briefing-feature">
      <NewsImage
        news={articleImage(issue)}
        className="briefing-feature-image"
        sizes="(max-width: 700px) 100vw, 45vw"
        priority
      />
      <div className="briefing-feature-copy">
        <span className="briefing-grade briefing-grade-5">
          {importanceLabel(5)}
        </span>
        <h3>{headline(issue)}</h3>
        {description && <p>{description}</p>}
        <NewsMeta issue={issue} />
        <span className="briefing-read">
          기사와 분석 읽기 <ArrowUpRight size={16} aria-hidden="true" />
        </span>
      </div>
    </Link>
  );
}

function NewsCard({
  issue,
  filters,
}: {
  issue: NewsIssue;
  filters: BriefingFilters;
}) {
  const description = summary(issue);
  return (
    <Link href={detailHref(issue, filters)} className="briefing-card">
      <NewsImage
        news={articleImage(issue)}
        className="briefing-card-image"
        sizes="(max-width: 700px) 100vw, (max-width: 1080px) 50vw, 33vw"
      />
      <div className="briefing-card-copy">
        <h3>{headline(issue)}</h3>
        {description && <p>{description}</p>}
        <NewsMeta issue={issue} />
      </div>
    </Link>
  );
}

function UpdateRow({
  issue,
  filters,
}: {
  issue: NewsIssue;
  filters: BriefingFilters;
}) {
  return (
    <li>
      <Link href={detailHref(issue, filters)} className="briefing-update">
        <NewsImage
          news={articleImage(issue)}
          className="briefing-update-image"
          sizes="(max-width: 700px) 88px, 112px"
        />
        <div>
          <h3>{headline(issue)}</h3>
          {issue.keywords.length > 0 && (
            <p className="briefing-keywords">
              {issue.keywords.slice(0, 3).map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </p>
          )}
          <NewsMeta issue={issue} />
        </div>
        <ArrowUpRight size={17} aria-hidden="true" />
      </Link>
    </li>
  );
}

export default function NewsSection() {
  const { feed, loading, error, refresh } = useNewsFeed();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const dates = useMemo(
    () =>
      [...new Set((feed?.issues || []).map(issueDateKey).filter(Boolean))]
        .sort()
        .reverse(),
    [feed],
  );
  const activeDate =
    selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];
  const dateIndex = dates.indexOf(activeDate);
  const filters: BriefingFilters = { date: activeDate, query, keyword };
  const filtered = useMemo(
    () =>
      filterBriefingIssues(feed?.issues || [], {
        date: activeDate,
        query,
        keyword,
        sort: "latest",
      }),
    [feed, activeDate, query, keyword],
  );
  const groups = useMemo(() => groupNewsByImportance(filtered), [filtered]);
  const keywords = useMemo(
    () =>
      [
        ...new Set(
          (feed?.issues || [])
            .filter(
              (issue) => !activeDate || issueDateKey(issue) === activeDate,
            )
            .flatMap((issue) => issue.keywords),
        ),
      ].sort((a, b) => a.localeCompare(b, "ko")),
    [feed, activeDate],
  );
  const uniqueIssues = [
    groups[5],
    groups[4],
    groups[3],
    groups[2],
    groups[1],
    groups.unclassified,
  ].flat();
  const sourceCount = new Set(
    uniqueIssues.flatMap((issue) => issue.sources.map((source) => source.id)),
  ).size;
  const lead = groups[5][0];

  function moveDate(step: number) {
    const next = dates[dateIndex + step];
    if (next) setSelectedDate(next);
  }

  return (
    <section className="briefing" aria-labelledby="news-heading">
      <div className="briefing-heading">
        <div>
          <p className="briefing-eyebrow">AI NEWS BRIEFING</p>
          <h1 id="news-heading">
            오늘의 <span>AI 뉴스</span>
          </h1>
          <p>같은 사건을 함께 읽고, 중요한 변화부터 살펴보세요.</p>
        </div>
        <div className="briefing-date-controls">
          <label className="visually-hidden" htmlFor="briefing-date">
            뉴스 날짜 선택
          </label>
          <div className="briefing-date-select">
            <select
              id="briefing-date"
              value={activeDate || ""}
              onChange={(event) => setSelectedDate(event.target.value)}
              disabled={!dates.length}
              aria-label="뉴스 날짜 선택"
            >
              {dates.length ? (
                dates.map((date) => (
                  <option value={date} key={date}>
                    {displayDay(date)}
                  </option>
                ))
              ) : (
                <option value="">뉴스 준비 중</option>
              )}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={() => moveDate(1)}
            disabled={dateIndex < 0 || dateIndex >= dates.length - 1}
            aria-label="이전 날짜 뉴스"
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => moveDate(-1)}
            disabled={dateIndex <= 0}
            aria-label="다음 날짜 뉴스"
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="briefing-filters">
        <div className="briefing-search">
          <Search size={18} aria-hidden="true" />
          <label className="visually-hidden" htmlFor="briefing-search">
            뉴스 제목, 요약, 기업, 기술 검색
          </label>
          <input
            id="briefing-search"
            type="search"
            placeholder="기업, 모델, 키워드 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <label className="briefing-filter-select">
          <span className="visually-hidden">본문 핵심 키워드</span>
          <select
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            aria-label="본문 핵심 키워드 필터"
          >
            <option value="">전체 핵심 키워드</option>
            {keyword && !keywords.includes(keyword) && (
              <option value={keyword}>{keyword}</option>
            )}
            {keywords.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>
        <span className="briefing-sort-note">등급별 최신순</span>
        {(query || keyword) && (
          <button
            type="button"
            className="briefing-filter-reset"
            onClick={() => {
              setQuery("");
              setKeyword("");
            }}
          >
            초기화
          </button>
        )}
      </div>

      <div className="briefing-overview">
        <nav className="briefing-jump-links" aria-label="중요도별 뉴스 영역">
          {([5, 4, 3] as const).map((grade) => (
            <a href={`#briefing-grade-${grade}`} key={grade}>
              {importanceLabel(grade)} <b>{groups[grade].length}</b>
            </a>
          ))}
        </nav>
        <p aria-live="polite">
          이슈 <strong>{uniqueIssues.length.toLocaleString("ko-KR")}</strong>건
          · 원문 기사 {sourceCount.toLocaleString("ko-KR")}개
        </p>
      </div>

      {error && (
        <div className="briefing-alert" role="status">
          <p>
            {feed
              ? "새 데이터를 받지 못해 마지막으로 불러온 뉴스를 표시합니다."
              : "뉴스를 불러오지 못했습니다."}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" /> 다시 불러오기
          </button>
        </div>
      )}
      {loading && !feed ? (
        <div className="briefing-loading" role="status">
          <LoaderCircle className="spin" size={23} aria-hidden="true" />
          <p>AI 뉴스를 불러오고 있습니다.</p>
        </div>
      ) : (
        <>
          <section
            id="briefing-grade-5"
            className="briefing-tier briefing-tier-core"
            aria-labelledby="briefing-core-heading"
          >
            <div className="briefing-tier-heading">
              <div>
                <span className="briefing-grade briefing-grade-5">
                  {importanceLabel(5)}
                </span>
                <h2 id="briefing-core-heading">
                  핵심 뉴스 <span>{groups[5].length}건</span>
                </h2>
              </div>
              <Link href={briefingHref({ ...filters, grade: 5 })}>
                핵심 뉴스 전체 보기{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {lead ? (
              <>
                <FeatureCard issue={lead} filters={filters} />
                {groups[5].length > 1 && (
                  <ol className="briefing-core-list">
                    {groups[5].slice(1).map((issue) => (
                      <li key={issue.id}>
                        <Link href={detailHref(issue, filters)}>
                          <div>
                            <h3>{headline(issue)}</h3>
                            <NewsMeta issue={issue} />
                          </div>
                          <ArrowUpRight size={17} aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="briefing-tier-empty">
                선택한 날짜와 조건에 맞는 최고중요 뉴스가 없습니다.
              </p>
            )}
          </section>
          <section
            id="briefing-grade-4"
            className="briefing-tier"
            aria-labelledby="briefing-major-heading"
          >
            <div className="briefing-tier-heading">
              <div>
                <span className="briefing-grade briefing-grade-4">
                  {importanceLabel(4)}
                </span>
                <h2 id="briefing-major-heading">
                  주요 뉴스 <span>{groups[4].length}건</span>
                </h2>
              </div>
              <Link href={briefingHref({ ...filters, grade: 4 })}>
                주요 뉴스 전체 보기{" "}
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {groups[4].length ? (
              <>
                <div className="briefing-card-grid">
                  {groups[4].slice(0, 6).map((issue) => (
                    <NewsCard issue={issue} filters={filters} key={issue.id} />
                  ))}
                </div>
                {groups[4].length > 6 && (
                  <Link
                    className="briefing-more"
                    href={briefingHref({ ...filters, grade: 4 })}
                  >
                    나머지 주요 뉴스 {groups[4].length - 6}건 보기{" "}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                )}
              </>
            ) : (
              <p className="briefing-tier-empty">
                선택한 날짜와 조건에 맞는 매우중요 뉴스가 없습니다.
              </p>
            )}
          </section>
          <section
            id="briefing-grade-3"
            className="briefing-tier"
            aria-labelledby="briefing-updates-heading"
          >
            <div className="briefing-tier-heading">
              <div>
                <span className="briefing-grade briefing-grade-3">
                  {importanceLabel(3)}
                </span>
                <h2 id="briefing-updates-heading">
                  주요 업데이트 <span>{groups[3].length}건</span>
                </h2>
              </div>
              <Link href={briefingHref({ ...filters, grade: 3 })}>
                업데이트 전체 보기 <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            </div>
            {groups[3].length ? (
              <>
                <ol className="briefing-update-list">
                  {groups[3].slice(0, 12).map((issue) => (
                    <UpdateRow issue={issue} filters={filters} key={issue.id} />
                  ))}
                </ol>
                {groups[3].length > 12 && (
                  <Link
                    className="briefing-more"
                    href={briefingHref({ ...filters, grade: 3 })}
                  >
                    나머지 업데이트 {groups[3].length - 12}건 보기{" "}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Link>
                )}
              </>
            ) : (
              <p className="briefing-tier-empty">
                선택한 날짜와 조건에 맞는 중요 뉴스가 없습니다.
              </p>
            )}
          </section>
        </>
      )}
      <div className="briefing-bottom">
        <span>
          {feed ? (
            <>
              데이터 갱신{" "}
              <time dateTime={feed.generatedAt}>
                {formatNewsDate(feed.generatedAt)}
              </time>
              {loading ? " · 확인 중" : ""}
            </>
          ) : (
            "뉴스가 갱신되면 이곳에서 확인할 수 있습니다."
          )}
        </span>
        <Link href={briefingHref(filters)}>
          관심·일반을 포함한 뉴스 전체 탐색{" "}
          <ArrowUpRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
