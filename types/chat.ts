export type ChatScope = "article" | "issue" | "all";

export interface ChatSource {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  evidenceKind: "body" | "analysis" | "title";
  citationNumber: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}

export interface ChatAnswer {
  answer: string;
  sources: ChatSource[];
  scope: ChatScope;
  revision: string;
}
