"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { accountBadges, badgesFor, badgeBook, BADGES, ACCOUNT_BADGES } = require("../src/core/badges.cjs");
const { defaultState } = require("../src/core/validation.cjs");
const { mergeSnapshot } = require("../src/core/profile-sync.cjs");
const { parseSavedVariables } = require("../src/core/game-sync.cjs");

const at = "2026-11-09T12:00:00.000Z";
const saved = (id) => ({ kind: "wow-addon", id, updatedAt: at });
const profession = (skillLineId, name, rank, extra = {}) => ({ skillLineId, professionId: skillLineId + 1000, name, rank, maxRank: 300, ...extra });
const observed = (items, extra = {}) => ({ observedAt: at, complete: false, items, ...extra });
const withProfessions = (items, extra) => ({ readiness: { workshop: { professions: observed(items, extra) } } });
const badge = (book, id) => {
  const found = book.badges.find(b => b.id === id);
  assert.ok(found, `missing ${id}`);
  return found;
};

function importedProfessionProfile() {
  const seconds = Date.parse(at) / 1000;
  const character = { id: "synthetic", name: "Example", realm: "Test", className: "Mage", level: 40, updatedAt: seconds,
    ...withProfessions([profession(171, "Alchimie", 150), profession(186, "Bergbau", 299)], { observedAt: seconds }) };
  const raw = "BackstageForeverExport = " + JSON.stringify(JSON.stringify({ schema: 1, characters: [character], activeId: character.id, observedAt: seconds }));
  return mergeSnapshot(defaultState(), parseSavedVariables(raw)).profiles[0];
}

test("profession milestones use each exact skill line from the persisted addon workshop", () => {
  const profile = importedProfessionProfile();
  const book = badgeBook({ profiles: [profile] }).book;
  const alchemy = badge(book, "profession-alchemy-150");
  assert.equal(alchemy.earned, true);
  assert.equal(alchemy.desktopOnly, true);
  assert.equal(alchemy.art, "profession-150");
  assert.equal(Object.hasOwn(alchemy, "at"), false, "a snapshot date is not a milestone date");
  assert.deepEqual(badge(book, "profession-alchemy-300").progress, { have: 150, need: 300 });
  assert.deepEqual(badge(book, "profession-mining-300").progress, { have: 299, need: 300 });
  assert.equal(badge(book, "profession-mining-300").earned, false);
  assert.equal(badge(book, "profession-tailoring-150").earned, false);
});

test("a capped rank earns only the milestones for its observed skill line", () => {
  for (const [id, slug] of [[129,"first-aid"], [164,"blacksmithing"], [165,"leatherworking"], [171,"alchemy"],
    [182,"herbalism"], [185,"cooking"], [186,"mining"], [197,"tailoring"], [202,"engineering"], [333,"enchanting"],
    [356,"fishing"], [393,"skinning"]]) {
    const book = badgesFor({ source: saved("synthetic"), ...withProfessions([profession(id, "Observed skill", 300)]) }, { desktop: true });
    assert.deepEqual(book.badges.filter(b => b.desktopOnly && b.earned).map(b => b.id), [`profession-${slug}-150`, `profession-${slug}-300`]);
  }
});

test("profession badges do not infer rank from a name, profession ID, cap, recipe, or malformed observation", () => {
  const source = saved("synthetic");
  const invalid = [
    withProfessions([profession(999, "Alchemy", 300, { professionId: 171 })]),

    withProfessions([profession(171, "Alchemy", "300")]),
    withProfessions([profession(171, "Alchemy", 300, { maxRank: 225 })]),
    withProfessions([profession(171, "Alchemy", 300), profession(171, "Alchemy", 1)]),
    withProfessions([profession(171, "Alchemy", 300)], { observedAt: "2026-11-09T12:00:01.000Z" }),
    { readiness: { workshop: { recipes: observed([{ id: 1, skillLineId: 171, name: "Potion", reagentsKnown: false, reagents: [] }]) } } },
  ];
  for (const profile of invalid) {
    const locked = badge(badgesFor({ ...profile, source }, { desktop: true }), "profession-alchemy-150");
    assert.equal(locked.earned, false);
    assert.equal(locked.progress, undefined, "missing evidence is not an observed zero");
    assert.equal(locked.progressUnavailable, true);
  }
  const zero = badge(badgesFor({ source, ...withProfessions([profession(171, "Alchemy", 0)]) }, { desktop: true }), "profession-alchemy-150");
  assert.deepEqual(zero.progress, { have: 0, need: 150 }, "an explicitly observed zero remains numeric");
  assert.equal(badge(badgesFor(withProfessions([profession(171, "Alchemy", 300)]), { desktop: true }), "profession-alchemy-300").earned, false, "no addon provenance");
});

test("account class variety counts known classes on distinct saved characters", () => {
  const roster = [
    { className: "Mage", source: saved("a") },
    { className: " mage ", source: saved("b") },
    { className: "Warrior", source: saved("c") },
    { className: "Priest" },
    { className: "Unknown", source: saved("d") },
    { className: "Warlock", source: { ...saved("e"), updatedAt: "bad" } },
    { className: "Hunter", source: { ...saved("f"), kind: "manual" } },
  ];
  const get = (id) => badge(accountBadges(roster), `account-classes-${id}`);
  assert.deepEqual(get(3).progress, { have: 2, need: 3 });
  roster.push({ className: "Priest", source: saved("a") });
  assert.equal(get(3).earned, false, "conflicting rows for one saved identity cannot count as two classes");
  roster.push({ className: "Priest", source: saved("g") });
  assert.equal(get(3).earned, true);
  assert.equal(get(3).desktopOnly, true);
  assert.equal(get(3).art, "account-2");
  assert.equal(Object.hasOwn(get(3), "at"), false);
  assert.deepEqual(get(6).progress, { have: 3, need: 6 });
  assert.deepEqual(get(9).progress, { have: 3, need: 9 });
  for (const className of ["Druid", "Hunter", "Paladin", "Rogue", "Shaman", "Warlock"]) roster.push({ className, source: saved(className) });
  assert.equal(get(6).earned, true);
  assert.equal(get(9).earned, true);
  assert.deepEqual(get(3).progress, { have: 3, need: 3 });
});

test("desktop expansion is reflected in holder and progress views without changing the original catalog", () => {
  const profile = importedProfessionProfile();
  const other = { id: "other", name: "Other", ...withProfessions([profession(171, "Alchemy", 300)]) };
  const state = { profiles: [profile, other] };
  const before = structuredClone(state);
  const data = badgeBook(state, profile.id);
  assert.deepEqual(state, before);
  assert.equal(BADGES.length, 30);
  assert.equal(ACCOUNT_BADGES.length, 4);
  assert.deepEqual(badgesFor(profile).badges.map(b => b.id), BADGES.map(b => b.id));
  assert.equal(data.book.total, 56);
  assert.equal(data.account.total, 7);
  assert.equal(data.totals.kinds, data.book.total);
  const entries = [...data.book.badges, ...data.account.badges];
  assert.equal(new Set(entries.map(b => b.id)).size, entries.length);
  for (const b of entries.filter(b => b.desktopOnly)) assert.ok(existsSync(join(__dirname, "../src/renderer/art/badges", `${b.art}.png`)), b.id);
  assert.deepEqual(data.holders["profession-alchemy-150"], [profile.name]);
  assert.deepEqual(data.holders["profession-alchemy-300"], []);
  assert.ok(data.next.some(b => b.id === "profession-mining-300"), "desktop-specific progress joins the closest-next list");
  assert.deepEqual(data.recent, []);
});
