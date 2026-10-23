/* Phase 52 + 57 e2e against the REAL server (production build, Pi payments off — exactly like production).
 * Admin opens #/admin/activation: four groups, push already active (auto VAPID), email/translation forms present.
 * Creator studio #/subscribers (stats tab renders), #/subs/<handle> renders with the «Pi not enabled» note.
 * Also: no page errors, no inline handlers / javascript: URLs in the subs + transfers chunks. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "sb_e2e", "مختبر الاشتراكات");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("activation hub, subscriptions page + studio; no CSP violations", async () => {
  await p.goto(S.base + "/?nosw#/admin/activation");
  await until(() => document.querySelectorAll(".tr-ck").length === 4, undefined, 30000);
  const txt = await p.textContent(".wrap");
  assert.match(txt, /إشعارات الجهاز/); assert.match(txt, /البريد الإلكتروني/); assert.match(txt, /الترجمة الآلية/);
  assert.match(await p.textContent(".tr-hero"), /إشعارات الجهاز/, "push active out of the box");
  assert.ok(await p.locator("#ac-em").count()); assert.ok(await p.locator("#ac-tr").count());
  await p.goto(S.base + "/?nosw#/subscribers");
  await until(() => /مشترك حالي/.test(document.querySelector("#sb-body")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/subs/sb_e2e");
  await until(() => /مدفوعات Pi|لا يقدّم/.test(document.querySelector(".sb-page")?.textContent || ""));
  for (const f of ["subs-ui.js", "transfers-ui.js"]) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /\son[a-z]+=["']|javascript:/, f);
  assert.deepEqual(errors, []);
});
