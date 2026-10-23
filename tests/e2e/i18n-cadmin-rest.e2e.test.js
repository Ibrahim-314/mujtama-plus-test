/* i18n-cadmin-rest: the community admin panel's non-moderation sections (sidebar groups + titles, owner label, search,
 * section labels / empty states / buttons) render in English (LTR) with no stray Arabic UI text; Arabic RTL unchanged.
 * Screenshots 1440 LTR: home, members, roles, insights, growth. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, DESKTOP } = require("./harness");
const SHOTS = process.env.SHOTS || "";
let S, own, cid; const errors = [];
const call = (p, m, u, b) => p.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [m, u, b]);
const until = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (p, h) => { await p.evaluate((h) => { document.getElementById("sheet")?.classList.add("hidden"); location.hash = h; }, h); await until(p, () => !document.querySelector("#view .skel") && !!document.querySelector("#view .page-head h2")); await p.waitForTimeout(700); };
const leftovers = (p) => p.evaluate(() => {
  const AR = /[\u0600-\u06FF]/, SKIP = ".body,.cbody,textarea,input,select,[data-noi18n],.bio,bdi,.page-head .sub,.ca-cname,.ca-nhead b,.ca-tile,.page-head .back";
  const out = new Set(); const w = document.createTreeWalker(document.querySelector("#view"), NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (AR.test(n.nodeValue) && !n.parentElement.closest(SKIP) && n.parentElement.offsetParent !== null) out.add(n.nodeValue.trim());
  document.querySelectorAll("#view [placeholder],#view [aria-label]").forEach((e) => { for (const a of ["placeholder", "aria-label"]) { const v = e.getAttribute(a); if (v && AR.test(v) && !e.closest(".ca-nhead,.page-head .back")) out.add("@" + a + ":" + v); } });
  const USER = ["مجتمع الترجمة", "مجتمع لاختبار الواجهة باتجاه اليسار.", "مالكة المجتمع", "م"]; // the test's own user content
  return [...out].filter((x) => !USER.includes(x));
});
const shot = async (p, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false }); };
const SECS = ["home", "general", "privacy", "members", "roles", "rules", "channels", "content", "knowledge", "events", "insights", "growth", "integrations", "health", "danger"];

test.before(async () => {
  S = await startStack();
  const c = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" }); own = await c.newPage(); own.on("pageerror", (e) => errors.push(e.message));
  await onboard(own, S.base, "ltr_cadm", "مالكة المجتمع");
  cid = (await call(own, "POST", "/api/communities", { name: "مجتمع الترجمة", desc: "مجتمع لاختبار الواجهة باتجاه اليسار.", rules: ["الاحترام"] })).community.id;
});
test.after(async () => { await S.close(); assert.deepEqual(errors, []); });

test("LTR (en): sidebar + non-moderation sections show no untranslated UI strings", async () => {
  await go(own, `#/cadmin/${cid}`); await own.evaluate(() => window.MPI18n?.setLang("en")).catch(() => {}); await own.waitForLoadState("load"); await own.waitForTimeout(800); await go(own, `#/cadmin/${cid}?s=home`); await until(own, () => document.documentElement.dir === "ltr");
  const report = {};
  for (const s of SECS) { await go(own, `#/cadmin/${cid}${s === "home" ? "" : "?s=" + s}`); report[s] = await leftovers(own); if (["home", "members", "roles", "insights", "growth"].includes(s)) await shot(own, "1440-ltr-" + s); }
  if (SHOTS) fs.writeFileSync(path.join(SHOTS, "ltr-leftovers.json"), JSON.stringify(report, null, 1));
  const total = Object.values(report).flat().length; console.log("LTR leftovers:", total, JSON.stringify(report));
  const nav = await own.evaluate(() => [...document.querySelectorAll(".ca-nav small,.ca-nl span")].map((e) => e.textContent).join("|") + "|" + document.getElementById("ca-q").placeholder);
  assert.ok(!/[\u0600-\u06FF]/.test(nav), "sidebar is translated: " + nav);
  assert.ok(total <= Number(process.env.MAX_LEFT || 0), "leftovers: " + JSON.stringify(report));
});

test("RTL (ar) unchanged", async () => {
  await own.evaluate(() => window.MPI18n?.setLang("ar")); await go(own, `#/cadmin/${cid}?s=members`); await until(own, () => document.documentElement.dir === "rtl");
  assert.match(await own.textContent(".ca-nav"), /الأعضاء/); assert.equal(await own.getAttribute("#ca-q", "placeholder"), "ابحث في الإعدادات");
});
