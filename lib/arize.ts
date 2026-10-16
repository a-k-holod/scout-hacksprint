import { SpanStatusCode, trace, type Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
  INPUT_VALUE,
  OpenInferenceSpanKind,
  OUTPUT_VALUE,
  SEMRESATTRS_PROJECT_NAME,
  SemanticConventions,
} from "@arizeai/openinference-semantic-conventions";

const PROJECT_NAME = "scout";
const US_TRACE_URL = "https://otlp.arize.com/v1/traces";

export type SearchObservation = {
  focus: "events" | "general";
  candidateCount: number;
  matchingCount: number;
  unverifiedCount: number;
  pagesOpened: number;
  outcome: "match" | "unverified" | "no-match" | "results" | "error";
  durationMs: number;
  errorStatus?: number;
};

type SearchRun = {
  focus: SearchObservation["focus"];
  candidateCount: number;
  events: readonly { relevance: "relevant" | "unverified" }[];
  pagesOpened: number;
  durationMs: number;
  errorStatus?: number;
};

let provider: NodeTracerProvider | null = null;

export function observationFor(run: SearchRun): SearchObservation {
  const matchingCount = run.events.filter(
    (event) => event.relevance === "relevant",
  ).length;
  const unverifiedCount = run.events.filter(
    (event) => event.relevance === "unverified",
  ).length;
  const outcome =
    run.errorStatus !== undefined
      ? "error"
      : run.focus === "general"
        ? "results"
        : matchingCount > 0
          ? "match"
          : unverifiedCount > 0
            ? "unverified"
            : "no-match";

  return {
    focus: run.focus,
    candidateCount: run.candidateCount,
    matchingCount,
    unverifiedCount,
    pagesOpened: run.pagesOpened,
    outcome,
    durationMs: run.durationMs,
    errorStatus: run.errorStatus,
  };
}

export function observeSearch(
  observation: SearchObservation,
  emit: (observation: SearchObservation) => void = emitToArize,
): void {
  try {
    emit(observation);
  } catch {
    // A telemetry failure must leave the search result unchanged.
  }
}

export function writeSearchSpan(span: Span, observation: SearchObservation): void {
  const output = {
    focus: observation.focus,
    candidateCount: observation.candidateCount,
    matchingCount: observation.matchingCount,
    unverifiedCount: observation.unverifiedCount,
    pagesOpened: observation.pagesOpened,
    outcome: observation.outcome,
    durationMs: observation.durationMs,
    errorStatus: observation.errorStatus ?? null,
  };

  span.setAttribute(
    SemanticConventions.OPENINFERENCE_SPAN_KIND,
    OpenInferenceSpanKind.CHAIN,
  );
  span.setAttribute(INPUT_VALUE, JSON.stringify({ focus: observation.focus }));
  span.setAttribute(OUTPUT_VALUE, JSON.stringify(output));
  span.setAttribute("search.focus", observation.focus);
  span.setAttribute("search.candidate_count", observation.candidateCount);
  span.setAttribute("search.matching_count", observation.matchingCount);
  span.setAttribute("search.unverified_count", observation.unverifiedCount);
  span.setAttribute("search.pages_opened", observation.pagesOpened);
  span.setAttribute("search.outcome", observation.outcome);
  span.setAttribute("search.duration_ms", observation.durationMs);
  if (observation.errorStatus !== undefined) {
    span.setAttribute("search.error_status", observation.errorStatus);
    span.setStatus({ code: SpanStatusCode.ERROR });
    return;
  }
  span.setStatus({ code: SpanStatusCode.OK });
}

export function emitToArize(observation: SearchObservation): void {
  const apiKey = process.env.ARIZE_API_KEY?.trim();
  const spaceId = process.env.ARIZE_SPACE_ID?.trim();
  if (!apiKey || !spaceId) {
    return;
  }

  const span = searchTracer(apiKey, spaceId).startSpan("scout.search");
  try {
    writeSearchSpan(span, observation);
  } catch {
    span.setStatus({ code: SpanStatusCode.ERROR });
  } finally {
    span.end();
  }

  void provider?.forceFlush().catch(() => undefined);
}

export async function flushTraces(): Promise<void> {
  try {
    await provider?.forceFlush();
  } catch {
    // Export errors stay inside the tracer.
  }
}

function searchTracer(apiKey: string, spaceId: string) {
  if (!provider) {
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: PROJECT_NAME,
        [SEMRESATTRS_PROJECT_NAME]: PROJECT_NAME,
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: traceUrl(),
            headers: {
              "arize-space-id": spaceId,
              "arize-api-key": apiKey,
            },
            timeoutMillis: 5_000,
          }),
          { scheduledDelayMillis: 1_000, exportTimeoutMillis: 5_000 },
        ),
      ],
    });
    provider.register();
  }

  return trace.getTracer(PROJECT_NAME);
}

function traceUrl(): string {
  const configured = process.env.ARIZE_COLLECTOR_ENDPOINT?.trim();
  if (!configured) {
    return US_TRACE_URL;
  }
  if (configured.endsWith("/v1/traces")) {
    return configured;
  }
  return `${configured.replace(/\/$/, "")}/v1/traces`;
}
