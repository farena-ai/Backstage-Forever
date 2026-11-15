"use strict";
// Translations (0.53, roadmap 4.3): the app follows the game's language (the addon saves it with each
// character) unless you pick one on Help → Field guide. Pages are written in English; this layer swaps
// whole text pieces and labels for the chosen language as they appear, from a reviewed dictionary
// (locales/*.js, built by scripts/build-locales.cjs). Anything without a translation stays English.
window.I18n = (() => {
  const KEY = "bf-lang-v1";
  const DICTS = { de: window.BF_LOCALE_DE || {} };
  const NAMES = { auto: "Same as the game", en: "English", de: "Deutsch (machine-translated)" };
  let lang = "en", gameLang = null, observer = null;
  const pref = () => { try { return localStorage.getItem(KEY) || "auto"; } catch { return "auto"; } };
  /** Pure: the language to show for a preference and the game's locale code (e.g. "deDE"). */
  function resolve(p, gameLocale) {
    const fromGame = /^de/i.test(gameLocale || "") ? "de" : "en";
    const want = p === "auto" ? fromGame : p;
    return want !== "en" && DICTS[want] && Object.keys(DICTS[want]).length ? want : "en";
  }
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  function tr(s) { const d = DICTS[lang]; if (!d || typeof s !== "string") return null; const v = d[norm(s)]; return typeof v === "string" ? v : null; }
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
    document.documentElement.dataset.machineTranslated = lang !== "en" ? "true" : "false";
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
  return { resolve, tr, apply, setGameLocale, control, choose, get lang() { return lang; }, NAMES };
})();
