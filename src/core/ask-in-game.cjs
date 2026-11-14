"use strict";
// Questions typed in game (0.38, roadmap A15). The live strip delivers the text (see
// live-bridge.cjs question pages); this answers it through the same path as the AI Companion page
// (offline reference first for where/how questions, then the AI the player chose) and shows the
// answer in the panel over the game. Only the typed text is used, plus the active character when
// the Companion page's own "Use my active character" setting is on and the question comes from
// that character. Nothing is ever sent to the game.
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
  }
  /** Queues a question from the live strip: { id, text, characterHash }. Resolves when answered. */
  handle(question) {
    if (!question || typeof question.text !== "string" || !question.text.trim() || question.text.length > 1000) return Promise.resolve(null);
    const run = this.queue.then(() => this.answer(question)).catch(() => null);
    this.queue = run;
    return run;
  }
  async answer({ text, characterHash = null }) {
    const prompt = text.trim();
    const state = this.getState();
    const profile = state.profiles?.find((p) => p.id === state.activeProfileId) || null;
    const expected = profile?.source?.kind === "wow-addon" ? this.liveKeyFor(profile.source.id) : null;
    const { shareProfile, note } = sharing({ share: this.getShare() === true, expected, characterHash });
    this.panel.show({ status: "thinking", question: prompt, at: this.now() });
    const request = { provider: state.provider.id, prompt, shareProfile, memoryIds: [] };
    if (state.activeProfileId) request.profileId = state.activeProfileId;
    const started = this.now();
    for (;;) {
      try {
        const result = await this.companion.ask(request);
        this.handled++;
        this.panel.show({ status: "answer", question: prompt, answer: { text: result.text, kind: result.kind }, note, at: this.now() });
        // The exchange also joins the Companion page's conversation.
        this.notify({ question: prompt, shareProfile, result: { text: result.text, kind: result.kind, npc: result.npc, travel: result.travel, lookups: result.lookups, conversation: result.conversation } });
        return result;
      } catch (error) {
        // The main window is answering something else: wait for it, a little.
        if (BUSY.test(String(error?.message)) && this.now() - started < RETRY_FOR_MS) { await this.wait(RETRY_MS); continue; }
        const message = playerMessage(error);
        this.panel.show({ status: "error", question: prompt, message, at: this.now() });
        return null;
      }
    }
  }
}
module.exports = { InGameAsk, sharing, playerMessage };
