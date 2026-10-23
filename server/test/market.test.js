/* Phase 39 — Community marketplace (السوق المجتمعي). Stubbed Pi Platform API + App Studio login (same stub as
 * paid.test.js, injected through config.piOpts), injectable clock for the market service, SQLite by default and
 * PostgreSQL with TEST_DATABASE_URL. Covers: migration 022 (down/up, static additive check), listing validation
 * (minors, price range/decimals, category, images ownership/count, spam), full listing shape + canBuy/buyReason,
 * edit/pause/delete, browse filters/sort/cursor, search indexing (type=listing on /api/search and /api/search/full,
 * paused/removed excluded), orders through the pi service (purpose market, intent passed unchanged, paid_held on
 * complete, escrow + double-entry journals with a fee, ledger balanced, idempotent replay), order conversation +
 * system messages, ship/deliver/confirm, quantity reservation/sold_out/restore on cancel, auto-release + pending expiry
 * job, reviews + seller reply + seller page aggregate, disputes (thread, seller_responded, admin queue, resolve
 * refund_buyer / release_seller / split), seller cancel after payment, minors and blocks, notifications + hrefs,
 * compliance export/erasure, Pi payments off → 409 not_configured. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_market_456";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "mpay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") {
    const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || ""));
    return m ? res(200, { sessionToken: "st-" + m[1], user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {});
  }
  const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path);
  const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_MAX_AMOUNT: "1000" };
const DAY = 864e5;
let offset = 0;
const now = () => new Date(Date.now() + offset);

let H, admin, sara, omar, lina, minnie, bob, unlinked;
const db = () => H.app.ctx.db;
const market = () => H.app.ctx.services.market;
const L = {}; // listing ids
const O = {}; // order ids
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
const settle = async () => { await H.app.ctx.services.paid.settle(); await market().settle(); };
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await settle();
  return p;
}
const check = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.status, 200); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); return r; };
const balance = async (account) => { const r = await db().get("SELECT COALESCE(SUM(credit),0) AS c, COALESCE(SUM(debit),0) AS d FROM ledger_entries WHERE account=$1", [account]); return (Number(r.c) - Number(r.d)) / 1e7; };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
async function upload(c) {
  H.app.ctx.rl.w.clear();
  const r = await fetch(H.base + "/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "image/png", Cookie: c.cookie }, body: PNG });
  const j = await r.json(); assert.equal(r.status, 200, j.error); return j.media;
}
const base = (imgs, extra = {}) => ({ kind: "product", title: "هاتف ذكي مستعمل بحالة ممتازة", description: "هاتف نظيف مع الشاحن الأصلي والعلبة", price: 12.5, category: "electronics", condition: "used", quantity: 2, images: imgs, location: "جدة", delivery: "shipping", ...extra });
const order = async (c, lid, qty = 1) => { H.app.ctx.rl.w.clear(); return c.req("POST", `/api/market/listings/${lid}/order`, { qty }); };
const notes = async (uid, kind) => db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind]);

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, marketOpts: { env: { MARKET_FEE_PCT: "10", MARKET_AUTO_RELEASE_DAYS: "7" }, now, jobs: false } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) { // HTTP status wins over a body field named status
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, text, status: r.status, headers: r.headers };
  };
  admin = await mk("mk_admin"); sara = await mk("mk_sara"); omar = await mk("mk_omar"); lina = await mk("mk_lina"); minnie = await mk("mk_minnie"); bob = await mk("mk_bob"); unlinked = await mk("mk_unlinked");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  for (const c of [omar, lina, minnie, bob]) await linkPi(c);
  assert.equal((await minnie.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 022: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '022_market' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "022_market"]);
  await assert.rejects(() => db().get("SELECT 1 FROM market_orders"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM paid_purchases")).n) >= 0, "021 tables untouched");
  assert.deepEqual(await mig.up(db()), ["022_market", ...later]);
  for (const t of ["market_listings", "market_orders", "market_escrow", "market_reviews", "market_disputes", "market_dispute_messages"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "022_market.js"));
});

test("listings: validation, minors, spam, full shape with images and canBuy reasons", async () => {
  const img1 = await upload(sara), img2 = await upload(sara), other = await upload(omar);
  sara.imgs = [img1, img2];
  const e = async (c, body, status, code) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/market/listings", body); assert.equal(r.status, status, JSON.stringify(body).slice(0, 120) + " → " + r.status + " " + r.error); if (code) assert.equal(r.code, code); return r; };
  await e(minnie, base([img1.id]), 403, "minor_restricted");
  for (const [p, code] of [[0, "price_invalid"], [0.001, "price_invalid"], [1000.5, "price_invalid"], ["abc", "price_invalid"], [1.123456789, "price_invalid"]]) await e(sara, base([img1.id], { price: p }), 400, code);
  await e(sara, base([img1.id], { category: "cars" }), 400, "category_invalid");
  await e(sara, base([]), 400, "images_invalid");
  await e(sara, base([other.id]), 400, "images_invalid");
  await e(sara, base(Array(9).fill(img1.id)), 400, "images_invalid");
  await e(sara, base([img1.id], { title: "ab" }), 400, "listing_invalid");
  await e(sara, base([img1.id], { kind: "car" }), 400, "listing_invalid");
  await e(sara, base([img1.id], { delivery: "drone" }), 400, "listing_invalid");
  await e(sara, base([img1.id], { quantity: -1 }), 400, "listing_invalid");
  await e(sara, base([img1.id], { description: "اربح 1000 دولار الآن ضاعف أموالك" }), 422, "spam");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM market_listings")).n), 0, "nothing persisted");

  const r = await e(sara, base([{ id: img1.id, alt: "الواجهة الأمامية" }, img2.url]), 200);
  L.phone = r.listing.id;
  assert.match(L.phone, /^ml_/);
  const g = r.listing;
  assert.equal(g.price, 12.5); assert.equal(g.currency, "PI"); assert.equal(g.status, "active"); assert.equal(g.quantity, 2); assert.equal(g.condition, "used");
  assert.equal(g.images.length, 2); assert.deepEqual(Object.keys(g.images[0]).sort(), ["alt", "h", "id", "thumb", "url", "w"]);
  assert.equal(g.images[0].alt, "الواجهة الأمامية"); assert.equal(g.images[1].id, img2.id); assert.ok(g.images[0].url.startsWith("/media/"));
  assert.equal(g.seller.handle, "mk_sara"); assert.deepEqual(g.seller.rating, { avg: 0, count: 0 }); assert.equal(g.seller.sales, 0);
  assert.equal(g.canBuy, false); assert.equal(g.buyReason, "own_listing");
  const anon = await new H.Client().req("GET", "/api/market/listings/" + L.phone);
  assert.equal(anon.status, 200); assert.equal(anon.listing.canBuy, false); assert.equal(anon.listing.buyReason, "sign_in");
  assert.equal((await minnie.req("GET", "/api/market/listings/" + L.phone)).listing.buyReason, "minor_restricted");
  const ob = await omar.req("GET", "/api/market/listings/" + L.phone);
  assert.equal(ob.listing.canBuy, true); assert.equal(ob.listing.buyReason, undefined); assert.ok(ob.listing.views >= 2);
  // a service with unlimited quantity, and a book
  const s = await e(sara, { kind: "service", title: "دروس خصوصية في الرياضيات", description: "حصص أونلاين", price: 3, category: "education", images: [img2.id] }, 200);
  L.lesson = s.listing.id; assert.equal(s.listing.quantity, null); assert.equal(s.listing.delivery, "onsite"); assert.equal(s.listing.condition, "na");
  const b = await e(sara, base([img1.id], { title: "رواية عربية كلاسيكية", description: "طبعة قديمة", price: 1, category: "books", quantity: 1, condition: "used" }), 200);
  L.book = b.listing.id;
  // edit / pause / delete
  const p = await sara.req("PATCH", "/api/market/listings/" + L.book, { price: 1.25, status: "paused" });
  assert.equal(p.status, 200, p.error); assert.equal(p.listing.price, 1.25); assert.equal(p.listing.status, "paused");
  assert.equal((await omar.req("GET", "/api/market/listings/" + L.book)).status, 404, "paused is owner-only");
  assert.equal((await omar.req("PATCH", "/api/market/listings/" + L.book, { price: 2 })).status, 403);
  assert.equal((await sara.req("PATCH", "/api/market/listings/" + L.book, { category: "x" })).code, "category_invalid");
  assert.equal((await sara.req("PATCH", "/api/market/listings/" + L.book, { status: "active" })).listing.status, "active");
  const tmp = await e(sara, base([img1.id], { title: "إعلان للحذف" }), 200);
  assert.equal((await sara.req("DELETE", "/api/market/listings/" + tmp.listing.id)).status, 200);
  assert.equal((await omar.req("GET", "/api/market/listings/" + tmp.listing.id)).status, 404);
  assert.equal((await db().get("SELECT status FROM market_listings WHERE id=$1", [tmp.listing.id])).status, "removed");
  const mine = await sara.req("GET", "/api/me/market/listings");
  assert.deepEqual(mine.items.map(x => x.id).sort(), [L.phone, L.lesson, L.book].sort());
});

test("browse: filters, sort, cursor; search index type=listing (paused/removed excluded)", async () => {
  const anon = new H.Client();
  const all = await anon.req("GET", "/api/market/listings");
  assert.equal(all.status, 200); assert.deepEqual(all.items.map(x => x.id).sort(), [L.phone, L.lesson, L.book].sort());
  const card = all.items.find(x => x.id === L.phone);
  assert.ok(card.cover && card.cover.url.startsWith("/media/")); assert.equal(card.imageCount, 2); assert.equal(card.seller.handle, "mk_sara"); assert.equal(card.description, undefined);
  assert.deepEqual((await anon.req("GET", "/api/market/listings?category=books")).items.map(x => x.id), [L.book]);
  assert.deepEqual((await anon.req("GET", "/api/market/listings?kind=service")).items.map(x => x.id), [L.lesson]);
  assert.deepEqual((await anon.req("GET", "/api/market/listings?min=2&max=5")).items.map(x => x.id), [L.lesson]);
  assert.deepEqual((await anon.req("GET", "/api/market/listings?sort=price_asc")).items.map(x => x.price), [1.25, 3, 12.5]);
  assert.deepEqual((await anon.req("GET", "/api/market/listings?sort=price_desc")).items.map(x => x.price), [12.5, 3, 1.25]);
  assert.equal((await anon.req("GET", "/api/market/listings?sort=rating")).items.length, 3);
  assert.equal((await anon.req("GET", "/api/market/listings?category=cars")).code, "category_invalid");
  const p1 = await anon.req("GET", "/api/market/listings?limit=2&sort=price_asc");
  assert.equal(p1.items.length, 2); assert.ok(p1.next);
  const p2 = await anon.req("GET", "/api/market/listings?limit=2&sort=price_asc&cursor=" + p1.next);
  assert.deepEqual(p2.items.map(x => x.price), [12.5]); assert.equal(p2.next, null);
  // search: listing text indexed; q filter on the grid
  assert.deepEqual((await anon.req("GET", "/api/market/listings?q=" + encodeURIComponent("هاتف"))).items.map(x => x.id), [L.phone]);
  const s = await anon.req("GET", "/api/search?type=listing&q=" + encodeURIComponent("رياضيات"));
  assert.equal(s.status, 200, s.error); assert.equal(s.type, "listing"); assert.deepEqual(s.listings.map(x => x.id), [L.lesson]);
  const sf = await anon.req("GET", "/api/search/full?type=listing&q=" + encodeURIComponent("رواية"));
  assert.equal(sf.status, 200, sf.error); assert.deepEqual(sf.groups.listings.items.map(x => x.id), [L.book]);
  const mixed = await anon.req("GET", "/api/search?q=" + encodeURIComponent("هاتف"));
  assert.equal(mixed.status, 200); assert.deepEqual(mixed.listings.map(x => x.id), [L.phone]); assert.ok(Array.isArray(mixed.posts));
  assert.ok(await db().get("SELECT 1 x FROM search_docs WHERE kind='listing' AND ref_id=$1", [L.phone]));
  await sara.req("PATCH", "/api/market/listings/" + L.book, { status: "paused" });
  assert.equal((await anon.req("GET", "/api/search?type=listing&q=" + encodeURIComponent("رواية"))).listings.length, 0, "paused not searchable");
  assert.equal((await anon.req("GET", "/api/market/listings?category=books")).items.length, 0);
  await sara.req("PATCH", "/api/market/listings/" + L.book, { status: "active" });
  assert.equal((await anon.req("GET", "/api/search?type=listing&q=" + encodeURIComponent("رواية"))).listings.length, 1);
});

test("order → Pi payment → escrow held → ship → deliver → confirm → released; conversation + notifications", async () => {
  // errors first
  assert.equal((await order(sara, L.phone)).code, "own_listing");
  assert.equal((await order(minnie, L.phone)).code, "minor_restricted");
  assert.equal((await order(omar, L.phone, 0)).code, "qty_invalid");
  assert.equal((await order(omar, L.phone, 3)).code, "insufficient_quantity");
  assert.equal((await order(unlinked, L.phone)).code, "pi_not_linked");
  assert.equal(Number((await db().get("SELECT quantity FROM market_listings WHERE id=$1", [L.phone])).quantity), 2, "failed intents release the reservation");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM market_orders")).n), 0);

  const r = await order(omar, L.phone, 1);
  assert.equal(r.status, 200, r.error);
  O.a = r.order.id; assert.match(O.a, /^mo_/);
  assert.equal(r.order.status, "pending_payment"); assert.equal(r.order.total, 12.5); assert.equal(r.order.fee, 1.25); assert.equal(r.order.role, "buyer");
  assert.ok(r.order.conversationId); assert.deepEqual(r.order.actions, ["pay", "cancel"]);
  assert.equal(r.intent.amount, 12.5); assert.equal(r.intent.metadata.intentId, r.intent.id);
  const tx = await db().get("SELECT * FROM pi_transactions WHERE id=$1", [r.intent.id]);
  assert.equal(tx.purpose, "market"); assert.equal(tx.ref_id, O.a);
  assert.equal(Number((await db().get("SELECT quantity FROM market_listings WHERE id=$1", [L.phone])).quantity), 1, "reserved");
  assert.equal((await notes(sara.id, "market_order_new")).length, 1);
  // the order conversation: both members, titled with the listing, system message
  const members = await db().all("SELECT user_id, state FROM conversation_members WHERE conv=$1 ORDER BY user_id", [r.order.conversationId]);
  assert.deepEqual(members.map(m => m.user_id).sort(), [omar.id, sara.id].sort()); assert.ok(members.every(m => m.state === "accepted"));
  assert.ok((await db().get("SELECT title FROM conversations WHERE id=$1", [r.order.conversationId])).title.includes("هاتف"));
  // re-fetch offers the same intent while pending
  const pend = await omar.req("GET", "/api/market/orders/" + O.a);
  assert.equal(pend.order.intent.id, r.intent.id); assert.equal(pend.order.escrow, null);
  assert.equal((await lina.req("GET", "/api/market/orders/" + O.a)).status, 404, "strangers cannot read an order");
  assert.equal((await admin.req("GET", "/api/market/orders/" + O.a)).order.role, "admin");
  assert.equal((await sara.req("POST", `/api/market/orders/${O.a}/ship`, {})).code, "invalid_state", "not paid yet");

  await payIntent(omar, r.intent);
  const o = (await omar.req("GET", "/api/market/orders/" + O.a)).order;
  assert.equal(o.status, "paid_held"); assert.equal(o.escrow.state, "held"); assert.equal(o.escrow.amount, 12.5);
  assert.deepEqual(o.actions, ["confirm", "dispute"]);
  assert.equal((await notes(sara.id, "market_order_paid")).length, 1);
  const hold = await db().all("SELECT j.kind, e.account, e.debit, e.credit FROM ledger_journals j JOIN ledger_entries e ON e.journal_id=j.id WHERE j.ref_id=$1 ORDER BY e.id", [O.a]);
  assert.deepEqual(hold.map(x => [x.kind, x.account, Number(x.debit), Number(x.credit)]), [["market_hold", `user:${omar.id}:pi_out`, 125000000, 0], ["market_hold", "escrow:market", 0, 125000000]]);
  assert.equal(await balance("escrow:market"), 12.5);
  // replaying the Pi completion changes nothing
  H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: r.intent.id, purpose: "market", amount: 12.5, refId: O.a });
  await settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE ref_id=$1", [O.a])).n), 1);
  await check();

  assert.equal((await omar.req("POST", `/api/market/orders/${O.a}/ship`, {})).status, 403, "buyer cannot ship");
  const sh = await sara.req("POST", `/api/market/orders/${O.a}/ship`, { tracking: "SA123456" });
  assert.equal(sh.status, 200, sh.error); assert.equal(sh.order.status, "shipped"); assert.equal(sh.order.tracking, "SA123456");
  assert.equal((await notes(omar.id, "market_order_shipped")).length, 1);
  const dl = await sara.req("POST", `/api/market/orders/${O.a}/deliver`, {});
  assert.equal(dl.order.status, "delivered"); assert.ok(dl.order.autoReleaseAt);
  assert.equal((await notes(omar.id, "market_order_delivered")).length, 1);
  assert.equal((await sara.req("POST", `/api/market/orders/${O.a}/confirm`, {})).status, 403, "seller cannot confirm");
  const cf = await omar.req("POST", `/api/market/orders/${O.a}/confirm`, {});
  assert.equal(cf.status, 200, cf.error); assert.equal(cf.order.status, "completed"); assert.equal(cf.order.escrow.state, "released");
  assert.equal(cf.order.escrow.sellerAmount, 11.25); assert.equal(cf.order.escrow.fee, 1.25); assert.deepEqual(cf.order.actions, ["review"]);
  assert.deepEqual(cf.order.timeline.map(t => t.status), ["pending_payment", "paid_held", "shipped", "delivered", "completed"]);
  assert.equal((await omar.req("POST", `/api/market/orders/${O.a}/confirm`, {})).code, "invalid_state");
  assert.equal(await balance("escrow:market"), 0); assert.equal(await balance(`seller:${sara.id}:earnings`), 11.25); assert.equal(await balance("platform:fees"), 1.25);
  assert.equal((await notes(sara.id, "market_order_completed")).length, 1);
  await check();
  // tips earnings are unaffected by market journals
  const earn = await sara.req("GET", "/api/me/earnings");
  if (earn.status === 200) assert.equal(earn.gross, 0);
  // system messages for every transition in the order conversation
  const sys = await db().all("SELECT text, meta FROM messages WHERE conv=$1 AND kind='system' ORDER BY created_at", [r.order.conversationId]);
  assert.deepEqual(sys.map(m => m.meta.step), ["pending_payment", "paid_held", "shipped", "delivered", "completed"]);
  assert.ok(sys.every(m => m.meta.event === "market" && m.meta.order === O.a && m.text));
  // lists
  assert.deepEqual((await omar.req("GET", "/api/me/market/orders")).items.map(x => x.id), [O.a]);
  assert.deepEqual((await sara.req("GET", "/api/me/market/orders?role=seller")).items.map(x => x.id), [O.a]);
  assert.equal((await sara.req("GET", "/api/me/market/orders")).items.length, 0);
});

test("reviews: one per completed order, seller reply, seller page aggregate", async () => {
  assert.equal((await sara.req("POST", `/api/market/orders/${O.a}/review`, { rating: 5 })).status, 403);
  assert.equal((await omar.req("POST", `/api/market/orders/${O.a}/review`, { rating: 6 })).code, "review_invalid");
  assert.equal((await omar.req("POST", `/api/market/orders/${O.a}/review`, { rating: 4, text: "x".repeat(1001) })).code, "review_invalid");
  const r = await omar.req("POST", `/api/market/orders/${O.a}/review`, { rating: 4, text: "بائعة أمينة والمنتج كما في الوصف" });
  assert.equal(r.status, 200, r.error); assert.equal(r.review.rating, 4); assert.equal(r.review.buyer.handle, "mk_omar");
  assert.equal((await omar.req("POST", `/api/market/orders/${O.a}/review`, { rating: 5 })).code, "review_exists");
  const n = await notes(sara.id, "market_review");
  assert.equal(n.length, 1); assert.equal(n[0].ref, "mk_sara");
  assert.equal((await omar.req("POST", `/api/market/reviews/${r.review.id}/reply`, { text: "؟" })).status, 403);
  const rp = await sara.req("POST", `/api/market/reviews/${r.review.id}/reply`, { text: "شكراً لك!" });
  assert.equal(rp.status, 200, rp.error); assert.equal(rp.review.reply, "شكراً لك!");
  const page = await new H.Client().req("GET", "/api/market/sellers/mk_sara");
  assert.equal(page.status, 200, page.error);
  assert.deepEqual(page.seller.rating, { avg: 4, count: 1 }); assert.equal(page.seller.sales, 1); assert.equal(page.seller.distribution[4], 1);
  assert.equal(page.reviews.items[0].reply, "شكراً لك!"); assert.ok(page.listings.length >= 1);
  assert.deepEqual((await omar.req("GET", "/api/market/listings/" + L.lesson)).listing.seller.rating, { avg: 4, count: 1 });
  assert.equal((await new H.Client().req("GET", "/api/market/sellers/nobody_here")).status, 404);
  assert.equal((await omar.req("GET", "/api/market/orders/" + O.a)).order.review.rating, 4);
});

test("quantity: sold_out at zero, cancel restores; buyer cancel; pending expiry job", async () => {
  const a = await order(lina, L.phone, 1); // last one in stock
  assert.equal(a.status, 200, a.error); O.b = a.order.id;
  const l = await db().get("SELECT status, quantity FROM market_listings WHERE id=$1", [L.phone]);
  assert.equal(l.status, "sold_out"); assert.equal(Number(l.quantity), 0);
  assert.equal((await order(bob, L.phone)).code, "sold_out");
  assert.equal((await bob.req("GET", "/api/market/listings/" + L.phone)).listing.buyReason, "sold_out");
  assert.equal((await new H.Client().req("GET", "/api/search?type=listing&q=" + encodeURIComponent("هاتف"))).listings.length, 0, "sold_out not searchable");
  const c = await lina.req("POST", `/api/market/orders/${O.b}/cancel`, { reason: "غيّرت رأيي" });
  assert.equal(c.status, 200, c.error); assert.equal(c.order.status, "cancelled");
  const l2 = await db().get("SELECT status, quantity FROM market_listings WHERE id=$1", [L.phone]);
  assert.equal(l2.status, "active"); assert.equal(Number(l2.quantity), 1);
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [a.intent.id])).status, "cancelled");
  // an unpaid order expires
  const b = await order(bob, L.phone, 1); O.c = b.order.id;
  offset = 25 * 3600e3;
  const j = await market().releaseJob();
  offset = 0;
  assert.equal(j.expired, 1);
  assert.equal((await db().get("SELECT status, cancel_reason FROM market_orders WHERE id=$1", [O.c])).cancel_reason, "payment_expired");
  assert.equal(Number((await db().get("SELECT quantity FROM market_listings WHERE id=$1", [L.phone])).quantity), 1);
  await check();
});

test("auto-release after MARKET_AUTO_RELEASE_DAYS from delivered; disputes freeze it", async () => {
  const a = await order(lina, L.lesson, 2); assert.equal(a.status, 200, a.error); O.d = a.order.id;
  await payIntent(lina, a.intent);
  assert.equal((await sara.req("POST", `/api/market/orders/${O.d}/deliver`, {})).order.status, "delivered");
  const b = await order(bob, L.lesson, 1); O.e = b.order.id;
  await payIntent(bob, b.intent);
  await sara.req("POST", `/api/market/orders/${O.e}/deliver`, {});
  const dsp = await bob.req("POST", `/api/market/orders/${O.e}/dispute`, { reason: "not_as_described", text: "الدرس لم يكن كما وُصف" });
  assert.equal(dsp.status, 200, dsp.error); assert.equal(dsp.dispute.status, "open"); assert.equal(dsp.dispute.order.status, "disputed");
  O.eDispute = dsp.dispute.id;
  offset = 6 * DAY; assert.equal((await market().releaseJob()).released, 0, "not yet");
  offset = 8 * DAY; const j = await market().releaseJob(); offset = 0;
  assert.equal(j.released, 1, "only the undisputed order");
  const o = (await sara.req("GET", "/api/market/orders/" + O.d)).order;
  assert.equal(o.status, "completed"); assert.equal(o.escrow.state, "released"); assert.equal(o.escrow.sellerAmount, 5.4);
  assert.equal((await db().get("SELECT auto_released FROM market_orders WHERE id=$1", [O.d])).auto_released, 1);
  assert.equal((await notes(lina.id, "market_order_completed")).length, 1);
  assert.equal((await db().get("SELECT status FROM market_orders WHERE id=$1", [O.e])).status, "disputed");
  await check();
});

test("disputes: thread, seller_responded, admin queue, resolve split / refund_buyer / release_seller", async () => {
  assert.equal((await lina.req("GET", "/api/market/disputes/" + O.eDispute)).status, 404);
  assert.equal((await bob.req("POST", `/api/market/orders/${O.e}/dispute`, { reason: "damaged" })).code, "dispute_exists");
  assert.equal((await lina.req("POST", `/api/market/orders/${O.d}/dispute`, { reason: "damaged" })).code, "invalid_state", "completed orders cannot be disputed");
  assert.equal((await bob.req("POST", `/api/market/orders/${O.e}/confirm`, {})).code, "invalid_state", "frozen while disputed");
  const ev = await upload(sara);
  const m = await sara.req("POST", `/api/market/disputes/${O.eDispute}/messages`, { text: "قدّمت الدرس كاملاً، هذا الإثبات", evidence: [ev.id] });
  assert.equal(m.status, 200, m.error); assert.equal(m.dispute.status, "seller_responded"); assert.equal(m.dispute.messages[0].role, "seller"); assert.equal(m.dispute.messages[0].evidence[0].id, ev.id);
  assert.equal((await sara.req("POST", `/api/market/disputes/${O.eDispute}/messages`, { text: "x", evidence: [(await upload(bob)).id] })).code, "evidence_invalid");
  assert.equal((await notes(sara.id, "market_dispute_opened")).length, 1);
  assert.equal((await bob.req("GET", "/api/admin/market/disputes")).status, 403);
  const q = await admin.req("GET", "/api/admin/market/disputes");
  assert.equal(q.status, 200); assert.deepEqual(q.items.map(x => x.id), [O.eDispute]);
  assert.ok(Array.isArray(q.items[0].evidence) && q.items[0].title, "admin rows carry title + evidence (the UI renders both)");
  assert.equal((await admin.req("POST", `/api/admin/market/disputes/${O.eDispute}/resolve`, { resolution: "nope" })).code, "resolution_invalid");
  assert.equal((await admin.req("POST", `/api/admin/market/disputes/${O.eDispute}/resolve`, { resolution: "split", buyerAmount: 3 })).code, "split_invalid");
  assert.equal((await admin.req("POST", `/api/admin/market/disputes/${O.eDispute}/resolve`, { resolution: "split", buyerAmount: 0 })).code, "split_invalid");
  const r = await admin.req("POST", `/api/admin/market/disputes/${O.eDispute}/resolve`, { resolution: "split", buyerAmount: 1, note: "نصف ونصف تقريباً" });
  assert.equal(r.status, 200, r.error); assert.equal(r.dispute.status, "resolved"); assert.equal(r.dispute.resolution, "split"); assert.equal(r.dispute.buyerAmount, 1);
  const o = (await bob.req("GET", "/api/market/orders/" + O.e)).order;
  assert.equal(o.status, "completed"); assert.equal(o.escrow.state, "split"); assert.equal(o.escrow.buyerAmount, 1); assert.equal(o.escrow.sellerAmount, 1.8); assert.equal(o.escrow.fee, 0.2);
  assert.equal((await admin.req("POST", `/api/admin/market/disputes/${O.eDispute}/resolve`, { resolution: "refund_buyer" })).code, "dispute_resolved");
  assert.equal((await notes(bob.id, "market_dispute_resolved")).length, 1);
  await check();

  // refund_buyer: escrow back to the buyer, the Pi payment is recorded refunded, quantity restored
  const lq = Number((await db().get("SELECT quantity FROM market_listings WHERE id=$1", [L.book])).quantity);
  const a = await order(bob, L.book, 1); O.f = a.order.id; await payIntent(bob, a.intent);
  const d1 = await bob.req("POST", `/api/market/orders/${O.f}/dispute`, { reason: "not_received" }); assert.equal(d1.status, 200, d1.error);
  const r1 = await admin.req("POST", `/api/admin/market/disputes/${d1.dispute.id}/resolve`, { resolution: "refund_buyer" });
  assert.equal(r1.status, 200, r1.error); await settle();
  const of = (await bob.req("GET", "/api/market/orders/" + O.f)).order;
  assert.equal(of.status, "refunded"); assert.equal(of.escrow.state, "refunded"); assert.equal(of.escrow.buyerAmount, 1.25);
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [a.intent.id])).status, "refunded");
  assert.equal(Number((await db().get("SELECT quantity FROM market_listings WHERE id=$1", [L.book])).quantity), lq);
  // release_seller after the seller opened the dispute
  const b = await order(bob, L.book, 1); O.g = b.order.id; await payIntent(bob, b.intent);
  await sara.req("POST", `/api/market/orders/${O.g}/ship`, {});
  const d2 = await sara.req("POST", `/api/market/orders/${O.g}/dispute`, { reason: "other", text: "المشتري لا يرد بعد الاستلام" });
  assert.equal(d2.status, 200, d2.error); assert.equal(d2.dispute.openerRole, "seller");
  assert.equal((await bob.req("POST", `/api/market/disputes/${d2.dispute.id}/messages`, { text: "استلمته، آسف" })).dispute.status, "seller_responded");
  const r2 = await admin.req("POST", `/api/admin/market/disputes/${d2.dispute.id}/resolve`, { resolution: "release_seller" });
  assert.equal(r2.status, 200, r2.error);
  assert.equal((await sara.req("GET", "/api/market/orders/" + O.g)).order.escrow.state, "released");
  assert.equal((await admin.req("GET", "/api/admin/market/disputes?status=resolved")).items.length, 3);
  await check();
  assert.equal(await balance("escrow:market"), 0, "nothing left in escrow");
});

test("seller cancels after payment → refunded; blocks; Pi-direct refund unwinds escrow", async () => {
  const a = await order(bob, L.lesson, 1); O.h = a.order.id; await payIntent(bob, a.intent);
  assert.equal((await bob.req("POST", `/api/market/orders/${O.h}/cancel`, {})).code, "invalid_state", "buyer must dispute after paying");
  const c = await sara.req("POST", `/api/market/orders/${O.h}/cancel`, { reason: "لا أستطيع تقديم الخدمة" });
  assert.equal(c.status, 200, c.error); await settle();
  assert.equal(c.order.status, "refunded"); assert.equal(c.order.escrow.state, "refunded");
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=$1", [a.intent.id])).status, "refunded");
  // staff refund the Pi payment directly from the Pi admin route while the escrow is held
  const b = await order(bob, L.lesson, 1); O.i = b.order.id; await payIntent(bob, b.intent);
  const rf = await admin.req("POST", `/api/admin/pi/payments/${b.intent.id}/refund`, { note: "خطأ" });
  assert.equal(rf.status, 200, rf.error); await settle();
  const oi = (await bob.req("GET", "/api/market/orders/" + O.i)).order;
  assert.equal(oi.status, "refunded"); assert.equal(oi.escrow.state, "refunded");
  await check();
  // blocks
  const bl = await bob.req("PUT", "/api/protection/blocks/" + sara.id, {});
  assert.equal(bl.status, 200, bl.error);
  assert.equal((await order(bob, L.lesson)).code, "blocked");
  assert.equal((await bob.req("GET", "/api/market/listings/" + L.lesson)).listing.buyReason, "blocked");
});

test("notifications: kinds and hrefs", async () => {
  const NL = require("../lib/notify-lib");
  for (const k of ["market_order_new", "market_order_paid", "market_order_shipped", "market_order_delivered", "market_order_completed", "market_review", "market_dispute_opened", "market_dispute_resolved"]) {
    assert.ok(NL.KINDS[k], k);
    if (k !== "market_review") assert.equal(NL.hrefFor({ kind: k, ref: "mo_x1" }), "/#/market/orders/mo_x1");
  }
  assert.equal(NL.hrefFor({ kind: "market_review", ref: "mk_sara" }), "/#/market/seller/mk_sara");
  const list = await sara.req("GET", "/api/notifications");
  assert.equal(list.status, 200);
  assert.ok(JSON.stringify(list).includes("market_order_paid"));
});

test("Pi payments off: listings readable, canBuy false (not_configured), order → 409 not_configured", async () => {
  const pis = H.app.ctx.services.pi, orig = pis.enabled;
  pis.enabled = () => false;
  try {
    const g = await lina.req("GET", "/api/market/listings/" + L.lesson);
    assert.equal(g.status, 200); assert.equal(g.listing.canBuy, false); assert.equal(g.listing.buyReason, "not_configured"); assert.equal(g.listing.buyNote, "مدفوعات Pi غير مفعّلة بعد");
    const r = await order(lina, L.lesson);
    assert.equal(r.status, 409); assert.equal(r.code, "not_configured");
    assert.equal((await new H.Client().req("GET", "/api/market/config")).piEnabled, false);
  } finally { pis.enabled = orig; }
});

test("compliance: data map, export carries market rows, erasure scrubs listings/reviews and keeps orders", async () => {
  const CL = require("../lib/compliance-lib");
  for (const t of ["market_listings", "market_orders", "market_escrow", "market_reviews", "market_disputes", "market_dispute_messages"]) assert.ok(CL.DATA_MAP.find(m => m.t === t), t);
  H.app.ctx.rl.w.clear();
  const ex = await sara.req("GET", "/api/me/privacy/export?format=json");
  assert.equal(ex.status, 200, ex.error);
  assert.ok(ex.market_listings.some(l => l.id === L.phone)); assert.ok(ex.market_orders.some(o => o.id === O.a)); assert.ok(ex.market_reviews.length >= 1);
  assert.ok(ex.market_escrow.length >= 1); assert.ok(ex.market_dispute_messages.length >= 1);
  await H.app.ctx.services.compliance.eraseUser(sara.id);
  await settle();
  const l = await db().get("SELECT * FROM market_listings WHERE id=$1", [L.phone]);
  assert.equal(l.status, "removed"); assert.equal(l.description, ""); assert.equal(l.images, "[]");
  assert.equal((await db().get("SELECT reply FROM market_reviews WHERE order_id=$1", [O.a])).reply, null);
  assert.ok(await db().get("SELECT 1 x FROM market_orders WHERE id=$1", [O.a]), "orders kept");
  assert.equal((await db().get("SELECT text FROM market_dispute_messages WHERE author_id=$1", [sara.id])).text, "");
  assert.equal((await new H.Client().req("GET", "/api/market/listings")).items.length, 0);
  assert.ok(!(await db().get("SELECT 1 x FROM search_docs WHERE kind='listing' AND ref_id=$1", [L.phone])));
  await check();
});
