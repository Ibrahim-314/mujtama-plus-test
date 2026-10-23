/* Phase 51 + 56 e2e against the REAL server (production build, Pi payments off — exactly like production), inline-handler check on the chunk source.
 * Admin opens #/admin/pi-activation: checklist shows the missing Pi API key with its fix, the in-memory dry run passes every
 * step; #/transfers shows the «not enabled yet» card with the limits; the send form is disabled; admin home links both pages.
 * Also: no page errors, no inline handlers / javascript: URLs in the transfers chunk. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "tr_e2e", "مختبر التحويلات");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("activation checklist + dry run; transfers off card; no CSP violations", async () => {
  await p.goto(S.base + "/?nosw#/admin/pi-activation");
  await until(() => /مفتاح Pi API/.test(document.querySelector(".tr-ck")?.textContent || ""), undefined, 30000);
  assert.match(await p.textContent(".tr-hero"), /متوقفة/);
  assert.match(await p.textContent(".wrap"), /PI_API_KEY/);
  await p.click("#pa-dry");
  await until(() => /نجحت كل الخطوات/.test(document.querySelector("#pa-out")?.textContent || ""));
  assert.equal(await p.locator("#pa-out .ic.ok").count(), 6);
  assert.equal(await p.isDisabled("#pa-test"), true);
  await p.goto(S.base + "/?nosw#/transfers");
  await until(() => /غير مفعّلة بعد/.test(document.querySelector(".tr-page")?.textContent || ""));
  assert.match(await p.textContent(".tr-page"), /حدود التحويل/);
  await p.goto(S.base + "/?nosw#/transfers/send?to=someone");
  await until(() => !!document.querySelector("#tr-go")?.disabled);
  await p.goto(S.base + "/?nosw#/admin");
  await until(() => !!document.querySelector('#tr-adm a[href="#/admin/pi-activation"]'));
  const src = fs.readFileSync(path.join(ROOT, "transfers-ui.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(src, /\son[a-z]+=["']|javascript:/);
  assert.deepEqual(errors, []);
});
