"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, BookOpen, Search, X } from "lucide-react";
import { research } from "@/data/research";

const categories = [
  "전체",
  "LLM",
  "AI Agent",
  "산업 동향",
  "Local LLM",
  "RAG",
  "연구 논문",
  "프로젝트 아이디어",
];

export function ResearchList({
  initialCategory = "전체",
  initialQuery = "",
}: {
  initialCategory?: string;
  initialQuery?: string;
}) {
  const [category, setCategory] = useState(
    categories.includes(initialCategory) ? initialCategory : "전체",
  );
  const [query, setQuery] = useState(initialQuery);

  const filtered = useMemo(
    () =>
      research.filter((item) => {
        const matchesCategory =
          category === "전체" ||
          item.category === category ||
          item.tags.includes(category);
        const text =
          `${item.title} ${item.subtitle} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
        return matchesCategory && text.includes(query.trim().toLowerCase());
      }),
    [category, query],
  );

  return (
    <main id="main-content" className="secondary-page research-index">
      <section className="secondary-hero">
        <p className="secondary-eyebrow">
          <span /> THE RESEARCH LIBRARY
        </p>
        <div className="secondary-heading-row">
          <div>
            <h1>
              질문에서 시작하는 <em>리서치.</em>
            </h1>
            <p>
              AI의 변화를 읽고, 직접 실험하고, 다음 프로젝트의 가능성을
              찾습니다.
            </p>
          </div>
          <span className="secondary-quiet-note">
            <BookOpen size={15} /> {research.length}개의 리서치 노트
          </span>
        </div>
      </section>

      <div className="research-controls">
        <div className="research-filters" aria-label="리서치 주제 필터">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? "is-active" : ""}
              onClick={() => setCategory(item)}
              aria-pressed={category === item}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="research-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="리서치 검색"
            aria-label="리서치 검색"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              <X size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="research-result-count">
        <span>
          {category === "전체" ? "모든 리서치" : category}{" "}
          <b>{filtered.length}</b>
        </span>
        <span>
          최근 작성순 <ArrowDown size={12} />
        </span>
      </div>
      <div className="research-grid">
        {filtered.map((item, index) => (
          <Link
            className={`research-card${index === 0 && category === "전체" && !query ? " research-card-featured" : ""}`}
            key={item.id}
            href={`/research/${item.id}`}
          >
            <div
              className="research-card-image"
              style={{ backgroundImage: `url(${item.image})` }}
            >
              <span className="research-category">{item.category}</span>
              <span className="research-open">
                <ArrowUpRight size={20} />
              </span>
            </div>
            <div className="research-card-body">
              <p className="research-card-meta">
                {item.date}
                <span />
                {item.readTime} 읽기
              </p>
              <h2>{item.title}</h2>
              <p className="research-card-summary">{item.summary}</p>
              <div className="research-card-tags">
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!filtered.length && (
        <div className="research-empty">
          <Search size={28} />
          <h2>일치하는 리서치가 없습니다.</h2>
          <p>다른 검색어를 입력하거나 전체 주제를 살펴보세요.</p>
          <button
            type="button"
            onClick={() => {
              setCategory("전체");
              setQuery("");
            }}
          >
            전체 리서치 보기
          </button>
        </div>
      )}
      <p className="secondary-demo-note">
        포트폴리오 데모 · 리서치 내용과 날짜는 예시 데이터입니다.
      </p>
    </main>
  );
}
