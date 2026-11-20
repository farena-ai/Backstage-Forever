"use strict";

const sections = [
  ["attendance", "Confirmed attendance", 64, 80],
  ["progression", "Progression", 16, 240],
  ["assignments", "Assignments", 16, 240],
  ["followUps", "Follow-ups", 16, 240],
];
const forbidden = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const invalid = () => new Error("Guild Run Pack officer debrief is invalid. Check the line and character limits.");
const emptyDebrief = () => ({ revision: 0, facts: { attendance: [], progression: [], assignments: [], followUps: [], privateNote: "" } });

function validateFacts(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts) || Object.keys(facts).length !== sections.length + 1 ||
      !Object.hasOwn(facts, "privateNote") || typeof facts.privateNote !== "string" || facts.privateNote.length > 1000 ||
      forbidden.test(facts.privateNote.replaceAll("\n", ""))) throw invalid();
  for (const [key, , maxLines, maxLength] of sections) {
    const values = facts[key];
    if (!Object.hasOwn(facts, key) || !Array.isArray(values) || values.length > maxLines) throw invalid();
    for (const line of values) {
      if (typeof line !== "string" || !line || line.length > maxLength || line !== line.trim() || forbidden.test(line)) throw invalid();
    }
  }
}

function validateDebrief(record) {
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).length !== 2 ||
      !Object.hasOwn(record, "revision") || !Number.isSafeInteger(record.revision) || record.revision < 1 ||
      !Object.hasOwn(record, "facts")) throw invalid();
  validateFacts(record.facts);
}

// Only named manual fact sections are shareable. Keep the local note out by construction.
function nextRunText(title, facts) {
  const included = sections.filter(([key]) => facts[key].length);
  if (!included.length) throw new Error("Guild Run Pack next-run copy needs saved, confirmed facts.");
  return [`Next-run handoff: ${title}`, ...included.map(([key, label]) =>
    [label, ...facts[key].map(line => `- ${line}`)].join("\n"))].join("\n\n");
}

module.exports = { emptyDebrief, validateDebrief, nextRunText };
