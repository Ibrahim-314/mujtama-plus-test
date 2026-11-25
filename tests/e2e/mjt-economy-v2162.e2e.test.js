/* v2.162 «اقتصاد MJT» e2e against the REAL server (production build), phone viewports with a Pi Browser user agent.
 * Admin (first account, 390 light) opens #/admin/mjt-economy from #/admin/rewards: lazy `mjteco` chunk; new and legacy
 * issuance shown apart; total balances shown as their own figure; hand-drawn SVG chart (no chart library); classes table with
 * the legacy row marked; issuance control (manual pause of a phase-4 source through the page); alerts all off by default;
 * thresholds saved; simulation labelled «افتراضي» and nothing written; period switch; CSV links. A member (360 dark) gets
 * «للإدارة فقط» and 403 from the API. No page errors; axe: no serious/critical WCAG A/AA issues; tap targets ≥ 44 px; RTL;
 * no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, tourDone, MOBILE } = require("./harness");

const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
let S, actx, p, uctx, u, uid, aid; const errors = [];
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
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-economy-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const count = async (t) => Number((await S.app.ctx.db.get(`SELECT COUNT(*) n FROM ${t}`)).n);

test.before(async () => {
  S = await startStack();
  await S.app.ctx.db.run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('mining',$1,'e2e',$2) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=$2", [JSON.stringify({ checkinOn: false }), new Date().toISOString()]);
  actx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await actx.newPage(); p.on("pageerror", (e) => errors.push("admin: " + e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "ec_admin", "مدير الاقتصاد");
  aid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='ec_admin'")).id;
  rl(); const reg = await fetch(S.base + "/api/auth/register", { method: "POST", headers: H(), body: JSON.stringify({ name: "سارة", handle: "ec_sara", password: "secret123" }) });
  assert.equal(reg.status, 200); uid = (await reg.json()).user.id;
  const ck = reg.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  uctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 360, height: 780 }, reducedMotion: "reduce" });
  const [n, ...val] = ck.split("="); await uctx.addCookies([{ name: n, value: val.join("="), url: S.base }]);
  u = await uctx.newPage(); u.on("pageerror", (e) => errors.push("member: " + e.message));
  await tourDone(S.base, ck);
  await u.goto(S.base + "/?nosw#/home"); await u.waitForTimeout(800); await u.evaluate(() => { try { DB.onboarded = true; window.save?.(); } catch { } });
  // real data: a phase-4 source pays 5 MJT (new issuance); a legacy mining credit of 5 MJT (the legacy ledger kind)
  const RW = S.app.ctx.services.mjtRewards; await RW.ready;
  await RW.saveSource({ id: aid }, "quiz_passed", { amount: 5, enabled: true });
  await RW.onAchievement({ user: uid, type: "quiz_passed", ref: "e2e_q1" });
  const L = S.app.ctx.services.mjt.ledger;
  await S.app.ctx.db.tx(async (t) => { await L.lock(t, ["user:" + uid, "sys:mint"]); await L.post(t, { ikey: "e2e-mine-1", kind: "mining", userId: uid, refType: "mining", lines: [{ account: "sys:mint", amount: -5e7 }, { account: "user:" + uid, amount: 5e7 }] }); });
});
test.after(async () => { await uctx?.close(); await actx?.close(); await S?.close(); });

test("admin: #/admin/mjt-economy — lazy chunk, new vs legacy apart, balances apart, SVG chart, classes, alerts off, a11y", async () => {
  rl(); await go(p, "#/admin/rewards"); await until(p, () => !!document.querySelector('#view a[href="#/admin/mjt-economy"]'));
  rl(); await p.locator('#view a[href="#/admin/mjt-economy"]').first().click();
  await until(p, () => !!document.querySelector("#ec-b .ec-kpi"));
  assert.equal(await p.evaluate(() => !!window.MPMjtEconomy && !!document.querySelector('script[data-chunk="mjteco"]')), true, "its own lazy chunk");
  await textHas(p, /الإصدار الجديد منذ البداية/); await textHas(p, /الإصدار القديم منذ البداية/); await textHas(p, /مجموع الأرصدة الحالية/); await textHas(p, /رقم مستقل لا يُجمع مع الإصدار/);
  await textHas(p, /ليس له قيمة نقدية/); await textHas(p, /آخر 30 يوماً/);
  const kpi = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ec-kpi > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent.trim()])));
  assert.equal(kpi["الإصدار الجديد منذ البداية"], "5"); assert.equal(kpi["الإصدار القديم منذ البداية"], "5"); assert.equal(kpi["مجموع الأرصدة الحالية"], "10");
  assert.equal(await p.evaluate(() => document.querySelectorAll(".ec-fig svg rect").length > 0), true, "hand-drawn SVG bars");
  assert.equal(await p.evaluate(() => /إصدار قديم/.test(document.querySelector("#view").textContent) && !!document.querySelector(".ec-t .sbadge.warn")), true, "legacy row marked");
  assert.equal(await p.evaluate(() => [...document.querySelectorAll(".ec-al .sbadge")].every((b) => !b.classList.contains("bad"))), true, "no alert triggered by default");
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector("#view .wrap")).direction), "rtl");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, "no horizontal page overflow at 390");
  assert.deepEqual(await axe(p), []);
  assert.ok((await minTap(p, "#view .btn")) >= 44, "tap targets");
  const html = await p.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i, "CSP-safe markup");
  await shot(p, "admin-390-light");
});

test("admin: manual pause of a phase-4 source; thresholds saved; simulation «افتراضي» writes nothing; period switch; CSV", async () => {
  rl(); await p.locator('.ec-src[data-key="quiz_passed"] [data-st="0"]').click();
  await until(p, () => !!document.querySelector('.ec-src[data-key="quiz_passed"] [data-st="1"]'));
  assert.equal(Number((await S.app.ctx.db.get("SELECT enabled FROM mjt_reward_sources WHERE key='quiz_passed'")).enabled), 0, "paused via the existing enable flag");
  await p.evaluate(() => { document.querySelector(".ec-thr").open = true; document.querySelector("#ec-thr").elements.correctionsMaxCount.value = "3"; });
  rl(); await p.locator("#ec-thr button.btn:not(.ghost)").click(); await p.waitForTimeout(700);
  assert.equal(JSON.parse((await S.app.ctx.db.get("SELECT value FROM mjt_settings WHERE key='economy'")).value).alerts.correctionsMaxCount, 3);
  const before = await Promise.all(["mjt_settings", "mjt_audit", "mjt_tx", "mjt_reward_sources"].map(count));
  const setBefore = (await S.app.ctx.db.get("SELECT value FROM mjt_settings WHERE key='economy'")).value;
  await until(p, () => !!document.querySelector("#ec-sim"));
  await p.evaluate(() => { const f = document.querySelector("#ec-sim"); f.elements.memberGrowthPct.value = "10"; f.elements.months.value = "3"; });
  rl(); await p.locator("#ec-sim button").click(); await until(p, () => /افتراضي/.test(document.querySelector("#ec-simr")?.textContent || ""));
  assert.equal(await p.evaluate(() => document.querySelectorAll("#ec-simr tbody tr").length), 3);
  assert.deepEqual(await Promise.all(["mjt_settings", "mjt_audit", "mjt_tx", "mjt_reward_sources"].map(count)), before, "simulation writes nothing");
  assert.equal((await S.app.ctx.db.get("SELECT value FROM mjt_settings WHERE key='economy'")).value, setBefore);
  await shot(p, "simulation-390-light");
  rl(); await p.locator('.ec-seg a[href$="period=week"]').click(); await until(p, () => document.querySelector('.ec-seg a[aria-current="page"]')?.getAttribute("href")?.endsWith("week") && !!document.querySelector("#ec-b .ec-kpi"));
  const links = await p.evaluate(() => [...document.querySelectorAll(".ec-csv a")].map((a) => a.getAttribute("href")));
  assert.equal(links.length, 10); assert.ok(links.every((h) => /period=week/.test(h)));
  rl(); const st = await p.evaluate(async (h) => (await fetch(h, { headers: { "X-Requested-With": "mujtama" } })).status, links[1]); assert.equal(st, 200);
});

test("member (360 dark): «للإدارة فقط» and 403 from the API; no page errors", async () => {
  await u.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  rl(); await go(u, "#/admin/mjt-economy"); await textHas(u, /للإدارة فقط/);
  rl(); assert.equal(await u.evaluate(async () => (await fetch("/api/admin/mjt/economy", { headers: { "X-Requested-With": "mujtama" } })).status), 403);
  await shot(u, "member-360-dark");
  assert.deepEqual(errors, []);
});
