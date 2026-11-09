"use strict";
const path = require("node:path"),
  crypto = require("node:crypto");
const { execFile } = require("node:child_process");
function candidateRoots({
  env = process.env,
  platform = process.platform,
} = {}) {
  const p = platform === "win32" ? path.win32 : path;
  const roots = [];
  for (const base of [
    env["ProgramFiles(x86)"],
    env.ProgramFiles,
    env.ProgramW6432,
  ].filter(Boolean))
    roots.push(p.join(base, "World of Warcraft", "_forever_"));
  if (platform === "win32")
    for (let code = 67; code <= 90; code++)
      for (const suffix of [
        "World of Warcraft",
        "WorldofWarcraft/World of Warcraft",
        "Games/World of Warcraft",
        "Program Files (x86)/World of Warcraft",
        "Program Files/World of Warcraft",
      ])
        roots.push(
          p.join(String.fromCharCode(code) + ":\\", suffix, "_forever_"),
        );
  return [...new Set(roots)];
}
async function registryRoots() {
  if (process.platform !== "win32") return [];
  const keys = [
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\World of Warcraft",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\World of Warcraft",
  ];
  const output = await Promise.all(
    keys.map(
      (key) =>
        new Promise((resolve) =>
          execFile(
            "reg.exe",
            ["query", key, "/v", "InstallLocation"],
            { timeout: 1500, maxBuffer: 8192, windowsHide: true },
            (error, stdout) =>
              resolve(
                error
                  ? []
                  : [
                      ...stdout.matchAll(
                        /InstallLocation\s+REG_\w+\s+([^\r\n]+)/g,
                      ),
                    ].map((m) => m[1].trim()),
              ),
          ),
        ),
    ),
  );
  return output.flat().slice(0, 8);
}
async function discoverGame({
  validateRoot,
  candidates,
  candidateTimeoutMs = 750,
  maxDurationMs = 5000,
} = {}) {
  const deadline = Date.now() + maxDurationMs;
  const roots = (
      candidates || [...candidateRoots(), ...(await registryRoots())]
    ).slice(0, 256),
    found = [];
  let index = 0;
  const worker = async () => {
    while (index < roots.length && Date.now() < deadline) {
      const position = index++,
        candidate = roots[position];
      let timer;
      try {
        const root = await Promise.race([
          Promise.resolve().then(() => validateRoot(candidate)),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Discovery timeout")),
              Math.max(1, Math.min(candidateTimeoutMs, deadline - Date.now())),
            );
          }),
        ]);
        found.push({
          position,
          id: crypto.createHash("sha256").update(root).digest("hex"),
          label: "World of Warcraft: Forever",
          path: root,
        });
      } catch {
      } finally {
        clearTimeout(timer);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(6, roots.length) }, () => worker()),
  );
  const seen = new Set();
  return found
    .sort((a, b) => a.position - b.position)
    .filter((item) => {
      const key = item.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ position, ...item }) => item);
}
module.exports = { candidateRoots, discoverGame };
