/* Phases 54 + 59 e2e against the REAL server (production build, LAUNCH_MODE unset → open, like production).
 * Beta: the staff account sees the floating «ملاحظة» button → sends a bug with device info → triage board → reply → the thread
 * shows «فريق مجتمع بلس»; waves + dashboard + kill-switch screens render. Points: #/points (level, how to earn, link to the MJT
 * wallet — v2.47 retired the points → Pi redemption), #/leaderboard, #/admin/points. No page errors; both chunks lazy, no inline handlers; core budget kept. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "bp_e2e", "مختبر تجريبي"); // first account → admin
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("beta: feedback button → triage board reply → tester sees it; waves, dashboard, flags", async () => {
  await p.goto(S.base + "/?nosw#/settings?s=help"); // v2.38: «المساعدة والقانوني»
  await p.waitForSelector("#bt-fab", { timeout: 25000 }); // v2.32: beta feedback is a Settings row (no second floating button) added by the beta chunk for staff
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("bt-fab")).position) !== "fixed", true);
  await p.click("#bt-fab");
  await p.waitForSelector("#bt-dlg[open]");
  await p.fill("#bt-tx", "الصفحة الرئيسية تتأخر في التحميل");
  await p.click("#bt-send");
  await until(() => !document.querySelector("#bt-dlg"));
  const { db } = S.app.ctx;
  const fb = await db.get("SELECT * FROM beta_feedback ORDER BY created_at DESC LIMIT 1");
  assert.equal(fb.kind, "bug"); assert.match(JSON.parse(fb.device).screen, /x/);
  await p.goto(S.base + "/?nosw#/admin/beta/board");
  await until((id) => !!document.querySelector(`[data-f="${id}"]`), fb.id);
  await p.selectOption(`[data-f="${fb.id}"] [data-s]`, "in_progress");
  await p.fill(`[data-f="${fb.id}"] [data-r]`, "نعمل على تحسينها");
  await p.click(`[data-f="${fb.id}"] [data-save]`);
  await until(() => /قيد التنفيذ/.test(document.querySelector("#bt-a")?.textContent || ""));
  await p.goto(S.base + `/?nosw#/beta/f/${fb.id}`);
  await until(() => /نعمل على تحسينها/.test(document.querySelector("#bt-th")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/admin/beta/waves");
  await until(() => /الموجة الأولى/.test(document.querySelector("#bt-a")?.textContent || "") && /مفتوح للجميع/.test(document.querySelector("#bt-a")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/admin/beta/dash");
  await until(() => /العودة D7/.test(document.querySelector("#bt-a")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/admin/beta/flags");
  await until(() => !!document.querySelector('[data-k="stories"] [data-kill]'));
  await p.goto(S.base + "/?nosw#/beta");
  await until(() => /ملاحظاتي/.test(document.querySelector("#bt-m")?.textContent || "") && /قيد التنفيذ/.test(document.querySelector("#bt-m")?.textContent || ""));
  assert.deepEqual(errors, []);
});

test("points: my points, leaderboard, admin screen; redemption off while Pi is off", async () => {
  await p.goto(S.base + "/?nosw#/points");
  await p.waitForSelector(".pt-hero", { timeout: 20000 });
  await until(() => /كيف تكسب النقاط/.test(document.querySelector("#pt-m")?.textContent || "") && !!document.querySelector("#pt-m .pt-mjt[href='#/mjt']") && !document.querySelector("#pt-rf")); // v2.47: points become «مجتمع كوين» (MJT); the Pi redemption is retired while MJT is linked
  await p.check("#pt-oo"); await until(() => true);
  await p.goto(S.base + "/?nosw#/leaderboard?p=month");
  await p.waitForSelector("#pt-b .empty, #pt-b ol");
  await p.goto(S.base + "/?nosw#/admin/points");
  await until(() => /مدفوعات Pi غير مفعّلة/.test(document.querySelector("#pt-a")?.textContent || ""));
  await p.click("#pt-scan");
  await until(() => !!document.querySelector("#pt-a .pt-t"));
  assert.deepEqual(errors, []);
});

test("build: beta + points chunks lazy, no inline handlers; core JS within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file)); assert.ok(core.br <= 90 * 1024, "core " + core.br);
  for (const n of ["beta", "points"]) {
    const ch = b.files.find((x) => new RegExp(`chunk-${n}-.*\\.js$`).test(x.file)); assert.ok(ch, n + " chunk built");
    const src = fs.readFileSync(path.join(ROOT, "dist", ch.file), "utf8");
    assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src), n);
  }
  const idx = fs.readFileSync(path.join(ROOT, "dist", "index.html"), "utf8"); assert.ok(!/beta-ui|points-ui/.test(idx));
});
