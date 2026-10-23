/* v2.62 mentorship M3 «مطوّر واجهة ملف المرشد» — full mentor profile page #/mentor/:handle + the editor in #/mentoring?tab=profile.
 * • A member sees approach, skills (chips), experience, qualifications (https link), years, city (public) and the photo fallback
 *   letter; age is ABSENT (field level off by default) in the API and in the page.
 * • The mentor turns age public and qualifications off in the editor → the member then sees the age and no qualifications.
 * • 390 light AR and 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, no Arabic UI text left in EN.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
const H = "m3ui_mentor";
let S, cm, cv, pm, pv; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(350); };
const arabicLeft = (pg) => pg.evaluate(() => {
  const root = document.querySelector(".wrap.mt-page"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.mt-tags,.mt-topics,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  return out;
});
const EXTRA = {
  approach: "جلسات عملية: نحدد هدفاً واحداً ونخرج بخطة أسبوعية.",
  city: "جدة", years: 7, skills: ["JavaScript", "تصميم الواجهات", "Node.js"],
  experience: [{ title: "مطوّرة واجهات أولى", org: "شركة تقنية", from: 2018, to: null }, { title: "مطوّرة ويب", org: "استوديو", from: 2015, to: 2018 }],
  qualifications: [{ name: "بكالوريوس علوم الحاسب", issuer: "جامعة الملك عبدالعزيز", year: 2014, link: "https://example.com/cert" }]
};

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cv = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pv = await cv.newPage();
  for (const pg of [pm, pv]) pg.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, H, "سارة المرشدة");
  assert.ok((await call(pm, "POST", "/api/age", { birthDate: "1990-06-15" })).status < 300, "birth date declared");
  const r = await call(pm, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة سبع سنوات", bio: "أساعدك في أول مشروع ويب.", topics: ["programming", "career"], languages: "العربية، English", minutes: 45, price: 0, tz: "Asia/Riyadh", allowMinors: false, open: true, extra: EXTRA, fields: { city: "public" } });
  assert.ok(r.status < 300, "profile saved " + JSON.stringify(r.j));
  await onboard(pv, S.base, "m3ui_member", "عضو");
});
test.after(async () => { await cm?.close(); await cv?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("member sees the full profile; age is absent while hidden (API + page)", async () => {
  const api = await call(pv, "GET", "/api/mentors/" + H);
  assert.equal(api.status, 200);
  assert.ok(!("age" in api.j.mentor), "age not in payload");
  assert.ok(!JSON.stringify(api.j).includes("1990"), "birth date never sent");
  await go(pv, "#/mentor/" + H, ".mt-hero");
  assert.match(await pv.textContent(".mt-hero .mt-name"), /سارة المرشدة/);
  assert.equal((await pv.textContent(".mt-hero .mt-av")).trim(), "س", "photo fallback = initial letter");
  assert.match(await pv.textContent("#mt-city"), /جدة/);
  assert.match(await pv.textContent("#mt-years"), /7/);
  assert.equal(await pv.$("#mt-age"), null, "no age on the page");
  assert.match(await pv.textContent("#mt-approach"), /خطة أسبوعية/);
  assert.equal((await pv.$$("#mt-skills .chip")).length, 3);
  assert.equal((await pv.$$("#mt-exp li")).length, 2);
  assert.match(await pv.textContent("#mt-exp"), /حتى الآن/);
  assert.equal(await pv.getAttribute("#mt-qual a", "href"), "https://example.com/cert");
  assert.match(await pv.getAttribute("#mt-qual a", "rel"), /noopener/);
  assert.deepEqual(await axe(pv), [], "axe 390 light ar");
  assert.ok(await noOverflow(pv), "no overflow at 390");
  await shot(pv, "390-light-ar-profile");
});

test("editor: page visibility + per-field levels + full fields; age public / qualifications off reach the member", async () => {
  await go(pm, "#/mentoring?tab=profile", "#mt-pfm #mt-vis");
  assert.equal(await pm.inputValue("#mt-pfm [name=city]"), "جدة");
  assert.equal(await pm.inputValue("#mt-pfm [name=visibility]"), "public");
  assert.equal(await pm.inputValue("#mt-pfm [name=lvl_age]"), "off");
  assert.equal((await pm.$$("#mt-pfm [data-row=exp]")).length, 2);
  assert.deepEqual(await axe(pm), [], "axe editor 390");
  assert.ok(await noOverflow(pm), "editor no overflow at 390");
  await shot(pm, "390-light-ar-editor");
  await pm.click("[data-radd=exp]");
  assert.equal((await pm.$$("#mt-pfm [data-row=exp]")).length, 3, "row added");
  await pm.click("#mt-pfm [data-row=exp]:last-child [data-rx]");
  assert.equal((await pm.$$("#mt-pfm [data-row=exp]")).length, 2, "empty row removed");
  await pm.selectOption("#mt-pfm [name=lvl_age]", "public");
  await pm.selectOption("#mt-pfm [name=lvl_qualifications]", "off");
  await pm.fill("#mt-pfm [name=skills]", "JavaScript، تصميم الواجهات، Node.js، الأداء");
  const [res] = await Promise.all([pm.waitForResponse((r) => r.url().endsWith("/api/mentor/me") && r.request().method() === "PUT"), pm.click("#mt-pfm button[type=submit]")]);
  assert.equal(res.status(), 200, "saved");
  const me = await call(pm, "GET", "/api/mentor/me");
  assert.equal(me.j.profile.fields.age, "public"); assert.equal(me.j.profile.fields.qualifications, "off");
  assert.equal(me.j.profile.extra.skills.length, 4); assert.equal(me.j.profile.extra.experience.length, 2); assert.equal(me.j.profile.visibility, "public");
  await go(pv, "#/mentor/" + H, ".mt-hero");
  assert.match(await pv.textContent("#mt-age"), /\d+/);
  assert.equal(await pv.$("#mt-qual"), null, "qualifications hidden");
  assert.equal((await pv.$$("#mt-skills .chip")).length, 4);
});

test("1440 dark EN (LTR): axe 0, no overflow, translated UI", async () => {
  for (const pg of [pv, pm]) {
    await pg.setViewportSize({ width: 1440, height: 900 });
    await pg.emulateMedia({ colorScheme: "dark" });
    await pg.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
    await pg.evaluate(() => window.MPI18n.setLang("en")); await pg.waitForFunction(() => document.documentElement.dir === "ltr");
    await pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  }
  await go(pv, "#/mentor/" + H, ".mt-hero"); await pv.waitForTimeout(300);
  assert.deepEqual(await axe(pv), [], "axe profile dark en");
  assert.ok(await noOverflow(pv));
  assert.deepEqual(await arabicLeft(pv), [], "no Arabic UI text in en (profile)");
  assert.match(await pv.textContent("#mt-skills"), /Skills/);
  assert.match(await pv.textContent("#mt-age"), /years old/);
  await shot(pv, "1440-dark-en-profile");
  await go(pm, "#/mentoring?tab=profile", "#mt-pfm #mt-vis"); await pm.waitForTimeout(300);
  assert.deepEqual(await axe(pm), [], "axe editor dark en");
  assert.ok(await noOverflow(pm));
  assert.deepEqual(await arabicLeft(pm), [], "no Arabic UI text in en (editor)");
  await shot(pm, "1440-dark-en-editor");
});
