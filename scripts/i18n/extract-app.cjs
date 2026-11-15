// Collect static English UI text from renderer templates: text between tags and title/aria-label/
// placeholder values with no ${...} inside, plus navigation labels. Writes a JSON list.
const fs = require("fs"), path = require("path");
const [dir, out] = process.argv.slice(2);
const skip = new Set(["commands.js"]); // the command catalogue is long reference text: a later pass
const strings = new Map();
const add = (t, file) => {
  t = t.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 220 || !/[A-Za-z]{2}/.test(t) || /[{}$<>=;]|=>|\bfunction\b|\.js\b|\bconst\b/.test(t)) return;
  if (/^[a-z0-9_-]+$/.test(t)) return; // class names, ids
  if (!strings.has(t)) strings.set(t, new Set());
  strings.get(t).add(file);
};
for (const f of fs.readdirSync(dir).filter((x) => /\.(js|html)$/.test(x) && !x.startsWith("_") && !skip.has(x))) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of s.matchAll(/>([^<>`]{2,220})</g)) if (!m[1].includes("${")) add(m[1], f);
  // text that starts right after a tag and runs into an interpolation: "Level ${x}" is skipped; whole static pieces only.
  for (const m of s.matchAll(/\b(?:title|aria-label|placeholder)="([^"$]{2,200})"/g)) add(m[1], f);
}
const nav = fs.readFileSync(path.join(dir, "player-navigation.js"), "utf8");
for (const m of nav.matchAll(/\["[a-z-]+",\s*"([^"]+)"\]/g)) add(m[1], "player-navigation.js");
for (const m of nav.matchAll(/label:\s*"([^"]+)"/g)) add(m[1], "player-navigation.js");
for (const m of nav.matchAll(/description:\s*\n?\s*"([^"]+)"/g)) add(m[1], "player-navigation.js");
const list = [...strings.entries()].map(([t, files]) => ({ en: t, files: [...files] })).sort((a, b) => a.en.localeCompare(b.en));
fs.writeFileSync(out, JSON.stringify(list, null, 1));
console.log("strings", list.length, "chars", list.reduce((n, x) => n + x.en.length, 0));
