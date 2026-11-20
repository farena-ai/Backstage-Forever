"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { EventEmitter } = require("node:events");
const { navigate } = require("./player-navigation.cjs");
const { FRESH_MS, crc8, encodeHairlineFrame, encodeHairlineCells } = require("../src/core/live-bridge.cjs");

const SAVED_AT = 1700000000;
const savedTime = new Date(SAVED_AT * 1000).toISOString();
const unsupported = { enabled: false, signal: "unsupported", frame: null, strip: null, last: null };

// Replace only the worker transport and clock. Bridge lifecycle, decode, main IPC,
// saved-file import and renderer are the actual app. No native capture on either branch.
function installWorker(live, macSavedOnly) {
  const fixture = globalThis.baselineWorker = { starts: 0, at: Date.now() - 120000 };
  live.LiveBridge = class extends live.LiveBridge {
    constructor(options) {
      super({ ...options, platform: macSavedOnly ? "darwin" : "win32", now: () => fixture.at, dumpDir: null,
        spawn() {
          fixture.starts++;
          assert.equal(macSavedOnly, false, "saved-only must never spawn capture");
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stdout.setEncoding = () => {};
          child.stderr = new EventEmitter();
          child.kill = () => {};
          fixture.worker = child;
          return child;
        },
      });
    }
  };
}

function pixelLine(seq, level) {
  const width = 912, height = 4, rgb = Buffer.alloc(width * height * 3, 140);
  const main = new Array(27).fill(0);
  Object.assign(main, { 0: 6, 1: seq, 2: 1456 >> 8, 3: 1456 & 255, 4: 0x8d, 5: 0x0f,
    6: 0x80, 7: 0x83, 8: level, 9: 100, 10: 64, 15: 255, 16: 255, 25: seq });
  main[26] = crc8(main, 26);
  encodeHairlineCells(encodeHairlineFrame(main, [])).forEach((color, i) => {
    rgb.set(color, i * 6);
    rgb.set(color, i * 6 + 3);
  });
  return `ok topleft ${width} ${height} ${rgb.toString("base64")} pw`;
}

const status = (page) => page.evaluate(() => backstage.liveLinkStatus());
const liveLine = (page) => page.locator("[data-live-link-line]");
const savedLabel = (page) => page.getByText(/^Saved snapshot · \d+ days ago · /);
function send(app, line) {
  return app.evaluate((_, text) => baselineWorker.worker.stdout.emit("data", `${text}\n`), line);
}

async function savedProfile(page) {
  const p = await page.evaluate(async () => {
    const { state } = await backstage.bootstrap();
    return state.profiles.find((profile) => profile.id === state.activeProfileId);
  });
  assert.equal(p.name, "Compass Hero");
  assert.equal(p.level, 18, "live position/level must not overwrite the saved profile");
  assert.equal(p.source.updatedAt, savedTime, "import, disconnect and restart must not freshen the observation time");
  assert.deepEqual(p.quests.map(q => [q.id, q.complete]), [[123, true]]);
}

async function macStatus(page, app, pref, livePreference) {
  await liveLine(page).getByText(/^Saved-only:.*Screen Recording is not needed/).waitFor();
  assert.equal(await page.locator("#live-link-toggle").isVisible(), false);
  assert.deepEqual(await status(page), unsupported);
  assert.deepEqual(await page.evaluate(() => backstage.setLiveLink(true)), unsupported);
  assert.equal(await fs.readFile(pref, "utf8"), livePreference);
  assert.equal(await app.evaluate(() => baselineWorker.starts), 0);
}

async function check({ page, app, macSavedOnly, pref, livePreference }) {
  page.setDefaultTimeout(10000);
  await page.getByRole("heading", { name: "Compass Hero", exact: true }).waitFor();
  await navigate(page, "game");
  await savedLabel(page).waitFor();
  assert.equal((await page.evaluate(() => backstage.gameStatus())).connected, true);
  await savedProfile(page);
  if (macSavedOnly) {
    await macStatus(page, app, pref, livePreference);
  } else {
    await send(app, pixelLine(3, 12));
    await liveLine(page).getByText("Live · Thunder Bluff 55.1, 50.2 · level 12").waitFor();
    assert.equal((await status(page)).frame.seq, 3);
    // No worker output: the actual renderer status poll must retire the live label.
    await app.evaluate((_, ms) => { baselineWorker.at += ms; }, FRESH_MS + 1);
    await liveLine(page).getByText(/^Signal paused.*Last live: Thunder Bluff.* ago\.$/).waitFor();
    const stale = await status(page);
    assert.equal(stale.signal, "stale");
    assert.equal(stale.frame, null);
    assert.equal(stale.last.ageMs, FRESH_MS + 1);
    await send(app, pixelLine(4, 13));
    await liveLine(page).getByText("Live · Thunder Bluff 55.1, 50.2 · level 13").waitFor();
    assert.equal((await status(page)).frame.seq, 4);
    // Same clock tick: explicit loss cannot wait for the frame TTL to elapse.
    await send(app, "nogame");
    await liveLine(page).getByText(/^WoW window not found.*Last live: Thunder Bluff.*level 13.* ago\.$/).waitFor();
    const lost = await status(page);
    assert.equal(lost.signal, "nogame");
    assert.equal(lost.frame, null);
    assert.equal(lost.last.ageMs, 0);
    assert.equal(await app.evaluate(() => baselineWorker.starts), 1, "reconnect should not restart the worker");
  }
  await page.getByText("Connection checks and tools", { exact: true }).click();
  await page.getByRole("button", { name: "Disconnect game", exact: true }).click();
  await page.getByText(/^Not connected yet: find your game folder below\.$/).waitFor();
  assert.equal((await page.evaluate(() => backstage.gameStatus())).connected, false);
  await savedLabel(page).waitFor();
  await savedProfile(page);
}

async function checkReopen({ page, app, macSavedOnly, pref, livePreference }) {
  page.setDefaultTimeout(10000);
  await navigate(page, "game");
  await page.getByText(/^Not connected yet: find your game folder below\.$/).waitFor();
  assert.equal((await page.evaluate(() => backstage.gameStatus())).connected, false);
  await savedLabel(page).waitFor();
  await savedProfile(page);
  if (macSavedOnly) {
    await macStatus(page, app, pref, livePreference);
  } else {
    await liveLine(page).getByText("Starting…", { exact: true }).waitFor();
    assert.deepEqual(await status(page), { enabled: true, signal: "starting", frame: null, strip: null, last: null });
  }
  // Follow the real, offline Map action from the saved location, without a provider or game launch.
  await navigate(page, "adventure");
  await page.getByRole("button", { name: /EXPLORE · SAVED LOCATION.*Durotar/ }).click();
  await page.waitForFunction(() => document.body.dataset.page === "world-map" && WorldMapView._state().model?.mapId === 1411);
  const player = await page.evaluate(() => WorldMapView._state().model.player);
  assert.deepEqual(player.saved, { x: 0.42, y: 0.68, at: savedTime });
  assert.equal(player.live, null);
  assert.equal(player.liveElsewhere, null);
  const counters = await app.evaluate(() => mapSetup);
  assert.deepEqual(counters, { providers: 0, keys: 0, game: 0, external: 0 });
}

module.exports = { SAVED_AT, installWorker, check, checkReopen };
