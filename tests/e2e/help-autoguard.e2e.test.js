/* v2.62 T10 page help «؟» for «الحارس التلقائي»: the help on #/cadmin/:id?s=automod explains the auto-guard settings and the
 * one on ?s=moderation explains the guard state on a member's card (warnings + «رفع الإيقاف»). 390 light AR (sheet) and
 * 1440 dark EN (popover, LTR): right text, ≤4 lines, no horizontal overflow, axe 0 serious/critical, no page errors.
 * Screenshots → AGH_SHOTS (env) when set. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.AGH_SHOTS || "";
let S, cid, m, d; const errors = [];
const until = (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms });
const call = (p, mth, u, b) => p.evaluate(async ([mth, u, b]) => { const r = await fetch(u, { method: mth, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [mth, u, b]);
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(250); };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
async function axe(p) {
  await p.evaluate(() => document.querySelectorAll("#nf-toasts .nf-toast .x").forEach((x) => x.click()));
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (p, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name) }); };
const btn = "[data-help]:not([hidden])";
const openHelp = async (p) => { await until(p, (s) => [...document.querySelectorAll(s)].some((e) => e.getClientRects().length), btn); await p.evaluate((s) => [...document.querySelectorAll(s)].find((e) => e.getClientRects().length).click(), btn); await until(p, () => !!document.querySelector("#hp-t")); };
const panelText = (p) => p.evaluate(() => { const t = document.querySelector("#hp-t"), b = document.querySelector(".hp-body"); return { t: t.textContent, body: b.textContent, n: b.querySelectorAll("p").length, dir: b.dir }; });
const panelFits = (p) => p.evaluate(() => { const el = document.querySelector("#hp-t").closest(".panel, .hp-pop, [role=dialog]"); const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; });

test.before(async () => {
  S = await startStack();
  const mc = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); m = await mc.newPage(); m.on("pageerror", (e) => errors.push("m: " + e.message));
  await onboard(m, S.base, "agh_owner", "مالكة المساعدة");
  cid = (await call(m, "POST", "/api/communities", { name: "مجتمع مساعدة الحارس", desc: "مجتمع لاختبار مساعدة الحارس التلقائي.", rules: ["الاحترام"] })).community.id;
  const dc = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" }); d = await dc.newPage(); d.on("pageerror", (e) => errors.push("d: " + e.message));
  await onboard(d, S.base, "agh_admin", "مدير المساعدة"); await call(d, "PUT", `/api/communities/${cid}/membership`);
  await call(m, "PATCH", `/api/communities/${cid}/members/${await meId(d)}`, { role: "admin" });
});
test.after(async () => { await S?.close(); assert.deepEqual(errors, [], "no page errors"); });

test("390 light AR: automod help explains the auto-guard, moderation help explains the member card", async () => {
  await go(m, `#/cadmin/${cid}?s=automod`); await openHelp(m);
  let x = await panelText(m);
  assert.match(x.t, /الإشراف الآلي/); assert.equal(x.dir, "rtl"); assert.equal(x.n, 4, "4 short lines");
  assert.match(x.body, /الحارس التلقائي/); assert.match(x.body, /متوقف حتى تشغّله/); assert.match(x.body, /جرّب الحارس/);
  assert.ok(await noOverflow(m), "no page overflow"); assert.ok(await panelFits(m), "panel inside the viewport");
  assert.deepEqual(await axe(m), [], "axe 390 light automod"); await shot(m, "390-light-ar-automod.png");
  await m.keyboard.press("Escape");
  await go(m, `#/cadmin/${cid}?s=moderation`); await openHelp(m);
  x = await panelText(m);
  assert.match(x.t, /الإشراف/); assert.match(x.body, /رفع الإيقاف/); assert.ok(x.n <= 4);
  assert.ok(await noOverflow(m)); assert.ok(await panelFits(m));
  assert.deepEqual(await axe(m), [], "axe 390 light moderation"); await shot(m, "390-light-ar-moderation.png");
  await m.keyboard.press("Escape");
});

test("1440 dark EN: translated auto-guard help, LTR, popover fits", async () => {
  await until(d, () => !!window.MPI18n); await d.evaluate(() => window.MPI18n.setLang("en")); await until(d, () => document.documentElement.dir === "ltr");
  await d.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await go(d, `#/cadmin/${cid}?s=automod`); await openHelp(d);
  await until(d, () => /Auto guard/.test(document.querySelector(".hp-body")?.textContent || ""));
  const x = await panelText(d);
  assert.match(x.t, /Automod/); assert.equal(x.dir, "ltr"); assert.equal(x.n, 4);
  assert.match(x.body, /off until you turn it on/); assert.match(x.body, /Test the guard/);
  assert.ok(await noOverflow(d)); assert.ok(await panelFits(d));
  assert.deepEqual(await axe(d), [], "axe 1440 dark EN automod"); await shot(d, "1440-dark-en-automod.png");
  await d.keyboard.press("Escape");
  await go(d, `#/cadmin/${cid}?s=moderation`); await openHelp(d);
  await until(d, () => /Lift the stop/.test(document.querySelector(".hp-body")?.textContent || ""));
  assert.ok(await noOverflow(d)); assert.ok(await panelFits(d));
  assert.deepEqual(await axe(d), [], "axe 1440 dark EN moderation"); await shot(d, "1440-dark-en-moderation.png");
});

test("en text is present for both entries (merge keys match); no retired fr/ur help chunks (v2.67)", () => {
  const root = path.join(__dirname, "..", ".."), w = {}; global.window = w;
  for (const l of ["fr", "ur"]) assert.ok(!fs.existsSync(path.join(root, `help-content-${l}.js`)), `help-content-${l}.js removed`);
  for (const l of ["en"]) { new Function("window", fs.readFileSync(path.join(root, `help-content-${l}.js`), "utf8"))(w); for (const s of ["automod", "moderation"]) { const e = w.MPHelpContentL[l]["#/cadmin/:id|" + s]; assert.ok(e && e.body.split("\n").length === 4, l + " " + s); } }
  delete global.window;
});
