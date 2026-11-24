"use strict";
// Verbatim copy of the pack validator shipped in Backstage Forever 1.26 (src/core/community.cjs at
// commit 67f5495: constants, checks and validatePack). Do not edit: tests use it to prove that the
// default pack is still accepted by apps that were released before pack format minor 1.
const PACK_LIMITS = Object.freeze({ nodes: 100000, nodeItems: 200000, npcs: 100000, vendors: 200000, drops: 200000, recipes: 50000 });
const NAME_RE = /^[\p{L}\p{N} '’.,:()&!-]{1,120}$/u;
const isId = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
const isFrac = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
function packFail(why) { throw Error(`Invalid community pack: ${why}.`); }
const SECTIONS = Object.freeze({
  nodes: { kind: "kind", objectId: "idn", name: "namen", mapId: "id", x: "frac", y: "frac", installs: "count" },
  nodeItems: { kind: "kind", objectId: "idn", name: "namen", itemId: "id", installs: "count" },
  npcs: { npcId: "id", mapId: "id", x: "frac", y: "frac", installs: "count" },
  vendors: { npcId: "id", itemId: "id", installs: "count" },
  drops: { npcId: "id", itemId: "id", rate: "rate", samples: "count", installs: "count" },
  recipes: { source: "source", npcId: "id", spellId: "idn", itemId: "idn", installs: "count" },
});
const CHECK = {
  kind: (v) => ["herb", "ore", "chest"].includes(v),
  id: isId, idn: (v) => v === null || isId(v),
  namen: (v) => v === null || (typeof v === "string" && NAME_RE.test(v)),
  frac: isFrac, rate: isFrac,
  count: (v) => Number.isSafeInteger(v) && v >= 1 && v <= 100000000,
  source: (v) => v === "trainer" || v === "vendor",
};
/** Strict validation of an untrusted pack. Returns compact rows by section; throws on anything off. */
function validatePack(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) packFail("not an object");
  if (value.format !== 1) packFail("format");
  if (typeof value.version !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(value.version)) packFail("version");
  if (typeof value.generatedAt !== "string" || value.generatedAt.length > 40 || !Number.isFinite(Date.parse(value.generatedAt))) packFail("generatedAt");
  if (!Number.isSafeInteger(value.minInstalls) || value.minInstalls < 1 || value.minInstalls > 1000) packFail("minInstalls");
  const out = { format: 1, version: value.version, generatedAt: value.generatedAt, minInstalls: value.minInstalls };
  for (const [name, spec] of Object.entries(SECTIONS)) {
    const sec = value[name];
    if (sec === undefined) { out[name] = []; continue; }
    if (!sec || typeof sec !== "object" || !Array.isArray(sec.columns) || !Array.isArray(sec.rows) || sec.columns.length > 32) packFail(name);
    if (sec.rows.length > PACK_LIMITS[name]) packFail(`${name} too large`);
    const at = {};
    for (const col of Object.keys(spec)) { at[col] = sec.columns.indexOf(col); if (at[col] < 0) packFail(`${name}.${col} missing`); }
    out[name] = sec.rows.map((row, i) => {
      if (!Array.isArray(row) || row.length !== sec.columns.length) packFail(`${name}[${i}]`);
      const o = {};
      for (const [col, type] of Object.entries(spec)) {
        const v = row[at[col]];
        if (!CHECK[type](v)) packFail(`${name}[${i}].${col}`);
        o[col] = v;
      }
      if ((name === "nodes" || name === "nodeItems") && (o.objectId === null) === (o.name === null)) packFail(`${name}[${i}] identity`);
      if (name === "recipes" && o.spellId === null && o.itemId === null) packFail(`${name}[${i}] identity`);
      return o;
    });
  }
  return out;
}
module.exports = { validatePack };
