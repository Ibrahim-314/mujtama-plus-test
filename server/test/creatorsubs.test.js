/* Phase 57 — creator monthly subscriptions with tiers, against the stubbed Pi Platform API (same stub as transfers.test.js).
 * Covers: migration 036 down/up + additive + data map, tier benefits (owner-only, validation), subscribe via renew
 * (purpose subscription, phase 37 rows), upgrade with prorated charge (ledger journal, tier switch, creator notification),
 * proration rules unit, downgrade scheduled → applied at renewal inside the reminder window, subscriber channel (access by
 * benefit, badges, outsider/minor refused, delete), early access release (locked → public), grace reminder, churn stats,
 * subscriber list (anonymous stays anonymous), minors refused, refunded upgrade reverts tier, ledger balanced. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/ledger");

const KEY = "sk_test_cs_57";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map(); let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "csp_" + (++seq), user_uid: o.uid, amount: o.amount, memo: "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") { const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || "")); return m ? res(200, { sessionToken: "s", user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {}); }
  const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path), p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub" };
const DAY = 864e5;
let H, admin, cr, fan, fan2, out, kid, tiers;
const db = () => H.app.ctx.db, cs = () => H.app.ctx.services.creatorSubs;
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await cs().settle(); return p;
};
const ledgerOk = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); };
const notes = async (uid, kind) => Number((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind]))?.n || 0);
const sub = (uid) => db().get("SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id=$2", [uid, cr.id]);

const override = (H) => { H.Client.prototype.req = async function (method, path, body, headers = {}) {
  const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { ...j, body: j, status: r.status, headers: r.headers };
}; };
test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, creatorSubsOpts: { jobs: false } });
  override(H);
  admin = await mk("cs_admin"); cr = await mk("cs_cr"); fan = await mk("cs_fan"); fan2 = await mk("cs_fan2"); out = await mk("cs_out"); kid = await mk("cs_kid");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  for (const c of [cr, fan, fan2, out, kid]) await linkPi(c);
  const age = await kid.req("POST", "/api/age", { birthDate: "2013-05-01" }); assert.equal(age.status, 200, age.error);
  const s = await cr.req("PUT", "/api/me/creator", { enabled: true, tiers: [{ name: "برونزي", amount: 5 }, { name: "ذهبي", amount: 10 }] }); assert.equal(s.status, 200, s.error);
  tiers = s.tiers;
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 036: down/up reversible, additive, data map", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '036_creator_subs' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "036_creator_subs"]);
  await assert.rejects(() => db().get("SELECT 1 FROM sub_changes"));
  assert.deepEqual(await mig.up(db()), ["036_creator_subs", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  const C = require("../lib/compliance-lib");
  for (const m of C.DATA_MAP.filter((x) => ["sub_changes", "sub_channel_msgs"].includes(x.t))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [fan.id]);
});

test("proration rules (lib/ledger.js)", () => {
  const P = 30 * DAY, at = Date.parse("2026-10-01T00:00:00Z"), until = new Date(at + 15 * DAY).toISOString();
  const up = L.prorate({ fromAmount: L.toUnits(5), toAmount: L.toUnits(10), activeUntil: until, at, periodMs: P });
  assert.equal(up.kind, "upgrade"); assert.equal(L.pi(up.charge), 2.5); assert.equal(up.remainingMs, 15 * DAY);
  const dn = L.prorate({ fromAmount: L.toUnits(10), toAmount: L.toUnits(5), activeUntil: until, at, periodMs: P });
  assert.equal(dn.kind, "downgrade"); assert.equal(dn.charge, 0); assert.equal(dn.effectiveAt, until);
  const tiny = L.prorate({ fromAmount: L.toUnits(5), toAmount: L.toUnits(10), activeUntil: new Date(at + 60e3).toISOString(), at, periodMs: P });
  assert.equal(tiny.waived, true); assert.equal(tiny.charge, 0);
  assert.equal(L.prorate({ fromAmount: 1, toAmount: 2, activeUntil: new Date(at - 1).toISOString(), at, periodMs: P }).kind, "renew");
  assert.equal(L.prorate({ fromAmount: 5, toAmount: 5, activeUntil: until, at, periodMs: P }).kind, "same");
});

test("tier benefits: owner sets, validation, public page shows them", async () => {
  assert.equal((await fan.req("PUT", "/api/me/subs/tiers", { tiers: [{ id: tiers[0].id, benefits: ["posts"] }] })).status, 400); // not fan's tier
  assert.equal((await cr.req("PUT", "/api/me/subs/tiers", { tiers: [{ id: tiers[0].id, benefits: ["vip"] }] })).status, 400);
  assert.equal((await kid.req("PUT", "/api/me/subs/tiers", { tiers: [] })).code, "minor_restricted");
  const r = await cr.req("PUT", "/api/me/subs/tiers", { tiers: [
    { id: tiers[0].id, benefits: ["posts", "channel", "badge"], badge: "داعم", badgeEmoji: "🥉", description: "منشورات وقناة" },
    { id: tiers[1].id, benefits: ["posts", "channel", "badge", "early"], badge: "ذهبي", badgeEmoji: "🥇", earlyHours: 48 }] });
  assert.equal(r.status, 200, r.error); assert.equal(r.tiers[1].earlyHours, 48); assert.deepEqual(r.tiers[0].benefits, ["posts", "channel", "badge"]);
  const p = await out.req("GET", "/api/subs/cs_cr"); assert.equal(p.creator.enabled, true); assert.equal(p.payments, true); assert.equal(p.tiers.length, 2); assert.equal(p.tiers[0].badgeEmoji, "🥉"); assert.equal(p.me.state, "none"); assert.equal(p.rules.graceDays, 3);
});

test("subscribe (renew), upgrade with prorated payment, ledger + notification, minors refused", async () => {
  assert.equal((await kid.req("POST", "/api/subs/cs_cr/renew", { tierId: tiers[0].id })).code, "minor_restricted");
  const s = await fan.req("POST", "/api/subs/cs_cr/renew", { tierId: tiers[0].id }); assert.equal(s.status, 200, s.error);
  assert.equal((await db().get("SELECT purpose FROM pi_transactions WHERE id=$1", [s.intent.id])).purpose, "subscription");
  await payIntent(fan, s.intent);
  let row = await sub(fan.id); assert.equal(row.state, "active"); assert.equal(row.tier_id, tiers[0].id);
  assert.equal((await fan.req("POST", "/api/subs/cs_cr/change", { tierId: tiers[0].id })).code, "same_tier");
  const q = await fan.req("GET", "/api/subs/cs_cr/quote?tierId=" + tiers[1].id); assert.equal(q.kind, "upgrade"); assert.ok(q.charge > 4.9 && q.charge <= 5 && Math.round(q.charge * 100) === q.charge * 100, String(q.charge));
  const c = await fan.req("POST", "/api/subs/cs_cr/change", { tierId: tiers[1].id }); assert.equal(c.status, 200, c.error); assert.equal(c.intent.amount, q.charge);
  assert.equal((await sub(fan.id)).tier_id, tiers[0].id, "tier changes only after payment");
  await payIntent(fan, c.intent);
  row = await sub(fan.id); assert.equal(row.tier_id, tiers[1].id); assert.equal(L.pi(row.amount), 10);
  const j = await db().get("SELECT * FROM ledger_journals WHERE ref_id=$1", [c.changeId]); assert.equal(j.kind, "support"); assert.equal(j.creator_id, cr.id);
  assert.equal(await notes(cr.id, "sub_upgraded"), 1);
  await ledgerOk();
});

test("downgrade scheduled, then applied by renewal inside the reminder window", async () => {
  const d = await fan.req("POST", "/api/subs/cs_cr/change", { tierId: tiers[0].id }); assert.equal(d.status, 200, d.error); assert.equal(d.kind, "downgrade"); assert.equal(d.charge, 0);
  let p = await fan.req("GET", "/api/subs/cs_cr"); assert.equal(p.me.scheduled.tierId, tiers[0].id); assert.equal(p.me.tier.id, tiers[1].id, "keeps higher tier until renewal");
  assert.equal((await fan.req("POST", "/api/subs/cs_cr/renew", {})).code, "support_active");
  await db().run("UPDATE support_subscriptions SET active_until=$1 WHERE supporter_id=$2", [new Date(Date.now() + DAY).toISOString(), fan.id]);
  p = await fan.req("GET", "/api/subs/cs_cr"); assert.equal(p.me.state, "due"); assert.equal(p.me.canRenew, true);
  const r = await fan.req("POST", "/api/subs/cs_cr/renew", {}); assert.equal(r.status, 200, r.error); assert.equal(r.intent.amount, 5);
  await payIntent(fan, r.intent);
  const row = await sub(fan.id); assert.equal(row.tier_id, tiers[0].id); assert.ok(Date.parse(row.active_until) > Date.now() + 29 * DAY);
  assert.equal((await db().get("SELECT status FROM sub_changes WHERE id=$1", [d.changeId])).status, "applied");
  await ledgerOk();
});

test("subscriber channel: access by benefit, badges, outsiders + minors refused, delete", async () => {
  assert.equal((await out.req("GET", "/api/subs/cs_cr/channel")).code, "subscribers_only");
  assert.equal((await kid.req("POST", "/api/subs/cs_cr/channel", { text: "hi" })).status, 403);
  const m1 = await fan.req("POST", "/api/subs/cs_cr/channel", { text: "مرحبا بالجميع" }); assert.equal(m1.status, 200, m1.error);
  const m2 = await cr.req("POST", "/api/subs/cs_cr/channel", { text: "أهلاً بالمشتركين" }); assert.equal(m2.status, 200, m2.error);
  assert.equal(await notes(fan.id, "sub_channel"), 1);
  const l = await fan.req("GET", "/api/subs/cs_cr/channel"); assert.equal(l.items.length, 2);
  assert.equal(l.items[0].badge.emoji, "🥉"); assert.equal(l.items[1].isCreator, true); assert.equal(l.items[1].canDelete, false);
  const b = await out.req("GET", "/api/subs/cs_cr/badges?users=cs_fan,cs_out"); assert.equal(b.badges.cs_fan.label, "داعم"); assert.equal(b.badges.cs_out, undefined);
  assert.equal((await fan.req("DELETE", "/api/subs/cs_cr/channel/" + m2.id)).status, 403);
  assert.equal((await cr.req("DELETE", "/api/subs/cs_cr/channel/" + m1.id)).status, 200);
  assert.equal((await fan.req("GET", "/api/subs/cs_cr/channel")).items.length, 1);
});

test("early access: supporter-only post released to everyone by the job", async () => {
  const p = await cr.req("POST", "/api/posts", { text: "محتوى حصري للمشتركين: في هذه الحلقة نشرح خطوات بناء متجر صغير على شبكة Pi، من فكرة المنتج إلى أول عملية بيع، مع أمثلة عملية من تجارب أعضاء المجتمع ونصائح لتجنب الأخطاء الشائعة.", paid: { mode: "supporters", minTierId: tiers[0].id } }); assert.equal(p.status, 200, p.error);
  const pid = p.post.id;
  assert.equal((await out.req("GET", "/api/posts/" + pid)).post.locked, true);
  assert.equal((await fan.req("GET", "/api/posts/" + pid)).post.locked, false);
  assert.equal((await cr.req("POST", "/api/me/subs/early", { postId: "nope" })).code, "not_supporters_post");
  const e = await cr.req("POST", "/api/me/subs/early", { postId: pid, hours: 2 }); assert.equal(e.status, 200, e.error); assert.equal(e.hours, 2);
  assert.equal((await cs().job()).released, 0);
  await db().run("UPDATE sub_early SET public_at=$1 WHERE post_id=$2", [new Date(Date.now() - 1000).toISOString(), pid]);
  assert.equal((await cs().job()).released, 1);
  const o = await out.req("GET", "/api/posts/" + pid); assert.ok(!o.post.locked); assert.ok(o.post.text.startsWith("محتوى حصري"));
  assert.equal((await db().get("SELECT state FROM paid_posts WHERE post_id=$1", [pid])).state, "released");
  assert.equal((await cr.req("GET", "/api/me/subs/early")).items[0].releasedAt !== null, true);
});

test("grace reminder, cancel → churn stats, subscriber list keeps anonymity, refunded upgrade reverts tier", async () => {
  const s = await fan2.req("POST", "/api/subs/cs_cr/renew", { tierId: tiers[0].id, anonymous: true }); await payIntent(fan2, s.intent);
  await db().run("UPDATE support_subscriptions SET active_until=$1 WHERE supporter_id=$2", [new Date(Date.now() - DAY).toISOString(), fan2.id]);
  assert.equal((await fan2.req("GET", "/api/subs/cs_cr")).me.state, "grace");
  assert.equal((await cs().job()).grace, 1); assert.equal((await cs().job()).grace, 0, "once per period");
  assert.equal(await notes(fan2.id, "sub_grace"), 1);
  const list = await cr.req("GET", "/api/me/subscribers"); assert.equal(list.items.length, 2);
  const anon = list.items.find((i) => i.anonymous); assert.equal(anon.user, null); assert.equal(anon.state, "grace");
  assert.equal((await out.req("GET", "/api/me/subscribers")).items.length, 0);
  // upgrade fan then refund it → tier reverts
  await db().run("UPDATE support_subscriptions SET active_until=$1 WHERE supporter_id=$2", [new Date(Date.now() + 20 * DAY).toISOString(), fan.id]);
  const c = await fan.req("POST", "/api/subs/cs_cr/change", { tierId: tiers[1].id }); assert.equal(c.status, 200, c.error); await payIntent(fan, c.intent);
  assert.equal((await sub(fan.id)).tier_id, tiers[1].id);
  const r = await H.app.ctx.services.pi.refund(admin, c.intent.id, { note: "test", txid: "tx_refund" }).catch((e) => e); await cs().settle();
  assert.ok(!(r instanceof Error), r?.message);
  assert.equal((await sub(fan.id)).tier_id, tiers[0].id); assert.equal((await db().get("SELECT status FROM sub_changes WHERE id=$1", [c.changeId])).status, "refunded");
  // cancel → churn
  const sid = (await sub(fan.id)).id; assert.equal((await fan.req("POST", `/api/support/${sid}/cancel`)).status, 200); await cs().settle();
  const st = await cr.req("GET", "/api/me/subscribers/stats"); assert.equal(st.status, 200, st.error);
  assert.equal(st.last30.started, 2); assert.ok(st.last30.renewed >= 1); assert.ok(st.last30.upgraded >= 1); assert.equal(st.last30.cancellations, 1); assert.equal(st.inGrace, 1);
  assert.ok(st.current >= 1); assert.equal(st.months.length, 6); assert.ok(st.churnRate > 0);
  await ledgerOk();
});
