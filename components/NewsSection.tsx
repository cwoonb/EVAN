"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Crown,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  filterIssues,
  formatNewsDate,
  issueHref,
  issueImage,
  useNewsFeed,
} from "@/lib/news-feed";
import type { NewsIssue } from "@/types/news";

function dateKey(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function displayDay(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${value}T12:00:00+09:00`));
}

function NewsCard({
  issue,
  priority,
}: {
  issue: NewsIssue;
  priority: boolean;
}) {
  const size =
    issue.importance === 5
      ? "lead"
      : issue.importance === 4
        ? "medium"
        : "small";
  const source = issue.sources[0]?.source || "수집된 기사";
  const summary = issue.summary;
  const plain = (value: string) => value.replace(/[\s.。]+/g, "").toLowerCase();
  const showSummary =
    issue.importance >= 4 && plain(summary) !== plain(issue.title);
  return (
    <Link
      href={issueHref(issue)}
      className={`news-card live-news-card news-card-${size} importance-${issue.importance}`}
      aria-label={`${issue.title}, 중요도 ${issue.importance}, 통합 이슈와 원문 ${issue.sources.length}개 보기`}
    >
      <Image
        className="news-image"
        src={issueImage(issue)}
        alt=""
        fill
        preload={priority}
        sizes={
          issue.importance === 5
            ? "(max-width: 700px) 100vw, 50vw"
            : issue.importance === 4
              ? "(max-width: 700px) 100vw, 30vw"
              : "(max-width: 700px) 100vw, 25vw"
        }
      />
      <div className="news-overlay" />
      <div className="news-importance">
        <span className="importance-badge">
          <Crown
            size={issue.importance === 5 ? 15 : 12}
            fill="currentColor"
            strokeWidth={1.4}
            aria-hidden="true"
          />{" "}
          중요도 {issue.importance}
        </span>
        <span className="importance-caption">
          {issue.importance === 5
            ? "가장 중요한 뉴스"
            : issue.importance === 4
              ? "주목할 뉴스"
              : "주요 뉴스"}
        </span>
      </div>
      <div className="news-copy">
        <span className="category-label">{issue.category}</span>
        <h2>{issue.title}</h2>
        {showSummary && <p>{summary}</p>}
        <div className="news-meta">
          <span>
            <time dateTime={issue.updatedAt}>
              {formatNewsDate(issue.updatedAt)}
            </time>
            <span className="meta-dot">·</span>
            {source}
            {issue.sources.length > 1
              ? ` 외 ${issue.sources.length - 1}개 기사`
              : ""}
          </span>
          <span className="card-arrow" aria-hidden="true">
            <ArrowRight
              size={issue.importance === 5 ? 21 : 18}
              strokeWidth={1.6}
            />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function NewsSection() {
  const { feed, loading, error, refresh } = useNewsFeed();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const importantIssues = useMemo(
    () =>
      filterIssues(feed?.issues || [], { importance: 3, sort: "importance" }),
    [feed],
  );
  const dates = useMemo(
    () =>
      [...new Set(importantIssues.map((issue) => dateKey(issue.updatedAt)))]
        .sort()
        .reverse(),
    [importantIssues],
  );
  const activeDate =
    selectedDate && dates.includes(selectedDate) ? selectedDate : dates[0];
  const dateIndex = dates.indexOf(activeDate);
  const dateIssues = importantIssues.filter(
    (issue) => dateKey(issue.updatedAt) === activeDate,
  );
  const pages: NewsIssue[][] = [];
  const remaining = [...dateIssues];
  while (remaining.length) {
    const selected: NewsIssue[] = [];
    for (const [score, limit] of [
      [5, 1],
      [4, 2],
      [3, 3],
    ]) {
      for (let count = 0; count < limit; count++) {
        const index = remaining.findIndex(
          (issue) => issue.importance === score,
        );
        if (index < 0) break;
        selected.push(...remaining.splice(index, 1));
      }
    }
    selected.push(...remaining.splice(0, 6 - selected.length));
    pages.push(selected.sort((a, b) => b.importance - a.importance));
  }
  const pageCount = Math.max(1, pages.length);
  const activePage = Math.min(page, pageCount - 1);
  const visibleIssues = pages[activePage] || [];

  function moveDate(step: number) {
    const next = dates[dateIndex + step];
    if (next) {
      setSelectedDate(next);
      setPage(0);
    }
  }

  return (
    <section
      className="news-section live-news-section"
      aria-labelledby="news-heading"
    >
      <div className="news-section-heading">
        <div>
          <div className="section-kicker">
            <span className="status-dot" /> THE AI BRIEFING
          </div>
          <h1 id="news-heading">
            오늘의 <span>AI 뉴스</span>
            <span className="title-period">.</span>
          </h1>
          <p>
            실제 기사에서 같은 사건을 묶고, 중요한 변화부터 깊이 있게
            살펴봅니다.
          </p>
        </div>
        <div className="news-controls">
          <div className="news-date">
            <span className="live-feed-label">수집된 AI 뉴스</span>
            {activeDate ? (
              <time dateTime={activeDate} aria-live="polite">
                {displayDay(activeDate)}
              </time>
            ) : (
              <span>브리핑 준비 중</span>
            )}
          </div>
          <div className="carousel-buttons">
            <button
              type="button"
              className="round-button"
              onClick={() => moveDate(1)}
              disabled={dateIndex < 0 || dateIndex >= dates.length - 1}
              aria-label="이전 날짜 뉴스"
            >
              <ArrowLeft size={19} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="round-button"
              onClick={() => moveDate(-1)}
              disabled={dateIndex <= 0}
              aria-label="다음 날짜 뉴스"
            >
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
      {error && (
        <div className="live-feed-alert" role="status">
          <span>
            {feed
              ? "새 데이터를 받지 못해 마지막으로 불러온 뉴스를 표시합니다."
              : "뉴스를 불러오지 못했습니다."}
          </span>
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
        <div className="live-news-loading" role="status">
          <LoaderCircle className="spin" size={22} aria-hidden="true" />
          <p>최신 AI 뉴스를 불러오고 있습니다.</p>
        </div>
      ) : !visibleIssues.length ? (
        <div className="live-news-empty">
          <p>
            {feed
              ? "이 날짜에 표시할 주요 뉴스가 없습니다."
              : "뉴스 데이터를 기다리고 있습니다."}
          </p>
          <Link href="/news">
            중요도 1–5 전체 뉴스 보기{" "}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div
          className="news-carousel live-news-carousel"
          role="region"
          aria-label="중요도 3 이상 AI 뉴스, 좌우 방향키로 날짜 이동"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              moveDate(event.key === "ArrowLeft" ? 1 : -1);
            }
          }}
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            touchStart.current = { x: touch.clientX, y: touch.clientY };
          }}
          onTouchEnd={(event) => {
            if (touchStart.current) {
              const touch = event.changedTouches[0];
              const x = touch.clientX - touchStart.current.x;
              const y = touch.clientY - touchStart.current.y;
              if (Math.abs(x) > Math.max(55, Math.abs(y) * 1.5))
                moveDate(x > 0 ? 1 : -1);
            }
            touchStart.current = null;
          }}
          onTouchCancel={() => {
            touchStart.current = null;
          }}
        >
          <div className="news-grid live-news-grid">
            {visibleIssues.map((issue, index) => (
              <NewsCard
                issue={issue}
                priority={activePage === 0 && index < 2}
                key={issue.id}
              />
            ))}
          </div>
        </div>
      )}
      <div className="news-section-bottom live-news-bottom">
        <span>
          {feed ? (
            <>
              갱신{" "}
              <time dateTime={feed.generatedAt}>
                {formatNewsDate(feed.generatedAt)}
              </time>
              {loading ? " · 확인 중" : ""}
            </>
          ) : (
            "중요도 3 이상 뉴스부터 표시합니다."
          )}
        </span>
        <div className="live-news-page-controls">
          {pageCount > 1 && (
            <>
              <button
                type="button"
                onClick={() => setPage(Math.max(0, activePage - 1))}
                disabled={activePage === 0}
                aria-label="이전 뉴스 페이지"
              >
                <ArrowLeft size={15} aria-hidden="true" />
              </button>
              <span aria-live="polite">
                {activePage + 1} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, activePage + 1))}
                disabled={activePage >= pageCount - 1}
                aria-label="다음 뉴스 페이지"
              >
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </>
          )}
          <Link className="live-news-explore" href="/news">
            뉴스 전체 탐색 <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
