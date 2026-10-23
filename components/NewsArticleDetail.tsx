"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ChevronDown, FileText, Home, MessageCircle, Search } from "lucide-react";
import ArticleChat from "@/components/ArticleChat";
import ArticleComments from "@/components/ArticleComments";
import { articleHref, relatedNews, type ArticleReference } from "@/lib/related-news";
import { articlePresentation, articleTitle, compactNewsDate, repeatsText, sourceIntroduction } from "@/lib/news-presentation";
import type { NewsIssue } from "@/types/news";

type DetailTab = "ai" | "related" | "comments";
const TABS: { id: DetailTab; label: string }[] = [
  { id: "ai", label: "AI에게 질문" },
  { id: "related", label: "관련 기사" },
  { id: "comments", label: "댓글" },
];

function RelatedArticles({ articles, closeHref }: { articles: ArticleReference[]; closeHref: string }) {
  return <ul className="article-related-list">{articles.map(({ issue, source }) => (
    <li key={source.id}><Link href={articleHref(issue, source, closeHref)} className="article-related-link">
      <div><h4>{articleTitle(issue, source)}</h4><p><span>{source.source}</span><time dateTime={source.publishedAt}>{compactNewsDate(source.publishedAt)}</time><span>중요도 {source.importance ?? issue.importance}</span></p></div>
      <ArrowUpRight size={19} aria-hidden="true" />
    </Link></li>
  ))}</ul>;
}

export default function NewsArticleDetail({ current, issues, closeHref }: {
  current: ArticleReference; issues: NewsIssue[]; closeHref: string;
}) {
  const { issue, source } = current;
  const [tab, setTab] = useState<DetailTab>("ai");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const panelId = useId();
  const related = useMemo(() => relatedNews(issues, current), [issues, current]);
  const content = useMemo(() => articlePresentation(issue, source), [issue, source]);
  const importance = source.importance ?? issue.importance;
  const alreadyShown = [...content.summary, ...content.why, ...content.developerImpact, ...content.facts];
  const limitedContent = /no_content|blocked|denied|forbidden|paywall|restricted|failed|error|unavailable|robots/i.test(source.analysis?.contentStatus || "");

  function activateTab(index: number) {
    const next = (index + TABS.length) % TABS.length;
    setTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return <>
    <article id="issue-detail" className="evan-article" aria-labelledby="article-title">
      <Link href={closeHref} className="article-back"><ArrowLeft size={18} aria-hidden="true" /> 뉴스 목록</Link>
      <header className="article-heading">
        <div className="article-labels"><span className={`article-importance importance-level-${importance}`}>중요도 {importance}</span>{issue.category && issue.category !== "기타" && <span>{issue.category}</span>}</div>
        <h1 id="article-title">{content.title}</h1>
        <div className="article-byline"><span>{source.source}</span><time dateTime={source.publishedAt}>{compactNewsDate(source.publishedAt)}</time></div>
      </header>
      {content.summary.length > 0 && <section className="article-summary-card" aria-labelledby="article-summary-title">
        <h2 id="article-summary-title">핵심 요약</h2><p>{content.summary.join(" ")}</p>
        {limitedContent && <p className="article-analysis-warning">본문 수집이 제한된 기사입니다. 원문에서 내용을 확인해 주세요.</p>}
      </section>}
      {content.event.length > 0 && <section className="article-event article-reading-section" aria-labelledby="article-event-title">
        <h2 id="article-event-title">이번 사건의 핵심</h2><dl>{content.event.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      </section>}
      {content.why.length > 0 && <section className="article-reading-section" aria-labelledby="article-why-title"><h2 id="article-why-title">왜 중요한가?</h2>{content.why.map((text) => <p key={text}>{text}</p>)}</section>}
      {content.developerImpact.length > 0 && <section className="article-reading-section" aria-labelledby="article-impact-title"><h2 id="article-impact-title">개발자 영향</h2>{content.developerImpact.map((text) => <p key={text}>{text}</p>)}</section>}
      {(content.facts.length > 0 || content.watchPoints.length > 0) && <details className="article-extra-analysis">
        <summary>추가 근거와 관찰 포인트 <ChevronDown size={19} aria-hidden="true" /></summary>
        {content.facts.length > 0 && <section><h3>핵심 사실</h3><ul>{content.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul></section>}
        {content.watchPoints.length > 0 && <section><h3>앞으로 주목할 부분</h3><ul>{content.watchPoints.map((point) => <li key={point}>{point}</li>)}</ul></section>}
      </details>}
      <section className="article-source-section article-reading-section" aria-labelledby="article-sources-title">
        <h2 id="article-sources-title">원문 기사</h2>
        <ul className="article-source-list">{issue.sources.map((item) => {
          const title = articleTitle(issue, item);
          const showTitle = !repeatsText(title, content.title);
          const introduction = item.id === source.id ? "" : sourceIntroduction(item, alreadyShown);
          return <li key={item.id}>
            {showTitle && <h3 className="article-source-title">{title}</h3>}
            <div className="article-source-footer"><p><strong>{item.source}</strong><time dateTime={item.publishedAt}>{compactNewsDate(item.publishedAt)}</time></p><a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.source} 원문 보기: ${item.title}`}>원문 보기 <ArrowUpRight size={16} aria-hidden="true" /></a></div>
            {introduction && <p className="article-source-intro">{introduction}</p>}
          </li>;
        })}</ul>
      </section>
      <section className="article-conversation" aria-label="뉴스 탐색과 대화">
        <div role="tablist" aria-label="기사 탐색" className="article-tabs">
          {TABS.map(({ id, label }, index) => <button key={id} ref={(element) => { tabRefs.current[index] = element; }} id={`${panelId}-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`${panelId}-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); activateTab(index + 1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); activateTab(index - 1); }
            if (event.key === "Home") { event.preventDefault(); activateTab(0); }
            if (event.key === "End") { event.preventDefault(); activateTab(TABS.length - 1); }
          }}>{label}</button>)}
        </div>
        <div className="article-tab-panel" id={`${panelId}-panel-ai`} role="tabpanel" aria-labelledby={`${panelId}-tab-ai`} hidden={tab !== "ai"} tabIndex={0}><ArticleChat articleId={source.id} issueId={issue.id} /></div>
        <div className="article-tab-panel article-related-panel" id={`${panelId}-panel-related`} role="tabpanel" aria-labelledby={`${panelId}-tab-related`} hidden={tab !== "related"} tabIndex={0}>
          {related.sameEvent.length > 0 && <section><h3>동일 사건의 다른 보도</h3><RelatedArticles articles={related.sameEvent} closeHref={closeHref} /></section>}
          {related.related.length > 0 && <section><h3>연관 뉴스</h3><RelatedArticles articles={related.related} closeHref={closeHref} /></section>}
          {related.past.length > 0 && <section><h3>과거 뉴스</h3><RelatedArticles articles={related.past} closeHref={closeHref} /></section>}
          {!related.sameEvent.length && !related.related.length && !related.past.length && <p className="article-related-empty">현재 뉴스에서 연결할 관련 기사를 찾지 못했습니다.</p>}
        </div>
        <div className="article-tab-panel" id={`${panelId}-panel-comments`} role="tabpanel" aria-labelledby={`${panelId}-tab-comments`} hidden={tab !== "comments"} tabIndex={0}><ArticleComments articleId={source.id} /></div>
      </section>
    </article>
    <nav className="article-mobile-nav" aria-label="모바일 하단 메뉴">
      <Link href="/"><Home size={21} aria-hidden="true" /><span>홈</span></Link>
      <Link href="/news" aria-current="page"><Search size={21} aria-hidden="true" /><span>뉴스</span></Link>
      <Link href="/research"><FileText size={21} aria-hidden="true" /><span>리서치</span></Link>
      <Link href="/about"><MessageCircle size={21} aria-hidden="true" /><span>소개</span></Link>
    </nav>
  </>;
}
