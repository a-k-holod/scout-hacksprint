"use client";

import { useId, useState } from "react";
import type { EventResult, SearchResponse, SearchSource } from "@/lib/search";

type Status = "idle" | "loading" | "done" | "error";

export function SearchPanel() {
  const inputId = useId();
  const errorId = useId();
  const [question, setQuestion] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = question.trim();

    if (!query) {
      setFieldError("Enter a research question.");
      setStatus("idle");
      setResponse(null);
      return;
    }

    if (query.length > 500) {
      setFieldError("Keep the question under 500 characters.");
      setStatus("idle");
      setResponse(null);
      return;
    }

    setFieldError(null);
    setResponse(null);
    setStatus("loading");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const data: unknown = await res.json();

      if (!res.ok || !isSearchResponse(data) || !data.connected) {
        setFieldError(readError(data));
        setStatus("error");
        return;
      }

      setResponse(data);
      setStatus("done");
    } catch {
      setFieldError(null);
      setStatus("error");
    }
  }

  return (
    <div className="workspace">
      <form className="search-form" onSubmit={onSubmit}>
        <label htmlFor={inputId}>Research question</label>
        <div className="search-row">
          <input
            id={inputId}
            name="query"
            type="text"
            value={question}
            maxLength={500}
            placeholder="What should Scout look up?"
            autoComplete="off"
            enterKeyHint="search"
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
            onChange={(event) => {
              setQuestion(event.target.value);
              if (fieldError) {
                setFieldError(null);
              }
            }}
          />
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Searching…" : "Search"}
          </button>
        </div>
        {fieldError ? (
          <p id={errorId} className="field-error" role="alert">
            {fieldError}
          </p>
        ) : null}
      </form>

      <section
        className="results"
        aria-live="polite"
        aria-busy={status === "loading"}
      >
        <h2>Results</h2>
        <div className="sheet">
          {status === "loading" ? <p className="status">Searching…</p> : null}

          {status === "error" && !fieldError ? (
            <p className="notice" role="alert">
              Search could not be completed. Try again.
            </p>
          ) : null}

          {status === "idle" ? (
            <p className="notice">Sources from a search will appear here.</p>
          ) : null}

          {status === "done" && response ? (
            <div className="answer">
              <p className="asked">{response.query}</p>
              {response.message ? (
                <p className="notice">{response.message}</p>
              ) : null}
              {response.focus === "events" &&
              relevantEvents(response.events).length > 0 ? (
                <>
                  <h3 className="sources-heading">Matching events</h3>
                  <ol className="sources">
                    {relevantEvents(response.events).map((event) => (
                      <EventCard key={event.url} event={event} />
                    ))}
                  </ol>
                </>
              ) : null}

              {unverifiedEvents(response.events).length > 0 ? (
                <>
                  <h3 className="sources-heading">Unverified candidates</h3>
                  <p className="notice">
                    The date could not be confirmed from the retrieved
                    evidence. These pages are not matches for the requested
                    dates.
                  </p>
                  <ol className="sources">
                    {unverifiedEvents(response.events).map((event) => (
                      <EventCard key={event.url} event={event} showDetails={false} />
                    ))}
                  </ol>
                </>
              ) : null}

              {response.sources.length > 0 ? (
                <>
                  <h3 className="sources-heading">
                    {response.focus === "events"
                      ? "Listing pages not used as evidence"
                      : "Sources"}
                  </h3>
                  <ol className="sources">
                    {response.sources.map((source, index) => (
                      <SourceItem
                        key={`${source.url}-${index}`}
                        source={source}
                      />
                    ))}
                  </ol>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function EventCard({
  event,
  showDetails = true,
}: {
  event: EventResult;
  showDetails?: boolean;
}) {
  return (
    <li className="event">
      <SourceLink title={event.title} url={event.url} />
      {showDetails ? (
        <dl className="event-facts">
          <div>
            <dt>When</dt>
            <dd>{event.when ?? "Not stated in the retrieved evidence."}</dd>
          </div>
          <div>
            <dt>Venue</dt>
            <dd>{event.venue ?? "Not stated in the retrieved evidence."}</dd>
          </div>
          <div>
            <dt>Attendance</dt>
            <dd>{event.attendance}</dd>
          </div>
          <div>
            <dt>Food</dt>
            <dd>{event.food}</dd>
          </div>
          <div>
            <dt>Swag</dt>
            <dd>{event.swag}</dd>
          </div>
        </dl>
      ) : (
        <p className="notice">
          The date could not be confirmed from the retrieved evidence.
        </p>
      )}
      {event.evidence.map((source) =>
        source.url === event.url ? (
          source.excerpt ? (
            <p key={source.url} className="source-excerpt">
              {source.excerpt}
            </p>
          ) : null
        ) : (
          <div key={source.url} className="evidence">
            <SourceLink title={source.title} url={source.url} />
            {source.excerpt ? (
              <p className="source-excerpt">{source.excerpt}</p>
            ) : null}
          </div>
        ),
      )}
    </li>
  );
}

function SourceItem({ source }: { source: SearchSource }) {
  return (
    <li className="source">
      <SourceLink title={source.title} url={source.url} />
      {source.excerpt ? <p className="source-excerpt">{source.excerpt}</p> : null}
    </li>
  );
}

function SourceLink({ title, url }: { title: string; url: string }) {
  if (!isHttpUrl(url)) {
    return <p className="source-title">{title}</p>;
  }

  return (
    <a
      className="source-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span className="source-title">{title}</span>
      <span className="source-url">{url}</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function relevantEvents(events: EventResult[]): EventResult[] {
  return events.filter((event) => event.relevance === "relevant");
}

function unverifiedEvents(events: EventResult[]): EventResult[] {
  return events.filter((event) => event.relevance === "unverified");
}

function readError(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof data.error === "string" &&
    data.error.trim()
  ) {
    return data.error;
  }

  if (
    typeof data === "object" &&
    data !== null &&
    "message" in data &&
    typeof data.message === "string" &&
    data.message.trim()
  ) {
    return data.message;
  }

  return "Search could not be completed. Try again.";
}

function isSearchResponse(data: unknown): data is SearchResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  if (!("query" in data) || typeof data.query !== "string") {
    return false;
  }

  if (!("connected" in data) || typeof data.connected !== "boolean") {
    return false;
  }

  if (!("message" in data) || typeof data.message !== "string") {
    return false;
  }

  if (!("sources" in data) || !Array.isArray(data.sources)) {
    return false;
  }

  if (!data.sources.every(isSearchSource)) {
    return false;
  }

  if (
    !("focus" in data) ||
    (data.focus !== "events" && data.focus !== "general")
  ) {
    return false;
  }

  if (!("events" in data) || !Array.isArray(data.events)) {
    return false;
  }

  return data.events.every(isEventResult);
}

function isSearchSource(source: unknown): source is SearchSource {
  return (
    typeof source === "object" &&
    source !== null &&
    "title" in source &&
    typeof source.title === "string" &&
    "url" in source &&
    typeof source.url === "string" &&
    "excerpt" in source &&
    typeof source.excerpt === "string"
  );
}

function isEventResult(event: unknown): event is EventResult {
  if (typeof event !== "object" || event === null) {
    return false;
  }

  const attendance =
    "attendance" in event &&
    typeof event.attendance === "string" &&
    event.attendance.trim().length > 0;
  const when =
    "when" in event && (event.when === null || typeof event.when === "string");
  const venue =
    "venue" in event &&
    (event.venue === null || typeof event.venue === "string");

  return (
    "title" in event &&
    typeof event.title === "string" &&
    "url" in event &&
    typeof event.url === "string" &&
    when &&
    venue &&
    attendance &&
    "food" in event &&
    isEvidenceLabel(event.food) &&
    "swag" in event &&
    isEvidenceLabel(event.swag) &&
    "relevance" in event &&
    (event.relevance === "relevant" || event.relevance === "unverified") &&
    "evidence" in event &&
    Array.isArray(event.evidence) &&
    event.evidence.every(isSearchSource)
  );
}

function isEvidenceLabel(
  value: unknown,
): value is EventResult["food"] {
  return value === "Confirmed" || value === "Not confirmed" || value === "Unknown";
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
