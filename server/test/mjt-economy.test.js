/* v2.162 — phase 6 «اقتصاد MJT» (services/mjt-economy.js, migration 092). Read-only economy analytics over the shared ledger:
 * classification of every ledger kind found in the code · totals vs hand-computed fixtures (new vs legacy kept apart) · total
 * balances never mixed with issued · active-wallet window (30 days) · concentration (top 10%) · reconciliation mismatch
 * detection · alerts all disabled by default, then one triggered · budgets only alert (source stays enabled) · manual pause of a
 * phase-4 source (legacy keys refused) · simulation writes nothing · CSV exports (audited) · 403 for members on every endpoint ·
 * the rewards «issued» bug (service refunds counted as admin credits) · migration 092 down / up. */
const test = require("node:test"), assert = require("node:assert");
const fs = require("node:fs"), path = require("node:path");
const { boot } = require("./helpers");
const { UNIT, SYS, userAcc } = require("../lib/mjt-ledger");

let H, admin, m1, m2, m3;
const db = () => H.app.ctx.db;
const RW = () => H.app.ctx.services.mjtRewards;
const MJ = () => H.app.ctx.services.mjt;
const clear = () => H.app.ctx.rl.w.clear();
let k = 0; const key = (p = "t") => `${p}_${Date.now()}_${k++}`;
const mk = async (handle) => {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), cl.id]);
  return cl;
};
/** a raw ledger post through the real primitive (lib/mjt-ledger.js) — for the legacy kinds whose own triggers need other systems */
const post = (kind, lines, extra = {}) => db().tx(async (t) => { await MJ().ledger.lock(t, lines.map((l) => l.account)); return MJ().ledger.post(t, { ikey: extra.ikey || key(kind), kind, userId: extra.userId || null, refType: extra.refType || kind, allowFrozen: true, lines }); });
const mint = (kind, uid, mjt, extra) => post(kind, [{ account: SYS.mint, amount: -mjt * UNIT }, { account: userAcc(uid), amount: mjt * UNIT }], { userId: uid, ...extra });
const cls = (d, k2) => d.classes.find((c) => c.key === k2);
const num = (s) => Number(s);

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false } });
  admin = await mk("ec_admin"); m1 = await mk("ec_m1"); m2 = await mk("ec_m2"); m3 = await mk("ec_m3");
  await RW().ready; await H.app.ctx.services.mjtServices.ready;
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("every ledger kind posted in the code is classified (none falls to «unclassified»); legacy is its own class", () => {
  const { classify, RULES } = require("../services/mjt-economy");
  const dir = path.join(__dirname, "..", "services"), kinds = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    if (!/mjt-ledger|\.ledger\b|led\(\)\.post|led\.post/.test(src)) continue;
    for (const line of src.split("\n").filter((l) => /\.post\(t, \{|const j = \{ ikey/.test(l))) for (const m of line.matchAll(/kind: "([a-z_]+)"/g)) kinds.add(m[1]);
  }
  // mjt-rewards posts TX_KIND values + txKind 'refund'; mjt.js tips use a `j` object (kind "tip")
  for (const x of ["earn", "spend", "adjustment", "refund", "tip"]) kinds.add(x);
  assert.ok(kinds.size >= 14, "found the ledger kinds: " + [...kinds].join(","));
  for (const kd of kinds) assert.notEqual(classify({ kind: kd, ikey: "x", ref_type: null }).cls, "unclassified", kd);
  const exp = { earn: "new_issuance", reward: "legacy_issuance", mining: "legacy_issuance", checkin: "legacy_issuance", conversion: "legacy_issuance", conversion_reversal: "legacy_issuance", clawback: "legacy_issuance",
    spend: "spend", refund: "refund", transfer: "member_transfer", community_reward: "member_transfer", community_reward_reversal: "member_transfer", tip: "tip", adjustment: "admin_correction", buy: "legacy_issuance" };
  for (const [kd, c] of Object.entries(exp)) assert.equal(classify({ kind: kd, ikey: "adj:x" }).cls, c, kd);
  assert.deepEqual(classify({ kind: "adjustment", ikey: "owner-grant:k1" }), { cls: "legacy_issuance", sub: "owner_grant" });
  assert.deepEqual(classify({ kind: "adjustment", ikey: "owner-grant-undo:k1" }), { cls: "legacy_issuance", sub: "owner_grant_undo" });
  assert.deepEqual(classify({ kind: "adjustment", ikey: "rw:adj:1", ref_type: "reward:admin" }), { cls: "admin_correction", sub: "rewards_correction" });
  assert.equal(classify({ kind: "brand_new_kind" }).cls, "unclassified");
  assert.ok(RULES.every((r) => r.ar), "every rule has an Arabic label");
});

test("migration 092 is additive (indexes only) and reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '092_mjt_economy' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "092_mjt_economy"]);
  await db().get("SELECT 1 FROM mjt_tx"); await db().get("SELECT 1 FROM mjt_entries"); await db().get("SELECT 1 FROM mjt_service_purchases"); // nothing else touched
  assert.deepEqual(await mig.up(db()), ["092_mjt_economy", ...later]);
  const idx = (await db().all("SELECT name FROM sqlite_master WHERE type='index' AND name IN ('mjt_tx_created','mjt_entries_created')")).map((r) => r.name).sort();
  if (db().dialect !== "postgres") assert.deepEqual(idx, ["mjt_entries_created", "mjt_tx_created"]);
});

test("v2.167: the admin economy page and its API are gone (404 for everyone, 401 signed out); nothing written", async () => {
  for (const c of [admin, m1]) for (const [m, p, b] of [["GET", "/api/admin/mjt/economy"], ["GET", "/api/admin/mjt/economy/mapping"], ["PUT", "/api/admin/mjt/economy/settings", { alerts: { useRateMinPct: 5 } }], ["POST", "/api/admin/mjt/economy/sources/quiz_passed/state", { enabled: false }], ["POST", "/api/admin/mjt/economy/simulate", {}]]) {
    clear(); assert.equal((await c.req(m, p, b)).status, 404, `${m} ${p}`);
  }
  clear(); assert.ok([401, 404].includes((await new H.Client().req("GET", "/api/admin/mjt/economy")).status));
  assert.equal((await db().get("SELECT value FROM mjt_settings WHERE key='economy'")), undefined, "nothing written");
});

test("v2.167: the read-only analytics still classify real ledger movements in-process (no balance mixed with issuance)", async () => {
  const E = H.app.ctx.services.mjtEconomy;
  const base = await E.dashboard({ period: "month" });
  await mint("mining", m1.id, 5); await mint("checkin", m1.id, 1); await mint("mystery_kind", m2.id, 1);
  const d = await E.dashboard({ period: "month" });
  const delta = (c, f) => num(cls(d, c).all[f]) - num(cls(base, c).all[f]);
  assert.equal(delta("legacy_issuance", "in"), 6);
  assert.equal(delta("unclassified", "in"), 1, "unknown kinds are shown, never hidden");
  assert.ok(cls(d, "unclassified").subs.some((s) => s.sub === "mystery_kind"));
  assert.equal(num(d.overview.cumulative.issuedLegacy) - num(base.overview.cumulative.issuedLegacy), 6);
});
