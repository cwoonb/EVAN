import { Suspense } from "react";
import { ResearchList } from "@/components/ResearchList";
import { ResearchRoute } from "@/components/ResearchRoute";

export const metadata = {
  title: "리서치",
  description:
    "AI의 변화를 읽고 실험하며 다음 프로젝트의 가능성을 찾는 리서치 노트.",
};

export default function ResearchPage() {
  return (
    <Suspense fallback={<ResearchList />}>
      <ResearchRoute />
    </Suspense>
  );
}
