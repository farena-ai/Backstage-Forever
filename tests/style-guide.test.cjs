"use strict";
// G12 (0.54): the measurable rules of docs/STYLE-GUIDE.md, checked over every renderer stylesheet.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const dir = path.join(__dirname, "../src/renderer");
const sheets = fs.readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")]);
const rules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
const lum = (h) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const hex = (v) => { const m = v?.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i); if (!m) return null; return (m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]).toLowerCase(); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("dark-room readability: no text under 11px (except the lettering inside a painted seal)", () => {
  const bad = [];
  for (const [f, css] of sheets) for (const { sel, body } of rules(css)) {
    if (/\.atlas-seal span/.test(sel)) continue;
    for (const m of body.matchAll(/(?:font-size:\s*|font:\s*(?:italic\s+)?(?:\d{3}\s+|bold\s+)?)(\d+(?:\.\d+)?)px/g)) if (Number(m[1]) < 11) bad.push(`${f} ${sel.slice(0, 60)} ${m[1]}px`);
  }
  assert.deepEqual(bad, []);
});

test("text on a solid background meets WCAG AA (4.5:1)", () => {
  const bad = [];
  for (const [f, css] of sheets) for (const { sel, body } of rules(css)) {
    const fg = hex(body.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1]);
    const bgRaw = body.match(/background(?:-color)?:\s*([^;]+)/)?.[1];
    if (!fg || !bgRaw || /gradient|url|rgba|transparent|var\(/.test(bgRaw)) continue;
    const bg = hex(bgRaw);
    if (bg && ratio(fg, bg) < 4.5) bad.push(`${f} ${sel.slice(0, 60)} #${fg} on #${bg} ${ratio(fg, bg).toFixed(2)}`);
  }
  assert.deepEqual(bad, []);
});

test("the old low-contrast chip colours are gone, and the style guide documents the rules", () => {
  const old = ["#3f86d8", "#4e8f3a", "#e8702e", "#d9822a", "#8a8378", "#d9442e", "#3f8f2e", "#cc7357"];
  for (const [f, css] of sheets) for (const c of old) assert.ok(!css.toLowerCase().includes(c), `${f} still uses ${c}`);
  const guide = fs.readFileSync(path.join(__dirname, "../docs/STYLE-GUIDE.md"), "utf8");
  for (const word of ["Dark-room minimum: 11px", "WCAG AA, 4.5:1", "prefers-reduced-motion", "Never rely on colour alone", "Show Frank samples"]) assert.ok(guide.includes(word), word);
});
