import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main id="main-content" className="not-found page-shell">
      <span className="eyebrow">404 · UNKNOWN TERRITORY</span>
      <h1>아직 탐험하지 않은 곳이네요.</h1>
      <p>
        페이지를 찾을 수 없습니다. 새로운 인사이트가 기다리는 홈으로 돌아가세요.
      </p>
      <Link className="primary-link" href="/">
        <ArrowLeft size={16} /> 홈으로 돌아가기
      </Link>
    </main>
  );
}
