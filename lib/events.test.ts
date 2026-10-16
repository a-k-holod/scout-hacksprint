import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEventQueries,
  extractVenue,
  extractWhen,
  isDirectoryUrl,
  isNycTechEventQuery,
  labelAttendance,
  labelFood,
  labelSwag,
  researchEvents,
  NO_MATCHING_EVENTS,
  SNIPPET_DISCLOSURE,
} from "./events.ts";

const longTalk =
  "Engineers will discuss query planning, indexes, and storage for an hour after the doors open.";

test("detects NYC event research and keeps the requested dates", () => {
  assert.equal(
    isNycTechEventQuery("NYC tech events this weekend with pizza"),
    true,
  );
  assert.equal(
    isNycTechEventQuery(
      "When was the James Webb Space Telescope launched? Find the official NASA source.",
    ),
    false,
  );

  const original = "Brooklyn AI events October 17-18, 2026";
  const queries = buildEventQueries(original);
  assert.equal(queries.length, 3);
  assert.equal(queries[0], original);
  assert.match(queries[1], /event page pizza breakfast lunch drinks catering/);
  assert.match(queries[2], /event page swag giveaway stickers merchandise/);
  for (const query of queries) {
    assert.match(query, /Brooklyn/);
    assert.match(query, /October 17-18, 2026/);
    assert.doesNotMatch(query, /Eventbrite|Meetup|free food/i);
  }
});

test("confirms food only from an explicit statement", () => {
  assert.equal(labelFood(`Pizza will be served. ${longTalk}`), "Confirmed");
  assert.equal(labelFood(`Free pizza for attendees. ${longTalk}`), "Confirmed");
  assert.equal(labelFood(longTalk), "Not confirmed");
  assert.equal(
    labelFood(`Happy hour after the talks. ${longTalk}`),
    "Unknown",
  );
  assert.equal(
    labelFood(`Refreshments will be available. ${longTalk}`),
    "Unknown",
  );
  assert.equal(labelFood(`Food is not provided. ${longTalk}`), "Unknown");
  assert.equal(labelFood("Free pizza."), "Confirmed");
});

test("does not treat breakfast in a title as food evidence", () => {
  const result = researchEvents([
    {
      title: "Breakfast networking",
      url: "https://lu.ma/breakfast-networking",
      content: longTalk,
    },
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.food, "Not confirmed");
  assert.equal(result.events[0]?.attendance, "Not confirmed");
});

test("confirms swag only when the source says it is provided", () => {
  assert.equal(labelSwag(`Swag bags for attendees. ${longTalk}`), "Confirmed");
  assert.equal(labelSwag(`There will be a giveaway. ${longTalk}`), "Confirmed");
  assert.equal(labelSwag(longTalk), "Not confirmed");
  assert.equal(labelSwag(`Stickers are mentioned in passing. ${longTalk}`), "Unknown");
});

test("keeps attendance price separate from free food", () => {
  assert.equal(labelAttendance(`This event is free. ${longTalk}`), "Free");
  assert.equal(
    labelAttendance(`Tickets are $20. Pizza will be served. ${longTalk}`),
    "$20",
  );
  assert.equal(
    labelAttendance(`Free pizza will be served. ${longTalk}`),
    "Not confirmed",
  );
  assert.equal(
    labelAttendance(`This event is free, but tickets are $20. ${longTalk}`),
    "Unknown",
  );
  assert.equal(labelAttendance("Free"), "Unknown");
});

test("reads only explicit dates and venues", () => {
  assert.equal(
    extractWhen("Thursday, October 16, 2026 at 6:30 PM in Manhattan"),
    "Thursday, October 16, 2026, 6:30 PM",
  );
  assert.equal(extractWhen("next week in New York"), null);
  assert.equal(
    extractVenue("Location: 370 Jay Street, Brooklyn, NY. Doors at 6."),
    "370 Jay Street, Brooklyn, NY",
  );
  assert.equal(extractVenue("Location: New York"), null);
  assert.equal(extractVenue("This is an online event."), "Online");
});

test("prefers direct event pages and does not turn directories into events", () => {
  assert.equal(
    isDirectoryUrl("https://www.eventbrite.com/d/ny--new-york/tech/"),
    true,
  );
  assert.equal(isDirectoryUrl("https://lu.ma/nyc"), true);
  assert.equal(
    isDirectoryUrl("https://www.meetup.com/find/?keywords=ai&location=nyc"),
    true,
  );
  assert.equal(isDirectoryUrl("https://lu.ma/ai-demo-night"), false);
  assert.equal(
    isDirectoryUrl("https://www.meetup.com/ny-js/events/123456789/"),
    false,
  );

  const result = researchEvents([
    {
      title: "Tech events in NYC",
      url: "https://www.eventbrite.com/d/ny--new-york/tech/",
      content: `Free food and swag at every event. ${longTalk}`,
    },
    {
      title: "AI Demo Night | Luma",
      url: "https://lu.ma/ai-demo-night",
      content: `Thursday, October 16, 2026 at 6:30 PM. Location: 370 Jay Street, Brooklyn. Pizza will be served. ${longTalk}`,
    },
  ]);

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.title, "AI Demo Night");
  assert.equal(result.events[0]?.url, "https://lu.ma/ai-demo-night");
  assert.equal(result.events[0]?.when, "Thursday, October 16, 2026, 6:30 PM");
  assert.equal(result.events[0]?.venue, "370 Jay Street, Brooklyn");
  assert.equal(result.events[0]?.food, "Confirmed");
  assert.equal(result.events[0]?.swag, "Not confirmed");
  assert.equal(result.events[0]?.attendance, "Not confirmed");
  assert.equal(result.listings.length, 1);
  assert.equal(result.events[0]?.relevance, "relevant");
  assert.match(result.message, /Directory and listing pages were not used as evidence/);
  assert.match(result.message, new RegExp(SNIPPET_DISCLOSURE.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(result.message, /events are free|verified/i);
});

test("does not treat a Meetup group page as a free event", () => {
  const result = researchEvents([
    {
      title: "In-Person Tech Events NYC 2026 | Meetup",
      url: "https://www.meetup.com/uptime-new-york",
      content: `Oct 29, 2026. Online. FREE to attend. ${longTalk}`,
    },
  ]);

  assert.equal(isDirectoryUrl("https://www.meetup.com/uptime-new-york"), true);
  assert.deepEqual(result.events, []);
  assert.match(result.message, /Evidence is insufficient/);
});

test("drops event pages outside the requested dates", () => {
  const result = researchEvents(
    [
      {
        title: "Daytona HackSprint",
        url: "https://luma.com/hacksprint-nyc",
        content: `October 20, 2026 at 9:00 AM. ${longTalk}`,
      },
      {
        title: "Confluent AI Day 2026 NYC",
        url: "https://events.confluent.io/confluentaiday2026nyc",
        content: `October 18, 2026 at 10:00 AM. Tickets are $20. ${longTalk}`,
      },
    ],
    "NYC tech events October 17-19, 2026",
  );

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.url, "https://events.confluent.io/confluentaiday2026nyc");
  assert.equal(result.events[0]?.when, "October 18, 2026, 10:00 AM");
  assert.equal(result.events[0]?.attendance, "$20");
  assert.equal(result.events[0]?.food, "Not confirmed");
});

test("does not present an undated page or its price as a matching event", () => {
  const result = researchEvents(
    [
      {
        title: "Manhattan AI workshop",
        url: "https://lu.ma/manhattan-ai-workshop",
        content: `A workshop for developers in Manhattan. Tickets are $999. ${longTalk}`,
      },
      {
        title: "Manhattan AI demo night",
        url: "https://lu.ma/manhattan-ai-demo",
        content: `October 18, 2026 at 6:00 PM. A demo night for developers in Manhattan. Tickets are $20. ${longTalk}`,
      },
    ],
    "Manhattan tech events October 17-19, 2026",
  );

  const matches = result.events.filter((event) => event.relevance === "relevant");
  const candidates = result.events.filter((event) => event.relevance === "unverified");

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.url, "https://lu.ma/manhattan-ai-demo");
  assert.equal(matches[0]?.when, "October 18, 2026, 6:00 PM");
  assert.equal(matches[0]?.attendance, "$20");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.when, null);
  assert.equal(candidates[0]?.venue, null);
  assert.equal(candidates[0]?.attendance, "Not confirmed");
  assert.equal(candidates[0]?.food, "Unknown");
  assert.equal(candidates[0]?.swag, "Unknown");
  assert.notEqual(candidates[0]?.attendance, "$999");
});

test("states when no dated event matches the requested range", () => {
  const result = researchEvents(
    [
      {
        title: "Manhattan AI workshop",
        url: "https://lu.ma/manhattan-ai-workshop",
        content: `A workshop for developers in Manhattan. Tickets are $999. ${longTalk}`,
      },
    ],
    "Manhattan tech events October 17-19, 2026",
  );

  assert.equal(
    result.events.some((event) => event.relevance === "relevant"),
    false,
  );
  assert.match(result.message, new RegExp(NO_MATCHING_EVENTS));
});

test("does not treat a direct URL alone as a relevant event", () => {
  const result = researchEvents(
    [
      {
        title: "Summer catalog",
        url: "https://lu.ma/summer-catalog",
        content: "Shop the new collection of shoes and bags. Shipping is available worldwide.",
      },
      {
        title: "Brooklyn jazz night",
        url: "https://lu.ma/brooklyn-jazz",
        content: `Doors open at 8 for a jazz concert in Brooklyn. ${longTalk}`,
      },
      {
        title: "Developer workshop",
        url: "https://lu.ma/developer-workshop",
        content: `Tickets are available. Doors at 6. ${longTalk}`,
      },
    ],
    "Manhattan tech events October 17-19, 2026",
  );

  assert.equal(
    result.events.some((event) => event.url.endsWith("summer-catalog")),
    false,
  );
  assert.equal(
    result.events.some((event) => event.url.endsWith("brooklyn-jazz")),
    false,
  );
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.url, "https://lu.ma/developer-workshop");
  assert.equal(result.events[0]?.relevance, "unverified");
  assert.equal(result.events[0]?.when, null);
  assert.match(result.message, /left out because the snippet did not show a relevant event/);
  assert.match(result.message, /unverified/);
});

test("says evidence is insufficient when every result is a listing", () => {
  const result = researchEvents([
    {
      title: "NYC tech events",
      url: "https://lu.ma/nyc",
      content: `A calendar of upcoming tech events. ${longTalk}`,
    },
  ]);

  assert.deepEqual(result.events, []);
  assert.match(result.message, /Evidence is insufficient/);
});
