/* v2.156.0 — membership page #/membership: Free state + comparison from the server, Pi off → no buy button (clear note),
 * a staff grant shows Plus with its dates, settings link, axe, no horizontal scroll at 320 px. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, MOBILE } = require("./harness");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const axeRun = async (p, sel) => { await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") }); return p.evaluate(async (sel) => (await axe.run(document.querySelector(sel), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((v) => v.id + ":" + v.nodes.length), sel); };

test("membership: Free → comparison, Pi off note; granted Plus → dates; axe; 320 px", async () => {
  const c = await S.browser.newContext({ ...MOBILE, viewport: { width: 320, height: 700 } }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "mb_page", "عضو العضوية"); await dismissTour(p);
  await p.goto(S.base + "/?nosw#/membership"); await p.waitForSelector("#mb-t");
  assert.equal((await p.textContent("#mb-t")).trim(), "Free");
  assert.equal(await p.getAttribute(".mb-hero [data-state]", "data-state"), "free");
  assert.equal(await p.$$eval(".mb-col", (x) => x.length), 2, "Free and Plus columns");
  assert.equal(await p.$("#mb-buy"), null, "no buy button while Pi payments are off");
  assert.match(await p.textContent(".mb-col.plus"), /غير مفعّلة|لم يُحدَّد/);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no horizontal scroll at 320 px");
  assert.deepEqual(await axeRun(p, "#view"), [], "axe");
  /* a staff grant (no money) → Plus, with dates; the toggle works */
  const u = await S.app.ctx.db.get("SELECT id FROM users WHERE handle='mb_page'");
  const ai = S.app.ctx.services.ai; const plan = await ai.planBySlug("ai_plus");
  await S.app.ctx.db.tx((t) => S.app.ctx.db.run("INSERT INTO ai_subscriptions(id,user_id,plan_id,state,source,period_start,period_end,created_at,updated_at) VALUES('aisub_e2e',$1,$2,'active','grant',$3,$4,$3,$3)", [u.id, plan.id, new Date().toISOString(), new Date(Date.now() + 30 * 864e5).toISOString()]));
  await p.reload(); await p.waitForSelector("#mb-t");
  assert.equal((await p.textContent("#mb-t")).trim(), "Plus");
  assert.equal(await p.$$eval(".mb-hero .mb-dl dd", (x) => x.length), 3, "start, end, days left");
  assert.deepEqual(errs, []); await c.close();
});

test("settings hub links to the membership page", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "mb_set", "عضو الإعدادات"); await dismissTour(p);
  await p.goto(S.base + "/?nosw#/settings?s=money"); await p.waitForSelector('.set-sec[data-s="money"] a[href="#/membership"]', { timeout: 10000 });
  await p.click('a[href="#/membership"]'); await p.waitForSelector("#mb-t"); await c.close();
});
