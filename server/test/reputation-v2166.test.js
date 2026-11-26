/* v2.166 — MJT phase 8.3 «السمعة 2» (services/reputation-levels.js, migration 094, identity.js profile, mjt-safety cap level).
 * Switch OFF (default) = v2.165 exactly: no level in the profile payload, /api/rep-levels says {enabled:false}, mjt-safety's daily
 * cap keeps reading the contribution-points level. Switch ON = unified number (existing reputation + points × 0.5 − active
 * penalties), the 8 plan levels and thresholds, penalties 10..200 that expire after 12 months (admin, reason, logged), and the
 * cap mapping 1–2 → 30, 3–4 → 40, 5+ → 50 from the new level. Nothing stored is rewritten: old reputation / points untouched. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const RLmod = require("../services/reputation-levels");

let H, admin, a, b;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services, RL = () => S().repLevels, SF = () => S().mjtSafety;
const clear = () => H.app.ctx.rl.w.clear();
async function mk(handle) {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle; return cl;
}
const seed = async (u, rep, points) => {
  const at = new Date().toISOString();
  await db().run("INSERT INTO user_reputation(user_id,score,breakdown,computed_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET score=$2", [u.id, rep, JSON.stringify({ penalties: 0 }), at]);
  await db().run("UPDATE users SET reputation=$1 WHERE id=$2", [rep, u.id]);
  await db().run("INSERT INTO points_balances(user_id,total,redeemable,redeemed,level,optout,updated_at) VALUES($1,$2,$2,0,0,0,$3) ON CONFLICT (user_id) DO UPDATE SET total=$2, level=0", [u.id, points, at]);
};
const setRep = async (body, reason = "تغيير إعداد السمعة للاختبار") => { clear(); const r = await admin.req("PUT", "/api/admin/reputation", { ...body, reason }); assert.equal(r.status, 200, r.error); return r; };
const profile = async (viewer, u) => { clear(); const r = await viewer.req("GET", "/api/profiles/" + u.handle); return r; };

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false } });
  admin = await mk("rp_admin"); a = await mk("rp_a"); b = await mk("rp_b");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]); await db().run("UPDATE users SET role='member' WHERE id<>$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 094 is additive and reversible", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '094_reputation_penalties' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "094_reputation_penalties"]);
  await assert.rejects(() => db().get("SELECT 1 FROM reputation_penalties"));
  await db().get("SELECT 1 FROM user_reputation"); await db().get("SELECT 1 FROM points_balances");
  assert.deepEqual(await mig.up(db()), ["094_reputation_penalties", ...later]);
});

test("levels and thresholds: the 8 plan levels, perks only (no multiplier)", () => {
  assert.deepEqual(RLmod.LEVELS.map((l) => [l.at, l.name]), [[0, "مبتدئ"], [50, "مشارك"], [150, "مساهم"], [400, "نشِط"], [1000, "موثوق"], [2500, "خبير"], [5000, "مرشد"], [10000, "قدوة المجتمع"]]);
  const L = RLmod.levelInfo;
  assert.equal(L(0).level, 1); assert.equal(L(49).level, 1); assert.equal(L(50).level, 2); assert.equal(L(149).level, 2); assert.equal(L(150).level, 3);
  assert.equal(L(399).level, 3); assert.equal(L(400).level, 4); assert.equal(L(999).level, 4); assert.equal(L(1000).level, 5); assert.equal(L(2500).level, 6);
  assert.equal(L(4999).level, 6); assert.equal(L(5000).level, 7); assert.equal(L(9999).level, 7); assert.equal(L(10000).level, 8); assert.equal(L(99999).level, 8);
  assert.deepEqual(L(100).next, { level: 3, name: "مساهم", at: 150, remaining: 50 }); assert.equal(L(100).progress, 50);
  assert.equal(L(10000).next, null); assert.equal(L(10000).progress, 100); assert.equal(L(-5).level, 1);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(RLmod.capBand), ["level12", "level12", "level34", "level34", "level5", "level5", "level5", "level5"]);
  for (const lv of RL().levelsPublic()) { assert.ok(lv.perks.length > 0); for (const o of lv.opens) assert.equal(o.built, false); assert.equal("multiplier" in lv, false); }
});

test("switch OFF by default: members see v2.165 exactly", async () => {
  assert.equal(await db().get("SELECT value FROM mjt_settings WHERE key='reputation'"), undefined);
  await seed(a, 120, 100);
  const st = await admin.req("GET", "/api/admin/reputation"); assert.equal(st.status, 200, st.error); assert.equal(st.settings.enabled, false); assert.equal(st.settings.pointsFactor, 0.5);
  const pub = await a.req("GET", "/api/rep-levels"); assert.equal(pub.status, 200); assert.equal(pub.enabled, false); assert.equal(pub.levels, undefined);
  const p = await profile(b, a); assert.equal(p.status, 200, p.error); assert.equal(p.profile.reputation, 120); assert.equal("repLevel" in p.profile, false);
  assert.equal(await RL().capLevel(a.id), null);
  // the cap level still comes from points_balances.level (0 → level 1) while the switch is off
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/safety", { caps: { enabled: true }, reason: "تشغيل السقوف للاختبار" })).status, 200);
  await seed(a, 5000, 0); assert.equal((await SF().capsOf(a.id)).level, 1); assert.equal((await SF().capsOf(a.id)).daily, 30);
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/safety", { caps: { enabled: false }, reason: "إيقاف السقوف بعد الاختبار" })).status, 200);
});

test("members and guests cannot reach the admin endpoints; reason required", async () => {
  clear(); assert.equal((await a.req("GET", "/api/admin/reputation")).status, 403);
  clear(); assert.equal((await a.req("PUT", "/api/admin/reputation", { enabled: true, reason: "محاولة عضو" })).status, 403);
  clear(); assert.equal((await a.req("POST", "/api/admin/reputation/penalties", { handle: b.handle, amount: 10, reason: "محاولة عضو" })).status, 403);
  clear(); const r = await admin.req("PUT", "/api/admin/reputation", { enabled: true }); assert.equal(r.status, 400); assert.equal(r.code, "reason_required");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/reputation", { enabled: "yes", reason: "قيمة غير صالحة" })).status, 400);
  assert.equal((await RL().settings()).enabled, false);
});

test("switch ON: unified number = reputation + points × 0.5 − penalties; profile badge + progress; old data untouched", async () => {
  await seed(a, 120, 100);
  await setRep({ enabled: true });
  const p = await profile(b, a); assert.equal(p.status, 200, p.error);
  assert.equal(p.profile.reputation, 120); // the old number is still served as is
  assert.equal(p.profile.repLevel.score, 170); assert.equal(p.profile.repLevel.level, 3); assert.equal(p.profile.repLevel.name, "مساهم");
  assert.equal(p.profile.repLevel.next.name, "نشِط"); assert.equal(p.profile.repLevel.next.remaining, 230); assert.equal(p.profile.repLevel.breakdown.contributions, 50);
  const pub = await a.req("GET", "/api/rep-levels"); assert.equal(pub.enabled, true); assert.equal(pub.levels.length, 8); assert.equal(pub.me.score, 170); assert.equal(pub.penaltyMonths, 12);
  // nothing stored changed
  assert.equal(Number((await db().get("SELECT score FROM user_reputation WHERE user_id=$1", [a.id])).score), 120);
  assert.equal(Number((await db().get("SELECT total FROM points_balances WHERE user_id=$1", [a.id])).total), 100);
  assert.equal(Number((await db().get("SELECT reputation FROM users WHERE id=$1", [a.id])).reputation), 120);
  // the factor is an admin setting, logged
  await setRep({ pointsFactor: 1 }); assert.equal((await RL().unified(a.id)).score, 220);
  await setRep({ pointsFactor: 0.5 });
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM mjt_audit WHERE action='reputation_settings'")).n) >= 3);
  await setRep({ enabled: false });
  const off = await profile(b, a); assert.equal("repLevel" in off.profile, false);
});

test("penalties: −10…−200, reason required, logged, expire after 12 months, can be revoked", async () => {
  await seed(b, 300, 0); await setRep({ enabled: true });
  const bad = async (body, code) => { clear(); const r = await admin.req("POST", "/api/admin/reputation/penalties", body); assert.equal(r.status, code === "unknown_user" ? 404 : 400, JSON.stringify(r)); assert.equal(r.code, code); };
  await bad({ handle: b.handle, amount: 5, reason: "مقدار صغير جداً" }, "bad_amount");
  await bad({ handle: b.handle, amount: 201, reason: "مقدار كبير جداً" }, "bad_amount");
  await bad({ handle: b.handle, amount: 50 }, "reason_required");
  await bad({ handle: "nobody_here", amount: 50, reason: "عضو غير موجود" }, "unknown_user");
  clear(); const r1 = await admin.req("POST", "/api/admin/reputation/penalties", { handle: b.handle, kind: "suspension", reason: "تعليق مؤقت بسبب مخالفة" });
  assert.equal(r1.status, 200, r1.error); assert.equal(r1.penalty.amount, 100); assert.equal(r1.penalty.status, "active"); assert.equal(r1.member.score, 200); assert.equal(r1.member.level, 3);
  const months = (new Date(r1.penalty.expiresAt) - new Date(r1.penalty.createdAt)) / 864e5; assert.ok(months >= 365 && months <= 366, String(months));
  clear(); const r2 = await admin.req("POST", "/api/admin/reputation/penalties", { handle: b.handle, amount: 200, kind: "manipulation", reason: "تلاعب مؤكد بحسابات وهمية" });
  assert.equal(r2.status, 200, r2.error); assert.equal(r2.member.score, 0); assert.equal(r2.member.level, 1); // floor at 0
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mjt_audit WHERE action='reputation_penalty' AND target=$1", ["user:" + b.id])).n), 2);
  // expiry: a penalty past its 12 months no longer counts
  await db().run("UPDATE reputation_penalties SET created_at=$1, expires_at=$2 WHERE id=$3", [new Date(Date.now() - 400 * 864e5).toISOString(), new Date(Date.now() - 35 * 864e5).toISOString(), r2.penalty.id]);
  assert.equal((await RL().unified(b.id)).score, 200);
  // revoke
  clear(); assert.equal((await admin.req("POST", `/api/admin/reputation/penalties/${r1.penalty.id}/revoke`, {})).status, 400);
  clear(); const rv = await admin.req("POST", `/api/admin/reputation/penalties/${r1.penalty.id}/revoke`, { reason: "قُبل الاستئناف" }); assert.equal(rv.status, 200, rv.error); assert.equal(rv.member.score, 300);
  clear(); assert.equal((await admin.req("POST", `/api/admin/reputation/penalties/${r1.penalty.id}/revoke`, { reason: "مرة ثانية" })).status, 409);
  const st = await admin.req("GET", "/api/admin/reputation"); const mine = st.penalties.filter((p) => p.member?.handle === b.handle);
  assert.deepEqual(mine.map((p) => p.status).sort(), ["expired", "revoked"]);
  assert.equal(st.distribution.length, 8);
  const m = await admin.req("GET", "/api/admin/reputation/member/" + b.handle); assert.equal(m.status, 200); assert.equal(m.score, 300);
  // stored reputation untouched by penalties
  assert.equal(Number((await db().get("SELECT score FROM user_reputation WHERE user_id=$1", [b.id])).score), 300);
  await setRep({ enabled: false });
});

test("switch ON: mjt-safety daily cap follows the new level (1–2 → 30, 3–4 → 40, 5+ → 50)", async () => {
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/safety", { caps: { enabled: true }, reason: "تشغيل السقوف للاختبار" })).status, 200);
  await setRep({ enabled: true }); SF().invalidate();
  const cases = [[0, 1, 30], [60, 2, 30], [150, 3, 40], [400, 4, 40], [1000, 5, 50], [2500, 6, 50], [10000, 8, 50]];
  for (const [rep, lvl, cap] of cases) { await seed(a, rep, 0); RL().invalidate(); const c = await SF().capsOf(a.id); assert.equal(c.level, lvl, `rep ${rep}`); assert.equal(c.daily, cap, `rep ${rep}`); }
  await setRep({ enabled: false });
  await seed(a, 10000, 0); assert.equal((await SF().capsOf(a.id)).daily, 30); // back to the contribution-points level
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/safety", { caps: { enabled: false }, reason: "إيقاف السقوف بعد الاختبار" })).status, 200);
});
