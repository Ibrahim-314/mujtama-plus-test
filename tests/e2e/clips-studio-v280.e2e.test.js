/* v2.80 — «أدوات صانع فيديوتك» (v280-studio).
 * 390 light RTL creator: a saved draft is listed on #/clips/drafts (axe clean), opens in the editor with its caption and
 * planned time, «جدولة» publishes it as a scheduled clip (the draft is removed, the profile shows the «مجدول» tile);
 * the profile has «المسودات» + «أفضل وقت للنشر», each own tile has a stats button → #/clips/stats/<id> (KPIs, 14 bars,
 * sources; axe clean); deleting a draft asks first. A viewer's watch from the creator's profile grid is counted as
 * «ملفك في فيديوتك». 1440 dark EN: the stats + drafts pages are English. No page errors anywhere. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
let S;
test.before(async () => { S = await startStack({ fakeVideoMs: 1 }); });
test.after(async () => { await S.close(); });
const axe = async (p, sel) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async sel =>
    (await window.axe.run(document.querySelector(sel), { resultTypes: ["violations"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ": " + v.nodes.map(n => n.target.join(" ")).join(", ")), sel);
};
const db = () => S.app.ctx.db;
async function seedClip(uid, id, ago = 60e3) {
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'video',$3,'public','published',$4,$5)", [
    id, uid, "لقطتي " + id, { video: { short: true, source: "clips", duration: 10, status: "ready", variants: { "360p": "/media/none-" + id + ".mp4", poster: "" } } }, new Date(Date.now() - ago).toISOString()]);
}
async function seedMedia(uid, id) {
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'video','video/mp4',10,$3,'ready',$4,$5)", [id, uid, id + ".mp4", { "360p": "/media/" + id + "_360p.mp4", duration: 12 }, new Date().toISOString()]);
}

test("390 light RTL: drafts → editor → schedule, profile tools, stats page, delete asks first", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" });
  const p = await c.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "vs_maker", "صانعة المقاطع");
  const me = await p.evaluate(() => DB.me);
  await seedClip(me, "vs_c1");
  await seedMedia(me, "m_vs1x"); await seedMedia(me, "m_vs2x");
  const fut = new Date(Date.now() + 2 * 86400e3); fut.setUTCMinutes(0, 0, 0);
  const put = await p.evaluate(async ([fut]) => {
    const h = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
    const a = await fetch("/api/clips/drafts/cd_vsdrafta1", { method: "PUT", headers: h, body: JSON.stringify({ mediaId: "m_vs1x", caption: "مسودة السفر #رحلة", publishAt: fut }) });
    const b = await fetch("/api/clips/drafts/cd_vsdraftb2", { method: "PUT", headers: h, body: JSON.stringify({ mediaId: "m_vs2x", caption: "" }) });
    return [a.status, b.status];
  }, [fut.toISOString()]);
  assert.deepEqual(put, [200, 200]);

  // drafts page
  await p.evaluate(() => { location.hash = "#/clips/drafts"; });
  await p.waitForSelector(".vs-list .vs-d", { timeout: 20000 });
  assert.equal(await p.locator(".vs-d").count(), 2);
  assert.match(await p.textContent(".vs-d:first-child"), /موعد مقترح|مسودة السفر|بدون وصف/);
  assert.deepEqual(await axe(p, ".vs-pg"), []);
  const backHref = await p.getAttribute(".vs-head a", "href");
  assert.equal(backHref, "#/clips/@vs_maker", "back goes to my Vidtik profile");
  // delete asks first: dismiss keeps it, accept removes it
  // v2.140.2: the in-app MPConfirm sheet replaced native confirm()
  await p.click('[data-vs-del="cd_vsdraftb2"]');
  await p.waitForSelector("#mp-cf-x", { timeout: 5000 }); await p.click("#mp-cf-x");
  await p.waitForSelector("#mp-cf-x", { state: "detached", timeout: 5000 });
  assert.equal(await p.locator(".vs-d").count(), 2, "cancelled confirm keeps the draft");
  await p.click('[data-vs-del="cd_vsdraftb2"]');
  await p.waitForSelector("#mp-cf-ok", { timeout: 5000 }); await p.click("#mp-cf-ok");
  await p.waitForFunction(() => document.querySelectorAll(".vs-d").length === 1, null, { timeout: 10000 });

  // open the draft in the editor
  await p.click('.vs-d-open[href*="cd_vsdrafta1"]');
  await p.waitForSelector('.vt-ed [data-step="edit"]:not([hidden])', { timeout: 15000 });
  assert.equal(await p.inputValue("#vt-cap"), "مسودة السفر #رحلة");
  assert.equal(await p.isChecked("#vt-sch"), true, "planned time restored");
  assert.ok(await p.inputValue("#vt-at"));
  await p.waitForFunction(() => !document.querySelector(".vt-pub").disabled, null, { timeout: 10000 });
  assert.match(await p.textContent(".vt-pub"), /جدولة/);
  assert.equal(await p.isDisabled(".vt-draft"), false);
  // a time too soon disables publishing
  await p.fill("#vt-at", await p.evaluate(() => { const d = new Date(Date.now() + 60e3); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); }));
  await p.waitForFunction(() => document.querySelector(".vt-pub").disabled);
  await p.fill("#vt-at", await p.evaluate((ms) => { const d = new Date(ms); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 16); }, fut.getTime()));
  await p.waitForFunction(() => !document.querySelector(".vt-pub").disabled);
  await p.click(".vt-pub");
  await p.waitForFunction(() => location.hash.startsWith("#/clips/@"), null, { timeout: 15000 });
  const row = await db().get("SELECT status, publish_at FROM posts WHERE author=$1 AND text=$2", [me, "مسودة السفر #رحلة"]);
  assert.equal(row.status, "scheduled");
  assert.equal(new Date(row.publish_at).toISOString(), fut.toISOString());
  for (let i = 0; i < 40 && await db().get("SELECT 1 x FROM clip_drafts WHERE id='cd_vsdrafta1'"); i++) await p.waitForTimeout(100);
  assert.equal(await db().get("SELECT 1 x FROM clip_drafts WHERE id='cd_vsdrafta1'"), undefined, "published draft removed");

  // profile: scheduled tile, tools, stats button
  await p.waitForSelector(".vt-tile-sched", { timeout: 15000 });
  assert.equal(await p.getAttribute(".vt-tile-sched", "href"), "#/scheduled");
  await p.waitForSelector("[data-vt-best]:not([hidden])", { timeout: 10000 });
  assert.match(await p.textContent("[data-vt-best]"), /أفضل وقت للنشر/);
  assert.equal(await p.getAttribute(".vt-tool", "href"), "#/clips/drafts");
  assert.deepEqual(await axe(p, ".vt-pf"), []);
  const stat = p.locator('.vt-stat[href="#/clips/stats/vs_c1"]');
  await stat.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
  assert.equal(await stat.count(), 1, await p.evaluate(() => (document.querySelector(".vt-grid")?.outerHTML || "no grid").slice(0, 1500)));
  // v2.140.2: the profile can re-render once after the publish syncs (same content); measure the settled tile
  let box = null; for (let i = 0; i < 20 && !(box = await stat.boundingBox().catch(() => null)); i++) await p.waitForTimeout(150); assert.ok(box.width >= 44 && box.height >= 44, "44px target");

  // a viewer opens the clip from the profile grid → counted as «profile»
  const v = await S.browser.newContext({ ...MOBILE });
  const q = await v.newPage(); q.on("pageerror", e => errs.push(e.message));
  await onboard(q, S.base, "vs_viewer", "مشاهد");
  await q.evaluate(() => { location.hash = "#/clips/@vs_maker"; });
  await q.waitForSelector('.vt-tile[href="#/clips?start=vs_c1"]', { timeout: 15000 });
  assert.equal(await q.locator(".vt-stat").count(), 0, "no stats button for others");
  assert.equal(await q.locator("[data-vt-tools]").count(), 0);
  await q.click('.vt-tile[href="#/clips?start=vs_c1"]');
  await q.waitForSelector('.shorts .short[data-short="vs_c1"]', { timeout: 15000 });
  await q.waitForTimeout(900);
  await q.evaluate(() => { location.hash = "#/home"; });
  let w; for (let i = 0; i < 40 && !(w = await db().get("SELECT src FROM clip_watch WHERE post_id='vs_c1'")); i++) await q.waitForTimeout(100);
  assert.equal(w?.src, "profile");
  await v.close();

  // stats page
  await stat.click();
  await p.waitForSelector(".vs-kpis", { timeout: 15000 });
  assert.equal(await p.locator(".vs-k").count(), 7);
  assert.equal(await p.locator(".vs-bar").count(), 14);
  assert.match(await p.textContent(".vs-k:first-child"), /1/);
  assert.match(await p.textContent(".vs-srcs"), /ملفك في فيديوتك/);
  assert.deepEqual(await axe(p, ".vs-pg"), []);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, "no horizontal overflow");
  assert.deepEqual(errs, []);
  await c.close();
});

test("1440 dark EN: stats and drafts pages in English, others get 404 on stats", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" });
  const p = await c.newPage();
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await onboard(p, S.base, "vs_en", "Maker EN");
  await p.evaluate(() => window.MPI18n.setLang("en"));
  await p.waitForTimeout(300);
  const me = await p.evaluate(() => DB.me);
  await seedClip(me, "vs_e1");
  await p.evaluate(() => { location.hash = "#/clips/stats/vs_e1"; });
  await p.waitForSelector(".vs-kpis", { timeout: 20000 });
  const t = await p.textContent(".vs-pg");
  assert.match(t, /Video stats/); assert.match(t, /Where viewers came from/); assert.match(t, /Sources appear after the first views/);
  assert.ok(!/[\u0600-\u06FF]/.test(t.replace(/لقطتي vs_e1/g, "")), "no Arabic UI text: " + t.slice(0, 200));
  assert.deepEqual(await axe(p, ".vs-pg"), []);
  await p.evaluate(() => { location.hash = "#/clips/drafts"; });
  await p.waitForSelector(".vs-pg .empty", { timeout: 15000 });
  assert.match(await p.textContent(".vs-pg"), /No drafts/);
  await p.evaluate(() => { location.hash = "#/clips/stats/vs_c1"; }); // someone else's clip
  await p.waitForSelector(".vs-pg .empty", { timeout: 15000 });
  assert.equal(await p.locator(".vs-kpis").count(), 0);
  assert.deepEqual(errs, []);
  await c.close();
});
