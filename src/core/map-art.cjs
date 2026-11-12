"use strict";
// Zone map art read from the player's own WoW Forever installation, composed once per
// build into a local PNG cache. Nothing here is bundled with the app or sent anywhere.
const fs = require("node:fs");
const path = require("node:path");
const { MAP_NAMES } = require("./companion-tools.cjs");

const WIDTH = 1002, HEIGHT = 668, TILE = 256, COLS = 4, ROWS = 3;
// World map texture folders whose names differ from the zone's display name.
const FOLDERS = {
  1413: ["Barrens"], 1415: ["Azeroth"], 1416: ["Alterac"], 1417: ["Arathi"], 1419: ["BlastedLands"],
  1420: ["Tirisfal"], 1421: ["Silverpine"], 1424: ["Hilsbrad", "HillsbradFoothills"], 1425: ["Hinterlands"],
  1429: ["Elwynn"], 1430: ["DeadwindPass"], 1433: ["Redridge"], 1434: ["Stranglethorn", "StranglethornVale"],
  1435: ["SwampOfSorrows"], 1442: ["StonetalonMountains"], 1445: ["Dustwallow"], 1447: ["Aszhara", "Azshara"],
  1449: ["UngoroCrater"], 1453: ["Stormwind", "StormwindCity"], 1454: ["Orgrimmar", "Ogrimmar"],
  1457: ["Darnassis", "Darnassus"], 1459: ["AlteracValley"], 1460: ["WarsongGulch"], 1461: ["ArathiBasin"],
};
function folderCandidates(mapId) {
  const name = MAP_NAMES[mapId];
  const out = [...(FOLDERS[mapId] || [])];
  if (name) {
    const words = name.replace(/['’]/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean);
    out.push(words.join(""), words.filter((w) => w.toLowerCase() !== "the").join(""));
  }
  return [...new Set(out)];
}

class MapArt {
  constructor({ getRoot, cacheDir, idleMs = 60000, open = null }) {
    this.getRoot = getRoot;
    this.cacheDir = cacheDir;
    this.idleMs = idleMs;
    this.openStorage = open || ((installDir) => new (require("./casc-reader.cjs").CascStorage)({ installDir }));
    this.storage = null;
    this.timer = null;
    this.failure = null;
  }
  installDir() {
    const root = this.getRoot();
    return root ? path.dirname(root) : null;
  }
  open() {
    const dir = this.installDir();
    if (!dir) { const e = Error("Connect your WoW Forever folder first."); e.code = "NOGAME"; throw e; }
    if (this.storage && this.storage.installDir === dir) return this.storage;
    this.release();
    this.storage = this.openStorage(dir);
    this.storage.installDir = dir;
    return this.storage;
  }
  release() { clearTimeout(this.timer); this.timer = null; if (this.storage) try { this.storage.close(); } catch {} this.storage = null; }
  idle() { clearTimeout(this.timer); this.timer = setTimeout(() => this.release(), this.idleMs); this.timer.unref?.(); }
  cacheFile(version, mapId, ext) { return path.join(this.cacheDir, String(version).replace(/[^\w.-]/g, "_"), `${mapId}.${ext}`); }

  // -> { png: Buffer, source } or { png: null, reason }
  art(mapId) {
    if (!Number.isSafeInteger(mapId) || mapId <= 0) throw Error("Invalid map.");
    let s;
    try { s = this.open(); } catch (e) { return { png: null, reason: e.code === "NOGAME" ? e.message : "Your WoW installation could not be read." }; }
    try {
      const png = this.cacheFile(s.version, mapId, "png"), none = this.cacheFile(s.version, mapId, "none");
      if (fs.existsSync(png)) return { png: fs.readFileSync(png), source: `Your WoW install · build ${s.version}` };
      if (fs.existsSync(none)) return { png: null, reason: "The game has no map art for this zone." };
      const buf = this.compose(s, mapId);
      fs.mkdirSync(path.dirname(png), { recursive: true });
      if (!buf) { fs.writeFileSync(none, ""); return { png: null, reason: "The game has no map art for this zone." }; }
      fs.writeFileSync(png, buf);
      return { png: buf, source: `Your WoW install · build ${s.version}` };
    } catch (e) {
      return { png: null, reason: e.code === "MISSING" ? "This zone's map art is not downloaded in your game yet." : "Your WoW installation could not be read." };
    } finally { this.idle(); }
  }
  // The game's own map tables: UiMap -> map art -> base tiles, plus every explored-area overlay.
  tables(s) {
    if (s._mapTables !== undefined) return s._mapTables;
    const { readDb2 } = require("./db2.cjs");
    const want = { xmap: [1957217, 0xEAE7DA2A], tiles: [1957210, 0x2DA5B77B], overlays: [1134579, 0x9A196494], overlayTiles: [1957212, 0x2C843422] };
    try {
      const t = {};
      for (const [k, [fdid, layout]] of Object.entries(want)) {
        const db = readDb2(s.readFileId(fdid));
        if (db.header.layoutHash !== layout) throw Error(`Unknown ${k} layout.`);
        t[k] = db.rows;
      }
      s._mapTables = t;
    } catch { s._mapTables = null; }
    return s._mapTables;
  }
  compose(s, mapId) {
    const { decodeBlp, encodePng } = require("./blp.cjs");
    const out = Buffer.alloc(WIDTH * HEIGHT * 4);
    const blit = (t, ox, oy, maxW, maxH, blend) => {
      for (let y = 0; y < Math.min(t.height, maxH); y++) {
        const dy = oy + y; if (dy < 0 || dy >= HEIGHT) continue;
        for (let x = 0; x < Math.min(t.width, maxW); x++) {
          const dx = ox + x; if (dx < 0 || dx >= WIDTH) continue;
          const si = (y * t.width + x) * 4, di = (dy * WIDTH + dx) * 4, a = t.rgba[si + 3];
          if (!blend || a === 255) { out[di] = t.rgba[si]; out[di + 1] = t.rgba[si + 1]; out[di + 2] = t.rgba[si + 2]; out[di + 3] = 255; continue; }
          if (!a) continue;
          for (let c = 0; c < 3; c++) out[di + c] = (t.rgba[si + c] * a + out[di + c] * (255 - a)) / 255 | 0;
        }
      }
    };
    const tables = this.tables(s);
    const link = tables && tables.xmap.find((r) => r.relation === mapId && r.fields[0] === 0) || tables?.xmap.find((r) => r.relation === mapId);
    if (link) {
      const art = link.fields[1];
      const base = tables.tiles.filter((r) => r.relation === art && r.fields[2] === 0);
      if (base.length) {
        for (const r of base) { const t = decodeBlp(s.readFileId(r.fields[3])); blit(t, r.fields[1] * TILE, r.fields[0] * TILE, TILE, TILE, false); }
        for (const o of tables.overlays.filter((r) => r.fields[1] === art)) {
          const [, , tw, th, ox, oy] = o.fields;
          for (const r of tables.overlayTiles.filter((x) => x.relation === o.id)) {
            let t; try { t = decodeBlp(s.readFileId(r.fields[3])); } catch { continue; }
            const col = r.fields[1], row = r.fields[0];
            blit(t, ox + col * TILE, oy + row * TILE, tw - col * TILE, th - row * TILE, true);
          }
        }
        return encodePng(WIDTH, HEIGHT, out);
      }
    }
    // Fallback: classic texture names.
    for (const folder of folderCandidates(mapId)) {
      const ids = [];
      for (let i = 1; i <= COLS * ROWS; i++) ids.push(s.fileIdForName(`interface/worldmap/${folder}/${folder}${i}.blp`));
      if (ids.some((id) => id == null)) continue;
      ids.forEach((id, n) => blit(decodeBlp(s.readFileId(id)), (n % COLS) * TILE, Math.floor(n / COLS) * TILE, TILE, TILE, false));
      return encodePng(WIDTH, HEIGHT, out);
    }
    return null;
  }
}

module.exports = { MapArt, folderCandidates, WIDTH, HEIGHT };
