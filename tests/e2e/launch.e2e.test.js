/* Phase 50 e2e against the REAL server (production build, LAUNCH_MODE unset → open, like production).
 * Help center search → article → open a ticket → staff (admin) replies in the queue → user sees «فريق الدعم» + status «تم الرد»;
 * ambassador apply → staff approve → referral link; signed-out visitor can open /about and the waitlist; settings entry card.
 * Also: no page errors, no inline handlers / javascript: in the launch chunk, core JS + CSS budgets untouched. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p; const errors = [];
const until = async (fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms });
const text = (sel) => p.textContent(sel);
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "ln_e2e", "مختبر الإطلاق");
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("help center → ticket → staff reply; ambassadors; settings card", async () => {
  await p.goto(S.base + "/?nosw#/faq");
  await p.waitForSelector("#lc-hq", { timeout: 25000 }); // lazy launch chunk (loaded by the ai chunk) rendered the help center
  await until(() => document.querySelectorAll("#lc-hl .lc-item").length >= 3);
  await p.fill("#lc-hq", "الاساءه"); await p.click("#lc-hs button");
  await until(() => /الإبلاغ عن الإساءة/.test(document.querySelector("#lc-hl")?.textContent || ""));
  await p.click('#lc-hl a[href="#/faq/report-abuse"]');
  await until(() => /زر الأمان/.test(document.querySelector("#lc-a")?.textContent || ""));
  // open a ticket
  await p.goto(S.base + "/?nosw#/tickets/new");
  await p.waitForSelector("#lc-tf");
  await p.fill("#lc-ts", "لا تظهر إشعاراتي"); await p.selectOption("#lc-tc", "bug"); await p.fill("#lc-tb", "منذ أمس لا تصلني أي إشعارات على الهاتف");
  await p.click("#lc-tsub");
  await until(() => /^#\/tickets\/tk_/.test(location.hash));
  const tid = await p.evaluate(() => location.hash.split("/")[2]);
  await until(() => /مفتوحة/.test(document.querySelector("#lc-h")?.textContent || ""));
  // ln_e2e is the first account → admin → staff queue; reply as a second staff member through the API (moderator)
  const { db } = S.app.ctx;
  await p.goto(S.base + "/?nosw#/staff/tickets");
  await until((t) => !!document.querySelector(`a[href="#/staff/tickets/${t}"]`), tid);
  const ctx2 = await S.browser.newContext({ ...MOBILE }); const q = await ctx2.newPage();
  await onboard(q, S.base, "ln_mod", "مشرف الدعم");
  await db.run("UPDATE users SET role='moderator' WHERE handle='ln_mod'");
  const r = await q.evaluate(async (t) => (await fetch(`/api/tickets/${t}/messages`, { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ body: "جرّب تفعيل الإشعارات من الإعدادات ← الإشعارات" }) })).json(), tid);
  assert.equal(r.ticket.status, "answered");
  await ctx2.close();
  await p.goto(S.base + "/?nosw#/tickets/" + tid);
  await until(() => /تم الرد/.test(document.querySelector("#lc-h")?.textContent || ""));
  assert.match(await text("#lc-th"), /فريق الدعم|مشرف الدعم/); // the admin viewer is staff and sees the real name
  await p.click("#lc-sset"); // staff controls are shown to the admin
  // ambassadors
  await p.goto(S.base + "/?nosw#/ambassadors");
  await p.waitForSelector("#lc-af");
  await p.fill("#lc-am1", "أدير مجموعة للمطورين العرب وأرغب في دعوتهم إلى المنصة ومساعدتهم");
  await p.click("#lc-af button");
  await until(() => /قيد المراجعة/.test(document.querySelector("#lc-am")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/staff/ambassadors");
  await p.waitForSelector('[data-dec="approve"]');
  await p.click('[data-dec="approve"]');
  await until(() => /لا طلبات/.test(document.querySelector("#lc-al")?.textContent || ""));
  await p.goto(S.base + "/?nosw#/ambassadors");
  await until(() => /\?ref=A[A-Z0-9]{7}/.test(document.querySelector("#lc-link")?.textContent || ""));
  // settings entry card
  await p.goto(S.base + "/?nosw#/settings?s=help"); // v2.38: help links filed into «المساعدة والقانوني»
  await p.waitForSelector(".set-sec a[href='#/faq']", { timeout: 15000 });
  assert.deepEqual(errors, []);
});

test("signed-out visitor: /about landing and waitlist work without an account", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const v = await c.newPage(); const errs = []; v.on("pageerror", (e) => errs.push(e.message));
  await v.goto(S.base + "/about?nosw");
  await v.waitForSelector(".lc-hero h1", { timeout: 25000 });
  assert.match(await v.textContent(".lc-hero"), /مجتمع بلس/);
  await v.click('.lc-hero a[href="#/waitlist"]');
  await v.waitForSelector("#lc-wf");
  await v.fill("#lc-wc", "visitor@example.com"); await v.click("#lc-wf button");
  await v.waitForFunction(() => /ترتيبك/.test(document.querySelector("#lc-wm")?.textContent || ""), null, { timeout: 10000 });
  const st = await v.goto(S.base + "/about.html"); assert.equal(st.status(), 200); // static landing copied from public/
  assert.match(await v.textContent("h1"), /مجتمع بلس/);
  await c.close();
  assert.deepEqual(errs, []);
});

test("build: launch chunk has no inline handlers; core JS and CSS stay within budget", () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json")));
  const core = b.files.find((f) => /^assets\/app-.*\.js$/.test(f.file)), css = b.files.find((f) => /^assets\/app-.*\.css$/.test(f.file));
  assert.ok(core.br <= 90 * 1024, "core " + core.br); assert.ok(css.br <= 16 * 1024, "css " + css.br) /* v2.53: same CSS budget as tools/budget.mjs (14→16 KB) */;
  const ch = b.files.find((x) => /chunk-launch-.*\.js$/.test(x.file)); assert.ok(ch, "launch chunk built");
  const src = fs.readFileSync(path.join(ROOT, "dist", ch.file), "utf8");
  assert.ok(!/\son[a-z]+=["']/.test(src) && !/javascript:/.test(src));
});
