import Link from "next/link";
import Image from "next/image";
import {
  AudioLines,
  Bot,
  ChartNoAxesCombined,
  ChevronRight,
  FileText,
  Box,
} from "lucide-react";
import { research } from "@/data/research";

const topics = [
  { name: "LLM", caption: "언어 모델", icon: AudioLines },
  { name: "AI Agent", caption: "에이전트", icon: Bot },
  { name: "산업 동향", caption: "시장 분석", icon: ChartNoAxesCombined },
  { name: "연구 논문", caption: "논문 리뷰", icon: FileText },
  { name: "프로젝트 아이디어", caption: "기획 가이드", icon: Box },
];

export default function RecentResearch() {
  return (
    <section className="discovery-section" aria-label="리서치와 주요 주제">
      <div className="recent-research">
        <Link href="/research" className="subsection-heading">
          <h2>최근 리서치</h2>
          <ChevronRight size={16} />
        </Link>
        <div className="research-mini-grid">
          {research.slice(0, 3).map((item) => (
            <Link
              href={`/research/${item.id}`}
              className="research-mini"
              key={item.id}
            >
              <div className="research-mini-image">
                <Image src={item.image} alt="" fill sizes="90px" />
              </div>
              <div className="research-mini-copy">
                <h3>{item.title}</h3>
                <span>{item.date.replaceAll("-", ". ")}</span>
              </div>
              <ChevronRight className="mini-arrow" size={15} />
            </Link>
          ))}
        </div>
      </div>
      <div className="popular-topics">
        <Link href="/research" className="subsection-heading">
          <h2>자주 찾는 주제</h2>
          <ChevronRight size={16} />
        </Link>
        <div className="topics-grid">
          {topics.map(({ name, caption, icon: Icon }) => (
            <Link
              href={`/research?topic=${encodeURIComponent(name)}`}
              className="topic-link"
              key={name}
            >
              <Icon size={21} strokeWidth={1.4} />
              <span>{name}</span>
              <small>{caption}</small>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
