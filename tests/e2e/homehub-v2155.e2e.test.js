/* v2.155.0 — Home hub (phase 1a): 7 default sections above the existing composer + feed, optional sections hidden by
 * default, «تخصيص صفحتي الرئيسية» (show/hide, reorder, reset) saved in the prefs store and restored on a fresh device,
 * no post shown twice («يستحق اهتمامك» vs the feed), a soft re-render keeps the same hub node without refetching,
 * onboarding interests can be skipped, no horizontal scroll at 320 px, English labels, axe on the customize sheet. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, dismissTour, markTourDone, MOBILE } = require("./harness");
const { seedDiscovery } = require("./discovery-seed");
let S; test.before(async () => { S = await startStack(); }); test.after(async () => { await S.close(); });
const home = async (p) => { await p.goto(S.base + "/?nosw#/home"); await p.waitForSelector("#view .hub #hb-s-welcome"); };
const axeRun = async (p, sel) => { await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") }); return p.evaluate(async (sel) => (await axe.run(sel ? document.querySelector(sel) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")), sel); };
const sections = (p) => p.$$eval("#view .hub > section", (xs) => xs.map((x) => x.id.replace("hb-s-", "")));

test("hub: 7 default sections in order, optional ones hidden, feed last, no duplicate posts, soft re-render keeps the node", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "hub_one", "عضو الرئيسية"); await seedDiscovery(S.app.ctx, p); await p.reload(); await dismissTour(p); await home(p);
  await p.waitForTimeout(800);
  assert.ok(await p.$("#view .hub .hb-search input[type=search]"), "search box");
  assert.deepEqual(await sections(p), ["welcome", "quick", "attention", "communities", "opps"], "default sections (search is the form above them)");
  assert.equal(await p.$$eval("#hb-s-quick .hb-q", (x) => x.length), 6, "6 quick actions");
  for (const k of ["studio", "learn", "ai"]) assert.equal(await p.$(`#hb-s-${k}`), null, k + " hidden by default");
  assert.equal(await p.evaluate(() => document.querySelector("#view .hub").nextElementSibling.id), "hcomp", "composer + feed after the hub");
  assert.equal(await p.textContent("#view .hub .hb-feedh h2"), "من المجتمع");
  /* «يستحق اهتمامك» picks never appear in the feed */
  const picks = await p.evaluate(() => window.MPHub._picks());
  assert.ok(picks.length >= 1, "seeded world gives at least one pick: " + picks.length);
  const feedIds = await p.$$eval("#view .wrap > .post-card [data-open]", (xs) => xs.map((x) => x.dataset.open.replace("#/post/", "")));
  assert.ok(feedIds.length > 0, "feed still renders");
  for (const id of picks) assert.ok(!feedIds.includes(id), "pick repeated in the feed: " + id);
  /* opportunities: its own request only when it nears the screen, then loaded/empty — never a stuck skeleton */
  await p.locator("#hb-s-opps").scrollIntoViewIfNeeded(); await p.waitForFunction(() => !document.querySelector("#hb-s-opps .hb-load"), null, { timeout: 8000 });
  await p.click('#hb-s-opps [data-k="teams"]'); await p.waitForFunction(() => !document.querySelector("#hb-s-opps .hb-load"), null, { timeout: 8000 });
  assert.equal(await p.getAttribute('#hb-s-opps [data-k="teams"]', "aria-pressed"), "true");
  /* a realtime-style soft re-render: same hub node, no new section requests */
  const reqs = []; p.on("request", (r) => { if (/\/api\/(jobs|teams|mjt|studio|courses|prefs)/.test(r.url())) reqs.push(r.url()); });
  await p.evaluate(() => { window.__hubNode = document.querySelector("#view .hub"); rerender(); rerender(); }); // eslint-disable-line no-undef
  await p.waitForTimeout(600);
  assert.equal(await p.evaluate(() => document.querySelector("#view .hub") === window.__hubNode), true, "hub node kept");
  assert.deepEqual(reqs, [], "no refetch on re-render");
  assert.deepEqual(errs, []); await c.close();
});

test("customize: show/hide + reorder + reset, saved in prefs and restored on a fresh device; axe; English", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "hub_cust", "مخصِّص"); await dismissTour(p); await home(p);
  await p.click("#view .hub [data-hb=customize]"); await p.waitForSelector(".hb-cz");
  assert.deepEqual(await axeRun(p, "#sheet"), [], "axe customize sheet");
  await p.check('.hb-cz input[data-k="studio"]');
  await p.uncheck('.hb-cz input[data-k="communities"]');
  await p.click('.hb-cz [data-up="3"]'); /* opps above communities */
  await p.click('.hb-cz [data-up="2"]'); /* opps above attention */
  await p.click('.hb-cz [data-cz="save"]'); await p.waitForTimeout(700);
  assert.deepEqual(await sections(p), ["welcome", "quick", "opps", "attention", "studio"]);
  const saved = await p.evaluate(async () => (await (await fetch("/api/prefs?ns=home", { headers: { "X-Requested-With": "mujtama" } })).json()).prefs.home.layout);
  assert.deepEqual(saved.order.slice(0, 4), ["quick", "opps", "attention", "communities"]); assert.ok(saved.hidden.includes("communities") && !saved.hidden.includes("studio"));
  /* a fresh device: same session cookie, empty localStorage → the layout comes back from the server */
  const st = await c.storageState(); st.origins = [];
  const c2 = await S.browser.newContext({ ...MOBILE, storageState: st }); const p2 = await c2.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
  await home(p2); await p2.waitForFunction(() => [...document.querySelectorAll("#view .hub > section")].map((x) => x.id).join() === "hb-s-welcome,hb-s-quick,hb-s-opps,hb-s-attention,hb-s-studio", null, { timeout: 8000 });
  /* reset */
  await p2.click("#view .hub [data-hb=customize]"); await p2.waitForSelector(".hb-cz"); await p2.click('.hb-cz [data-cz="reset"]'); await p2.click('.hb-cz [data-cz="save"]'); await p2.waitForTimeout(600);
  assert.deepEqual(await sections(p2), ["welcome", "quick", "attention", "communities", "opps"]);
  /* English UI */
  await p2.evaluate(() => (window.MPI18n ? Promise.resolve() : window.MPChunks.load("i18n")).then(() => window.MPI18n.setLang("en"))); await home(p2); await p2.waitForTimeout(1200);
  assert.equal((await p2.textContent("#view .hub [data-hb=customize]")).trim(), "Customize my Home");
  assert.equal(await p2.getAttribute("#view .hub .hb-search input", "placeholder"), "Search Mujtama Plus...");
  assert.deepEqual(await axeRun(p2), [], "axe home LTR");
  assert.deepEqual(errs, []); await c.close(); await c2.close();
});

test("onboarding: interests can be skipped; search goes to the existing search; no horizontal scroll at 320 px", async () => {
  const c = await S.browser.newContext({ ...MOBILE, viewport: { width: 320, height: 640 } }); const p = await c.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(S.base + "/?nosw#/login?recover=1"); await p.click("[data-m=register]");
  await p.fill("#a-name", "متخطٍّ"); await p.fill("#a-handle", "hub_skip"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go");
  await p.waitForSelector("#n1"); await markTourDone(p); await p.click("#n1");
  assert.equal(await p.isDisabled("#n2"), false, "next is never locked behind 3 interests");
  await p.click("#n2s"); await p.waitForSelector(".bottomnav a[data-r=home]"); await dismissTour(p);
  await p.waitForSelector("#view .hub #hb-s-welcome");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no horizontal page scroll at 320 px");
  await p.fill("#view .hub .hb-search input", "Pi"); await p.press("#view .hub .hb-search input", "Enter");
  await p.waitForFunction(() => location.hash.startsWith("#/search/Pi"));
  assert.deepEqual(errs, []); await c.close();
});
