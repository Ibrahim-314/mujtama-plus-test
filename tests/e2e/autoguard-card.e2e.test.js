/* v2.62 T8 «الحارس التلقائي» admin card in a real browser (cadmin → الإشراف الآلي): off by default, the recommended
 * setup fills the form (saves nothing), enable + words + save persists `guard`, the tester shows the guard outcome
 * («سيُحذف · تحذير 1 من 3 · كتم 1 ساعة»), KPI tiles, a moderator sees it read-only, 44px targets, no overflow at 390,
 * axe (no serious/critical) at 390 light AR, 1440 dark EN and 390 LTR; screenshots in SHOTS (env) when set. */
const test = require("node:test"), assert = require("node:assert"), path = require("path");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.AG_SHOTS || "";
let S, cid, own, mod; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(200); };
async function axe(p) {
  await p.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await p.waitForFunction(() => !document.querySelector("#nf-toasts .nf-toast"), null, { timeout: 5000 }).catch(() => {});
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document.querySelector("#ag-card") || document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const page = async (opts = MOBILE, who = "") => {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog " + d.type()); d.dismiss().catch(() => {}); });
  return p;
};
const shot = async (p, name) => { if (!SHOTS) return; await p.$eval("#ag-card", (n) => n.scrollIntoView({ block: "start" })); await (await p.$("#ag-card")).screenshot({ path: path.join(SHOTS, name) }); };

test.before(async () => {
  S = await startStack();
  own = await page(MOBILE, "owner"); await onboard(own, S.base, "ag_owner", "مالكة الحارس");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع الحارس", desc: "مجتمع لاختبار بطاقة الحارس التلقائي.", rules: ["الاحترام"] })).community.id;
  mod = await page(MOBILE, "mod"); await onboard(mod, S.base, "ag_mod", "مشرف الحارس"); await call(mod, "PUT", `/api/communities/${cid}/membership`);
  await call(own, "PATCH", `/api/communities/${cid}/members/${await meId(mod)}`, { role: "moderator" });
});
test.after(async () => { await S?.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native dialogs"); });
test.beforeEach(() => S.app.ctx.rl.w?.clear?.());

test("guard card: off by default, recommended setup fills (nothing saved), enable + words + save, tester shows the outcome", async () => {
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector("#ag-card");
  assert.equal(await own.$eval('[data-k="g.enabled"]', (x) => x.checked), false, "off by default");
  assert.equal(await own.$eval("#ag-card .ag-opts", (x) => x.hidden), true, "settings hidden while off");
  assert.equal(await own.$$eval("#ag-card .ag-kpis .mq2-k", (x) => x.length), 3, "KPI tiles");
  // the recommended setup fills the form and saves nothing
  await own.click("#ag-pre"); await own.waitForSelector("#ca-save:not([hidden])");
  assert.equal(await own.$eval('[data-k="g.enabled"]', (x) => x.checked), true);
  assert.equal(await own.$eval('input[name="ag-maxStrikes"]:checked', (x) => x.value), "3");
  assert.equal(await own.$eval('input[name="ag-muteHours"]:checked', (x) => x.value), "1");
  assert.equal(await own.$eval('input[name="ag-decayDays"]:checked', (x) => x.value), "30");
  assert.equal(await own.$eval("#ag-card .ag-opts", (x) => x.hidden), false);
  assert.ok(!(await call(own, "GET", `/api/communities/${cid}/automod`)).automod.guard?.enabled, "a preset saves nothing");
  await own.fill('[data-k="g.words"]', "كلمة سيئة\nغب*"); await until(own, () => /2\/300|٢\/٣٠٠/.test(document.querySelector("#ag-cnt").textContent));
  // turn edits off with a real pointer click on the chip: since v2.61.1 the transparent input covers the whole .am-cat chip
  // (44px target), so the click lands on the input — the same thing a user's tap hits — and must toggle it
  assert.equal(await own.$eval('input[data-k="g.edits"]', (x) => x.checked), true, "edits on in the recommended setup");
  await own.click('label:has(input[data-k="g.edits"])');
  await until(own, () => document.querySelector('input[data-k="g.edits"]').checked === false);
  await own.selectOption('[data-k="g.liftMin"]', "admin");
  // tester on the draft (before saving)
  await own.fill("#ag-tt", "يا غبي"); await own.click("#ag-tgo"); await own.waitForSelector("#ag-tres .am-verdict.danger");
  assert.match(await own.textContent("#ag-tres"), /سيُحذف/); assert.match(await own.textContent("#ag-tres"), /تحذير ١? ?1? ?من|تحذير/);
  assert.match(await own.textContent("#ag-tres .ag-out"), /من/);
  await own.fill("#ag-tt", "صباح الخير"); await own.click("#ag-tgo"); await own.waitForSelector("#ag-tres .am-verdict.ok");
  // save
  await own.click('[data-ca="save"]'); await own.waitForSelector("#ca-save[hidden]", { state: "attached" });
  const g = (await call(own, "GET", `/api/communities/${cid}/automod`)).automod.guard;
  assert.equal(g.enabled, true); assert.deepEqual(g.words, ["كلمة سيئة", "غب*"]); assert.equal(g.maxStrikes, 3); assert.equal(g.muteHours, 1); assert.equal(g.decayDays, 30); assert.equal(g.edits, false); assert.equal(g.posts, true); assert.equal(g.liftMin, "admin"); assert.equal(g.fullLock, true);
  // after reload the card reflects the saved state and the tester still works
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector("#ag-card");
  assert.equal(await own.$eval('[data-k="g.enabled"]', (x) => x.checked), true);
  await own.fill("#ag-tt", "والغبية هنا"); await own.click("#ag-tgo"); await own.waitForSelector("#ag-tres .am-verdict.danger");
  // 44px targets in the card and no horizontal overflow at 390
  const small = await own.$$eval("#ag-card button, #ag-card .ca-seg span, #ag-card .am-cat span, #ag-card select", (els) => els.filter((e) => e.getBoundingClientRect().height && e.getBoundingClientRect().height < 43.5).map((e) => e.className + ":" + e.textContent.trim().slice(0, 20)));
  assert.deepEqual(small, [], "touch targets ≥44px");
  assert.ok(await own.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
  await shot(own, "autoguard-card-390-light-ar.png");
  // a moderator sees it read-only (and can still test)
  await go(mod, `#/cadmin/${cid}?s=automod`); await mod.waitForSelector("#ag-card");
  assert.equal(await mod.$eval('[data-k="g.enabled"]', (x) => x.disabled), true); assert.equal(await mod.$("#ag-pre"), null);
  await mod.fill("#ag-tt", "كلمة سيئة"); await mod.click("#ag-tgo"); await mod.waitForSelector("#ag-tres .am-verdict.danger");
});

test("axe: no serious/critical on the guard card — 390 light AR, 1440 dark EN, 390 LTR; screenshots", async () => {
  const bad = [];
  await go(own, `#/cadmin/${cid}?s=automod`); await own.waitForSelector("#ag-card"); for (const v of await axe(own)) bad.push("390 light " + v);
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "dark"); await d.goto(S.base + "/?nosw"); await d.fill("#a-handle", "ag_owner"); await d.fill("#a-pass", "secret1234"); await d.click("#a-go"); await d.waitForSelector(".bottomnav a[data-r=home]");
  await go(d, `#/cadmin/${cid}?s=automod`); await d.waitForSelector("#ag-card"); for (const v of await axe(d)) bad.push("1440 dark AR " + v);
  await until(d, () => !!window.MPI18n?.setLang); await d.evaluate(() => window.MPI18n.setLang("en")); await until(d, () => document.documentElement.dir === "ltr");
  await go(d, `#/cadmin/${cid}?s=automod`); await d.waitForSelector("#ag-card");
  await d.fill("#ag-tt", "you are غبي"); await d.click("#ag-tgo"); await d.waitForSelector("#ag-tres .am-verdict.danger");
  assert.match(await d.textContent("#ag-tres"), /Will be removed/); assert.match(await d.textContent("#ag-tres .ag-out"), /Warning/);
  for (const v of await axe(d)) bad.push("1440 dark EN " + v);
  await shot(d, "autoguard-card-1440-dark-en.png");
  await d.setViewportSize(MOBILE.viewport); await go(d, `#/cadmin/${cid}?s=automod`); await d.waitForSelector("#ag-card");
  assert.ok(await d.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no overflow LTR 390");
  for (const v of await axe(d)) bad.push("390 LTR " + v);
  await shot(d, "autoguard-card-390-dark-ltr.png");
  await d.evaluate(() => window.MPI18n?.setLang("ar")); await d.context().close();
  assert.deepEqual(bad, []);
});
