"use strict";
// Strict validation for Backstage Live: the realtime session, guilds, guild
// events and sign-ups, the Discord link and the party board. Same rules as
// validate.js: unknown fields are rejected, every value is on a fixed list or
// matches a fixed pattern, and the first offending path is named.
const { fail, plainObject, array, oneOf, intRange, installId } = require("./validate");
const { ticketNumber, ticketKey, chars } = require("./validate-desk");

const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url: member tokens and stream tokens
const GUILD_ID = /^g_[A-Za-z0-9_-]{16}$/;
const EVENT_ID = /^[A-Za-z0-9_-]{1,24}$/;
const LISTING_ID = /^[A-Za-z0-9_-]{16}$/;
const PLACE = /^[a-z][a-z0-9]{0,7}$/; // an Atlas id of the addon ("mc", "brd"), or "other"
const CLASS = /^[a-z]{3,12}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SNOWFLAKE = /^\d{15,22}$/;
// Codes people type: no 0/O, 1/I/L, so a code read aloud or copied by hand cannot be mistyped that way.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LINK_CODE = new RegExp(`^BFG-[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`);
const DISCORD_CODE = new RegExp(`^BFL-[${CODE_ALPHABET}]{4}-[${CODE_ALPHABET}]{4}$`);
const CHARACTER = /^[\p{L}\p{M}]{2,24}$/u; // a character name as the game shows it: letters only
const REALM = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’-]{1,39}$/u;
const GUILD_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.-]{1,23}$/u;
const FACTIONS = Object.freeze(["horde", "alliance"]);
const ANSWERS = Object.freeze(["tank", "healer", "damage", "maybe", "no"]);
const ROLES = Object.freeze(["tank", "healer", "damage"]);
const CLIENT_VIA = Object.freeze(["game", "desktop"]); // "discord" is only ever set by the server
const LFG_KINDS = Object.freeze(["lfg", "lfm"]);
const LIVE_LIMITS = Object.freeze({
  title: 40, titleMin: 2, note: 80, lfgNote: 60, version: 9999, rank: 9,
  subs: 12, ticketSubs: 40, guildSubs: 8, lfgSubs: 2, attended: 80, level: 80,
  aheadMs: 180 * 86_400_000, // an event at most half a year ahead, as in the addon
});

// Control characters and invisible direction or format characters (built from code points so this file stays plain ASCII here).
const HIDDEN = new RegExp("[" + [[0, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => "\\u{" + a.toString(16) + "}-\\u{" + b.toString(16) + "}").join("") + "]", "u");

function schema1(body) { if (body.schema !== 1) fail("schema", "must be 1"); }
function matching(value, path, re) {
  if (typeof value !== "string" || !re.test(value)) fail(path, "has an invalid format");
  return value;
}
// ASCII lower case only, as the addon's string.lower does it; other letters stay as they are.
function asciiLower(s) { return String(s).replace(/[A-Z]/g, (c) => c.toLowerCase()); }

function name(value, path, re) {
  if (typeof value !== "string" || value.length > 96 || !value.isWellFormed()) fail(path, "has an invalid format");
  const text = value.normalize("NFC");
  if (!re.test(text) || /\s{2}|\s$/.test(text)) fail(path, "has an invalid format");
  return text;
}
function character(value, path) {
  const c = plainObject(value, path, ["name", "realm"], ["name", "realm"]);
  return { name: name(c.name, `${path}.name`, CHARACTER), realm: name(c.realm, `${path}.realm`, REALM) };
}
function realmKey(realm) { return realm.toLowerCase(); }
function nameKey(n) { return n.normalize("NFC").toLowerCase(); }

// Does a text hold a web address? Mirrors BackstageForeverEventLinky of the addon.
function linky(text) {
  const t = text.toLowerCase();
  if (t.includes("://") || t.includes("www.") || t.includes(".gg/")) return true;
  return /[a-z0-9]\.(?:com|net|org|gg|io|ru|tv)(?![a-z])/.test(t);
}

// One line of plain player text: NFC, no control or invisible direction characters, no game colour or
// link codes (they all start with "|"), no web addresses. Limits are in characters.
function plainLine(value, path, min, max) {
  if (typeof value !== "string") fail(path, "must be a string");
  if (value.length > max * 2 + 16) fail(path, `must be at most ${max} characters`);
  if (!value.isWellFormed()) fail(path, "is not valid Unicode");
  const text = value.normalize("NFC").trim();
  if (HIDDEN.test(text)) fail(path, "contains control characters");
  if (text.includes("|")) fail(path, "contains colour or link codes");
  if (/\s{2}/.test(text)) fail(path, "contains repeated spaces");
  if (linky(text)) fail(path, "must not contain a web address");
  if (chars(text) > max) fail(path, `must be at most ${max} characters`);
  if (chars(text) < min) fail(path, `must be at least ${min} characters`);
  return text;
}

function isoTime(value, path) {
  matching(value, path, ISO_TIME);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") !== value) fail(path, "is not a real time");
  return value;
}
function place(value, path) { return matching(value, path, PLACE); }
function rank(value, path = "rankIndex") { return intRange(value, path, 0, LIVE_LIMITS.rank); }
function consent(value) { if (value !== true) fail("consent", "must be true"); }

// ------------------------------------------------------------------ realtime
function validateSession(body) {
  plainObject(body, "", ["schema", "installId", "subs"], ["schema", "installId", "subs"]);
  schema1(body);
  const out = { installId: installId(body.installId), tickets: [], guilds: [], lfg: [] };
  let sawTickets = false;
  for (const [i, s] of array(body.subs, "subs", LIVE_LIMITS.subs).entries()) {
    const p = `subs[${i}]`;
    if (s === null || typeof s !== "object" || Array.isArray(s)) fail(p, "must be an object");
    if (s.t === "tickets") {
      plainObject(s, p, ["t", "tickets"], ["t", "tickets"]);
      if (sawTickets) fail(p, "tickets given more than once");
      sawTickets = true;
      const seen = new Set();
      for (const [j, t] of array(s.tickets, `${p}.tickets`, LIVE_LIMITS.ticketSubs).entries()) {
        const q = `${p}.tickets[${j}]`;
        plainObject(t, q, ["ticket", "key"], ["ticket", "key"]);
        const number = ticketNumber(t.ticket);
        if (number === null) fail(`${q}.ticket`, "has an invalid format");
        if (seen.has(number)) fail(`${q}.ticket`, "duplicate ticket");
        seen.add(number);
        if (ticketKey(t.key) === null) fail(`${q}.key`, "has an invalid format");
        out.tickets.push({ number, key: t.key });
      }
    } else if (s.t === "guild") {
      plainObject(s, p, ["t", "guildId", "member"], ["t", "guildId", "member"]);
      const guildId = matching(s.guildId, `${p}.guildId`, GUILD_ID);
      if (out.guilds.some(g => g.guildId === guildId)) fail(`${p}.guildId`, "duplicate guild");
      if (out.guilds.length >= LIVE_LIMITS.guildSubs) fail(p, `at most ${LIVE_LIMITS.guildSubs} guilds`);
      out.guilds.push({ guildId, member: matching(s.member, `${p}.member`, TOKEN) });
    } else if (s.t === "lfg") {
      plainObject(s, p, ["t", "realm", "faction"], ["t", "realm", "faction"]);
      if (out.lfg.length >= LIVE_LIMITS.lfgSubs) fail(p, `at most ${LIVE_LIMITS.lfgSubs} party boards`);
      out.lfg.push({ realm: name(s.realm, `${p}.realm`, REALM), faction: oneOf(s.faction, `${p}.faction`, FACTIONS) });
    } else fail(`${p}.t`, "must be one of tickets, guild, lfg");
  }
  return out;
}

function validateStreamQuery(params) {
  let token = null;
  for (const [k, v] of params) {
    if (k !== "s") fail(k.slice(0, 40), "unknown field");
    if (token !== null) fail("s", "given more than once");
    token = matching(v, "s", TOKEN);
  }
  if (token === null) fail("s", "is required");
  return token;
}

// -------------------------------------------------------------------- guilds
function validateGuildCreate(body) {
  const keys = ["schema", "installId", "realm", "faction", "guildName", "character", "rankIndex"];
  plainObject(body, "", [...keys, "consent"], keys);
  schema1(body);
  if (body.consent !== undefined) consent(body.consent);
  return {
    installId: installId(body.installId), realm: name(body.realm, "realm", REALM), faction: oneOf(body.faction, "faction", FACTIONS),
    guildName: name(body.guildName, "guildName", GUILD_NAME), character: character(body.character, "character"), rankIndex: rank(body.rankIndex),
  };
}

function linkCode(value, path = "linkCode") {
  if (typeof value !== "string" || value.length > 32) fail(path, "has an invalid format");
  return matching(value.trim().toUpperCase(), path, LINK_CODE);
}

function validateGuildJoin(body) {
  const keys = ["schema", "installId", "linkCode", "character", "rankIndex", "consent"];
  plainObject(body, "", keys, keys);
  schema1(body);
  consent(body.consent);
  return { installId: installId(body.installId), linkCode: linkCode(body.linkCode), character: character(body.character, "character"), rankIndex: rank(body.rankIndex) };
}

function validateGuildPatch(body) {
  plainObject(body, "", ["schema", "thresholds", "rotateCode"], ["schema"]);
  schema1(body);
  const out = { thresholds: null, rotateCode: false };
  if (body.thresholds !== undefined) {
    const t = plainObject(body.thresholds, "thresholds", ["officerRank", "proposeRank", "editRank"]);
    out.thresholds = {};
    for (const k of ["officerRank", "proposeRank", "editRank"]) if (t[k] !== undefined) out.thresholds[k] = rank(t[k], `thresholds.${k}`);
    if (!Object.keys(out.thresholds).length) fail("thresholds", "must name at least one threshold");
  }
  if (body.rotateCode !== undefined) {
    if (body.rotateCode !== true) fail("rotateCode", "must be true");
    out.rotateCode = true;
  }
  if (!out.thresholds && !out.rotateCode) fail("", "nothing to change");
  return out;
}

// Bodies that carry nothing ({"schema":1}); an absent body is taken as that.
function validateEmpty(body) {
  if (body === undefined) return {};
  plainObject(body, "", ["schema"], ["schema"]);
  schema1(body);
  return {};
}
function validateInstallOnly(body) {
  plainObject(body, "", ["schema", "installId"], ["schema", "installId"]);
  schema1(body);
  return { installId: installId(body.installId) };
}

// A path segment holding a character name (already percent-decoded by the router).
function memberSegment(value) { return name(value, "name", CHARACTER); }
function guildIdSegment(value) { return typeof value === "string" && GUILD_ID.test(value) ? value : null; }
function memberToken(value) { return typeof value === "string" && TOKEN.test(value) ? value : null; }

// -------------------------------------------------------- events and sign-ups
// The E1 shape. Accepted bare (optionally with "schema":1) or as {"schema":1,"event":{…}}.
function validateEvent(body, pathId) {
  let e = body;
  if (e !== null && typeof e === "object" && !Array.isArray(e) && Object.hasOwn(e, "event")) {
    plainObject(e, "", ["schema", "event"], ["schema", "event"]);
    schema1(e);
    e = e.event;
  } else if (e !== null && typeof e === "object" && !Array.isArray(e) && Object.hasOwn(e, "schema")) {
    schema1(e);
    e = { ...e }; delete e.schema;
  }
  const required = ["id", "version", "creator", "at", "place", "title", "roles"];
  plainObject(e, "", [...required, "editor", "note", "cancelled"], required);
  const id = matching(e.id, "id", EVENT_ID);
  if (pathId !== undefined && id !== pathId) fail("id", "must be the id in the address");
  const roles = plainObject(e.roles, "roles", ROLES, ROLES);
  const creator = character(e.creator, "creator");
  let editor = e.editor === undefined || e.editor === null ? null : character(e.editor, "editor");
  if (editor && nameKey(editor.name) === nameKey(creator.name)) editor = null; // the creator editing their own event
  if (e.cancelled !== undefined && typeof e.cancelled !== "boolean") fail("cancelled", "must be true or false");
  return {
    id, version: intRange(e.version, "version", 1, LIVE_LIMITS.version), creator, editor,
    at: isoTime(e.at, "at"), place: place(e.place, "place"),
    title: plainLine(e.title, "title", LIVE_LIMITS.titleMin, LIVE_LIMITS.title),
    note: e.note === undefined || e.note === null ? "" : plainLine(e.note, "note", 0, LIVE_LIMITS.note),
    roles: { tank: intRange(roles.tank, "roles.tank", 0, 9), healer: intRange(roles.healer, "roles.healer", 0, 9), damage: intRange(roles.damage, "roles.damage", 0, 40) },
    cancelled: e.cancelled === true,
  };
}

// The E2 shape, bare (optionally with "schema":1) or as {"schema":1,"signup":{…}}.
function validateSignup(body, pathName) {
  let s = body;
  if (s !== null && typeof s === "object" && !Array.isArray(s) && Object.hasOwn(s, "signup")) {
    plainObject(s, "", ["schema", "signup"], ["schema", "signup"]);
    schema1(s);
    s = s.signup;
  } else if (s !== null && typeof s === "object" && !Array.isArray(s) && Object.hasOwn(s, "schema")) {
    schema1(s);
    s = { ...s }; delete s.schema;
  }
  const keys = ["who", "answer", "version", "via"];
  plainObject(s, "", keys, keys);
  const who = character(s.who, "who");
  if (pathName !== undefined && nameKey(who.name) !== nameKey(pathName)) fail("who.name", "must be the name in the address");
  return { who, answer: oneOf(s.answer, "answer", ANSWERS), version: intRange(s.version, "version", 1, LIVE_LIMITS.version), via: oneOf(s.via, "via", CLIENT_VIA) };
}

function validateEventsQuery(params) {
  let since = null;
  for (const [k, v] of params) {
    if (k !== "since") fail(k.slice(0, 40), "unknown field");
    if (since !== null) fail("since", "given more than once");
    since = isoTime(v, "since");
  }
  return since;
}

function validateSummary(body) {
  const keys = ["schema", "attended", "bosses", "durationSec"];
  plainObject(body, "", keys, keys);
  schema1(body);
  const seen = new Set(), attended = [];
  for (const [i, n] of array(body.attended, "attended", LIVE_LIMITS.attended).entries()) {
    const who = name(n, `attended[${i}]`, CHARACTER);
    if (seen.has(nameKey(who))) fail(`attended[${i}]`, "duplicate name");
    seen.add(nameKey(who));
    attended.push(who);
  }
  return { attended, bosses: intRange(body.bosses, "bosses", 0, 99), durationSec: intRange(body.durationSec, "durationSec", 0, 86_400) };
}

function validateDiscordLink(body) {
  plainObject(body, "", ["schema", "code"], ["schema", "code"]);
  schema1(body);
  if (typeof body.code !== "string" || body.code.length > 32) fail("code", "has an invalid format");
  return { code: matching(body.code.trim().toUpperCase(), "code", DISCORD_CODE) };
}

// ---------------------------------------------------------------- party board
function validateListing(body, pathId) {
  const keys = ["schema", "installId", "realm", "faction", "listing", "consent"];
  plainObject(body, "", keys, keys);
  schema1(body);
  consent(body.consent);
  const required = ["id", "kind", "who", "level", "class", "roles", "place", "note", "need", "at"];
  const l = plainObject(body.listing, "listing", required, required);
  const id = matching(l.id, "listing.id", LISTING_ID);
  if (pathId !== undefined && id !== pathId) fail("listing.id", "must be the id in the address");
  const seen = new Set();
  for (const [i, r] of array(l.roles, "listing.roles", ROLES.length).entries()) {
    oneOf(r, `listing.roles[${i}]`, ROLES);
    if (seen.has(r)) fail(`listing.roles[${i}]`, "duplicate role");
    seen.add(r);
  }
  let need = null;
  if (l.need !== null) {
    const n = plainObject(l.need, "listing.need", ROLES, ROLES);
    need = { tank: intRange(n.tank, "listing.need.tank", 0, 9), healer: intRange(n.healer, "listing.need.healer", 0, 9), damage: intRange(n.damage, "listing.need.damage", 0, 40) };
  }
  isoTime(l.at, "listing.at"); // checked, then replaced by the time the server received it
  return {
    installId: installId(body.installId), realm: name(body.realm, "realm", REALM), faction: oneOf(body.faction, "faction", FACTIONS),
    listing: {
      id, kind: oneOf(l.kind, "listing.kind", LFG_KINDS), who: character(l.who, "listing.who"),
      level: intRange(l.level, "listing.level", 1, LIVE_LIMITS.level), class: l.class === null ? null : matching(l.class, "listing.class", CLASS),
      roles: ROLES.filter(r => seen.has(r)), place: place(l.place, "listing.place"),
      note: plainLine(l.note, "listing.note", 0, LIVE_LIMITS.lfgNote), need,
    },
  };
}

function validateLfgQuery(params) {
  const out = { realm: null, faction: null };
  for (const [k, v] of params) {
    if (!Object.hasOwn(out, k)) fail(k.slice(0, 40), "unknown field");
    if (out[k] !== null) fail(k, "given more than once");
    out[k] = k === "realm" ? name(v, "realm", REALM) : oneOf(v, "faction", FACTIONS);
  }
  if (out.realm === null) fail("realm", "is required");
  if (out.faction === null) fail("faction", "is required");
  return out;
}

module.exports = {
  validateSession, validateStreamQuery, validateGuildCreate, validateGuildJoin, validateGuildPatch, validateEmpty, validateInstallOnly,
  validateEvent, validateSignup, validateEventsQuery, validateSummary, validateDiscordLink, validateListing, validateLfgQuery,
  memberSegment, guildIdSegment, memberToken, linkCode, plainLine, linky, isoTime, asciiLower, realmKey, nameKey, character,
  TOKEN, GUILD_ID, EVENT_ID, LISTING_ID, LINK_CODE, DISCORD_CODE, CODE_ALPHABET, SNOWFLAKE, CHARACTER, REALM, GUILD_NAME, PLACE,
  FACTIONS, ANSWERS, ROLES, CLIENT_VIA, LFG_KINDS, LIVE_LIMITS,
};
