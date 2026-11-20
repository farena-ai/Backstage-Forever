"use strict";
const fs = require("node:fs"), path = require("node:path");
const LEGACY_FILE = "local-craft.json";
const LEGACY_STAGE = /^local-craft\.json\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;
function clearLegacyLocalCraft(dir) {
  let complete = true;
  try {
    const entries = fs.opendirSync(dir);
    try {
      let entry;
      while ((entry = entries.readSync())) {
        if (entry.name !== LEGACY_FILE && !LEGACY_STAGE.test(entry.name)) continue;
        try { fs.unlinkSync(path.join(dir, entry.name)); }
        catch (error) { if (error.code !== "ENOENT") complete = false; }
      }
    } finally { entries.closeSync(); }
  } catch { return false; }
  return complete;
}
module.exports = { clearLegacyLocalCraft };
