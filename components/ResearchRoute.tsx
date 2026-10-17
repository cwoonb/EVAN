"use client";

import { useSearchParams } from "next/navigation";
import { ResearchList } from "@/components/ResearchList";

export function ResearchRoute() {
  const searchParams = useSearchParams();
  const category =
    searchParams.get("category") || searchParams.get("topic") || "전체";
  const query = searchParams.get("q") || "";

  return (
    <ResearchList
      key={JSON.stringify([category, query])}
      initialCategory={category}
      initialQuery={query}
    />
  );
}
