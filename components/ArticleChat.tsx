"use client";

import { useEffect, useId, useRef } from "react";
import {
  ArrowUpRight,
  LogIn,
  LoaderCircle,
  UserRound,
  PanelRightOpen,
  RotateCcw,
  Send,
  Square,
} from "lucide-react";
import { requestMemberLogin } from "@/lib/member-session";
import { useAiAccess } from "@/lib/ai-access";
import {
  aiApiOrigin,
  openFloatingAssistant,
  useAiConversation,
  type AssistantContext,
  type ConversationScope,
} from "@/lib/ai-conversation";
import "@/app/news/chat.css";

const prompts = [
  {
    label: "관련 분석",
    article: "관련 기사를 찾아 핵심 차이와 공통점을 분석해 줘.",
    general: "최근 EVAN 뉴스에서 중요한 AI 흐름과 연관 기사를 분석해 줘.",
  },
  {
    label: "산업·관련 기업 영향",
    article:
      "이 뉴스가 산업과 관련 기업에 미칠 영향을 기사 근거와 추론으로 구분해 설명해 줘.",
    general:
      "최근 주요 AI 뉴스가 산업과 관련 기업에 미칠 영향을 기사 근거와 추론으로 구분해 설명해 줘.",
  },
  {
    label: "다른 관점",
    article: "이 기사에 대한 다른 관점과 아직 확인되지 않은 점을 설명해 줘.",
    general:
      "최근 주요 AI 뉴스에서 다른 관점과 아직 확인되지 않은 점을 설명해 줘.",
  },
];

export default function ArticleChat({
  articleId,
  issueId,
}: {
  articleId: string;
  issueId: string;
}) {
  return <AssistantConversation context={{ articleId, issueId }} />;
}

export function AssistantConversation({
  context,
  floating = false,
  seedQuestion,
  seedKey,
  onSeedConsumed,
}: {
  context: AssistantContext;
  floating?: boolean;
  seedQuestion?: string;
  seedKey?: number;
  onSeedConsumed?: () => void;
}) {
  const access = useAiAccess();
  const conversation = useAiConversation(access.owner, context);
  const id = useId();
  const end = useRef<HTMLDivElement>(null);
  const seeded = useRef("");
  const submittedSeed = useRef("");
  const origin = aiApiOrigin();
  const canAsk =
    !!origin && access.configured && !!access.accessToken && !access.loading && access.quota?.remaining !== 0;
  const { messages, busy, input, pendingQuestion, error } = conversation;

  useEffect(() => {
    if (!busy && !messages.length) return;
    const target = end.current;
    if (floating) {
      const panel = target?.closest<HTMLElement>(".assistant-panel-content");
      if (panel?.closest<HTMLDialogElement>("dialog")?.open)
        panel.scrollTo({ top: panel.scrollHeight, behavior: "auto" });
    } else if (!document.querySelector("dialog[open]") && target?.closest(".article-chat")?.contains(document.activeElement)) {
      target.scrollIntoView({ behavior: "auto", block: "nearest" });
    }
  }, [floating, busy, messages.length]);

  useEffect(() => {
    if (!seedQuestion || !seedKey) return;
    const key = `${access.owner}:${seedKey}`;
    if (seeded.current !== key) {
      seeded.current = key;
      conversation.setInput(seedQuestion);
    }
    if (
      canAsk &&
      access.accessToken &&
      !conversation.busy &&
      submittedSeed.current !== key
    ) {
      submittedSeed.current = key;
      void conversation.ask(access.accessToken, seedQuestion);
      onSeedConsumed?.();
    }
  }, [
    seedQuestion,
    seedKey,
    access.owner,
    access.accessToken,
    canAsk,
    conversation,
    onSeedConsumed,
  ]);

  const heading = (
    <div className="article-chat-heading">
      <div>
        <h3>
          {context.articleId
            ? "기사에 대해 물어보세요"
            : "EVAN 뉴스와 함께 생각해보세요"}
        </h3>
        <p>기사 근거와 AI 해석을 구분해 답합니다.</p>
      </div>
      <div className="chat-heading-actions">
        {!floating && (
          <button
            type="button"
            className="chat-popout"
            onClick={() => openFloatingAssistant(context)}
            aria-label="EVAN AI 작은 창에서 대화 이어가기"
          >
            <PanelRightOpen size={18} aria-hidden="true" />
            <span>작게 열기</span>
          </button>
        )}
        {(messages.length > 0 || !!pendingQuestion) && (
          <button
            type="button"
            className="chat-reset"
            onClick={() => {
              submittedSeed.current = String(seedKey);
              conversation.clear();
            }}
          >
            새 대화
          </button>
        )}
      </div>
    </div>
  );

  if (!origin)
    return (
      <section className="article-chat" aria-label="EVAN AI 대화">
        {heading}
        <div className="article-service-notice" role="status">
          <strong>AI 연결 준비 중</strong>
          <p>
            AI 서버 연결이 완료되면 뉴스에 대해 질문할 수 있습니다. 지금은 기사
            요약과 관련 기사를 확인해주세요.
          </p>
        </div>
      </section>
    );
  if (access.loading && !access.accessToken)
    return (
      <section className="article-chat" aria-label="EVAN AI 대화">
        {heading}
        <p className="chat-connection" role="status">
          <LoaderCircle size={16} className="chat-spinner" aria-hidden="true" />{" "}
          접속 상태 확인 중…
        </p>
      </section>
    );
  if (!access.configured)
    return (
      <section className="article-chat" aria-label="EVAN AI 대화">
        {heading}
        <div className="article-service-notice" role="status">
          <strong>AI 서버에 연결하지 못했습니다</strong>
          <p>
            {access.error ||
              "서버가 준비 중이거나 연결이 끊겼습니다. 잠시 후 다시 연결해주세요."}
          </p>
          <button
            className="chat-reset"
            type="button"
            onClick={() => void access.retryConnection()}
            disabled={access.loading}
          >
            <RotateCcw size={15} aria-hidden="true" /> 다시 연결
          </button>
        </div>
      </section>
    );
  if (!access.accessToken)
    return (
      <section className="article-chat" aria-label="EVAN AI 대화">
        {heading}
        <div className="chat-member-prompt">
          <strong>로그인하고 EVAN AI에 질문하세요</strong>
          <p>계정마다 하루 10회 질문할 수 있습니다. 한국 시간 자정에 초기화됩니다.</p>
          {seedQuestion && <p className="chat-queued-question">입력한 질문: {seedQuestion}</p>}
          <button type="button" onClick={() => requestMemberLogin("먼저 로그인을 해주세요")}>
            <LogIn size={17} aria-hidden="true" /> 로그인하고 질문하기
          </button>
        </div>
      </section>
    );

  return (
    <section
      className={`article-chat${floating ? " article-chat-floating" : ""}`}
      aria-label="EVAN AI 대화"
    >
      {heading}
      <div className="chat-access-status">
        <span>
          {access.user?.username} · 오늘 남은 질문 {access.quota?.remaining ?? "확인 중"} / 10회
        </span>
        <button
          type="button"
          onClick={() => requestMemberLogin("내 계정")}
          disabled={access.loading}
        >
          <UserRound size={14} aria-hidden="true" /> 내 계정
        </button>
      </div>
      {access.quota?.remaining === 0 && <p className="chat-daily-limit" role="status">오늘의 AI 질문 10회를 모두 사용했습니다. 한국 시간 자정 이후 다시 질문할 수 있습니다. 댓글과 뉴스 탐색은 계속 이용할 수 있습니다.</p>}
      <label className="chat-scope-label" htmlFor={`${id}-scope`}>
        근거 검색 범위
      </label>
      <select
        id={`${id}-scope`}
        className="chat-scope"
        value={context.articleId ? conversation.scope : "all"}
        onChange={(event) =>
          conversation.setScope(event.target.value as ConversationScope)
        }
        disabled={busy || !context.articleId}
      >
        {context.articleId && (
          <>
            <option value="auto">질문에 맞게 자동 검색</option>
            <option value="article">현재 기사</option>
            <option value="issue">관련 이슈 · 과거 뉴스</option>
          </>
        )}
        <option value="all">전체 EVAN 뉴스</option>
      </select>
      <p className="chat-scope-note">
        {context.articleId
          ? "현재 기사를 중심으로 질문에 맞는 뉴스 근거를 찾습니다."
          : "EVAN에 저장된 전체 뉴스에서 근거를 찾습니다."}{" "}
        독자 댓글은 뉴스 근거로 사용하지 않습니다.
      </p>
      <div className="chat-quick-questions" aria-label="빠른 질문">
        {prompts.map((prompt) => (
          <button
            type="button"
            key={prompt.label}
            disabled={!canAsk || busy}
            onClick={() => {
              if (access.accessToken)
                void conversation.ask(
                  access.accessToken,
                  context.articleId ? prompt.article : prompt.general,
                );
            }}
          >
            {prompt.label}
          </button>
        ))}
      </div>
      <div
        className="article-chat-messages"
        role="log"
        aria-label="AI 대화 내용"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={busy}
      >
        {messages.length === 0 && !pendingQuestion && (
          <p className="chat-empty">
            궁금한 내용을 자유롭게 질문하세요. EVAN에 없는 사실은 확인할 수
            없다고 안내합니다.
          </p>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={`article-chat-message article-chat-message-${message.role}`}
          >
            <span className="chat-message-author">
              {message.role === "user" ? "나" : "EVAN AI"}
            </span>
            <p>{message.content}</p>
            {!!message.sources?.length && (
              <ul className="chat-source-list" aria-label="답변 근거">
                {message.sources.map((source) => (
                  <li key={`${source.id}-${source.citationNumber}`}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="chat-citation-number">
                        [{source.citationNumber}]
                      </span>
                      <span>
                        <strong>{source.title}</strong>
                        <small>
                          {source.source} ·{" "}
                          {source.evidenceKind === "body"
                            ? "수집 본문 참고"
                            : source.evidenceKind === "analysis"
                              ? "기존 AI 분석 참고 · 본문 미확인"
                              : "제목만 확인 · 본문 미수집"}
                        </small>
                      </span>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {pendingQuestion && (
          <div className="article-chat-message article-chat-message-user">
            <span className="chat-message-author">나</span>
            <p>{pendingQuestion}</p>
          </div>
        )}
        {busy && (
          <div className="chat-answer-loading" role="status">
            <LoaderCircle
              size={17}
              className="chat-spinner"
              aria-hidden="true"
            />
            뉴스 근거를 확인하고 있습니다…
          </div>
        )}
        <div ref={end} />
      </div>
      {error && (
        <div className="chat-error" role="alert">
          <p>{error}</p>
          {pendingQuestion && (
            <button
              type="button"
              onClick={() => {
                if (access.accessToken)
                  void conversation.ask(access.accessToken, pendingQuestion);
              }}
              disabled={busy || !canAsk}
            >
              <RotateCcw size={15} aria-hidden="true" />
              다시 시도
            </button>
          )}
        </div>
      )}
      <form
        className="article-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (access.accessToken) void conversation.ask(access.accessToken);
        }}
      >
        <label className="sr-only" htmlFor={`${id}-question`}>
          EVAN AI에게 질문
        </label>
        <textarea
          id={`${id}-question`}
          value={input}
          onChange={(event) => conversation.setInput(event.target.value)}
          placeholder={
            context.articleId
              ? "이 기사에 대해 궁금한 점을 입력하세요…"
              : "AI 뉴스와 궁금한 주제를 질문하세요…"
          }
          maxLength={2_000}
          rows={2}
          disabled={!canAsk || busy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (access.accessToken) void conversation.ask(access.accessToken);
            }
          }}
        />
        {busy ? (
          <button
            className="article-chat-send"
            type="button"
            onClick={conversation.cancel}
            aria-label="답변 요청 취소"
          >
            <Square size={18} aria-hidden="true" />
          </button>
        ) : (
          <button
            className="article-chat-send"
            type="submit"
            disabled={!canAsk || !input.trim()}
            aria-label="질문 보내기"
          >
            <Send size={19} aria-hidden="true" />
          </button>
        )}
      </form>
      <p className="chat-input-note">
        {input.length.toLocaleString()} / 2,000자 · 대화는 브라우저를 닫으면
        사라집니다.
      </p>
    </section>
  );
}
