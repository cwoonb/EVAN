import Link from "next/link";
import {
  ArrowUpRight,
  Boxes,
  Code2,
  Cpu,
  ScanEye,
  Workflow,
} from "lucide-react";
import { projects } from "@/data/projects";

const icons = [Boxes, Workflow, Cpu, ScanEye, Code2];

export const metadata = {
  title: "프로젝트 — EVAN",
  description: "AI의 가능성을 실제 사용 경험으로 연결하는 EVAN의 프로젝트.",
};

export default function ProjectsPage() {
  return (
    <main id="main-content" className="secondary-page project-index">
      <section className="secondary-hero">
        <p className="secondary-eyebrow">
          <span /> BUILT WITH CURIOSITY
        </p>
        <div className="secondary-heading-row">
          <div>
            <h1>
              아이디어를 <em>실제로.</em>
            </h1>
            <p>
              기술을 이해하는 가장 좋은 방법은, 직접 만들어보는 것이라고
              믿습니다.
            </p>
          </div>
          <span className="secondary-quiet-note">
            {projects.length}개의 프로젝트와 실험
          </span>
        </div>
      </section>
      <div className="project-list">
        {projects.map((project, index) => {
          const Icon = icons[index];
          return (
            <Link
              href={`/projects/${project.id}`}
              className="project-row"
              key={project.id}
            >
              <span className="project-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="project-icon">
                <Icon size={27} strokeWidth={1.3} />
              </div>
              <div className="project-row-content">
                <div className="project-row-heading">
                  <span className="project-category">{project.category}</span>
                  <span
                    className={`project-status${index === 0 ? " is-live" : ""}`}
                  >
                    <span />
                    {project.status}
                  </span>
                </div>
                <h2>{project.title}</h2>
                <p>{project.description}</p>
                <div className="project-tech">
                  {project.tech.map((tech) => (
                    <span key={tech}>{tech}</span>
                  ))}
                </div>
              </div>
              <span className="project-row-arrow">
                <ArrowUpRight size={24} strokeWidth={1.3} />
              </span>
            </Link>
          );
        })}
      </div>
      <div className="project-closing">
        <p>좋은 프로젝트는 좋은 질문에서 시작됩니다.</p>
        <Link href="/research">
          프로젝트가 시작된 리서치 보기 <ArrowUpRight size={15} />
        </Link>
      </div>
      <p className="secondary-demo-note">
        포트폴리오 데모 · 각 프로젝트의 구현 범위와 상태는 상세 페이지에
        표시했습니다.
      </p>
    </main>
  );
}
