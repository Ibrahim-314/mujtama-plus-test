/* global Remote */
/* Phase 78 e2e (contracts, milestones & escrow) against the REAL server (production build), mobile viewport.
 * Client = staff (first account → admin, 390 light): sends a direct offer from #/contracts/new (two milestones: unpaid + 30 π),
 *   reviews deliveries (revision sheet, approve), sees the Pi-off notice on the paid milestone, creates a contract from an
 *   «offered» job application (prefilled form), resolves a dispute at #/admin/contracts (split).
 * Worker (new member, 360 dark): sees the offer in #/contracts, accepts, delivers through the sheet (note + link), resubmits
 *   after a revision, messages, opens a dispute on a funded milestone.
 * axe: no serious/critical WCAG A/AA issues on every new screen (light + dark); no page errors; lazy `work` chunk; no inline
 * handlers / styles / javascript: URLs; tap targets ≥ 44 px. Screenshots (390 light, 360 dark) → tests/visual/output/p78-*. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, cid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
const sheetHas = (pg, sel) => until(pg, (s) => !!document.querySelector("#sheet:not(.hidden) " + s), sel);
async function axe(pg) {
  // realtime notification toasts (translucent glass, fixed at the top) land at timing-dependent moments and can sit over the
  // KPI row; axe then blends their backdrop into the tile's background. Dismiss them the way a user would (✕) before auditing.
  await pg.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await pg.waitForFunction(() => !document.querySelector("#nf-toasts .nf-toast"), null, { timeout: 5000 }).catch(() => {});
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `p78-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
const light = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message));
  p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "p78_admin", "شركة نور"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المطوّرة", handle: "p78_sara", password: "secret123" }) });
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

test("client offers a contract; worker accepts, delivers, revises; client approves", async () => {
  await go(p, "#/settings?s=acct"); await until(p, () => !!document.querySelector('#view a[href="#/contracts"]'));
  rl(); await go(p, "#/contracts"); await textHas(p, /لا عقود جارية/); assert.deepEqual(await axe(p), [], "hub empty");
  await go(p, "#/contracts/new?to=p78_sara"); await until(p, () => !!document.querySelector("#wk-cform"));
  assert.equal(await p.inputValue("#wk-cform [name=to]"), "p78_sara");
  await p.fill("#wk-cform [name=title]", "تصميم هوية متجر قهوة"); await p.fill("#wk-cform [name=scope]", "تصميم شعار ودليل ألوان وخطوط لمتجر قهوة مختصة، مع ملفات مصدرية وتطبيقات على الأكواب والأكياس.");
  await p.selectOption("#wk-cform [name=rev]", "1");
  await p.fill("#wk-msl li:nth-child(1) [name=mt]", "مقترحات الشعار"); await p.fill("#wk-msl li:nth-child(1) [name=ma]", "0");
  await tap(p, "#wk-addms"); await p.fill("#wk-msl li:nth-child(2) [name=mt]", "الهوية الكاملة"); await p.fill("#wk-msl li:nth-child(2) [name=ma]", "30");
  await until(p, () => /30/.test(document.querySelector("#wk-total").textContent));
  assert.ok((await minTap(p, "#wk-cform .btn")) >= 44, "44px form buttons");
  assert.deepEqual(await axe(p), [], "new contract light"); await shot(p, "new-390-light");
  rl(); await tap(p, "#wk-cform [type=submit]"); await until(p, () => /^#\/contract\/[^/]+$/.test(location.hash)); await textHas(p, /بانتظار رد المنفّذ/);
  cid = await p.evaluate(() => location.hash.split("/")[2]);
  await textHas(p, /مدفوعات Pi غير مفعّلة/);
  assert.deepEqual(await axe(p), [], "offer client"); await shot(p, "offer-390-light");
  // worker accepts
  rl(); await go(u, "#/contracts"); await until(u, () => !!document.querySelector(".wk-ctl a.li")); await dark(u); await u.waitForTimeout(200);
  assert.deepEqual(await axe(u), [], "hub dark"); await shot(u, "hub-360-dark");
  await tap(u, ".wk-ctl a.li"); await until(u, () => !!document.querySelector('[data-resp="accept"]'));
  assert.deepEqual(await axe(u), [], "offer worker dark");
  rl(); await tap(u, '[data-resp="accept"]'); await until(u, () => !!document.querySelector('[data-ma="submit"]')); await textHas(u, /نشط/);
  await textHas(u, /تبدأ بعد أن يموّلها العميل بالضمان/);
  await tap(u, '[data-ma="submit"]'); await sheetHas(u, "#wk-mf"); assert.deepEqual(await axe(u), [], "submit sheet dark");
  await u.fill("#wk-mf [name=note]", "ثلاثة مقترحات للشعار مع شرح الفكرة لكل مقترح."); await u.fill("#wk-mf [name=l0]", "https://example.com/logos");
  rl(); await u.click("#wk-mf [type=submit]"); await until(u, () => !document.querySelector('[data-ma="submit"]')); await textHas(u, /سُلّمت للمراجعة/);
  assert.ok((await minTap(u, ".wk-ms .btn, #wk-cmf .btn")) >= 44, "44px milestone actions");
  await shot(u, "contract-worker-360-dark");
  // client asks for a revision, then approves
  rl(); await go(p, "#/contracts"); await go(p, "#/contract/" + cid); await until(p, () => !!document.querySelector('[data-ma="revision"]'));
  await tap(p, '[data-ma="revision"]'); await sheetHas(p, "#wk-mf"); await p.fill("#wk-mf [name=note]", "نفضّل ألواناً أدفأ في المقترح الثاني");
  rl(); await p.click("#wk-mf [type=submit]"); await textHas(p, /مطلوب تعديل/);
  rl(); await go(u, "#/contracts"); await go(u, "#/contract/" + cid); await until(u, () => !!document.querySelector('[data-ma="submit"]')); await textHas(u, /ألواناً أدفأ/);
  await tap(u, '[data-ma="submit"]'); await sheetHas(u, "#wk-mf"); await u.fill("#wk-mf [name=note]", "عدّلت الألوان في المقترح الثاني كما طلبتم.");
  rl(); await u.click("#wk-mf [type=submit]"); await textHas(u, /سُلّمت للمراجعة/);
  await u.fill("#wk-cmf [name=body]", "أرسل لي رأيك، وتقدر تحوّل المبلغ على واتساب لو أسهل"); rl(); await tap(u, "#wk-cmf [type=submit]"); await textHas(u, /واتساب/);
  rl(); await go(p, "#/contracts"); await go(p, "#/contract/" + cid); await until(p, () => !!document.querySelector('[data-ma="approve"]'));
  assert.equal(await p.locator('[data-ma="revision"]').count(), 0, "revision cap reached");
  await until(p, () => !!document.querySelector(".wk-tline .notice.warn"));
  rl(); await tap(p, '[data-ma="approve"]'); await textHas(p, /معتمدة/);
  assert.deepEqual(await axe(p), [], "contract client light"); await shot(p, "contract-client-390-light");
});

test("dispute on a funded milestone → staff split; contract from an offered application; CSP", async () => {
  // the paid milestone is funded (Pi is off in this stack: mark the escrow state directly)
  const m2 = await S.app.ctx.db.get("SELECT id FROM contract_milestones WHERE contract_id=$1 AND pos=1", [cid]);
  await S.app.ctx.db.run("UPDATE contract_milestones SET status='funded', funded_at=$1 WHERE id=$2", [new Date().toISOString(), m2.id]);
  rl(); await go(u, "#/contracts"); await go(u, "#/contract/" + cid); await until(u, () => !!document.querySelector('[data-ma="dispute"]'));
  await tap(u, '[data-ma="dispute"]'); await sheetHas(u, "#wk-mf"); assert.deepEqual(await axe(u), [], "dispute sheet dark");
  await u.selectOption("#wk-mf [name=reason]", "scope"); await u.fill("#wk-mf [name=body]", "يطلب العميل تطبيقات إضافية على اللافتات غير موجودة في الاتفاق.");
  rl(); await u.click("#wk-mf [type=submit]"); await textHas(u, /نزاع مفتوح/); await shot(u, "dispute-360-dark");
  rl(); await go(p, "#/admin/contracts"); await until(p, () => !!document.querySelector("[data-dsp]"));
  assert.deepEqual(await axe(p), [], "admin light"); await shot(p, "admin-390-light");
  await p.selectOption("[data-dsp] [name=outcome]", "split"); await p.fill("[data-dsp] [name=share]", "20"); await p.fill("[data-dsp] [name=note]", "التطبيقات الإضافية خارج النطاق؛ تقسيم عادل.");
  rl(); await tap(p, "[data-dsp] [type=submit]"); await until(p, () => /لا نزاعات مفتوحة/.test(document.querySelector("#wk-ac")?.textContent || ""));
  await dark(p); await p.waitForTimeout(200); assert.deepEqual(await axe(p), [], "admin dark"); await light(p);
  assert.equal((await S.app.ctx.db.get("SELECT status FROM contracts WHERE id=$1", [cid])).status, "completed");
  rl(); await go(u, "#/contracts?tab=closed"); await until(u, () => !!document.querySelector(".wk-ctl a.li")); await textHas(u, /مكتمل/);
  // from an «offered» job application → prefilled contract form
  rl(); const job = await p.evaluate(async () => (await Remote.api("POST", "/api/jobs", { kind: "freelance", title: "كتابة محتوى لمتجر", body: "نحتاج كتابة وصف ٣٠ منتجاً بأسلوب جذاب وواضح مع مراعاة تحسين محركات البحث وقواعد اللغة.", category: "writing", payType: "fixed", payMin: 20, payMax: 40 })).id);
  rl(); await u.evaluate(async () => Remote.api("PUT", "/api/pro/me", { headline: "مصمّمة هويات بصرية", visibility: "members" }));
  rl(); const app = await u.evaluate(async (j) => (await Remote.api("POST", `/api/jobs/${j}/apply`, { cover: "كتبت أوصاف منتجات لمتاجر عربية كثيرة وأستطيع التسليم خلال أسبوع.", bid: 35, days: 7 })).id, job);
  rl(); await p.evaluate(async (a) => Remote.api("POST", `/api/job-applications/${a}/status`, { status: "offered" }), app);
  await go(p, "#/jobs"); await go(p, "#/application/" + app); await until(p, (a) => !!document.querySelector(`a[href="#/contracts/new?app=${a}"]`), app);
  await tap(p, `a[href="#/contracts/new?app=${app}"]`); await until(p, () => !!document.querySelector("#wk-cform"));
  assert.equal(await p.inputValue("#wk-cform [name=title]"), "كتابة محتوى لمتجر"); assert.equal(await p.inputValue("#wk-msl [name=ma]"), "35");
  await textHas(p, /عرضه 35/); assert.deepEqual(await axe(p), [], "from application");
  assert.deepEqual(errors, []);
  const inline = await u.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .wk-page"))).map((e) => e.outerHTML.slice(0, 160)));
  assert.deepEqual(inline, []);
  const src = fs.readFileSync(path.join(__dirname, "../..", "work-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../chunks.js"), "utf8"), /work: \[[^\]]*"contracts"/);
});
