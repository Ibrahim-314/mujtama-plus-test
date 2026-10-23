/* v2.81 — «أول مقطع ينفتح مرتين»: the first visit to a lazy screen rendered it twice (the chunk's own development
 * «route()» ran while it was executing, beside the loader's re-route, and the route() wrapper + the hashchange ensure()
 * each queued one more). Now a landing chunk re-routes exactly once: the clips viewer (and its first video) is built
 * once, and so is any other lazy screen on its first visit. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE } = require("./harness");
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });

const POSTER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#5b21b6"/></svg>');
/* counts every time #view receives a fresh screen root matching `sel` (a re-render replaces it) */
const watch = (p, sel) => p.evaluate((sel) => {
  window.__mounts = 0; const v = document.getElementById("view");
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches(sel) || n.querySelector?.(sel))) window.__mounts++; }).observe(v, { childList: true, subtree: true });
}, sel);

test("390: the first clip opens once — the clips viewer is built a single time on the chunk's first load", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "once_a", "مشاهد");
  await p.route(/\/api\/clips\/feed/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], next: null }) }));
  const firstLoad = await p.evaluate(() => !(window.MPChunks && window.MPChunks.loaded.clips));
  await p.evaluate((POSTER) => { for (let i = 0; i < 3; i++) { const id = "once_" + i; if (!S.post(id)) DB.posts.push({ id, author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة " + i, createdAt: new Date(Date.now() - i * 60e3).toISOString(), media: [{ kind: "video", url: "/x.mp4", poster: POSTER, duration: 12, w: 720, h: 1280 }], counts: {} }); } }, POSTER);
  await watch(p, ".shorts");
  await p.evaluate(() => { location.hash = "#/clips"; });
  await p.waitForSelector(".shorts", { timeout: 15000 }); await p.waitForTimeout(2500);
  const n = await p.evaluate(() => window.__mounts);
  assert.ok(firstLoad, "the clips chunk was not loaded before the visit (the first-load path is the one under test)");
  assert.equal(n, 1, `clips viewer mounted ${n} times on its first open`);
  assert.deepEqual(errs, []);
  await c.close();
});

test("390: a lazy screen renders once on its first visit (hashchange + route wrapper share one re-route)", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "once_b", "زائر");
  const firstLoad = await p.evaluate(() => !(window.MPChunks && window.MPChunks.loaded.v12x));
  await watch(p, ".wrap");
  await p.evaluate(() => { location.hash = "#/trends"; });
  await p.waitForFunction(() => !!document.querySelector("#view .wrap h2, #view .wrap .page-head"), null, { timeout: 15000 }); await p.waitForTimeout(2000);
  const n = await p.evaluate(() => window.__mounts);
  if (firstLoad) assert.ok(n <= 2, `trends screen built ${n} times (skeleton + one render expected)`);
  assert.deepEqual(errs, []);
  await c.close();
});
