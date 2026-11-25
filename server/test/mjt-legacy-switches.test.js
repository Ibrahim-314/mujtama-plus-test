/* v2.163 — admin on/off switches for the LEGACY MJT paths (services/mjt-legacy.js, mjt_settings key 'legacy', no migration).
 * Defaults all ON (no row written) · members 403 / signed-out 401 on the admin endpoints, nothing written · validation (reason ≥ 5,
 * enabled boolean, unknown path, «buy» has no switch) · each switch OFF blocks only its own path with 409 mjt_legacy_disabled and
 * ON restores it: transfers, tips (posts + rooms), mining (new session; an earlier session still claims), daily check-in,
 * points → MJT batch conversion (dry run + rollback stay), MJT for new points awards (the points award itself continues),
 * owner grant, community rewards · toggling never touches balances / ledger / sessions / check-ins / links · audit rows (mjt_audit +
 * hash-chained audit_log) with admin id and reason · env override MJT_LEGACY_<PATH>=off · economy dashboard shows each switch next to
 * its numbers · member flags in /api/mjt/me and /api/mjt/mining. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/mjt-ledger");

const DAY = 864e5, OLD = new Date(Date.now() - 40 * DAY).toISOString();
let H, admin, a, b, c, own, now = Date.now();
const db = () => H.app.ctx.db, S = () => H.app.ctx.services, M = () => S().mjt, LG = () => S().mjtLegacy;
const clear = () => H.app.ctx.rl.w.clear();
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
let seq = 0; const key = (p = "k") => `${p}${Date.now().toString(36)}_${++seq}_lg`;
async function mk(handle) {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, cl.id]);
  return cl;
}
const bal = async (u) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + u.id]))?.balance || 0);
const fund = async (u, amount) => { clear(); const r = await admin.req("POST", "/api/admin/mjt/adjust", { ikey: key("f"), handle: u.handle, amount: String(amount), reason: "رصيد اختبار المفاتيح" }); assert.equal(r.status, 200, r.error); };
const sw = async (k, enabled, reason = "اختبار مفتاح المسار") => { clear(); const r = await admin.req("PUT", "/api/admin/mjt/legacy/" + k, { enabled, reason }); assert.equal(r.status, 200, r.error); assert.equal(r.path.enabled, enabled); return r; };
const off = (r, path) => { assert.equal(r.status, 409, JSON.stringify(r)); assert.equal(r.code, "mjt_legacy_disabled"); assert.equal(r.path, path); assert.match(r.error, /متوقف مؤقتاً/); assert.match(r.messageEn, /temporarily paused/); };
/** everything a switch must never touch */
const snapshot = async () => JSON.stringify(await Promise.all(["SELECT id, balance, status, receive FROM mjt_accounts ORDER BY id", "SELECT id, kind, amount, ikey FROM mjt_tx ORDER BY id", "SELECT id, account_id, amount, balance_after FROM mjt_entries ORDER BY id",
  "SELECT * FROM mjt_mining ORDER BY id", "SELECT * FROM mjt_checkins ORDER BY user_id, day", "SELECT * FROM mjt_point_links ORDER BY id", "SELECT * FROM mjt_conversions ORDER BY id", "SELECT * FROM mjt_tips ORDER BY tx_id",
  "SELECT * FROM community_mjt_rewards ORDER BY id", "SELECT * FROM points_awards ORDER BY id"].map((q) => db().all(q))));

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false }, miningOpts: { now: () => now }, cintegrationsOpts: { jobs: false } });
  await M().ready;
  admin = await mk("lg_admin"); a = await mk("lg_a"); b = await mk("lg_b"); c = await mk("lg_c"); own = await mk("lg_own");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]); await db().run("UPDATE users SET role='member' WHERE id<>$1", [admin.id]);
  await M().dropMinAge();
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("defaults: every legacy path ON, nothing stored; members see all flags on; buy listed as not available", async () => {
  assert.equal(await db().get("SELECT value FROM mjt_settings WHERE key='legacy'"), undefined, "no row until an admin changes a switch");
  const r = await admin.req("GET", "/api/admin/mjt/legacy");
  assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.paths.map((p) => p.key), ["transfers", "tips", "mining", "checkin", "conversion", "pointRewards", "ownerGrant", "communityRewards"]);
  assert.ok(r.paths.every((p) => p.enabled && p.stored && !p.envForcedOff), "all enabled by default");
  assert.deepEqual(r.fixed.map((p) => [p.key, p.enabled, p.fixed]), [["buy", false, true]]);
  const me = await a.req("GET", "/api/mjt/me");
  assert.deepEqual(me.legacy, { transfers: true, tips: true, mining: true, checkin: true });
  assert.equal(me.tip.allowed, true);
  const mn = await a.req("GET", "/api/mjt/mining"); assert.equal(mn.enabled, true); assert.equal(mn.checkin.on, true);
  clear(); assert.equal((await a.req("POST", "/api/mjt/buy", {})).status, 501, "buy unchanged: always 501");
});

test("admin only: members 403, signed out 401, nothing written; validation", async () => {
  for (const [m, p, body] of [["GET", "/api/admin/mjt/legacy"], ["PUT", "/api/admin/mjt/legacy/mining", { enabled: false, reason: "محاولة عضو" }]]) {
    clear(); assert.equal((await a.req(m, p, body)).status, 403, `${m} ${p}`);
    clear(); assert.equal((await new H.Client().req(m, p, body)).status, 401);
  }
  assert.equal(await db().get("SELECT value FROM mjt_settings WHERE key='legacy'"), undefined);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action='legacy_switch'"), 0);
  let r = await admin.req("PUT", "/api/admin/mjt/legacy/mining", { enabled: false, reason: "قصير" }); assert.equal(r.status, 400); assert.equal(r.code, "reason_required");
  clear(); r = await admin.req("PUT", "/api/admin/mjt/legacy/mining", { enabled: false }); assert.equal(r.status, 400);
  clear(); r = await admin.req("PUT", "/api/admin/mjt/legacy/mining", { enabled: "no", reason: "سبب كافٍ" }); assert.equal(r.status, 400); assert.equal(r.code, "enabled_required");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/legacy/nope", { enabled: false, reason: "سبب كافٍ" })).status, 404);
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/legacy/buy", { enabled: true, reason: "سبب كافٍ" })).status, 404, "buy has no switch");
  assert.equal(await db().get("SELECT value FROM mjt_settings WHERE key='legacy'"), undefined, "a refused change writes nothing");
});

test("toggling every switch off and on changes no balance, ledger row, session, check-in, link or award; each change audited", async () => {
  await fund(a, 50); now = Date.now();
  clear(); assert.equal((await a.req("POST", "/api/mjt/mining/start")).started, true);
  clear(); assert.equal((await a.req("POST", "/api/mjt/checkin")).credited, true);
  const before = await snapshot(), v0 = await M().verify(), audits0 = await n("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'mjt_legacy_%'");
  for (const k of LG().KEYS) await sw(k, false, "إيقاف تجريبي " + k);
  const st = await admin.req("GET", "/api/admin/mjt/legacy"); assert.ok(st.paths.every((p) => !p.enabled));
  assert.equal(await snapshot(), before, "turning off touched nothing");
  for (const k of LG().KEYS) await sw(k, true, "إعادة تشغيل " + k);
  assert.equal(await snapshot(), before, "turning back on touched nothing");
  assert.equal((await M().verify()).ok, v0.ok);
  const rows = await db().all("SELECT actor_id, target, detail FROM mjt_audit WHERE action='legacy_switch' ORDER BY id");
  assert.equal(rows.length, LG().KEYS.length * 2);
  assert.ok(rows.every((r) => r.actor_id === admin.id), "admin id recorded");
  const d0 = JSON.parse(rows[0].detail); assert.equal(d0.before, true); assert.equal(d0.after, false); assert.match(d0.reason, /إيقاف تجريبي/);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await n("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'mjt_legacy_%'") - audits0, LG().KEYS.length * 2, "hash-chained audit log too");
  const al = await db().get("SELECT by_user, reason FROM audit_log WHERE action='mjt_legacy_disabled' AND target='transfers' ORDER BY id DESC LIMIT 1");
  assert.equal(al.by_user, admin.id); assert.match(al.reason, /إيقاف تجريبي/);
  assert.equal((await H.app.ctx.verifyAudit()).ok, true);
});

test("transfers: OFF → 409 mjt_legacy_disabled, member UI flag off, tips unaffected; ON → transfers work again", async () => {
  await fund(b, 30);
  await sw("transfers", false);
  const b0 = await bal(b), tx0 = await n("SELECT COUNT(*) n FROM mjt_tx");
  off(await b.req("POST", "/api/mjt/transfers", { to: c.handle, amount: "1", ikey: key() }), "transfers");
  assert.equal(await bal(b), b0); assert.equal(await n("SELECT COUNT(*) n FROM mjt_tx"), tx0, "nothing posted");
  const me = await b.req("GET", "/api/mjt/me");
  assert.equal(me.send.allowed, false); assert.equal(me.send.reason, "mjt_legacy_disabled"); assert.match(me.send.note, /متوقف مؤقتاً/);
  assert.equal(me.legacy.transfers, false); assert.equal(me.tip.allowed, true, "tips have their own switch");
  clear(); const p = await c.req("POST", "/api/posts", { text: "منشور لاختبار الإكرامية" }); assert.equal(p.status, 200, p.error);
  clear(); const t = await b.req("POST", `/api/mjt/posts/${p.post.id}/tips`, { ikey: key(), amount: "2" }); assert.equal(t.status, 200, t.error);
  await sw("transfers", true);
  clear(); const r = await b.req("POST", "/api/mjt/transfers", { to: c.handle, amount: "1", ikey: key() }); assert.equal(r.status, 200, r.error);
  assert.equal((await b.req("GET", "/api/mjt/me")).send.allowed, true);
});

test("tips: OFF → post and live-room tips 409; summaries readable; transfers unaffected; ON restores", async () => {
  await fund(b, 10);
  clear(); const p = await c.req("POST", "/api/posts", { text: "منشور إكرامية ثانٍ" });
  await sw("tips", false);
  off(await b.req("POST", `/api/mjt/posts/${p.post.id}/tips`, { ikey: key(), amount: "1" }), "tips");
  clear(); off(await b.req("POST", `/api/mjt/rooms/rm_any/tips`, { ikey: key(), amount: "1" }), "tips");
  clear(); assert.equal((await b.req("GET", `/api/mjt/posts/${p.post.id}/tips`)).status, 200, "reading a summary still works");
  const me = await b.req("GET", "/api/mjt/me"); assert.equal(me.tip.allowed, false); assert.equal(me.tip.reason, "mjt_legacy_disabled"); assert.equal(me.send.allowed, true);
  clear(); assert.equal((await b.req("POST", "/api/mjt/transfers", { to: c.handle, amount: "1", ikey: key() })).status, 200);
  await sw("tips", true);
  clear(); const t = await b.req("POST", `/api/mjt/posts/${p.post.id}/tips`, { ikey: key(), amount: "1" }); assert.equal(t.status, 200, t.error);
});

test("mining: OFF → no new session (409), state shows off; a session started before still claims; ON → start works", async () => {
  const t0 = Date.now(); now = t0;
  clear(); assert.equal((await b.req("POST", "/api/mjt/mining/start")).started, true);
  await sw("mining", false);
  clear(); off(await c.req("POST", "/api/mjt/mining/start"), "mining");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_mining WHERE user_id=$1", [c.id]), 0);
  const st = await b.req("GET", "/api/mjt/mining"); assert.equal(st.enabled, false); assert.ok(st.session, "the running session is kept");
  now = t0 + 24 * 3600e3 + 1000;
  const b0 = await bal(b);
  clear(); const cl = await b.req("POST", "/api/mjt/mining/claim"); assert.equal(cl.status, 200, cl.error); assert.equal(cl.claimed, "5", "an in-flight session finishes exactly as before");
  assert.equal(await bal(b) - b0, 5 * L.UNIT);
  clear(); off(await b.req("POST", "/api/mjt/mining/start"), "mining");
  await sw("mining", true);
  clear(); const s2 = await c.req("POST", "/api/mjt/mining/start"); assert.equal(s2.started, true);
  assert.equal((await c.req("GET", "/api/mjt/mining")).enabled, true);
  now = Date.now();
});

test("daily check-in: OFF → 409, nothing credited or recorded; ON → credited", async () => {
  now = Date.now() + 3 * DAY; // a fresh UTC day for everyone
  await sw("checkin", false);
  const c0 = await bal(c);
  clear(); off(await c.req("POST", "/api/mjt/checkin"), "checkin");
  assert.equal(await bal(c), c0); assert.equal(await n("SELECT COUNT(*) n FROM mjt_checkins WHERE user_id=$1 AND day=$2", [c.id, new Date(now).toISOString().slice(0, 10)]), 0);
  assert.equal((await c.req("GET", "/api/mjt/mining")).checkin.on, false);
  assert.equal((await c.req("GET", "/api/mjt/me")).legacy.checkin, false);
  await sw("checkin", true);
  clear(); const r = await c.req("POST", "/api/mjt/checkin"); assert.equal(r.credited, true); assert.equal(await bal(c) - c0, 1 * L.UNIT);
  now = Date.now();
});

test("MJT for new points awards: OFF → the points award still happens, MJT skipped (legacy_off); ON → mints again", async () => {
  clear(); await admin.req("PUT", "/api/admin/points/settings", { cooldownSec: 0, minTrust: 0, minAccountDays: 0 });
  const P = S().points;
  await sw("pointRewards", false);
  const a0 = await bal(a);
  const r1 = await P.award(a.id, "answer_accepted", "lg_q1");
  assert.equal(r1.awarded, true, r1.reason); assert.equal(r1.mjt.minted, false); assert.equal(r1.mjt.reason, "legacy_off");
  assert.equal(await n("SELECT COUNT(*) n FROM points_awards WHERE source_id='lg_q1' AND status='active'"), 1, "points continue");
  assert.equal(await bal(a), a0, "no MJT minted");
  assert.equal((await db().get("SELECT l.status FROM mjt_point_links l JOIN points_awards p ON p.id=l.award_id WHERE p.source_id='lg_q1'")).status, "skipped");
  assert.equal((await a.req("GET", "/api/mjt/config")).earn.enabled, false);
  await sw("pointRewards", true);
  const r2 = await P.award(a.id, "answer_accepted", "lg_q2"); assert.equal(r2.mjt.minted, true); assert.ok(await bal(a) > a0);
});

test("points → MJT batch conversion: OFF → apply 409, auto run skipped, dry run + rollback still work; ON → applies", async () => {
  const launch = await M().launchAt(), before = new Date(Date.parse(launch) - 2 * DAY).toISOString();
  await db().run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES('pa_lg1',$1,'wiki_edit','src_lg1',7,1,'active',$2,NULL,$3)", [c.id, before.slice(0, 10), before]);
  await sw("conversion", false);
  clear(); off(await admin.req("POST", "/api/admin/mjt/conversion"), "conversion");
  assert.deepEqual(await M().convert("system"), { applied: false, reason: "legacy_off" });
  clear(); const dr = await admin.req("GET", "/api/admin/mjt/conversion/dry-run"); assert.equal(dr.status, 200); assert.ok(dr.totals.users >= 1);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_conversions WHERE user_id=$1", [c.id]), 0);
  await sw("conversion", true);
  clear(); const ap = await admin.req("POST", "/api/admin/mjt/conversion"); assert.equal(ap.status, 200, ap.error); assert.equal(ap.applied, true);
  // a batch applied while ON can still be rolled back while OFF (reversal finishes exactly as before)
  await sw("conversion", false);
  clear(); const rb = await admin.req("POST", `/api/admin/mjt/conversion/${ap.batch.id}/rollback`, {}); assert.equal(rb.status, 200, rb.error); assert.equal(rb.rolledBack, true);
  await sw("conversion", true);
  assert.equal((await M().verify()).ok, true);
});

test("owner grant: OFF → skipped (nothing minted); ON → applied once; undo works regardless", async () => {
  await sw("ownerGrant", false);
  const tx0 = await n("SELECT COUNT(*) n FROM mjt_tx");
  assert.deepEqual(await M().ownerGrant(`25:lgkey1:@${admin.handle}`), { skipped: true, reason: "legacy_off" });
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_tx"), tx0);
  await sw("ownerGrant", true);
  const g = await M().ownerGrant(`25:lgkey1:@${admin.handle}`); assert.equal(g.replayed, false); assert.equal(g.amount, "25");
  await sw("ownerGrant", false);
  assert.equal((await M().ownerGrantUndo("lgkey1")).replayed, false, "the undo (a reversal) is never blocked");
  await sw("ownerGrant", true);
});

test("community rewards: OFF → recorded as skipped (legacy_off), nothing paid; ON → paid", async () => {
  clear(); const cid = (await own.req("POST", "/api/communities", { name: "مجتمع مفاتيح MJT", desc: "اختبار مكافآت المجتمع", rules: ["الاحترام"] })).community.id;
  clear(); await a.req("PUT", `/api/communities/${cid}/membership`);
  await fund(own, 10);
  clear(); const set = await own.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true, perPost: "1", perAnswer: "1", memberDailyCap: "5", communityDailyCap: "10" }); assert.equal(set.status, 200, set.error);
  const CI = S().cintegrations;
  await sw("communityRewards", false);
  const o0 = await bal(own), a0 = await bal(a);
  assert.equal((await CI.reward(cid, a.id, "post", "lg_ref1")).reason, "legacy_off");
  assert.deepEqual(await db().get("SELECT status, reason, amount FROM community_mjt_rewards WHERE ref_id='lg_ref1'"), { status: "skipped", reason: "legacy_off", amount: 0 });
  assert.equal(await bal(own), o0); assert.equal(await bal(a), a0);
  await sw("communityRewards", true);
  const r = await CI.reward(cid, a.id, "post", "lg_ref2"); assert.equal(r.paid, true, r.reason); assert.equal(await bal(a) - a0, 1 * L.UNIT);
});

test("env override MJT_LEGACY_<PATH>=off forces a path off (and is shown); it cannot force one on", async () => {
  const routes = []; const fake = { db: db(), rl: H.app.ctx.rl, router: { get: (p) => routes.push(p), put: (p) => routes.push(p) }, requireUser: (f) => f };
  const inst = require("../services/mjt-legacy")(fake, { env: { MJT_LEGACY_MINING: "off", MJT_LEGACY_POINT_REWARDS: "0", MJT_LEGACY_TIPS: "on" } });
  assert.equal(await inst.isOn("mining"), false); assert.equal(await inst.isOn("pointRewards"), false); assert.equal(await inst.isOn("tips"), true); assert.equal(await inst.isOn("transfers"), true);
  const st = await inst.state();
  const m = st.paths.find((p) => p.key === "mining"); assert.equal(m.enabled, false); assert.equal(m.envForcedOff, true); assert.equal(m.stored, true); assert.equal(m.envVar, "MJT_LEGACY_MINING");
  await sw("transfers", false); inst.invalidate();
  assert.equal(await inst.isOn("transfers"), false, "stored switch still read");
  await sw("transfers", true); inst.invalidate();
  assert.equal(await inst.isOn("buy"), false, "buy is never on");
});

test("economy dashboard shows each legacy switch next to its own numbers", async () => {
  await sw("checkin", false);
  clear(); const d = await admin.req("GET", "/api/admin/mjt/economy?period=month"); assert.equal(d.status, 200, d.error);
  const by = Object.fromEntries(d.legacy.switches.map((s) => [s.key, s]));
  assert.deepEqual(Object.keys(by), ["transfers", "tips", "mining", "checkin", "conversion", "pointRewards", "ownerGrant", "communityRewards", "buy"]);
  assert.equal(by.checkin.enabled, false); assert.equal(by.mining.enabled, true); assert.equal(by.buy.fixed, true); assert.equal(by.buy.enabled, false);
  assert.ok(Number(by.mining.all.in) >= 5, "mining numbers from the ledger"); assert.ok(by.checkin.all.tx >= 2);
  assert.ok(Number(by.transfers.all.in) >= 2 && Number(by.tips.all.in) >= 3);
  assert.equal(Number(by.ownerGrant.all.in), 25); assert.equal(Number(by.ownerGrant.all.out), 25);
  await sw("checkin", true);
  assert.equal((await M().verify()).ok, true);
});
