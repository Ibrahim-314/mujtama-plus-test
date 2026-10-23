/* Hijri calendar and seasons «تقويم هجري ومواسم» (phase 68). Free for everyone; no external service.
 *  1. Calendar: Umm al-Qura (ICU) + admin moon-sighting overrides (lib/hijri.js). Today, month grids (Hijri month with
 *     Gregorian days, or a Gregorian month with Hijri days), two-way date converter.
 *  2. Occasions: Ramadan, the last ten nights, Eid al-Fitr, the ten days of Dhul-Hijjah, Hajj, Arafah, Eid al-Adha,
 *     Islamic new year, Ashura; optional «white days»; Gulf national days by country (SA founding + national day, AE, KW,
 *     QA, BH). iCal feed /hijri.ics for any calendar app.
 *  3. Season hubs (ramadan, eid_fitr, hajj, eid_adha): countdown or «day N of M», greeting, tips, public posts under the
 *     season hashtags (visibility rules of content.filterVisible), public community events inside the season window.
 *  4. Reminders: opt-in per season (N days before and / or on the first day) → season_soon / season_start notifications
 *     from a leased scheduled job, once per member, season and Hijri year.
 *  5. Admin: month-start overrides with validation (±2 days of Umm al-Qura, months stay 29–30 days) + audit. */
const { E, str, Classifier } = require("../lib/core");
const H = require("../lib/hijri");

const REMINDABLE = Object.keys(H.SEASONS);
const COUNTRIES = Object.keys(H.NATIONAL);

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, jobs?: boolean, now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = () => new Date(clock()).toISOString();
  const TZ = env.HIJRI_TZ || "Asia/Riyadh";
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };

  /* ---------- calendar with overrides (cached; any write invalidates) ---------- */
  let calP = null;
  const cal = () => (calP ||= (async () => {
    const rows = await db.all("SELECT hy, hm, starts_on FROM hijri_overrides").catch(() => []);
    return H.calendar(Object.fromEntries(rows.map((r) => [`${r.hy}-${r.hm}`, r.starts_on])));
  })().catch((e) => { calP = null; throw e; }));
  const tzOf = (q) => { const t = String(q || ""); try { if (t) { new Intl.DateTimeFormat("en", { timeZone: t }); return t; } } catch { /* bad tz */ } return TZ; };
  const countryOf = async (q, user) => {
    const c = String(q || "").toUpperCase(); if (COUNTRIES.includes(c)) return c;
    if (c === "NONE") return "NONE";
    const u = user ? String((await db.get("SELECT country FROM users WHERE id=$1", [user.id]).catch(() => null))?.country || "").toUpperCase() : "";
    return COUNTRIES.includes(u) ? u : "SA";
  };
  const hijriLabel = (h) => `${h.d} ${h.monthName} ${h.y} هـ`;
  const gLabel = (ymd) => { const [y, m, d] = ymd.split("-").map(Number); return `${d} ${H.G_MONTHS[m - 1]} ${y}`; };
  const day = (c, ymd) => { const h = c.toHijri(ymd); return { g: ymd, gLabel: gLabel(ymd), hijri: { y: h.y, m: h.m, d: h.d, monthName: h.monthName, label: hijriLabel(h) }, weekday: h.weekday }; };

  /* ---------- 1. today / month / convert ---------- */
  async function todayInfo(q = {}, user = null) {
    const c = await cal(), tz = tzOf(q.tz), t = H.today(tz, clock()), country = await countryOf(q.country, user);
    const end = H.ymdOf(H.dn(t) + 120);
    const occ = H.occasions(c, t, end, { country });
    const active = occ.filter((o) => o.start <= t && o.end >= t);
    const seasons = REMINDABLE.map((k) => ({ ...H.seasonState(c, k, t), name: H.SEASONS[k].name, emoji: H.SEASONS[k].emoji })).filter((s) => s.key).sort((a, b) => (a.start < b.start ? -1 : 1));
    const current = seasons.find((s) => s.active) || null;
    return { tz, country, today: day(c, t), active, upcoming: occ.filter((o) => o.start > t).slice(0, 8), seasons, current: current ? { ...current, greeting: H.SEASONS[current.key].greeting, hue: H.SEASONS[current.key].hue } : null, next: seasons.find((s) => !s.active) || null };
  }
  async function month(q = {}, user = null) {
    const c = await cal(), tz = tzOf(q.tz), t = H.today(tz, clock()), country = await countryOf(q.country, user), sunnah = q.sunnah === "1" || q.sunnah === true;
    const th = c.toHijri(t);
    const mode = q.cal === "g" ? "g" : "h";
    let first, len, title, sub, prev, next, head, overridden = null;
    if (mode === "h") {
      const y = Math.round(+q.y || th.y), m = Math.round(+q.m || th.m); if (!(y >= 1350 && y <= 1550 && m >= 1 && m <= 12)) throw E.bad("شهر غير صالح");
      first = H.dn(c.startYmd(y, m)); len = c.length(y, m);
      title = `${H.MONTHS[m - 1]} ${y} هـ`;
      const g0 = H.ymdOf(first), g1 = H.ymdOf(first + len - 1);
      sub = g0.slice(0, 7) === g1.slice(0, 7) ? `${H.G_MONTHS[+g0.slice(5, 7) - 1]} ${g0.slice(0, 4)}` : `${H.G_MONTHS[+g0.slice(5, 7) - 1]}${g0.slice(0, 4) !== g1.slice(0, 4) ? " " + g0.slice(0, 4) : ""} – ${H.G_MONTHS[+g1.slice(5, 7) - 1]} ${g1.slice(0, 4)}`;
      const pm = m === 1 ? [y - 1, 12] : [y, m - 1], nm = m === 12 ? [y + 1, 1] : [y, m + 1];
      prev = { y: pm[0], m: pm[1], label: H.MONTHS[pm[1] - 1] }; next = { y: nm[0], m: nm[1], label: H.MONTHS[nm[1] - 1] };
      const o = await db.get("SELECT starts_on, note FROM hijri_overrides WHERE hy=$1 AND hm=$2", [y, m]).catch(() => null);
      if (o) overridden = { startsOn: o.starts_on, note: o.note || null, umalqura: H.ymdOf(H.uqStart(y, m)) };
      head = { y, m };
    } else {
      const y = Math.round(+q.y || +t.slice(0, 4)), m = Math.round(+q.m || +t.slice(5, 7)); if (!(y >= 1930 && y <= 2120 && m >= 1 && m <= 12)) throw E.bad("شهر غير صالح");
      first = H.dn(`${y}-${String(m).padStart(2, "0")}-01`); len = new Date(Date.UTC(y, m, 0)).getUTCDate();
      title = `${H.G_MONTHS[m - 1]} ${y}`;
      const h0 = c.toHijri(first), h1 = c.toHijri(first + len - 1);
      sub = h0.m === h1.m ? `${h0.monthName} ${h0.y} هـ` : `${h0.monthName}${h0.y !== h1.y ? " " + h0.y : ""} – ${h1.monthName} ${h1.y} هـ`;
      const pm = m === 1 ? [y - 1, 12] : [y, m - 1], nm = m === 12 ? [y + 1, 1] : [y, m + 1];
      prev = { y: pm[0], m: pm[1], label: H.G_MONTHS[pm[1] - 1] }; next = { y: nm[0], m: nm[1], label: H.G_MONTHS[nm[1] - 1] };
      head = { y, m };
    }
    const from = H.ymdOf(first), to = H.ymdOf(first + len - 1);
    const occ = H.occasions(c, from, to, { country, sunnah });
    const days = [];
    for (let i = 0; i < len; i++) {
      const n = first + i, g = H.ymdOf(n), h = c.toHijri(n);
      days.push({ g, gd: +g.slice(8), hd: h.d, hm: h.m, wd: new Date(n * 864e5).getUTCDay(), today: g === t, occ: occ.filter((o) => o.start <= g && o.end >= g).map((o) => o.key) });
    }
    return { mode, ...head, title, sub, lead: new Date(first * 864e5).getUTCDay(), days, occasions: occ, prev, next, today: t, isCurrent: days.some((d) => d.today), overridden, country, weekdays: H.WEEKDAYS };
  }
  async function convert(q = {}) {
    const c = await cal();
    if (q.date) { if (!H.validYmd(String(q.date))) throw E.bad("تاريخ ميلادي غير صالح"); return { from: "g", ...day(c, String(q.date)) }; }
    let g; try { g = c.toGregorian(q.hy, q.hm, q.hd); } catch (e) { throw E.bad(/range/.test(e.message) ? "هذا الشهر الهجري أقصر من اليوم المطلوب" : "تاريخ هجري غير صالح"); }
    return { from: "h", ...day(c, g) };
  }
  async function config() {
    const rows = await db.all("SELECT hy, hm, starts_on FROM hijri_overrides ORDER BY hy, hm").catch(() => []);
    return { calendar: "islamic-umalqura", tz: TZ, overrides: Object.fromEntries(rows.map((r) => [`${r.hy}-${r.hm}`, r.starts_on])), months: H.MONTHS, countries: COUNTRIES };
  }

  /* ---------- 3. season hubs ---------- */
  const seasonTags = (key) => [...new Set(H.SEASONS[key].tags.flatMap((t) => Classifier.hashtags("#" + t)))];
  async function season(key, q = {}, user = null) {
    const def = H.SEASONS[key]; if (!def) throw E.nf("الموسم غير موجود");
    const c = await cal(), t = H.today(tzOf(q.tz), clock()), st = H.seasonState(c, key, t);
    const occ = st ? H.occasions(c, st.start, st.end, { country: "NONE" }).filter((o) => o.key !== key) : [];
    const tags = seasonTags(key), since = new Date(Math.min(clock(), Date.now()) - 60 * 864e5).toISOString();
    const ph = tags.map((_, i) => "$" + (i + 2)).join(",");
    const rows = tags.length ? await db.all(`SELECT DISTINCT p.* FROM post_hashtags h JOIN posts p ON p.id=h.post_id JOIN users u ON u.id=p.author WHERE h.created_at > $1 AND h.tag IN (${ph}) AND p.status='published' AND p.visibility='public' AND p.type<>'story' AND u.status='active' ORDER BY p.created_at DESC LIMIT 60`, [since, ...tags]) : [];
    const vis = rows.length ? (await ctx.services.content.filterVisible(rows, user?.id || null)).slice(0, 20) : [];
    const authors = vis.length ? await db.all(`SELECT id, name, handle, color FROM users WHERE id IN (${vis.map((_, i) => "$" + (i + 1)).join(",")})`, [...new Set(vis.map((p) => p.author))]).catch(() => []) : [];
    const ids = vis.map((p) => p.id);
    const rx = ids.length ? await db.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${ids.map((_, i) => "$" + (i + 1)).join(",")}) GROUP BY target`, ids) : [];
    const posts = vis.map((p) => { const a = authors.find((x) => x.id === p.author) || {}; return { id: p.id, type: p.type, title: p.title || null, text: String(p.text || "").replace(/\s+/g, " ").slice(0, 220), createdAt: p.created_at, author: { name: a.name, handle: a.handle, color: a.color }, reactions: Number(rx.find((x) => x.target === p.id)?.n || 0) }; });
    let events = [];
    if (st) {
      const a = new Date(H.dn(st.start) * 864e5 - 7 * 864e5).toISOString(), b = new Date((H.dn(st.end) + 1) * 864e5).toISOString();
      const ev = await db.all("SELECT e.id, e.name, e.starts_at, e.place, e.community, c.name cname, c.type ctype FROM events e LEFT JOIN communities c ON c.id=e.community WHERE e.status='upcoming' AND e.starts_at >= $1 AND e.starts_at < $2 ORDER BY e.starts_at LIMIT 40", [a, b]).catch(() => []);
      const mine = user ? new Set((await db.all("SELECT community FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned')", [user.id])).map((m) => m.community)) : new Set();
      events = ev.filter((e) => !e.community || e.ctype === "public" || mine.has(e.community)).slice(0, 12).map((e) => { const at = new Date(e.starts_at).toISOString(); return { id: e.id, name: e.name, startsAt: at, place: e.place || null, community: e.community ? { id: e.community, name: e.cname } : null, hijri: hijriLabel(c.toHijri(H.today(TZ, Date.parse(at)))) }; });
    }
    const rem = user ? await db.get("SELECT days_before, on_start FROM hijri_reminders WHERE user_id=$1 AND season=$2", [user.id, key]) : null;
    return { season: { key, name: def.name, emoji: def.emoji, hue: def.hue, greeting: def.greeting, tips: def.tips, tags: def.tags }, state: st ? { ...st, startLabel: day(c, st.start), endLabel: day(c, st.end) } : null, today: t, within: occ, posts, events,
      reminder: rem ? { daysBefore: Number(rem.days_before), onStart: !!Number(rem.on_start) } : null };
  }
  async function seasons(q = {}, user = null) {
    const c = await cal(), t = H.today(tzOf(q.tz), clock());
    const mine = user ? await db.all("SELECT season, days_before, on_start FROM hijri_reminders WHERE user_id=$1", [user.id]) : [];
    return { today: t, seasons: REMINDABLE.map((k) => { const s = H.seasonState(c, k, t), r = mine.find((x) => x.season === k); return { key: k, name: H.SEASONS[k].name, emoji: H.SEASONS[k].emoji, hue: H.SEASONS[k].hue, ...s, startLabel: s ? day(c, s.start) : null, reminder: r ? { daysBefore: Number(r.days_before), onStart: !!Number(r.on_start) } : null }; }).sort((a, b) => (a.start < b.start ? -1 : 1)) };
  }

  /* ---------- 4. reminders ---------- */
  async function setReminder(user, key, b = {}) {
    if (!REMINDABLE.includes(key)) throw E.nf("الموسم غير موجود");
    if (!rl.hit("default", "hijri:" + user.id)) throw E.rate();
    if (b.off) { await db.run("DELETE FROM hijri_reminders WHERE user_id=$1 AND season=$2", [user.id, key]); return { reminder: null }; }
    const days = [0, 1, 3, 7, 14].includes(+b.daysBefore) ? +b.daysBefore : 3, onStart = b.onStart === undefined ? 1 : b.onStart ? 1 : 0;
    await db.run("INSERT INTO hijri_reminders(user_id,season,days_before,on_start,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, season) DO UPDATE SET days_before=$3, on_start=$4", [user.id, key, days, onStart, iso()]);
    return { reminder: { daysBefore: days, onStart: !!onStart } };
  }
  /** idempotent: tells every opted-in member once per season, Hijri year and kind */
  async function tick() {
    const c = await cal(), t = H.today(TZ, clock()); let sent = 0;
    for (const key of REMINDABLE) {
      const st = H.seasonState(c, key, t); if (!st) continue;
      const rows = await db.all("SELECT user_id, days_before, on_start FROM hijri_reminders WHERE season=$1 LIMIT 20000", [key]);
      for (const r of rows) {
        let kind = null;
        if (st.active && st.dayOf <= 2 && Number(r.on_start)) kind = "start";
        else if (!st.active && Number(r.days_before) > 0 && st.daysLeft <= Number(r.days_before)) kind = "soon";
        if (!kind) continue;
        const ins = await db.run("INSERT INTO hijri_reminder_log(user_id,season,hijri_year,kind,sent_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [r.user_id, key, st.hijriYear, kind, iso()]);
        if (ins.changes) { await notify(r.user_id, kind === "start" ? "season_start" : "season_soon", key); sent++; }
      }
    }
    return { sent };
  }

  /* ---------- 5. admin overrides ---------- */
  async function adminView() {
    const c = await cal(), t = H.today(TZ, clock()), th = c.toHijri(t);
    const rows = await db.all("SELECT o.*, u.name FROM hijri_overrides o LEFT JOIN users u ON u.id=o.set_by ORDER BY hy DESC, hm DESC LIMIT 100");
    const upcoming = []; for (let i = -1; i <= 6; i++) { let y = th.y, m = th.m + i; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } upcoming.push({ y, m, name: H.MONTHS[m - 1], umalqura: H.ymdOf(H.uqStart(y, m)), starts: c.startYmd(y, m), length: c.length(y, m), overridden: rows.some((r) => +r.hy === y && +r.hm === m), current: i === 0 }); }
    return { today: day(c, t), months: upcoming, overrides: rows.map((r) => ({ y: +r.hy, m: +r.hm, name: H.MONTHS[r.hm - 1], startsOn: r.starts_on, umalqura: H.ymdOf(H.uqStart(+r.hy, +r.hm)), note: r.note || null, by: r.name || null, at: r.set_at })) };
  }
  async function setOverride(user, b = {}) {
    const y = Math.round(+b.y), m = Math.round(+b.m), s = String(b.startsOn || "");
    if (!(y >= 1400 && y <= 1500 && m >= 1 && m <= 12)) throw E.bad("الشهر الهجري غير صالح");
    const cur = (await config()).overrides; delete cur[`${y}-${m}`];
    const bad = H.checkOverride(cur, y, m, s); if (bad) throw E.bad(bad);
    if (s === H.ymdOf(H.uqStart(y, m))) await db.run("DELETE FROM hijri_overrides WHERE hy=$1 AND hm=$2", [y, m]);
    else await db.run("INSERT INTO hijri_overrides(hy,hm,starts_on,note,set_by,set_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (hy, hm) DO UPDATE SET starts_on=$3, note=$4, set_by=$5, set_at=$6", [y, m, s, str(b.note, 200) || null, user.id, iso()]);
    calP = null; await ctx.audit?.("HIJRI_OVERRIDE", `${y}-${m}`, s, user.id);
    return adminView();
  }
  async function clearOverride(user, y, m) {
    await db.run("DELETE FROM hijri_overrides WHERE hy=$1 AND hm=$2", [+y, +m]); calP = null;
    await ctx.audit?.("HIJRI_OVERRIDE_CLEARED", `${y}-${m}`, null, user.id);
    return adminView();
  }

  /* ---------- iCal feed: /hijri.ics?country=SA&sunnah=1 ---------- */
  async function ssr(req, res, url) {
    if (url.pathname !== "/hijri.ics") return false;
    const c = await cal(), t = H.today(TZ, clock()), country = await countryOf(url.searchParams.get("country"), null);
    const occ = H.occasions(c, H.ymdOf(H.dn(t) - 30), H.ymdOf(H.dn(t) + 730), { country, sunnah: url.searchParams.get("sunnah") === "1" });
    const esc = (s) => String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n"), d8 = (ymd) => ymd.replace(/-/g, "");
    const stamp = new Date(clock()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const ev = occ.map((o) => ["BEGIN:VEVENT", `UID:${o.key}-${o.hijriYear}-${d8(o.start)}@mujtama.plus`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d8(o.start)}`, `DTEND;VALUE=DATE:${d8(H.ymdOf(H.dn(o.end) + 1))}`, `SUMMARY:${esc(`${o.emoji} ${o.name}`)}`, `DESCRIPTION:${esc(`${hijriLabel(c.toHijri(o.start))} — حسب تقويم أم القرى وإعلانات الرؤية في مجتمع بلس`)}`, "TRANSP:TRANSPARENT", "END:VEVENT"].join("\r\n"));
    res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "public, max-age=3600", "Content-Disposition": 'inline; filename="hijri.ics"' });
    res.end(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mujtama Plus//Hijri//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:مواسم ومناسبات — مجتمع بلس", "X-WR-TIMEZONE:Asia/Riyadh", ...ev, "END:VCALENDAR", ""].join("\r\n"));
    return true;
  }

  /* ---------- routes ---------- */
  R.get("/api/hijri/today", async (req) => todayInfo(req.query, req.user));
  R.get("/api/hijri/month", async (req) => month(req.query, req.user));
  R.get("/api/hijri/convert", async (req) => convert(req.query));
  R.get("/api/hijri/config", async () => config());
  R.get("/api/hijri/seasons", async (req) => seasons(req.query, req.user));
  R.get("/api/hijri/seasons/:key", async (req) => season(req.params.key, req.query, req.user));
  R.put("/api/hijri/reminders/:key", A(async (req) => setReminder(req.user, req.params.key, req.body || {})));
  R.del("/api/hijri/reminders/:key", A(async (req) => setReminder(req.user, req.params.key, { off: true })));
  R.get("/api/admin/hijri", admin(async () => adminView()));
  R.put("/api/admin/hijri/overrides", admin(async (req) => setOverride(req.user, req.body || {})));
  R.del("/api/admin/hijri/overrides/:y/:m", admin(async (req) => clearOverride(req.user, req.params.y, req.params.m)));
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("hijri.tick", +(env.HIJRI_TICK_INTERVAL_MS || 60 * 60e3), () => tick());
  return { todayInfo, month, convert, config, season, seasons, setReminder, tick, adminView, setOverride, clearOverride, ssr, cal };
};
