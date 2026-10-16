import { enrichEventPages, readVisiblePages } from "@/lib/anchor";
import {
  buildEventQueries,
  isDirectoryUrl,
  isNycTechEventQuery,
  researchEvents,
  type EventResult,
  type RetrievedPage,
} from "@/lib/events";
import {
  describeGeneralFindings,
  mergeAndRankHits,
  officialDomains,
  officialSourcesOnly,
  retainOfficialHits,
} from "@/lib/sources";

export type { EventResult, EvidenceLabel } from "@/lib/events";

export type SearchSource = {
  title: string;
  url: string;
  excerpt: string;
};

export type SearchResponse = {
  query: string;
  connected: boolean;
  sources: SearchSource[];
  events: EventResult[];
  focus: "events" | "general";
  message: string;
};

export class SearchError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 25_000;
const EVENT_PAGE_DOMAINS = ["lu.ma", "luma.com", "partiful.com"];

export async function searchWeb(query: string): Promise<SearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();

  if (!apiKey) {
    throw new SearchError("Web search is not configured.", 503);
  }

  if (isNycTechEventQuery(query)) {
    return searchEvents(query, apiKey);
  }

  const domains = officialDomains(query);
  const searches = [
    tavilySearch(query, apiKey, {
      search_depth: "advanced",
      max_results: 8,
    }),
  ];

  if (domains) {
    searches.push(
      tavilySearch(query, apiKey, {
        search_depth: "advanced",
        max_results: 5,
        include_domains: domains,
        include_domains_mode: "restrict",
      }),
    );
  }

  const settled = await Promise.allSettled(searches);
  if (settled.every((result) => result.status === "rejected")) {
    throw failureFromSettled(settled);
  }

  const ranked = mergeAndRankHits(
    settled.map((result, index) => ({
      hits: result.status === "fulfilled" ? result.value : [],
      preferred: index === 1,
    })),
    domains ?? [],
  );
  const hits =
    domains && officialSourcesOnly(query)
      ? retainOfficialHits(ranked, domains)
      : ranked;
  const sources = hits.map(toSource);

  return {
    query,
    connected: true,
    sources,
    events: [],
    focus: "general",
    message: describeGeneralFindings(
      hits,
      domains,
      domains !== null && settled[1]?.status === "rejected",
    ),
  };
}

async function searchEvents(
  query: string,
  apiKey: string,
): Promise<SearchResponse> {
  const queries = buildEventQueries(query);
  const settled = await Promise.allSettled(
    queries.map((focused, index) =>
      tavilySearch(focused, apiKey, {
        search_depth: "advanced",
        max_results: 8,
        ...(index === 0
          ? {}
          : {
              include_domains: EVENT_PAGE_DOMAINS,
              include_domains_mode: "prefer" as const,
            }),
      }),
    ),
  );

  const fulfilled = settled.filter(
    (result): result is PromiseFulfilledResult<RetrievedPage[]> =>
      result.status === "fulfilled",
  );

  if (fulfilled.length === 0) {
    throw failureFromSettled(settled);
  }

  const pages = fulfilled.flatMap((result) => result.value);
  const anchorKey = process.env.ANCHORBROWSER_API_KEY?.trim();
  const evidenced = anchorKey
    ? await enrichEventPages(
        pages,
        (urls) => readVisiblePages(urls, anchorKey),
        (url) => !isDirectoryUrl(url),
      )
    : { pages, opened: 0 };
  const research = researchEvents(evidenced.pages, query);
  const message =
    evidenced.opened > 0
      ? `${research.message} Visible text from opened event pages was included as evidence.`
      : research.message;

  return {
    query,
    connected: true,
    sources: research.listings,
    events: research.events,
    focus: "events",
    message,
  };
}

async function tavilySearch(
  query: string,
  apiKey: string,
  options: {
    search_depth: "basic" | "advanced";
    max_results: number;
    include_domains?: string[];
    include_domains_mode?: "prefer" | "restrict";
  },
): Promise<RetrievedPage[]> {
  let response: Response;

  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        topic: "general",
        search_depth: options.search_depth,
        max_results: options.max_results,
        chunks_per_source: 3,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
        ...(options.include_domains
          ? {
              include_domains: options.include_domains,
              include_domains_mode: options.include_domains_mode,
            }
          : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SearchError("Web search could not be reached. Try again.", 502);
  }

  if (!response.ok) {
    throw failureForStatus(response.status);
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new SearchError("Web search returned an unexpected response.", 502);
  }

  const pages = readPages(payload);

  if (!pages) {
    throw new SearchError("Web search returned an unexpected response.", 502);
  }

  return pages;
}

function failureFromSettled(
  settled: PromiseSettledResult<RetrievedPage[]>[],
): SearchError {
  const reasons = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  const searchError = reasons.find(
    (reason): reason is SearchError => reason instanceof SearchError,
  );

  return (
    searchError ??
    new SearchError("Web search could not be reached. Try again.", 502)
  );
}

function failureForStatus(status: number): SearchError {
  if (status === 429) {
    return new SearchError("Web search is busy. Try again in a moment.", 429);
  }

  if (status === 401 || status === 403) {
    return new SearchError("Web search is unavailable.", 502);
  }

  if (status === 432 || status === 433) {
    return new SearchError("Web search is temporarily unavailable.", 503);
  }

  if (status >= 500) {
    return new SearchError(
      "Web search is temporarily unavailable. Try again.",
      502,
    );
  }

  return new SearchError("Web search could not complete this request.", 502);
}

function readPages(payload: unknown): RetrievedPage[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return null;
  }

  const pages: RetrievedPage[] = [];

  for (const result of payload.results) {
    const page = readPage(result);

    if (page) {
      pages.push(page);
    }
  }

  if (payload.results.length > 0 && pages.length === 0) {
    return null;
  }

  return pages;
}

function readPage(result: unknown): RetrievedPage | null {
  if (!isRecord(result)) {
    return null;
  }

  const title = readText(result.title, 300);
  const url = readText(result.url, 2000);
  const content = readText(result.content, 2000);

  if (!title || !url || !isHttpUrl(url)) {
    return null;
  }

  return { title, url, content };
}

function toSource(page: RetrievedPage): SearchSource {
  return {
    title: page.title,
    url: page.url,
    excerpt: page.content.length > 700 ? `${page.content.slice(0, 700)}…` : page.content,
  };
}

function readText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
