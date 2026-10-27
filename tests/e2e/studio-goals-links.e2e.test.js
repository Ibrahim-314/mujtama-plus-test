/* v2.61 — creator studio: goals widget + «روابطك» (studio-goals-links).
 * Goals: pick 1–3 goals (posts this week · total followers · MJT balance) → saved in user prefs (ns "studio", key "goals")
 * → progress bars computed from existing data (calendar, overview.followersTotal, /api/mjt/me); max 3 enforced; Pi tips
 * listed but disabled «غير مفعّل بعد». Links: managed community, #/mjt, #/earnings («غير مفعّل بعد»), #/support/:handle, #/creator.
 * Existing studio tabs still present. axe (no serious/critical) at 390 light, 1440 dark, LTR (en); no overflow; no page errors. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S, cid; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const page = async (opts, who) => {
  const c = await S.browser.newContext({ ...opts, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(who + ": " + e.message)); p.on("dialog", (d) => { errors.push(who + ": native dialog " + d.message()); d.dismiss().catch(() => {}); });
  return p;
};
const login = async (p) => { await p.goto(S.base + "/?nosw"); await p.fill("#a-handle", "sgl_maker"); await p.fill("#a-pass", "secret1234"); await p.click("#a-go"); await p.waitForSelector(".bottomnav a[data-r=home]"); await p.waitForTimeout(400); const b = await p.$("#t-skip, #t-ok"); if (b) await b.click().catch(() => {}); };
async function axe(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const studio = async (p) => { await p.evaluate(() => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = "#/"; }); await p.waitForTimeout(150); await p.evaluate(() => { location.hash = "#/studio"; }); await p.waitForSelector("#st-goals #sgl-edit"); };

test.before(async () => {
  S = await startStack();
  const p = await page(DESKTOP, "setup"); await onboard(p, S.base, "sgl_maker", "صانعة أهداف");
  for (const t of ["أول منشور لهذا الأسبوع", "ثاني منشور لهذا الأسبوع"]) { const r = await call(p, "POST", "/api/posts", { text: t }); assert.ok(r.status < 300, JSON.stringify(r).slice(0, 200)); }
  const c = await call(p, "POST", "/api/communities", { name: "مجتمع الأهداف والنمو", desc: "مجتمع لاختبار أهداف المنشئ.", rules: ["الاحترام"] });
  cid = (c.community || c).id; assert.ok(cid, JSON.stringify(c).slice(0, 200));
  await p.context().close();
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors, no native dialogs"); });
test.beforeEach(() => S.app.ctx.rl?.w?.clear?.());

test("390 light: empty state → pick goals (max 3, Pi disabled) → saved in prefs → progress bars; links row", async () => {
  const m = await page(MOBILE, "390"); await login(m); await studio(m);
  assert.match(await m.textContent("#st-goals"), /اختر من هدف إلى ثلاثة أهداف/);
  // existing tabs untouched
  assert.equal((await m.$$("[data-stab]")).length, 7, "all seven studio tabs still there (AI icon tab added v2.114)");
  // order: goals section sits before the tabs
  assert.ok(await m.evaluate(() => !!(document.querySelector("#st-goals").compareDocumentPosition(document.querySelector(".wrap.studio .seg")) & Node.DOCUMENT_POSITION_FOLLOWING)));
  // links
  const hrefs = await m.$$eval("#st-goals .sgl-links a", (as) => as.map((a) => a.getAttribute("href")));
  for (const h of [`#/c/${cid}`, "#/mjt", "#/earnings", "#/support/sgl_maker", "#/creator"]) assert.ok(hrefs.includes(h), "link " + h + " in " + hrefs);
  assert.match(await m.textContent('#st-goals a[href="#/earnings"]'), /غير مفعّل بعد/);
  const lh = await m.$$eval("#st-goals .sgl-links a, #sgl-edit", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.ok(lh.every((h) => h >= 44), "touch targets ≥44px " + lh);
  for (const v of await axe(m)) assert.fail("390 light empty " + v);
  // editor
  await m.tap("#sgl-edit"); await m.waitForSelector("#sheet:not(.hidden) #sgl-save");
  assert.ok(await m.isDisabled("#sheet .sgl-off input"), "Pi tips option visible but disabled"); assert.match(await m.textContent("#sgl-pi"), /غير مفعّل بعد/);
  await m.check('[data-gk="posts"]'); await m.fill("#sgl-t-posts", "4");
  await m.check('[data-gk="followers"]'); await m.fill("#sgl-t-followers", "10");
  await m.check('[data-gk="mjt"]'); await m.fill("#sgl-t-mjt", "20");
  assert.ok(!(await m.isDisabled("#sgl-save")));
  for (const v of await axe(m)) assert.fail("390 light editor " + v);
  await shot(m, "390-light-editor");
  await m.tap("#sgl-save"); await m.waitForSelector("#st-goals .sgl-goal");
  const pr = await call(m, "GET", "/api/prefs?ns=studio");
  assert.deepEqual(pr.prefs.studio.goals, [{ k: "posts", target: 4 }, { k: "followers", target: 10 }, { k: "mjt", target: 20 }]);
  assert.equal((await m.$$("#st-goals .sgl-goal")).length, 3);
  const posts = await m.$eval('#st-goals .sgl-goal:first-child [role="progressbar"]', (e) => +e.getAttribute("aria-valuenow"));
  assert.equal(posts, 50, "2 of 4 posts this week = 50%");
  assert.match(await m.textContent("#st-goals .sgl-goal:first-child .sgl-num"), /2\s*\/\s*4/);
  assert.ok(await noOverflow(m), "no horizontal overflow at 390");
  for (const v of await axe(m)) assert.fail("390 light goals " + v);
  await shot(m, "390-light-goals");
  // edit back down to one goal; tab switch keeps the widget
  await m.tap("#sgl-edit"); await m.uncheck('[data-gk="followers"]'); await m.uncheck('[data-gk="mjt"]'); await m.tap("#sgl-save");
  await m.waitForFunction(() => document.querySelectorAll("#st-goals .sgl-goal").length === 1);
  await m.tap('[data-stab="best"]'); await m.waitForSelector("#st-goals .sgl-goal");
  await m.context().close();
});

test("server keeps at most what the client sends; bad namespace refused; visitors 401", async () => {
  const p = await page(DESKTOP, "api"); await p.goto(S.base + "/?nosw");
  assert.equal((await call(p, "GET", "/api/prefs?ns=studio")).status, 401);
  await p.context().close();
});

test("1440 dark + LTR (en): goals + links render, keyboard opens editor, Escape closes", async () => {
  const d = await page({ ...DESKTOP, colorScheme: "dark" }, "1440"); await login(d); await studio(d);
  await d.waitForSelector("#st-goals .sgl-goal");
  for (const v of await axe(d)) assert.fail("1440 dark " + v);
  assert.ok(await noOverflow(d)); await shot(d, "1440-dark-goals");
  await d.focus("#sgl-edit"); await d.keyboard.press("Enter"); await d.waitForSelector("#sheet:not(.hidden) #sgl-save");
  for (const v of await axe(d)) assert.fail("1440 dark editor " + v);
  await d.keyboard.press("Escape"); await d.waitForTimeout(200);
  await d.evaluate(() => document.getElementById("sheet")?.classList.add("hidden"));
  await d.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 }); await d.evaluate(() => window.MPI18n.setLang("en")); await d.waitForFunction(() => document.documentElement.dir === "ltr");
  await studio(d); await d.waitForSelector("#st-goals .sgl-goal"); await d.waitForTimeout(300);
  const txt = await d.textContent("#st-goals");
  assert.match(txt, /Your goals/); assert.match(txt, /Your links/); assert.match(txt, /Not active yet/);
  for (const v of await axe(d)) assert.fail("LTR " + v);
  assert.ok(await noOverflow(d)); await shot(d, "1440-ltr-goals");
  await d.setViewportSize({ width: 390, height: 844 }); await d.waitForTimeout(200); assert.ok(await noOverflow(d)); await shot(d, "390-ltr-dark-goals");
  await d.evaluate(() => window.MPI18n?.setLang("ar")); await d.context().close();
});
