// Assemble data/i18n/de.json from the translation cache, with hand corrections from the spot check.
// node i18n-assemble.cjs <app.json> <addon.json> <cache.json> <out de.json>
const fs = require("fs");
const [appFile, addonFile, cacheFile, outFile] = process.argv.slice(2);
const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
const app = JSON.parse(fs.readFileSync(appFile, "utf8")).map((x) => x.en), addon = JSON.parse(fs.readFileSync(addonFile, "utf8"));
// Whole-word corrections for recurring machine mistakes (applied to every value).
const FIX = [
  [/\bScrollrad\b/g, "Schriftrolle"], [/\bdas Schriftrolle\b/g, "die Schriftrolle"], [/\bDas Schriftrolle\b/g, "Die Schriftrolle"],
  [/\bLevel\b/g, "Stufe"], [/\bLevels\b/g, "Stufen"],
  [/\bAutosaves\b/g, "Automatische Sicherungen"],
  [/\bKlassentrainer\b/g, "Klassenlehrer"], [/\bBerufstrainer\b/g, "Berufslehrer"], [/\bTrainern\b/g, "Lehrern"], [/\bTrainers\b/g, "Lehrers"], [/\bTrainer\b/g, "Lehrer"],
  [/Gegenstandsniveau/g, "Gegenstandsstufe"], [/durchschnittliches Gegenstandsstufe/g, "durchschnittliche Gegenstandsstufe"],
];
// Exact replacements after review (English source -> German).
const EXACT = {
  ", the top.": ", die höchste Stufe.",
  "No XP · safe to drop": "Keine EP · kann abgebrochen werden",
  "saved carried": "gespeichert, dabei",
};
const isCommandOnly = (s) => /^\/(bf|reload)\b[\w\s|.\-]*$/.test(s.trim());
const fix = (en, de) => { if (EXACT[en]) return EXACT[en]; if (isCommandOnly(en)) return en; let v = de; for (const [a, b] of FIX) v = v.replace(a, b); return v; };
const pick = (list) => Object.fromEntries(list.filter((en) => typeof cache[en] === "string").map((en) => [en, fix(en, cache[en])]).filter(([en, de]) => de !== en));
const out = { version: 1, name: "Deutsch", machineNote: "maschinell übersetzt", machineTranslated: true, note: "German, machine-translated with the local model qwen3.8:27b and spot-checked; fixes welcome. Keys are the exact English text.", app: pick(app), addon: { plain: pick(addon.plain), templates: pick(addon.templates) } };
fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
console.log("app", Object.keys(out.app).length, "addon plain", Object.keys(out.addon.plain).length, "templates", Object.keys(out.addon.templates).length);
