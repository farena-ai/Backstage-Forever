"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}
function harness(overrides = {}) {
  const handlers = {};
  const automatic = {
    dataset: { updatePref: "automatic" },
    checked: true,
    matches: () => false,
  };
  const installOnQuit = {
    dataset: { updatePref: "installOnQuit" },
    checked: true,
    matches: () => false,
  };
  const summary = { textContent: "" };
  const label = { textContent: "" };
  const nodes = {
    "[data-update-summary]": summary,
    "[data-update-progress]": {},
    "[data-update-version]": {},
    '[data-command="install-update"]': {},
    '[data-command="check-updates"]': {},
  };
  const root = {
    addEventListener: (name, fn) => (handlers[name] ??= []).push(fn),
  };
  const polls = [];
  function select(selector) {
    if (selector.includes("data-update-pref")) {
      if (selector.includes("installOnQuit")) return [installOnQuit];
      if (selector.includes("automatic")) return [automatic];
      return [automatic, installOnQuit];
    }
    if (selector === "[data-update-label]") return [label];
    return nodes[selector] ? [nodes[selector]] : [];
  }
  const context = vm.createContext({
    window: {
      backstage: { bootstrap: () => new Promise(() => {}), ...overrides },
    },
    document: {
      addEventListener: () => {},
      body: { dataset: {} },
      hidden: false,
      getElementById: (id) => (id === "app" ? root : {}),
      querySelector: (selector) => select(selector)[0] || null,
      querySelectorAll: select,
    },
    setInterval: (fn) => {
      polls.push(fn);
      return polls.length;
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    crypto: {},
    console,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8"),
    context,
  );
  vm.runInContext("state = { onboarded: true };", context);
  return {
    context,
    automatic,
    installOnQuit,
    summary,
    poll: () => polls.forEach((fn) => fn()),
    change: (node, checked) => {
      node.checked = checked;
      return Promise.all(handlers.change.map((fn) => fn({ target: node })));
    },
    info: () =>
      JSON.parse(vm.runInContext("JSON.stringify(updateInfo)", context)),
  };
}

test("overlapping preference changes cannot silently re-enable automatic updates", async () => {
  const requests = [];
  const h = harness({
    setUpdatePreferences: (input) => {
      const wait = deferred();
      requests.push({ input: { ...input }, wait });
      return wait.promise;
    },
  });
  const first = h.change(h.automatic, false);
  const second = h.change(h.installOnQuit, false);
  assert.equal(requests[0].input.automatic, false);
  assert.equal(
    requests.some(({ input }) => input.automatic === true),
    false,
    "a second pending checkbox change must not restore stale automatic:true",
  );
  for (const { input, wait } of requests)
    wait.resolve({ ...input, phase: "disabled" });
  await Promise.all([first, second]);
  assert.equal(h.info().automatic, false);
  assert.equal(h.automatic.checked, h.info().automatic);
  assert.equal(h.installOnQuit.checked, h.info().installOnQuit);
});

test("a stale status poll cannot overwrite an acknowledged opt-out", async () => {
  const poll = deferred();
  let reads = 0;
  const save = deferred();
  const h = harness({
    updateStatus: () => {
      reads++;
      return poll.promise;
    },
    setUpdatePreferences: () => save.promise,
  });
  h.poll();
  assert.equal(reads, 1);
  const saving = h.change(h.automatic, false);
  save.resolve({ automatic: false, installOnQuit: true, phase: "disabled" });
  await saving;
  poll.resolve({ automatic: true, installOnQuit: true, phase: "idle" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.info().automatic, false);
  assert.equal(h.automatic.checked, false);
});

test("manual update checks report their actual phase when automatic checks are off", () => {
  const h = harness();
  for (const [phase, expected] of [
    ["checking", /checking/i],
    ["downloading", /download/i],
    ["ready", /ready/i],
    ["error", /fixture verification failure/i],
  ]) {
    vm.runInContext(
      `updateInfo = { automatic: false, installOnQuit: false, phase: ${JSON.stringify(phase)}, message: "Fixture verification failure" }; refreshUpdateWidgets();`,
      h.context,
    );
    assert.match(
      h.summary.textContent,
      expected,
      `${phase} feedback should not be masked by automatic opt-out`,
    );
  }
});

test("a failed newer download remains visible beside the older ready installer", () => {
  const h = harness();
  vm.runInContext(
    'updateInfo = { phase: "ready", readyVersion: "0.4.0", availableVersion: "0.5.0", message: "The update download was interrupted. Retry, or use the Releases page." }; refreshUpdateWidgets();',
    h.context,
  );
  assert.match(h.summary.textContent, /interrupted/);
  assert.match(h.summary.textContent, /0\.4\.0.*ready/i);
  assert.equal(
    vm.runInContext(
      "document.querySelector('[data-command=\"check-updates\"]').textContent",
      h.context,
    ),
    "Retry update",
  );
  assert.match(
    vm.runInContext("updatesPage()", h.context),
    /data-link="releases"/,
  );
});
