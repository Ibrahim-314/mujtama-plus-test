/* v2.61 — creator studio LTR strings (studio-i18n-ltr).
 * The original #/studio strings (title, six tabs, headings, empty states, buttons, calendar days, best-time slots) are
 * translated by the existing DOM i18n catalogues (en/fr/ur) — no Arabic left in LTR (en); Arabic RTL text unchanged.
 * Goal unit «منشور» pluralises in en (Post / Posts). axe (no serious/critical) at 1440 LTR; no overflow; no page errors. */
const test = require("node:test"), assert = require("node:assert"), fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS_DIR || "";
let S; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
async function axe(p) {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.filter((x) => ["serious", "critical"].includes(x.impact)).map((x) => x.id + ":" + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("|")));
}
const shot = async (p, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: true }); } };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/* Arabic UI text left inside the studio (user content — post titles, names — excluded) */
const arabicLeft = (p) => p.evaluate(() => {
  const root = document.querySelector(".wrap.studio"), out = [], AR = /[\u0600-\u06FF]/;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) { const el = n.parentElement; if (!AR.test(n.nodeValue) || el.closest("bdi,.top-post b,.card > b,.cal-item,.muted.u-t-xs,[data-noi18n],#st-goals .sgl-links a[href^='#/c/']")) continue; out.push(n.nodeValue.trim()); }
  for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]")) for (const a of ["aria-label", "title", "placeholder"]) { const v = el.getAttribute(a); if (v && AR.test(v) && !el.closest(".cal-item")) out.push(a + "=" + v); }
  return out;
});
const tab = async (p, k) => { await p.click(`[data-stab="${k}"]`); await p.waitForFunction((k) => document.querySelector(`[data-stab="${k}"]`)?.classList.contains("on") && !document.querySelector("#st-body .skel"), k); await p.waitForTimeout(250); };

test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("1440 LTR (en): every studio tab has no Arabic UI strings; Post/Posts unit; RTL Arabic unchanged", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, timezoneId: "Asia/Riyadh", reducedMotion: "reduce" }); const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "sil_maker", "مترجمة الاستوديو");
  for (const t of ["منشور أول للاختبار", "منشور ثانٍ للاختبار"]) assert.ok((await call(p, "POST", "/api/posts", { text: t })).status < 300);
  assert.ok((await call(p, "PUT", "/api/prefs", { ns: "studio", values: { goals: [{ k: "posts", target: 4 }] } })).status < 300);
  const go = async () => { await p.evaluate(() => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = "#/"; }); await p.waitForTimeout(150); await p.evaluate(() => { location.hash = "#/studio"; }); await p.waitForSelector("#st-goals .sgl-goal"); await p.waitForTimeout(300); };
  await go();
  // Arabic RTL: source strings untouched
  const arHead = await p.textContent(".wrap.studio .page-head h2"), arTabs = await p.$$eval("[data-stab]", (b) => b.map((x) => x.textContent));
  assert.equal(arHead.trim(), "استوديو المنشئ");
  assert.deepEqual(arTabs, ["نظرة عامة", "التقويم", "أفضل وقت", "إعادة النشر", "القوالب", "التقرير الأسبوعي"]);
  assert.match(await p.textContent("#st-goals .sgl-num"), /منشور/);
  await p.waitForFunction(() => !!window.MPI18n?.setLang, null, { timeout: 15000 });
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await go();
  assert.equal((await p.textContent(".wrap.studio .page-head h2")).trim(), "Creator Studio");
  assert.deepEqual(await p.$$eval("[data-stab]", (b) => b.map((x) => x.textContent)), ["Overview", "Calendar", "Best time", "Recycle", "Templates", "Weekly report"]);
  assert.match(await p.textContent("#st-goals .sgl-num"), /Posts/, "plural unit for target 4");
  const left = {};
  for (const k of ["overview", "calendar", "best", "recycle", "templates", "weekly"]) {
    await tab(p, k); const a = await arabicLeft(p); if (a.length) left[k] = a;
    for (const v of await axe(p)) assert.fail("LTR " + k + " " + v);
    assert.ok(await noOverflow(p), "no overflow " + k);
    if (k === "overview" || k === "calendar" || k === "best") await shot(p, "1440-ltr-" + k);
  }
  assert.deepEqual(left, {}, "Arabic UI strings left in LTR: " + JSON.stringify(left));
  // singular
  assert.ok((await call(p, "PUT", "/api/prefs", { ns: "studio", values: { goals: [{ k: "posts", target: 1 }] } })).status < 300);
  await go(); assert.match(await p.textContent("#st-goals .sgl-num"), /\bPost\b/);
  await p.evaluate(() => window.MPI18n.setLang("ar")); await c.close();
});
