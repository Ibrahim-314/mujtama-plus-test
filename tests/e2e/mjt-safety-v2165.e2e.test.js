/* v2.165 MJT phase 8.1 «محرك آمن» — e2e against the REAL server (production build), phone viewport (390, Pi Browser UA).
 * #/admin/mjt-safety: every switch shows OFF by default, the 13 earn sources with suggested values and «موصول»; saving needs a
 * reason and turns the identity checks on. A member transfer from a brand-new account is then held (nothing deducted) and shows
 * in the member's «قيد المراجعة»; #/admin/mjt-review lists it with the member's signals and approving sends it once. Members
 * get 403 on the admin APIs; «كيف أكسب» shows no new source while they are off. No page errors; axe: no serious/critical WCAG
 * A/AA issues; tap targets ≥ 44 px; no inline handlers / styles. */
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

test("#/admin/mjt-safety: every switch OFF by default, sources listed as wired; members get 403", async () => {
  rl(); await go(p, "#/admin/mjt-safety"); await textHas(p, /ضوابط الهوية والحسابات المرتبطة/);
  assert.equal(await p.evaluate(() => document.querySelector('#sf-f [name="i_enabled"]').checked), false);
  assert.equal(await p.evaluate(() => document.querySelector('#sf-f [name="c_enabled"]').checked), false);
  assert.equal(await p.evaluate(() => document.querySelector('#sf-f [name="c_daily"]').value), "50");
  const t = await p.textContent("#view");
  for (const re of [/السقوف الشاملة للكسب/, /إجابة مقبولة/, /مكافأة النشاط اليومي/, /أسبوع نشِط/, /موصول/]) assert.match(t, re);
  assert.ok((await minTap(p, "#sf-f input, #sf-f .btn, .mj-seg a")) >= 44, "tap targets");
  assert.deepEqual(await axe(p), [], "safety"); await shot(p, "settings-390");
  rl(); assert.equal((await call(m, "GET", "/api/admin/mjt/safety")).status, 403);
  rl(); assert.equal((await call(m, "GET", "/api/admin/mjt/review")).status, 403);
});

test("identity ON → a new account's transfer is held, shows under review, and the admin queue approves it once", async () => {
  rl(); await call(p, "POST", "/api/admin/mjt/adjust", { handle: "sf_member", amount: "30", reason: "رصيد اختبار الحماية", ikey: "e2e-sf-fund-1" });
  rl(); await go(p, "#/admin/mjt-safety"); await textHas(p, /ضوابط الهوية والحسابات المرتبطة/);
  await p.check('#sf-f [name="i_enabled"]'); await p.fill('#sf-f [name="reason"]', "تشغيل ضوابط الهوية للاختبار");
  rl(); await p.click('#sf-f button.btn'); await until(p, () => document.querySelector('#sf-f [name="i_enabled"]')?.checked === true);
  rl(); const before = Number((await call(m, "GET", "/api/mjt/me")).balance.mjt); assert.ok(before >= 30);
  rl(); const r = await call(m, "POST", "/api/mjt/transfers", { to: "sf_payee", amount: "10", ikey: "e2e-sf-x-1" });
  assert.equal(r.pending, true, JSON.stringify(r)); assert.equal(Number(r.balance.mjt), before, "nothing deducted");
  rl(); await go(m, "#/mjt?tab=review"); await textHas(m, /تحويل قيد المراجعة/);
  rl(); await go(p, "#/admin/mjt-review"); await textHas(p, /@sf_member ← @sf_payee/);
  assert.match(await p.textContent("#view"), /عمر الحساب أقل من الحد/);
  assert.deepEqual(await axe(p), [], "review"); await shot(p, "review-390");
  rl(); await p.click("[data-ok]"); await textHas(p, /لا شيء بانتظار المراجعة/);
  rl(); assert.equal(Number((await call(m, "GET", "/api/mjt/me")).balance.mjt), before - 10, "sent once on approval");
  // switch it off again: the next transfer goes through at once (v2.164 behaviour)
  rl(); await call(p, "PUT", "/api/admin/mjt/safety", { identity: { enabled: false }, reason: "إيقاف بعد الاختبار" });
  rl(); const r2 = await call(m, "POST", "/api/mjt/transfers", { to: "sf_payee", amount: "5", ikey: "e2e-sf-x-2" }); assert.ok(r2.transfer && !r2.pending);
});

test("members see no change: «كيف أكسب» lists no new source while they are off; CSP hygiene; no page errors", async () => {
  rl(); await go(m, "#/mjt/earn"); await textHas(m, /مكافآت المساهمات المفيدة/);
  assert.doesNotMatch(await m.textContent("#view"), /مكافأة النشاط اليومي|أسبوع نشِط|منشور مفيد/);
  const html = await p.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i);
  const src = fs.readFileSync(path.join(__dirname, "../..", "mjt-safety-ui.js"), "utf8"); assert.doesNotMatch(src, /\son(click|input|change|submit)=|["'`]javascript:|style="/);
  assert.deepEqual(errors, []);
});
