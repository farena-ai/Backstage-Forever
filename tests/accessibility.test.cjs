"use strict";
// 4.3 accessibility (0.52): a static audit of every renderer page and window, contrast of the main
// text colours, keyboard focus, reduced motion, high-contrast mode and the map's keyboard controls.
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const dir = path.join(__dirname, "../src/renderer"), read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const files = fs.readdirSync(dir).filter((f) => /\.(js|html)$/.test(f) && !f.startsWith("_"));

test("every image has alt text, every button a name, every field a label", () => {
  const bad = [];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) bad.push(`${f} image: ${m[0].slice(0, 80)}`);
    for (const m of s.matchAll(/<button\b([^>]*)>([\s\S]{0,300}?)<\/button>/g)) {
      if (/aria-label=|aria-labelledby=|title=/.test(m[1])) continue;
      const text = m[2].replace(/<[^>]*>/g, "").replace(/\$\{[^}]*\}/g, "X").trim();
      if (!text || /^[\s×✕+\-－＋◉◎⤢▶🖼←→‹›<>…·✓✗↑↓↺]+$/u.test(text)) bad.push(`${f} button: ${m[0].slice(0, 80)}`);
    }
    for (const m of s.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
      if (/type="?hidden/.test(m[2]) || /aria-label=|aria-labelledby=/.test(m[2])) continue;
      const before = s.slice(Math.max(0, m.index - 200), m.index), id = m[2].match(/\bid="([^"$]+)"/)?.[1];
      if (before.lastIndexOf("<label") > before.lastIndexOf("</label>") || (id && s.includes(`for="${id}"`))) continue;
      bad.push(`${f} field: <${m[1]}${m[2].slice(0, 60)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every window has a language, a title and a live region where answers or steps change", () => {
  for (const f of files.filter((x) => x.endsWith(".html"))) {
    const s = read(f);
    assert.match(s, /<html lang="en">/, f); assert.match(s, /<title>[^<]+<\/title>/, f);
  }
  assert.match(read("ask-panel.html"), /aria-live="polite"/);
  assert.match(read("mini-now.html"), /aria-live="polite"/);
  assert.match(read("index.html"), /id="toast" role="status" aria-live="polite"/);
});

const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test("text colours meet WCAG AA (4.5:1) on their backgrounds", () => {
  const PARCH = "#dcc797", DARK = "#140c05", BG = "#0d161e";
  const pairs = [["#edf0e8", BG], ["#a6b8bd", BG], ["#2b1b0a", PARCH], ["#5a3e1c", PARCH], ["#6b4e26", PARCH], ["#664808", PARCH], ["#5e4a30", PARCH], ["#2b5e1f", PARCH], ["#dcc79a", DARK], ["#a8916a", DARK], ["#c9a45a", DARK], ["#f4cf72", "#3d220c"], ["#6a4a20", "#e9d5a3"]];
  for (const [fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg}: ${ratio(fg, bg).toFixed(2)}`);
  for (const f of ["alts.css", "guided-route.css", "onboarding.css", "world-tracker.css"]) assert.doesNotMatch(read(f), /#8a6410/i, `${f} uses the old low-contrast gold for text`);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../addon/BackstageForever/BackstageForeverRoute.lua"), "utf8"), /cff7a5a30/);
});

test("keyboard focus always shows; motion stops on request; high-contrast mode keeps controls visible", () => {
  const css = read("styles.css");
  assert.match(css, /:where\(button, a, input, select, textarea, summary, \[tabindex\]\):focus-visible \{ outline: 2px solid #f4cf72 !important;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \*, \*::before, \*::after \{ animation-duration: \.01ms !important;/);
  assert.match(css, /@media \(forced-colors: active\)/);
});

test("the World Map works from the keyboard and says so; item cards name the quality in words", () => {
  const wm = read("world-map.js");
  assert.match(wm, /canvas\.addEventListener\("keydown"/); assert.match(wm, /ArrowLeft: \[-step, 0\]/); assert.match(wm, /aria-describedby="wm-keys"/);
  assert.match(read("hover-cards.js"), /QUALITY\.includes\(q\) \? q\[0\]\.toUpperCase\(\) \+ q\.slice\(1\)/);
});
