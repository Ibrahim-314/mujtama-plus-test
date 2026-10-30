/* v2.141.0 — design touches.
 * • Search typeahead: history items may come back as {id, q} objects — never «[object Object]»; a stale blur never
 *   cancels typeahead the user started after refocusing.
 * • Profile action row fits a 390 screen (wraps, never overflows).
 * • English placeholders for search. No page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });

test("390: search suggestions, profile actions fit, English placeholder", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "dz_v2141", "تصميم");
  // search typeahead with object-shaped history
  await p.route("**/api/search/suggest*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ q: "x", terms: ["تصميم"], history: [{ id: "h1", q: "تصميم واجهات" }], people: [], hashtags: [], communities: [] }) }));
  await p.goto(S.base + "/?nosw#/search"); await p.waitForSelector("#sq2");
  await p.fill("#sq2", "تصم"); await p.waitForSelector(".s-sugg:not([hidden]) .s-opt", { timeout: 8000 });
  const txt = await p.textContent(".s-sugg");
  assert.ok(!/object Object/.test(txt), "no [object Object]"); assert.match(txt, /تصميم واجهات/);
  await p.unroute("**/api/search/suggest*");
  // profile action row fits
  await p.goto(S.base + "/?nosw#/me"); await p.waitForSelector(".profile-top", { timeout: 8000 });
  const over = await p.evaluate(() => { const vw = document.documentElement.clientWidth; return [...document.querySelectorAll(".profile-top > .row .btn")].filter((b) => { const r = b.getBoundingClientRect(); return r.width && (r.right > vw + 1 || r.left < -1); }).length; });
  assert.equal(over, 0, "profile buttons stay on screen");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no horizontal overflow");
  // English placeholder
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.goto(S.base + "/?nosw#/search"); await p.waitForSelector("#sq2");
  await p.waitForTimeout(400);
  assert.match(await p.getAttribute("#sq2", "placeholder"), /Search people/);
  assert.deepEqual(errs, [], "no page errors");
  await c.close();
});
