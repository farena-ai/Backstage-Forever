// Collect the addon's player-facing English text: literal say('...') messages, ('...'):format(...)
// templates passed to say, the /bf help lines, and toast titles/subs given as literals.
const fs = require("fs"), path = require("path");
const [dir, out] = process.argv.slice(2);
const plain = new Map(), templates = new Map();
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, "\n");
const ok = (t) => t.length >= 3 && /[A-Za-z]{3}/.test(t) && !/^[A-Za-z_]+$/.test(t);
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".lua") && x !== "BackstageForeverFind.lua" && x !== "BackstageForeverGuideData.lua" && x !== "BackstageForeverReference.lua" && x !== "BackstageForeverAdvisorData.lua" && x !== "BackstageForeverLocale.lua")) {
  const s = fs.readFileSync(path.join(dir, f), "utf8");
  // say('literal') / say("literal")
  for (const m of s.matchAll(/\bsay\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)) { const t = unq(m[1]); if (ok(t)) plain.set(t, f); }
  for (const m of s.matchAll(/\bsay\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) { const t = unq(m[1]); if (ok(t)) plain.set(t, f); }
  // say(('template'):format(...))
  for (const m of s.matchAll(/\(\s*'((?:[^'\\]|\\.)*%[sd.0-9]*[sdf](?:[^'\\]|\\.)*)'\s*\)\s*:format\(/g)) { const t = unq(m[1]); if (ok(t)) templates.set(t, f); }
  // literal first pieces of say('text '..x): the literal head becomes a "starts with" template
  for (const m of s.matchAll(/\bsay\(\s*'((?:[^'\\]|\\.){6,})'\s*\.\./g)) { const t = unq(m[1]); if (ok(t)) templates.set(t + "%s", f); }
  // toasts
  for (const m of s.matchAll(/BackstageForeverToast,?\s*\(?\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) { for (const t of [unq(m[1]), unq(m[2])]) if (ok(t)) plain.set(t, f); }
}
// /bf help lines (Assist)
const assist = fs.readFileSync(path.join(dir, "BackstageForeverAssist.lua"), "utf8");
const help = assist.slice(assist.indexOf("local HELP_TOPICS={"), assist.indexOf("function BackstageForeverAssistCommand(message)"));
for (const m of help.matchAll(/'((?:[^'\\]|\\.)*)'/g)) { const t = unq(m[1]); if (ok(t)) plain.set(t, "help"); }
const list = { plain: [...plain.keys()].sort(), templates: [...templates.keys()].sort() };
fs.writeFileSync(out, JSON.stringify(list, null, 1));
console.log("plain", list.plain.length, "templates", list.templates.length);
