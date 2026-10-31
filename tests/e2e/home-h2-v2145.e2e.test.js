/* v2.145.0 — Home H2 «أول 5 ثواني»: 7 icon-only composer shortcuts (each opens the existing editor flow), the add-story «+» on the
 * composer avatar vs the stories strip, the 48 px first-week challenges bar (expand/collapse remembered), the thin Home bar
 * that hides on scroll down and returns on scroll up, first post height, axe at 390 light / 1440 dark / LTR. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const home = async (p) => { await p.goto(S.base + "/?nosw#/home"); await p.waitForSelector("#hcomp .h2c-b"); };
const axeRun = async (p) => { await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") }); return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | "))); };

test("composer: one row + 7 icon-only buttons in order, each opens its existing flow", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "h2_comp", "مؤلف"); await home(p);
  const qs = await p.$$eval("#hcomp .h2c-b", (bs) => bs.map((b) => [b.dataset.q, b.getAttribute("aria-label"), b.title, b.textContent.trim(), Math.round(b.getBoundingClientRect().width)]));
  assert.deepEqual(qs.map((q) => q[0]), ["img", "video", "audio", "poll", "thread", "article", "ai"]);
  for (const [, l, t, txt, w] of qs) { assert.ok(l && l === t, "aria-label = title"); assert.equal(txt, "", "icon only"); assert.ok(w >= 44, "44 px target"); }
  const xs = await p.$$eval("#hcomp .h2c-b", (bs) => bs.map((b) => b.getBoundingClientRect().left)); assert.ok(xs[0] > xs[6], "RTL: صورة on the right");
  const TT = { video: "فيديو جديد", audio: "مقطع صوتي جديد", poll: "استطلاع جديد", thread: "سلسلة جديدة", article: "مقال جديد" };
  for (const [k, ttl] of Object.entries(TT)) {
    await p.click(`#hcomp [data-q=${k}]`); await p.waitForSelector("#composer3");
    await p.waitForFunction((t) => document.querySelector("#c3-ttl")?.textContent.trim() === t, ttl, { timeout: 8000 });
    await p.click("#c3-x"); await p.waitForSelector("#composer3", { state: "detached" });
  }
  const [fc] = await Promise.all([p.waitForEvent("filechooser", { timeout: 8000 }), p.click("#hcomp [data-q=img]")]);
  assert.ok(fc, "image picker of the editor opened"); await p.click("#c3-x"); await p.waitForSelector("#composer3", { state: "detached" });
  await p.click("#hcomp [data-q=ai]"); await p.waitForSelector("#composer3"); await p.waitForSelector("#composer3 .mp-asb", { timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector("#sheet")?.classList.contains("hidden") || /المساعد|سجّل/.test(document.querySelector("#toast")?.textContent || ""), null, { timeout: 10000 });
  await p.evaluate(() => typeof closeSheet === "function" && closeSheet()); await p.click("#c3-x").catch(() => {});
  await p.click("#cbar"); await p.waitForSelector("#composer3[data-mode=general]"); await p.click("#c3-x");
  assert.deepEqual(errs, []); await c.close();
});

test("stories: «+» on the avatar when nobody has a story, the strip when others do", async () => {
  const a = await S.browser.newContext({ ...MOBILE }); const pa = await a.newPage();
  await onboard(pa, S.base, "h2_story", "راوي"); await home(pa);
  await pa.waitForSelector("#hcomp .h2c-av #st-new"); assert.equal(await pa.$(".stories-bar"), null, "no add-story card");
  assert.ok(await pa.$eval("#st-new", (b) => b.getBoundingClientRect().width >= 44));
  await pa.click("#st-new"); await pa.waitForSelector(".story-pick"); await pa.fill("#c3-text", "قصة اختبار"); await pa.click("#c3-pub"); await pa.waitForSelector("#composer3", { state: "detached" });
  const b = await S.browser.newContext({ ...MOBILE }); const pb = await b.newPage();
  await onboard(pb, S.base, "h2_fan", "معجب");
  await pb.evaluate(async () => { const r = await fetch("/api/users/h2_story", { headers: { "X-Requested-With": "mujtama" } }).then((x) => x.json()).catch(() => null); const id = r?.user?.id || DB.users.find((x) => x.handle === "h2_story")?.id; await fetch("/api/follows/" + id, { method: "PUT", headers: { "X-Requested-With": "mujtama" } }); });
  await pb.reload(); await dismissTour(pb); await pb.waitForSelector(".stories-bar [data-st]", { timeout: 10000 });
  assert.equal(await pb.$("#hcomp .h2c-av #st-new"), null, "no badge while the strip shows"); assert.ok(await pb.$(".stories-bar #st-new"), "add-story stays reachable in the strip");
  await a.close(); await b.close();
});

test("challenges: one 48 px bar, expands to the full list, state remembered", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "h2_ch", "متحدٍ"); await home(p); await p.waitForSelector(".challenges .ch-bar");
  const h = await p.$eval(".challenges", (e) => e.getBoundingClientRect().height); assert.ok(h <= 54, "bar height " + h);
  assert.match(await p.textContent(".challenges"), /تحديات أسبوعك الأول/); assert.match(await p.textContent(".ch-t small"), /التالي:.*أيام متبقية/);
  assert.equal(await p.getAttribute(".ch-bar", "aria-expanded"), "false"); assert.equal(await p.$$eval(".ch-list .ch", (x) => x.length), 0);
  await p.click(".ch-bar"); await p.waitForSelector(".challenges.open .ch-list .ch"); assert.equal(await p.$$eval(".ch-list .ch", (x) => x.length), 5);
  await p.reload(); await p.waitForSelector(".challenges.open .ch-list .ch", { timeout: 10000 });
  await p.click(".ch-bar"); await p.waitForSelector(".challenges.folded"); assert.equal(await p.getAttribute(".ch-bar", "aria-expanded"), "false");
  await c.close();
});

test("header: thin on Home, hides on scroll down, back on scroll up; first post height; SVG icons in HTML; axe", async () => {
  const html = await (await fetch(S.base + "/")).text(); assert.ok(/class="top-actions">[\s\S]*?<svg/.test(html), "top bar icons are SVG in the HTML"); assert.ok(!/🔎|✉️/.test(html.split("</header>")[0]));
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  await onboard(p, S.base, "h2_view", "قارئ"); await seedDiscovery(S.app.ctx, p); await p.reload(); await dismissTour(p); await home(p);
  await p.waitForSelector(".post-card"); await p.waitForTimeout(1500);
  assert.equal(await p.$eval(".topbar", (e) => Math.round(e.getBoundingClientRect().height)), 50);
  const first = () => p.evaluate(() => Math.round(document.querySelector("#view .post-card").getBoundingClientRect().top + scrollY));
  const withDig = await first(); if (await p.$("#d-dig-x")) await p.click("#d-dig-x"); await p.waitForTimeout(400);
  const noDig = await first(); console.log(`# first post top @390 ar: with «فاتك اليوم» ${withDig}px, without ${noDig}px`);
  assert.ok(noDig <= 305, "first post near the top: " + noDig);
  await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(100);
  for (let y = 100; y <= 900; y += 100) { await p.mouse.wheel(0, 100); await p.waitForTimeout(40); }
  await p.waitForFunction(() => document.body.classList.contains("bars-off"), null, { timeout: 4000 });
  await p.mouse.wheel(0, -300); await p.waitForFunction(() => !document.body.classList.contains("bars-off"), null, { timeout: 4000 });
  await p.evaluate(() => scrollTo(0, 0)); assert.deepEqual(await axeRun(p), [], "axe 390 light");
  await p.goto(S.base + "/?nosw#/explore"); await p.waitForTimeout(500); assert.equal(await p.evaluate(() => document.body.classList.contains("on-home")), false, "thin bar only on Home");
  await p.evaluate(() => window.MPI18n ? window.MPI18n.setLang("en") : window.MPChunks.load("i18n").then(() => window.MPI18n.setLang("en"))); await home(p); await p.waitForTimeout(800);
  assert.equal(await p.getAttribute("#hcomp [data-q=ai]", "aria-label"), "Help me write");
  assert.deepEqual(await axeRun(p), [], "axe LTR");
  await p.evaluate(() => window.MPI18n.setLang("ar")); await p.setViewportSize({ width: 1440, height: 900 }); await p.emulateMedia({ colorScheme: "dark" }); await home(p); await p.waitForTimeout(800);
  assert.equal(await p.$$eval("#hcomp .h2c-b", (x) => x.length), 7); assert.deepEqual(await axeRun(p), [], "axe 1440 dark"); await c.close();
});
