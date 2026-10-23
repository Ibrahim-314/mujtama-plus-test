/* v2.67 «مُظهر موارد الإرشاد في الجلسة» — card «موارد من مرشدك» on #/msession/:id.
 * • Learner of the session sees the mentor's public + mentees-only resources (existing GET /api/mentors/:handle filter).
 * • A minor's active guardian sees the same list read-only («موارد من المرشد»).
 * • The mentor's own view of the session has no card; a mentor with no resources → no card (empty state hidden).
 * • 390 light AR + 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, rows ≥44px. Shots → SHOTS_DIR. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
const H = "msr_mentor", H2 = "msr_mentor2";
let S, cm, ce, cg, pm, pe, pg; const errors = [];
async function axe(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.waitForSelector("#mt-sres", { timeout: 15000 }); await p.$eval("#mt-sres", (e) => e.scrollIntoView()); await p.screenshot({ path: path.join(SHOTS, name + ".png") }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (p, h, sel) => { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(120); await p.evaluate((x) => { location.hash = x; }, h); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(400); };
const titles = (p) => p.$$eval("#mt-sres li b", (bs) => bs.map((b) => b.textContent.trim()));
const ins = "INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,45,$5,0,0,'none',$6,$7,$7)";

test.before(async () => {
  S = await startStack();
  const ctx = () => S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cm = await ctx(); ce = await ctx(); cg = await ctx();
  pm = await cm.newPage(); pe = await ce.newPage(); pg = await cg.newPage();
  for (const p of [pm, pe, pg]) p.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, H, "سارة المرشدة");
  const prof = { headline: "مطوّرة ويب بخبرة سبع سنوات", topics: ["programming"], minutes: 45, price: 0, tz: "Asia/Riyadh", open: true };
  assert.ok((await call(pm, "PUT", "/api/mentor/me", prof)).status < 300);
  assert.equal((await call(pm, "POST", "/api/mentor/me/resources", { title: "دليل البداية", url: "https://example.com/start", kind: "link", visibility: "public" })).status, 200);
  assert.equal((await call(pm, "POST", "/api/mentor/me/resources", { title: "ملف خاص بالمتعلّمين", url: "https://files.example.com/plan.pdf", kind: "file", visibility: "mentees" })).status, 200);
  await onboard(pe, S.base, "msr_mentee", "فهد المتعلّم");
  await onboard(pg, S.base, "msr_guard", "أبو خالد");
  const db = S.app.ctx.db, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const id = async (h) => (await db.get("SELECT id FROM users WHERE handle=$1", [h])).id;
  const m = await id(H), l = await id("msr_mentee"), g = await id("msr_guard");
  // a minor learner (no browser needed) linked to the guardian
  const kid = "u_msr_kid";
  await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,'msr_kid','خالد الصغير','','#0ea5e9','user',$2,$3)", [kid, { onboarded: true, interests: [] }, iso(now)]);
  await db.run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_msr',$1,$2,'active',$1,'{}',$3)", [g, kid, iso(now)]);
  await db.run(ins, ["mss_msr", m, l, iso(now + 2 * 86400e3), "confirmed", 0, iso(now)]);
  await db.run(ins, ["mss_msr_k", m, kid, iso(now + 3 * 86400e3), "confirmed", 1, iso(now)]);
  // second mentor with no resources → no card
  const cx = await ctx(); const px = await cx.newPage(); await onboard(px, S.base, H2, "مرشد بلا موارد");
  assert.ok((await call(px, "PUT", "/api/mentor/me", prof)).status < 300); await cx.close();
  await db.run(ins, ["mss_msr_2", await id(H2), l, iso(now + 4 * 86400e3), "confirmed", 0, iso(now)]);
});
test.after(async () => { await cm?.close(); await ce?.close(); await cg?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("learner sees «موارد من مرشدك» with both resources (390 light AR)", async () => {
  await go(pe, "#/msession/mss_msr", "#mt-sres");
  assert.match(await pe.textContent("#mt-sres-h"), /موارد من مرشدك/);
  assert.deepEqual(await titles(pe), ["دليل البداية", "ملف خاص بالمتعلّمين"]);
  assert.equal(await pe.getAttribute("#mt-sres a.li", "target"), "_blank");
  assert.match(await pe.getAttribute("#mt-sres a.li", "rel"), /noopener noreferrer/);
  assert.equal(await pe.$$eval("#mt-sres .li", (a) => a.filter((x) => x.getBoundingClientRect().height < 44).length), 0, "rows ≥44px");
  assert.deepEqual(await axe(pe), [], "axe 390 light"); assert.ok(await noOverflow(pe), "no overflow 390");
  await shot(pe, "390-light-ar-learner-session-resources");
});

test("guardian sees the list read-only; mentor's own view has no card", async () => {
  await go(pg, "#/msession/mss_msr_k", "#mt-sres");
  assert.match(await pg.textContent("#mt-sres-h"), /موارد من المرشد/);
  assert.deepEqual(await titles(pg), ["دليل البداية", "ملف خاص بالمتعلّمين"], "active guardian of a mentee: both");
  assert.equal(await pg.$$eval("#mt-sres button, #mt-sres form", (x) => x.length), 0, "read-only");
  assert.deepEqual(await axe(pg), [], "axe guardian 390");
  await shot(pg, "390-light-ar-guardian-session-resources");
  await go(pm, "#/msession/mss_msr", ".mt-who");
  assert.equal(await pm.$("#mt-sres, #mt-sres-slot"), null, "mentor: no card");
});

test("mentor without resources → card absent (empty state hidden)", async () => {
  await go(pe, "#/msession/mss_msr_2", ".mt-who"); await pe.waitForTimeout(500);
  assert.equal(await pe.$("#mt-sres"), null); assert.equal(await pe.$("#mt-sres-slot"), null);
});

test("1440 dark EN (LTR): translated, axe 0, no overflow", async () => {
  await pe.setViewportSize({ width: 1440, height: 900 }); await pe.emulateMedia({ colorScheme: "dark" });
  await pe.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await pe.evaluate(() => window.MPI18n.setLang("en")); await pe.waitForFunction(() => document.documentElement.dir === "ltr");
  await pe.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(pe, "#/msession/mss_msr", "#mt-sres"); await pe.waitForTimeout(300);
  assert.match(await pe.textContent("#mt-sres-h"), /Resources from your mentor/);
  assert.match(await pe.textContent("#mt-sres"), /Mentees/);
  assert.deepEqual(await axe(pe), [], "axe 1440 dark en"); assert.ok(await noOverflow(pe));
  await shot(pe, "1440-dark-en-learner-session-resources");
  await pe.evaluate(() => window.MPI18n.setLang("ar"));
});
