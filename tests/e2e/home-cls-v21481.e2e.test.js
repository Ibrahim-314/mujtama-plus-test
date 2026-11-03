/* v2.148.1 «راحة العين» — Home must not jump: (1) while scrolling and loading more posts, (2) when «فاتك اليوم» arrives late,
 * (3) the 1440 side rail on page load. Layout shifts are read from the browser's own layout-shift entries. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const OBS = () => { window.__ls = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ls.push({ v: e.value, src: (e.sources || []).map((s) => (s.node && s.node.className && String(s.node.className)) || "?") }); }).observe({ type: "layout-shift", buffered: true }); };
const cls = (p) => p.evaluate(() => (window.__ls || []).reduce((a, e) => a + e.v, 0));
const DIG = { summary: { points: [{ text: "نقطة أولى عن اليوم", cites: [] }, { text: "نقطة ثانية عن اليوم", cites: [] }, { text: "نقطة ثالثة عن اليوم", cites: [] }], label: "ملخص" }, counts: { posts: 12, people: 5, comments: 0 } };

test("390: scrolling down through load-more and back up does not move the feed", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "cls_scroll", "قياس"); await seedDiscovery(S.app.ctx, p); await dismissTour(p);
  await p.addInitScript(OBS); await p.goto(S.base + "/?nosw&t=1#/home"); await p.waitForSelector("#hcomp"); await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__ls = []; });
  for (let i = 0; i < 14; i++) { await p.mouse.wheel(0, 350); await p.waitForTimeout(600); }
  for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -500); await p.waitForTimeout(600); }
  const v = await cls(p); assert.ok(v < 0.01, "home scroll CLS " + v.toFixed(4) + " " + JSON.stringify(await p.evaluate(() => window.__ls)).slice(0, 400));
  await c.close();
});

test("390: a late «فاتك اليوم» does not push the feed (slot held, then cached on the next visit)", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await p.route("**/api/digest/daily*", async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DIG) }); });
  await onboard(p, S.base, "cls_dig", "قياس"); await seedDiscovery(S.app.ctx, p); await dismissTour(p);
  await p.evaluate(() => localStorage.removeItem("mp_digest_cache")); /* first visit of the day: nothing cached yet */
  await p.addInitScript(OBS); await p.addInitScript(() => { window.__slot = []; new MutationObserver(() => { const sl = document.querySelector(".d-dig-slot"), cd = document.querySelector(".d-digest:not(.d-dig-slot)"); if (sl && !window.__slot.some((x) => x[0] === "slot")) window.__slot.push(["slot", Math.round(performance.now()), Math.round(sl.getBoundingClientRect().height), document.querySelectorAll(".post-card").length]); if (cd && !window.__slot.some((x) => x[0] === "card")) window.__slot.push(["card", Math.round(performance.now()), Math.round(cd.getBoundingClientRect().height)]); }).observe(document, { childList: true, subtree: true }); }); await p.goto(S.base + "/?nosw&t=2#/home"); await p.waitForSelector(".d-digest:not(.d-dig-slot)", { timeout: 15000 }); await p.waitForTimeout(800);
  const first = await cls(p); assert.ok(first < 0.05, "first visit CLS " + first.toFixed(4) + " " + JSON.stringify(await p.evaluate(() => [window.__slot, window.__ls.map((e) => [Math.round(e.v * 1000), e.src[0]])])));
  await p.goto(S.base + "/?nosw&t=3#/home"); await p.waitForSelector("#hcomp");
  await p.waitForSelector(".d-digest:not(.d-dig-slot)", { timeout: 8000 }); assert.equal(await p.$$eval(".d-dig-slot", (x) => x.length), 0, "no slot when cached"); await p.waitForTimeout(2500);
  const second = await cls(p); assert.ok(second < 0.01, "cached visit CLS " + second.toFixed(4));
  await c.close();
});

test("1440: the side rail does not jump on load", async () => {
  const c = await S.browser.newContext({ ...DESKTOP }); const p = await c.newPage();
  await onboard(p, S.base, "cls_rail", "قياس"); await dismissTour(p);
  await p.addInitScript(OBS); await p.goto(S.base + "/?nosw&t=4#/explore"); await p.waitForTimeout(3000);
  const rail = await p.evaluate(() => window.__ls.filter((e) => e.src.some((s) => /side-|^$/.test(s)) || true).reduce((a, e) => a + e.v, 0));
  assert.ok(rail < 0.002, "1440 load CLS " + rail.toFixed(4) + " " + JSON.stringify(await p.evaluate(() => window.__ls)).slice(0, 300));
  assert.equal(await p.$$eval(".bottomnav .side-brand", (x) => x.length), 1, "one brand, not two");
  await c.close();
});
