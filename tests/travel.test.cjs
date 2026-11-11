"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { loadTravelReference } = require("../src/core/travel-data.cjs");
const reference = loadTravelReference(
  fs.readFileSync(path.join(__dirname, "../data/forever-travel/pack.json")),
);
const matching = {
  faction: "Horde",
  clientBuild: "1.60.1.70862",
  location: { zone: "Orgrimmar" },
  source: { kind: "wow-addon", updatedAt: "2026-11-10T12:00:00.000Z" },
};
function api() {
  assert.ok(
    fs.existsSync(path.join(__dirname, "../src/core/travel.cjs")),
    "Pure travel planner must exist",
  );
  return require("../src/core/travel.cjs");
}
function intent(q, options = {}) {
  return api().parseTravelIntent(q, options);
}
function trip(q, profile = matching) {
  return api().planTravel(reference, intent(q, { profile }), { profile });
}
test("Org to TB fastest question gives conditional Doras flight, road and scoped zeppelin correction", () => {
  const i = intent("what is the fastest way from org to tb");
  assert.equal(i.status, "ready");
  assert.equal(i.originId, "orgrimmar");
  assert.equal(i.destinationId, "thunder-bluff");
  const r = api().planTravel(reference, i, { profile: matching });
  assert.equal(r.status, "route");
  assert.match(r.text, /Doras/);
  assert.match(r.text, /offered/);
  assert.match(r.text, /Razor Hill/);
  assert.match(r.text, /zeppelin/);
  assert.match(r.text, /fastest.*unknown/i);
  assert.doesNotMatch(
    r.text,
    /take the zeppelin (to|bound for) Thunder Bluff/i,
  );
  assert.deepEqual(
    r.options.map((o) => o.mode),
    ["flight", "road"],
  );
  assert.equal(r.options[0].conditional, true);
});
test("other Horde zeppelins are positive, dated and distinguish city from boarding point", () => {
  const r = trip("how do I get from org to uc");
  assert.equal(r.status, "route");
  assert.equal(r.options[0].mode, "zeppelin");
  assert.match(r.text, /outside the main gate/);
  assert.match(r.text, /Tirisfal/);
  assert.match(r.text, /2026-10-14/);
  assert.match(r.text, /prelaunch/i);
  assert.doesNotMatch(r.text, /no direct.*zeppelin/i);
});
test("all six scheduled zeppelin directions and optional explicit E4 directions stay directed", () => {
  for (const q of [
    "org to uc",
    "uc to org",
    "org to gromgol",
    "gromgol to org",
    "uc to gromgol",
    "gromgol to uc",
  ])
    assert.equal(trip(q).options[0].mode, "zeppelin", q);
  for (const q of [
    "sw to ironforge",
    "ironforge to sw",
    "stormwind harbour to auberdine",
    "auberdine to stormwind harbour",
  ])
    assert.equal(
      trip(q, { ...matching, faction: "Alliance" }).status,
      "route",
      q,
    );
  assert.equal(trip("ratchet to booty bay").status, "uncovered");
  assert.equal(trip("booty bay to ratchet").status, "uncovered");
});
test("all published flights stay conditional, carry build/date, and never imply learned routes", () => {
  for (const q of [
    "org to tb",
    "tb to org",
    "org to crossroads",
    "crossroads to org",
    "crossroads to tb",
    "tb to crossroads",
  ]) {
    const r = trip(q);
    assert.equal(r.options[0].conditional, true);
    assert.match(r.text, /unlocked routes are unknown/);
    assert.match(r.text, /1\.60\.1\.70862/);
    assert.match(r.text, /2026-11-09/);
  }
});
test("manual, mismatched or missing saved build cannot promote exact-build flight observations", () => {
  for (const p of [
    { ...matching, source: { kind: "manual" } },
    { ...matching, clientBuild: "1.60.1.0" },
    { ...matching, clientBuild: undefined },
    { ...matching, source: undefined },
  ]) {
    const r = trip("org to tb", p);
    assert.equal(r.status, "route");
    assert.deepEqual(
      r.options.map((o) => o.mode),
      ["road"],
    );
    assert.match(r.text, /build|observed/i);
  }
});
test("unknown and opposing factions never offer restricted transport as usable", () => {
  for (const faction of [undefined, "Alliance"]) {
    const r = trip("org to uc", { ...matching, faction });
    assert.ok(["clarify", "uncovered"].includes(r.status));
    assert.equal(r.options.length, 0);
    assert.match(r.text, /faction|Horde/i);
  }
  assert.equal(
    trip("sw to ironforge", { ...matching, faction: "Horde" }).options.length,
    0,
  );
  assert.equal(trip("ratchet to booty bay", null).options.length, 0);
});
test("saved addon location is qualified; explicit origin wins and omitted profile means unknown", () => {
  const i = intent("how to get to tb", { profile: matching });
  assert.equal(i.originId, "orgrimmar");
  assert.equal(i.originSource, "saved-location");
  assert.match(
    api().planTravel(reference, i, { profile: matching }).text,
    /last.saved.*not.*live/i,
  );
  assert.equal(
    intent("crossroads to tb", { profile: matching }).originId,
    "crossroads",
  );
  assert.equal(intent("how to get to tb").status, "clarify");
  assert.equal(
    intent("how to get to tb", {
      profile: { ...matching, source: { kind: "manual" } },
    }).status,
    "clarify",
  );
});
test("saved origin remains qualified for same-place and uncovered answers", () => {
  for (const q of ["how do I get to org", "how do I get to Darnassus"]) {
    const r = trip(q);
    assert.match(r.text, /last.saved.*not.*live/i);
  }
});
test("there and here remain clarification even when a saved location exists", () => {
  for (const q of ["how do I get there", "how do I get from here to tb"]) {
    assert.equal(trip(q).status, "clarify");
  }
});
test("URLs, dotted domains and substrings do not supply aliases or conceal unknown endpoints", () => {
  for (const q of [
    "how to get from https://example.org to tb",
    "how to get from example.org to tb",
    "how to get from organization to tb",
    "how to get from morg to tb",
  ]) {
    const i = intent(q, { profile: matching });
    assert.equal(i.status, "clarify", q);
    assert.equal(i.originId, null, q);
  }
  assert.equal(intent("visit https://org.example/tb for news"), null);
});
test("conjunction if is never Ironforge and explicit Ironforge is accepted", () => {
  const i = intent("if I want to travel from org to tb");
  assert.equal(i.originId, "orgrimmar");
  assert.equal(i.destinationId, "thunder-bluff");
  assert.equal(intent("how do I get from sw to IF").status, "clarify");
  assert.equal(
    intent("how do I get from sw to ironforge").destinationId,
    "ironforge",
  );
});
test("leveling, questing and unrelated questions never inherit old travel intent", () => {
  for (const q of [
    "how do I get to level 20",
    "how to get to lvl20",
    "where should I quest next",
    "what does this spell do",
    "hello",
  ])
    assert.equal(
      intent(q, { previousQuestion: "org to tb", profile: matching }),
      null,
      q,
    );
});
test("progression and talent transitions remain nontravel even after game correction", () => {
  for (const q of [
    "How do I get from level 10 to level 20?",
    "How do I level from 10 to 20?",
    "level 10 to 20",
    "What talents should I take if I go from Beast Mastery to Survival?",
    "How do I change talents from Beast Mastery to Survival?",
    "How do I switch from Beast Mastery to Survival?",
    "What is the fastest way to get from level 10 to level 20?",
    "What leveling route should I use from 10 to 20?",
  ]) {
    assert.equal(intent(q, { profile: matching }), null, q);
    assert.equal(
      intent("This is for wow forever, not retail", {
        previousQuestion: q,
        profile: matching,
      }),
      null,
      q,
    );
  }
});
test("real trips retain incidental progression words and unknown named destinations", () => {
  for (const q of [
    "At level 10, how do I get from org to tb?",
    "With Survival talents, what is the fastest way from org to tb?",
  ]) {
    const i = intent(q);
    assert.equal(i?.status, "ready", q);
    assert.equal(i.originId, "orgrimmar");
    assert.equal(i.destinationId, "thunder-bluff");
  }
  for (const q of [
    "While choosing talents, how do I get from org to Darnassus?",
    "With my talents, how do I travel from Darnassus to Exodar?",
    "Darnassus to Exodar",
  ]) {
    const i = intent(q);
    assert.ok(i, q);
    assert.equal(
      api().planTravel(reference, i, { profile: matching }).status,
      "uncovered",
      q,
    );
  }
});
test("via waypoints and chained destinations ask one trip question instead of inventing a place label", () => {
  for (const q of [
    "How do I get from org to tb via crossroads?",
    "How do I get from org to tb to uc?",
    "org to tb via crossroads",
    "org to tb to uc",
    "How to get to tb via crossroads from org?",
    "How to get from org through crossroads to tb?",
    "How do I get from org to Darnassus via Ironforge?",
  ]) {
    const i = intent(q, { profile: matching });
    assert.equal(i?.reason, "ambiguous", q);
    const r = api().planTravel(reference, i, { profile: matching });
    assert.equal(r.status, "clarify", q);
    assert.equal(r.options.length, 0);
    assert.equal((r.text.match(/\?/g) || []).length, 1);
  }
  assert.equal(intent("How to get to tb from org?").status, "ready");
});
test("unknown explicit endpoint is retained without asking for the same destination again", () => {
  const i = intent("how do I get from org to Darnassus");
  assert.equal(i.destinationId, null);
  assert.equal(i.destinationLabel, "Darnassus");
  const r = api().planTravel(reference, i, { profile: matching });
  assert.equal(r.status, "uncovered");
  assert.match(r.text, /Darnassus/);
  assert.match(r.text, /coverage|reference/i);
  assert.doesNotMatch(r.text, /where.*want to go/i);
});
test("unknown bare origin never silently becomes the shared saved city", () => {
  const i = intent("Darnassus to org", { profile: matching });
  assert.equal(i.originId, null);
  assert.equal(i.originLabel, "Darnassus");
  assert.equal(i.originSource, "explicit");
  assert.equal(
    api().planTravel(reference, i, { profile: matching }).status,
    "uncovered",
  );
});
test("conjoined destinations clarify and reversed get-to syntax preserves both endpoints", () => {
  assert.equal(intent("how to get from org to tb and uc").reason, "ambiguous");
  const i = intent("how to get to tb from org");
  assert.equal(i.status, "ready");
  assert.equal(i.destinationId, "thunder-bluff");
  assert.equal(i.originId, "orgrimmar");
});
test("a matching build without a dated addon observation does not qualify flights", () => {
  for (const updatedAt of [undefined, "bad"])
    assert.ok(
      !trip("org to tb", {
        ...matching,
        source: { kind: "wow-addon", updatedAt },
      }).options.some((o) => o.mode === "flight"),
    );
});
test("ambiguous multiple trips, missing destinations and there ask one clear question", () => {
  for (const q of [
    "how do I get from org to tb or uc",
    "org to tb and sw to ironforge",
    "how do I get there",
    "how do I travel from org",
  ]) {
    const i = intent(q);
    assert.equal(i.status, "clarify", q);
    const r = api().planTravel(reference, i);
    assert.equal(r.status, "clarify");
    assert.equal((r.text.match(/\?/g) || []).length, 1);
  }
});
test("narrow Forever correction can reuse only supplied original user question", () => {
  const i = intent("Forever not retail", {
    previousQuestion: "what is the fastest way from org to tb",
  });
  assert.equal(i.originId, "orgrimmar");
  assert.equal(i.destinationId, "thunder-bluff");
  assert.equal(i.question, "what is the fastest way from org to tb");
  assert.equal(intent("Forever not retail"), null);
  assert.equal(
    intent("Forever not retail", {
      previousQuestion: "what does this spell do",
    }),
    null,
  );
});
test("exact reported game correction shares conversation grammar and never hijacks nontravel", () => {
  for (const q of [
    "This is for wow forever, not retail",
    "I meant World of Warcraft: Forever—not retail.",
  ]) {
    const i = intent(q, {
      previousQuestion: "what is the fastest way from org to tb",
    });
    assert.equal(i?.status, "ready");
    assert.equal(i.originId, "orgrimmar");
    assert.equal(i.destinationId, "thunder-bluff");
    assert.equal(
      intent(q, { previousQuestion: "what food does my Hunter pet need" }),
      null,
    );
    assert.equal(
      intent(q, { previousQuestion: "how do I get there" })?.status,
      "clarify",
    );
  }
});
test("same city means named place, while uncovered pair is not impossible or a composed graph path", () => {
  const r = trip("org to orgrimmar");
  assert.equal(r.status, "same-place");
  assert.match(r.text, /precise|exact/i);
  const uncovered = trip("org to ironforge");
  assert.equal(uncovered.status, "uncovered");
  assert.doesNotMatch(uncovered.text, /impossible|no routes exist|cannot get/i);
  assert.equal(uncovered.options.length, 0);
});
test("missing and invalid reference fails closed without provider guess or arbitrary source links", () => {
  for (const ref of [null, {}, { ...reference, product: "retail" }]) {
    const r = api().planTravel(ref, intent("org to tb"), { profile: matching });
    assert.equal(r.status, "unavailable");
    assert.deepEqual(r.sources, []);
    assert.deepEqual(r.options, []);
  }
});
test("route negative is one direction only and output includes scoped source attribution", () => {
  assert.match(
    trip("org to tb").text,
    /no direct Orgrimmar to Thunder Bluff zeppelin/,
  );
  assert.doesNotMatch(trip("tb to org").text, /no direct.*zeppelin/i);
  const r = trip("org to tb");
  assert.deepEqual(
    r.sources.map((s) => s.id),
    ["E1", "E2", "E3"],
  );
  assert.match(r.text, /GamerBlurb/);
  assert.match(r.text, /2026-11-06/);
  assert.match(r.text, /general|published/i);
  assert.ok(r.sources.every((s) => s.url.startsWith("https://")));
});
test("bounded inputs and sanitized safe output do not echo private profile fields or arbitrary endpoint markup", () => {
  assert.equal(intent("x".repeat(12001)), null);
  assert.equal(intent({}), null);
  const r = trip("org to tb", {
    ...matching,
    notes: "PRIVATE_NOTE",
    goals: ["PRIVATE_GOAL"],
    source: { ...matching.source, id: "PRIVATE_ID" },
  });
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_/);
  const unknown = trip("how do I get from org to <script>alert(1)<\/script>");
  assert.doesNotMatch(unknown.text, /<script>|https:\/\/evil/);
});
test("no prices, times, speed rankings or safety promises are manufactured", () => {
  const text = trip("what is the fastest way from org to tb").text;
  assert.doesNotMatch(
    text,
    /\d+\s*(seconds|minutes|copper|silver|gold)|safest|guaranteed|guarantees/i,
  );
  assert.match(text, /timing|duration/i);
  assert.match(text, /unknown/i);
});
test('generic quest routes do not become city travel, but geographic quest travel remains recognized',()=>{assert.equal(intent('Explain the quest route'),null);assert.equal(intent('What questing route should I use?'),null);assert.equal(intent('quest route from org to tb').status,'ready');assert.equal(intent('travel from unknownville to TB').status,'clarify');});
