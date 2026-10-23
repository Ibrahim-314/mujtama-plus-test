/* M4-5/F10 «مطوّر الردود الجاهزة» — mentor reply templates in a real browser.
 * • #/mentoring?tab=profile: add two templates, edit one, delete one (confirm), limits shown; saved via PUT /api/mentor/me.
 * • #/mentoring?tab=requests: the picker inserts the template text into the reply, the mentor edits it, accepts → the learner
 *   receives exactly the edited text; the public page never carries the templates.
 * • 390 light AR and 1440 dark EN (LTR): axe 0 serious/critical, no horizontal overflow, ≥44px targets, no Arabic UI text in EN.
 * Screenshots go to SHOTS_DIR when set. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
const H = "m4tpl_mentor";
let S, cm, cl, pm, pl; const errors = [];
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((v) => ["serious", "critical"].includes(v.impact)).map((v) => v.id + ":" + v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const call = (pg, m, u, b) => pg.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); let j = null; try { j = await r.json(); } catch { /* empty */ } return { status: r.status, j }; }, [m, u, b]);
const shot = async (pg, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const go = async (pg, h, sel) => { await pg.evaluate(() => { location.hash = "#/home"; }); await pg.waitForTimeout(120); await pg.evaluate((x) => { location.hash = x; }, h); await pg.waitForSelector(sel, { timeout: 15000 }); await pg.waitForTimeout(350); };
const small = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim() || e.tagName, h: r.height, w: r.width }; }).filter((x) => x.h < 44 || x.w < 44), sel);
const arabicLeft = (pg, root) => pg.evaluate((root) => {
  const out = [], AR = /[\u0600-\u06FF]/, w = document.createTreeWalker(document.querySelector(root), NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,[data-noi18n],textarea,select,.help-pop,.helpi")) continue; out.push(n.nodeValue.trim()); }
  return out;
}, root);
const putTpl = (pg) => pg.waitForResponse((r) => r.url().endsWith("/api/mentor/me") && r.request().method() === "PUT");

test.before(async () => {
  S = await startStack();
  cm = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  cl = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" });
  pm = await cm.newPage(); pl = await cl.newPage();
  for (const pg of [pm, pl]) pg.on("pageerror", (e) => errors.push(e.message));
  pm.on("dialog", (d) => d.accept());
  await onboard(pm, S.base, H, "سارة المرشدة");
  const r = await call(pm, "PUT", "/api/mentor/me", { headline: "مطوّرة ويب بخبرة سبع سنوات", topics: ["programming"], minutes: 45, price: 0, tz: "Asia/Riyadh", open: true });
  assert.ok(r.status < 300, "profile saved " + JSON.stringify(r.j));
  await onboard(pl, S.base, "m4tpl_learner", "متعلّم");
  const q = await call(pl, "POST", "/api/mentor/requests", { topic: "programming", goal: "أريد مساعدة في بناء أول موقع ويب لي", mentor: H });
  assert.ok(q.status < 300, "request sent " + JSON.stringify(q.j));
});
test.after(async () => { await cm?.close(); await cl?.close(); await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("profile tab: add, edit, delete templates; axe + 44px at 390 light", async () => {
  await go(pm, "#/mentoring?tab=profile", "#mt-tpl #mt-tpl-f");
  assert.match(await pm.textContent("#mt-tpl"), /لا ردود جاهزة بعد/);
  for (const [t, b] of [["ترحيب وحجز", "أهلاً بك! يسعدني مساعدتك، احجز موعداً من صفحتي."], ["اعتذار", "أعتذر، جدولي ممتلئ هذا الشهر."]]) {
    await pm.fill("#mt-tpl-f [name=title]", t); await pm.fill("#mt-tpl-f [name=body]", b);
    const [res] = await Promise.all([putTpl(pm), pm.click("#mt-tpl-f button[type=submit]")]); assert.equal(res.status(), 200);
    await pm.waitForFunction((t) => document.querySelector("#mt-tpl .mt-tpl-list")?.textContent.includes(t), t);
  }
  assert.equal((await pm.$$("#mt-tpl .mt-tpl-list li")).length, 2);
  assert.equal(await pm.getAttribute("#mt-tpl-f [name=title]", "maxlength"), "40");
  assert.equal(await pm.getAttribute("#mt-tpl-f [name=body]", "maxlength"), "500");
  await pm.click("#mt-tpl [data-tedit]:first-of-type");
  assert.equal(await pm.inputValue("#mt-tpl-f [name=title]"), "ترحيب وحجز");
  await pm.fill("#mt-tpl-f [name=body]", "أهلاً بك! يسعدني مساعدتك. اختر موعداً يناسبك من صفحتي.");
  await Promise.all([putTpl(pm), pm.click("#mt-tpl-f button[type=submit]")]);
  await pm.waitForFunction(() => document.querySelector("#mt-tpl .mt-tpl-list")?.textContent.includes("اختر موعداً"));
  await pm.click("#mt-tpl .mt-tpl-list li:nth-child(2) [data-tdel]");
  await pm.waitForFunction(() => document.querySelectorAll("#mt-tpl .mt-tpl-list li").length === 1);
  const me = await call(pm, "GET", "/api/mentor/me");
  assert.deepEqual(me.j.profile.extra.templates.map((t) => t.title), ["ترحيب وحجز"]);
  assert.match(me.j.profile.extra.templates[0].body, /اختر موعداً/);
  assert.deepEqual(await small(pm, "#mt-tpl button"), [], "44px targets");
  assert.deepEqual(await axe(pm), [], "axe 390 light ar");
  assert.ok(await noOverflow(pm), "no overflow at 390");
  await shot(pm, "390-light-ar-templates");
  const pub = await call(pl, "GET", "/api/mentors/" + H);
  assert.equal(pub.status, 200); assert.ok(!JSON.stringify(pub.j).includes("اختر موعداً"), "never on the public page");
});

test("requests tab: picker inserts the template, editable before send; learner receives the edited text", async () => {
  await go(pm, "#/mentoring?tab=requests", "form[data-r] select[name=tpl]");
  const sel = "form[data-r] select[name=tpl]", id = await pm.$eval(sel + " option:nth-child(2)", (o) => o.value);
  await pm.selectOption(sel, id);
  assert.match(await pm.inputValue("form[data-r] [name=reply]"), /اختر موعداً يناسبك/);
  assert.equal(await pm.evaluate(() => document.activeElement?.name), "reply", "focus moves to the reply");
  assert.deepEqual(await small(pm, "form[data-r] select, form[data-r] button"), [], "44px targets");
  assert.deepEqual(await axe(pm), [], "axe requests 390 light");
  assert.ok(await noOverflow(pm));
  await shot(pm, "390-light-ar-requests-picker");
  await pm.type("form[data-r] [name=reply]", " نلتقي الأحد.");
  const [res] = await Promise.all([pm.waitForResponse((r) => /\/api\/mentor\/requests\/[^/]+\/accept$/.test(r.url())), pm.click("form[data-r] button[value=accept]")]);
  assert.equal(res.status(), 200);
  const mine = await call(pl, "GET", "/api/mentor/requests");
  assert.match(mine.j.sent[0].reply, /اختر موعداً يناسبك من صفحتي\. نلتقي الأحد\.$/);
});

test("1440 dark EN (LTR): axe 0, no overflow, translated UI (manager + picker)", async () => {
  await call(pl, "POST", "/api/mentor/requests", { topic: "programming", goal: "طلب ثانٍ لمساعدة في التصميم والواجهات", mentor: H });
  await pm.setViewportSize({ width: 1440, height: 900 });
  await pm.emulateMedia({ colorScheme: "dark" });
  await pm.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await pm.evaluate(() => window.MPI18n.setLang("en")); await pm.waitForFunction(() => document.documentElement.dir === "ltr");
  await pm.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(pm, "#/mentoring?tab=profile", "#mt-tpl #mt-tpl-f"); await pm.waitForTimeout(300);
  assert.deepEqual(await axe(pm), [], "axe manager dark en");
  assert.ok(await noOverflow(pm));
  assert.deepEqual(await arabicLeft(pm, "#mt-tpl"), [], "no Arabic UI text in en (manager)");
  assert.match(await pm.textContent("#mt-tpl-h"), /Reply templates/);
  await shot(pm, "1440-dark-en-templates");
  await go(pm, "#/mentoring?tab=requests", "form[data-r] select[name=tpl]"); await pm.waitForTimeout(300);
  assert.deepEqual(await axe(pm), [], "axe picker dark en");
  assert.ok(await noOverflow(pm));
  assert.deepEqual(await arabicLeft(pm, "form[data-r]"), [], "no Arabic UI text in en (picker)");
  await shot(pm, "1440-dark-en-requests-picker");
});
