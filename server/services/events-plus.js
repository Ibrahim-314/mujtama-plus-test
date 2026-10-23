/* Advanced Events (Phase 19): recurring events, free tickets with capacity, automatic waitlist
 * promotion, QR check-in, reminders a day and an hour before (leased scheduled job + idempotent
 * reminder ledger), iCal export per event and a private calendar feed per user, and geocoding for
 * the event map. */
const crypto = require("node:crypto");
const { E, str, oneOf, id, now } = require("../lib/core");
const HOUR = 3600e3, DAY = 24 * HOUR;
const icsEsc = (s = "") => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const fold = (line) => { const out = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };
const RRULE = { weekly: "FREQ=WEEKLY", biweekly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY" };

module.exports = (ctx) => {
  const { db, router: R, rl } = ctx; const A = ctx.requireUser;
  const getEv = async (eid) => { const e = await db.get("SELECT * FROM events WHERE id=$1", [eid]); if (!e) throw E.nf("الفعالية غير موجودة"); return e; };
  /* v2.56: events of private / invite-only communities exist only for their members (404 for everyone else) */
  const getVisible = async (eid, uid) => { const e = await getEv(eid); if (!(await ctx.services.communities.canSeeEvent(e, uid))) throw E.nf("الفعالية غير موجودة"); return e; };
  const isOrganizer = async (e, uid) => e.organizer === uid || (e.community && ["owner", "admin", "moderator"].includes((await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [e.community, uid]))?.role));
  const ticketCode = () => Array.from(crypto.randomBytes(8), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  const counts = async (eid) => Object.fromEntries((await db.all("SELECT status, COUNT(*) n FROM event_tickets WHERE event=$1 GROUP BY status", [eid])).map(r => [r.status, Number(r.n)]));

  async function details(e, viewer) {
    const base = await ctx.services.communities.evClient(e), c = await counts(e.id);
    const confirmed = (c.confirmed || 0) + (c.checked_in || 0);
    const mine = viewer ? await db.get("SELECT * FROM event_tickets WHERE event=$1 AND user_id=$2", [e.id, viewer]) : null;
    let position = null; if (mine?.status === "waitlist") position = Number((await db.get("SELECT COUNT(*) n FROM event_tickets WHERE event=$1 AND status='waitlist' AND created_at <= $2", [e.id, mine.created_at])).n);
    const org = await db.get("SELECT id, name, handle, avatar, color FROM users WHERE id=$1", [e.organizer]);
    return { ...base, endsAt: e.ends_at, capacity: e.capacity, recurrence: e.recurrence, seriesId: e.series_id, lat: e.lat, lng: e.lng, address: e.address, onlineUrl: e.online_url, organizerUser: org,
      tickets: { confirmed, waitlist: c.waitlist || 0, checkedIn: c.checked_in || 0, remaining: e.capacity ? Math.max(0, e.capacity - confirmed) : null },
      myTicket: mine && mine.status !== "cancelled" ? { status: mine.status, code: mine.code, position, checkedInAt: mine.checked_in_at } : null, canManage: viewer ? await isOrganizer(e, viewer) : false, ics: `/e/${e.id}.ics` };
  }

  R.post("/api/events/plus", A(async (req) => {
    const b = req.body; const ev = await ctx.services.communities.createEvent(req.user, b);
    const ends = b.endsAt && !isNaN(new Date(b.endsAt)) && new Date(b.endsAt) > new Date(ev.startsAt) ? new Date(b.endsAt).toISOString() : null;
    const lat = Number.isFinite(+b.lat) && b.lat !== null && b.lat !== "" && Math.abs(+b.lat) <= 90 ? +b.lat : null, lng = Number.isFinite(+b.lng) && b.lng !== null && b.lng !== "" && Math.abs(+b.lng) <= 180 ? +b.lng : null;
    const online = /^https:\/\/[^\s]{4,300}$/.test(b.onlineUrl || "") ? b.onlineUrl : null;
    await db.run("UPDATE events SET ends_at=$1, capacity=$2, recurrence=$3, series_id=$4, lat=$5, lng=$6, address=$7, online_url=$8 WHERE id=$9", [ends, Number.isInteger(b.capacity) && b.capacity > 0 ? Math.min(b.capacity, 100000) : null, oneOf(b.recurrence, ["weekly", "biweekly", "monthly"], null), ev.id, lat, lng, str(b.address, 200), online, ev.id]);
    await db.run("DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2 AND kind='going'", [ev.id, req.user.id]); // organisers hold no ticket
    return { event: await details(await getEv(ev.id), req.user.id) };
  }));
  R.get("/api/events/:id/details", async (req) => ({ event: await details(await getVisible(req.params.id, req.user?.id), req.user?.id) }));

  /* ---- tickets & waitlist ---- */
  R.post("/api/events/:id/tickets", A(async (req) => {
    if (!rl.hit("default", "tkt:" + req.user.id)) throw E.rate();
    const e = await getVisible(req.params.id, req.user.id); if (e.status !== "upcoming") throw E.bad("انتهت الفعالية");
    const ex = await db.get("SELECT * FROM event_tickets WHERE event=$1 AND user_id=$2", [e.id, req.user.id]);
    if (ex && ex.status !== "cancelled") return { event: await details(e, req.user.id) };
    let status = "confirmed";
    await db.tx(async t => {
      if (db.dialect === "postgres") await t.get("SELECT id FROM events WHERE id=$1 FOR UPDATE", [e.id]); // serialise seat allocation
      const taken = Number((await t.get("SELECT COUNT(*) n FROM event_tickets WHERE event=$1 AND status IN ('confirmed','checked_in')", [e.id])).n);
      if (e.capacity && taken >= e.capacity) status = "waitlist";
      if (ex) await t.run("UPDATE event_tickets SET status=$1, created_at=$2, code=$3 WHERE id=$4", [status, now(), ticketCode(), ex.id]);
      else await t.run("INSERT INTO event_tickets(id,event,user_id,status,code,created_at) VALUES($1,$2,$3,$4,$5,$6)", [id("tk"), e.id, req.user.id, status, ticketCode(), now()]);
      if (status === "confirmed") await t.run("INSERT INTO event_rsvps(event_id,user_id,kind,at) VALUES($1,$2,'going',$3) ON CONFLICT DO NOTHING", [e.id, req.user.id, now()]);
    });
    return { event: await details(e, req.user.id) };
  }));
  async function promote(e) {
    if (!e.capacity) return null;
    const taken = Number((await db.get("SELECT COUNT(*) n FROM event_tickets WHERE event=$1 AND status IN ('confirmed','checked_in')", [e.id])).n); if (taken >= e.capacity) return null;
    const next = await db.get("SELECT * FROM event_tickets WHERE event=$1 AND status='waitlist' ORDER BY created_at LIMIT 1", [e.id]); if (!next) return null;
    const r = await db.run("UPDATE event_tickets SET status='confirmed' WHERE id=$1 AND status='waitlist'", [next.id]); if (!r.changes) return null;
    await db.run("INSERT INTO event_rsvps(event_id,user_id,kind,at) VALUES($1,$2,'going',$3) ON CONFLICT DO NOTHING", [e.id, next.user_id, now()]);
    await ctx.services.messaging.notify(next.user_id, "waitlist_promoted", { actor: e.organizer, ref: e.id });
    return next.user_id;
  }
  R.del("/api/events/:id/tickets", A(async (req) => {
    const e = await getEv(req.params.id); const t = await db.get("SELECT * FROM event_tickets WHERE event=$1 AND user_id=$2 AND status IN ('confirmed','waitlist')", [e.id, req.user.id]); if (!t) throw E.nf();
    await db.run("UPDATE event_tickets SET status='cancelled' WHERE id=$1", [t.id]); await db.run("DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2 AND kind='going'", [e.id, req.user.id]);
    const promoted = t.status === "confirmed" ? await promote(e) : null;
    return { event: await details(e, req.user.id), promoted: !!promoted };
  }));
  R.get("/api/events/:id/attendees", A(async (req) => {
    const e = await getEv(req.params.id); if (!(await isOrganizer(e, req.user.id))) throw E.forbid();
    const rows = await db.all("SELECT t.status, t.created_at, t.checked_in_at, u.id, u.name, u.handle, u.avatar, u.color FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event=$1 AND t.status<>'cancelled' ORDER BY CASE t.status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, t.created_at", [e.id]);
    return { attendees: rows.map(r => ({ user: { id: r.id, name: r.name, handle: r.handle, avatar: r.avatar, color: r.color }, status: r.status, at: r.created_at, checkedInAt: r.checked_in_at })) };
  }));
  /* ---- QR check-in: the ticket QR encodes "MPT:<event>:<code>" ---- */
  R.post("/api/events/:id/checkin", A(async (req) => {
    const e = await getEv(req.params.id); if (!(await isOrganizer(e, req.user.id))) throw E.forbid("تسجيل الحضور للمنظمين");
    const raw = String(req.body.code || "").trim().toUpperCase(); const m = /^MPT:([A-Z0-9_]+):([A-Z0-9]{8})$/i.exec(raw); const code = m ? m[2].toUpperCase() : raw;
    if (m && m[1].toLowerCase() !== e.id.toLowerCase()) throw E.bad("التذكرة لفعالية أخرى");
    const t = await db.get("SELECT t.*, u.name, u.handle FROM event_tickets t JOIN users u ON u.id=t.user_id WHERE t.event=$1 AND t.code=$2", [e.id, code]);
    if (!t || t.status === "cancelled") throw E.nf("تذكرة غير صالحة");
    if (t.status === "waitlist") throw E.bad(`${t.name} في قائمة الانتظار وليس لديه تذكرة مؤكدة`);
    if (t.status === "checked_in") return { already: true, attendee: { name: t.name, handle: t.handle }, at: t.checked_in_at };
    await db.run("UPDATE event_tickets SET status='checked_in', checked_in_at=$1 WHERE id=$2", [now(), t.id]);
    return { already: false, attendee: { name: t.name, handle: t.handle }, at: now() };
  }));

  /* ---- scheduled: reminders (24h & 1h), recurrence, past ---- */
  async function reminders() {
    const t = Date.now(); let sent = 0;
    const due = await db.all(`SELECT e.id, e.organizer, e.starts_at FROM events e WHERE e.status='upcoming' AND e.starts_at > $1 AND e.starts_at <= $2`, [new Date(t).toISOString(), new Date(t + DAY).toISOString()]);
    for (const e of due) {
      const left = new Date(e.starts_at) - t, kind = left <= HOUR ? "1h" : left > 2 * HOUR ? "24h" : null; if (!kind) continue;
      if (ctx.services.cinsights && !(await ctx.services.cinsights.reminderOn(e.id, kind))) continue; // v2.60: the community's default reminders
      const users = new Set([...(await db.all("SELECT user_id FROM event_tickets WHERE event=$1 AND status IN ('confirmed','checked_in')", [e.id])).map(r => r.user_id), ...(await db.all("SELECT user_id FROM event_rsvps WHERE event_id=$1 AND kind IN ('going','reminder')", [e.id])).map(r => r.user_id)]);
      for (const u of users) { const ins = await db.run("INSERT INTO reminder_log(event,user_id,kind,sent_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [e.id, u, kind, now()]); if (ins.changes) { sent++; await ctx.services.messaging.notify(u, kind === "1h" ? "event_1h" : "event_24h", { actor: e.organizer === u ? null : e.organizer, ref: e.id }); } }
    }
    return sent;
  }
  const nextDate = (d, rec) => { const x = new Date(d); if (rec === "monthly") x.setUTCMonth(x.getUTCMonth() + 1); else x.setTime(x.getTime() + (rec === "biweekly" ? 14 : 7) * DAY); return x; };
  async function rollRecurring() {
    let made = 0;
    for (const e of await db.all("SELECT * FROM events WHERE recurrence IS NOT NULL AND starts_at < $1 AND status IN ('upcoming','past')", [new Date(Date.now() - 3 * HOUR).toISOString()])) {
      const series = e.series_id || e.id; if (await db.get("SELECT 1 x FROM events WHERE series_id=$1 AND starts_at > $2", [series, e.starts_at])) continue;
      let start = nextDate(e.starts_at, e.recurrence); while (start < new Date()) start = nextDate(start, e.recurrence);
      const dur = e.ends_at ? new Date(e.ends_at) - new Date(e.starts_at) : null, nid = id("e");
      await db.run("INSERT INTO events(id,name,descr,starts_at,place,organizer,community,color,status,created_at,ends_at,capacity,recurrence,series_id,lat,lng,address,online_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'upcoming',$9,$10,$11,$12,$13,$14,$15,$16,$17)",
        [nid, e.name, e.descr, start.toISOString(), e.place, e.organizer, e.community, e.color, now(), dur ? new Date(start.getTime() + dur).toISOString() : null, e.capacity, e.recurrence, series, e.lat, e.lng, e.address, e.online_url]);
      made++;
    }
    return made;
  }
  async function tick() {
    const sent = await reminders(); const made = await rollRecurring();
    await db.run("UPDATE events SET status='past' WHERE status='upcoming' AND COALESCE(ends_at, starts_at) < $1", [new Date(Date.now() - 3 * HOUR).toISOString()]);
    return { sent, made };
  }
  ctx.scheduler.every("eventsTick", 60e3, tick);

  /* ---- iCal ---- */
  function vevent(e, origin) {
    const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * HOUR).toISOString();
    return ["BEGIN:VEVENT", `UID:${e.id}@mujtama.plus`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(e.starts_at)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${icsEsc(e.name)}`, `DESCRIPTION:${icsEsc((e.descr || "") + (e.online_url ? "\n" + e.online_url : ""))}`, `LOCATION:${icsEsc(e.address || e.place || "")}`,
      ...(e.lat !== null && e.lat !== undefined && e.lng !== null && e.lng !== undefined ? [`GEO:${e.lat};${e.lng}`] : []), `URL:${origin}/#/event/${e.id}`, ...(e.recurrence ? [`RRULE:${RRULE[e.recurrence]}`] : []),
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(e.name)}`, "TRIGGER:-PT1H", "END:VALARM", "END:VEVENT"].map(fold);
  }
  const cal = (events, origin, name) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mujtama Plus//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc(name)}`, ...events.flatMap(e => vevent(e, origin)), "END:VCALENDAR"].join("\r\n") + "\r\n";
  async function ics(req, res, url) {
    const origin = process.env.PUBLIC_URL || `http://${req.headers.host}`;
    let m = /^\/e\/([a-z]{1,3}_[a-z0-9]{6,24})\.ics$/i.exec(url.pathname);
    if (m) { const e = await db.get("SELECT * FROM events WHERE id=$1", [m[1]]); if (!e) return false; if (!(await ctx.services.communities.canSeeEvent(e, req.user?.id))) { res.writeHead(404); res.end(); return true; } res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="${e.id}.ics"`, "Cache-Control": "no-store" }); res.end(cal([e], origin, e.name)); return true; }
    m = /^\/cal\/([a-z]{1,3}_[a-z0-9]{6,24})\.([a-f0-9]{32})\.ics$/i.exec(url.pathname);
    if (m) {
      const u = await db.get("SELECT id, name, prefs FROM users WHERE id=$1", [m[1]]); if (!u || !u.prefs?.calToken || !crypto.timingSafeEqual(Buffer.from(u.prefs.calToken), Buffer.from(m[2]))) { res.writeHead(404); res.end(); return true; }
      const evs = await db.all("SELECT e.* FROM events e WHERE e.starts_at > $2 AND (e.organizer=$1 OR e.id IN (SELECT event FROM event_tickets WHERE user_id=$1 AND status IN ('confirmed','checked_in','waitlist')) OR e.id IN (SELECT event_id FROM event_rsvps WHERE user_id=$1 AND kind IN ('going','interested'))) ORDER BY e.starts_at LIMIT 300", [u.id, new Date(Date.now() - 30 * DAY).toISOString()]);
      res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900" }); res.end(cal(evs, origin, `فعالياتي · ${u.name}`)); return true;
    }
    return false;
  }
  R.get("/api/me/calendar", A(async (req) => {
    const u = await db.get("SELECT prefs FROM users WHERE id=$1", [req.user.id]); let token = u.prefs?.calToken;
    if (!token || req.query.rotate) { token = crypto.randomBytes(16).toString("hex"); await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [{ ...(u.prefs || {}), calToken: token }, req.user.id]); }
    return { url: `/cal/${req.user.id}.${token}.ics` };
  }));
  /* ---- geocoding for the map (OpenStreetMap Nominatim, cached; best effort) ---- */
  R.get("/api/geocode", A(async (req) => {
    const q = String(req.query.q || "").trim().slice(0, 120); if (q.length < 3) return { results: [] };
    return { results: await ctx.cache.wrap("geo:" + q, 24 * HOUR, async () => {
      try { const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ar&q=${encodeURIComponent(q)}`, { headers: { "User-Agent": "MujtamaPlus/2.5 (events map)" }, signal: AbortSignal.timeout(5000) }); const j = await r.json(); return j.map(x => ({ name: x.display_name, lat: +x.lat, lng: +x.lon })); } catch { return []; }
    }) };
  }));
  return { details, promote, reminders, rollRecurring, tick, ics, cal };
};
