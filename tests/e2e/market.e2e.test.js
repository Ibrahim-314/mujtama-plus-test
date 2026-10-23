/* global MPMarket, MPPi, PiAdapter  */
/* Phase 39 (client): community marketplace «السوق المجتمعي» in a real browser against the production build.
 * The market API (/api/market/*, /api/me/market/*, /api/admin/market/*), Pi (/api/pi/*, fake window.Pi) and media uploads
 * (POST /api/media, GET /media/mk-*) are stubbed per docs/integration/p39-contract.md; users, session, chunks and the CSP are real.
 * Covers: lazy "market" chunk (not in core, core ≤ 90 KB br), «السوق» entry on #/explore, grid (search, category chips,
 * filters, sort, infinite scroll, 2/3/4 columns), product page (gallery: thumbnails, arrow keys, swipe, alt text, lightbox,
 * lazy images; seller card + rating), Pi off (buy disabled + «مدفوعات Pi غير مفعّلة بعد»), buyReason states, buy flow
 * (order → intent passed unchanged to Pi.createPayment → order page), errors / cancel, listing form (Arabic validation,
 * uploads, reorder, remove, server errors, create + edit), orders tabs (keyboard), order page per role (actions, escrow,
 * chat link, review, dispute with evidence, dispute messages), seller page (summary, replies, pagination), admin disputes
 * (split validation, resolve), axe on every screen, and the real CSP (no 'unsafe-inline') with no violations. */
const test = require("node:test"), assert = require("node:assert"), path = require("node:path"), fs = require("node:fs");
const { ensureBuild, startStack, onboard, MOBILE, DESKTOP, ROOT } = require("./harness");
let S, P, ctxMain, ME = null; const errors = [];
const PI_UA = MOBILE.userAgent + " PiBrowser/1.0.0";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const SELLER = { id: "u_seller", handle: "yousef_shop", name: "يوسف التاجر", avatar: null, rating: { avg: 4.5, count: 12 }, sales: 30 };
const CATS = ["electronics", "fashion", "home", "books", "digital", "services", "education", "crafts", "other"];
const now = () => new Date().toISOString();

/* ---------- contract stub ---------- */
const st = { enabled: true, calls: [], listings: [], orders: {}, disputes: {}, adminDisputes: [], nextOrder: 1, nextMedia: 1, orderError: null, listingError: null, reviews: {} };
const img = (n, k) => ({ id: `md_${n}_${k}`, url: `/media/mk-${n}-${k}.png`, thumb: `/media/mk-${n}-${k}-t.png`, w: 800, h: 600, alt: k === 0 ? `صورة أمامية للمنتج ${n}` : null });
function seed() {
  st.listings = [];
  for (let n = 1; n <= 30; n++) st.listings.push({ id: "ml_" + n, seller: SELLER, kind: n % 7 === 0 ? "service" : "product", title: n === 1 ? "هاتف ذكي بحالة ممتازة" : `منتج رقم ${n}`, description: "وصف تفصيلي للمنتج\nسطر ثانٍ", price: n === 1 ? 2.5 : n, currency: "PI", category: CATS[n % CATS.length], condition: n % 2 ? "new" : "used", quantity: n === 1 ? 5 : 1, images: n === 1 ? [img(1, 0), img(1, 1), img(1, 2)] : [img(n, 0)], delivery: "shipping", location: "جدة", status: "active", createdAt: now(), updatedAt: now(), views: 10 });
  st.listings.push({ id: "ml_mine", seller: { id: ME, handle: "amal_market", name: "أمل", rating: { avg: 0, count: 0 }, sales: 0 }, kind: "product", title: "كتاب برمجة للبيع", description: "كتاب", price: 3, category: "books", condition: "used", quantity: 2, images: [img(90, 0), img(90, 1)], delivery: "pickup", location: null, status: "active", createdAt: now(), updatedAt: now(), views: 4, own: true });
  st.listings.push({ id: "ml_minor", seller: SELLER, kind: "product", title: "سماعات", description: "", price: 4, category: "electronics", condition: "new", quantity: 3, images: [img(91, 0)], delivery: "shipping", status: "active", createdAt: now(), buyReason: "minor_restricted" });
  st.listings.push({ id: "ml_sold", seller: SELLER, kind: "product", title: "ساعة", description: "", price: 6, category: "fashion", condition: "used", quantity: 0, images: [img(92, 0)], delivery: "shipping", status: "sold_out", createdAt: now(), buyReason: "sold_out" });
  const L1 = { id: "ml_1", title: "هاتف ذكي بحالة ممتازة", price: 2.5, images: [img(1, 0)] };
  const me = { id: ME, handle: "amal_market", name: "أمل" }, seller = { id: SELLER.id, handle: SELLER.handle, name: SELLER.name };
  const tl = (...s) => s.map((x, i) => ({ status: x, at: new Date(Date.now() - (s.length - i) * 3600e3).toISOString() }));
  st.orders = {
    mo_ship: { id: "mo_ship", listing: L1, buyer: me, seller, qty: 1, unitPrice: 2.5, total: 2.5, status: "shipped", conversationId: "cv_1", escrow: { state: "held", amount: 2.5 }, timeline: tl("pending_payment", "paid_held", "shipped"), createdAt: now() },
    mo_done: { id: "mo_done", listing: L1, buyer: me, seller, qty: 1, unitPrice: 2.5, total: 2.5, status: "completed", conversationId: "cv_2", escrow: { state: "released", amount: 2.5 }, timeline: tl("pending_payment", "paid_held", "delivered", "completed"), createdAt: now() },
    mo_sell: { id: "mo_sell", listing: { id: "ml_mine", title: "كتاب برمجة للبيع", price: 3, images: [img(90, 0)] }, buyer: seller, seller: me, qty: 1, unitPrice: 3, total: 3, status: "paid_held", conversationId: "cv_3", escrow: { state: "held", amount: 3 }, timeline: tl("pending_payment", "paid_held"), createdAt: now() },
    mo_disp: { id: "mo_disp", listing: L1, buyer: me, seller, qty: 2, unitPrice: 2.5, total: 5, status: "disputed", conversationId: "cv_4", escrow: { state: "held", amount: 5 }, disputeId: "dp_1", timeline: tl("pending_payment", "paid_held", "delivered", "disputed"), createdAt: now() }
  };
  st.disputes = { dp_1: { id: "dp_1", orderId: "mo_disp", openedBy: me, reason: "not_as_described", text: "اللون مختلف تماماً عن الصور", evidence: [{ id: "ev1", url: "/media/mk-ev-1.png" }], status: "open", messages: [{ id: "dm1", author: seller, text: "سأراجع الطلب", at: now() }, { id: "dm2", admin: true, text: "نراجع الأدلة", at: now() }] } };
  st.adminDisputes = [
    { id: "dp_1", order: { id: "mo_disp", total: 5, listing: { title: "هاتف ذكي بحالة ممتازة" } }, buyer: me, seller, reason: "not_as_described", text: "اللون مختلف تماماً عن الصور", evidence: [{ id: "ev1", url: "/media/mk-ev-1.png" }], status: "open", createdAt: now() },
    { id: "dp_2", order: { id: "mo_x", total: 8, listing: { title: "ساعة" } }, buyer: { handle: "sara_b" }, seller, reason: "not_received", text: "لم يصل", evidence: [], status: "seller_responded", createdAt: now() }];
  st.reviews = { yousef_shop: [{ id: "rv1", rating: 5, text: "بائع ممتاز وسريع", buyer: { handle: "sara_b", name: "سارة" }, listing: { title: "منتج رقم 3" }, createdAt: now(), reply: "شكراً لك" }, { id: "rv2", rating: 4, text: "جيد", buyer: { handle: "khaled", name: "خالد" }, createdAt: now() }],
    amal_market: [{ id: "rv9", rating: 3, text: "تأخر الشحن قليلاً", buyer: { handle: "sara_b", name: "سارة" }, createdAt: now(), reply: null }] };
}
const full = (L) => {
  const own = L.seller.id === ME, reason = own ? "own_listing" : L.buyReason || (!st.enabled ? "not_configured" : null);
  return { ...L, canBuy: !reason, ...(reason ? { buyReason: reason } : {}) };
};
async function stub(ctx) {
  const rt = (g, fn) => ctx.route(g, async (r) => { try { await fn(r); } catch (e) { if (!/disposed|closed|Target page/i.test(e.message)) throw e; } });
  const json = (r, status, body) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await rt(/\/media\/mk-[\w-]+\.png$/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await rt("**/api/media", async (r) => { if (r.request().method() !== "POST") return r.fallback(); const n = st.nextMedia++; st.calls.push({ m: "POST", p: "/api/media" }); return json(r, 200, { media: { id: "up_" + n, kind: "image", url: `/media/mk-up-${n}.png`, status: "ready" } }); });
  const handler = async (r) => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), p = u.pathname; let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    st.calls.push({ m, p, q: u.search, body });
    let mm;
    if (p === "/api/pi/config") return json(r, 200, { enabled: st.enabled, authEnabled: true, network: "testnet", sandbox: true, paidMaxPrice: 100, marketMaxPrice: 1000 });
    if (p === "/api/pi/payments/complete") { const o = Object.values(st.orders).filter(x => x.status === "pending_payment").at(-1); /* newest order: a cancelled attempt leaves an older one pending */ if (o) { o.status = "paid_held"; o.escrow = { state: "held", amount: o.total }; o.timeline.push({ status: "paid_held", at: now() }); } return json(r, 200, { ok: true, receipt: { status: "completed" } }); }
    if (/^\/api\/pi\/payments\/(approve|cancel|incomplete)$/.test(p)) return json(r, 200, { ok: true, status: "approved" });
    if (p === "/api/pi/auth") return json(r, 200, { linked: true, piUsername: "pi_amal" });
    if (p === "/api/pi/link") return json(r, 200, { linked: true, piUsername: "pi_amal", network: "testnet" });
    if (p === "/api/market/config") return json(r, 200, { enabled: true, piEnabled: st.enabled, currency: "PI", categories: CATS, kinds: ["product", "service"], conditions: ["new", "used", "na"], delivery: ["pickup", "shipping", "digital", "onsite"], minPrice: 0.01, maxPrice: 1000, feePct: 0, autoReleaseDays: 7, maxImages: 8, maxQty: 100 });
    if (p === "/api/market/listings" && m === "GET") {
      const q = u.searchParams; let items = st.listings.filter(x => x.status === "active" && !x.own);
      if (q.get("q")) items = items.filter(x => x.title.includes(q.get("q")));
      if (q.get("category")) items = items.filter(x => x.category === q.get("category"));
      if (q.get("kind")) items = items.filter(x => x.kind === q.get("kind"));
      if (q.get("min")) items = items.filter(x => x.price >= Number(q.get("min")));
      if (q.get("max")) items = items.filter(x => x.price <= Number(q.get("max")));
      if (q.get("sort") === "price_desc") items = [...items].sort((a, b) => b.price - a.price);
      const off = Number(q.get("cursor") || 0), page = items.slice(off, off + 12).map(({ description: _d, images, ...c }) => ({ ...c, image: images[0] }));
      return json(r, 200, { items: page, next: off + 12 < items.length ? String(off + 12) : null });
    }
    if (p === "/api/market/listings" && m === "POST") {
      if (st.listingError) { const e = st.listingError; st.listingError = null; return json(r, e.status, e.body); }
      const L = { ...body, id: "ml_new", seller: { id: ME, handle: "amal_market" }, images: body.images.map((id, i) => ({ id, url: `/media/mk-up-${id.split("_")[1]}.png`, alt: null, i })), createdAt: now(), own: true };
      st.listings.push(L); return json(r, 201, { listing: full(L) });
    }
    if ((mm = /^\/api\/market\/listings\/([^/]+)$/.exec(p))) {
      const L = st.listings.find(x => x.id === mm[1]); if (!L) return json(r, 404, { error: "not found", code: "not_found" });
      if (m === "GET") return json(r, 200, full(L));
      if (m === "PATCH") { Object.assign(L, body); return json(r, 200, { listing: full(L) }); }
      if (m === "DELETE") { L.status = "removed"; return json(r, 200, { ok: true }); }
    }
    if ((mm = /^\/api\/market\/listings\/([^/]+)\/order$/.exec(p))) {
      if (!st.enabled) return json(r, 409, { error: "Pi payments are not configured", code: "not_configured" });
      if (st.orderError) { const e = st.orderError; st.orderError = null; return json(r, e.status, e.body); }
      const L = st.listings.find(x => x.id === mm[1]), id = "mo_" + st.nextOrder++, total = Math.round(L.price * body.qty * 1e7) / 1e7;
      st.orders[id] = { id, listing: { id: L.id, title: L.title, price: L.price, images: L.images }, buyer: { id: ME, handle: "amal_market" }, seller: { id: SELLER.id, handle: SELLER.handle }, qty: body.qty, unitPrice: L.price, total, status: "pending_payment", conversationId: "cv_" + id, escrow: null, timeline: [{ status: "pending_payment", at: now() }], createdAt: now() };
      return json(r, 200, { order: st.orders[id], intent: { id: "int_" + id, amount: total, memo: `مجتمع بلس — السوق: ${L.title}`, metadata: { intentId: "int_" + id, app: "mujtama", kind: "market", orderId: id } } });
    }
    if (p === "/api/me/market/listings") return json(r, 200, { items: st.listings.filter(x => x.own).map(({ images, ...c }) => ({ ...c, image: images[0] })) });
    if (p === "/api/me/market/orders") { const role = u.searchParams.get("role"); return json(r, 200, { items: Object.values(st.orders).filter(o => (role === "seller" ? o.seller.id : o.buyer.id) === ME) }); }
    if ((mm = /^\/api\/market\/orders\/([^/]+)$/.exec(p))) { const o = st.orders[mm[1]]; return o ? json(r, 200, { order: o }) : json(r, 404, { error: "not found", code: "not_found" }); }
    if ((mm = /^\/api\/market\/orders\/([^/]+)\/(ship|deliver|confirm|cancel)$/.exec(p))) {
      const o = st.orders[mm[1]], to = { ship: "shipped", deliver: "delivered", confirm: "completed", cancel: "cancelled" }[mm[2]];
      o.status = to; o.timeline.push({ status: to, at: now() }); if (to === "completed") o.escrow = { state: "released", amount: o.total }; if (to === "cancelled") o.escrow = { state: "refunded", amount: o.total };
      return json(r, 200, { order: o });
    }
    if ((mm = /^\/api\/market\/orders\/([^/]+)\/review$/.exec(p))) { st.orders[mm[1]].review = { id: "rvn", ...body }; return json(r, 201, { review: st.orders[mm[1]].review }); }
    if ((mm = /^\/api\/market\/orders\/([^/]+)\/dispute$/.exec(p))) { const o = st.orders[mm[1]]; o.status = "disputed"; o.disputeId = "dp_new"; st.disputes.dp_new = { id: "dp_new", orderId: o.id, reason: body.reason, text: body.text, evidence: (body.evidence || []).map(id => ({ id, url: `/media/mk-up-${id.split("_")[1]}.png` })), status: "open", messages: [] }; return json(r, 201, { dispute: st.disputes.dp_new }); }
    if ((mm = /^\/api\/market\/disputes\/([^/]+)$/.exec(p))) return json(r, 200, { dispute: st.disputes[mm[1]] });
    if ((mm = /^\/api\/market\/disputes\/([^/]+)\/messages$/.exec(p))) { st.disputes[mm[1]].messages.push({ id: "dmx", author: { handle: "amal_market" }, text: body.text, at: now() }); return json(r, 201, { ok: true }); }
    if ((mm = /^\/api\/market\/reviews\/([^/]+)\/reply$/.exec(p))) { for (const k in st.reviews) for (const rv of st.reviews[k]) if (rv.id === mm[1]) rv.reply = body.text; return json(r, 200, { ok: true }); }
    if ((mm = /^\/api\/market\/sellers\/([^/]+)$/.exec(p))) {
      const hd = decodeURIComponent(mm[1]), mine = hd === "amal_market", revs = st.reviews[hd] || [];
      if (u.searchParams.get("cursor")) return json(r, 200, { reviews: [{ id: "rv_old", rating: 2, text: "تقييم قديم", buyer: { handle: "old_b" }, createdAt: now() }], next: null });
      return json(r, 200, { seller: mine ? { id: ME, handle: "amal_market", name: "أمل", rating: { avg: 3, count: 1 }, sales: 1 } : { ...SELLER, rating: { ...SELLER.rating, distribution: { 5: 8, 4: 3, 3: 1, 2: 0, 1: 0 } } }, reviews: revs, next: mine ? null : "c2" });
    }
    if (p === "/api/admin/market/disputes") return json(r, 200, { items: st.adminDisputes });
    if ((mm = /^\/api\/admin\/market\/disputes\/([^/]+)\/resolve$/.exec(p))) { st.adminDisputes = st.adminDisputes.filter(x => x.id !== mm[1]); return json(r, 200, { ok: true }); }
    return json(r, 404, { error: "not stubbed " + p });
  };
  for (const g of ["**/api/pi/**", "**/api/market/**", "**/api/me/market/**", "**/api/admin/market/**"]) await rt(g, handler);
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
const until = async (fn, arg, timeout = 12000, page = P) => { const end = Date.now() + timeout; for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160)); await page.waitForTimeout(60); } };
const calls = (p, m) => st.calls.filter(c => c.p === p && (!m || c.m === m));
async function axeOn(page, sel) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return (await page.evaluate(async (s) => (await axe.run(s ? document.querySelector(s) : document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sel: v.nodes[0]?.target?.join(" ") })), sel)).filter(v => ["serious", "critical"].includes(v.impact));
}
const go = async (hash, page = P) => { await page.evaluate((h) => { location.hash = h; }, hash); };
const reloadPi = () => P.evaluate(() => { MPPi.refresh(); PiAdapter.cfg = null; });
const shot = (name, page = P) => process.env.MK_SHOTS ? page.screenshot({ path: path.join(process.env.MK_SHOTS, name + ".png"), fullPage: false }) : null; // optional visual check
const cols = (page = P) => page.evaluate(() => getComputedStyle(document.getElementById("mk-grid")).gridTemplateColumns.split(" ").length);

test.before(async () => {
  ensureBuild(); // rebuilds dist only when stale — never wipes a fresh shared dist mid-run
  S = await startStack();
  ctxMain = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await stub(ctxMain); await ctxMain.addInitScript(FAKE_PI);
  P = await ctxMain.newPage(); P.on("pageerror", e => errors.push(e.message));
  await onboard(P, S.base, "amal_market", "أمل"); // first account = admin
  ME = await P.evaluate(() => DB.me); seed();
});
test.after(async () => { await S.close(); assert.deepEqual(errors, [], "no uncaught page errors"); });

test("lazy chunk: market-ui is its own chunk, not in core (core ≤ 90 KB br); «السوق» entry on #/explore", async () => {
  const r = await P.evaluate(() => ({ src: (window.__CHUNKS || {}).market, loaded: !!window.MPChunks.loaded.market }));
  assert.match(r.src, /^\/assets\/chunk-market-.+\.js$/);
  assert.equal(r.loaded, false, "not loaded before a market route");
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8")), core = b.files.find(f => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(!/MPMarket|mk-grid|\/api\/market\//.test(fs.readFileSync(path.join(ROOT, "dist", core.file), "utf8")), "market code is not in the core bundle");
  assert.ok(core.br <= 90 * 1024, "core ≤ 90 KB br: " + core.br);
  await go("#/explore"); await P.waitForSelector("#mk-ex", { timeout: 15000 });
  assert.equal(await P.getAttribute("#mk-ex", "href"), "#/market");
  await P.click("#mk-ex"); await P.waitForSelector("#mk-grid .mk-item");
  assert.ok(await P.evaluate(() => window.MPChunks.loaded.market && !!window.MPMarket));
});

test("grid: cards, search, category chips, filters, sort, infinite scroll, 2 columns on mobile", async () => {
  await go("#/market"); await P.waitForSelector("#mk-grid .mk-item");
  assert.equal(await P.$$eval("#mk-grid .mk-item", n => n.length), 12);
  assert.equal(await cols(), 2);
  await shot("market-grid-mobile");
  assert.match(await P.textContent("[data-mk-id=ml_1]"), /2.5 π/);
  assert.equal(await P.getAttribute("[data-mk-id=ml_1] img", "alt"), "صورة أمامية للمنتج 1");
  assert.equal(await P.getAttribute("[data-mk-id=ml_1] img", "loading"), "lazy");
  assert.match(await P.getAttribute("[data-mk-id=ml_1] .mk-stars", "aria-label"), /التقييم ٤٫٥ من 5/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  // infinite scroll
  await until(() => { document.getElementById("mk-more").scrollIntoView(); return document.querySelectorAll("#mk-grid .mk-item").length >= 24; });
  assert.ok(calls("/api/market/listings", "GET").some(c => /cursor=12/.test(c.q)));
  await until(() => { document.getElementById("mk-more").scrollIntoView(); return document.querySelectorAll("#mk-grid .mk-item").length === 31 && /نهاية النتائج/.test(document.getElementById("mk-more").textContent); });
  // search
  await P.fill("#mk-q", "هاتف"); await P.press("#mk-q", "Enter");
  await until(() => document.querySelectorAll("#mk-grid .mk-item").length === 1);
  assert.match(calls("/api/market/listings", "GET").at(-1).q, /q=%D9%87/);
  await P.fill("#mk-q", ""); await P.press("#mk-q", "Enter"); await until(() => document.querySelectorAll("#mk-grid .mk-item").length === 12);
  // category chip
  await P.click("[data-mk-cat=books]");
  await until(() => document.querySelector("[data-mk-cat=books]").getAttribute("aria-pressed") === "true" && !document.getElementById("mk-grid").hasAttribute("aria-busy"));
  assert.match(calls("/api/market/listings", "GET").at(-1).q, /category=books/);
  assert.equal(await P.getAttribute("[data-mk-cat='']", "aria-pressed"), "false");
  // filters + sort (min > max is refused in Arabic)
  await P.click("#mk-fd summary");
  await P.fill("#mk-min", "5"); await P.fill("#mk-max", "2"); await P.press("#mk-max", "Tab");
  await until(() => /أقل سعر يجب ألا يتجاوز/.test(document.getElementById("mk-ferr").textContent));
  const before = calls("/api/market/listings", "GET").length;
  await P.click("[data-mk-cat='']"); await P.fill("#mk-max", "40"); await P.press("#mk-max", "Tab");
  await P.selectOption("#mk-kind", "product"); await P.selectOption("#mk-cond", "new"); await P.selectOption("#mk-sort", "price_desc");
  await until((n) => { const g = document.getElementById("mk-grid"); return !g.hasAttribute("aria-busy") && g.querySelectorAll(".mk-item").length > 0; }, before);
  const q = new URLSearchParams(calls("/api/market/listings", "GET").at(-1).q);
  assert.deepEqual({ kind: q.get("kind"), condition: q.get("condition"), min: q.get("min"), max: q.get("max"), sort: q.get("sort"), category: q.get("category") }, { kind: "product", condition: "new", min: "5", max: "40", sort: "price_desc", category: null });
  assert.equal(await P.textContent("#mk-ferr"), "");
  const prices = await P.$$eval("#mk-grid .mk-pr", n => n.map(x => parseFloat(x.textContent)));
  assert.deepEqual(prices, [...prices].sort((a, b) => b - a), "sorted by price desc");
  assert.ok(prices.every(x => x >= 5 && x <= 40));
  // reset for the next tests
  await P.evaluate(() => Object.assign(MPMarket.filters, { q: "", category: "", kind: "", condition: "", min: "", max: "", sort: "new" }));
});

test("responsive grid: 3 columns on tablet, 4 on desktop (rail hidden on the market grid)", async () => {
  for (const [vp, n] of [[{ width: 900, height: 900 }, 3], [{ width: 1440, height: 900 }, 4]]) {
    const ctx = await S.browser.newContext({ ...DESKTOP, viewport: vp }); await stub(ctx); await ctx.addCookies(await ctxMain.cookies());
    const p = await ctx.newPage(); p.on("pageerror", e => errors.push("rwd: " + e.message));
    await p.goto(S.base + "/?nosw#/market"); await p.waitForSelector("#mk-grid .mk-item", { timeout: 15000 });
    assert.equal(await cols(p), n, `columns at ${vp.width}px`);
    await shot("market-grid-" + vp.width, p);
    if (n === 4) { assert.ok(await p.evaluate(() => document.body.classList.contains("mk-wide"))); await go("#/market/item/ml_1", p); await p.waitForSelector("#mk-gal"); assert.ok(!(await p.evaluate(() => document.body.classList.contains("mk-wide")))); }
    await ctx.unrouteAll({ behavior: "ignoreErrors" }); await ctx.close();
  }
});

test("product page: gallery (thumbnails, arrow keys, swipe, alt text, lazy images, lightbox), seller card", async () => {
  await go("#/market/item/ml_1"); await P.waitForSelector("#mk-gal");
  assert.equal(await P.textContent("#mk-h"), "هاتف ذكي بحالة ممتازة");
  assert.deepEqual(await P.$$eval("#mk-track img", n => n.map(i => i.alt)), ["صورة أمامية للمنتج 1", "هاتف ذكي بحالة ممتازة — صورة ٢ من ٣", "هاتف ذكي بحالة ممتازة — صورة ٣ من ٣"]);
  assert.deepEqual(await P.$$eval("#mk-track img", n => n.map(i => i.getAttribute("loading"))), [null, "lazy", "lazy"]);
  assert.equal(await P.$$eval("[data-mk-th]", n => n.length), 3);
  const idx = () => P.evaluate(() => document.getElementById("mk-gal").dataset.index);
  await P.focus("#mk-gal"); await P.keyboard.press("ArrowLeft"); assert.equal(await idx(), "1"); // RTL: left = next
  assert.match(await P.textContent("#mk-gc"), /٢ \/ ٣/);
  await P.keyboard.press("ArrowRight"); assert.equal(await idx(), "0");
  await P.keyboard.press("End"); assert.equal(await idx(), "2"); assert.equal(await P.isDisabled("#mk-gn"), true);
  await P.click("[data-mk-th='0']"); assert.equal(await idx(), "0"); assert.equal(await P.getAttribute("[data-mk-th='0']", "aria-current"), "true");
  assert.equal(await P.getAttribute("[data-mk-slide='1']", "aria-hidden"), "");
  // swipe (RTL: finger moves right → next image)
  await P.evaluate(() => { const g = document.getElementById("mk-gal"), r = g.getBoundingClientRect(), y = r.top + r.height / 2, ev = (t, x) => g.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, pointerType: "touch" })); ev("pointerdown", r.left + 60); ev("pointermove", r.left + 160); ev("pointerup", r.left + 200); });
  assert.equal(await idx(), "1");
  // lightbox: Enter opens, arrows move, Escape closes and focus returns
  await P.focus("#mk-gal"); await P.keyboard.press("Enter"); await P.waitForSelector("#mk-lb");
  assert.equal(await P.getAttribute("#mk-lb", "aria-modal"), "true"); assert.equal(await P.evaluate(() => document.activeElement.id), "mk-lbx");
  assert.match(await P.getAttribute("#mk-lbi", "alt"), /صورة ٢ من ٣/);
  await P.keyboard.press("ArrowLeft"); assert.match(await P.getAttribute("#mk-lbi", "alt"), /صورة ٣ من ٣/);
  assert.deepEqual(await axeOn(P, "#mk-lb"), []);
  await P.keyboard.press("Escape"); await P.waitForSelector("#mk-lb", { state: "detached" });
  assert.equal(await P.evaluate(() => document.activeElement.id), "mk-gal"); assert.equal(await idx(), "2");
  // seller card + buy box
  assert.match(await P.textContent(".mk-seller"), /يوسف التاجر/); assert.match(await P.textContent(".mk-seller"), /٣٠ عملية بيع/);
  assert.equal(await P.getAttribute(".mk-seller a.btn", "href"), "#/market/seller/yousef_shop");
  assert.equal(await P.isDisabled("#mk-buy"), false); assert.ok(await P.$("#mk-qty"));
  await P.evaluate(() => scrollTo(0, 0)); await shot("market-item");
  assert.deepEqual(await axeOn(P, "#view"), []);
});

test("Pi off: buy disabled with «مدفوعات Pi غير مفعّلة بعد», no order request", async () => {
  st.enabled = false; await reloadPi();
  try {
    await go("#/home"); await go("#/market/item/ml_2"); await P.waitForSelector("#mk-buy");
    assert.equal(await P.isDisabled("#mk-buy"), true);
    assert.match(await P.textContent("#mk-bn"), /^مدفوعات Pi غير مفعّلة بعد$/);
    assert.equal(await P.getAttribute("#mk-buy", "aria-describedby"), "mk-bn");
    await P.evaluate(() => document.getElementById("mk-buy").scrollIntoView()); await shot("market-item-pi-off");
    await P.click("#mk-buy", { force: true }); await P.waitForTimeout(200);
    assert.equal(await P.$("#mk-go"), null); assert.equal(calls("/api/market/listings/ml_2/order").length, 0);
    assert.deepEqual(await axeOn(P, "#view"), []);
  } finally { st.enabled = true; await reloadPi(); }
});

test("buyReason: minor_restricted, sold_out, own listing", async () => {
  await go("#/market/item/ml_minor"); await P.waitForSelector("#mk-buy[disabled]");
  assert.match(await P.textContent("#mk-bn"), /دون 18/);
  await go("#/market/item/ml_sold"); await P.waitForSelector("[data-mk-listing=ml_sold] #mk-buy[disabled]");
  assert.match(await P.textContent("#mk-bn"), /نفدت الكمية/);
  await go("#/market/item/ml_mine"); await P.waitForSelector("[data-mk-listing=ml_mine] a[href='#/market/edit/ml_mine']");
  assert.equal(await P.$("#mk-buy"), null);
});

test("buy flow: order → intent passed unchanged to Pi.createPayment → order page; errors + cancel", async () => {
  await go("#/market/item/ml_1"); await P.waitForSelector("[data-mk-listing=ml_1] #mk-buy:not([disabled])");
  await P.fill("#mk-qty", "2"); await P.click("#mk-buy"); await P.waitForSelector("#mk-go:not([disabled])");
  assert.equal(await P.evaluate(() => document.activeElement.id), "mk-st");
  assert.match(await P.textContent("#mk-sd"), /× ٢/); assert.match(await P.textContent("#mk-sd"), /5 π/);
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  st.orderError = { status: 403, body: { error: "minor", code: "minor_restricted" } };
  await P.click("#mk-go"); await until(() => /دون 18/.test(document.getElementById("mk-serr").textContent));
  assert.equal(await P.evaluate(() => window.__pi.payments.length), 0, "Pi never asked when the order is refused");
  await P.evaluate(() => { window.__piMode = "cancel"; });
  await P.click("#mk-go"); await until(() => /أُلغيت عملية الدفع/.test(document.getElementById("mk-snote").textContent));
  assert.equal(await P.isDisabled("#mk-go"), false);
  await P.evaluate(() => { window.__piMode = "ok"; });
  const n0 = st.nextOrder;
  await P.click("#mk-go"); await until((id) => location.hash === "#/market/orders/" + id, "mo_" + n0);
  const oc = calls("/api/market/listings/ml_1/order", "POST").at(-1); assert.deepEqual(oc.body, { qty: 2 });
  const sent = await P.evaluate(() => window.__pi.payments.at(-1));
  const intent = { amount: 5, memo: "مجتمع بلس — السوق: هاتف ذكي بحالة ممتازة", metadata: { intentId: "int_mo_" + n0, app: "mujtama", kind: "market", orderId: "mo_" + n0 } };
  assert.deepEqual(sent, intent, "the intent reaches Pi exactly as the server returned it");
  assert.equal(calls("/api/pi/payments/approve", "POST").length >= 1, true); assert.equal(calls("/api/pi/payments/complete", "POST").length >= 1, true);
  await P.waitForSelector(`[data-mk-order="mo_${n0}"]`);
  assert.match(await P.textContent(".mk-escrow"), /محجوز لدى المنصة/);
  // Pi turned off server-side between page load and order → 409 not_configured in Arabic
  await go("#/market/item/ml_3"); await P.waitForSelector("[data-mk-listing=ml_3] #mk-buy:not([disabled])");
  await P.click("#mk-buy"); await P.waitForSelector("#mk-go:not([disabled])");
  st.enabled = false;
  await P.click("#mk-go"); await until(() => /غير مفعّلة بعد/.test(document.getElementById("mk-serr").textContent));
  assert.equal(await P.isDisabled("#mk-go"), true);
  st.enabled = true; await P.evaluate(() => closeSheet()); await reloadPi();
});

test("listing form: Arabic validation, uploads, reorder, remove, server errors, create", async () => {
  await go("#/market/new"); await P.waitForSelector("#mk-form");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("#mk-save");
  await until(() => !document.getElementById("mk-es").hidden);
  const es = await P.textContent("#mk-es");
  for (const re of [/اكتب عنواناً للإعلان/, /اكتب السعر بعملة Pi/, /اختر فئة من القائمة/, /أضف صورة واحدة على الأقل/]) assert.match(es, re);
  assert.equal(await P.evaluate(() => document.activeElement.id), "mk-title", "focus moves to the first invalid field");
  assert.equal(await P.getAttribute("#mk-title", "aria-invalid"), "true");
  assert.match(await P.getAttribute("#mk-title", "aria-describedby"), /mk-e-title/);
  assert.equal(calls("/api/market/listings", "POST").length, 0);
  await P.fill("#mk-title", "دراجة"); await P.fill("#mk-price", "0.001"); await P.selectOption("#mk-category", "home"); await P.fill("#mk-quantity", "1.5");
  const files = [1, 2, 3].map(i => ({ name: `p${i}.png`, mimeType: "image/png", buffer: PNG }));
  await P.setInputFiles("#mk-files", files); await until(() => document.querySelectorAll("#mk-imgs img").length === 3);
  assert.match(await P.textContent("#mk-ic"), /٣/);
  const order = () => P.$$eval("#mk-imgs img", n => n.map(i => i.getAttribute("src")));
  assert.deepEqual(await order(), ["/media/mk-up-1.png", "/media/mk-up-2.png", "/media/mk-up-3.png"]);
  await P.click("[data-mv='-1'][data-i='2']"); // third image one step forward
  assert.deepEqual(await order(), ["/media/mk-up-1.png", "/media/mk-up-3.png", "/media/mk-up-2.png"]);
  assert.equal(await P.evaluate(() => document.activeElement.dataset.i), "1", "focus follows the moved image");
  await P.click("[data-rm='0']"); assert.deepEqual(await order(), ["/media/mk-up-3.png", "/media/mk-up-2.png"]);
  await P.click("#mk-save"); await until(() => /0.01/.test(document.getElementById("mk-e-price").textContent));
  assert.match(await P.textContent("#mk-e-price"), /السعر يجب أن يكون بين 0.01 و1,000 Pi/);
  assert.match(await P.textContent("#mk-e-quantity"), /عدد صحيح/);
  assert.equal(await P.textContent("#mk-e-title"), "");
  await P.fill("#mk-price", "12.5"); await P.fill("#mk-quantity", "2"); await P.fill("#mk-description", "دراجة هوائية بحالة جيدة");
  st.listingError = { status: 422, body: { error: "spam", code: "spam" } };
  await P.click("#mk-save"); await until(() => /يبدو مزعجاً/.test(document.getElementById("mk-es").textContent));
  st.listingError = { status: 400, body: { error: "bad price", code: "price_invalid" } };
  await P.click("#mk-save"); await until(() => /السعر يجب أن يكون بين/.test(document.getElementById("mk-e-price").textContent));
  assert.equal(await P.evaluate(() => document.activeElement.id), "mk-price");
  await P.click("#mk-save"); await until(() => location.hash === "#/market/item/ml_new");
  assert.deepEqual(calls("/api/market/listings", "POST").at(-1).body, { kind: "product", title: "دراجة", description: "دراجة هوائية بحالة جيدة", price: 12.5, category: "home", condition: "new", quantity: 2, delivery: "shipping", location: null, images: ["up_3", "up_2"], status: "active" });
  await P.waitForSelector("[data-mk-listing=ml_new]");
});

test("listing form: service kind (unlimited quantity, no condition), edit + pause, draft", async () => {
  await go("#/market/new"); await P.waitForSelector("#mk-form");
  await P.check("input[name=kind][value=service]"); assert.equal(await P.isHidden("#mk-condition"), true);
  await P.fill("#mk-title", "تصميم شعار احترافي"); await P.fill("#mk-price", "7"); await P.selectOption("#mk-category", "services"); await P.fill("#mk-quantity", "");
  await P.setInputFiles("#mk-files", [{ name: "s.png", mimeType: "image/png", buffer: PNG }]); await until(() => document.querySelectorAll("#mk-imgs img").length === 1);
  await P.click("#mk-draft"); await until(() => /^#\/market\/item\//.test(location.hash));
  const b = calls("/api/market/listings", "POST").at(-1).body; assert.equal(b.kind, "service"); assert.equal(b.condition, "na"); assert.equal(b.quantity, null); assert.equal(b.status, "draft");
  await go("#/market/edit/ml_mine"); await P.waitForSelector("#mk-form");
  assert.equal(await P.inputValue("#mk-title"), "كتاب برمجة للبيع"); assert.equal(await P.$$eval("#mk-imgs img", n => n.length), 2);
  assert.equal(await P.inputValue("#mk-category"), "books");
  await P.fill("#mk-price", "4"); await P.click("#mk-save"); await until(() => location.hash === "#/market/item/ml_mine");
  const pb = calls("/api/market/listings/ml_mine", "PATCH").at(-1).body; assert.equal(pb.price, 4); assert.deepEqual(pb.images, ["md_90_0", "md_90_1"]);
  await go("#/market/edit/ml_mine"); await P.waitForSelector("#mk-pause"); await P.click("#mk-pause");
  await until(() => !!document.getElementById("mk-resume"));
  assert.deepEqual(calls("/api/market/listings/ml_mine", "PATCH").at(-1).body, { status: "paused" });
  await P.click("#mk-resume"); await until(() => !!document.getElementById("mk-pause"));
});

test("#/market/orders: buyer / seller / my listings tabs (keyboard)", async () => {
  await go("#/market/orders"); await P.waitForSelector("#mk-panel [data-mk-o]");
  assert.equal(await P.getAttribute("#mk-tab-buyer", "aria-selected"), "true");
  assert.ok(calls("/api/me/market/orders", "GET").some(c => c.q === "?role=buyer"));
  assert.match(await P.textContent("[data-mk-o=mo_ship]"), /تم الشحن/);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.focus("#mk-tab-buyer"); await P.keyboard.press("ArrowLeft"); // RTL: next tab
  await until(() => document.getElementById("mk-tab-seller").getAttribute("aria-selected") === "true" && document.activeElement.id === "mk-tab-seller" && !!document.querySelector("#mk-panel [data-mk-o=mo_sell]"));
  assert.ok(calls("/api/me/market/orders", "GET").some(c => c.q === "?role=seller"));
  await P.keyboard.press("End"); await until(() => !!document.querySelector("#mk-panel [data-mk-l=ml_mine]"));
  assert.equal(await P.getAttribute("[data-mk-l=ml_mine] a[href^='#/market/edit/']", "href"), "#/market/edit/ml_mine");
  assert.equal(await P.getAttribute("#mk-panel", "aria-labelledby"), "mk-tab-listings");
  await P.click("#mk-tab-buyer");
});

test("order page (buyer): stepper, escrow, chat link, confirm receipt; review; dispute with evidence", async () => {
  await go("#/market/orders/mo_ship"); await P.waitForSelector("[data-mk-order=mo_ship]");
  assert.equal(await P.textContent(".mk-steps [aria-current=step]"), "الشحن");
  assert.match(await P.textContent(".mk-escrow"), /محجوز لدى المنصة/);
  assert.equal(await P.getAttribute("#mk-chat", "href"), "#/chat/cv_1");
  await shot("market-order");
  assert.ok(await P.$("[data-mk-act=confirm]")); assert.equal(await P.$("[data-mk-act=ship]"), null, "buyer cannot mark shipped");
  assert.ok(await P.$("#mk-disp"));
  assert.deepEqual(await axeOn(P, "#view"), []);
  // dispute with evidence
  await P.click("#mk-disp"); await P.waitForSelector("#mk-df");
  await P.check("input[name=mk-dr][value=damaged]"); await P.fill("#mk-dtext", "قصير"); await P.click("#mk-dgo");
  await until(() => /10 أحرف/.test(document.getElementById("mk-derr").textContent));
  await P.setInputFiles("#mk-dfile", [{ name: "e.png", mimeType: "image/png", buffer: PNG }]); await until(() => document.querySelectorAll("#mk-dev img").length === 1);
  assert.deepEqual(await axeOn(P, "#sheet"), []);
  await P.fill("#mk-dtext", "وصل الهاتف والشاشة مكسورة"); await P.click("#mk-dgo");
  await until(() => !!document.querySelector("#mk-dsp .mk-msgs") && document.getElementById("sheet").classList.contains("hidden"));
  const db = calls("/api/market/orders/mo_ship/dispute", "POST").at(-1).body;
  assert.equal(db.reason, "damaged"); assert.equal(db.text, "وصل الهاتف والشاشة مكسورة"); assert.equal(db.evidence.length, 1); assert.match(db.evidence[0], /^up_/);
  // confirm on another order (shipped → completed)
  st.orders.mo_ship.status = "delivered"; st.orders.mo_ship.disputeId = null;
  await go("#/market/orders/mo_done"); await go("#/market/orders/mo_ship"); await P.waitForSelector("[data-mk-order=mo_ship] [data-mk-act=confirm]");
  assert.match(await P.textContent(".mk-escrow"), /يُحرَّر تلقائياً/);
  await P.click("[data-mk-act=confirm]"); await P.waitForSelector("#mk-cgo"); assert.match(await P.textContent("#mk-cd"), /سيُحرَّر المبلغ المحجوز للبائع/);
  await P.click("#mk-cgo"); await until(() => /مكتمل/.test(document.querySelector("[data-mk-order=mo_ship] .mk-chip")?.textContent || ""));
  assert.equal(calls("/api/market/orders/mo_ship/confirm", "POST").length, 1);
  assert.match(await P.textContent(".mk-escrow"), /حُرّر المبلغ للبائع/);
  // review on a completed order
  await go("#/market/orders/mo_done"); await P.waitForSelector("#mk-rf");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("#mk-rf button[type=submit]"); await until(() => /اختر عدد النجوم/.test(document.getElementById("mk-rerr").textContent));
  await P.click("label[for=mk-r4]"); await P.fill("#mk-rtext", "تعامل راقٍ"); await P.click("#mk-rf button[type=submit]");
  await until(() => !document.getElementById("mk-rf") && /تقييمك/.test(document.getElementById("view").textContent));
  assert.deepEqual(calls("/api/market/orders/mo_done/review", "POST").at(-1).body, { rating: 4, text: "تعامل راقٍ" });
});

test("order page (seller): ship / deliver / cancel actions; dispute panel messages", async () => {
  await go("#/market/orders/mo_sell"); await P.waitForSelector("[data-mk-order=mo_sell]");
  assert.deepEqual(await P.$$eval("[data-mk-act]", n => n.map(b => b.dataset.mkAct)), ["ship", "deliver", "cancel"]);
  assert.equal(await P.$("#mk-disp"), null); assert.equal(await P.$("[data-mk-act=confirm]"), null);
  await P.click("[data-mk-act=ship]"); await P.click("#mk-cgo");
  await until(() => document.querySelectorAll("[data-mk-act]").length === 1 && !!document.querySelector("[data-mk-act=deliver]"));
  assert.equal(calls("/api/market/orders/mo_sell/ship", "POST").length, 1);
  await go("#/market/orders/mo_disp"); await P.waitForSelector("#mk-dsp .mk-msgs");
  assert.match(await P.textContent("#mk-dsp"), /مختلف عن الوصف/); assert.match(await P.textContent("#mk-dsp"), /الإدارة/);
  assert.equal(await P.$$eval("#mk-dsp .mk-ev img", n => n.length), 1);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.fill("#mk-dm", "أرفقت صوراً إضافية"); await P.click("#mk-dmf button");
  await until(() => /أرفقت صوراً إضافية/.test(document.getElementById("mk-dsp").textContent));
  assert.deepEqual(calls("/api/market/disputes/dp_1/messages", "POST").at(-1).body, { text: "أرفقت صوراً إضافية" });
});

test("seller page: rating summary, reviews + pagination; own page: reply to a review", async () => {
  await go("#/market/seller/yousef_shop"); await P.waitForSelector("#mk-revs");
  assert.match(await P.getAttribute(".mk-sum .mk-stars", "aria-label"), /٤٫٥ من 5 \(١٢ تقييم\)/);
  assert.match(await P.textContent("#view"), /رد البائع: شكراً لك/);
  assert.equal(await P.$("[data-mk-reply]"), null, "no reply button on someone else's page");
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.click("#mk-rm"); await until(() => document.querySelectorAll("#mk-revs .mk-rev").length === 3);
  assert.equal(await P.$("#mk-rm"), null);
  await go("#/market/seller/amal_market"); await P.waitForSelector("[data-mk-reply=rv9]");
  await P.click("[data-mk-reply=rv9]"); await P.waitForSelector(".mk-rpf textarea");
  assert.equal(await P.evaluate(() => document.activeElement.tagName), "TEXTAREA");
  await P.fill(".mk-rpf textarea", "نعتذر عن التأخير"); await P.click(".mk-rpf button");
  await until(() => /رد البائع: نعتذر عن التأخير/.test(document.getElementById("view").textContent));
  assert.deepEqual(calls("/api/market/reviews/rv9/reply", "POST").at(-1).body, { text: "نعتذر عن التأخير" });
});

test("admin: card on #/admin + #/admin/market/disputes (split validation, resolve)", async () => {
  await go("#/admin"); await P.waitForSelector("#mk-adm", { timeout: 15000 });
  await P.click("#mk-adm"); await P.waitForSelector("#mk-aq [data-mk-d]");
  assert.equal(await P.$$eval("#mk-aq [data-mk-d]", n => n.length), 2);
  assert.deepEqual(await axeOn(P, "#view"), []);
  await P.check("[data-mk-d=dp_1] input[value=split]"); assert.equal(await P.isHidden("[data-mk-d=dp_1] [data-amt]"), false);
  await P.fill("[data-mk-d=dp_1] [data-amt]", "5"); await P.click("[data-mk-d=dp_1] [data-mk-resolve]");
  await until(() => /أقل من 5 Pi/.test(document.querySelector("[data-mk-d=dp_1] [data-err]").textContent));
  await P.fill("[data-mk-d=dp_1] [data-amt]", "2"); await P.click("[data-mk-d=dp_1] [data-mk-resolve]");
  await until(() => document.querySelectorAll("#mk-aq [data-mk-d]").length === 1);
  assert.deepEqual(calls("/api/admin/market/disputes/dp_1/resolve", "POST").at(-1).body, { resolution: "split", buyerAmount: 2 });
  await P.click("[data-mk-d=dp_2] [data-mk-resolve]"); await until(() => /لا نزاعات مفتوحة/.test(document.getElementById("mk-aq").textContent));
  assert.deepEqual(calls("/api/admin/market/disputes/dp_2/resolve", "POST").at(-1).body, { resolution: "refund_buyer" });
});

test("real CSP (no 'unsafe-inline'): deep link to a product, gallery + buy flow work with no violations", async () => {
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce", bypassCSP: false });
  await stub(ctx); await ctx.addInitScript(FAKE_PI);
  await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI)); });
  const p = await ctx.newPage(); p.on("pageerror", e => errors.push("csp page: " + e.message));
  await ctx.addCookies(await ctxMain.cookies());
  await p.goto(S.base + "/?nosw#/market/item/ml_4");
  await p.waitForSelector("[data-mk-listing=ml_4] #mk-buy:not([disabled])", { timeout: 15000 });
  assert.match((await p.evaluate(() => document.querySelector("meta[http-equiv]")?.content || "")) + (await (await p.request.get(S.base + "/")).headers()["content-security-policy"]), /script-src 'self'/);
  await p.click("[data-mk-slide='0']"); await p.waitForSelector("#mk-lb"); await p.click("#mk-lbx");
  await p.click("#mk-buy"); await p.waitForSelector("#mk-go:not([disabled])"); await p.click("#mk-go");
  await until(() => /^#\/market\/orders\/mo_/.test(location.hash) && !!document.querySelector("[data-mk-order]"), null, 12000, p);
  await p.evaluate(() => { location.hash = "#/market/new"; }); await p.waitForSelector("#mk-form"); await p.click("#mk-save"); await p.waitForSelector("#mk-es:not([hidden])");
  assert.deepEqual((await p.evaluate(() => window.__csp)).filter(v => /script/.test(v)), []);
  await ctx.unrouteAll({ behavior: "ignoreErrors" }); await ctx.close();
});

/* ---------- integration (p39-integrate): the REAL P39 server, no market / media / Pi stubs ----------
 * A fresh context without any route stubs (only the fake window.Pi; real /api/pi/config, so Pi payments are off as in production).
 * Proves the client and server shapes match: listing form → real POST /api/media + POST /api/market/listings (stored row asserted),
 * grid + `condition=` filter answered by the server, product page (Pi off note), seller page (reviews:{items,next} + distribution
 * on seller) with a real reply, order page (server `actions`, timeline), admin dispute row (flat `title`, evidence). */
test("real P39 server: listing form, grid condition filter, product page (Pi off), seller reply, order page, admin dispute row", async () => {
  S.app.ctx.rl?.w?.clear?.(); // earlier tests in this file post listings: start with a fresh per-user write rate limit
  const { db } = S.app.ctx, { id } = require(path.join(ROOT, "server", "lib", "core")), at = (min) => new Date(Date.now() - min * 60e3).toISOString();
  const ctx = await S.browser.newContext({ ...MOBILE, userAgent: PI_UA, reducedMotion: "reduce" });
  await ctx.addInitScript(FAKE_PI); await ctx.addCookies(await ctxMain.cookies());
  const p = await ctx.newPage(); p.on("pageerror", e => errors.push("real page: " + e.message));
  await p.goto(S.base + "/?nosw#/market/new");
  const mc = await (await p.request.get(S.base + "/api/market/config")).json();
  assert.equal(mc.enabled, true); assert.ok(mc.maxPrice > 0);
  await p.waitForSelector("#mk-form", { timeout: 15000 });
  assert.equal(await p.getAttribute("#mk-price", "max"), String(mc.maxPrice), "form max price comes from /api/market/config");
  // 1) create through the form against the real server (real upload)
  await p.fill("#mk-title", "كاميرا رقمية مستعملة"); await p.fill("#mk-description", "كاميرا بحالة جيدة مع الشاحن");
  await p.fill("#mk-price", "7.5"); await p.selectOption("#mk-category", "electronics"); await p.selectOption("#mk-condition", "used");
  await p.fill("#mk-quantity", "3"); await p.selectOption("#mk-delivery", "shipping");
  await p.setInputFiles("#mk-files", { name: "cam.png", mimeType: "image/png", buffer: PNG });
  await p.waitForSelector("#mk-imgs li img", { timeout: 15000 });
  const respP0 = p.waitForResponse((r) => r.url().endsWith("/api/market/listings") && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
  await p.click("#mk-save");
  const resp0 = await respP0; assert.ok(resp0 && resp0.status() < 400, "POST /api/market/listings " + (resp0 ? resp0.status() : "not sent")); // wait for the real write before polling the route
  await until(() => /^#\/market\/item\/ml_/.test(location.hash) && !!document.querySelector("[data-mk-listing]"), null, 15000, p);
  const mine = await db.get("SELECT * FROM market_listings WHERE seller_id=$1 ORDER BY created_at DESC", [ME]);
  assert.equal(mine.title, "كاميرا رقمية مستعملة"); assert.equal(mine.item_condition, "used"); assert.equal(Number(mine.price), 7.5e7);
  assert.equal(Number(mine.quantity), 3); assert.equal(mine.status, "active"); assert.equal(JSON.parse(mine.images).length, 1);
  assert.ok(await p.$(`a[href="#/market/edit/${mine.id}"]`), "own listing → edit link instead of buy");
  // 2) a second seller with a "new" listing (real rows)
  const rid = id("u"); await db.run("INSERT INTO users(id,handle,name,bio,color,role,prefs,created_at) VALUES($1,$2,$3,'',$4,'user',$5,$6)", [rid, "rami_real", "رامي", "#047857", { onboarded: true, interests: [] }, at(60 * 24 * 90)]);
  const mid = id("md"); await db.run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'image','image/png',68,$3,'ready',$4,$5)", [mid, rid, mid + ".png", { original: "/media/" + mid + ".png" }, at(5)]);
  const lid = id("ml"); await db.run("INSERT INTO market_listings(id,seller_id,kind,title,description,price,currency,category,item_condition,quantity,images,location,delivery,status,views,created_at,updated_at) VALUES($1,$2,'product',$3,'سماعات جديدة',$4,'PI','electronics','new',2,$5,NULL,'shipping','active',0,$6,$6)", [lid, rid, "سماعات لاسلكية", 4e7, JSON.stringify([{ id: mid, alt: "" }]), at(3)]);
  // 3) grid + condition filter answered by the server
  await go("#/market", p); await until(() => document.querySelectorAll("#mk-grid [data-mk-id]").length === 2, null, 15000, p);
  await p.click("#mk-fd summary");
  const [resp] = await Promise.all([p.waitForResponse(r => /\/api\/market\/listings\?.*condition=used/.test(r.url())), p.selectOption("#mk-cond", "used")]);
  assert.equal(resp.status(), 200); const items = (await resp.json()).items;
  assert.deepEqual(items.map(x => [x.id, x.condition]), [[mine.id, "used"]], "server filters by condition");
  await until(() => document.querySelectorAll("#mk-grid [data-mk-id]").length === 1, null, 8000, p);
  await p.selectOption("#mk-cond", "");
  // 4) product page of someone else's listing, Pi off in this stack
  const pc = await (await p.request.get(S.base + "/api/pi/config")).json();
  await go("#/market/item/" + lid, p); await p.waitForSelector(`[data-mk-listing="${lid}"] #mk-buy`, { timeout: 15000 });
  assert.match(await p.textContent("[data-mk-listing] .mk-seller"), /@rami_real/);
  if (!pc.enabled) { assert.equal(await p.isDisabled("#mk-buy"), true); assert.match(await p.textContent("#mk-bn"), /مدفوعات Pi غير مفعّلة بعد/); }
  // 5) completed order (buyer rami → seller me) + review; seller page shows it, I reply for real
  const oid = id("mo"), now = at(1);
  await db.run("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,qty,unit_price,total,fee,status,created_at,updated_at,paid_at,delivered_at,completed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6,0,'completed',$7,$7,$7,$7,$7)", [oid, mine.id, rid, ME, mine.title, 7.5e7, now]);
  const rvid = id("mr"); await db.run("INSERT INTO market_reviews(id,order_id,listing_id,buyer_id,seller_id,rating,text,hidden,created_at,updated_at) VALUES($1,$2,$3,$4,$5,4,'وصلت الكاميرا سليمة',0,$6,$6)", [rvid, oid, mine.id, rid, ME, now]);
  await go("#/market/seller/amal_market", p); await p.waitForSelector(`[data-mk-rev="${rvid}"]`, { timeout: 15000 });
  assert.ok(await p.$("ul[aria-label='توزيع التقييمات']"), "distribution (on seller) is rendered");
  await p.click(`[data-mk-reply="${rvid}"]`); await p.fill(`[data-mk-rev="${rvid}"] textarea`, "شكراً لثقتك"); await p.click(`[data-mk-rev="${rvid}"] .mk-rpf button`);
  await p.waitForSelector(`[data-mk-rev="${rvid}"] .mk-reply`);
  assert.equal((await db.get("SELECT reply FROM market_reviews WHERE id=$1", [rvid])).reply, "شكراً لثقتك");
  // 6) order page as seller: server actions (none when completed + reviewed), timeline
  await go("#/market/orders/" + oid, p); await p.waitForSelector(`[data-mk-order="${oid}"]`, { timeout: 15000 });
  assert.equal(await p.$$eval("[data-mk-act]", n => n.length), 0); assert.ok(await p.$$eval(".mk-tl li", n => n.length) >= 1);
  // 7) disputed order → admin queue row with the flat title
  const oid2 = id("mo"), did = id("md");
  await db.run("INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,qty,unit_price,total,fee,status,prev_status,created_at,updated_at,paid_at,disputed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6,0,'disputed','paid_held',$7,$7,$7,$7)", [oid2, mine.id, rid, ME, mine.title, 7.5e7, now]);
  await db.run("INSERT INTO market_disputes(id,order_id,opened_by,buyer_id,seller_id,reason,text,evidence,status,created_at,updated_at) VALUES($1,$2,$3,$3,$4,'not_received','لم يصل الطلب بعد','[]','open',$5,$5)", [did, oid2, rid, ME, now]);
  await go("#/admin/market/disputes", p); await p.waitForSelector(`[data-mk-d="${did}"]`, { timeout: 15000 });
  const row = await p.textContent(`[data-mk-d="${did}"]`);
  assert.match(row, /كاميرا رقمية مستعملة/); assert.match(row, /@rami_real/); assert.match(row, /لم يصلني الطلب/);
  await ctx.close();
});
