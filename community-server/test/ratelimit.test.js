"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { RateLimiter } = require("../lib/ratelimit");

test("fixed window allows `limit` hits per key then refuses until the window ends", () => {
  const rl = new RateLimiter({ limit: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) assert.equal(rl.hit("a", 0).ok, true);
  const denied = rl.hit("a", 400);
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterSec, 1);
  assert.equal(rl.hit("b", 400).ok, true); // keys are independent
  assert.equal(rl.hit("a", 1000).ok, true); // new window
});

test("sweeps expired keys and never grows past maxKeys", () => {
  const rl = new RateLimiter({ limit: 1, windowMs: 100, maxKeys: 10 });
  for (let i = 0; i < 10; i++) rl.hit(`k${i}`, 0);
  rl.hit("new", 200); // all old windows expired -> swept
  assert.equal(rl.buckets.size, 1);
  for (let i = 0; i < 50; i++) rl.hit(`flood${i}`, 250);
  assert.ok(rl.buckets.size <= 10);
});
