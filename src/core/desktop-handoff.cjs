"use strict";
// Desktop -> game hand-off (1.20, roadmap F3). The addon cannot hear the desktop while the game
// runs, so the desktop writes one small data-only Lua file into the addon's own folder through the
// installer's safe write path. The game reads it at the next login or /reload. Nothing is sent to
// the game, no input is simulated and SavedVariables are never touched.
//
// Content: each character's wish list (item ids starred in the Instance Atlas), since 1.21 the
// dungeon drops the desktop rates as an upgrade over what the character wears, and (roadmap C1)
// the talent build the player marked "Use in game": its talents by name and the order to take
// them, so /bf talents can name the next point. Characters are keyed "Name-Realm", the only
// identity the game and the desktop both know without a save round trip. The file stays on this
// computer.
//
// Roadmap E4 adds the gathering loop the player sent from the World Map: loop={m=map id,
// k="h" herbs or "o" ore, s={x1,y1,x2,y2,...}} with each stop in ten-thousandths of the map, in
// walking order. /bf loop walks it. Like the talent plan it is left out before the file grows past
// its limit.
//
// Roadmap A1 adds the last few answers the companion gave to questions asked from the game:
// ans={{q="question",a="answer",t=unix seconds},...}, newest first, plain text, at most 5 of them.
// /bf answers reads them in game. They are the newest passenger and the first left out.
//
// Roadmap Q8/Q9 (and the F3 follow-up) add the next steps of a route the player changed on the
// desktop: rt={v="careful",s={{kind,text,map id,x,y,level,{quest ids},step id,note},...}} in the
// shape of the addon's own guide steps, with the player's note as a ninth value. It is written
// only for a character whose route differs from the one the addon already carries (another
// variant, or edits), at most 12 steps. It gets room after plans and loops and before answers.
//
// Backstage Desk adds one number beside schema: reports=N, how many replies to the player's own
// reports wait unread in the desktop app. /bf reports says so. It is left out when it is zero, so
// the file is byte for byte what it was before for everyone without a waiting reply.
//
// Profiles ("One addon instead of ten") add the addon settings profile the player chose to send to
// a character under Settings: prof={n="name",f="From-Realm",c="code"}. The code is one line of plain
// characters with its own checksum (settings-profiles.cjs); the game offers it and applies it only
// when the player types /bf profile accept. It is the newest passenger and the first left out.
//
// Backstage Live adds three fields beside `characters` (game-guild-feed.cjs checks them first):
// guild={id="g_…",n="guild name",r="realm",discord="connected",events={{id,version,creator,editor,
// unix time,place,tanks,healers,damage,cancelled 0|1,title,note},...},signups={{event id,name,
// answer t|h|d|m|n,version,via g|k|d},...}}; lfg={r="realm",f="H"|"A",rows={{id,kind g|m,name,realm,
// level,class 0-9,roles,place,note,tanks,healers,damage (-1: no need given),unix time},...}} and
// plan={p="place",n="note",t=unix time,f="Name-Realm",m={{name,role t|h|d|-,bring},...}}. The addon
// merges guild rows by version like guild-channel messages and passes news on to guild members in
// game. They are the newest passengers: each has its own byte cap (sign-ups go before events, the
// oldest board rows first) and, when the whole file is full, the board goes first, then the guild,
// then the plan. With none of them the file is byte for byte what it was.
const FILE = "BackstageForeverDesktop.lua";
const MAX_GUILD_BYTES = 96 * 1024, MAX_LFG_BYTES = 16 * 1024, MAX_PLAN_BYTES = 6 * 1024;
const MAX_PROFILE_CODE = 16000;
const MAX_CHARACTERS = 100, MAX_ITEMS = 200, MAX_BYTES = 256 * 1024, MAX_PICKS = 51, MAX_LOOP_STOPS = 40;
const MAX_ROUTE_STEPS = 12, ROUTE_TEXT = 200, ROUTE_NOTE = 120;
const MAX_ANSWERS = 5, MAX_QUESTION = 200, MAX_ANSWER = 1200;
const MAX_SHIPS = 24, MAX_SHIP_RIDES = 30, MAX_SHIP_BYTES = 16 * 1024;
const luaString = (value) => '"' + [...Buffer.from(String(value), "utf8")].map((b) => (b >= 32 && b <= 126 && b !== 34 && b !== 92 ? String.fromCharCode(b) : "\\" + String(b).padStart(3, "0"))).join("") + '"';
const named = (v) => typeof v === "string" && v.length > 0 && v.length <= 60 && !/[\x00-\x1f]/.test(v);
const itemId = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
const HEADER = [
  "-- Written by the Backstage Forever desktop app when it prepares the addon. Data only.",
  "-- It carries your wish list and gear upgrades into the game; the game reads it at login or /reload.",
  "-- Safe to delete: the desktop app writes it again.",
];

// A talent plan as Lua: t lists each talent once as {name, tree, highest rank}; o is the order of
// points, each a position in t. Returns "" for anything that is not a clean plan.
function talentPlan(plan) {
  if (!plan || !named(plan.name) || !Array.isArray(plan.picks) || !plan.picks.length || plan.picks.length > MAX_PICKS) return "";
  const table = [], at = new Map(), order = [], taken = new Map();
  for (const p of plan.picks) {
    if (!p || !named(p.name) || !named(p.tab) || !Number.isInteger(p.maxRank) || p.maxRank < 1 || p.maxRank > 9) return "";
    const key = `${p.tab}\n${p.name}`;
    if (!at.has(key)) { table.push(`{${luaString(p.name)},${luaString(p.tab)},${p.maxRank}}`); at.set(key, table.length); }
    taken.set(key, (taken.get(key) || 0) + 1);
    if (taken.get(key) > p.maxRank) return "";
    order.push(at.get(key));
  }
  return `tal={n=${luaString(plan.name)},t={${table.join(",")}},o={${order.join(",")}}}`;
}

// A gathering loop as Lua, or "" for anything that is not a clean loop of 3 to 40 stops.
function gatheringLoop(loop) {
  const kind = { herbalism: "h", mining: "o" }[loop?.profession];
  if (!loop || !kind || !itemId(loop.mapId) || !Array.isArray(loop.stops) || loop.stops.length < 3 || loop.stops.length > MAX_LOOP_STOPS) return "";
  const flat = [];
  for (const s of loop.stops) {
    if (!Array.isArray(s) || s.length !== 2 || !s.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return "";
    flat.push(Math.round(s[0] * 10000), Math.round(s[1] * 10000));
  }
  return `loop={m=${loop.mapId},k="${kind}",s={${flat.join(",")}}}`;
}

// Plain text for the chat window: no control characters, no Markdown marks, cut to max characters.
// Line breaks survive in answers (keepLines) so a list stays a list.
function plainText(value, max, keepLines) {
  if (typeof value !== "string") return "";
  let text = value.replace(/\r\n?/g, "\n").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ").replace(/\*\*|__|`+/g, "").replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  text = keepLines ? text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n") : text.replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trimEnd() : text;
}
// The last answers as Lua, or "" when there is none. Each needs a question, an answer and a time.
function answerList(list) {
  const rows = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (rows.length >= MAX_ANSWERS) break;
    const q = plainText(entry?.question, MAX_QUESTION, false), a = plainText(entry?.answer, MAX_ANSWER, true);
    const t = Number.isFinite(entry?.at) && entry.at > 0 ? Math.min(Math.floor(entry.at / 1000), 4102444800) : 0;
    if (q && a) rows.push(`{q=${luaString(q)},a=${luaString(a)},t=${t}}`);
  }
  return rows.length ? `ans={${rows.join(",")}}` : "";
}

// Route steps as Lua, or "" for anything that is not a clean list. Text is escaped byte by byte
// and "|" (the game's colour and link code) never gets through.
// Roadmap B2 adds where boats, zeppelins and airships stop, for /bf fly across the sea. Upstream
// names the transports but not their stops; the desktop works the stops out from the player's own
// game files (transport-rides.cjs). They are not tied to a character, so they sit beside
// `characters`: ships={H={...},A={...}}, one list per faction that has a saved character, each
// {k="z" zeppelin | "b" boat | "a" airship, n="name", s={{"stop",continent,wx,wy},...},
//  r={{from stop,to stop,seconds},...}}. Old addons never look at the field.
const SHIP_KIND = { boat: "b", zeppelin: "z", airship: "a" }, OTHER_SIDE = { Horde: "Alliance", Alliance: "Horde" };
function shipList(rides, faction) {
  const rows = [];
  for (const t of Array.isArray(rides?.transports) ? rides.transports : []) {
    if (rows.length >= MAX_SHIPS) break;
    if (!t || t.source !== "game-files" || !SHIP_KIND[t.mode] || t.side === OTHER_SIDE[faction] || !Array.isArray(t.stops) || t.stops.length < 2 || t.stops.length > 6 || !Array.isArray(t.rides)) continue;
    // A stop nobody could name (no flight point or zone beside it) cannot be told to the player.
    if (!t.stops.every((s) => s && s.named !== false && routeText(s.label, 60) && Number.isSafeInteger(s.instance) && s.instance >= 0 && s.instance <= 9999 && [s.wx, s.wy].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100000))) continue;
    const legs = t.rides.filter((r) => r && Number.isSafeInteger(r.from) && Number.isSafeInteger(r.to) && r.from !== r.to && t.stops[r.from] && t.stops[r.to] && Number.isSafeInteger(r.seconds) && r.seconds > 0 && r.seconds <= 36000).slice(0, MAX_SHIP_RIDES);
    if (!legs.length) continue;
    rows.push(`{k="${SHIP_KIND[t.mode]}"${routeText(t.name, 60) ? `,n=${luaString(t.name)}` : ""},s={${t.stops.map((s) => `{${luaString(s.label)},${s.instance},${Math.round(s.wx)},${Math.round(s.wy)}}`).join(",")}},r={${legs.map((r) => `{${r.from + 1},${r.to + 1},${r.seconds}}`).join(",")}}}`);
  }
  return rows;
}
function shipField(profiles, ships) {
  const sides = [];
  for (const [faction, key] of [["Alliance", "A"], ["Horde", "H"]]) {
    if (!profiles.some((p) => p?.source?.kind === "wow-addon" && p.faction === faction)) continue;
    let rows = []; try { rows = shipList(ships(faction), faction); } catch { rows = []; }
    if (rows.length) sides.push(`${key}={${rows.join(",")}}`);
  }
  const text = sides.length ? `ships={${sides.join(",")}}` : "";
  return Buffer.byteLength(text) <= MAX_SHIP_BYTES ? text : "";
}
const ROUTE_KINDS = new Set(["p", "c", "o", "t", "g", "d", "x"]), ROUTE_VARIANTS = new Set(["solo", "duo", "dungeons", "trips", "careful"]);
const routeText = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f|]/.test(v);
function routeSteps(route) {
  if (!route || !ROUTE_VARIANTS.has(route.variant) || !Array.isArray(route.steps) || !route.steps.length || route.steps.length > MAX_ROUTE_STEPS) return "";
  const rows = [];
  for (const s of route.steps) {
    if (!s || !ROUTE_KINDS.has(s.kind) || !routeText(s.text, ROUTE_TEXT) || !routeText(s.id, 400) || !(s.note === "" || s.note == null || routeText(s.note, ROUTE_NOTE))) return "";
    if (!(s.mapId === 0 || itemId(s.mapId)) || !Number.isInteger(s.level) || s.level < 1 || s.level > 100 || !Array.isArray(s.ids) || s.ids.length > 40 || !s.ids.every(itemId)) return "";
    const point = s.x != null && s.y != null;
    if (point && ![s.x, s.y].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) return "";
    const xy = point ? `${Math.round(s.x * 1000) / 1000},${Math.round(s.y * 1000) / 1000}` : "nil,nil";
    rows.push(`{"${s.kind}",${luaString(s.text)},${s.mapId},${xy},${s.level},{${s.ids.join(",")}},${luaString(s.id)}${s.note ? `,${luaString(s.note)}` : ""}}`);
  }
  return `rt={v="${route.variant}",s={${rows.join(",")}}}`;
}

// A sent settings profile as Lua, or "" for anything that is not a clean one. The code's own
// alphabet has no quote, backslash, bar or control character; anything else is refused here.
function sentProfile(send) {
  if (!send || typeof send.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,19}$/.test(send.name) || !routeText(send.from, 130)) return "";
  if (typeof send.code !== "string" || send.code.length > MAX_PROFILE_CODE || !/^BF\d+:[0-9a-f]{8}:[A-Za-z0-9_.\-%;{}]+$/.test(send.code)) return "";
  return `prof={n=${luaString(send.name)},f=${luaString(send.from)},c=${luaString(send.code)}}`;
}

// Backstage Live fields as Lua: { plan, guild, lfg }, each "" when there is nothing clean to say.
const size = (text) => Buffer.byteLength(text);
function liveFields(live) {
  const out = { plan: "", guild: "", lfg: "" };
  if (!live || typeof live !== "object") return out;
  const g = live.guild;
  if (g && typeof g.id === "string" && /^g_[A-Za-z0-9_-]{1,40}$/.test(g.id) && Array.isArray(g.events) && Array.isArray(g.signups)) {
    const event = (e) => `{${luaString(e.id)},${e.ver},${luaString(e.creator)},${luaString(e.editor)},${e.at},${luaString(e.place)},${e.t},${e.h},${e.d},${e.x},${luaString(e.title)},${luaString(e.note)}}`;
    const signup = (r) => `{${luaString(r.id)},${luaString(r.name)},"${r.s}",${r.ver},"${r.via}"}`;
    const events = g.events.slice(0, 60), signups = g.signups.slice(0, 600);
    const build = () => `guild={id=${luaString(g.id)}${g.guildName ? `,n=${luaString(g.guildName)}` : ""}${g.realm ? `,r=${luaString(g.realm)}` : ""},discord=${luaString(["none", "pending", "connected", "problem"].includes(g.discord) ? g.discord : "none")},events={${events.map(event).join(",")}},signups={${signups.filter((r) => events.some((e) => e.id === r.id)).map(signup).join(",")}}}`;
    let text = build();
    // Sign-ups go first (the events themselves matter more), then the events furthest ahead.
    while (size(text) > MAX_GUILD_BYTES && signups.length) { signups.length = Math.max(0, signups.length - 20); text = build(); }
    while (size(text) > MAX_GUILD_BYTES && events.length) { events.pop(); text = build(); }
    out.guild = size(text) <= MAX_GUILD_BYTES ? text : "";
  }
  const l = live.lfg;
  if (l && Array.isArray(l.rows)) {
    const rows = l.rows.slice(0, 40);
    const row = (r) => `{${luaString(r.id)},"${r.kind}",${luaString(r.name)},${luaString(r.realm)},${r.level},${r.cls},"${r.roles}",${luaString(r.place)},${luaString(r.note)},${r.need ? `${r.need.t},${r.need.h},${r.need.d}` : "-1,-1,-1"},${r.at}}`;
    const build = () => `lfg={${l.realm ? `r=${luaString(l.realm)},` : ""}${l.faction ? `f="${l.faction === "horde" ? "H" : "A"}",` : ""}rows={${rows.map(row).join(",")}}}`;
    let text = build();
    while (size(text) > MAX_LFG_BYTES && rows.length) { rows.pop(); text = build(); }
    // An empty board is still worth telling: the game then shows "no listings" instead of old rows.
    out.lfg = size(text) <= MAX_LFG_BYTES ? text : "";
  }
  const p = live.plan;
  if (p && Array.isArray(p.members) && p.members.length) {
    const text = `plan={p=${luaString(p.place || "")},n=${luaString(p.note || "")},t=${Number.isSafeInteger(p.at) ? p.at : 0}${p.for ? `,f=${luaString(p.for)}` : ""},m={${p.members.slice(0, 40).map((m) => `{${luaString(m.name)},"${m.role}",${luaString(m.bring || "")}}`).join(",")}}}`;
    out.plan = size(text) <= MAX_PLAN_BYTES ? text : "";
  }
  return out;
}

// The same bytes for the same input: characters sorted by key, wishes in wish-list order,
// upgrades by item id, talent picks in the order the player planned them. Talent plans are the
// newest passenger: when the file would grow past its limit they are left out, character by
// character, before anything else is touched.
function compile({ profiles = [], wishlist = () => [], upgrades = () => [], talents = () => null, loops = () => null, answers = () => [], routes = () => null, ships = () => null, reports = 0, sentProfiles = () => null, live = null } = {}) {
  const waiting = Number.isSafeInteger(reports) && reports > 0 ? Math.min(reports, 999) : 0;
  const rows = [];
  const seen = new Set();
  for (const p of Array.isArray(profiles) ? profiles : []) {
    if (p?.source?.kind !== "wow-addon" || !named(p.name) || !named(p.realm)) continue;
    const key = `${p.name}-${p.realm}`;
    if (seen.has(key)) continue;
    const list = (supplier) => { let ids = []; try { ids = supplier(p.id); } catch {} return [...new Set((Array.isArray(ids) ? ids : []).filter(itemId))]; };
    const ids = list(wishlist).slice(0, MAX_ITEMS), up = list(upgrades).sort((a, b) => a - b).slice(0, MAX_ITEMS);
    let tal = ""; try { tal = talentPlan(talents(p.id)); } catch {}
    let loop = ""; try { loop = gatheringLoop(loops(p.id)); } catch {}
    let ans = ""; try { ans = answerList(answers(p.id)); } catch {}
    let rt = ""; try { rt = routeSteps(routes(p.id)); } catch {}
    let prof = ""; try { prof = sentProfile(sentProfiles(key, p.id)); } catch {}
    if (!ids.length && !up.length && !tal && !loop && !ans && !rt && !prof) continue;
    seen.add(key);
    rows.push([key, ids, up, tal, loop, ans, rt, prof]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const kept = rows.slice(0, MAX_CHARACTERS);
  const line = ([key, ids, up, tal, loop, ans, rt, prof]) => `[${luaString(key)}]={wish={${ids.join(",")}}${up.length ? `,up={${up.join(",")}}` : ""}${tal ? `,${tal}` : ""}${loop ? `,${loop}` : ""}${rt ? `,${rt}` : ""}${ans ? `,${ans}` : ""}${prof ? `,${prof}` : ""}},`;
  // The stops are small and come first: every character's /bf fly needs them.
  const sea = shipField(Array.isArray(profiles) ? profiles : [], ships);
  let extra = { plan: "", guild: "", lfg: "" }; try { extra = liveFields(live); } catch { extra = { plan: "", guild: "", lfg: "" }; }
  const tail = () => [sea, extra.guild, extra.lfg, extra.plan].filter(Boolean).join(",");
  const wrap = (body) => [...HEADER, `BackstageForeverDesktopData={schema=1,${waiting ? `reports=${waiting},` : ""}characters={`, ...body, tail() ? `},${tail()}}` : "}}", ""].join("\n");
  // The live fields ride last: when the characters' own wishes leave no room, the board goes first,
  // then the guild, then the plan.
  { const full = extra, bare = kept.map(([key, ids, up]) => line([key, ids, up, "", "", "", "", ""]));
    for (const drop of [[], ["lfg"], ["lfg", "guild"], ["lfg", "guild", "plan"]]) {
      extra = { ...full }; for (const k of drop) extra[k] = "";
      if (Buffer.byteLength(wrap(bare)) <= MAX_BYTES) break;
    } }
  let room = MAX_BYTES - Buffer.byteLength(wrap(kept.map(([key, ids, up]) => line([key, ids, up, "", "", "", "", ""]))));
  const body = [];
  // Plans and loops of every character get room first, then route steps, then answers, then a sent profile.
  for (const fields of [[3, 4], [6], [5], [7]]) {
    for (const row of kept) {
      for (const i of fields) {
        const cost = row[i] ? Buffer.byteLength(row[i]) + 1 : 0;
        if (cost && cost <= room) room -= cost; else row[i] = "";
      }
    }
  }
  for (const row of kept) if (row[1].length || row[2].length || row[3] || row[4] || row[5] || row[6] || row[7]) body.push(line(row));
  const text = wrap(body);
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error("Desktop hand-off is too large.");
  return text;
}

module.exports = { FILE, MAX_SHIPS, MAX_SHIP_RIDES, MAX_SHIP_BYTES, MAX_ITEMS, MAX_CHARACTERS, MAX_PICKS, MAX_LOOP_STOPS, MAX_ROUTE_STEPS, MAX_ANSWERS, MAX_QUESTION, MAX_ANSWER, MAX_BYTES, MAX_PROFILE_CODE, MAX_GUILD_BYTES, MAX_LFG_BYTES, MAX_PLAN_BYTES, compile, EMPTY: compile() };
