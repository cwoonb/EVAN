import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  ExternalLink,
  Layers3,
} from "lucide-react";
import { getProjectById, projects } from "@/data/projects";
import { getResearchById } from "@/data/research";

export function generateStaticParams() {
  return projects.map((project) => ({ id: project.id }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = getProjectById(id);
  return {
    title: project
      ? `${project.title} — EVAN`
      : "프로젝트를 찾을 수 없습니다 — EVAN",
    description: project?.description,
  };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = getProjectById(id);
  if (!project) notFound();
  const related = getResearchById(project.relatedResearchId);
  const nextProject =
    projects[
      (projects.findIndex((item) => item.id === id) + 1) % projects.length
    ];
  return (
    <main id="main-content" className="secondary-page project-detail">
      <Link className="secondary-back" href="/projects">
        <ArrowLeft size={15} /> 모든 프로젝트
      </Link>
      <section className="project-detail-hero">
        <p className="secondary-eyebrow">
          PROJECT <span className="workspace-title-divider">/</span>{" "}
          {project.category}
        </p>
        <h1>{project.title}</h1>
        <p className="project-detail-description">{project.description}</p>
        <div className="project-detail-meta">
          <div className="project-tech">
            {project.tech.map((tech) => (
              <span key={tech}>{tech}</span>
            ))}
          </div>
          <span className="project-status">
            <span />
            {project.status}
          </span>
        </div>
      </section>
      <div className="project-detail-layout">
        <div className="project-detail-main">
          <section className="project-detail-section">
            <p className="secondary-eyebrow">01 — OVERVIEW</p>
            <h2>어떤 문제에서 시작했을까요?</h2>
            <p>{project.summary}</p>
          </section>
          <section className="project-detail-section">
            <p className="secondary-eyebrow">02 — APPROACH</p>
            <h2>문제를 푸는 방식</h2>
            <div className="project-approach">
              {project.approach.map((step, index) => (
                <article key={step.title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="project-detail-section">
            <p className="secondary-eyebrow">03 — OUTCOME</p>
            <h2>현재까지 정리한 결과</h2>
            <ul className="project-results">
              {project.results.map((result) => (
                <li key={result}>
                  <Check size={16} />
                  {result}
                </li>
              ))}
            </ul>
            <p className="project-state-note">
              {project.id === "news-intelligence"
                ? "현재 프론트엔드와 예시 데이터로 체험할 수 있습니다. 실제 뉴스 수집과 AI API는 연결하지 않았습니다."
                : "이 프로젝트는 설계 예시입니다. 실제 구현과 측정 결과는 후속 작업에서 추가할 예정입니다."}
            </p>
          </section>
        </div>
        <aside className="project-detail-aside">
          <div className="project-highlights">
            <Layers3 size={23} strokeWidth={1.3} />
            <h2>핵심 포인트</h2>
            <ul>
              {project.highlights.map((highlight) => (
                <li key={highlight}>
                  <span />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
          {related && (
            <Link className="project-related" href={`/research/${related.id}`}>
              <span>
                함께 읽는 리서치 <ArrowUpRight size={15} />
              </span>
              <h3>{related.title}</h3>
              <p>{related.summary}</p>
            </Link>
          )}
          {project.id === "news-intelligence" && (
            <Link href="/" className="project-demo-link">
              홈에서 데모 체험하기 <ExternalLink size={15} />
            </Link>
          )}
        </aside>
      </div>
      <Link href={`/projects/${nextProject.id}`} className="project-next">
        <div>
          <span>다음 프로젝트</span>
          <h2>{nextProject.title}</h2>
        </div>
        <ChevronRight size={25} />
      </Link>
    </main>
  );
}
