"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  FlaskConical,
  Lightbulb,
  MessageSquare,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { ResearchItem } from "@/types/research";

type Tab = "report" | "sources" | "applications" | "process";
type Message = { id: number; role: "assistant" | "user"; content: string };
const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: "report", label: "보고서", icon: FileText },
  { id: "sources", label: "출처", icon: BookOpen },
  { id: "applications", label: "적용 아이디어", icon: Lightbulb },
  { id: "process", label: "만든 과정", icon: FlaskConical },
];

function answerFor(question: string, research: ResearchItem) {
  const input = question.toLowerCase();
  if (/출처|근거|source|링크|논문/.test(input))
    return `이 리서치의 내용을 확인할 때는 다음 공식 자료부터 살펴보세요.\n\n${research.sources.map((source, index) => `${index + 1}. ${source.title} — ${source.description}`).join("\n\n")}\n\n오른쪽 ‘출처’ 탭에서 원문을 열 수 있습니다. 이 보고서는 데모용 분석이며, 최신 업데이트와 구체적인 수치는 원문에서 다시 확인해야 합니다.`;
  if (/계획|과정|시작|순서|로드맵|방법/.test(input))
    return `‘${research.title}’를 직접 탐구하는 4단계 계획입니다.\n\n${research.process.map((step, index) => `${index + 1}. ${step.title}\n${step.description}`).join("\n\n")}\n\n첫 실험은 하루 안에 결과를 확인할 수 있는 크기로 제한하세요. 평가 기준과 실패 사례를 함께 기록하면 다음 실험으로 이어집니다.`;
  if (/적용|프로젝트|만들|구현|사례|아이디어/.test(input))
    return `‘${research.title}’를 프로젝트로 연결한다면 다음 실험이 좋습니다.\n\n${research.applications.map((item, index) => `${index + 1}. ${item.title}\n${item.description}\n범위: ${item.effort}`).join("\n\n")}\n\n가장 작은 입력 예시 하나와 성공 조건부터 정해보세요. 결과를 확인한 뒤 범위를 넓히면 원인을 추적하기 쉽습니다.`;
  if (/한계|주의|위험|비용|보안|단점/.test(input))
    return `‘${research.title}’에서 확인해야 할 한계입니다.\n\n1. 품질: 실제 사용자 질문으로 평가하기 전에는 성능을 단정할 수 없습니다.\n2. 비용: 모델 호출뿐 아니라 검색, 재시도, 검토에 드는 비용도 포함해야 합니다.\n3. 데이터: 입력 자료의 접근 권한과 로그에 남는 정보를 확인해야 합니다.\n4. 최신성: 이 보고서는 예시 데이터입니다. 도입 시점의 공식 문서와 라이선스를 다시 확인해야 합니다.\n\n이 보고서에서 제안하는 첫 실험은 ‘${research.applications[0].title}’입니다. ${research.applications[0].description}`;
  return `‘${research.title}’의 맥락에서 정리해볼게요.\n\n${research.sections[0].body}\n\n핵심은 다음과 같습니다.\n${(research.sections.find((section) => section.points)?.points || research.sections.slice(1).map((section) => section.body)).map((point, index) => `${index + 1}. ${point}`).join("\n\n")}\n\n직접 적용하려면 ‘${research.applications[0].title}’부터 시작할 수 있습니다. ${research.applications[0].description}\n\n‘적용 아이디어’, ‘실험 계획’, ‘한계’, ‘출처’ 중 더 궁금한 부분을 질문해보세요. 현재 대화는 보고서 내용을 활용한 로컬 데모 응답입니다.`;
}

export function ResearchWorkspace({ research }: { research: ResearchItem }) {
  const initialMessage = (): Message => ({
    id: 0,
    role: "assistant",
    content: `‘${research.title}’를 함께 살펴볼까요?\n\n${research.summary}\n\n핵심 요약부터 프로젝트 적용 아이디어까지, 이 리서치를 기준으로 질문할 수 있습니다.`,
  });
  const [tab, setTab] = useState<Tab>("report");
  const [messages, setMessages] = useState<Message[]>([initialMessage()]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userSubmitted = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  useEffect(() => {
    if (userSubmitted.current)
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  function send(question: string) {
    const value = question.trim();
    if (!value || loading) return;
    userSubmitted.current = true;
    setMessages((previous) => [
      ...previous,
      { id: Date.now(), role: "user", content: value },
    ]);
    setInput("");
    setLoading(true);
    if (/출처|근거|source|논문/.test(value)) setTab("sources");
    else if (/계획|과정|순서/.test(value)) setTab("process");
    else if (/적용|아이디어|프로젝트/.test(value)) setTab("applications");
    timerRef.current = setTimeout(() => {
      setMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: answerFor(value, research),
        },
      ]);
      setLoading(false);
    }, 480);
  }

  function reset() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLoading(false);
    setMessages([initialMessage()]);
    setInput("");
    userSubmitted.current = false;
  }

  return (
    <main id="main-content" className="secondary-page workspace-page">
      <Link href="/research" className="secondary-back">
        <ArrowLeft size={15} /> 모든 리서치
      </Link>
      <section className="workspace-title-row">
        <div>
          <p className="secondary-eyebrow">
            RESEARCH WORKSPACE{" "}
            <span className="workspace-title-divider">/</span>{" "}
            {research.category}
          </p>
          <h1>{research.title}</h1>
          <p>{research.subtitle}</p>
        </div>
        <span className="workspace-demo">
          <span /> 인터랙티브 데모
        </span>
      </section>

      <div className="workspace-layout">
        <section className="workspace-chat" aria-label="리서치 대화">
          <div className="workspace-panel-heading">
            <div>
              <MessageSquare size={17} />
              <h2>함께 탐구하기</h2>
            </div>
            <button
              type="button"
              onClick={reset}
              className="workspace-reset"
              aria-label="대화 초기화"
              title="대화 초기화"
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="workspace-context">
            <BookOpen size={13} />
            <span>현재 리서치를 바탕으로 대화합니다</span>
          </div>
          <div
            className="workspace-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.map((message) => (
              <div
                key={message.id}
                className={`workspace-message workspace-message-${message.role}`}
              >
                <div className="workspace-avatar">
                  {message.role === "assistant" ? <Sparkles size={15} /> : "E"}
                </div>
                <div>
                  <span className="workspace-message-name">
                    {message.role === "assistant" ? "EVAN AI" : "나"}
                  </span>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
            {loading && (
              <div className="workspace-thinking">
                <span />
                <span />
                <span />
                <span className="workspace-thinking-label">
                  리서치를 살펴보고 있어요
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="workspace-composer-area">
            <div className="workspace-suggestions">
              {[
                "핵심 내용 요약해줘",
                "프로젝트 적용 아이디어",
                "출처를 확인하고 싶어",
              ].map((question) => (
                <button
                  type="button"
                  key={question}
                  disabled={loading}
                  onClick={() => send(question)}
                >
                  {question}
                  <ChevronRight size={11} />
                </button>
              ))}
            </div>
            <form
              className="workspace-composer"
              onSubmit={(event) => {
                event.preventDefault();
                send(input);
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    send(input);
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="이 리서치에 대해 질문해보세요..."
                aria-label="리서치 질문"
              />
              <div>
                <span>Shift + Enter 줄바꿈</span>
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  aria-label="질문 보내기"
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </form>
            <p className="workspace-disclaimer">
              AI 연결 전 데모입니다. 질문 주제에 따라 보고서 내용을 정리합니다.
            </p>
          </div>
        </section>

        <section className="workspace-report" aria-label="리서치 보고서">
          <div className="report-tabs" role="tablist" aria-label="리서치 내용">
            {tabs.map(({ id, label, icon: Icon }, index) => (
              <button
                key={id}
                id={`tab-${id}`}
                role="tab"
                type="button"
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => setTab(id)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next =
                      tabs[
                        (index + (event.key === "ArrowRight" ? 1 : 3)) %
                          tabs.length
                      ].id;
                    setTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}
              >
                <Icon size={15} />
                <span>{label}</span>
                {id === "sources" && <small>{research.sources.length}</small>}
              </button>
            ))}
          </div>
          <div
            className="report-content"
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            tabIndex={0}
          >
            {tab === "report" && (
              <>
                <div className="report-document-top">
                  <span className="report-type">RESEARCH NOTE</span>
                  <span>
                    <Clock3 size={12} /> {research.readTime} 읽기
                  </span>
                </div>
                <h2>{research.title}</h2>
                <p className="report-subtitle">{research.subtitle}</p>
                <div className="report-meta">
                  <span>EVAN Research</span>
                  <span>{research.date}</span>
                  <span>데모 보고서</span>
                </div>
                <div
                  className="report-cover"
                  style={{ backgroundImage: `url(${research.image})` }}
                />
                <div className="report-sections">
                  {research.sections.map((section, index) => (
                    <section key={section.title}>
                      <h3>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        {section.title}
                      </h3>
                      <p>{section.body}</p>
                      {section.points && (
                        <ul>
                          {section.points.map((point) => (
                            <li key={point}>{point}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                </div>
                <div className="report-keywords">
                  {research.tags.map((tag) => (
                    <span key={tag}># {tag}</span>
                  ))}
                </div>
                <button
                  className="report-next-tab"
                  type="button"
                  onClick={() => setTab("sources")}
                >
                  근거가 되는 자료 살펴보기 <ArrowUpRight size={15} />
                </button>
              </>
            )}
            {tab === "sources" && (
              <>
                <p className="report-type">READ THE ORIGINAL</p>
                <h2>직접 확인하는 출처</h2>
                <p className="report-tab-intro">
                  기술의 가능성과 한계를 판단할 때 참고할 공식 문서입니다. 데모
                  보고서의 최신성은 원문에서 확인하세요.
                </p>
                <div className="report-source-list">
                  {research.sources.map((source, index) => (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="report-source"
                    >
                      <span className="report-source-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <span className="report-source-publisher">
                          {source.publisher}
                        </span>
                        <h3>
                          {source.title} <ExternalLink size={13} />
                        </h3>
                        <p>{source.description}</p>
                        <small>{new URL(source.url).hostname}</small>
                      </div>
                    </a>
                  ))}
                </div>
                <p className="report-note">
                  <BookOpen size={16} /> 출처는 새 탭에서 열립니다. 서비스
                  기능과 사용 조건은 업데이트될 수 있습니다.
                </p>
              </>
            )}
            {tab === "applications" && (
              <>
                <p className="report-type">FROM INSIGHT TO ACTION</p>
                <h2>작게 시작하는 적용 아이디어</h2>
                <p className="report-tab-intro">
                  읽은 내용을 동작하는 작은 실험으로 바꿔보세요. 범위와 성공
                  조건을 먼저 정하는 것이 출발점입니다.
                </p>
                <div className="report-application-list">
                  {research.applications.map((application, index) => (
                    <article key={application.title}>
                      <span className="report-application-number">
                        0{index + 1}
                      </span>
                      <div>
                        <span className="report-effort">
                          {application.effort}
                        </span>
                        <h3>{application.title}</h3>
                        <p>{application.description}</p>
                        <button
                          type="button"
                          disabled={loading}
                          onClick={() =>
                            send(
                              `${application.title} 구현을 위한 실험 계획을 세워줘`,
                            )
                          }
                        >
                          대화에서 실험 계획 세우기 <ArrowUpRight size={13} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <Link className="report-next-tab" href="/projects">
                  관련 프로젝트 둘러보기 <ArrowUpRight size={15} />
                </Link>
              </>
            )}
            {tab === "process" && (
              <>
                <p className="report-type">BEHIND THE RESEARCH</p>
                <h2>질문을 결과로 만드는 과정</h2>
                <p className="report-tab-intro">
                  결론만큼 중요한 것은 그 결론에 도달한 방법입니다. 이 리서치의
                  탐구 과정을 정리했습니다.
                </p>
                <ol className="report-process">
                  {research.process.map((step, index) => (
                    <li key={step.title}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                      <Check size={14} />
                    </li>
                  ))}
                </ol>
                <div className="report-process-note">
                  <FlaskConical size={21} />
                  <h3>계속 업데이트하는 기록</h3>
                  <p>
                    현재 내용은 포트폴리오용 예시입니다. 실제 실험을 추가할 때
                    입력, 평가 기준, 결과와 한계를 함께 기록할 계획입니다.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
