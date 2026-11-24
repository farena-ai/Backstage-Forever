"use strict";
// Validators of every Backstage Live route: what is accepted, and that anything else is refused
// with the offending path named.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../lib/validate-live");
const { ValidationError } = require("../lib/validate");
const { uuid } = require("./helpers");

const cp = String.fromCodePoint;
const TOKEN = "A".repeat(43), GUILD = `g_${"a".repeat(16)}`;
const who = (name = "Abel", realm = "Thunder Hold") => ({ name, realm });
function invalid(fn, re, label) {
  assert.throws(fn, (e) => { assert.ok(e instanceof ValidationError, `${label || re}: ${e && e.stack}`); assert.match(e.message, re, label); return true; }, label);
}
// Every way a single field can be wrong, against a builder of an otherwise valid body.
function cases(validate, build, list) {
  for (const [label, change, re] of list) invalid(() => validate(build(change)), re, label);
}

test("L1 session: subscriptions of the three kinds, strictly checked", () => {
  const body = (over = {}) => ({ schema: 1, installId: uuid(), subs: [
    { t: "tickets", tickets: [{ ticket: "BF-1042", key: TOKEN }] }, { t: "guild", guildId: GUILD, member: TOKEN }, { t: "lfg", realm: "Thunder Hold", faction: "horde" }], ...over });
  const ok = V.validateSession(body());
  assert.deepEqual(ok.tickets, [{ number: 1042, key: TOKEN }]);
  assert.deepEqual(ok.guilds, [{ guildId: GUILD, member: TOKEN }]);
  assert.deepEqual(ok.lfg, [{ realm: "Thunder Hold", faction: "horde" }]);
  assert.deepEqual(V.validateSession(body({ subs: [] })).tickets, []);
  cases(V.validateSession, body, [
    ["schema", { schema: 2 }, /schema/], ["install id", { installId: "x" }, /UUID/], ["unknown field", { extra: 1 }, /unknown field/],
    ["subs not a list", { subs: {} }, /subs: must be an array/], ["too many subs", { subs: Array.from({ length: 13 }, () => ({ t: "lfg", realm: "Aa", faction: "horde" })) }, /at most/],
    ["unknown kind", { subs: [{ t: "all" }] }, /subs\[0\]\.t/], ["sub not an object", { subs: ["guild"] }, /subs\[0\]/],
    ["ticket id", { subs: [{ t: "tickets", tickets: [{ ticket: "1042", key: TOKEN }] }] }, /ticket: has an invalid format/],
    ["ticket key", { subs: [{ t: "tickets", tickets: [{ ticket: "BF-1042", key: "short" }] }] }, /key: has an invalid format/],
    ["ticket twice", { subs: [{ t: "tickets", tickets: [{ ticket: "BF-1042", key: TOKEN }, { ticket: "BF-1042", key: TOKEN }] }] }, /duplicate ticket/],
    ["tickets twice", { subs: [{ t: "tickets", tickets: [] }, { t: "tickets", tickets: [] }] }, /more than once/],
    ["41 tickets", { subs: [{ t: "tickets", tickets: Array.from({ length: 41 }, (_, i) => ({ ticket: `BF-${2000 + i}`, key: TOKEN })) }] }, /at most 40/],
    ["extra ticket field", { subs: [{ t: "tickets", tickets: [{ ticket: "BF-1042", key: TOKEN, since: 1 }] }] }, /unknown field/],
    ["guild id", { subs: [{ t: "guild", guildId: "g_1", member: TOKEN }] }, /guildId/], ["member token", { subs: [{ t: "guild", guildId: GUILD, member: "x" }] }, /member/],
    ["guild twice", { subs: [{ t: "guild", guildId: GUILD, member: TOKEN }, { t: "guild", guildId: GUILD, member: TOKEN }] }, /duplicate guild/],
    ["nine guilds", { subs: Array.from({ length: 9 }, (_, i) => ({ t: "guild", guildId: `g_${String(i).repeat(16)}`, member: TOKEN })) }, /at most 8 guilds/],
    ["faction", { subs: [{ t: "lfg", realm: "Thunder Hold", faction: "neutral" }] }, /faction/], ["realm", { subs: [{ t: "lfg", realm: "<b>", faction: "horde" }] }, /realm/],
    ["three boards", { subs: [1, 2, 3].map(() => ({ t: "lfg", realm: "Thunder Hold", faction: "horde" })) }, /at most 2 party boards/],
  ]);
});

test("L2 stream query: exactly one 43-character token", () => {
  const q = (s) => V.validateStreamQuery(new URLSearchParams(s));
  assert.equal(q(`s=${TOKEN}`), TOKEN);
  invalid(() => q(""), /s: is required/);
  invalid(() => q("s=short"), /s: has an invalid format/);
  invalid(() => q(`s=${TOKEN}&s=${TOKEN}`), /more than once/);
  invalid(() => q(`s=${TOKEN}&x=1`), /unknown field/);
});

test("G1/G2/G4: create, join and change a guild", () => {
  const create = (over = {}) => ({ schema: 1, installId: uuid(), realm: "Thunder Hold", faction: "horde", guildName: "Night Watch", character: who(), rankIndex: 0, ...over });
  const made = V.validateGuildCreate(create());
  assert.equal(made.guildName, "Night Watch");
  assert.equal(V.validateGuildCreate(create({ consent: true })).rankIndex, 0);
  assert.equal(V.validateGuildCreate(create({ guildName: "L'Ordre d'Azur", realm: "Kul Tiras-2" })).guildName, "L'Ordre d'Azur");
  cases(V.validateGuildCreate, create, [
    ["schema", { schema: "1" }, /schema/], ["install", { installId: null }, /UUID/], ["faction", { faction: "Horde" }, /faction/], ["unknown", { note: "x" }, /unknown field/],
    ["name too short", { guildName: "A" }, /guildName/], ["name too long", { guildName: "A".repeat(25) }, /guildName/], ["name with markup", { guildName: "<script>" }, /guildName/],
    ["name with colour code", { guildName: "|cffff0000Red" }, /guildName/], ["name with a hidden character", { guildName: `Night${cp(0x202e)}Watch` }, /guildName/],
    ["name with double space", { guildName: "Night  Watch" }, /guildName/], ["name ending in a space", { guildName: "Night Watch " }, /guildName/],
    ["rank", { rankIndex: 10 }, /rankIndex/], ["rank type", { rankIndex: "0" }, /rankIndex/], ["rank negative", { rankIndex: -1 }, /rankIndex/],
    ["character missing realm", { character: { name: "Abel" } }, /character\.realm: is required/], ["character extra", { character: { ...who(), guid: "Player-1" } }, /unknown field/],
    ["character with digits", { character: who("Abel2") }, /character\.name/], ["character with a space", { character: who("Abel Smith") }, /character\.name/],
    ["character too long", { character: who("A".repeat(25)) }, /character\.name/], ["consent false", { consent: false }, /consent: must be true/], ["realm", { realm: "x" }, /realm/],
  ]);

  const join = (over = {}) => ({ schema: 1, installId: uuid(), linkCode: "BFG-7K2M-Q9XD", character: who("Bea"), rankIndex: 4, consent: true, ...over });
  assert.equal(V.validateGuildJoin(join()).linkCode, "BFG-7K2M-Q9XD");
  assert.equal(V.validateGuildJoin(join({ linkCode: " bfg-7k2m-q9xd " })).linkCode, "BFG-7K2M-Q9XD", "typed in lower case with spaces around");
  cases(V.validateGuildJoin, join, [
    ["consent missing", { consent: undefined }, /consent: is required/], ["consent false", { consent: false }, /consent: must be true/], ["consent as text", { consent: "true" }, /consent: must be true/],
    ["consent as 1", { consent: 1 }, /consent: must be true/], ["code with an ambiguous letter", { linkCode: "BFG-7K2M-Q9XO" }, /linkCode/], ["code with a 1", { linkCode: "BFG-1K2M-Q9XD" }, /linkCode/],
    ["code too short", { linkCode: "BFG-7K2M" }, /linkCode/], ["code not text", { linkCode: 7 }, /linkCode/], ["wrong prefix", { linkCode: "BFL-7K2M-Q9XD" }, /linkCode/],
    ["rank missing", { rankIndex: undefined }, /rankIndex: is required/], ["unknown", { guildId: GUILD }, /unknown field/],
  ]);
  for (const c of "0O1IL") assert.ok(!V.CODE_ALPHABET.includes(c), `${c} is not in the code alphabet`);
  assert.equal(V.CODE_ALPHABET.length, 31);

  const patch = (over = {}) => ({ schema: 1, thresholds: { officerRank: 2 }, ...over });
  assert.deepEqual(V.validateGuildPatch(patch()), { thresholds: { officerRank: 2 }, rotateCode: false });
  assert.deepEqual(V.validateGuildPatch({ schema: 1, rotateCode: true }), { thresholds: null, rotateCode: true });
  assert.deepEqual(V.validateGuildPatch(patch({ thresholds: { officerRank: 0, proposeRank: 9, editRank: 3 }, rotateCode: true })).thresholds, { officerRank: 0, proposeRank: 9, editRank: 3 });
  cases(V.validateGuildPatch, patch, [
    ["nothing", { thresholds: undefined }, /nothing to change/], ["empty thresholds", { thresholds: {} }, /at least one/], ["unknown threshold", { thresholds: { leaderRank: 0 } }, /unknown field/],
    ["threshold range", { thresholds: { editRank: 12 } }, /editRank/], ["rotate false", { rotateCode: false }, /rotateCode: must be true/], ["unknown", { guildName: "New" }, /unknown field/], ["schema", { schema: 0 }, /schema/],
  ]);

  assert.deepEqual(V.validateEmpty(undefined), {});
  assert.deepEqual(V.validateEmpty({ schema: 1 }), {});
  invalid(() => V.validateEmpty({ schema: 1, installId: uuid() }), /unknown field/);
  invalid(() => V.validateEmpty({}), /schema: is required/);
  assert.equal(V.memberSegment("Abel"), "Abel");
  invalid(() => V.memberSegment("Abel/../x"), /name/);
  assert.equal(V.guildIdSegment(GUILD), GUILD);
  assert.equal(V.guildIdSegment("g_short"), null);
  assert.equal(V.memberToken(TOKEN), TOKEN);
  assert.equal(V.memberToken(undefined), null);
  assert.equal(V.memberToken(`${TOKEN}=`), null);
});

test("E1 event: the shape, bare or wrapped, and every refusal", () => {
  const event = (over = {}) => ({ id: "abc123", version: 3, creator: who("Anna"), editor: who("Bob"), at: "2026-11-27T19:00:00Z", place: "mc", title: "Molten Core", note: "Bring fire resist",
    roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false, ...over });
  const ok = V.validateEvent(event(), "abc123");
  assert.deepEqual(ok, { id: "abc123", version: 3, creator: who("Anna"), editor: who("Bob"), at: "2026-11-27T19:00:00Z", place: "mc", title: "Molten Core", note: "Bring fire resist", roles: { tank: 2, healer: 8, damage: 30 }, cancelled: false });
  assert.deepEqual(V.validateEvent({ schema: 1, event: event() }, "abc123"), ok, "wrapped");
  assert.deepEqual(V.validateEvent({ schema: 1, ...event() }, "abc123"), ok, "bare with schema");
  assert.equal(V.validateEvent(event({ editor: who("anna") })).editor, null, "the creator as editor is no editor");
  assert.equal(V.validateEvent(event({ editor: null })).editor, null);
  assert.equal(V.validateEvent(event({ note: undefined })).note, "");
  assert.equal(V.validateEvent(event({ note: "" })).note, "");
  assert.equal(V.validateEvent(event({ cancelled: undefined })).cancelled, false);
  assert.equal(V.validateEvent(event({ place: "other", title: "@everyone **free gold**" })).title, "@everyone **free gold**", "stored as given; made harmless where it is shown");
  cases((b) => V.validateEvent(b, "abc123"), event, [
    ["id not the address", { id: "other1" }, /id: must be the id in the address/], ["id characters", { id: "a b" }, /id/], ["id too long", { id: "a".repeat(25) }, /id/],
    ["version 0", { version: 0 }, /version/], ["version too high", { version: 10000 }, /version/], ["version text", { version: "3" }, /version/], ["version fraction", { version: 1.5 }, /version/],
    ["creator text", { creator: "Anna" }, /creator: must be an object/], ["creator name", { creator: who("An na") }, /creator\.name/], ["editor name", { editor: who("B0b") }, /editor\.name/],
    ["time format", { at: "2026-11-27 19:00" }, /at: has an invalid format/], ["time with offset", { at: "2026-11-27T19:00:00+01:00" }, /at/], ["time that does not exist", { at: "2026-02-30T19:00:00Z" }, /not a real time/],
    ["place capital", { place: "MC" }, /place/], ["place too long", { place: "moltencore" }, /place/], ["title short", { title: "A" }, /title: must be at least 2/], ["title long", { title: "t".repeat(41) }, /title: must be at most 40/],
    ["title with colour code", { title: "|cffff0000Raid|r" }, /colour or link codes/], ["title with a link", { title: "join discord.gg/abc" }, /web address/], ["title with a newline", { title: "Molten\nCore" }, /control characters/],
    ["title with a hidden character", { title: `Molten${cp(0x200b)}Core` }, /control characters/], ["title with a direction override", { title: `Molten${cp(0x202e)}Core` }, /control characters/],
    ["note long", { note: "n".repeat(81) }, /note: must be at most 80/], ["note with a link", { note: "see https://x.example" }, /web address/], ["note with www", { note: "www.site.example" }, /web address/],
    ["note with a .com", { note: "buy at cheapgold.com now" }, /web address/], ["tanks", { roles: { tank: 10, healer: 8, damage: 30 } }, /roles\.tank/], ["damage", { roles: { tank: 2, healer: 8, damage: 41 } }, /roles\.damage/],
    ["roles missing one", { roles: { tank: 2, healer: 8 } }, /roles\.damage: is required/], ["roles extra", { roles: { tank: 2, healer: 8, damage: 30, bench: 2 } }, /unknown field/],
    ["cancelled text", { cancelled: "no" }, /cancelled/], ["unknown field", { signups: [] }, /unknown field/], ["missing title", { title: undefined }, /title: is required/],
  ]);
  invalid(() => V.validateEvent({ schema: 2, event: event() }), /schema/);
  invalid(() => V.validateEvent({ schema: 1, event: event(), extra: 1 }), /unknown field/);
  invalid(() => V.validateEvent(null), /must be an object/);
  invalid(() => V.validateEvent([event()]), /must be an object/);
  // 40 characters, not bytes: accented letters count once.
  assert.equal(V.validateEvent(event({ title: cp(0xe9).repeat(40) })).title.length, 40);
});

test("E2 sign-up and E3 summary", () => {
  const signup = (over = {}) => ({ who: who("Bea"), answer: "healer", version: 2, via: "desktop", ...over });
  assert.deepEqual(V.validateSignup(signup(), "Bea"), signup());
  assert.deepEqual(V.validateSignup({ schema: 1, signup: signup() }, "bea"), signup(), "wrapped; the address is not case sensitive");
  assert.deepEqual(V.validateSignup({ schema: 1, ...signup({ via: "game" }) }, "Bea").via, "game");
  cases((b) => V.validateSignup(b, "Bea"), signup, [
    ["another name than the address", { who: who("Cy") }, /who\.name: must be the name in the address/], ["answer", { answer: "yes" }, /answer/], ["version", { version: 0 }, /version/],
    ["via discord is the server's own", { via: "discord" }, /via: must be one of game, desktop/], ["via missing", { via: undefined }, /via: is required/], ["unknown", { note: "late" }, /unknown field/],
    ["who text", { who: "Bea" }, /who: must be an object/],
  ]);
  const q = (s) => V.validateEventsQuery(new URLSearchParams(s));
  assert.equal(q(""), null);
  assert.equal(q("since=2026-11-24T12:00:00Z"), "2026-11-24T12:00:00Z");
  invalid(() => q("since=yesterday"), /since/);
  invalid(() => q("since=2026-11-24T12:00:00Z&since=2026-11-24T12:00:00Z"), /more than once/);
  invalid(() => q("limit=5"), /unknown field/);

  const summary = (over = {}) => ({ schema: 1, attended: ["Abel", "Bea"], bosses: 8, durationSec: 9000, ...over });
  assert.deepEqual(V.validateSummary(summary()), { attended: ["Abel", "Bea"], bosses: 8, durationSec: 9000 });
  cases(V.validateSummary, summary, [
    ["name", { attended: ["Abel", "@everyone"] }, /attended\[1\]/], ["same name twice", { attended: ["Abel", "abel"] }, /duplicate name/], ["81 names", { attended: Array.from({ length: 81 }, (_, i) => `N${"a".repeat(i % 20 + 1)}`) }, /at most 80/],
    ["bosses", { bosses: 100 }, /bosses/], ["duration", { durationSec: 86401 }, /durationSec/], ["bosses missing", { bosses: undefined }, /bosses: is required/], ["unknown", { loot: [] }, /unknown field/], ["schema", { schema: 3 }, /schema/],
  ]);
});

test("D3 Discord link code", () => {
  assert.deepEqual(V.validateDiscordLink({ schema: 1, code: "bfl-7k2m-q9xd" }), { code: "BFL-7K2M-Q9XD" });
  invalid(() => V.validateDiscordLink({ schema: 1, code: "BFG-7K2M-Q9XD" }), /code/);
  invalid(() => V.validateDiscordLink({ schema: 1, code: 12345678 }), /code/);
  invalid(() => V.validateDiscordLink({ schema: 1 }), /code: is required/);
  invalid(() => V.validateDiscordLink({ schema: 1, code: "BFL-7K2M-Q9XD", user: "1" }), /unknown field/);
});

test("P1 party board: listing and query", () => {
  const id = "L".repeat(16), install = uuid();
  const body = (over = {}, listing = {}) => ({ schema: 1, installId: install, realm: "Thunder Hold", faction: "alliance", consent: true, ...over,
    listing: { id, kind: "lfm", who: who("Abel"), level: 34, class: "hunter", roles: ["damage", "tank"], place: "sm", note: "Need a healer", need: { tank: 1, healer: 1, damage: 0 }, at: "2026-11-24T12:00:00Z", ...listing } });
  const ok = V.validateListing(body(), id);
  assert.deepEqual(ok.listing.roles, ["tank", "damage"], "roles come back in a fixed order");
  assert.deepEqual(ok.listing.need, { tank: 1, healer: 1, damage: 0 });
  assert.equal(V.validateListing(body({}, { class: null, need: null, roles: [], note: "" }), id).listing.class, null);
  const bad = (label, over, listing, re) => invalid(() => V.validateListing(body(over, listing), id), re, label);
  bad("consent", { consent: false }, {}, /consent: must be true/);
  bad("consent missing", { consent: undefined }, {}, /consent: is required/);
  bad("faction", { faction: "both" }, {}, /faction/);
  bad("unknown field", { guildId: GUILD }, {}, /unknown field/);
  bad("id not the address", {}, { id: "M".repeat(16) }, /listing\.id: must be the id in the address/);
  bad("id length", {}, { id: "short" }, /listing\.id/);
  bad("kind", {}, { kind: "wts" }, /listing\.kind/);
  bad("level 0", {}, { level: 0 }, /listing\.level/);
  bad("level 81", {}, { level: 81 }, /listing\.level/);
  bad("class", {}, { class: "Hunter" }, /listing\.class/);
  bad("role", {}, { roles: ["dps"] }, /listing\.roles\[0\]/);
  bad("role twice", {}, { roles: ["tank", "tank"] }, /duplicate role/);
  bad("place", {}, { place: "Scarlet Monastery" }, /listing\.place/);
  bad("note long", {}, { note: "n".repeat(61) }, /listing\.note: must be at most 60/);
  bad("note with a link", {}, { note: "join discord.gg/abc" }, /web address/);
  bad("note with a colour code", {}, { note: "|cff00ff00WTS|r" }, /colour or link codes/);
  bad("note with a control character", {}, { note: `a${cp(7)}b` }, /control characters/);
  bad("need", {}, { need: { tank: 1, healer: 1 } }, /listing\.need\.damage: is required/);
  bad("time", {}, { at: "now" }, /listing\.at/);
  bad("listing extra", {}, { gold: 5 }, /unknown field/);
  bad("who", {}, { who: who("A") }, /listing\.who\.name/);
  const q = (s) => V.validateLfgQuery(new URLSearchParams(s));
  assert.deepEqual(q("realm=Thunder+Hold&faction=horde"), { realm: "Thunder Hold", faction: "horde" });
  invalid(() => q("realm=Thunder+Hold"), /faction: is required/);
  invalid(() => q("faction=horde"), /realm: is required/);
  invalid(() => q("realm=Thunder+Hold&faction=pirates"), /faction/);
  invalid(() => q("realm=Thunder+Hold&faction=horde&page=2"), /unknown field/);
  invalid(() => q("realm=a&realm=b&faction=horde"), /realm/);
  assert.deepEqual(V.validateInstallOnly({ schema: 1, installId: install }), { installId: install });
  invalid(() => V.validateInstallOnly({ schema: 1 }), /installId: is required/);
});

test("plain text: the link check mirrors the addon's, and nothing invisible gets through", () => {
  for (const bad of ["join https://x.y/z", "see www.site.example", "discord.gg/abc", "buy gold at cheapgold.com now", "visit shop.net", "my.org today", "stream on a.tv"]) assert.equal(V.linky(bad), true, bad);
  for (const good of ["Molten Core 20.00", "tank + 2 healers", "e.g. bring pots", "no.one cares"]) assert.equal(V.linky(good), false, good);
  for (const c of [0, 7, 0x1b, 0x7f, 0x85, 0x200b, 0x200e, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff, 0x2028]) invalid(() => V.plainLine(`a${cp(c)}b`, "t", 0, 40), /control characters/, `U+${c.toString(16)}`);
  assert.equal(V.plainLine("  Molten Core  ", "t", 2, 40), "Molten Core");
  invalid(() => V.plainLine("ab", "t", 3, 40), /at least 3/);
  invalid(() => V.plainLine(5, "t", 0, 40), /must be a string/);
  invalid(() => V.plainLine("\ud800", "t", 0, 40), /Unicode|control/);
});
