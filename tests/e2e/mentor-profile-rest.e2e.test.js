/* M2-4 «مصمم صفحة الملف (الجزء السفلي)» — #/mentor/:handle remainder.
 * • Reviews: first 20, «عرض المزيد» loads the rest through ?reviewsBefore= (no duplicates), then the button goes away.
 * • Sticky CTA (phones): visible at 390, sits above the bottom nav, clear of the FAB, inside the viewport; «احجز جلسة»
 *   scrolls to the booking box (bar then hides); absent at 1440.
 * • Public communities block when the mentor turns the field on; guardian card for a linked minor's guardian.
 * • 390 light AR, 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, no Arabic UI text left in EN.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
const H = "m24_mentor";
let S, cm, cv, cg, pm, pv, pg2; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (pg, name, full = true) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: full }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(350); };
const arabicLeft = (pg) => pg.evaluate(() => {
  const root = document.querySelector(".wrap.mt-page"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.mt-tags,.mt-topics,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  return out;
});
const rect = (pg, sel) => pg.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vis: cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.5 }; }, sel);
const db = () => S.app.ctx.db;
const iso = (ms) => new Date(ms).toISOString();

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cv = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cg = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pv = await cv.newPage(); pg2 = await cg.newPage();
  for (const pg of [pm, pv, pg2]) pg.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, H, "سارة المرشدة");
  const r = await call(pm, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة سبع سنوات", bio: "أساعدك في أول مشروع ويب.", topics: ["programming"], minutes: 45, price: 0, tz: "Asia/Riyadh", allowMinors: true, open: true, fields: { communities: "public" } });
  assert.ok(r.status < 300, "profile saved " + JSON.stringify(r.j));
  const sl = await call(pm, "PUT", "/api/mentor/me/slots", { slots: Array.from({ length: 7 }, (_, w) => ({ weekday: w, start: "08:00", end: "22:00" })) });
  assert.ok(sl.status < 300, "slots saved " + JSON.stringify(sl.j));
  await onboard(pv, S.base, "m24_member", "عضو");
  await onboard(pg2, S.base, "m24_parent", "وليّ أمر");
  const mid = (await db().get("SELECT id FROM users WHERE handle=$1", [H])).id;
  const vid = (await db().get("SELECT id FROM users WHERE handle='m24_member'")).id, gid = (await db().get("SELECT id FROM users WHERE handle='m24_parent'")).id;
  const now = Date.now();
  for (let i = 0; i < 24; i++) {
    const sid = "m24s" + String(i).padStart(2, "0");
    await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES($1,$2,$3,NULL,'programming','',$4,45,'completed',0,0,'none',0,$5,$5)", [sid, mid, vid, iso(now - (40 - i) * 864e5), iso(now)]);
    await db().run("INSERT INTO mentor_feedback(session_id,by_user,about_user,rating,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)", [sid, vid, mid, 3 + (i % 3), "مراجعة رقم " + i, iso(now - (40 - i) * 864e5 + 3600e3)]);
  }
  // guardian: parent ↔ kid (minor) with one confirmed session with the mentor
  const kc = await S.browser.newContext(); const kp = await kc.newPage(); await kp.goto(S.base + "/");
  const reg = await call(kp, "POST", "/api/auth/register", { name: "طفل", handle: "m24_kid", password: "secret123" }); await kc.close();
  const kid = reg.j?.user?.id; assert.ok(kid, "kid registered");
  await db().run("INSERT INTO age_profiles(user_id,birth_date,source,updated_at) VALUES($1,'2013-04-01','self',$2)", [kid, iso(now)]);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_m24',$1,$2,'active',$1,'{}',$3)", [gid, kid, iso(now)]);
  await db().run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES('m24k1',$1,$2,NULL,'programming','سرّي',$3,45,'confirmed',0,0,'none',1,$4,$4)", [mid, kid, iso(now + 3 * 864e5), iso(now)]);
  // communities: one public (listed), one private (never listed)
  for (const [id, type] of [["m24pub", "public"], ["m24priv", "private"]]) {
    await db().run("INSERT INTO communities(id,name,descr,topic,type,color,owner,rules,settings,location,created_at,member_count) VALUES($1,$2,'',NULL,$3,NULL,$4,'[]','{}',NULL,$5,5)", [id, id === "m24pub" ? "مطوّرو الويب" : "سرّي", type, mid, iso(now)]);
    await db().run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,'member',$3)", [id, mid, iso(now)]);
  }
});
test.after(async () => { await cm?.close(); await cv?.close(); await cg?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("reviews: 20 first, «عرض المزيد» loads the remaining 4 then disappears; communities public only", async () => {
  await go(pv, "#/mentor/" + H, "#mt-revs");
  assert.equal((await pv.$$("#mt-revs > li")).length, 20);
  const [res] = await Promise.all([pv.waitForResponse((r) => r.url().includes("reviewsBefore=")), pv.click("#mt-more")]);
  assert.equal(res.status(), 200);
  await pv.waitForFunction(() => document.querySelectorAll("#mt-revs > li").length === 24);
  const texts = await pv.$$eval("#mt-revs small[dir=auto]", (els) => els.map((e) => e.textContent));
  assert.equal(new Set(texts).size, 24, "no duplicates");
  assert.equal(await pv.$("#mt-more"), null, "button gone at the end");
  assert.ok(await pv.evaluate(() => document.activeElement?.closest("#mt-revs") !== null), "focus moved to the first new review");
  assert.equal((await pv.$$("#mt-comms li")).length, 1); assert.match(await pv.textContent("#mt-comms"), /مطوّرو الويب/);
  assert.equal(await pv.$("#mt-guard"), null, "no guardian card for a plain member");
});

test("sticky CTA at 390: above the bottom nav, inside the viewport, clear of the FAB; book scrolls to the booking box", async () => {
  await go(pv, "#/mentor/" + H, "#mt-cta");
  await pv.evaluate(() => scrollTo(0, 0)); await pv.waitForTimeout(300);
  const bar = await rect(pv, "#mt-cta"); assert.ok(bar && bar.vis, "bar visible");
  assert.ok(bar.bottom <= 844 && bar.left >= 0 && bar.right <= 390, "inside viewport " + JSON.stringify(bar));
  const nav = await rect(pv, ".bottomnav"); if (nav && nav.vis) assert.ok(bar.bottom <= nav.top + 1, "above the bottom nav");
  const fab = await rect(pv, ".fab"); if (fab && fab.vis) assert.ok(bar.right <= fab.left || bar.left >= fab.right || bar.bottom <= fab.top || bar.top >= fab.bottom, "does not cover the FAB");
  const help = await rect(pv, ".hp-btn"); if (help && help.vis) assert.ok(bar.top >= help.bottom || bar.bottom <= help.top, "does not cover help «؟»");
  const tb = await pv.evaluate(() => { const b = document.querySelector("#mt-cta-go").getBoundingClientRect(); return b.height; }); assert.ok(tb >= 44, "touch target ≥44");
  assert.deepEqual(await axe(pv), [], "axe 390 light ar");
  assert.ok(await noOverflow(pv), "no overflow at 390");
  await shot(pv, "390-light-ar-top-cta", false);
  await pv.click("#mt-cta-go");
  await pv.waitForFunction(() => { const b = document.querySelector("#mt-book"); if (!b) return false; const r = b.getBoundingClientRect(); return r.top < innerHeight * 0.7 && r.bottom > 0; }, null, { timeout: 5000 });
  await pv.waitForFunction(() => document.querySelector("#mt-cta")?.classList.contains("off"), null, { timeout: 5000 });
  await shot(pv, "390-light-ar-profile");
});

test("guardian card for the linked minor's guardian (no notes)", async () => {
  await go(pg2, "#/mentor/" + H, "#mt-guard");
  const t = await pg2.textContent("#mt-guard");
  assert.match(t, /طفل/); assert.ok(!t.includes("سرّي"), "no private note");
  assert.deepEqual(await axe(pg2), [], "axe guardian 390");
  await pg2.$eval("#mt-guard", (e) => e.scrollIntoView()); await shot(pg2, "390-light-ar-guardian", false);
});

test("1440 dark EN (LTR): axe 0, no overflow, translated, no sticky bar on desktop", async () => {
  for (const pg of [pv, pg2]) {
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.emulateMedia({ colorScheme: "dark" });
    await pg.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
    await pg.evaluate(() => window.MPI18n.setLang("en")); await pg.waitForFunction(() => document.documentElement.dir === "ltr");
    await pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  }
  await go(pv, "#/mentor/" + H, "#mt-revs"); await pv.waitForTimeout(300);
  const bar = await rect(pv, "#mt-cta"); assert.ok(!bar || !bar.vis, "no sticky bar at 1440");
  assert.match(await pv.textContent("#mt-more"), /Show more/);
  assert.deepEqual(await axe(pv), [], "axe 1440 dark en");
  assert.ok(await noOverflow(pv));
  assert.deepEqual(await arabicLeft(pv), [], "no Arabic UI text in en");
  await shot(pv, "1440-dark-en-profile");
  await go(pg2, "#/mentor/" + H, "#mt-guard"); await pg2.waitForTimeout(300);
  assert.deepEqual(await axe(pg2), [], "axe guardian 1440 dark en");
  assert.deepEqual(await arabicLeft(pg2), [], "no Arabic UI text in en (guardian)");
  await pg2.$eval("#mt-guard", (e) => e.scrollIntoView()); await shot(pg2, "1440-dark-en-guardian", false);
  await pg2.setViewportSize({ width: 390, height: 844 }); await go(pg2, "#/mentor/" + H, "#mt-cta"); await pg2.waitForTimeout(300);
  assert.deepEqual(await axe(pg2), [], "axe 390 dark en LTR");
  assert.ok(await noOverflow(pg2));
  await shot(pg2, "390-dark-en-ltr-cta", false);
});

test("stats hidden («off»): the whole reviews section and the rating/sessions tiles are absent (no misleading «لا تقييمات بعد»)", async () => {
  assert.ok((await call(pm, "PUT", "/api/mentor/me", { fields: { stats: "off" } })).status < 300);
  try {
    await go(pv, "#/mentor/" + H, ".mt-stats");
    assert.equal(await pv.$("#mt-revs"), null, "no reviews list");
    assert.equal(await pv.$(".mt-dist"), null, "no distribution");
    const body = await pv.textContent("main");
    assert.doesNotMatch(body, /لا تقييمات بعد|No ratings yet/, "no empty-state claiming zero reviews");
    assert.doesNotMatch(body, /جلسة مكتملة|completed session/i, "sessions tile hidden too");
    assert.ok(await pv.$("#mt-book"), "booking still available");
  } finally {
    assert.ok((await call(pm, "PUT", "/api/mentor/me", { fields: { stats: "public" } })).status < 300);
  }
});
