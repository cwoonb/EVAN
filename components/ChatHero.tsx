"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Sparkles } from "lucide-react";
import { openFloatingAssistant } from "@/lib/ai-conversation";

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
  { label: "오늘의 주요 AI 이슈 요약", question: "오늘의 주요 AI 이슈 요약" },
  { label: "산업·관련 기업 영향", question: "최근 주요 AI 뉴스가 산업과 관련 기업에 미칠 영향을 기사 근거와 추론으로 구분해 설명해 줘." },
  { label: "최근 NVIDIA 뉴스", question: "NVIDIA 관련 최신 뉴스를 찾아 핵심을 정리해 줘." },
  { label: "최근 OpenAI 뉴스", question: "OpenAI 관련 최신 뉴스를 찾아 핵심을 정리해 줘." },
  { label: "다른 관점과 확인할 점", question: "최근 주요 AI 뉴스에서 다른 관점과 아직 확인되지 않은 점을 설명해 줘." },
];

export default function ChatHero() {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  useEffect(
    () => () => {
      recognitionRef.current?.stop();
    },
    [],
  );

  function submit(question = input) {
    const text = question.trim();
    if (!text || text.length > 2_000) return;
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
    }
    setListening(false);
    setInput("");
    setNotice("");
    openFloatingAssistant({ articleId: null, issueId: null, question: text });
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
    recognition.onresult = (event) =>
      setInput(
        Array.from(
          { length: event.results.length },
          (_, index) => event.results[index][0].transcript,
        )
          .join("")
          .slice(0, 2_000),
      );
    recognition.onend = () => {
      setListening(false);
      setNotice("");
    };
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
    <section className="chat-section" aria-labelledby="chat-heading">
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
      <form
        className={`chat-composer${listening ? " is-listening" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="composer-row">
          <span className="composer-ai-mark" aria-hidden="true">
            <Sparkles size={23} strokeWidth={1.5} />
          </span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={2_000}
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
            aria-label="EVAN AI에서 질문 보내기"
            disabled={!input.trim()}
          >
            <ArrowUp size={23} strokeWidth={1.8} />
          </button>
        </div>
      </form>
      {notice && (
        <p className="composer-notice" role="status">
          {notice}
        </p>
      )}
      <div className="suggestion-list" aria-label="추천 질문">
        {suggestions.map(({ label, question }) => (
          <button type="button" key={label} onClick={() => submit(question)}>
            {label}
          </button>
        ))}
      </div>
      <p className="chat-demo-note">
        <span className="tiny-dot" /> EVAN에 저장된 뉴스 근거로 답변합니다. 원문
        출처를 함께 확인하세요.
      </p>
    </section>
  );
}
