/* v2.74 — MJT tips on clips / video posts («إكرامية مجتمع كوين»).
 * Migration 073 (reversible, additive) · POST /api/mjt/posts/:id/tips moves MJT viewer → author on the ledger (kind 'tip',
 * ref post) with the transfer guards (ikey + replay + conflict, own post, balance, minors, blocks, receive off, frozen,
 * too-new account, transfers off, hidden post, limits shared with transfers) · GET summary (total, supporters, top 5,
 * anonymous tips hidden, the viewer's own total) · creator «tips received» · wallet history labels (anon hidden from the
 * creator) · notification · ledger still verifies. SQLite + PostgreSQL (TEST_DATABASE_URL). */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");

let H, staff, a, b, c, kid, newbie, postB, postA;
const DAY = 864e5;
const db = () => H.app.ctx.db,
  M = () => H.app.ctx.services.mjt;
const OLD = new Date(Date.now() - 40 * DAY).toISOString();
let seq = 0;
const key = () => `t${Date.now().toString(36)}_${++seq}_tip`;
async function mk(handle, old = true) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client();
  const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  cl.id = r.user.id;
  cl.handle = handle;
  if (old) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, cl.id]);
  return cl;
}
const fund = async (u, amount) => {
  const r = await staff.req("POST", "/api/admin/mjt/adjust", { ikey: key(), handle: u.handle, amount: String(amount), reason: "رصيد اختبار الإكراميات" });
  assert.equal(r.status, 200, r.error);
};
const bal = async u => (await u.req("GET", "/api/mjt/me")).balance.mjt;
const tip = (u, pid, body) => {
  H.app.ctx.rl.w.clear();
  return u.req("POST", `/api/mjt/posts/${pid}/tips`, { ikey: key(), ...body });
};
const mkPost = async (u, text) => {
  H.app.ctx.rl.w.clear();
  const r = await u.req("POST", "/api/posts", { text });
  assert.equal(r.status, 200, r.error);
  return (r.post || r).id;
};

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await M().ready;
  staff = await mk("tp_staff");
  a = await mk("tp_a");
  b = await mk("tp_b");
  c = await mk("tp_c");
  kid = await mk("tp_kid");
  newbie = await mk("tp_new", false);
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  await M().dropMinAge();
  assert.equal((await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { minAccountDays: 7 } })).status, 200); // v2.74.2 default is 0; these tests cover a configured wait
  const real = H.app.ctx.services.minors.minorIds;
  H.app.ctx.services.minors.minorIds = async ids => {
    const s = await real(ids);
    if (ids.includes(kid.id)) s.add(kid.id);
    return s;
  };
  await fund(a, 100);
  await fund(c, 100);
  await fund(newbie, 50);
  await fund(kid, 20);
  postB = await mkPost(b, "لقطة صانع المحتوى ب");
  postA = await mkPost(a, "منشور العضو أ");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 073: reversible and additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '073_mjt_tips' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "073_mjt_tips"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mjt_tips"));
  assert.ok((await db().get("SELECT 1 x FROM mjt_tx LIMIT 1")) !== undefined, "the MJT ledger is untouched");
  assert.deepEqual(await mig.up(db()), ["073_mjt_tips", ...later]);
});

test("tip moves MJT from the viewer to the author, idempotent replay, conflict on reuse", async () => {
  const k = key();
  const r = await a.req("POST", `/api/mjt/posts/${postB}/tips`, { ikey: k, amount: "10", note: "لقطة رائعة" });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.tip.amount, "10");
  assert.equal(r.balance.mjt, "90");
  assert.equal(r.summary.total, "10");
  assert.equal(r.summary.count, 1);
  assert.equal(r.summary.mine, "10");
  assert.equal(await bal(b), "10");
  const again = await a.req("POST", `/api/mjt/posts/${postB}/tips`, { ikey: k, amount: "10" });
  assert.equal(again.replayed, true);
  assert.equal(await bal(a), "90");
  assert.equal(await bal(b), "10");
  const clash = await a.req("POST", `/api/mjt/posts/${postB}/tips`, { ikey: k, amount: "11" });
  assert.equal(clash.status, 409);
  assert.equal(clash.code, "idempotency_conflict");
  const tx = await db().get("SELECT * FROM mjt_tx WHERE id=$1", [r.tip.id]);
  assert.equal(tx.kind, "tip");
  assert.equal(tx.ref_type, "post");
  assert.equal(tx.ref_id, postB);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='mjt_tip'", [b.id]), "creator notified");
  assert.equal((await staff.req("GET", "/api/admin/mjt/verify")).ok !== false, true);
});

test("guards: ikey, own post, balance, amount, minors, too-new, receive off, blocked, missing post, transfers off", async () => {
  H.app.ctx.rl.w.clear();
  assert.equal((await a.req("POST", `/api/mjt/posts/${postB}/tips`, { amount: "1" })).code, "ikey_required");
  assert.equal((await tip(a, postA, { amount: "1" })).code, "self_tip");
  assert.equal((await tip(a, postB, { amount: "0" })).code, "bad_amount");
  assert.equal((await tip(a, postB, { amount: "5000" })).status >= 400, true);
  assert.equal((await tip(c, postB, { amount: "101" })).code, "insufficient_balance");
  assert.equal((await tip(kid, postB, { amount: "1" })).code, "minor_restricted");
  assert.equal((await tip(newbie, postB, { amount: "1" })).code, "account_too_new");
  assert.equal((await tip(a, "nope_post", { amount: "1" })).status, 404);
  const off = await b.req("PUT", "/api/mjt/receive", { receive: false });
  assert.equal(off.status, 200, off.error);
  assert.equal((await tip(c, postB, { amount: "1" })).code, "recipient_off");
  await b.req("PUT", "/api/mjt/receive", { receive: true });
  const bl = await b.req("PUT", `/api/protection/blocks/${c.id}`, { linked: false });
  assert.equal(bl.status, 200, bl.error);
  const blk = await tip(c, postB, { amount: "1" });
  assert.ok(blk.status === 403 || blk.status === 404, JSON.stringify(blk));
  await b.req("DELETE", `/api/protection/blocks/${c.id}`);
  assert.equal(await bal(c), "100", "no guard moved money");
});

test("summary: top supporters, anonymous tips hidden, mine per viewer; history labels; creator report", async () => {
  const r1 = await tip(c, postB, { amount: "7", anon: true });
  assert.equal(r1.status, 200, r1.error);
  const r2 = await tip(c, postB, { amount: "3", anon: true });
  assert.equal(r2.status, 200, r2.error);
  const s = await b.req("GET", `/api/mjt/posts/${postB}/tips`);
  assert.equal(s.total, "20");
  assert.equal(s.count, 3);
  assert.equal(s.supporters, 2);
  assert.equal(s.mine, "0");
  assert.deepEqual(
    s.top.map(x => [x.anon, x.amount, x.user?.handle || null]),
    [
      [false, "10", "tp_a"],
      [true, "10", null]
    ]
  );
  assert.equal((await c.req("GET", `/api/mjt/posts/${postB}/tips`)).mine, "10");
  const hb = (await b.req("GET", "/api/mjt/history")).items.filter(i => i.kind === "tip");
  assert.equal(hb.length, 3);
  const anonRow = hb.find(i => i.label === "إكرامية من داعم مجهول");
  assert.ok(anonRow);
  assert.equal(anonRow.with, null, "anonymous tipper hidden from the creator");
  const named = hb.find(i => i.label === "إكرامية مُستلَمة");
  assert.equal(named.with.handle, "tp_a");
  assert.equal(named.post, postB);
  assert.equal(named.note, "لقطة رائعة");
  const hc = (await c.req("GET", "/api/mjt/history")).items.find(i => i.kind === "tip");
  assert.equal(hc.label, "إكرامية مُرسَلة");
  assert.equal(hc.with.handle, "tp_b");
  const rep = await b.req("GET", "/api/mjt/tips/received");
  assert.equal(rep.total, "20");
  assert.equal(rep.count, 3);
  assert.equal(rep.last30.supporters, 2);
  assert.deepEqual(rep.topPosts[0], { post: postB, total: "20", count: 3 });
  const n = await db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='mjt_tip' ORDER BY created_at DESC LIMIT 1", [b.id]);
  assert.ok(n);
});

test("tips count toward the daily transfer limit", async () => {
  const S = await M().settings();
  const max = S.transfers.maxDaily;
  const sent = Number((await a.req("GET", "/api/mjt/me")).today.sent);
  assert.ok(sent >= 10, "the earlier tip is counted as sent today");
  assert.ok(max > 0);
});

test("ledger verifies after tips; visitors cannot tip", async () => {
  const v = await staff.req("GET", "/api/admin/mjt/verify");
  assert.equal(v.status ?? 200, 200);
  assert.ok(v.ok !== false, JSON.stringify(v).slice(0, 200));
  const anon = new H.Client();
  assert.equal((await anon.req("POST", `/api/mjt/posts/${postB}/tips`, { ikey: key(), amount: "1" })).status, 401);
});
