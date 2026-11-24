"use strict";
// Website pages (scripts/build-site.cjs) and winget manifests (scripts/build-winget.cjs).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const site = require("../scripts/build-site.cjs");
const content = require("../site/content.cjs");
const winget = require("../scripts/build-winget.cjs");
const pkg = require("../package.json");

// What the live folder's page looks like to the generator: the parent site's frame around <main>.
const INDEX = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fixture</title><link rel="stylesheet" href="/css/products.css?v=1"><link rel="stylesheet" href="./landing.css"></head><body>
<a class="skip" href="#main">Skip to content</a><header class="site-head"><nav><a href="./" aria-current="page">Backstage Forever</a></nav></header>
<main id="main"><section id="setup"><h1>Old page</h1><a class="btn" data-download="windows" href="https://github.com/farena-ai/Backstage-Forever/releases/latest">Download for Windows</a></section></main><footer class="footer"><a href="/contact.html">Contact</a></footer><script src="/js/products.js?v=1" defer></script><script src="./desktop-downloads.js" defer></script></body></html>`;
const PAGES = ["commands.html", "coverage.html", "download.html", "index.html", "tour.html", "whats-new.html"];
const SHOTS = [site.HERO_SHOT, ...[...site.FEATURES, site.MORE].flatMap((f) => f.shots)];
const DATE = "2026-11-24";

// Picture files as headers only: enough for their size to be read.
function pngHeader(w, h) { const b = Buffer.alloc(24); b.write("\x89PNG\r\n\x1a\n", 0, "latin1"); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "latin1"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; }
function webpHeader(w, h) { const b = Buffer.alloc(30); b.write("RIFF", 0, "latin1"); b.write("WEBPVP8 ", 8, "latin1"); b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); return b; }
function fixtureSite(t, { pictures = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-site-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "index.html"), INDEX);
  for (const name of ["landing.css", "desktop-downloads.js", site.OG.file]) fs.writeFileSync(path.join(dir, name), "");
  for (const [name, w, h] of [["crest.png", 512, 512], ["compass.png", 624, 438], ["helpers.png", 672, 504]]) fs.writeFileSync(path.join(dir, name), pngHeader(w, h));
  fs.writeFileSync(path.join(dir, "journey.webp"), webpHeader(1680, 722));
  fs.mkdirSync(path.join(dir, "tour"));
  if (pictures) for (const [name] of SHOTS) for (const suffix of ["", "-800"]) fs.writeFileSync(path.join(dir, "tour", `${name}${suffix}.webp`), "");
  return dir;
}
const built = (t, options) => site.build(fixtureSite(t, options), { date: DATE });
const html = (files) => Object.entries(files).filter(([name]) => name.endsWith(".html"));
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const structured = (page) => [...page.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("the website builds from the repo, with working links and the parent site's frame", (t) => {
  const { files, problems } = built(t);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(files).sort(), [...PAGES, "site.css", "sitemap-backstage-forever.xml"].sort());
  for (const [name, page] of html(files)) {
    assert.match(page, /<a class="skip" href="#main">/, `${name} keeps the site header`);
    assert.match(page, /<footer class="footer">/, `${name} keeps the site footer`);
    assert.match(page, /<link rel="stylesheet" href="\/css\/products\.css\?v=1"><link rel="stylesheet" href="\.\/site\.css">/, `${name} keeps the parent stylesheet and adds its own`);
    assert.doesNotMatch(page, /landing\.css|tour\.css/, `${name} needs no other stylesheet from the folder`);
    assert.match(page, /<script src="\.\/desktop-downloads\.js" defer><\/script>/, `${name} keeps the download script`);
    assert.doesNotMatch(page, /no desktop app required/i);
    // Nothing from another site is loaded: no scripts, styles, fonts or images.
    assert.doesNotMatch(page.replace(/<link rel="canonical"[^>]*>/, ""), /<(?:script|link|img|source)\b[^>]*(?:src|href)="https?:/);
    assert.doesNotMatch(page, /fonts\.googleapis|googletagmanager|google-analytics/i, `${name} has no tracker or outside font`);
  }
  assert.equal(files["site.css"], fs.readFileSync(path.join(__dirname, "../site/site.css"), "utf8"));
});

test("every page carries the download call to action, top and bottom, in a form the download script understands", (t) => {
  const { files } = built(t);
  const latest = "https://github.com/farena-ai/Backstage-Forever/releases/latest";
  for (const [name, page] of html(files)) {
    const buttons = page.match(/<a class="bfx-btn" data-download="windows" href="[^"]*">Download for Windows — free<\/a>/g) || [];
    assert.ok(buttons.length >= 2, `${name} has the button ${buttons.length} times`);
    assert.match(page, /The app installs and updates the in-game addon for you\./, name);
    assert.match(page, /data-download="arm"[^>]*>macOS on Apple silicon</, name);
    assert.match(page, /data-download="intel"[^>]*>macOS on Intel</, name);
    assert.match(page, /<a class="bf-release" href="[^"]*">/, `${name} has the release link the script renames`);
    // Without JavaScript every download link is the plain latest-release page; no version is written into a link.
    for (const m of page.matchAll(/<a\b[^>]*data-download="(\w+)"[^>]*>/g)) {
      assert.ok(["windows", "arm", "intel", "linux", "addon"].includes(m[1]), m[1]);
      assert.ok(m[0].includes(`href="${latest}"`), m[0]);
    }
    assert.match(page, /not affiliated with or endorsed by Blizzard Entertainment/, `${name} carries the notice`);
  }
  // The home page and the download page offer every download, one sentence each.
  for (const key of ["windows", "arm", "intel", "linux", "addon"]) for (const name of ["index.html", "download.html"]) assert.match(files[name], new RegExp(`<li id="[a-z-]+"[^>]*><h3>[^<]+</h3><p>[^<]+</p><a class="bfx-btn[^"]*" data-download="${key}"`), `${name}: ${key}`);
});

test("the home page is written for a first-time visitor and for search", (t) => {
  const { files } = built(t);
  const page = files["index.html"], main = page.slice(page.indexOf("<main"), page.indexOf("</main>"));
  assert.match(page, /<h1 id="title">Backstage Forever <span>The free companion app and addon for WoW Forever<\/span><\/h1>/);
  // The call to action comes before the first picture of the app.
  assert.ok(main.indexOf("Download for Windows — free") < main.indexOf("bfx-heroshot"));
  // One section per thing players look for, each with a heading, plain text and one described picture.
  assert.equal(content.FEATURES.length, 10);
  const { CATALOG } = require("../src/renderer/commands.js");
  for (const f of content.FEATURES) {
    const section = new RegExp(`<section class="bfx-feature[^"]*" id="${f.id}">([^]*?)</section>`).exec(main)?.[1];
    assert.ok(section, f.id);
    assert.ok(section.includes(`<h2>${f.h2}</h2>`), f.id);
    assert.ok(f.text.length >= 2 && f.text.length <= 3, `${f.id}: two or three paragraphs`);
    assert.equal((section.match(/<img\b/g) || []).length, 1, `${f.id}: one picture`);
    assert.ok(f.shots.some((s) => s[0] === f.home), `${f.id}: its home picture is one of its pictures`);
    assert.ok(section.includes(`href="./tour.html#${f.id}"`), `${f.id} links to its part of the tour`);
    // Every /bf command a section names is a real one.
    for (const c of f.commands) assert.ok(CATALOG.some((row) => row.command.startsWith(c.split(" ").slice(0, 2).join(" "))), `${f.id}: ${c}`);
  }
  for (const id of ["how-it-works", "privacy", "faq", "in-game", "download"]) assert.match(main, new RegExp(`<section[^>]* id="${id}"`), id);
  assert.equal((/<ol class="bfx-steps">([^]*?)<\/ol>/.exec(main)[1].match(/<li>/g) || []).length, 4, "four steps");
  // The desktop app is the product; the addon alone is never offered as the main download.
  assert.match(text(main), /The desktop app is Backstage Forever\./);
  assert.ok(content.DOWNLOADS[0].key === "windows" && content.DOWNLOADS[0].main);
  assert.equal(content.DOWNLOADS.filter((d) => d.main).length, 1);
  // The hand-written layout lives in the repo's template, and the build fills every blank in it.
  const template = fs.readFileSync(path.join(__dirname, "../site/index.template.html"), "utf8");
  for (const blank of ["head", "header", "cta", "features", "faq", "downloads", "footer", "scripts"]) assert.ok(template.includes(`{{${blank}}}`), blank);
  assert.doesNotMatch(page, /\{\{[\w:.-]+\}\}/);
  assert.match(page, /<img src="\.\/journey\.webp" alt="" width="1680" height="722" fetchpriority="high">/);
  assert.match(page, /It installs and updates its in-game addon for you/);
});

test("titles, descriptions, headings, pictures and structured data pass on every page", (t) => {
  const { files } = built(t);
  const titles = new Set(), descriptions = new Set();
  for (const [name, page] of html(files)) {
    const title = text(/<title>([^<]*)<\/title>/.exec(page)[1]), description = text(/<meta name="description" content="([^"]*)">/.exec(page)[1]);
    assert.ok(title.length >= 20 && title.length <= 60, `${name}: title is ${title.length} characters`);
    assert.ok(description.length >= 70 && description.length <= 155, `${name}: description is ${description.length} characters`);
    assert.ok(!titles.has(title) && !descriptions.has(description), `${name}: title and description are its own`);
    titles.add(title); descriptions.add(description);
    assert.match(title, /Backstage Forever/, name);
    assert.match(page, /<html lang="en">/, name);
    const url = site.BASE + (name === "index.html" ? "" : name);
    assert.ok(page.includes(`<link rel="canonical" href="${url}">`), `${name}: canonical`);
    assert.ok(page.includes(`<meta property="og:url" content="${url}">`), name);
    for (const tag of ["og:title", "og:description", "og:type", "og:site_name", "og:image:alt"]) assert.match(page, new RegExp(`<meta property="${tag}" content="[^"]+">`), `${name}: ${tag}`);
    assert.ok(page.includes(`<meta property="og:image" content="${site.BASE}${site.OG.file}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`), name);
    assert.match(page, /<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="[^"]+"><meta name="twitter:description" content="[^"]+"><meta name="twitter:image" content="[^"]+">/, name);
    assert.equal((page.match(/<h1\b/g) || []).length, 1, `${name}: one h1`);
    const levels = [...page.slice(page.indexOf("<main"), page.indexOf("</main>")).matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels[0], 1, `${name}: starts with its h1`);
    levels.forEach((level, i) => assert.ok(i === 0 || level <= levels[i - 1] + 1, `${name}: an h${level} follows an h${levels[i - 1]}`));
    const images = page.match(/<img\b[^>]*>/g) || [];
    for (const tag of images) {
      assert.match(tag, /\salt="[^"]*"/, `${name}: ${tag}`);
      assert.match(tag, /\swidth="\d+" height="\d+"/, `${name}: ${tag}`);
      // A screenshot says what is on it; only decoration (the crest, the hero painting) has an empty alt.
      if (/src="\.\/(?:tour\/|compass|helpers)/.test(tag)) assert.ok(/\salt="([^"]{30,})"/.test(tag), `${name}: ${tag}`);
      if (/src="\.\/tour\//.test(tag)) assert.match(tag, /-800\.webp 800w, \.\/tour\/[\w-]+\.webp 1600w" sizes="[^"]+"/, `${name}: ${tag}`);
    }
    // Only the first picture loads at once; everything further down waits until it is near.
    const eager = images.filter((tag) => /src="\.\/(?:tour\/|compass|helpers)/.test(tag) && !/loading="lazy"/.test(tag));
    assert.ok(eager.length <= 1, `${name}: ${eager.length} pictures load at once`);
    for (const data of structured(page)) assert.equal(data["@context"], "https://schema.org", name);
    if (name !== "index.html") {
      const crumbs = structured(page).find((d) => d["@type"] === "BreadcrumbList");
      assert.deepEqual(crumbs.itemListElement.map((x) => [x.position, x.item]), [[1, "https://backstagecoding.com/"], [2, site.BASE], [3, url]], name);
      assert.match(page, /<p class="bfx-crumbs"><a href="\.\/">Backstage Forever<\/a> \/ /, name);
    }
    // The shared links between the pages, with the current one marked.
    const nav = /<nav class="bfx-nav"[^>]*>([^]*?)<\/nav>/.exec(page)[1];
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), site.ORDER.map((f) => (f === "index.html" ? "./" : `./${f}`)), name);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, name);
  }
  const home = structured(files["index.html"]);
  const app = home.find((d) => d["@type"] === "SoftwareApplication");
  assert.equal(app.name, "Backstage Forever");
  assert.deepEqual(app.offers, { "@type": "Offer", price: "0", priceCurrency: "USD" });
  assert.equal(app.downloadUrl, "https://github.com/farena-ai/Backstage-Forever/releases/latest");
  assert.equal(app.softwareVersion, undefined, "no version to go stale");
  assert.match(app.operatingSystem, /Windows.*macOS.*Linux/);
  assert.ok(["GameApplication", "UtilitiesApplication"].includes(app.applicationCategory));
  assert.equal(app.license, "https://opensource.org/licenses/MIT");
  assert.equal(pkg.license, "MIT");
  assert.equal(app.author.name, "Frank Arena");
  assert.equal(app.aggregateRating, undefined, "no invented ratings");
  const faq = home.find((d) => d["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 6 && faq.mainEntity.length <= 8);
  const visible = text(files["index.html"]);
  for (const q of faq.mainEntity) { assert.ok(visible.includes(q.name), q.name); assert.ok(visible.includes(q.acceptedAnswer.text), `the answer to "${q.name}" is on the page as written`); }
  assert.deepEqual(site.audit(files), []);
});

test("the checks catch a page that breaks the rules", () => {
  const good = `<html lang="en"><title>A title that is long enough here</title><meta name="description" content="d"><link rel="canonical" href="${site.BASE}tour.html"><main id="main"><h1>One</h1></main>`;
  const found = (page) => site.audit({ "tour.html": page }).join("\n");
  assert.match(found(good.replace("<h1>One</h1>", "<h1>One</h1><h1>Two</h1>")), /2 h1 headings/);
  assert.match(found(good.replace("<h1>One</h1>", "<h1>One</h1><h3>Deep</h3>")), /an h3 follows an h1/);
  assert.match(found(good.replace("</main>", '<img src="./a.webp" width="1" height="1"></main>')), /a\.webp has no alt text/);
  assert.match(found(good.replace("</main>", '<img src="./a.webp" alt="x"></main>')), /a\.webp has no width and height/);
  assert.match(found(good.replace("A title that is long enough here", "x".repeat(61))), /title is 61 characters/);
  assert.match(found(good.replace('content="d"', `content="${"y".repeat(156)}"`)), /description is 156 characters/);
  assert.match(found(good.replace("</main>", '<script type="application/ld+json">{oops</script></main>')), /structured data does not parse/);
  assert.match(found(good.replace("</main>", '<a href="./x.html">click here</a></main>')), /a link says only/);
  assert.match(found(good), /no Blizzard notice/);
  assert.match(found(good), /no og:title/);
  assert.equal(site.checkLinks(os.tmpdir(), { "a.html": '<img src="https://example.com/a.png">' }).length, 1);
});

test("picture sizes are read from the files", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bf-site-img-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const png = pngHeader(624, 438), lossy = webpHeader(1348, 1000);
  const extended = Buffer.alloc(30); extended.write("RIFF", 0, "latin1"); extended.write("WEBPVP8X", 8, "latin1"); extended.writeUIntLE(1599, 24, 3); extended.writeUIntLE(999, 27, 3);
  for (const [name, bytes] of [["a.png", png], ["b.webp", lossy], ["c.webp", extended], ["d.webp", Buffer.alloc(0)]]) fs.writeFileSync(path.join(dir, name), bytes);
  assert.deepEqual(site.imageSize(path.join(dir, "a.png")), { w: 624, h: 438 });
  assert.deepEqual(site.imageSize(path.join(dir, "b.webp")), { w: 1348, h: 1000 });
  assert.deepEqual(site.imageSize(path.join(dir, "c.webp")), { w: 1600, h: 1000 });
  assert.equal(site.imageSize(path.join(dir, "d.webp")), null);
  assert.equal(site.imageSize(path.join(dir, "missing.webp")), null);
});

test("only the what's new page carries app version numbers", (t) => {
  const { files } = built(t);
  const latest = site.stableReleases()[0];
  assert.equal(latest.channel, "stable");
  assert.ok(files["whats-new.html"].includes(`Version ${latest.version}`));
  assert.ok(files["whats-new.html"].includes(site.tagline(latest).replace(/&/g, "&amp;")));
  assert.doesNotMatch(files["whats-new.html"], /preview/i);
  // The game's own build numbers (1.60.1.x) are data; the app's version must not be written into the other pages.
  const appVersion = /\b\d+\.\d+\.\d+\b(?!\.\d)/;
  for (const name of PAGES.filter((p) => p !== "whats-new.html")) assert.doesNotMatch(files[name].replace(/\?v=[\w.-]+/g, "").replace(/\b\d+\.\d+\.\d+\.\d+\b/g, ""), appVersion, name);
});

test("the commands page lists every command with its own anchor and the coverage page both factions", (t) => {
  const { files } = built(t);
  const { CATALOG } = require("../src/renderer/commands.js");
  const esc = (v) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const page = files["commands.html"];
  for (const row of CATALOG) assert.ok(page.includes(`<dt><code>${esc(row.command)}</code></dt>`), row.command);
  // Findable without JavaScript: an index of links, one anchor per command.
  const anchors = [...page.matchAll(/<div class="bfx-cmd" id="(cmd-[a-z0-9-]+)">/g)].map((m) => m[1]);
  assert.equal(anchors.length, CATALOG.length);
  assert.equal(new Set(anchors).size, anchors.length, "every anchor is its own");
  const index = /<div class="bfx-index" id="all-commands">([^]*?)<\/div>/.exec(page)[1];
  assert.deepEqual([...index.matchAll(/href="#(cmd-[a-z0-9-]+)"/g)].map((m) => m[1]), anchors);
  for (const faction of ["Alliance", "Horde"]) assert.match(files["coverage.html"], new RegExp(`<section class="bfx-cov" id="${faction.toLowerCase()}"><h2>${faction}</h2><p><strong>\\d+ of \\d+</strong>`));
  assert.match(files["coverage.html"], /The Barrens/);
  assert.match(files["coverage.html"], /A zero means nobody has recorded it yet/);
});

test("the tour shows every picture once, grouped like the home page", (t) => {
  const { files } = built(t);
  const page = files["tour.html"];
  for (const [name, , alt] of SHOTS.slice(1)) {
    assert.equal(page.split(`src="./tour/${name}-800.webp"`).length, 2, name);
    assert.ok(alt.length >= 40 && alt.length <= 220, `${name}: alt text is ${alt.length} characters`);
  }
  assert.equal(new Set(SHOTS.map((s) => s[0])).size, SHOTS.length, "no picture is listed twice");
  // The screenshot script takes exactly the pictures the pages use.
  assert.deepEqual(require("../scripts/site-shots.cjs").map((s) => s.name).sort(), SHOTS.map((s) => s[0]).sort());
  const order = [...page.matchAll(/<section class="bfx-tour-group[^"]*" id="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [...content.FEATURES.map((f) => f.id), "more", "in-game"]);
});

test("building twice changes nothing, and the sitemap lists every page", (t) => {
  const dir = fixtureSite(t);
  const first = site.build(dir, { date: DATE }).files;
  for (const [name, body] of Object.entries(first)) fs.writeFileSync(path.join(dir, name), body);
  const second = site.build(dir, { date: DATE });
  assert.deepEqual(second.problems, []);
  assert.deepEqual(second.files, first, "the frame is read back from the generated page unchanged");
  assert.ok(first["index.html"].includes('<header class="site-head"><nav><a href="./" aria-current="page">Backstage Forever</a></nav></header>\n<main id="main" class="bfx-page">'));
  assert.ok(first["index.html"].endsWith('</main><footer class="footer"><a href="/contact.html">Contact</a></footer><script src="/js/products.js?v=1" defer></script><script src="./desktop-downloads.js" defer></script></body></html>\n'));
  assert.doesNotMatch(first["index.html"], /Old page/);
  const map = first["sitemap-backstage-forever.xml"];
  assert.deepEqual([...map.matchAll(/<url><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/url>/g)].map((m) => [m[1], m[2]]), site.ORDER.map((f) => [site.BASE + (f === "index.html" ? "" : f), DATE]));
  assert.throws(() => site.build(dir, { date: "24.11.2026" }));
});

test("a missing picture or a broken link is reported", (t) => {
  const { problems } = built(t, { pictures: false });
  assert.ok(problems.some((p) => p.includes("tour/now.webp is missing")));
  assert.ok(problems.some((p) => p.includes("tour/recipe-book-800.webp is missing")));
  assert.deepEqual(site.checkLinks(os.tmpdir(), { "a.html": '<a href="./nowhere.html">x</a><a href="tour.html">y</a><a href="#gone">z</a><img srcset="./gone-800.webp 800w">' }).length, 4);
});

test("winget manifests come from package.json and take the installer hash", () => {
  const files = winget.manifests({ pkg, sha256: "ab".repeat(32) });
  assert.deepEqual(Object.keys(files), [`${winget.ID}.yaml`, `${winget.ID}.installer.yaml`, `${winget.ID}.locale.en-US.yaml`]);
  const installer = files[`${winget.ID}.installer.yaml`];
  assert.ok(installer.includes(`PackageVersion: ${pkg.version}\n`));
  assert.ok(installer.includes(`/releases/download/v${pkg.version}/${winget.installerName(pkg.version)}\n`));
  assert.ok(installer.includes(`InstallerSha256: ${"AB".repeat(32)}\n`));
  assert.match(installer, /InstallerType: nullsoft\nScope: user\n/);
  // The installer name is the one electron-builder is told to write.
  assert.equal(winget.installerName("1.2.3"), pkg.build.artifactName.replace("${version}", "1.2.3").replace("${arch}", "x64").replace("${ext}", "exe"));
  assert.ok(winget.manifests({ pkg })[`${winget.ID}.installer.yaml`].includes(winget.OPEN_HASH), "no hash given: left open, never guessed");
  assert.throws(() => winget.manifests({ pkg, sha256: "abc" }));
  assert.throws(() => winget.manifests({ pkg, version: "1.2" }));
  const short = /ShortDescription: "(.*)"/.exec(files[`${winget.ID}.locale.en-US.yaml`])[1];
  assert.ok(short.length >= 3 && short.length <= 256);
});

test("the Linux build is an x64 AppImage with its own file name", () => {
  assert.deepEqual(pkg.build.linux.target, [{ target: "AppImage", arch: ["x64"] }]);
  assert.equal(pkg.build.linux.artifactName, "Backstage-Forever-${version}-Linux-x64.${ext}");
  assert.match(pkg.scripts["dist:linux"], /--linux AppImage --x64 --publish never/);
  const release = fs.readFileSync(path.join(__dirname, "../.github/workflows/release.yml"), "utf8");
  const linux = release.slice(release.indexOf("\n  linux:"));
  assert.match(linux, /needs: \[release, mac\]/, "after the Mac job: both rewrite SHA256SUMS.txt");
  assert.match(linux, /grep -v -- '-Linux-' > sums\.tmp/);
  assert.doesNotMatch(linux, /backstage-update\.json/, "the Windows update file is not touched");
});
