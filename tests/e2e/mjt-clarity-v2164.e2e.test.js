/* global MPMenu */
/* v2.164 MJT phase 8.0 «الوضوح» — e2e against the REAL server (production build), phone viewport (390, Pi Browser UA).
 * One wallet page: #/rewards and #/mjt?tab=earn redirect, no «شراء بـ Pi» entry, the services page links to the wallet instead
 * of repeating the balance. «كيف أكسب» (#/mjt/earn) lists only the paths the server reports as live — contribution rewards,
 * the daily sign-in reward, mining — and drops a path an admin pauses (no behaviour change, the page only reads).
 * «شروط مجتمع كوين» (#/mjt/terms) states the six terms. Menu rows; help «؟» on the new pages; English UI on the earn page.
 * No page errors; axe: no serious/critical WCAG A/AA issues; tap targets ≥ 44 px; no inline handlers / styles. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE } = require("./harness");

const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
let S, ctx, p; const errors = [];
const until = async (pg, fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });
const textHas = (pg, re, ms) => until(pg, (r) => new RegExp(r).test(document.querySelector("#view")?.textContent || ""), re.source, ms);
async function axe(pg) {
  await pg.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return pg.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const rl = () => S.app.ctx.rl.w.clear();
const go = async (pg, hash) => { await pg.evaluate((h) => { location.hash = h; }, hash); await pg.waitForTimeout(150); };
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "../visual/output");
const shot = async (pg, name) => { fs.mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, `mjt-clarity-${name}.png`), fullPage: true }); };
const minTap = (pg, sel) => pg.evaluate((s) => Math.min(...[...document.querySelectorAll(s)].filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height)), sel);
const call = (m, u, b) => p.evaluate(async ([m, u, b]) => { try { return await Remote.api(m, u, b); } catch (e) { return { error: e.message }; } }, [m, u, b]);

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await onboard(p, S.base, "cl_admin", "مدير الوضوح"); // first account → admin (also a member with a wallet)
  await p.evaluate(() => { try { DB.onboarded = true; } catch { } });
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("one wallet page: #/rewards and ?tab=earn redirect; no buy entry; services link instead of a second balance", async () => {
  rl(); await go(p, "#/rewards"); await until(p, () => location.hash === "#/mjt" && !!document.querySelector(".mj-big"));
  assert.equal(await p.evaluate(() => !!document.querySelector("#mj-buy, #mj-buy-n")), false, "no «شراء بـ Pi»");
  const txt = await p.textContent("#view");
  assert.doesNotMatch(txt, /شراء بـ Pi|التجريبية|مرحلة لاحقة|له قيمة/); assert.match(txt, /بلا قيمة نقدية/); assert.match(txt, /مكافآت المساهمات اليوم/);
  for (const h of ["#/mjt/earn", "#/mjt/services", "#/mjt/terms", "#/mjt?tab=review"]) assert.equal(await p.evaluate((x) => !!document.querySelector(`#view a[href="${x}"]`), h), true, h);
  assert.ok((await minTap(p, ".mj-links .btn, .mj-seg a, .mj-hero .btn")) >= 44, "tap targets");
  assert.deepEqual(await axe(p), [], "wallet"); await shot(p, "wallet-390");
  rl(); await go(p, "#/rewards?tab=review"); await until(p, () => location.hash === "#/mjt?tab=review"); await textHas(p, /لا شيء قيد المراجعة|تُضاف إلى رصيدك تلقائياً بعد 72 ساعة/); // v2.167: a new account's earn (daily sign-in) may be held by the always-ON identity checks
  rl(); await go(p, "#/mjt?tab=earn"); await until(p, () => location.hash === "#/mjt/earn");
  rl(); await go(p, "#/mjt/services"); await until(p, () => !!document.querySelector(".sv-wal"));
  assert.equal(await p.evaluate(() => !!document.querySelector("#view .mj-big")), false, "balance not repeated");
  assert.match(await p.textContent(".page-head, #view header") || "", /خدمات مجتمع كوين/);
  const r = await call("POST", "/api/mjt/buy", {}); assert.match(r.error, /لا يُشترى/, "server route stays disabled with a clear message");
});

test("«كيف أكسب» lists the live paths from the server and drops a paused one", async () => {
  rl(); await go(p, "#/mjt/earn"); await textHas(p, /مكافآت المساهمات المفيدة/);
  await textHas(p, /مكافأة الدخول اليومي/); await textHas(p, /التعدين اليومي/); await textHas(p, /إجابة مقبولة/);
  const cfg = await call("GET", "/api/mjt/config"), mine = await call("GET", "/api/mjt/mining");
  const t = await p.textContent("#view");
  assert.ok(t.includes("+" + cfg.earn.kinds[0].mjt + " MJT"), "contribution amounts come from /api/mjt/config");
  assert.ok(t.includes("+" + mine.checkin.amount + " MJT"), "sign-in amount comes from /api/mjt/mining");
  assert.ok(t.includes(mine.rate), "mining rate comes from /api/mjt/mining");
  assert.equal(await p.evaluate(() => !!document.querySelector('#view a[href="#/mjt/terms"]')), true);
  assert.deepEqual(await axe(p), [], "earn"); await shot(p, "earn-390");
  // v2.167: the sign-in reward is always ON — the admin pause switch and its API are gone
  rl(); const off = await p.evaluate(async () => (await fetch("/api/admin/mjt/legacy/checkin", { method: "PUT", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ enabled: false, reason: "e2e" }), credentials: "include" })).status);
  assert.equal(off, 404, "pause route removed");
  rl(); await go(p, "#/home"); await go(p, "#/mjt/earn"); await textHas(p, /مكافآت المساهمات المفيدة/); await textHas(p, /مكافأة الدخول اليومي/);
  // English UI
  await until(p, () => !!window.MPI18n?.setLang); await p.evaluate(() => window.MPI18n.setLang("en")); await until(p, () => document.documentElement.dir === "ltr");
  rl(); await go(p, "#/home"); await go(p, "#/mjt/earn"); await textHas(p, /Rewards for helpful contributions|How to earn/);
  await p.evaluate(() => window.MPI18n.setLang("ar")); await until(p, () => document.documentElement.dir === "rtl");
});

test("«شروط مجتمع كوين» states the terms; menu rows; help «؟»; CSP hygiene", async () => {
  rl(); await go(p, "#/mjt/terms"); await textHas(p, /شروط مجتمع كوين/);
  for (const re of [/بلا قيمة نقدية/, /لا يُحوَّل إلى Pi أو مال/, /ليس توكن على بلوكشين/, /إشعار الأعضاء مسبقاً/, /لا تُسحب الأرصدة من الأعضاء/, /رصيد مكافآت داخلي/]) await textHas(p, re);
  assert.deepEqual(await axe(p), [], "terms"); await shot(p, "terms-390");
  assert.equal(await p.evaluate(() => !!document.querySelector("[data-help]")), true, "help «؟» on the terms page");
  const items = await p.evaluate(() => (window.MPMenu ? MPMenu.items().map((x) => x.r) : null));
  if (items) { assert.ok(items.includes("mjt/earn") && items.includes("mjt/terms")); assert.ok(!items.includes("rewards"), "no second wallet row"); }
  assert.deepEqual(errors, []);
  const html = await p.evaluate(() => document.querySelector("#view").innerHTML);
  assert.doesNotMatch(html, /\son[a-z]+=|javascript:|style="/i);
  for (const f of ["mjt-ui.js", "rewards-ui.js", "mjt-services-ui.js"]) { const src = fs.readFileSync(path.join(__dirname, "../..", f), "utf8"); assert.doesNotMatch(src, /\son(click|input|change|submit)=|["'`]javascript:|style="/, f); assert.doesNotMatch(src, /شراء بـ Pi|التجريبية/, f); }
});
