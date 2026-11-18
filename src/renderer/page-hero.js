"use strict";
// One painted banner for every page: eyebrow, title, a line of real information and the page's art.
// Art lives in art/heroes/<page>.webp; page-hero.css layers art/hero-help.webp underneath, so a
// painting that has not shipped yet falls back without breaking the page.
// eyebrow, title, subtitle and aside are HTML: callers escape any player or game text.
window.PageHero = (() => {
  const ART = Object.freeze(["adventure", "quests", "professions", "plans", "party", "characters", "dungeons", "talents", "journey", "badges", "coverage", "commands", "companion", "now", "settings", "field-guide", "ledger", "ledger-gold", "ledger-reputation", "ledger-cooldowns"]);
  const known = (art) => (ART.includes(art) ? art : "settings");
  // character is an optional local profile; motion:false makes this banner static.
  function render({ art, eyebrow = "", title = "", subtitle = "", crest = "", crestHtml = "", aside = "", compact = false, attrs = "", titleAttrs = "", subAttrs = "", character, motion = true } = {}) {
    const key = known(art);
    const identity = character ? characterIdentity(character) : !crestHtml && crestIdentity(crest, key);
    const image = crestHtml || (identity ? identityArt(identity) : crest ? `<img class="ph-crest" src="${esc(crest)}" alt="" width="84" height="84">` : "");
    return `<header class="page-hero ph-art-${key}${compact ? " compact" : ""}${identity ? " ph-identity" : ""}" data-page-hero="${key}"${identity?.faction ? ` data-ph-faction="${identity.faction}"` : ""}${motion === false ? ' data-ph-motion="off"' : ""}${attrs ? " " + attrs : ""}>`
      + `<span class="ph-faction" aria-hidden="true"></span>`
      + `<div class="ph-copy">${image}<div class="ph-words">`
      + (eyebrow ? `<span class="ph-eyebrow">${eyebrow}</span>` : "")
      + `<h1${titleAttrs ? " " + titleAttrs : ""}>${title}</h1>${subtitle || subAttrs ? `<p class="ph-sub"${subAttrs ? " " + subAttrs : ""}>${subtitle}</p>` : ""}${identity ? identityDetails(identity) : ""}</div></div>`
      + (aside ? `<div class="ph-aside">${aside}</div>` : "")
      + `</header>`;
  }
  // Class crests are the same painted set everywhere (art/classes/<class>.png).
  const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
  const classCrest = (className) => {
    const key = String(className || "").toLowerCase().replace(/[^a-z]/g, "");
    return CLASSES.includes(key) ? `art/classes/${key}.png` : "";
  };
  const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  const RACE = { forsaken: "undead", scourge: "undead" };
  const RACE_NAMES = { undead: "Forsaken", nightelf: "Night Elf", highorderskyborne: "High Order Skyborne", windshaperskyborne: "Windshaper Skyborne" };
  const text = (v) => typeof v === "string" ? v.trim() : "";
  const capitalize = (v) => v.charAt(0).toUpperCase() + v.slice(1);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const portraits = new Set(window.BF_PORTRAITS || []);
  const paintingPath = (key) => `art/portraits/${key}.webp`;
  function keys(who) {
    const race = slug(who.race), cls = slug(who.className), sex = text(who.sex).toLowerCase();
    return { race: Object.hasOwn(RACE, race) ? RACE[race] : race, cls, sex: ["male", "female"].includes(sex) ? sex : "" };
  }
  const fullKey = ({ race, sex, cls }) => race && sex && cls && `${race}-${sex}-${cls}`;
  // Retain the path API (including partial-art fallbacks) for existing image consumers.
  const portrait = (who) => {
    const c = typeof who === "string" ? { className: who } : who || {};
    const identity = keys(c), { race, cls, sex } = identity;
    const match = sex && [fullKey(identity), race && `${race}-${sex}`, cls && `${cls}-${sex}`].find((key) => portraits.has(key));
    return match ? paintingPath(match) : classCrest(c.className);
  };
  const raceName = (key, fallback) => Object.hasOwn(RACE_NAMES, key) ? RACE_NAMES[key] : fallback;
  const artNote = (kind) => `${kind} — not your exact face or gear`;
  // Full-profile heroes use a crest or neutral seal rather than substituting a partial likeness.
  function characterIdentity(c) {
    const identity = keys(c), { race, cls, sex } = identity;
    const key = fullKey(identity), painted = Boolean(key && portraits.has(key));
    const crest = classCrest(cls);
    const factionKey = text(c.faction).toLowerCase();
    const faction = ["horde", "alliance"].includes(factionKey) ? factionKey : "neutral";
    return { faction, painted, src: painted ? paintingPath(key) : crest, pin: painted ? crest : "",
      traits: [raceName(race, text(c.race)), capitalize(sex), crest ? capitalize(cls) : text(c.className)],
      label: painted ? artNote("Archetype art") : `${crest ? "Class crest" : "Journal seal"} — no matching portrait` };
  }
  // Path-only callers can label what the asset depicts, but not recover omitted profile fields.
  function crestIdentity(crest, art) {
    const [, stem, sex, cls] = /^art\/portraits\/([a-z]+)-(male|female)(?:-([a-z]+))?\.webp$/.exec(crest) || [];
    if (stem && portraits.has(cls ? `${stem}-${sex}-${cls}` : `${stem}-${sex}`)) {
      const classOnly = !cls && Boolean(classCrest(stem));
      return { src: crest, painted: true, pin: classCrest(cls || (classOnly ? stem : "")),
        traits: [classOnly ? "" : raceName(stem, capitalize(stem)), capitalize(sex), capitalize(cls || (classOnly ? stem : ""))],
        label: artNote(cls ? "Archetype art" : classOnly ? "Class archetype art" : "Race archetype art") };
    }
    const [, key] = /^art\/classes\/([a-z]+)\.png$/.exec(crest) || [];
    if (key && classCrest(key) && ["characters", "adventure"].includes(art)) return { src: crest, traits: [capitalize(key)], label: "Class crest" };
    return null;
  }
  function identityArt({ src, painted, pin }) {
    const image = src ? `<img class="ph-crest${painted ? " ph-portrait" : ""}" src="${esc(src)}" alt="" width="${painted ? 128 : 84}" height="${painted ? 128 : 84}">` : `<span class="ph-identity-seal">◇</span>`;
    return `<span class="ph-identity-art" aria-hidden="true">${image}${pin ? `<img class="ph-identity-pin" src="${esc(pin)}" alt="" width="32" height="32">` : ""}</span>`;
  }
  function identityDetails({ faction, traits, label }) {
    const factionLabel = (key) => `<span class="ph-identity-faction" data-ph-side="${key}">${capitalize(key)}</span>`;
    const side = !faction ? factionLabel("horde") + factionLabel("alliance") : faction === "neutral" ? "" : factionLabel(faction);
    const details = traits.filter(Boolean).map(esc).join(" · ");
    return `<div class="ph-identity-details">${side}${details ? `<span class="ph-identity-traits">${details}</span>` : ""}<small class="ph-identity-note">${label}</small></div>`;
  }
  // The one small, consistent note for community-sourced facts.
  const note = (text = "Community data · may differ in game") => `<p class="bf-note">${text}</p>`;
  return { render, classCrest, portrait, note, ART };
})();
