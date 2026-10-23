/* global Remote */
/* Phase 76 e2e (professional profile & CV) against the REAL server (production build), mobile viewport.
 * Member (360): creates a professional profile in #/cv, adds experience + education + portfolio, reorders, sets skills,
 *   languages & links, privacy (members only, links followers-only); opens the printable /cv page; previews as a stranger.
 * Staff (first account → admin, 390): sees the badge link on the social profile, opens #/cv/:handle, finds the member in
 *   #/talent (search + filter sheet), reports flow + #/admin/pro hide / restore. Studio stats from the post menu load the lazy
 *   creation chunk (core budget move).
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots (390 light, 360 dark) → tests/visual/output/p76-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u; const errors = [];
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
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p76-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message));
  p.on("dialog", (d) => d.accept("بيانات غير صحيحة في الملف"));
  await onboard(p, S.base, "p76_admin", "نورة الإدارية"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المطوّرة", handle: "p76_sara", password: "secret123" }) });
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

test("member builds a professional profile: basics, entries, reorder, skills, languages, privacy, CV page", async () => {
  assert.equal(await u.evaluate(() => !!window.MPWork), false, "lazy chunk not in core");
  rl(); await go(u, "#/cv"); await until(u, () => !!document.querySelector("#wk-new"));
  assert.deepEqual(await axe(u), []);
  await u.fill("#wk-new [name=headline]", "مطوّرة واجهات أمامية — React وإمكانية الوصول");
  await u.fill("#wk-new [name=about]", "أبني واجهات عربية سريعة وسهلة الوصول منذ ست سنوات، وأحب تحويل الأفكار المعقدة إلى تجارب بسيطة وواضحة.");
  await u.fill("#wk-new [name=city]", "جدة"); await u.fill("#wk-new [name=country]", "السعودية");
  await u.check('#wk-new [name=openTo][value="freelance"]'); await u.selectOption("#wk-new [name=visibility]", "public");
  await tap(u, "#wk-new [type=submit]"); await until(u, () => !!document.querySelector(".wk-done progress"));
  // experience ×2 (second goes first after reorder)
  for (const [t, o, s, e] of [["مطوّرة واجهات", "شركة نور", "2021-03", ""], ["متدرّبة", "استوديو الأفكار", "2019-06", "2020-12"]]) {
    rl(); await tap(u, '[data-add="experience"]'); await sheetHas(u, "#wk-if");
    await u.fill("#wk-if [name=title]", t); await u.fill("#wk-if [name=org]", o); await u.fill("#wk-if [name=start]", s);
    if (e) await u.fill("#wk-if [name=end]", e); else await u.check("#wk-if [name=current]");
    assert.deepEqual(await axe(u), [], "item sheet");
    await u.click("#wk-if [type=submit]"); await until(u, (x) => document.querySelector("#view").textContent.includes(x), t);
  }
  await tap(u, '[data-dn]:not([disabled])'); await until(u, () => document.querySelector("#wk-s-experience")?.closest("section").querySelector(".wk-item b")?.textContent === "متدرّبة");
  rl(); await tap(u, '[data-add="education"]'); await sheetHas(u, "#wk-if");
  await u.fill("#wk-if [name=title]", "بكالوريوس علوم الحاسب"); await u.fill("#wk-if [name=org]", "جامعة الملك عبدالعزيز"); await u.fill("#wk-if [name=start]", "2015-09"); await u.fill("#wk-if [name=end]", "2019-06");
  await u.click("#wk-if [type=submit]"); await textHas(u, /جامعة الملك عبدالعزيز/);
  rl(); await tap(u, '[data-add="portfolio"]'); await sheetHas(u, "#wk-if");
  await u.fill("#wk-if [name=title]", "واجهة متجر عربي"); await u.fill("#wk-if [name=url]", "https://example.com/shop"); await u.fill("#wk-if [name=body]", "تصميم وتنفيذ واجهة متجر بالكامل.");
  await u.click("#wk-if [type=submit]"); await textHas(u, /واجهة متجر عربي/);
  // skills
  rl(); await tap(u, "#wk-es"); await sheetHas(u, "#wk-sf");
  await u.fill("#wk-sf .wk-row:nth-child(1) [name=name]", "React"); await u.selectOption("#wk-sf .wk-row:nth-child(1) [name=level]", "5"); await u.fill("#wk-sf .wk-row:nth-child(1) [name=years]", "6");
  for (const s of ["إمكانية الوصول", "TypeScript"]) { await u.click("#wk-sf [data-addrow]"); await u.fill("#wk-sf .wk-row:last-child [name=name]", s); }
  assert.deepEqual(await axe(u), [], "skills sheet");
  await u.click("#wk-sf [type=submit]"); await until(u, () => document.querySelectorAll(".wk-skills li").length === 3);
  // languages + links
  rl(); await tap(u, "#wk-el"); await sheetHas(u, "#wk-lf");
  await u.click("#wk-al"); await u.fill("#wk-lr .wk-row:last-child [name=lname]", "العربية"); await u.selectOption("#wk-lr .wk-row:last-child [name=llevel]", "native");
  await u.click("#wk-ak"); await u.fill("#wk-kr .wk-row:last-child [name=klabel]", "GitHub"); await u.fill("#wk-kr .wk-row:last-child [name=kurl]", "https://github.com/sara");
  await u.click("#wk-lf [type=submit]"); await textHas(u, /GitHub/);
  await textHas(u, /اكتمال ملفك 100٪/);
  assert.ok((await minTap(u, ".wk-sec .btn, .wk-acts .btn, .wk-ia .btn")) >= 44, "44px targets");
  assert.deepEqual(await axe(u), []);
  // privacy: links followers-only, profile members
  await u.locator("#wk-pv details summary").click(); await u.selectOption("#wk-pv [name=s_links]", "followers"); await u.selectOption("#wk-pv [name=visibility]", "members");
  rl(); await tap(u, "#wk-pv [type=submit]"); await u.waitForTimeout(400);
  const row = await S.app.ctx.db.get("SELECT p.visibility, p.sections FROM pro_profiles p JOIN users u ON u.id=p.user_id WHERE u.handle='p76_sara'");
  assert.equal(row.visibility, "members"); assert.match(JSON.stringify(row.sections), /followers/);
  await dark(u); await go(u, "#/cv"); await until(u, () => !!document.querySelector(".wk-done")); await u.waitForTimeout(300);
  assert.deepEqual(await axe(u), [], "editor dark"); await shot(u, "editor-360-dark");
  // preview as a stranger → locked
  await go(u, "#/cv/p76_sara?as=stranger"); await textHas(u, /سجّل الدخول لعرض/); assert.deepEqual(await axe(u), []);
  await go(u, "#/cv/p76_sara?as=member"); await textHas(u, /معاينة/); await textHas(u, /الخبرات/);
  assert.equal(await u.locator('a[href="https://github.com/sara"]').count(), 0, "links hidden from members");
  assert.deepEqual(await axe(u), [], "preview dark"); await shot(u, "preview-member-360-dark");
  // printable CV page (owner)
  const cv = await uctx.newPage(); const resp = await cv.goto(S.base + "/cv/p76_sara"); assert.equal(resp.status(), 200);
  assert.match(await cv.content(), /مطوّرة واجهات أمامية/); assert.deepEqual(await axe(cv), [], "cv page"); await cv.emulateMedia({ media: "print" }); await shot(cv, "cv-print-360"); await cv.close();
});

test("staff: profile badge, member view, talent directory + filters, report, moderation; dark axe; studio chunk; CSP hygiene", async () => {
  rl();
  await go(p, "#/u/p76_sara"); await until(p, () => !!document.querySelector('a[href="#/cv/p76_sara"]'));
  await tap(p, 'a[href="#/cv/p76_sara"]'); await until(p, () => !!document.querySelector(".wk-hero")); await textHas(p, /الخبرات/);
  assert.equal(await p.locator('a[href="https://github.com/sara"]').count(), 1, "staff sees everything");
  assert.ok((await minTap(p, ".wk-acts .btn")) >= 44); assert.deepEqual(await axe(p), []); await shot(p, "profile-390-light");
  await go(p, "#/talent"); await until(p, () => !!document.querySelector(".wk-card")); await textHas(p, /سارة المطوّرة/);
  assert.deepEqual(await axe(p), []);
  await tap(p, ".fx-open"); await until(p, () => !document.querySelector(".fx-sheet").classList.contains("hidden"));
  await p.fill(".fx-sheet [name=skill]", "react"); await p.click('.fx-sheet [data-fx="ok"]');
  await until(p, () => /skill=react/.test(location.hash)); await until(p, () => document.querySelectorAll(".wk-card").length === 1);
  await shot(p, "talent-390-light");
  await go(p, "#/talent?skill=cobol"); await textHas(p, /لا نتائج مطابقة/);
  // a member reports → staff moderation
  rl(); const r = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "مبلّغ", handle: "p76_rep", password: "secret123" }) });
  const ck = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const rep = await fetch(S.base + "/api/pro/u/p76_sara/report", { method: "POST", headers: { ...H(), Cookie: ck }, body: JSON.stringify({ reason: "fake", note: "شهادة غير صحيحة" }) }); assert.equal(rep.status, 200);
  await go(p, "#/admin/pro"); await until(p, () => !!document.querySelector('[data-mod="hide"]')); assert.deepEqual(await axe(p), []);
  await tap(p, '[data-mod="hide"]'); await until(p, () => !!document.querySelector('[data-mod="restore"]'));
  assert.ok(await S.app.ctx.db.get("SELECT 1 x FROM notifications WHERE kind='pro_hidden'"));
  await shot(p, "admin-390-light");
  await tap(p, '[data-mod="restore"]'); await until(p, () => !document.querySelector('[data-mod="restore"]'));
  for (const hash of ["#/talent", "#/cv/p76_sara", "#/admin/pro"]) { await dark(p); await go(p, hash); await p.waitForTimeout(500); assert.deepEqual(await axe(p), [], hash + " dark"); }
  await u.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await go(u, "#/talent"); await u.waitForTimeout(500); await dark(u); await u.waitForTimeout(700); /* v2.54: let colour transitions finish before axe (was 200 ms → mid-transition contrast flake) */ assert.deepEqual(await axe(u), [], "talent dark 360"); await shot(u, "talent-360-dark");
  // studio stats from the post menu (lazy creation chunk)
  rl(); const post = await p.evaluate(async () => (await Remote.api("POST", "/api/posts", { type: "post", text: "منشور لاختبار الإحصائيات" })).post.id);
  await go(p, "#/post/" + post); await until(p, (id) => !!document.querySelector(`[data-more="${id}"]`), post); await p.waitForTimeout(300);
  await p.click(`[data-more="${post}"]`); await until(p, () => !!document.querySelector("#sheet [data-stats]")); await p.click("#sheet [data-stats]");
  await until(p, () => !!document.querySelector("#sheet .kpi-card")); assert.equal(await p.evaluate(() => !!window.MPStudio), true);
  assert.deepEqual(errors, []);
  const inline = await u.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .wk-page"))).map((e) => e.outerHTML.slice(0, 160)));
  assert.deepEqual(inline, []);
  for (const f of ["work-ui.js", "creation-ui.js"]) { const src = fs.readFileSync(path.join(__dirname, "../..", f), "utf8"); assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../..", "work-ui.js"), "utf8"), /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /data-chunk="work"/);
});
