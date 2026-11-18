"use strict";
// Questions typed in game (0.38, roadmap A15). The live strip delivers the text (see
// live-bridge.cjs question pages); this answers it through the same path as the AI Companion page
// (offline reference first for where/how questions, then the AI the player chose) and shows the
// answer in the panel over the game. Since 0.39.1 the owl only sends an "open" signal and the
// question is typed in the panel itself (askTyped); /bf ask QUESTION still arrives over the strip.
// Only the typed text is used, plus the active character when
// the Companion page's own "Use my active character" setting is on and the question comes from
// that character. Nothing is ever sent to the game.
const { workshopQuestion } = require("./companion-workshop.cjs");
const RETRY_MS = 2000, RETRY_FOR_MS = 30000;
// Companion errors meant for the player (same list as the main window's ask handler); others become generic.
const PLAYER_ERRORS = /^(Provider |Could not reach|Save an API|Choose a model|Choose a character|Choose the current character|ChatGPT |Claude |Grok |Install the official|Connect a supported|Subscription |The free AI)/;
const BUSY = /^Provider request (already in progress|is still stopping)/;
const NO_MODEL = /^Choose a model in Connections/;

/**
 * Who the question may describe: share is the Companion page's "Use my active character" setting;
 * expected is the live key of the active character (null when not known yet). A question from
 * another character than the app's active one gets no character details.
 */
function sharing({ share, expected, characterHash }) {
  if (!share) return { shareProfile: false, note: null };
  if (expected !== null && expected !== undefined && characterHash && expected !== characterHash) return { shareProfile: false, note: "Answered without character details: another character is active in the app." };
  return { shareProfile: true, note: null };
}
function playerMessage(error) {
  const m = String(error?.message || "");
  if (NO_MODEL.test(m)) return "Where and how questions are answered offline; this one needs an AI. Open the app and turn on the free AI (one click on the Companion page) or choose a model in Connections.";
  return PLAYER_ERRORS.test(m) ? m.slice(0, 300) : "The companion could not answer. Open the app to try again.";
}

class InGameAsk {
  constructor({ companion, getState, liveKeyFor = () => null, panel, notify = () => {}, getShare = () => false, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now }) {
    Object.assign(this, { companion, getState, liveKeyFor, panel, notify, getShare, wait, now });
    this.queue = Promise.resolve();
    this.handled = 0;
    this.seq = 0;
    this.lastHash = null;
  }
  /** Queues a question from the live strip: { id, text, characterHash }. Resolves when answered. */
  handle(question) {
    // The owl button (0.39.1): open the panel with the keyboard in its question box.
    if (question && question.kind === "open") {
      if (Number.isInteger(question.characterHash)) this.lastHash = question.characterHash;
      this.panel.open?.();
      return Promise.resolve(null);
    }
    if (!question || typeof question.text !== "string" || !question.text.trim() || question.text.length > 1000) return Promise.resolve(null);
    const run = this.queue.then(() => this.answer(question)).catch(() => null);
    this.queue = run;
    return run;
  }
  /** A question typed in the panel: asked for the character that last opened it from the game. */
  askTyped(text) {
    return this.handle({ text, characterHash: this.lastHash });
  }
  async answer({ text, characterHash = null }) {
    if (Number.isInteger(characterHash)) this.lastHash = characterHash;
    const prompt = text.trim();
    const id = ++this.seq;
    const state = this.getState();
    const profile = state.profiles?.find((p) => p.id === state.activeProfileId) || null;
    const expected = profile?.source?.kind === "wow-addon" ? this.liveKeyFor(profile.source.id) : null;
    const isWorkshop = Boolean(workshopQuestion(prompt));
    let { shareProfile, note } = sharing({ share: this.getShare() === true, expected, characterHash });
    if (shareProfile && isWorkshop && !(Number.isInteger(expected) && expected > 0 && expected === characterHash)) {
      shareProfile = false;
      note = "The game character could not be matched to the active save. Ask in the desktop Companion instead.";
    }
    this.panel.show({ id, status: "thinking", question: prompt, at: this.now() });
    let request = { provider: state.provider.id, prompt, shareProfile, memoryIds: [] };
    if (state.activeProfileId) request.profileId = state.activeProfileId;
    const started = this.now();
    for (;;) {
      try {
        const result = await this.companion.ask(request);
        this.handled++;
        this.panel.show({ id, status: "answer", question: prompt, answer: { text: result.text, kind: result.kind }, note, at: this.now() });
        // The exchange also joins the Companion page's conversation.
        this.notify({ question: prompt, shareProfile: request.shareProfile, result: { text: result.text, kind: result.kind, npc: result.npc, travel: result.travel, lookups: result.lookups, conversation: result.conversation } });
        return result;
      } catch (error) {
        // The main window is answering something else: wait for it, a little.
        if (BUSY.test(String(error?.message)) && this.now() - started < RETRY_FOR_MS) {
          await this.wait(RETRY_MS);
          if (isWorkshop && request.shareProfile) {
            const current = this.getState();
            const source = current.profiles?.find(p => p.id === current.activeProfileId)?.source;
            if (this.getShare() !== true || current.activeProfileId !== request.profileId || source?.kind !== "wow-addon" || this.liveKeyFor(source.id) !== characterHash) {
              request = { ...request, shareProfile: false };
              note = "Saved character context changed while waiting. You can ask again in Companion.";
            }
          }
          continue;
        }
        const message = playerMessage(error);
        this.panel.show({ id, status: "error", question: prompt, message, at: this.now() });
        return null;
      }
    }
  }
}
module.exports = { InGameAsk, sharing, playerMessage };
