// Translate English UI strings to German with the local Ollama model (no cloud). Resumable cache.
// node i18n-translate.cjs <app.json> <addon.json> <cache.json>
const fs = require("fs");
const [appFile, addonFile, cacheFile] = process.argv.slice(2);
const MODEL = "qwen3.8:27b-mtp-q4_K_M";
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const junk = (t) => /['"]\s*[+:,)]|[+]\s*['"]|\(\w|\|\||\.replace|escape\(|\bwindow\.|=>|^[',.:;)\]]+\s*$|^\W{0,2}$/.test(t) || /^[',]/.test(t) && /[+(]/.test(t);
const app = JSON.parse(fs.readFileSync(appFile, "utf8")).map((x) => x.en).filter((t) => !junk(t));
const addon = JSON.parse(fs.readFileSync(addonFile, "utf8"));
const all = [...new Set([...app, ...addon.plain, ...addon.templates])].filter((t) => !(t in cache));
console.log("to translate", all.length, "cached", Object.keys(cache).length);
const GLOSSARY = `Keep exactly: Backstage Forever, WoW, World of Warcraft: Forever, Horde, Alliance (as Horde/Allianz), every /bf command and its words (e.g. /bf route guide), placeholders like %s %d %.1f %02d %1, colour codes like |cff6a4a20 and |r, HTML entities, emoji and symbols (✓ ✗ ↑ ↓ ↺ ★ ◆ · → – …).
Use the German WoW client's terms: quest = Quest, quest giver = Questgeber, hand in = abgeben, pick up (a quest) = annehmen, objective = Ziel, level = Stufe, experience/XP = Erfahrung/EP, rested = ausgeruht, flight master = Flugmeister, flight path = Flugroute, trainer = Lehrer, class trainer = Klassenlehrer, Hearthstone = Ruhestein, inn = Gasthaus, vendor = Händler, repair = reparieren, bags = Taschen, bank = Bank, gold = Gold, dungeon = Dungeon, raid = Schlachtzug, elite = Elite, rare = selten, talent = Talent, profession = Beruf, herb = Kraut, ore = Erz, mount = Reittier, party = Gruppe, minimap = Minikarte, world map = Weltkarte, zone = Gebiet, the companion = der Begleiter.
App page names: Now = Jetzt, Adventure = Abenteuer, Characters = Charaktere, Ledger = Kontobuch, Plans = Pläne, Settings = Einstellungen, Help = Hilfe, Journey = Reise, Sheet = Charakterbogen, Zones = Gebiete, Guided route = Geführte Route, Commands = Befehle, Field guide = Leitfaden, World Map = Weltkarte, Mini Now = Mini-Jetzt.
Style: friendly, short, plain German (du-Form), like a game guide. Keep leading/trailing spaces and punctuation as in the source.`;
async function batch(items) {
  const prompt = `Translate each English UI string to German for a World of Warcraft companion app.\n${GLOSSARY}\nAnswer with JSON only: an object whose keys are the exact English strings and whose values are the German translations.\n\n${JSON.stringify(items)}`;
  const r = await fetch("http://127.0.0.1:11434/api/chat", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, stream: false, think: false, format: "json", options: { temperature: 0.1, num_ctx: 16384 }, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json();
  return JSON.parse(j.message?.content || "{}");
}
const placeholders = (s) => (s.match(/%[0-9.]*[sdf]|%\d|\|c[0-9a-f]{8}|\|r|\/bf [a-z]+/gi) || []).sort().join(" ");
(async () => {
  for (let i = 0; i < all.length; i += 30) {
    const items = all.slice(i, i + 30);
    let out = {};
    for (let attempt = 0; attempt < 2 && !Object.keys(out).length; attempt++) { try { out = await batch(items); } catch (e) { console.error("batch error", e.message); } }
    let kept = 0;
    for (const en of items) {
      const de = out[en];
      if (typeof de === "string" && de.trim() && placeholders(de) === placeholders(en)) { cache[en] = de; kept++; }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1));
    console.log(`${Math.min(i + 30, all.length)}/${all.length} kept ${kept}`);
  }
  console.log("done", Object.keys(cache).length);
})();
