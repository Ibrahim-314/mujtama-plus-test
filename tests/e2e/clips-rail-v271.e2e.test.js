/* v2.71 — «لقطات» action rail (v271-rail): vertical rail on the inline-end side with like / comments / save / share / tip,
 * compact counts (1.2 ألف / 1.2K), ≥44px targets, aria-pressed, keyboard, comments CustomEvent + #/post fallback, save via the
 * core collections picker, share clipboard fallback, tip sheet (MJT + Pi «غير مفعّل بعد»), double-tap burst (reduced-motion
 * fade), axe 0 serious/critical at 390 light / 1440 dark / 390 LTR. RAIL_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.RAIL_SHOTS;
let S;
/* fakeVideoMs: the demo-shape video job (no uploaded file) finishes at once instead of 3.5 s later, after the stack has closed */
test.before(async () => { S = await startStack({ fakeVideoMs: 1 }); });
test.after(async () => { await S.close(); });
/* the clips are real server posts (POST /api/posts, then marked published with a playable variant the way the encoder would),
 * so likes / saves round-trip through the API and a background store re-sync (GET /api/bootstrap) keeps them instead of
 * dropping local-only seeds (that was the earlier flake: the server rejected reactions on unknown ids and the resync wiped them). */
const seed = async (p) => {
  S.app.ctx.rl?.w?.clear?.();
  // one stack serves every test: drop the previous test's clips (and their reactions) before renaming the new ones
  await S.app.ctx.db.run("DELETE FROM reactions WHERE target LIKE 'clipv271_%'", []); await S.app.ctx.db.run("DELETE FROM posts WHERE id LIKE 'clipv271_%'", []);
  const made = await p.evaluate(async () => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, out = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch("/api/posts", { method: "POST", headers: h, body: JSON.stringify({ type: "video", visibility: "public", text: "لقطة الأزرار رقم " + (i + 1), media: "linear-gradient(135deg, #223, #446)", video: { short: true, duration: 12 } }) });
      out.push((await r.json()).post?.id || null);
    }
    return out;
  });
  assert.ok(made.every(Boolean), "seed clips created via the API " + JSON.stringify(made));
  await new Promise((r) => setTimeout(r, 100)); // the demo video job has run (it publishes by the API id, renamed below)
  for (let i = 0; i < made.length; i++) {
    const row = await S.app.ctx.db.get("SELECT data FROM posts WHERE id=$1", [made[i]]); const d = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    d.video = { ...d.video, status: "ready", variants: { "360p": "/media/none-" + i + ".mp4", poster: "" } };
    await S.app.ctx.db.run("UPDATE posts SET id=$1, status='published', data=$2, created_at=$3 WHERE id=$4", ["clipv271_" + i, d, new Date(Date.now() - i * 60000).toISOString(), made[i]]);
  }
  await p.reload(); await p.waitForFunction(() => typeof DB !== "undefined" && !!DB.me && DB.posts.filter(x => /^clipv271_/.test(x.id) && x.status === "published").length === 6, null, { timeout: 30000 });
};
/* big counts come from the server feed (GET /api/clips/feed → items[].counts, which clips-ui re-reads on every page): patch
 * the real response for one clip instead of poking Clips.api.counts, which the next feed page would overwrite */
const bigCounts = (p, id, counts) => p.route(/\/api\/clips\/feed\?/, async (r) => {
  const res = await r.fetch(); const j = await res.json().catch(() => null);
  if (j && Array.isArray(j.items)) j.items.forEach((x) => { if (x && x.id === id) x.counts = { ...(x.counts || {}), ...counts }; });
  await r.fulfill({ response: res, body: JSON.stringify(j) });
});
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
/* a background store refresh can re-render the feed between two steps: find + scroll in one in-page step, and wait until the
 * clip is at the top of a settled feed */
const open = async (p, hash) => {
  await p.evaluate((h) => { location.hash = h; }, hash);
  await p.waitForFunction(() => { const s = document.querySelector('.short[data-short="clipv271_0"]'); if (!s || !s.querySelector(".short-actions.cl-rail [data-cl-rail]")) return false; s.scrollIntoView({ block: "start" }); return Math.abs(s.getBoundingClientRect().top - (document.querySelector(".shorts")?.getBoundingClientRect().top || 0)) < 2; }, null, { timeout: 30000, polling: 200 });
  await p.waitForTimeout(400);
};
const R = (k) => `.short[data-short="clipv271_0"] [data-cl-rail="${k}"]`;
const doubleTap = (p) => p.evaluate(() => { const s = document.querySelector('.short[data-short="clipv271_0"]'); const ev = () => s.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); ev(); ev(); });
/* rail geometry: five buttons, each ≥44px, inside the clip, on the inline-end edge, lower half, never under the bottom nav */
const railOk = async (p, rtl) => {
  // read in one in-page step once the clip is painted (a store refresh may be re-rendering the feed at this instant)
  const r = await (await p.waitForFunction(() => {
    const sec = document.querySelector('.short[data-short="clipv271_0"]'), rail = sec && sec.querySelector(".short-actions.cl-rail"); if (!rail || !document.querySelector(".bottomnav")) return false;
    const b = (el) => el.getBoundingClientRect(), s = b(sec), rb = b(rail), nav = b(document.querySelector(".bottomnav"));
    return { n: rail.querySelectorAll("[data-cl-rail]").length, sizes: [...rail.querySelectorAll("[data-cl-rail]")].map(x => { const q = b(x); return Math.min(q.width, q.height); }),
      endGap: { left: rb.left - s.left, right: s.right - rb.right }, inside: rb.top >= s.top && rb.bottom <= s.bottom, underNav: rb.bottom > nav.top && rb.top < nav.bottom && rb.left < nav.right && rb.right > nav.left,
      lowHalf: rb.top + rb.height / 2 > s.top + s.height / 2, overflowX: document.documentElement.scrollWidth > innerWidth };
  }, null, { timeout: 30000, polling: 200 })).jsonValue();
  assert.equal(r.n, 5, "five rail buttons");
  r.sizes.forEach((v) => assert.ok(v >= 44, "touch target ≥44px, got " + v));
  assert.ok(r.inside, "rail inside the clip"); assert.ok(!r.underNav, "rail overlaps the bottom nav"); assert.ok(r.lowHalf, "rail sits centred-low");
  assert.ok(rtl ? r.endGap.left < 24 : r.endGap.right < 24, "rail on the inline-end edge " + JSON.stringify(r.endGap)); assert.ok(!r.overflowX, "no horizontal overflow");
};
test("390 light RTL: rail, like + keyboard, compact counts, save picker, share copy, tip sheet, burst, comments event + fallback, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", permissions: ["clipboard-read", "clipboard-write"] }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "rail_a", "صانع الأزرار"); await seed(p);
  await bigCounts(p, "clipv271_1", { likes: 1234, comments: 2500000 });
  await open(p, "#/shorts");
  await railOk(p, true);
  assert.equal(await p.getAttribute(R("like"), "aria-pressed"), "false"); assert.equal(await p.getAttribute(R("save"), "aria-pressed"), "false");
  for (const k of ["like", "comment", "save", "share", "tip"]) assert.ok((await p.getAttribute(R(k), "aria-label")).length > 2, k + " has aria-label");
  const n1 = await p.$$eval('.short[data-short="clipv271_1"] .cl-rail-n', (x) => x.map(e => e.dataset.n));
  assert.match(n1[0], /^1[.,٫]2\s?ألف$/, "1234 → 1.2 ألف, got " + n1[0]); assert.match(n1[1], /2[.,٫]5\s?مليون/, "2.5M in Arabic, got " + n1[1]);
  // like by click (core quick-like), unlike by keyboard
  await p.click(R("like")); await p.waitForTimeout(400);
  assert.equal(await p.getAttribute(R("like"), "aria-pressed"), "true"); assert.equal(await p.getAttribute(R("like") + " .cl-rail-n", "data-n"), "1");
  // keyboard: Enter on the focused like button activates it, and aria-pressed always mirrors the store afterwards
  await p.waitForTimeout(1500); // let the like round-trip (PUT /api/reactions + bootstrap refresh) settle first
  const before = await p.evaluate(() => S.reactionsOf("clipv271_0").length + ":" + document.querySelector(".shorts").scrollTop);
  await p.focus(R("like")); await p.keyboard.press("Enter"); await p.waitForTimeout(700);
  assert.notEqual(await p.evaluate(() => S.reactionsOf("clipv271_0").length + ":" + document.querySelector(".shorts").scrollTop), before, "Enter on the like button reacts");
  assert.equal(await p.getAttribute(R("like"), "aria-pressed"), String(await p.evaluate(() => !!S.myReaction("clipv271_0"))), "aria-pressed mirrors the store");
  assert.ok(await p.evaluate((s) => document.activeElement === document.querySelector(s), R("like")), "focus stays on the like button");
  // save → core collections picker → pressed
  // collections are server-side (ids minted by the API): save into the account's first default collection
  const col = await p.evaluate(() => DB.collections[0]?.id); assert.ok(col, "the account has a default collection");
  await p.click(R("save")); await p.waitForSelector(`#sheet [data-c="${col}"]`); await p.click(`#sheet [data-c="${col}"]`); await p.waitForTimeout(400);
  assert.equal(await p.getAttribute(R("save"), "aria-pressed"), "true"); assert.ok(await p.evaluate(() => S.saved("clipv271_0")));
  // share: no navigator.share → copy the post link
  await p.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); });
  await p.click(R("share")); await p.waitForTimeout(300);
  assert.match(await p.evaluate(() => navigator.clipboard.readText()), /#\/post\/clipv271_0$/);
  // tip sheet: MJT link + Pi locked «غير مفعّل بعد»; Escape closes and focus returns
  await p.click(R("tip")); await p.waitForSelector('.cl-rail-panel[role="dialog"]');
  assert.match(await p.textContent(".cl-rail-panel"), /غير مفعّل بعد/); assert.ok(await p.$eval("[data-cl-pi]", (b) => b.disabled));
  assert.match(await p.getAttribute("[data-cl-mjt]", "href"), /^#\/mjt\?tab=send/);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/rail-390-light-tip.png" });
  await p.keyboard.press("Escape"); assert.equal(await p.$(".cl-rail-sheet"), null);
  assert.ok(await p.evaluate((s) => document.activeElement === document.querySelector(s), R("tip")), "focus back on tip");
  // double-tap → like + burst (core behaviour kept, smoother animation)
  await doubleTap(p);
  await p.waitForSelector('.short[data-short="clipv271_0"] .burst'); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".short .burst")).animationName), "cl-rail-burst");
  await p.waitForTimeout(500); assert.equal(await p.getAttribute(R("like"), "aria-pressed"), String(await p.evaluate(() => !!S.myReaction("clipv271_0"))));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/rail-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  // comments: a listener that handles the event keeps the clip; nobody listening → the post page
  const got = await p.evaluate((s) => { let id = null; const f = (e) => { id = e.detail.post.id; e.preventDefault(); }; document.addEventListener("clips:comments", f); document.querySelector(s).click(); document.removeEventListener("clips:comments", f); return { id, hash: location.hash }; }, R("comment"));
  assert.equal(got.id, "clipv271_0"); assert.match(got.hash, /^#\/shorts/);
  // once the v2.71 comments sheet is merged it always handles the event (sheet over the clip); without it → the post page
  await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.querySelector(".cl-cm.open"));
  await p.click(R("comment")); await p.waitForFunction(() => !!document.querySelector(".cl-cm.open") || location.hash === "#/post/clipv271_0");
  assert.deepEqual(errs, []);
  await c.close();
});
test("1440 dark: rail layout + focus ring + axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "rail_b", "مشاهد الأزرار"); await seed(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p, "#/clips"); await railOk(p, true);
  await p.focus(R("comment")); await p.keyboard.press("Tab"); await p.keyboard.press("Shift+Tab");
  assert.notEqual(await p.evaluate((s) => getComputedStyle(document.querySelector(s)).outlineStyle, R("comment")), "none", "visible focus ring");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/rail-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
test("390 LTR English + reduced motion: mirrored rail, 1.2K, English labels, fade burst, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US", reducedMotion: "reduce" }); const p = await c.newPage();
  await onboard(p, S.base, "rail_c", "Rail Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p);
  await bigCounts(p, "clipv271_1", { likes: 1234, comments: 0 });
  await open(p, "#/clips"); await p.waitForTimeout(300);
  await railOk(p, false);
  assert.equal(await p.getAttribute('.short[data-short="clipv271_1"] [data-cl-rail="like"] .cl-rail-n', "data-n"), "1.2K");
  await p.waitForFunction((s) => document.querySelector(s)?.getAttribute("aria-label") === "Like clip", R("like"));
  await doubleTap(p);
  await p.waitForSelector(".short .burst"); assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector(".short .burst")).animationName), "cl-rail-fade");
  await p.click(R("tip")); await p.waitForSelector(".cl-rail-panel"); await p.waitForFunction(() => /not enabled yet/.test(document.querySelector(".cl-rail-panel").textContent));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(700);
  if (SHOTS) await p.screenshot({ path: SHOTS + "/rail-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
