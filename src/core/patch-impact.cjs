"use strict";
// Shared desktop policy. Saved builds, never a live-client or player-readiness claim.
// A review on one build covers the other builds of the same patch (see build-compat.cjs); the row says so.
(() => {
  const MAGE_GUIDE_BUILDS = Object.freeze(["1.60.1.70959"]);
  const MAGE_ABILITY_BUILDS = Object.freeze(["1.60.1.70959"]);
  const isBuild = value => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,8}$/.test(value) && !/\s/.test(value);
  const savedBuild = (profile, now) => {
    const source = profile?.source;
    return source?.kind === "wow-addon" && typeof source.id === "string" && source.id.length > 0 &&
      typeof source.updatedAt === "string" && Date.parse(source.updatedAt) <= now && isBuild(profile.clientBuild)
      ? profile.clientBuild : null;
  };
  function reviewStatus(build, reviewedBuilds) {
    if (!isBuild(build)) return "unknown-build";
    if (!reviewedBuilds.length) return "no-review";
    return reviewedBuilds.includes(build) || carriedFrom(build, reviewedBuilds) ? "reviewed" : "needs-review";
  }
  const patchOf = build => (isBuild(build) ? build.slice(0, build.lastIndexOf(".")) : null);
  // The reviewed build of the same patch that stands in for this one, or null.
  function carriedFrom(build, reviewedBuilds) {
    if (!isBuild(build) || reviewedBuilds.includes(build)) return null;
    return reviewedBuilds.find(reviewed => patchOf(reviewed) === patchOf(build)) || null;
  }
  function forBuild(build, routeBuild) {
    const rows = [
      ["desktop-route", isBuild(routeBuild) ? [routeBuild] : []],
      ["frost-mage-guide", MAGE_GUIDE_BUILDS],
      ["frost-mage-abilities", MAGE_ABILITY_BUILDS],
    ].map(([id, reviewedBuilds]) => ({ id, reviewedBuilds: [...reviewedBuilds], status: reviewStatus(build, reviewedBuilds), carriedFrom: carriedFrom(build, reviewedBuilds) }));
    return { savedBuild: isBuild(build) ? build : null, rows };
  }
  const snapshot = (profile, routeBuild, now = Date.now()) => forBuild(savedBuild(profile, now), routeBuild);
  const api = { snapshot, forBuild, reviewStatus, carriedFrom, savedBuild, MAGE_GUIDE_BUILDS, MAGE_ABILITY_BUILDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PatchImpact = api;
})();
