export type RetrievedHit = {
  title: string;
  url: string;
  content: string;
};

const OFFICIAL_SITES: { pattern: RegExp; domains: string[] }[] = [
  { pattern: /\bnasa\b/i, domains: ["nasa.gov", "science.nasa.gov"] },
];

export function officialDomains(query: string): string[] | null {
  if (!/\bofficial\b/i.test(query)) {
    return null;
  }

  for (const site of OFFICIAL_SITES) {
    if (site.pattern.test(query)) {
      return site.domains;
    }
  }

  return null;
}

export function mergeAndRankHits(
  groups: { hits: RetrievedHit[]; preferred: boolean }[],
  domains: string[],
): RetrievedHit[] {
  const merged = new Map<
    string,
    {
      hit: RetrievedHit;
      preferred: boolean;
      seen: number;
      preferredSeen: number | null;
    }
  >();
  let order = 0;

  for (const group of groups) {
    for (const hit of group.hits) {
      if (!isHttpUrl(hit.url)) {
        continue;
      }

      const key = normalizeUrl(hit.url);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, {
          hit: { ...hit, content: hit.content.trim() },
          preferred: group.preferred,
          seen: order,
          preferredSeen: group.preferred ? order : null,
        });
        order += 1;
        continue;
      }

      if (group.preferred && existing.preferredSeen === null) {
        existing.preferredSeen = order;
      }
      existing.preferred = existing.preferred || group.preferred;
      order += 1;
      const addition = hit.content.trim();
      if (addition && !existing.hit.content.includes(addition)) {
        existing.hit.content = `${existing.hit.content}\n${addition}`.slice(0, 2400);
      }
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      const leftRank = rank(left.hit.url, left.preferred, domains);
      const rightRank = rank(right.hit.url, right.preferred, domains);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return (
        (left.preferredSeen ?? left.seen) - (right.preferredSeen ?? right.seen)
      );
    })
    .map((item) => item.hit);
}

export function isOfficialHost(url: string, domains: string[]): boolean {
  if (domains.length === 0) {
    return false;
  }

  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }

  return domains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}

export function describeGeneralFindings(
  hits: RetrievedHit[],
  domains: string[] | null,
  officialSearchFailed: boolean,
): string {
  const count = hits.length;
  const notes = [
    count > 0
      ? `Found ${count} source${count === 1 ? "" : "s"}.`
      : "No sources were found for this question.",
  ];

  if (domains) {
    const officialCount = hits.filter((hit) => isOfficialHost(hit.url, domains)).length;
    notes.push(
      officialSearchFailed || officialCount === 0
        ? "No page from the requested official site was retrieved, so this is not verified."
        : "Official-site snippets are listed first. This is not full-page verification.",
    );
  }

  notes.push("Excerpts are search snippets; the full page was not read.");
  return notes.join(" ");
}

function rank(url: string, preferred: boolean, domains: string[]): number {
  const official = isOfficialHost(url, domains);
  if (preferred && official) {
    return 0;
  }
  if (official) {
    return 1;
  }
  return 2;
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
