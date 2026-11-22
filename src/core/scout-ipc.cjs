"use strict";
// Scout notes on the desktop (roadmap S1): how many records the last read of the game's saved file
// held, and one button that writes them to a JSON file the player chooses. Nothing is uploaded:
// the only write is the file picked in the save dialog. Read-only apart from that.
function registerScoutHandlers({ handle, getGame, dialog, getWindow, writeFile = (file, text) => require("node:fs/promises").writeFile(file, text, "utf8"), now = () => Math.floor(Date.now() / 1000) }) {
  const entries = () => { try { return getGame()?.scoutCapture() || []; } catch { return []; } };
  const summary = () => {
    const list = entries().filter((e) => e?.scout?.records?.length);
    return { characters: list.map((e) => ({ name: e.name, realm: e.realm || "", records: e.scout.records.length })).sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)),
      records: list.reduce((n, e) => n + e.scout.records.length, 0) };
  };
  handle("scoutNotes", (...args) => {
    if (args.length) throw Error("Invalid scout request.");
    return summary();
  });
  handle("exportScoutNotes", async (...args) => {
    if (args.length) throw Error("Invalid scout request.");
    const game = getGame();
    const doc = game ? game.scoutExport(now()) : null;
    const records = (doc?.characters || []).reduce((n, c) => n + c.records.length, 0);
    if (!records) return { saved: false, reason: "empty" };
    const result = await dialog.showSaveDialog(getWindow(), { title: "Save my scout notes", defaultPath: "Backstage-Forever-scout-notes.json", filters: [{ name: "Scout notes", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return { saved: false, reason: "cancelled" };
    await writeFile(result.filePath, JSON.stringify(doc, null, 1) + "\n");
    return { saved: true, characters: doc.characters.length, records };
  }, { privateOnly: true });
  return { summary };
}
module.exports = { registerScoutHandlers };
