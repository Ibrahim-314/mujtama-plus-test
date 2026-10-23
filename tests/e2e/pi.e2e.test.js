/* global MPPi, PiAdapter, showAuth, sheet */
/* Phase 36 (client) in a real browser against the production build. The Pi server API (/api/pi/*,
 * /api/admin/pi/*) is stubbed with context.route exactly per the contract in BRIEF-P36.md, and window.Pi is a
 * fake SDK injected before any page script, so nothing here talks to Pi or moves money.
 * Covers (36b: App Studio): Pi.init({version:"2.0"}) without sandbox, auth scopes username+payments (token only) +
 * onIncompletePaymentFound, sign-in/linking visible when only authEnabled is on (payments hidden), the real CSP enforced
 * (no violations, data-ui actions instead of inline handlers), «الدخول بحساب Pi»
 * (disabled outside Pi Browser, needsLink note, linked sign-in), «ربط حساب Pi» + unlink in settings, the unified
 * pay button (success → receipt link, cancel, error, disabled when Pi is off), the old PiAdapter.createPayment
 * entry point, #/wallet with chips + testnet badge + cursor infinite scroll, #/receipt/:id, #/admin/pi, and axe. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const { ensureBuild, startStack, onboard, MOBILE } = require("./harness");
let S, P, ctxMain; const errors = [];
const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";

/* ---------- fake Pi server (contract stub) ---------- */
const st = { enabled: true, authEnabled: true, network: "testnet", calls: [], linked: null, authMode: "linked", nextIntent: 1, unverified: 0, notLinked: false, incomplete: "pending" };
const TX = Array.from({ length: 27 }, (_, i) => ({ id: "tx" + (i + 1), paymentId: "pay_" + (i + 1), amount: (i % 5) + 0.5, memo: i % 3 ? "دعم مبدع #" + (i + 1) : "", status: ["completed", "approved", "cancelled", "created", "refunded", "failed"][i % 6], direction: i % 4 === 3 ? "in" : "out", createdAt: new Date(Date.UTC(2026, 9, 15, 12, 0) - i * 36e5).toISOString(), txid: i % 6 === 0 ? "a1b2c3d4e5f6" + i : null, purpose: i % 2 ? "tip" : "support", refId: null }));
const RECEIPT = { id: "tx1", amount: 2.5, memo: "دعم مقال الذكاء الاصطناعي", status: "completed", txid: "7f3e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f", network: "testnet", createdAt: "2026-10-15T12:00:00Z", completedAt: "2026-10-15T12:01:10Z", piUsername: "pi_amal", purpose: "tip", explorerUrl: "https://blockexplorer.minepi.com/testnet/tx/7f3e9a0b" };
async function stubPi(ctx) {
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const handler = async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname; let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    st.calls.push({ m, p, q: u.search, body, xrw: req.headers()["x-requested-with"] });
    if (p === "/api/pi/config") return json(route, 200, { enabled: st.enabled, authEnabled: st.authEnabled, network: st.network, sandbox: st.network !== "mainnet" });
    const authRoute = p === "/api/pi/auth" || p === "/api/pi/link"; // sign-in / linking: gated by authEnabled, not by payments
    if (authRoute ? !st.authEnabled : !st.enabled) return json(route, 501, { error: "مدفوعات Pi غير مفعّلة بعد" });
    if (p === "/api/pi/link" && m === "GET") return json(route, 200, { linked: !!st.linked, piUsername: st.linked, network: st.network });
    if (p === "/api/pi/auth") {
      if (body?.link) { st.linked = "pi_amal"; return json(route, 200, { user: { id: "u" }, piUsername: "pi_amal", linked: true }); }
      if (st.authMode === "needsLink") return json(route, 200, { needsLink: true, username: "pi_amal" });
      return json(route, 200, { user: { id: "u" }, piUsername: "pi_amal", linked: true });
    }
    if (p === "/api/pi/link" && m === "DELETE") { st.linked = null; return json(route, 200, { ok: true }); }
    if (p === "/api/pi/wallet") {
      const c = u.searchParams.get("cursor"), lim = Number(u.searchParams.get("limit") || 20), sts = u.searchParams.get("status"), rows = sts ? TX.filter(t => t.status === sts) : TX;
      const from = c ? Number(c) : 0, page = rows.slice(from, from + lim), nx = from + lim < rows.length ? String(from + lim) : null;
      return json(route, 200, { piUsername: st.linked, network: st.network, balanceNote: "الرصيد يظهر في محفظة Pi نفسها.", tx: page, nextCursor: nx });
    }
    if (p === "/api/pi/payments" && m === "POST") {
      if (st.notLinked) return json(route, 409, { error: "اربط حساب Pi أولاً", code: "pi_not_linked" });
      const id = "int" + st.nextIntent++; return json(route, 200, { id, amount: body.amount, memo: body.memo, metadata: { intentId: id, app: "mujtama" } });
    }
    if (p === "/api/pi/payments/complete" && st.unverified > 0) { st.unverified--; return json(route, 409, { error: "لم تتحقق شبكة Pi من المعاملة بعد، حاول بعد قليل", code: "pi_unverified" }); }
    if (p === "/api/pi/payments/incomplete") return json(route, 200, { ok: true, id: "old", status: st.incomplete, txid: null });
    if (/^\/api\/pi\/payments\/(approve|complete|cancel)$/.test(p)) return json(route, 200, { ok: true, status: p.endsWith("complete") ? "completed" : "approved" });
    if (p.startsWith("/api/pi/receipts/")) return p.endsWith("/nope") ? json(route, 404, { error: "غير موجود" }) : json(route, 200, { ...RECEIPT, id: decodeURIComponent(p.split("/").pop()) });
    if (p === "/api/admin/pi/reconciliation") return json(route, 200, { date: u.searchParams.get("date"), checked: 14, matched: 12, mismatched: [{ paymentId: "pay_9", reason: "مكتمل على Pi ومعلّق محلياً", status: "approved" }, { paymentId: "pay_11", reason: "ملغى على Pi", status: "created", fixed: true }], fixed: 1 });
    if (p === "/api/admin/pi/reconcile") return json(route, 200, { date: "2026-10-15", checked: 15, matched: 15, mismatched: [], fixed: 2 });
    return json(route, 404, { error: "not stubbed" });
  };
  await ctx.route("**/api/pi/**", handler);
  await ctx.route("**/api/admin/pi/**", handler);
}
/* fake Pi SDK: records init/authenticate/createPayment; window.__piMode = "ok" | "cancel" | "error" */
const FAKE_PI = () => {
  window.__pi = { init: null, scopes: null, payments: [] }; window.__piMode = "ok";
  window.Pi = {
    init(o) { window.__pi.init = o; },
    authenticate(scopes, onIncomplete) { window.__pi.scopes = scopes; if (window.__piIncomplete) onIncomplete(window.__piIncomplete); return Promise.resolve({ accessToken: "fake-token", user: { uid: "uid-1", username: "pi_amal" } }); },
    createPayment(data, cb) {
      window.__pi.payments.push(data); const id = "pay_" + window.__pi.payments.length;
      setTimeout(() => cb.onReadyForServerApproval(id), 30);
      if (window.__piMode === "abort") { setTimeout(() => cb.onCancel(null), 20); return; }
      if (window.__piMode === "cancel") setTimeout(() => cb.onCancel(id), 120);
      else if (window.__piMode === "error") setTimeout(() => cb.onError(new Error("انقطع الاتصال"), { identifier: id }), 120);
      else setTimeout(() => cb.onReadyForServerCompletion(id, "txid_" + id), 150);
    }
  };
};
const until = async (fn, arg, timeout = 12000, page = P) => { const end = Date.now() + timeout; for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await page.waitForTimeout(80); } };
const calls = (p, m) => st.calls.filter(c => c.p === p && (!m || c.m === m));
/* the app's real CSP stays enforced in this suite; any violation is recorded and fails the run */
const CSP_WATCH = () => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + (e.blockedURI || "inline") + " " + (e.sample || ""))); };
async function newCtx(ua = PI_UA) {
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: ua, reducedMotion: "reduce", bypassCSP: false });
  await stubPi(ctx); await ctx.addInitScript(FAKE_PI); await ctx.addInitScript(CSP_WATCH);
  return ctx;
}
async function axeOn(page, sel) {
  await page.evaluate(require("node:fs").readFileSync(require.resolve("axe-core/axe.min.js"), "utf8")); // evaluate is not subject to the page CSP
  return (await page.evaluate(async (s) => (await axe.run(s ? document.querySelector(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const shot = (name, page = P) => process.env.PI_SHOTS ? page.screenshot({ path: path.join(process.env.PI_SHOTS, name + ".png") }) : null; // optional visual check
const go = async (hash) => { await P.evaluate((h) => { location.hash = h; }, hash); };

test.before(async () => {
  ensureBuild(); // dist must be current (pi/tips chunks); rebuilds only when stale — never wipes a fresh shared dist mid-run
  S = await startStack();
  ctxMain = await newCtx(); P = await ctxMain.newPage();
  P.on("pageerror", e => errors.push("main: " + e.message));
  await onboard(P, S.base, "amal_pi", "أمل"); // first account = admin
  await until(() => !!window.MPPi);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("adapter: Pi.init({version:\"2.0\"}) with no sandbox option; authenticate asks for username+payments, keeps only the token, queues incomplete payments", async () => {
  await until(() => window.__pi.init);
  assert.deepEqual(await P.evaluate(() => window.__pi.init), { version: "2.0" }, "App Studio: no sandbox option");
  await P.evaluate(() => { window.__piIncomplete = { identifier: "pay_old", transaction: { txid: "tx_old" } }; });
  const auth = await P.evaluate(() => PiAdapter.authenticate());
  assert.deepEqual(auth, { accessToken: "fake-token" }, "only the access token is kept (no client uid/username)");
  assert.deepEqual(await P.evaluate(() => window.__pi.scopes), ["username", "payments"]);
  await P.waitForTimeout(200);
  assert.equal(calls("/api/pi/payments/incomplete").length, 0, "not sent before /api/pi/auth (no session yet)");
  assert.equal(await P.evaluate(() => PiAdapter.incomplete.length), 1, "queued");
  await P.evaluate(() => { window.__piIncomplete = null; });
});

test("sign-in screen: «الدخول بحساب Pi» is disabled with a note outside Pi Browser, hidden when Pi sign-in is off", async () => {
  const ctx = await newCtx(MOBILE.userAgent); const Q = await ctx.newPage(); Q.on("pageerror", e => errors.push("plain: " + e.message));
  await Q.goto(S.base + "/?nosw");
  await Q.waitForSelector("#pi-signin", { timeout: 15000 });
  assert.equal(await Q.isDisabled("#pi-signin"), true);
  assert.match(await Q.textContent("#pi-signin-n"), /متصفح Pi/);
  assert.equal(await Q.getAttribute("#pi-signin", "aria-describedby"), "pi-signin-n");
  await Q.click("[data-m=register]"); await Q.waitForSelector("#a-name");
  await Q.waitForSelector("#pi-signin"); // re-added on every auth render
  assert.equal(await Q.$$eval("#pi-signin", n => n.length), 1);
  st.enabled = false; st.authEnabled = false; await Q.evaluate(() => { MPPi.refresh(); showAuth("login"); });
  await Q.waitForTimeout(400);
  assert.equal(await Q.$("#pi-signin"), null, "no Pi button while Pi sign-in is off");
  st.enabled = true; st.authEnabled = true; await ctx.close();
});

test("payments off, sign-in on (authEnabled): «الدخول بحساب Pi» and the settings link show, payment UI stays hidden", async () => {
  st.enabled = false; st.authEnabled = true; st.linked = null;
  const ctx = await newCtx(); const Q = await ctx.newPage(); Q.on("pageerror", e => errors.push("authonly: " + e.message));
  try {
    await onboard(Q, S.base, "pi_authonly", "دخول فقط"); await until(() => !!window.MPPi, null, 15000, Q);
    await Q.evaluate(() => { location.hash = "#/settings?s=money"; });
    await Q.waitForSelector("#pi-set #pi-link:not([disabled])", { timeout: 15000 });
    assert.equal(await Q.$("#pi-set a[href='#/admin/pi']"), null, "no payments admin link while payments are off");
    await Q.click("#pi-link"); await Q.waitForSelector("#pi-unlink");
    assert.equal(calls("/api/pi/auth").at(-1).body.link, true);
    assert.equal(await Q.$("#pi-set-w"), null, "no wallet link while payments are off");
    await Q.evaluate(() => { const d = document.createElement("div"); d.id = "pay-test"; document.querySelector("#view").prepend(d); d.appendChild(MPPi.payButton({ amount: 1, memo: "x", purpose: "tip" })); });
    await Q.waitForSelector("#pay-test .pi-pay[data-state=off]", { state: "attached" });
    assert.equal(await Q.$eval("#pay-test .pi-pay", n => n.hidden), true, "pay button hidden when enabled:false");
    // signed out: the sign-in screen still offers «الدخول بحساب Pi», and it sends only the token
    await Q.evaluate(() => fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "mujtama" } }));
    await Q.goto(S.base + "/?nosw");
    await Q.waitForSelector("#pi-signin:not([disabled])", { timeout: 15000 });
    st.authMode = "linked"; const nAuth = calls("/api/pi/auth").length;
    await Q.click("#pi-signin"); // (the stubbed /api/pi/auth sets no real session; only the request matters here)
    for (let k = 0; k < 50 && calls("/api/pi/auth").length === nAuth; k++) await Q.waitForTimeout(100);
    const a = calls("/api/pi/auth")[nAuth]; assert.ok(a, "sign-in request sent"); assert.deepEqual(Object.keys(a.body), ["accessToken"], "only the token is sent"); assert.equal(a.body.accessToken, "fake-token");
    assert.deepEqual(await Q.evaluate(() => window.__csp), [], "no CSP violations");
  } finally { st.enabled = true; st.linked = null; await ctx.close(); }
});

test("CSP: no violations while using the app; data-ui actions replace inline handlers (close-sheet, back)", async () => {
  await go("#/home"); await P.waitForSelector(".bottomnav a[data-r=home].active");
  await P.evaluate(() => sheet(`<p>x</p><button id="csp-close" data-ui="close-sheet">إغلاق</button>`));
  await P.waitForSelector("#sheet:not(.hidden) #csp-close"); await P.click("#csp-close");
  await P.waitForSelector("#sheet.hidden", { state: "attached" });
  await go("#/settings"); await P.waitForSelector("#ver"); await go("#/home"); await P.waitForSelector(".bottomnav a[data-r=home].active");
  await P.evaluate(() => { const a = document.createElement("a"); a.href = "#"; a.dataset.ui = "back"; a.id = "csp-back"; a.textContent = "رجوع"; document.querySelector("#view").prepend(a); });
  await P.click("#csp-back"); await until(() => location.hash.startsWith("#/settings"));
  assert.deepEqual(await P.evaluate(() => window.__csp), [], "no CSP violations on the main page");
});

test("sign-in screen inside Pi Browser: needsLink shows the account to link, a linked account signs in", async () => {
  const ctx = await newCtx(); const Q = await ctx.newPage(); Q.on("pageerror", e => errors.push("signin: " + e.message));
  await Q.goto(S.base + "/?nosw");
  await Q.waitForSelector("#pi-signin:not([disabled])", { timeout: 15000 });
  assert.match(await Q.textContent("#pi-signin"), /الدخول بحساب Pi/);
  await shot("signin", Q);
  st.authMode = "needsLink";
  await Q.click("#pi-signin");
  await Q.waitForSelector("#pi-signin-n.err[role=alert]");
  assert.match(await Q.textContent("#pi-signin-n"), /@pi_amal/); assert.match(await Q.textContent("#pi-signin-n"), /غير مربوط/);
  const a = calls("/api/pi/auth").at(-1); assert.equal(a.body.accessToken, "fake-token"); assert.equal(a.body.link, undefined);
  assert.ok(await Q.$("#pi-new"), "offers creating a new account with Pi (legacy /api/auth/pi)");
  // the user signs in with the password; the same Pi token is then linked with link:true
  const reg = await Q.evaluate(async () => { const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ handle: "pi_signin", password: "secret1234", name: "داخل بـ Pi" }) }); await fetch("/api/auth/logout", { method: "POST", headers: { "X-Requested-With": "mujtama" } }); return r.status; });
  assert.equal(reg, 200);
  await Q.fill("#a-handle", "pi_signin"); await Q.fill("#a-pass", "secret1234");
  const nAuth = calls("/api/pi/auth").length;
  await Q.click("#a-go");
  await until(() => !document.body.classList.contains("ob") || !!document.querySelector("#n1"), null, 8000, Q);
  await until(() => true, null, 100, Q);
  const linkCall = await (async () => { for (let k = 0; k < 40; k++) { const c = calls("/api/pi/auth").slice(nAuth).find(x => x.body.link); if (c) return c; await Q.waitForTimeout(100); } return null; })();
  assert.ok(linkCall, "linked right after the password sign-in"); assert.equal(linkCall.body.accessToken, "fake-token");
  await ctx.close();
});

test("sign-in screen inside Pi Browser: a linked Pi account signs straight in, then queued incomplete payments are resolved", async () => {
  const ctx = await newCtx(); const Q = await ctx.newPage(); Q.on("pageerror", e => errors.push("signin2: " + e.message));
  await Q.goto(S.base + "/?nosw");
  await Q.waitForSelector("#pi-signin:not([disabled])", { timeout: 15000 });
  st.authMode = "linked";
  const reg = await Q.evaluate(async () => (await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ handle: "pi_signin2", password: "secret1234", name: "داخل بـ Pi" }) })).status);
  assert.equal(reg, 200);
  await Q.evaluate(() => { window.__piIncomplete = { identifier: "pay_old2", transaction: { txid: "tx_old2" } }; });
  const nAuth = calls("/api/pi/auth").length, nInc = calls("/api/pi/payments/incomplete").length;
  await Q.click("#pi-signin");
  await Q.waitForSelector("#pi-signin", { state: "detached" });
  await until(() => !document.body.classList.contains("ob") || !!document.querySelector("#n1"), null, 8000, Q);
  await until(() => /قيد التحقق/.test(document.getElementById("toast").textContent), null, 5000, Q);
  const inc = calls("/api/pi/payments/incomplete").slice(nInc);
  assert.equal(inc.length, 1); assert.equal(inc[0].body.payment.identifier, "pay_old2"); assert.equal(inc[0].xrw, "mujtama", "CSRF header like other routes");
  assert.ok(st.calls.indexOf(calls("/api/pi/auth")[nAuth]) < st.calls.indexOf(inc[0]), "only after /api/pi/auth");
  await ctx.close();
});

test("settings: «ربط حساب Pi» links (link:true), shows the account + wallet link, and unlinking asks first", async () => {
  st.linked = null; // the stub is shared by every context; earlier sign-in tests linked their own accounts
  await go("#/settings?s=money"); // v2.38: the Pi card lives in «المدفوعات والمحفظة»
  await P.waitForSelector("#pi-set #pi-link:not([disabled])");
  assert.match(await P.textContent("#pi-set"), /Testnet/);
  await P.click("#pi-link");
  await P.waitForSelector("#pi-set-w");
  assert.equal(await P.evaluate(() => document.activeElement?.id), "pi-set-w", "focus moves to the next step");
  assert.equal(calls("/api/pi/auth").at(-1).body.link, true);
  await until(() => true); for (let k = 0; k < 20 && !calls("/api/pi/payments/incomplete").some(c => c.body.payment.identifier === "pay_old"); k++) await P.waitForTimeout(100);
  assert.ok(calls("/api/pi/payments/incomplete").some(c => c.body.payment.identifier === "pay_old"), "the queue from the first test is flushed once linked");
  assert.match(await P.textContent("#pi-set"), /@pi_amal/);
  await P.$eval("#pi-set", (n) => n.scrollIntoView()); await shot("settings");
  assert.ok(await P.$("#pi-set a[href='#/admin/pi']"), "admins get the reconciliation link");
  assert.deepEqual(await axeOn(P, "#pi-set"), []);
  await P.click("#pi-unlink");
  await P.waitForSelector("#sheet:not(.hidden) [role=alertdialog]");
  await P.click("#pi-ul-x"); await P.waitForSelector("#sheet.hidden", { state: "attached" });
  assert.equal(calls("/api/pi/link", "DELETE").length, 0);
  await P.click("#pi-unlink"); await P.click("#pi-ul-go");
  await P.waitForSelector("#pi-set #pi-link");
  assert.equal(calls("/api/pi/link", "DELETE").length, 1);
  // link again for the wallet test
  await P.click("#pi-link"); await P.waitForSelector("#pi-set-w");
});

async function mountPay(opts) {
  await P.evaluate((o) => { const w = document.querySelector("#view .wrap") || document.querySelector("#view"); document.getElementById("pay-test")?.remove(); const d = document.createElement("div"); d.id = "pay-test"; d.className = "card"; w.prepend(d); d.appendChild(MPPi.payButton({ ...o, onDone: (r) => { window.__payDone = r; } })); }, opts);
}
test("pay button: intent → Pi.createPayment → approve → complete, then a receipt link", async () => {
  await go("#/home"); await P.waitForSelector(".bottomnav a[data-r=home].active");
  const before = st.calls.length;
  await mountPay({ amount: 1.5, memo: "دعم منشور", purpose: "tip", refId: "p1" });
  await P.waitForSelector("#pay-test .pi-pay[data-state=idle] .pi-btn:not([disabled])");
  assert.match(await P.textContent("#pay-test .pi-btn"), /ادفع 1\.5 Pi/);
  assert.match(await P.textContent("#pay-test .pi-note"), /Testnet/);
  await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=done]");
  const mine = st.calls.slice(before).map(c => c.m + " " + c.p);
  const i = (s) => mine.indexOf(s);
  assert.ok(i("POST /api/pi/payments") >= 0 && i("POST /api/pi/payments") < i("POST /api/pi/payments/approve") && i("POST /api/pi/payments/approve") < i("POST /api/pi/payments/complete"), mine.join(", "));
  const intent = st.calls.slice(before).find(c => c.p === "/api/pi/payments");
  assert.deepEqual(intent.body, { amount: 1.5, memo: "دعم منشور", purpose: "tip", refId: "p1" });
  const sent = await P.evaluate(() => window.__pi.payments.at(-1));
  assert.deepEqual(sent, { amount: 1.5, memo: "دعم منشور", metadata: { intentId: sent.metadata.intentId, app: "mujtama" } }, "intent passed to Pi unchanged");
  assert.match(sent.metadata.intentId, /^int\d+$/);
  const done = await P.evaluate(() => window.__payDone);
  assert.equal(done.txid, "txid_" + done.paymentId);
  assert.equal(await P.getAttribute("#pay-test [data-pi-rc]", "href"), "#/receipt/" + done.id);
  assert.equal(await P.isDisabled("#pay-test .pi-btn"), true, "no double pay");
});

test("pay button: cancel calls /cancel and returns to idle; an SDK error shows an alert and allows retry", async () => {
  await P.evaluate(() => { window.__piMode = "cancel"; });
  await mountPay({ amount: 1, memo: "اختبار", purpose: "support" });
  await P.waitForSelector("#pay-test .pi-btn:not([disabled])"); await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=loading] .pi-btn[aria-busy=true]").catch(() => { });
  await until(() => document.querySelector("#pay-test .pi-pay").dataset.state === "idle" && /أُلغيت/.test(document.querySelector("#pay-test .pi-note").textContent));
  assert.ok(calls("/api/pi/payments/cancel").length >= 1);
  await P.evaluate(() => { window.__piMode = "error"; });
  await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=error] .pi-note.err[role=alert]");
  assert.match(await P.textContent("#pay-test .pi-note"), /انقطع الاتصال/);
  assert.match(await P.textContent("#pay-test .pi-btn"), /إعادة المحاولة/);
  assert.equal(await P.isDisabled("#pay-test .pi-btn"), false);
  await P.evaluate(() => { window.__piMode = "abort"; });
  const nc = calls("/api/pi/payments/cancel").length;
  await P.click("#pay-test .pi-btn");
  await until(() => document.querySelector("#pay-test .pi-pay").dataset.state === "idle");
  const ab = calls("/api/pi/payments/cancel").slice(nc); assert.equal(ab.length, 1); assert.match(ab[0].body.intentId, /^int\d+$/, "no paymentId yet → cancel by intentId"); assert.equal(ab[0].body.paymentId, undefined);
  await P.evaluate(() => { window.__piMode = "ok"; });
  assert.deepEqual(await axeOn(P, "#pay-test"), []);
});

test("pay button: pi_unverified on complete is retried; pi_not_linked points to settings", async () => {
  await P.evaluate(() => { MPPi._retryMs = 40; });
  st.unverified = 2; const n0 = calls("/api/pi/payments/complete").length;
  await mountPay({ amount: 2, memo: "اشتراك", purpose: "subscription" });
  await P.waitForSelector("#pay-test .pi-btn:not([disabled])"); await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=done]");
  assert.equal(calls("/api/pi/payments/complete").length - n0, 3, "two retries then success");
  assert.match(await P.textContent("#pay-test .pi-btn"), /تمّ الدفع/);
  st.unverified = 9;
  await mountPay({ amount: 2, memo: "اشتراك", purpose: "subscription" });
  await P.waitForSelector("#pay-test .pi-btn:not([disabled])"); await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=done]");
  assert.match(await P.textContent("#pay-test .pi-note"), /قيد التحقق/); assert.ok(await P.$("#pay-test [data-pi-rc]"));
  st.unverified = 0; st.notLinked = true;
  await mountPay({ amount: 1, memo: "x", purpose: "tip" });
  await P.waitForSelector("#pay-test .pi-btn:not([disabled])"); await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=error]");
  assert.ok(await P.$("#pay-test .pi-note a[href='#/settings']")); assert.match(await P.textContent("#pay-test .pi-note"), /اربط حساب Pi/);
  st.notLinked = false;
  await mountPay({ amount: 5000, memo: "x", purpose: "tip" });
  await P.waitForSelector("#pay-test .pi-btn:not([disabled])"); await P.click("#pay-test .pi-btn");
  await P.waitForSelector("#pay-test .pi-pay[data-state=error]"); assert.match(await P.textContent("#pay-test .pi-note"), /1000/);
});

test("pay button is hidden when Pi is off, disabled with a clear note outside Pi Browser", async () => {
  st.enabled = false; await P.evaluate(() => MPPi.refresh());
  await mountPay({ amount: 1, memo: "x", purpose: "tip" });
  await P.waitForSelector("#pay-test .pi-pay[data-state=off]", { state: "attached" });
  assert.equal(await P.$eval("#pay-test .pi-pay", n => n.hidden), true, "Pi off: the button is not shown at all");
  st.enabled = true; await P.evaluate(() => { MPPi.refresh(); window.MP_PI_BROWSER = false; });
  const ctx = await newCtx(MOBILE.userAgent); const Q = await ctx.newPage(); Q.on("pageerror", e => errors.push("plain2: " + e.message));
  await onboard(Q, S.base, "plain_pi", "عادي"); await until(() => !!window.MPPi, null, 15000, Q);
  await Q.evaluate(() => { const d = document.createElement("div"); d.id = "pay-test"; document.querySelector("#view").prepend(d); d.appendChild(MPPi.payButton({ amount: 1, memo: "x" })); });
  await Q.waitForSelector("#pay-test .pi-pay[data-state=off]");
  assert.equal(await Q.isDisabled("#pay-test .pi-btn"), true);
  assert.match(await Q.textContent("#pay-test .pi-note"), /متصفح Pi/);
  await ctx.close();
});

test("old entry point PiAdapter.createPayment opens the unified pay sheet and resolves with the result", async () => {
  await P.evaluate(() => { window.__old = PiAdapter.createPayment(1, "دعم أمل", { post: "p9" }).then(r => (window.__oldR = r || "closed")); });
  await P.waitForSelector("#sheet:not(.hidden) .pi-pay .pi-btn:not([disabled])");
  assert.equal(await P.evaluate(() => document.activeElement?.id), "pi-sh-t");
  await shot("pay-sheet");
  await P.click("#sheet .pi-btn");
  await P.waitForSelector("#sheet .pi-pay[data-state=done]");
  await shot("pay-sheet-done");
  const intent = calls("/api/pi/payments", "POST").at(-1); assert.deepEqual(intent.body, { amount: 1, memo: "دعم أمل", purpose: "tip", refId: "p9" });
  await P.click("#pi-sh-x");
  const r = await until(() => window.__oldR);
  assert.ok(r.txid, "resolves with the completed payment");
});

test("#/wallet: account, testnet badge, status chips, and cursor paging by infinite scroll", async () => {
  await go("#/wallet");
  await P.waitForSelector("#pi-tx li");
  assert.match(await P.textContent(".pi-hero"), /@pi_amal/); assert.match(await P.textContent(".pi-hero .pi-net"), /Testnet/);
  assert.equal(await P.$$eval("#pi-tx li", l => l.length), 20);
  await shot("wallet");
  const chips = await P.$$eval("#pi-tx .pi-chip", l => [...new Set(l.map(x => x.textContent))]);
  for (const t of ["مكتمل", "قيد التنفيذ", "ملغاة", "بانتظار الموافقة", "مستردّة", "فشلت"]) assert.ok(chips.includes(t), t);
  assert.ok(await P.$("#pi-tx li a[href='#/receipt/tx1']"));
  assert.match(await P.getAttribute("#pi-tx li a", "aria-label"), /Pi/);
  assert.deepEqual(await axeOn(P), []);
  for (let k = 0; k < 6 && (await P.$$eval("#pi-tx li", l => l.length)) < 27; k++) { await P.evaluate(() => scrollTo(0, document.body.scrollHeight)); await P.waitForTimeout(300); }
  assert.equal(await P.$$eval("#pi-tx li", l => l.length), 27, "all pages loaded by scrolling");
  const qs = calls("/api/pi/wallet").map(c => new URLSearchParams(c.q)).slice(-2);
  assert.deepEqual(qs.map(q => [q.get("limit"), q.get("cursor")]), [["20", null], ["20", "20"]]);
  assert.equal(await P.$("#pi-more-b"), null, "no more button at the end");
  await P.selectOption("#pi-st", "refunded");
  await until(() => document.querySelectorAll("#pi-tx li").length > 0 && [...document.querySelectorAll("#pi-tx .pi-chip")].every(c => c.textContent === "مستردّة"));
  assert.equal(new URLSearchParams(calls("/api/pi/wallet").at(-1).q).get("status"), "refunded");
  assert.equal(await P.evaluate(() => document.activeElement?.id), "pi-st");
  await P.selectOption("#pi-st", ""); await until(() => document.querySelectorAll("#pi-tx li").length === 20);
});

test("#/receipt/:id: amount, memo, status, txid with explorer link, network, dates, copy and share", async () => {
  await ctxMain.grantPermissions(["clipboard-read", "clipboard-write"], { origin: S.base });
  await P.click("#pi-tx li a[href='#/receipt/tx1']");
  await P.waitForSelector(".pi-rc");
  assert.equal(await P.evaluate(() => document.activeElement?.id), "pi-h");
  const t = await P.textContent("#view");
  await shot("receipt");
  assert.match(t, /دعم مقال الذكاء الاصطناعي/); assert.match(t, /مكتمل/); assert.match(t, /Testnet/); assert.match(t, /@pi_amal/); assert.match(t, /دعم مبدع/);
  assert.match(await P.textContent("#pi-txid"), /^7f3e9a0b/);
  assert.equal(await P.getAttribute("#pi-exp", "href"), RECEIPT.explorerUrl);
  assert.equal(await P.getAttribute("#pi-exp", "target"), "_blank"); assert.match(await P.getAttribute("#pi-exp", "rel"), /noopener/);
  await P.click("#pi-cp-tx"); await until(() => /نُسخ/.test(document.getElementById("toast").textContent));
  assert.equal(await P.evaluate(() => navigator.clipboard.readText()), RECEIPT.txid);
  await P.evaluate(() => { navigator.share = (d) => { window.__shared = d; return Promise.resolve(); }; });
  await P.click("#pi-share"); const shared = await until(() => window.__shared);
  assert.match(shared.text, /2\.5 Pi/); assert.match(shared.text, /7f3e9a0b/);
  assert.deepEqual(await axeOn(P), []);
  await go("#/receipt/nope"); await P.waitForSelector("#view .empty"); assert.match(await P.textContent("#view .empty"), /لم يُعثر/);
});

test("#/admin/pi: reconciliation report for a date and «تشغيل المطابقة الآن»; #/admin links to it", async () => {
  await go("#/admin"); await P.waitForSelector("#pi-adm");
  await P.click("#pi-adm");
  await P.waitForSelector(".pi-kpi");
  assert.match(calls("/api/admin/pi/reconciliation").at(-1).q, /^\?date=\d{4}-\d{2}-\d{2}$/);
  assert.match(await P.textContent("#pi-rep"), /pay_9/); assert.match(await P.textContent("#pi-rep"), /أُصلحت/);
  assert.ok(await P.$("label[for=pi-date]"));
  await shot("admin");
  assert.deepEqual(await axeOn(P), []);
  await P.click("#pi-run");
  await P.waitForSelector("#pi-run-n.ok");
  assert.equal(calls("/api/admin/pi/reconcile", "POST").length, 1);
  assert.match(await P.textContent("#pi-rep"), /لا فروقات/);
});

test("Pi off: wallet explains it kindly (501), settings hides the Pi card", async () => {
  st.enabled = false; st.authEnabled = false; await P.evaluate(() => MPPi.refresh());
  await go("#/wallet"); await P.waitForSelector("#view .empty[role=status]");
  assert.match(await P.textContent("#view .empty"), /غير مفعّلة/);
  await go("#/settings"); await P.waitForSelector("#ver");
  await until(() => !document.getElementById("pi-set") && !document.getElementById("pi"));
  assert.equal(await P.$("#pi-link"), null, "Pi off: no Pi card in settings");
  assert.deepEqual(await P.evaluate(() => window.__csp), [], "no CSP violations during the whole run");
  st.enabled = true; st.authEnabled = true;
});
