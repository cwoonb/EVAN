"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import { AssistantConversation } from "@/components/ArticleChat";
import {
  ASSISTANT_OPEN_EVENT,
  type AssistantContext,
  type AssistantOpenRequest,
} from "@/lib/ai-conversation";
import { useNewsFeed } from "@/lib/news-feed";
import { findArticle } from "@/lib/related-news";
import "@/app/assistant.css";
import { MEMBER_LOGIN_EVENT, requestMemberLogin, useMemberSession } from "@/lib/member-session";

const allNews: AssistantContext = {
  articleId: null,
  issueId: null,
  title: "전체 EVAN 뉴스",
};

function validContext(value: unknown): value is AssistantContext {
  if (!value || typeof value !== "object") return false;
  const context = value as AssistantContext;
  return (
    (context.articleId === null && context.issueId === null) ||
    (typeof context.articleId === "string" &&
      /^article_[0-9a-f]{20}$/.test(context.articleId) &&
      typeof context.issueId === "string" &&
      /^(?:issue|article)_[0-9a-f]{20}$/.test(context.issueId))
  );
}

export default function FloatingAssistant() {
  const member = useMemberSession();
  const pathname = usePathname();
  const params = useSearchParams();
  const { feed } = useNewsFeed();
  const routeKey = `${pathname}?${params.toString()}`;
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<{
    routeKey: string;
    context: AssistantContext;
    question?: string;
    seed: number;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const onNewsPage = /(?:^|\/)news\/?$/.test(pathname);
  const routeArticle = onNewsPage
    ? findArticle(
        feed?.issues || [],
        params.get("issue"),
        params.get("article"),
      )
    : null;
  const requestedContext =
    requested?.routeKey === routeKey ? requested.context : null;
  const requestedArticle = requestedContext?.articleId
    ? findArticle(
        feed?.issues || [],
        requestedContext.issueId,
        requestedContext.articleId,
      )
    : null;
  const currentArticle =
    requestedArticle || (requestedContext ? null : routeArticle);
  const context: AssistantContext = currentArticle
    ? {
        articleId: currentArticle.source.id,
        issueId: currentArticle.issue.id,
        title:
          currentArticle.source.display?.titleKo || currentArticle.source.title,
      }
    : requestedContext || allNews;

  useEffect(() => {
    function handleOpen(event: Event) {
      const detail: unknown =
        event instanceof CustomEvent ? event.detail : null;
      if (validContext(detail)) {
        const question = (detail as AssistantOpenRequest).question;
        setRequested({
          routeKey,
          context: detail,
          question:
            typeof question === "string"
              ? question.trim().slice(0, 2_000)
              : undefined,
          seed: Date.now(),
        });
      }
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : launcher.current;
      if (!member.accessToken) { requestMemberLogin(); return; }
      setOpen(true);
    }
    window.addEventListener(ASSISTANT_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, handleOpen);
  }, [routeKey, member.accessToken]);

  useEffect(() => {
    function closeForLogin() { dialog.current?.close(); setOpen(false); }
    window.addEventListener(MEMBER_LOGIN_EVENT, closeForLogin);
    return () => window.removeEventListener(MEMBER_LOGIN_EVENT, closeForLogin);
  }, []);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (open) {
      if (!panel.open) panel.showModal();
      closeButton.current?.focus({ preventScroll: true });
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = previous;
      };
    }
    if (panel.open) {
      panel.close();
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : launcher.current;
      target?.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <>
      <button
        ref={launcher}
        type="button"
        className="assistant-launcher"
        aria-label="EVAN AI 대화 열기"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => {
          if (!member.accessToken) { requestMemberLogin(); return; }
          returnFocus.current = launcher.current;
          setOpen(true);
        }}
      >
        <span className="assistant-launcher-icon">
          <Sparkles size={23} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>
          EVAN <b>AI</b>
        </span>
      </button>
      <dialog
        ref={dialog}
        id={`${id}-panel`}
        className="assistant-panel"
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="assistant-panel-shell">
          <header className="assistant-panel-header">
            <div>
              <span className="assistant-header-icon">
                <Sparkles size={21} aria-hidden="true" />
              </span>
              <div>
                <h2 id={`${id}-title`}>EVAN AI</h2>
                <p>뉴스를 읽고, 근거를 묻는 대화</p>
              </div>
            </div>
            <button
              ref={closeButton}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="EVAN AI 대화 닫기"
            >
              <X size={21} aria-hidden="true" />
            </button>
          </header>
          <div className="assistant-context">
            <span>
              {context.articleId
                ? "현재 기사와 대화 중"
                : "전체 뉴스와 대화 중"}
            </span>
            <p>{context.title || "선택한 기사"}</p>
            {context.articleId ? (
              <button
                type="button"
                onClick={() =>
                  setRequested({ routeKey, context: allNews, seed: Date.now() })
                }
              >
                전체 뉴스 대화 <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            ) : routeArticle ? (
              <button type="button" onClick={() => setRequested(null)}>
                현재 기사로 돌아가기{" "}
                <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="assistant-panel-content">
            <AssistantConversation
              context={context}
              floating
              seedQuestion={
                requested?.routeKey === routeKey
                  ? requested.question
                  : undefined
              }
              seedKey={requested?.seed}
              onSeedConsumed={() =>
                setRequested((current) =>
                  current && current.seed === requested?.seed
                    ? { ...current, question: undefined }
                    : current,
                )
              }
            />
          </div>
        </div>
      </dialog>
    </>
  );
}
