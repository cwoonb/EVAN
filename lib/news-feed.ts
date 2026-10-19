"use client";

import { useSyncExternalStore } from "react";
import { assetPath } from "@/lib/asset-path";
import type { NewsFeed, NewsIssue } from "@/types/news";

type FeedState = {
  feed: NewsFeed | null;
  loading: boolean;
  error: string | null;
};
const initial: FeedState = { feed: null, loading: true, error: null };
let state = initial;
let request: Promise<void> | null = null;
let etag: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function notify(next: FeedState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function isNewsFeed(value: unknown): value is NewsFeed {
  if (!value || typeof value !== "object") return false;
  const feed = value as NewsFeed;
  return (
    feed.version === 1 &&
    typeof feed.revision === "string" &&
    typeof feed.generatedAt === "string" &&
    Number.isFinite(Date.parse(feed.generatedAt)) &&
    !!feed.stats &&
    Array.isArray(feed.issues) &&
    feed.issues.every(
      (issue) =>
        !!issue &&
        typeof issue.id === "string" &&
        typeof issue.title === "string" &&
        typeof issue.summary === "string" &&
        typeof issue.category === "string" &&
        typeof issue.eventType === "string" &&
        [1, 2, 3, 4, 5].includes(issue.importance) &&
        Number.isFinite(Date.parse(issue.publishedAt)) &&
        [issue.keywords, issue.searchKeywords, issue.newTechnologies].every(
          (list) =>
            Array.isArray(list) &&
            list.every((word) => typeof word === "string"),
        ) &&
        !!issue.event &&
        !!issue.analysis &&
        Array.isArray(issue.sources) &&
        issue.sources.length > 0 &&
        issue.sources.every(
          (source) =>
            typeof source.id === "string" &&
            typeof source.title === "string" &&
            typeof source.source === "string" &&
            typeof source.summary === "string" &&
            (source.display === undefined ||
              (!!source.display && typeof source.display.titleKo === "string" &&
                !!source.display.event && ["subject", "action", "object"].every(
                  (field) => typeof source.display?.event[field as keyof typeof source.display.event] === "string",
                ))) &&
            (source.importance === undefined ||
              [1, 2, 3, 4, 5].includes(source.importance)) &&
            (source.analysis === undefined ||
              (!!source.analysis &&
                typeof source.analysis.whyItMatters === "string" &&
                typeof source.analysis.developerImpact === "string" &&
                typeof source.analysis.contentStatus === "string" &&
                [source.analysis.keyFacts, source.analysis.watchPoints].every(
                  (list) => Array.isArray(list) && list.every((item) => typeof item === "string"),
                ))) &&
            /^https?:\/\//i.test(source.url) &&
            Number.isFinite(Date.parse(source.publishedAt)),
        ),
    )
  );
}

export function refreshNewsFeed(): Promise<void> {
  if (request) return request;
  request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        assetPath(`/data/news.json?t=${Date.now()}`),
        {
          cache: "no-store",
          signal: controller.signal,
          headers: etag ? { "If-None-Match": etag } : undefined,
        },
      );
      if (response.status === 304 && state.feed) {
        notify({ ...state, loading: false, error: null });
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed: unknown = await response.json();
      if (!isNewsFeed(feed)) throw new Error("Invalid news feed");
      etag = response.headers.get("etag");
      notify({ feed, loading: false, error: null });
    } catch {
      notify({
        feed: state.feed,
        loading: false,
        error: state.feed
          ? "최신 데이터를 확인하지 못했습니다. 마지막으로 받은 뉴스를 표시합니다."
          : "뉴스 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      clearTimeout(timeout);
      request = null;
    }
  })();
  return request;
}

function refreshWhenVisible() {
  if (document.visibilityState === "visible") void refreshNewsFeed();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshNewsFeed();
    timer = setInterval(() => {
      void refreshNewsFeed();
    }, 60_000);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    }
  };
}

export function useNewsFeed() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => initial,
  );
  return { ...snapshot, refresh: refreshNewsFeed };
}

export function issueHref(issue: Pick<NewsIssue, "id" | "sources">) {
  // An article remains a valid issue anchor when more sources join its group.
  return `/news?issue=${encodeURIComponent(issue.sources[0]?.id || issue.id)}`;
}

export function issueImage(issue: NewsIssue) {
  const words =
    `${issue.title} ${issue.keywords.join(" ")} ${issue.category}`.toLowerCase();
  const image = /nvidia|gpu|반도체|cuda/.test(words)
    ? "chip"
    : /openai|gpt|chatgpt/.test(words)
      ? "openai"
      : /apple|애플/.test(words)
        ? "apple"
        : /agent|에이전트/.test(words)
          ? "agent"
          : /vision|multimodal|멀티모달|이미지|영상/.test(words)
            ? "multimodal"
            : /보안|보호|security|network/.test(words)
              ? "network"
              : /서버|클라우드|infrastructure|data center/.test(words)
                ? "server"
                : "earth";
  return assetPath(`/images/${image}.jpg`);
}

export function formatNewsDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: "Asia/Seoul",
      }).format(date)
    : "날짜 미상";
}

export function filterIssues(
  issues: NewsIssue[],
  options: {
    query?: string;
    keyword?: string;
    importance?: number;
    sort?: "latest" | "importance";
  } = {},
) {
  const words =
    options.query
      ?.trim()
      .toLocaleLowerCase("ko")
      .split(/\s+/)
      .filter(Boolean) || [];
  const keyword = options.keyword?.trim().toLocaleLowerCase("ko");
  return issues
    .filter((issue) => {
      if (issue.importance < (options.importance || 0)) return false;
      const tags = [
        ...issue.keywords,
        ...issue.searchKeywords,
        ...issue.newTechnologies,
      ];
      if (
        keyword &&
        !tags.some((tag) => tag.toLocaleLowerCase("ko") === keyword)
      )
        return false;
      const searchable = [
        issue.title,
        issue.summary,
        issue.category,
        issue.eventType,
        ...tags,
        ...Object.values(issue.event),
        ...issue.sources.map((source) => `${source.title} ${source.source}`),
      ]
        .join(" ")
        .toLocaleLowerCase("ko");
      return words.every((word) => searchable.includes(word));
    })
    .sort((a, b) => {
      if (options.sort === "importance" && a.importance !== b.importance)
        return b.importance - a.importance;
      return (
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.id.localeCompare(b.id)
      );
    });
}
