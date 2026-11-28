/* v2.163 legacy MJT switches — e2e against the REAL server (production build), phone viewports with a Pi Browser user agent.
 * Admin (first account, 390 light) opens #/admin/mjt-economy: «مفاتيح المسارات القديمة» lists every legacy path ON by default
 * next to its ledger numbers; a reason under 5 characters is refused in the page (nothing written); pausing «التحويل بين الأعضاء»
 * with a reason stores the switch + an mjt_audit row with the admin id. A member (360) then sees the wallet send button disabled
 * with «… متوقف مؤقتاً» and the API answers 409 mjt_legacy_disabled; turning the path back on re-enables the button. No page
 * errors; axe: no serious/critical WCAG A/AA issues; RTL; tap targets ≥ 44 px; no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
let S, actx, p, uctx, u, uid, aid, ck; const errors = [];
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
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-legacy-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const stored = async () => JSON.parse((await S.app.ctx.db.get("SELECT value FROM mjt_settings WHERE key='legacy'"))?.value || "{}");
const lgRow = (pg, key) => pg.evaluate((k) => { const f = document.querySelector(`.ec-lg[data-k="${k}"]`); return f ? { on: f.dataset.on, btn: f.querySelector("button").textContent.trim() } : null; }, key);

test.before(async () => {
  S = await startStack();
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
  actx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "lg_admin", "مدير المسارات");
  aid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='lg_admin'")).id;
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "ليلى", handle: "lg_layla", password: "secret123" }) });
  assert.equal(reg.status, 200); uid = (await reg.json()).user.id;
  ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  // a little real legacy data: the member mined 5 MJT once (legacy ledger kind 'mining')
  const L = S.app.ctx.services.mjt.ledger;
  await S.app.ctx.db.tx(async (t) => { await L.lock(t, ["user:" + uid, "sys:mint"]); await L.post(t, { ikey: "e2e-lg-mine-1", kind: "mining", userId: uid, refType: "mining", lines: [{ account: "sys:mint", amount: -5e7 }, { account: "user:" + uid, amount: 5e7 }] }); });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("v2.167: the legacy switches and their admin API are gone; a stale stored «off» value is ignored — every path is ON", async () => {
  rl(); assert.equal(await p.evaluate(async () => (await fetch("/api/admin/mjt/legacy", { headers: { "X-Requested-With": "mujtama" }, credentials: "include" })).status), 404);
  rl(); assert.equal(await p.evaluate(async () => (await fetch("/api/admin/mjt/legacy/transfers", { method: "PUT", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ enabled: false, reason: "e2e إيقاف" }), credentials: "include" })).status), 404);
  // a value an admin stored before v2.167 must not pause anything any more
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('legacy',$1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$3", [JSON.stringify({ transfers: false, mining: false, checkin: false }), aid, new Date().toISOString()]);
  const LG = S.app.ctx.services.mjtLegacy; LG.invalidate();
  for (const k of LG.KEYS) assert.equal(await LG.isOn(k), true, k);
  assert.equal(await LG.isOn("buy"), false, "buying MJT with Pi stays unavailable");
  assert.equal(Object.keys(await stored()).length, 3, "the member data / old row is kept, never deleted");
});

test("member (360): wallet send button enabled; the API never answers mjt_legacy_disabled", async () => {
  rl(); await go(u, "#/mjt?tab=send"); await until(u, () => !!document.querySelector("#mj-sf"));
  assert.equal(await u.evaluate(() => document.querySelector('#mj-sf button[type="submit"]').disabled), false, "send enabled");
  assert.doesNotMatch(await u.textContent("#view"), /متوقف مؤقتاً/);
  rl(); const r = await u.evaluate(async () => { const x = await fetch("/api/mjt/transfers", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ to: "lg_admin", amount: "1", ikey: "e2elegacy0001" }) }); return { s: x.status, b: await x.json() }; });
  assert.notEqual(r.b.code, "mjt_legacy_disabled", JSON.stringify(r));
  assert.deepEqual(await axe(u), []);
  assert.ok((await minTap(u, "#mj-sf input, #mj-sf .btn")) >= 44, "tap targets");
  const html = await u.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i, "CSP-safe markup");
  await shot(u, "member-360-send");
  assert.deepEqual(errors, []);
});
