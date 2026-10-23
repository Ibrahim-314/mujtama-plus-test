/* Nearby events and places on a map (phase 66).
 *  1. Approximate location, opt-in: the device turns its position into a 5-character geohash (≈ 5 km cell) and sends only
 *     that — or the member picks a city. Stored in geo_prefs only when they switch it on; one tap deletes it. Longer hashes
 *     are cut to 5 characters before anything is stored. Minors (phase 34/35): the opt-in is refused, any stored row is
 *     purged, and their searches use a city only.
 *  2. Places: members submit public places (name, category, pin, address, hours, link) → automated screening (automod) →
 *     moderation queue → approved places appear on the map; reports hide a place for review after PLACES_HIDE_REPORTS.
 *  3. Events from phase 19 that their organisers pinned (lat/lng) appear on the map; events of private / invite-only
 *     communities only for their members; past and cancelled events never.
 *  4. Nearby search: centre (cell centre / city centre / a public place) + radius 1–50 km → bounding-box pre-filter on
 *     indexed lat/lng, then exact great-circle distance; distances are shown rounded (the centre itself is approximate).
 *  5. City pages: the gazetteer cities (lib/geo.js) with events, places by category, local communities and the phase 23
 *     location trends for that city.
 *  6. Map config for the client: OpenStreetMap standard tiles (no key, attribution shown, no prefetch / bulk download,
 *     usage policy https://operations.osmfoundation.org/policies/tiles/), swappable with MAP_TILE_URL. */
const { E, str, oneOf, id, now } = require("../lib/core");
const G = require("../lib/geohash");
const geo = require("../lib/geo");
const AR = require("../lib/arabic");

const CATS = { mosque: "مسجد", cafe: "مقهى", restaurant: "مطعم", library: "مكتبة", park: "حديقة", coworking: "مساحة عمل", education: "تعليم وتدريب", health: "صحة", shop: "متجر", culture: "ثقافة وفنون", sports: "رياضة", community: "مركز مجتمعي", other: "أخرى" };
const REPORT_REASONS = { wrong: "معلومات خاطئة", closed: "مغلق نهائياً", duplicate: "مكرر", inappropriate: "محتوى غير لائق", private: "منزل أو مكان خاص", spam: "إعلان مزعج", pi_false: "لا يقبل Pi فعلياً", fake_owner: "ينتحل صفة صاحب النشاط" }; // v2.30: last two for the phase 67 business directory
const DAY = 864e5;

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl, cache } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const HIDE_AT = Math.max(2, +(env.PLACES_HIDE_REPORTS || 3));
  const PENDING_MAX = Math.max(1, +(env.PLACES_PENDING_MAX || 10));
  const TILE = /^https:\/\/[a-z0-9.-]+(:\d+)?\/[^\s"'<>]*\{z\}[^\s"'<>]*\{x\}[^\s"'<>]*\{y\}[^\s"'<>]*$/i.test(env.MAP_TILE_URL || "") ? env.MAP_TILE_URL : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const ATTR = str(env.MAP_ATTRIBUTION || "", 200) || "© مساهمو OpenStreetMap";
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("للمشرفين فقط"); return fn(req, res); });
  const isMinor = async (uid) => { if (!uid) return false; try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const cityOf = (lat, lng, address) => { const n = G.nearestCity(lat, lng, 60); if (n) return { city: n.city, country: geo.resolve(n.city).country }; const r = geo.resolve(address || ""); return { city: r.city, country: r.country }; };
  const normName = (s) => AR.normalize(String(s || "")).replace(/\s+/g, " ").trim();

  /* ======================= 1. approximate location ======================= */
  async function myLocation(user) {
    if (await isMinor(user.id)) { await db.run("DELETE FROM geo_prefs WHERE user_id=$1", [user.id]); return { enabled: false, minor: true, allowed: false, note: "مشاركة الموقع غير متاحة لحسابات القاصرين. يمكنك تصفح الخريطة باختيار مدينة." }; }
    const r = await db.get("SELECT * FROM geo_prefs WHERE user_id=$1", [user.id]);
    if (!r || !r.enabled) return { enabled: false, allowed: true, radiusKm: r?.radius_km || 10 };
    const c = r.geohash ? G.decode(r.geohash) : null;
    return { enabled: true, allowed: true, geohash: r.geohash, city: r.city, country: r.country, radiusKm: r.radius_km, source: r.source, updatedAt: r.updated_at,
      cell: c ? { lat: c.lat, lng: c.lng, kmAcross: Math.round(c.latErr * 2 * 110.574 * 10) / 10 } : null };
  }
  async function setLocation(user, b = {}) {
    if (await isMinor(user.id)) { await db.run("DELETE FROM geo_prefs WHERE user_id=$1", [user.id]); throw Object.assign(E.forbid("مشاركة الموقع غير متاحة لحسابات القاصرين"), { code: "minor_location" }); }
    if (!rl.hit("default", "geo:" + user.id)) throw E.rate();
    let gh = null, city = null, country = null, source = null;
    if (b.geohash !== undefined && b.geohash !== null && b.geohash !== "") {
      if (!G.valid(String(b.geohash).toLowerCase())) throw E.bad("رمز الموقع غير صالح");
      gh = G.coarsen(String(b.geohash).toLowerCase()); source = "device";
      const c = G.decode(gh); const n = G.nearestCity(c.lat, c.lng, 60); if (n) { city = n.city; country = geo.resolve(n.city).country; }
    }
    if (b.city) { const r = geo.resolve(String(b.city)); if (!r.city || !G.CITY_CENTERS[r.city]) throw E.bad("مدينة غير معروفة"); if (!gh) { city = r.city; country = r.country; source = "city"; } }
    if (!gh && !city) throw E.bad("اختر مدينة أو استخدم موقع جهازك التقريبي");
    const radius = Math.max(1, Math.min(50, Math.round(+b.radiusKm || 10)));
    await db.run(`INSERT INTO geo_prefs(user_id,enabled,geohash,city,country,radius_km,source,updated_at) VALUES($1,1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (user_id) DO UPDATE SET enabled=1, geohash=excluded.geohash, city=excluded.city, country=excluded.country, radius_km=excluded.radius_km, source=excluded.source, updated_at=excluded.updated_at`, [user.id, gh, city, country, radius, source, now()]);
    return myLocation(user);
  }
  async function clearLocation(user) { await db.run("DELETE FROM geo_prefs WHERE user_id=$1", [user.id]); return { enabled: false, deleted: true }; }

  /* ======================= 2. centre + nearby search ======================= */
  async function centre(user, q) {
    const minor = user ? await isMinor(user.id) : false;
    if (q.place) { const p = await db.get("SELECT id, name, lat, lng FROM places WHERE id=$1 AND status='approved'", [String(q.place)]); if (p) return { lat: p.lat, lng: p.lng, label: p.name, source: "place", approx: false }; }
    // a browsing area (the map was panned there) — not the member's position, never stored; allowed for everyone
    if (q.area && G.valid(String(q.area).toLowerCase())) { const h = G.coarsen(String(q.area).toLowerCase()); const c = G.decode(h); return { lat: c.lat, lng: c.lng, label: G.nearestCity(c.lat, c.lng, 60)?.city || "المنطقة المعروضة", source: "area", approx: true, precision: h.length }; }
    if (q.gh && !minor) { const h = G.coarsen(String(q.gh).toLowerCase()); if (h) { const c = G.decode(h); return { lat: c.lat, lng: c.lng, label: G.nearestCity(c.lat, c.lng, 60)?.city || "موقعك التقريبي", source: "device", approx: true, precision: h.length }; } }
    if (q.city) { const r = geo.resolve(String(q.city)); const c = r.city && G.CITY_CENTERS[r.city]; if (c) return { lat: c[0], lng: c[1], label: r.city, city: r.city, source: "city", approx: true }; throw E.bad("مدينة غير معروفة"); }
    if (user && !minor) {
      const pr = await db.get("SELECT * FROM geo_prefs WHERE user_id=$1 AND enabled=1", [user.id]);
      if (pr?.geohash) { const c = G.decode(pr.geohash); return { lat: c.lat, lng: c.lng, label: pr.city || "موقعك التقريبي", source: "saved", approx: true, precision: pr.geohash.length, radiusKm: pr.radius_km }; }
      if (pr?.city && G.CITY_CENTERS[pr.city]) { const c = G.CITY_CENTERS[pr.city]; return { lat: c[0], lng: c[1], label: pr.city, city: pr.city, source: "saved", approx: true, radiusKm: pr.radius_km }; }
    }
    if (user) { const u = await db.get("SELECT location, country FROM users WHERE id=$1", [user.id]); const r = geo.resolve(u?.location, u?.country); if (r.city && G.CITY_CENTERS[r.city]) { const c = G.CITY_CENTERS[r.city]; return { lat: c[0], lng: c[1], label: r.city, city: r.city, source: "profile", approx: true }; } }
    return null;
  }
  async function visibleEvent(e, uid) {
    if (!e.community) return true;
    const c = await db.get("SELECT type FROM communities WHERE id=$1", [e.community]);
    if (!c || c.type === "public") return true;
    if (!uid) return false;
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [e.community, uid]);
    return !!m && !["pending", "banned"].includes(m.role);
  }
  const placeClient = (p, extra = {}) => ({ kind: "place", id: p.id, name: p.name, category: p.category, categoryLabel: CATS[p.category] || p.category, descr: p.descr || "", address: p.address || "", lat: p.lat, lng: p.lng, city: p.city, country: p.country, url: p.url || null, hours: p.hours || null, status: p.status, href: `#/place/${p.id}`, ...extra });
  const eventClient = (e, extra = {}) => ({ kind: "event", id: e.id, name: e.name, place: e.place, address: e.address || "", lat: e.lat, lng: e.lng, startsAt: e.starts_at, endsAt: e.ends_at || null, community: e.community || null, color: e.color, href: `#/event/${e.id}`, ...extra });

  async function around(user, c, radiusKm, { kinds = ["events", "places"], category = null, q = "", limit = 200 } = {}) {
    const [a, b, cc, d] = G.bbox(c.lat, c.lng, radiusKm), items = [], uid = user?.id || null;
    const qn = q ? normName(q) : "";
    if (kinds.includes("places")) {
      const rows = await db.all(`SELECT * FROM places WHERE status='approved' AND lat >= $1 AND lat <= $2 AND lng >= $3 AND lng <= $4 ${category ? "AND category=$5" : ""} AND NOT EXISTS (SELECT 1 FROM businesses b WHERE b.place_id=places.id AND b.home_based=1) LIMIT 2000`, category ? [a, cc, b, d, category] : [a, cc, b, d]);
      for (const p of rows) { const km = G.haversine(c.lat, c.lng, p.lat, p.lng); if (km <= radiusKm && (!qn || normName(p.name + " " + (p.descr || "")).includes(qn))) items.push(placeClient(p, { km, distanceKm: G.approxKm(km) })); }
    }
    if (kinds.includes("events") && !category) {
      const rows = await db.all("SELECT * FROM events WHERE status='upcoming' AND lat IS NOT NULL AND lng IS NOT NULL AND lat >= $1 AND lat <= $2 AND lng >= $3 AND lng <= $4 AND starts_at > $5 ORDER BY starts_at LIMIT 1000", [a, cc, b, d, new Date(Date.now() - 6 * 3600e3).toISOString()]);
      for (const e of rows) { const km = G.haversine(c.lat, c.lng, e.lat, e.lng); if (km <= radiusKm && (!qn || normName(e.name + " " + (e.descr || "")).includes(qn)) && (await visibleEvent(e, uid))) items.push(eventClient(e, { km, distanceKm: G.approxKm(km) })); }
    }
    items.sort((x, y) => x.km - y.km || (x.kind === "event" && y.kind === "event" ? (x.startsAt < y.startsAt ? -1 : 1) : 0));
    const out = items.slice(0, limit).map(({ km, ...rest }) => rest), evs = out.filter((x) => x.kind === "event");
    if (evs.length) { // v2.29: RSVP from the map — going count and my own answer
      const rs = await db.all(`SELECT event_id, user_id, kind FROM event_rsvps WHERE kind IN ('going','interested') AND event_id IN (${evs.map((_, i) => "$" + (i + 1)).join(",")})`, evs.map((e) => e.id));
      for (const e of evs) { const mine = rs.filter((r) => r.event_id === e.id); e.going = mine.filter((r) => r.kind === "going").length; e.myRsvp = uid ? (mine.some((r) => r.user_id === uid && r.kind === "going") ? "going" : mine.some((r) => r.user_id === uid && r.kind === "interested") ? "interested" : null) : null; }
    }
    return out;
  }
  async function nearby(user, q) {
    const c = await centre(user, q || {});
    const cities = Object.keys(G.CITY_CENTERS).map((name) => ({ name, country: geo.resolve(name).country }));
    if (!c) return { center: null, items: [], cities, minor: user ? await isMinor(user.id) : false, note: "اختر مدينة أو فعّل موقعك التقريبي لعرض ما حولك.", categories: Object.entries(CATS).map(([key, label]) => ({ key, label })) };
    const radiusKm = Math.max(1, Math.min(50, Math.round(+q.radius || c.radiusKm || 10)));
    const kinds = String(q.kinds || "events,places").split(",").filter((k) => ["events", "places"].includes(k));
    const category = q.category && CATS[q.category] ? q.category : null;
    const items = await around(user, c, radiusKm, { kinds: kinds.length ? kinds : ["events", "places"], category, q: typeof q.q === "string" ? q.q.slice(0, 60) : "" });
    const { radiusKm: _r, ...center } = c;
    return { center, radiusKm, items, counts: { events: items.filter((x) => x.kind === "event").length, places: items.filter((x) => x.kind === "place").length }, cities,
      categories: Object.entries(CATS).map(([key, label]) => ({ key, label })), minor: user ? await isMinor(user.id) : false };
  }

  /* ======================= 3. places (submit, moderate, report) ======================= */
  function readPlace(b, partial = false, prev = null) {
    const out = {};
    if (!partial || b.name !== undefined) out.name = str(b.name, 80, { required: true, min: 2 });
    if (!partial || b.category !== undefined) { out.category = oneOf(b.category, Object.keys(CATS), null); if (!out.category) throw E.bad("اختر تصنيفاً"); }
    if (!partial || b.descr !== undefined) out.descr = str(b.descr, 500) || "";
    if (!partial || b.address !== undefined) out.address = str(b.address, 200) || "";
    if (!partial || b.hours !== undefined) out.hours = str(b.hours, 120) || null;
    if (!partial || b.hoursWeek !== undefined) { const w = b.hoursWeek === undefined ? null : readWeek(b.hoursWeek); out.hours_week = w ? JSON.stringify(w) : null; }
    if (!partial || b.url !== undefined) { const u = str(b.url, 300); if (u && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u)) throw E.bad("الرابط يجب أن يبدأ بـ https://"); out.url = u || null; }
    if (!partial || b.lat !== undefined || b.lng !== undefined) {
      const lat = +(b.lat ?? prev?.lat), lng = +(b.lng ?? prev?.lng);
      if (!G.validLatLng(lat, lng)) throw E.bad("حدد موقع المكان على الخريطة");
      out.lat = G.round4(lat); out.lng = G.round4(lng); out.geohash = G.encode(out.lat, out.lng, 7);
      Object.assign(out, cityOf(out.lat, out.lng, out.address ?? prev?.address));
    }
    return out;
  }
  async function screen(user, text) {
    try { const v = await ctx.services.automod?.assess?.({ text, author: user.id }); if (v) return { action: v.action, risk: Number(v.risk || 0), reasons: (v.reasons || []).join(",") }; } catch { /* automod optional */ }
    return { action: "allow", risk: 0, reasons: "" };
  }
  async function submit(user, b = {}) {
    if (await isMinor(user.id)) throw Object.assign(E.forbid("إضافة الأماكن غير متاحة لحسابات القاصرين حفاظاً على خصوصيتهم"), { code: "minor_location" });
    if (!rl.hit("default", "place:" + user.id)) throw E.rate();
    const pend = Number((await db.get("SELECT COUNT(*) n FROM places WHERE submitted_by=$1 AND status='pending'", [user.id]))?.n || 0);
    if (pend >= PENDING_MAX) throw E.bad("لديك أماكن كثيرة بانتظار المراجعة؛ انتظر مراجعتها أولاً");
    const p = readPlace(b);
    // duplicate: same normalised name within 150 m (approved or pending)
    const [a, bb, c, d] = G.bbox(p.lat, p.lng, 0.15);
    for (const x of await db.all("SELECT id, name, lat, lng FROM places WHERE status IN ('approved','pending','review') AND lat >= $1 AND lat <= $2 AND lng >= $3 AND lng <= $4", [a, c, bb, d]))
      if (normName(x.name) === normName(p.name) && G.haversine(p.lat, p.lng, x.lat, x.lng) <= 0.15) throw Object.assign(E.conflict("هذا المكان موجود بالفعل على الخريطة"), { code: "duplicate", details: { existing: x.id } });
    const s = await screen(user, `${p.name}\n${p.descr}\n${p.address}`);
    const status = s.action === "block" || s.action === "remove" ? "rejected" : "pending";
    const pid = id("pl"), at = now();
    await db.run("INSERT INTO places(id,name,category,descr,address,lat,lng,geohash,city,country,url,hours,hours_week,status,risk,reasons,submitted_by,review_note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$19,$13,$14,$15,$16,$17,$18,$18)",
      [pid, p.name, p.category, p.descr, p.address, p.lat, p.lng, p.geohash, p.city, p.country, p.url, p.hours, status, s.risk, s.reasons || null, user.id, status === "rejected" ? "رُفض تلقائياً: المحتوى يخالف الإرشادات" : null, at, p.hours_week]);
    await ctx.audit?.("PLACE_SUBMITTED", pid, status, user.id);
    return { place: placeClient(await db.get("SELECT * FROM places WHERE id=$1", [pid]), { mine: true }) };
  }
  async function getPlace(user, pid) {
    const p = await db.get("SELECT * FROM places WHERE id=$1", [pid]); if (!p) throw E.nf("المكان غير موجود");
    const mine = user && p.submitted_by === user.id;
    if (p.status !== "approved" && !mine && !isStaff(user)) throw E.nf("المكان غير موجود");
    const nearbyEvents = p.status === "approved" ? (await around(user, { lat: p.lat, lng: p.lng }, 3, { kinds: ["events"] })).slice(0, 5) : [];
    const reported = user ? !!(await db.get("SELECT 1 x FROM place_reports WHERE place_id=$1 AND user_id=$2", [pid, user.id])) : false;
    const extras = p.status === "approved" ? await placeExtras(user, p) : { hoursWeek: parseWeek(p.hours_week), hoursTable: weekRows(parseWeek(p.hours_week)) };
    const biz = await db.get("SELECT home_based FROM businesses WHERE place_id=$1", [pid]).catch(() => null); // v2.30: phase 67
    const out = placeClient(p, { mine: !!mine, reviewNote: mine || isStaff(user) ? p.review_note : undefined, reports: isStaff(user) ? p.reports : undefined, reported, business: !!biz, ...extras });
    if (biz && Number(biz.home_based)) Object.assign(out, { lat: null, lng: null, address: "", homeBased: true });
    return { place: out, nearbyEvents: biz && Number(biz.home_based) ? [] : nearbyEvents, reasons: REPORT_REASONS, shareUrl: `/#/place/${p.id}` };
  }
  async function editPlace(user, pid, b = {}) {
    const p = await db.get("SELECT * FROM places WHERE id=$1", [pid]); if (!p) throw E.nf();
    const mine = p.submitted_by === user.id; if (!mine && !isStaff(user)) throw E.forbid();
    if (mine && !isStaff(user) && !["pending", "rejected"].includes(p.status)) throw E.bad("تعديل مكان معتمد يتم عبر الإبلاغ عن معلومة خاطئة");
    const ch = readPlace(b, true, p); if (!Object.keys(ch).length) throw E.bad("لا تغييرات");
    const merged = { ...p, ...ch };
    let status = p.status, risk = p.risk, reasons = p.reasons;
    if (!isStaff(user)) { const s = await screen(user, `${merged.name}\n${merged.descr}\n${merged.address}`); risk = s.risk; reasons = s.reasons || null; status = s.action === "block" || s.action === "remove" ? "rejected" : "pending"; }
    await db.run("UPDATE places SET name=$1, category=$2, descr=$3, address=$4, lat=$5, lng=$6, geohash=$7, city=$8, country=$9, url=$10, hours=$11, status=$12, risk=$13, reasons=$14, updated_at=$15, hours_week=$17 WHERE id=$16",
      [merged.name, merged.category, merged.descr, merged.address, merged.lat, merged.lng, merged.geohash, merged.city, merged.country, merged.url, merged.hours, status, risk, reasons, now(), pid, merged.hours_week ?? null]);
    return getPlace(user, pid);
  }
  async function removePlace(user, pid) {
    const p = await db.get("SELECT * FROM places WHERE id=$1", [pid]); if (!p) throw E.nf();
    if (!isStaff(user) && !(p.submitted_by === user.id && p.status !== "approved")) throw E.forbid("يزيل المشرفون الأماكن المعتمدة؛ أبلغ عنه إن كان خاطئاً");
    await db.run("UPDATE places SET status='removed', reviewed_by=$1, reviewed_at=$2, updated_at=$2 WHERE id=$3", [user.id, now(), pid]);
    await db.run("DELETE FROM place_reports WHERE place_id=$1", [pid]);
    await ctx.audit?.("PLACE_REMOVED", pid, null, user.id);
    return { ok: true };
  }
  async function report(user, pid, b = {}) {
    if (!rl.hit("report", user.id)) throw E.rate();
    const p = await db.get("SELECT * FROM places WHERE id=$1 AND status='approved'", [pid]); if (!p) throw E.nf();
    if (p.submitted_by === user.id) throw E.bad("لا يمكنك الإبلاغ عن مكان أضفته؛ عدّله أو احذفه");
    const reason = oneOf(b.reason, Object.keys(REPORT_REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const r = await db.run("INSERT INTO place_reports(place_id,user_id,reason,note,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [pid, user.id, reason, str(b.note, 300), now()]);
    if (!r.changes) return { ok: true, duplicate: true };
    const n = Number((await db.get("SELECT COUNT(*) n FROM place_reports WHERE place_id=$1 AND reason NOT IN ('pi_false')", [pid])).n); // a Pi dispute never hides the place (phase 67 handles it)
    // a «private home» report from anyone hides it at once (a home must never stay on a public map); others after HIDE_AT
    const hide = reason === "private" || (reason !== "pi_false" && n >= HIDE_AT);
    await db.run("UPDATE places SET reports=$1, status=$2, updated_at=$3 WHERE id=$4", [n, hide ? "review" : p.status, now(), pid]);
    return { ok: true, hidden: hide };
  }
  async function queue(q) {
    const st = oneOf(q.status, ["pending", "review", "rejected", "approved"], "pending");
    const rows = await db.all("SELECT p.*, u.handle sh, u.name sn FROM places p LEFT JOIN users u ON u.id=p.submitted_by WHERE p.status=$1 ORDER BY p.risk DESC, p.created_at LIMIT 100", [st]);
    const reps = rows.length ? await db.all(`SELECT place_id, reason, COUNT(*) n FROM place_reports WHERE place_id IN (${rows.map((_, i) => "$" + (i + 1)).join(",")}) GROUP BY place_id, reason`, rows.map((r) => r.id)) : [];
    return { filter: st, places: rows.map((p) => placeClient(p, { risk: p.risk, reasons: p.reasons ? p.reasons.split(",").filter(Boolean) : [], reviewNote: p.review_note, reports: p.reports, reportReasons: reps.filter((r) => r.place_id === p.id).map((r) => ({ reason: r.reason, label: REPORT_REASONS[r.reason], n: Number(r.n) })), submittedBy: { handle: p.sh, name: p.sn }, createdAt: p.created_at })),
      counts: Object.fromEntries((await db.all("SELECT status, COUNT(*) n FROM places GROUP BY status")).map((r) => [r.status, Number(r.n)])) };
  }
  async function review(user, pid, b = {}) {
    const p = await db.get("SELECT * FROM places WHERE id=$1", [pid]); if (!p) throw E.nf();
    const d = oneOf(b.decision, ["approve", "reject"], null); if (!d) throw E.bad("اختر قبول أو رفض");
    const status = d === "approve" ? "approved" : "rejected", note = str(b.note, 300) || null;
    await db.run("UPDATE places SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=$4, updated_at=$4, reports=$5 WHERE id=$6", [status, note, user.id, now(), status === "approved" ? 0 : p.reports, pid]);
    if (status === "approved") await db.run("DELETE FROM place_reports WHERE place_id=$1", [pid]);
    await ctx.audit?.(d === "approve" ? "PLACE_APPROVED" : "PLACE_REJECTED", pid, note, user.id);
    if (p.submitted_by !== user.id && p.status === "pending") await notify(p.submitted_by, status === "approved" ? "place_approved" : "place_rejected", pid);
    return { ok: true, decision: status };
  }
  async function mine(user) {
    const rows = await db.all("SELECT * FROM places WHERE submitted_by=$1 AND status<>'removed' ORDER BY created_at DESC LIMIT 100", [user.id]);
    return { places: rows.map((p) => placeClient(p, { mine: true, reviewNote: p.review_note })) };
  }

  /* ======================= 7. place pages: hours, ratings + reviews, photos, saves (v2.29) ======================= */
  const TZ = { SA: "Asia/Riyadh", KW: "Asia/Kuwait", QA: "Asia/Qatar", BH: "Asia/Bahrain", IQ: "Asia/Baghdad", YE: "Asia/Aden", AE: "Asia/Dubai", OM: "Asia/Muscat", EG: "Africa/Cairo", JO: "Asia/Amman", LB: "Asia/Beirut", SY: "Asia/Damascus", PS: "Asia/Gaza", MA: "Africa/Casablanca", DZ: "Africa/Algiers", TN: "Africa/Tunis", LY: "Africa/Tripoli", SD: "Africa/Khartoum" };
  const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  /** structured week: 7 entries (Sunday first), each null (closed) or [open, close] "HH:MM"; close ≤ open runs past midnight */
  function readWeek(v) {
    if (v === null || v === "") return null;
    let w = v; if (typeof w === "string") { try { w = JSON.parse(w); } catch { throw E.bad("صيغة ساعات العمل غير صالحة"); } }
    if (!Array.isArray(w) || w.length !== 7) throw E.bad("ساعات العمل: سبعة أيام مطلوبة");
    return w.map((d) => { if (!d) return null; if (!Array.isArray(d) || d.length !== 2 || !HM.test(d[0]) || !HM.test(d[1])) throw E.bad("ساعات العمل: استخدم الصيغة 08:00"); return [d[0], d[1]]; });
  }
  const mins = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  /** open-now in the place's own time zone (by country), with the next change */
  function openNow(week, country, at = new Date()) {
    if (!week) return null;
    let parts; try { parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ[country] || "Asia/Riyadh", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((p) => [p.type, p.value])); } catch { return null; }
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday), t = (+parts.hour % 24) * 60 + +parts.minute;
    const span = (d) => { const x = week[(d + 7) % 7]; if (!x) return null; const o = mins(x[0]), c = mins(x[1]); return { o, c: c <= o ? c + 1440 : c, x }; };
    const today = span(day), yest = span(day - 1);
    if (yest && yest.c > 1440 && t < yest.c - 1440) return { open: true, label: `مفتوح الآن · يغلق ${yest.x[1]}` };
    if (today && t >= today.o && t < today.c) return { open: true, label: today.x[0] === today.x[1] ? "مفتوح الآن · ٢٤ ساعة" : `مفتوح الآن · يغلق ${today.x[1]}` };
    if (today && t < today.o) return { open: false, label: `مغلق الآن · يفتح اليوم ${today.x[0]}` };
    for (let i = 1; i <= 7; i++) { const s = span(day + i); if (s) return { open: false, label: `مغلق الآن · يفتح ${i === 1 ? "غداً" : DAYS_AR[(day + i) % 7]} ${s.x[0]}` }; }
    return { open: false, label: "مغلق" };
  }
  const weekRows = (week) => (week ? week.map((d, i) => ({ day: DAYS_AR[i], hours: d ? (d[0] === d[1] ? "٢٤ ساعة" : `${d[0]} – ${d[1]}`) : "مغلق" })) : null);
  const parseWeek = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
  async function placeExtras(user, p) {
    const uid = user?.id || null;
    const rv = await db.all("SELECT r.user_id, r.rating, r.text, r.updated_at, u.name, u.handle, u.color FROM place_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.place_id=$1 AND r.status='visible' ORDER BY r.updated_at DESC LIMIT 200", [p.id]);
    const dist = [1, 2, 3, 4, 5].map((n) => rv.filter((r) => Number(r.rating) === n).length), cnt = rv.length;
    const photos = await db.all("SELECT id, user_id, url, caption, created_at FROM place_photos WHERE place_id=$1 AND status='visible' ORDER BY created_at DESC LIMIT 24", [p.id]);
    const saves = Number((await db.get("SELECT COUNT(*) n FROM place_saves WHERE place_id=$1", [p.id]))?.n || 0);
    const mineR = uid ? await db.get("SELECT rating, text, status FROM place_reviews WHERE place_id=$1 AND user_id=$2", [p.id, uid]) : null;
    const week = parseWeek(p.hours_week);
    return { rating: { avg: cnt ? Math.round((rv.reduce((a, r) => a + Number(r.rating), 0) / cnt) * 10) / 10 : 0, count: cnt, dist },
      reviews: rv.filter((r) => r.text).slice(0, 20).map((r) => ({ rating: Number(r.rating), text: r.text, at: r.updated_at, mine: r.user_id === uid, author: { name: r.name || "عضو", handle: r.handle, color: r.color } })),
      myReview: mineR ? { rating: Number(mineR.rating), text: mineR.text || "", status: mineR.status } : null,
      photos: photos.map((x) => ({ id: x.id, url: x.url, caption: x.caption || "", mine: x.user_id === uid, at: x.created_at })), saves, saved: uid ? !!(await db.get("SELECT 1 x FROM place_saves WHERE place_id=$1 AND user_id=$2", [p.id, uid])) : false,
      hoursWeek: week, hoursTable: weekRows(week), openNow: openNow(week, p.country) };
  }
  async function approvedPlace(pid) { const p = await db.get("SELECT * FROM places WHERE id=$1 AND status='approved'", [pid]); if (!p) throw E.nf("المكان غير موجود"); return p; }
  async function rate(user, pid, b = {}) {
    const p = await approvedPlace(pid);
    if (p.submitted_by === user.id) throw E.bad("لا يمكنك تقييم مكان أضفته بنفسك");
    if (!rl.hit("default", "prev:" + user.id)) throw E.rate();
    const rating = Math.round(+b.rating); if (!(rating >= 1 && rating <= 5)) throw E.bad("اختر تقييماً من ١ إلى ٥ نجوم");
    const text = str(b.text, 500) || null;
    let status = "visible"; if (text) { const s = await screen(user, text); if (["block", "remove", "hold", "review"].includes(s.action)) status = "hidden"; }
    const at = now();
    await db.run("INSERT INTO place_reviews(place_id,user_id,rating,text,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (place_id, user_id) DO UPDATE SET rating=$3, text=$4, status=$5, updated_at=$6", [pid, user.id, rating, text, status, at]);
    if (p.submitted_by !== user.id) notify(p.submitted_by, "place_review", pid);
    return { ok: true, reviewStatus: status, ...(await placeExtras(user, p)) };
  }
  async function unreview(user, pid) { await db.run("DELETE FROM place_reviews WHERE place_id=$1 AND user_id=$2", [pid, user.id]); return { ok: true }; }
  async function addPhoto(user, pid, b = {}) {
    const p = await approvedPlace(pid);
    if (await isMinor(user.id)) throw Object.assign(E.forbid("إضافة الصور للأماكن غير متاحة لحسابات القاصرين"), { code: "minor_location" });
    if (!rl.hit("default", "pph:" + user.id)) throw E.rate();
    const m = await db.get("SELECT id, owner, kind, status, variants FROM media WHERE id=$1", [String(b.media || "")]);
    if (!m || m.owner !== user.id) throw E.bad("ارفع الصورة أولاً");
    if (m.kind !== "image") throw E.bad("الصور فقط");
    const mine = Number((await db.get("SELECT COUNT(*) n FROM place_photos WHERE place_id=$1 AND user_id=$2 AND status='visible'", [pid, user.id]))?.n || 0);
    if (mine >= 3) throw E.bad("ثلاث صور لكل عضو في المكان الواحد");
    const all = Number((await db.get("SELECT COUNT(*) n FROM place_photos WHERE place_id=$1 AND status='visible'", [pid]))?.n || 0);
    if (all >= 24) throw E.bad("اكتمل عدد صور هذا المكان");
    let v = m.variants; if (typeof v === "string") { try { v = JSON.parse(v); } catch { v = {}; } }
    const url = v?.["800"] || v?.["1200"] || v?.original; if (!url) throw E.bad("الصورة غير جاهزة بعد");
    const caption = str(b.caption, 120) || null;
    if (caption) { const s = await screen(user, caption); if (["block", "remove"].includes(s.action)) throw E.bad("الوصف يخالف الإرشادات"); }
    await db.run("INSERT INTO place_photos(id,place_id,user_id,media_id,url,caption,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'visible',$7)", [id("pp"), pid, user.id, m.id, url, caption, now()]);
    return { ok: true, ...(await placeExtras(user, p)) };
  }
  async function delPhoto(user, pid, phid) {
    const x = await db.get("SELECT * FROM place_photos WHERE id=$1 AND place_id=$2", [phid, pid]); if (!x) throw E.nf();
    if (x.user_id !== user.id && !isStaff(user)) throw E.forbid();
    await db.run("UPDATE place_photos SET status='removed' WHERE id=$1", [phid]);
    if (x.user_id !== user.id) await ctx.audit?.("PLACE_PHOTO_REMOVED", phid, pid, user.id);
    return { ok: true };
  }
  async function save(user, pid, on) {
    if (on) { await approvedPlace(pid); await db.run("INSERT INTO place_saves(place_id,user_id,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [pid, user.id, now()]); }
    else await db.run("DELETE FROM place_saves WHERE place_id=$1 AND user_id=$2", [pid, user.id]);
    return { ok: true, saved: on };
  }
  async function saved(user) {
    const rows = await db.all("SELECT p.* FROM place_saves s JOIN places p ON p.id=s.place_id WHERE s.user_id=$1 AND p.status='approved' ORDER BY s.at DESC LIMIT 200", [user.id]);
    return { places: rows.map((p) => placeClient(p, { openNow: openNow(parseWeek(p.hours_week), p.country) })) };
  }

  /* ======================= 5. city pages ======================= */
  async function cities() {
    return cache.wrap("nearby:cities", 10 * 60e3, async () => {
      const byCity = Object.fromEntries((await db.all("SELECT city, COUNT(*) n FROM places WHERE status='approved' AND city IS NOT NULL GROUP BY city")).map((r) => [r.city, Number(r.n)]));
      return { cities: Object.keys(G.CITY_CENTERS).map((name) => { const cc = geo.resolve(name).country; return { name, country: cc, countryLabel: geo.COUNTRY_AR[cc] || cc, places: byCity[name] || 0 }; }) };
    });
  }
  async function cityPage(user, name) {
    const r = geo.resolve(decodeURIComponent(String(name || "")));
    const cc = r.city && G.CITY_CENTERS[r.city]; if (!cc) throw E.nf("مدينة غير معروفة");
    const center = { lat: cc[0], lng: cc[1], label: r.city, city: r.city, source: "city", approx: true };
    const items = await around(user, center, 40, { limit: 400 });
    const events = items.filter((x) => x.kind === "event").sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)).slice(0, 20);
    const places = items.filter((x) => x.kind === "place");
    const byCat = {}; for (const p of places) (byCat[p.category] ||= []).push(p);
    let trends = []; try { trends = (await ctx.services.trends.list({ scope: "city", key: r.city })).trends.slice(0, 8).map((t) => ({ tag: t.tag, score: t.score, posts: t.posts, summary: t.summary?.points?.[0]?.text || null })); } catch { /* trends optional */ }
    const comms = (await db.all("SELECT id, name, descr, type, color, location FROM communities WHERE type='public' AND location IS NOT NULL LIMIT 2000")).filter((c) => geo.resolve(c.location).city === r.city).slice(0, 10).map((c) => ({ id: c.id, name: c.name, desc: c.descr, color: c.color }));
    return { city: r.city, country: r.country, countryLabel: geo.COUNTRY_AR[r.country] || r.country, center, events, places: places.slice(0, 60), categories: Object.entries(byCat).map(([k, l]) => ({ key: k, label: CATS[k] || k, count: l.length })).sort((a, b) => b.count - a.count),
      trends, communities: comms, trendsHref: `#/explore`, mapHref: `#/nearby?city=${encodeURIComponent(r.city)}` };
  }

  const config = () => ({ tileUrl: TILE, attribution: ATTR, attributionUrl: "https://www.openstreetmap.org/copyright", minZoom: 3, maxZoom: 18, defaultZoom: 12, maxUserPrecision: G.MAX_USER_PRECISION, categories: Object.entries(CATS).map(([key, label]) => ({ key, label })), reportReasons: REPORT_REASONS });

  /* sweep: minors never keep a stored location (age may be declared after opting in) */
  async function sweep() {
    const rows = await db.all("SELECT user_id FROM geo_prefs LIMIT 5000");
    if (!rows.length || !ctx.services.minors?.minorIds) return 0;
    const m = await ctx.services.minors.minorIds(rows.map((r) => r.user_id)); let n = 0;
    for (const uid of m) { await db.run("DELETE FROM geo_prefs WHERE user_id=$1", [uid]); n++; }
    return n;
  }
  if (opts.jobs !== false && ctx.scheduler) ctx.scheduler.every("nearby.sweep", +(env.NEARBY_SWEEP_INTERVAL_MS || 6 * 3600e3), () => sweep());

  R.get("/api/nearby/config", async () => config());
  R.get("/api/nearby", async (req) => nearby(req.user, req.query));
  R.get("/api/nearby/location", A(async (req) => myLocation(req.user)));
  R.put("/api/nearby/location", A(async (req) => setLocation(req.user, req.body || {})));
  R.del("/api/nearby/location", A(async (req) => clearLocation(req.user)));
  R.get("/api/places/mine", A(async (req) => mine(req.user)));
  R.get("/api/places/saved", A(async (req) => saved(req.user)));
  R.post("/api/places/:id/reviews", A(async (req) => rate(req.user, req.params.id, req.body || {})));
  R.del("/api/places/:id/reviews", A(async (req) => unreview(req.user, req.params.id)));
  R.post("/api/places/:id/photos", A(async (req) => addPhoto(req.user, req.params.id, req.body || {})));
  R.del("/api/places/:id/photos/:photo", A(async (req) => delPhoto(req.user, req.params.id, req.params.photo)));
  R.put("/api/places/:id/save", A(async (req) => save(req.user, req.params.id, true)));
  R.del("/api/places/:id/save", A(async (req) => save(req.user, req.params.id, false)));
  R.post("/api/places", A(async (req) => submit(req.user, req.body || {})));
  R.get("/api/places/:id", async (req) => getPlace(req.user, req.params.id));
  R.patch("/api/places/:id", A(async (req) => editPlace(req.user, req.params.id, req.body || {})));
  R.del("/api/places/:id", A(async (req) => removePlace(req.user, req.params.id)));
  R.post("/api/places/:id/report", A(async (req) => report(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/places", staff(async (req) => queue(req.query)));
  R.post("/api/admin/places/:id/review", staff(async (req) => review(req.user, req.params.id, req.body || {})));
  R.get("/api/cities", async () => cities());
  R.get("/api/cities/:name", async (req) => cityPage(req.user, req.params.name));
  return { placeExtras, openNow, parseWeek, readWeek, weekRows, REPORT_REASONS, nearby, around, centre, myLocation, setLocation, clearLocation, submit, getPlace, editPlace, removePlace, report, queue, review, cities, cityPage, sweep, config, CATS, DAY };
};
