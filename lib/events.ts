import type { SearchSource } from "@/lib/search";

export type EvidenceLabel = "Confirmed" | "Not confirmed" | "Unknown";

export type EventRelevance = "relevant" | "unverified";

export type EventResult = {
  title: string;
  when: string | null;
  venue: string | null;
  url: string;
  food: EvidenceLabel;
  swag: EvidenceLabel;
  attendance: string;
  relevance: EventRelevance;
  evidence: SearchSource[];
};

export const SNIPPET_DISCLOSURE =
  "Excerpts are search snippets; the full page was not read.";

export const NO_MATCHING_EVENTS =
  "No verified matching events found in the retrieved evidence.";

export type RetrievedPage = {
  title: string;
  url: string;
  content: string;
};

const FOOD_NOUN =
  "(?:pizza|food|breakfast|lunch|dinner|brunch|drinks|beer|wine|coffee|catering|snacks|meal)";
const PROVIDED =
  "(?:provided|included|served|serving|complimentary|offered|available|for attendees)";

const EXPLICIT_FOOD = [
  new RegExp(`\\bfree\\s+${FOOD_NOUN}\\b`, "i"),
  new RegExp(`\\bcomplimentary\\s+${FOOD_NOUN}\\b`, "i"),
  new RegExp(`\\b${FOOD_NOUN}\\b(?:\\s+\\w+){0,5}\\s+${PROVIDED}\\b`, "i"),
  new RegExp(`\\b${PROVIDED}\\b(?:\\s+\\w+){0,6}\\s+${FOOD_NOUN}\\b`, "i"),
  /\bopen bar\b/i,
  /\bcatered\b/i,
];

const AMBIGUOUS_FOOD =
  /\b(refreshments|happy hour|pizza|food|breakfast|lunch|dinner|brunch|drinks|beer|wine|coffee|catering|snacks)\b/i;

const EXPLICIT_SWAG = [
  /\bfree\s+(?:swag|stickers?|t-?shirts?|shirts?|merch(?:andise)?)\b/i,
  /\bswag\s+bags?\b/i,
  /\bgiveaways?\b/i,
  /\b(?:swag|stickers?|t-?shirts?|shirts?|merch(?:andise)?)\b(?:\s+\w+){0,5}\s+(?:provided|included|for attendees|available)\b/i,
];

const AMBIGUOUS_SWAG =
  /\b(swag|stickers?|t-?shirts?|shirts?|merch(?:andise)?)\b/i;

const FREE_ADMISSION = [
  /\bfree (?:admission|entry|registration|rsvp|tickets?|event)\b/i,
  /\b(?:tickets?|admission|entry|registration) (?:are|is) free\b/i,
  /\bfree to attend\b/i,
  /\b(?:this )?event is free\b/i,
  /\bno (?:cost|charge) to attend\b/i,
  /\bcomplimentary (?:admission|tickets?|entry|registration)\b/i,
  /\b(?:price|cost|admission|tickets?)\s*[:\-]\s*free\b/i,
];

const MONTH =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

const DATE_PATTERN = new RegExp(
  `(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\\s+)?(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:\\s*(?:-|–|to)\\s*\\d{1,2}(?:st|nd|rd|th)?)?(?:,?\\s+\\d{4})?|\\b\\d{4}-\\d{2}-\\d{2}\\b`,
  "i",
);

const TOPIC_PATTERN =
  /\b(tech|ai|developer|developers|software|engineering|startup|hackathon|machine learning)\b/i;

const DIRECTORY_SLUGS = new Set([
  "discover",
  "explore",
  "calendar",
  "map",
  "nyc",
  "new-york",
  "newyork",
  "events",
  "search",
  "find",
]);

export function isNycTechEventQuery(query: string): boolean {
  const nyc =
    /\b(nyc|new york(?: city)?|manhattan|brooklyn|queens|bronx)\b/i.test(
      query,
    );
  const eventish =
    /\b(events?|meetups?|hackathons?|conferences?|workshops?|mixers?|calendar)\b/i.test(
      query,
    );
  return nyc && eventish;
}

export function buildEventQueries(query: string): string[] {
  const focus = clip(query, 280);

  return [
    focus,
    `${focus} event page pizza breakfast lunch drinks catering`,
    `${focus} event page swag giveaway stickers merchandise`,
  ];
}

export function researchEvents(
  pages: RetrievedPage[],
  query = "",
): {
  events: EventResult[];
  listings: SearchSource[];
  message: string;
} {
  const merged = mergePages(pages);
  const candidates: EventResult[] = [];
  const listings: SearchSource[] = [];
  let excluded = 0;

  for (const page of merged) {
    if (!isHttpUrl(page.url) || isDirectoryUrl(page.url) || isRoundup(page.title)) {
      listings.push(toListing(page));
      continue;
    }

    if (isSocialPost(page.url)) {
      excluded += 1;
      continue;
    }

    const relevance = assessRelevance(page, query);
    if (relevance === "exclude") {
      excluded += 1;
      continue;
    }

    candidates.push(toEvent(page, relevance));
  }

  const requested = requestedDates(query);
  const matching: EventResult[] = [];
  const unverified: EventResult[] = [];
  let droppedForDates = false;

  for (const event of candidates) {
    const inRange =
      requested !== null &&
      event.when !== null &&
      dateOverlaps(event.when, requested);

    if (requested && event.when && !inRange) {
      droppedForDates = true;
      continue;
    }

    if (requested) {
      if (event.relevance === "relevant" && inRange) {
        matching.push(event);
      } else {
        unverified.push(redactUnconfirmed(event));
      }
      continue;
    }

    if (event.relevance === "relevant") {
      matching.push(event);
    } else {
      unverified.push(event);
    }
  }

  return {
    events: [...matching, ...unverified],
    listings,
    message: describeFindings({
      relevant: matching.length,
      unverified: unverified.length,
      listings: listings.length,
      excluded,
      droppedForDates,
      requestedRange: requested !== null,
    }),
  };
}

export function labelFood(content: string): EvidenceLabel {
  if (hasExplicit(content, EXPLICIT_FOOD)) {
    return "Confirmed";
  }

  if (content.trim().length < 40 || AMBIGUOUS_FOOD.test(content)) {
    return "Unknown";
  }

  return "Not confirmed";
}

export function labelSwag(content: string): EvidenceLabel {
  if (hasExplicit(content, EXPLICIT_SWAG)) {
    return "Confirmed";
  }

  if (content.trim().length < 40 || AMBIGUOUS_SWAG.test(content)) {
    return "Unknown";
  }

  return "Not confirmed";
}

export function labelAttendance(content: string): string {
  const explicitFree = hasExplicit(content, FREE_ADMISSION);
  const price = ticketPrice(content);

  if (explicitFree && price && price !== "$0") {
    return "Unknown";
  }

  if (explicitFree || price === "$0") {
    return "Free";
  }

  if (price) {
    return price;
  }

  if (content.trim().length < 40) {
    return "Unknown";
  }

  return "Not confirmed";
}

export function extractWhen(text: string): string | null {
  const match = DATE_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const date = match[0].replace(/\s+/g, " ").trim();
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
  const time = after.match(
    /^\s*(?:at|·|,|-|–)?\s*(\d{1,2}(?::\d{2})?\s*(?:a\.m\.|p\.m\.|am|pm))\b/i,
  );

  return time ? `${date}, ${time[1].replace(/\s+/g, " ")}` : date;
}

export function extractVenue(text: string): string | null {
  const labeled = text.match(
    /\b(?:venue|location|address)\s*[:\-]\s*([^\n.]{3,90})/i,
  );
  const street = text.match(
    /\b\d{1,5}\s+[A-Z0-9][A-Za-z0-9.'’\- ]{2,40}\b(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Broadway|Place|Pl|Drive|Dr|Lane|Ln)\b\.?(?:,\s*[A-Za-z .'-]{2,40})?/i,
  );

  const candidate = cleanVenue(labeled?.[1] ?? street?.[0] ?? "");
  if (candidate) {
    return candidate;
  }

  if (
    /\b(?:location|venue|held)\b[\s\S]{0,24}\b(?:online|virtual)\b/i.test(text) ||
    /\b(?:online|virtual)\s+event\b/i.test(text)
  ) {
    return "Online";
  }

  return null;
}

export function isDirectoryUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "bing.com" ||
    host === "duckduckgo.com"
  ) {
    return true;
  }

  if (host === "meetup.com" && !hasEventId(parts)) {
    return true;
  }

  if (
    host.endsWith("eventbrite.com") &&
    (parts[0] === "d" || parts[0] === "b" || parts[0] === "t" || parts.length === 0)
  ) {
    return true;
  }

  if (
    (host === "lu.ma" || host === "luma.com") &&
    (parts.length === 0 || DIRECTORY_SLUGS.has(parts[0]?.toLowerCase() ?? ""))
  ) {
    return true;
  }

  if (
    host === "partiful.com" &&
    (parts.length === 0 || DIRECTORY_SLUGS.has(parts[0]?.toLowerCase() ?? ""))
  ) {
    return true;
  }

  return false;
}

function redactUnconfirmed(event: EventResult): EventResult {
  return {
    ...event,
    relevance: "unverified",
    venue: null,
    attendance: "Not confirmed",
    food: "Unknown",
    swag: "Unknown",
  };
}

function describeFindings(counts: {
  relevant: number;
  unverified: number;
  listings: number;
  excluded: number;
  droppedForDates: boolean;
  requestedRange: boolean;
}): string {
  const notes: string[] = [];

  if (counts.requestedRange && counts.relevant === 0) {
    notes.push(NO_MATCHING_EVENTS);
    if (counts.unverified > 0) {
      notes.push(
        "Pages without a confirmed date are unverified candidates, not matches.",
      );
    }
  } else if (counts.relevant === 0 && counts.unverified === 0) {
    notes.push(
      counts.droppedForDates
        ? "Evidence is insufficient. Event pages that were found do not state a date within the requested dates, so Scout will not present them as matches."
        : counts.listings > 0
          ? "Evidence is insufficient. The search returned directory or listing pages, not individual event pages, so Scout cannot confirm specific events, dates, venues, food, swag, or attendance price."
          : "No individual event pages were found. Scout cannot confirm dates, venues, food, swag, or attendance price.",
    );
  } else {
    notes.push(
      `Found ${counts.relevant} individual event page${counts.relevant === 1 ? "" : "s"}.`,
    );
    if (counts.unverified > 0) {
      notes.push(
        `${counts.unverified} direct link${counts.unverified === 1 ? " is" : "s are"} unverified because the snippet does not show the requested location or topic.`,
      );
    }
    notes.push(
      "Food and swag are confirmed only when a source explicitly says they are provided. Attendance is marked free only when a source says it is free.",
    );
    if (counts.listings > 0) {
      notes.push("Directory and listing pages were not used as evidence.");
    }
    if (counts.droppedForDates) {
      notes.push("Pages whose snippet states a date outside the request were not shown.");
    }
  }

  if (counts.excluded > 0) {
    notes.push(
      `${counts.excluded} direct link${counts.excluded === 1 ? " was" : "s were"} left out because the snippet did not show a relevant event.`,
    );
  }

  notes.push(SNIPPET_DISCLOSURE);
  return notes.join(" ");
}

function toListing(page: RetrievedPage): SearchSource {
  return {
    title: cleanTitle(page.title),
    url: page.url,
    excerpt: clip(page.content, 420),
  };
}

function toEvent(page: RetrievedPage, relevance: EventRelevance): EventResult {
  const text = `${page.title}\n${page.content}`;
  const content = page.content.trim();

  return {
    title: cleanTitle(page.title),
    when: extractWhen(text),
    venue: extractVenue(content),
    url: page.url,
    food: labelFood(content),
    swag: labelSwag(content),
    attendance: labelAttendance(content),
    relevance,
    evidence: [
      {
        title: cleanTitle(page.title),
        url: page.url,
        excerpt: evidenceExcerpt(content),
      },
    ],
  };
}

function assessRelevance(
  page: RetrievedPage,
  query: string,
): EventRelevance | "exclude" {
  const text = `${cleanTitle(page.title)}\n${page.content}`;
  if (!looksLikeEvent(text)) {
    return "exclude";
  }

  const location = locationMatch(query, text);
  const topic = topicMatch(query, text);
  if (location === "mismatch") {
    return "exclude";
  }

  if (location === "missing" || topic === "missing") {
    return "unverified";
  }

  return "relevant";
}

function looksLikeEvent(text: string): boolean {
  return /\b(meetups?|hackathons?|hacksprints?|conferences?|workshops?|summits?|mixers?|demo nights?|demo days?|rsvps?|tickets?|register|registration|doors|seminars?|symposiums?)\b/i.test(
    text,
  );
}

function locationMatch(
  query: string,
  text: string,
): "ok" | "missing" | "mismatch" | "not-required" {
  const asked = extractBorough(query).toLowerCase();
  const asksPlace =
    asked.length > 0 ||
    /\b(nyc|new york(?: city)?|manhattan|brooklyn|queens|bronx)\b/i.test(query);
  if (!asksPlace) {
    return "not-required";
  }

  const found = [
    ...text.matchAll(
      /\b(manhattan|brooklyn|queens|bronx|staten island|nyc|new york(?: city)?)\b/gi,
    ),
  ].map((match) => match[1].toLowerCase());
  if (found.length === 0) {
    return "missing";
  }

  if (!asked) {
    return "ok";
  }

  const generic = found.some((place) => place === "nyc" || place.startsWith("new york"));
  const specific = found.some((place) => place === asked);
  return specific || generic ? "ok" : "mismatch";
}

function topicMatch(
  query: string,
  text: string,
): "ok" | "missing" | "not-required" {
  if (!TOPIC_PATTERN.test(query)) {
    return "not-required";
  }

  return TOPIC_PATTERN.test(text) ? "ok" : "missing";
}

function isSocialPost(url: string): boolean {
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  return (
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "instagram.com" ||
    host === "twitter.com" ||
    host === "x.com" ||
    host === "linkedin.com" ||
    host === "youtube.com" ||
    host === "tiktok.com" ||
    host === "reddit.com"
  );
}

function isRoundup(title: string): boolean {
  return (
    /\b(upcoming events|events calendar|all events|event listings|things to do|browse events|find events)\b/i.test(
      title,
    ) ||
    /\b(\d+\s+)?(best|top|guide to|roundup|list of)\b.{0,40}\bevents?\b/i.test(
      title,
    ) ||
    /\bevents?\s+in\s+(nyc|new york)\b/i.test(title) ||
    /\b(newsletter|this week|roundup)\b/i.test(title)
  );
}

type CalendarDate = {
  month: number;
  day: number;
  endDay: number;
  year?: number;
};

function requestedDates(query: string): CalendarDate | null {
  const match = new RegExp(
    `\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*(?:-|–|to)\\s*(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s+(\\d{4}))?`,
    "i",
  ).exec(query);

  if (!match) {
    return null;
  }

  const month = monthNumber(match[1] ?? "");
  const day = Number(match[2]);
  const endDay = Number(match[3] ?? match[2]);
  if (!month || !day || !endDay) {
    return null;
  }

  return {
    month,
    day,
    endDay,
    year: match[4] ? Number(match[4]) : undefined,
  };
}

function dateOverlaps(when: string | null, requested: CalendarDate): boolean {
  if (!when) {
    return false;
  }

  const match = new RegExp(
    `\\b(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    "i",
  ).exec(when);
  if (!match) {
    return false;
  }

  const month = monthNumber(match[1] ?? "");
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : undefined;
  if (!month || !day || month !== requested.month) {
    return false;
  }

  if (requested.year && year && requested.year !== year) {
    return false;
  }

  return day >= requested.day && day <= requested.endDay;
}

function monthNumber(name: string): number | null {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const normalized = name.toLowerCase().replace(/\./g, "");
  const index = months.findIndex(
    (month) => month === normalized || month.startsWith(normalized),
  );
  return index >= 0 ? index + 1 : null;
}

function hasEventId(parts: string[]): boolean {
  const index = parts.findIndex((part) => part.toLowerCase() === "events");
  const id = index >= 0 ? parts[index + 1] : undefined;
  return Boolean(id && /^\d{5,}$/.test(id));
}

function mergePages(pages: RetrievedPage[]): RetrievedPage[] {
  const merged = new Map<string, RetrievedPage>();

  for (const page of pages) {
    if (!isHttpUrl(page.url)) {
      continue;
    }

    const key = normalizeUrl(page.url);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, {
        title: page.title,
        url: page.url,
        content: page.content.trim(),
      });
      continue;
    }

    if (page.content && !existing.content.includes(page.content.trim())) {
      existing.content = `${existing.content}\n${page.content.trim()}`.slice(0, 2400);
    }
  }

  return [...merged.values()];
}

function hasExplicit(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const expression = new RegExp(pattern.source, flags);

    for (const match of text.matchAll(expression)) {
      const index = match.index ?? 0;
      const span = text.slice(index, index + match[0].length + 24);
      const prefix = text.slice(Math.max(0, index - 16), index);
      if (/\b(no|not|without|n't)\b/i.test(`${prefix} ${span}`)) {
        continue;
      }
      return true;
    }

    return false;
  });
}

function ticketPrice(content: string): string | null {
  const prices = content.matchAll(/\$\s?\d{1,4}(?:\.\d{2})?/g);
  let found: string | null = null;

  for (const match of prices) {
    const index = match.index ?? 0;
    const window = content.slice(Math.max(0, index - 40), index + match[0].length + 40);
    if (
      !/\b(tickets?|admission|entry|registration|rsvp|attend|cover)\b/i.test(
        window,
      )
    ) {
      continue;
    }

    const normalized = match[0].replace(/\s/g, "");
    if (found && found !== normalized) {
      return null;
    }
    found = normalized;
  }

  return found;
}

function extractBorough(query: string): string {
  const match = query.match(/\b(manhattan|brooklyn|queens|bronx|staten island)\b/i);
  return match?.[1] ?? "";
}

function evidenceExcerpt(content: string): string {
  const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);
  const picked = sentences.filter((sentence) =>
    hasExplicit(sentence, [...EXPLICIT_FOOD, ...EXPLICIT_SWAG, ...FREE_ADMISSION]),
  );
  const text = (picked.length > 0 ? picked.slice(0, 2).join(" ") : content).trim();
  return clip(text, 420);
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[|·•]\s*(Luma|Meetup|Eventbrite|Partiful)\s*$/i, "")
    .trim();
}

function cleanVenue(value: string): string | null {
  const venue = value.replace(/\s+/g, " ").replace(/[.,;\s]+$/, "").trim();
  if (!venue || /^(new york|nyc|manhattan|brooklyn|queens|bronx|tbd|tba)$/i.test(venue)) {
    return null;
  }
  return venue.length > 90 ? `${venue.slice(0, 90)}…` : venue;
}

function clip(value: string, maxLength: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  url.pathname = url.pathname.replace(/\/$/, "");
  return url.toString();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
