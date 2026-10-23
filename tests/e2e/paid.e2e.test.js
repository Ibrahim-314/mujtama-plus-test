/* global MPPaid, MPPi, route */
/* Phase 38 (client): subscriber-only & pay-per-view posts in a real browser against the production build. The paid API
 * (/api/paid/*, /api/me/purchases, /api/me/paid-posts, /api/admin/paid/*) and Pi (/api/pi/*, fake window.Pi) are stubbed
 * per BRIEF-P38.md; /api/bootstrap is passed through the real server and its posts are rewritten into the locked / unlocked
 * shapes the P38 server sends. Users and posts are real rows. POST /api/posts is NOT stubbed: it reaches the real P38 server,
 * which validates `paid` against the DB, so the composer's creator profile + tiers are seeded as real rows (same ids as the
 * stubbed GET /api/me/creator) and the stored paid_posts rows are asserted.
 * The locked stubs deliberately still carry media / images (and one has no text) to prove the client never renders them.
 * Covers: lazy "paid" chunk (not in core), Pi off (no buy button, Arabic note, teasers still render, composer options
 * disabled), locked PPV + supporters cards (teaser, blurred placeholder, tiers CTA), post page lock, unlock through
 * MPPi.pay with the intent exactly as returned, errors, cancel, unlocked state, composer options → `paid` on POST /api/posts,
 * #/me/purchases + refund request, #/me/paid-posts, #/admin card + #/admin/paid (approve / reject), axe on every screen,
 * and the real CSP (no 'unsafe-inline') with no violations while buying. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { ensureBuild, startStack, onboard, MOBILE, ROOT } = require("./harness");
let S, P, ctxMain, AMAL; const errors = [];
const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
const POSTS = {};
const SECRET_PPV = "سرّ-مدفوع-PPV-BODY-7781", SECRET_SUP = "سرّ-الداعمين-SUP-BODY-4410";
const TEASER_PPV = "دليل عملي لبناء تطبيق على Pi خطوة بخطوة — الجزء الأول مجاني";
const TIERS = [{ id: "tr1", name: "داعم", amount: 2 }, { id: "tr2", name: "شريك", amount: 5 }, { id: "tr3", name: "راعٍ ذهبي", amount: 20 }];

/* ---------- contract stub ---------- */
const st = { enabled: true, calls: [], posted: [], nextIntent: 1, unlocked: false, intentError: null, refunds: null, purchases: null };
const resetData = () => {
  // shapes as in p38-server services/paid.js (myPurchases / refundList)
  st.purchases = [{ id: "pu1", postId: POSTS.ppv, post: { id: POSTS.ppv, title: null, teaser: TEASER_PPV, type: "post", status: "published", author: { handle: "yousef_pi", name: "يوسف" } }, amount: 3, status: "completed", createdAt: new Date(Date.now() - 3600e3).toISOString(), completedAt: new Date(Date.now() - 3600e3).toISOString(), refundEligible: true, refundUntil: new Date(Date.now() + 20 * 3600e3).toISOString(), refundRequest: null },
    { id: "pu2", postId: "gone", post: null, amount: 1.5, status: "refunded", createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), refundEligible: false, refundUntil: null, refundRequest: { id: "rq0", status: "approved", kind: "deleted" } }];
  st.refunds = [{ id: "rf1", purchaseId: "pu9", postId: POSTS.ppv, kind: "edited", reason: "تغيّر المحتوى كلياً", status: "pending", note: null, createdAt: new Date().toISOString(), amount: 3, intentId: "int_x", buyer: { id: "u7", handle: "sara_learn", name: "سارة" }, creator: { id: "u1", handle: "yousef_pi", name: "يوسف" }, post: { id: POSTS.ppv, title: null, status: "published" } },
    { id: "rf2", purchaseId: "pu8", postId: POSTS.free, kind: "deleted", reason: null, status: "pending", createdAt: new Date().toISOString(), amount: 1, buyer: { handle: "khaled_dev" }, creator: { handle: "reem_ai" }, post: { id: POSTS.free, status: "deleted" } }];
};
function patchPost(p) {
  if (p.id === POSTS.ppv && !st.unlocked) return { ...p, text: TEASER_PPV, teaser: TEASER_PPV, media: "/media/LEAK-ppv-cover.jpg", images: ["/media/LEAK-ppv-1.jpg"], locked: true, lock: { mode: "ppv", price: 3, minTier: null, tiers: [], purchasable: st.enabled, reason: st.enabled ? null : "not_configured", media: { images: 2, media: true, cover: false, video: false, audio: false } } };
  if (p.id === POSTS.ppv) return { ...p, paid: { mode: "ppv", price: 3, minTierId: null }, teaser: TEASER_PPV, locked: false };
  if (p.id === POSTS.sup) { const { text: _t, ...rest } = p; return { ...rest, teaser: "للداعمين: كواليس الإصدار القادم…", media: "/media/LEAK-sup.jpg", locked: true, lock: { mode: "supporters", price: null, minTier: { id: "tr2", name: "شريك", amount: 5 }, tiers: TIERS.slice(1), purchasable: true, reason: null, media: { images: 0, media: true, cover: false, video: false, audio: false } } }; }
  if (p.id === POSTS.mine) return { ...p, paid: { mode: "ppv", price: 4, minTierId: null }, teaser: p.text, locked: false };
  return p;
}
async function stub(ctx) {
  const rt = (g, fn) => ctx.route(g, async (r) => { try { await fn(r); } catch (e) { if (!/disposed|closed|Target page/i.test(e.message)) throw e; } }); // in-flight requests when a context closes
  const json = (r, status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  // every other real-server list (digest, explore, search…) answers like the P38 server would: teasers, never the body
  const clean = (v) => typeof v === "string" ? v.replace(SECRET_PPV, "").replace("كواليس " + SECRET_SUP, "للداعمين: كواليس الإصدار القادم…").trim() : Array.isArray(v) ? v.map(clean) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v;
  await rt("**/api/**", async (r) => {
    const req = r.request(); if (req.method() !== "GET" || /\/api\/(stream|media)/.test(req.url())) return r.fallback();
    const res = await r.fetch(); if (!/json/.test(res.headers()["content-type"] || "")) return r.fulfill({ response: res });
    return r.fulfill({ response: res, json: clean(await res.json()) });
  });
  await rt("**/api/bootstrap", async (r) => { const res = await r.fetch(); const j = await res.json(); if (Array.isArray(j.posts)) j.posts = j.posts.map(patchPost); return r.fulfill({ response: res, json: j }); });
  await rt("**/api/posts/*", async (r) => { if (r.request().method() !== "GET") return r.fallback(); const res = await r.fetch(); const j = await res.json(); if (j.post) j.post = patchPost(j.post); st.calls.push({ m: "GET", p: new URL(r.request().url()).pathname }); return r.fulfill({ response: res, json: j }); });
  await rt("**/api/posts", async (r) => { const req = r.request(); if (req.method() === "POST") { try { st.posted.push(req.postDataJSON()); } catch { } } return r.continue(); });
  const handler = async (r) => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), p = u.pathname; let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    st.calls.push({ m, p, body });
    if (p === "/api/pi/config") return json(r, 200, { enabled: st.enabled, authEnabled: true, network: "testnet", sandbox: true, paidMaxPrice: 100 });
    if (p === "/api/me/creator") return json(r, 200, { enabled: true, showAmounts: true, tiers: TIERS, feeBps: 250, limits: { maxTierAmount: 500, maxTiers: 3 } });
    if (/^\/api\/creators\//.test(p)) return json(r, 200, { creator: { handle: "yousef_pi", enabled: false }, tiers: [], stats: {}, myStatus: { state: "none" }, wall: [] });
    if (p === "/api/me/purchases") return json(r, 200, { items: st.purchases });
    if (p === "/api/me/paid-posts") return json(r, 200, { currency: "Pi", feeBps: 250, items: [{ postId: POSTS.mine, title: null, teaser: "منشوري المدفوع", type: "post", status: "published", state: "active", mode: "ppv", price: 4, minTier: null, unlocks: 7, revenue: 27.3, net: 26.6, refunds: 1, createdAt: new Date().toISOString() }, { postId: POSTS.free, teaser: "للداعمين", mode: "supporters", price: null, minTier: { id: "tr2", name: "شريك", amount: 5 }, unlocks: 0, revenue: 0, net: 0, refunds: 0 }] });
    if (p === "/api/admin/paid/refunds") return json(r, 200, { items: st.refunds });
    let mm;
    if ((mm = /^\/api\/admin\/paid\/refunds\/([^/]+)\/(approve|reject)$/.exec(p))) { st.refunds = st.refunds.filter(x => x.id !== mm[1]); return json(r, 200, { ok: true, id: mm[1], status: mm[2] === "approve" ? "refunded" : "rejected" }); }
    if (!st.enabled) return json(r, 501, { error: "Pi payments are not configured", code: "not_configured" });
    if ((mm = /^\/api\/paid\/purchases\/([^/]+)\/refund-request$/.exec(p))) { const pu = st.purchases.find(x => x.id === mm[1]); pu.refundEligible = false; pu.refundRequest = { id: "rf9", purchaseId: pu.id, kind: "edited", reason: body?.reason || null, status: "pending" }; return json(r, 200, { request: pu.refundRequest }); }
    if ((mm = /^\/api\/paid\/([^/]+)\/intent$/.exec(p))) {
      if (st.intentError) { const e = st.intentError; st.intentError = null; return json(r, e.status, e.body); }
      const id = "int" + st.nextIntent++; return json(r, 200, { intent: { id, amount: 3, memo: "فتح منشور مدفوع — مجتمع بلس", metadata: { intentId: id, app: "mujtama", kind: "ppv" } }, purchaseId: "pu_" + id });
    }
    if (p === "/api/pi/auth") return json(r, 200, { user: { id: "u" }, piUsername: "pi_amal", linked: true });
    if (p === "/api/pi/payments/complete") { st.unlocked = true; return json(r, 200, { ok: true, receipt: { status: "completed" } }); }
    if (/^\/api\/pi\/payments\/(approve|cancel|incomplete)$/.test(p)) return json(r, 200, { ok: true, status: "approved" });
    if (p === "/api/pi/link") return json(r, 200, { linked: true, piUsername: "pi_amal", network: "testnet" });
    return json(r, 404, { error: "not stubbed" });
  };
  for (const g of ["**/api/pi/**", "**/api/paid/**", "**/api/me/purchases", "**/api/me/paid-posts", "**/api/me/creator", "**/api/creators/**", "**/api/admin/paid/**"]) await rt(g, handler);
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
  return (await page.evaluate(async (s) => (await axe.run(typeof s === "object" && s ? s : s ? document.querySelector(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const go = async (hash) => { await P.evaluate((h) => { location.hash = h; }, hash); };
const reload = () => P.evaluate(async () => { MPPi.refresh(); return MPPaid.refresh(); });
const leaks = () => P.evaluate(([a, b]) => { const html = document.documentElement.innerHTML; const r = { body: html.includes(a) || html.includes(b), media: /LEAK-/.test(html) }; if (r.body || r.media) { const i = Math.max(html.indexOf(a), html.indexOf(b), html.search(/LEAK-/)); console.log("LEAKDBG " + html.slice(Math.max(0, i - 600), i + 100)); } return r; }, [SECRET_PPV, SECRET_SUP]);

test.before(async () => {
  ensureBuild(); // rebuilds dist only when stale — never wipes a fresh shared dist mid-run
  S = await startStack();
  ctxMain = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await stub(ctxMain); await ctxMain.addInitScript(FAKE_PI);
  P = await ctxMain.newPage(); P.on("pageerror", e => errors.push(e.message)); P.on("console", m => { if (/LEAKDBG/.test(m.text())) console.error(m.text()); });
  await onboard(P, S.base, "amal_paid", "أمل"); // first account = admin
  const { db } = S.app.ctx, { id } = require(path.join(ROOT, "server", "lib", "core")), at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  // the real P38 server validates `paid` on POST /api/posts against the DB (creator_settings.enabled → 409 creator_disabled,
  // creator_tiers → 409 no_tiers / 400 tier_invalid), so the composer's creator profile + tiers (stubbed GET /api/me/creator)
  // must also exist as real rows with the same ids, or every paid publish is refused and the composer stays open.
  const amal = (AMAL = await db.get("SELECT id FROM users WHERE handle=$1", ["amal_paid"])), now = at(0);
  await db.run("INSERT INTO creator_settings(user_id,enabled,show_amounts,created_at,updated_at) VALUES($1,1,1,$2,$2)", [amal.id, now]);
  for (const [i, t] of TIERS.entries()) await db.run("INSERT INTO creator_tiers(id,creator_id,name,amount,perks,position,active,created_at,updated_at) VALUES($1,$2,$3,$4,'',$5,1,$6,$6)", [t.id, amal.id, t.name, t.amount * 1e7, i, now]);
  const uid = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [uid, "yousef_pi", "يوسف الحمادي", "#047857", { onboarded: true, interests: [] }, at(60 * 24 * 90)]);
  for (const [k, text, min] of [["ppv", TEASER_PPV + " " + SECRET_PPV, 10], ["sup", "كواليس " + SECRET_SUP, 20], ["free", "منشور مجاني للجميع عن Pi", 30]]) {
    const pid = id("p"); POSTS[k] = pid;
    await db.run("INSERT INTO posts(id,author,type,text,topic,lang,visibility,status,created_at) VALUES($1,$2,'post',$3,'pi','ar','public','published',$4)", [pid, uid, text, at(min)]);
  }
  const me = await P.evaluate(async () => (await (await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" }, body: JSON.stringify({ text: "منشوري المدفوع هنا", topic: "pi" }) })).json()).post);
  POSTS.mine = me.id; resetData(); st.posted = [];
  await P.reload(); await P.waitForSelector(".bottomnav a[data-r=home]");
  await until(() => !!window.MPPaid && !!window.MPPi && !!window.MPTips);
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("lazy chunk: paid-ui is its own chunk (not in the core bundle), loaded after tips", async () => {
  const r = await P.evaluate(() => ({ paid: (window.__CHUNKS || {}).paid, loaded: { ...window.MPChunks.loaded } }));
  assert.match(r.paid, /^\/assets\/chunk-paid-.+\.js$/);
  assert.ok(r.loaded.pi && r.loaded.tips && r.loaded.paid);
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8"));
  const core = fs.readFileSync(path.join(ROOT, "dist", b.files.find(f => /^assets\/app-.*\.js$/.test(f.file)).file), "utf8");
  assert.ok(!/MPPaid|pd-lock|\/api\/paid\//.test(core), "paid code is not in the core bundle");
  assert.ok(b.files.find(f => /^assets\/app-.*\.js$/.test(f.file)).br <= 90 * 1024, "core ≤ 90 KB br");
});

test("Pi off: locked teasers still render with an Arabic note, no buy button; composer paid options disabled", async () => {
  st.enabled = false; await reload();
  try { await piOff(); } finally { await P.evaluate(() => document.getElementById("c3-x")?.click()); st.enabled = true; await reload(); }
});
async function piOff() {
  await go("#/home"); await P.evaluate(() => route());
  await P.waitForSelector(`[data-pd-lock="${POSTS.ppv}"]`);
  assert.equal(await P.$("[data-pd-buy]"), null, "no buy buttons while Pi is off");
  assert.match(await P.textContent(`[data-pd-lock="${POSTS.ppv}"]`), /مدفوعات Pi غير مفعّلة بعد/);
  assert.match(await P.textContent(`[data-pd-lock="${POSTS.ppv}"]`), /3 π/);
  const card = await P.$(`[data-pd-lock="${POSTS.ppv}"]`); const cardText = await card.evaluate(n => n.closest(".card").textContent);
  assert.match(cardText, /دليل عملي لبناء تطبيق/, "teaser shown");
  assert.match(await P.textContent(`[data-pd-lock="${POSTS.sup}"]`), /مدفوعات Pi غير مفعّلة بعد/);
  assert.ok(await P.$(`[data-pd-lock="${POSTS.sup}"] a[href="#/support/yousef_pi"]`), "tiers link still there (page explains Pi is off)");
  assert.deepEqual(await leaks(), { body: false, media: false });
  await P.evaluate(() => document.getElementById("fab").click()); await P.waitForSelector("#composer3 #pd-opts", { state: "attached" });
  await until(() => document.querySelector("#pd-opts input[value=ppv]")?.disabled === true);
  assert.match(await P.textContent("#pd-cnote"), /فور تفعيل مدفوعات Pi/);
  assert.equal(await P.isDisabled("#pd-opts input[value=free]"), false);
}

test("feed: locked PPV + supporters cards (teaser, blurred media placeholder, no body / media), own paid post badge", async () => {
  await go("#/home"); await P.evaluate(() => route());
  await P.waitForSelector(`[data-pd-buy="${POSTS.ppv}"]`);
  assert.equal(await P.getAttribute(`[data-pd-buy="${POSTS.ppv}"]`, "aria-label"), "افتح المنشور مقابل 3 Pi");
  assert.equal(await P.getAttribute(`[data-pd-lock="${POSTS.ppv}"]`, "aria-labelledby"), "pd-l-" + POSTS.ppv);
  const blur = await P.evaluate((pid) => document.querySelector(`[data-pd-lock="${pid}"]`).previousElementSibling?.getAttribute("aria-label"), POSTS.ppv);
  assert.match(blur, /٢ وسائط مقفلة/); // images 2 (+ media = the first image)
  const sup = await P.textContent(`[data-pd-lock="${POSTS.sup}"]`);
  assert.match(sup, /للداعمين فقط/); assert.match(sup, /«شريك» فأعلى/); assert.match(sup, /راعٍ ذهبي/);
  assert.equal(await P.$(`[data-pd-lock="${POSTS.sup}"] [data-pd-buy]`), null, "supporters posts are unlocked by supporting, not buying");
  assert.match(await P.evaluate((pid) => document.querySelector(`[data-pd-lock="${pid}"]`).closest(".card").textContent, POSTS.sup), /كواليس الإصدار القادم/, "teaser used when text is missing");
  assert.equal(await P.$(`[data-pd-lock="${POSTS.free}"]`), null);
  assert.deepEqual(await leaks(), { body: false, media: false });
  assert.equal(await P.evaluate((pid) => S.post(pid).media, POSTS.ppv) !== null, true, "store copy untouched (render uses a clone)");
  const mine = await P.evaluate((pid) => document.querySelector(`#view [data-react="${pid}"]`)?.closest(".card")?.querySelector(".pd-badge")?.textContent, POSTS.mine);
  assert.match(mine, /منشورك المدفوع/); assert.match(mine, /4 π/);
  assert.deepEqual(await axeOn(P, { include: [["#view"]], exclude: [["#view .empty"]] }), []); // the home empty-state link is pre-existing core markup
  await P.click(`[data-pd-lock="${POSTS.sup}"] [data-pd-tiers]`); await until(() => location.hash === "#/support/yousef_pi");
});

test("post page: lock card, teaser only", async () => {
  await go("#/post/" + POSTS.ppv); await P.waitForSelector(`#view [data-pd-buy="${POSTS.ppv}"]`);
  assert.deepEqual(await leaks(), { body: false, media: false });
  assert.deepEqual(await axeOn(P, "#view"), []);
});

test("unlock: errors in Arabic, cancel keeps the sheet usable", async () => {
  await P.click(`#view [data-pd-buy="${POSTS.ppv}"]`); await P.waitForSelector("#pd-go:not([disabled])");
  // the core sheet helper focuses the first button at 60 ms and the paid sheet moves focus back to its title at 90 ms
  await until(() => document.activeElement?.id === "pd-st", null, 2000);
  assert.match(await P.textContent("#pd-sd"), /3 π/);
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  st.intentError = { status: 403, body: { error: "minor", code: "minor_restricted" } };
  await P.click("#pd-go"); await until(() => /دون 18/.test(document.getElementById("pd-err")?.textContent));
  assert.equal(await P.getAttribute("#pd-err", "role"), "alert");
  st.intentError = { status: 400, body: { error: "own", code: "own_post" } };
  await P.click("#pd-go"); await until(() => /هذا منشورك/.test(document.getElementById("pd-err")?.textContent));
  st.intentError = { status: 501, body: { error: "Pi payments are not configured", code: "not_configured" } };
  await P.click("#pd-go"); await until(() => /غير مفعّلة بعد/.test(document.getElementById("pd-err")?.textContent));
  assert.equal(await P.evaluate(() => window.__pi.payments.length), 0, "Pi never asked when the intent is refused");
  await P.evaluate(() => { window.__piMode = "cancel"; });
  await P.click("#pd-go"); await until(() => /أُلغيت عملية الدفع/.test(document.getElementById("pd-note")?.textContent));
  assert.equal(await P.isDisabled("#pd-go"), false);
  await P.evaluate(() => { window.__piMode = "ok"; });
  assert.equal(st.unlocked, false);
});

test("unlock: intent → Pi.createPayment unchanged → approve/complete → full post replaces the teaser", async () => {
  const n0 = calls(`/api/paid/${POSTS.ppv}/intent`).length;
  await P.click("#pd-go");
  await until(() => !document.querySelector("#sheet .pd-sheet"));
  assert.equal(calls(`/api/paid/${POSTS.ppv}/intent`, "POST").length, n0 + 1);
  const intentId = "int" + (st.nextIntent - 1);
  assert.deepEqual(await P.evaluate(() => window.__pi.payments.at(-1)), { amount: 3, memo: "فتح منشور مدفوع — مجتمع بلس", metadata: { intentId, app: "mujtama", kind: "ppv" } }, "exactly as returned");
  assert.equal(calls("/api/pi/payments", "POST").length, 0, "no generic intent");
  assert.ok(calls("/api/pi/payments/complete").length >= 1);
  assert.ok(calls("/api/posts/" + POSTS.ppv, "GET").length >= 1, "the post is re-fetched after complete");
  await until((s) => document.getElementById("view").textContent.includes(s), SECRET_PPV);
  assert.equal(await P.$(`[data-pd-lock="${POSTS.ppv}"]`), null);
  assert.match(await P.textContent("#view .pd-badge"), /مفتوح لك/);
  assert.equal(await P.$(".tp-burst"), null, "reduced motion: no confetti");
  assert.deepEqual(await axeOn(P, "#view"), []);
});

test("composer: free / supporters (min tier) / PPV (price, teaser) → `paid` on POST /api/posts; price validated", async () => {
  await go("#/home");
  await P.evaluate(() => document.getElementById("fab").click()); await P.waitForSelector("#composer3 #pd-opts", { state: "attached" });
  await P.evaluate(() => { document.querySelector("#composer3 .c3-opts").open = true; });
  await until(() => document.querySelector("#pd-opts input[value=ppv]")?.disabled === false && document.querySelectorAll("#pd-tier option").length === 4);
  assert.equal(await P.isHidden("#pd-pricew"), true);
  assert.deepEqual(await axeOn(P, "#pd-opts"), []);
  await P.fill("#c3-text", "محتوى حصري عن عقود Pi الذكية");
  await P.check("#pd-opts input[value=ppv]"); assert.equal(await P.isVisible("#pd-price"), true); assert.equal(await P.isVisible("#pd-teaser"), true);
  await P.fill("#pd-price", "0"); await P.click("#c3-pub");
  assert.match(await P.textContent("#pd-cerr"), /بين 0.01 و100 Pi/);
  await P.fill("#pd-price", "150"); await P.click("#c3-pub"); assert.match(await P.textContent("#pd-cerr"), /بين 0.01 و100 Pi/);
  assert.ok(await P.$("#composer3"), "publish was stopped"); assert.equal(st.posted.length, 0);
  await P.fill("#pd-price", "2.5"); await P.fill("#pd-teaser", "مقدمة مجانية قصيرة");
  await P.click("#c3-pub"); await P.waitForSelector("#composer3", { state: "detached" });
  await until(() => true); const b1 = st.posted.at(-1);
  assert.deepEqual(b1.paid, { mode: "ppv", price: 2.5, teaser: "مقدمة مجانية قصيرة" });
  await P.evaluate(() => document.getElementById("fab").click()); await P.waitForSelector("#composer3 #pd-opts", { state: "attached" });
  await until(() => document.querySelectorAll("#pd-tier option").length === 4);
  await P.evaluate(() => { document.querySelector("#composer3 .c3-opts").open = true; });
  await P.fill("#c3-text", "للداعمين: خطة الشهر القادم");
  await P.check("#pd-opts input[value=supporters]"); await P.selectOption("#pd-tier", "tr2");
  await P.click("#c3-pub"); await P.waitForSelector("#composer3", { state: "detached" });
  assert.deepEqual(st.posted.at(-1).paid, { mode: "supporters", minTierId: "tr2" });
  await P.evaluate(() => document.getElementById("fab").click()); await P.waitForSelector("#composer3 #pd-opts", { state: "attached" });
  await P.fill("#c3-text", "منشور عادي مجاني"); await P.click("#c3-pub"); await P.waitForSelector("#composer3", { state: "detached" });
  assert.equal(st.posted.at(-1).paid, undefined, "free posts carry no paid field");
  // and the real server accepted + stored both paid choices (not just the request body)
  const rows = await S.app.ctx.db.all("SELECT mode, price, min_tier_id FROM paid_posts WHERE creator_id=$1 ORDER BY created_at", [AMAL.id]);
  assert.deepEqual(rows.map(r => [r.mode, Number(r.price), r.min_tier_id || null]), [["ppv", 2.5e7, null], ["supporters", 0, "tr2"]]);
});

test("#/me/purchases: status chips, receipt, refund request", async () => {
  await go("#/me/purchases"); await P.waitForSelector("#pd-pl .pd-row");
  assert.equal(await P.$$eval("#pd-pl .pd-row", n => n.length), 2);
  const t = await P.textContent("#pd-pl"); assert.match(t, /مفتوح لك/); assert.match(t, /مُسترد/); assert.match(t, /دليل عملي/); assert.match(t, /لم يعد متاحاً/); assert.match(t, /يمكن طلب الاسترداد حتى/);
  assert.ok(await P.$(`#pd-pl a[href="#/post/${POSTS.ppv}"]`));
  assert.equal(await P.$$eval("[data-pd-ref]", n => n.length), 1, "only refundable purchases");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("[data-pd-ref=pu1]"); await P.waitForSelector("#pd-rf");
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  await P.fill("#pd-rn", "تغيّر المنشور بعد الشراء"); await P.click("#pd-rgo");
  await until(() => /طلب استرداد قيد المراجعة/.test(document.getElementById("pd-pl")?.textContent || ""));
  assert.deepEqual(calls("/api/paid/purchases/pu1/refund-request", "POST").at(-1).body, { reason: "تغيّر المنشور بعد الشراء" });
  assert.equal(await P.$("[data-pd-ref]"), null);
  await go("#/home"); await P.waitForTimeout(200); await go("#/purchases"); await P.waitForSelector("#pd-pl .pd-row"); // notification links (/#/purchases)
  assert.match(await P.textContent("#pd-h"), /مشترياتي/);
});

test("#/me/paid-posts (creator) + link on #/creator and in Settings", async () => {
  await go("#/me/paid-posts"); await P.waitForSelector("#pd-cl .pd-kpi");
  assert.match(await P.textContent("#pd-cl .pd-kpi"), /27.3 π/); assert.match(await P.textContent("#pd-cl .pd-kpi"), /٧/);
  assert.equal(await P.$$eval("#pd-cl .pd-row", n => n.length), 2);
  assert.match(await P.textContent("#pd-cl"), /«شريك» فأعلى/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await go("#/creator"); await P.waitForSelector("#pd-crl");
  assert.equal(await P.getAttribute("#pd-crl", "href"), "#/me/paid-posts");
  await go("#/settings?s=money"); await P.waitForSelector(".set-sec a[href='#/me/purchases']"); // v2.38: «المدفوعات والمحفظة»
  await go("#/me"); await P.waitForTimeout(300); assert.equal(await P.$("#pd-pl"), null, "#/me is still the profile");
});

test("#/admin card + #/admin/paid: approve / reject refunds", async () => {
  await go("#/admin"); await P.waitForSelector("#pd-adm");
  await P.click("#pd-adm"); await P.waitForSelector("#pd-aq [data-rq]");
  assert.equal(await P.$$eval("#pd-aq [data-rq]", n => n.length), 2);
  assert.match(await P.textContent("#pd-aq"), /تغيّر المحتوى كلياً/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  assert.match(await P.textContent("[data-rq=rf2]"), /حذف الناشر المنشور/); assert.equal(await P.$("[data-rq=rf2] a[href^='#/post/']"), null, "no link to a deleted post");
  await P.fill("[data-rq=rf1] [data-note]", "تم التحقق"); await P.fill("[data-rq=rf1] [data-txid]", "tx_refund_1");
  await P.click("[data-rq=rf1] [data-act=approve]"); await until(() => document.querySelectorAll("#pd-aq [data-rq]").length === 1);
  assert.deepEqual(calls("/api/admin/paid/refunds/rf1/approve", "POST").at(-1).body, { note: "تم التحقق", txid: "tx_refund_1" });
  await P.click("[data-rq=rf2] [data-act=reject]"); await until(() => /لا طلبات استرداد/.test(document.getElementById("pd-aq")?.textContent));
  assert.equal(calls("/api/admin/paid/refunds/rf2/reject", "POST").length, 1);
});

test("real CSP (no 'unsafe-inline'): lock card + buy flow work with no violations", async () => {
  st.unlocked = false; resetData();
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce", bypassCSP: false });
  await stub(ctx); await ctx.addInitScript(FAKE_PI);
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
  const p = await ctx.newPage(); p.on("pageerror", e => errors.push("csp page: " + e.message));
  const cookies = await ctxMain.cookies(); await ctx.addCookies(cookies);
  await p.goto(S.base + "/?nosw#/post/" + POSTS.ppv);
  await until(() => !!window.MPPaid, null, 15000, p);
  await p.waitForSelector(`#view [data-pd-buy="${POSTS.ppv}"]`, { timeout: 15000 });
  await p.click(`#view [data-pd-buy="${POSTS.ppv}"]`); await p.waitForSelector("#pd-go:not([disabled])");
  await p.click("#pd-go");
  await until((s) => document.getElementById("view").textContent.includes(s), SECRET_PPV, 12000, p);
  assert.deepEqual((await p.evaluate(() => window.__csp)).filter(v => /script/.test(v)), []);
  await ctx.unrouteAll({ behavior: "ignoreErrors" }); await ctx.close();
});
