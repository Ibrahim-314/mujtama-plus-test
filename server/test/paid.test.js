/* Phase 38 — Subscriptions & paid content. Stubbed Pi Platform API + App Studio login (same stub as tips.test.js, injected
 * through config.piOpts), injectable clock for the tips and paid services, SQLite by default and PostgreSQL with
 * TEST_DATABASE_URL. Covers: migration 021, paid post validation (creator opt-in, minors, price range, tiers, types,
 * media ownership), the teaser-only storage model, locked rendering, a leak sweep over every list/detail endpoint
 * (feed, bootstrap, post, search, discovery, explore, tags, profile, notifications, collections, summaries, digest,
 * OG/SSR page, SSE stream, other users' exports), the media access check, PPV purchases through the pi service
 * (journal source ppv, idempotent replays, duplicate purchase), supporter-only posts with minimum tiers (active, due,
 * cancelled-within-period, lapsed), minors, edits/deletes/moderation → refund requests → admin approve/reject (reversing
 * journal, access revoked), creator dashboard + earnings bySource.ppv, notifications, compliance data map / export /
 * erasure, Pi payments off → 501. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_paid_789";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "ppay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") { // App Studio token exchange (phase 36b)
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
const FEE = { CREATOR_FEE_BPS: "1000" }; // 10 % so the three-line journals are exercised
let offset = 0;
const DAY = 864e5, HOUR = 3600e3;
const now = () => new Date(Date.now() + offset);

const SECRET = "SECRETBODYppv7Q", SECRET2 = "SECRETBODYgold3Z", SECRET3 = "SECRETBODYsup5K", SECRET_ART = "SECRETBODYart9X";
const LONG = (s) => "هذه تمهيد عامة يمكن أن يقرأها الجميع عن موضوع المنشور #محتوى_مدفوع ثم يأتي الجزء الخاص " + "تفاصيل حصرية ".repeat(30) + s + " الخاتمة";

let H, admin, cara, fred, gina, hana, otto, mina, ivan, unlinked;
const db = () => H.app.ctx.db;
const paid = () => H.app.ctx.services.paid;
const events = [];
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
const settle = async () => { await H.app.ctx.services.tips.settle(); await paid().settle(); };
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await settle();
  return p;
}
const check = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.status, 200); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); return r; };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
async function upload(c) {
  H.app.ctx.rl.w.clear();
  const r = await fetch(H.base + "/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "image/png", Cookie: c.cookie }, body: PNG });
  const j = await r.json(); assert.equal(r.status, 200, j.error); return j.media;
}
const raw = (c, path, headers = {}) => fetch(H.base + path, { headers: { Cookie: c ? c.cookie : "", ...headers } });
const post = async (c, body) => { H.app.ctx.rl.w.clear(); return c.req("POST", "/api/posts", body); };
const P = {}; // post ids

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, tipsOpts: { env: FEE, now, jobs: false }, paidOpts: { env: { ...FEE, PAID_MAX_PRICE: "100" }, now } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, text, status: r.status, headers: r.headers };
  };
  for (const e of ["PPV_PURCHASED", "PAID_ACCESS_REVOKED"]) H.app.ctx.bus.on(e, (p) => events.push({ e, ...p }));
  admin = await mk("pd_admin"); cara = await mk("pd_cara"); fred = await mk("pd_fred"); gina = await mk("pd_gina"); hana = await mk("pd_hana");
  otto = await mk("pd_otto"); mina = await mk("pd_mina"); ivan = await mk("pd_ivan"); unlinked = await mk("pd_unlinked");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  for (const c of [cara, fred, gina, hana, otto, mina, ivan]) await linkPi(c);
  assert.equal((await mina.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200);
  for (const c of [fred, gina, hana, otto, mina, ivan]) assert.equal((await c.req("PUT", "/api/follows/" + cara.id, {})).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 021: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '021_paid' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "021_paid"]);
  await assert.rejects(() => db().get("SELECT 1 FROM paid_purchases"));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM tips")).n) >= 0, true, "020 tables untouched");
  assert.deepEqual(await mig.up(db()), ["021_paid", ...later]);
  for (const t of ["paid_posts", "paid_content", "paid_media", "paid_purchases", "paid_refund_requests"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "021_paid.js"));
});

test("creating paid posts: validation (creator opt-in, minors, price, tiers, type, media ownership)", async () => {
  const e = async (c, body, status, code) => { const r = await post(c, body); assert.equal(r.status, status, JSON.stringify(body) + " → " + r.status + " " + r.error); if (code) assert.equal(r.code, code); };
  await e(cara, { text: LONG("x"), paid: { mode: "ppv", price: 1 } }, 409, "creator_disabled");
  await e(mina, { text: LONG("x"), paid: { mode: "ppv", price: 1 } }, 403, "minor_restricted");
  const T = (n, amount) => ({ name: n, amount, perks: "شكراً" });
  await e(cara, { text: LONG("x"), visibility: "supporters" }, 409, "creator_disabled");
  let s = await cara.req("PUT", "/api/me/creator", { enabled: true, tiers: [] }); assert.equal(s.status, 200, s.error);
  await e(cara, { text: LONG("x"), visibility: "supporters" }, 409, "no_tiers");
  s = await cara.req("PUT", "/api/me/creator", { enabled: true, tiers: [T("برونزي", 2), T("ذهبي", 10)] }); assert.equal(s.status, 200, s.error);
  cara.bronze = s.tiers[0].id; cara.gold = s.tiers[1].id;
  for (const [body, code] of [[{ mode: "ppv", price: 0 }, "price_invalid"], [{ mode: "ppv", price: 0.001 }, "price_invalid"], [{ mode: "ppv", price: 100.5 }, "price_invalid"], [{ mode: "ppv" }, "price_invalid"],
    [{ mode: "nope" }, "paid_invalid"], ["x", "paid_invalid"], [{ mode: "supporters", minTierId: "tier_unknown1" }, "tier_invalid"]])
    await e(cara, { text: LONG("x"), paid: body }, 400, code);
  await e(cara, { type: "poll", text: "?", poll: { options: ["a", "b"] }, paid: { mode: "ppv", price: 1 } }, 400, "paid_type");
  await e(cara, { type: "story", text: "قصة", paid: { mode: "ppv", price: 1 } }, 400, "paid_type");
  const om = await upload(otto);
  await e(cara, { text: LONG("x"), images: [om.url], paid: { mode: "ppv", price: 1 } }, 400, "paid_media_owner");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM paid_posts")).n), 0, "nothing persisted by rejected creates");

  // PPV post with an image: the author gets the full post back
  const img = await upload(cara); P.img = img;
  const r1 = await post(cara, { text: LONG(SECRET), images: [img.url], alts: ["وصف " + SECRET], paid: { mode: "ppv", price: 2.5 } });
  assert.equal(r1.status, 200, r1.error);
  P.ppv = r1.post.id;
  assert.equal(r1.post.locked, false); assert.ok(r1.post.text.includes(SECRET)); assert.deepEqual(r1.post.images, [img.url]);
  assert.deepEqual(r1.post.paid, { mode: "ppv", price: 2.5, minTierId: null });
  assert.ok(r1.post.teaser.length > 0 && !r1.post.teaser.includes(SECRET), "auto teaser is the opening only");
  // storage model: posts.text = teaser only; the body lives in paid_content; media registered
  const row = await db().get("SELECT * FROM posts WHERE id=$1", [P.ppv]);
  assert.ok(!row.text.includes(SECRET)); assert.ok(!JSON.stringify(row.data).includes("SECRETBODY") || JSON.stringify(row.data).includes("وصف"), "data holds media refs only");
  assert.ok((await db().get("SELECT text FROM paid_content WHERE post_id=$1", [P.ppv])).text.includes(SECRET));
  assert.equal((await db().get("SELECT post_id FROM paid_media WHERE media_id=$1", [img.id])).post_id, P.ppv);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM post_hashtags WHERE post_id=$1 AND tag LIKE '%secret%'", [P.ppv])).n), 0);
  await e(cara, { text: LONG("y"), images: [img.url], paid: { mode: "ppv", price: 1 } }, 409, "paid_media_used");

  // supporters-only (gold minimum) and the visibility:"supporters" alias (any tier), custom teaser
  const r2 = await post(cara, { text: LONG(SECRET2), paid: { mode: "supporters", minTierId: cara.gold, teaser: "للداعمين الذهبيين فقط" } });
  assert.equal(r2.status, 200, r2.error); P.gold = r2.post.id; assert.equal(r2.post.teaser, "للداعمين الذهبيين فقط"); assert.equal(r2.post.paid.minTierId, cara.gold);
  const r3 = await post(cara, { text: LONG(SECRET3), visibility: "supporters" });
  assert.equal(r3.status, 200, r3.error); P.sup = r3.post.id; assert.equal(r3.post.visibility, "public"); assert.equal(r3.post.paid.mode, "supporters");
  // a paid article (rich document moved out of posts.data too) and a free post
  const r4 = await post(cara, { type: "article", title: "مقال مدفوع للاختبار", markdown: "## تمهيد عامة طويلة بما يكفي لتكون معاينة للمقال\n\n" + LONG(SECRET_ART), paid: { mode: "ppv", price: 1 } });
  assert.equal(r4.status, 200, r4.error); P.art = r4.post.id; assert.ok(r4.post.doc, "author sees the document");
  assert.equal((await db().get("SELECT data FROM posts WHERE id=$1", [P.art])).data.doc, undefined);
  const free = await post(cara, { text: "منشور مجاني عادي للجميع #محتوى_مدفوع" }); P.free = free.post.id;
  assert.equal(free.post.locked, undefined); assert.equal(free.post.paid, undefined);
});

test("locked rendering: teaser + lock card instead of body/media, for anonymous and signed-in viewers; admin can see", async () => {
  for (const c of [new H.Client(), otto]) {
    const g = await c.req("GET", "/api/posts/" + P.ppv);
    assert.equal(g.status, 200, g.error);
    assert.equal(g.post.locked, true); assert.ok(!g.text.includes(SECRET)); assert.ok(!g.text.includes(P.img.id), "no media path");
    assert.equal(g.post.images, undefined); assert.equal(g.post.alts, undefined); assert.equal(g.post.media, null);
    assert.equal(g.post.text, g.post.teaser); assert.deepEqual(g.post.history, []);
    assert.equal(g.post.lock.mode, "ppv"); assert.equal(g.post.lock.price, 2.5); assert.equal(g.post.lock.media.images, 1);
  }
  assert.equal((await new H.Client().req("GET", "/api/posts/" + P.ppv)).post.lock.reason, "sign_in");
  assert.equal((await otto.req("GET", "/api/posts/" + P.ppv)).post.lock.purchasable, true);
  const g = await otto.req("GET", "/api/posts/" + P.gold);
  assert.equal(g.post.locked, true); assert.equal(g.post.lock.minTier.id, cara.gold);
  assert.deepEqual(g.post.lock.tiers.map(t => t.id), [cara.gold], "only tiers that unlock it");
  assert.deepEqual((await otto.req("GET", "/api/posts/" + P.sup)).post.lock.tiers.map(t => t.name), ["برونزي", "ذهبي"]);
  const a = await admin.req("GET", "/api/posts/" + P.ppv);
  assert.equal(a.post.locked, false); assert.ok(a.post.text.includes(SECRET), "admins see paid posts for moderation");
  const info = await otto.req("GET", "/api/paid/" + P.ppv);
  assert.equal(info.status, 200); assert.equal(info.paid, true); assert.equal(info.unlocked, false); assert.equal(info.price, 2.5); assert.equal(info.purchase, null);
  assert.equal((await otto.req("GET", "/api/paid/" + P.free)).paid, false);
});

test("leak sweep: no locked body or media in any list/detail endpoint, OG page, SSE or other users' exports", async () => {
  // engagement so the posts show up in notifications / collections / trends
  await otto.req("PUT", "/api/reactions/" + P.ppv, { type: "like" });
  await otto.req("POST", "/api/comments", { post: P.ppv, text: "يبدو رائعاً" });
  const col = await otto.req("POST", "/api/collections", { name: "مدفوع" });
  if (col.collection?.id) await otto.req("POST", `/api/collections/${col.collection.id}/items`, { post: P.ppv });
  // SSE stream open while a new paid post and a purchase notification happen
  const ac = new AbortController(); const chunks = [];
  const sse = fetch(H.base + "/api/stream", { headers: { Cookie: otto.cookie }, signal: ac.signal }).then(async (r) => { const rd = r.body.getReader(); for (;;) { const { value, done } = await rd.read(); if (done) break; chunks.push(Buffer.from(value).toString()); } }).catch(() => { });
  await new Promise(r => setTimeout(r, 100));
  const live = await post(cara, { text: LONG("SECRETBODYlive1"), paid: { mode: "ppv", price: 1 } }); assert.equal(live.status, 200);
  await new Promise(r => setTimeout(r, 300)); ac.abort(); await sse;
  const SECRETS = [SECRET, SECRET2, SECRET3, SECRET_ART, "SECRETBODYlive1", P.img.id];
  const clean = (label, txt) => { for (const s of SECRETS) assert.ok(!String(txt).includes(s), `${label} leaks ${s}`); };
  clean("SSE", chunks.join(""));
  const paths = ["/api/feed", "/api/feed?mode=latest", "/api/bootstrap", "/api/posts/" + P.ppv, "/api/posts/" + P.gold, "/api/posts/" + P.sup, "/api/posts/" + P.art, "/api/posts/" + P.ppv + "/comments",
    "/api/search?q=" + encodeURIComponent("تمهيد"), "/api/search?q=SECRETBODY", "/api/search/full?q=" + encodeURIComponent("تمهيد"), "/api/search/full?q=SECRETBODY", "/api/search/suggest?q=" + encodeURIComponent("تمهيد"),
    "/api/explore", "/api/trending", "/api/trends", "/api/tags/" + encodeURIComponent("محتوى_مدفوع"), "/api/trending/tag/" + encodeURIComponent("محتوى_مدفوع"), "/api/profiles/pd_cara", "/api/users/pd_cara",
    "/api/notifications", "/api/collections", "/api/collections/later", "/api/posts/" + P.ppv + "/summary", "/api/digest/daily", "/api/stories", "/api/posts/" + P.ppv + "/tips", "/api/creators/pd_cara/support", "/api/paid/" + P.ppv];
  if (col.collection?.id) paths.push("/api/collections/" + col.collection.id);
  let checked = 0; const shown = new Set();
  for (const c of [otto, new H.Client(), mina]) for (const p of paths) { const r = await raw(c, p); const t = await r.text(); clean(`${c.handle || "anon"} ${p} (${r.status})`, t); if (r.status === 200) checked++; if (c === otto && (t.includes(P.ppv) || t.includes(P.gold))) shown.add(p.split("?")[0]); }
  assert.ok(checked > 40, "most endpoints answered: " + checked);
  for (const p of ["/api/feed", "/api/bootstrap", "/api/search", "/api/search/full", "/api/collections", "/api/profiles/pd_cara", "/api/digest/daily"]) assert.ok(shown.has(p), "the sweep saw the locked post in " + p + " (" + [...shown].join(", ") + ")");
  // the creator sees her own content in her lists (sanity: the sweep would catch it)
  const mine = await (await raw(cara, "/api/posts/" + P.ppv)).text(); assert.ok(mine.includes(SECRET));
  // OG / SSR article page and sitemap
  const ssr = await raw(null, "/a/" + P.art); const html = await ssr.text();
  assert.equal(ssr.status, 200); clean("SSR /a/", html); assert.ok(!/og:image/.test(html), "no paid cover as og:image");
  // a commenter's own data export never carries the creator's locked body
  await db().run("DELETE FROM dsr_requests WHERE user_id=$1", [otto.id]);
  const ex = await raw(otto, "/api/me/privacy/export?format=json"); clean("export", await ex.text());
});

test("media of paid posts: 403 for non-entitled viewers, private (no-store) for the author; /api/media/:id gated", async () => {
  const name = P.img.url.slice(7);
  for (const c of [null, otto, mina]) { const r = await raw(c, "/media/" + name); assert.equal(r.status, 403, (c?.handle || "anon")); assert.equal((await r.json()).code, "paid_locked"); }
  const own = await raw(cara, "/media/" + name); assert.equal(own.status, 200); assert.match(own.headers.get("cache-control"), /private, no-store/); assert.equal(own.headers.get("access-control-allow-origin"), null);
  assert.equal((await raw(admin, "/media/" + name)).status, 200);
  assert.equal((await otto.req("GET", "/api/media/" + P.img.id)).status, 403);
  assert.equal((await cara.req("GET", "/api/media/" + P.img.id)).status, 200);
  const pub = await upload(otto); const r = await raw(null, pub.url); assert.equal(r.status, 200); assert.match(r.headers.get("cache-control"), /public/, "ordinary media unchanged");
});

test("PPV purchase: errors, intent through the pi service, unlock on completion (journal ppv), replay-safe, notifications", async () => {
  const e = async (c, pid, status, code) => { const r = await c.req("POST", `/api/paid/${pid}/intent`); assert.equal(r.status, status, `${c.handle} ${pid} → ${r.status} ${r.error}`); if (code) assert.equal(r.code, code); };
  await e(new H.Client(), P.ppv, 401);
  await e(cara, P.ppv, 400, "own_post");
  await e(otto, P.sup, 400, "not_ppv");
  await e(otto, P.free, 400, "not_paid");
  await e(otto, "p_nothere123", 404);
  await e(mina, P.ppv, 403, "minor_restricted");
  await e(unlinked, P.ppv, 409, "pi_not_linked");
  assert.equal((await gina.req("PUT", "/api/protection/blocks/" + cara.id, {})).status, 200);
  const gb = await gina.req("POST", `/api/paid/${P.ppv}/intent`); assert.ok([403, 404].includes(gb.status), "blocked → " + gb.status);
  assert.equal((await gina.req("DELETE", "/api/protection/blocks/" + cara.id)).status, 200);
  const pis = H.app.ctx.services.pi, en = pis.enabled; pis.enabled = () => false;
  try { await e(fred, P.ppv, 501, "not_configured"); } finally { pis.enabled = en; }

  const r = await fred.req("POST", `/api/paid/${P.ppv}/intent`);
  assert.equal(r.status, 200, r.error); assert.match(r.purchaseId, /^ppv_/); assert.equal(r.intent.amount, 2.5); assert.deepEqual(r.intent.metadata, { intentId: r.intent.id });
  const tx = await db().get("SELECT * FROM pi_transactions WHERE id=$1", [r.intent.id]); assert.equal(tx.purpose, "ppv"); assert.equal(tx.ref_id, P.ppv);
  const pu = await db().get("SELECT * FROM paid_purchases WHERE id=$1", [r.purchaseId]); assert.equal(pu.status, "pending"); assert.equal(Number(pu.amount), 25000000); assert.equal(Number(pu.fee), 2500000);
  assert.equal((await fred.req("GET", "/api/posts/" + P.ppv)).post.locked, true, "nothing unlocks before Pi completes");
  const pmt = await payIntent(fred, r.intent);
  assert.equal((await db().get("SELECT status FROM paid_purchases WHERE id=$1", [r.purchaseId])).status, "completed");
  const g = await fred.req("GET", "/api/posts/" + P.ppv);
  assert.equal(g.post.locked, false); assert.ok(g.post.text.includes(SECRET)); assert.deepEqual(g.post.images, [P.img.url]);
  assert.equal((await raw(fred, "/media/" + P.img.url.slice(7))).status, 200, "buyer can load the media");
  assert.equal((await fred.req("GET", "/api/media/" + P.img.id)).status, 200);
  const feed = await (await raw(fred, "/api/feed?mode=latest")).text(); assert.ok(feed.includes(SECRET) || !feed.includes(P.ppv), "entitled viewer gets the body in lists too");
  const js = await db().all("SELECT * FROM ledger_journals WHERE ref_id=$1", [r.purchaseId]);
  assert.equal(js.length, 1); assert.equal(js[0].kind, "ppv"); assert.equal(js[0].source, "ppv"); assert.equal(js[0].post_id, P.ppv); assert.equal(js[0].creator_id, cara.id);
  const lines = await db().all("SELECT account, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [js[0].id]);
  assert.deepEqual(lines.map(l => [l.account, Number(l.debit), Number(l.credit)]), [[`user:${fred.id}:pi_out`, 25000000, 0], [`creator:${cara.id}:earnings`, 0, 22500000], ["platform:fees", 0, 2500000]]);
  // replayed bus event: nothing doubles
  H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { user: fred.id, tx: r.intent.id, paymentId: pmt.identifier, amount: 2.5, purpose: "ppv", refId: P.ppv }); await settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE ref_id=$1", [r.purchaseId])).n), 1);
  assert.equal(events.filter(x => x.e === "PPV_PURCHASED" && x.purchase === r.purchaseId).length, 1);
  const ev = events.find(x => x.e === "PPV_PURCHASED"); assert.equal(ev.creator, cara.id); assert.equal(ev.buyer, fred.id); assert.equal(ev.amount, 2.5);
  const n = await cara.req("GET", "/api/notifications"); assert.ok(JSON.stringify(n).includes("ppv_purchased"), "creator notified");
  await e(fred, P.ppv, 409, "already_unlocked");
  fred.purchase = r.purchaseId;
  // cancelled intent → purchase cancelled
  const c1 = await otto.req("POST", `/api/paid/${P.art}/intent`); assert.equal(c1.status, 200);
  assert.equal((await otto.req("POST", "/api/pi/payments/cancel", { intentId: c1.intent.id })).status, 200); await settle();
  assert.equal((await db().get("SELECT status FROM paid_purchases WHERE id=$1", [c1.purchaseId])).status, "cancelled");
  // two intents paid for the same post: the second is a duplicate with an automatic refund request
  const d1 = await ivan.req("POST", `/api/paid/${P.art}/intent`), d2 = await ivan.req("POST", `/api/paid/${P.art}/intent`);
  assert.equal(d1.status, 200); assert.equal(d2.status, 200);
  await payIntent(ivan, d1.intent); await payIntent(ivan, d2.intent);
  assert.equal((await db().get("SELECT status FROM paid_purchases WHERE id=$1", [d2.purchaseId])).status, "duplicate");
  const auto = await db().get("SELECT * FROM paid_refund_requests WHERE purchase_id=$1", [d2.purchaseId]); assert.equal(auto.kind, "duplicate"); assert.equal(auto.status, "pending");
  ivan.dup = d2.purchaseId; ivan.purchase = d1.purchaseId;
  await check();
});

test("supporters-only posts: tier minimum, active / due / cancelled-in-period / lapsed, purchase-free", async () => {
  const support = async (c, tierId) => { const r = await c.req("POST", "/api/support/intent", { toHandle: "pd_cara", tierId }); assert.equal(r.status, 200, r.error); await payIntent(c, r.intent); return r.supportId; };
  gina.sup = await support(gina, cara.bronze);
  hana.sup = await support(hana, cara.gold);
  const see = async (c, pid) => (await c.req("GET", "/api/posts/" + pid)).post;
  assert.equal((await see(gina, P.sup)).locked, false); assert.ok((await see(gina, P.sup)).text.includes(SECRET3));
  const gl = await see(gina, P.gold); assert.equal(gl.locked, true, "bronze is below the gold minimum"); assert.ok(!JSON.stringify(gl).includes(SECRET2));
  assert.equal((await see(hana, P.gold)).locked, false); assert.equal((await see(hana, P.sup)).locked, false, "higher tier unlocks lower minimums");
  assert.equal((await see(hana, P.ppv)).locked, true, "support does not unlock pay-per-view");
  // tier re-priced above gina's paid amount? minimum follows the tier's current amount
  // due (within 3 days of the end) still unlocks; cancelled keeps perks until active_until; lapsed locks
  offset = 28 * DAY; assert.equal((await see(gina, P.sup)).locked, false, "due");
  assert.equal((await gina.req("POST", `/api/support/${gina.sup}/cancel`)).status, 200);
  assert.equal((await see(gina, P.sup)).locked, false, "cancelled: perks until active_until");
  offset = 31 * DAY; assert.equal((await see(gina, P.sup)).locked, true, "cancelled and past the paid period");
  offset = 34 * DAY; assert.equal((await see(hana, P.sup)).locked, true, "lapsed after the grace period");
  offset = 0;
  assert.equal((await see(hana, P.sup)).locked, false);
});

test("minors: teaser only, cannot buy, never see adult-labelled paid posts", async () => {
  const g = await mina.req("GET", "/api/posts/" + P.ppv);
  assert.equal(g.status, 200); assert.equal(g.post.locked, true); assert.equal(g.post.lock.purchasable, false); assert.equal(g.post.lock.reason, "minor_restricted");
  const adult = await post(cara, { text: LONG("SECRETBODYadult"), labels: ["adult"], paid: { mode: "ppv", price: 1 } });
  assert.equal(adult.status, 200, adult.error); P.adult = adult.post.id;
  assert.equal((await mina.req("GET", "/api/posts/" + P.adult)).status, 404);
  assert.equal((await mina.req("POST", `/api/paid/${P.adult}/intent`)).status, 404);
  const feed = await (await raw(mina, "/api/feed?mode=latest")).text(); assert.ok(!feed.includes(P.adult));
});

test("creator edits / deletes / moderation → refund requests → admin approve (reversal, access revoked) or reject", async () => {
  // no change yet → not eligible
  let rr = await fred.req("POST", `/api/paid/purchases/${fred.purchase}/refund-request`, { reason: "أريد استرداد" });
  assert.equal(rr.status, 409); assert.equal(rr.code, "refund_not_eligible");
  assert.equal((await otto.req("POST", `/api/paid/purchases/${fred.purchase}/refund-request`)).status, 404, "only the buyer");
  // free post cannot become paid; author-only; price edit
  const fp = await cara.req("PATCH", "/api/posts/" + P.free, { paid: { mode: "ppv", price: 1 } }); assert.equal(fp.status, 400); assert.equal(fp.code, "paid_on_create_only");
  assert.equal((await otto.req("PATCH", "/api/posts/" + P.ppv, { text: "x" })).status, 403);
  const pe = await cara.req("PATCH", "/api/posts/" + P.ppv, { paid: { price: 3 } }); assert.equal(pe.status, 200, pe.error); assert.equal(pe.post.paid.price, 3); assert.equal(pe.post.locked, false);
  assert.equal((await fred.req("GET", "/api/posts/" + P.ppv)).post.locked, false, "a purchase survives price changes");
  // edit the body → buyers may ask for a refund within 24 h
  const NEW = LONG("SECRETBODYedit2");
  const ed = await cara.req("PATCH", "/api/posts/" + P.ppv, { text: NEW }); assert.equal(ed.status, 200, ed.error); assert.ok(ed.post.text.includes("SECRETBODYedit2"));
  const row = await db().get("SELECT text FROM posts WHERE id=$1", [P.ppv]); assert.ok(!row.text.includes("SECRETBODYedit2"));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM post_versions WHERE post_id=$1 AND text LIKE '%SECRETBODY%'", [P.ppv])).n), 0, "versions only hold teasers");
  assert.equal((await db().get("SELECT change_kind FROM paid_posts WHERE post_id=$1", [P.ppv])).change_kind, "edited");
  assert.ok(JSON.stringify(await fred.req("GET", "/api/notifications")).includes("paid_refundable"));
  const mp = await fred.req("GET", "/api/me/purchases");
  const it = mp.items.find(x => x.id === fred.purchase); assert.equal(it.refundEligible, true); assert.ok(it.refundUntil); assert.equal(it.post.id, P.ppv); assert.ok(!JSON.stringify(mp).includes("SECRETBODY"));
  rr = await fred.req("POST", `/api/paid/purchases/${fred.purchase}/refund-request`, { reason: "تغيّر المحتوى" });
  assert.equal(rr.status, 200, rr.error); assert.equal(rr.request.status, "pending"); assert.equal(rr.request.kind, "edited");
  assert.equal((await fred.req("POST", `/api/paid/purchases/${fred.purchase}/refund-request`)).code, "refund_pending");
  assert.equal((await fred.req("GET", "/api/admin/paid/refunds")).status, 403);
  const q = await admin.req("GET", "/api/admin/paid/refunds"); assert.equal(q.status, 200);
  const item = q.items.find(x => x.purchaseId === fred.purchase); assert.ok(item); assert.equal(item.amount, 2.5); assert.equal(item.buyer.handle, "pd_fred"); assert.equal(item.creator.handle, "pd_cara");
  const ap = await admin.req("POST", `/api/admin/paid/refunds/${item.id}/approve`, { note: "ok", txid: "tx_refund_1" });
  assert.equal(ap.status, 200, ap.error); assert.equal(ap.status, 200); assert.equal(ap.purchase.status, "refunded");
  await settle();
  assert.equal((await db().get("SELECT status FROM pi_transactions WHERE id=(SELECT intent_id FROM paid_purchases WHERE id=$1)", [fred.purchase])).status, "refunded");
  const js = await db().all("SELECT kind, reverses FROM ledger_journals WHERE ref_id=$1 ORDER BY created_at, id", [fred.purchase]);
  assert.deepEqual(js.map(j => j.kind), ["ppv", "reversal"]);
  assert.equal((await fred.req("GET", "/api/posts/" + P.ppv)).post.locked, true, "access revoked");
  assert.equal((await raw(fred, "/media/" + P.img.url.slice(7))).status, 403);
  assert.ok(events.some(x => x.e === "PAID_ACCESS_REVOKED" && x.purchase === fred.purchase && x.user === fred.id));
  assert.ok(JSON.stringify(await fred.req("GET", "/api/notifications")).includes("ppv_refunded"));
  assert.equal((await admin.req("POST", `/api/admin/paid/refunds/${item.id}/approve`)).status, 200, "idempotent");
  assert.equal((await admin.req("POST", `/api/admin/paid/refunds/${item.id}/reject`)).status, 409);
  // duplicate purchase auto-request → approve; the original purchase keeps access
  const dq = (await admin.req("GET", "/api/admin/paid/refunds")).items.find(x => x.purchaseId === ivan.dup);
  assert.equal((await admin.req("POST", `/api/admin/paid/refunds/${dq.id}/approve`, {})).status, 200); await settle();
  assert.equal((await db().get("SELECT status FROM paid_purchases WHERE id=$1", [ivan.dup])).status, "refunded");
  assert.equal((await ivan.req("GET", "/api/posts/" + P.art)).post.locked, false, "the first purchase still unlocks");
  // deletion → eligible; then reject
  await db().run("UPDATE paid_posts SET changed_at=NULL, change_kind=NULL WHERE post_id=$1", [P.art]);
  const del = await cara.req("DELETE", "/api/posts/" + P.art); assert.equal(del.status, 200); await settle();
  assert.equal((await db().get("SELECT change_kind FROM paid_posts WHERE post_id=$1", [P.art])).change_kind, "deleted");
  const ir = await ivan.req("POST", `/api/paid/purchases/${ivan.purchase}/refund-request`); assert.equal(ir.status, 200, ir.error); assert.equal(ir.request.kind, "deleted");
  const rj = await admin.req("POST", `/api/admin/paid/refunds/${ir.request.id}/reject`, { note: "لا" }); assert.equal(rj.status, 200); assert.equal(rj.body.status, "rejected");
  assert.ok(JSON.stringify(await ivan.req("GET", "/api/notifications")).includes("paid_refund_rejected"));
  // moderation removal (bus event) and the 24 h window
  const p2 = await post(cara, { text: LONG("SECRETBODYmod4"), paid: { mode: "ppv", price: 1 } }); P.mod = p2.post.id;
  const bi = await otto.req("POST", `/api/paid/${P.mod}/intent`); await payIntent(otto, bi.intent);
  H.app.ctx.bus.emit("CONTENT_REMOVED", { post: P.mod, user: cara.id, decision: "مخالفة" }); await settle();
  assert.equal((await db().get("SELECT change_kind FROM paid_posts WHERE post_id=$1", [P.mod])).change_kind, "removed");
  offset = 25 * HOUR;
  const late = await otto.req("POST", `/api/paid/purchases/${bi.purchaseId}/refund-request`); assert.equal(late.status, 409); assert.equal(late.code, "refund_window_passed");
  offset = 0;
  await check();
});

test("paid → free, creator dashboard, earnings bySource.ppv, honour roll excludes purchases", async () => {
  const mp = await cara.req("GET", "/api/me/paid-posts");
  assert.equal(mp.status, 200); assert.equal(mp.currency, "Pi"); assert.equal(mp.feeBps, 1000);
  const mod = mp.items.find(x => x.postId === P.mod); assert.equal(mod.unlocks, 1); assert.equal(mod.revenue, 1); assert.equal(mod.net, 0.9); assert.equal(mod.mode, "ppv");
  const ppv = mp.items.find(x => x.postId === P.ppv); assert.equal(ppv.unlocks, 0); assert.equal(ppv.refunds, 1); assert.equal(ppv.price, 3);
  assert.equal(mp.items.find(x => x.postId === P.gold).minTier.id, cara.gold);
  assert.equal((await fred.req("GET", "/api/me/paid-posts")).items.length, 0);
  const er = await cara.req("GET", "/api/me/earnings?period=month");
  assert.equal(er.status, 200); assert.ok(er.bySource.ppv > 0, JSON.stringify(er.bySource)); assert.ok("tips" in er.bySource && "support" in er.bySource);
  const csv = await (await raw(cara, er.csvUrl)).text(); assert.ok(csv.includes("محتوى مدفوع"));
  const wall = await new H.Client().req("GET", "/api/creators/pd_cara/wall?period=all");
  assert.ok(wall.items.every(i => !i.kinds.includes("ppv")), "purchases are private");
  const page = await new H.Client().req("GET", "/api/creators/pd_cara/support"); assert.ok(page.wall.every(w => w.kind !== "ppv"));
  // paid → free: the body becomes the post text, media public again
  const fr = await cara.req("PATCH", "/api/posts/" + P.sup, { paid: null }); assert.equal(fr.status, 200, fr.error);
  const g = await otto.req("GET", "/api/posts/" + P.sup); assert.equal(g.post.locked, undefined); assert.ok(g.post.text.includes(SECRET3));
  assert.equal((await db().get("SELECT state FROM paid_posts WHERE post_id=$1", [P.sup])).state, "free");
  await check();
});

test("compliance: data map, export carries my purchases, erasure deletes the locked body and keeps financial rows", async () => {
  const L = require("../lib/compliance-lib");
  const mapped = new Set([...L.DATA_MAP.map(m => m.t), ...L.SYSTEM_RECORDS.map(m => m.t)]);
  for (const t of ["paid_posts", "paid_content", "paid_media", "paid_purchases", "paid_refund_requests"]) assert.ok(mapped.has(t), t);
  for (const m of L.DATA_MAP.filter(x => x.t.startsWith("paid_"))) await db().get(`SELECT ${m.cols ? m.cols.join(",") : "*"} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [fred.id]);
  await db().run("DELETE FROM dsr_requests WHERE user_id=$1", [fred.id]);
  const ex = await fred.req("GET", "/api/me/privacy/export?format=json");
  assert.equal(ex.status, 200, ex.error); assert.ok(Array.isArray(ex.paid_purchases) && ex.paid_purchases.some(p => p.id === fred.purchase), "my purchases are exported");
  assert.ok(Array.isArray(ex.paid_refund_requests) && ex.paid_refund_requests.length >= 1);
  await db().run("DELETE FROM dsr_requests WHERE user_id=$1", [cara.id]);
  const ce = await cara.req("GET", "/api/me/privacy/export?format=json");
  assert.ok(JSON.stringify(ce.paid_content || []).includes("SECRETBODY"), "the creator exports her own locked bodies");
  H.app.ctx.bus.emit("USER_ANONYMISED", { user: fred.id }); await settle();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM paid_refund_requests WHERE buyer_id=$1 AND reason IS NOT NULL", [fred.id])).n), 0);
  await H.app.ctx.services.compliance.eraseUser(cara.id);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM paid_content WHERE post_id IN (SELECT id FROM posts WHERE author=$1)", [cara.id])).n), 0, "locked bodies deleted");
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM paid_purchases WHERE creator_id=$1", [cara.id])).n) > 0, "purchases kept");
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ledger_journals WHERE source='ppv'")).n) > 0, "ledger kept");
  await check();
});
