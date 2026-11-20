"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { atomic } = require("./store.cjs");
const { emptyBoard, validateBoard, validId, changeBoard, boardView } = require("./guild-organizer.cjs");
const { emptyDebrief, validateDebrief, nextRunText } = require("./guild-officer-debrief.cjs");
const { appendDecision, validateLog } = require("./guild-officer-log.cjs");
const { newcomerMentorDraft } = require("./guild-run-templates.cjs");
const { MAX_GUILD_RUN_BYTES, previewGuildRunPack, serializeGuildRunPack, parseGuildRunPack,
  resolveGuildRunStart, applyGuildRunPack, setGuildRunPrepDone } = require("./guild-run-pack.cjs");

const LIMIT = 32; // Per list, per local installation; never evict a run or its private checks silently.
const STORE_LIMIT = LIMIT * 2 * (MAX_GUILD_RUN_BYTES + 2048) + 1024;
const STORE_NAME = "guild-runs.json";
const BOARD_NAME = "guild-organizer.json";
const BOARD_LIMIT = 2 * 1024 * 1024;
const DEBRIEF_NAME = "guild-officer-debrief.json";
const DEBRIEF_LIMIT = 2 * 1024 * 1024;
const OFFICER_NAME = "guild-officer-log.json";
const OFFICER_LIMIT = 6 * 1024 * 1024;
// Match only this store's siblings produced by atomic(): <filename>.<randomUUID()>.tmp.
const STORE_TEMP_NAME = /^guild-(?:runs|organizer|officer-debrief|officer-log)\.json\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.tmp$/;
const invalid = () => new Error("Guild Run Pack request is invalid.");
const expired = () => new Error("Guild Run Pack review is no longer current. Open a new preview.");
const updated = new Set(["imported", "updated"]);

function fields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) throw invalid();
}

function readBounded(file, limit) {
  // Reject non-files before open (e.g. a named pipe), then validate the opened handle again.
  if (!fs.statSync(file).isFile()) throw invalid();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw invalid();
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!read) break;
      offset += read;
    }
    if (offset > limit) throw invalid();
    return buffer.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}

function editable(base) {
  const { start, title, destination, meetingPoint, duties, prep } = base;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: start.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZoneName: "longOffset" }).formatToParts(new Date(start.utc)).map(p => [p.type, p.value]));
  return { title, destination, meetingPoint, duties, prep: prep.map(p => p.text),
    local: `${parts.year.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`,
    timeZone: start.timeZone, offset: parts.timeZoneName === "GMT" ? "+00:00" : parts.timeZoneName.slice(3) };
}

function registerGuildRunHandlers({ handle, dataDir, dialog, clipboard, getWindow, context,
  viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, isBlocked = () => false }) {
  const file = path.join(dataDir, STORE_NAME);
  const boardFile = path.join(dataDir, BOARD_NAME);
  const debriefFile = path.join(dataDir, DEBRIEF_NAME);
  const officerFile = path.join(dataDir, OFFICER_NAME);
  let generation = 0, review = null, nextRunReview = null, welcome = null;
  function retire() { generation++; review = nextRunReview = welcome = null; }
  function load() {
    try {
      const stored = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(file, STORE_LIMIT)));
      fields(stored, ["organized", "received"]);
      for (const kind of ["organized", "received"]) {
        const entries = stored[kind];
        if (!Array.isArray(entries) || entries.length > LIMIT) throw invalid();
        const ids = new Set();
        for (const entry of entries) {
          const pack = kind === "organized" ? entry : entry.pack;
          if (kind === "organized") serializeGuildRunPack(pack);
          else applyGuildRunPack(entry, pack);
          if (ids.has(pack.eventId)) throw invalid();
          ids.add(pack.eventId);
        }
      }
      return stored;
    } catch (error) {
      if (error.code === "ENOENT") return { organized: [], received: [] };
      throw new Error("Guild Run Pack local runs could not be opened. Existing runs were not changed.");
    }
  }
  function persist(stored) {
    if (stored.organized.length > LIMIT || stored.received.length > LIMIT)
      throw new Error("Guild Run Pack local run limit reached. Existing runs were not changed.");
    try { atomic(file, JSON.stringify(stored)); }
    catch { throw new Error("Guild Run Pack local runs could not be saved. Try again."); }
  }
  const event = (list, id, wrapped = false) => list.find(entry => (wrapped ? entry.pack : entry).eventId === id);
  const summary = ({ eventId, title, status, revision }) => ({ eventId, title, status, revision });
  const current = (stamp, source) => !isBlocked() && generation === stamp && context.isCurrent(source);
  const memberView = record => {
    const { text, viewerTime } = previewGuildRunPack(record.pack, viewerZone());
    return { ...record, text, viewerTime };
  };
  function stage(kind, pack, extra = {}) {
    retire();
    const preview = previewGuildRunPack(pack, viewerZone());
    review = { ...preview, kind, token: randomUUID(), source: context.snapshot(), ...extra };
    return { ...preview, token: review.token, ...(kind === "incoming" && { outcome: review.outcome }) };
  }
  function reviewed(token, ...kinds) {
    if (!review || review.token !== token || !kinds.includes(review.kind) || !current(generation, review.source)) throw expired();
    return review;
  }
  function basePack(base, stored) {
    fields(base, ["eventId", "revision"]);
    const pack = event(stored.organized, base.eventId);
    if (!pack || pack.revision !== base.revision || pack.status !== "scheduled") throw expired();
    return pack;
  }
  function makePreview({ draft, base }) {
    fields(draft, ["title", "destination", "meetingPoint", "local", "offset", "timeZone", "duties", "prep"]);
    const prior = base === null ? null : basePack(base, load());
    if (!Array.isArray(draft.prep) || draft.prep.length > 32) throw invalid();
    const old = [...(prior?.prep || [])];
    const prep = draft.prep.map(text => {
      const i = old.findIndex(p => p.text === text);
      return i < 0 ? { id: randomUUID(), text } : old.splice(i, 1)[0];
    });
    let start;
    try { start = resolveGuildRunStart({ local: draft.local, offset: draft.offset, timeZone: draft.timeZone }); }
    catch { throw new Error("Guild Run Pack start is invalid. Check the date, named time zone and UTC offset for that date. Skipped times cannot be scheduled."); }
    const { title, destination, meetingPoint, duties } = draft;
    return stage("unsaved", { title, destination, meetingPoint, duties, prep, start, status: "scheduled",
      eventId: prior?.eventId || randomUUID(), revision: (prior?.revision || 0) + 1 }, { prior });
  }
  function save(token) {
    const entry = reviewed(token, "unsaved");
    const stored = load(), index = stored.organized.findIndex(p => p.eventId === entry.pack.eventId);
    if (index === -1 ? entry.prior : !entry.prior || serializeGuildRunPack(stored.organized[index]) !== serializeGuildRunPack(entry.prior)) throw expired();
    if (index < 0) stored.organized.unshift(entry.pack); else stored.organized[index] = entry.pack;
    persist(stored);
    entry.kind = "saved";
    return true;
  }
  async function exportReview(token, format) {
    const entry = reviewed(token, "unsaved", "saved");
    if (entry.kind === "unsaved") throw new Error("Guild Run Pack: Save the reviewed run locally before exporting it.");
    if (format !== "json" && format !== "text") throw invalid();
    const stamp = ++generation, extension = format === "json" ? "json" : "txt";
    const bytes = format === "json" ? serializeGuildRunPack(entry.pack) : entry.text;
    const result = await dialog.showSaveDialog(getWindow(), { title: "Export reviewed Guild Run Pack",
      defaultPath: `Backstage-Forever-guild-run-r${entry.pack.revision}.${extension}`,
      filters: [{ name: format === "json" ? "Guild Run Pack" : "Plain text", extensions: [extension] }] });
    if (!current(stamp, entry.source) || result.canceled) return null;
    return writeShare(result.filePath, bytes);
  }
  function writeShare(target, bytes) {
    try {
      if (typeof target !== "string" || !path.isAbsolute(target)) throw invalid();
      const owned = fs.realpathSync(dataDir);
      const parent = fs.realpathSync(path.dirname(target));
      const inside = candidate => {
        const relative = path.relative(owned, candidate);
        return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
      };
      if (inside(parent) || (fs.existsSync(target) && inside(fs.realpathSync(target)))) throw invalid();
      atomic(target, bytes);
    } catch { throw new Error("Guild Run Pack could not be saved. Choose a writable file outside the app data folder."); }
    return true;
  }
  async function importReview() {
    // Starting the picker supersedes another dialog, not an already reviewed run.
    const stamp = ++generation, source = context.snapshot();
    const result = await dialog.showOpenDialog(getWindow(), { title: "Preview a Guild Run Pack", properties: ["openFile"],
      filters: [{ name: "Guild Run Pack", extensions: ["json"] }] });
    if (!current(stamp, source) || result.canceled) return null;
    let bytes;
    try {
      if (result.filePaths?.length !== 1) throw invalid();
      bytes = readBounded(result.filePaths[0], MAX_GUILD_RUN_BYTES);
    } catch { throw new Error("Guild Run Pack could not be read. Choose a JSON file up to 32 KiB."); }
    const pack = parseGuildRunPack(bytes);
    const before = event(load().received, pack.eventId, true) ?? null;
    const { outcome } = applyGuildRunPack(before, pack);
    return stage("incoming", pack, { before, outcome });
  }
  function accept(token) {
    const entry = reviewed(token, "incoming");
    if (!updated.has(entry.outcome)) throw expired();
    const stored = load(), index = stored.received.findIndex(p => p.pack.eventId === entry.pack.eventId);
    const before = stored.received[index] ?? null;
    if (before === null ? entry.before !== null : !entry.before || serializeGuildRunPack(before.pack) !== serializeGuildRunPack(entry.before.pack)) throw expired();
    const { outcome, record } = applyGuildRunPack(before, entry.pack);
    if (!updated.has(outcome)) throw expired();
    if (index < 0) stored.received.unshift(record); else stored.received[index] = record;
    persist(stored);
    retire();
    return memberView(record);
  }
  function check(input) {
    fields(input, ["eventId", "revision", "actionId", "done"]);
    const stored = load(), index = stored.received.findIndex(p => p.pack.eventId === input.eventId);
    const record = stored.received[index];
    if (!record || record.pack.revision !== input.revision) throw expired();
    const next = setGuildRunPrepDone(record, input.actionId, input.done);
    if (record.completedPrepIds.includes(input.actionId) !== input.done) {
      stored.received[index] = next;
      persist(stored);
    }
    return memberView(next);
  }
  function authoredReview(token) {
    const { pack } = reviewed(token, "saved");
    const stored = load();
    const currentPack = event(stored.organized, pack.eventId);
    if (!currentPack || serializeGuildRunPack(currentPack) !== serializeGuildRunPack(pack)) throw expired();
    return { pack, stored, readOnly: pack.status !== "scheduled" };
  }
  function welcomeClose(token) {
    if (welcome && welcome.token === token) { generation++; welcome = null; }
  }
  function welcomePreview(runToken, input) {
    if (authoredReview(runToken).readOnly) throw new Error("Guild Run Pack welcome copy is unavailable for a cancelled run.");
    fields(input, ["guild", "greeting", "recruiting", "contact"]);
    const { guild, greeting, recruiting, contact } = input;
    const line = (value, max) => typeof value === "string" && value.length <= max && value === value.trim() &&
      !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value);
    if (!guild || !greeting || !line(guild, 100) || !line(greeting, 400) || !line(recruiting, 240) || !line(contact, 160)) throw invalid();
    // Only explicitly entered public fields contribute to the welcome bytes.
    const details = [recruiting && `Recruiting: ${recruiting}\n`, contact && `Contact: ${contact}\n`].join("");
    const text = `Welcome to ${guild}\n\n${greeting}\n${details ? `\n${details}` : ""}`;
    generation++;
    welcome = { runToken, token: randomUUID(), text };
    return { token: welcome.token, text };
  }
  async function welcomeExport(token) {
    const entry = welcome;
    if (!entry || token !== entry.token || authoredReview(entry.runToken).readOnly) throw expired();
    const stamp = ++generation, { source } = review;
    const result = await dialog.showSaveDialog(getWindow(), { title: "Export reviewed guild welcome copy",
      defaultPath: "Backstage-Forever-guild-welcome.txt", filters: [{ name: "Plain text", extensions: ["txt"] }] });
    if (result.canceled || !current(stamp, source)) return null;
    // Recheck the committed authored run after the picker, including edits by another window.
    try { if (authoredReview(entry.runToken).readOnly) return null; } catch { return null; }
    return writeShare(result.filePath, entry.text);
  }
  function organizer(token, mutation) {
    const { pack, stored, readOnly } = authoredReview(token);
    if (mutation && readOnly) throw new Error("Guild Run Pack organizer board is read-only for a cancelled run.");
    let boards;
    try {
      boards = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(boardFile, BOARD_LIMIT)));
      if (!boards || typeof boards !== "object" || Array.isArray(boards) || Object.keys(boards).length > LIMIT) throw invalid();
      for (const [id, board] of Object.entries(boards)) {
        if (!validId(id)) throw invalid();
        validateBoard(board);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Guild Run Pack organizer boards could not be opened. Existing data was not changed.");
      boards = {};
    }
    const board = boards[pack.eventId] ?? emptyBoard();
    if (!mutation) return boardView(board, readOnly);
    if (board.revision !== mutation.revision) throw new Error("Guild Run Pack organizer board changed. Reopen it before editing.");
    const next = changeBoard(board, mutation.change);
    if (next !== board) {
      // Only locally authored event IDs may own a board. Never reattach orphaned data to an imported pack.
      const liveBoards = Object.fromEntries(stored.organized.filter(p => Object.hasOwn(boards, p.eventId)).map(p => [p.eventId, boards[p.eventId]]));
      liveBoards[pack.eventId] = next;
      try {
        const bytes = JSON.stringify(liveBoards);
        if (Buffer.byteLength(bytes) > BOARD_LIMIT) throw invalid();
        atomic(boardFile, bytes);
      } catch { throw new Error("Guild Run Pack organizer board could not be saved. Try again."); }
    }
    return boardView(next, false);
  }
  function readDebrief(token, forWrite = false) {
    const { pack, stored, readOnly } = authoredReview(token);
    if (readOnly && forWrite) throw new Error("Guild Run Pack officer debrief is read-only for a cancelled run.");
    let debriefs;
    try {
      debriefs = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(debriefFile, DEBRIEF_LIMIT)));
      if (!debriefs || typeof debriefs !== "object" || Array.isArray(debriefs) || Object.keys(debriefs).length > LIMIT) throw invalid();
      for (const [id, record] of Object.entries(debriefs)) {
        if (!validId(id)) throw invalid();
        validateDebrief(record);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Guild Run Pack officer debriefs could not be opened. Existing data was not changed.");
      debriefs = {};
    }
    return { pack, stored, debriefs, record: debriefs[pack.eventId] ?? emptyDebrief(), readOnly };
  }
  function saveDebrief(token, revision, facts) {
    const { pack, stored, debriefs, record } = readDebrief(token, true);
    if (record.revision !== revision) throw new Error("Guild Run Pack officer debrief changed. Reopen it before editing.");
    const next = { revision: revision + 1, facts };
    validateDebrief(next);
    const live = Object.fromEntries(stored.organized.filter(p => Object.hasOwn(debriefs, p.eventId)).map(p => [p.eventId, debriefs[p.eventId]]));
    live[pack.eventId] = next;
    try {
      const bytes = JSON.stringify(live);
      if (Buffer.byteLength(bytes) > DEBRIEF_LIMIT) throw invalid();
      atomic(debriefFile, bytes);
    } catch { throw new Error("Guild Run Pack officer debrief could not be saved. Try again."); }
    nextRunReview = null;
    return { ...next, readOnly: false };
  }
  function previewNextRun(token, revision) {
    const { pack, record } = readDebrief(token, true);
    if (record.revision !== revision) throw expired();
    const text = nextRunText(pack.title, record.facts), approval = randomUUID();
    nextRunReview = { owner: token, approval, record: JSON.stringify(record), text };
    return { token: approval, text };
  }
  function copyNextRun(token, approval) {
    if (!nextRunReview || nextRunReview.owner !== token || nextRunReview.approval !== approval) throw expired();
    const { record } = readDebrief(token, true);
    if (JSON.stringify(record) !== nextRunReview.record) throw expired();
    clipboard.writeText(nextRunReview.text);
    return true;
  }
  function officerLog(token, mutation) {
    const { pack, stored, readOnly } = authoredReview(token);
    if (mutation && readOnly) throw new Error("Guild Run Pack officer log is read-only for a cancelled run.");
    let logs;
    try {
      logs = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(officerFile, OFFICER_LIMIT)));
      if (!logs || typeof logs !== "object" || Array.isArray(logs) || Object.keys(logs).length > LIMIT) throw invalid();
      for (const [id, rows] of Object.entries(logs)) {
        if (!validId(id)) throw invalid();
        validateLog(rows);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Guild Run Pack officer logs could not be opened. Existing data was not changed.");
      logs = {};
    }
    let rows = logs[pack.eventId] ?? [];
    if (mutation) {
      if (rows.length !== mutation.revision) throw new Error("Guild Run Pack officer log changed. Reopen it before editing.");
      rows = appendDecision(rows, mutation.input);
      const liveLogs = Object.fromEntries(stored.organized.filter(p => Object.hasOwn(logs, p.eventId)).map(p => [p.eventId, logs[p.eventId]]));
      liveLogs[pack.eventId] = rows;
      try {
        const bytes = JSON.stringify(liveLogs);
        if (Buffer.byteLength(bytes) > OFFICER_LIMIT) throw invalid();
        atomic(officerFile, bytes);
      } catch { throw new Error("Guild Run Pack officer log could not be saved. Try again."); }
    }
    return { rows, revision: rows.length, readOnly };
  }
  const commands = {
    list: [0, () => { const stored = load(); return { organized: stored.organized.map(summary), received: stored.received.map(r => summary(r.pack)) }; }],
    defaults: [0, () => ({ timeZone: viewerZone() })],
    template: [1, id => {
      if (id !== "newcomer-mentor") throw invalid();
      return { ...newcomerMentorDraft(), timeZone: viewerZone() };
    }],
    close: [0, retire],
    preview: [1, input => { fields(input, ["draft", "base"]); return makePreview(input); }],
    organized: [1, id => {
      const pack = event(load().organized, id);
      if (!pack) throw expired();
      return stage("saved", pack);
    }],
    edit: [1, base => editable(basePack(base, load()))],
    cancelRun: [1, base => {
      const prior = basePack(base, load());
      return stage("unsaved", { ...prior, revision: prior.revision + 1, status: "cancelled", duties: [], prep: [] }, { prior });
    }],
    received: [1, id => {
      const record = event(load().received, id, true);
      if (!record) throw expired();
      retire();
      return memberView(record);
    }],
    save: [1, save], export: [2, exportReview], import: [0, importReview], accept: [1, accept], check: [1, check],
    board: [1, token => organizer(token)],
    boardChange: [3, (token, revision, change) => organizer(token, { revision, change })],
    debrief: [1, token => { const { record, readOnly } = readDebrief(token); return { ...record, readOnly }; }],
    debriefSave: [3, saveDebrief],
    nextRunPreview: [2, previewNextRun],
    nextRunDiscard: [1, token => { reviewed(token, "saved"); nextRunReview = null; }],
    nextRunCopy: [2, copyNextRun],
    officerLog: [1, token => officerLog(token)],
    officerAppend: [3, (token, revision, input) => officerLog(token, { revision, input })],
    welcomePreview: [2, welcomePreview], welcomeExport: [1, welcomeExport], welcomeClose: [1, welcomeClose],
  };
  handle("guildRun", (op, ...args) => {
    if (typeof op !== "string" || !Object.hasOwn(commands, op) || args.length !== commands[op][0] || isBlocked()) throw invalid();
    return commands[op][1](...args);
  }, { privateOnly: true });
  return { reset: () => {
    retire();
    try {
      // Keep the committed store available for a retry if orphan cleanup fails.
      for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
        if (entry.isFile() && STORE_TEMP_NAME.test(entry.name)) fs.rmSync(path.join(dataDir, entry.name), { force: true });
      }
      fs.rmSync(officerFile, { force: true });
      fs.rmSync(boardFile, { force: true });
      fs.rmSync(debriefFile, { force: true });
      fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("Guild Run Pack local runs could not be deleted. Try again.");
    }
  } };
}

module.exports = { registerGuildRunHandlers };
