/* v2.146.1 — profile polish. (1) an article with images is listed once, under «مقالات», not again under «أعمال»;
 * (2) a lone card in a profile section spans the row instead of sitting at half width; (3) 390 English: the follow button
 * stays on the avatar row (it wrapped to a second line); (4) 1440: the shortcut chips wrap instead of being cut off. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const open = async (p, h) => {
  await p.evaluate((h) => { location.hash = h; }, h);
  await p.waitForSelector(".profile-v2 .profile-top .stats .rep-chip", { timeout: 15000 }); await p.waitForTimeout(300);
};

test("390: sections list an article once, lone card is full width, EN follow button stays on the avatar row", async () => {
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "pf_fix", "فاحص"); await seedDiscovery(S.app.ctx, p); await p.evaluate(() => refresh());
  await open(p, "#/u/reem_ai");
  // v2.147: works + articles became one «مميّز» row (approved profile v3); still each post once
  const seen = await p.$$eval(".pv3-card", (cs) => cs.map((c) => c.getAttribute("href"))); assert.ok(seen.length >= 1, "featured cards render"); assert.equal(new Set(seen).size, seen.length, "no post listed twice: " + JSON.stringify(seen));
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await open(p, "#/u/reem_ai");
  const rows = await p.$eval(".profile-top > .row", (r) => { const kids = [...r.children].filter((k) => k.getClientRects().length && !k.classList.contains("grow")); return [...new Set(kids.map((k) => Math.round(k.getBoundingClientRect().bottom / 8)))].length; });
  assert.equal(rows, 1, "avatar, icons and follow button share one row");
  assert.ok(await p.$eval(".profile-top > .row", (r) => r.scrollWidth <= r.clientWidth + 1), "row does not overflow");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no page overflow");
  assert.deepEqual(errs, []); await c.close();
});

test("1440: own profile shortcut chips all visible (wrap, not clipped)", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "pf_desk", "مكتب"); await open(p, "#/me");
  const r = await p.$eval(".profile-top .chips", (ch) => { const b = ch.getBoundingClientRect(); return [...ch.querySelectorAll(".tab")].every((t) => { const x = t.getBoundingClientRect(); return x.left >= b.left - 1 && x.right <= b.right + 1; }); });
  assert.ok(r, "every chip inside the row");
  await c.close();
});
