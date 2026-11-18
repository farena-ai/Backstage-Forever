"use strict";
const { validateState, PERSISTED_BADGE_AWARDS } = require("./validation.cjs");

// This list is the schema-1 wire contract of v1.8.0, not the current badge catalog.
const legacyAwards = new Set([
  "alchemy", "blacksmithing", "cooking", "enchanting", "engineering", "first-aid",
  "fishing", "herbalism", "leatherworking", "mining", "skinning", "tailoring",
].flatMap(profession => [150, 300].map(rank => `profession-${profession}-${rank}`)));
const isLegacy = id => legacyAwards.has(id);

// Only call after decoding has validated the entire persisted state.
function hasInlineDesktopAwards(state) {
  return state.profiles.some(profile => profile.badgeAwards?.some(id => !isLegacy(id)));
}

// v1.8.0 validates the top-level award list strictly, but ignores unknown
// journal properties and clones them through its ordinary saves. Keep both
// catalogs in the same atomic file, with no sidecar to orphan or misassociate.
// Takes already validated application state; never changes the in-memory model.
function encodeJournalState(state) {
  return { ...state, profiles: state.profiles.map(profile => {
    const newer = profile.badgeAwards?.filter(id => !isLegacy(id));
    if (!newer?.length) return profile;
    const { badgeAwards, ...encoded } = profile;
    const legacy = badgeAwards.filter(isLegacy);
    if (legacy.length) encoded.badgeAwards = legacy;
    encoded.journal = { ...profile.journal, [PERSISTED_BADGE_AWARDS]: newer };
    return encoded;
  }) };
}

function decodeJournalState(state) {
  if (!Array.isArray(state?.profiles) || state.profiles.length > 100) return validateState(state);
  return validateState({ ...state, profiles: state.profiles.map(profile => {
    if (!profile?.journal || !Object.hasOwn(profile.journal, PERSISTED_BADGE_AWARDS)) return profile;
    const { [PERSISTED_BADGE_AWARDS]: newer, ...journal } = profile.journal;
    const legacy = profile.badgeAwards === undefined ? [] : profile.badgeAwards;
    const { validBadgeAwards } = require("./badges.cjs");
    if (!validBadgeAwards(newer) || !newer.length || newer.some(isLegacy) ||
        !validBadgeAwards(legacy) || !legacy.every(isLegacy))
      throw new Error("Invalid data. Please check the selected fields or backup.");
    const decoded = { ...profile, badgeAwards: [...legacy, ...newer] };
    if (Object.keys(journal).length) decoded.journal = journal;
    else delete decoded.journal;
    return decoded;
  }) });
}

module.exports = { encodeJournalState, decodeJournalState, hasInlineDesktopAwards };