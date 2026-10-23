/* مسار الإرشاد M3-6 «إحصاءاتي» — #/mentoring?tab=insights renders: empty state for a new mentor, then KPI tiles (.kpi-tile)
 * and six CSS-only month bars on seeded data. 390 light Arabic RTL and 1440 dark English LTR: axe 0 serious/critical,
 * no horizontal overflow, tabs ≥ 44px, no Arabic UI text left in English, no uncaught page errors. Screenshots → SHOTS_DIR. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, c, p, me; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [m, u, b]);
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const open = async (sel) => {
  await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(120);
  await p.evaluate(() => { location.hash = "#/mentoring?tab=insights"; });
  await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(350);
};
const arabicLeft = () => p.evaluate(() => {
  const root = document.querySelector(".wrap.mt-page"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.mt-tags,.mt-topics,.help-pop,.helpi,.hp-strip")) continue; out.push(n.nodeValue.trim()); }
  return out;
});

test.before(async () => {
  S = await startStack();
  c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  p = await c.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "m3ins_mentor", "مرشدة الإحصاءات");
  const r = await call(p, "PUT", "/api/mentor/me", { headline: "مرشدة برمجة", topics: ["programming"], minutes: 60, price: 0, tz: "Asia/Riyadh", open: true });
  assert.ok(r.status < 300, JSON.stringify(r.body));
  me = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='m3ins_mentor'")).id;
});
test.after(async () => { await c?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("new mentor: the insights tab shows the empty state, 390 light AR is clean", async () => {
  await open(".mt-bars");
  assert.ok(await p.$(".mt-page .empty"), "empty state");
  assert.equal(await p.$$eval(".mt-bars li", (x) => x.length), 6, "six months always listed");
  assert.equal(await p.getAttribute('.mt-page .seg a[href$="tab=insights"]', "aria-current"), "page");
  assert.deepEqual(await axe(p), [], "axe empty");
  await shot("390-light-ar-insights-empty");
});

test("seeded data: KPI tiles + bars; 390 light AR and 1440 dark EN clean", async () => {
  const db = S.app.ctx.db, now = Date.now(), iso = (d) => new Date(now - d * 864e5).toISOString();
  const learners = [];
  for (const h of ["m3ins_l1", "m3ins_l2"]) { const id = "u_" + h; await db.run("INSERT INTO users(id,handle,name,created_at) VALUES($1,$2,$3,$4)", [id, h, h, iso(400)]); learners.push(id); }
  let i = 0;
  for (const [l, st, d, rating] of [[0, "completed", 1, 5], [1, "completed", 3, 4], [0, "completed", 40, 4], [1, "no_show", 70, null], [0, "completed", 100, null]]) {
    const id = "m3ins_s" + (++i);
    await db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,60,$5,0,0,'none',0,$6,$6)", [id, me, learners[l], iso(d), st, iso(200)]);
    if (rating) await db.run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,'',$5)", [id, learners[l], me, rating, iso(d)]);
  }
  await db.run("INSERT INTO mentor_requests(id,learner_id,mentor_id,topic,goal,status,created_at,decided_at) VALUES('m3ins_r1',$1,$2,'programming','هدف','accepted',$3,$4)", [learners[0], me, iso(5), new Date(now - 5 * 864e5 + 90 * 60e3).toISOString()]);
  const api = await call(p, "GET", "/api/mentor/insights"); assert.equal(api.status, 200);
  assert.equal(api.body.sessionsTotal, 4); assert.deepEqual(api.body.rating, { avg: 4.3, count: 3 });

  await open(".mt-bars");
  assert.equal(await p.$(".mt-page .empty"), null, "no empty state with data");
  assert.equal(await p.$$eval("#mt-dt .kpi-tile", (x) => x.length), 4, "four KPI tiles");
  const widths = await p.$$eval(".mt-bar-t i", (x) => x.map((e) => e.getBoundingClientRect().width));
  assert.equal(widths.length, 6); assert.ok(Math.max(...widths) > 40, "tallest bar has width");
  assert.ok((await p.$eval(".mt-page .seg a", (e) => e.getBoundingClientRect().height)) >= 44, "tabs ≥ 44px");
  assert.deepEqual(await axe(p), [], "axe 390 light ar"); assert.ok(await noOverflow(), "overflow 390");
  await shot("390-light-ar-insights");

  await p.setViewportSize({ width: 1440, height: 900 });
  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await open(".mt-bars"); await p.waitForTimeout(300);
  await p.waitForFunction(() => /My insights/.test(document.querySelector('.mt-page .seg a[href$="tab=insights"]')?.textContent || ""), null, { timeout: 10000 });
  await p.waitForFunction(() => /Average rating/.test(document.querySelector("#mt-dt")?.textContent || ""), null, { timeout: 10000 });
  assert.deepEqual(await axe(p), [], "axe 1440 dark en"); assert.ok(await noOverflow(), "overflow 1440");
  assert.deepEqual(await arabicLeft(), [], "Arabic UI text left in en");
  await shot("1440-dark-en-insights");
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light")); await p.emulateMedia({ colorScheme: "light" });
  await open(".mt-bars"); await shot("1440-light-en-insights");
});
