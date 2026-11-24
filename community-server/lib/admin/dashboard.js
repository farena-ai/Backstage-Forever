"use strict";
// Renders the dashboard from the aggregates in lib/stats.js.
const { esc, num, text } = require("./html");
const { lineChart, columnChart, barList, cohortTable, figure, shortDay, r1 } = require("./charts");
const { RANGES, mondayOf } = require("../stats");

const AREA_NAMES = { now: "Now", route: "Route", map: "Map", dungeons: "Dungeons", professions: "Professions", ledger: "Ledger", talents: "Talents", journey: "Journey", companion: "Companion" };
const LANG_NAMES = { en: "English", de: "German", fr: "French", es: "Spanish" };
const KIND_NAMES = { herb: "Herb spots", ore: "Ore spots", chest: "Chests", npc: "NPC places", vendor: "Vendor stock", drop: "Drops", recipe: "Recipes" };
const RANGE_NAMES = { 7: "7 days", 30: "30 days", 90: "90 days", 365: "365 days" };

function sum(list) { return list.reduce((a, b) => a + (b || 0), 0); }
function peak(days, values) {
  let best = -1;
  values.forEach((v, i) => { if (v !== null && (best < 0 || v > values[best])) best = i; });
  return best < 0 ? null : { day: days[best], value: values[best] };
}
function tile(label, value, sub = "") {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div><div class="tile-sub">${esc(sub)}</div></div>`;
}
function plural(n, one, many) { return `${num(n)} ${n === 1 ? one : many}`; }

// Folds daily columns into weeks when a year of days would be too thin to read.
function byWeek(days, lists) {
  const keys = [], out = lists.map(() => []);
  days.forEach((d, i) => {
    const w = mondayOf(d);
    if (keys[keys.length - 1] !== w) { keys.push(w); out.forEach(o => o.push(0)); }
    lists.forEach((l, k) => { out[k][keys.length - 1] += l[i] || 0; });
  });
  return { keys, lists: out };
}

const SHORT = { windows: "Windows", "mac-arm64": "Mac ARM", "mac-x64": "Mac Intel", linux: "Linux", addon: "Addon", source: "Source", other: "Other" };

// GitHub release downloads: public numbers about files, nothing about players.
function downloadsSection(dl, range, days) {
  const head = (sub) => `<div class="section-head"><h2>Downloads</h2><span class="dim">${esc(sub)}</span></div>`;
  if (!dl) return `${head("from the public GitHub release pages")}<p class="card empty">Download counts are switched off on this server.</p>`;
  const checked = dl.lastChecked ? `last checked ${dl.lastChecked.slice(0, 16).replace("T", " ")} UTC` : "not checked yet";
  if (dl.empty) return `${head(`from the public GitHub release pages, ${checked}`)}<p class="card empty">No download counts yet. The service asks GitHub about once an hour.</p>`;
  const classes = dl.classes.filter(c => dl.totals[c] > 0 || c !== "other");
  const weekly = days > 90 ? byWeek(dl.days, dl.perDay) : null;
  const startInRange = dl.trackingStart >= dl.days[0];
  const figs = [
    barList({
      title: "Downloads by platform, all time", what: "File", countLabel: "Downloads",
      summary: `${num(dl.total)} downloads of release files in all, as GitHub counts them today. Update and checksum files are left out.`,
      rows: dl.byClass.map(x => ({ label: x.label, n: x.n, pct: x.pct })),
    }),
    columnChart({
      title: weekly ? "Downloads per week" : "Downloads per day",
      summary: `${plural(dl.inRange, "download", "downloads")} in the last ${range}, from the change in GitHub's counts between one day and the next.`,
      labels: (weekly ? weekly.keys : dl.days).map(shortDay), keys: weekly ? weekly.keys : dl.days,
      series: dl.classes.map((c, i) => ({ c, name: SHORT[c], values: weekly ? weekly.lists[i] : dl.perDay[i], cls: c === "other" ? "other" : `s${i + 1}` })).filter(s => classes.includes(s.c)),
      yLabel: "Downloads", xLabel: weekly ? "Week starting (UTC)" : "Day (UTC)",
      note: `Tracking started on ${dl.trackingStart}${startInRange ? "; earlier days cannot be shown" : ""}. Files that already existed that day are counted from the next change on; a release that came out later counts in full. ${num(dl.sinceStart)} downloads have been counted day by day since then.`,
    }),
  ];
  if (dl.updates.length) {
    figs.push(figure({
      title: "Update and checksum files", summary: "Fetched by the app's updater and by people checking a download. Shown for completeness; not counted as downloads.",
      body: `<table class="grid-table"><thead><tr><th scope="col">File</th><th scope="col" class="n">Fetched</th></tr></thead><tbody>
${dl.updates.slice(0, 8).map(u => `<tr><th scope="row">${text(u.name)}</th><td class="n">${num(u.n)}</td></tr>`).join("")}</tbody></table>`,
    }));
  }
  const shown = dl.releases.slice(0, 12), rest = dl.releases.slice(12);
  const table = figure({
    title: "Downloads per release",
    summary: `The newest ${shown.length === dl.releases.length ? "releases" : `${shown.length} of ${dl.releases.length} releases`}, with all-time downloads of each file kind.`,
    body: `<div class="scroll"><table class="grid-table"><thead><tr><th scope="col">Release</th><th scope="col">Published</th><th scope="col" class="n">Days out</th>${classes.map(c => `<th scope="col" class="n">${esc(SHORT[c])}</th>`).join("")}<th scope="col" class="n">Total</th></tr></thead><tbody>
${shown.map(r => `<tr><th scope="row">${text(r.tag)}${r.prerelease ? ' <span class="chip tag">pre-release</span>' : ""}</th><td class="nowrap">${esc(r.published || "not known")}</td><td class="n">${r.daysSince === null ? "–" : num(r.daysSince)}</td>${classes.map(c => `<td class="n">${num(r.counts[c])}</td>`).join("")}<td class="n"><b>${num(r.total)}</b></td></tr>`).join("")}
${rest.length ? `<tr><th scope="row" class="dim">${num(rest.length)} older releases</th><td></td><td></td>${classes.map(c => `<td class="n">${num(rest.reduce((a, r) => a + r.counts[c], 0))}</td>`).join("")}<td class="n"><b>${num(rest.reduce((a, r) => a + r.total, 0))}</b></td></tr>` : ""}
</tbody></table></div>`,
  }).replace('class="card chart"', 'class="card chart full"');
  return `${head(`from the public GitHub release pages, ${checked}`)}
<p class="plain-note">Downloads are not new players. Installer downloads include automatic updates of existing installs: each time the app updates itself it fetches the installer again.</p>
<div class="charts">
${figs.join("\n")}
</div>
${table}`;
}

function renderDashboard(d, notice = "") {
  const range = RANGE_NAMES[d.days];
  const picker = `<nav class="seg" aria-label="Period">${RANGES.map(r => `<a href="/admin/?days=${r}"${r === d.days ? ' class="on" aria-current="true"' : ""}>${esc(RANGE_NAMES[r])}</a>`).join("")}</nav>`;
  const a = d.active.now;

  const tiles = `<section class="tiles" aria-label="Headline numbers">
${tile("Active today", num(a.dauToday), "so far, UTC day")}
${tile("Weekly active", num(a.wau), "last 7 days")}
${tile("Monthly active", num(a.mau), "last 30 days")}
${tile("Stickiness", `${r1(a.stickiness)}%`, `daily ÷ monthly, ${a.dauAvg7} a day`)}
${tile("New installs", num(d.installs.newInRange), `last ${range}`)}
${tile("Ever seen", num(d.installs.totalEver), "installs, all time")}
${tile("Open tickets", num(d.support.openNow), d.support.medianFirstReplyHours === null ? "no replies yet" : `first reply in ${d.support.medianFirstReplyHours} h (median)`)}
</section>`;

  const charts = [];
  const pNew = peak(d.installs.days, d.installs.newPerDay);
  charts.push(lineChart({
    title: "New installs per day",
    summary: `${plural(d.installs.newInRange, "install was", "installs were")} seen for the first time in the last ${range}${pNew && pNew.value > 0 ? `; the busiest day was ${shortDay(pNew.day)} with ${num(pNew.value)}` : ""}.`,
    days: d.installs.days, series: [{ name: "New installs", values: d.installs.newPerDay, cls: "s1" }], yLabel: "Installs",
  }));

  charts.push(lineChart({
    title: "Active installs",
    summary: `${num(a.dauToday)} active today so far, ${num(a.wau)} in the last 7 days and ${num(a.mau)} in the last 30 days.`,
    days: d.active.days,
    series: [{ name: "Daily", values: d.active.dau, cls: "s1" }, { name: "Weekly (7 days)", values: d.active.wau, cls: "s2" }, { name: "Monthly (30 days)", values: d.active.mau, cls: "s3" }],
    yLabel: "Installs", xLabel: d.days > 90 ? "Day (UTC), one point a week" : "Day (UTC)",
    note: "Today is not over, so the last daily point is low.",
  }));

  charts.push(lineChart({
    title: "Stickiness",
    summary: `Daily active installs as a share of monthly active installs: ${r1(a.stickiness)}% over the last seven full days.`,
    days: d.active.days, series: [{ name: "Daily ÷ monthly", values: d.active.stickiness, cls: "s1" }], yLabel: "Share of monthly actives", percent: true,
    xLabel: d.days > 90 ? "Day (UTC), one point a week" : "Day (UTC)",
  }));

  charts.push(cohortTable({
    title: "Weekly retention",
    summary: "Of the installs first seen in a week, the share that sent statistics again one to eight weeks later.",
    cohorts: d.cohorts, note: "A dot means that week has not started. * marks the week still running.",
  }));

  const v = d.versions;
  const topNow = d.breakdowns.version.slice().sort((x, y) => y.n - x.n)[0];
  charts.push(columnChart({
    title: "Version share over time",
    summary: topNow ? `Each column is one day's active installs split by app version. Most installs in this period ended on ${topNow.label} (${r1(topNow.pct)}%).` : "Each column is one day's active installs split by app version.",
    labels: v.days.map(shortDay), keys: v.days, percent: true, yLabel: "Share of the day's installs",
    series: v.series.map((name, i) => ({ name, values: v.share[i].map(x => x ?? 0), cls: name === "other" ? "other" : `s${i + 1}` })),
  }));

  if (v.adoption) {
    const ad = v.adoption, lastShare = [...ad.share].reverse().find(x => x !== null);
    charts.push(lineChart({
      title: `Adoption of ${v.latest}`,
      summary: `Share of each day's active installs running ${v.latest}, the newest stable version seen, from ${shortDay(ad.firstDay)} on. Latest: ${lastShare === undefined ? "no data" : `${r1(lastShare)}%`}.`,
      days: ad.days, series: [{ name: v.latest, values: ad.share, cls: "s1" }], yLabel: "Share of the day's installs", percent: true,
      labels: ad.days.map((_, i) => `Day ${i + 1}`), xLabel: "Days since first seen (up to 30)",
    }));
  }

  const dl = d.downloads;
  if (dl && !dl.empty && dl.latest && dl.latest.values.some(x => x !== null)) {
    const lastTotal = [...dl.latest.values].reverse().find(x => x !== null);
    charts.push(lineChart({
      title: `Downloads of ${dl.latest.tag}`,
      summary: `All downloads so far of the files of ${dl.latest.tag}, the newest release on GitHub${dl.latest.publishedAt ? `, published ${shortDay(dl.latest.publishedAt.slice(0, 10))}` : ""}: ${num(lastTotal)}. Compare with the adoption chart: downloads include automatic updates.`,
      days: dl.days, series: [{ name: "Downloads so far", values: dl.latest.values, cls: "s1" }], yLabel: "Downloads, running total",
    }));
  }

  charts.push(barList({
    title: "Versions in use", what: "Version", summary: `The app version each install was on when it last sent statistics in the last ${range}. Old versions near the top of the count are installs that have not updated.`,
    rows: d.breakdowns.version, limit: 8,
  }));
  charts.push(barList({ title: "Operating systems", what: "System", summary: `Operating system family and major version of installs active in the last ${range}.`, rows: d.breakdowns.os, limit: 8 }));
  charts.push(barList({ title: "Languages", what: "Language", summary: `App language of installs active in the last ${range}.`, rows: d.breakdowns.lang.map(r => ({ ...r, label: LANG_NAMES[r.label] || r.label })) }));
  charts.push(barList({ title: "Game builds", what: "Build", summary: `Game build reported by installs active in the last ${range}.`, rows: d.breakdowns.build, limit: 6 }));

  charts.push(barList({
    title: "Setup funnel", what: "Step", countLabel: "Installs", of: "Of all",
    summary: `How far installs got with setup, from their latest statistics in the last ${range}. Each step also counts only installs that passed the step before.`,
    rows: d.funnel, note: `Community sharing is switched on for ${num(d.sharing.n)} installs (${r1(d.sharing.pct)}%). The app does not report "first save read", so that step is not shown.`,
  }));
  charts.push(barList({
    title: "Feature reach this week", what: "Area", countLabel: "Installs", of: "Of weekly actives",
    summary: "Share of installs active in the last 7 days that opened each main area at least once.",
    rows: d.reach.map(r => ({ ...r, label: AREA_NAMES[r.label] || r.label })),
  }));

  const c = d.community;
  const weekly = d.days > 90 ? byWeek(c.days, c.perDay) : null;
  charts.push(columnChart({
    title: weekly ? "Community data: new facts per week" : "Community data: new facts per day",
    summary: `${plural(c.newFacts, "fact was", "facts were")} reported for the first time by an install in the last ${range}, from ${plural(c.contributors, "contributor", "contributors")}.`,
    labels: (weekly ? weekly.keys : c.days).map(shortDay), keys: weekly ? weekly.keys : c.days,
    series: c.kinds.map((k, i) => ({ name: KIND_NAMES[k], values: weekly ? weekly.lists[i] : c.perDay[i], cls: `s${i + 1}` })),
    yLabel: "New facts", xLabel: weekly ? "Week starting (UTC)" : "Day (UTC)",
    note: "A fact is one spot, place, vendor item, drop or recipe as first reported by one install. The service keeps no log of single submissions.",
  }));
  const fresh = sum(c.newContributorsPerDay);
  charts.push(lineChart({
    title: "New contributors per day",
    summary: `Installs that shared community data for the first time. ${num(fresh)} new in the last ${range}; ${num(c.contributors)} distinct contributors were active in it, ${num(c.contributorsEver)} ever.`,
    days: c.days, series: [{ name: "New contributors", values: c.newContributorsPerDay, cls: "s1" }], yLabel: "Installs",
  }));
  if (c.zones.length) {
    charts.push(figure({
      title: "Gathering coverage by zone", summary: `The ten map ids with the most reported gathering spots, and how many are new in the last ${range}.`,
      body: `<table class="grid-table"><thead><tr><th scope="col">Map id</th><th scope="col" class="n">Spots</th><th scope="col" class="n">New</th><th scope="col" class="n">Contributors</th></tr></thead><tbody>
${c.zones.map(z => `<tr><th scope="row">${esc(z.map)}</th><td class="n">${num(z.spots)}</td><td class="n">${num(z.fresh)}</td><td class="n">${num(z.contributors)}</td></tr>`).join("")}</tbody></table>`,
    }));
  }

  const s = d.support;
  charts.push(columnChart({
    title: "Tickets opened and closed per week", mode: "group",
    summary: `${plural(s.openedInRange, "ticket", "tickets")} opened and ${num(s.closedInRange)} fixed or closed in the weeks shown. ${num(s.openNow)} are open now.`,
    labels: s.weeks.map(shortDay), keys: s.weeks, series: [{ name: "Opened", values: s.opened, cls: "s1" }, { name: "Fixed or closed", values: s.closed, cls: "s2" }],
    yLabel: "Tickets", xLabel: "Week starting (UTC)",
  }));
  charts.push(barList({
    title: "Open tickets by age", what: "Waiting", countLabel: "Tickets", of: "Of open",
    summary: s.medianFirstReplyHours === null ? "How long the tickets that are still open have been waiting. No ticket from this period has a reply yet."
      : `How long the tickets that are still open have been waiting. Median time to a first reply in this period: ${s.medianFirstReplyHours} hours (${plural(s.replied, "ticket", "tickets")}).`,
    rows: s.ages.map(x => ({ ...x, pct: s.openNow ? r1((x.n / s.openNow) * 100) : 0 })),
  }));
  charts.push(figure({
    title: "Tickets per 1,000 weekly actives, by version",
    summary: `Tickets opened in the last ${range} for each app version, divided by that version's weekly active installs added up over the same weeks. A release-quality number: lower is better.`,
    body: s.perVersion.length ? `<table class="grid-table"><thead><tr><th scope="col">Version</th><th scope="col" class="n">Tickets</th><th scope="col" class="n">Active install-weeks</th><th scope="col" class="n">Per 1,000</th></tr></thead><tbody>
${s.perVersion.map(p => `<tr><th scope="row">${esc(p.version)}</th><td class="n">${num(p.tickets)}</td><td class="n">${num(p.installWeeks)}</td><td class="n">${p.rate === null ? "–" : esc(p.rate)}</td></tr>`).join("")}</tbody></table>` : '<p class="empty">No data in this period yet.</p>',
  }));
  charts.push(figure({
    title: "Top error groups",
    summary: `Automatic error reports in the last ${range}, grouped by error name and the first three stack lines.`,
    body: s.topErrors.length ? `<table class="grid-table"><thead><tr><th scope="col">Error</th><th scope="col" class="n">Reports</th><th scope="col" class="n">Versions</th><th scope="col">Last seen</th></tr></thead><tbody>
${s.topErrors.map(g => `<tr><th scope="row" class="sum"><a href="/admin/errors/${g.id}">${text(g.name)}</a> <span class="dim clip1" dir="auto">${text([...g.message].slice(0, 70).join(""))}</span></th><td class="n">${num(g.recent)}</td><td class="n">${num(g.versions)}</td><td class="nowrap">${esc(g.last_day)}</td></tr>`).join("")}</tbody></table>` : '<p class="empty">No automatic error reports in this period.</p>',
  }));

  if (d.history.length) {
    charts.push(figure({
      title: "Older months", summary: "Statistics older than 13 months are kept only as these monthly totals.",
      body: `<table class="grid-table"><thead><tr><th scope="col">Month</th><th scope="col" class="n">Active installs</th><th scope="col" class="n">New installs</th><th scope="col" class="n">Active days</th></tr></thead><tbody>
${d.history.map(m => `<tr><th scope="row">${esc(m.month)}</th><td class="n">${num(m.active)}</td><td class="n">${num(m.fresh)}</td><td class="n">${num(m.days)}</td></tr>`).join("")}</tbody></table>`,
    }));
  }

  return `<div class="head"><h1>Dashboard</h1>${picker}</div>
${notice}
${tiles}
<div class="charts">
${charts.join("\n")}
</div>
<p class="footnote">Counts are installs that send statistics. Installs with statistics switched off, and anything before the statistics release, are not in these numbers. Period: ${esc(d.start)} to ${esc(d.today)} (UTC).</p>
${downloadsSection(d.downloads, range, d.days)}`;
}

module.exports = { renderDashboard };
