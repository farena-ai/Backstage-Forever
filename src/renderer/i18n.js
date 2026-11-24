"use strict";
// Translations (0.53, roadmap 4.3; more languages, roadmap P1): the app follows the game's language (the addon
// saves it with each character) unless you pick one on Help → Field guide. Pages are written in English; this layer swaps
// whole text pieces and labels for the chosen language as they appear, from a reviewed dictionary
// (locales/*.js, built by scripts/build-locales.cjs). Anything without a translation stays English.
window.I18n = (() => {
  const KEY = "bf-lang-v1";
  // Every dictionary script (locales/<lang>.js) leaves BF_LOCALE_<LANG>, …_TEMPLATES and …_META on the window.
  const DICTS = {}, TEMPLATES = {}, META = {};
  const NAMES = { auto: "Same as the game", en: "English" };
  for (const k of Object.keys(window).filter((x) => /^BF_LOCALE_[A-Z]{2}$/.test(x)).sort()) {
    const code = k.slice(-2).toLowerCase(), meta = window[k + "_META"] || {};
    DICTS[code] = window[k] || {};
    // Sentences with numbers or names ("Hand in {0} finished quests"): [pattern, translation, placeholder order].
    TEMPLATES[code] = (window[k + "_TEMPLATES"] || []).map(([src, to, order]) => [new RegExp(src), to, order]);
    META[code] = { name: meta.name || code, machineTranslated: meta.machineTranslated !== false, machineNote: meta.machineNote || "machine-translated", gameLocales: Array.isArray(meta.gameLocales) ? meta.gameLocales : [] };
    // Each language under its own name; a machine translation says so in its own words.
    NAMES[code] = META[code].name + (META[code].machineTranslated ? ` (${META[code].machineNote})` : "");
  }
  let lang = "en", gameLang = null, observer = null;
  const pref = () => { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } };
  /** Pure: the language to show for a preference and the game's locale code (e.g. "deDE"). */
  function resolve(p, gameLocale) {
    const code = typeof gameLocale === "string" ? gameLocale : "";
    const fromGame = Object.keys(META).find((l) => META[l].gameLocales.includes(code)) || (DICTS[code.slice(0, 2).toLowerCase()] ? code.slice(0, 2).toLowerCase() : "en");
    const want = p === "auto" ? fromGame : p;
    return want !== "en" && DICTS[want] && Object.keys(DICTS[want]).length ? want : "en";
  }
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  function tr(s) {
    const d = DICTS[lang]; if (!d || typeof s !== "string") return null;
    const key = norm(s), v = d[key];
    if (typeof v === "string") return v;
    for (const [re, to, order] of TEMPLATES[lang] || []) {
      const m = re.exec(key); if (!m) continue;
      const parts = {}; order.forEach((n, i) => { const x = m[i + 1]; parts[n] = typeof d[x] === "string" ? d[x] : x; });
      return to.replace(/\{#?(\d+)\}/g, (_, n) => parts[n] ?? ""); // a translation may write {0} or {#0}
    }
    return null;
  }
  // One date format for the whole app (B6), in the shown language. value: a Date or milliseconds.
  // kind: "date" 24 Nov 2026 · "day" 24 Nov · "time" 14:05 · "dateTime" (default) · "weekday" Tue, 24 Nov, 14:05
  // · "longDay" Tuesday, 24 November 2026 · "month" November 2026. An unreadable value gives "".
  const WHEN = {
    date: { day: "numeric", month: "short", year: "numeric" }, day: { day: "numeric", month: "short" }, time: { hour: "2-digit", minute: "2-digit" },
    dateTime: { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }, weekday: { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
    longDay: { weekday: "long", day: "numeric", month: "long", year: "numeric" }, month: { month: "long", year: "numeric" },
  };
  function when(value, kind = "dateTime") {
    const d = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(d.getTime())) return "";
    // English is written day first ("24 Nov 2026"), like the dates in the app's own sentences (story.cjs, challenge-runs.cjs).
    try { return d.toLocaleString(lang === "en" ? "en-GB" : lang, WHEN[kind] || WHEN.dateTime); } catch { return d.toLocaleString(); }
  }
  const SKIP = "[data-no-translate], script, style, textarea, code, pre, input, select option[data-keep]";
  function walk(n) {
    if (!n) return;
    if (n.nodeType === 3) {
      const t = n.nodeValue;
      if (!t || !t.trim() || n.parentElement?.closest?.(SKIP)) return;
      const v = tr(t);
      if (v && v !== norm(t)) n.nodeValue = (t.match(/^\s*/)[0]) + v + (t.match(/\s*$/)[0]);
      return;
    }
    if (n.nodeType !== 1 || n.matches?.(SKIP)) return;
    for (const a of ["title", "aria-label", "placeholder"]) { const v = n.getAttribute?.(a); const x = v && tr(v); if (x) n.setAttribute(a, x); }
    for (const c of n.childNodes) walk(c);
  }
  function apply(root = document.body) {
    lang = resolve(pref(), gameLang);
    document.documentElement.lang = lang;
    document.documentElement.dataset.machineTranslated = lang !== "en" && META[lang]?.machineTranslated !== false ? "true" : "false";
    // The menu's small "machine-translated" mark, in the shown language (styles.css reads the variable).
    document.documentElement.style?.setProperty?.("--bf-machine-note", JSON.stringify(" · " + (META[lang]?.machineNote || "machine-translated")));
    if (lang !== "en") walk(root);
  }
  function watch() {
    if (observer || typeof MutationObserver !== "function") return;
    observer = new MutationObserver((list) => {
      if (lang === "en") return;
      for (const m of list) { if (m.type === "characterData") walk(m.target); else for (const n of m.addedNodes) walk(n); }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  /** Called by the app with the active character's game locale; re-applies only when it changes. */
  function setGameLocale(locale) {
    const next = typeof locale === "string" ? locale : null;
    if (next === gameLang) return;
    gameLang = next;
    const before = lang; apply();
    if (before !== lang && before !== "en") location.reload(); // back to English needs the original text
  }
  function choose(p) { try { localStorage.setItem(KEY, Object.hasOwn(NAMES, p) ? p : "auto"); } catch {} location.reload(); }
  function control() {
    const p = pref();
    return `<label class="bf-lang" data-no-translate>Language <select data-lang-choice>${Object.entries(NAMES).map(([k, v]) => `<option value="${k}"${k === p ? " selected" : ""}>${v}</option>`).join("")}</select></label>`;
  }
  document.addEventListener("change", (e) => { if (e.target.matches?.("[data-lang-choice]")) choose(e.target.value); });
  const start = () => { apply(); watch(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  return { resolve, tr, when, apply, setGameLocale, control, choose, get lang() { return lang; }, NAMES, META };
})();
