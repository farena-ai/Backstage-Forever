"use strict";
const { randomUUID, createHash } = require("node:crypto");
const { parseTravelIntent, planTravel } = require("./travel.cjs");
const { SOURCES } = require("./travel-sources.cjs");
const { applyJourneyAction } = require("./journeys.cjs");
const { object } = require("./validation.cjs");
function localProfile(profile) {
  if (!profile) return undefined;
  const { faction, clientBuild } = profile,
    location = profile.location;
  return {
    faction,
    clientBuild,
    location: location
      ? {
          zone: location.zone,
          subZone: location.subZone,
          mapId: location.mapId,
          x: location.x,
          y: location.y,
        }
      : undefined,
    source: profile.source
      ? { kind: profile.source.kind, updatedAt: profile.source.updatedAt }
      : undefined,
  };
}
/** Volatile trusted choices; renderer text never supplies actions or destinations. */
class TravelCompanion {
  constructor({ store, context, reference, openExternal, writeClipboard }) {
    Object.assign(this, {
      store,
      context,
      reference,
      openExternal,
      writeClipboard,
    });
    this.clear();
    context.subscribe(({ reason }) => {
      if (!["renderer-context", "memory-save"].includes(reason)) this.clear();
    });
  }
  clear() {
    this.trip = null;
    this.choice = null;
  }
  fingerprint(profileId) {
    const s = this.store.state,
      p = s.profiles.find((p) => p.id === profileId);
    return JSON.stringify([
      s.activeProfileId,
      s.provider,
      p?.source?.id,
      localProfile(p),
      createHash("sha256").update(JSON.stringify(this.reference)).digest("hex"),
    ]);
  }
  resolve(question, { profileId, shareProfile }) {
    const fingerprint = this.fingerprint(profileId),
      previous = this.trip?.fingerprint === fingerprint ? this.trip : null;
    const profile = shareProfile
      ? localProfile(this.store.state.profiles.find((p) => p.id === profileId))
      : undefined;
    let intent = parseTravelIntent(question, {
        profile,
        previousQuestion: previous?.question,
      }),
      reported;
    const short = question.trim();
    const originOnly = short.match(
      /^(?:travel|how (?:can|do) i (?:travel|go)) from ([a-z '\-]+)[?.!]*$/i,
    );
    if (originOnly) {
      const known = parseTravelIntent(originOnly[1] + " to " + originOnly[1]);
      if (known?.status === "ready")
        intent = {
          ...known,
          question,
          status: "clarify",
          destinationId: null,
          destinationLabel: null,
          reason: "missing-endpoint",
        };
    }
    if (
      previous &&
      /^(?:which is fastest|can i walk instead|what are (?:my |the )?options|which option)[?!.]*$/i.test(
        short,
      )
    ) {
      intent = previous.intent;
      reported = previous.reported;
    }
    if (intent && previous && intent.question === previous.question)
      reported = previous.reported;
    if (previous?.pending && short.length <= 80) {
      const faction = short.match(
        /^(?:i(?:'m| am)|for|my faction is)?\s*(horde|alliance)[.!]?$/i,
      );
      if (
        faction &&
        previous.intent.originId &&
        previous.intent.destinationId
      ) {
        reported =
          faction[1][0].toUpperCase() + faction[1].slice(1).toLowerCase();
        intent = previous.intent;
      } else if (!intent && /^[a-z '\-]+[.!]?$/i.test(short)) {
        const old = previous.intent;
        let candidate;
        if (!old.originId && old.destinationLabel)
          candidate = parseTravelIntent(
            "from " +
              short.replace(/[.!]$/, "") +
              " to " +
              old.destinationLabel,
            { profile },
          );
        else if (old.originLabel && !old.destinationId)
          candidate = parseTravelIntent(
            "from " + old.originLabel + " to " + short.replace(/[.!]$/, ""),
            { profile },
          );
        if (candidate?.status === "ready") intent = candidate;
      }
    }
    if (!intent) return null;
    const effective = reported ? { faction: reported } : profile;
    const result = planTravel(this.reference, intent, { profile: effective });
    if (reported) {
      const note =
        "Faction is user-reported for this trip; it does not establish an observed client build.";
      result.cautions.unshift(note);
      result.text += "\n\n" + note;
    }
    const claims = (this.reference?.negatives || [])
      .filter(
        (n) => n.from === intent.originId && n.to === intent.destinationId,
      )
      .map((n) => ({ text: n.text, sourceIds: [...n.sourceIds] }));
    const dto = {
      status: result.status,
      headline: result.text.split("\n")[0],
      origin: result.origin,
      destination: result.destination,
      options: result.options,
      cautions: result.cautions,
      claims,
      sources: result.sources,
      coverage: result.coverage,
      choiceToken: null,
    };
    return {
      text: result.text,
      dto,
      trip: {
        question: intent.question,
        intent,
        reported,
        fingerprint,
        pending: result.status === "clarify",
      },
      profileId,
      fingerprint,
    };
  }
  commit(resolution) {
    this.choice = null;
    this.trip = resolution.trip;
    if (resolution.dto.status === "route" && resolution.dto.options.length) {
      resolution.dto.choiceToken = randomUUID();
      this.choice = { ...resolution, token: resolution.dto.choiceToken };
    }
    return structuredClone(resolution.dto);
  }
  currentChoice(token) {
    this.context.sync();
    const c = this.choice;
    if (
      !c ||
      token !== c.token ||
      c.profileId !== this.store.state.activeProfileId ||
      this.fingerprint(c.profileId) !== c.fingerprint
    )
      throw Error("This trip choice is no longer current. Ask again.");
    return c;
  }
  copyGuidance(...args) {
    if (args.length !== 1 || typeof args[0] !== "string")
      throw Error("Invalid travel copy request.");
    const choice = this.currentChoice(args[0]);
    this.writeClipboard(choice.text);
    return { copied: true };
  }
  createPlan(...args) {
    if (args.length !== 1) throw Error("Invalid trip plan request.");
    const input = args[0];
    object(input, ["profileId", "token", "optionId"]);
    if (Object.keys(input).length !== 3)
      throw Error("Invalid trip plan request.");
    const c = this.currentChoice(input.token);
    if (input.profileId !== c.profileId)
      throw Error("This trip choice is no longer current. Ask again.");
    const option = c.dto.options.find((o) => o.id === input.optionId);
    if (!option) throw Error("Invalid trip option.");
    const title = (
        c.dto.origin.label +
        " to " +
        c.dto.destination.label +
        " · " +
        option.mode
      ).slice(0, 100),
      steps = option.steps;
    const prior = (this.store.state.journeys || []).find(
      (j) =>
        j.title === title &&
        j.steps.length === steps.length &&
        j.steps.every(
          (s, i) =>
            s.text === steps[i] &&
            s.profileId === input.profileId &&
            !s.quest &&
            !s.observed,
        ),
    );
    if (prior)
      return {
        state: structuredClone(this.store.state),
        journeyId: prior.id,
        reused: true,
      };
    let next = applyJourneyAction(this.store.state, {
        type: "create",
        title,
        profileId: input.profileId,
      }),
      journeyId = next.journeys.at(-1).id;
    for (const text of steps)
      next = applyJourneyAction(next, {
        type: "add-note",
        journeyId,
        text,
        profileId: input.profileId,
      });
    const state = this.store.saveState(next);
    return { state, journeyId, reused: false };
  }
  async openSource(...args) {
    if (args.length !== 1 || typeof args[0] !== "string")
      throw Error("Invalid travel source.");
    const source = SOURCES.find((s) => s.id === args[0]);
    if (!source) throw Error("Invalid travel source.");
    await this.openExternal(source.url);
    return { opened: true };
  }
}
module.exports = { TravelCompanion, localProfile };
