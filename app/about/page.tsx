import Link from "next/link";
import { ArrowUpRight, Code2, Mail, Sparkles } from "lucide-react";

export const metadata = {
  title: "소개 — EVAN",
  description:
    "AI를 이해하고, 실험하고, 실제 제품으로 연결하는 AI Developer 조원배.",
};

export default function AboutPage() {
  return (
    <main id="main-content" className="secondary-page secondary-about">
      <section className="secondary-about-intro">
        <p className="secondary-eyebrow">
          <span /> THE PERSON BEHIND EVAN
        </p>
        <div className="secondary-about-profile">
          <div className="secondary-about-avatar" aria-hidden="true">
            E<span />
          </div>
          <div>
            <p className="secondary-about-role">AI Developer</p>
            <h1>
              안녕하세요,
              <br />
              <em>조원배</em>입니다.
            </h1>
          </div>
        </div>
        <p className="secondary-about-statement">
          AI의 가능성을 탐구하고,
          <br />
          실제로 쓸 수 있는 경험을 만듭니다.
        </p>
        <p className="secondary-about-description">
          새로운 기술을 빠르게 따라가기보다, 왜 중요한지 이해하고 직접
          만들어보는 데 관심이 있습니다. EVAN은 AI 뉴스에서 시작한 질문을
          리서치와 실험, 프로젝트로 이어가는 저의 작업공간입니다.
        </p>
        <div className="secondary-about-contacts">
          <button type="button" disabled title="GitHub 주소 연결 전입니다">
            <Code2 size={16} /> GitHub <ArrowUpRight size={14} />
          </button>
          <button type="button" disabled title="이메일 주소 연결 전입니다">
            <Mail size={16} /> Email <ArrowUpRight size={14} />
          </button>
          <span>연락처 연결 준비 중</span>
        </div>
      </section>
      <section className="secondary-about-interests">
        <div className="secondary-about-section-heading">
          <Sparkles size={19} strokeWidth={1.4} />
          <h2>지금 탐구하는 것들</h2>
        </div>
        <div className="secondary-interest-list">
          {[
            {
              title: "LLM",
              text: "모델의 가능성과 한계를 이해하는 실험",
              href: "/research?category=LLM",
            },
            {
              title: "AI Agent",
              text: "생각을 실행으로 연결하는 작업 흐름",
              href: "/research?category=AI%20Agent",
            },
            {
              title: "RAG",
              text: "근거를 찾고 확인할 수 있는 답변",
              href: "/research?category=RAG",
            },
            {
              title: "AI Automation",
              text: "반복 업무에 가치를 더하는 자동화",
              href: "/research/agent-workflows",
            },
            {
              title: "Data Analysis",
              text: "데이터에서 질문과 인사이트 찾기",
              href: "/projects/llm-benchmark",
            },
            {
              title: "Local LLM",
              text: "내 데이터와 인프라에서 시작하는 AI",
              href: "/research?category=Local%20LLM",
            },
          ].map((interest) => (
            <Link href={interest.href} key={interest.title}>
              <div>
                <h3>{interest.title}</h3>
                <p>{interest.text}</p>
              </div>
              <ArrowUpRight size={17} />
            </Link>
          ))}
        </div>
        <div className="secondary-about-philosophy">
          <span>HOW I WORK</span>
          <p>
            작게 만들고, 직접 확인하고,
            <br />
            배운 것을 다음 실험으로 이어갑니다.
          </p>
          <Link href="/projects">
            프로젝트 살펴보기 <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
