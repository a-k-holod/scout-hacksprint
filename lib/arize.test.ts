import assert from "node:assert/strict";
import test from "node:test";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BasicTracerProvider, InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  INPUT_VALUE,
  OpenInferenceSpanKind,
  SemanticConventions,
} from "@arizeai/openinference-semantic-conventions";
import { observationFor, observeSearch, writeSearchSpan } from "./arize.ts";

test("records operational search metadata without the query", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const span = provider.getTracer("test").startSpan("scout.search");
  const secretQuery = "private research question about a person";

  writeSearchSpan(
    span,
    observationFor({
      focus: "events",
      candidateCount: 4,
      events: [{ relevance: "relevant" }, { relevance: "unverified" }],
      pagesOpened: 2,
      durationMs: 850,
    }),
  );
  span.end();

  const finished = exporter.getFinishedSpans()[0];
  const attributes = finished?.attributes ?? {};
  const encoded = JSON.stringify(attributes);

  assert.equal(
    attributes[SemanticConventions.OPENINFERENCE_SPAN_KIND],
    OpenInferenceSpanKind.CHAIN,
  );
  assert.equal(attributes["search.candidate_count"], 4);
  assert.equal(attributes["search.matching_count"], 1);
  assert.equal(attributes["search.unverified_count"], 1);
  assert.equal(attributes["search.pages_opened"], 2);
  assert.equal(attributes["search.outcome"], "match");
  assert.equal(attributes["search.duration_ms"], 850);
  assert.equal(attributes[INPUT_VALUE], JSON.stringify({ focus: "events" }));
  assert.equal(encoded.includes(secretQuery), false);
  assert.equal(encoded.includes("ARIZE_API_KEY"), false);
  assert.equal(finished?.status.code, SpanStatusCode.OK);
});

test("marks a search error without throwing when export fails", () => {
  const observation = observationFor({
    focus: "general",
    candidateCount: 0,
    events: [],
    pagesOpened: 0,
    durationMs: 12,
    errorStatus: 503,
  });

  assert.equal(observation.outcome, "error");
  assert.doesNotThrow(() => {
    observeSearch(observation, () => {
      throw new Error("collector unavailable");
    });
  });
});
