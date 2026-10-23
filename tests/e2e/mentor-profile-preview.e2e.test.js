/* مسار الإرشاد M2-5 «مصمم معاينة واكتمال الملف» — #/mentoring?tab=profile:
 * • completeness meter: percentage + checklist of missing items (photo, weekly slots here) — CSS only, role=progressbar.
 * • «معاينة كما يراه»: visitor / member / mentee / guardian picker rendered from GET /api/mentor/me/preview (server rules):
 *   a mentees-only city is absent for the visitor and present for the mentee; qualifications off → absent for everyone;
 *   page set to members → the visitor preview says the page is not visible.
 * • 390 light AR + 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, no Arabic UI text left in EN. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, cm, pm; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(350); };
const pick = async (pg, as) => { await pg.click(`#mt-pv .mt-pv-seg [data-as=${as}]`); await pg.waitForFunction((a) => { const b = document.querySelector("#mt-pv-b"); return b && b.dataset.as === a && !b.querySelector(".skel"); }, as, { timeout: 10000 }); };
const pressedOnlyOnButtons = (pg) => pg.evaluate(() => [...document.querySelectorAll("#mt-pv [aria-pressed]")].every((e) => e.tagName === "BUTTON"));
const axeAfterSwitch = async (pg, label) => {
  for (const as of ["member", "mentee", "guardian"]) {
    await pick(pg, as);
    assert.ok(await pressedOnlyOnButtons(pg), `aria-pressed only on segment buttons (${label} ${as})`);
    assert.equal(await pg.getAttribute("#mt-pv-b", "aria-pressed"), null, `preview box has no aria-pressed (${label} ${as})`);
    assert.deepEqual(await axe(pg), [], `axe ${label} after switching to ${as}`);
  }
};
const arabicLeft = (pg) => pg.evaluate(() => {
  const out = [], AR = /[\u0600-\u06FF]/;
  for (const root of document.querySelectorAll("#mt-cm, #mt-pv")) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.mt-tags,.mt-topics,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  }
  return out;
});
const EXTRA = { approach: "جلسات عملية بخطة أسبوعية.", city: "جدة", years: 7, skills: ["JavaScript", "Node.js"], experience: [{ title: "مطوّرة واجهات", org: "شركة", from: 2018, to: null }], qualifications: [{ name: "بكالوريوس علوم الحاسب", issuer: "جامعة", year: 2014, link: null }] };

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pm.on("pageerror", (e) => errors.push(e.message));
  await onboard(pm, S.base, "m25_mentor", "سارة المرشدة");
  assert.ok((await call(pm, "POST", "/api/age", { birthDate: "1990-06-15" })).status < 300);
  const r = await call(pm, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة سبع سنوات", bio: "أساعدك في أول مشروع ويب.", topics: ["programming"], minutes: 45, price: 0, tz: "Asia/Riyadh", open: true, extra: EXTRA, fields: { city: "mentees", qualifications: "off" } });
  assert.ok(r.status < 300, JSON.stringify(r.j));
});
test.after(async () => { await cm?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("completeness meter: 5 of 7 → 71%, missing photo + weekly slots", async () => {
  await go(pm, "#/mentoring?tab=profile", "#mt-cm");
  assert.equal(await pm.getAttribute("#mt-cm .mt-cm-pct", "data-pct"), "71");
  assert.equal(await pm.getAttribute("#mt-cm [role=progressbar]", "aria-valuenow"), "71");
  assert.deepEqual(await pm.$$eval("#mt-cm [data-miss]", (l) => l.map((x) => x.dataset.miss)), ["photo", "slots"]);
  assert.ok(await pm.$eval("#mt-cm .mt-cm-bar i", (i) => i.getBoundingClientRect().width > 0), "bar filled by CSS");
});

test("preview switch: visitor vs mentee vs guardian follow the server field rules", async () => {
  await pm.waitForSelector("#mt-pv-b .mt-hero", { timeout: 10000 });
  assert.equal(await pm.getAttribute("#mt-pv .mt-pv-seg [data-as=visitor]", "aria-pressed"), "true");
  assert.equal(await pm.$("#mt-pv-b #mt-city"), null, "mentees-only city hidden for visitor");
  assert.equal(await pm.$("#mt-pv-b #mt-qual"), null, "qualifications off");
  assert.equal(await pm.$("#mt-pv-b #mt-age"), null, "age off by default");
  assert.match(await pm.textContent("#mt-pv-b #mt-approach"), /خطة أسبوعية/);
  assert.deepEqual(await axe(pm), [], "axe 390 light ar");
  assert.ok(await noOverflow(pm), "no overflow at 390");
  await shot(pm, "390-light-ar-editor-preview");
  await pick(pm, "mentee");
  assert.equal(await pm.getAttribute("#mt-pv .mt-pv-seg [data-as=mentee]", "aria-pressed"), "true");
  assert.equal(await pm.getAttribute("#mt-pv .mt-pv-seg [data-as=visitor]", "aria-pressed"), "false");
  assert.match(await pm.textContent("#mt-pv-b #mt-city"), /جدة/, "mentee sees the city");
  assert.equal(await pm.$("#mt-pv-b #mt-qual"), null);
  assert.ok(await pm.$("#mt-pv-ct.ok"), "mentee can contact");
  await pick(pm, "guardian");
  assert.equal(await pm.$("#mt-pv-b #mt-city"), null, "guardian is not a mentee for field levels");
  const raw = await call(pm, "GET", "/api/mentor/me/preview?as=mentee");
  assert.ok(!JSON.stringify(raw.j).includes("1990"), "birth date never sent");
});

test("390 light AR: axe 0 after switching to «عضو», «متعلّمي», «وليّ أمر»", async () => {
  await axeAfterSwitch(pm, "390 light ar");
  await pick(pm, "visitor");
});

test("page visible to members only → visitor preview says not visible; member sees it", async () => {
  assert.ok((await call(pm, "PUT", "/api/mentor/me", { visibility: "members" })).status < 300);
  await go(pm, "#/mentoring?tab=profile", "#mt-pv-b .notice, #mt-pv-b .mt-hero");
  await pm.waitForSelector("#mt-pv-hidden", { timeout: 10000 });
  await pick(pm, "member");
  assert.ok(await pm.$("#mt-pv-b .mt-hero"));
  await pick(pm, "visitor");
  assert.ok(await pm.$("#mt-pv-hidden"));
});

test("1440 dark EN (LTR): axe 0, no overflow, translated", async () => {
  await pm.setViewportSize({ width: 1440, height: 900 }); await pm.emulateMedia({ colorScheme: "dark" });
  await pm.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await pm.evaluate(() => window.MPI18n.setLang("en")); await pm.waitForFunction(() => document.documentElement.dir === "ltr");
  await pm.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  assert.ok((await call(pm, "PUT", "/api/mentor/me", { visibility: "public" })).status < 300);
  await go(pm, "#/mentoring?tab=profile", "#mt-cm"); await pm.waitForSelector("#mt-pv-b .mt-hero", { timeout: 10000 }); await pm.waitForTimeout(300);
  assert.match(await pm.textContent("#mt-cm-h"), /Profile completeness/);
  assert.match(await pm.textContent("#mt-pv-h"), /Preview as/);
  assert.deepEqual(await axe(pm), [], "axe 1440 dark en");
  assert.ok(await noOverflow(pm));
  assert.deepEqual(await arabicLeft(pm), [], "no Arabic UI text left in en");
  await shot(pm, "1440-dark-en-editor-preview");
  await pick(pm, "mentee"); await pm.waitForTimeout(250);
  assert.deepEqual(await arabicLeft(pm), [], "no Arabic UI text left in en (mentee)");
  await axeAfterSwitch(pm, "1440 dark en");
});
