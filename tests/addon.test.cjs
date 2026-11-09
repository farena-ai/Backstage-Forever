const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
test('addon requires a verified interface instead of claiming certification', () => {
  const toc = fs.readFileSync(path.join(root, 'addon/BackstageForever/BackstageForever.toc.template'), 'utf8');
  assert.match(toc, /## Interface: REPLACE_WITH_VERIFIED_INTERFACE/);
  assert.match(toc, /Experimental/);
  assert.match(toc, /BackstageForever.lua/);
  assert.equal(fs.existsSync(path.join(root, 'addon/BackstageForever/BackstageForever.toc')), false);
});
test('copy panel is explicit, combat guarded and contains no executable import or bridge', () => {
  const lua = fs.readFileSync(path.join(root, 'addon/BackstageForever/BackstageForever.lua'), 'utf8');
  assert.match(lua, /SLASH_BACKSTAGEFOREVER1/);
  assert.match(lua, /InCombatLockdown\(\)/);
  assert.match(lua, /GetBuildInfo\(\)/);
  assert.match(lua, /PLAYER_REGEN_DISABLED/);
  assert.match(lua, /HighlightText\(\)/);
  assert.doesNotMatch(lua, /loadstring|RunScript|SendAddonMessage|RegisterAddonMessagePrefix|OnUpdate|SavedVariables|C_HTTP|Socket/i);
});
