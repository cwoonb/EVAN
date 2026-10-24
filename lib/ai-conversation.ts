"use client";

import { useSyncExternalStore } from "react";
import type {
  ChatAnswer,
  ChatMessage,
  ChatScope,
  ChatSource,
} from "@/types/chat";

export type ConversationScope = ChatScope | "auto";
export interface AssistantContext {
  articleId: string | null;
  issueId: string | null;
  title?: string;
}
export interface AssistantOpenRequest extends AssistantContext {
  question?: string;
}
export interface ConversationState {
  messages: ChatMessage[];
  input: string;
  scope: ConversationScope;
  pendingQuestion: string;
  busy: boolean;
  error: string | null;
}

const snapshots = new Map<string, ConversationState>();
const subscriptions = new Map<string, Set<() => void>>();
const requests = new Map<string, AbortController>();
const empty: ConversationState = {
  messages: [],
  input: "",
  scope: "auto",
  pendingQuestion: "",
  busy: false,
  error: null,
};
export const ASSISTANT_OPEN_EVENT = "evan:open-assistant";

function privateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host.includes(":") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "::" ||
    host === "::1" ||
    /^(?:fc|fd|fe[89ab])[a-f0-9]*:/i.test(host)
  )
    return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
}

/** Only a public HTTPS gateway can be embedded in a production static page. */
export function aiApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_EVAN_API_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      privateHost(url.hostname) ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isSource(value: unknown): value is ChatSource {
  if (!value || typeof value !== "object") return false;
  const source = value as ChatSource;
  try {
    const url = new URL(source.url);
    return (
      /^https?:$/.test(url.protocol) &&
      !privateHost(url.hostname) &&
      !url.username &&
      !url.password &&
      typeof source.id === "string" &&
      typeof source.title === "string" &&
      source.title.length <= 700 &&
      typeof source.source === "string" &&
      typeof source.publishedAt === "string" &&
      ["body", "analysis", "title"].includes(source.evidenceKind) &&
      Number.isInteger(source.citationNumber) &&
      source.citationNumber > 0
    );
  } catch {
    return false;
  }
}

export function responseAnswer(value: unknown): ChatAnswer {
  if (!value || typeof value !== "object")
    throw new Error("AI 응답을 확인하지 못했습니다. 다시 시도해주세요.");
  const answer = value as ChatAnswer;
  if (
    typeof answer.answer !== "string" ||
    !answer.answer.trim() ||
    answer.answer.length > 12_000 ||
    !Array.isArray(answer.sources) ||
    answer.sources.length > 6 ||
    !answer.sources.every(isSource)
  )
    throw new Error("AI 응답을 확인하지 못했습니다. 다시 시도해주세요.");
  return answer;
}

export function requestHistory(messages: ChatMessage[], question: string) {
  if (question.length > 2_000)
    throw new Error("질문은 2,000자 이하로 입력해주세요.");
  const recent = messages
    .slice(-8)
    .map(({ role, content }) => ({ role, content: content.slice(0, 2_000) }));
  while (
    recent.length &&
    recent.reduce(
      (size, message) => size + message.content.length,
      question.length,
    ) > 10_000
  )
    recent.splice(0, 2);
  return [...recent, { role: "user" as const, content: question }];
}

export function conversationKey(owner: string, context: AssistantContext) {
  return JSON.stringify([owner, context.articleId || "all-news"]);
}

function snapshot(key: string, context: AssistantContext): ConversationState {
  let current = snapshots.get(key);
  if (!current) {
    current = {
      ...empty,
      messages: [],
      scope: context.articleId ? "auto" : "all",
    };
    snapshots.set(key, current);
  }
  return current;
}

function update(
  key: string,
  context: AssistantContext,
  change: Partial<ConversationState>,
) {
  snapshots.set(key, { ...snapshot(key, context), ...change });
  subscriptions.get(key)?.forEach((listener) => listener());
}

function subscribe(key: string, listener: () => void) {
  const listeners = subscriptions.get(key) || new Set<() => void>();
  listeners.add(listener);
  subscriptions.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) subscriptions.delete(key);
  };
}

export function useAiConversation(owner: string, context: AssistantContext) {
  const key = conversationKey(owner, context);
  const state = useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => snapshot(key, context),
    () => empty,
  );
  return {
    ...state,
    setInput: (input: string) =>
      update(key, context, { input: input.slice(0, 2_000) }),
    setScope: (scope: ConversationScope) => {
      if (!snapshot(key, context).busy) update(key, context, { scope });
    },
    ask: (token: string, question?: string) =>
      askConversation(key, context, token, question),
    cancel: () => requests.get(key)?.abort("cancelled"),
    clear: () => {
      const request = requests.get(key);
      requests.delete(key);
      request?.abort("new-conversation");
      update(key, context, {
        ...empty,
        messages: [],
        scope: context.articleId ? "auto" : "all",
      });
    },
  };
}

async function askConversation(
  key: string,
  context: AssistantContext,
  token: string,
  question?: string,
) {
  const current = snapshot(key, context);
  const text = (question ?? current.input).trim();
  const origin = aiApiOrigin();
  if (!origin || !token || requests.has(key) || !text || text.length > 2_000)
    return;
  if (!!context.articleId !== !!context.issueId) return;
  const controller = new AbortController();
  requests.set(key, controller);
  update(key, context, {
    input: "",
    pendingQuestion: text,
    busy: true,
    error: null,
  });
  const timeout = setTimeout(() => controller.abort("timeout"), 100_000);
  try {
    const response = await fetch(`${origin}/v1/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        articleId: context.articleId,
        issueId: context.issueId,
        scope: context.articleId ? current.scope : "all",
        messages: requestHistory(current.messages, text),
      }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) {
      if (response.status === 401) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("evan:member-expired"));
        throw new Error("로그인이 만료됐습니다. 다시 로그인해주세요.");
      }
      if (response.status === 429) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.code === "DAILY_QUOTA_EXCEEDED"
          ? "오늘의 AI 질문 10회를 모두 사용했습니다. 한국 시간 자정 이후 다시 질문해주세요."
          : "질문이 너무 빠릅니다. 잠시 후 다시 시도해주세요.");
      }
      if (response.status === 404)
        throw new Error(
          "기사가 갱신됐습니다. 최신 뉴스를 불러온 뒤 다시 질문해주세요.",
        );
      if (response.status === 503)
        throw new Error(
          "AI 서버가 준비 중이거나 사용 중입니다. 잠시 후 다시 시도해주세요.",
        );
      if (response.status === 400 || response.status === 413)
        throw new Error("질문이나 대화가 너무 깁니다. 새 대화를 시작해주세요.");
      throw new Error("AI 답변을 받지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
    const answer = responseAnswer(await response.json());
    if (requests.get(key) !== controller || controller.signal.aborted) return;
    const messages: ChatMessage[] = [
      ...current.messages,
      { role: "user", content: text },
      { role: "assistant", content: answer.answer, sources: answer.sources },
    ];
    update(key, context, {
      messages: messages.slice(-40),
      pendingQuestion: "",
      error: null,
    });
  } catch (failure) {
    if (requests.get(key) !== controller) return;
    const error = controller.signal.aborted
      ? controller.signal.reason === "timeout"
        ? "응답 시간이 초과됐습니다. 다시 시도해주세요."
        : "답변 요청을 취소했습니다."
      : failure instanceof TypeError
        ? "AI 서버에 연결하지 못했습니다. 네트워크와 서버 상태를 확인해주세요."
        : failure instanceof Error
          ? failure.message
          : "AI 요청에 실패했습니다.";
    update(key, context, { error });
  } finally {
    clearTimeout(timeout);
    if (requests.get(key) === controller) {
      requests.delete(key);
      update(key, context, { busy: false });
    }
    if (typeof window !== "undefined") window.dispatchEvent(new Event("evan:refresh-member"));
  }
}

export function openFloatingAssistant(context?: AssistantOpenRequest) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(ASSISTANT_OPEN_EVENT, { detail: context }),
    );
}
