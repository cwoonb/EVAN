"use client";

import Link from "next/link";
import { ArrowUpRight, FileText, FolderKanban, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { issueHref, useNewsFeed } from "@/lib/news-feed";
import { research } from "@/data/research";
import { projects } from "@/data/projects";

type SearchEntry = {
  id: string;
  title: string;
  summary: string;
  group: "뉴스" | "리서치" | "프로젝트";
  category: string;
  href: string;
  searchText?: string;
};

const entries: SearchEntry[] = [
  ...research.map((item) => ({
    id: `research-${item.id}`,
    title: item.title,
    summary: item.summary,
    group: "리서치" as const,
    category: "",
    href: `/research/${item.id}`,
  })),
  ...projects.map((item) => ({
    id: `project-${item.id}`,
    title: item.title,
    summary: item.description,
    group: "프로젝트" as const,
    category: "",
    href: `/projects/${item.id}`,
  })),
];

type SearchDialogProps = { open: boolean; onClose: () => void };

export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const { feed } = useNewsFeed();
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const resultsId = useId();

  const results = useMemo(() => {
    const allEntries: SearchEntry[] = [
      ...(feed?.issues || []).map((issue) => ({
        id: `news-${issue.id}`,
        title: issue.title,
        summary: issue.summary,
        group: "뉴스" as const,
        category: issue.category,
        href: issueHref(issue),
        searchText: [
          ...issue.keywords,
          ...issue.searchKeywords,
          ...issue.newTechnologies,
          ...Object.values(issue.event),
          ...issue.sources.map((source) => `${source.title} ${source.source}`),
        ].join(" "),
      })),
      ...entries,
    ];
    const value = query.trim().toLocaleLowerCase("ko");
    if (!value) return allEntries.slice(0, 6);
    return allEntries
      .filter((item) =>
        `${item.title} ${item.summary} ${item.category} ${item.group} ${item.searchText || ""}`
          .toLocaleLowerCase("ko")
          .includes(value),
      )
      .slice(0, 50);
  }, [query, feed]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="search-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="search-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="search-dialog-heading">
          <div>
            <p className="search-eyebrow">EXPLORE EVAN</p>
            <h2 id={titleId}>어떤 인사이트를 찾고 있나요?</h2>
          </div>
          <button
            type="button"
            className="search-close"
            aria-label="검색 닫기"
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="search-input-wrap">
          <Search size={20} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="search"
            placeholder="AI 뉴스, 리서치, 프로젝트 검색"
            aria-label="AI 뉴스, 리서치, 프로젝트 검색"
            aria-controls={resultsId}
            autoComplete="off"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-results-meta" role="status" aria-live="polite">
          <span>{query.trim() ? "검색 결과" : "추천 콘텐츠"}</span>
          <span>{results.length}개</span>
        </div>
        <div className="search-results" id={resultsId}>
          {results.length ? (
            <ul>
              {results.map((item) => (
                <li key={item.id}>
                  <Link
                    className="search-result"
                    href={item.href}
                    onClick={() => {
                      setQuery("");
                      onClose();
                    }}
                  >
                    <span className="search-result-icon" aria-hidden="true">
                      {item.group === "프로젝트" ? (
                        <FolderKanban size={19} />
                      ) : (
                        <FileText size={19} />
                      )}
                    </span>
                    <span className="search-result-copy">
                      <span className="search-result-group">
                        {item.group}
                        {item.category ? ` · ${item.category}` : ""}
                      </span>
                      <span className="search-result-title">{item.title}</span>
                      <span className="search-result-summary">
                        {item.summary}
                      </span>
                    </span>
                    <ArrowUpRight
                      className="search-result-arrow"
                      size={18}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="search-empty">
              <Search size={28} aria-hidden="true" />
              <p>일치하는 콘텐츠가 없습니다.</p>
              <span>다른 키워드로 검색해 보세요.</span>
            </div>
          )}
        </div>
        <p className="search-dialog-footer">
          <kbd>Tab</kbd> 콘텐츠 이동 <span>·</span> <kbd>Enter</kbd> 열기{" "}
          <span>·</span> <kbd>Esc</kbd> 닫기
        </p>
      </div>
    </div>
  );
}
