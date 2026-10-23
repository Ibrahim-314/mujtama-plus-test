/* v2.62 T2 «الحارس التلقائي» — settings wiring: `automod.guard` is parsed only when sent (OFF by default), carried
 * over a legacy patch (keepV2), summarised without its word lists in the audit diff, round-trips through both save
 * paths (PATCH /automod and PATCH /settings/moderation), and never leaves the server in public/member responses. A
 * config without `guard` stays byte-for-byte the v2.61 object. */
const test = require("node:test"), assert = require("node:assert");
const CS = require("../lib/community-settings");
const AR = require("../lib/automod-rules");
const { boot } = require("./helpers");

const SECRET = "كلمةسرية_حارس", ALLOW = "استثناء_حارس";
const V261 = { words: ["سبام"], blockLinks: true, newAccountDays: 3, toxicity: "reject", action: "reject", v2: { caps: { enabled: true } }, ladder: { enabled: true, steps: [{ at: 2, do: "warn" }] } };

/* ---------- pure ---------- */
test("automodOf: no guard key → exact v2.61 object (no guard field at all)", () => {
  const legacy = { words: ["a1", "b2"], blockLinks: true, newAccountDays: 5, toxicity: "off", action: "reject" };
  const out = CS.automodOf(legacy);
  assert.deepEqual(out, { words: ["a1", "b2"], blockLinks: true, newAccountDays: 5, toxicity: "off", action: "reject" });
  assert.ok(!("guard" in out));
  assert.ok(!("guard" in CS.automodOf({ ...legacy, guard: null })), "null guard is ignored like an absent one");
  const withV2 = CS.automodOf(V261);
  assert.ok(!("guard" in withV2)); assert.deepEqual(withV2.v2, AR.parseV2(V261.v2)); assert.deepEqual(withV2.ladder, AR.parseLadder(V261.ladder));
});

test("automodOf: guard parsed through parseGuard; OFF unless enabled:true", () => {
  const off = CS.automodOf({ guard: { words: [SECRET] } }).guard;
  assert.equal(off.enabled, false); assert.deepEqual(off, AR.parseGuard({ words: [SECRET] }));
  assert.equal(CS.automodOf({ guard: { enabled: "true", words: [SECRET] } }).guard.enabled, false, "only boolean true enables");
  assert.equal(CS.automodOf({ guard: {} }).guard.enabled, false);
  const on = CS.automodOf({ guard: { enabled: true, words: [SECRET], allow: [ALLOW], muteHours: 9999, maxStrikes: 0 } }).guard;
  assert.equal(on.enabled, true); assert.deepEqual(on.words, [SECRET]); assert.deepEqual(on.allow, [ALLOW]);
  assert.equal(on.muteHours, 720); assert.equal(on.maxStrikes, 1);
});

test("keepV2: a patch without guard keeps the stored guard; a patch with guard replaces it; no prev → unchanged", () => {
  const prev = CS.automodOf({ ...V261, guard: { enabled: true, words: [SECRET] } });
  const legacyPatch = CS.automodOf({ words: ["x9"] });
  const kept = CS.keepV2(prev, legacyPatch);
  assert.deepEqual(kept.guard, prev.guard); assert.deepEqual(kept.v2, prev.v2); assert.deepEqual(kept.ladder, prev.ladder); assert.deepEqual(kept.words, ["x9"]);
  const repl = CS.keepV2(prev, CS.automodOf({ guard: { enabled: false, words: [] } }));
  assert.equal(repl.guard.enabled, false); assert.deepEqual(repl.guard.words, []);
  assert.deepEqual(CS.keepV2(undefined, legacyPatch), legacyPatch);
  const oldPrev = CS.automodOf(V261); // a v2.61 store: nothing invented
  assert.ok(!("guard" in CS.keepV2(oldPrev, legacyPatch)));
});

test("summary/diff: guard summarised by counts and switches; word / allow lists never copied", () => {
  const before = { automod: CS.automodOf(V261) };
  const after = { automod: CS.automodOf({ ...V261, guard: { enabled: true, words: [SECRET, "ثانية"], allow: [ALLOW] } }) };
  const d = CS.diff(before, after);
  assert.ok(d.automod); assert.ok(!("guard" in d.automod.from));
  assert.deepEqual(d.automod.to.guard, { enabled: true, words: 2, allow: 1, muteHours: 1, maxStrikes: 3, decayDays: 30, fullLock: true, liftMin: "moderator" });
  const s = JSON.stringify(d); assert.ok(!s.includes(SECRET) && !s.includes(ALLOW));
  assert.deepEqual(CS.summary(CS.automodOf(V261)), { words: 1, blockLinks: true, newAccountDays: 3, toxicity: "reject", action: "reject", v2: Object.keys(AR.parseV2(V261.v2)).filter(k => AR.parseV2(V261.v2)[k]?.enabled), ladder: true }, "v2.61 summary unchanged (no guard key)");
});

test("automod stays staff-only: publicSettings never carries it (or the guard)", () => {
  assert.equal(CS.FIELDS.automod.vis, "staff"); assert.ok(!CS.PUBLIC_KEYS.includes("automod"));
  const pub = CS.publicSettings({ whoCanPost: "members", automod: CS.automodOf({ guard: { enabled: true, words: [SECRET] } }) });
  assert.ok(!JSON.stringify(pub).includes(SECRET)); assert.ok(!("automod" in pub));
});

/* ---------- API ---------- */
let H, O, MO, U, X, cid, oldCid;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const db = () => H.app.ctx.db;
const settingsOf = async (id) => { const c = await db().get("SELECT settings FROM communities WHERE id=$1", [id]); return typeof c.settings === "string" ? JSON.parse(c.settings) : c.settings; };

test.describe("API", () => {
  test.before(async () => {
    H = await boot();
    [O, MO, U, X] = [await mk("cg_own"), await mk("cg_mod"), await mk("cg_usr"), await mk("cg_out")];
    cid = (await O.req("POST", "/api/communities", { name: "مجتمع الحارس", desc: "اختبار الحارس" })).community.id;
    H.app.ctx.rl.w?.clear?.();
    oldCid = (await O.req("POST", "/api/communities", { name: "مجتمع قديم", desc: "إعداد v2.61" })).community.id;
    for (const c of [MO, U]) await c.req("PUT", `/api/communities/${cid}/membership`);
    await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" });
  });
  test.after(() => H.app.close());
  test.beforeEach(() => H.app.ctx.rl.w?.clear?.());

  test("round-trip: PATCH /automod saves guard; GET /automod (staff) returns it; legacy body keeps it", async () => {
    const r = await O.req("PATCH", `/api/communities/${cid}/automod`, { ...V261, guard: { enabled: true, words: [SECRET], allow: [ALLOW], maxStrikes: 5 } });
    assert.equal(r.status, 200, r.error); assert.equal(r.automod.guard.enabled, true); assert.equal(r.automod.guard.maxStrikes, 5);
    const g = await MO.req("GET", `/api/communities/${cid}/automod`); assert.equal(g.status, 200);
    assert.deepEqual(g.automod.guard, AR.parseGuard({ enabled: true, words: [SECRET], allow: [ALLOW], maxStrikes: 5 }));
    // a legacy client (no guard, no v2, no ladder) must not wipe them
    const l = await O.req("PATCH", `/api/communities/${cid}/automod`, { words: ["سبام"], blockLinks: false, newAccountDays: 0, toxicity: "queue", action: "queue" });
    assert.equal(l.status, 200); assert.deepEqual(l.automod.guard.words, [SECRET]); assert.ok(l.automod.v2 && l.automod.ladder);
    const st = await settingsOf(cid); assert.deepEqual(st.automod.guard.words, [SECRET]);
  });

  test("round-trip through PATCH /settings/moderation keeps / replaces the guard", async () => {
    let r = await O.req("PATCH", `/api/communities/${cid}/settings/moderation`, { automod: { words: ["آخر"] } });
    assert.equal(r.status, 200, r.error); assert.deepEqual(r.values.automod.guard.words, [SECRET], "kept");
    r = await O.req("PATCH", `/api/communities/${cid}/settings/moderation`, { automod: { words: ["آخر"], guard: { enabled: false, words: [SECRET, "جديدة"] } } });
    assert.equal(r.values.automod.guard.enabled, false); assert.deepEqual(r.values.automod.guard.words, [SECRET, "جديدة"]);
    const s = await MO.req("GET", `/api/communities/${cid}/settings`); assert.equal(s.status, 200);
    assert.deepEqual(s.sections.moderation.values.automod.guard.words, [SECRET, "جديدة"]);
    await O.req("PATCH", `/api/communities/${cid}/automod`, { guard: { enabled: true, words: [SECRET], allow: [ALLOW] } });
  });

  test("privacy: members, outsiders and visitors never see the word / allow lists", async () => {
    const V = new H.Client();
    const probes = [
      await U.req("GET", `/api/communities/${cid}`), await X.req("GET", `/api/communities/${cid}`), await V.req("GET", `/api/communities/${cid}`),
      await U.req("GET", "/api/communities"), await V.req("GET", "/api/communities"),
      await U.req("GET", `/api/communities/${cid}/space`), await V.req("GET", `/api/communities/${cid}/space`)
    ];
    for (const p of probes) { const s = JSON.stringify(p); assert.ok(!s.includes(SECRET) && !s.includes(ALLOW), "leak in " + s.slice(0, 120)); }
    assert.ok([401, 403].includes((await U.req("GET", `/api/communities/${cid}/automod`)).status), "a member is refused the automod config");
    assert.ok([401, 403].includes((await V.req("GET", `/api/communities/${cid}/automod`)).status), "a visitor is refused");
    const us = await U.req("GET", `/api/communities/${cid}/settings`); assert.ok(!JSON.stringify(us).includes(SECRET));
    const vs = await V.req("GET", `/api/communities/${cid}/settings`); assert.ok(!JSON.stringify(vs).includes(SECRET));
  });

  test("audit log: guard changes are summarised, the words never stored in mod_actions", async () => {
    const rows = await db().all("SELECT * FROM mod_actions WHERE community=$1", [cid]);
    assert.ok(rows.some(r => /automod_updated|settings_updated/.test(r.action)));
    const s = JSON.stringify(rows); assert.ok(!s.includes(SECRET) && !s.includes(ALLOW));
    const log = await O.req("GET", `/api/communities/${cid}/modlog`); assert.ok(!JSON.stringify(log).includes(SECRET));
  });

  test("old v2.61 config: saving it stores no guard; a legacy patch leaves it byte-identical", async () => {
    const r = await O.req("PATCH", `/api/communities/${oldCid}/automod`, V261); assert.equal(r.status, 200, r.error);
    const st1 = await settingsOf(oldCid); assert.ok(!("guard" in st1.automod)); assert.deepEqual(st1.automod, CS.automodOf(V261));
    await O.req("PATCH", `/api/communities/${oldCid}/automod`, V261);
    const st2 = await settingsOf(oldCid); assert.equal(JSON.stringify(st2.automod), JSON.stringify(st1.automod));
    const s = await O.req("PATCH", `/api/communities/${oldCid}/settings/moderation`, { automod: V261 });
    assert.equal(s.status, 200); assert.ok(!("guard" in s.values.automod));
  });
});
