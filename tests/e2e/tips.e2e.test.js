/* global MPPi, MPTips, route */
/* Phase 37 (client): tips & creator support in a real browser against the production build. The server side
 * (/api/pi/*, /api/tips/*, /api/support/*, /api/creators/*, /api/me/creator|supporting|earnings*, /api/posts/:id/tips,
 * /api/admin/tips/*, /api/admin/ledger/*) is stubbed with context.route per BRIEF-P37.md, and window.Pi is a fake SDK,
 * so nothing here talks to Pi or moves money. Users and posts are real rows (the feed comes from the real server).
 * Covers: lazy "tips" chunk (not in core), Pi off → everything hidden except #/creator (with a note), «إكرامية» only for
 * opted-in creators and never on own posts, tip sheet (presets / custom / message / anonymous, client + server limit
 * errors in Arabic, intent → Pi.createPayment unchanged → approve/complete, cancel), celebration (none under reduced
 * motion, coins otherwise), post tips summary, #/support/:handle (tiers, stats, wall tabs, subscribe, cancel),
 * #/me/supporting, #/creator (≤ 3 tiers, validation, PUT), #/earnings (periods, KPIs, SVG chart, CSV), #/admin card +
 * #/admin/tips (release / reject, ledger check), and axe (wcag2a/aa serious+critical) on each screen. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path");
const { ensureBuild, startStack, onboard, MOBILE, ROOT } = require("./harness");
let S, P, ctxMain; const errors = [];
const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
const POSTS = {};

/* ---------- contract stub ---------- */
const st = { enabled: true, calls: [], nextIntent: 1, tipError: null, myState: "none", held: [{ id: "t9", amount: 60, holdReason: "velocity", sender: { id: "u9", handle: "fast_sender", name: "س" }, creator: { id: "u1", handle: "yousef_pi", name: "يوسف" }, createdAt: "2026-10-15T10:00:00Z", postId: null, anonymous: false }, { id: "t10", amount: 12, holdReason: "new_account", sender: { id: "u10", handle: "new_acc", name: "ج" }, creator: { id: "u1", handle: "yousef_pi", name: "يوسف" }, createdAt: "2026-10-15T11:00:00Z" }] };
const CREATORS = {
  yousef_pi: { enabled: true, tiers: [{ id: "tr1", name: "داعم", amount: 2, perks: "شكر خاص في البث الشهري" }, { id: "tr2", name: "شريك", amount: 5, perks: "وصول مبكر للمقالات\nجلسة أسئلة شهرية" }, { id: "tr3", name: "راعٍ ذهبي", amount: 20, perks: "اسمك في نهاية كل فيديو" }] },
  reem_ai: { enabled: false, tiers: [] }, amal_tip: { enabled: false, tiers: [] }
};
const WALL = { month: [{ user: { handle: "khaled_dev", name: "خالد العتيبي" }, amount: 25, kind: "support", at: "2026-10-10T10:00:00Z" }, { user: null, amount: null, kind: "tip", at: "2026-10-12T10:00:00Z" }, { user: { handle: "sara_learn", name: "سارة القحطاني" }, amount: 5, kind: "tip", at: "2026-10-13T10:00:00Z" }],
  all: [{ user: { handle: "omar_startup", name: "عمر الشهري" }, amount: 120, kind: "support", at: "2026-06-10T10:00:00Z" }, { user: { handle: "khaled_dev", name: "خالد العتيبي" }, amount: 80, kind: "support", at: "2026-10-10T10:00:00Z" }] };
const EARN = (period) => ({ currency: "Pi", gross: 42.5, fees: 2.1, net: 40.4, refunds: 1, period,
  series: Array.from({ length: period === "day" ? 1 : period === "week" ? 7 : 30 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, gross: (i % 4) + 1, net: (i % 4) + 0.9 })),
  bySource: { tips: 12.5, support: 30 }, topPosts: [{ postId: "PID", total: 9 }], topSupporters: [{ user: { handle: "khaled_dev", name: "خالد العتيبي" }, amount: 25, kind: "support" }, { user: null, amount: null, kind: "tip" }], csvUrl: `/api/me/earnings.csv?period=${period}` });
async function stub(ctx) {
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const handler = async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), p = u.pathname; let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    st.calls.push({ m, p, q: u.search, body });
    if (p === "/api/pi/config") return json(route, 200, { enabled: st.enabled, network: "testnet", sandbox: true });
    if (p === "/api/me/creator" && m === "PUT") { CREATORS.amal_tip = { enabled: body.enabled, tiers: body.tiers.map((t, i) => ({ id: t.id || "nt" + i, ...t })), showAmounts: body.showAmounts }; return json(route, 200, CREATORS.amal_tip); }
    if (p === "/api/me/creator") return json(route, 200, { showAmounts: true, ...CREATORS.amal_tip, feeBps: 250, limits: { maxTierAmount: 500, maxTiers: 3 } });
    let mm;
    if ((mm = /^\/api\/creators\/([^/]+)\/(support|wall)$/.exec(p))) {
      const hd = decodeURIComponent(mm[1]), c = CREATORS[hd]; if (!c) return json(route, 404, { error: "غير موجود" });
      if (mm[2] === "wall") return json(route, 200, { creator: { handle: hd }, period: u.searchParams.get("period"), items: (WALL[u.searchParams.get("period")] || []).map((w, i) => ({ rank: i + 1, user: w.user, amount: w.amount, count: i === 0 ? 3 : 1, kinds: [w.kind] })) });
      return json(route, 200, { creator: { id: "uid_" + hd, handle: hd, name: hd === "yousef_pi" ? "يوسف الحمادي" : hd, avatar: null, enabled: c.enabled }, tiers: c.tiers, stats: { supporters: 12, tipsCount: 87 },
        myStatus: st.myState === "none" ? { tier: null, activeUntil: null, state: "none" } : { supportId: "s1", tier: { id: "tr2", name: "شريك", amount: 5 }, activeUntil: "2026-11-16T00:00:00Z", state: st.myState }, wall: WALL.month });
    }
    if (!st.enabled) return json(route, 501, { error: "Pi payments are not configured", code: "not_configured" });
    if (p === "/api/pi/auth") return json(route, 200, { user: { id: "u" }, piUsername: "pi_amal", linked: true });
    if (p === "/api/tips/intent") {
      if (st.tipError) { const e = st.tipError; st.tipError = null; return json(route, e.status, e.body); }
      const id = "int" + st.nextIntent++; return json(route, 200, { intent: { id, amount: body.amount, memo: "إكرامية مجتمع بلس", metadata: { intentId: id, app: "mujtama", kind: "tip" } }, tipId: "tip_" + id });
    }
    if (p === "/api/support/intent") { const id = "int" + st.nextIntent++; return json(route, 200, { intent: { id, amount: 5, memo: "دعم شهري", metadata: { intentId: id, kind: "support" } }, supportId: "s1", paymentId: "sp1" }); }
    if (/^\/api\/support\/[^/]+\/cancel$/.test(p)) { st.myState = "cancelled"; return json(route, 200, { ok: true, id: "s1", state: "cancelled", activeUntil: "2026-11-16T00:00:00Z", refundEligible: false, note: "يبقى دعمك فعّالاً حتى نهاية الشهر المدفوع" }); }
    if (/^\/api\/pi\/payments\/(approve|complete|cancel)$/.test(p)) return json(route, 200, { ok: true, status: p.endsWith("complete") ? "completed" : "approved" });
    if (p === "/api/pi/payments/incomplete") return json(route, 200, { ok: true, status: "completed" });
    if (p === "/api/me/supporting") return json(route, 200, { items: [{ id: "s1", creator: { handle: "yousef_pi", name: "يوسف الحمادي" }, tier: { id: "tr2", name: "شريك", amount: 5 }, state: "active", activeUntil: "2026-11-16T00:00:00Z" }, { id: "s2", creator: { handle: "lyan_design", name: "ليان الزهراني" }, tier: { id: "x", name: "داعم", amount: 1 }, state: "due", activeUntil: "2026-10-18T00:00:00Z" }, { id: "s3", creator: { handle: "omar_startup", name: "عمر الشهري" }, tier: { id: "y", name: "داعم", amount: 3 }, state: "lapsed", activeUntil: "2026-09-01T00:00:00Z" }] });
    if (p === "/api/me/earnings") { const e = EARN(u.searchParams.get("period")); e.topPosts[0].postId = POSTS.y1; return json(route, 200, e); }
    if ((mm = /^\/api\/posts\/([^/]+)\/tips$/.exec(p))) return json(route, 200, decodeURIComponent(mm[1]) === POSTS.y1 ? { count: 3, total: 16, recent: [{ user: { handle: "khaled_dev" }, amount: 10 }, { user: null, amount: null }] } : { count: 0, total: null, recent: [] });
    if (p === "/api/admin/tips/held") return json(route, 200, { items: st.held });
    if ((mm = /^\/api\/admin\/tips\/([^/]+)\/(release|reject)$/.exec(p))) { st.held = st.held.filter(t => t.id !== mm[1]); return json(route, 200, { ok: true, id: mm[1], status: mm[2] === "release" ? "completed" : "rejected" }); } // body status ≠ HTTP status
    if (p === "/api/admin/ledger/check") return json(route, 200, { journals: 42, balanced: true, imbalances: [] });
    return json(route, 404, { error: "not stubbed" });
  };
  for (const g of ["**/api/pi/**", "**/api/tips/**", "**/api/support/**", "**/api/creators/**", "**/api/me/creator", "**/api/me/supporting", "**/api/me/earnings?*", "**/api/posts/*/tips", "**/api/admin/tips/**", "**/api/admin/ledger/**"]) await ctx.route(g, handler);
}
const FAKE_PI = () => {
  window.__pi = { payments: [] }; window.__piMode = "ok";
  window.Pi = {
    init() { }, authenticate() { return Promise.resolve({ accessToken: "fake-token", user: { uid: "uid-1", username: "pi_amal" } }); },
    createPayment(data, cb) {
      window.__pi.payments.push(JSON.parse(JSON.stringify(data))); const id = "pay_" + window.__pi.payments.length;
      setTimeout(() => cb.onReadyForServerApproval(id), 30);
      if (window.__piMode === "cancel") setTimeout(() => cb.onCancel(id), 120);
      else setTimeout(() => cb.onReadyForServerCompletion(id, "txid_" + id), 150);
    }
  };
};
const until = async (fn, arg, timeout = 12000, page = P) => { const end = Date.now() + timeout; for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140)); await page.waitForTimeout(80); } };
const calls = (p, m) => st.calls.filter(c => c.p === p && (!m || c.m === m));
async function axeOn(page, sel) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await page.evaluate(async (s) => (await axe.run(s ? document.querySelector(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const shot = (name, page = P) => process.env.TIPS_SHOTS ? page.screenshot({ path: path.join(process.env.TIPS_SHOTS, name + ".png") }) : null;
const go = async (hash) => { await P.evaluate((h) => { location.hash = h; }, hash); };
const reload = () => P.evaluate(async () => { MPPi.refresh(); return MPTips.refresh(); });

test.before(async () => {
  ensureBuild(); // dist must be current (pi/tips chunks); rebuilds only when stale — never wipes a fresh shared dist mid-run
  S = await startStack();
  ctxMain = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await stub(ctxMain); await ctxMain.addInitScript(FAKE_PI);
  P = await ctxMain.newPage(); P.on("pageerror", e => errors.push(e.message));
  await onboard(P, S.base, "amal_tip", "أمل"); // first account = admin
  // two authors (one opted in, one not) with a post each, plus a post of the viewer
  const { db } = S.app.ctx, { id } = require(path.join(ROOT, "server", "lib", "core")), at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  for (const [handle, name] of [["yousef_pi", "يوسف الحمادي"], ["reem_ai", "ريم المصري"]]) {
    const uid = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [uid, handle, name, "#047857", { onboarded: true, interests: [] }, at(60 * 24 * 90)]);
    const pid = id("p"); POSTS[handle === "yousef_pi" ? "y1" : "r1"] = pid;
    await db.run("INSERT INTO posts(id,author,type,text,topic,lang,visibility,status,created_at) VALUES($1,$2,'post',$3,'pi','ar','public','published',$4)", [pid, uid, handle === "yousef_pi" ? "نسخة جديدة من محفظة الإيصالات على Pi تدعم الفواتير المشتركة" : "تحليل المشاعر في التغريدات العربية", at(20)]);
  }
  const me = await P.evaluate(async () => (await (await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "منشوري الأول هنا", topic: "pi" }) })).json()).post);
  POSTS.mine = me.id;
  await P.reload(); await P.waitForSelector(".bottomnav a[data-r=home]");
  await until(() => !!window.MPTips && !!window.MPPi);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("lazy chunk: tips-ui is its own chunk (not in the core bundle) and loads after pi", async () => {
  const r = await P.evaluate(() => ({ tips: (window.__CHUNKS || {}).tips, loaded: { ...window.MPChunks.loaded } }));
  assert.match(r.tips, /^\/assets\/chunk-tips-.+\.js$/);
  assert.ok(r.loaded.pi && r.loaded.tips);
  const core = require("node:fs").readFileSync(path.join(ROOT, "dist", JSON.parse(require("node:fs").readFileSync(path.join(ROOT, "dist", "build.json"), "utf8")).files.find(f => /^assets\/app-.*\.js$/.test(f.file)).file), "utf8");
  assert.ok(!/MPTips/.test(core), "tips code is not in the core bundle");
});

test("Pi off: no tip buttons, support / earnings / admin hidden; #/creator still works with a note", async () => {
  st.enabled = false; await reload();
  await go("#/post/" + POSTS.y1); await P.waitForSelector(`[data-react="${POSTS.y1}"]`); await P.waitForTimeout(400);
  assert.equal(await P.$("[data-tip]"), null); assert.equal(await P.$("#tp-post"), null);
  await go("#/support/yousef_pi"); await until(() => /غير مفعّلة/.test(document.getElementById("view").textContent));
  assert.equal(await P.$(".tp-tiers"), null);
  await go("#/earnings"); await until(() => /غير مفعّلة/.test(document.getElementById("view").textContent) && /الأرباح/.test(document.getElementById("tp-h")?.textContent));
  await go("#/admin"); await P.waitForTimeout(400); assert.equal(await P.$("#tp-adm"), null);
  await go("#/creator"); await P.waitForSelector("#tp-offnote");
  assert.match(await P.textContent("#tp-offnote"), /فور تفعيل مدفوعات Pi/);
  assert.equal(await P.$("a[href='#/earnings']"), null, "no earnings link while off");
  await P.check("#tp-en"); await P.click("#tp-add"); await P.fill(".tp-tierform input[data-k=name]", "داعم"); await P.fill(".tp-tierform input[data-k=amount]", "3");
  await P.click("#tp-save"); await until(() => /حُفظت/.test(document.getElementById("toast").textContent));
  const put = calls("/api/me/creator", "PUT").at(-1);
  assert.deepEqual(put.body, { enabled: true, tiers: [{ name: "داعم", amount: 3, perks: "" }], showAmounts: true });
  CREATORS.amal_tip = { enabled: false, tiers: [] };
  st.enabled = true; await reload();
});

test("«إكرامية» only on posts by opted-in creators, never on own posts; post page shows the tips summary", async () => {
  await go("#/home"); await P.waitForSelector(`[data-react="${POSTS.y1}"]`);
  await P.waitForSelector(`[data-tip="${POSTS.y1}"]`);
  await P.waitForTimeout(300);
  assert.equal(await P.$(`[data-tip="${POSTS.r1}"]`), null, "creator not opted in");
  assert.equal(await P.$(`[data-tip="${POSTS.mine}"]`), null, "no self-tips");
  assert.equal(await P.getAttribute(`[data-tip="${POSTS.y1}"]`, "aria-label"), "إكرامية لـ يوسف الحمادي");
  await go("#/post/" + POSTS.y1); await P.waitForSelector("#tp-post:not([hidden])");
  assert.match(await P.textContent("#tp-post"), /٣ إكراميات/); assert.match(await P.textContent("#tp-post"), /16 π/); assert.match(await P.textContent("#tp-post"), /@khaled_dev، مجهول/);
  await P.waitForSelector(`#view [data-tip="${POSTS.y1}"]`);
  assert.equal(calls("/api/creators/yousef_pi/support").length >= 1, true);
});

test("tip sheet: presets, custom amount, client + server limit errors in Arabic", async () => {
  await P.click(`#view [data-tip="${POSTS.y1}"]`);
  await P.waitForSelector("#tp-form"); await P.waitForSelector("#tp-go:not([disabled])");
  assert.match(await P.textContent("#tp-st"), /إكرامية لـ يوسف الحمادي/);
  assert.equal(await P.evaluate(() => document.activeElement.id), "tp-st");
  assert.match(await P.textContent("#tp-go"), /أرسل 1 Pi/);
  await P.check("input[name=tp-a][value='10']", { force: true }); assert.match(await P.textContent("#tp-go"), /أرسل 10 Pi/);
  await P.check("#tp-cr", { force: true }); assert.equal(await P.isVisible("#tp-custom"), true);
  await P.fill("#tp-custom", "0"); await P.click("#tp-go"); assert.match(await P.textContent("#tp-err"), /أكبر من صفر/);
  await P.fill("#tp-custom", "150"); await P.click("#tp-go"); assert.match(await P.textContent("#tp-err"), /أقصى مبلغ للإكرامية الواحدة 100 Pi/);
  assert.equal(calls("/api/tips/intent").length, 0, "client-side checks stop before the server");
  st.tipError = { status: 422, body: { error: "daily limit", code: "tip_daily_limit" } };
  await P.fill("#tp-custom", "20"); await P.click("#tp-go");
  await until(() => /الحد اليومي/.test(document.getElementById("tp-err")?.textContent));
  assert.equal(await P.getAttribute("#tp-err", "role"), "alert");
  assert.equal(await P.isDisabled("#tp-go"), false, "can retry");
  assert.equal(await P.evaluate(() => window.__pi.payments.length), 0, "Pi never asked when the intent is refused");
  st.tipError = { status: 429, body: { error: "rate" } };
  await P.click("#tp-go"); await until(() => /انتظر قليلاً/.test(document.getElementById("tp-err")?.textContent));
  st.tipError = { status: 429, body: { error: "الحسابات الجديدة يمكنها إرسال 10 Pi يومياً كحد أقصى", code: "tip_daily_limit" } }; // the server's exact Arabic message wins
  await P.click("#tp-go"); await until(() => /الحسابات الجديدة يمكنها إرسال 10 Pi/.test(document.getElementById("tp-err")?.textContent));
  st.tipError = { status: 409, body: { error: "link", code: "pi_not_linked" } };
  await P.click("#tp-go"); await until(() => /اربط حساب Pi/.test(document.getElementById("tp-err")?.textContent));
  st.tipError = { status: 403, body: { error: "minor", code: "minor_restricted" } };
  await P.click("#tp-go"); await until(() => /دون 18/.test(document.getElementById("tp-err")?.textContent));
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  await shot("tip-sheet");
});

test("tip sheet: success → intent passed to Pi unchanged, approve/complete, thank-you; no confetti under reduced motion", async () => {
  await P.fill("#tp-custom", "7.5"); await P.fill("#tp-msg", "شكراً على الشرح"); await P.check("#tp-anon"); await P.uncheck("#tp-showamt");
  const n0 = calls("/api/tips/intent").length;
  await P.click("#tp-go");
  await P.waitForSelector("#tp-done");
  const ic = calls("/api/tips/intent").slice(n0);
  assert.equal(ic.length, 1);
  assert.deepEqual(ic[0].body, { postId: POSTS.y1, toHandle: "yousef_pi", amount: 7.5, message: "شكراً على الشرح", anonymous: true, showAmount: false });
  const pay = await P.evaluate(() => window.__pi.payments.at(-1));
  const intentId = "int" + (st.nextIntent - 1);
  assert.deepEqual(pay, { amount: 7.5, memo: "إكرامية مجتمع بلس", metadata: { intentId, app: "mujtama", kind: "tip" } }, "exactly as returned by /api/tips/intent");
  assert.equal(calls("/api/pi/payments", "POST").length, 0, "no generic intent: the tips endpoint made it");
  assert.equal(calls("/api/pi/payments/approve").at(-1).body.paymentId, "pay_" + (await P.evaluate(() => window.__pi.payments.length)));
  assert.ok(calls("/api/pi/payments/complete").length >= 1);
  assert.match(await P.textContent("#tp-done"), /وصلت إكراميتك/); assert.match(await P.textContent("#tp-done"), /مجهول الهوية/);
  assert.equal(await P.getAttribute("#tp-rc", "href"), "#/receipt/" + intentId);
  assert.equal(await P.evaluate(() => document.activeElement.id), "tp-done");
  assert.equal(await P.$(".tp-burst"), null, "reduced motion: no confetti");
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  await P.evaluate(() => closeSheet());
});

test("tip sheet: cancelling in Pi keeps the sheet usable; celebration shows coins when motion is allowed", async () => {
  await P.click(`#view [data-tip="${POSTS.y1}"]`); await P.waitForSelector("#tp-go:not([disabled])");
  await P.evaluate(() => { window.__piMode = "cancel"; });
  await P.click("#tp-go"); await until(() => /أُلغيت عملية الدفع/.test(document.getElementById("tp-note")?.textContent));
  assert.equal(await P.isDisabled("#tp-go"), false); assert.ok(calls("/api/pi/payments/cancel").length >= 1);
  await P.evaluate(() => { window.__piMode = "ok"; });
  await P.emulateMedia({ reducedMotion: "no-preference" });
  await P.click("#tp-go"); await P.waitForSelector("#tp-done");
  const burst = await P.evaluate(() => { const b = document.querySelector(".tp-burst"); return b && { coins: b.querySelectorAll("i.c").length, hidden: b.getAttribute("aria-hidden") }; });
  assert.ok(burst && burst.coins > 0, "coins + confetti"); assert.equal(burst.hidden, "true");
  await P.emulateMedia({ reducedMotion: "reduce" });
  await P.evaluate(() => closeSheet());
});

test("#/support/:handle: tiers, stats, honour roll tabs, subscribe through Pi, then cancel", async () => {
  st.myState = "none";
  await go("#/support/yousef_pi"); await P.waitForSelector(".tp-tiers");
  assert.equal(await P.$$eval(".tp-tier", n => n.length), 3);
  assert.match(await P.textContent(".tip-stats"), /١٢/); assert.match(await P.textContent(".tip-stats"), /٨٧/);
  await P.waitForSelector("#tp-wall .tp-wall li");
  assert.match(calls("/api/creators/yousef_pi/wall").at(-1).q, /period=month/);
  assert.equal(await P.$$eval("#tp-wall li", n => n.length), 3);
  assert.match(await P.textContent("#tp-wall"), /داعم مجهول/);
  await until(() => /×٣/.test(document.getElementById("tp-wall").textContent)); // server leaderboard rows: rank / count / kinds
  await P.focus("#tp-tab-month"); await P.keyboard.press("ArrowLeft");
  await until(() => document.getElementById("tp-tab-all").getAttribute("aria-selected") === "true" && /عمر الشهري/.test(document.getElementById("tp-wall").textContent));
  assert.match(calls("/api/creators/yousef_pi/wall").at(-1).q, /period=all/);
  assert.equal(await P.evaluate(() => document.activeElement.id), "tp-tab-all");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("support");
  const n0 = calls("/api/support/intent").length;
  await P.check("#tp-sanon");
  st.myState = "active"; // what the server reports after the payment completes
  await P.click("[data-tp-sub=tr2]");
  await until(() => !!document.querySelector("[data-tp-cancel]"));
  assert.deepEqual(calls("/api/support/intent").slice(n0)[0].body, { toHandle: "yousef_pi", tierId: "tr2", anonymous: true, showAmount: true });
  const pay = await P.evaluate(() => window.__pi.payments.at(-1));
  assert.equal(pay.metadata.kind, "support"); assert.equal(pay.amount, 5);
  await P.waitForSelector(".tp-tier.on [data-tp-cancel]", { timeout: 5000 }); // current tier highlighted
  await P.click("[data-tp-cancel]"); await P.waitForSelector("[role=alertdialog]");
  assert.match(await P.textContent("#tp-cd"), /24 ساعة/);
  await P.click("#tp-cy"); await until(() => !document.querySelector("[data-tp-cancel]") && !!document.querySelector("[data-tp-sub=tr2]"));
  assert.equal(calls("/api/support/s1/cancel", "POST").length, 1);
  assert.match(await P.textContent("[data-tp-sub=tr2]"), /ادعم مجدداً/);
  assert.match(await P.textContent("#toast"), /حتى نهاية الشهر المدفوع/, "the server's cancel note is shown");
  st.myState = "due"; await P.evaluate(() => route()); await until(() => /جدّد الدعم/.test(document.querySelector("[data-tp-sub=tr2]")?.textContent));
});

test("#/me/supporting: state chips, renew links, cancel asks first", async () => {
  await go("#/me/supporting"); await P.waitForSelector("#tp-sl .tp-row");
  assert.equal(await P.$$eval("#tp-sl .tp-row", n => n.length), 3);
  const txt = await P.textContent("#tp-sl"); assert.match(txt, /نشط/); assert.match(txt, /مستحق التجديد/); assert.match(txt, /منتهٍ/);
  assert.ok(await P.$("#tp-sl a[href='#/support/lyan_design']"));
  assert.deepEqual(await axeOn(P, "#view"), []);
  const n0 = calls("/api/support/s1/cancel").length;
  await P.click("[data-tp-c=s1]"); await P.waitForSelector("#tp-cy"); await P.click("#tp-cy");
  await until(() => !document.getElementById("tp-cy"));
  assert.equal(calls("/api/support/s1/cancel").length, n0 + 1);
  await go("#/me"); await P.waitForTimeout(300); assert.equal(await P.$("#tp-sl"), null, "#/me is still the profile");
});

test("notification links: #/supporting, #/u/<handle>/support and #/earnings open the right screens; #/u/<handle> is still the profile", async () => {
  await go("#/supporting"); await P.waitForSelector("#tp-sl .tp-row");
  await go("#/u/yousef_pi/support"); await P.waitForSelector("#tp-sup[data-h=yousef_pi] .tp-tiers");
  await go("#/u/yousef_pi"); await P.waitForTimeout(400); assert.equal(await P.$("#tp-sup"), null);
  await go("#/earnings"); await P.waitForSelector("#tp-eb .tp-kpi");
});

test("#/creator: up to 3 tiers, validation, saved with PUT /api/me/creator", async () => {
  await go("#/creator"); await P.waitForSelector("#tp-cf");
  assert.equal(await P.$("#tp-offnote"), null);
  await P.check("#tp-en"); await P.uncheck("#tp-show");
  assert.match(await P.textContent("#tp-cf"), /رسوم المنصة ٢٫٥٪/);
  for (let i = 0; i < 3; i++) await P.click("#tp-add");
  assert.equal(await P.getAttribute(".tp-tierform input[data-k=amount]", "max"), "500", "limits.maxTierAmount");
  assert.equal(await P.isHidden("#tp-add"), true, "max 3 tiers");
  assert.equal(await P.evaluate(() => document.activeElement.dataset.k), "name", "focus moves to the new tier");
  const f = (i, k) => `.tp-tierform[data-i="${i}"] [data-k=${k}]`;
  await P.fill(f(0, "name"), "داعم"); await P.fill(f(0, "amount"), "1"); await P.fill(f(0, "perks"), "شكراً");
  await P.fill(f(1, "name"), "شريك"); await P.fill(f(1, "amount"), "0");
  await P.click("#tp-save"); assert.match(await P.textContent("#tp-cerr"), /المستوى ٢/);
  await P.click("[data-rm='2']"); assert.equal(await P.$$eval(".tp-tierform", n => n.length), 2); assert.equal(await P.isHidden("#tp-add"), false);
  await P.fill(f(1, "amount"), "5");
  await P.click("#tp-save"); await until(() => /حُفظت/.test(document.getElementById("toast").textContent));
  assert.deepEqual(calls("/api/me/creator", "PUT").at(-1).body, { enabled: true, showAmounts: false, tiers: [{ name: "داعم", amount: 1, perks: "شكراً" }, { name: "شريك", amount: 5, perks: "" }] });
  assert.equal(await P.$$eval(".tp-tierform input[data-k=id]", n => n.length), 2, "server ids kept for the next save");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("creator");
});

test("#/earnings: period switch, gross / fees / net, SVG chart with a text alternative, top posts, CSV", async () => {
  await go("#/earnings"); await P.waitForSelector("#tp-eb .tp-kpi");
  assert.match(calls("/api/me/earnings").at(-1).q, /period=month/);
  const k = await P.textContent(".tp-kpi"); assert.match(k, /42\.5 π/); assert.match(k, /2\.1 π/); assert.match(k, /40\.4 π/);
  assert.equal(await P.$$eval("svg.tp-chart rect.g", n => n.length), 30);
  assert.equal(await P.getAttribute("svg.tp-chart", "role"), "img"); assert.match(await P.textContent("#tp-ch-t"), /إجمالي/);
  assert.equal(await P.$$eval(".tp-sr tbody tr", n => n.length), 30);
  assert.ok(await P.$(`#tp-eb a[href="#/post/${POSTS.y1}"]`));
  assert.equal(await P.getAttribute("#tp-csv", "href"), "/api/me/earnings.csv?period=month");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("earnings");
  await P.click("[data-p=week]"); await until(() => document.querySelectorAll("svg.tp-chart rect.g").length === 7);
  assert.match(calls("/api/me/earnings").at(-1).q, /period=week/);
  assert.equal(await P.getAttribute("[data-p=week]", "aria-pressed"), "true");
  assert.equal(await P.getAttribute("#tp-csv", "href"), "/api/me/earnings.csv?period=week");
});

test("#/admin: held tips card → #/admin/tips, release / reject, ledger check", async () => {
  await go("#/admin"); await P.waitForSelector("#tp-adm");
  await P.click("#tp-adm"); await P.waitForSelector("#tp-held .tp-row");
  assert.equal(await P.$$eval("[data-held]", n => n.length), 2);
  assert.match(await P.textContent("[data-held=t9]"), /@fast_sender/); assert.match(await P.textContent("[data-held=t9]"), /velocity/);
  assert.equal(await P.$("#pi-adm"), null, "the Pi card is not injected into the tips page");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await shot("admin-tips");
  await P.click("[data-held=t9] [data-act=release]"); await until(() => document.querySelectorAll("[data-held]").length === 1);
  assert.equal(calls("/api/admin/tips/t9/release", "POST").length, 1);
  assert.match(await P.textContent("#toast"), /أُفرج/, "body status:completed did not break the 200 handling");
  await P.click("[data-held=t10] [data-act=reject]"); await until(() => /لا إكراميات معلّقة/.test(document.getElementById("tp-held").textContent));
  assert.equal(calls("/api/admin/tips/t10/reject", "POST").length, 1);
  await P.click("#tp-lc"); await until(() => /متوازن/.test(document.getElementById("tp-lcr").textContent));
  assert.match(await P.textContent("#tp-lcr"), /٤٢ قيد/);
  await go("#/admin/pi"); await P.waitForSelector("#pi-h"); // the Pi admin page still works through the wrapped route
});
