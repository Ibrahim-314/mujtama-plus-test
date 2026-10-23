/* Phase 46 e2e against the real server + production build, WITH the service worker (no ?nosw after onboarding).
 * Manifest linked + served; SW controls the page; lazy `pwa` chunk arrives via the `notify` chunk; offline reading (feed served from
 * "mp-api" while offline); offline drafts (PUT queued → 202, listed offline, flushed to the server when back online); Web Share Target
 * (POST /share-target → composer prefilled); #/app screen; no page errors. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1"; // setOffline/route also apply to the service worker
let S, ctx, p; const errors = [];
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "pwa_e2e", "مختبر التطبيق");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("installable app: SW + manifest, offline reading and drafts, share target, #/app", async () => {
  const man = await (await fetch(S.base + "/manifest.json")).json();
  assert.equal(man.display, "standalone"); assert.ok(man.icons.length >= 12);
  assert.equal((await fetch(S.base + "/icons/maskable-512.png")).status, 200);

  await p.goto(S.base + "/#/home");
  await p.evaluate(() => navigator.serviceWorker.ready);
  if (!(await p.evaluate(() => !!navigator.serviceWorker.controller))) await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  assert.equal(await p.getAttribute('link[rel="manifest"]', "href"), "/manifest.json");
  await p.waitForFunction(() => !!window.MPPwa, null, { timeout: 30000 }); // pwa chunk rides on the idle notify chunk

  // offline reading: a feed fetched online is served from the SW cache offline
  const on = await p.evaluate(async () => (await fetch("/api/feed?mode=latest&limit=50", { credentials: "same-origin" })).status);
  assert.equal(on, 200);
  // the SW stores the copy after answering (cache.put is not awaited) — wait for it so a loaded machine cannot race offline ahead of it
  await p.waitForFunction(() => caches.open("mp-api").then((c) => c.match("/api/feed?mode=latest&limit=50")).then(Boolean), null, { timeout: 15000 });
  await ctx.setOffline(true);
  const off = await p.evaluate(async () => { const r = await fetch("/api/feed?mode=latest&limit=50", { credentials: "same-origin" }); return { s: r.status, ok: Array.isArray((await r.json()).items || []) }; });
  assert.equal(off.s, 200);
  await p.waitForFunction(() => document.body.classList.contains("mp-offline"));

  // offline drafts: queued by the SW, visible in the list, flushed when back online
  const q = await p.evaluate(async (h) => { const r = await fetch("/api/drafts/dr_offline01", { method: "PUT", credentials: "same-origin", headers: h, body: JSON.stringify({ data: { type: "post", markdown: "مسودة بلا اتصال" }, device: "phone-e2e" }) }); return { s: r.status, j: await r.json() }; }, H);
  assert.equal(q.s, 202); assert.equal(q.j.queued, true);
  const list = await p.evaluate(async () => (await (await fetch("/api/drafts", { credentials: "same-origin" })).json()));
  assert.ok(list.drafts.some((d) => d.id === "dr_offline01" && d.queued), JSON.stringify(list));
  await ctx.setOffline(false);
  await p.evaluate(() => window.dispatchEvent(new Event("online")));
  await p.waitForFunction(async () => { const r = await fetch("/api/drafts", { credentials: "same-origin" }); const j = await r.json(); return j.drafts.some((d) => d.id === "dr_offline01" && !d.queued) && !j.queued; }, null, { timeout: 15000, polling: 500 });
  const srv = await p.evaluate(async () => (await (await fetch("/api/drafts", { credentials: "same-origin", cache: "no-store", headers: { "X-Requested-With": "mujtama" } })).json()).drafts.find((d) => d.id === "dr_offline01"));
  assert.equal(srv.data.markdown, "مسودة بلا اتصال");

  // share target: another app shares text + url → composer opens prefilled
  await p.evaluate(async () => { const f = new FormData(); f.set("title", "عنوان مشترك"); f.set("text", "نص من تطبيق آخر"); f.set("url", "https://example.com/a"); await fetch("/share-target", { method: "POST", body: f }); });
  await p.goto(S.base + "/?source=share#/home");
  await p.waitForSelector("#composer3 #c3-text", { timeout: 30000 });
  const txt = await p.inputValue("#composer3 #c3-text");
  assert.match(txt, /عنوان مشترك/); assert.match(txt, /نص من تطبيق آخر/); assert.match(txt, /example\.com\/a/);
  assert.ok(!(await p.url()).includes("source=share"));
  assert.equal(await p.evaluate(async () => !!(await (await caches.open("mp-share")).match("/__share/meta"))), false, "share inbox cleared");
  await p.click("#c3-x").catch(() => { });

  // #/app
  await p.goto(S.base + "/#/app");
  await p.waitForSelector("text=التطبيق", { timeout: 15000 });
  await p.waitForSelector("#mp-app-up");
  assert.match(await p.textContent("#view"), /الإشعارات/);
  assert.deepEqual(errors, []);
});
