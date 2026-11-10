"use strict";
/** Main-owned request identity. Native workers retain ownership until confirmed closed. */
class CompanionRequest {
  constructor(context) {
    this.context = context;
    this.active = null;
    context.subscribe(() => this.cancel("Provider response is no longer current because the context changed."));
  }
  cancel(message = "Provider response stopped. You can edit your question and send it again.") {
    const request = this.active;
    if (!request || request.controller.signal.aborted) return false;
    request.error = new Error(message);
    request.controller.abort(request.error);
    request.reject(request.error);
    if (!request.waitForSettlement && this.active === request) this.active = null;
    return true;
  }
  async run(operation, { waitForSettlement = false } = {}) {
    if (this.active) throw new Error(this.active.controller.signal.aborted
      ? "Provider request is still stopping. Wait for the official tool to close before trying again."
      : "Provider request already in progress.");
    const token = this.context.snapshot();
    const request = { controller: new AbortController(), waitForSettlement };
    const cancelled = new Promise((_, reject) => { request.reject = reject; });
    this.active = request;
    const work = (async () => {
      try {
        const result = await operation(request.controller.signal);
        if (request.controller.signal.aborted) throw request.error;
        if (!this.context.isCurrent(token)) throw new Error("Provider response is no longer current because the context changed.");
        return result;
      } finally {
        if (this.active === request) this.active = null;
      }
    })();
    return Promise.race([work, cancelled]);
  }
}
module.exports = { CompanionRequest };
