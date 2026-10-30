"use strict";
/* v2.143 «حارس الإنتاج»: test-only switches can never run on the production host (Railway), whatever its env says.
 * Production = Railway runtime vars or MJT_PRODUCTION=1. Every switch below is forced off there, and the blocked ones are
 * reported once at boot so a stray variable is visible in the logs instead of silently seeding fake data for real people. */
const TEST_ONLY = {
  SEED_DEMO: (v) => v !== "0",           // demo posts/users seeding (defaults ON locally, so production must refuse it outright)
  DEMO_LOGIN: (v) => v === "1",          // «دخول تجريبي» button
  DEMO_MESSAGES: (v) => v === "1"        // seeded demo DMs/groups for the messages-AI tests
};

function isProduction(env = process.env) {
  return !!(env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID || env.MJT_PRODUCTION === "1");
}

/** Returns { production, seedDemo, demoLogin, demoMessages, blocked: [names that asked to be on but were refused] }. */
function testSwitches(env = process.env) {
  const production = isProduction(env);
  const wants = {}; const blocked = [];
  for (const [name, on] of Object.entries(TEST_ONLY)) {
    const asked = on(env[name]);
    // SEED_DEMO is on by default when unset; in production only an explicit request counts as «asked» for the report
    if (production && asked && (name !== "SEED_DEMO" || env[name] !== undefined)) blocked.push(name);
    wants[name] = production ? false : asked;
  }
  return { production, seedDemo: wants.SEED_DEMO, demoLogin: wants.DEMO_LOGIN, demoMessages: wants.DEMO_MESSAGES, blocked };
}

module.exports = { isProduction, testSwitches, TEST_ONLY: Object.keys(TEST_ONLY) };
