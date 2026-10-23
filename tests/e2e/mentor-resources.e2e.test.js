/* مسار الإرشاد M4-2 «مطوّر موارد المرشد» — mentor resources (PLAN F8).
 * • Mentor adds two resources in #/mentoring?tab=profile (one «للجميع», one «لمتعلّميّ فقط»), reorders them (up/down).
 * • A member (no session) sees only the public one on #/mentor/:handle; a mentee (≥1 session) sees both; a signed-out
 *   visitor's JSON never contains the mentees-only url. Links: target=_blank, rel noopener noreferrer.
 * • 390 light AR + 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, buttons ≥44px.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
const H = "mres_mentor";
let S, cm, cv, ce, pm, pv, pe; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(350); };
const titles = (pg) => pg.$$eval("#mt-res li b", (bs) => bs.map((b) => b.textContent.trim()));
const small44 = (pg, sel) => pg.$$eval(sel, (bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
async function addRes(pg, title, url, vis) {
  await pg.fill("#mt-resf [name=title]", title);
  await pg.fill("#mt-resf [name=url]", url);
  await pg.selectOption("#mt-resf [name=visibility]", vis);
  const [r] = await Promise.all([pg.waitForResponse((x) => x.url().endsWith("/api/mentor/me/resources") && x.request().method() === "POST"), pg.click("#mt-resf-go")]);
  assert.equal(r.status(), 200, "resource saved");
  await pg.waitForFunction((t) => [...document.querySelectorAll("#mt-resm-list b")].some((b) => b.textContent.trim() === t), title);
}

test.before(async () => {
  S = await startStack();
  const ctx = () => S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cm = await ctx(); cv = await ctx(); ce = await ctx();
  pm = await cm.newPage(); pv = await cv.newPage(); pe = await ce.newPage();
  for (const pg of [pm, pv, pe]) pg.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, H, "سارة المرشدة");
  const r = await call(pm, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة سبع سنوات", topics: ["programming"], minutes: 45, price: 0, tz: "Asia/Riyadh", open: true });
  assert.ok(r.status < 300, "profile saved " + JSON.stringify(r.j));
  await onboard(pv, S.base, "mres_member", "عضو زائر");
  await onboard(pe, S.base, "mres_mentee", "فهد المتعلّم");
  const db = S.app.ctx.db, now = Date.now(), iso = (t) => new Date(t).toISOString();
  const m = await db.get("SELECT id FROM users WHERE handle=$1", [H]), l = await db.get("SELECT id FROM users WHERE handle=$1", ["mres_mentee"]);
  await db.run("INSERT INTO mentor_sessions(id,mentor_id,learner_id,request_id,topic,note,starts_at,minutes,status,price,fee,pay_status,minor,created_at,updated_at) VALUES('mss_mres',$1,$2,NULL,'programming','',$3,45,'completed',0,0,'none',0,$4,$4)", [m.id, l.id, iso(now - 3 * 86400e3), iso(now)]);
});
test.after(async () => { await cm?.close(); await cv?.close(); await ce?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("mentor adds + reorders resources in the dashboard (390 light AR)", async () => {
  await go(pm, "#/mentoring?tab=profile", "#mt-resm #mt-resf");
  assert.match(await pm.textContent("#mt-resm"), /لا موارد بعد/);
  await addRes(pm, "دليل البداية", "https://example.com/start", "public");
  await addRes(pm, "ملف خاص بالمتعلّمين", "https://files.example.com/plan.pdf", "mentees");
  assert.deepEqual(await pm.$$eval("#mt-resm-list b", (bs) => bs.map((b) => b.textContent.trim())), ["دليل البداية", "ملف خاص بالمتعلّمين"]);
  // client-side https guard: http is refused before any request
  await pm.fill("#mt-resf [name=title]", "رابط غير آمن"); await pm.fill("#mt-resf [name=url]", "http://example.com");
  await pm.click("#mt-resf-go"); await pm.waitForTimeout(250);
  assert.equal((await call(pm, "GET", "/api/mentor/me/resources")).j.resources.length, 2, "http link not saved");
  await pm.fill("#mt-resf [name=title]", ""); await pm.fill("#mt-resf [name=url]", "");
  // reorder: move the second one up
  const [r] = await Promise.all([pm.waitForResponse((x) => x.url().endsWith("/api/mentor/me/resources/order")), pm.click("#mt-resm-list li:nth-child(2) [data-act=up]")]);
  assert.equal(r.status(), 200);
  await pm.waitForFunction(() => document.querySelector("#mt-resm-list li:first-child b")?.textContent.trim() === "ملف خاص بالمتعلّمين");
  assert.equal(await small44(pm, "#mt-resm .mt-resm-btn"), 0, "tool buttons ≥44px");
  assert.deepEqual(await axe(pm), [], "axe dashboard 390 light");
  assert.ok(await noOverflow(pm), "no overflow 390");
  await pm.$eval("#mt-resm", (e) => e.scrollIntoView());
  await shot(pm, "390-light-ar-resources-manager");
});

test("visitor/member sees public only; mentee sees both; links open safely", async () => {
  const anon = await (await fetch(S.base + "/api/mentors/" + H, { headers: { "X-Requested-With": "mujtama" } })).json();
  assert.deepEqual(anon.resources.map((x) => x.title), ["دليل البداية"], "signed-out JSON: public only");
  assert.ok(!JSON.stringify(anon).includes("files.example.com"), "mentees-only url never sent to a visitor");
  await go(pv, "#/mentor/" + H, "#mt-res");
  assert.deepEqual(await titles(pv), ["دليل البداية"], "member: public only");
  assert.equal(await pv.getAttribute("#mt-res a.li", "target"), "_blank");
  assert.match(await pv.getAttribute("#mt-res a.li", "rel"), /noopener/);
  assert.match(await pv.getAttribute("#mt-res a.li", "rel"), /noreferrer/);
  assert.equal(await pv.getAttribute("#mt-res a.li", "href"), "https://example.com/start");
  assert.deepEqual(await axe(pv), [], "axe member 390");
  await go(pe, "#/mentor/" + H, "#mt-res");
  assert.deepEqual(await titles(pe), ["ملف خاص بالمتعلّمين", "دليل البداية"], "mentee: both, in the mentor's order");
  assert.match(await pe.textContent("#mt-res"), /للمتعلّمين/);
  assert.deepEqual(await axe(pe), [], "axe mentee 390");
  assert.ok(await noOverflow(pe));
  await pe.$eval("#mt-res", (e) => e.scrollIntoView());
  await shot(pe, "390-light-ar-mentee-resources");
});

test("1440 dark EN (LTR): translated, axe 0, no overflow (dashboard + profile)", async () => {
  for (const pg of [pm, pe]) {
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.emulateMedia({ colorScheme: "dark" });
    await pg.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
    await pg.evaluate(() => window.MPI18n.setLang("en")); await pg.waitForFunction(() => document.documentElement.dir === "ltr");
    await pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  }
  await go(pm, "#/mentoring?tab=profile", "#mt-resm-list"); await pm.waitForTimeout(300);
  assert.match(await pm.textContent("#mt-resm"), /Resources/);
  assert.match(await pm.textContent("#mt-resm"), /Add resource/);
  assert.equal(await pm.getAttribute("#mt-resm-list [data-act=up]", "aria-label"), "Move up");
  assert.deepEqual(await axe(pm), [], "axe dashboard 1440 dark en"); assert.ok(await noOverflow(pm));
  await pm.$eval("#mt-resm", (e) => e.scrollIntoView());
  await shot(pm, "1440-dark-en-resources-manager");
  await go(pe, "#/mentor/" + H, "#mt-res"); await pe.waitForTimeout(300);
  assert.match(await pe.textContent("#mt-res"), /Resources/);
  assert.deepEqual(await axe(pe), [], "axe profile 1440 dark en"); assert.ok(await noOverflow(pe));
  await pe.$eval("#mt-res", (e) => e.scrollIntoView());
  await shot(pe, "1440-dark-en-mentee-resources");
  for (const pg of [pm, pe]) await pg.evaluate(() => window.MPI18n.setLang("ar"));
});
