/* v2.161 «خدمات MJT» e2e against the REAL server (production build), mobile viewports with a Pi Browser user agent.
 * Admin (first account, 390 light) opens #/admin/mjt-services: the seeded service is disabled with no cost; sets a cost + term
 * and enables it. A Free member (360 dark) reaches #/mjt/services from #/rewards, sees balance + the no-monetary-value line,
 * opens the confirmation sheet (name, what you get, cost, current balance, balance after), confirms → success, «خدماتي» shows
 * the expiry, the history lists the purchase, the rewards wallet history shows it too; a stale price is re-confirmed; offline
 * state. Lazy (rides the `mjt` chunk); no page errors; axe: no serious/critical WCAG A/AA issues; tap targets ≥ 44 px; RTL;
 * no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
let S, actx, p, uctx, u, uid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
const sheetHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#sheet")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output");
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-services-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const bal = async () => Number((await S.app.ctx.db.get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0);

test.before(async () => {
  S = await startStack();
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
  actx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "sv_admin", "مدير الخدمات");
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "ريم الصانعة", handle: "sv_reem", password: "secret123" }) });
  assert.equal(reg.status, 200); uid = (await reg.json()).user.id;
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  await S.app.ctx.services.mjtRewards.ready; await S.app.ctx.services.mjtServices.ready;
  await S.app.ctx.services.mjtRewards.credit(uid, { amount: 9 * 1e7, source: "admin", reason: "e2e funding", ikey: "e2e_fund_sv_reem" });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("admin: #/admin/mjt-services — seeded disabled with no cost; set cost + 30-day term, enable; refund policy shown", async () => {
  rl(); await go(p, "#/admin/mjt-services"); await until(p, () => !!document.querySelector('.sv-f[data-id="svc_studio_extended"]'));
  assert.equal(await p.evaluate(() => { const f = document.querySelector(".sv-f"); return !f.elements.enabled.checked && f.elements.cost.value === "" && f.elements.term.value === ""; }), true, "ships off, no cost, no term");
  await textHas(p, /سياسة الاسترداد/); await textHas(p, /ليس له قيمة نقدية/);
  await p.evaluate(() => { const f = document.querySelector(".sv-f"); f.elements.cost.value = "4"; f.elements.term.value = "days"; f.elements.durationDays.value = "30"; f.elements.enabled.checked = true; });
  rl(); await p.locator('.sv-f button.btn:not([data-pur]):not([data-det])').click(); await p.waitForTimeout(700);
  const s = await S.app.ctx.db.get("SELECT cost, term, duration_days, enabled, price_version FROM mjt_services WHERE id='svc_studio_extended'");
  assert.equal(Number(s.enabled), 1); assert.equal(Number(s.cost), 4 * 1e7); assert.equal(s.term, "days"); assert.equal(Number(s.duration_days), 30); assert.equal(Number(s.price_version), 2);
  assert.deepEqual(await axe(p), []);
  assert.ok((await minTap(p, "#view .btn")) >= 44, "tap targets");
  await shot(p, "admin-390-light");
});

test("member: #/rewards → خدمات MJT; confirmation sheet with cost / balance / balance after; success; my services; history; wallet history", async () => {
  rl(); await go(u, "#/rewards"); await until(u, () => !!document.querySelector('#view a[href="#/mjt/services"]'));
  assert.equal(await u.evaluate(() => !!window.MPMjtServices), true, "rides the mjt chunk loaded with #/rewards");
  await u.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  rl(); await u.locator('#view a.btn[href="#/mjt/services"]').click(); await until(u, () => !!document.querySelector("[data-buy]"));
  assert.equal(await u.evaluate(() => document.querySelector("#sv-bal bdi").textContent), "9");
  assert.equal(await u.evaluate(() => getComputedStyle(document.querySelector("#view .wrap")).direction), "rtl");
  await textHas(u, /ليس له قيمة نقدية/); await textHas(u, /تحليلات الاستوديو الممتدة/);
  assert.deepEqual(await axe(u), []);
  assert.ok((await minTap(u, "#view .btn")) >= 44, "tap targets");
  await shot(u, "list-360-dark");
  await u.locator("[data-buy]").click(); await until(u, () => !!document.querySelector("#sv-go"));
  await sheetHas(u, /تحليلات الاستوديو الممتدة/); await sheetHas(u, /رصيدك الحالي/); await sheetHas(u, /رصيدك بعد العملية/);
  assert.deepEqual(await u.evaluate(() => [...document.querySelectorAll(".sv-conf dd bdi")].map((x) => x.textContent)), ["4", "9", "5"], "cost · balance · balance after");
  assert.equal(await bal(), 9 * 1e7, "nothing debited before confirming");
  await shot(u, "confirm-360-dark");
  rl(); await u.locator("#sv-go").click(); await sheetHas(u, /تمت العملية بنجاح/);
  assert.equal(await bal(), 5 * 1e7);
  await u.locator("#sv-x2").click();
  await until(u, () => /لديك وصول|تملك هذه الخدمة/.test(document.querySelector("#view")?.textContent || ""));
  rl(); await go(u, "#/mjt/services?tab=mine"); await textHas(u, /فعّالة/); await textHas(u, /حتى/);
  rl(); await go(u, "#/mjt/services?tab=history"); await textHas(u, /مكتملة/);
  rl(); await go(u, "#/rewards?tab=history"); await textHas(u, /خدمة MJT/);
  rl(); const st = await u.evaluate(async () => (await fetch("/api/studio/overview?days=180", { headers: { "X-Requested-With": "mujtama" } })).status); assert.equal(st, 200, "unlocked server-side");
});

test("stale price: the sheet re-reads the server price and asks again (nothing debited); offline state; CSP-safe markup", async () => {
  // a new member who has not bought yet; admin changes the price while the sheet is open
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "خالد", handle: "sv_khalid", password: "secret123" }) });
  const kid = (await reg.json()).user.id, ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  await S.app.ctx.services.mjtRewards.credit(kid, { amount: 20 * 1e7, source: "admin", reason: "e2e funding", ikey: "e2e_fund_sv_khalid" });
  const kctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await kctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  const k = await kctx.newPage(); k.on("pageerror", (e) => errors.push("khalid: " + e.message)); await tourDone(S.base, ck);
  await k.goto(S.base + "/?nosw#/home"); await k.waitForTimeout(800); await k.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  rl(); await go(k, "#/mjt/services"); await until(k, () => !!document.querySelector("[data-buy]"));
  await k.locator("[data-buy]").click(); await until(k, () => !!document.querySelector("#sv-go"));
  await S.app.ctx.services.mjtServices.edit({ id: (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='sv_admin'")).id }, "svc_studio_extended", { cost: 6 });
  rl(); await k.locator("#sv-go").click(); await sheetHas(k, /تغيّرت تكلفة الخدمة/);
  assert.equal(await k.evaluate(() => document.querySelector(".sv-conf dd bdi").textContent !== undefined && [...document.querySelectorAll(".sv-conf dd bdi")][0].textContent), "6", "sheet shows the new server price");
  const kb = Number((await S.app.ctx.db.get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + kid])).balance); assert.equal(kb, 20 * 1e7, "nothing debited on a stale price");
  rl(); await k.locator("#sv-go").click(); await sheetHas(k, /تمت العملية بنجاح/);
  assert.equal(Number((await S.app.ctx.db.get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + kid])).balance), 14 * 1e7);
  await k.evaluate(() => closeSheet());
  await kctx.setOffline(true); await go(k, "#/home"); rl(); await go(k, "#/mjt/services");
  await until(k, () => /غير متصل|تعذّر/.test(document.querySelector("#view")?.textContent || "")); await kctx.setOffline(false);
  const html = await k.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i, "CSP-safe markup");
  await kctx.close();
  assert.deepEqual(errors, []);
});
