"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import {
  formatNewsDate,
  useNewsFeed,
} from "@/lib/news-feed";
import { filterBriefingIssues, importanceLabel, issueDateKey, newsDateKey, normalizeNewsImportance } from "@/lib/news-layout";
import NewsImage from "@/components/NewsImage";
import NewsArticleDetail from "@/components/NewsArticleDetail";
import { findArticle } from "@/lib/related-news";

const PAGE_SIZE = 24;
type SortOrder = "latest" | "importance";
type InitialFilters = {
  query: string;
  keyword: string;
  importance: number;
  sort: SortOrder;
  date: string;
  grade: number;
};

function ExplorerContent({
  initial,
  selectedId,
  articleId,
}: {
  initial: InitialFilters;
  selectedId: string | null;
  articleId: string | null;
}) {
  const { feed, loading, error, refresh } = useNewsFeed();
  const [query, setQuery] = useState(initial.query);
  const [keyword, setKeyword] = useState(initial.keyword);
  const [importance, setImportance] = useState(initial.importance);
  const [sort, setSort] = useState<SortOrder>(initial.sort);
  const [date, setDate] = useState(initial.date);
  const [grade, setGrade] = useState(initial.grade);
  const [page, setPage] = useState(1);
  const dates = useMemo(() => [...new Set((feed?.issues || []).map(issueDateKey).filter(Boolean))].sort().reverse(), [feed]);
  const keywords = useMemo(
    () =>
      [
        ...new Set(
          (feed?.issues || []).flatMap((issue) => [
            ...issue.searchKeywords,
            ...issue.keywords,
          ]),
        ),
      ].sort((a, b) => a.localeCompare(b, "ko")),
    [feed],
  );
  const filtered = useMemo(
    () =>
      filterBriefingIssues(feed?.issues || [], { query, keyword, date, grade: grade || undefined, sort })
        .filter((issue) => !importance || (normalizeNewsImportance(issue.importance) ?? 0) >= importance),
    [feed, query, keyword, importance, grade, date, sort],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.max(1, Math.min(page, totalPages));
  const visible = filtered.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE,
  );
  const selectedArticle = findArticle(
    feed?.issues || [],
    selectedId,
    articleId,
  );
  const firstPage = Math.max(1, Math.min(activePage - 2, totalPages - 4));
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => firstPage + index,
  );

  function explorerHref(issueId?: string) {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (keyword) params.set("keyword", keyword);
    if (importance) params.set("importance", String(importance));
    if (grade) params.set("grade", String(grade));
    if (date) params.set("date", date);
    if (sort !== "latest") params.set("sort", sort);
    if (issueId) {
      params.set("issue", issueId);
      params.set("article", issueId);
    }
    return `/news${params.size ? `?${params.toString()}` : ""}`;
  }

  function clearFilters() {
    setQuery("");
    setKeyword("");
    setImportance(0);
    setGrade(0);
    setDate("");
    setSort("latest");
    setPage(1);
  }

  function movePage(value: number) {
    setPage(Math.max(1, Math.min(totalPages, value)));
    document
      .getElementById("news-library-heading")
      ?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  if (selectedId || articleId) {
    if (selectedArticle && feed) {
      return (
        <>
          <NewsArticleDetail
            key={selectedArticle.source.id}
            current={selectedArticle}
            issues={feed.issues}
            closeHref={explorerHref()}
          />
          {error && (
            <p className="news-feed-error" role="status">
              {error}
            </p>
          )}
        </>
      );
    }
    if (loading && !feed) {
      return (
        <div className="news-explorer-loading" role="status">
          <LoaderCircle className="spin" size={25} aria-hidden="true" />
          <p>기사와 분석을 불러오고 있습니다.</p>
        </div>
      );
    }
    return (
      <div className="news-issue-missing" role="status">
        <h1>
          {error
            ? "뉴스 데이터를 불러오지 못했습니다."
            : "이 기사를 현재 데이터에서 찾을 수 없습니다."}
        </h1>
        <p>
          {error ||
            "데이터가 갱신되었을 수 있습니다. 뉴스 목록에서 키워드로 다시 찾아보세요."}
        </p>
        {error && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="article-original"
          >
            다시 불러오기 <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}
        <Link href={explorerHref()}>
          뉴스 목록 보기 <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <>
      <section className="news-explorer-hero news-explorer-hero-compact">
        <Link className="news-explorer-back" href="/">
          <ArrowLeft size={14} aria-hidden="true" /> 오늘의 브리핑
        </Link>
        <div className="news-explorer-title-row">
          <div>
            <h1>전체 뉴스 탐색</h1>
            <p>날짜와 키워드로 사건을 찾고, 실제 원문을 확인하세요.</p>
          </div>
          {feed && (
            <div className="news-explorer-stats">
              <span>
                <b>{feed.stats.issues.toLocaleString("ko-KR")}</b>개의 통합 이슈
              </span>
              <span>
                원문 기사 {feed.stats.articles.toLocaleString("ko-KR")}개
              </span>
            </div>
          )}
        </div>
      </section>
      <div className="news-feed-status" role="status">
        <span>
          {loading && (
            <LoaderCircle size={13} className="spin" aria-hidden="true" />
          )}
          {feed ? (
            <>
              {error
                ? "갱신하지 못해 마지막 데이터를 표시합니다. · "
                : "마지막 갱신 "}
              <time dateTime={feed.generatedAt}>
                {formatNewsDate(feed.generatedAt)}
              </time>
            </>
          ) : loading ? (
            "뉴스 데이터를 불러오고 있습니다."
          ) : (
            "뉴스 데이터를 불러오지 못했습니다."
          )}
        </span>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" />{" "}
          {loading ? "확인 중" : "새로고침"}
        </button>
      </div>
      {error && (
        <p className="news-feed-error" role="alert">
          {error}{" "}
          {feed
            ? "이전에 불러온 이슈와 원문은 계속 확인할 수 있습니다."
            : "잠시 후 다시 불러와 주세요."}
        </p>
      )}
      <section
        className="news-explorer-library"
        aria-labelledby="news-library-heading"
      >
        <div className="news-library-heading">
          <h2 id="news-library-heading">전체 뉴스 탐색</h2>
          <span>중요도 1–5 · 모든 이슈</span>
        </div>
        <form
          className="news-explorer-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
          }}
        >
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            aria-label="뉴스 제목, 내용, 키워드, 출처, 사건, 신기술 검색"
            placeholder="키워드, 출처, 사건, 신기술 검색"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPage(1);
              }}
              aria-label="검색어 지우기"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </form>
        <div className="news-explorer-filters">
          <label>
            <span>날짜 · 한국 시간</span>
            <div className="news-filter-select">
              <select value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} aria-label="뉴스 날짜 필터">
                <option value="">전체 날짜</option>
                {date && !dates.includes(date) && <option value={date}>{date} · 현재 뉴스 없음</option>}
                {dates.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </label>
          <label>
            <span>키워드</span>
            <div className="news-filter-select">
              <select
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value);
                  setPage(1);
                }}
                aria-label="뉴스 키워드 필터"
              >
                <option value="">전체 키워드</option>
                {keyword && !keywords.includes(keyword) && (
                  <option value={keyword}>{keyword}</option>
                )}
                {keywords.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </label>
          <label>
            <span>중요도</span>
            <div className="news-filter-select">
              <select
                value={grade ? `grade-${grade}` : `min-${importance}`}
                onChange={(event) => {
                  const [kind, value] = event.target.value.split("-");
                  setImportance(kind === "min" ? Number(value) : 0);
                  setGrade(kind === "grade" ? Number(value) : 0);
                  setPage(1);
                }}
                aria-label="뉴스 중요도 필터"
              >
                <option value="min-0">전체 (1–5)</option>
                <option value="min-3">3 이상 · 중요 이상</option>
                <option value="min-4">4 이상 · 매우중요 이상</option>
                <option value="grade-5">5 · 최고중요</option>
                <option value="grade-4">4 · 매우중요</option>
                <option value="grade-3">3 · 중요</option>
                <option value="grade-2">2 · 관심</option>
                <option value="grade-1">1 · 일반</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </label>
          <label>
            <span>정렬</span>
            <div className="news-filter-select">
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as SortOrder);
                  setPage(1);
                }}
                aria-label="뉴스 정렬"
              >
                <option value="latest">최신순</option>
                <option value="importance">중요도순</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </label>
          {(query || keyword || importance || grade || date || sort !== "latest") && (
            <button
              className="news-filter-reset"
              type="button"
              onClick={clearFilters}
            >
              필터 초기화 <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="news-explorer-result-count" aria-live="polite">
          <p>
            {query ? (
              <>
                <b>‘{query}’</b> 검색 결과{" "}
              </>
            ) : (
              "이슈 "
            )}
            <b>{filtered.length.toLocaleString("ko-KR")}</b>개
            {keyword ? ` · #${keyword}` : ""}
            {grade ? ` · 중요도 ${importanceLabel(grade)}` : ""}
            {date ? ` · ${date}` : ""}
          </p>
          <span>
            {filtered.length
              ? `${(activePage - 1) * PAGE_SIZE + 1}–${Math.min(activePage * PAGE_SIZE, filtered.length)}`
              : "0"}{" "}
            / {filtered.length}
          </span>
        </div>
        {loading && !feed ? (
          <div className="news-explorer-loading" role="status">
            <LoaderCircle className="spin" size={25} aria-hidden="true" />
            <p>통합 이슈와 원문을 불러오고 있습니다.</p>
          </div>
        ) : !filtered.length ? (
          <div className="news-explorer-empty">
            <Search size={29} aria-hidden="true" />
            <h3>
              {feed?.issues.length
                ? "일치하는 이슈가 없습니다."
                : "아직 수집된 이슈가 없습니다."}
            </h3>
            <p>
              {feed?.issues.length
                ? "검색어와 키워드, 중요도를 바꿔 다시 살펴보세요."
                : "데이터가 갱신되면 이곳에서 확인할 수 있습니다."}
            </p>
            {feed?.issues.length ? (
              <button type="button" onClick={clearFilters}>
                모든 이슈 보기
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading}
              >
                다시 불러오기
              </button>
            )}
          </div>
        ) : (
          <ol className="news-explorer-list" role="list" aria-label="뉴스 검색 결과">
            {visible.map((issue) => {
              const source = issue.sources[0];
              const title = source?.display?.titleKo || issue.title || source?.title;
              const publishedAt = source?.publishedAt || issue.updatedAt;
              return (
                <li key={issue.id}>
                  <Link href={explorerHref(source?.id || issue.id)} className="news-explorer-row">
                    <NewsImage
                      news={{ id: source?.id || issue.id, url: source?.url, title: issue.title, category: issue.category, publishedAt, image: source?.image || issue.image }}
                      className="news-explorer-row-image"
                      sizes="(max-width: 700px) 76px, 112px"
                    />
                    <div className="news-explorer-row-copy">
                      <h3 title={title}>{title}</h3>
                      {issue.keywords.length > 0 && (
                        <p className="news-explorer-row-keywords" title={issue.keywords.slice(0, 3).join(" · ")}>
                          {issue.keywords.slice(0, 3).map((entry) => <span key={entry}>{entry}</span>)}
                        </p>
                      )}
                      <div className="news-explorer-row-meta">
                        <span className="news-explorer-row-source">{source?.source || "출처 미상"}</span>
                        <time dateTime={publishedAt}>{formatNewsDate(publishedAt)}</time>
                        <span className={`explorer-importance importance-level-${issue.importance}`}>{importanceLabel(issue.importance)}</span>
                        {issue.sources.length > 1 && <span>원문 {issue.sources.length}개</span>}
                      </div>
                    </div>
                    <ArrowUpRight className="news-explorer-row-arrow" size={19} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        {totalPages > 1 && (
          <nav
            className="news-explorer-pagination"
            aria-label="뉴스 결과 페이지"
          >
            <button
              type="button"
              disabled={activePage === 1}
              onClick={() => movePage(activePage - 1)}
              aria-label="이전 결과 페이지"
            >
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            {firstPage > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => movePage(1)}
                  aria-label="첫 페이지"
                >
                  1
                </button>
                {firstPage > 2 && <span aria-hidden="true">…</span>}
              </>
            )}
            {pageNumbers.map((number) => (
              <button
                type="button"
                key={number}
                onClick={() => movePage(number)}
                aria-label={`${number}페이지`}
                aria-current={number === activePage ? "page" : undefined}
              >
                {number}
              </button>
            ))}
            {firstPage + pageNumbers.length - 1 < totalPages && (
              <>
                {firstPage + pageNumbers.length < totalPages && (
                  <span aria-hidden="true">…</span>
                )}
                <button
                  type="button"
                  onClick={() => movePage(totalPages)}
                  aria-label="마지막 페이지"
                >
                  {totalPages}
                </button>
              </>
            )}
            <button
              type="button"
              disabled={activePage >= totalPages}
              onClick={() => movePage(activePage + 1)}
              aria-label="다음 결과 페이지"
            >
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </nav>
        )}
      </section>
      <p className="news-explorer-footnote">
        뉴스 데이터는 주기적으로 확인합니다. 실제 발표 내용과 조건은 각 원문에서
        확인해 주세요.
      </p>
    </>
  );
}

export default function NewsExplorer() {
  const params = useSearchParams();
  const importance = Number(params.get("importance") || 0);
  const requestedGrade = Number(params.get("grade") || 0);
  const grade = [1, 2, 3, 4, 5].includes(requestedGrade) ? requestedGrade : importance === 5 ? 5 : 0;
  const rawDate = params.get("date") || "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && newsDateKey(`${rawDate}T12:00:00+09:00`) === rawDate ? rawDate : "";
  const initial: InitialFilters = {
    query: params.get("q") || "",
    keyword: params.get("keyword") || "",
    importance: grade ? 0 : [0, 3, 4].includes(importance) ? importance : 0,
    sort: params.get("sort") === "importance" ? "importance" : "latest",
    date,
    grade,
  };
  return (
    <ExplorerContent
      key={JSON.stringify(initial)}
      initial={initial}
      selectedId={params.get("issue")}
      articleId={params.get("article")}
    />
  );
}
