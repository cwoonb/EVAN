export interface ResearchSection {
  title: string;
  body: string;
  points?: string[];
}

export interface ResearchSource {
  title: string;
  publisher: string;
  url: string;
  description: string;
}

export interface ResearchItem {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  category: string;
  date: string;
  image: string;
  readTime: string;
  tags: string[];
  sections: ResearchSection[];
  sources: ResearchSource[];
  applications: { title: string; description: string; effort: string }[];
  process: { title: string; description: string }[];
}
