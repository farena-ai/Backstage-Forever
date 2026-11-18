"use strict";
// One painted banner for every page: eyebrow, title, a line of real information and the page's art.
// Art lives in art/heroes/<page>.webp; page-hero.css layers art/hero-help.webp underneath, so a
// painting that has not shipped yet falls back without breaking the page.
// eyebrow, title, subtitle and aside are HTML: callers escape any player or game text.
window.PageHero = (() => {
  const ART = Object.freeze(["adventure", "quests", "professions", "plans", "party", "characters", "dungeons", "talents", "journey", "badges", "coverage", "commands", "companion", "now", "settings", "field-guide", "ledger", "ledger-gold", "ledger-reputation", "ledger-cooldowns"]);
  const known = (art) => (ART.includes(art) ? art : "settings");
  function render({ art, eyebrow = "", title = "", subtitle = "", crest = "", crestHtml = "", aside = "", compact = false, attrs = "", titleAttrs = "", subAttrs = "" } = {}) {
    const key = known(art);
    return `<header class="page-hero ph-art-${key}${compact ? " compact" : ""}" data-page-hero="${key}"${attrs ? " " + attrs : ""}>`
      + `<span class="ph-faction" aria-hidden="true"></span>`
      + `<div class="ph-copy">${crestHtml || (crest ? (crest.startsWith("art/portraits/") ? `<img class="ph-crest ph-portrait" src="${crest}" alt="" width="128" height="128">` : `<img class="ph-crest" src="${crest}" alt="" width="84" height="84">`) : "")}<div class="ph-words">`
      + (eyebrow ? `<span class="ph-eyebrow">${eyebrow}</span>` : "")
      + `<h1${titleAttrs ? " " + titleAttrs : ""}>${title}</h1>${subtitle || subAttrs ? `<p class="ph-sub"${subAttrs ? " " + subAttrs : ""}>${subtitle}</p>` : ""}</div></div>`
      + (aside ? `<div class="ph-aside">${aside}</div>` : "")
      + `</header>`;
  }
  // Class crests are the same painted set everywhere (art/classes/<class>.png).
  const CLASSES = ["warrior", "paladin", "hunter", "rogue", "priest", "shaman", "mage", "warlock", "druid"];
  const classCrest = (className) => {
    const key = String(className || "").toLowerCase().replace(/[^a-z]/g, "");
    return CLASSES.includes(key) ? `art/classes/${key}.png` : "";
  };
  // A character's own portrait: the most specific painting that ships, matched on race, sex and
  // class (Rolica, a female Forsaken priest, gets exactly that), then race and sex, then class and
  // sex, then the class crest. Unknown sex never guesses one.
  const slug = (v) => String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  const RACE = { forsaken: "undead", scourge: "undead" };
  const portrait = (who) => {
    const c = typeof who === "string" ? { className: who } : who || {};
    const cls = slug(c.className), sex = c.sex === "male" || c.sex === "female" ? c.sex : "", race = RACE[slug(c.race)] || slug(c.race);
    const have = new Set(window.BF_PORTRAITS || []);
    for (const key of sex ? [race && cls && `${race}-${sex}-${cls}`, race && `${race}-${sex}`, cls && `${cls}-${sex}`] : [])
      if (key && have.has(key)) return `art/portraits/${key}.webp`;
    return classCrest(c.className);
  };
  // The one small, consistent note for community-sourced facts.
  const note = (text = "Community data · may differ in game") => `<p class="bf-note">${text}</p>`;
  return { render, classCrest, portrait, note, ART };
})();
