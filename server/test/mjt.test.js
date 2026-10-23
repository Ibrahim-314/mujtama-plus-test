/* v2.47 — «مجتمع كوين» (MJT) stage 1: in-app double-entry ledger (not on any chain).
 * Migration 061 (reversible, additive, data map) · points → MJT conversion (rate 1:1, dry run writes nothing, points tables
 * untouched, idempotent re-run, rollback blocked when converted MJT was spent, rollback + re-apply) · rewards from new points
 * awards (daily cap, rewards off, duplicate hook, reconcile, clawback on removal never below 0) · points → Pi redemption
 * retired while MJT is linked · transfers (idempotency key + replay + conflict, decimal-string amounts, limits, minors,
 * blocks, linked accounts, receive off, frozen, too-new accounts, transfers off) · staff adjustments (admin only, reason,
 * no negative balance, audited, notified) · freeze · Pi → MJT purchase 501 · public supply · admin overview + verify ·
 * spend/refund primitives. SQLite + PostgreSQL (TEST_DATABASE_URL). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/mjt-ledger");

let H, staff, mod, a, b, c, kid, newbie;
const DAY = 864e5;
const db = () => H.app.ctx.db, M = () => H.app.ctx.services.mjt, P = () => H.app.ctx.services.points;
const OLD = new Date(Date.now() - 40 * DAY).toISOString();
let seq = 0; const key = () => `k${Date.now().toString(36)}_${++seq}_test`;
async function mk(handle, old = true) {
  H.app.ctx.rl.w.clear();
  const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  if (old) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, cl.id]);
  return cl;
}
/** a points award written straight into points_awards (as phase 59 would have), `ago` days in the past */
let aw = 0;
async function award(uid, kind, pts, { ago = 5, status = "active" } = {}) {
  const id = "pa_t" + (++aw), at = new Date(Date.now() - ago * DAY).toISOString();
  await db().run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,NULL,$8)", [id, uid, kind, "src_" + id, pts, status, at.slice(0, 10), at]);
  return id;
}
const bal = async (u) => (await u.req("GET", "/api/mjt/me")).balance.mjt;
const pointsSnapshot = async () => JSON.stringify([await db().all("SELECT * FROM points_awards ORDER BY id"), await db().all("SELECT * FROM points_balances ORDER BY user_id"), await db().all("SELECT * FROM points_redemptions ORDER BY id")]);

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await M().ready;
  staff = await mk("mj_staff"); mod = await mk("mj_mod"); a = await mk("mj_a"); b = await mk("mj_b"); c = await mk("mj_c"); kid = await mk("mj_kid"); newbie = await mk("mj_new", false);
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]); await db().run("UPDATE users SET role='moderator' WHERE id=$1", [mod.id]);
  await H.app.ctx.services.mjt.dropMinAge(); assert.equal((await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { minAccountDays: 7 } })).status, 200); // v2.74.2 default 0; tests cover a configured wait
  const real = H.app.ctx.services.minors.minorIds; H.app.ctx.services.minors.minorIds = async (ids) => { const s = await real(ids); if (ids.includes(kid.id)) s.add(kid.id); return s; };
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("ledger helpers: exact decimal parsing and formatting, no floats", () => {
  assert.equal(L.parseAmount("1"), 10_000_000); assert.equal(L.parseAmount("0.0000001"), 1); assert.equal(L.parseAmount("12.5"), 125_000_000);
  assert.equal(L.parseAmount("١٢٫٥"), 125_000_000); assert.equal(L.parseAmount(3), 30_000_000); assert.equal(L.parseAmount("-2", { allowNegative: true }), -20_000_000);
  for (const bad of ["0", "-1", "1.00000001", "abc", "1e3", "", " ", "99999999999", "1,000", null, undefined, {}, 0.1 + 0.2, 1e-7, NaN, Infinity]) assert.throws(() => L.parseAmount(bad), (e) => e.code === "bad_amount", String(bad));
  assert.equal(L.format(1), "0.0000001"); assert.equal(L.format(125_000_000), "12.5"); assert.equal(L.format(-20_000_000), "-2"); assert.equal(L.format(0), "0");
  assert.ok(L.MAX_SUPPLY < Number.MAX_SAFE_INTEGER && L.MAX_LINE < Number.MAX_SAFE_INTEGER);
  assert.ok(L.lockOrder("user:z", "sys:mint") < 0 && L.lockOrder("sys:burn", "sys:mint") < 0 && L.lockOrder("user:a", "user:b") < 0);
});

test("migration 061: reversible, additive, data map; system accounts exist", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '061_mjt' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "061_mjt"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mjt_accounts"));
  assert.ok(await db().get("SELECT 1 x FROM schema_migrations WHERE id='060_proreviews'"), "older migrations untouched");
  assert.deepEqual(await mig.up(db()), ["061_mjt", ...later]);
  await M().ledger.ensureSystem(); await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('launch',$1,'system',$2)", [await M().launchAt(), new Date().toISOString()]);
  const s = require("../scripts/verify-migrations").staticCheck(); // 053/054/059 are known, older false positives (table names containing "updates")
  assert.deepEqual(s.problems.filter((x) => x.startsWith("061_")), []); assert.ok(s.seen.some((x) => x.file === "061_mjt.js" && x.statements >= 20));
  for (const m of require("../lib/compliance-lib").DATA_MAP.filter((x) => x.t.startsWith("mjt_"))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [a.id]);
  const sys = (await db().all("SELECT id, allow_negative FROM mjt_accounts WHERE kind='system' ORDER BY id")).map((r) => `${r.id}:${r.allow_negative}`);
  assert.deepEqual(sys, ["sys:burn:0", "sys:mint:1", "sys:treasury:0"]);
  // the CHECK constraint is a second line of defence under the conditional updates
  await assert.rejects(() => db().run("UPDATE mjt_accounts SET balance=-1 WHERE id='sys:burn'"));
  await assert.rejects(() => db().run("INSERT INTO mjt_tx(id,ikey,kind,amount,req_hash,created_at) VALUES('x1','dup','reward',1,'h',$1),('x2','dup','reward',1,'h',$1)", [new Date().toISOString()]));
});

test("conversion: dry run (nothing written) → apply (rate 1:1, points untouched) → idempotent re-run", async () => {
  // the launch time is now; everything below happened before it
  await award(a.id, "answer_accepted", 15); await award(a.id, "mentoring", 20); await award(a.id, "adjustment", 1000); await award(a.id, "adjustment", -5);
  await award(a.id, "engaged_post", 10, { status: "reversed" });
  await award(b.id, "report_confirmed", 5); await award(b.id, "wiki_edit", 4); await award(b.id, "report_confirmed", 1);
  await db().run("INSERT INTO points_redemptions(id,user_id,points,amount,rate,month,status,created_at) VALUES('pr_t1',$1,4,400000,100,'2026-09','pending',$2)", [b.id, OLD]);
  await award(c.id, "adjustment", 300); // only a positive staff adjustment → nothing to convert
  await award(kid.id, "report_confirmed", 5);
  const launch = await M().launchAt(); // fixed at first boot, after these awards
  assert.ok(launch > OLD);
  const before = await pointsSnapshot();
  const dry = await staff.req("GET", "/api/admin/mjt/conversion/dry-run"); assert.equal(dry.status, 200, dry.error);
  assert.equal(dry.dryRun, true); assert.equal(dry.totals.users, 3); assert.equal(dry.totals.pts, 30 + 6 + 5); assert.equal(dry.totals.amount, "41"); assert.equal(dry.totals.excludedPts, 1300); assert.equal(dry.totals.redeemedPts, 4);
  const ra = dry.users.find((u) => u.handle === "mj_a"); assert.deepEqual([ra.earned, ra.penalties, ra.excluded, ra.pts, ra.mjt], [35, -5, 1000, 30, "30"]);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_tx")).n), 0, "dry run writes no transaction");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_point_links")).n), 0);
  assert.equal((await a.req("GET", "/api/admin/mjt/conversion/dry-run")).status, 403);
  const ap = await staff.req("POST", "/api/admin/mjt/conversion", {}); assert.equal(ap.status, 200, ap.error);
  assert.equal(ap.applied, true); assert.equal(ap.batch.users, 3); assert.equal(ap.batch.amount, "41"); assert.equal(ap.batch.rate, "1");
  assert.equal(await bal(a), "30"); assert.equal(await bal(b), "6"); assert.equal(await bal(kid), "5"); assert.equal(await bal(c), "0");
  assert.equal(await pointsSnapshot(), before, "points tables are never written");
  const me = await a.req("GET", "/api/mjt/me"); assert.deepEqual(me.conversion && [me.conversion.pts, me.conversion.mjt], [30, "30"]); assert.equal(me.verified, true);
  const h = await a.req("GET", "/api/mjt/history"); assert.equal(h.items[0].kind, "conversion"); assert.equal(h.items[0].label, "تحويل نقاط المساهمة"); assert.equal(h.items[0].amount, "30");
  // re-run: nobody twice
  assert.deepEqual(await M().convert("system"), { applied: false, reason: "nothing_to_convert" });
  assert.equal((await staff.req("POST", "/api/admin/mjt/conversion", {})).applied, false);
  assert.equal(await bal(a), "30");
  const v = await staff.req("GET", "/api/admin/mjt/verify"); assert.equal(v.ok, true, v.problems?.join());
  assert.equal(v.supply.minted, 41 * L.UNIT);
  const sup = await new H.Client().req("GET", "/api/mjt/supply"); assert.equal(sup.circulating, "41"); assert.equal(sup.conversion.users, 3); assert.equal(sup.conversion.mjt, "41"); assert.equal(sup.token.symbol, "MJT");
});

test("rollback: blocked while converted MJT is spent; dry run; then all-or-nothing reversal and re-apply", async () => {
  const batch = (await db().get("SELECT id FROM mjt_conversion_batches WHERE status='applied'")).id;
  const sp = await M().spend(a.id, 25 * L.UNIT, { ikey: "rb_spend_1", refId: "test" });
  const dr = await staff.req("POST", `/api/admin/mjt/conversion/${batch}/rollback`, { dryRun: true }); assert.equal(dr.possible, false); assert.equal(dr.blocked, 1); assert.equal(dr.blockedUsers[0].handle, "mj_a");
  const rb = await staff.req("POST", `/api/admin/mjt/conversion/${batch}/rollback`, {}); assert.equal(rb.status, 409); assert.equal(rb.code, "rollback_blocked"); assert.equal(rb.blocked, 1);
  assert.equal(await bal(a), "5"); assert.equal(await bal(b), "6", "a blocked rollback changes nothing");
  await M().refund(sp.tx.id);
  assert.equal((await M().refund(sp.tx.id)).replayed, true, "refund twice = once");
  assert.equal(await bal(a), "30");
  const before = await pointsSnapshot();
  const ok = await staff.req("POST", `/api/admin/mjt/conversion/${batch}/rollback`, {}); assert.equal(ok.status, 200, ok.error); assert.equal(ok.rolledBack, true); assert.equal(ok.users, 3);
  for (const u of [a, b, kid]) assert.equal(await bal(u), "0");
  assert.equal(await pointsSnapshot(), before);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_point_links WHERE batch_id=$1 AND status<>'rolled_back'", [batch])).n), 0);
  assert.equal((await staff.req("POST", `/api/admin/mjt/conversion/${batch}/rollback`, {})).code, "already_rolled_back");
  assert.equal((await M().settings()).conversion.auto, false, "no automatic re-conversion after a rollback");
  assert.equal((await M().verify()).ok, true);
  // re-apply: a new batch converts the same awards again, exactly once
  const again = await staff.req("POST", "/api/admin/mjt/conversion", {}); assert.equal(again.applied, true); assert.notEqual(again.batch.id, batch); assert.equal(again.batch.amount, "41");
  assert.equal(await bal(a), "30"); assert.equal((await M().settings()).conversion.auto, true);
  assert.equal((await M().convert()).applied, false);
  const s = await M().supply(); assert.equal(s.circulating, 41 * L.UNIT); assert.equal((await M().verify()).ok, true);
});

test("rewards: new points awards mint MJT once, capped per day; rewards off; reconcile; clawback never below zero", async () => {
  await staff.req("PUT", "/api/admin/points/settings", { cooldownSec: 0, minTrust: 0, minAccountDays: 0 });
  assert.equal((await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { dailyCap: "20" } })).settings.rewards.dailyCap, "20");
  const r1 = await P().award(b.id, "answer_accepted", "q_mj1"); assert.equal(r1.awarded, true, r1.reason); assert.equal(r1.mjt.minted, true);
  assert.equal(await bal(b), "21"); // 6 converted + 15
  const r2 = await P().award(b.id, "answer_accepted", "q_mj2"); assert.equal(r2.mjt.minted, true); assert.equal(await bal(b), "26", "capped to the 5 MJT left today");
  const r3 = await P().award(b.id, "report_confirmed", "q_mj3"); assert.equal(r3.awarded, true); assert.equal(r3.mjt.reason, "daily_cap"); assert.equal(await bal(b), "26");
  assert.equal((await b.req("GET", "/api/mjt/me")).today.earned, "20");
  // the hook twice → once
  const aw2 = await db().get("SELECT * FROM points_awards WHERE source_id='q_mj2'");
  assert.equal((await M().onAward(aw2)).reason, "duplicate");
  // rewards off → skipped (and never paid later)
  await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { enabled: false, dailyCap: "150" } });
  const r4 = await P().award(a.id, "wiki_edit", "w_mj4"); assert.equal(r4.mjt.reason, "rewards_off");
  await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { enabled: true } });
  assert.equal((await M().reconcile()).minted, 0);
  // a missed hook is repaired by the reconcile job
  const lost = await award(a.id, "mentoring", 20, { ago: -0.0001 }); await db().run("UPDATE points_awards SET created_at=$1 WHERE id=$2", [new Date().toISOString(), lost]);
  const rc = await M().reconcile(); assert.equal(rc.minted, 1); assert.equal(await bal(a), "50");
  assert.equal((await M().reconcile()).minted, 0);
  // removal → clawback (burn) up to the balance, never below 0
  await P().reverseSource("q_mj1", "content_removed");
  assert.equal(await bal(b), "11");
  await M().spend(b.id, 10 * L.UNIT, { ikey: "claw_spend" }); // b keeps 1
  await P().reverseSource("q_mj2", "content_removed");
  assert.equal(await bal(b), "0"); // wanted 5, only 1 left
  assert.ok(await db().get("SELECT 1 x FROM mjt_audit WHERE action='clawback_shortfall' AND target=$1", [b.id]));
  const hb = await b.req("GET", "/api/mjt/history"); assert.ok(hb.items.some((i) => i.kind === "clawback" && i.label.includes("محذوف")));
  assert.equal((await M().verify()).ok, true);
});

test("points → Pi redemption is retired while MJT is linked", async () => {
  const cfg = await a.req("GET", "/api/points/config"); assert.equal(cfg.redemption.available, false); assert.equal(cfg.redemption.reason, "mjt"); assert.match(cfg.redemption.note, /مجتمع كوين/);
  const r = await a.req("POST", "/api/points/redeem", { points: 10 }); assert.equal(r.status, 409); assert.equal(r.code, "redemption_retired");
});

test("transfers: idempotency key, decimal strings, replay + conflict, history, notification", async () => {
  await M().spend(a.id, 1, { ikey: "warm" }).catch(() => { }); // a holds 50 − 0.0000001
  let r = await a.req("POST", "/api/mjt/transfers", { to: "mj_c", amount: "5" }); assert.equal(r.code, "ikey_required");
  for (const amount of ["0", "-3", "1.12345678", "abc", 0.1 + 0.2, "1e2"]) { r = await a.req("POST", "/api/mjt/transfers", { to: "mj_c", amount, ikey: key() }); assert.equal(r.code, "bad_amount", String(amount)); }
  const k = key();
  r = await a.req("POST", "/api/mjt/transfers", { to: "@MJ_C", amount: "12.5", note: "شكراً على المساعدة", ikey: k }); assert.equal(r.status, 200, r.error);
  assert.equal(r.replayed, false); assert.equal(r.transfer.amount, "12.5"); assert.equal(r.transfer.to.handle, "mj_c");
  assert.equal(await bal(c), "12.5");
  const again = await a.req("POST", "/api/mjt/transfers", { to: "mj_c", amount: "12.5", ikey: k }); assert.equal(again.status, 200); assert.equal(again.replayed, true); assert.equal(again.transfer.id, r.transfer.id);
  assert.equal(await bal(c), "12.5", "a replay moves nothing");
  assert.equal((await a.req("POST", "/api/mjt/transfers", { to: "mj_c", amount: "13", ikey: k })).code, "idempotency_conflict");
  assert.equal((await a.req("POST", "/api/mjt/transfers", { to: "mj_b", amount: "12.5", ikey: k })).code, "idempotency_conflict");
  const hc = await c.req("GET", "/api/mjt/history"); assert.equal(hc.items[0].label, "تحويل مُستلَم"); assert.equal(hc.items[0].with.handle, "mj_a"); assert.equal(hc.items[0].note, "شكراً على المساعدة");
  const ha = await a.req("GET", "/api/mjt/history"); assert.equal(ha.items[0].label, "تحويل مُرسَل"); assert.equal(ha.items[0].amount, "-12.5");
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='mjt_received'", [c.id]));
  // keyset pagination
  const p1 = await a.req("GET", "/api/mjt/history?limit=1"); assert.equal(p1.items.length, 1); assert.ok(p1.next);
  const p2 = await a.req("GET", "/api/mjt/history?limit=1&cursor=" + p1.next); assert.notEqual(p2.items[0].id, p1.items[0].id);
});

test("transfers: limits and safety rules", async () => {
  const send = (u, to, amount) => u.req("POST", "/api/mjt/transfers", { to, amount, ikey: key() });
  assert.equal((await send(a, "mj_c", "1000")).code, "transfer_max");
  assert.equal((await send(c, "mj_a", "100")).code, "insufficient_balance");
  assert.equal((await send(a, "mj_a", "1")).code, "self_transfer");
  assert.equal((await send(a, "nobody_here", "1")).status, 404);
  assert.equal((await send(a, "mj_kid", "1")).code, "minor_restricted");
  assert.equal((await send(kid, "mj_a", "1")).code, "minor_restricted");
  assert.equal((await send(newbie, "mj_a", "1")).code, "account_too_new");
  assert.equal((await newbie.req("GET", "/api/mjt/me")).send.reason, "account_too_new");
  await db().run("INSERT INTO user_blocks(owner,target,created_at) VALUES($1,$2,$3)", [c.id, a.id, new Date().toISOString()]).catch(async () => {
    const u = await db().get("SELECT prefs FROM users WHERE id=$1", [c.id]); await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify({ ...(u.prefs || {}), blocked: [a.id] }), c.id]);
  });
  assert.equal((await send(a, "mj_c", "1")).code, "blocked");
  await db().run("DELETE FROM user_blocks WHERE owner=$1", [c.id]).catch(() => { });
  { const u = await db().get("SELECT prefs FROM users WHERE id=$1", [c.id]); const p = { ...(u.prefs || {}) }; delete p.blocked; await db().run("UPDATE users SET prefs=$1 WHERE id=$2", [JSON.stringify(p), c.id]); }
  assert.equal((await c.req("PUT", "/api/mjt/receive", { receive: false })).receive, false);
  assert.equal((await send(a, "mj_c", "1")).code, "recipient_off");
  await c.req("PUT", "/api/mjt/receive", { receive: true });
  const I = H.app.ctx.services.integrity, realLinked = I.linkedAccounts; I.linkedAccounts = async (u) => new Map(u === a.id ? [[c.id, "device"]] : []);
  assert.equal((await send(a, "mj_c", "1")).code, "linked_accounts"); I.linkedAccounts = realLinked;
  // frozen wallet: cannot send, still receives
  assert.equal((await mod.req("POST", "/api/admin/mjt/accounts/mj_a/freeze", { frozen: true, reason: "مراجعة نشاط" })).status, 403, "admins only");
  assert.equal((await staff.req("POST", "/api/admin/mjt/accounts/mj_a/freeze", { frozen: true })).status, 400, "reason required");
  assert.equal((await staff.req("POST", "/api/admin/mjt/accounts/mj_a/freeze", { frozen: true, reason: "مراجعة نشاط" })).frozen, true);
  assert.equal((await send(a, "mj_c", "1")).code, "account_frozen");
  await assert.rejects(() => M().spend(a.id, 1, { ikey: "frozen_spend" }), (e) => e.code === "account_frozen");
  assert.equal((await send(c, "mj_a", "0.5")).status, 200, "a frozen wallet still receives");
  await staff.req("POST", "/api/admin/mjt/accounts/mj_a/freeze", { frozen: false, reason: "انتهت المراجعة" });
  // daily + hourly limits
  await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { maxDaily: "20", maxSingle: "10", maxPerHour: 2 } });
  assert.equal((await send(a, "mj_c", "6")).status, 200); // 12.5 already today
  assert.equal((await send(a, "mj_c", "2")).code, "daily_limit");
  await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { maxDaily: "2000", maxSingle: "500" } });
  assert.equal((await send(a, "mj_c", "1")).code, "hourly_limit");
  await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { maxPerHour: 10, enabled: false } });
  assert.equal((await send(a, "mj_c", "1")).code, "transfers_off");
  assert.equal((await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { maxSingle: "3000", maxDaily: "2000" } })).status, 400);
  await staff.req("PUT", "/api/admin/mjt/settings", { transfers: { enabled: true } });
  assert.equal((await M().verify()).ok, true);
});

test("staff adjustments: admin only, reason, no negative balance, idempotent, audited + notified", async () => {
  const adj = (u, body) => u.req("POST", "/api/admin/mjt/adjust", { ikey: key(), ...body });
  assert.equal((await adj(mod, { handle: "mj_c", amount: "5", reason: "تعويض خطأ" })).status, 403);
  assert.equal((await adj(staff, { handle: "mj_c", amount: "5" })).status, 400);
  assert.equal((await adj(staff, { handle: "mj_c", amount: "20000", reason: "تعويض خطأ" })).code, "adjust_max");
  const cb = Number((await c.req("GET", "/api/mjt/me")).balance.units);
  const k = key();
  const r = await staff.req("POST", "/api/admin/mjt/adjust", { ikey: k, handle: "mj_c", amount: "5", reason: "تعويض عن خطأ تقني" }); assert.equal(r.status, 200, r.error);
  assert.equal(Number(r.balance.units), cb + 5 * L.UNIT);
  assert.equal((await staff.req("POST", "/api/admin/mjt/adjust", { ikey: k, handle: "mj_c", amount: "5", reason: "تعويض عن خطأ تقني" })).replayed, true);
  assert.equal(Number((await c.req("GET", "/api/mjt/me")).balance.units), cb + 5 * L.UNIT);
  assert.equal((await adj(staff, { handle: "mj_c", amount: "-100000", reason: "تصحيح رصيد" })).code, "adjust_max");
  assert.equal((await adj(staff, { handle: "mj_c", amount: "-9999", reason: "تصحيح رصيد" })).code, "insufficient_balance");
  const neg = await adj(staff, { handle: "mj_c", amount: "-5", reason: "تصحيح رصيد" }); assert.equal(neg.status, 200); assert.equal(Number(neg.balance.units), cb);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='mjt_adjusted' AND target=$1", [c.id]));
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='mjt_adjusted'", [c.id]));
  const hc = await c.req("GET", "/api/mjt/history"); assert.equal(hc.items[0].label, "تعديل من الإدارة"); assert.equal(hc.items[0].note, "تصحيح رصيد");
  assert.equal((await M().verify()).ok, true);
});

test("Pi → MJT purchase answers 501 not_configured; config, supply, admin overview", async () => {
  const r = await a.req("POST", "/api/mjt/buy", { amount: "10" }); assert.equal(r.status, 501); assert.equal(r.code, "not_configured"); assert.match(r.error, /Pi/);
  assert.equal((await new H.Client().req("POST", "/api/mjt/buy", {})).status, 401);
  const cfg = await new H.Client().req("GET", "/api/mjt/config"); assert.equal(cfg.buy.available, false); assert.equal(cfg.buy.reason, "pi_off"); assert.equal(cfg.rate.pointsPerMjt, 1);
  assert.match(cfg.token.stageNote, /ليس عملة على أي بلوكشين/); assert.equal(cfg.earn.kinds.length, 5);
  assert.equal((await new H.Client().req("GET", "/api/mjt/me")).status, 401);
  const o = await mod.req("GET", "/api/admin/mjt"); assert.equal(o.status, 200); assert.equal(o.verify.ok, true); assert.ok(o.batches.length >= 2); assert.ok(o.recent.length > 0);
  assert.equal((await a.req("GET", "/api/admin/mjt")).status, 403);
  assert.equal((await mod.req("PUT", "/api/admin/mjt/settings", { rewards: { enabled: false } })).status, 403);
});

test("spend / refund primitives: no overspend, idempotent", async () => {
  await M().spend(c.id, 1 * L.UNIT, { ikey: "sp_once" });
  const again = await M().spend(c.id, 1 * L.UNIT, { ikey: "sp_once" }); assert.equal(again.replayed, true);
  await assert.rejects(() => M().spend(c.id, 1 * L.UNIT, { ikey: "sp_once", refId: "other" }), (e) => e.code === "idempotency_conflict");
  await assert.rejects(() => M().spend(c.id, 10_000_000 * L.UNIT, { ikey: "sp_big" }), (e) => e.code === "insufficient_balance");
  assert.equal((await M().verify()).ok, true);
  const s = await M().supply(); assert.equal(s.circulating, s.users + s.treasury);
});
