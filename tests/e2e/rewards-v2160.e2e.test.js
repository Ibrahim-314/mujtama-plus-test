/* v2.160 «محفظة المكافآت» e2e against the REAL server (production build), mobile viewports. Admin (first account, 390
 * light) enables one reward source from #/admin/rewards; a member (360 dark) earns it through a real achievement (course
 * completion event → reward), opens Settings → «المدفوعات والمحفظة» → «محفظة المكافآت»: balance / earned / spent, the
 * no-monetary-value line, history with source + status, «قيد المراجعة», offline state. Lazy (rides the `mjt` chunk); no page
 * errors; axe: no serious/critical WCAG A/AA issues; tap targets ≥ 44 px; no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u, uid; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output");
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `rewards-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);

test.before(async () => {
  S = await startStack();
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "rw_admin", "مدير المكافآت");
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة المتعلمة", handle: "rw_sara", password: "secret123" }) });
  assert.equal(reg.status, 200); uid = (await reg.json()).user.id;
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  await S.app.ctx.services.mjtRewards.ready;
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("admin: #/admin/rewards shows stats + sources (all off, no amount); enable «إكمال دورة» with an amount", async () => {
  rl(); await go(p, "#/admin/rewards"); await until(p, () => !!document.querySelector('.rw-src[data-key="course_completed"]'));
  assert.equal(await p.evaluate(() => [...document.querySelectorAll(".rw-src")].every((f) => !f.elements.enabled.checked && f.elements.amount.value === "")), true, "everything ships off with no amount");
  await textHas(p, /ليس له قيمة نقدية/);
  await p.evaluate(() => { const f = document.querySelector('.rw-src[data-key="course_completed"]'); f.elements.amount.value = "6"; f.elements.enabled.checked = true; });
  rl(); await p.locator('.rw-src[data-key="course_completed"] button.btn:not([data-del])').click();
  await until(p, async () => true); await p.waitForTimeout(600);
  const src = await S.app.ctx.db.get("SELECT amount, enabled FROM mjt_reward_sources WHERE key='course_completed'");
  assert.equal(Number(src.enabled), 1); assert.equal(Number(src.amount), 6 * 1e7);
  assert.deepEqual(await axe(p), []);
  assert.ok((await minTap(p, "#view .btn")) >= 44, "tap targets");
  await shot(p, "admin-390-light");
});

test("member: real achievement → reward; v2.164: #/rewards opens the one wallet page #/mjt (balance, note, history, review tab); offline state", async () => {
  await S.app.ctx.services.achievements.record(uid, "course_completed", "course-e2e");
  await S.app.ctx.services.mjtRewards.settle();
  rl(); await go(u, "#/settings?s=money"); await until(u, () => !!document.querySelector('#view a[href="#/mjt"]'));
  assert.equal(await u.evaluate(() => !!document.querySelector('#view a[href="#/rewards"]')), false, "no second wallet row in settings");
  assert.equal(await u.evaluate(() => !!window.MPRewards), false, "lazy: not loaded before the route opens");
  await u.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  rl(); await go(u, "#/rewards"); await until(u, () => location.hash === "#/mjt" && !!document.querySelector(".mj-big"));
  assert.equal(await u.evaluate(() => document.querySelector(".mj-big bdi").textContent), "6");
  await textHas(u, /بلا قيمة نقدية/);
  assert.deepEqual(await axe(u), []);
  await shot(u, "wallet-360-dark");
  rl(); await go(u, "#/rewards?tab=history"); await until(u, () => location.hash === "#/mjt?tab=history" && !!document.querySelector("#mj-hl .li"));
  rl(); await go(u, "#/rewards?tab=review"); await until(u, () => location.hash === "#/mjt?tab=review"); await textHas(u, /لا شيء قيد المراجعة/);
  await uctx.setOffline(true); await go(u, "#/home"); rl(); await go(u, "#/mjt");
  await textHas(u, /غير متصل|تعذّر/); await uctx.setOffline(false);
  const html = await u.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i, "CSP-safe markup");
  assert.deepEqual(errors, []);
});
