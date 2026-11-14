"use strict";
// Which painted vista (art/zones/*.webp) stands for each leveling zone; shared by Now and Data coverage.
window.ZoneArt = (() => {
  const BIOME = Object.freeze({ 1429: "meadow", 1424: "meadow", 1417: "meadow", 1433: "meadow", 1436: "farmland", 1411: "canyon", 1441: "canyon", 1442: "canyon", 1413: "savanna", 1412: "savanna", 1426: "snow", 1416: "snow", 1452: "snow", 1432: "highlands", 1425: "highlands", 1420: "haunted", 1421: "haunted", 1431: "haunted", 1430: "haunted", 1422: "haunted", 1423: "haunted", 1448: "haunted", 1438: "elvenwood", 1439: "elvenwood", 1440: "elvenwood", 1444: "elvenwood", 1447: "elvenwood", 1437: "swamp", 1445: "swamp", 1435: "swamp", 1434: "jungle", 1449: "jungle", 1446: "desert", 1451: "desert", 1443: "desert", 1418: "volcanic", 1427: "volcanic", 1428: "volcanic", 1419: "volcanic", 1454: "warcamp", 1453: "citadel", 1456: "canyon", 1458: "haunted", 1455: "snow", 1457: "elvenwood" });
  // English zone names (from core/map-names.cjs) so a saved location, which only carries a name, finds its vista and map.
  const NAMES = Object.freeze({"1411":"Durotar","1412":"Mulgore","1413":"The Barrens","1414":"Kalimdor","1415":"Eastern Kingdoms","1416":"Alterac Mountains","1417":"Arathi Highlands","1418":"Badlands","1419":"Blasted Lands","1420":"Tirisfal Glades","1421":"Silverpine Forest","1422":"Western Plaguelands","1423":"Eastern Plaguelands","1424":"Hillsbrad Foothills","1425":"The Hinterlands","1426":"Dun Morogh","1427":"Searing Gorge","1428":"Burning Steppes","1429":"Elwynn Forest","1430":"Deadwind Pass","1431":"Duskwood","1432":"Loch Modan","1433":"Redridge Mountains","1434":"Stranglethorn Vale","1435":"Swamp of Sorrows","1436":"Westfall","1437":"Wetlands","1438":"Teldrassil","1439":"Darkshore","1440":"Ashenvale","1441":"Thousand Needles","1442":"Stonetalon Mountains","1443":"Desolace","1444":"Feralas","1445":"Dustwallow Marsh","1446":"Tanaris","1447":"Azshara","1448":"Felwood","1449":"Un'Goro Crater","1450":"Moonglade","1451":"Silithus","1452":"Winterspring","1453":"Stormwind City","1454":"Orgrimmar","1455":"Ironforge","1456":"Thunder Bluff","1457":"Darnassus","1458":"Undercity"});
  // G13: zones with their own painting (art/zones/map-<mapId>.webp, also the in-game banner); the rest use their biome vista.
  const PAINTED = Object.freeze(new Set([1411, 1412, 1420, 1429, 1426, 1438, 1413, 1421, 1436, 1432, 1439, 1433, 1442, 1440, 1431, 1424, 1437, 1441, 1416, 1417, 1443, 1434, 1445, 1418, 1435, 1444, 1425, 1446, 1427, 1447, 1419, 1449, 1448, 1428, 1422, 1423, 1452, 1430, 1451, 1450, 1453, 1454, 1455, 1456, 1457, 1458]));
  const painted = (mapId) => PAINTED.has(Number(mapId));
  const url = (mapId) => (painted(mapId) ? `art/zones/map-${Number(mapId)}.webp` : BIOME[mapId] ? `art/zones/${BIOME[mapId]}.webp` : null);
  // Elements marked data-zone-art="<mapId>" get that zone's painting as --zone-art (CSP: no inline style attributes).
  function paint(root) {
    const marked = [...(root?.matches?.("[data-zone-art]") ? [root] : []), ...(root?.querySelectorAll?.("[data-zone-art]") || [])];
    for (const el of marked) {
      const u = painted(el.dataset.zoneArt) ? url(el.dataset.zoneArt) : null;
      if (u) el.style.setProperty("--zone-art", `url("${u}")`);
    }
  }
  const IDS = Object.freeze(Object.fromEntries(Object.entries(NAMES).map(([id, n]) => [n.toLowerCase(), Number(id)])));
  const idFor = (name) => IDS[String(name || "").trim().toLowerCase()] || null;
  return { idFor, nameFor: (mapId) => NAMES[mapId] || null, biome: (mapId) => BIOME[mapId] || null, painted, url, paint, paintedIds: () => [...PAINTED], biomeForName: (name) => BIOME[idFor(name)] || null };
})();
