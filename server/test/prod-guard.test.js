"use strict";
const test = require("node:test"), assert = require("node:assert");
const { testSwitches, isProduction } = require("../lib/prod-guard");

test("prod-guard: local/Render keeps the switches it was given", () => {
  const g = testSwitches({ DEMO_LOGIN: "1", DEMO_MESSAGES: "1" });
  assert.equal(g.production, false);
  assert.deepEqual([g.seedDemo, g.demoLogin, g.demoMessages], [true, true, true]);
  assert.deepEqual(g.blocked, []);
  assert.equal(testSwitches({ SEED_DEMO: "0" }).seedDemo, false);
});

test("prod-guard: Railway refuses every test-only switch and reports the ones that asked", () => {
  for (const marker of [{ RAILWAY_ENVIRONMENT: "production" }, { RAILWAY_PROJECT_ID: "x" }, { MJT_PRODUCTION: "1" }]) {
    assert.equal(isProduction(marker), true);
    const g = testSwitches({ ...marker, SEED_DEMO: "1", DEMO_LOGIN: "1", DEMO_MESSAGES: "1" });
    assert.deepEqual([g.seedDemo, g.demoLogin, g.demoMessages], [false, false, false]);
    assert.deepEqual(g.blocked.sort(), ["DEMO_LOGIN", "DEMO_MESSAGES", "SEED_DEMO"]);
  }
  // unset SEED_DEMO (default-on locally) is still off in production, without a noisy report
  const quiet = testSwitches({ RAILWAY_ENVIRONMENT: "production" });
  assert.equal(quiet.seedDemo, false); assert.deepEqual(quiet.blocked, []);
});

test("prod-guard: the real Railway env (SEED_DEMO=0, no demo flags) is clean", () => {
  const g = testSwitches({ RAILWAY_ENVIRONMENT: "production", SEED_DEMO: "0" });
  assert.deepEqual([g.seedDemo, g.demoLogin, g.demoMessages, g.blocked.length], [false, false, false, 0]);
});
