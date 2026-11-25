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

test("admin: legacy switches on the economy page — all ON by default next to their numbers; short reason refused; pause «transfers» with a reason (audited)", async () => {
  rl(); await go(p, "#/admin/mjt-economy"); await until(p, () => !!document.querySelector("#ech-lg"));
  await textHas(p, /مفاتيح المسارات القديمة/);
  const rows = await p.evaluate(() => [...document.querySelectorAll('[aria-labelledby="ech-lg"] tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent.trim())));
  assert.equal(rows.length, 9, "8 switches + buy");
  assert.ok(rows.slice(0, 8).every((r) => r[1].startsWith("يعمل")), "all ON by default: " + JSON.stringify(rows.map((r) => r[1])));
  assert.equal(rows[8][1], "غير متاح", "buy listed as not available");
  const mining = rows.find((r) => r[0] === "التعدين اليومي"); assert.equal(mining[3], "5", "mining numbers next to its switch");
  assert.equal(await stored().then((s) => Object.keys(s).length), 0, "nothing stored by default");
  await p.evaluate(() => { document.querySelector(".ec-lgd").open = true; });
  assert.deepEqual(await lgRow(p, "transfers"), { on: "0", btn: "إيقاف" });
  // a reason under 5 characters is refused in the page — nothing written
  await p.fill('.ec-lg[data-k="transfers"] input[name="reason"]', "قصير");
  rl(); await p.locator('.ec-lg[data-k="transfers"] button').click(); await p.waitForTimeout(400);
  assert.equal(await S.app.ctx.db.get("SELECT value FROM mjt_settings WHERE key='legacy'"), undefined);
  assert.deepEqual(await axe(p), []);
  assert.ok((await minTap(p, '[aria-labelledby="ech-lg"] .btn')) >= 44, "tap targets");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no horizontal page overflow at 390");
  const html = await p.evaluate(() => document.querySelector('[aria-labelledby="ech-lg"]').outerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i, "CSP-safe markup");
  await shot(p, "admin-390-default");
  // pause with a real reason
  await p.fill('.ec-lg[data-k="transfers"] input[name="reason"]', "مراجعة التحويلات بين الأعضاء");
  rl(); await p.locator('.ec-lg[data-k="transfers"] button').click();
  await until(p, () => document.querySelector('.ec-lg[data-k="transfers"]')?.dataset.on === "1");
  assert.equal((await stored()).transfers, false);
  const a = await S.app.ctx.db.get("SELECT actor_id, detail FROM mjt_audit WHERE action='legacy_switch' AND target='transfers' ORDER BY id DESC LIMIT 1");
  assert.equal(a.actor_id, aid); assert.match(JSON.parse(a.detail).reason, /مراجعة التحويلات/);
  const st = await p.evaluate(() => [...document.querySelectorAll('[aria-labelledby="ech-lg"] tbody tr')].find((tr) => tr.cells[0].textContent.trim() === "التحويل بين الأعضاء").cells[1].textContent.trim());
  assert.equal(st, "متوقف");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#view .wrap")).direction), "rtl");
  await shot(p, "admin-390-paused");
});

test("member (360): wallet send button disabled with «متوقف مؤقتاً»; API 409 mjt_legacy_disabled; back ON → enabled", async () => {
  rl(); await go(u, "#/mjt?tab=send"); await until(u, () => !!document.querySelector("#mj-sf"));
  assert.equal(await u.evaluate(() => document.querySelector('#mj-sf button[type="submit"]').disabled), true, "send disabled");
  await textHas(u, /التحويل بين الأعضاء» متوقف مؤقتاً/);
  rl(); const r = await u.evaluate(async () => { const x = await fetch("/api/mjt/transfers", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ to: "lg_admin", amount: "1", ikey: "e2elegacy0001" }) }); return { s: x.status, b: await x.json() }; });
  assert.equal(r.s, 409); assert.equal(r.b.code, "mjt_legacy_disabled"); assert.equal(r.b.path, "transfers"); assert.match(r.b.messageEn, /temporarily paused/);
  assert.deepEqual(await axe(u), []);
  await shot(u, "member-360-send-paused");
  // admin turns it back on from the page
  await p.evaluate(() => { document.querySelector(".ec-lgd").open = true; });
  await p.fill('.ec-lg[data-k="transfers"] input[name="reason"]', "انتهت المراجعة");
  rl(); await p.locator('.ec-lg[data-k="transfers"] button').click();
  await until(p, () => document.querySelector('.ec-lg[data-k="transfers"]')?.dataset.on === "0");
  assert.equal((await stored()).transfers, true);
  rl(); await go(u, "#/mjt?tab=history"); await go(u, "#/mjt?tab=send"); await until(u, () => !!document.querySelector("#mj-sf"));
  assert.equal(await u.evaluate(() => document.querySelector('#mj-sf button[type="submit"]').disabled), false, "send enabled again");
  assert.deepEqual(errors, []);
});
