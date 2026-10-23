/* Phase 68 — Hijri calendar and seasons: lib round-trips + known Umm al-Qura dates, overrides (validation, month moves,
 * neighbours stay 29–30 days), today / month grids (Hijri + Gregorian), converter, occasions + national days by country,
 * season hubs (hashtag posts honour visibility, events in window), reminders (idempotent soon / start notifications),
 * admin-only overrides with audit, /hijri.ics, migration 049 reversible + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const Hj = require("../lib/hijri");

let H, adminC, u1, u2, NOW = Date.parse("2027-02-05T09:00:00Z");
const db = () => H.app.ctx.db;
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
test.before(async () => {
  H = await boot({ hijriOpts: { jobs: false, now: () => NOW } });
  adminC = await mk("hj_admin"); u1 = await mk("hj_u1"); u2 = await mk("hj_u2");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("lib: Umm al-Qura known dates, round-trip 12 years, overrides validated", () => {
  const c = Hj.calendar();
  assert.deepEqual([c.toHijri("2026-10-17").y, c.toHijri("2026-10-17").m, c.toHijri("2026-10-17").d], [1448, 5, 6]);
  assert.equal(c.toGregorian(1448, 9, 1), "2027-02-08"); // Ramadan 1448
  assert.equal(c.toGregorian(1447, 12, 10), "2026-05-27"); // Eid al-Adha 1447
  let bad = 0; for (let n = Hj.dn("2022-01-01"); n < Hj.dn("2034-01-01"); n++) { const h = c.toHijri(n); if (c.toGregorian(h.y, h.m, h.d) !== Hj.ymdOf(n)) bad++; }
  assert.equal(bad, 0);
  assert.match(Hj.checkOverride({}, 1448, 9, "2027-02-12"), /يومين/);
  assert.match(Hj.checkOverride({}, 1448, 9, "2027-02-09"), /31/); // would make Sha'ban 31 days
  assert.equal(Hj.checkOverride({}, 1448, 9, "2027-02-07"), null);
  const c2 = Hj.calendar({ "1448-9": "2027-02-07" });
  assert.equal(c2.toHijri("2027-02-07").m, 9); assert.equal(c2.length(1448, 8), 29);
  assert.throws(() => c.toGregorian(1448, 9, 30)); // Ramadan 1448 has 29 days
});

test("today, month grids (Hijri + Gregorian), converter, occasions + national days", async () => {
  const t = await u1.req("GET", "/api/hijri/today?tz=Asia/Riyadh");
  assert.equal(t.status, 200, t.error);
  assert.equal(t.today.g, "2027-02-05"); assert.equal(t.today.hijri.m, 8);
  assert.equal(t.next.key, "ramadan"); assert.equal(t.next.daysLeft, 3);
  const m = await u1.req("GET", "/api/hijri/month?y=1448&m=9");
  assert.equal(m.status, 200, m.error);
  assert.equal(m.days.length, 29); assert.equal(m.days[0].g, "2027-02-08"); assert.equal(m.lead, 1); // a Monday
  assert.ok(m.days[0].occ.includes("ramadan")); assert.ok(m.days[20].occ.includes("last10"));
  assert.match(m.title, /رمضان 1448/);
  const g = await u1.req("GET", "/api/hijri/month?cal=g&y=2027&m=2&country=SA");
  assert.equal(g.days.length, 28); assert.ok(g.occasions.some((o) => o.key === "sa_founding" && o.start === "2027-02-22"));
  const kw = await u1.req("GET", "/api/hijri/month?cal=g&y=2027&m=2&country=KW");
  assert.ok(kw.occasions.some((o) => o.key === "kw_national")); assert.ok(!kw.occasions.some((o) => o.key === "sa_founding"));
  const sun = await u1.req("GET", "/api/hijri/month?y=1448&m=8&sunnah=1");
  assert.ok(sun.occasions.some((o) => o.key === "white_days"));
  assert.equal((await u1.req("GET", "/api/hijri/month?y=1200&m=1")).status, 400);
  const c1 = await u1.req("GET", "/api/hijri/convert?date=2027-03-09");
  assert.equal(c1.hijri.m, 10); assert.equal(c1.hijri.d, 1); assert.match(c1.hijri.label, /شوال 1448/);
  const c2 = await u1.req("GET", "/api/hijri/convert?hy=1448&hm=12&hd=9");
  assert.equal(c2.g, "2027-05-15");
  assert.equal((await u1.req("GET", "/api/hijri/convert?hy=1448&hm=9&hd=30")).status, 400);
  const cfg = await new H.Client().req("GET", "/api/hijri/config");
  assert.equal(cfg.calendar, "islamic-umalqura"); assert.deepEqual(cfg.overrides, {});
});

test("admin overrides: staff only, validated, move the month, audit; clearing restores", async () => {
  assert.equal((await u1.req("PUT", "/api/admin/hijri/overrides", { y: 1448, m: 9, startsOn: "2027-02-07" })).status, 403);
  const bad = await adminC.req("PUT", "/api/admin/hijri/overrides", { y: 1448, m: 9, startsOn: "2027-02-11" });
  assert.equal(bad.status, 400);
  const ok = await adminC.req("PUT", "/api/admin/hijri/overrides", { y: 1448, m: 9, startsOn: "2027-02-07", note: "إعلان المحكمة العليا" });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.overrides[0].startsOn, "2027-02-07");
  const m = await u1.req("GET", "/api/hijri/month?y=1448&m=9");
  assert.equal(m.days[0].g, "2027-02-07"); assert.equal(m.overridden.startsOn, "2027-02-07"); assert.equal(m.overridden.umalqura, "2027-02-08");
  assert.equal((await u1.req("GET", "/api/hijri/config")).overrides["1448-9"], "2027-02-07");
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='HIJRI_OVERRIDE'"));
  const cl = await adminC.req("DELETE", "/api/admin/hijri/overrides/1448/9");
  assert.equal(cl.status, 200); assert.equal((await u1.req("GET", "/api/hijri/month?y=1448&m=9")).days[0].g, "2027-02-08");
  const v = await adminC.req("GET", "/api/admin/hijri"); assert.equal(v.months.length, 8); assert.ok(v.months.some((x) => x.current));
});

test("season hub: posts under season hashtags respect visibility; events inside the window; reminders idempotent", async () => {
  H.app.ctx.rl.w.clear();
  const p1 = await u1.req("POST", "/api/posts", { type: "post", text: "استعدادات #رمضان هذا العام في جدة" }); assert.equal(p1.status, 200, p1.error);
  H.app.ctx.rl.w.clear();
  const p2 = await u2.req("POST", "/api/posts", { type: "post", text: "منشور خاص #رمضان", visibility: "followers" }); assert.equal(p2.status, 200, p2.error);
  const anon = await new H.Client().req("GET", "/api/hijri/seasons/ramadan");
  assert.equal(anon.status, 200, anon.error);
  assert.ok(anon.posts.some((p) => p.id === p1.post.id)); assert.ok(!anon.posts.some((p) => p.id === p2.post.id));
  assert.equal(anon.state.active, false); assert.equal(anon.state.daysLeft, 3); assert.ok(anon.within.some((o) => o.key === "last10"));
  assert.equal((await u1.req("GET", "/api/hijri/seasons/nope")).status, 404);
  // reminders
  assert.equal((await new H.Client().req("PUT", "/api/hijri/reminders/ramadan", { daysBefore: 3 })).status, 401);
  const r = await u1.req("PUT", "/api/hijri/reminders/ramadan", { daysBefore: 3, onStart: true }); assert.equal(r.status, 200, r.error);
  await u2.req("PUT", "/api/hijri/reminders/ramadan", { daysBefore: 1 });
  const svc = H.app.ctx.services.hijri;
  assert.equal((await svc.tick()).sent, 1); // u1: 3 days before; u2 waits (1 day)
  assert.equal((await svc.tick()).sent, 0); // idempotent
  NOW = Date.parse("2027-02-07T09:00:00Z"); assert.equal((await svc.tick()).sent, 1); // u2 now
  NOW = Date.parse("2027-02-08T09:00:00Z"); assert.equal((await svc.tick()).sent, 2); // both: first day
  assert.equal((await svc.tick()).sent, 0);
  const kinds = (await db().all("SELECT kind FROM notifications WHERE user_id=$1 ORDER BY created_at", [u1.id]).catch(() => [])).map((x) => x.kind);
  assert.ok(kinds.includes("season_soon") && kinds.includes("season_start"), kinds.join(","));
  const now = await u1.req("GET", "/api/hijri/seasons/ramadan"); assert.equal(now.state.active, true); assert.equal(now.state.dayOf, 1); assert.deepEqual(now.reminder, { daysBefore: 3, onStart: true });
  const all = await u1.req("GET", "/api/hijri/seasons"); assert.equal(all.seasons[0].key, "ramadan");
  assert.equal((await u1.req("DELETE", "/api/hijri/reminders/ramadan")).status, 200);
  NOW = Date.parse("2027-02-05T09:00:00Z");
});

test("/hijri.ics feed + migration 049 reversible + data map", async () => {
  const r = await fetch(H.base + "/hijri.ics?country=SA");
  assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/calendar/);
  const body = await r.text(); assert.match(body, /BEGIN:VCALENDAR/); assert.match(body, /DTSTART;VALUE=DATE:20270208/); assert.match(body, /اليوم الوطني السعودي/);
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '049_hijri' ORDER BY id")).map((x) => x.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "049_hijri"]);
  await assert.rejects(() => db().get("SELECT 1 FROM hijri_reminders"));
  assert.deepEqual(await mig.up(db()), ["049_hijri", ...after]);
  const L = require("../lib/compliance-lib"), m = L.DATA_MAP.find((x) => x.t === "hijri_reminders"); assert.ok(m);
  await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [u1.id]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
});
