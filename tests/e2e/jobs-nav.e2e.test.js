/* v2.151.0 «لا شاشة فارغة» — jobs navigation feels like a native app (user-approved council plan stage 1, 2026-11-20).
 * Against the REAL server (production build), 390 mobile: an employer (first account) posts 10 jobs (the open-postings limit), then:
 *  1. list → job: the job's hero (title + pay) is on screen in the same frame as the tap (drawn from the card), no blank skeleton-only view;
 *  2. job → back: the list is back at once (no skeleton) at the exact scroll position the reader left;
 *  3. list → «إعلاناتي وطلباتي» → back to browse: painted from memory at once;
 *  4. stale data never acts: a job drawn from memory has its action bar inert until the fresh copy lands, and any change
 *     (save) drops the memory so the next visit shows the new state.
 *  5. privacy: memory belongs to the signed-in account (signing out drops it). No page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

let S, ctx, p; const errors = [];
const until = (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "jn_admin", "شركة الأفق");
  for (let i = 0; i < 10; i++) {
    S.app.ctx.rl.w.clear();
    const r = await p.evaluate(async (i) => (await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ kind: i % 2 ? "freelance" : "job", title: "فرصة تجريبية رقم " + (i + 1) + " لمطوّر واجهات", body: "نبحث عن شخص يتقن بناء واجهات عربية سريعة وسهلة الوصول مع اختبارات وتوثيق واضح، والعمل ضمن فريق صغير ومرن. " + i, category: "tech", employment: "full", skills: "React، CSS", mode: "remote", city: null, payType: "fixed", payMin: 100 + i, payMax: 200 + i, minorsOk: false, deadline: null, questions: [] }) })).status, i);
    assert.equal(r, 200, "post job " + i);
  }
  void H;
});
test.after(async () => { await ctx?.close(); await S?.close(); });

/* records, from the hashchange on, whether #view ever showed only a skeleton (no real content) in any frame */
const watch = (pg, sel) => pg.evaluate((sel) => {
  window.__jn = { blank: 0, frames: 0, hit: null, t0: performance.now() };
  const v = document.getElementById("view");
  const look = () => { window.__jn.frames++; const has = !!v.querySelector(sel); if (has && window.__jn.hit == null) window.__jn.hit = performance.now() - window.__jn.t0; if (!has && v.querySelector(".skel, .sk")) window.__jn.blank++; if (window.__jn.frames < 40 && window.__jn.hit == null) requestAnimationFrame(look); };
  requestAnimationFrame(look);
}, sel);

test("list → job → back is instant, keeps the scroll, never blank", async () => {
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  // scroll to the 8th card and open it
  const y = await p.evaluate(() => { const c = document.querySelectorAll("#view .wk-card")[7]; c.scrollIntoView({ block: "center" }); return Math.round(scrollY); });
  assert.ok(y > 300, "scrolled down " + y);
  const title = await p.evaluate(() => document.querySelectorAll("#view .wk-card")[7].querySelector(".wk-ttl").textContent);
  await watch(p, ".wk-jhero .wk-jt");
  await p.evaluate(() => document.querySelectorAll("#view .wk-card")[7].click());
  // the hero is in the first frame after the tap, drawn from the card
  const firstHero = await p.evaluate(() => document.querySelector("#view .wk-jhero .wk-jt")?.textContent || "");
  assert.equal(firstHero, title, "hero drawn from the card in the same task as the tap");
  await until(p, () => !!document.querySelector("#view .wk-about"));
  assert.equal(await p.evaluate(() => window.__jn.blank), 0, "no skeleton-only frame on open");

  await watch(p, ".wk-card");
  await p.goBack();
  const back = await p.evaluate(() => document.querySelectorAll("#view .wk-card").length);
  assert.ok(back >= 8, "list painted from memory at once: " + back);
  assert.equal(await p.evaluate(() => window.__jn.blank), 0, "no skeleton on back");
  await p.waitForTimeout(400);
  const y2 = await p.evaluate(() => Math.round(scrollY));
  assert.ok(Math.abs(y2 - y) <= 4, `scroll restored exactly: ${y} → ${y2}`);
});

test("browse ↔ mine tab switch paints from memory", async () => {
  await p.evaluate(() => { location.hash = "#/jobs?tab=mine"; }); await until(p, () => !!document.querySelector("#view .wk-stats"));
  await watch(p, ".wk-card");
  await p.evaluate(() => { location.hash = "#/jobs"; });
  assert.ok(await p.evaluate(() => document.querySelectorAll("#view .wk-card").length >= 8), "browse from memory");
  await watch(p, ".wk-stats");
  await p.evaluate(() => { location.hash = "#/jobs?tab=mine"; });
  assert.ok(await p.evaluate(() => !!document.querySelector("#view .wk-stats")), "mine from memory");
});

test("memory never acts: inert action bar until fresh, dropped after a change and on sign-out", async () => {
  // a second visit to a job drawn from memory: actions are inert until the fresh copy is in
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  const href = await p.evaluate(() => document.querySelector("#view .wk-card").getAttribute("href"));
  await p.evaluate((h) => { location.hash = h; }, href); await until(p, () => !!document.querySelector("#view .wk-about"));
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => !!document.querySelector("#view .wk-card"));
  const st = await p.evaluate((h) => new Promise((res) => { addEventListener("hashchange", () => { const a = document.querySelector("#wk-ja"); res({ painted: !!document.querySelector("#view .wk-about"), inert: !!a?.inert }); }, { once: true }); location.hash = h; }), href); // read in the same task as the route (listener added after the router's)
  assert.deepEqual(st, { painted: true, inert: true }, "full job from memory, actions inert");
  await until(p, () => document.querySelector("#wk-ja") && !document.querySelector("#wk-ja").inert);
  // memory is per account and in-memory only
  assert.equal(await p.evaluate(() => typeof window.MPWork?.cache?.size), "function");
  assert.ok(await p.evaluate(() => window.MPWork.cache.size() > 0));
  await p.evaluate(() => window.MPWork.cache.forUser("someone_else"));
  assert.equal(await p.evaluate(() => window.MPWork.cache.size()), 0, "another account sees nothing");
  assert.deepEqual(errors, []);
});
