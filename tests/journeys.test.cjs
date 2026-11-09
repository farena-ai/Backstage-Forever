"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateJourneys } = require("../src/core/journeys.cjs");
const { defaultState, validateState } = require("../src/core/validation.cjs");

test("legacy state normalizes journeys and rejects excess plans", () => {
  assert.deepEqual(validateJourneys(undefined), []);
  assert.throws(() => validateJourneys(Array(21).fill({})));
  const legacy = defaultState();
  delete legacy.journeys;
  assert.deepEqual(validateState(legacy).journeys, []);
});

const at = "2026-01-01T00:00:00.000Z";
const quest = () => ({
  id: 1061,
  build: "1.15.8.64000",
  sourceHash: "a".repeat(64),
  baselineAt: at,
  baselineCompleted: false,
  baselineTurnInAt: null,
});
const step = () => ({ id: "s", text: "Explore", done: false, profileId: null });
const journey = () => ({
  id: "j",
  title: "Plan",
  createdAt: at,
  steps: [step()],
});

test("journey validation enforces strict nested shapes, limits and immutable output", () => {
  const valid = journey();
  const out = validateJourneys([valid]);
  out[0].steps[0].text = "Changed";
  assert.equal(valid.steps[0].text, "Explore");
  for (const bad of [
    null,
    {},
    [{}],
    [{ ...journey(), extra: true }],
    [{ ...journey(), title: " " }],
    [{ ...journey(), title: "a".repeat(101) }],
    [{ ...journey(), createdAt: "2026-02-30T00:00:00.000Z" }],
    [
      {
        ...journey(),
        steps: Array.from({ length: 51 }, (_, i) => ({
          ...step(),
          id: String(i),
        })),
      },
    ],
    [journey(), journey()],
  ])
    assert.throws(() => validateJourneys(bad));
  for (const change of [
    { text: " " },
    { text: "x".repeat(301) },
    { id: "" },
    { profileId: "" },
    { done: 0 },
    { extra: 1 },
    { observed: { at, via: "completed-id" } },
  ])
    assert.throws(() =>
      validateJourneys([{ ...journey(), steps: [{ ...step(), ...change }] }]),
    );
  assert.throws(() =>
    validateJourneys([{ ...journey(), steps: [step(), step()] }]),
  );
  assert.throws(() =>
    validateJourneys([journey(), { ...journey(), id: "other" }]),
  );
});

test("quest metadata and observed evidence are bounded and coherent", () => {
  const valid = { ...step(), profileId: "missing-profile", quest: quest() };
  assert.deepEqual(
    validateJourneys([{ ...journey(), steps: [valid] }])[0].steps[0],
    valid,
  );
  for (const change of [
    { id: 0 },
    { id: 1.1 },
    { build: "retail" },
    { sourceHash: "A".repeat(64) },
    { baselineAt: "yesterday" },
    { baselineCompleted: undefined },
    { baselineCompleted: "true" },
    { baselineTurnInAt: at.replace("01T", "02T") },
    { extra: true },
  ])
    assert.throws(() =>
      validateJourneys([
        {
          ...journey(),
          steps: [{ ...valid, quest: { ...quest(), ...change } }],
        },
      ]),
    );
  assert.throws(() =>
    validateJourneys([
      { ...journey(), steps: [{ ...valid, profileId: null }] },
    ]),
  );
  for (const observed of [
    { at, via: "completed-id" },
    { at: "2026-01-02T00:00:00.000Z", via: "guess" },
    { at: "2026-01-02T00:00:00.000Z", via: "turn-in", extra: true },
  ])
    assert.throws(() =>
      validateJourneys([{ ...journey(), steps: [{ ...valid, observed }] }]),
    );
  assert.throws(() =>
    validateJourneys([
      {
        ...journey(),
        steps: [
          {
            ...valid,
            quest: { ...quest(), baselineCompleted: true },
            observed: { at: "2026-01-02T00:00:00.000Z", via: "completed-id" },
          },
        ],
      },
    ]),
  );
});

const { applyJourneyAction } = require("../src/core/journeys.cjs");
const sourceAt = "2026-01-03T00:00:00.000Z",
  later = "2026-01-04T00:00:00.000Z";
const savedProfile = (extra = {}) => ({
  id: "p",
  name: "Hero",
  realm: "Realm",
  className: "Mage",
  level: 10,
  notes: "private",
  goals: [],
  source: {
    kind: "wow-addon",
    id: "secret-stable-character",
    updatedAt: sourceAt,
  },
  clientBuild: "1.15.8.64000",
  quests: [
    { id: 1061, title: "A saved quest", complete: false, objectives: [] },
  ],
  history: { recent: [], completedIdsKnown: true, completedIds: [] },
  ...extra,
});
const savedState = (extra = {}) =>
  validateState({
    ...defaultState(),
    profiles: [savedProfile(extra)],
    journeys: [{ ...journey(), steps: [] }],
  });
const act = (state, action) =>
  applyJourneyAction(state, action, {
    now: 1700000000000,
    id: () => "generated",
  });

test("actions create editable templates, notes and immutable server-owned IDs", () => {
  const input = defaultState(),
    before = structuredClone(input);
  const created = act(input, { type: "create", title: "  Next adventure  " });
  assert.deepEqual(created.journeys, [
    {
      id: "generated",
      title: "Next adventure",
      createdAt: "2023-11-14T22:13:20.000Z",
      steps: [],
    },
  ]);
  assert.deepEqual(input, before);
  for (const template of ["quest-session", "dungeon-prep"]) {
    let seq = 0;
    const result = applyJourneyAction(
      input,
      { type: "create", title: "Template", template },
      { now: 0, id: () => `id${++seq}` },
    );
    assert.ok(result.journeys[0].steps.length >= 2);
    assert.ok(
      result.journeys[0].steps.every(
        (s) => s.profileId === null && !s.quest && !s.done,
      ),
    );
    validateState(result);
  }
  let next = act(savedState(), {
    type: "add-note",
    journeyId: "j",
    text: "A note",
    profileId: "p",
  });
  next = act(next, {
    type: "edit-step",
    journeyId: "j",
    stepId: "generated",
    text: "Revised",
    profileId: null,
  });
  next = act(next, {
    type: "set-done",
    journeyId: "j",
    stepId: "generated",
    done: true,
  });
  assert.deepEqual(next.journeys[0].steps[0], {
    id: "generated",
    text: "Revised",
    done: true,
    profileId: null,
  });
  next = act(next, { type: "rename", journeyId: "j", title: "Renamed" });
  assert.equal(next.journeys[0].title, "Renamed");
  next = act(next, {
    type: "remove-step",
    journeyId: "j",
    stepId: "generated",
  });
  assert.equal(next.journeys[0].steps.length, 0);
  assert.equal(
    act(next, { type: "remove", journeyId: "j" }).journeys.length,
    0,
  );
});

test("actions reject unknown fields, missing targets, invalid assignments, caps and renderer evidence", () => {
  const state = savedState();
  for (const action of [
    null,
    {},
    { type: "surprise" },
    { type: "create", title: "X", id: "forged" },
    { type: "create", title: "X", template: "raid-ready" },
    { type: "create", title: "X", profileId: "missing" },
    {
      type: "add-note",
      journeyId: "j",
      text: "X",
      observed: { at, via: "turn-in" },
    },
    { type: "rename", journeyId: "none", title: "X" },
    { type: "edit-step", journeyId: "j", stepId: "none", text: "X" },
    { type: "add-note", journeyId: "j", text: "X", profileId: "missing" },
    { type: "add-quest", journeyId: "j", profileId: "p", questId: 2 },
    {
      type: "add-quest",
      journeyId: "j",
      profileId: "p",
      questId: 1061,
      text: "forged title",
    },
  ])
    assert.throws(() => act(state, action));
  const full = {
    ...state,
    journeys: Array.from({ length: 20 }, (_, i) => ({
      ...journey(),
      id: `j${i}`,
      steps: [],
    })),
  };
  assert.throws(() => act(full, { type: "create", title: "X" }));
  const steps = {
    ...state,
    journeys: [
      {
        ...journey(),
        steps: Array.from({ length: 50 }, (_, i) => ({
          ...step(),
          id: `s${i}`,
        })),
      },
    ],
  };
  assert.throws(() =>
    act(steps, { type: "add-note", journeyId: "j", text: "X" }),
  );
  assert.throws(() =>
    applyJourneyAction(
      state,
      { type: "create", title: "X" },
      { now: NaN, id: () => "new" },
    ),
  );
  assert.throws(() =>
    applyJourneyAction(
      state,
      { type: "create", title: "X" },
      { id: () => "j" },
    ),
  );
});

test("quest tracking captures saved source baseline and hashed identity rather than app clock", () => {
  const state = savedState({
    history: {
      recent: [
        { id: 1061, title: "Earlier run", completedAt: Date.parse(at) / 1000 },
      ],
      completedIdsKnown: true,
      completedIds: [1061],
    },
  });
  const next = act(state, {
    type: "add-quest",
    journeyId: "j",
    profileId: "p",
    questId: 1061,
  });
  const s = next.journeys[0].steps[0];
  assert.equal(s.text, "A saved quest");
  assert.equal(s.observed, undefined);
  assert.equal(s.quest.baselineAt, sourceAt);
  assert.equal(s.quest.baselineTurnInAt, at);
  assert.equal(s.quest.baselineCompleted, true);
  assert.equal(
    s.quest.sourceHash,
    require("node:crypto")
      .createHash("sha256")
      .update(state.profiles[0].source.id)
      .digest("hex"),
  );
  assert.equal(JSON.stringify(s).includes("secret-stable-character"), false);
  const unknown = act(savedState({ history: undefined }), {
    type: "add-quest",
    journeyId: "j",
    profileId: "p",
    questId: 1061,
  });
  assert.equal(unknown.journeys[0].steps[0].quest.baselineCompleted, null);
  for (const extra of [
    { source: undefined },
    { clientBuild: undefined },
    { quests: undefined },
  ])
    assert.throws(() =>
      act(savedState(extra), {
        type: "add-quest",
        journeyId: "j",
        profileId: "p",
        questId: 1061,
      }),
    );
});

test("orphan tracking survives and reassignment explicitly converts it to a fresh manual step", () => {
  let next = act(savedState(), {
    type: "add-quest",
    journeyId: "j",
    profileId: "p",
    questId: 1061,
  });
  next.profiles = [];
  next.activeProfileId = null;
  validateState(next);
  next.journeys[0].steps[0].observed = { at: later, via: "completed-id" };
  next.journeys[0].steps[0].done = true;
  assert.throws(() =>
    act(next, {
      type: "edit-step",
      journeyId: "j",
      stepId: "generated",
      text: "Forged quest text",
    }),
  );
  const reassigned = act(next, {
    type: "edit-step",
    journeyId: "j",
    stepId: "generated",
    profileId: null,
    text: "Manual now",
  });
  assert.deepEqual(reassigned.journeys[0].steps[0], {
    id: "generated",
    text: "Manual now",
    done: false,
    profileId: null,
  });
});

const { reconcileJourneys } = require("../src/core/journeys.cjs");
const tracked = (extra = {}) =>
  act(savedState(extra), {
    type: "add-quest",
    journeyId: "j",
    profileId: "p",
    questId: 1061,
  });
const updatedProfiles = (extra = {}) => [
  savedProfile({
    source: {
      kind: "wow-addon",
      id: "secret-stable-character",
      updatedAt: later,
    },
    ...extra,
  }),
];

test("strictly newer known absent-to-present membership latches without mutating either input", () => {
  const start = tracked(),
    profiles = updatedProfiles({
      quests: [],
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    before = structuredClone(start),
    beforeProfiles = structuredClone(profiles);
  const next = reconcileJourneys(start.journeys, profiles);
  assert.deepEqual(next[0].steps[0].observed, {
    at: later,
    via: "completed-id",
  });
  assert.deepEqual(start, before);
  assert.deepEqual(profiles, beforeProfiles);
  assert.equal(
    reconcileJourneys(next, updatedProfiles({ history: undefined }))[0].steps[0]
      .observed.at,
    later,
  );
  assert.equal(reconcileJourneys(next, [])[0].steps[0].observed.at, later);
  assert.equal(
    reconcileJourneys(next, updatedProfiles({ clientBuild: "1.15.8.99999" }))[0]
      .steps[0].observed.at,
    later,
  );
  const state = { ...start, journeys: next };
  assert.deepEqual(
    act(state, {
      type: "set-done",
      journeyId: "j",
      stepId: "generated",
      done: false,
    }).journeys[0].steps[0].observed,
    next[0].steps[0].observed,
  );
});

test("ready, disappeared, unknown, stale, other identity and build data cannot invent completion", () => {
  const start = tracked();
  const cases = [
    updatedProfiles({
      quests: [{ id: 1061, title: "Ready", complete: true, objectives: [] }],
    }),
    updatedProfiles({ quests: [] }),
    updatedProfiles({ quests: undefined, history: undefined }),
    updatedProfiles({
      history: { recent: [], completedIds: [1061], completedIdsKnown: false },
    }),
    updatedProfiles({
      source: {
        kind: "wow-addon",
        id: "secret-stable-character",
        updatedAt: sourceAt,
      },
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    updatedProfiles({
      source: {
        kind: "wow-addon",
        id: "secret-stable-character",
        updatedAt: at,
      },
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    updatedProfiles({
      id: "other",
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    updatedProfiles({
      source: { kind: "wow-addon", id: "other-source", updatedAt: later },
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    updatedProfiles({
      clientBuild: "1.15.8.99999",
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    updatedProfiles({
      source: undefined,
      history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
    }),
    [],
  ];
  for (const profiles of cases)
    assert.equal(
      reconcileJourneys(start.journeys, profiles)[0].steps[0].observed,
      undefined,
    );
  for (const history of [
    undefined,
    { recent: [], completedIdsKnown: false, completedIds: [] },
    { recent: [] },
  ]) {
    const unknown = tracked({ history });
    const next = reconcileJourneys(
      unknown.journeys,
      updatedProfiles({
        history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
      }),
    );
    assert.equal(next[0].steps[0].observed, undefined);
  }
});

test("known-complete repeatable requires a newly observed turn-in bounded by the saved game clock", () => {
  const start = tracked({
    history: {
      recent: [
        { id: 1061, title: "Prior", completedAt: Date.parse(at) / 1000 },
      ],
      completedIdsKnown: true,
      completedIds: [1061],
    },
  });
  assert.equal(
    reconcileJourneys(
      start.journeys,
      updatedProfiles({
        history: { recent: [], completedIdsKnown: true, completedIds: [1061] },
      }),
    )[0].steps[0].observed,
    undefined,
  );
  for (const eventAt of [at, sourceAt, "2026-01-05T00:00:00.000Z"]) {
    const next = reconcileJourneys(
      start.journeys,
      updatedProfiles({
        history: {
          recent: [
            {
              id: 1061,
              title: "Event",
              completedAt: Date.parse(eventAt) / 1000,
            },
          ],
          completedIdsKnown: true,
          completedIds: [1061],
        },
      }),
    );
    assert.equal(next[0].steps[0].observed, undefined);
  }
  const eventAt = "2026-01-03T12:00:00.000Z";
  const next = reconcileJourneys(
    start.journeys,
    updatedProfiles({
      quests: [],
      history: {
        recent: [
          { id: 999, title: "Other", completedAt: Date.parse(later) / 1000 },
          {
            id: 1061,
            title: "Turned in",
            completedAt: Date.parse(eventAt) / 1000,
          },
        ],
        completedIdsKnown: false,
      },
    }),
  );
  assert.deepEqual(next[0].steps[0].observed, { at: eventAt, via: "turn-in" });
  const pruned = reconcileJourneys(
    next,
    updatedProfiles({ history: undefined }),
  );
  assert.deepEqual(pruned, next);
});

test("template enum rejects null rather than silently guessing a template", () => {
  assert.throws(() =>
    act(defaultState(), { type: "create", title: "Plan", template: null }),
  );
});

test("action and template discriminants reject coercible non-string values", () => {
  assert.throws(() =>
    act(defaultState(), { type: "create", title: "Plan", template: ["blank"] }),
  );
  const current = act(savedState(), {
    type: "add-note",
    journeyId: "j",
    text: "Note",
  });
  assert.throws(() =>
    act(current, {
      type: ["edit-step"],
      journeyId: "j",
      stepId: "generated",
      text: "Coerced",
    }),
  );
});
