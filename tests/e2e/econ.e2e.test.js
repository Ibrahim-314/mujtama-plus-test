/* Phase 53 + 58 e2e against the REAL server (production build, Pi payments off — exactly like production).
 * Admin: #/admin/pricing (all paid items, suggested prices shown but not applied), #/admin/revenue (totals, costs, CSV link).
 * Members: #/digital store and #/purchases render with the «Pi not enabled» note. Core-slimming check: #/security, #/status and
 * #/privacy (moved to the lazy "secx" chunk in v2.26.0) still render. No page errors; no inline handlers in the new chunks. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "ec_e2e", "مختبر الأسعار");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("pricing + revenue (admin), digital store + purchases, moved security/privacy screens; no CSP violations", async () => {
  await p.goto(S.base + "/?nosw#/admin/pricing");
  await until(() => document.querySelectorAll(".ec-it").length >= 8, undefined, 30000);
  const t = await p.textContent(".ec-page");
  assert.match(t, /رسوم المنصة على الإكراميات/); assert.match(t, /مجتمع\+ ذكاء/); assert.match(t, /أسعار مقترحة لم تُطبَّق بعد/);
  /* Every suggested price is shown (8: ai_plus + 7 fixed items). An "apply" button [data-sug] appears only where the current
   * value differs from the suggestion; where it already matches (env defaults: fee.transfers 0, ads.cpm.min 0.01) the row shows
   * the «مطبّق» chip instead. So the button count is derived from the API, never a hard-coded number, and nothing was applied. */
  const ov = await p.evaluate(async () => (await (await fetch("/api/admin/pricing", { credentials: "include" })).json()).items);
  const sugs = ov.filter((i) => i.suggested), pending = sugs.filter((i) => !i.suggested.applied);
  assert.ok(sugs.length >= 8 && pending.length >= 1, "suggestions exist");
  assert.equal(await p.locator(".ec-it .ec-sug").count(), sugs.length, "every suggestion is shown");
  assert.equal(await p.locator("[data-sug]").count(), pending.length, "one apply button per not-yet-applied suggestion");
  assert.ok(!pending.some((i) => i.source === "price_book"), "suggestions are offered, not applied");
  await p.goto(S.base + "/?nosw#/admin/revenue");
  await until(() => !!document.querySelector("#ec-cost"), undefined, 30000);
  assert.match(await p.textContent(".ec-page"), /حصة المنصة/);
  assert.ok(await p.locator('a[href^="/api/admin/revenue.csv"]').count());
  await p.goto(S.base + "/?nosw#/digital");
  await until(() => /مدفوعات Pi/.test(document.querySelector("#dg-list")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/purchases");
  await until(() => /لم تشترِ/.test(document.querySelector(".dg-page")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/security");
  await until(() => /التحقق بخطوتين/.test(document.querySelector("#view")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/status");
  await until(() => /الخدمات/.test(document.querySelector("#view")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/privacy");
  await until(() => /الكلمات المكتومة/.test(document.querySelector("#view")?.textContent || ""));
  for (const f of ["econ-ui.js", "digital-ui.js", "secx-ui.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /\son[a-z]+=["']|javascript:/, f);
  assert.deepEqual(errors, []);
});
