"use strict";
// Shared desktop policy. Exact saved builds, never a live-client or player-readiness claim.
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
    return reviewedBuilds.includes(build) ? "reviewed" : "needs-review";
  }
  function forBuild(build, routeBuild) {
    const rows = [
      ["desktop-route", isBuild(routeBuild) ? [routeBuild] : []],
      ["frost-mage-guide", MAGE_GUIDE_BUILDS],
      ["frost-mage-abilities", MAGE_ABILITY_BUILDS],
    ].map(([id, reviewedBuilds]) => ({ id, reviewedBuilds: [...reviewedBuilds], status: reviewStatus(build, reviewedBuilds) }));
    return { savedBuild: isBuild(build) ? build : null, rows };
  }
  const snapshot = (profile, routeBuild, now = Date.now()) => forBuild(savedBuild(profile, now), routeBuild);
  const api = { snapshot, forBuild, reviewStatus, savedBuild, MAGE_GUIDE_BUILDS, MAGE_ABILITY_BUILDS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.PatchImpact = api;
})();
