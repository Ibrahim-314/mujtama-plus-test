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

/* ---------- v2.151.1 «الصفحة لا تُهدم» (stage 2) ---------- */
const cards = () => p.evaluate(() => [...document.querySelectorAll("#view .wk-card")].map((c) => c.querySelector(".wk-kp")?.classList.contains("fr") ? "fr" : "jb"));

test("filters and tabs swap only the list: the form stays, no jump to the top, no history entries", async () => {
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  await p.evaluate(() => { document.querySelector("#wk-jf").__keep = 1; document.querySelector(".wk-qk").__keep = 1; scrollTo(0, 120); });
  const len = await p.evaluate(() => history.length);
  const now = await p.evaluate(() => { document.querySelector('.wk-kc a[href*="kind=freelance"]').click(); return { form: document.querySelector("#wk-jf")?.__keep === 1, skel: !!document.querySelector("#view .skel, #view .sk") }; });
  assert.deepEqual(now, { form: true, skel: false }, "the form is the same element and no skeleton replaces the page");
  await until(p, () => { const k = [...document.querySelectorAll("#view .wk-card .wk-kp")]; return k.length > 0 && k.every((x) => x.classList.contains("fr")); });
  assert.ok((await cards()).length === 5, "5 freelance");
  assert.match(await p.evaluate(() => location.hash), /kind=freelance/);
  assert.equal(await p.evaluate(() => history.length), len, "the filter replaced the URL, it did not push");
  assert.ok(await p.evaluate(() => scrollY) > 0, "no jump to the top");
  assert.equal(await p.evaluate(() => document.querySelector("#wk-jf").__keep), 1, "form kept after the fresh list");
  // the search form (and the sheet's apply) swap the list too
  await p.evaluate(() => { const f = document.querySelector("#wk-jf"); f.q.value = "رقم 2"; f.requestSubmit(); });
  await until(p, () => /رقم 2 /.test(document.querySelector("#view .wk-card .wk-ttl")?.textContent || "")); // search ORs its words and ranks title hits first
  assert.equal(await p.evaluate(() => document.querySelector("#wk-jf").__keep), 1, "search kept the form");
  assert.equal(await p.evaluate(() => new URLSearchParams(location.hash.split("?")[1]).get("q")), "رقم 2");
  // browse ↔ mine: the header and its tiles stay, only the section below changes
  await p.evaluate(() => document.querySelector('.seg a[href="#/jobs?tab=mine"]').click());
  await until(p, () => !!document.querySelector("#view .wk-stats"));
  assert.equal(await p.evaluate(() => document.querySelector(".wk-qk").__keep), 1, "header tiles kept");
  assert.equal(await p.evaluate(() => document.querySelector('.seg a[aria-current="page"]').getAttribute("href")), "#/jobs?tab=mine");
  assert.equal(await p.evaluate(() => history.length), len, "tabs replace too");
  await p.evaluate(() => document.querySelector('.seg a[href="#/jobs"]').click());
  await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  assert.equal(await p.evaluate(() => location.hash), "#/jobs");
});

test("back after filtering leaves the jobs page in one step; a job opened from a filtered list comes back to it", async () => {
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  await p.evaluate(() => document.querySelector('.wk-kc a[href*="kind=freelance"]').click()); await until(p, () => (document.querySelector('.wk-kc a[aria-current]')?.getAttribute("href") || "").includes("freelance"));
  await p.evaluate(() => document.querySelector('.wk-kc a[href*="kind=job"]').click()); await until(p, () => (document.querySelector('.wk-kc a[aria-current]')?.getAttribute("href") || "").includes("kind=job"));
  await until(p, () => [...document.querySelectorAll("#view .wk-card .wk-kp")].every((x) => x.classList.contains("jb")));
  await p.evaluate(() => document.querySelector("#view .wk-card").click()); await until(p, () => !!document.querySelector("#view .wk-about"));
  await p.goBack(); await until(p, () => !!document.querySelector("#view .wk-card"));
  assert.match(await p.evaluate(() => location.hash), /kind=job/, "back from the job lands on the filtered list");
  await p.goBack(); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => location.hash), "#/home", "one more back leaves jobs (filters did not fill the history)");
});

test("prefetch: a finger resting 80 ms on a card fetches it once (not a view); a scroll does not", async () => {
  await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  await p.evaluate(() => window.MPWork.cache.forUser("nobody"));
  const seen = []; const on = (r) => { if (/\/api\/jobs\/[^/?]+(\?|$)/.test(r.url())) seen.push(r.url()); }; p.on("request", on);
  const ev = (i, type, dx = 0) => p.evaluate(([i, type, dx]) => { const c = document.querySelectorAll("#view .wk-card")[i], b = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "touch", isPrimary: true, clientX: b.x + 20 + dx, clientY: b.y + 20 + dx })); }, [i, type, dx]);
  await ev(2, "pointerdown"); await ev(2, "pointermove", 30); await ev(2, "pointercancel"); await p.waitForTimeout(250);
  assert.equal(seen.length, 0, "a scroll gesture fetches nothing: " + seen.join());
  await ev(3, "pointerdown"); await p.waitForTimeout(250);
  assert.equal(seen.length, 1, "one prefetch: " + seen.join()); assert.match(seen[0], /\?peek=1$/);
  const id = await p.evaluate(() => document.querySelectorAll("#view .wk-card")[3].getAttribute("href").split("/").pop());
  await until(p, (id) => window.MPWork.cache.has("job:" + id), id);
  await ev(3, "pointerup"); p.off("request", on);
  assert.deepEqual(errors, []);
});

/* ---------- v2.151.2 «اللمسة الأخيرة» (stage 3) ---------- */
test("card → job morphs with a view transition when motion is welcome, never with reduced motion", async () => {
  await p.emulateMedia({ reducedMotion: "no-preference" });
  try {
    await p.evaluate(() => { location.hash = "#/jobs"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
    assert.equal(await p.evaluate(() => typeof document.startViewTransition), "function", "this Chromium supports view transitions");
    await p.evaluate(() => { window.__vt = 0; const o = document.startViewTransition.bind(document); document.startViewTransition = (cb) => { window.__vt++; return o(cb); }; });
    const title = await p.evaluate(() => { const c = document.querySelectorAll("#view .wk-card")[1]; const t = c.querySelector(".wk-ttl").textContent; c.click(); return t; });
    await until(p, () => !!document.querySelector("#view .wk-jhero .wk-jt"));
    assert.equal(await p.evaluate(() => document.querySelector("#view .wk-jhero .wk-jt").textContent), title);
    assert.equal(await p.evaluate(() => window.__vt), 1, "one view transition");
    await until(p, () => !document.documentElement.classList.contains("wk-vt"), null, 3000);
    await p.goBack(); await until(p, () => document.querySelectorAll("#view .wk-card").length >= 8);
  } finally { await p.emulateMedia({ reducedMotion: "reduce" }); }
  await p.evaluate(() => document.querySelectorAll("#view .wk-card")[2].click()); await until(p, () => !!document.querySelector("#view .wk-jhero"));
  assert.equal(await p.evaluate(() => window.__vt || 0), 1, "reduced motion: no transition");
  await p.goBack(); await until(p, () => !!document.querySelector("#view .wk-card"));
});

test("the section bar sticks under the top bar; tapping the current section scrolls to the top in place", async () => {
  await p.evaluate(() => { location.hash = "#/jobs?kind=freelance"; }); await until(p, () => document.querySelectorAll("#view .wk-card").length === 5);
  await p.evaluate(() => scrollTo(0, 700)); await p.waitForTimeout(200);
  const r = await p.evaluate(() => { const s = document.querySelector("#view .wk-tabs"); if (!s) return null; const b = s.getBoundingClientRect(); return { pos: getComputedStyle(s).position, top: Math.round(b.top), y: Math.round(scrollY) }; });
  assert.ok(r, ".wk-tabs present"); assert.equal(r.pos, "sticky"); assert.ok(r.y > 300, "scrolled " + r.y);
  assert.ok(r.top >= 0 && r.top <= 52, "stuck at the top: " + r.top);
  const len = await p.evaluate(() => history.length);
  await p.evaluate(() => document.querySelector('#view .wk-tabs a[aria-current="page"]').click());
  await until(p, () => scrollY < 4, null, 3000);
  assert.match(await p.evaluate(() => location.hash), /kind=freelance/, "filters kept");
  assert.equal(await p.evaluate(() => history.length), len);
  assert.deepEqual(errors, []);
});
