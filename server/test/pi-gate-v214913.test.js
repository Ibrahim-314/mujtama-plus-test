/* v2.149.13 «بوابة Pi»: /api/pi/config carries piUrl — the app's official Pi Browser address — so the sign-in gate can offer
 * «افتح في متصفح Pi» outside Pi Browser. PI_APP_URL (https only) wins; the Render test copy falls back to the testnet app URL;
 * production (Railway / MJT_PRODUCTION) never gets a hard-coded default. */
const test = require("node:test"), assert = require("node:assert");
const { Router } = require("../lib/http");
const cfg = async (env) => {
  const router = new Router();
  const stubDb = { one: async () => null, all: async () => [], run: async () => ({}), tx: async (f) => f(stubDb), dialect: "sqlite" };
  require("../services/pi")({ db: stubDb, bus: { on() { }, emit() { } }, rl: { hit: () => true }, router, config: {}, requireUser: (fn) => fn, services: {} }, { env, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), jobs: false });
  return router.match("GET", "/api/pi/config").handler({ query: {} });
};
const TEST_URL = "https://mujtamakt6955.pinet.com";

test("piUrl: PI_APP_URL wins (https only, origin form), Render test defaults to the testnet app URL, production has no default", async () => {
  assert.equal((await cfg({ PI_APP_URL: "https://example.pinet.com/" })).piUrl, "https://example.pinet.com");
  assert.equal((await cfg({ PI_APP_URL: "http://evil.example" })).piUrl, undefined, "non-https ignored");
  assert.equal((await cfg({ PI_APP_URL: "javascript:alert(1)" })).piUrl, undefined);
  assert.equal((await cfg({ RENDER: "true" })).piUrl, TEST_URL, "Render test default");
  assert.equal((await cfg({ RENDER: "true", RAILWAY_ENVIRONMENT: "production" })).piUrl, undefined, "never a default on production");
  assert.equal((await cfg({ MJT_PRODUCTION: "1", RENDER: "true" })).piUrl, undefined);
  assert.equal((await cfg({ RAILWAY_ENVIRONMENT: "production", PI_APP_URL: "https://real.pinet.com" })).piUrl, "https://real.pinet.com", "production uses its own configured URL");
  assert.equal((await cfg({})).piUrl, undefined, "nothing configured → no piUrl (old shape kept)");
});
