"use strict";
const { CITIES, ENDPOINTS, BUILD } = require("./travel-sources.cjs");
const { loadTravelReference } = require("./travel-data.cjs");
const { questionForEvidence } = require("./companion-conversation.cjs");
const normalize = (s) =>
  s.toLowerCase().replace(/’/g, "'").replace(/\s+/g, " ").trim();
const aliases = new Map([
  ...CITIES.flatMap(([id, , names]) => names.map((n) => [normalize(n), id])),
  ...ENDPOINTS.map(([id, label]) => [normalize(label), id]),
]);
const labels = new Map(
  [...CITIES, ...ENDPOINTS].map(([id, label]) => [id, label]),
);
function endpoint(raw) {
  const cleaned = raw
    .trim()
    .replace(/[?.!,]+$/, "")
    .replace(
      /\s+(?:please|in (?:wow )?forever|by (?:flight|zeppelin|boat|tram|road))$/i,
      "",
    )
    .trim();
  const id = aliases.get(normalize(cleaned)) || null;
  const label = id
    ? labels.get(id)
    : /^[a-z][a-z0-9 '\-]{0,79}$/i.test(cleaned) &&
        !/^(?:here|there|home)$/i.test(cleaned)
      ? cleaned
      : null;
  return { id, label };
}
function savedOrigin(profile) {
  if (
    profile?.source?.kind !== "wow-addon" ||
    typeof profile.source.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(profile.source.updatedAt))
  )
    return null;
  const location = profile.location;
  for (const value of [location?.subZone, location?.zone])
    if (typeof value === "string") {
      const e = endpoint(value);
      if (e.id && CITIES.some(([id]) => id === e.id)) return e;
    }
  return null;
}
/** previousQuestion must be a main-owned original USER question, never assistant prose. */
function parseTravelIntent(question, { previousQuestion, profile } = {}) {
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > 12000
  )
    return null;
  const q = question.trim();
  // Reuse the conversation service's grammar without depending on its state.
  const marker = {};
  if (questionForEvidence(q, marker) === marker)
    return typeof previousQuestion === "string" && previousQuestion !== q
      ? parseTravelIntent(previousQuestion, { profile })
      : null;
  if (
    /\bget\s+to\s+(?:level\s*|lvl\s*)\d+/i.test(q) ||
    /\b(?:quest|level)\s+next\b/i.test(q)
  )
    return null;
  const travel =
    /\b(?:travel|flight|fly|zeppelin|boat|tram|route|fastest way)\b/i.test(q) ||
    /\b(?:get|go|walk)\b.*\b(?:to|from|there)\b/i.test(q) ||
    /^[a-z '\-]+\s+to\s+[a-z '\-]+[?.!]?$/i.test(q) ||
    /\bfrom\s+.+\s+to\s+/i.test(q);
  if (!travel) return null;
  const result = {
    status: "clarify",
    question: q,
    originId: null,
    destinationId: null,
    originLabel: null,
    destinationLabel: null,
    originSource: "unknown",
    reason: "missing-endpoint",
    clarification: "What are your starting place and destination?",
  };
  if (/\b(?:or|then|and)\b/i.test(q)) {
    result.reason = "ambiguous";
    result.clarification =
      "Which single starting place and destination should I use for this trip?";
    return result;
  }
  let from,
    to,
    explicit = false;
  const forward = q.match(/\bfrom\s+(.+?)\s+to\s+(.+)$/i);
  const reverse = q.match(/.*\bto\s+(.+?)\s+from\s+(.+)$/i);
  if (forward) {
    [, from, to] = forward;
    explicit = true;
  } else if (reverse) {
    to = reverse[1];
    from = reverse[2];
    explicit = true;
  } else {
    const simple = q.match(/^([a-z '\-]+?)\s+to\s+(.+)$/i);
    if (
      simple &&
      !/\b(?:how|what|way|get|go|travel|walk|fly|boat|tram|zeppelin|route|want|need)\b/i.test(
        simple[1],
      )
    ) {
      from = simple[1];
      to = simple[2];
      explicit = true;
    } else {
      const destination = q.match(/.*\bto\s+(.+)$/i);
      if (destination) to = destination[1];
    }
  }
  if (from) {
    const e = endpoint(from);
    result.originId = e.id;
    result.originLabel = e.label;
    result.originSource = "explicit";
  }
  if (to) {
    const e = endpoint(to);
    result.destinationId = e.id;
    result.destinationLabel = e.label;
  }
  if (!explicit) {
    const e = savedOrigin(profile);
    if (e) {
      result.originId = e.id;
      result.originLabel = e.label;
      result.originSource = "saved-location";
    }
  }
  if (result.originId && result.destinationId) {
    result.status = "ready";
    delete result.reason;
    delete result.clarification;
  } else if ((from && !result.originId) || (to && !result.destinationId)) {
    result.reason = "unknown-endpoint";
    result.clarification = result.destinationId
      ? "Which named starting city or transport stop are you using?"
      : "Which named destination or transport stop are you using?";
  } else if (result.destinationId)
    result.clarification = "Where are you starting this trip?";
  else if (result.originId)
    result.clarification =
      "Where do you want to travel from " + result.originLabel + "?";
  return result;
}
const COVERAGE =
  "Small dated reference: six conditional flights, ten directed scheduled-transport segments, and one Orgrimmar to Thunder Bluff road itinerary. Other routes may exist beyond this coverage.";
function planTravel(reference, intent, { profile } = {}) {
  const result = {
    status: "unavailable",
    text: "The local Forever travel reference is unavailable. I cannot verify this trip from it.",
    origin: null,
    destination: null,
    options: [],
    cautions: [],
    sources: [],
    coverage: COVERAGE,
  };
  let ref;
  try {
    ref = loadTravelReference(JSON.stringify(reference));
  } catch {
    return result;
  }
  if (!intent || !["ready", "clarify"].includes(intent.status)) return result;
  const node = (id) => ref.nodes.find((n) => n.id === id);
  const safeLabel = (value) =>
    typeof value === "string" && /^[a-z][a-z0-9 '\-]{0,99}$/i.test(value)
      ? value
      : null;
  const origin = node(intent.originId),
    destination = node(intent.destinationId);
  result.origin = origin
    ? { id: origin.id, label: origin.label }
    : safeLabel(intent.originLabel)
      ? { id: null, label: intent.originLabel }
      : null;
  result.destination = destination
    ? { id: destination.id, label: destination.label }
    : safeLabel(intent.destinationLabel)
      ? { id: null, label: intent.destinationLabel }
      : null;
  if (intent.originSource === "saved-location" && result.origin)
    result.cautions.push(
      "Starting from your last-saved location, not a live position. Confirm you are still at " +
        result.origin.label +
        ".",
    );
  if (intent.status === "clarify" || !origin || !destination) {
    if (
      intent.reason === "unknown-endpoint" &&
      result.origin &&
      result.destination
    ) {
      result.status = "uncovered";
      result.text =
        "This local reference does not cover a verified connection from " +
        result.origin.label +
        " to " +
        result.destination.label +
        ". " +
        COVERAGE;
    } else {
      result.status = "clarify";
      result.text =
        intent.reason === "ambiguous"
          ? "Which single starting place and destination should I use for this trip?"
          : intent.reason === "correction"
            ? "Which starting place and destination did you mean for Forever?"
            : result.destination
              ? "Where are you starting this trip?"
              : result.origin
                ? "Which destination or transport stop do you mean from " +
                  result.origin.label +
                  "?"
                : "What are your starting place and destination?";
    }
    result.text = [result.text, ...result.cautions].join("\n\n");
    return result;
  }
  if (origin.id === destination.id) {
    result.status = "same-place";
    result.text =
      "Both endpoints name " +
      origin.label +
      ". That identifies the same named place, not your precise position or arrival at a specific stop.";
    result.text = [result.text, ...result.cautions].join("\n\n");
    return result;
  }
  const at = (endpointId, requested) =>
    endpointId === requested.id ||
    (requested.kind === "city" && node(endpointId)?.cityId === requested.id);
  const candidates = ref.edges.filter(
    (e) => at(e.from, origin) && at(e.to, destination),
  );
  const roads = ref.itineraries.filter(
    (i) => i.from === origin.id && i.to === destination.id,
  );
  const faction = ["Horde", "Alliance"].includes(profile?.faction)
    ? profile.faction
    : null;
  const eligible = (e) => e.faction === "neutral" || e.faction === faction;
  const matching =
    profile?.source?.kind === "wow-addon" &&
    profile?.clientBuild === BUILD &&
    typeof profile?.source?.updatedAt === "string" &&
    Number.isFinite(Date.parse(profile.source.updatedAt));
  const allowed = candidates.filter(
    (e) => eligible(e) && (e.mode !== "flight" || matching),
  );
  const availableRoads = roads.filter(eligible);
  if (candidates.some((e) => e.mode === "flight") && !matching)
    result.cautions.push(
      "Exact-build flight observations are not offered as a current route: a dated shared addon observation is missing, manual, or does not establish matching build " +
        BUILD +
        ".",
    );
  if ([...candidates, ...roads].some((e) => !eligible(e)))
    result.cautions.push(
      faction
        ? "This reference does not establish your " +
            faction +
            " eligibility for the faction-restricted routes."
        : "Your faction is unknown; faction-restricted routes are not offered as usable.",
    );
  for (const e of [...allowed, ...availableRoads])
    result.options.push({
      id: e.id,
      title:
        e.mode === "road"
          ? "Documented road fallback"
          : e.mode === "flight"
            ? "Check the flight master"
            : "Documented " + e.mode + " segment",
      mode: e.mode,
      conditional: true,
      steps: [...e.steps],
      sourceIds: [...e.sourceIds],
    });
  const negatives = ref.negatives.filter(
    (n) => n.from === origin.id && n.to === destination.id,
  );
  if (!result.options.length) {
    result.status =
      !faction && [...candidates, ...roads].some((e) => e.faction !== "neutral")
        ? "clarify"
        : "uncovered";
    result.text =
      result.status === "clarify"
        ? "Which faction is this trip for?"
        : "This reference lacks a verified usable connection from " +
          origin.label +
          " to " +
          destination.label +
          ".";
  } else {
    result.status = "route";
    result.text = "From " + origin.label + " to " + destination.label + ":";
  }
  result.cautions.push(
    "Player unlocks, current service operation, costs, timing and level suitability are unknown.",
  );
  if (
    typeof intent.question === "string" &&
    /\bfastest\b/i.test(intent.question)
  )
    result.cautions.push(
      "An offered flight may save walking; the actual fastest route is unknown.",
    );
  if (availableRoads.length)
    result.cautions.push(
      "The road itinerary gives broad published landmarks, not continuous navigation or a safety assessment.",
    );
  const ids = new Set([
    ...result.options.flatMap((o) => o.sourceIds),
    ...negatives.flatMap((n) => n.sourceIds),
  ]);
  result.sources = ref.sources
    .filter((s) => ids.has(s.id))
    .map((s) => ({ ...s }));
  const sections = [
    result.text,
    ...result.options.map(
      (o) =>
        o.title +
        " [" +
        o.sourceIds.join(", ") +
        "]\n" +
        o.steps.map((s, i) => i + 1 + ". " + s).join("\n"),
    ),
    ...negatives.map((n) => n.text + " [" + n.sourceIds.join(", ") + "]"),
    ...result.cautions,
  ];
  if (result.sources.length)
    sections.push(
      "Sources:\n" +
        result.sources
          .map(
            (s) =>
              s.id +
              " — " +
              s.publisher +
              ": " +
              (s.scope === "exact-build-observation"
                ? "published community observations, build " +
                  s.build +
                  ", observed " +
                  s.observedOn
                : s.scope.includes("prelaunch")
                  ? "general prelaunch Forever guidance, published " +
                    s.publishedOn
                  : "general published Forever guidance, " + s.publishedOn) +
              "; reviewed " +
              s.reviewedOn +
              ". " +
              s.url,
          )
          .join("\n"),
    );
  sections.push(COVERAGE);
  result.text = sections.join("\n\n");
  return result;
}
module.exports = { parseTravelIntent, planTravel };
