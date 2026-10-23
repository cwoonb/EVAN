export type NewsImportance = 1 | 2 | 3 | 4 | 5;

export interface NewsSourceAnalysis {
  whyItMatters: string;
  developerImpact: string;
  keyFacts: string[];
  watchPoints: string[];
  contentStatus: string;
}

export interface NewsSource {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary: string;
  searchKeywords: string[];
  // Optional raw image URL. Rendering still requires the local approval registry.
  image?: string;
  // Optional additions keep already published version-1 feeds readable.
  importance?: NewsImportance;
  analysis?: NewsSourceAnalysis;
  display?: {
    titleKo: string;
    event: { subject: string; action: string; object: string };
  };
}

export interface NewsEvent {
  subject: string;
  action: string;
  object: string;
  version: string;
  date: string;
  summary: string;
}

export interface NewsIssue {
  id: string;
  title: string;
  summary: string;
  importance: NewsImportance;
  category: string;
  image?: string;
  eventType: string;
  publishedAt: string;
  updatedAt: string;
  keywords: string[];
  searchKeywords: string[];
  newTechnologies: string[];
  event: NewsEvent;
  sources: NewsSource[];
  analysis: {
    status: string;
    summaryMethod: string;
    groupingMethod: string;
  };
}

export interface NewsFeed {
  version: 1;
  revision: string;
  generatedAt: string;
  latestPublishedAt: string | null;
  stats: {
    inputRows: number;
    articles: number;
    issues: number;
    duplicates: number;
    skipped: number;
  };
  issues: NewsIssue[];
}
