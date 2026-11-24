"use strict";
// HTML building blocks for the admin area. Everything that reaches a page
// goes through esc() or text(); there is no way to emit a raw player string.
// Pages carry no inline script and no inline style (the CSP forbids both).

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };
// Characters that could hide or reorder what an admin reads: control
// characters, direction marks and overrides, zero-width space, separators.
// (Zero-width joiners stay: emoji and several scripts need them.)
const UNSAFE = /[&<>"'`]|[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200e\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff\ufff9-\ufffb]/g;
function code(c) { return `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`; }

// For any text or attribute: escaped, hidden characters written out as "[U+202E]".
function esc(value) { return String(value ?? "").replace(UNSAFE, (c) => ESC[c] || `[${code(c)}]`); }

// For the value of a form control only (input value, textarea, option): the
// text must come back unchanged when the form is saved, so hidden characters
// are kept, as numeric references. Inside a control they cannot disguise the page.
function val(value) { return String(value ?? "").replace(UNSAFE, (c) => ESC[c] || `&#x${c.codePointAt(0).toString(16)};`); }

// Marks a string as already-safe HTML so helpers can nest.
class Safe { constructor(html) { this.html = html; } toString() { return this.html; } }
function raw(html) { return new Safe(html); }
function h(value) { return value instanceof Safe ? value.html : esc(value); }

// For player text shown on a page: escaped, hidden characters shown as a marked code.
function text(value) {
  return String(value ?? "").replace(UNSAFE, (c) => ESC[c] || `<span class="ctl" title="Hidden character, shown as its code">${code(c)}</span>`);
}
function block(value, cls = "") { return `<div class="pre${cls ? ` ${cls}` : ""}" dir="auto">${text(value)}</div>`; }
function clip(value, max) { const a = [...String(value ?? "")]; return a.length > max ? `${a.slice(0, max - 1).join("")}…` : a.join(""); }

function attrs(o) {
  let out = "";
  for (const [k, v] of Object.entries(o)) {
    if (v === false || v === null || v === undefined) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return out;
}

function select(name, options, selected, extra = {}) {
  const opts = options.map((o) => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(value)}"${String(value) === String(selected ?? "") ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
  return `<select name="${esc(name)}"${attrs(extra)}>${opts}</select>`;
}

function field(label, control, hint = "") {
  return `<label class="field"><span class="field-label">${esc(label)}</span>${control}${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>`;
}

function csrfInput(session) { return `<input type="hidden" name="csrf" value="${esc(session.csrf)}">`; }

function when(isoText) {
  if (!isoText) return "";
  const s = String(isoText);
  return `<time datetime="${esc(s)}" title="${esc(s)} (UTC)">${esc(s.slice(0, 16).replace("T", " "))}</time>`;
}

function num(n) { return n === null || n === undefined ? "–" : Number(n).toLocaleString("en-US"); }

const STATUS_LABEL = { new: "New", looking: "Waiting on us", question: "Waiting on player", fixed: "Fixed", closed: "Closed" };
const PLAYER_SEES = { new: "Received", looking: "Looking into it", question: "Question for you", fixed: "Fixed", closed: "Closed" };
function statusChip(status) { return `<span class="chip st-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`; }
function chip(label, cls = "") { return `<span class="chip${cls ? ` ${esc(cls)}` : ""}">${esc(label)}</span>`; }

const NAV = [
  ["/admin/", "Dashboard", "dashboard"],
  ["/admin/tickets", "Tickets", "tickets"],
  ["/admin/errors", "Errors", "errors"],
  ["/admin/announcements", "Announcements", "announcements"],
  ["/admin/replies", "Saved replies", "replies"],
  ["/admin/admins", "Admins", "admins"],
  ["/admin/audit", "Audit log", "audit"],
  ["/admin/data", "Data", "data"],
];

// The page shell. `body` is trusted HTML assembled from the helpers above.
function page({ title, active = "", session = null, counts = null, body, flash = "", wide = false }) {
  const nav = session ? `<nav class="nav" aria-label="Admin sections">${NAV.map(([href, label, key]) => {
    const badge = key === "tickets" && counts && counts.new + counts.looking > 0
      ? ` <span class="badge" title="${esc(`${counts.new} new, ${counts.looking} waiting on us`)}">${num(counts.new + counts.looking)}</span>` : "";
    return `<a href="${href}"${key === active ? ' class="on" aria-current="page"' : ""}>${esc(label)}${badge}</a>`;
  }).join("")}</nav>` : "";
  const who = session ? `<form class="who" method="post" action="/admin/logout">${csrfInput(session)}<a class="who-name" href="/admin/account" title="My account">${esc(session.admin.name)}</a><button class="btn quiet" type="submit">Sign out</button></form>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · Backstage Desk</title>
<link rel="stylesheet" href="/admin/static/admin.css">
<script src="/admin/static/admin.js" defer></script>
</head>
<body${session ? "" : ' class="bare"'}>
<header class="top"><div class="top-in"><a class="brand" href="/admin/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Backstage Desk</span></a>${nav}${who}</div></header>
<main class="main${wide ? " wide" : ""}">
${flash ? `<p class="flash" role="status">${esc(flash)}</p>` : ""}
${body}
</main>
<footer class="foot">Backstage Forever · admin area · times are UTC</footer>
</body>
</html>
`;
}

function pager(base, params, page, pages) {
  if (pages <= 1) return "";
  const link = (p, label, cls = "") => {
    const q = new URLSearchParams(params); q.set("page", String(p));
    return `<a class="btn quiet${cls}" href="${esc(`${base}?${q}`)}">${esc(label)}</a>`;
  };
  return `<nav class="pager" aria-label="Pages">${page > 1 ? link(page - 1, "‹ Newer") : '<span class="btn quiet off">‹ Newer</span>'}
    <span class="pager-at">Page ${num(page)} of ${num(pages)}</span>
    ${page < pages ? link(page + 1, "Older ›") : '<span class="btn quiet off">Older ›</span>'}</nav>`;
}

module.exports = { esc, val, raw, h, text, block, clip, attrs, select, field, csrfInput, when, num, statusChip, chip, page, pager, STATUS_LABEL, PLAYER_SEES, Safe };
