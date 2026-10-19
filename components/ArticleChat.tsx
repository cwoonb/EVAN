"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, RotateCcw, Send, Square } from "lucide-react";
import { CommunityAuthPanel } from "@/components/ArticleComments";
import { useCommunitySession, type CommunitySessionState } from "@/lib/community-client";
import type { ChatAnswer, ChatMessage, ChatScope, ChatSource } from "@/types/chat";

const conversations = new Map<string, ChatMessage[]>();
const quickQuestions = [
  "이 뉴스의 핵심은 뭐야?",
  "개발자 입장에서 어떻게 활용할 수 있어?",
  "다른 관점이나 확인할 점은 없어?",
  "관련 기사를 찾아서 비교해 줘.",
];

function apiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_EVAN_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.protocol !== "https:" && !(process.env.NODE_ENV === "development" && local && url.protocol === "http:")) return null;
    if (local && process.env.NODE_ENV !== "development") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isSource(value: unknown): value is ChatSource {
  if (!value || typeof value !== "object") return false;
  const item = value as ChatSource;
  if (typeof item.url !== "string") return false;
  try {
    const url = new URL(item.url);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password &&
      typeof item.id === "string" && typeof item.title === "string" &&
      typeof item.source === "string" && typeof item.publishedAt === "string" &&
      ["body", "analysis", "title"].includes(item.evidenceKind) &&
      Number.isInteger(item.citationNumber) && item.citationNumber > 0;
  } catch {
    return false;
  }
}

function responseAnswer(value: unknown): ChatAnswer {
  if (!value || typeof value !== "object") throw new Error("AI 응답을 확인하지 못했습니다. 다시 시도해주세요.");
  const answer = value as ChatAnswer;
  if (typeof answer.answer !== "string" || !answer.answer.trim() || answer.answer.length > 12_000 || !Array.isArray(answer.sources) || answer.sources.length > 6 || !answer.sources.every(isSource)) {
    throw new Error("AI 응답을 확인하지 못했습니다. 다시 시도해주세요.");
  }
  return answer;
}

function requestHistory(messages: ChatMessage[], question: string) {
  const recent = messages.slice(-8).map(({ role, content }) => ({ role, content: content.slice(0, 2_000) }));
  while (recent.reduce((size, item) => size + item.content.length, question.length) > 10_000) recent.splice(0, 2);
  return [...recent, { role: "user" as const, content: question }];
}

export default function ArticleChat({ articleId, issueId }: { articleId: string; issueId: string }) {
  const community = useCommunitySession();
  const owner = `${community.session?.user.id ?? "visitor"}:${articleId}`;
  return <ArticleChatSession key={owner} articleId={articleId} issueId={issueId} owner={owner} community={community} />;
}

function ArticleChatSession({ articleId, issueId, owner, community }: { articleId: string; issueId: string; owner: string; community: CommunitySessionState }) {
  const { session, loading: sessionLoading, configured } = community;
  const [conversation, setConversation] = useState<{ owner: string; messages: ChatMessage[] }>({ owner, messages: conversations.get(owner) ?? [] });
  const [scope, setScope] = useState<ChatScope>("article");
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const end = useRef<HTMLDivElement>(null);
  const origin = apiOrigin();
  const messages = conversation.owner === owner ? conversation.messages : conversations.get(owner) ?? [];
  const canAsk = !!origin && configured && !!session && !sessionLoading;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  useEffect(() => {
    if (busy || messages.length) end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [busy, messages.length]);

  async function ask(question = input) {
    const text = question.trim();
    if (!canAsk || !session || !origin || controller.current || !text || text.length > 2_000) return;
    const aborter = new AbortController();
    controller.current = aborter;
    const submittedOwner = owner;
    setPendingQuestion(text);
    setInput("");
    setBusy(true);
    setError(null);
    const timeout = setTimeout(() => aborter.abort("timeout"), 100_000);
    try {
      const response = await fetch(`${origin}/v1/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ articleId, issueId, scope, messages: requestHistory(messages, text) }),
        signal: aborter.signal,
        cache: "no-store",
        credentials: "omit",
      });
      if (!response.ok) {
        if (response.status === 401) throw new Error("로그인이 만료됐습니다. 로그아웃 후 다시 로그인해주세요.");
        if (response.status === 429) throw new Error("질문 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.");
        if (response.status === 404) throw new Error("기사가 갱신됐습니다. 최신 뉴스를 불러온 뒤 다시 질문해주세요.");
        if (response.status === 503) throw new Error("AI 서버가 준비 중이거나 사용 중입니다. 잠시 후 다시 시도해주세요.");
        if (response.status === 400 || response.status === 413) throw new Error("질문이나 대화가 너무 깁니다. 새 대화를 시작해주세요.");
        throw new Error("AI 답변을 받지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
      const answer = responseAnswer(await response.json());
      const next: ChatMessage[] = [...messages, { role: "user", content: text }, { role: "assistant", content: answer.answer, sources: answer.sources }];
      if (mounted.current && !aborter.signal.aborted) {
        conversations.set(submittedOwner, next.slice(-40));
        setConversation({ owner: submittedOwner, messages: next.slice(-40) });
        setPendingQuestion("");
      }
    } catch (failure) {
      if (!mounted.current) return;
      if (aborter.signal.aborted) setError(aborter.signal.reason === "timeout" ? "응답 시간이 초과됐습니다. 다시 시도해주세요." : "답변 요청을 취소했습니다.");
      else setError(failure instanceof TypeError ? "AI 서버에 연결하지 못했습니다. 네트워크와 서버 상태를 확인해주세요." : failure instanceof Error ? failure.message : "AI 요청에 실패했습니다.");
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  function clearConversation() {
    controller.current?.abort();
    conversations.delete(owner);
    setConversation({ owner, messages: [] });
    setPendingQuestion("");
    setError(null);
  }

  if (!origin || !configured) {
    return <section className="article-chat" aria-label="기사 AI 대화">
      <div className="article-chat-heading"><div><h3>AI에게 질문</h3></div></div>
      <div className="article-service-notice" role="status"><strong>대화 연결 준비 중</strong><p>연결이 완료되면 기사에 대해 질문할 수 있습니다. 지금은 핵심 요약과 관련 기사를 확인해주세요.</p></div>
    </section>;
  }

  if (!session && !sessionLoading) {
    return <section className="article-chat" aria-label="기사 AI 대화"><div className="article-chat-heading"><div><h3>AI에게 질문</h3><p>로그인하면 기사 근거를 바탕으로 대화할 수 있습니다.</p></div></div><CommunityAuthPanel /></section>;
  }

  if (sessionLoading) return <section className="article-chat" aria-label="기사 AI 대화"><p className="chat-connection" role="status">로그인 상태 확인 중…</p></section>;

  return (
    <section className="article-chat" aria-label="기사 AI 대화">
      <div className="article-chat-heading">
        <div><h3>기사에 대해 물어보세요</h3><p>뉴스 근거와 AI 해석을 구분해 답합니다.</p></div>
        {messages.length > 0 && <button type="button" className="chat-reset" onClick={clearConversation} disabled={busy}>새 대화</button>}
      </div>
      <label className="chat-scope-label" htmlFor={`chat-scope-${articleId}`}>근거 검색 범위</label>
      <select id={`chat-scope-${articleId}`} className="chat-scope" value={scope} onChange={(event) => setScope(event.target.value as ChatScope)} disabled={busy}>
        <option value="article">현재 기사</option><option value="issue">관련 이슈 · 과거 뉴스</option><option value="all">전체 EVAN 뉴스</option>
      </select>
      <p className="chat-scope-note">현재 저장된 뉴스에서 검색합니다. 관련 보도가 없으면 찾지 못했다고 안내합니다.</p>
      <div className="chat-quick-questions" aria-label="빠른 질문">
        {quickQuestions.map((question) => <button type="button" key={question} disabled={!canAsk || busy} onClick={() => void ask(question)}>{question}</button>)}
      </div>
      <div className="article-chat-messages" aria-live="polite" aria-relevant="additions text" aria-busy={busy}>
        {messages.length === 0 && !pendingQuestion && <p className="chat-empty">핵심 요약, 기술 차이, 개발자 영향부터 질문해보세요. 독자 댓글은 뉴스 근거로 사용하지 않습니다.</p>}
        {messages.map((message, index) => <div key={index} className={`article-chat-message article-chat-message-${message.role}`}>
          <span className="chat-message-author">{message.role === "user" ? "나" : "EVAN AI"}</span>
          <p>{message.content}</p>
          {!!message.sources?.length && <ul className="chat-source-list" aria-label="답변 근거">
            {message.sources.map((source) => <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer"><span className="chat-citation-number">[{source.citationNumber}]</span><span><strong>{source.title}</strong><small>{source.source} · {source.evidenceKind === "body" ? "수집 본문 참고" : source.evidenceKind === "analysis" ? "기존 AI 분석 참고 · 본문 미확인" : "제목만 확인 · 본문 미수집"}</small></span><ArrowUpRight size={16} aria-hidden="true" /></a></li>)}
          </ul>}
        </div>)}
        {pendingQuestion && <div className="article-chat-message article-chat-message-user"><span className="chat-message-author">나</span><p>{pendingQuestion}</p></div>}
        {busy && <div className="chat-answer-loading" role="status"><LoaderCircle size={17} className="chat-spinner" aria-hidden="true" />뉴스 근거를 확인하고 있습니다…</div>}
        <div ref={end} />
      </div>
      {error && <div className="chat-error" role="alert"><p>{error}</p>{pendingQuestion && <button type="button" onClick={() => void ask(pendingQuestion)} disabled={busy || !canAsk}><RotateCcw size={15} aria-hidden="true" />다시 시도</button>}</div>}
      <form className="article-chat-form" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <label className="sr-only" htmlFor={`chat-question-${articleId}`}>AI에게 질문</label>
        <textarea id={`chat-question-${articleId}`} value={input} onChange={(event) => setInput(event.target.value)} placeholder={canAsk ? "이 기사에 대해 궁금한 점을 입력하세요…" : "AI 연결과 로그인 완료 후 질문할 수 있습니다"} maxLength={2_000} rows={2} disabled={!canAsk || busy} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void ask(); } }} />
        {busy ? <button className="article-chat-send" type="button" onClick={() => controller.current?.abort()} aria-label="답변 요청 취소"><Square size={18} aria-hidden="true" /></button> : <button className="article-chat-send" type="submit" disabled={!canAsk || !input.trim()} aria-label="질문 보내기"><Send size={19} aria-hidden="true" /></button>}
      </form>
      <p className="chat-input-note">{input.length.toLocaleString()} / 2,000자 · AI 답변은 원문 출처와 함께 확인하세요.</p>
    </section>
  );
}
