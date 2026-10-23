/* v2.70 e2e (real server, production build): the admin ops page shows the «جودة تشغيل الفيديو» card fed by
 * GET /api/admin/video/qoe — KPIs, per-source table, range switch — at 390 light, 1440 dark and English LTR, no
 * horizontal overflow, axe 0 serious/critical on the card, no page errors. Screenshots → SHOTS_DIR (optional). */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S; const errors = [];
async function axeOn(page, sel) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await page.evaluate(async (s) => (await window.axe.run(document.querySelector(s), { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
async function waitFor(page, fn, ms = 15000) { const end = Date.now() + ms; for (;;) { if (await page.evaluate(fn).catch(() => false)) return; if (Date.now() > end) throw new Error("timeout " + fn); await new Promise(r => setTimeout(r, 150)); } }
test.before(async () => { S = await startStack(); });
test.after(async () => { await S?.close(); });

test("ops page: «جودة تشغيل الفيديو» card (390 light, 1440 dark, LTR)", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  await onboard(p, S.base, "qoe_admin", "مدير الجودة"); // first account = admin
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='qoe_admin'")).id;
  const at = new Date().toISOString();
  for (let i = 1; i <= 12; i++) await S.app.ctx.db.run("INSERT INTO video_qoe (user_id, post_id, source, startup_ms, stalls, stall_ms, watched_ms, rung, created_at) VALUES ($1,'p',$2,$3,$4,$5,$6,1,$7)", [uid, i % 2 ? "clips" : "post", 200 * i, i % 4 ? 0 : 1, i % 4 ? 0 : 900, 8000 + i * 100, new Date(Date.now() - (i % 3) * 864e5).toISOString() || at]);
  const open = async (page) => {
    await page.goto(S.base + "/?nosw#/admin/ops");
    await page.waitForSelector("#ops-qoe .ops-kpi", { timeout: 25000 });
  };
  await open(p);
  const txt = await p.textContent("#ops-qoe");
  assert.match(txt, /جودة تشغيل الفيديو/); assert.match(txt, /زمن البدء p50/); assert.match(txt, /المقاطع القصيرة/); assert.match(txt, /فيديو المنشورات/);
  assert.equal(await p.getAttribute("#ops-qoe a[aria-current=page]", "data-qdays"), "7");
  await p.click('#ops-qoe [data-qdays="1"]'); await waitFor(p, () => document.querySelector("#ops-qoe a[aria-current=page]")?.dataset.qdays === "1");
  await p.click('#ops-qoe [data-qdays="7"]'); await waitFor(p, () => document.querySelector("#ops-qoe a[aria-current=page]")?.dataset.qdays === "7");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow at 390");
  assert.deepEqual(await axeOn(p, "#ops-qoe"), []);
  if (SHOTS) await p.locator("#ops-qoe").screenshot({ path: path.join(SHOTS, "qoe-390-light.png") });
  const cookies = await ctx.cookies();
  // 1440 dark
  const d = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark", reducedMotion: "reduce" }); await d.addCookies(cookies);
  const dp = await d.newPage(); dp.on("pageerror", e => errors.push(e.message));
  await dp.goto(S.base + "/?nosw"); await dp.evaluate(() => { try { localStorage.setItem("mp.onboarded", "1"); } catch { } });
  await open(dp);
  assert.ok(await dp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.deepEqual(await axeOn(dp, "#ops-qoe"), []);
  if (SHOTS) await dp.locator("#ops-qoe").screenshot({ path: path.join(SHOTS, "qoe-1440-dark.png") });
  // English LTR
  await S.app.ctx.db.run("UPDATE users SET lang='en' WHERE id=$1", [uid]);
  await p.evaluate(() => { DB.settings.lang = "en"; save(); });
  await p.reload(); await waitFor(p, () => document.documentElement.dir === "ltr");
  await open(p);
  await waitFor(p, () => /Video playback quality/.test(document.querySelector("#ops-qoe")?.textContent || ""));
  assert.match(await p.textContent("#ops-qoe"), /Short clips/);
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  assert.deepEqual(await axeOn(p, "#ops-qoe"), []);
  if (SHOTS) await p.locator("#ops-qoe").screenshot({ path: path.join(SHOTS, "qoe-390-ltr.png") });
  assert.deepEqual(errors, []);
  await ctx.close(); await d.close();
});
