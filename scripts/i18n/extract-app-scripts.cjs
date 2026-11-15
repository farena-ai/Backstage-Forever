// Second pass: script strings the template scan misses (banner titles, subtitles, eyebrows, labels).
const fs = require("fs"), path = require("path");
const [dir, listFile] = process.argv.slice(2);
const list = JSON.parse(fs.readFileSync(listFile, "utf8"));
const have = new Set(list.map((x) => x.en));
let n = 0;
function add(t, f) {
  t = t.trim();
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t) || /^[a-z0-9_-]+$/.test(t) || /[{}<>=;]/.test(t) || have.has(t)) return;
  have.add(t); list.push({ en: t, files: [f] }); n++;
}
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js") && !x.startsWith("_") && !["commands.js", "i18n.js"].includes(x))) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  for (const m of s.matchAll(/\b(?:title|subtitle|eyebrow|label|heading|empty|hint)\s*:\s*"([^"$\\]{2,200})"/g)) { add(m[1], f); if (m[1].includes(" · ")) for (const p of m[1].split(" · ")) add(p, f); }
  for (const m of s.matchAll(/\b[a-z]+\s*:\s*"([A-Z][a-z]+(?: [a-z]+){0,3})"/g)) add(m[1], f);
}
fs.writeFileSync(listFile, JSON.stringify(list, null, 1));
console.log("added", n);
