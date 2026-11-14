"use strict";
// One painted banner for every page: eyebrow, title, a line of real information and the page's art.
// Art lives in art/heroes/<page>.webp; page-hero.css layers art/hero-help.webp underneath, so a
// painting that has not shipped yet falls back without breaking the page.
// eyebrow, title, subtitle and aside are HTML: callers escape any player or game text.
window.PageHero = (() => {
  const ART = Object.freeze(["adventure", "quests", "professions", "plans", "party", "characters", "dungeons", "talents", "journey", "coverage", "commands", "companion", "now", "settings"]);
  const known = (art) => (ART.includes(art) ? art : "settings");
  function render({ art, eyebrow = "", title = "", subtitle = "", crest = "", crestHtml = "", aside = "", compact = false, attrs = "", titleAttrs = "", subAttrs = "" } = {}) {
    const key = known(art);
    return `<header class="page-hero ph-art-${key}${compact ? " compact" : ""}" data-page-hero="${key}"${attrs ? " " + attrs : ""}>`
      + `<div class="ph-copy">${crestHtml || (crest ? `<img class="ph-crest" src="${crest}" alt="" width="84" height="84">` : "")}<div class="ph-words">`
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
  // The one small, consistent note for community-sourced facts.
  const note = (text = "Community data · may differ in game") => `<p class="bf-note">${text}</p>`;
  return { render, classCrest, note, ART };
})();
