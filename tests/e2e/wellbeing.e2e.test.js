/* Phase 45 e2e against the real server (production build). Covers: lazy `wellbeing` chunk, #/wellbeing screen with the
 * device-only note, usage measured locally (and NOTHING sent to the server before the opt-in), hide counts (likes/comments/
 * reposts/views hidden via body[data-wb-hide]) persisted server-side, focus mode (no infinite scroll: sentinel hidden, explicit
 * «عرض 10 منشورات أخرى», calm banner), «أنت مطّلع على كل شيء» at the end of the feed, break reminder dialog, opt-in weekly
 * totals upload, no page errors, no inline handlers in the chunk. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [], wbPosts = [];
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
const call = (m, url, body) => p.evaluate(async ([m, url, body]) => { const r = await fetch(url, { method: m, headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, url, body]);
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => { if (r.url().includes("/api/wellbeing/weekly")) wbPosts.push(r.method()); });
  await onboard(p, S.base, "wb_e2e", "مختبر الرفاهية");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("wellbeing screen, local-only usage, hide counts persisted", async () => {
  await until(() => !!window.MPWellbeing, null, 15000);
  await p.goto(S.base + "/?nosw#/wellbeing");
  await p.waitForSelector("#wb-hide", { timeout: 15000 });
  assert.match(await p.textContent("#view"), /يُحسب وقت استخدامك على هذا الجهاز فقط/);
  assert.match(await p.textContent("#view"), /مجانية للجميع/);
  // usage: activity + ticks → seconds stored on the device only
  await p.evaluate(() => { dispatchEvent(new KeyboardEvent("keydown")); for (let i = 0; i < 12; i++) window.MPWellbeing.tick(); });
  const u = await p.evaluate(() => window.MPWellbeing.usage());
  assert.ok(Object.values(u.d).reduce((a, b) => a + b, 0) >= 60, "seconds counted locally");
  assert.equal(wbPosts.length, 0, "no usage sent before the opt-in");
  assert.equal(Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM wellbeing_weekly")).n), 0);
  await p.check("#wb-hide");
  await until(() => document.body.dataset.wbHide === "1");
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='wb_e2e'")).id;
  await until(() => true); await new Promise((r) => setTimeout(r, 400));
  assert.equal((await S.app.ctx.db.get("SELECT hide_counts FROM wellbeing_settings WHERE user_id=$1", [uid])).hide_counts, 1);
  for (let i = 0; i < 13; i++) S.app.ctx.rl.w.clear(), assert.equal((await call("POST", "/api/posts", { text: `منشور هادئ رقم ${i + 1} عن التوازن الرقمي` })).status, 200);
  await p.goto(S.base + "/?nosw#/home"); await p.reload();
  await p.waitForSelector(".actions .a-like", { timeout: 15000 });
  await until(() => document.body.dataset.wbHide === "1", null, 15000);
  const shown = await p.evaluate(() => [...document.querySelectorAll(".actions .a-like>span:last-child, .actions .a-com>span, .actions .views")].filter((e) => getComputedStyle(e).display !== "none").length);
  assert.equal(shown, 0, "counts hidden");
});

test("focus mode: no infinite scroll, explicit more button, caught-up screen at the end", async () => {
  await p.goto(S.base + "/?nosw#/wellbeing"); await p.waitForSelector("#wb-focus", { timeout: 15000 });
  await p.check("#wb-focus"); await until(() => document.body.dataset.wbFocus === "1");
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForSelector("#wb-calm", { timeout: 15000 });
  await p.waitForSelector("#wb-more", { timeout: 10000 });
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#more-sentinel")).display), "none", "sentinel never intersects");
  const before = await p.evaluate(() => document.querySelectorAll(".wrap > .post-card, .wrap > .card.post-card").length);
  await p.evaluate(() => scrollTo(0, document.body.scrollHeight)); await new Promise((r) => setTimeout(r, 900));
  assert.equal(await p.evaluate(() => document.querySelectorAll(".wrap > .post-card, .wrap > .card.post-card").length), before, "scrolling loads nothing");
  await p.click("#wb-more");
  await p.waitForSelector("#wb-cu", { timeout: 10000 });
  assert.match(await p.textContent("#wb-cu"), /أنت مطّلع على كل شيء/);
  await p.click("#wb-unfocus"); await until(() => !document.body.dataset.wbFocus);
});

test("break reminder and opt-in weekly totals", async () => {
  await p.goto(S.base + "/?nosw#/wellbeing"); await p.waitForSelector("#wb-break", { timeout: 15000 });
  await p.selectOption("#wb-break", "15"); await new Promise((r) => setTimeout(r, 300));
  await p.evaluate(() => { for (let i = 0; i < 185; i++) { dispatchEvent(new KeyboardEvent("keydown")); window.MPWellbeing.tick(); } });
  await p.waitForSelector(".wb-dlg", { timeout: 5000 });
  assert.match(await p.textContent(".wb-dlg"), /وقت استراحة قصيرة/);
  await p.click('.wb-dlg [data-wb="ok"]'); await until(() => !document.querySelector(".wb-dlg"));
  await p.goto(S.base + "/?nosw#/wellbeing"); await p.waitForSelector("#wb-share", { timeout: 15000 });
  await p.check("#wb-share");
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='wb_e2e'")).id;
  for (let i = 0; i < 40 && !Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM wellbeing_weekly WHERE user_id=$1", [uid])).n); i++) await new Promise((r) => setTimeout(r, 150));
  const row = await S.app.ctx.db.get("SELECT * FROM wellbeing_weekly WHERE user_id=$1", [uid]);
  assert.ok(row && Number(row.seconds) >= 60, "weekly total uploaded after opt-in");
  assert.ok(wbPosts.includes("POST"));
  await p.uncheck("#wb-share");
  // wait for the condition (the DELETE lands asynchronously) instead of a fixed 400 ms sleep
  for (let i = 0; i < 80 && Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM wellbeing_weekly WHERE user_id=$1", [uid])).n); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM wellbeing_weekly WHERE user_id=$1", [uid])).n), 0, "opt-out deletes");
});

test("no page errors, no inline handlers in the chunk", () => {
  assert.deepEqual(errors, []);
  const src = fs.readFileSync(path.join(ROOT, "wellbeing-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son[a-z]+=["'`]/i);
});
