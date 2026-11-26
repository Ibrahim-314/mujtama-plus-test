/* v2.166 MJT phase 8.3 «السمعة 2» — e2e against the REAL server (production build), phone viewport (390, Pi Browser UA).
 * Switch OFF (default): the member profile shows the old «السمعة» chip and no level card, #/reputation is the usual not-found
 * page. #/admin/mjt-reputation: switch shows OFF; saving needs a reason and turns it on. Then the profile shows the level card
 * (name · number, level x of 8, progress) and #/reputation lists the 8 levels with «قريباً» perks; an admin penalty lowers the
 * number and shows in the history; members get 403 on the admin APIs. No page errors; axe: no serious/critical WCAG A/AA
 * issues; tap targets ≥ 44 px; no inline handlers / styles. */
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
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = "#/home"; setTimeout(() => { location.hash = h; }, 30); }, hash); await pg.waitForTimeout(250); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output");
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `reputation-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const call = (pg, mth, u, b) => pg.evaluate(async ([mth, u, b]) => { try { return await Remote.api(mth, u, b); } catch (e) { return { error: e.message, status: e.status }; } }, [mth, u, b]);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "rp_admin", "مدير السمعة"); // first account → admin
  await p.evaluate(() => { try { DB.onboarded = true; } catch { } });
  ctx2 = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  m = await ctx2.newPage(); m.on("pageerror", (e) => errors.push(e.message));
  await onboard(m, S.base, "rp_member", "عضو السمعة");
  await m.evaluate(() => { try { DB.onboarded = true; } catch { } });
  const db = S.app.ctx.db, u = await db.get("SELECT id FROM users WHERE handle='rp_member'"), at = new Date().toISOString();
  await db.run("INSERT INTO user_reputation(user_id,score,breakdown,computed_at) VALUES($1,120,$2,$3) ON CONFLICT (user_id) DO UPDATE SET score=120", [u.id, JSON.stringify({ penalties: 0 }), at]);
  await db.run("UPDATE users SET reputation=120 WHERE id=$1", [u.id]);
  await db.run("INSERT INTO points_balances(user_id,total,redeemable,redeemed,level,optout,updated_at) VALUES($1,100,100,0,1,0,$2) ON CONFLICT (user_id) DO UPDATE SET total=100", [u.id, at]);
});
test.after(async () => { await ctx?.close(); await ctx2?.close(); await S?.close(); });

test("switch OFF: profile unchanged (old chip, no level card) and #/reputation is the not-found page", async () => {
  rl(); await go(m, "#/u/rp_member"); await until(m, () => !!document.querySelector("#rep"));
  assert.match(await m.textContent("#rep"), /120/); assert.match(await m.textContent("#rep"), /السمعة/);
  assert.equal(await m.evaluate(() => !!document.querySelector("#rep-lvl")), false);
  rl(); await go(m, "#/reputation"); await textHas(m, /الصفحة غير موجودة/);
  rl(); assert.equal((await call(m, "GET", "/api/rep-levels")).enabled, false);
  rl(); assert.equal((await call(m, "GET", "/api/admin/reputation")).status, 403);
  rl(); assert.equal((await call(m, "POST", "/api/admin/reputation/penalties", { handle: "rp_admin", amount: 10, reason: "محاولة عضو" })).status, 403);
});

test("#/admin/mjt-reputation: OFF by default; saving with a reason turns it on", async () => {
  rl(); await go(p, "#/admin/mjt-reputation"); await textHas(p, /السمعة الموحّدة والمستويات/);
  assert.equal(await p.evaluate(() => document.querySelector('#rp-f [name="enabled"]').checked), false);
  assert.match(await p.textContent("#view"), /قدوة المجتمع/);
  assert.ok((await minTap(p, "#rp-f input, #rp-f .btn, #rp-p input, #rp-p select, .mj-seg a")) >= 44, "tap targets");
  assert.deepEqual(await axe(p), [], "admin"); await shot(p, "admin-390");
  await p.check('#rp-f [name="enabled"]'); await p.fill('#rp-f [name="reason"]', "تشغيل السمعة الموحدة للاختبار");
  rl(); await p.click("#rp-f button.btn"); await until(p, () => document.querySelector('#rp-f [name="enabled"]')?.checked === true);
});

test("switch ON: profile level card + #/reputation levels; an admin penalty lowers the number and is listed", async () => {
  await m.reload(); await m.waitForTimeout(1500); await m.evaluate(() => { try { DB.onboarded = true; } catch { } });
  rl(); await go(m, "#/u/rp_member"); await until(m, () => !!document.querySelector("#rep-lvl"));
  const card = await m.textContent("#rep-lvl"); assert.match(card, /مساهم/); assert.match(card, /170/); assert.match(card, /المستوى 3 من 8/);
  rl(); await go(m, "#/reputation"); await textHas(m, /المستويات الثمانية/);
  const t = await m.textContent("#view"); for (const re of [/مبتدئ/, /مشارك/, /مساهم/, /نشِط/, /موثوق/, /خبير/, /مرشد/, /قدوة المجتمع/, /قريباً/, /170/]) assert.match(t, re);
  assert.deepEqual(await axe(m), [], "reputation"); await shot(m, "levels-390");
  rl(); await go(p, "#/admin/mjt-reputation"); await textHas(p, /تطبيق عقوبة/);
  await p.fill('#rp-p [name="handle"]', "rp_member"); await p.selectOption('#rp-p [name="kind"]', "warning"); await p.fill('#rp-p [name="reason"]', "إنذار رسمي بسبب مخالفة");
  rl(); await p.click("#rp-p button.btn"); await textHas(p, /@rp_member · −25/);
  rl(); assert.equal((await call(m, "GET", "/api/rep-levels")).me.score, 145);
  // CSP hygiene
  const html = await p.evaluate(() => document.querySelector("#view").innerHTML); assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i);
  const src = fs.readFileSync(path.join(__dirname, "../..", "reputation-ui.js"), "utf8"); assert.doesNotMatch(src, /\son(click|input|change|submit)=|["'`]javascript:|style="/);
  rl(); await call(p, "PUT", "/api/admin/reputation", { enabled: false, reason: "إيقاف بعد الاختبار" });
  assert.deepEqual(errors, []);
});
