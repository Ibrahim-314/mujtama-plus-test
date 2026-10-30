/* v2.61.1 — B1: a community feed with more than 30 posts pages in the older ones (sentinel near the end + «عرض المزيد»
 * fallback) with no duplicates, and a back navigation repaints the same length with the scroll kept.
 * B8: on a phone the compose FAB is compact and the feed ends with room for it (screenshots 390 ar light/dark). */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S, cid; const errors = [], N = 64;
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "..", "..", "shots-e2e"); fs.mkdirSync(SHOTS, { recursive: true });
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });
const page = async (opts = MOBILE) => { const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage(); p.on("pageerror", e => errors.push(e.message)); return p; };
const call = (p, method, url, body) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, url, body]);
const count = (p) => p.$$eval("#c-feed .post-head", (x) => x.length);
const ids = (p) => p.$$eval("#c-feed a[href^='#/post/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);

test("seed: a community with 64 posts (one through the API, the rest copied in the DB past the posting rate limit)", async () => {
  const o = await page(); await onboard(o, S.base, "fm_owner", "مالك الصفحات");
  const r = await call(o, "POST", "/api/communities", { name: "مجتمع الصفحات الطويلة", desc: "اختبار عرض المزيد" }); assert.ok(r.community, JSON.stringify(r)); cid = r.community.id;
  const first = await call(o, "POST", "/api/posts", { text: "أحدث منشور في المجتمع", community: cid }); assert.equal(first.status, 200, first.error);
  const db = S.app.ctx.db, row = await db.get("SELECT * FROM posts WHERE id=$1", [first.post.id]), cols = Object.keys(row);
  for (let i = 1; i < N; i++) {
    const x = { ...row, id: `p_fm${String(i).padStart(5, "0")}`, text: `منشور قديم رقم ${i}`, created_at: new Date(Date.parse(row.created_at) - Math.ceil(i / 2) * 60e3).toISOString() }; // pairs share a timestamp
    await db.run(`INSERT INTO posts(${cols.join(",")}) VALUES(${cols.map((_, k) => "$" + (k + 1)).join(",")})`, cols.map((k) => x[k]));
  }
  await o.context().close();
});

test("B1: scrolling to the end loads the older posts, no duplicates; «عرض المزيد» works by keyboard; back keeps length + scroll", async () => {
  const p = await page(); await onboard(p, S.base, "fm_reader", "قارئ الصفحات");
  await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector("#c-feed .post-head");
  assert.equal(await count(p), 30, "first page");
  assert.ok(await p.$("#c-feedmore #c-mb"), "accessible «عرض المزيد» fallback");
  // infinite load: scroll the sentinel into view
  await p.evaluate(() => document.querySelector("#c-feedmore").scrollIntoView());
  await p.waitForFunction(() => document.querySelectorAll("#c-feed .post-head").length >= 60, null, { timeout: 10000 });
  // the fallback button: focus + Enter
  await p.waitForSelector("#c-mb"); await p.focus("#c-mb"); await p.keyboard.press("Enter");
  await p.waitForFunction((n) => document.querySelectorAll("#c-feed .post-head").length === n, N, { timeout: 10000 });
  await p.waitForFunction(() => !document.querySelector("#c-mb"), null, { timeout: 5000 });
  const all = await ids(p); assert.equal(all.length, N, "every post once"); assert.equal(await count(p), N, "no duplicate cards");
  assert.match(await p.textContent("#c-feed"), /منشور قديم رقم 63/, "the oldest post is reachable");
  // open a deep post and come back: same length, scroll kept
  await p.evaluate(() => document.querySelectorAll("#c-feed .post-head")[50].scrollIntoView()); await p.waitForTimeout(300);
  const y = await p.evaluate(() => scrollY); assert.ok(y > 3000, "deep in the feed");
  await p.goto(S.base + "/?nosw#/post/p_fm00050"); await p.waitForTimeout(600); await p.goBack(); await p.waitForSelector("#c-feed .post-head");
  await p.waitForTimeout(1200);
  assert.equal(await count(p), N, "back repaints every loaded page"); assert.equal((await ids(p)).length, N, "still no duplicates");
  assert.ok(Math.abs((await p.evaluate(() => scrollY)) - y) < 400, "scroll position kept");
  await p.context().close();
});

test("B8: 390 light/dark — no floating compose button (removed v2.139), the feed ends with room above the dock; screenshots", async () => {
  for (const scheme of ["light", "dark"]) {
    const p = await page({ ...MOBILE, colorScheme: scheme }); await onboard(p, S.base, "fm_shot_" + scheme, "لقطات " + scheme);
    if (scheme === "dark") await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await p.goto(S.base + "/?nosw#/c/" + cid); await p.waitForSelector("#c-feed .post-head");
    const fab = await p.evaluate(() => { const f = document.getElementById("fab"); if (!f) return { w: 0, vis: false }; const r = f.getBoundingClientRect(), cs = getComputedStyle(f); return { w: r.width, h: r.height, vis: cs.display !== "none" && cs.visibility !== "hidden" }; });
    // v2.139: the floating compose button was removed at the owner's request (it duplicated the composer bar)
    assert.ok(!fab.vis || fab.w === 0, "FAB stays removed");
    assert.ok(await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".c-main")).paddingBottom) >= 56), "room for the FAB at the end");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "no horizontal overflow");
    await p.evaluate(() => scrollTo(0, document.querySelector("#c-feed").offsetTop - 200)); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, `feed-fab-390-${scheme}-ar.png`) });
    await p.evaluate(() => document.querySelector("#c-feedmore").scrollIntoView({ block: "end" })); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(SHOTS, `feed-more-390-${scheme}-ar.png`) });
    await p.context().close();
  }
  const d = await page({ ...DESKTOP, colorScheme: "dark" }); await onboard(d, S.base, "fm_desk", "سطح المكتب");
  await d.goto(S.base + "/?nosw#/c/" + cid); await d.waitForSelector("#c-feed .post-head");
  assert.ok(await d.evaluate(() => { const f = document.getElementById("fab"); return !f || getComputedStyle(f).display === "none" || f.getBoundingClientRect().width === 0; }), "desktop FAB stays removed (v2.139)");
  await d.evaluate(() => document.querySelector("#c-feedmore").scrollIntoView({ block: "end" })); await d.waitForTimeout(300);
  await d.screenshot({ path: path.join(SHOTS, "feed-more-1440-dark-ar.png") }); await d.context().close();
});
