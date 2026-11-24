"use strict";
// The website at backstagecoding.com/backstage-forever/ (roadmap R4, R5, D6).
//
//   node scripts/build-site.cjs SITE_DIR [--date YYYY-MM-DD]   write the pages (--date is the sitemap's lastmod; left out without it)
//   node scripts/build-site.cjs SITE_DIR --check               fail if a page is stale or something is wrong
//
// SITE_DIR is a copy of the live folder (index.html, desktop-downloads.js, crest.png, journey.webp,
// compass.png, helpers.png). The parent site's header, footer, stylesheet and scripts are taken from
// that index.html, so every page keeps the live site's frame. Everything else is written from here:
//   index.html      site/index.template.html + site/content.cjs (the home page)
//   tour.html       the feature tour; pictures come from scripts/site-screenshots.cjs --webp SITE_DIR/tour
//   download.html   every download with one sentence, and the install steps
//   whats-new.html  data/whats-new-catalog.json (the list the app shows after an update)
//   commands.html   src/renderer/commands.js (the list behind Help → Commands)
//   coverage.html   the same count the app's Help → Data coverage shows, plus pack totals
//   site.css        site/site.css
//   sitemap-backstage-forever.xml
// No page needs JavaScript to be read, and nothing is loaded from another site.
// Run it again for every release; nothing is deployed from here.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), vm = require("node:vm");
const root = path.join(__dirname, "..");
// Line endings are normalised: a Windows checkout may hold these files with CRLF, and the pages must come out the same everywhere.
const read = (p) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const json = (p) => JSON.parse(read(p));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => Number(n).toLocaleString("en-US");
const { BASE, REPO, RELEASES, PAGES, HERO_SHOT, FEATURES, MORE, ALSO, STEPS, TRUST, DOWNLOADS, INSTALL, FAQ } = require("../site/content.cjs");
const SHOWN_RELEASES = 8;
const LATEST = `${RELEASES}/latest`;
const ORDER = ["index.html", "tour.html", "download.html", "whats-new.html", "commands.html", "coverage.html"];
const OG = { file: "og-image.jpg", width: 1200, height: 630, alt: "Backstage Forever: the Now page of the desktop app beside the crest" };
const LIMITS = { title: 60, description: 155 };
const urlOf = (file) => BASE + (file === "index.html" ? "" : file);
const hrefOf = (file) => (file === "index.html" ? "./" : `./${file}`);

// ---------- the parent site's frame, from the index.html in the folder ----------
function chrome(index) {
  const mainStart = index.search(/<main id="main"/), mainEnd = index.indexOf("</main>");
  const skip = index.indexOf('<a class="skip"');
  if (mainStart < 0 || mainEnd < 0 || skip < 0) throw new Error("index.html does not look like the site's page (no skip link or <main id=\"main\">).");
  const after = index.slice(mainEnd + "</main>".length);
  const scriptAt = after.search(/<script\b/);
  return {
    // The folder's own stylesheets are replaced by site.css; the parent site's stay.
    styles: (index.match(/<link rel="stylesheet"[^>]*>/g) || []).filter((l) => !/href="\.\/(?:site|tour|landing)\.css"/.test(l)),
    header: index.slice(skip, mainStart),
    footer: scriptAt < 0 ? after.replace(/<\/body>[^]*$/, "") : after.slice(0, scriptAt),
    scripts: (after.match(/<script\b[^>]*><\/script>/g) || []),
  };
}

// ---------- pictures ----------
// Width and height of a WebP or PNG, so every <img> carries its real size. Null when unreadable.
function imageSize(file) {
  let b;
  try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length >= 24 && b.toString("latin1", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
  if (kind === "VP8X") return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  return null;
}
const sizeAttrs = (site, name) => { const s = imageSize(path.join(site, name)); return s ? ` width="${s.w}" height="${s.h}"` : ""; };
// One screenshot: the 800 px copy for small screens, the full one for large, and a link to the full picture.
function shot(ctx, [name, title, alt, caption], { sizes, lazy = true, wide = false } = {}) {
  const big = `tour/${name}.webp`, small = `tour/${name}-800.webp`;
  for (const f of [big, small]) if (!fs.existsSync(path.join(ctx.site, f))) ctx.missing.push(f);
  const b = imageSize(path.join(ctx.site, big)) || { w: 1600, h: 1000 }, s = imageSize(path.join(ctx.site, small)) || { w: 800, h: 500 };
  const srcset = s.w < b.w ? ` srcset="./${small} ${s.w}w, ./${big} ${b.w}w" sizes="${sizes}"` : "";
  return `<figure class="bfx-shot${wide ? " bfx-wide" : ""}"><a class="bfx-frame" href="./${big}" aria-label="${esc(title)}: open the full-size picture"><img src="./${s.w < b.w ? small : big}"${srcset} width="${b.w}" height="${b.h}" alt="${esc(alt)}"${lazy ? ' loading="lazy"' : ""} decoding="async"></a><figcaption><strong>${esc(title)}</strong> ${esc(caption)}</figcaption></figure>`;
}
const SIZES = { half: "(max-width: 900px) calc(100vw - 40px), 660px", wide: "(max-width: 1220px) calc(100vw - 40px), 1180px", pair: "(max-width: 900px) calc(100vw - 40px), 580px" };

// ---------- shared pieces ----------
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
function head(c, file, extra = []) {
  const p = PAGES[file], url = urlOf(file), image = BASE + OG.file;
  const crumbs = file === "index.html" ? [] : [jsonLd({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [["Backstage Coding", "https://backstagecoding.com/"], ["Backstage Forever", BASE], [p.nav, url]].map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })) })];
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title)}</title><meta name="description" content="${esc(p.description)}"><link rel="canonical" href="${url}">`
    + `<meta property="og:type" content="website"><meta property="og:site_name" content="Backstage Forever"><meta property="og:title" content="${esc(p.title)}"><meta property="og:description" content="${esc(p.description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="${OG.width}"><meta property="og:image:height" content="${OG.height}"><meta property="og:image:alt" content="${esc(OG.alt)}">`
    + `<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(p.title)}"><meta name="twitter:description" content="${esc(p.description)}"><meta name="twitter:image" content="${image}"><meta name="theme-color" content="#121922">`
    + `${c.styles.join("")}<link rel="stylesheet" href="./site.css">${[...crumbs, ...extra].join("")}`;
}
const nav = (file) => `<nav class="bfx-nav" aria-label="Backstage Forever pages">${ORDER.map((f) => `<a href="${hrefOf(f)}"${f === file ? ' aria-current="page"' : ""}>${esc(PAGES[f].nav)}</a>`).join("")}</nav>`;
// The call to action. The download script upgrades [data-download] links to direct files and
// .bf-release to the release's number; without JavaScript they stay on the latest-release page.
const cta = () => `<div class="bfx-cta"><a class="bfx-btn" data-download="windows" href="${LATEST}">Download for Windows — free</a>`
  + `<p>Also for <a data-download="arm" href="${LATEST}">macOS on Apple silicon</a>, <a data-download="intel" href="${LATEST}">macOS on Intel</a> and <a href="./download.html#linux">Linux</a>. The app installs and updates the in-game addon for you.</p>`
  + `<p class="bfx-fine">Signed installer · Open source · No account · <a class="bf-release" href="${LATEST}">Latest release on GitHub</a></p></div>`;
const ctaBand = (title, text) => `<section class="bfx-section bfx-band bfx-cta-band" id="get"><div class="bfx-wrap"><h2>${esc(title)}</h2><p class="bfx-intro">${esc(text)}</p>${cta()}</div></section>`;
const legal = () => `<div class="bfx-legal"><div class="bfx-wrap"><p>Backstage Forever is an independent fan project. It is not affiliated with or endorsed by Blizzard Entertainment. World of Warcraft, Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc.</p><p>The app bundles no game files: map art, icons and item data are read from your own installation, on your own computer. Quest and world reference data comes from Efficient Games (CC BY 4.0) and from players' own play. Free and open source under the MIT licence, on <a href="${REPO}">GitHub</a>.</p></div></div>`;
const commandsLine = (list) => (list?.length ? `<p class="bfx-cmds"><span>In game:</span> ${list.map((x) => `<code>${esc(x)}</code>`).join(" ")}</p>` : "");
const downloadsList = () => `<ul class="bfx-dl">${DOWNLOADS.map((d) => `<li id="${d.id}"${d.main ? ' class="bfx-main"' : ""}><h3>${esc(d.title)}</h3><p>${esc(d.text)}</p><a class="bfx-btn${d.main ? "" : " bfx-ghost"}" data-download="${d.key}" href="${LATEST}">${esc(d.button)}</a></li>`).join("")}</ul>`;

function page(c, file, body, { extra = [], bottom = ["Get Backstage Forever", "One free download. The desktop app sets up the addon in WoW Forever and keeps both up to date."] } = {}) {
  const p = PAGES[file];
  return `<!doctype html><html lang="en"><head>${head(c, file, extra)}</head><body>
${c.header}<main id="main" class="bfx-page">
<section class="bfx-top"><div class="bfx-wrap"><p class="bfx-crumbs"><a href="./">Backstage Forever</a> / ${esc(p.nav)}</p><h1>${esc(p.h1)}</h1><p class="bfx-lead">${p.lead}</p>${cta()}${nav(file)}</div></section>
${body}
${ctaBand(...bottom)}
${legal()}
</main>${c.footer}${c.scripts.join("")}</body></html>
`;
}

// ---------- home ----------
function home(c, ctx) {
  const p = PAGES["index.html"];
  const software = jsonLd({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Backstage Forever", description: p.description, url: BASE, image: BASE + OG.file,
    screenshot: `${BASE}tour/now.webp`, applicationCategory: "GameApplication", applicationSubCategory: "UtilitiesApplication", operatingSystem: "Windows 10, Windows 11, macOS, Linux",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, isAccessibleForFree: true, downloadUrl: LATEST, installUrl: LATEST, releaseNotes: `${BASE}whats-new.html`,
    license: "https://opensource.org/licenses/MIT", inLanguage: ["en", "de", "fr", "es"], sameAs: REPO,
    author: { "@type": "Person", name: "Frank Arena" }, publisher: { "@type": "Organization", name: "Backstage Coding", url: "https://backstagecoding.com/" } });
  const faq = jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  const latest = stableReleases()[0];
  const cards = [["tour.html", "Feature tour", "Real screens of every part of the app."], ["download.html", "Download", "Windows, macOS, Linux and the addon on its own."], ["whats-new.html", "What's new", latest ? `Latest: ${tagline(latest)}.` : "What changed in each release."],
    ["commands.html", "Commands", "Everything you can type in game, in plain words."], ["coverage.html", "Data coverage", "How much the app knows, zone by zone, for each faction."]];
  const features = FEATURES.map((f, i) => `<section class="bfx-feature bfx-section${i % 2 ? "" : " bfx-band"}${i % 2 ? " bfx-flip" : ""}" id="${f.id}"><div class="bfx-wrap"><div class="bfx-text"><p class="bfx-kicker">${esc(f.kicker)}</p><h2>${esc(f.h2)}</h2>${f.text.map((t) => `<p>${esc(t)}</p>`).join("")}${commandsLine(f.commands)}<p class="bfx-more"><a href="./tour.html#${f.id}">More ${esc(f.short.toLowerCase())} screens in the tour</a></p></div>${shot(ctx, f.shots.find((s) => s[0] === f.home), { sizes: SIZES.half })}</div></section>`).join("\n");
  const parts = {
    head: head(c, "index.html", [software, faq]), header: c.header, footer: c.footer, scripts: c.scripts.join(""), repo: REPO,
    h1: esc(p.h1), h1sub: esc(p.h1sub), cta: cta(), nav: nav("index.html"),
    "hero-shot": shot(ctx, HERO_SHOT, { sizes: SIZES.wide, lazy: false }),
    "feature-links": `<nav class="bfx-jump" aria-label="Features">${FEATURES.map((f) => `<a href="#${f.id}">${esc(f.short)}</a>`).join("")}<a href="#in-game">In the game</a><a href="#faq">Questions</a></nav>`,
    features, also: `<ul class="bfx-also">${ALSO.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`,
    steps: `<ol class="bfx-steps">${STEPS.map(([t, text]) => `<li><h3>${esc(t)}</h3><p>${esc(text)}</p></li>`).join("")}</ol>`,
    trust: `<div class="bfx-tiles">${TRUST.map(([t, text]) => `<div class="bfx-tile"><h3>${esc(t)}</h3><p>${text}</p></div>`).join("")}</div>`,
    cards: `<div class="bfx-cards">${cards.map(([href, title, text]) => `<a class="bfx-card" href="./${href}"><strong>${esc(title)}</strong><span>${esc(text)}</span></a>`).join("")}</div>`,
    faq: `<div class="bfx-faq">${FAQ.map(([q, a]) => `<div class="bfx-qa"><h3>${esc(q)}</h3><p>${esc(a)}</p></div>`).join("")}</div>`,
    downloads: downloadsList(), legal: legal(),
  };
  return read("site/index.template.html").replace(/<!--[^]*?-->\n?/g, "").replace(/\{\{([\w:.-]+)\}\}/g, (all, key) => {
    if (key.startsWith("size:")) return sizeAttrs(ctx.site, key.slice(5));
    if (!(key in parts)) throw new Error(`site/index.template.html: nothing to put in {{${key}}}`);
    return parts[key];
  });
}

// ---------- feature tour ----------
function tour(c, ctx) {
  const groups = [...FEATURES, MORE];
  const jump = `<nav class="bfx-jump" aria-label="On this page">${groups.map((t) => `<a href="#${t.id}">${esc(t.short)}</a>`).join("")}<a href="#in-game">In the game</a></nav>`;
  const sections = groups.map((t, i) => `<section class="bfx-tour-group bfx-section${i % 2 ? " bfx-band" : ""}" id="${t.id}"><div class="bfx-wrap"><p class="bfx-kicker">${String(i + 1).padStart(2, "0")} / ${esc(t.kicker)}</p><h2>${esc(t.h2)}</h2>${t.text ? `<p class="bfx-intro">${esc(t.text[0])}</p>` : ""}${commandsLine(t.commands)}<div class="bfx-shots">${t.shots.map((s, n) => { const wide = n === 0 || (t.shots.length % 2 === 0 && n === t.shots.length - 1 && t.shots.length > 2); return shot(ctx, s, { sizes: wide ? SIZES.wide : SIZES.pair, wide, lazy: i > 0 || n > 0 }); }).join("")}</div></div></section>`).join("\n");
  const inGame = `<section class="bfx-tour-group bfx-section${groups.length % 2 ? " bfx-band" : ""}" id="in-game"><div class="bfx-wrap"><p class="bfx-kicker">${String(groups.length + 1).padStart(2, "0")} / In the game</p><h2>The addon brings it into WoW Forever</h2><p class="bfx-intro">These two are real pictures from the game. Everything the addon can do is on the <a href="./commands.html">commands page</a>.</p><div class="bfx-shots"><figure class="bfx-shot"><div class="bfx-frame"><img src="./compass.png"${sizeAttrs(ctx.site, "compass.png")} alt="Adventure Compass panel in WoW Forever showing level, experience to the next level, quests ready to hand in and the next step" loading="lazy" decoding="async"></div><figcaption><strong>Adventure Compass</strong> What is ready to hand in and how your leveling is going.</figcaption></figure><figure class="bfx-shot"><div class="bfx-frame"><img src="./helpers.png"${sizeAttrs(ctx.site, "helpers.png")} alt="In-Game Helpers panel in WoW Forever with a switch for each hint, set for one character" loading="lazy" decoding="async"></div><figcaption><strong>In-Game Helpers</strong> Choose which hints each character gets.</figcaption></figure></div></div></section>`;
  return page(c, "tour.html", `<div class="bfx-wrap">${jump}</div>\n${sections}\n${inGame}`);
}

// ---------- download ----------
function download(c) {
  const body = `<section class="bfx-section" id="files"><div class="bfx-wrap"><h2>Choose your system</h2><p class="bfx-intro">Every button opens the latest release on GitHub, where the files are. The desktop app is the download you want; it brings the addon with it.</p>${downloadsList()}
<div class="bfx-notes"><p>Each release lists SHA-256 checksums (SHA256SUMS.txt) for every file. If Windows reports an unknown publisher or an invalid signature, do not run the installer; download it again from the release page.</p><p>The same files and the source code are on <a href="${RELEASES}">the releases page on GitHub</a>.</p></div></div></section>
<section class="bfx-section bfx-band" id="install"><div class="bfx-wrap"><h2>Install it</h2><p class="bfx-intro">About five minutes, once. The app finds WoW Forever (or lets you choose its folder) and installs the addon.</p><div class="bfx-install">${INSTALL.map(([title, steps]) => `<div class="bfx-tile"><h3>${esc(title)}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("")}</div>
<p class="bfx-intro">More detail is in the <a href="${REPO}/blob/main/docs/GETTING-STARTED.md">getting started guide</a> and the <a href="${REPO}/blob/main/docs/LINUX.md">Linux notes</a> on GitHub. Curious first? Take the <a href="./tour.html">feature tour</a> or read the <a href="./#faq">questions and answers</a>.</p></div></section>`;
  return page(c, "download.html", body, { bottom: ["Ready when you are", "The Windows installer is the quickest start. The app sets up the addon in WoW Forever and keeps both up to date."] });
}

// ---------- what's new ----------
const KIND_LABEL = { new: "New", improved: "Better", fixed: "Fixed", compatibility: "Game updates" };
const PLATFORM_LABEL = { desktop: "Desktop app", windows: "Windows", macos: "Mac", addon: "In game" };
function stableReleases() {
  const { compareVersions } = require("../src/core/whats-new-catalog.cjs");
  return json("data/whats-new-catalog.json").releases.filter((r) => r.channel === "stable").sort((a, b) => compareVersions(b.version, a.version));
}
const tagline = (r) => r.title.replace(/^Backstage Forever\s+\S+\s*[—–-]\s*/, "").trim() || r.title;
// A change usually opens with a short name ("Recipe book and skill path."): that part is set in bold.
const changeText = (text) => { const m = /^(.{3,60}?[.:])\s+(?=\S)/.exec(text); return m ? `<strong>${esc(m[1])}</strong> ${esc(text.slice(m[0].length))}` : esc(text); };
function whatsNew(c) {
  const releases = stableReleases(), shown = releases.slice(0, SHOWN_RELEASES);
  const jump = `<nav class="bfx-jump" aria-label="Releases on this page">${shown.map((r) => `<a href="#v${esc(r.version)}">${esc(r.version)}</a>`).join("")}</nav>`;
  const body = shown.map((r, i) => {
    const groups = Object.keys(KIND_LABEL).map((kind) => {
      const rows = r.changes.filter((ch) => ch.kind === kind);
      return rows.length ? `<h3 class="bfx-kind">${KIND_LABEL[kind]}</h3><ul>${rows.map((ch) => `<li>${changeText(ch.text)}${ch.platforms?.length ? ` <span class="bfx-where">${ch.platforms.map((p) => esc(PLATFORM_LABEL[p] || p)).join(" · ")}</span>` : ""}</li>`).join("")}</ul>` : "";
    }).join("");
    return `<article class="bfx-release" id="v${esc(r.version)}"><header><p class="bfx-version">${i === 0 ? "Latest · " : ""}Version ${esc(r.version)}</p><h2>${esc(tagline(r))}</h2></header>${groups}<p class="bfx-notes-link"><a href="${RELEASES}/tag/v${esc(r.version)}">Full notes and files for version ${esc(r.version)} on GitHub</a></p></article>`;
  }).join("\n");
  return page(c, "whats-new.html", `<section class="bfx-section"><div class="bfx-wrap">${jump}<div class="bfx-releases">${body}</div><p class="bfx-older">${releases.length > shown.length ? `${releases.length - shown.length} older releases are on ` : "Every release is on "}<a href="${RELEASES}">the releases page on GitHub</a>.</p></div></section>`,
    { bottom: ["Get the latest version", "The Windows app updates itself. On a Mac or Linux, download the new version here."] });
}

// ---------- commands ----------
function commands(c) {
  const { CATALOG, FEATURES: SEEN, APP } = require("../src/renderer/commands.js");
  const groups = [...new Set(CATALOG.map((x) => x.group))];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const used = new Set();
  const idOf = new Map(CATALOG.map((x) => { let id = `cmd-${slug(x.command.replace(/^\/bf\s*/, "")) || "bf"}`; for (let n = 2; used.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`; used.add(id); return [x, id]; }));
  const jump = `<nav class="bfx-jump" aria-label="On this page">${groups.map((g) => `<a href="#${slug(g)}">${esc(g)}</a>`).join("")}<a href="#in-game">Things you'll see in game</a><a href="#in-app">In the desktop app</a></nav>`;
  // Every command as a link: find one with the browser's own search, then jump to it.
  const index = `<div class="bfx-index" id="all-commands"><h2>Find a command</h2><p>All ${num(CATALOG.length)} commands. Press Ctrl+F (or Cmd+F) to search this page, or pick one to jump to it.</p>${groups.map((g) => `<h3>${esc(g)}</h3><ul>${CATALOG.filter((x) => x.group === g).map((x) => `<li><a href="#${idOf.get(x)}"><code>${esc(x.command)}</code></a></li>`).join("")}</ul>`).join("")}</div>`;
  const sections = groups.map((g) => `<section class="bfx-cmd-group" id="${slug(g)}"><h2>${esc(g)}</h2><dl class="bfx-cmd-list">${CATALOG.filter((x) => x.group === g).map((x) => `<div class="bfx-cmd" id="${idOf.get(x)}"><dt><code>${esc(x.command)}</code></dt><dd><p>${esc(x.what)}</p>${x.when ? `<p class="bfx-when"><strong>Use it:</strong> ${esc(x.when)}</p>` : ""}${x.example && x.example !== x.command ? `<p class="bfx-when">Example: <code>${esc(x.example)}</code></p>` : ""}</dd></div>`).join("")}</dl></section>`).join("\n");
  const list = (id, title, rows) => `<section class="bfx-cmd-group" id="${id}"><h2>${title}</h2><dl class="bfx-cmd-list">${rows.map((x) => `<div class="bfx-cmd"><dt>${esc(x.name)}</dt><dd><p>${esc(x.what)}</p>${x.where ? `<p class="bfx-when"><strong>Where:</strong> ${esc(x.where)}</p>` : ""}</dd></div>`).join("")}</dl></section>`;
  PAGES["commands.html"].lead = `Press Enter in WoW Forever, type a command, press Enter again. Commands only show you things or put an arrow on your map; nothing plays for you. This is the same list as Help → Commands in the app.`;
  return page(c, "commands.html", `<section class="bfx-section"><div class="bfx-wrap">${jump}${index}${sections}\n${list("in-game", "Things you'll see in game", SEEN)}\n${list("in-app", "In the desktop app", APP)}</div></section>`,
    { bottom: ["Get the app that installs the addon", "The commands come with the addon, and the desktop app installs and updates it for you."] });
}

// ---------- data coverage ----------
function coverageData() {
  const { KnowledgeService } = require("../src/core/knowledge-cache.cjs");
  const knowledge = new KnowledgeService({ dataDir: path.join(os.tmpdir(), "bf-site-knowledge-unused") });
  const quiet = (fn) => { try { return fn(); } catch { return null; } };
  // The same inputs src/main.cjs gives the World Map, so the numbers match Help → Data coverage.
  const worldMap = new (require("../src/core/world-map.cjs").WorldMap)({
    getState: () => ({ profiles: [], activeProfileId: null }), knowledge,
    npcReference: quiet(() => require("../src/core/npc-location-data.cjs").validateNpcLocationPack(json("data/forever-npc-locations/pack.json"))),
    travelReference: quiet(() => require("../src/core/travel-data.cjs").loadTravelReference(fs.readFileSync(path.join(root, "data/forever-travel/pack.json")))),
    vendorPack: quiet(() => require("../src/core/vendor-facts.cjs").loadVendorPack()),
    insights: require("../src/core/insights-data.cjs").loadBundledInsights(),
    acquisitionPack: quiet(() => require("../src/core/acquisition-data.cjs").loadAcquisitionPack()),
    creaturePack: quiet(() => require("../src/core/creature-data.cjs").loadCreaturePack()),
    worldPack: require("../src/core/world-finds.cjs").loadWorldPack(), live: null,
  });
  // The meters' "good" marks live in the app's page; read them from there instead of copying them.
  const sandbox = { window: { backstage: {} } };
  vm.runInNewContext(read("src/renderer/coverage.js"), sandbox);
  return { coverage: worldMap.coverage(), KINDS: sandbox.window.CoverageView.KINDS, level: sandbox.window.CoverageView.level };
}
function coverage(c) {
  const { coverage: data, KINDS, level } = coverageData();
  const score = (z, f) => KINDS.reduce((t, [k, , , good]) => t + Math.min(1, z[f][k] / good), 0) / KINDS.length;
  const verdict = (s) => (s >= 0.7 ? ["Well covered", "good"] : s >= 0.35 ? ["Partly covered", "mid"] : ["Thin", "low"]);
  const zones = [...data.zones].sort((a, b) => a.min - b.min || a.name.localeCompare(b.name));
  const table = (f) => {
    const mine = zones.filter((z) => z.faction === f || z.faction === "Contested");
    const useful = mine.filter((z) => score(z, f) >= 0.35).length;
    const rows = mine.map((z) => { const [label, cls] = verdict(score(z, f)); return `<tr><th scope="row">${esc(z.name)}<small>Levels ${z.min}–${z.max}${z.faction === "Contested" ? " · contested" : ""}</small></th>${KINDS.map(([k, , , good]) => `<td class="bfx-n bfx-${level(z[f][k], good)}">${num(z[f][k])}</td>`).join("")}<td><span class="bfx-verdict bfx-${cls}">${label}</span></td></tr>`; }).join("");
    return `<section class="bfx-cov" id="${f.toLowerCase()}"><h2>${f}</h2><p><strong>${useful} of ${mine.length}</strong> leveling zones for ${f} players have useful coverage.</p><div class="bfx-scroll" tabindex="0" role="region" aria-label="${f} coverage by zone"><table class="bfx-table"><thead><tr><th scope="col">Zone</th>${KINDS.map(([, label]) => `<th scope="col">${esc(label)}</th>`).join("")}<th scope="col">Overall</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  };
  // Totals straight from the bundled packs.
  const pack = json("data/forever/pack.json"), transport = json("data/forever-transport/pack.json"), trainers = json("data/forever-trainers/pack.json");
  const vendors = json("data/forever-vendors/pack.json"), world = json("data/forever-world/pack.json"), boss = Object.values(json("data/forever-boss-loot/pack.json").instances);
  const creatures = json("data/forever-creatures/pack.json");
  const quests = Object.values(pack.quests), sideOf = (s) => transport.nodes.filter((n) => n.side === s).length;
  const totals = [
    ["Quests", [[num(quests.length), "quests known by name"], [num(quests.filter((q) => q.givers?.length).length), "with a quest giver"], [num(quests.filter((q) => q.objectiveLocations?.some((o) => o.positions?.length)).length), "with an objective place"], [num(quests.filter((q) => q.observedInPlay).length), "seen in play by other players"]]],
    ["People and places", [[num(Object.values(pack.npcs).filter((n) => n.positions?.length).length), "quest NPCs with a position"], [num(vendors.counts.vendors), "vendors"], [num(vendors.counts.listings), "things they sell"], [num(world.mailboxes.length), "mailboxes"]]],
    ["Training", [[num(trainers.counts.trainers), "trainers"], [num(trainers.counts.classServices), "class skills with a level or price"], [num(trainers.counts.professionServices), "profession recipes and ranks taught"], [num(trainers.counts.weaponServices + trainers.counts.ridingServices), "weapon and riding lessons"]]],
    ["Travel", [[num(transport.counts.nodes), `flight points (${sideOf("Alliance")} Alliance, ${sideOf("Horde")} Horde)`], [num(transport.counts.edges), "flight connections"], [num(transport.counts.timedEdges), "with a recorded flight time"], [num(transport.counts.pricedEdges), "with a recorded price"]]],
    ["The world", [[num(world.rares.length), "rare enemies"], [num(world.rares.filter((r) => r.positions.length).length), "of them with a place"], [num(world.nodes.reduce((s, n) => s + n.positions.length, 0)), `herb and ore spots (${world.nodes.length} kinds)`], [num(world.chests.reduce((s, n) => s + n.positions.length, 0)), "chest spots"]]],
    ["Dungeons and enemies", [[num(boss.length), "dungeons and raids"], [num(boss.reduce((s, i) => s + i.bosses.length, 0)), "bosses"], [num(boss.reduce((s, i) => s + i.bosses.filter((b) => b.items.length).length, 0)), "bosses with recorded loot"], [num(Object.keys(creatures.creatures).length), "enemies with level and type"]]],
  ];
  const tiles = totals.map(([title, rows]) => `<section class="bfx-total"><h3>${esc(title)}</h3><dl>${rows.map(([n, label]) => `<div><dt>${n}</dt><dd>${esc(label)}</dd></div>`).join("")}</dl></section>`).join("");
  const builds = (data.source.builds || []).map((b) => (typeof b === "string" ? b : b.build)).filter(Boolean);
  return page(c, "coverage.html", `<section class="bfx-section"><div class="bfx-wrap"><nav class="bfx-jump" aria-label="On this page"><a href="#totals">Totals</a><a href="#alliance">Alliance</a><a href="#horde">Horde</a><a href="#honest-notes">What is still thin</a></nav>
<section class="bfx-cov" id="totals"><h2>What the app carries</h2><div class="bfx-totals">${tiles}</div></section>
${table("Alliance")}
${table("Horde")}
<section class="bfx-cov" id="honest-notes"><h2>What is still thin</h2><div class="bfx-notes"><p>A zero means nobody has recorded it yet, not that it does not exist. In a thin zone the app has less to point at, and it says so instead of guessing. Reference data that was not checked on your game build is labelled.</p><p>Flight times and prices exist only for connections players have flown and recorded. Boats, zeppelins, the tram and portals are not in the travel data.</p><p>More than half of all profession recipes have no recorded source yet, and the recipe book says so for each one. Key and attunement directions are classic reference text, not checked in WoW Forever.</p><p>Item names, talents and recipes are read from your own game files and are not counted here.</p></div></section>
<p class="bfx-foot">Counts come from community observations bundled with the app (${esc(data.source.attribution || "Efficient Games, CC BY 4.0")}${builds.length ? `; game builds ${esc(builds.join(", "))}` : ""}${data.source.observedThrough ? `; observed through ${esc(data.source.observedThrough)}` : ""}).</p></div></section>`);
}

// ---------- sitemap ----------
// The date is only ever the one given with --date: never the clock, a file time or git, so a build is the same on every machine.
const sitemap = (date) => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${ORDER.map((f) => `  <url><loc>${urlOf(f)}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`).join("\n")}\n</urlset>\n`;
const withoutDates = (xml) => xml.replace(/\r\n/g, "\n").replace(/<lastmod>[^<]*<\/lastmod>/g, "");

// ---------- checks ----------
function checkLinks(site, files) {
  const problems = [];
  for (const [file, html] of Object.entries(files)) {
    if (!file.endsWith(".html")) continue;
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const urls = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]);
    for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1].split(",")) urls.push(part.trim().split(/\s+/)[0]);
    for (const url of urls) {
      // Site-wide files and outside links are not this folder's to check.
      if (/^(https?:|mailto:)/.test(url) || url.startsWith("/")) continue;
      if (url.startsWith("#")) { if (url.length > 1 && !ids.has(url.slice(1))) problems.push(`${file}: no element with id ${url}`); continue; }
      if (!url.startsWith("./")) { problems.push(`${file}: ${url} is not written as a relative ./ link`); continue; }
      const [target, hash] = url.slice(2).split("#");
      const name = target === "" ? "index.html" : target.split("?")[0];
      const text = files[name] ?? (fs.existsSync(path.join(site, name)) ? (name.endsWith(".html") ? fs.readFileSync(path.join(site, name), "utf8") : "") : null);
      if (text === null) problems.push(`${file}: ${url} does not exist`);
      else if (hash && !new RegExp(`\\sid="${hash}"`).test(text)) problems.push(`${file}: ${url} has no such anchor`);
    }
    if (/<script(?![^>]*\ssrc="(?:\/|\.\/)[^"]*")(?![^>]*type="application\/ld\+json")/.test(html) || /<(?:script|link|img|source)\b[^>]*\s(?:src|href)="https?:\/\/[^"]*"/.test(html.replace(/<link rel="canonical"[^>]*>/, ""))) problems.push(`${file}: loads a script, style, font or picture from another site`);
    if (/no desktop app required/i.test(html)) problems.push(`${file}: says the desktop app is optional`);
  }
  return problems;
}
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
// What a search engine and a first-time visitor need from every page.
function audit(files) {
  const problems = [], seen = { title: new Map(), description: new Map() };
  for (const [file, html] of Object.entries(files)) {
    if (!file.endsWith(".html")) continue;
    const say = (text) => problems.push(`${file}: ${text}`);
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "", description = attr(/<meta name="description"[^>]*>/.exec(html)?.[0] ?? "", "content") ?? "";
    const plain = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    for (const [kind, value] of [["title", plain(title)], ["description", plain(description)]]) {
      if (!value) say(`no ${kind}`);
      else if (value.length > LIMITS[kind]) say(`${kind} is ${value.length} characters (limit ${LIMITS[kind]})`);
      if (seen[kind].has(value)) say(`same ${kind} as ${seen[kind].get(value)}`);
      seen[kind].set(value, file);
    }
    if (!/<html lang="en">/.test(html)) say("no lang attribute");
    if (attr(/<link rel="canonical"[^>]*>/.exec(html)?.[0] ?? "", "href") !== urlOf(file)) say("canonical link is missing or wrong");
    for (const name of ["og:title", "og:description", "og:url", "og:image"]) if (!new RegExp(`<meta property="${name}" content="[^"]+">`).test(html)) say(`no ${name}`);
    if (!/<meta name="twitter:card" content="summary_large_image">/.test(html)) say("no twitter card");
    const h1 = html.match(/<h1\b/g) || [];
    if (h1.length !== 1) say(`${h1.length} h1 headings (wanted one)`);
    // Headings never skip a level on the way down.
    let last = 0;
    for (const m of html.slice(html.indexOf('<main id="main"'), html.indexOf("</main>")).matchAll(/<h([1-6])\b/g)) { const level = Number(m[1]); if (last && level > last + 1) say(`an h${level} follows an h${last}`); last = level; }
    for (const tag of html.match(/<img\b[^>]*>/g) || []) {
      const src = attr(tag, "src");
      if (attr(tag, "alt") === undefined) say(`${src} has no alt text`);
      if (!/^\d+$/.test(attr(tag, "width") ?? "") || !/^\d+$/.test(attr(tag, "height") ?? "")) say(`${src} has no width and height`);
    }
    for (const m of html.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)) { try { const d = JSON.parse(m[1]); if (d["@context"] !== "https://schema.org" || !d["@type"]) say("structured data without a type"); } catch { say("structured data does not parse"); } }
    for (const m of html.matchAll(/<a\b[^>]*>([^]*?)<\/a>/g)) if (/^\s*(?:click here|here|more|read more|link)\s*$/i.test(m[1].replace(/<[^>]+>/g, ""))) say(`a link says only "${m[1].trim()}"`);
    if (!/not affiliated with or endorsed by Blizzard Entertainment/.test(html)) say("no Blizzard notice");
    if (!/data-download="windows"[^>]*>Download for Windows — free</.test(html)) say("no Windows download button");
  }
  return problems;
}

function build(site, { date = null } = {}) {
  const indexPath = path.join(site, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`${indexPath} not found. Copy the live backstage-forever folder there first.`);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date wants YYYY-MM-DD");
  const c = chrome(fs.readFileSync(indexPath, "utf8")), ctx = { site, missing: [] };
  const files = { "index.html": home(c, ctx), "tour.html": tour(c, ctx), "download.html": download(c), "whats-new.html": whatsNew(c), "commands.html": commands(c), "coverage.html": coverage(c),
    "site.css": read("site/site.css"), "sitemap-backstage-forever.xml": sitemap(date) };
  if (!fs.existsSync(path.join(site, OG.file))) ctx.missing.push(OG.file);
  const shots = `node scripts/site-screenshots.cjs work/site-shots --webp ${path.join(site, "tour")} --og ${path.join(site, OG.file)}`;
  return { files, problems: [...[...new Set(ctx.missing)].map((f) => `${f} is missing: run ${shots}`), ...checkLinks(site, files), ...audit(files)] };
}

if (require.main === module) {
  const args = process.argv.slice(2), check = args.includes("--check");
  const dateAt = args.indexOf("--date"), date = dateAt < 0 ? undefined : args.splice(dateAt, 2)[1];
  const site = args.find((a) => !a.startsWith("--"));
  if (!site) { console.error("Usage: node scripts/build-site.cjs SITE_DIR [--check] [--date YYYY-MM-DD]"); process.exit(2); }
  const { files, problems } = build(path.resolve(site), date ? { date } : {});
  if (check) for (const [name, text] of Object.entries(files)) {
    const file = path.join(site, name), same = (a, b) => (name.endsWith(".xml") ? withoutDates(a) === withoutDates(b) : a === b);
    if (!fs.existsSync(file) || !same(fs.readFileSync(file, "utf8"), text)) problems.push(`${name} is stale: run node scripts/build-site.cjs ${site}`);
  } else for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(site, name), text);
  for (const p of problems) console.error(p);
  if (problems.length) process.exit(1);
  console.log(check ? "Website pages are current, every link resolves and every page passes the checks." : `Wrote ${Object.keys(files).join(", ")} to ${path.resolve(site)}`);
}
module.exports = { build, chrome, checkLinks, audit, imageSize, stableReleases, tagline, sitemap, FEATURES, MORE, HERO_SHOT, PAGES, ORDER, OG, LIMITS, BASE };
