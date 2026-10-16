import assert from "node:assert/strict";
import test from "node:test";
import {
  describeGeneralFindings,
  isOfficialHost,
  mergeAndRankHits,
  officialDomains,
  officialSourcesOnly,
  retainOfficialHits,
} from "./sources.ts";

test("routes official NASA requests to NASA domains only", () => {
  assert.deepEqual(
    officialDomains(
      "When was the James Webb Space Telescope launched? Find the official NASA source and verify the launch date.",
    ),
    ["nasa.gov", "science.nasa.gov"],
  );
  assert.equal(
    officialDomains("When was the James Webb Space Telescope launched?"),
    null,
  );
  assert.equal(officialDomains("Find the official museum source for the telescope."), null);
});

test("dedupes results and ranks the targeted official host first", () => {
  const ranked = mergeAndRankHits(
    [
      {
        preferred: false,
        hits: [
          {
            title: "Planned launch",
            url: "https://astrobiology.nasa.gov/news/webb-2019/",
            content: "The telescope is planned for launch in 2019.",
          },
          {
            title: "Wikipedia",
            url: "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
            content: "Launched on 25 December 2021.",
          },
        ],
      },
      {
        preferred: true,
        hits: [
          {
            title: "James Webb launch",
            url: "https://science.nasa.gov/mission/webb/launch/",
            content: "Webb launched on December 25, 2021.",
          },
          {
            title: "Planned launch duplicate",
            url: "https://astrobiology.nasa.gov/news/webb-2019",
            content: "An earlier plan mentioned 2019.",
          },
        ],
      },
    ],
    ["nasa.gov", "science.nasa.gov"],
  );

  assert.deepEqual(
    ranked.map((hit) => hit.url),
    [
      "https://science.nasa.gov/mission/webb/launch/",
      "https://astrobiology.nasa.gov/news/webb-2019/",
      "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
    ],
  );
  assert.match(ranked[1]?.content ?? "", /planned for launch in 2019/);
  assert.match(ranked[1]?.content ?? "", /earlier plan mentioned 2019/);
  assert.equal(isOfficialHost(ranked[2]?.url ?? "", ["nasa.gov"]), false);
});

test("keeps only NASA hosts when the question asks for official sources only", () => {
  const query =
    "When did the James Webb Space Telescope launch? Use official NASA sources only.";
  const domains = officialDomains(query);

  assert.ok(domains);
  assert.equal(officialSourcesOnly(query), true);
  assert.equal(
    officialSourcesOnly(
      "When was the James Webb Space Telescope launched? Find the official NASA source.",
    ),
    false,
  );

  const kept = retainOfficialHits(
    [
      {
        title: "Webb launch",
        url: "https://science.nasa.gov/mission/webb/launch/",
        content: "Webb launched on December 25, 2021.",
      },
      {
        title: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
        content: "Launched on 25 December 2021.",
      },
      {
        title: "Lookalike",
        url: "https://nasa.gov.example.com/webb",
        content: "Not an official NASA page.",
      },
    ],
    domains,
  );

  assert.deepEqual(
    kept.map((hit) => hit.url),
    ["https://science.nasa.gov/mission/webb/launch/"],
  );
  assert.equal(isOfficialHost("https://www.nasa.gov/webb/", domains), true);
  assert.equal(isOfficialHost("https://astrobiology.nasa.gov/news/", domains), true);
  assert.equal(isOfficialHost("https://nasa.gov.example.com/webb", domains), false);
  assert.equal(isOfficialHost("https://notnasa.gov/webb", domains), false);

  const empty = describeGeneralFindings([], domains, false);
  assert.match(empty, /No sources were found/);
  assert.match(empty, /not verified/);
});

test("does not call an official-source search verified when no official page was retrieved", () => {
  const message = describeGeneralFindings(
    [
      {
        title: "Wikipedia",
        url: "https://en.wikipedia.org/wiki/James_Webb_Space_Telescope",
        content: "Launched in 2021.",
      },
    ],
    ["nasa.gov", "science.nasa.gov"],
    false,
  );

  assert.match(message, /not verified/);
  assert.match(message, /Excerpts are search snippets/);
  assert.doesNotMatch(message, /full-page verification/);
});
