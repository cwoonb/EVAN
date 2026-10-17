import type { Metadata } from "next";
import { Suspense } from "react";
import NewsExplorer from "@/components/NewsExplorer";

export const metadata: Metadata = {
  title: "AI 뉴스 탐색",
  description:
    "AI 뉴스를 키워드와 중요도로 검색하고, 같은 사건의 통합 요약과 원문 기사를 확인합니다.",
};

export default function NewsPage() {
  return (
    <main id="main-content" className="news-explorer-page">
      <Suspense
        fallback={
          <div className="news-explorer-loading" role="status">
            뉴스 탐색 화면을 준비하고 있습니다.
          </div>
        }
      >
        <NewsExplorer />
      </Suspense>
    </main>
  );
}
