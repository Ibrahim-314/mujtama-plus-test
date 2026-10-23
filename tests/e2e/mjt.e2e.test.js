/* global Remote */
/* v2.47 MJT «مجتمع كوين» e2e against the REAL server (production build), mobile viewports: staff (first account, 390 light)
 * and a member (360 dark). Both earned contribution points before the MJT launch. Staff opens Settings → «المدفوعات والمحفظة»
 * → «مجتمع كوين», then #/admin/mjt: ledger check, dry run, apply the conversion. The member sees the converted balance with
 * the in-app-only label, the conversion note, how to earn, sends MJT to staff (decimal string, confirm), sees it in the
 * history; Pi purchase is shown as unavailable; the points page links to the wallet and no longer offers Pi redemption.
 * axe: no serious/critical WCAG A/AA issues (light + dark); tap targets ≥ 44 px; lazy `mjt` chunk; no page errors; no inline
 * handlers / styles / javascript: URLs. Screenshots → tests/visual/output/mjt-*. */
process.env.MJT_AUTO_CONVERT = "0"; // the test applies the conversion from the admin screen
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

let S, actx, p, uctx, u; const errors = [];
const H = () => ({ "Content-Type": "application/json", "X-Requested-With": "mujtama", Origin: S.base });
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const tap = async (pg, sel) => { await pg.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: "center" })); await pg.click(sel); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output"); // SHOTS_DIR: private output dir for parallel runs
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const dark = (pg) => pg.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));

test.before(async () => {
  S = await startStack();
  actx = await S.browser.newContext({ ...MOBILE, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("staff: " + e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "mjt_admin", "نورة المشرفة"); // first account → admin
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "خالد المساهم", handle: "mjt_khaled", password: "secret123" }) });
  assert.equal(reg.status, 200);
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message)); u.on("dialog", (d) => d.accept());
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  const db = S.app.ctx.db, old = new Date(Date.now() - 60 * 864e5).toISOString();
  await db.run("UPDATE users SET created_at=$1 WHERE handle IN ('mjt_admin','mjt_khaled')", [old]);
  await S.app.ctx.services.mjt.ready;
  // contribution points earned before the MJT launch
  const ids = Object.fromEntries((await db.all("SELECT id, handle FROM users WHERE handle IN ('mjt_admin','mjt_khaled')")).map((r) => [r.handle, r.id]));
  const at = new Date(Date.now() - 20 * 864e5).toISOString();
  let k = 0; for (const [h, kind, pts] of [["mjt_khaled", "answer_accepted", 15], ["mjt_khaled", "mentoring", 20], ["mjt_khaled", "wiki_edit", 4], ["mjt_admin", "report_confirmed", 5]])
    await db.run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES($1,$2,$3,$4,$5,1,'active',$6,NULL,$7)", ["pa_e2e" + ++k, ids[h], kind, "src_e2e" + k, pts, at.slice(0, 10), at]);
  for (const id of Object.values(ids)) await S.app.ctx.services.points.recompute(id);
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("staff: settings entry → #/admin/mjt → ledger check, dry run, apply conversion", async () => {
  rl(); await go(p, "#/settings?s=money"); await until(p, () => !!document.querySelector('#view .set-sec a[href="#/mjt"]'));
  assert.equal(await p.evaluate(() => !!window.MPMjt), false, "lazy chunk not loaded yet");
  rl(); await go(p, "#/admin/mjt"); await until(p, () => !!document.querySelector("#mj-dry"));
  assert.equal(await p.evaluate(() => !!window.MPMjt && !!window.MPFeat), true, "mjt chunk loads after feat");
  await textHas(p, /متوازن/);
  rl(); await tap(p, "#mj-dry"); await until(p, () => /سيُحوَّل 2 عضو: 44 نقطة/.test(document.querySelector("#mj-dr")?.textContent || ""));
  assert.ok((await minTap(p, "#mj-a .btn")) >= 44, "44px buttons");
  assert.deepEqual(await axe(p), [], "admin light"); await shot(p, "admin-390-light");
  rl(); await tap(p, "#mj-apply"); await until(p, () => !!document.querySelector("[data-rb]"));
  await textHas(p, /مطبّق/);
});

test("member: converted balance, in-app label, earn rules, send with confirm, history (360 dark)", async () => {
  rl(); await go(u, "#/mjt"); await dark(u); await until(u, () => !!document.querySelector(".mj-big"));
  assert.match(await u.textContent(".mj-big"), /39/); await textHas(u, /ليس عملة على أي بلوكشين/); await textHas(u, /حوّلنا 39 نقطة مساهمة/);
  assert.match(await u.textContent("#mj-buy-n"), /غير مفعّلة/);
  assert.ok((await minTap(u, ".mj-hero .btn, .mj-seg a")) >= 44);
  assert.deepEqual(await axe(u), [], "wallet dark"); await shot(u, "wallet-360-dark");
  rl(); await tap(u, '.mj-seg a[href="#/mjt?tab=earn"]'); await until(u, () => !!document.querySelector(".mj-kinds"));
  await textHas(u, /1 نقطة مساهمة = 1 MJT/); assert.deepEqual(await axe(u), [], "earn dark"); await shot(u, "earn-360-dark");
  rl(); await tap(u, '.mj-seg a[href="#/mjt?tab=send"]'); await until(u, () => !!document.querySelector("#mj-sf"));
  // validation is accessible and local
  await tap(u, "#mj-sf [type=submit]"); await until(u, () => !document.querySelector("#mj-err").hidden);
  await u.fill("#mj-sf [name=to]", "@mjt_admin"); await u.fill("#mj-sf [name=amount]", "2.5"); await u.fill("#mj-sf [name=note]", "شكراً على المراجعة");
  assert.ok((await minTap(u, "#mj-sf input, #mj-sf .btn")) >= 44);
  assert.deepEqual(await axe(u), [], "send dark"); await shot(u, "send-360-dark");
  rl(); await tap(u, "#mj-sf [type=submit]"); await until(u, () => location.hash === "#/mjt?tab=history");
  await until(u, () => /تحويل مُرسَل/.test(document.querySelector("#mj-hl")?.textContent || ""));
  assert.match(await u.textContent(".mj-big"), /36\.5/);
  assert.equal(await u.evaluate(() => !!document.querySelector("#mj-more")), false, "no «المزيد» when everything fits");
  assert.deepEqual(await axe(u), [], "history dark"); await shot(u, "history-360-dark");
});

test("staff wallet (390 light), points page links to MJT, Pi redemption gone, CSP hygiene", async () => {
  rl(); await go(p, "#/mjt"); await until(p, () => !!document.querySelector("#mj-hl"));
  assert.match(await p.textContent(".mj-big"), /7\.5/); // 5 converted + 2.5 received
  await textHas(p, /تحويل مُستلَم/); await textHas(p, /شكراً على المراجعة/);
  assert.deepEqual(await axe(p), [], "wallet light"); await shot(p, "wallet-390-light");
  rl(); await go(p, "#/points"); await until(p, () => !!document.querySelector(".pt-mjt"));
  assert.equal(await p.evaluate(() => !!document.querySelector("#pt-rf")), false, "no Pi redemption form while MJT is linked");
  assert.ok((await minTap(p, ".pt-mjt")) >= 44);
  rl(); const r = await p.evaluate(async () => { try { await Remote.api("POST", "/api/mjt/buy", {}); return "ok"; } catch (e) { return e.message; } }); assert.match(r, /Pi/);
  assert.deepEqual(errors, []);
  for (const pg of [p, u]) {
    const inline = await pg.evaluate(() => [...document.querySelectorAll("*")].filter((e) => [...e.attributes].some((a) => /^on/.test(a.name)) || (!!e.getAttribute("style") && !!e.closest("#view .mj-page"))).map((e) => e.outerHTML.slice(0, 160)));
    assert.deepEqual(inline, []);
  }
  const src = fs.readFileSync(path.join(__dirname, "../..", "mjt-ui.js"), "utf8");
  assert.doesNotMatch(src, /\son(click|input|change|submit)=/); assert.doesNotMatch(src, /["'`]javascript:/); assert.doesNotMatch(src, /style="/);
  assert.match(fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8"), /mjt-ui\.js" data-chunk="mjt"/);
});
