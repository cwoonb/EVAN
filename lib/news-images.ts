/** Fixed category artwork. Do not choose images from company names or keywords. */
export const NEWS_IMAGE_MAPPING_VERSION = "category-artwork-v1";
export const categoryImageManifest = {
  technology: ["technology-01.webp", "technology-02.webp", "technology-03.webp"],
  product: ["product-01.webp", "product-02.webp", "product-03.webp"],
  business: ["business-01.webp", "business-02.webp", "business-03.webp"],
  market: ["market-01.webp", "market-02.webp", "market-03.webp"],
  policy: ["policy-01.webp", "policy-02.webp", "policy-03.webp"],
  security: ["security-01.webp", "security-02.webp", "security-03.webp"],
  other: ["other-01.webp", "other-02.webp", "other-03.webp"],
} as const;
export type NewsImageCategory = keyof typeof categoryImageManifest;
export const NEWS_IMAGE_DIRECTORY = "/images/news-fallbacks/";
export const DEFAULT_NEWS_IMAGE = `${NEWS_IMAGE_DIRECTORY}default.webp`;
export const categoryAliases: Readonly<Record<string, NewsImageCategory>> = {
  "기술": "technology", technology: "technology", tech: "technology",
  "제품": "product", product: "product", products: "product",
  "비즈니스": "business", business: "business",
  "시장": "market", market: "market", markets: "market",
  "정책": "policy", policy: "policy", regulation: "policy",
  "보안": "security", security: "security", cybersecurity: "security",
  "기타": "other", other: "other", general: "other",
};
export const categoryLabels: Record<NewsImageCategory, string> = {
  technology: "기술", product: "제품", business: "비즈니스", market: "시장", policy: "정책", security: "보안", other: "기타",
};

export interface NewsImageInput { id?: string; url?: string; title?: string; category?: string; image?: unknown; publishedAt?: string }
export interface ApprovedArticleImage { url: string; rightsNote: string; approvedAt: string }
/** No existing permission policy or representative-image field exists. Opt in per exact URL after review. */
export const approvedArticleImagePolicy: readonly ApprovedArticleImage[] = [];
/** Local article photos must be added explicitly, with an existing file and a rights approval. */
export const registeredLocalArticleImages: readonly string[] = [];
export interface ImageResolutionOptions { approvedImages?: readonly ApprovedArticleImage[]; localArticlePaths?: readonly string[] }
export interface NewsImageChoice { kind: "article" | "category" | "default" | "css"; src: string | null; category: NewsImageCategory; identity: string; variant: number }

/** Map only explicit category aliases. Missing/unknown input becomes neutral other artwork. */
export function normalizeCategory(value: unknown): NewsImageCategory {
  if (typeof value !== "string") return "other";
  const alias = value.normalize("NFKC").trim().toLowerCase();
  return Object.hasOwn(categoryAliases, alias) ? categoryAliases[alias] : "other";
}

function stableUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return value.trim();
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch { return value.trim(); }
}

/** Stable article identity, independent of ordering, filters, clocks and surrounding articles. */
export function newsImageIdentity(news: NewsImageInput): string {
  if (news.id?.trim()) return `id:${news.id.trim()}`;
  if (news.url?.trim()) return `url:${stableUrl(news.url)}`;
  const title = (news.title ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
  return `text:${title}|published:${(news.publishedAt ?? "").trim()}`;
}

export function stableImageHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/** URL syntax is a security check, never evidence of image usage permission. */
export function isPublicImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) return false;
    if (!host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host) || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) return false;
    return ![...url.searchParams.keys()].some((key) => /^(?:token|access_token|api_key|apikey|key|secret|signature|sig|auth|authorization|password|session|sessionid)$/i.test(key));
  } catch { return false; }
}

export function approvedArticleImage(value: unknown, options: ImageResolutionOptions = {}): string | null {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) return null;
  const approval = (options.approvedImages ?? approvedArticleImagePolicy).find((item) => item.url === value);
  if (!approval?.rightsNote.trim() || !approval.approvedAt || !Number.isFinite(Date.parse(approval.approvedAt))) return null;
  if (value.startsWith("/")) {
    const known = options.localArticlePaths ?? registeredLocalArticleImages;
    return /^\/images\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g|avif)$/.test(value) && known.includes(value) ? value : null;
  }
  return isPublicImageUrl(value) ? value : null;
}

/** Resolve a permitted article image or fixed category/default artwork, skipping known failures. */
export function resolveNewsImage(news: NewsImageInput, failures: ReadonlySet<string> = new Set(), options: ImageResolutionOptions = {}): NewsImageChoice {
  const category = normalizeCategory(news.category);
  const identity = newsImageIdentity(news);
  const variant = stableImageHash(`${NEWS_IMAGE_MAPPING_VERSION}|${identity}`) % 3;
  const common = { category, identity, variant };
  const actual = approvedArticleImage(news.image, options);
  if (actual && !failures.has(actual)) return { ...common, kind: "article", src: actual };
  const categoryPath = NEWS_IMAGE_DIRECTORY + categoryImageManifest[category][variant];
  if (!failures.has(categoryPath)) return { ...common, kind: "category", src: categoryPath };
  if (!failures.has(DEFAULT_NEWS_IMAGE)) return { ...common, kind: "default", src: DEFAULT_NEWS_IMAGE };
  return { ...common, kind: "css", src: null };
}

/** On 403/404/network failure, record the exact failed source and advance at most three image stages. */
export function nextNewsImage(news: NewsImageInput, current: NewsImageChoice, failures: Set<string>, options: ImageResolutionOptions = {}): NewsImageChoice {
  if (current.src) failures.add(current.src);
  return resolveNewsImage(news, failures, options);
}

// Shared across mounted cards and route transitions; never fill this from an untrusted feed field.
const failedSources = new Set<string>();
const failureListeners = new Set<() => void>();
let failureRevision = 0;
export function failedNewsImages(): ReadonlySet<string> { return failedSources; }
export function newsImageFailureRevision(): number { return failureRevision; }
export function subscribeNewsImageFailures(listener: () => void): () => void {
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}
export function rememberNewsImageFailure(source: string): void {
  if (failedSources.has(source)) return;
  failedSources.add(source);
  failureRevision += 1;
  failureListeners.forEach((listener) => listener());
}
