"use strict";
// Which painted vista (art/zones/*.webp) stands for each leveling zone; shared by Now and Data coverage.
window.ZoneArt = (() => {
  const BIOME = Object.freeze({ 1429: "meadow", 1424: "meadow", 1417: "meadow", 1433: "meadow", 1436: "farmland", 1411: "canyon", 1441: "canyon", 1442: "canyon", 1413: "savanna", 1412: "savanna", 1426: "snow", 1416: "snow", 1452: "snow", 1432: "highlands", 1425: "highlands", 1420: "haunted", 1421: "haunted", 1431: "haunted", 1430: "haunted", 1422: "haunted", 1423: "haunted", 1448: "haunted", 1438: "elvenwood", 1439: "elvenwood", 1440: "elvenwood", 1444: "elvenwood", 1447: "elvenwood", 1437: "swamp", 1445: "swamp", 1435: "swamp", 1434: "jungle", 1449: "jungle", 1446: "desert", 1451: "desert", 1443: "desert", 1418: "volcanic", 1427: "volcanic", 1428: "volcanic", 1419: "volcanic" });
  return { biome: (mapId) => BIOME[mapId] || null, url: (mapId) => (BIOME[mapId] ? `art/zones/${BIOME[mapId]}.webp` : null) };
})();
