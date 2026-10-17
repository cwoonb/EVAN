"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { filterIssues, issueHref, useNewsFeed } from "@/lib/news-feed";
import type { NewsIssue } from "@/types/news";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  FileText,
  LoaderCircle,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  link?: string;
  linkLabel?: string;
};
type RecognitionEvent = {
  results: {
    [index: number]: {
      [index: number]: { transcript: string };
      isFinal: boolean;
    };
    length: number;
  };
};
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const suggestions = [
  "오늘의 주요 AI 이슈 요약",
  "이 기술이 산업에 미치는 영향은?",
  "비슷한 프로젝트 사례 찾아줘",
  "최신 논문 핵심 정리",
  "이 주제로 리서치 계획 세워줘",
];

function makeReply(
  question: string,
  hasAttachment: boolean,
  issues: NewsIssue[],
): Omit<ChatMessage, "id" | "role"> {
  if (hasAttachment)
    return {
      text: "파일을 첨부했습니다. 현재 데모에서는 파일의 실제 내용을 분석하지 않습니다. 파일에서 궁금한 부분을 텍스트로 붙여 넣으면, 관련 리서치를 바탕으로 탐색 방향을 안내할 수 있습니다.",
      link: "/research",
      linkLabel: "관련 리서치 살펴보기",
    };
  if (/뉴스|이슈|요약|오늘|브리핑/.test(question)) {
    const latest = filterIssues(issues, {
      importance: 3,
      sort: "latest",
    }).slice(0, 3);
    return latest.length
      ? {
          text: `현재 공개된 뉴스 분석의 핵심입니다.\n\n${latest.map((issue, index) => `${index + 1}. ${issue.title}\n${issue.summary}\n출처 ${issue.sources.length}개 · 중요도 ${issue.importance}`).join("\n\n")}\n\n저장된 Qwen 분석 결과를 바탕으로 정리했습니다. 상세 화면에서 실제 원문과 게시일을 확인할 수 있습니다.`,
          link: issueHref(latest[0]),
          linkLabel: "실제 기사와 분석 확인하기",
        }
      : {
          text: "아직 뉴스 데이터를 받지 못했습니다. 뉴스 탐색에서 연결 상태를 확인하고 다시 시도해주세요.",
          link: "/news",
          linkLabel: "뉴스 탐색 열기",
        };
  }
  if (/산업|영향|시장/.test(question))
    return {
      text: "AI의 변화는 ‘답변 생성’에서 ‘업무 실행’으로 이어지고 있습니다.\n\n① 소프트웨어: 검색, 문서 정리, 코드 리뷰처럼 반복되는 과정을 에이전트가 연결합니다.\n② 인프라: 모델 크기보다 지연 시간, 메모리, 추론 비용을 함께 보는 것이 중요합니다.\n③ 도입 전략: 하나의 작은 업무를 정하고, 정확도와 사람의 검토 시간을 먼저 측정해보세요.\n\n프로젝트 설계를 위한 데모 안내입니다. 실제 도입 전에는 최신 자료를 확인하세요.",
      link: "/research/agent-workflows",
      linkLabel: "AI 에이전트 리서치 읽기",
    };
  if (/프로젝트|사례|만들/.test(question))
    return {
      text: "작게 만들고, 실제로 써볼 수 있는 프로젝트부터 시작해보세요.\n\n• AI 뉴스 인텔리전스: 뉴스 수집, 중복 제거, 중요도 분류, 근거가 있는 요약을 연결합니다.\n• 채용 공고 AI Agent: 관심 직무에 맞는 공고를 찾고, 요건과 내 경험의 차이를 정리합니다.\n• 로컬 LLM: 외부로 데이터를 보내지 않는 문서 질의 실험을 구성합니다.\n\n각 프로젝트의 설계와 적용 기술을 프로젝트 페이지에 정리했습니다.",
      link: "/projects",
      linkLabel: "프로젝트 둘러보기",
    };
  if (/계획|리서치/.test(question))
    return {
      text: "다음 순서로 리서치를 시작해보세요.\n\n1. 질문 정의: 해결하려는 문제를 한 문장으로 적습니다.\n2. 자료 수집: 공식 문서, 논문, 재현 가능한 코드를 우선합니다.\n3. 비교 기준: 정확도, 지연 시간, 비용, 데이터 보호를 함께 살펴봅니다.\n4. 작은 실험: 같은 입력과 평가 기준으로 후보를 비교합니다.\n5. 기록: 관찰 결과, 한계, 다음 실험을 남깁니다.\n\n리서치 상세 화면에서 보고서와 적용 아이디어를 함께 탐색할 수 있습니다.",
      link: "/research/local-llm",
      linkLabel: "로컬 LLM 리서치로 시작하기",
    };
  if (/논문|모델|LLM|llm/.test(question))
    return {
      text: "모델이나 논문을 볼 때는 결과 수치와 실험 조건을 함께 읽어야 합니다.\n\n• 핵심 질문: 기존 방식의 어떤 한계를 해결하나요?\n• 실험 조건: 사용한 데이터, 모델 규모, 추론 환경은 무엇인가요?\n• 재현 가능성: 코드와 평가 방법이 공개되어 있나요?\n• 적용 가능성: 내 작업의 입력 길이, 비용, 정확도 요구와 맞나요?\n\n이 데모는 최신 논문을 실시간 검색하지 않습니다. 논문 제목이나 초록을 입력하고, 관련 리서치에서 비교 기준을 확인해보세요.",
      link: "/research/llm-comparison",
      linkLabel: "LLM 모델 비교 리서치 읽기",
    };
  return {
    text: "뉴스 탐색에서 관심 기업·모델·기술을 검색해보세요. 실제 기사와 저장된 AI 분석, 동일 사건의 출처를 함께 확인할 수 있습니다.\n\n자유 대화와 프로젝트 조언은 데모 안내입니다. ‘오늘의 주요 AI 이슈 요약’을 선택하면 실제 뉴스 데이터의 요약을 확인할 수 있습니다.",
    link: "/news",
    linkLabel: "실제 뉴스 탐색하기",
  };
}

export default function ChatHero() {
  const { feed } = useNewsFeed();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      recognitionRef.current?.stop();
    },
    [],
  );
  useEffect(() => {
    if (messages.length)
      logRef.current?.scrollTo({
        top: logRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [messages, busy]);

  function submit(question = input) {
    const text = question.trim();
    if (busy || (!text && !attachments.length)) return;
    const hasAttachment = attachments.length > 0;
    const attachmentLabel = attachments.length
      ? `\n첨부: ${attachments.map((file) => file.name).join(", ")}`
      : "";
    setMessages((previous) => [
      ...previous,
      {
        id: Date.now(),
        role: "user",
        text: `${text || "첨부한 파일에 대해 알려줘"}${attachmentLabel}`,
      },
    ]);
    setInput("");
    setAttachments([]);
    setNotice("");
    setBusy(true);
    timerRef.current = setTimeout(() => {
      setMessages((previous) => [
        ...previous,
        {
          id: Date.now(),
          role: "assistant",
          ...makeReply(text, hasAttachment, feed?.issues || []),
        },
      ]);
      setBusy(false);
      inputRef.current?.focus();
    }, 650);
  }

  function startVoice() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const browser = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const SpeechRecognition =
      browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNotice(
        "이 브라우저는 음성 입력을 지원하지 않습니다. 키보드로 질문을 입력해주세요.",
      );
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "ko-KR";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      setInput(
        Array.from(
          { length: event.results.length },
          (_, index) => event.results[index][0].transcript,
        ).join(""),
      );
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setNotice(
        "마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 확인해주세요.",
      );
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setNotice("듣고 있습니다. 질문을 말해주세요.");
    } catch {
      setNotice("음성 입력을 시작할 수 없습니다. 다시 시도해주세요.");
    }
  }

  return (
    <section
      className={`chat-section${messages.length ? " has-conversation" : ""}`}
      aria-labelledby="chat-heading"
    >
      <div className="chat-intro">
        <span className="eyebrow">TURNING AI TRENDS INTO REAL PROJECTS</span>
        <h2 id="chat-heading">
          AI와 함께 더 깊이 <span>탐험해보세요.</span>
        </h2>
        <p>
          최신 AI 뉴스부터 기술 분석, 실제 프로젝트 적용까지
          <br />
          EVAN과 함께 생각하고 만들어가는 작업공간입니다.
        </p>
      </div>
      {messages.length > 0 && (
        <div className="conversation-panel">
          <div className="conversation-heading">
            <span>
              <Sparkles size={14} /> EVAN과 탐색하기{" "}
              <small>분석 요약 · 데모 안내</small>
            </span>
            <button
              type="button"
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current);
                setMessages([]);
                setBusy(false);
                inputRef.current?.focus();
              }}
              aria-label="새 대화 시작"
            >
              <RotateCcw size={14} /> 새 대화
            </button>
          </div>
          <div
            className="conversation-log"
            role="log"
            aria-live="polite"
            aria-label="AI 대화"
            ref={logRef}
          >
            {messages.map((message) => (
              <div
                className={`chat-message chat-message-${message.role}`}
                key={message.id}
              >
                {message.role === "assistant" && (
                  <div className="assistant-mark">E</div>
                )}
                <div className="message-body">
                  <span className="message-author">
                    {message.role === "assistant" ? "EVAN" : "나"}
                  </span>
                  <p>{message.text}</p>
                  {message.link && (
                    <Link href={message.link} className="message-reference">
                      {message.linkLabel}
                      <ArrowUpRight size={14} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="chat-thinking">
                <LoaderCircle size={14} className="spin" /> 리서치를 살펴보고
                있습니다...
              </div>
            )}
          </div>
        </div>
      )}
      <form
        className={`chat-composer${listening ? " is-listening" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map((file, index) => (
              <span key={`${file.name}-${index}`}>
                <FileText size={13} />
                {file.name}
                <button
                  type="button"
                  aria-label={`${file.name} 첨부 취소`}
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((_, current) => current !== index),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <input
            type="file"
            className="visually-hidden"
            ref={fileRef}
            accept=".txt,.md,.pdf,.png,.jpg,.jpeg,.webp"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              const valid = files.filter(
                (file) => file.size <= 10 * 1024 * 1024,
              );
              setAttachments((previous) => [...previous, ...valid].slice(0, 3));
              setNotice(
                files.length !== valid.length
                  ? "파일당 10MB까지 첨부할 수 있습니다."
                  : "최대 3개 파일을 첨부할 수 있습니다. 데모에서는 파일 내용을 분석하지 않습니다.",
              );
              event.target.value = "";
            }}
          />
          <button
            type="button"
            className="attach-button"
            aria-label="파일 첨부"
            onClick={() => fileRef.current?.click()}
          >
            <Plus size={23} strokeWidth={1.5} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            aria-label="AI에게 질문하기"
            placeholder="AI에게 무엇이든 물어보세요..."
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className={`voice-button${listening ? " active" : ""}`}
            onClick={startVoice}
            aria-label={listening ? "음성 입력 종료" : "음성으로 질문하기"}
            aria-pressed={listening}
          >
            <Mic size={21} strokeWidth={1.6} />
          </button>
          <button
            type="submit"
            className="send-button"
            aria-label="질문 보내기"
            disabled={busy || (!input.trim() && !attachments.length)}
          >
            {busy ? (
              <LoaderCircle className="spin" size={21} />
            ) : (
              <ArrowUp size={23} strokeWidth={1.8} />
            )}
          </button>
        </div>
      </form>
      {notice && (
        <p className="composer-notice" role="status">
          {attachments.length > 0 && <Check size={12} />}
          {notice}
        </p>
      )}
      <div className="suggestion-list" aria-label="추천 질문">
        {suggestions.map((question) => (
          <button
            type="button"
            disabled={busy}
            key={question}
            onClick={() => submit(question)}
          >
            {question}
          </button>
        ))}
      </div>
      <p className="chat-demo-note">
        <span className="tiny-dot" /> 뉴스 요약은 실제 분석 데이터 · 자유 대화와
        파일 분석은 데모입니다
      </p>
    </section>
  );
}
