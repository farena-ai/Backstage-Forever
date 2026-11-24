"use strict";
// Charts for the dashboard, drawn on the server as inline SVG: no script is
// needed to see them. Each chart is a <figure> with a title, one plain
// sentence that says what it shows, a legend when there is more than one
// series, labelled axes, and the same numbers as a table. Colours come from
// CSS classes (s1..s8, other), never from inline styles.
const { esc, num } = require("./html");

const W = 640, H = 262, M = { l: 48, r: 16, t: 26, b: 40 };
const PW = W - M.l - M.r, PH = H - M.t - M.b;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let seq = 0;

function shortDay(d) { return `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`; }
function r1(n) { return Math.round(n * 10) / 10; }
function fmt(v, percent) { return v === null || v === undefined ? "no data" : percent ? `${r1(v)}%` : num(r1(v)); }

// The axis top: four equal steps of a round size (1, 2, 3, 4 or 5 times a power of ten), so every tick is a clean number.
function niceMax(max) {
  if (!(max > 0)) return 4;
  for (let pow = 1; ; pow *= 10) for (const q of [1, 2, 3, 4, 5]) if (max <= 4 * q * pow) return 4 * q * pow;
}

function frame({ yMax, percent, yLabel, xLabel, labels, slots }) {
  const out = [];
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i, y = M.t + PH - (PH * i) / 4;
    out.push(`<line class="grid" x1="${M.l}" x2="${W - M.r}" y1="${y}" y2="${y}"/>`);
    out.push(`<text class="tick" x="${M.l - 6}" y="${y + 4}" text-anchor="end">${esc(percent ? `${r1(v)}%` : num(r1(v)))}</text>`);
  }
  const n = labels.length, want = Math.min(n, 6);
  const seen = new Set();
  for (let k = 0; k < want; k++) {
    const i = want === 1 ? 0 : Math.round((k * (n - 1)) / (want - 1));
    if (seen.has(i)) continue;
    seen.add(i);
    const x = slots(i);
    out.push(`<text class="tick" x="${r1(x)}" y="${H - M.b + 16}" text-anchor="${k === 0 ? "start" : k === want - 1 ? "end" : "middle"}">${esc(labels[i])}</text>`);
  }
  out.push(`<text class="axis" x="${M.l + PW / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>`);
  out.push(`<text class="axis" x="${M.l}" y="11">${esc(yLabel)}</text>`);
  return out.join("");
}

function legend(series, latest) {
  if (series.length < 2) return "";
  return `<ul class="legend">${series.map((s, i) => `<li><span class="sw ${esc(s.cls)}" aria-hidden="true"></span>${esc(s.name)}${latest ? ` <b>${esc(latest[i])}</b>` : ""}</li>`).join("")}</ul>`;
}

function tableView(head, rows) {
  return `<details class="tableview"><summary>Show as a table</summary><div class="scroll"><table class="grid-table small"><thead><tr>${head.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${rows.map(r => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td class="n">${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

function figure({ title, summary, body, note = "" }) {
  return `<figure class="card chart"><figcaption><h3>${esc(title)}</h3><p class="summary">${esc(summary)}</p></figcaption>${body}${note ? `<p class="note">${esc(note)}</p>` : ""}</figure>`;
}

function empty(title, summary, why = "No data in this period yet.") {
  return figure({ title, summary, body: `<p class="empty">${esc(why)}</p>` });
}

function svgOpen(title, summary) {
  const id = `c${++seq}`;
  return `<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}t ${id}d"><title id="${id}t">${esc(title)}</title><desc id="${id}d">${esc(summary)}</desc>`;
}

// series: [{ name, values: (number|null)[], cls }]. A null value is a gap.
function lineChart({ title, summary, days, series, yLabel, xLabel = "Day (UTC)", percent = false, note = "", labels }) {
  const flat = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
  if (!days.length || !flat.length) return empty(title, summary);
  const yMax = percent ? (Math.max(...flat) > 60 ? 100 : Math.min(100, niceMax(Math.max(...flat)))) : niceMax(Math.max(...flat));
  const n = days.length;
  const x = (i) => (n === 1 ? M.l + PW / 2 : M.l + (PW * i) / (n - 1));
  const y = (v) => M.t + PH - (PH * v) / yMax;
  const lab = labels || days.map(shortDay);
  let marks = "";
  series.forEach((s) => {
    let d = "", pen = false, last = -1;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { pen = false; return; }
      d += `${pen ? "L" : "M"}${r1(x(i))} ${r1(y(v))}`;
      pen = true; last = i;
    });
    if (series.length === 1 && last >= 0) {
      const first = s.values.findIndex(v => v !== null && v !== undefined);
      if (!s.values.slice(first, last + 1).some(v => v === null || v === undefined))
        marks += `<path class="wash ${esc(s.cls)}" d="${d}L${r1(x(last))} ${M.t + PH}L${r1(x(first))} ${M.t + PH}Z"/>`;
    }
    marks += `<path class="line ${esc(s.cls)}" d="${d}"/>`;
    if (last >= 0) marks += `<circle class="dot ${esc(s.cls)}" cx="${r1(x(last))}" cy="${r1(y(s.values[last]))}" r="4"/>`;
  });
  const bw = n === 1 ? PW : PW / (n - 1);
  const hits = days.map((d, i) => `<rect class="hit" x="${r1(x(i) - bw / 2)}" y="${M.t}" width="${r1(bw)}" height="${PH}" data-x="${r1(x(i))}" data-tip="${esc(`${lab[i]}: ${series.map(s => `${s.name} ${fmt(s.values[i], percent)}`).join(", ")}`)}"/>`).join("");
  const latest = series.map(s => { const v = [...s.values].reverse().find(q => q !== null && q !== undefined); return fmt(v, percent); });
  const body = `${legend(series, latest)}${svgOpen(title, summary)}${frame({ yMax, percent, yLabel, xLabel, labels: lab, slots: x })}${marks}<line class="cross" x1="0" x2="0" y1="${M.t}" y2="${M.t + PH}"/>${hits}</svg>
${tableView([xLabel, ...series.map(s => s.name)], days.map((d, i) => [d, ...series.map(s => fmt(s.values[i], percent))]))}`;
  return figure({ title, summary, body, note });
}

// Columns: stacked (parts of a whole) or grouped (side by side).
// series: [{ name, values: number[], cls }]; labels: one per column.
function columnChart({ title, summary, labels, keys, series, yLabel, xLabel = "Day (UTC)", percent = false, mode = "stack", note = "" }) {
  const n = labels.length;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
  const peak = mode === "stack" ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap(s => s.values.map(v => v || 0)));
  if (!n || peak <= 0) return empty(title, summary);
  const yMax = percent ? 100 : niceMax(peak);
  const slot = PW / n, gap = slot >= 8 ? 2 : 0;
  const cx = (i) => M.l + slot * i + slot / 2;
  const y = (v) => M.t + PH - (PH * v) / yMax;
  let marks = "";
  labels.forEach((_, i) => {
    if (mode === "stack") {
      const bw = gap ? Math.min(24, slot - gap) : slot + 0.4; // thin columns touch, so a year of days reads as one shape
      let acc = 0;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) return;
        const top = y(acc + v), hgt = y(acc) - top, g = hgt > 3 && gap ? 1 : 0;
        marks += `<rect class="col ${esc(s.cls)}" x="${r1(cx(i) - bw / 2)}" y="${r1(top + g)}" width="${r1(bw)}" height="${r1(Math.max(0.5, hgt - g))}"/>`;
        acc += v;
      });
    } else {
      const bw = Math.min(18, Math.max(1, (slot - 4) / series.length - 2));
      const total = series.length * bw + (series.length - 1) * 2;
      series.forEach((s, k) => {
        const v = s.values[i] || 0;
        if (v <= 0) return;
        marks += `<rect class="col ${esc(s.cls)}" x="${r1(cx(i) - total / 2 + k * (bw + 2))}" y="${r1(y(v))}" width="${r1(bw)}" height="${r1(y(0) - y(v))}" rx="${bw >= 6 ? 2 : 0}"/>`;
      });
    }
  });
  const hits = labels.map((l, i) => `<rect class="hit" x="${r1(M.l + slot * i)}" y="${M.t}" width="${r1(slot)}" height="${PH}" data-x="${r1(cx(i))}" data-tip="${esc(`${l}: ${totals[i] > 0 || !percent ? series.filter(s => (s.values[i] || 0) > 0 || series.length <= 3).map(s => `${s.name} ${fmt(s.values[i] || 0, percent)}`).join(", ") || "none" : "no data"}`)}"/>`).join("");
  const body = `${legend(series)}${svgOpen(title, summary)}${frame({ yMax, percent, yLabel, xLabel, labels, slots: cx })}${marks}<line class="cross" x1="0" x2="0" y1="${M.t}" y2="${M.t + PH}"/>${hits}</svg>
${tableView([xLabel, ...series.map(s => s.name)], labels.map((l, i) => [keys ? keys[i] : l, ...series.map(s => (percent && totals[i] <= 0 ? "no data" : fmt(s.values[i] || 0, percent)))]))}`;
  return figure({ title, summary, body, note });
}

// A ranked list with a bar per row: label, bar, count, share.
// rows: [{ label, n, pct }]. `of` names what the share is a share of.
function barList({ title, summary, rows, what = "", countLabel = "Installs", of = "Share", note = "", limit = 10 }) {
  if (!rows.length || !rows.some(r => r.n > 0)) return empty(title, summary);
  const shown = rows.slice(0, limit), rest = rows.slice(limit);
  if (rest.length) shown.push({ label: `Other (${rest.length})`, n: rest.reduce((a, r) => a + r.n, 0), pct: r1(rest.reduce((a, r) => a + r.pct, 0)) });
  const body = `<table class="bars"><thead><tr><th scope="col">${esc(what || title)}</th><th scope="col"><span class="vh">Bar</span></th><th scope="col" class="n">${esc(countLabel)}</th><th scope="col" class="n">${esc(of)}</th></tr></thead><tbody>
${shown.map(r => `<tr><th scope="row">${esc(r.label)}</th><td class="bar"><progress max="100" value="${Math.max(0, Math.min(100, r.pct))}" aria-hidden="true"></progress></td><td class="n">${num(r.n)}</td><td class="n">${esc(r1(r.pct))}%</td></tr>`).join("")}
</tbody></table>`;
  return figure({ title, summary, body, note });
}

function heatClass(p) { return p >= 60 ? 5 : p >= 40 ? 4 : p >= 25 ? 3 : p >= 12 ? 2 : p > 0 ? 1 : 0; }

function cohortTable({ title, summary, cohorts, note = "" }) {
  if (!cohorts.some(c => c.size > 0)) return empty(title, summary, "No installs were first seen in the last nine weeks.");
  const body = `<div class="scroll"><table class="grid-table cohort"><thead><tr><th scope="col">First seen</th><th scope="col" class="n">Installs</th>${[1, 2, 3, 4, 5, 6, 7, 8].map(k => `<th scope="col" class="n">+${k} wk</th>`).join("")}</tr></thead><tbody>
${cohorts.map(c => `<tr><th scope="row"><span class="wk">${esc(c.week)}</span> <span class="dim">${esc(shortDay(c.start))}</span></th><td class="n">${num(c.size)}</td>${c.weeks.map(w => (w === null || !c.size
    ? '<td class="n dim">·</td>'
    : `<td class="n heat${heatClass(w.pct)}" title="${esc(`${w.n} of ${c.size} installs${w.partial ? " so far (week not over)" : ""}`)}">${esc(Math.round(w.pct))}%${w.partial ? '<span class="dim">*</span>' : ""}</td>`)).join("")}</tr>`).join("")}
</tbody></table></div>`;
  return figure({ title, summary, body, note });
}

module.exports = { lineChart, columnChart, barList, cohortTable, figure, shortDay, niceMax, r1 };
