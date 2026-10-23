/* global Remote */
/* Phase 77 e2e (jobs & freelance board) against the REAL server (production build), mobile viewport.
 * Employer = staff (first account → admin, 390 light): posts a job through #/jobs/new (published at once), sees the Pi-off
 *   notice on «تمييز الإعلان», opens #/job/:id/applicants, the application (applicant's professional profile, next step with a
 *   message, private note, messages), sees the scam warning on a risky message, reviews a held posting in #/admin/jobs.
 * Applicant (new member, 360 dark): browses #/jobs (search + filter sheet), opens the job, is told to create a professional
 *   profile, then applies (cover + screening answer) in the sheet, follows #/application/:id, messages, sees «إعلاناتي وطلباتي»;
 *   posts a freelance project from a new account with a messaging-app link → held for review with reasons.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy `work` chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots (390 light, 360 dark) → tests/visual/output/p77-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, jobId, appId; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
const sheetHas = (pg, sel) => until(pg, (s) => !!document.querySelector("#sheet:not(.hidden) " + s), sel);
async function axe(pg) {
  // v2.54: measure settled colours. The tests flip data-theme directly (no .no-tx), so colour transitions start; some only start
  // once axe first reads an element's style, and under load axe then sees the *old* scheme's colour (1.02:1 false failures).
  // Transitions are switched off while axe runs and finite animations finished; the end state is what is checked, nothing is skipped.
  await pg.evaluate(async () => { const st = document.createElement("style"); st.id = "axe-settle"; st.textContent = "*,*::before,*::after{transition:none!important}"; document.head.append(st); document.getAnimations().forEach((a) => { const t = a.effect?.getComputedTiming?.(); if (t && t.iterations !== Infinity) a.finish(); }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  try { return await pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|"))); }
  finally { await pg.evaluate(() => document.getElementById("axe-settle")?.remove()).catch(() => {}); }
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p77-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
const light = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
const BODY = "نبحث عن مطوّرة واجهات أمامية تتقن React لبناء لوحة تحكم عربية سريعة وسهلة الوصول، مع اختبارات وتوثيق واضح وتعاون مع فريق التصميم.";

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message));
  p.on("dialog", (d) => d.accept("يطلب التواصل والدفع خارج المنصة"));
  await onboard(p, S.base, "p77_admin", "شركة نور"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المطوّرة", handle: "p77_sara", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  u.on("dialog", (d) => d.accept());
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("employer posts a job; applicant browses, filters, creates a profile and applies", async () => {
  assert.equal(await p.evaluate(() => !!window.MPWork), false, "lazy chunk not in core");
  // entry: settings → account section row
  await go(p, "#/settings?s=acct"); await until(p, () => !!document.querySelector('#view a[href="#/jobs"]'));
  rl(); await go(p, "#/jobs/new"); await until(p, () => !!document.querySelector("#wk-jform"));
  assert.deepEqual(await axe(p), [], "new job form");
  assert.equal(await p.isHidden("#wk-mok"), true, "minors switch only for unpaid");
  await p.fill("#wk-jform [name=title]", "مطوّرة واجهات أمامية (React)"); await p.fill("#wk-jform [name=body]", BODY);
  await p.selectOption("#wk-jform [name=category]", "tech"); await p.fill("#wk-jform [name=skills]", "React، TypeScript، إمكانية الوصول");
  await p.selectOption("#wk-jform [name=mode]", "hybrid"); await p.fill("#wk-jform [name=city]", "جدة");
  await p.selectOption("#wk-jform [name=payType]", "monthly"); await p.fill("#wk-jform [name=payMin]", "800"); await p.fill("#wk-jform [name=payMax]", "1200");
  await p.fill("#wk-jform [name=q0]", "كم سنة خبرتك في React؟");
  await shot(p, "new-390-light");
  await tap(p, "#wk-jform [type=submit]"); await until(p, () => /^#\/job\/[^/]+$/.test(location.hash)); await textHas(p, /الوصف/);
  jobId = await p.evaluate(() => location.hash.split("/")[2]);
  await textHas(p, /مدفوعات Pi غير مفعّلة/); // boost: Pi off notice, no pay buttons
  assert.equal(await p.locator("[data-boost]").count(), 0);
  assert.ok((await minTap(p, "#wk-ja .btn")) >= 44, "44px owner actions");
  assert.deepEqual(await axe(p), [], "job owner view"); await shot(p, "job-owner-390-light");

  // applicant: browse + filters
  rl(); await go(u, "#/jobs"); await until(u, () => !!document.querySelector(".wk-job")); await textHas(u, /مطوّرة واجهات أمامية/);
  assert.deepEqual(await axe(u), [], "browse light");
  await tap(u, ".fx-open"); await until(u, () => !document.querySelector(".fx-sheet").classList.contains("hidden"));
  await u.fill(".fx-sheet [name=skill]", "react"); await u.click('.fx-sheet [data-fx="ok"]');
  await until(u, () => /skill=react/.test(location.hash)); await until(u, () => document.querySelectorAll(".wk-job").length === 1);
  await dark(u); await u.waitForTimeout(200); assert.deepEqual(await axe(u), [], "browse dark"); await shot(u, "browse-360-dark");
  await go(u, "#/jobs?skill=cobol"); await textHas(u, /لا فرص مطابقة/);
  await go(u, "#/jobs?kind=freelance"); await textHas(u, /لا فرص مطابقة/);
  await go(u, "#/jobs?q=" + encodeURIComponent("واجهات")); await until(u, () => document.querySelectorAll(".wk-job").length === 1);
  await tap(u, ".wk-job"); await until(u, () => /^#\/job\//.test(location.hash)); await textHas(u, /أنشئ ملفك المهني للتقديم/);
  await tap(u, "#wk-save"); await until(u, () => document.querySelector("#wk-save")?.getAttribute("aria-pressed") === "true");
  assert.deepEqual(await axe(u), [], "job view dark (no profile)");
  // create a professional profile, then apply
  rl(); const pr = await u.evaluate(async () => (await Remote.api("PUT", "/api/pro/me", { headline: "مطوّرة واجهات أمامية — React", about: "أبني واجهات عربية سريعة وسهلة الوصول منذ ست سنوات.", city: "جدة", visibility: "members" })));
  assert.ok(pr);
  await go(u, "#/jobs"); await go(u, "#/job/" + jobId); await until(u, () => !!document.querySelector("#wk-apply"));
  assert.ok((await minTap(u, "#wk-ja .btn")) >= 44, "44px applicant actions");
  await shot(u, "job-360-dark");
  await tap(u, "#wk-apply"); await sheetHas(u, "#wk-af");
  assert.deepEqual(await axe(u), [], "apply sheet dark");
  await u.fill("#wk-af [name=cover]", "عملت ست سنوات على واجهات React عربية، آخرها لوحة تحكم لمتجر إلكتروني مع اختبارات كاملة.");
  await u.fill("#wk-af [name=a0]", "ست سنوات");
  rl(); await u.click("#wk-af [type=submit]"); await until(u, () => /^#\/application\//.test(location.hash)); await textHas(u, /رسالة التقديم/);
  appId = await u.evaluate(() => location.hash.split("/")[2]);
  await textHas(u, /مُرسَل/); assert.deepEqual(await axe(u), [], "application applicant dark"); await shot(u, "application-360-dark");
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='job_app_new'"));
});

test("employer pipeline: applicants, profile, next step, note, messages + scam warning; my jobs; moderation; CSP", async () => {
  rl(); await go(p, `#/job/${jobId}/applicants`); await until(p, () => !!document.querySelector(".wk-arow")); await textHas(p, /سارة المطوّرة/);
  assert.ok((await minTap(p, ".wk-pipe .chip")) >= 44, "44px pipeline chips");
  assert.deepEqual(await axe(p), [], "applicants light"); await shot(p, "applicants-390-light");
  await tap(p, ".wk-arow"); await until(p, () => !!document.querySelector("#wk-ns")); await textHas(p, /الملف المهني للمتقدّم/); await textHas(p, /اطّلع عليه/);
  await p.fill("#wk-ns [name=message]", "نود دعوتك لمقابلة عن بُعد يوم الأحد."); rl(); await tap(p, '[data-next="interview"]');
  await until(p, () => document.querySelectorAll(".wk-tline li").length >= 3); await textHas(p, /نود دعوتك لمقابلة/);
  await p.locator("#wk-nt").evaluate((f) => { f.closest("details").open = true; });
  await p.fill("#wk-nt [name=note]", "مرشّحة قوية"); rl(); await tap(p, "#wk-nt [type=submit]"); await p.waitForTimeout(400);
  assert.equal((await S.app.ctx.db.get("SELECT note FROM job_applications WHERE id=$1", [appId])).note, "مرشّحة قوية");
  assert.ok((await minTap(p, "#wk-ns .btn, #wk-mf .btn")) >= 44);
  assert.deepEqual(await axe(p), [], "application employer light"); await shot(p, "application-employer-390-light");
  // applicant replies with a risky message → warning on the employer side only
  rl(); await go(u, "#/jobs"); await go(u, "#/application/" + appId); await textHas(u, /مقابلة/); assert.equal(await u.locator("text=مرشّحة قوية").count(), 0, "note private");
  await u.fill("#wk-mf [name=body]", "تمام، ويمكنك التواصل معي على واتساب أيضاً"); await tap(u, "#wk-mf [type=submit]"); await textHas(u, /واتساب/);
  assert.equal(await u.locator(".wk-tline .notice.warn").count(), 0, "sender sees no warning");
  await go(p, "#/jobs"); await go(p, "#/application/" + appId); await until(p, () => !!document.querySelector(".wk-tline .notice.warn"));
  await dark(p); await p.waitForTimeout(200); assert.deepEqual(await axe(p), [], "application employer dark");
  // my postings / applications / saved
  await go(u, "#/jobs?tab=mine"); await textHas(u, /طلباتي/); await until(u, () => !!document.querySelector(".list a.li"));
  await textHas(u, /مقابلة/); assert.ok(await u.locator(".wk-grid .wk-job").count() === 1, "saved job listed");
  assert.deepEqual(await axe(u), [], "mine dark"); await shot(u, "mine-360-dark");
  // applicant (new account) posts a freelance project with a messaging-app link → held for review
  rl(); await go(u, "#/jobs/new"); await until(u, () => !!document.querySelector("#wk-jform"));
  await u.check('#wk-jform [name=kind][value="freelance"]'); assert.equal(await u.isHidden("#wk-emp"), true, "no employment type for freelance");
  await u.fill("#wk-jform [name=title]", "تصميم شعار لمتجر قهوة"); await u.fill("#wk-jform [name=body]", "نحتاج شعاراً بسيطاً وأنيقاً لمتجر قهوة مختصة في جدة مع دليل ألوان. للتفاصيل راسلني على واتساب بعد التقديم مباشرة.");
  await u.selectOption("#wk-jform [name=category]", "design"); await u.selectOption("#wk-jform [name=payType]", "fixed"); await u.fill("#wk-jform [name=payMax]", "50");
  assert.deepEqual(await axe(u), [], "new form dark"); await shot(u, "new-360-dark");
  await tap(u, "#wk-jform [type=submit]"); await until(u, () => /^#\/job\//.test(location.hash)); await textHas(u, /قيد المراجعة/); await textHas(u, /خارج المنصة/);
  const held = await u.evaluate(() => location.hash.split("/")[2]);
  // staff queue: remove the held posting; a report on the open job then dismiss
  await light(p); rl(); await go(p, "#/admin/jobs"); await until(p, () => !!document.querySelector('[data-jm="approve"]')); await textHas(p, /تصميم شعار/);
  assert.deepEqual(await axe(p), [], "admin light"); await shot(p, "admin-390-light");
  await tap(p, `[data-jm="remove"][data-j="${held}"]`); await until(p, () => /لا إعلانات بانتظار المراجعة/.test(document.querySelector("#wk-aj")?.textContent || ""));
  assert.equal((await S.app.ctx.db.get("SELECT status FROM jobs WHERE id=$1", [held])).status, "removed");
  rl(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "مبلّغ", handle: "p77_rep", password: "secret123" }) });
  const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const rep = await fetch(S.base + `/api/jobs/${jobId}/report`, { method: "POST", headers: { ...H(), Cookie: ck }, body: JSON.stringify({ reason: "other", note: "تجربة" }) }); assert.equal(rep.status, 200);
  await go(p, "#/jobs"); await go(p, "#/admin/jobs"); await until(p, () => !!document.querySelector('[data-jm="dismiss"]'));
  await dark(p); await p.waitForTimeout(200); assert.deepEqual(await axe(p), [], "admin dark");
  await tap(p, '[data-jm="dismiss"]'); await until(p, () => /لا بلاغات مفتوحة/.test(document.querySelector("#wk-aj")?.textContent || ""));
  await go(u, "#/jobs"); await go(u, "#/job/" + held); await textHas(u, /أُزيل/); await shot(u, "removed-360-dark");
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='job_removed'"));
  // hire → job filled
  await light(p); rl(); await go(p, "#/application/" + appId); await until(p, () => !!document.querySelector('[data-next="offered"]'));
  await tap(p, '[data-next="offered"]'); await until(p, () => !!document.querySelector('[data-next="hired"]'));
  rl(); await tap(p, '[data-next="hired"]'); await until(p, () => !document.querySelector('[data-next="hired"]'));
  assert.equal((await S.app.ctx.db.get("SELECT status FROM jobs WHERE id=$1", [jobId])).status, "filled");
  assert.deepEqual(errors, []);
  const inline = await u.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .wk-page"))).map((e) => e.outerHTML.slice(0, 160)));
  assert.deepEqual(inline, []);
  const src = fs.readFileSync(path.join(__dirname, "../..", "work-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../chunks.js"), "utf8"), /work: \[[^\]]*"jobs"/);
});
