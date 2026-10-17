"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  Clock3,
  ExternalLink,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import {
  filterIssues,
  formatNewsDate,
  issueImage,
  useNewsFeed,
} from "@/lib/news-feed";
import type { NewsIssue } from "@/types/news";

const PAGE_SIZE = 12;
type SortOrder = "latest" | "importance";
type InitialFilters = {
  query: string;
  keyword: string;
  importance: number;
  sort: SortOrder;
};

function analysisStatusLabel(status: string) {
  if (status === "ok") return "기존 기사 분석 반영";
  if (status.includes("partial")) return "일부 기사 분석 미완료";
  if (status.includes("failed")) return "분석 미완료 · 원문 확인 필요";
  return "분석 상태 확인 필요";
}

function summaryMethodLabel(method: string) {
  return method.includes("qwen")
    ? "기존 Qwen 요약 재사용 · 중복 문장 제거 후 통합"
    : "수집된 기사 요약 재사용";
}

function groupingMethodLabel(method: string) {
  return method.includes("event")
    ? "주체·행동·대상 등 사건 정보 대조"
    : "수집된 기사 정보 대조";
}

function IssueDetail({
  issue,
  closeHref,
}: {
  issue: NewsIssue;
  closeHref: string;
}) {
  const fields = [
    { label: "주체", value: issue.event.subject },
    { label: "행동", value: issue.event.action },
    { label: "대상", value: issue.event.object },
    { label: "버전", value: issue.event.version },
    { label: "사건 날짜", value: issue.event.date },
  ];
  return (
    <article
      id="issue-detail"
      className="news-issue-detail"
      tabIndex={-1}
      aria-labelledby="issue-detail-title"
    >
      <div className="news-detail-topline">
        <span>
          <Layers3 size={15} aria-hidden="true" /> 같은 사건의 기사{" "}
          {issue.sources.length}개
        </span>
        <Link
          href={closeHref}
          scroll={false}
          className="news-detail-close"
          aria-label="이슈 상세 닫고 뉴스 목록 보기"
        >
          <X size={18} aria-hidden="true" /> 목록
        </Link>
      </div>
      <div className="news-detail-heading">
        <span
          className={`explorer-importance importance-level-${issue.importance}`}
        >
          중요도 {issue.importance}
        </span>
        <span>{issue.category}</span>
        <span>{issue.eventType}</span>
        <h2 id="issue-detail-title">{issue.title}</h2>
        {issue.event.summary && issue.event.summary !== issue.summary && (
          <p className="news-event-summary">{issue.event.summary}</p>
        )}
        <div className="news-detail-dates">
          <span>
            <Clock3 size={13} aria-hidden="true" /> 최초 기사{" "}
            <time dateTime={issue.publishedAt}>
              {formatNewsDate(issue.publishedAt)}
            </time>
          </span>
          <span>
            이슈 갱신{" "}
            <time dateTime={issue.updatedAt}>
              {formatNewsDate(issue.updatedAt)}
            </time>
          </span>
        </div>
      </div>
      <div className="news-detail-layout">
        <div className="news-detail-main">
          <section className="news-detail-summary">
            <p className="news-detail-eyebrow">ISSUE BRIEF</p>
            <h3>여러 기사, 하나의 맥락</h3>
            <p>
              {issue.summary ||
                issue.event.summary ||
                "통합 요약을 준비하고 있습니다. 아래 원문을 확인해 주세요."}
            </p>
          </section>
          <section className="news-detail-events">
            <h3>어떤 사건인가요?</h3>
            <dl>
              {fields.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "기사에서 확인되지 않음"}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section
            className="news-detail-sources"
            aria-labelledby="news-source-title"
          >
            <div className="news-detail-section-title">
              <h3 id="news-source-title">원문에서 확인하기</h3>
              <span>{issue.sources.length}개 기사</span>
            </div>
            <p className="news-source-intro">
              각 기사의 제목과 수집된 요약입니다. 원문은 새 탭에서 열립니다.
            </p>
            <ol>
              {issue.sources.map((source, index) => (
                <li key={source.id}>
                  <div className="news-source-meta">
                    <span>
                      {String(index + 1).padStart(2, "0")}{" "}
                      <b>{source.source}</b>
                    </span>
                    <time dateTime={source.publishedAt}>
                      {formatNewsDate(source.publishedAt)}
                    </time>
                  </div>
                  {/^https?:\/\//i.test(source.url) ? (
                    <a
                      className="news-source-link"
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <h4>{source.title}</h4>
                      <ExternalLink size={16} aria-hidden="true" />
                      <span className="visually-hidden">
                        새 탭에서 원문 열기
                      </span>
                    </a>
                  ) : (
                    <h4>{source.title}</h4>
                  )}
                  {source.summary && <p>{source.summary}</p>}
                  {source.searchKeywords.length > 0 && (
                    <div className="news-source-keywords">
                      {source.searchKeywords.map((keyword) => (
                        <span key={keyword}>{keyword}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className="news-detail-aside">
          <section>
            <p className="news-detail-eyebrow">KEYWORDS</p>
            <h3>이슈의 핵심 키워드</h3>
            <div className="news-detail-keywords">
              {issue.keywords.length ? (
                issue.keywords.map((keyword) => (
                  <Link
                    href={`/news?keyword=${encodeURIComponent(keyword)}`}
                    key={keyword}
                  >
                    # {keyword}
                  </Link>
                ))
              ) : (
                <p>키워드를 정리하고 있습니다.</p>
              )}
            </div>
          </section>
          {issue.newTechnologies.length > 0 && (
            <section className="news-new-technologies">
              <Sparkles size={19} aria-hidden="true" />
              <p className="news-detail-eyebrow">TECHNOLOGY WATCH</p>
              <h3>주목할 신기술 후보</h3>
              <p>
                기사에서 추출한 기술명입니다. 새로운 기술인지, 실제 적용할 수
                있는지는 원문 확인이 필요합니다.
              </p>
              <ul>
                {issue.newTechnologies.map((technology) => (
                  <li key={technology}>{technology}</li>
                ))}
              </ul>
            </section>
          )}
          <section className="news-analysis-note">
            <h3>이 요약이 만들어진 방식</h3>
            <dl>
              <div>
                <dt>처리 상태</dt>
                <dd>{analysisStatusLabel(issue.analysis.status)}</dd>
              </div>
              <div>
                <dt>요약 방식</dt>
                <dd>{summaryMethodLabel(issue.analysis.summaryMethod)}</dd>
              </div>
              <div>
                <dt>기사 통합 방식</dt>
                <dd>{groupingMethodLabel(issue.analysis.groupingMethod)}</dd>
              </div>
            </dl>
            <p>
              통합 단계에서 새 AI 추론을 실행하지 않습니다. 기존 요약과 사건
              정보는 원문을 기준으로 확인해 주세요.
            </p>
          </section>
        </aside>
      </div>
    </article>
  );
}

function ExplorerContent({
  initial,
  selectedId,
}: {
  initial: InitialFilters;
  selectedId: string | null;
}) {
  const { feed, loading, error, refresh } = useNewsFeed();
  const [query, setQuery] = useState(initial.query);
  const [keyword, setKeyword] = useState(initial.keyword);
  const [importance, setImportance] = useState(initial.importance);
  const [sort, setSort] = useState<SortOrder>(initial.sort);
  const [page, setPage] = useState(1);
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
      filterIssues(feed?.issues || [], { query, keyword, importance, sort }),
    [feed, query, keyword, importance, sort],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.max(1, Math.min(page, totalPages));
  const visible = filtered.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE,
  );
  const selectedIssue = selectedId
    ? feed?.issues.find(
        (issue) =>
          issue.id === selectedId ||
          issue.sources.some((source) => source.id === selectedId),
      )
    : null;
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
    if (sort !== "latest") params.set("sort", sort);
    if (issueId) params.set("issue", issueId);
    return `/news${params.size ? `?${params.toString()}` : ""}${issueId ? "#issue-detail" : ""}`;
  }

  function clearFilters() {
    setQuery("");
    setKeyword("");
    setImportance(0);
    setSort("latest");
    setPage(1);
  }

  function movePage(value: number) {
    setPage(Math.max(1, Math.min(totalPages, value)));
    document
      .getElementById("news-library-heading")
      ?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  return (
    <>
      <section className="news-explorer-hero">
        <Link className="news-explorer-back" href="/">
          <ArrowLeft size={14} aria-hidden="true" /> 오늘의 브리핑
        </Link>
        <p className="news-explorer-eyebrow">
          <span /> THE AI NEWSROOM
        </p>
        <div className="news-explorer-title-row">
          <div>
            <h1>
              뉴스를 넘어, <em>맥락으로.</em>
            </h1>
            <p>
              키워드로 찾고, 같은 사건을 함께 읽고, 기술의 다음 변화를
              살펴보세요.
            </p>
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
      {selectedIssue && (
        <IssueDetail issue={selectedIssue} closeHref={explorerHref()} />
      )}
      {selectedId && feed && !selectedIssue && (
        <div className="news-issue-missing" role="status">
          <h2>이 이슈를 현재 데이터에서 찾을 수 없습니다.</h2>
          <p>
            이슈가 갱신되었을 수 있습니다. 최신 목록에서 키워드로 다시
            찾아보세요.
          </p>
          <Link href={explorerHref()} scroll={false}>
            뉴스 목록 보기 <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
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
                value={importance}
                onChange={(event) => {
                  setImportance(Number(event.target.value));
                  setPage(1);
                }}
                aria-label="최소 중요도 필터"
              >
                <option value={0}>전체 (1–5)</option>
                <option value={3}>3 이상 · 주요 뉴스</option>
                <option value={4}>4 이상 · 주목할 뉴스</option>
                <option value={5}>5 · 가장 중요한 뉴스</option>
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
          {(query || keyword || importance || sort !== "latest") && (
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
          <div className="news-explorer-grid">
            {visible.map((issue) => (
              <Link
                href={explorerHref(issue.sources[0]?.id || issue.id)}
                key={issue.id}
                className={`news-explorer-card importance-level-${issue.importance}`}
              >
                <div className="news-explorer-card-image">
                  <Image
                    src={issueImage(issue)}
                    alt=""
                    fill
                    sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
                  />
                  <span
                    className={`explorer-importance importance-level-${issue.importance}`}
                  >
                    중요도 {issue.importance}
                    {issue.importance <= 2 ? " · 참고" : ""}
                  </span>
                  <span className="news-explorer-card-arrow">
                    <ArrowUpRight size={19} aria-hidden="true" />
                  </span>
                </div>
                <div className="news-explorer-card-body">
                  <div className="news-explorer-card-meta">
                    <span>{issue.category}</span>
                    <span>기사 {issue.sources.length}개</span>
                  </div>
                  <h3>{issue.title}</h3>
                  <p>{issue.event.summary || issue.summary}</p>
                  <div className="news-explorer-card-keywords">
                    {issue.keywords.slice(0, 3).map((entry) => (
                      <span key={entry}># {entry}</span>
                    ))}
                  </div>
                  <time dateTime={issue.updatedAt}>
                    {formatNewsDate(issue.updatedAt)}
                  </time>
                </div>
              </Link>
            ))}
          </div>
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
  const initial: InitialFilters = {
    query: params.get("q") || "",
    keyword: params.get("keyword") || "",
    importance: [0, 3, 4, 5].includes(importance) ? importance : 0,
    sort: params.get("sort") === "importance" ? "importance" : "latest",
  };
  return (
    <ExplorerContent
      key={JSON.stringify(initial)}
      initial={initial}
      selectedId={params.get("issue")}
    />
  );
}
