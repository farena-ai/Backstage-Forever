"use strict";

// Event wording only. No profile, Journey, or organizer record is an input.
function newcomerMentorDraft() {
  return {
    title: "Newcomer dungeon run",
    duties: [{ role: "all", text: "Ask for a volunteer mentor; welcome questions and agree on a relaxed pace." }],
    prep: ["Agree on roles and a meeting point before setting off."],
  };
}

module.exports = { newcomerMentorDraft };