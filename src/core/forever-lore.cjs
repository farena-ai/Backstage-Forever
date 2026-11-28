"use strict";

// Short factual summaries of Blizzard's publications. Older Warcraft background is labelled.
const SKYBORNE = "https://news.blizzard.com/en-us/article/24302071/wow-forever-meet-the-new-skyborne";
const FOREVER = "https://news.blizzard.com/en-gb/article/24315820/world-of-warcraft-forever-now-live";
const CLASSIC = "https://us.media.blizzard.com/manuals/wow/wow-classic-manual-enUS.pdf";
const TOPICS = [
  { aliases: ["skyborne", "zephras isle", "shen'dorei"], title: "The Skyborne", url: SKYBORNE,
    scope: "Forever race introduction", text: "The Skyborne descend from Highborne exiles who made a pact with wind elementals and built a civilization in Skywall. On Zephras Isle, their elemental patrons have disappeared. Windshaper Skyborne join the Horde and seek to restore the spirits. High Order Skyborne join the Alliance and seek the arcane legacy of Eldre'Thalas." },
  { aliases: ["shen'dralas"], title: "Shen'dralas", url: FOREVER,
    scope: "Forever launch overview", text: "Shen'dralas lies between Mulgore and Desolace. Its story connects the centaur tribes with the Shen'dralar, the ancient city of Eldre'Thalas, and Dire Maul." },
  { aliases: ["riverglades"], title: "The Riverglades", url: FOREVER,
    scope: "Forever launch overview", text: "The Riverglades is a frontier of waterways, grassland and trade roads. Forever explores settlements struggling to survive there and the old rivalries that tie those communities together." },
  { aliases: ["mount hyjal", "darkwhisper gorge"], title: "Mount Hyjal", url: FOREVER,
    scope: "Forever launch overview", text: "Forever visits Mount Hyjal in the aftermath of Archimonde's defeat. The story takes players through Darkwhisper Gorge and explores what comes next for the land after the battle." },
  { aliases: ["varimathras"], title: "Varimathras", url: CLASSIC,
    scope: "Foundational Warcraft background · Classic manual, pp. 190–191", text: "Varimathras is a dreadlord who helped Sylvanas Windrunner move against Arthas in Lordaeron. Sylvanas then turned on the dreadlords. Varimathras pledged himself to her to survive and served her in the Undercity as her majordomo." },
  { aliases: ["sylvanas", "forsaken"], title: "Sylvanas and the Forsaken", url: CLASSIC,
    scope: "Foundational Warcraft background · Classic manual, p. 190", text: "Sylvanas Windrunner commanded Silvermoon's rangers before Arthas killed her and raised her as a banshee. She regained her will when the Lich King's power weakened, led undead rebels away from the Scourge, and ruled the Forsaken from the Undercity of Lordaeron." },
];

const normalize = value => value.toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

function loreAnswer(question) {
  const q = normalize(question);
  if (!/^(?:who (?:is|are|was|were) |what(?: is|'s) (?:the (?:story|lore) (?:behind|of|about) )?|why (?:is|are|did|was|do) |tell me about |lore (?:of|about) )/.test(q)) return null;
  if (/\b(?:how (?:can|do|should)|where (?:can|do|should)|coordinates|on foot|step by step|drop rate|turn in|quest reward)\b/.test(q)) return null;
  const matches = TOPICS.filter(topic => topic.aliases.some(alias => ` ${q} `.includes(` ${alias} `)));
  if (!matches.length || matches.length > 2) return null;
  const text = matches.map(topic => `**${topic.title}**\n\n${topic.text}\n\nSource: Blizzard Entertainment · ${topic.scope}\n${topic.url}`).join("\n\n");
  return { text, topic: "lore" };
}

module.exports = { loreAnswer };
