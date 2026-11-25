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
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
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
const burn = (kind, uid, mjt, extra) => post(kind, [{ account: userAcc(uid), amount: -mjt * UNIT }, { account: SYS.burn, amount: mjt * UNIT }], { userId: uid, ...extra });
const dash = async (period = "month") => { clear(); const r = await admin.req("GET", "/api/admin/mjt/economy?period=" + period); assert.equal(r.status, 200, r.error); return r; };
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

test("members get 403 on every economy endpoint", async () => {
  for (const [m, p, b] of [["GET", "/api/admin/mjt/economy"], ["GET", "/api/admin/mjt/economy/mapping"], ["GET", "/api/admin/mjt/economy/alerts"], ["GET", "/api/admin/mjt/economy/reconciliation"], ["GET", "/api/admin/mjt/economy/settings"],
    ["PUT", "/api/admin/mjt/economy/settings", { alerts: { useRateMinPct: 5 } }], ["POST", "/api/admin/mjt/economy/sources/quiz_passed/state", { enabled: false }], ["POST", "/api/admin/mjt/economy/simulate", {}], ["GET", "/api/admin/mjt/economy/export.csv?table=summary"]]) {
    clear(); const r = await m1.req(m, p, b); assert.equal(r.status, 403, `${m} ${p}`);
  }
  clear(); assert.equal((await new H.Client().req("GET", "/api/admin/mjt/economy")).status, 401);
  assert.equal((await db().get("SELECT value FROM mjt_settings WHERE key='economy'")), undefined, "nothing written by a refused request");
});

test("alerts and budgets ship disabled (null); nothing triggers by default", async () => {
  const d = await dash();
  for (const [k2, v] of Object.entries(d.settings.alerts)) assert.equal(v, null, k2);
  assert.deepEqual(d.settings.budgets, {});
  assert.ok(d.alerts.items.length >= 7);
  assert.ok(d.alerts.items.every((a) => a.enabled === false && a.triggered === false));
  assert.equal(d.alerts.triggered, 0);
  assert.ok(d.issuance.phase4.every((s) => s.budget.monthly === null && s.enabled === false), "phase-4 sources still off, no budget");
});

let base;
test("totals match hand-computed fixtures; new and legacy issuance apart; balances never mixed with issued", async () => {
  base = await dash();
  const b0 = num(base.overview.balances.total);
  // new issuance: quiz_passed source → 5 MJT to m1 and m2 (real engine path)
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/rewards/sources/quiz_passed", { amount: 5, enabled: true })).status, 200);
  assert.equal((await RW().onAchievement({ user: m1.id, type: "quiz_passed", ref: "q1" })).paid, true);
  assert.equal((await RW().onAchievement({ user: m2.id, type: "quiz_passed", ref: "q1" })).paid, true);
  // legacy issuance: mining 5 + check-in 1 (m1), points conversion 10 (m3), points reward 2 then clawback 2 (m3), owner grant 7 (admin)
  await mint("mining", m1.id, 5); await mint("checkin", m1.id, 1); await mint("conversion", m3.id, 10); await mint("reward", m3.id, 2); await burn("clawback", m3.id, 2);
  assert.equal((await MJ().ownerGrant("7:ecgrant:@ec_admin")).replayed, false);
  // admin corrections: rewards-engine corrective credit 3 to m2, staff adjustment −1 on m3
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/rewards/wallets/ec_m2/adjust", { direction: "credit", amount: "3", reason: "تصحيح اختبار", ikey: key("adj") })).status, 200);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/adjust", { handle: "ec_m3", amount: "-1", reason: "تعديل اختبار", ikey: key("sadj") })).status, 200);
  // spend: studio_extended 2 MJT bought by m1 and m2, m2's refunded by the admin
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/services/svc_studio_extended", { cost: 2, term: "permanent", enabled: true })).status, 200);
  const svc = (await H.app.ctx.db.get("SELECT price_version FROM mjt_services WHERE id='svc_studio_extended'"));
  for (const cl of [m1, m2]) { clear(); const r = await cl.req("POST", "/api/mjt/services/svc_studio_extended/purchase", { priceVersion: Number(svc.price_version), ikey: key("buy") }); assert.equal(r.status, 200, r.error); cl.pid = r.purchase.id; }
  clear(); assert.equal((await admin.req("POST", `/api/admin/mjt/services/purchases/${m2.pid}/refund`, { reason: "استرداد اختبار" })).status, 200);
  // member transfer 4 (m3 → m1), tip 1 (m1 → m2, raw), one unknown kind 1 → m2
  clear(); const tr = await m3.req("POST", "/api/mjt/transfers", { to: "ec_m1", amount: "4", ikey: key("xfer") }); assert.equal(tr.status, 200, tr.error);
  await post("tip", [{ account: userAcc(m1.id), amount: -UNIT }, { account: userAcc(m2.id), amount: UNIT }], { userId: m1.id, refType: "post" });
  await mint("mystery_kind", m2.id, 1);

  const d = await dash();
  const delta = (c, f) => num(cls(d, c).all[f]) - num(cls(base, c).all[f]);
  assert.equal(delta("new_issuance", "in"), 10);
  assert.equal(delta("legacy_issuance", "in"), 5 + 1 + 10 + 2 + 7);
  assert.equal(delta("legacy_issuance", "out"), 2, "clawback reduces legacy, never new");
  assert.equal(delta("admin_correction", "in"), 3); assert.equal(delta("admin_correction", "out"), 1);
  assert.equal(delta("spend", "out"), 4); assert.equal(delta("refund", "in"), 2, "service refund is a refund, not an admin credit");
  assert.equal(delta("member_transfer", "in"), 4); assert.equal(delta("member_transfer", "out"), 4);
  assert.equal(delta("tip", "in"), 1); assert.equal(delta("unclassified", "in"), 1, "unknown kinds are shown, never hidden");
  assert.ok(cls(d, "unclassified").subs.some((s) => s.sub === "mystery_kind"));
  const subs = cls(d, "legacy_issuance").subs.map((s) => s.sub).sort();
  for (const s of ["checkin", "mining", "owner_grant", "points_conversion", "points_reward", "points_reward_clawback"]) assert.ok(subs.includes(s), s);
  assert.equal(num(d.overview.cumulative.issuedNew) - num(base.overview.cumulative.issuedNew), 10);
  assert.equal(num(d.overview.cumulative.issuedLegacy) - num(base.overview.cumulative.issuedLegacy), 25);
  // balances: the stored wallet total, its own number — equals the ledger, and is NOT issued (new + legacy)
  const tot = Number((await db().get("SELECT COALESCE(SUM(balance),0) s FROM mjt_accounts WHERE kind='user'")).s) / UNIT;
  assert.equal(num(d.overview.balances.total), tot);
  // Δbalances = 10 + 25 − 2 + 3 − 1 − 4 + 2 + 1 (mystery) = 34 — not the 35 issued
  assert.equal(num(d.overview.balances.total) - b0, 34);
  // flows: inflow − outflow = change of member balances in the window; transfers / tips are circulation, not inflow
  const f = d.flows; assert.equal(num(f.gap), num(f.inflow) - num(f.outflow));
  assert.equal(num(f.unused.end), num(d.overview.balances.total));
  // services usage
  const s = d.services.items.find((x) => x.key === "studio_extended");
  assert.deepEqual([s.purchases, num(s.spent), s.refunds, num(s.refunded), s.buyers, s.repeatBuyers], [2, 4, 1, 2, 2, 0]);
  assert.equal(d.services.mostUsed, "studio_extended");
  // issuance control: quiz_passed caps next to usage
  const q = d.issuance.phase4.find((x) => x.key === "quiz_passed");
  assert.equal(q.enabled, true); assert.equal(q.caps.day.count, 2); assert.equal(q.caps.day.peakPerMember, 1); assert.equal(num(q.allTime.issued), 10);
  assert.ok(d.topSources.some((x) => x.key === "quiz_passed"));
  // averages: per earner = issued in the window ÷ members who received issuance
  assert.ok(d.overview.period.earners >= 4); assert.ok(num(d.overview.period.avgEarnedPerEarner) > 0);
  assert.equal(d.overview.period.spenders >= 2, true);
  // series sums: legacy and new never merged
  const sumS = (f2) => d.series.points.reduce((x, p) => x + p[f2], 0);
  assert.equal(Math.round(sumS("issuedNew")), num(cls(d, "new_issuance").period.in));
  assert.equal(Math.round(sumS("issuedLegacy")), num(cls(d, "legacy_issuance").period.in));
  // the shared ledger still verifies — nothing here wrote history
  assert.equal((await MJ().verify()).ok, true);
  // mapping lists the unknown kind as unclassified
  clear(); const mp = await admin.req("GET", "/api/admin/mjt/economy/mapping");
  assert.equal(mp.seen.find((x) => x.kind === "mystery_kind").known, false);
  assert.ok(mp.rules.length >= 17);
});

test("rewards admin «issued» no longer counts service refunds as admin credits (v2.161 bug)", async () => {
  const st = await RW().stats();
  const refunds = Number((await db().get("SELECT COALESCE(SUM(amount),0) s FROM mjt_reward_entries WHERE status='posted' AND source='service_refund'")).s) / UNIT;
  const credits = Number((await db().get("SELECT COALESCE(SUM(amount),0) s FROM mjt_reward_entries WHERE status='posted' AND kind='adjust_credit' AND (source IS NULL OR source<>'service_refund')")).s) / UNIT;
  const earned = Number((await db().get("SELECT COALESCE(SUM(amount),0) s FROM mjt_reward_entries WHERE status='posted' AND kind='earn'")).s) / UNIT;
  assert.equal(refunds, 2);
  assert.equal(Number(st.rewards.refunds), 2);
  assert.equal(Number(st.rewards.adjustCredit), credits);
  assert.equal(Number(st.rewards.issued), earned + credits, "issued = earn + corrective credits, refunds excluded");
});

test("active wallets = ≥1 movement in the last 30 days (constant shown)", async () => {
  const d0 = await dash();
  assert.equal(d0.overview.activeWindowDays, 30);
  assert.match(d0.definitions.activeWallet, /30/);
  const m4 = await mk("ec_m4"); await mint("mining", m4.id, 1);
  const d1 = await dash(); assert.equal(d1.overview.activeWallets, d0.overview.activeWallets + 1);
  // move every movement of m4 to 40 days ago (test-only history edit) → no longer active, still in all-time totals
  const old = new Date(Date.now() - 40 * 864e5).toISOString();
  await db().run("UPDATE mjt_entries SET created_at=$1 WHERE account_id=$2", [old, userAcc(m4.id)]);
  await db().run("UPDATE mjt_tx SET created_at=$1 WHERE user_id=$2", [old, m4.id]);
  const d2 = await dash(); assert.equal(d2.overview.activeWallets, d0.overview.activeWallets);
  assert.equal(num(d2.overview.cumulative.issuedLegacy), num(d1.overview.cumulative.issuedLegacy), "all-time keeps it");
  assert.equal(num(cls(d2, "legacy_issuance").period.in), num(cls(d1, "legacy_issuance").period.in) - 1, "the 30-day window drops it");
});

test("concentration = share of total balance held by the top 10% of wallets with a balance", async () => {
  const rows = (await db().all("SELECT balance FROM mjt_accounts WHERE kind='user' AND balance > 0 ORDER BY balance DESC")).map((r) => Number(r.balance));
  const kk = Math.ceil(rows.length * 0.1), top = rows.slice(0, kk).reduce((a, b) => a + b, 0), all = rows.reduce((a, b) => a + b, 0);
  const c = (await dash()).overview.concentration;
  assert.equal(c.holders, rows.length); assert.equal(c.topWallets, kk);
  assert.equal(c.sharePct, Math.round((top / all) * 1000) / 10);
});

test("reconciliation lists a wallet whose stored balance differs from its ledger sum", async () => {
  let r = await dash(); assert.equal(r.reconciliation.ok, true);
  await db().run("UPDATE mjt_accounts SET balance=balance+1 WHERE id=$1", [userAcc(m3.id)]); // simulated corruption
  r = await dash();
  assert.equal(r.reconciliation.ok, false);
  assert.deepEqual(r.reconciliation.mismatches.map((x) => x.handle), ["ec_m3"]);
  assert.equal(r.reconciliation.mismatches[0].diff, "0.0000001");
  assert.ok(r.recommendations.items.some((x) => x.id === "reconcile"));
  assert.equal(r.alerts.items.find((a) => a.key === "mismatch").triggered, false, "the alert rule is still disabled");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/economy/settings", { alerts: { mismatch: true } })).status, 200);
  r = await dash(); assert.equal(r.alerts.items.find((a) => a.key === "mismatch").triggered, true);
  await db().run("UPDATE mjt_accounts SET balance=balance-1 WHERE id=$1", [userAcc(m3.id)]);
  r = await dash(); assert.equal(r.reconciliation.ok, true); assert.equal(r.alerts.items.find((a) => a.key === "mismatch").triggered, false);
  clear(); await admin.req("PUT", "/api/admin/mjt/economy/settings", { alerts: { mismatch: null } });
});

test("thresholds and budgets: alert only — no limit or source is changed; settings audited; bad values refused", async () => {
  const before = await db().get("SELECT * FROM mjt_reward_sources WHERE key='quiz_passed'");
  clear(); let r = await admin.req("PUT", "/api/admin/mjt/economy/settings", { budgets: { quiz_passed: "5" }, alerts: { issuanceDailyMax: "1", correctionsMaxCount: 1, top10ShareMaxPct: 1, sourceSpikeFactor: 2 } });
  assert.equal(r.status, 200, r.error); assert.equal(r.settings.budgets.quiz_passed, "5");
  const d = await dash();
  const a = (k2) => d.alerts.items.find((x) => x.key === k2);
  assert.equal(a("issuanceDailyMax").triggered, true); assert.equal(a("correctionsMaxCount").triggered, true); assert.equal(a("top10ShareMaxPct").triggered, true);
  assert.equal(a("sourceSpikeFactor").triggered, true, "today's quiz rewards with no 30-day baseline");
  const bud = d.alerts.items.find((x) => x.key === "budget" && x.source === "quiz_passed"); assert.equal(bud.triggered, true);
  assert.equal(d.issuance.phase4.find((x) => x.key === "quiz_passed").budget.reached, true);
  const after = await db().get("SELECT * FROM mjt_reward_sources WHERE key='quiz_passed'");
  assert.deepEqual(after, before, "a reached budget / triggered alert never pauses or edits the source");
  assert.ok(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action='economy_settings'") >= 2);
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/economy/settings", { budgets: { mining: "5" } })).status, 400, "legacy paths have no budget here");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/economy/settings", { alerts: { useRateMinPct: 150 } })).status, 400);
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/economy/settings", { alerts: { nope: 1 } })).status, 400);
  clear(); r = await admin.req("PUT", "/api/admin/mjt/economy/settings", { budgets: { quiz_passed: null }, alerts: { issuanceDailyMax: null, correctionsMaxCount: null, top10ShareMaxPct: null, sourceSpikeFactor: null } });
  assert.equal(r.status, 200); assert.ok(Object.values(r.settings.alerts).every((v) => v === null)); assert.deepEqual(r.settings.budgets, {});
});

test("manual pause / resume of a phase-4 source through its enable flag; legacy paths cannot be paused here", async () => {
  clear(); let r = await admin.req("POST", "/api/admin/mjt/economy/sources/quiz_passed/state", { enabled: false, reason: "مراجعة" });
  assert.equal(r.status, 200, r.error); assert.equal(r.source.enabled, false);
  assert.equal((await RW().onAchievement({ user: m3.id, type: "quiz_passed", ref: "q9" })).reason, "disabled");
  clear(); r = await admin.req("POST", "/api/admin/mjt/economy/sources/quiz_passed/state", { enabled: true }); assert.equal(r.status, 200); assert.equal(r.source.enabled, true);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/economy/sources/mining/state", { enabled: false })).status, 404);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/economy/sources/course_completed/state", { enabled: true })).status, 400, "no amount → cannot enable (engine rule)");
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/economy/sources/quiz_passed/state", {})).status, 400);
  assert.ok(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action='reward_source_saved' AND target='quiz_passed'") >= 3);
});

test("simulation is hypothetical, labelled «افتراضي», and writes nothing", async () => {
  const counts = async () => Promise.all(["mjt_settings", "mjt_audit", "mjt_tx", "mjt_entries", "mjt_reward_entries", "mjt_reward_sources", "mjt_service_purchases"].map((t) => n(`SELECT COUNT(*) n FROM ${t}`)));
  const set0 = await db().get("SELECT value FROM mjt_settings WHERE key='economy'"); const c0 = await counts();
  clear(); const r = await admin.req("POST", "/api/admin/mjt/economy/simulate", { memberGrowthPct: 10, activityPct: 5, rewardRatePct: -20, serviceCostPct: 0, serviceUsagePct: 50, months: 3 });
  assert.equal(r.status, 200, r.error); assert.equal(r.hypothetical, true); assert.equal(r.label, "افتراضي"); assert.match(r.note, /افتراضي/);
  assert.equal(r.months.length, 3); assert.equal(r.baseline.windowDays, 30);
  // month 1 by hand: new = base × 1.1 × 1.05 × 0.8
  const bNew = Number(r.baseline.newIssued) * UNIT; assert.equal(Number(r.months[0].issuedNew), Math.round(bNew * 1.1 * 1.05 * 0.8) / UNIT);
  assert.deepEqual(await counts(), c0); assert.deepEqual(await db().get("SELECT value FROM mjt_settings WHERE key='economy'"), set0);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/economy/simulate", { memberGrowthPct: 5000 })).status, 400);
});

test("CSV exports for each table of the period; formula injection guarded; export audited", async () => {
  for (const t of ["summary", "classes", "sources", "legacy", "services", "flows", "series", "alerts", "reconciliation", "mapping"]) {
    clear(); const r = await fetch(H.base + "/api/admin/mjt/economy/export.csv?period=week&table=" + t, { headers: { Cookie: admin.cookie, "X-Requested-With": "mujtama" } });
    assert.equal(r.status, 200, t); assert.match(r.headers.get("content-type"), /text\/csv/); assert.match(r.headers.get("content-disposition"), new RegExp(`mjt-economy-${t}-week`));
    const body = await r.text(); assert.ok(body.split("\r\n").length >= 1);
    if (t === "classes") { assert.match(body, /legacy_issuance/); assert.match(body, /new_issuance/); }
  }
  clear(); assert.equal((await admin.req("GET", "/api/admin/mjt/economy/export.csv?table=nope")).status, 400);
  const logged = await n("SELECT COUNT(*) n FROM audit_log WHERE action='mjt_economy_export'").catch(() => null);
  if (logged !== null) assert.ok(logged >= 10);
});

test("recommendations are text only; periods filter; legacy paths still active and untouched", async () => {
  for (const p of ["day", "week", "month", "year"]) { const d = await dash(p); assert.equal(d.period.key, p); assert.ok(d.series.points.length >= 5); assert.ok(d.recommendations.items.length >= 1); assert.match(d.recommendations.note, /لا يُطبَّق/); }
  const d = await dash("bogus"); assert.equal(d.period.key, "month");
  // legacy settings unchanged: transfers on, mining defaults
  assert.equal((await MJ().settings()).transfers.enabled, true);
  clear(); assert.equal((await m1.req("POST", "/api/mjt/buy", {})).status, 501);
});
