"use strict";
// Game builds change every few days inside one patch (1.60.1.70888, 1.60.1.71037 ...).
// Data checked on one build is used on the other builds of the same patch and says so
// ("carried"). A different patch number is a mismatch until the data is checked again.
// The addon applies the same rule (BackstageForeverBuildRelation in BackstageForeverHelpers.lua).
const BUILD = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,8})$/;

function parts(build) {
  const m = typeof build === "string" ? BUILD.exec(build) : null;
  return m ? { patch: m[1], number: m[2] } : null;
}

// "match" | "carried" | "mismatch" | "unknown"
function relation(dataBuild, clientBuild) {
  const data = parts(dataBuild),
    client = parts(clientBuild);
  if (!data || !client) return "unknown";
  if (data.patch !== client.patch) return "mismatch";
  return data.number === client.number ? "match" : "carried";
}

const usable = (dataBuild, clientBuild) => {
  const r = relation(dataBuild, clientBuild);
  return r === "match" || r === "carried";
};

// One sentence for the player when data from another build of the same patch is in use.
function carriedNote(dataBuild, clientBuild) {
  if (relation(dataBuild, clientBuild) !== "carried") return null;
  return `Checked on game build ${parts(dataBuild).number}; your game is on ${parts(clientBuild).number} of the same patch. Places rarely move between builds.`;
}

module.exports = { relation, usable, carriedNote, parts };
