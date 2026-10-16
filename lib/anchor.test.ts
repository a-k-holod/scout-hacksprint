import assert from "node:assert/strict";
import test from "node:test";
import { enrichEventPages, readVisiblePages } from "./anchor.ts";
import { researchEvents } from "./events.ts";

const longTalk =
  "Engineers will discuss query planning, indexes, and storage for an hour after the doors open.";

const query =
  "Find in-person AI and software developer events in Manhattan, New York, on October 17-19, 2026.";

test("uses opened page text as evidence for a matching event", async () => {
  const pages = [
    {
      title: "AI demo night",
      url: "https://lu.ma/manhattan-ai-demo",
      content: "A meetup listing.",
    },
  ];
  const evidenced = await enrichEventPages(
    pages,
    async () =>
      new Map([
        [
          pages[0].url,
          `October 18, 2026 at 6:00 PM. A demo night for software developers in Manhattan. ${longTalk}`,
        ],
      ]),
    () => true,
  );
  const result = researchEvents(evidenced.pages, query);

  assert.equal(evidenced.opened, 1);
  assert.equal(result.events.filter((event) => event.relevance === "relevant").length, 1);
  assert.equal(result.events[0]?.url, pages[0].url);
  assert.match(result.events[0]?.when ?? "", /October 18, 2026/);
});

test("does not confirm a page whose opened text places it outside Manhattan", async () => {
  const pages = [
    {
      title: "AI meetup",
      url: "https://example.com/newark-ai-meetup",
      content: `October 18, 2026. A meetup for software developers in Manhattan. ${longTalk}`,
    },
  ];
  const evidenced = await enrichEventPages(
    pages,
    async () =>
      new Map([
        [
          pages[0].url,
          `October 18, 2026. A meetup for software developers. Venue: 550 Broad St, Newark. ${longTalk}`,
        ],
      ]),
    () => true,
  );
  const result = researchEvents(evidenced.pages, query);

  assert.equal(
    result.events.some((event) => event.relevance === "relevant"),
    false,
  );
  assert.equal(
    result.events.some((event) => /newark/i.test(event.venue ?? "")),
    false,
  );
});

test("keeps snippet-only results unverified when page retrieval fails", async () => {
  const pages = [
    {
      title: "AI developer workshop",
      url: "https://lu.ma/undated-ai-workshop",
      content: `A workshop for software developers in Manhattan. ${longTalk}`,
    },
  ];
  const evidenced = await enrichEventPages(
    pages,
    async () => {
      throw new Error("timeout");
    },
    () => true,
  );
  const result = researchEvents(evidenced.pages, query);

  assert.equal(evidenced.opened, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.relevance, "unverified");
  assert.equal(result.events[0]?.when, null);
});

test("reads visible text through a browser session without captcha solving", async () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    assert.equal(new Headers(init?.headers).get("anchor-api-key"), "test-key");
    assert.equal(url.includes("/v1/tools/fetch/webpage"), false);
    assert.equal(url.includes("/v1/tools/execute-code"), false);

    if (url.endsWith("/v1/sessions") && method === "POST") {
      assert.equal(body.browser.captcha_solver.active, false);
      return jsonResponse({
        data: { id: "sess-1", cdp_url: "wss://example.test/session" },
      });
    }
    if (method === "DELETE") {
      return jsonResponse({ success: true });
    }
    return jsonResponse({ error: { message: "unexpected" } }, 500);
  };

  const texts = await readVisiblePages(
    ["https://lu.ma/manhattan-ai-demo"],
    "test-key",
    {
      fetchImpl,
      connect: async (cdpUrl) => {
        assert.equal(cdpUrl, "wss://example.test/session");
        return {
          read: async () => "October 18, 2026 Manhattan software developers",
          close: async () => undefined,
        };
      },
    },
  );

  assert.equal(
    texts.get("https://lu.ma/manhattan-ai-demo"),
    "October 18, 2026 Manhattan software developers",
  );
  assert.equal(
    calls.some((call) => call.url.includes("/v1/tools/fetch/webpage")),
    false,
  );
  assert.equal(calls.some((call) => call.method === "DELETE"), true);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
