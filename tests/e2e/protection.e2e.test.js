/* global MPProtection, rerender */
/* Track 7 — phase 33 in a real browser: the 🛡 button on every post opens the one-tap safety sheet, the
 * 3-step report (category → detail → protect) blocks the author and lands in the server queue, hidden replies
 * collapse behind a tap for other viewers, the help center lists verified numbers with tel: links and the
 * informational disclaimer, protection mode toggles from #/protection, and an axe audit of the new screens.
 * index.html is a shared file (wired by the integrator), so the test injects protection-core.js + protection-ui.js
 * into each page and attaches the protection service to the running server. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");
let S, A, B, C; const errors = [], ids = {};
const until = async (P, fn, arg, timeout = 10000) => { const end = Date.now() + timeout; for (;;) { const v = await P.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await P.waitForTimeout(100); } };
const call = (P, method, p, body) => P.evaluate(async ([m, u, b]) => { const r = await fetch(u, { method: m, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, ...(await r.json().catch(() => ({}))) }; }, [method, p, body]);
async function inject(P) {
  if (await P.evaluate(() => !!window.MPProtection)) return; // already in the bundle once index.html is wired
  await P.addScriptTag({ path: path.join(ROOT, "protection-core.js") });
  await P.addScriptTag({ path: path.join(ROOT, "protection-ui.js") });
  await until(P, () => !!window.MPProtection);
}
async function go(P, hash) { await P.evaluate((h) => { location.hash = h; }, hash); await P.waitForTimeout(400); }
async function user(handle, name) {
  const ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const P = await ctx.newPage();
  P.on("pageerror", e => errors.push(handle + ": " + e.message));
  await onboard(P, S.base, handle, name);
  ids[handle] = (await call(P, "GET", "/api/me")).user.id;
  await inject(P);
  return P;
}
async function reload(P, hash) { await P.goto(S.base + "/?nosw" + hash); await P.waitForSelector(".bottomnav a[data-r=home]"); await inject(P); await P.evaluate(() => typeof rerender === "function" && rerender()); await P.waitForTimeout(500); }

test.before(async () => {
  S = await startStack();
  S.app.ctx.services.protection ||= require(path.join(ROOT, "server", "services", "protection"))(S.app.ctx);
  A = await user("amal_pt", "أمل"); B = await user("badr_pt", "بدر"); C = await user("chadi_pt", "شادي");
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("🛡 safety button on a post → one-tap sheet; 3-step report blocks the author and reaches the queue", async () => {
  const post = (await call(A, "POST", "/api/posts", { text: "منشور أمل لاختبار أدوات الأمان" })).post;
  await reload(B, "#/post/" + post.id);
  await B.waitForSelector(`[data-safety="${post.id}"]`);
  assert.equal(await B.getAttribute(`[data-safety="${post.id}"]`, "aria-label"), "أدوات الأمان لهذا المنشور");
  await B.click(`[data-safety="${post.id}"]`);
  await B.waitForSelector('#sheet [data-pt="report"]');
  const labels = await B.$$eval("#sheet [data-pt]", els => els.map(e => e.dataset.pt));
  for (const k of ["mute", "word", "block", "report", "mode", "help"]) assert.ok(labels.includes(k), k);
  assert.equal(await B.getAttribute("#sheet .panel", "role"), "dialog");
  await B.click('#sheet [data-pt="report"]');
  // step 1
  await B.waitForSelector('#sheet input[name="pt-c"][value="harassment"]');
  assert.match(await B.textContent("#sheet .pt-sub"), /الخطوة ١ من ٣/);
  assert.equal(await B.isDisabled("#pt-n"), true, "next disabled until a category is chosen");
  await B.check('#sheet input[name="pt-c"][value="harassment"]'); await B.click("#pt-n");
  // step 2
  await B.waitForSelector('#sheet input[name="pt-s"][value="threat"]');
  await B.check('#sheet input[name="pt-s"][value="threat"]'); await B.fill("#pt-d", "تهديد في المنشور"); await B.click("#pt-n");
  // step 3
  await B.waitForSelector("#pt-bl"); await B.check("#pt-bl"); await B.click("#pt-send");
  await B.waitForSelector("#pt-ok");
  assert.match(await B.textContent("#sheet"), /عاجلاً/); assert.match(await B.textContent("#sheet"), /الحظر/);
  await B.click("#pt-ok");
  const rep = await S.app.ctx.db.get("SELECT r.reason, d.category, d.subcategory, d.details FROM reports r JOIN report_details d ON d.report=r.id WHERE r.target=$1", [post.id]);
  assert.deepEqual([rep.category, rep.subcategory, rep.details], ["harassment", "threat", "تهديد في المنشور"]);
  assert.ok((await call(B, "GET", "/api/me")).prefs.blocked.includes(ids.amal_pt));
  await call(B, "DELETE", "/api/protection/blocks/" + ids.amal_pt);
});

test("hidden replies: the author hides a reply; other viewers see it collapsed behind a tap", async () => {
  const post = (await call(A, "POST", "/api/posts", { text: "منشور فيه رد سيُخفى" })).post;
  const c = (await call(C, "POST", "/api/comments", { post: post.id, text: "رد مزعج سيُخفى" })).comment;
  await reload(A, "#/post/" + post.id);
  await A.waitForSelector(`[data-pt-hide="${c.id}"]`);
  await A.click(`[data-pt-hide="${c.id}"]`);
  await until(A, (id) => !!document.querySelector(`[data-pt-hide="${id}"]`) && document.querySelector(`[data-pt-hide="${id}"]`).textContent === "إظهار", c.id);
  await reload(B, "#/post/" + post.id);
  await B.waitForSelector(".comment.pt-hidden .pt-reveal");
  assert.equal(await B.isVisible(".comment.pt-hidden .cbody"), false, "reply body hidden");
  assert.equal(await B.getAttribute(".comment.pt-hidden .pt-reveal", "aria-expanded"), "false");
  await B.click(".comment.pt-hidden .pt-reveal");
  assert.equal(await B.isVisible(".comment.pt-hidden .cbody"), true, "revealed after a tap");
  assert.match(await B.textContent(".comment.pt-hidden .cbody"), /رد مزعج/);
  assert.equal(await B.$(`[data-pt-hide="${c.id}"]`), null, "only the post author can hide");
});

test("who can reply: author restricts to mentioned; a non-mentioned viewer sees the notice and a disabled box", async () => {
  const post = (await call(A, "POST", "/api/posts", { text: "سؤال لـ @chadi_pt فقط" })).post;
  await reload(A, "#/home");
  await A.waitForSelector(`[data-safety="${post.id}"]`); await A.click(`[data-safety="${post.id}"]`);
  await A.waitForSelector('#sheet input[name="pt-aud"][value="mentioned"]');
  await A.check('#sheet input[name="pt-aud"][value="mentioned"]');
  await until(A, async (pid) => (await (await fetch(`/api/posts/${pid}/reply-settings`)).json()).audience === "mentioned", post.id);
  await A.evaluate(() => closeSheet());
  await reload(B, "#/post/" + post.id);
  await B.waitForSelector(".pt-audience");
  assert.match(await B.textContent(".pt-audience"), /من أشرت إليهم فقط/);
  assert.equal(await B.isDisabled(".chatbar input"), true);
});

test("help center: disclaimer, verified numbers as tel: links, placeholders; protection mode from #/protection", async () => {
  await reload(B, "#/help");
  await B.waitForSelector(".pt-res");
  assert.match(await B.textContent("[role=note]"), /للتوعية/);
  assert.equal(await B.getAttribute('a.pt-tel[href="tel:911"]', "href"), "tel:911");
  assert.ok(await B.$('a.pt-tel[href="tel:920033360"]'));
  assert.match((await B.$$eval(".pt-res", els => els.map(e => e.textContent))).join(" "), /سيُضاف الرقم المعتمد قريباً/);
  await go(B, "#/help/mental-health"); await B.waitForSelector(".pt-art");
  assert.match(await B.textContent(".pt-art h2"), /صحتك النفسية/);
  await go(B, "#/protection"); await B.waitForSelector("#pt-mode");
  await B.click("#pt-mode"); await B.waitForSelector("#pt-hr");
  await B.selectOption("#pt-hr", "6"); await B.click("#pt-go");
  await until(B, async () => (await (await fetch("/api/protection/mode")).json()).mode.active);
  await go(B, "#/policies"); await B.waitForSelector('a[href="#/policies/community-guidelines"]');
  await B.click('a[href="#/policies/community-guidelines"]'); await B.waitForSelector(".pt-pol h2");
  assert.match(await B.textContent(".pt-pol h2"), /إرشادات المجتمع/);
});

test("accessibility: report sheet, help center, protection and policies have no serious/critical WCAG A/AA violations", async () => {
  const post = (await call(C, "POST", "/api/posts", { text: "منشور للفحص" })).post;
  const report = {};
  const audit = async (name) => { await B.addScriptTag({ path: require.resolve("axe-core/axe.min.js") }); report[name] = (await B.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })))).filter(v => ["serious", "critical"].includes(v.impact)); };
  for (const r of ["#/help", "#/protection", "#/policies/community-guidelines"]) { await reload(B, r); await B.waitForTimeout(800); await audit(r); }
  await reload(B, "#/post/" + post.id);
  await B.evaluate((pid) => MPProtection.report3(pid, "post"), post.id); await B.waitForSelector('#sheet input[name="pt-c"]');
  await audit("report-step1");
  await B.evaluate(() => closeSheet());
  const bad = Object.entries(report).filter(([, v]) => v.length);
  assert.deepEqual(bad, [], JSON.stringify(bad));
});
