/* v2.62 T4 «مهندس محرّك الحارس» — cmod2.guardCheck/guardStrike wired first in cmod.automod: a hit rejects (text not
 * stored), strike 1/2 = warn + timed mute, strike 3 = indefinite lock; staff exempt; decay window; guard hits never
 * reach the v2.59 ladder; mod log actor shown as «الحارس التلقائي»; the client gets the step, never the word list;
 * guard off (or no guard key) = v2.61 behaviour. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const AR = require("../lib/automod-rules");
let H, O, MO, U1, U2, U3, U4, cid;
const DEF = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "off", action: "queue" };
const clear = () => H.app.ctx.rl.w?.clear?.();
const db = () => H.app.ctx.db;
const mk = async (handle) => { clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const setAm = (am) => db().run("UPDATE communities SET settings=$1 WHERE id=$2", [{ automod: am }, cid]);
const post = (c, text) => { clear(); return c.req("POST", "/api/posts", { text, community: cid }); };
const mem = (u) => db().get("SELECT role, muted_until, warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, u]);
const guard = (x = {}) => AR.parseGuard({ enabled: true, words: ["غبي", "يا حمار"], ...x });
const expire = async (u) => { await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 60e3).toISOString(), cid, u]); await db().run("UPDATE community_sanctions SET until=$1 WHERE community=$2 AND user_id=$3 AND kind='mute' AND until IS NOT NULL", [new Date(Date.now() - 60e3).toISOString(), cid, u]); await H.app.ctx.services.cmod.unmuteDue(); };
const stored = async (text) => Number((await db().get("SELECT COUNT(*) n FROM posts WHERE text LIKE $1", ["%" + text + "%"])).n);

test.before(async () => {
  H = await boot();
  [O, MO, U1, U2, U3, U4] = [await mk("own_g4"), await mk("mod_g4"), await mk("usr_g4a"), await mk("usr_g4b"), await mk("usr_g4c"), await mk("usr_g4d")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع الحارس", desc: "اختبار", topic: "dev" })).community.id;
  for (const c of [MO, U1, U2, U3, U4]) { clear(); await c.req("PUT", `/api/communities/${cid}/membership`); }
  clear(); assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" })).status, 200);
});
test.after(() => H.app.close());

test("3-strike scenario: reject + warn + 1h mute, twice; third → indefinite lock; nothing stored; response shape", async () => {
  await setAm({ ...DEF, guard: guard() });
  const r1 = await post(U1, "انت غبييي جداً نص1");
  assert.equal(r1.status, 400); assert.equal(r1.code, "autoguard");
  assert.match(r1.error, /تحذير 1 من 3/); assert.match(r1.error, /ساعة/);
  assert.equal(r1.guard.n, 1); assert.equal(r1.guard.max, 3); assert.equal(r1.guard.locked, false); assert.equal(r1.guard.hours, 1);
  assert.ok(Math.abs(Date.parse(r1.guard.mutedUntil) - Date.now() - 3600e3) < 60e3);
  assert.deepEqual(r1.guard.words, ["غ**"], "masked words only");
  assert.ok(!JSON.stringify(r1).includes("غبي") && !JSON.stringify(r1).includes("حمار"), "never the word list");
  assert.equal(await stored("نص1"), 0, "rejected text not stored");
  let m = await mem(U1.id); assert.equal(m.role, "muted"); assert.equal(m.warnings, 1);
  const s1 = await db().all("SELECT kind, rule_id, actor, until FROM community_sanctions WHERE community=$1 AND user_id=$2 ORDER BY created_at", [cid, U1.id]);
  assert.deepEqual(s1.map(x => [x.kind, x.rule_id, x.actor]), [["warn", "autoguard", "system"], ["mute", "autoguard", "system"]]);
  // while muted the member cannot post at all (existing permission)
  assert.notEqual((await post(U1, "نص عادي اثناء الكتم")).status, 200);
  await expire(U1.id);
  const r2 = await post(U1, "يا   حمار نص2"); assert.equal(r2.guard.n, 2); assert.match(r2.error, /تحذير 2 من 3/); assert.deepEqual(r2.guard.words, ["ي* ح***"]);
  await expire(U1.id);
  const r3 = await post(U1, "والغبي نص3");
  assert.equal(r3.guard.n, 3); assert.equal(r3.guard.locked, true); assert.equal(r3.guard.mutedUntil, null); assert.match(r3.error, /حتى يراجع مشرف/);
  m = await mem(U1.id); assert.equal(m.role, "muted"); assert.equal(m.muted_until, null); assert.equal(m.warnings, 3);
  assert.ok(await db().get("SELECT 1 x FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='mute' AND rule_id='autoguard_lock' AND until IS NULL AND lifted_at IS NULL", [cid, U1.id]));
  await H.app.ctx.services.cmod.unmuteDue(); assert.equal((await mem(U1.id)).role, "muted", "the lock is never auto-lifted");
  const acts = await db().all("SELECT action, actor, reason, meta FROM mod_actions WHERE community=$1 AND target_user=$2 AND action LIKE 'autoguard%' ORDER BY created_at", [cid, U1.id]);
  assert.deepEqual(acts.map(a => a.action), ["autoguard_strike", "autoguard_strike", "autoguard_lock"]);
  assert.ok(acts.every(a => a.actor === "system" && !/غبي|حمار/.test(a.reason)));
  // mod log labels the entry as automatic «الحارس التلقائي»
  const log = await O.req("GET", `/api/communities/${cid}/modlog`);
  assert.equal(log.status, 200); const e = log.log.find(x => x.action === "autoguard_lock"); assert.equal(e.actor, "الحارس التلقائي"); assert.match(e.label, /الحارس التلقائي/);
  const LABEL = H.app.ctx.services.cmod.LABEL; assert.ok(LABEL.autoguard_strike && LABEL.autoguard_lock);
  // a manual unmute (reset) clears the strikes: next hit is strike 1 again
  clear(); assert.equal((await MO.req("POST", `/api/communities/${cid}/members/${U1.id}/discipline`, { action: "unmute" })).status, 200);
  await H.app.ctx.services.communities.sanction(MO.id, cid, U1.id, "unmute", { reset: true });
  assert.equal(await H.app.ctx.services.cmod2.guardCount(cid, U1.id, guard()), 0);
  // clean text passes
  const ok = await post(U1, "صباح الخير للجميع"); assert.equal(ok.status, 200);
});

test("staff exempt: owner and moderator are never struck", async () => {
  await setAm({ ...DEF, guard: guard() });
  for (const c of [O, MO]) { const r = await post(c, "غبي من الطاقم " + c.id); assert.equal(r.status, 200, "staff post published"); }
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM community_sanctions WHERE community=$1 AND user_id IN ($2,$3)", [cid, O.id, MO.id])).n), 0);
});

test("decay: strikes older than decayDays no longer count; decayDays 0 never decays; muteHours 0 = warn only", async () => {
  await setAm({ ...DEF, guard: guard({ muteHours: 0, decayDays: 30 }) });
  const r1 = await post(U2, "غبي أ"); assert.equal(r1.guard.n, 1); assert.equal(r1.guard.mutedUntil, null); assert.equal((await mem(U2.id)).role, "member", "warn only");
  assert.doesNotMatch(r1.error, /لا يمكنك الكتابة/);
  await db().run("UPDATE community_sanctions SET created_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 40 * 864e5).toISOString(), cid, U2.id]);
  const r2 = await post(U2, "غبي ب"); assert.equal(r2.guard.n, 1, "old strike decayed");
  await db().run("UPDATE community_sanctions SET created_at=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 400 * 864e5).toISOString(), cid, U2.id]);
  await setAm({ ...DEF, guard: guard({ muteHours: 0, decayDays: 0 }) });
  const r3 = await post(U2, "غبي ج"); assert.equal(r3.guard.n, 3, "decayDays 0 keeps every unlifted strike");
  assert.equal(r3.guard.locked, true);
});

test("fullLock false: the last strike is a timed mute, not a lock", async () => {
  await setAm({ ...DEF, guard: guard({ maxStrikes: 1, fullLock: false, muteHours: 2 }) });
  const r = await post(U4, "غبي"); assert.equal(r.guard.n, 1); assert.equal(r.guard.locked, false); assert.equal(r.guard.hours, 2); assert.ok(r.guard.mutedUntil);
  assert.ok((await mem(U4.id)).muted_until);
  await expire(U4.id);
});

test("ladder is not double-counted: guard hits never trigger the v2.59 ladder; other rule hits still do", async () => {
  const ladder = AR.parseLadder({ enabled: true, windowDays: 30, steps: [{ at: 1, action: "warn" }] });
  await setAm({ ...DEF, guard: guard({ muteHours: 0 }), ladder, v2: AR.parseV2({ words: { enabled: true, words: ["محظورة"] } }) });
  const r = await post(U3, "غبي"); assert.equal(r.guard.n, 1);
  assert.equal((await mem(U3.id)).warnings, 1, "only the guard warning");
  assert.equal(await db().get("SELECT 1 x FROM mod_actions WHERE community=$1 AND target_user=$2 AND action IN ('automod_penalty','automod_reject')", [cid, U3.id]), undefined);
  // a v2 hit afterwards: the ladder counts 1 automod hit (not 2) → its at:1 step applies once
  const v = await post(U3, "كلمة محظورة"); assert.notEqual(v.code, "autoguard");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1 AND target_user=$2 AND action='automod_penalty'", [cid, U3.id])).n), 1);
  assert.equal((await mem(U3.id)).warnings, 2);
});

test("guard off = v2.61: enabled false or no guard key → no strike, verdict identical to legacy/v2", async () => {
  const cmod = H.app.ctx.services.cmod, c = await db().get("SELECT * FROM communities WHERE id=$1", [cid]);
  const user = { id: U4.id };
  for (const am of [{ ...DEF, words: ["غبي"], action: "reject" }, { ...DEF, words: ["غبي"], action: "reject", guard: AR.parseGuard({ enabled: false, words: ["غبي"] }) }, { ...DEF, guard: guard({ posts: false }) }]) {
    const base = { ...am }; delete base.guard;
    const a = await cmod.automod({ ...c, settings: { automod: am } }, user, "member", "انت غبي");
    const b = await cmod.automod({ ...c, settings: { automod: base } }, user, "member", "انت غبي");
    assert.deepEqual(a, b); assert.ok(!a || !a.guard);
  }
  assert.equal(await H.app.ctx.services.cmod2.guardCheck({ ...c, settings: { automod: DEF } }, user, "غبي", "post"), null, "community without guard");
  const before = Number((await db().get("SELECT COUNT(*) n FROM community_sanctions WHERE user_id=$1 AND rule_id LIKE 'autoguard%'", [U4.id])).n);
  await setAm({ ...DEF, guard: AR.parseGuard({ enabled: false, words: ["غبي"] }) });
  assert.equal((await post(U4, "غبي لكن الحارس مطفأ")).status, 200);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM community_sanctions WHERE user_id=$1 AND rule_id LIKE 'autoguard%'", [U4.id])).n), before);
});
