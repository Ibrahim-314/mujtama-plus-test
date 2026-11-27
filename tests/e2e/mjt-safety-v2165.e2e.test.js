/* v2.165 MJT phase 8.1 «محرك آمن» → v2.167: the identity checks and overall caps are ALWAYS ON with fixed values; the admin pages
 * #/admin/mjt-safety and #/admin/mjt-review were removed. e2e against the REAL server (production build), phone viewport (390, Pi
 * Browser UA): a member transfer from a brand-new account is held (nothing deducted) and shows in the member's «قيد المراجعة»; the
 * automatic rule sends it once after 72 h. «كيف أكسب» lists the approved sources. No page errors; axe: no serious/critical
 * WCAG A/AA issues; no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");

const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
let S, ctx, ctx2, p, m; const errors = [];
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output");
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-safety-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const call = (pg, mth, u, b) => pg.evaluate(async ([mth, u, b]) => { try { return await Remote.api(mth, u, b); } catch (e) { return { error: e.message, status: e.status }; } }, [mth, u, b]);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "sf_admin", "مدير الحماية"); // first account → admin
  await p.evaluate(() => { try { DB.onboarded = true; } catch { } });
  ctx2 = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  m = await ctx2.newPage(); m.on("pageerror", (e) => errors.push(e.message));
  await onboard(m, S.base, "sf_member", "عضو جديد");
  await m.evaluate(() => { try { DB.onboarded = true; } catch { } });
  // the recipient registers through the API (no browser device: two contexts on one machine share a device fingerprint, which the
  // v2.74 same-device rule refuses outright before any 8.1 check)
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base }, body: JSON.stringify({ name: "مستلم", handle: "sf_payee", password: "secret123" }) });
  assert.equal(reg.status, 200);
});
test.after(async () => { await ctx?.close(); await ctx2?.close(); await S?.close(); });

test("v2.167: the admin safety / review pages and APIs are gone", async () => {
  rl(); await go(p, "#/admin/mjt-safety"); await p.waitForTimeout(1200);
  assert.equal(await p.evaluate(() => !!document.querySelector("#sf-f")), false, "no switches page");
  rl(); assert.equal((await call(p, "GET", "/api/admin/mjt/safety")).status, 404);
  rl(); assert.equal((await call(m, "GET", "/api/admin/mjt/review")).status, 404);
});

test("identity always ON → a new account's transfer is held, shows under review, and the automatic rule sends it once after 72 h", async () => {
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='sf_member'")).id;
  await S.app.ctx.services.mjtRewards.credit(uid, { amount: 30 * 1e7, source: "admin", reason: "e2e funding", ikey: "e2e-sf-fund-1" });
  rl(); const before = Number((await call(m, "GET", "/api/mjt/me")).balance.mjt); assert.ok(before >= 30);
  rl(); const r = await call(m, "POST", "/api/mjt/transfers", { to: "sf_payee", amount: "10", ikey: "e2e-sf-x-1" });
  assert.equal(r.pending, true, JSON.stringify(r)); assert.equal(Number(r.balance.mjt), before, "nothing deducted");
  rl(); await go(m, "#/mjt?tab=review"); await textHas(m, /تحويل قيد المراجعة/);
  assert.deepEqual(await axe(m), [], "review tab"); await shot(m, "review-390");
  await S.app.ctx.services.autoRules.sweep({ now: new Date(Date.now() + 73 * 3600e3) });
  rl(); assert.equal(Number((await call(m, "GET", "/api/mjt/me")).balance.mjt), before - 10, "sent once by the automatic rule");
  await S.app.ctx.services.autoRules.sweep({ now: new Date(Date.now() + 80 * 3600e3) });
  rl(); assert.equal(Number((await call(m, "GET", "/api/mjt/me")).balance.mjt), before - 10, "never twice");
});

test("«كيف أكسب» lists the approved sources; CSP hygiene; no page errors", async () => {
  rl(); await go(m, "#/mjt/earn"); await textHas(m, /إجابة مقبولة/);
  assert.match(await m.textContent("#view"), /منشور مفيد/);
  const html = await m.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i);
  assert.deepEqual(errors, []);
});
