"use strict";
// Backstage Desk scrubber. Pure: text in, text out, plus how many things were taken out.
// It removes what could point at a person or their computer before anything is sent:
// file paths (Windows, macOS, Linux, UNC, file://), profile folder names, e-mail addresses,
// network addresses, long tokens, the names the app knows (characters, realms, guilds, account
// folders, the computer's user name) and anything shaped like Name-Realm.
// Diagnostics and automatic error reports always go through it. The player's own words go
// through it too unless they untick the box, and they see the result before sending.

const MARK = Object.freeze({ path: "[path]", name: "[name]", email: "[email]", token: "[token]", address: "[address]" });
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A path segment may hold spaces only when another separator follows it, so a sentence after a
// path is not swallowed whole; each segment is bounded.
const SEG = "[^\\\\/:*?\"<>|\\r\\n]{1,80}";
const TAIL = "[^\\\\/:*?\"'<>|\\s),;\\]]{0,80}";
const FILE_URL = /file:\/{2,3}[^\s"'<>|)\]]+/gi;
const WIN_PATH = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${TAIL}`, "g");
const UNC_PATH = new RegExp(`\\\\\\\\[^\\s\\\\/"'<>|]{1,80}(?:[\\\\/](?:${SEG}[\\\\/])*${TAIL})?`, "g");
const ROOTS = "Users|home|root|var|tmp|mnt|opt|private|etc|usr|Volumes|Applications|Library|media|srv|run|snap|data";
const USEG = "[^/\\s\"'<>|:]{1,80}(?: [^/\\s\"'<>|:]{1,40}){0,3}";
const UTAIL = "[^/\\s\"'<>|:),;\\]]{1,80}";
const UNIX_ROOTED = new RegExp(`(^|[\\s"'(=:,\\[<])((?:~|/(?:${ROOTS}))(?:/${USEG}(?=/))*(?:/${UTAIL})?/?)`, "gm");
const UNIX_ANY = /(^|[\s"'(=,\[<])(\/[A-Za-z0-9._@-]{1,80}(?:\/[A-Za-z0-9._@-]{1,80})+\/?)/gm;
const PROFILE_REL = /(?<![A-Za-z0-9])(?:Users|home|Documents and Settings)[\\/][^\\/\s"'<>|:]{1,80}(?:[\\/][^\\/\s"'<>|:]{1,80})*/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const OCTET = "(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)";
const IPV4 = new RegExp(`(?<![\\d.])(?:${OCTET}\\.){3}${OCTET}(?![\\d.]|\\.\\d)(?::\\d{1,5})?`, "g");
const H = "[0-9A-Fa-f]{1,4}";
const IPV6 = new RegExp(`(?<![\\w:])(?:(?:${H}:){7}${H}|(?:${H}:){1,7}(?::${H}){1,6}|::(?:${H}:){0,5}${H})(?![\\w:])`, "g");
const MAC = /(?<![\w:-])(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}(?![\w:-])/g;
// The game's own id of a character or a Battle.net account ("Player-4184-0A1B2C3D").
const GUID = /(?<![A-Za-z0-9])(?:Player|BNetAccount)-\d{1,6}-[0-9A-Fa-f]{6,16}(?![A-Za-z0-9])/g;
const UUID =/(?<![0-9A-Fa-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Fa-f])/gi;
const PREFIXED = /(?<![A-Za-z0-9])(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[abprs]|Bearer)[-_ ][A-Za-z0-9._-]{10,}/g;
const HEX = /(?<![0-9A-Za-z])[0-9A-Fa-f]{20,}(?![0-9A-Za-z])/g;
const B64URL = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}={0,2}/g;
const B64 = /(?<![A-Za-z0-9+/])(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*[A-Z])[A-Za-z0-9+/]{40,}={0,2}/g;
// Name-Realm: two capitalised words joined by a hyphen. Everyday pairs ("Desktop-App",
// "Quest-Log", "Alt-Tab") are common, above all in German, so words the app and the game use
// all the time never count as a name.
const NAME_REALM = /(?<![\p{L}\p{N}-])(\p{Lu}\p{Ll}{1,11})-(\p{Lu}[\p{L}']{2,24})(?![\p{L}\p{N}-])/gu;
const COMMON = new Set(("add addon addons alt app apps auto backstage bank battle beta boss button chat class classic click client code companion compass " +
  "ctrl dark data desktop discord download dungeon error field forever game gear gold guide guild help horde alliance allianz item journal karte key launcher ledger level " +
  "light link linux list live log mac macos mail map menu mini net off offline on online options page panel party patch plan planer planner plans player pop pre post profile " +
  "quest quests raid realm reload report reports route screen screenshot server settings shift site spiel start step strg tab talent talents test tool tooltip track tracker " +
  "update upload user version web window windows world wow zone zoom fehler datei ordner seite liste fenster charakter gilde klasse einstellungen hilfe beruf berufe " +
  "ansicht anzeige befehl befehle begleiter abenteuer ausrüstung talentplaner import export up down left right top in out non anti multi self free").split(" "));

function nameRegex(names) {
  const list = [...new Set((Array.isArray(names) ? names : [])
    .filter((n) => typeof n === "string").map((n) => n.normalize("NFC").trim())
    .flatMap((n) => (/\s/.test(n) ? [n, n.replace(/\s+/g, "")] : [n]))
    .filter((n) => n.length >= 2 && n.length <= 60))].sort((a, b) => b.length - a.length);
  if (!list.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`, "giu");
}
// "C:\app\src\main.cjs" → "main.cjs"; "file:///C:/app/main.cjs:10:3" → "main.cjs:10:3"; null when there is no file name.
const baseName = (p) => { const m = /([A-Za-z0-9._-]{1,60}\.[A-Za-z0-9]{1,6})((?::\d{1,7}){0,2})$/.exec(p.replace(/[\\/]+$/, "")); return m ? m[1] + m[2] : null; };

/**
 * scrub(text, { names, keepFileNames }) → { text, removed }
 *  names: strings the app knows to be private (character, realm, guild, account folder, user name).
 *  keepFileNames: a path becomes its bare file name ("app.js") instead of "[path]"; used for stack lines.
 */
function scrub(input, { names = [], keepFileNames = false } = {}) {
  let text = String(input ?? "").normalize("NFC"), removed = 0;
  const swap = (re, mark) => { text = text.replace(re, () => { removed++; return mark; }); };
  // A full stop that ends the sentence is not part of the path.
  const path = (p) => { removed++; const dot = p.endsWith(".") ? "." : ""; return (keepFileNames ? baseName(dot ? p.slice(0, -1) : p) || MARK.path : MARK.path) + dot; };
  text = text.replace(FILE_URL, path).replace(UNC_PATH, path).replace(WIN_PATH, path);
  text = text.replace(UNIX_ROOTED, (all, lead, p) => (p === "~" || p === "/" ? all : lead + path(p)));
  text = text.replace(UNIX_ANY, (all, lead, p) => lead + path(p));
  text = text.replace(PROFILE_REL, path);
  swap(EMAIL, MARK.email);
  swap(GUID, MARK.name);
  swap(UUID, MARK.token); swap(PREFIXED, MARK.token);
  swap(MAC, MARK.address); swap(IPV6, MARK.address); swap(IPV4, MARK.address);
  swap(HEX, MARK.token); swap(B64URL, MARK.token); swap(B64, MARK.token);
  const known = nameRegex(names);
  if (known) swap(known, MARK.name);
  text = text.replace(NAME_REALM, (all, a, b) => {
    if (COMMON.has(a.toLowerCase()) || COMMON.has(b.toLowerCase())) return all;
    removed++; return MARK.name;
  });
  return { text, removed };
}

/** Stack lines for an error report: at most 12, each at most 200 characters, file names without folders. */
function scrubStack(stack, { names = [] } = {}) {
  const lines = (Array.isArray(stack) ? stack : String(stack ?? "").split(/\r?\n/))
    .map((l) => String(l).trim()).filter((l) => /^at\s/.test(l));
  return lines.slice(0, 12).map((l) => scrub(l, { names, keepFileNames: true }).text
    .replace(/[^\s()]*[\\/]([^\s()\\/]*)/g, "$1") // anything still shaped like a folder path keeps only its last part
    .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200));
}

/** Every name the app knows that must never be sent: from saved characters plus whatever the caller adds. */
function knownNames(profiles, extra = []) {
  const out = new Set();
  const add = (v) => { if (typeof v === "string" && v.trim().length >= 2 && v.length <= 60) out.add(v.trim()); };
  for (const p of Array.isArray(profiles) ? profiles : []) {
    add(p?.name); add(p?.realm); add(p?.guild); add(p?.guildName); add(p?.account); add(p?.accountName);
    if (p?.guild && typeof p.guild === "object") add(p.guild.name);
  }
  for (const v of Array.isArray(extra) ? extra : []) add(v);
  return [...out];
}

module.exports = { scrub, scrubStack, knownNames, MARK };
