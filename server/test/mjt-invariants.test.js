/* v2.47 — MJT ledger invariants under random operation sequences + concurrency. SQLite + PostgreSQL (TEST_DATABASE_URL).
 * Property test (seeded, reproducible: MJT_SEEDS="1,2,3"): random mints (staff +), burns (staff −), transfers, spends,
 * refunds, rewards from new points awards, clawbacks and REPLAYS of earlier operations (same idempotency key), with amounts
 * deliberately above the balance half of the time. After every operation each balance equals an independent JS model; every
 * 25 operations and at the end verify() re-derives everything from the entries: Σ all balances = 0, every transaction sums
 * to 0, no negative balance, cached = derived, supply = minted − burned = Σ users + treasury.
 * Concurrency: parallel spends never overspend; parallel replays of one transfer move money once; opposite transfers in
 * parallel do not deadlock and conserve the total; parallel conversions apply once; one award rewarded once under parallel
 * hooks; parallel rewards respect the daily cap exactly. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/mjt-ledger");
const U = L.UNIT;

let H, staff; const people = [];
const db = () => H.app.ctx.db, M = () => H.app.ctx.services.mjt;
const OLD = new Date(Date.now() - 40 * 864e5).toISOString();
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [OLD, c.id]);
  return c;
}
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const balOf = async (uid) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0);
let awardN = 0;
async function newAward(uid, pts) {
  const id = "pa_inv" + (++awardN), at = new Date().toISOString();
  await db().run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES($1,$2,'answer_accepted',$3,$4,1,'active',$5,NULL,$6)", [id, uid, "src_" + id, pts, at.slice(0, 10), at]);
  return db().get("SELECT * FROM points_awards WHERE id=$1", [id]);
}

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  await M().ready;
  staff = await mk("inv_staff"); await db().run("UPDATE users SET role='admin' WHERE id=$1", [staff.id]);
  for (let i = 0; i < 6; i++) people.push(await mk("inv_u" + i));
  await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { dailyCap: "100000" }, transfers: { maxSingle: "1000000", maxDaily: "10000000", maxPerHour: 1000, minAccountDays: 0 } });
});
test.after(() => H.app.close());

test("property: random operation sequences keep every invariant", async () => {
  const seeds = (process.env.MJT_SEEDS || "7,20261017,99").split(",").map(Number);
  const OPS = +(process.env.MJT_OPS || 140);
  const model = new Map(people.map((p) => [p.id, 0])); let treasury = 0, minted = 0, burned = 0, run = 0;
  const done = []; // replayable operations
  for (const seed of seeds) {
    const rnd = mulberry(seed), pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const amt = (max) => Math.max(1, Math.floor(rnd() * max)); // units
    const dec = (u) => L.format(u);
    for (let i = 0; i < OPS; i++) {
      H.app.ctx.rl.w.clear();
      const op = pick(["mint", "mint", "burn", "transfer", "transfer", "transfer", "spend", "refund", "reward", "claw", "replay"]);
      const p = pick(people), q = pick(people.filter((x) => x !== p)), have = model.get(p.id);
      const k = `_seed${seed}_run${run}_op${i}`;
      const big = rnd() < 0.5; // half of the time: try to move more than the balance
      try {
        if (op === "mint") { const a = amt(50 * U); const r = await M().adjust({ id: staff.id }, { handle: p.handle, amount: dec(a), reason: "اختبار خاصية", ikey: "m" + k }); assert.equal(r.replayed, false); model.set(p.id, have + a); minted += a; done.push(() => M().adjust({ id: staff.id }, { handle: p.handle, amount: dec(a), reason: "اختبار خاصية", ikey: "m" + k })); }
        else if (op === "burn") { const a = big ? have + amt(10 * U) : amt(Math.max(2, have)); const r = await M().adjust({ id: staff.id }, { handle: p.handle, amount: "-" + dec(a), reason: "اختبار خاصية", ikey: "b" + k }).catch((e) => e);
          if (a <= have) { assert.ok(!(r instanceof Error), r.message); model.set(p.id, have - a); burned += a; } else assert.equal(r.code, "insufficient_balance"); }
        else if (op === "transfer") { const a = big ? have + amt(10 * U) : amt(Math.max(2, have)); const body = { to: q.handle, amount: dec(a), ikey: "t" + k }; const r = await M().transfer({ id: p.id }, body).catch((e) => e);
          if (a <= have) { assert.ok(!(r instanceof Error), r.message); model.set(p.id, have - a); model.set(q.id, model.get(q.id) + a); done.push(() => M().transfer({ id: p.id }, body)); } else assert.equal(r.code, "insufficient_balance"); }
        else if (op === "spend") { const a = big ? have + amt(10 * U) : amt(Math.max(2, have)); const r = await M().spend(p.id, a, { ikey: "sp" + k }).catch((e) => e);
          if (a <= have) { assert.ok(!(r instanceof Error), r.message); model.set(p.id, have - a); treasury += a; done.push({ spend: r.tx.id, uid: p.id, a }); } else assert.equal(r.code, "insufficient_balance"); }
        else if (op === "refund") { const s = pick(done.filter((d) => d.spend && !d.refunded)); if (s) { const r = await M().refund(s.spend); assert.equal(r.replayed, false); s.refunded = true; model.set(s.uid, model.get(s.uid) + s.a); treasury -= s.a; assert.equal((await M().refund(s.spend)).replayed, true); } }
        else if (op === "reward") { const pts = 1 + Math.floor(rnd() * 20); const a = await newAward(p.id, pts); const r = await M().onAward(a); assert.equal(r.minted, true, r.reason); model.set(p.id, have + pts * U); minted += pts * U; done.push({ award: a.id, uid: p.id, a: pts * U }); assert.equal((await M().onAward(a)).reason, "duplicate"); }
        else if (op === "claw") { const w = pick(done.filter((d) => d.award && !d.clawed)); if (w) { await db().run("UPDATE points_awards SET status='reversed' WHERE id=$1", [w.award]); const r = await M().onAwardReversed(w.award); const exp = Math.min(w.a, model.get(w.uid)); assert.equal(r.clawed, exp); w.clawed = true; model.set(w.uid, model.get(w.uid) - exp); burned += exp; assert.equal((await M().onAwardReversed(w.award)).clawed, 0); } }
        else if (op === "replay") { const f = pick(done.filter((d) => typeof d === "function")); if (f) { const r = await f(); assert.equal(r.replayed, true); } }
      } catch (e) { e.message = `seed ${seed} op ${i} (${op}): ${e.message}`; throw e; }
      for (const x of people) assert.equal(await balOf(x.id), model.get(x.id), `seed ${seed} op ${i} (${op}) balance of ${x.handle}`);
      if (i % 25 === 24) { const v = await M().verify(); assert.equal(v.ok, true, v.problems.join(", ")); }
    }
    run++;
    const v = await M().verify(); assert.equal(v.ok, true, v.problems.join(", "));
    assert.equal(v.supply.minted, minted); assert.equal(v.supply.burned, burned); assert.equal(v.supply.treasury, treasury);
    assert.equal(v.supply.users, [...model.values()].reduce((s, x) => s + x, 0));
    assert.equal(Number((await db().get("SELECT COALESCE(SUM(balance),0) s FROM mjt_accounts")).s), 0);
    assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_accounts WHERE allow_negative=0 AND balance < 0")).n), 0);
  }
});

test("concurrency: parallel spends never overspend", async () => {
  const x = await mk("inv_par1");
  await M().adjust({ id: staff.id }, { handle: x.handle, amount: "10", reason: "رصيد اختبار", ikey: "par1_seed" });
  const res = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => M().spend(x.id, U, { ikey: "par1_" + i })));
  const ok = res.filter((r) => r.status === "fulfilled").length, no = res.filter((r) => r.status === "rejected");
  assert.equal(ok, 10); assert.equal(no.length, 30); assert.ok(no.every((r) => r.reason.code === "insufficient_balance"), no.map((r) => r.reason.message).join());
  assert.equal(await balOf(x.id), 0);
  assert.equal((await M().verify()).ok, true);
});

test("concurrency: parallel replays of one transfer move money exactly once (HTTP)", async () => {
  const s = await mk("inv_par2"), r = await mk("inv_par3");
  await M().adjust({ id: staff.id }, { handle: s.handle, amount: "5", reason: "رصيد اختبار", ikey: "par2_seed" });
  H.app.ctx.rl.w.clear();
  const body = { to: r.handle, amount: "5", ikey: "par2_same_key_1" };
  const res = await Promise.all(Array.from({ length: 20 }, () => s.req("POST", "/api/mjt/transfers", body)));
  assert.ok(res.every((x) => x.status === 200), res.map((x) => x.code || x.status).join());
  assert.equal(res.filter((x) => !x.replayed).length, 1); assert.equal(new Set(res.map((x) => x.transfer.id)).size, 1);
  assert.equal(await balOf(s.id), 0); assert.equal(await balOf(r.id), 5 * U);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_tx WHERE ikey LIKE $1", ["xfer:%:par2_same_key_1"])).n), 1);
});

test("concurrency: opposite transfers in parallel neither deadlock nor lose money", async () => {
  const a = await mk("inv_par4"), b = await mk("inv_par5");
  await M().adjust({ id: staff.id }, { handle: a.handle, amount: "50", reason: "رصيد اختبار", ikey: "par4_seed" });
  await M().adjust({ id: staff.id }, { handle: b.handle, amount: "50", reason: "رصيد اختبار", ikey: "par5_seed" });
  H.app.ctx.rl.w.clear();
  const jobs = [];
  for (let i = 0; i < 30; i++) { jobs.push(M().transfer({ id: a.id }, { to: b.handle, amount: "1.5", ikey: "par45_ab_" + i })); jobs.push(M().transfer({ id: b.id }, { to: a.handle, amount: "1.5", ikey: "par45_ba_" + i })); }
  const res = await Promise.allSettled(jobs);
  const failed = res.filter((r) => r.status === "rejected"); assert.deepEqual(failed.map((r) => r.reason.message), []);
  assert.equal((await balOf(a.id)) + (await balOf(b.id)), 100 * U); assert.equal(await balOf(a.id), 50 * U);
  assert.equal((await M().verify()).ok, true);
});

test("concurrency: one award rewarded once; parallel rewards respect the daily cap exactly", async () => {
  const x = await mk("inv_par6");
  const a = await newAward(x.id, 7);
  const r = await Promise.all(Array.from({ length: 10 }, () => M().onAward(a)));
  assert.equal(r.filter((y) => y.minted).length, 1); assert.equal(await balOf(x.id), 7 * U);
  await H.app.ctx.services.mjt.ledger; await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { dailyCap: "30" } });
  const many = []; for (let i = 0; i < 12; i++) many.push(await newAward(x.id, 4));
  const rs = await Promise.all(many.map((w) => M().onAward(w)));
  assert.equal(await balOf(x.id), 30 * U, "7 + 23 (the last reward is cut to what is left) = the cap");
  assert.equal(rs.filter((y) => y.reason === "daily_cap").length, 6);
  await staff.req("PUT", "/api/admin/mjt/settings", { rewards: { dailyCap: "100000" } });
  assert.equal((await M().verify()).ok, true);
});

test("concurrency: parallel conversion runs apply once", async () => {
  const y = await mk("inv_par7");
  await db().run("INSERT INTO points_awards(id,user_id,kind,source_id,points,redeemable,status,day,reason,created_at) VALUES('pa_conv_par',$1,'wiki_edit','src_conv_par',12,1,'active','2026-01-01',NULL,$2)", [y.id, OLD]);
  const res = await Promise.allSettled(Array.from({ length: 5 }, () => M().convert("system")));
  const applied = res.filter((r) => r.status === "fulfilled" && r.value.applied);
  const errs = res.filter((r) => r.status === "rejected").map((r) => r.reason.message);
  assert.equal(applied.length, 1, errs.join(" | ")); assert.ok(applied[0].value.batch.users >= 1);
  assert.equal(await balOf(y.id), 12 * U);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_conversions WHERE user_id=$1", [y.id])).n), 1);
  assert.equal((await M().verify()).ok, true);
});
