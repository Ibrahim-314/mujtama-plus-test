/* Phase 40 — Ethical ads (الإعلانات الأخلاقية). Stubbed Pi Platform API (same stub as market.test.js, injected through
 * config.piOpts), injectable clock for the ads service, SQLite by default and PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 023 (down/up, static additive check), campaign validation (minors, own public post only, sensitive and
 * unknown targeting, budget/CPM/daily cap, dates, frequency cap), targetable topics, k-anonymous audience estimate,
 * submit → automod/spam rejection (422 ad_rejected) → admin review queue → reject/approve + notifications/hrefs,
 * Pi funding (purpose ads, intent → approve/complete → active, ledger journal), Pi off → 409 not_configured,
 * feed insertion (≤ 1 per 8, never first, home modes only, minors/blocks/mutes/hidden/personalisation off),
 * signed single-use event tokens, frequency caps, CPM charging + k-anonymous stats, budget low/exhausted → completed,
 * «لماذا أرى هذا الإعلان؟», hide ad/advertiser (aggregated feedback), prefs, maintenance job (end_at, 7-day purge, salt rotation),
 * NO user ids in ad_stats_daily / ad_feedback / ad_freq / ad_tokens, compliance export + erasure, ledger balanced. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_ads_789";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "apay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
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

let H, admin, sara, omar, lina, minnie, bob, nora;
const db = () => H.app.ctx.db;
const ads = () => H.app.ctx.services.ads;
const C = {}; // campaign ids
const P = {}; // post ids
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
const settle = async () => { await H.app.ctx.services.paid.settle(); await H.app.ctx.services.market.settle(); await ads().settle(); };
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
const notes = async (uid, kind) => db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind]);
const post = async (c, text, old = false) => {
  H.app.ctx.rl.w.clear();
  const r = await c.req("POST", "/api/posts", { text }); assert.equal(r.status, 200, r.error);
  if (old) await db().run("UPDATE posts SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 40 * DAY).toISOString(), r.post.id]); // out of the organic "for/latest" window
  return r.post.id;
};
const base = (pid, extra = {}) => ({ name: "حملة دورة البرمجة", objective: "reach", postId: pid, targeting: { topics: ["dev"], languages: ["ar"] }, budgetTotal: 5, dailyCap: 5, bidCpm: 10, freqCap: { impressions: 3, perHours: 24 }, ...extra });
const feed = async (c, mode = "latest", q = "") => { H.app.ctx.rl.w.clear(); const r = await c.req("GET", `/api/feed?mode=${mode}&limit=20${q}`); assert.equal(r.status, 200, r.error); return r; };
const promotedIn = (f) => f.posts.map((p, i) => ({ p, i })).filter((x) => x.p.promoted);
const ev = async (c, item, type = "impression") => { H.app.ctx.rl.w.clear(); return c.req("POST", "/api/ads/events", { campaignId: item.promoted.campaignId, type, token: item.promoted.token }); };
/** drop every per-viewer ranking cache so new organic posts appear */
const flushFeeds = () => H.app.ctx.cache.del("feed:");

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, marketOpts: { jobs: false }, adsOpts: { env: { ADS_FEED_INTERVAL: "8" }, now, jobs: false } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) { // HTTP status wins over a body field named status
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, text, status: r.status, headers: r.headers };
  };
  admin = await mk("ad_admin"); sara = await mk("ad_sara"); omar = await mk("ad_omar"); lina = await mk("ad_lina"); minnie = await mk("ad_minnie"); bob = await mk("ad_bob"); nora = await mk("ad_nora");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  for (const c of [sara, lina]) await linkPi(c);
  assert.equal((await minnie.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200);
  // organic content for feeds (two authors, ≥ 16 posts so a 20-post page has two ad slots)
  for (let i = 0; i < 9; i++) { await post(bob, `ملاحظة رقم ${i + 1} عن تعلم البرمجة خطوة بخطوة`); await post(nora, `تجربة رقم ${i + 1} في تصميم الواجهات العربية`); }
  P.sara = await post(sara, "دورة مجانية لتعلم البرمجة بلغة جافاسكربت للمبتدئين", true);
  P.sara2 = await post(sara, "ورشة عن التصميم الجرافيكي يوم الخميس", true);
  P.lina = await post(lina, "متجري الصغير للكتب المستعملة في جدة", true);
  P.minnie = await post(minnie, "منشوري الأول عن الألعاب", true);
  // explicit interests: omar follows the dev topic; nora chose "design" as an interest; bob follows nothing
  await db().run("INSERT INTO topic_follows(user_id,kind,ref,created_at) VALUES($1,'topic','dev',$2)", [omar.id, new Date().toISOString()]);
  assert.equal((await nora.req("PUT", "/api/me/prefs", { interests: ["design"] })).status, 200);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 023: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '023_ads' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "023_ads"]);
  await assert.rejects(() => db().get("SELECT 1 FROM ad_campaigns"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM market_listings")).n) >= 0, "022 tables untouched");
  assert.deepEqual(await mig.up(db()), ["023_ads", ...later]);
  for (const t of ["ad_campaigns", "ad_reviews", "ad_stats_daily", "ad_freq", "ad_tokens", "ad_prefs", "ad_feedback", "ad_meta"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "023_ads.js"));
});

test("pure helpers: targeting match, k-anon buckets, feed slots, sensitive topics", () => {
  const { matchTargeting, audienceBucket, slotsFor, isSensitive } = require("../services/ads");
  const v = { personalized: true, topics: new Set(["dev"]), lang: "ar", country: "SA" };
  assert.deepEqual(matchTargeting({ topics: ["dev", "ai"], languages: ["ar"] }, v), [{ type: "topic", topic: "dev" }, { type: "language" }]);
  assert.equal(matchTargeting({ topics: ["ai"] }, v), null);
  assert.equal(matchTargeting({ topics: ["dev"] }, { ...v, personalized: false }), null, "personalisation off → no topic targeting");
  assert.equal(matchTargeting({ countries: ["SA"] }, { ...v, personalized: false }), null);
  assert.deepEqual(matchTargeting({ languages: ["ar"] }, { ...v, personalized: false }), [{ type: "language" }], "UI language stays contextual");
  assert.deepEqual(matchTargeting({}, null), [{ type: "general" }], "signed out → untargeted only");
  assert.equal(matchTargeting({ languages: ["ar"] }, null), null);
  assert.equal(audienceBucket(9).label, "أقل من 10"); assert.equal(audienceBucket(9).max, 9);
  assert.equal(audienceBucket(10).min, 10); assert.equal(audienceBucket(250).label, "100–1,000"); assert.equal(audienceBucket(2e5).max, null);
  assert.deepEqual(slotsFor(0, 20, 8), [7, 15]); assert.deepEqual(slotsFor(0, 7, 8), []); assert.deepEqual(slotsFor(20, 20, 8), [3, 11, 19]);
  assert.ok(!slotsFor(0, 50, 8).includes(-1) && slotsFor(0, 50, 8).every((i) => i >= 7), "never the first slot");
  for (const s of ["religion", "Politics", "#صحة", "سياسة", "ethnicity", "sexuality"]) assert.ok(isSensitive(s), s);
  assert.ok(!isSensitive("dev"));
});

test("campaigns: validation, minors, sensitive targeting rejected, shape, topics, k-anon estimate", async () => {
  const e = async (c, body, status, code) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/ads/campaigns", body); assert.equal(r.status, status, JSON.stringify(body).slice(0, 140) + " → " + r.status + " " + r.error); if (code) assert.equal(r.code, code); return r; };
  await e(minnie, base(P.minnie), 403, "minor_restricted");
  assert.equal((await minnie.req("POST", "/api/ads/estimate", { targeting: {} })).code, "minor_restricted");
  await e(sara, base(P.lina), 400, "post_invalid"); // not her post
  await e(sara, base("nope"), 400, "post_invalid");
  for (const topics of [["religion"], ["سياسة"], ["health"], ["dev", "sexuality"], ["#العرق"]]) await e(sara, base(P.sara, { targeting: { topics } }), 400, "targeting_sensitive");
  await e(sara, base(P.sara, { targeting: { topics: ["cars"] } }), 400, "targeting_invalid");
  await e(sara, base(P.sara, { targeting: { topics: ["dev"], age: "18-24" } }), 400, "targeting_invalid");
  await e(sara, base(P.sara, { targeting: { languages: ["arabic"] } }), 400, "targeting_invalid");
  await e(sara, base(P.sara, { targeting: { countries: ["Saudi"] } }), 400, "targeting_invalid");
  await e(sara, base(P.sara, { budgetTotal: 0.5 }), 400, "budget_invalid");
  await e(sara, base(P.sara, { budgetTotal: 5000 }), 400, "budget_invalid");
  await e(sara, base(P.sara, { dailyCap: 6 }), 400, "budget_invalid");
  await e(sara, base(P.sara, { bidCpm: 0.001 }), 400, "budget_invalid");
  await e(sara, base(P.sara, { budgetTotal: 1.123456789 }), 400, "budget_invalid");
  await e(sara, base(P.sara, { name: "x" }), 400, "campaign_invalid");
  await e(sara, base(P.sara, { objective: "sales" }), 400, "campaign_invalid");
  await e(sara, base(P.sara, { freqCap: { impressions: 50, perHours: 24 } }), 400, "campaign_invalid");
  await e(sara, base(P.sara, { freqCap: { impressions: 3, perHours: 48 } }), 400, "campaign_invalid");
  await e(sara, base(P.sara, { startAt: new Date(Date.now() - 3 * DAY).toISOString() }), 400, "campaign_invalid");
  await e(sara, base(P.sara, { startAt: new Date(Date.now() + DAY).toISOString(), endAt: new Date(Date.now() + 200 * DAY).toISOString() }), 400, "campaign_invalid");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ad_campaigns")).n), 0, "nothing persisted");

  const r = await e(sara, base(P.sara), 200);
  const c = r.campaign; C.dev = c.id;
  assert.match(c.id, /^ac_/);
  assert.equal(c.status, "draft"); assert.equal(c.post.id, P.sara); assert.deepEqual(c.targeting, { topics: ["dev"], languages: ["ar"], countries: [] });
  assert.deepEqual(c.budget, { total: 5, dailyCap: 5, bidCpm: 10, spent: 0, remaining: 5, funded: false, fundedAmount: 0, currency: "PI" });
  assert.deepEqual(c.freqCap, { impressions: 3, perHours: 24 });
  assert.deepEqual(c.actions, ["edit", "submit", "fund", "delete"]); assert.equal(c.label, "مُروَّج");
  assert.equal(c.stats.totals.impressions, null); assert.equal(c.stats.totals.impressionsText, "أقل من 10");
  const def = await e(sara, { name: "حملة افتراضية", postId: P.sara2, budgetTotal: 3 }, 200);
  assert.deepEqual(def.campaign.freqCap, { impressions: 3, perHours: 24 }, "default 3/24h");
  C.general = def.campaign.id;
  // PATCH in draft: anything; sensitive targeting still refused
  assert.equal((await sara.req("PATCH", "/api/ads/campaigns/" + C.general, { targeting: { topics: ["religion"] } })).code, "targeting_sensitive");
  const p = await sara.req("PATCH", "/api/ads/campaigns/" + C.general, { name: "حملة ورشة التصميم", budgetTotal: 2, bidCpm: 100, targeting: {} });
  assert.equal(p.status, 200, p.error); assert.equal(p.campaign.budget.total, 2); assert.equal(p.campaign.budget.dailyCap, 2, "daily cap clamped to the new budget");
  assert.equal((await omar.req("PATCH", "/api/ads/campaigns/" + C.general, { name: "سرقة" })).status, 404, "not yours");
  assert.equal((await omar.req("GET", "/api/ads/campaigns/" + C.general)).status, 404);
  const l = await sara.req("GET", "/api/ads/campaigns");
  assert.equal(l.status, 200); assert.equal(l.items.length, 2); assert.ok(l.items[0].totals);

  const t = await new H.Client().req("GET", "/api/ads/topics");
  assert.ok(t.topics.some(x => x.slug === "dev")); assert.ok(!t.topics.some(x => ["religion", "politics", "health"].includes(x.slug)));
  const est = await sara.req("POST", "/api/ads/estimate", { targeting: { topics: ["dev"] } });
  assert.equal(est.status, 200, est.error); assert.equal(est.audience.label, "أقل من 10"); assert.equal(est.audience.bucket, "lt10");
  assert.equal((await sara.req("POST", "/api/ads/estimate", { targeting: { topics: ["religion"] } })).code, "targeting_sensitive");
  assert.equal((await new H.Client().req("POST", "/api/ads/campaigns", base(P.sara))).status, 401);
});

test("submit: spam/automod rejection, review queue, reject → edit → resubmit → approve, notifications", async () => {
  const bad = await sara.req("POST", "/api/ads/campaigns", base(P.sara, { name: "اربح 1000 دولار الآن ضاعف أموالك" }));
  assert.equal(bad.status, 200, bad.error);
  const s = await sara.req("POST", `/api/ads/campaigns/${bad.campaign.id}/submit`);
  assert.equal(s.status, 422); assert.equal(s.code, "ad_rejected");
  const g = await sara.req("GET", "/api/ads/campaigns/" + bad.campaign.id);
  assert.equal(g.campaign.status, "rejected"); assert.equal(g.campaign.review.automated, true); assert.ok(g.campaign.reviewNote);
  assert.equal((await notes(sara.id, "ad_rejected")).length, 1);
  await sara.req("DELETE", "/api/ads/campaigns/" + bad.campaign.id);
  assert.equal((await sara.req("GET", "/api/ads/campaigns/" + bad.campaign.id)).status, 404, "removed is gone for the advertiser");

  const sub = await sara.req("POST", `/api/ads/campaigns/${C.dev}/submit`);
  assert.equal(sub.status, 200, sub.error); assert.equal(sub.campaign.status, "in_review");
  assert.equal((await sara.req("POST", `/api/ads/campaigns/${C.dev}/submit`)).code, "invalid_state");
  assert.equal((await sara.req("PATCH", "/api/ads/campaigns/" + C.dev, { name: "اسم جديد للحملة" })).code, "invalid_state", "no edits while in review");
  assert.equal((await omar.req("GET", "/api/admin/ads/review")).status, 403);
  const q = await admin.req("GET", "/api/admin/ads/review");
  assert.equal(q.status, 200); assert.ok(q.items.some(x => x.id === C.dev && x.advertiser.handle === "ad_sara" && x.post.id === P.sara));
  assert.ok(q.reasons.some(r => r.code === "misleading"));
  assert.equal((await admin.req("POST", "/api/admin/ads/review/" + C.dev, { decision: "reject" })).code, "review_invalid", "a reason is required");
  const rj = await admin.req("POST", "/api/admin/ads/review/" + C.dev, { decision: "reject", reasons: ["misleading"], note: "وضّح أن الدورة مجانية فعلاً" });
  assert.equal(rj.status, 200, rj.error); assert.equal(rj.campaign.status, "rejected"); assert.equal(rj.campaign.reviewNote, "وضّح أن الدورة مجانية فعلاً");
  assert.equal((await notes(sara.id, "ad_rejected")).length, 2);
  const L = require("../lib/notify-lib");
  for (const k of ["ad_approved", "ad_rejected", "ad_budget_low", "ad_completed"]) { assert.ok(L.KINDS[k], k); assert.equal(L.hrefFor({ kind: k, ref: C.dev }), "/#/ads/campaigns/" + C.dev); }
  const ed = await sara.req("PATCH", "/api/ads/campaigns/" + C.dev, { name: "دورة البرمجة المجانية" });
  assert.equal(ed.status, 200, ed.error);
  assert.equal((await sara.req("POST", `/api/ads/campaigns/${C.dev}/submit`)).campaign.status, "in_review");
  const ap = await admin.req("POST", "/api/admin/ads/review/" + C.dev, { decision: "approve", note: "مقبول" });
  assert.equal(ap.status, 200, ap.error); assert.equal(ap.campaign.status, "awaiting_funds");
  assert.equal((await notes(sara.id, "ad_approved")).length, 1);
  assert.equal((await admin.req("POST", "/api/admin/ads/review/" + C.dev, { decision: "approve" })).code, "invalid_state");
  // after approval only limited edits
  assert.equal((await sara.req("PATCH", "/api/ads/campaigns/" + C.dev, { targeting: { topics: ["ai"] } })).code, "invalid_state");
  const lim = await sara.req("PATCH", "/api/ads/campaigns/" + C.dev, { name: "دورة البرمجة المجانية للمبتدئين", freqCap: { impressions: 3, perHours: 12 } });
  assert.equal(lim.status, 200, lim.error); assert.deepEqual(lim.campaign.freqCap, { impressions: 3, perHours: 12 });
  // general campaign through review (approved before funding)
  await sara.req("POST", `/api/ads/campaigns/${C.general}/submit`);
  assert.equal((await admin.req("POST", "/api/admin/ads/review/" + C.general, { decision: "approve" })).campaign.status, "awaiting_funds");
});

test("funding: Pi off → 409 not_configured; Pi on → intent purpose ads → active, ledger journal", async () => {
  const pis = H.app.ctx.services.pi, orig = pis.enabled;
  pis.enabled = () => false;
  try {
    const r = await sara.req("POST", `/api/ads/campaigns/${C.dev}/fund`);
    assert.equal(r.status, 409); assert.equal(r.code, "not_configured");
    const g = await sara.req("GET", "/api/ads/campaigns/" + C.dev);
    assert.equal(g.campaign.piEnabled, false); assert.equal(g.campaign.fundNote, "مدفوعات Pi غير مفعّلة بعد");
    assert.equal((await new H.Client().req("GET", "/api/ads/config")).piEnabled, false);
  } finally { pis.enabled = orig; }
  assert.equal((await omar.req("POST", `/api/ads/campaigns/${C.dev}/fund`)).status, 404);
  const f = await sara.req("POST", `/api/ads/campaigns/${C.dev}/fund`);
  assert.equal(f.status, 200, f.error); assert.equal(f.intent.amount, 5);
  const tx = await db().get("SELECT purpose, ref_id FROM pi_transactions WHERE id=$1", [f.intent.id]);
  assert.deepEqual({ ...tx }, { purpose: "ads", ref_id: C.dev });
  const again = await sara.req("POST", `/api/ads/campaigns/${C.dev}/fund`);
  assert.equal(again.intent.id, f.intent.id, "an open intent is offered again");
  await payIntent(sara, f.intent);
  const g = await sara.req("GET", "/api/ads/campaigns/" + C.dev);
  assert.equal(g.campaign.status, "active"); assert.equal(g.campaign.budget.funded, true); assert.equal(g.campaign.budget.fundedAmount, 5);
  assert.ok(g.campaign.actions.includes("pause")); assert.ok(!g.campaign.actions.includes("fund"));
  assert.equal(await balance("ads:budget:" + C.dev), 5);
  assert.equal((await sara.req("POST", `/api/ads/campaigns/${C.dev}/fund`)).code, "invalid_state");
  assert.equal((await sara.req("PATCH", "/api/ads/campaigns/" + C.dev, { budgetTotal: 8 })).code, "invalid_state", "funded budget is fixed");
  const f2 = await sara.req("POST", `/api/ads/campaigns/${C.general}/fund`);
  await payIntent(sara, f2.intent);
  assert.equal((await sara.req("GET", "/api/ads/campaigns/" + C.general)).campaign.status, "active");
  // the general campaign stays paused while we test the targeted one
  assert.equal((await sara.req("POST", `/api/ads/campaigns/${C.general}/pause`)).campaign.status, "paused");
  await check();
});

test("delivery: ≤ 1 per 8 organic posts, never first, home modes only; minors, blocks, mutes, personalisation off", async () => {
  flushFeeds();
  const f = await feed(omar);
  const pr = promotedIn(f);
  assert.equal(pr.length, 1, "one eligible campaign → one ad even with two slots");
  assert.equal(pr[0].i, 8, "after 8 organic posts");
  const item = pr[0].p;
  assert.equal(item.id, P.sara); assert.equal(item.promoted.campaignId, C.dev); assert.equal(item.promoted.label, "مُروَّج");
  assert.deepEqual({ handle: item.promoted.advertiser.handle, name: item.promoted.advertiser.name }, { handle: "ad_sara", name: "عضو ad_sara" });
  assert.ok(item.promoted.token);
  assert.equal(f.posts.filter(p => !p.promoted).length, 18); assert.notEqual(f.posts[0].promoted, true);
  assert.ok(f.users.some(u => u.id === sara.id), "advertiser profile is hydrated");
  assert.equal(promotedIn(await feed(omar, "communities")).length, 0, "never in communities");
  assert.equal(promotedIn(await feed(omar, "for")).length, 1);
  // second page: cursor stays organic, the slot is global
  const p2 = await feed(omar, "latest", "&cursor=7");
  assert.equal(promotedIn(p2)[0]?.i, 1, "global slot after organic #8 → second item of a page starting at 7");
  // not targeted: bob follows no topic; nora chose design not dev
  assert.equal(promotedIn(await feed(bob)).length, 0);
  // minors never see ads, even untargeted ones
  await sara.req("POST", `/api/ads/campaigns/${C.general}/resume`);
  assert.equal(promotedIn(await feed(minnie)).length, 0, "minor");
  assert.equal(promotedIn(await feed(bob)).length, 1, "untargeted campaign reaches bob");
  // personalisation off → only untargeted
  assert.equal((await omar.req("PUT", "/api/me/ads/prefs", { personalized: false })).personalized, false);
  const off = promotedIn(await feed(omar));
  assert.ok(off.every(x => x.p.promoted.campaignId === C.general), "targeted campaign not shown with personalisation off");
  assert.equal((await omar.req("PUT", "/api/me/ads/prefs", { personalized: true })).personalized, true);
  const both = promotedIn(await feed(omar));
  assert.equal(both.length, 2); assert.deepEqual(both.map(x => x.i), [8, 17]);
  assert.equal(new Set(both.map(x => x.p.promoted.campaignId)).size, 2, "distinct campaigns per page");
  // blocks (either way) and mutes
  const setPrefs = (uid, o) => db().run("UPDATE users SET prefs=$1 WHERE id=$2", [o, uid]);
  await setPrefs(bob.id, { blocked: [sara.id] });
  assert.equal(promotedIn(await feed(bob)).length, 0, "bob blocked the advertiser");
  await setPrefs(bob.id, { blocked: [] });
  await db().run("INSERT INTO user_blocks(owner,target,root,created_at) VALUES($1,$2,$2,$3)", [sara.id, bob.id, new Date().toISOString()]);
  assert.equal(promotedIn(await feed(bob)).length, 0, "advertiser blocked bob");
  await db().run("DELETE FROM user_blocks WHERE owner=$1", [sara.id]);
  assert.equal(promotedIn(await feed(bob)).length, 1);
  await setPrefs(bob.id, { muted: { users: [sara.id] } });
  assert.equal(promotedIn(await feed(bob)).length, 0, "muted advertiser");
  await setPrefs(bob.id, {});
  assert.equal(promotedIn(await feed(sara)).length, 0, "no own ads");
  // signed out: untargeted only (service level; /api/feed requires sign-in)
  const anon = await ads().pick(null, 3);
  assert.deepEqual(anon.map(x => x.c.id), [C.general]);
  await sara.req("POST", `/api/ads/campaigns/${C.general}/pause`);
});

test("events: signed single-use tokens, frequency cap, CPM charging, k-anonymous stats", async () => {
  let item = promotedIn(await feed(omar))[0].p;
  const forged = await omar.req("POST", "/api/ads/events", { campaignId: C.dev, type: "impression", token: item.promoted.token.slice(0, -3) + "AAA" });
  assert.equal(forged.code, "token_invalid");
  assert.equal((await bob.req("POST", "/api/ads/events", { campaignId: C.dev, type: "impression", token: item.promoted.token })).code, "token_invalid", "token bound to the viewer");
  assert.equal((await new H.Client().req("POST", "/api/ads/events", { campaignId: C.dev, type: "impression", token: item.promoted.token })).code, "token_invalid");
  assert.equal((await omar.req("POST", "/api/ads/events", { campaignId: C.general, type: "impression", token: item.promoted.token })).code, "token_invalid", "token bound to the campaign");
  const e1 = await ev(omar, item);
  assert.equal(e1.status, 200, e1.error); assert.equal(e1.counted, true);
  assert.equal((await ev(omar, item)).counted, false, "single use");
  assert.equal((await ev(omar, item, "click")).counted, true);
  assert.equal((await ev(omar, item, "click")).counted, false);
  for (let i = 0; i < 2; i++) { item = promotedIn(await feed(omar))[0].p; assert.equal((await ev(omar, item)).counted, true); }
  assert.equal(promotedIn(await feed(omar)).length, 0, "frequency cap 3 per 12 h reached");
  const c = await db().get("SELECT spent FROM ad_campaigns WHERE id=$1", [C.dev]);
  assert.equal(Number(c.spent), 3 * Math.round(toU(10) / 1000), "CPM 10 Pi → 0.01 Pi per impression");
  const g = await sara.req("GET", "/api/ads/campaigns/" + C.dev);
  assert.equal(g.campaign.stats.days.length, 1);
  assert.deepEqual(g.campaign.stats.totals, { day: null, impressions: null, impressionsText: "أقل من 10", clicks: null, clicksText: "أقل من 10", spend: 0.03, ctr: null });
  assert.equal(g.campaign.budget.spent, 0.03);
  // window passes → eligible again (ads clock moves; salt for the same day keeps the counter)
  offset = 13 * 3600e3;
  try {
    if (new Date(Date.now() + offset).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) assert.equal(promotedIn(await feed(omar)).length, 1, "window expired");
  } finally { offset = 0; }
});

test("privacy: no user ids in ad_stats_daily / ad_feedback / ad_freq / ad_tokens; why + hide + prefs", async () => {
  const w = await omar.req("GET", "/api/ads/why/" + C.dev);
  assert.equal(w.status, 200, w.error);
  assert.deepEqual(w.reasons.map(r => r.type), ["topic", "language"]); assert.equal(w.reasons[0].topic, "dev"); assert.equal(w.personalized, true);
  assert.ok(w.controls.some(x => x.action === "hide_ad") && w.controls.some(x => x.href === "/#/settings/ads"));
  assert.equal((await new H.Client().req("GET", "/api/ads/why/" + C.dev)).reasons[0].type, "general");
  assert.equal((await omar.req("GET", "/api/ads/why/ac_nope")).status, 404);
  // hide this ad / this advertiser → aggregated feedback only
  assert.equal((await bob.req("POST", "/api/ads/hide", { campaignId: C.dev, scope: "ad", reason: "irrelevant" })).ok, true);
  assert.equal((await nora.req("POST", "/api/ads/hide", { campaignId: C.dev, scope: "advertiser", reason: "repetitive" })).ok, true);
  const np = await nora.req("GET", "/api/me/ads/prefs");
  assert.deepEqual(np.hiddenAdvertisers.map(a => a.handle), ["ad_sara"]); assert.equal(np.personalized, true);
  const fb = await db().all("SELECT * FROM ad_feedback WHERE campaign_id=$1 ORDER BY reason", [C.dev]);
  assert.deepEqual(fb.map(r => [r.reason, Number(r.count)]), [["irrelevant", 1], ["repetitive", 1]]);
  // un-hide via PUT
  assert.deepEqual((await nora.req("PUT", "/api/me/ads/prefs", { hiddenAdvertisers: [] })).hiddenAdvertisers, []);
  assert.equal((await nora.req("PUT", "/api/me/ads/prefs", { personalized: "no" })).status, 400);
  // the hard rule: no column that could hold a user id, and no stored value equal to / containing any user id
  const userIds = (await db().all("SELECT id FROM users")).map(r => r.id);
  for (const t of ["ad_stats_daily", "ad_feedback", "ad_freq", "ad_tokens"]) {
    const rows = await db().all(`SELECT * FROM ${t}`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    assert.ok(!cols.some(c => /user|viewer|actor|member|advertiser|ip|device/i.test(c)), `${t} columns: ${cols}`);
    for (const r of rows) for (const v of Object.values(r)) for (const u of userIds) assert.ok(!String(v ?? "").includes(u), `${t} holds user id ${u}`);
  }
  assert.ok((await db().all("SELECT * FROM ad_stats_daily")).length >= 1);
  assert.ok((await db().all("SELECT * FROM ad_freq")).length >= 1, "frequency counters exist (hashed)");
  // the hash is the documented HMAC under today's salt, not reversible without it
  const h = await ads().viewerHash(omar.id, C.dev);
  assert.ok(await db().get("SELECT 1 x FROM ad_freq WHERE hash=$1", [h]));
  assert.notEqual(h, await ads().viewerHash(omar.id, C.dev, "2000-01-01"), "rotates daily");
});

test("budget: low warning, exhaustion → completed, charges journaled, ledger balanced", async () => {
  // general campaign: budget 2 Pi at CPM 100 → 0.1 Pi per impression → 20 impressions; freq cap raised so one viewer can drain it
  await db().run("UPDATE ad_campaigns SET freq_impressions=20 WHERE id=$1", [C.general]);
  await sara.req("POST", `/api/ads/campaigns/${C.general}/resume`);
  const viewers = [bob, lina, nora];
  let n = 0;
  for (let round = 0; round < 10 && n < 20; round++) for (const v of viewers) {
    if (n >= 20) break;
    const it = promotedIn(await feed(v)).find(x => x.p.promoted.campaignId === C.general);
    if (!it) continue;
    const r = await ev(v, it.p); if (r.counted) n++;
  }
  assert.equal(n, 20);
  await settle();
  const g = await sara.req("GET", "/api/ads/campaigns/" + C.general);
  assert.equal(g.campaign.status, "completed"); assert.equal(g.campaign.budget.spent, 2); assert.equal(g.campaign.budget.remaining, 0);
  assert.equal(g.campaign.stats.totals.impressions, 20, "≥ 10 → exact count"); assert.equal(g.campaign.stats.totals.impressionsText, "20");
  assert.equal((await notes(sara.id, "ad_budget_low")).filter(x => x.ref === C.general).length, 1);
  assert.equal((await notes(sara.id, "ad_completed")).filter(x => x.ref === C.general).length, 1);
  assert.ok(promotedIn(await feed(bob)).every(x => x.p.promoted.campaignId !== C.general), "completed campaigns are not served");
  assert.equal(await balance("ads:budget:" + C.general), 0);
  await ads().maintain();
  assert.equal(await balance("ads:budget:" + C.dev), 5 - 0.03);
  assert.equal(await balance("platform:ads"), 2.03);
  assert.equal((await ads().maintain()).charged, 0, "idempotent");
  assert.equal((await sara.req("POST", `/api/ads/campaigns/${C.general}/resume`)).code, "invalid_state");
  await check();
});

test("maintenance: end_at passes → completed; 7-day purge of frequency rows, tokens and old salts", async () => {
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ad_freq")).n) > 0);
  await db().run("INSERT INTO ad_meta(key,value,created_at) VALUES('salt:2000-01-01','x',$1) ON CONFLICT DO NOTHING", [new Date().toISOString()]);
  offset = 31 * DAY;
  try {
    const out = await ads().maintain();
    assert.ok(out.completed >= 1);
    assert.ok(out.purged.freq > 0 && out.purged.tokens > 0); assert.ok(out.purged.salts >= 1);
  } finally { offset = 0; }
  assert.equal((await db().get("SELECT status FROM ad_campaigns WHERE id=$1", [C.dev])).status, "completed");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ad_freq")).n), 0);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM ad_meta WHERE key='salt:2000-01-01'")).n), 0);
  assert.equal((await notes(sara.id, "ad_completed")).filter(x => x.ref === C.dev).length, 1);
  await check();
});

test("compliance: data map, export of ad prefs + own campaigns, erasure scrubs campaigns and deletes prefs", async () => {
  const CL = require("../lib/compliance-lib");
  for (const t of ["ad_prefs", "ad_campaigns", "ad_reviews"]) assert.ok(CL.DATA_MAP.find(m => m.t === t), t);
  for (const t of ["ad_stats_daily", "ad_feedback", "ad_freq", "ad_tokens"]) assert.ok(!CL.DATA_MAP.find(m => m.t === t), t + " holds no personal data");
  H.app.ctx.rl.w.clear();
  const ex = await sara.req("GET", "/api/me/privacy/export?format=json");
  assert.equal(ex.status, 200, ex.error);
  assert.ok(ex.ad_campaigns.some(c => c.id === C.dev));
  const eo = await omar.req("GET", "/api/me/privacy/export?format=json");
  assert.equal(eo.ad_prefs.length, 1);
  await H.app.ctx.services.compliance.eraseUser(omar.id);
  await H.app.ctx.services.compliance.eraseUser(sara.id);
  await settle();
  assert.equal(await db().get("SELECT * FROM ad_prefs WHERE user_id=$1", [omar.id]), undefined);
  const c = await db().get("SELECT * FROM ad_campaigns WHERE id=$1", [C.dev]);
  assert.equal(c.status, "removed"); assert.equal(c.name, "حملة محذوفة"); assert.equal(c.targeting, "{}");
  assert.ok(Number(c.spent) > 0, "financial figures kept");
  await check();
});

function toU(x) { return Math.round(x * 1e7); }
