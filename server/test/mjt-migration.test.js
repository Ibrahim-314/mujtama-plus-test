/* v2.47 — MJT migration + points conversion on a copy of realistic data. SQLite + PostgreSQL (TEST_DATABASE_URL).
 * The data: the demo seed (the same seed production started from) + 160 members with ~1,900 phase 59 point awards of every
 * kind (earning kinds, positive and negative staff adjustments, reversed awards), points→Pi redemptions (pending / paid /
 * rejected), minors and suspended accounts. Checks: dry run = an independent SQL computation of the documented rule and
 * writes nothing · apply converts each member exactly as computed · every pre-existing table keeps its rows (points tables
 * byte-identical) · re-run converts nobody twice · rollback restores zero balances, points untouched · re-apply · migration
 * 061 down (MJT tables gone, everything else identical) → up → convert again gives the same totals · on PostgreSQL the
 * repository's verify-migrations --apply check passes for 061. */
const test = require("node:test"), assert = require("node:assert");
const crypto = require("node:crypto");
const { boot } = require("./helpers");
const L = require("../lib/mjt-ledger");

let H, staff;
const db = () => H.app.ctx.db, M = () => H.app.ctx.services.mjt;
const EARN = ["answer_accepted", "engaged_post", "report_confirmed", "wiki_edit", "mentoring"];
const SKIP = new Set(["search_postings", "search_vocab", /* v2.123 derived search index: dropped by 084 down, rebuilt by the background upgrade */ "community_roles", "member_roles", "community_sanctions", "community_member_stats", "community_member_events", "community_member_invites", "community_transfers", "community_channel_groups", "channel_reads", "community_pins", "community_announcements", "announcement_dismissals", "community_rules", "community_onboarding", "mod_claims", "community_appeals", "mod_macros", "mod_prefs", "content_fingerprints", /* tables of later migrations (062+, 063, 064, 065) */ "schema_migrations", "audit_log", "sessions", "rate_events", "jobs", "scheduler_runs", "client_errors", "rum_events", "metrics"]);
async function tables() {
  return db().dialect === "postgres"
    ? (await db().all("SELECT table_name n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).map((r) => r.n)
    : (await db().all("SELECT name n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.n);
}
/** row counts of every non-MJT table + a content hash of the points tables and users */
async function snapshot() {
  const out = {};
  for (const t of await tables()) {
    if (t.startsWith("mjt_") || SKIP.has(t)) continue;
    out[t] = Number((await db().get(`SELECT COUNT(*) n FROM "${t}"`)).n);
  }
  for (const t of ["points_awards", "points_balances", "points_redemptions", "points_settings", "users"]) out["#" + t] = crypto.createHash("sha256").update(JSON.stringify(await db().all(`SELECT * FROM ${t} ORDER BY 1`))).digest("hex");
  return out;
}
/** the documented rule, computed independently in SQL + JS: per user max(0, earned + negative adjustments − redeemed) */
async function expected(cutoff) {
  const rows = await db().all(`SELECT user_id,
      COALESCE(SUM(CASE WHEN kind IN ('${EARN.join("','")}') AND points > 0 THEN points ELSE 0 END),0) earned,
      COALESCE(SUM(CASE WHEN kind='adjustment' AND points < 0 THEN points ELSE 0 END),0) pen,
      COALESCE(SUM(CASE WHEN kind IN ('${EARN.join("','")}') AND points > 0 THEN 1 WHEN kind='adjustment' AND points < 0 THEN 1 ELSE 0 END),0) n
    FROM points_awards WHERE status='active' AND created_at < $1 GROUP BY user_id`, [cutoff]);
  const out = new Map();
  for (const r of rows) {
    if (!Number(r.n)) continue;
    const red = Number((await db().get("SELECT COALESCE(SUM(points),0) s FROM points_redemptions WHERE user_id=$1 AND status IN ('pending','paid')", [r.user_id])).s);
    out.set(r.user_id, Math.max(0, Number(r.earned) + Number(r.pen) - red));
  }
  return out;
}
const sum = (m) => [...m.values()].reduce((s, x) => s + x, 0);

test.before(async () => {
  H = await boot({ seedDemo: true, mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await M().ready;
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "الإدارة", handle: "mg_staff", password: "secret123" }); staff = c; staff.id = r.user.id;
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  // 160 members with a realistic spread of contribution points, all before the MJT launch
  let x = 1;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const launch = Date.parse(await M().launchAt());
  for (let i = 0; i < 160; i++) {
    const uid = "mg_u" + i, at = new Date(launch - (60 + i) * 864e5).toISOString();
    await db().run("INSERT INTO users(id,handle,name,password_hash,created_at,status,role) VALUES($1,$2,$3,'x',$4,$5,'user')", [uid, "mg_u" + i, "عضو " + i, at, i % 37 === 0 ? "suspended" : "active"]).catch(async () => {
      await db().run("INSERT INTO users(id,handle,name,created_at,status) VALUES($1,$2,$3,$4,$5)", [uid, "mg_u" + i, "عضو " + i, at, i % 37 === 0 ? "suspended" : "active"]);
    });
    const n = Math.floor(rnd() * 24);
    for (let j = 0; j < n; j++) {
      const roll = rnd(), kind = roll < 0.06 ? "adjustment" : EARN[Math.floor(rnd() * EARN.length)];
      const pts = kind === "adjustment" ? (rnd() < 0.5 ? -Math.ceil(rnd() * 30) : Math.ceil(rnd() * 200)) : [15, 10, 5, 4, 20][EARN.indexOf(kind)];
      const when = new Date(launch - Math.floor(rnd() * 50 + 1) * 864e5 - j * 1000).toISOString();
      await db().run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9)",
        [`mg_a${i}_${j}`, uid, kind, `src_${i}_${j}`, pts, kind === "adjustment" || i % 23 === 0 ? 0 : 1, rnd() < 0.07 ? "reversed" : "active", when.slice(0, 10), when]);
    }
    if (i % 11 === 0) await db().run("INSERT INTO points_redemptions(id,user_id,points,amount,rate,month,status,created_at) VALUES($1,$2,$3,$4,100,'2026-09',$5,$6)", ["mg_r" + i, uid, 10 + i, (10 + i) * 100000, ["pending", "paid", "rejected"][i % 3], at]);
    await H.app.ctx.services.points.recompute(uid);
  }
});
test.after(() => H.app.close());

test("realistic copy: dry run = independent computation, apply, untouched data, idempotent, rollback, re-apply", async () => {
  const cutoff = await M().launchAt();
  const exp = await expected(cutoff);
  assert.ok(exp.size > 100, "realistic volume: " + exp.size);
  const snap0 = await snapshot();
  const dry = await M().dryRun();
  assert.equal(dry.totals.users, exp.size); assert.equal(dry.totals.pts, sum(exp)); assert.equal(dry.totals.amount, L.format(sum(exp) * L.UNIT));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_tx")).n), 0, "dry run writes nothing");
  assert.deepEqual(await snapshot(), snap0);
  const ap = await M().convert(staff.id); assert.equal(ap.applied, true); assert.equal(ap.batch.users, exp.size); assert.equal(ap.batch.amount, L.format(sum(exp) * L.UNIT));
  for (const [uid, pts] of exp) assert.equal(Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0), pts * L.UNIT, uid);
  assert.deepEqual(await snapshot(), snap0, "no pre-existing table changed");
  const v = await M().verify(); assert.equal(v.ok, true, v.problems.join()); assert.equal(v.supply.circulating, sum(exp) * L.UNIT);
  assert.equal((await M().convert("system")).applied, false, "re-run converts nobody twice");
  const rb = await M().rollback(ap.batch.id, staff.id); assert.equal(rb.rolledBack, true); assert.equal(rb.users, exp.size);
  assert.equal(Number((await db().get("SELECT COALESCE(SUM(balance),0) s FROM mjt_accounts WHERE kind='user'")).s), 0);
  assert.deepEqual(await snapshot(), snap0);
  assert.equal((await M().verify()).ok, true);
  const again = await M().convert(staff.id); assert.equal(again.batch.amount, ap.batch.amount);
  assert.equal((await M().verify()).ok, true);
});

test("migration 061 down → everything else identical → up → same conversion; verify-migrations --apply (PG)", async () => {
  const mig = require("../lib/migrations");
  const snap0 = await snapshot();
  const total0 = (await M().supply()).circulating;
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '061_mjt' ORDER BY id")).map((r) => r.id); // 062+ roll back first
  // 062+ roll back first (they drop their own tables); the baseline for 061 is the state right before 061 goes down
  assert.deepEqual(await mig.down(db(), later.length), [...later].reverse());
  const before061 = await snapshot();
  assert.deepEqual(await mig.down(db(), 1), ["061_mjt"]);
  assert.ok(!(await tables()).some((t) => t.startsWith("mjt_")));
  const without = (s) => Object.fromEntries(Object.entries(s).filter(([t]) => !t.startsWith("mjt_") && t !== "schema_migrations"));
  assert.deepEqual(without(await snapshot()), without(before061), "rolling back 061 touches nothing else");
  if (db().dialect === "postgres") {
    const logs = []; const r = await require("../scripts/verify-migrations").applyCheck(db(), (m) => logs.push(m));
    assert.equal(r.ok, true, (r.problems || []).join("\n")); assert.ok(r.ran.includes("061_mjt"));
  } else assert.deepEqual(await mig.up(db()), ["061_mjt", ...later]);
  await M().ledger.ensureSystem();
  await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('launch',$1,'system',$2)", [await M().launchAt(), new Date().toISOString()]);
  const re = await M().convert("system"); assert.equal(re.applied, true);
  assert.equal((await M().supply()).circulating, total0, "same totals after down/up");
  assert.deepEqual(await snapshot(), snap0);
  assert.equal((await M().verify()).ok, true);
});
