"use strict";
// The base button style gives light text a black drop shadow (enchanted.css). A control that
// switches to dark text on a light background must drop that shadow, or its words look fuzzy
// (owner report, 2026-11-22: the skill-up colour chips on Professions).
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const dir = path.join(__dirname, "../src/renderer");
const CONTROL = /button|\.skill-chip|\.party-role|\.bf-go|\.quest-link|\.now-link|\.rail-link|\.cov-toggle|\.gr-acts|summary|\.chip\b|-chip\b|\.tab\b|-tab\b/;

function luminance(hex) {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("a control with dark text never keeps the black text shadow", () => {
  const offenders = [];
  let checked = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const css = fs.readFileSync(path.join(dir, file), "utf8");
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const color = /(?:^|;|\s)color\s*:\s*(#[0-9a-fA-F]{3,8})\b/.exec(body);
      if (!color || selector.trim().startsWith("@") || !CONTROL.test(selector) || luminance(color[1]) >= 0.2) continue;
      checked++;
      if (!/text-shadow\s*:/.test(body)) offenders.push(`${file}: ${selector.replace(/\s+/g, " ").trim().slice(0, 90)}`);
    }
  }
  assert.ok(checked >= 20, `rules checked: ${checked}`);
  assert.deepEqual(offenders, [], "add text-shadow: none (or a deliberate light shadow) to these rules");
});

test("the skill-up chips on Professions are dark text with no shadow", () => {
  const css = fs.readFileSync(path.join(dir, "preparation.css"), "utf8");
  assert.match(css, /\.workshop \.skill-chip \{[^}]*color: #2b1b0a;[^}]*text-shadow: none;/);
});
