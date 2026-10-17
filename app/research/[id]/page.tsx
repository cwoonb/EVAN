import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResearchWorkspace } from "@/components/ResearchWorkspace";
import { getResearchById, research } from "@/data/research";

export function generateStaticParams() {
  return research.map((item) => ({ id: item.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = getResearchById(id);
  return {
    title: item ? `${item.title} — EVAN` : "리서치를 찾을 수 없습니다 — EVAN",
    description: item?.summary,
  };
}

export default async function ResearchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = getResearchById(id);
  if (!item) notFound();
  return <ResearchWorkspace research={item} />;
}
