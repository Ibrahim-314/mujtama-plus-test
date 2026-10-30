/* v2.142.0 — design round 2: the cover-photo button is no longer hidden behind the avatar, lighter «المزيد» tiles,
 * English "followers". 390, no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });

test("390: cover button tappable, menu tiles compact, followers label", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "dz_v2142", "تصميم");
  await p.goto(S.base + "/?nosw#/me"); await p.waitForSelector(".cover-cam", { timeout: 8000 });
  const hit = await p.evaluate(() => { const b = document.querySelector(".cover-cam"), r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return (!!e && b.contains(e)) || [Math.round(r.top), Math.round(r.left), e && (e.tagName + "." + e.className)].join(" "); });
  assert.equal(hit, true, "cover button is on top and tappable");
  await p.goto(S.base + "/?nosw#/menu"); await p.waitForSelector(".mn-tile");
  const tall = await p.$$eval(".mn-tile", (ts) => Math.max(...ts.map((t) => t.getBoundingClientRect().height)));
  assert.ok(tall <= 100, "tiles stay compact: " + tall);
  assert.equal(await p.$eval(".mn-tile", (t) => getComputedStyle(t).boxShadow), "none");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.MPI18n.t ? window.MPI18n.t("متابِع") : "followers"), "followers");
  assert.deepEqual(errs, [], "no page errors");
  await c.close();
});
