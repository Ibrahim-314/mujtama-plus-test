/* Phase 45 — digital wellbeing. SQLite by default and PostgreSQL with TEST_DATABASE_URL. Injectable clock.
 * Covers: migration 028 (down/up, static additive), ISO week helpers, settings defaults/validation/persistence (free for all),
 * opt-in rule for weekly totals (403 before opting in, validation, upsert, no future / too-old weeks), opt-out deletes every
 * stored week, weekly report job (one in-app notification per finished week, never the current week, respects weekly_report,
 * no email without SMTP), retention prune, notify kind + href, compliance data map. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let offset = 0;
const now = () => new Date(Date.now() + offset);
const DAY = 864e5;
let H, sara, omar;
const db = () => H.app.ctx.db;
const wb = () => H.app.ctx.services.wellbeing;
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
};

test.before(async () => {
  H = await boot({ wellbeingOpts: { jobs: false, now } });
  sara = await mk("sara_wb"); omar = await mk("omar_wb");
});
test.after(async () => { await H.app.close(); });

test("migration 028: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '028_wellbeing' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "028_wellbeing"]);
  await assert.rejects(() => db().get("SELECT 1 FROM wellbeing_settings"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ai_plans")).n) >= 0, "024 tables untouched");
  assert.deepEqual(await mig.up(db()), ["028_wellbeing", ...later]);
  for (const t of ["wellbeing_settings", "wellbeing_weekly"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some((x) => x.file === "028_wellbeing.js"));
});

test("ISO week helpers", () => {
  const W = require("../services/wellbeing");
  assert.equal(W.isoWeek(new Date("2026-10-16T12:00:00Z")), "2026-W42");
  assert.equal(W.isoWeek(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(W.isoWeek(new Date("2024-12-30T00:00:00Z")), "2025-W01");
  assert.equal(W.weekStart("2026-W42").toISOString().slice(0, 10), "2026-10-12");
  assert.equal(W.weekStart("2025-W53"), null, "2025 has 52 weeks");
  assert.equal(W.weekStart("2026-42"), null);
});

test("settings: defaults, validation, persistence, free for everyone", async () => {
  const anon = new H.Client();
  assert.equal((await anon.req("GET", "/api/wellbeing/settings")).status, 401);
  const cfg = await anon.req("GET", "/api/wellbeing/config");
  assert.equal(cfg.status, 200); assert.equal(cfg.free, true); assert.equal(cfg.localOnly, true); assert.equal(cfg.email, false);
  let r = await sara.req("GET", "/api/wellbeing/settings");
  assert.deepEqual({ ...r.settings, updatedAt: undefined }, { breakMinutes: 0, dailyLimitMinutes: 0, hideCounts: false, focus: false, weeklyReport: true, shareTotals: false, emailReport: false, updatedAt: undefined });
  for (const bad of [{ breakMinutes: 17 }, { dailyLimitMinutes: 5 }, { dailyLimitMinutes: 601 }, { dailyLimitMinutes: 1.5 }, { hideCounts: "yes" }, { focus: 1 }]) {
    r = await sara.req("PUT", "/api/wellbeing/settings", bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.code, "settings_invalid");
  }
  r = await sara.req("PUT", "/api/wellbeing/settings", { breakMinutes: 20, dailyLimitMinutes: 90, hideCounts: true, focus: true });
  assert.equal(r.status, 200); assert.equal(r.settings.breakMinutes, 20); assert.equal(r.settings.hideCounts, true); assert.equal(r.settings.focus, true);
  r = await sara.req("PUT", "/api/wellbeing/settings", { focus: false }); // partial update keeps the rest
  assert.equal(r.settings.focus, false); assert.equal(r.settings.dailyLimitMinutes, 90); assert.equal(r.settings.hideCounts, true);
  assert.equal((await omar.req("GET", "/api/wellbeing/settings")).settings.hideCounts, false, "per user");
});

test("weekly totals: opt-in only, validated, upserted; opt-out forgets everything", async () => {
  const cur = wb().isoWeek(now()), prev = wb().isoWeek(new Date(now().getTime() - 7 * DAY));
  let r = await omar.req("POST", "/api/wellbeing/weekly", { week: prev, seconds: 3600, sessions: 4, days: 2 });
  assert.equal(r.status, 403); assert.equal(r.code, "not_opted_in");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM wellbeing_weekly")).n), 0, "nothing stored without opt-in");
  await omar.req("PUT", "/api/wellbeing/settings", { shareTotals: true });
  const future = wb().isoWeek(new Date(now().getTime() + 14 * DAY)), old = wb().isoWeek(new Date(now().getTime() - 70 * DAY));
  for (const bad of [{ week: future, seconds: 1, sessions: 1, days: 1 }, { week: old, seconds: 1, sessions: 1, days: 1 }, { week: prev, seconds: 7 * 86400 + 1, sessions: 1, days: 7 },
    { week: prev, seconds: 100, sessions: 1, days: 0 }, { week: prev, seconds: -1, sessions: 0, days: 0 }, { week: "2026-W99", seconds: 0, sessions: 0, days: 0 }, { week: prev, seconds: 1, sessions: 1, days: 8 }]) {
    r = await omar.req("POST", "/api/wellbeing/weekly", bad); assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.code, "totals_invalid");
  }
  r = await omar.req("POST", "/api/wellbeing/weekly", { weeks: [{ week: prev, seconds: 3600, sessions: 4, days: 2 }, { week: cur, seconds: 600, sessions: 1, days: 1 }] });
  assert.equal(r.status, 200); assert.deepEqual(r.saved, [prev, cur]);
  r = await omar.req("POST", "/api/wellbeing/weekly", { week: prev, seconds: 5400, sessions: 6, days: 3 });
  assert.equal(r.status, 200);
  r = await omar.req("GET", "/api/wellbeing/weekly");
  assert.deepEqual(r.weeks.map((w) => [w.week, w.seconds, w.sessions, w.days]), [[cur, 600, 1, 1], [prev, 5400, 6, 3]]);
  const cols = (await db().all("SELECT * FROM wellbeing_weekly WHERE user_id=$1", [omar.id]))[0];
  assert.deepEqual(Object.keys(cols).sort(), ["days", "reported_at", "seconds", "sessions", "updated_at", "user_id", "week"], "aggregates only");
  await omar.req("PUT", "/api/wellbeing/settings", { shareTotals: false });
  assert.equal((await omar.req("GET", "/api/wellbeing/weekly")).weeks.length, 0, "opt-out deletes the stored weeks");
  assert.equal((await omar.req("POST", "/api/wellbeing/weekly", { week: prev, seconds: 1, sessions: 1, days: 1 })).status, 403);
  await omar.req("PUT", "/api/wellbeing/settings", { shareTotals: true });
  await omar.req("POST", "/api/wellbeing/weekly", { week: prev, seconds: 60, sessions: 1, days: 1 });
  r = await omar.req("DELETE", "/api/wellbeing/weekly"); assert.equal(r.status, 200); assert.equal(r.deleted, 1);
});

test("weekly report job: one in-app notification per finished week, no email without SMTP, retention prune", async () => {
  const cur = wb().isoWeek(now()), prev = wb().isoWeek(new Date(now().getTime() - 7 * DAY));
  await sara.req("PUT", "/api/wellbeing/settings", { shareTotals: true, emailReport: true });
  await sara.req("POST", "/api/wellbeing/weekly", { weeks: [{ week: prev, seconds: 7200, sessions: 9, days: 4 }, { week: cur, seconds: 300, sessions: 1, days: 1 }] });
  await omar.req("PUT", "/api/wellbeing/settings", { weeklyReport: false });
  await omar.req("POST", "/api/wellbeing/weekly", { week: prev, seconds: 60, sessions: 1, days: 1 });
  let r = await wb().report();
  assert.equal(r.notified, 1); assert.equal(r.emailed, 0, "SMTP not configured → no email");
  const ns = await db().all("SELECT * FROM notifications WHERE kind='wellbeing_weekly'");
  assert.equal(ns.length, 1); assert.equal(ns[0].user_id, sara.id); assert.equal(ns[0].ref, prev);
  r = await wb().report(); assert.equal(r.notified, 0, "only once per week");
  const L = require("../lib/notify-lib");
  assert.equal(L.hrefFor({ kind: "wellbeing_weekly", ref: prev }), "/#/wellbeing");
  assert.equal(L.sentence("wellbeing_weekly", [], 1).includes("تقرير"), true);
  const list = await sara.req("GET", "/api/notifications");
  assert.equal(list.status, 200);
  offset = 7 * DAY; // the current week ends → reported next run
  r = await wb().report(); assert.equal(r.notified, 1);
  offset = 70 * DAY; // retention: weeks older than 8 weeks are pruned
  r = await wb().report(); assert.ok(r.pruned >= 2);
  offset = 0;
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM wellbeing_weekly WHERE user_id=$1", [sara.id])).n), 0);
});

test("compliance data map covers the wellbeing tables", async () => {
  const C = require("../lib/compliance-lib");
  for (const t of ["wellbeing_settings", "wellbeing_weekly"]) {
    const m = C.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); assert.equal(m.erase, "delete");
    for (const c of m.cols) await db().get(`SELECT ${c} FROM ${t} LIMIT 1`);
  }
});
