"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const FILES = ["voice-helper.ps1", "voice-helper.cs"];

// Inspect every ancestor, including the user-data directory. A junction must
// never turn repair of our two files into a write to somebody else's directory.
async function regularPath(target, directory) {
  const absolute = path.resolve(target), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || (current !== absolute && !stat.isDirectory())) throw Error("Unsafe voice runtime path.");
    if (current === absolute && (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw Error("Unsafe voice runtime file.");
  }
  return fs.realpath(absolute);
}
async function prepareVoiceRuntime(dataDir) {
  const root = await regularPath(dataDir, true);
  let directory = root;
  for (const part of ["runtime", "voice"]) {
    directory = path.join(directory, part);
    try { await fs.mkdir(directory); } catch (e) { if (e.code !== "EEXIST") throw e; }
    if ((await regularPath(directory, true)).toLowerCase() !== directory.toLowerCase()) throw Error("Redirected voice runtime path.");
  }
  for (const name of FILES) {
    const source = await fs.readFile(path.join(__dirname, "../native", name));
    if (!source.length || source.length > 128 * 1024) throw Error("Invalid bundled voice helper.");
    const target = path.join(directory, name);
    let existing;
    try { await regularPath(target, false); existing = await fs.readFile(target); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (!existing?.equals(source)) {
      const temporary = path.join(directory, ".voice-" + randomUUID() + ".tmp");
      try {
        await fs.writeFile(temporary, source, { flag: "wx", mode: 0o600 });
        await regularPath(directory, true);
        try { await regularPath(target, false); } catch (e) { if (e.code !== "ENOENT") throw e; }
        await fs.rename(temporary, target);
      } finally { await fs.rm(temporary, { force: true }); }
    }
    await regularPath(target, false);
    if (!(await fs.readFile(target)).equals(source)) throw Error("Voice helper verification failed.");
  }
  return path.join(directory, FILES[0]);
}
module.exports = { prepareVoiceRuntime };
