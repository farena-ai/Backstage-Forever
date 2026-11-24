"use strict";
// IPC for route variants (Q8) and the route editor with its share code (Q9). The routes are
// built from the bundled data on this computer; a character's choice and edits live in
// route-edits.json in the app's data folder. Nothing is sent anywhere: a code leaves only when
// the player copies or saves it.
const G = require("./guided-route.cjs");
const V = require("./route-variants.cjs");
const E = require("./route-editor.cjs");
const PAGE = 25;
const say = (message) => Object.assign(new Error(message), { name: "JourneyError" });
const plainly = (work) => { try { return work(); } catch (e) { throw say(e.message); } };

function registerRouteEditor({ handle, getState, edits, getPack, getZones, getReviews = () => null, getCreatures = () => [], getBaseline = () => [], mapNames = {},
  dialog = null, getWindow = () => null, copyText = () => {}, onChange = () => {},
  readFile = (file) => require("node:fs").readFileSync(file), statFile = (file) => require("node:fs").statSync(file), writeFile = (file, text) => require("node:fs/promises").writeFile(file, text, "utf8") }) {
  let cache = new Map(), facts = null;
  const data = () => {
    if (facts) return facts;
    const pack = getPack(), dungeons = V.dungeonList(getBaseline());
    return (facts = { pack, dungeons, flags: V.questFlags(pack, getCreatures(), dungeons) });
  };
  /** Every race's route for one variant, hand review applied (review entries fit where the step exists). */
  const built = (variant) => {
    const id = V.variantId(variant);
    if (!cache.has(id)) { const f = data(); cache.set(id, G.buildGuidedRoutes({ pack: f.pack, zones: getZones(), reviews: getReviews(), tune: V.tuneFor(id, f) })); }
    return cache.get(id);
  };
  const invalidate = () => { cache = new Map(); facts = null; };
  const raceOf = (p) => (p?.race ? (G.ALIASES[p.race.replace(/\s/g, "")] || G.ALIASES[p.race] || p.race) : null);
  const profile = (id) => { const s = getState(); const p = s.profiles.find((x) => x.id === s.activeProfileId) || null; return p && p.id === id ? p : null; };
  const generated = (p, variant) => built(variant).routes.find((r) => r.key === raceOf(p)) || null;
  /** What the desktop and the hand-off use: { variant, generated, route (edited), overlay }. */
  function routeFor(p) {
    if (!p) return { variant: "solo", generated: null, route: null, overlay: E.empty() };
    const overlay = edits.get(p.id), gen = generated(p, overlay.variant);
    return { variant: overlay.variant, generated: gen, route: gen ? E.applyOverlay(gen, overlay) : null, overlay };
  }
  const stateOf = (p) => ({ completed: p.history?.completedIdsKnown === true ? p.history.completedIds || [] : [], inLog: (p.quests || []).map((q) => q.id), complete: (p.quests || []).filter((q) => q.complete).map((q) => q.id),
    level: Number.isInteger(p.level) ? p.level : 1, mapId: p.location?.mapId ?? null });
  /** The next steps for the game, or null when the addon's own route already says the same. */
  function handoff(profileId) {
    const p = getState().profiles.find((x) => x.id === profileId);
    if (!p || p.source?.kind !== "wow-addon") return null;
    const r = routeFor(p);
    if (!r.route) return null;
    const e = r.route.edits;
    if (r.variant === "solo" && !(e.notes || e.skipped || e.moved || e.custom)) return null;
    const pos = G.position(r.route, stateOf(p));
    if (pos.ended) return null;
    const steps = E.handoffSteps(r.route, pos.index);
    return steps.length ? { variant: r.variant, steps } : null;
  }

  function view(p, pageNo = null, note = "") {
    if (!p) return { profileId: null, variants: V.VARIANTS, variant: "solo", route: null, note };
    const overlay = edits.get(p.id), race = raceOf(p), f = data();
    const variants = V.VARIANTS.map((v) => { const r = built(v.id).routes.find((x) => x.key === race) || null; return { ...v, numbers: r ? V.summary(r, f.flags) : null }; });
    const gen = generated(p, overlay.variant);
    if (!gen) return { profileId: p.id, variants, variant: overlay.variant, route: null, note };
    const shown = E.applyOverlay(gen, overlay, { keepSkipped: true }), live = E.applyOverlay(gen, overlay);
    const pos = G.position(live, stateOf(p)), here = pos.ended ? null : live.steps[pos.index]?.id ?? null;
    const at = here ? Math.max(0, shown.steps.findIndex((s) => s.id === here)) : 0;
    const pages = Math.max(1, Math.ceil(shown.steps.length / PAGE)), page = Math.min(pages - 1, Math.max(0, Number.isSafeInteger(pageNo) ? pageNo : Math.floor(at / PAGE)));
    let code = null, codeError = "";
    try { code = E.exportCode(overlay, race); } catch (e) { codeError = e.message; }
    const sent = handoff(p.id);
    return { profileId: p.id, variants, variant: overlay.variant, note,
      route: { race, total: shown.steps.length, page, pages, here, hereNumber: here ? at + 1 : null, edits: shown.edits, canShare: Boolean(code), shareError: codeError,
        inGame: sent ? sent.steps.length : 0, limits: { note: E.LIMITS.note, customText: E.LIMITS.customText },
        zones: [...new Map(getZones().filter((z) => z.faction === gen.faction || z.faction === "Contested").map((z) => [z.mapId, mapNames[z.mapId] || `Map ${z.mapId}`])).entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([mapId, name]) => ({ mapId, name })),
        steps: shown.steps.slice(page * PAGE, page * PAGE + PAGE).map((s, i) => ({ n: page * PAGE + i + 1, id: s.id, kind: s.kind, text: s.text, level: s.level, mapName: mapNames[s.mapId] || null,
          x: Number.isFinite(s.x) ? s.x : null, y: Number.isFinite(s.y) ? s.y : null, note: s.note || "", skipped: Boolean(s.skipped), custom: Boolean(s.custom) })) } };
  }
  const input = (args, what) => {
    const [i] = args;
    if (args.length !== 1 || !i || typeof i !== "object" || Array.isArray(i) || typeof i.profileId !== "string") throw Error(`Invalid ${what} request.`);
    const p = profile(i.profileId);
    if (!p) throw say("Choose this character again first.");
    return [i, p];
  };
  handle("routeEditor", (...args) => {
    const [i] = args;
    if (args.length !== 1 || !i || typeof i !== "object" || (i.profileId !== null && typeof i.profileId !== "string") || !(i.page === null || (Number.isSafeInteger(i.page) && i.page >= 0))) throw Error("Invalid route request.");
    return view(i.profileId === null ? null : profile(i.profileId), i.page);
  });
  handle("routeEdit", (...args) => {
    const [i, p] = input(args, "route edit");
    if (!i.action || typeof i.action !== "object" || Array.isArray(i.action) || JSON.stringify(i.action).length > 2000) throw Error("Invalid route edit.");
    const before = edits.get(p.id);
    const next = plainly(() => E.edit(before, i.action, generated(p, before.variant)));
    plainly(() => edits.set(p.id, next));
    onChange();
    return view(p, Number.isSafeInteger(i.page) && i.page >= 0 ? i.page : null);
  }, { privateOnly: true });
  const codeOf = (p) => plainly(() => E.exportCode(edits.get(p.id), raceOf(p)));
  handle("copyRouteCode", async (...args) => { const [, p] = input(args, "route code"); await copyText(codeOf(p)); return true; }, { privateOnly: true });
  handle("saveRouteCode", async (...args) => {
    const [, p] = input(args, "route code");
    const code = codeOf(p);
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save your route edits", defaultPath: "Backstage-Forever-route.txt", filters: [{ name: "Text file", extensions: ["txt"] }] });
    if (result.canceled || !result.filePath) return { saved: false };
    await writeFile(result.filePath, `${code}\n`);
    return { saved: true };
  }, { privateOnly: true });
  const knows = () => { const f = data(); return { quest: (id) => Boolean(f.pack.quests?.[id]), map: (id) => Boolean(mapNames[id]), dungeon: (key) => f.dungeons.some((d) => d.key === key) }; };
  function take(p, code) {
    const got = E.importCode(code, knows());
    if (!got) throw say("That is not a route code this app can read. Nothing was changed.");
    edits.set(p.id, got.overlay);
    onChange();
    const v = view(p, null);
    const e = v.route?.edits, fits = e ? e.notes + e.skipped + e.moved + e.custom : 0;
    return { ...v, note: `Imported a ${V.VARIANTS.find((x) => x.id === got.overlay.variant).name} route made for the ${got.race} start. ${fits} edit${fits === 1 ? "" : "s"} fit your route${e?.lost ? `; ${e.lost} wait for steps your route does not have` : ""}. It replaced your earlier edits.` };
  }
  handle("importRouteCode", (...args) => {
    const [i, p] = input(args, "route code");
    if (typeof i.code !== "string" || i.code.length > E.LIMITS.code + 200) throw say("That is not a route code this app can read. Nothing was changed.");
    return take(p, i.code);
  }, { privateOnly: true });
  handle("openRouteCode", async (...args) => {
    const [, p] = input(args, "route code");
    const result = await dialog.showOpenDialog(getWindow(), { title: "Open a route code", properties: ["openFile"], filters: [{ name: "Text file", extensions: ["txt"] }] });
    const file = result.canceled ? null : result.filePaths?.[0];
    if (!file) return null;
    if (statFile(file).size > E.LIMITS.code + 200) throw say("That file is too large to be a route code.");
    return take(p, String(readFile(file)));
  }, { privateOnly: true });
  return { routeFor, handoff, invalidate, view };
}
module.exports = { registerRouteEditor, PAGE };
