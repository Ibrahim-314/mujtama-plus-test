/* Phase 66 — nearby events and places: coarse opt-in location (≤ 5-char geohash, city, delete), minors refused and purged,
 * moderated place submissions (screening, duplicates, rounding, city), review queue + notifications, reports hiding a
 * place, events of public vs private communities on the map, radius / kind / category / text filters with approximate
 * distances, city pages (events, places, categories, communities, trends), map config, migration 043. PostgreSQL + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const G = require("../lib/geohash");

let H, admin, ali, sara, kid, mona, rami;
const db = () => H.app.ctx.db;
const JED = [21.5433, 39.1728]; // Al Shati, Jeddah
const ymd = (years) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); };
async function mk(handle, extra = {}) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...extra });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const place = (o = {}) => ({ name: "مكتبة الشاطئ العامة", category: "library", descr: "مكتبة هادئة للقراءة والدراسة", address: "حي الشاطئ، جدة", lat: JED[0] + 0.000123456, lng: JED[1] - 0.000098765, hours: "9 ص – 9 م", url: "https://example.org/lib", ...o });
test.before(async () => {
  H = await boot({ nearbyOpts: { jobs: false, env: { PLACES_HIDE_REPORTS: "3" } } });
  admin = await mk("nb_admin"); ali = await mk("nb_ali"); sara = await mk("nb_sara"); mona = await mk("nb_mona"); rami = await mk("nb_rami");
  kid = await mk("nb_kid", { birthDate: ymd(15) });
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => { H.app.ctx.rl.w.clear(); H.app.ctx.cache.del("nearby:"); });

test("migration 043 reversible + additive; data map; map config (OSM, attribution, swappable)", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '043_nearby' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "043_nearby"]);
  await assert.rejects(() => db().get("SELECT 1 FROM places"));
  assert.deepEqual(await mig.up(db()), ["043_nearby", ...later]);
  for (const t of ["geo_prefs", "places", "place_reports"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [ali.id]); }
  const c = await new H.Client().req("GET", "/api/nearby/config");
  assert.equal(c.tileUrl, "https://tile.openstreetmap.org/{z}/{x}/{y}.png"); assert.match(c.attribution, /OpenStreetMap/); assert.equal(c.attributionUrl, "https://www.openstreetmap.org/copyright");
  assert.equal(c.maxUserPrecision, 5); assert.ok(c.categories.length >= 10); assert.ok(c.maxZoom <= 19);
});

test("opt-in location: geohash cut to 5 chars (≈5 km), city choice, radius bounds, delete; no lat/lng accepted", async () => {
  assert.equal((await ali.req("GET", "/api/nearby/location")).enabled, false, "off by default");
  const precise = G.encode(JED[0], JED[1], 9);
  const r = await ali.req("PUT", "/api/nearby/location", { geohash: precise, radiusKm: 500, lat: JED[0], lng: JED[1] }); assert.equal(r.status, 200, r.error);
  assert.equal(r.geohash, precise.slice(0, 5)); assert.equal(r.radiusKm, 50, "radius capped at 50 km"); assert.equal(r.city, "جدة"); assert.ok(r.cell.kmAcross >= 4 && r.cell.kmAcross <= 6, String(r.cell.kmAcross));
  const row = await db().get("SELECT * FROM geo_prefs WHERE user_id=$1", [ali.id]);
  assert.equal(row.geohash.length, 5); assert.ok(!("lat" in row) && !("lng" in row), "no coordinate columns exist for people");
  assert.ok(!JSON.stringify(row).includes(String(JED[0])), "the precise position is nowhere");
  assert.equal((await ali.req("PUT", "/api/nearby/location", { geohash: "aaaa!" })).status, 400);
  assert.equal((await ali.req("PUT", "/api/nearby/location", { city: "أتلانتس" })).status, 400);
  assert.equal((await ali.req("PUT", "/api/nearby/location", {})).status, 400);
  const c = await sara.req("PUT", "/api/nearby/location", { city: "Riyadh", radiusKm: 0 }); assert.equal(c.city, "الرياض"); assert.equal(c.geohash, null); assert.equal(c.radiusKm, 10, "0 falls back to the default");
  assert.equal((await sara.req("DELETE", "/api/nearby/location")).deleted, true);
  assert.equal(await db().get("SELECT 1 x FROM geo_prefs WHERE user_id=$1", [sara.id]), undefined, "really deleted");
  assert.equal((await new H.Client().req("PUT", "/api/nearby/location", { city: "جدة" })).status, 401);
});

test("minors: location opt-in refused (code minor_location), stored row purged, device hash ignored, cannot add places", async () => {
  await db().run("INSERT INTO geo_prefs(user_id,enabled,geohash,city,radius_km,source,updated_at) VALUES($1,1,'sggf5','جدة',10,'device',$2)", [kid.id, new Date().toISOString()]);
  const g = await kid.req("GET", "/api/nearby/location"); assert.equal(g.allowed, false); assert.equal(g.minor, true);
  assert.equal(await db().get("SELECT 1 x FROM geo_prefs WHERE user_id=$1", [kid.id]), undefined, "purged on read");
  const p = await kid.req("PUT", "/api/nearby/location", { geohash: "sggf5" }); assert.equal(p.status, 403); assert.equal(p.code, "minor_location");
  const n = await kid.req("GET", "/api/nearby?gh=sggf5"); assert.equal(n.status, 200); assert.equal(n.center, null, "a minor's device position is never used"); assert.equal(n.minor, true);
  const c = await kid.req("GET", "/api/nearby?city=" + encodeURIComponent("جدة")); assert.equal(c.center.city, "جدة", "browsing by city is fine");
  const s = await kid.req("POST", "/api/places", place({ name: "بيتنا" })); assert.equal(s.status, 403); assert.equal(s.code, "minor_location");
  // the periodic sweep removes rows of members who became minors after opting in
  await db().run("INSERT INTO geo_prefs(user_id,enabled,geohash,radius_km,updated_at) VALUES($1,1,'sggf5',10,$2)", [kid.id, new Date().toISOString()]);
  assert.equal(await H.app.ctx.services.nearby.sweep(), 1);
});

let lib;
test("places: submit → pending (rounded, city, geohash) → only submitter/staff see it → duplicate guard → review → map", async () => {
  const s = await ali.req("POST", "/api/places", place()); assert.equal(s.status, 200, s.error);
  lib = s.place; assert.equal(lib.status, "pending"); assert.equal(lib.city, "جدة"); assert.equal(lib.country, "SA");
  assert.equal(lib.lat, G.round4(JED[0] + 0.000123456)); assert.equal(lib.lng, G.round4(JED[1] - 0.000098765));
  assert.equal((await db().get("SELECT geohash FROM places WHERE id=$1", [lib.id])).geohash.length, 7);
  assert.equal((await sara.req("GET", "/api/places/" + lib.id)).status, 404, "pending is private");
  assert.equal((await ali.req("GET", "/api/places/" + lib.id)).place.mine, true);
  assert.equal((await new H.Client().req("GET", "/api/nearby?city=" + encodeURIComponent("جدة"))).items.length, 0, "not on the map yet");
  const d = await sara.req("POST", "/api/places", place({ name: "مكتبة  الشاطئ العامة", lat: JED[0] + 0.0005 })); assert.equal(d.status, 409); assert.equal(d.code, "duplicate"); assert.equal(d.existing, lib.id);
  for (const [b, why] of [[{ url: "http://x.com" }, "https only"], [{ lat: 0, lng: 0 }, "null island"], [{ lat: 95 }, "lat range"], [{ category: "casino" }, "category"], [{ name: "" }, "name"]]) assert.equal((await sara.req("POST", "/api/places", place({ name: "مكان " + why, ...b }))).status, 400, why);
  assert.equal((await ali.req("GET", "/api/admin/places")).status, 403);
  const q = await admin.req("GET", "/api/admin/places?status=pending"); assert.equal(q.status, 200); assert.ok(q.places.some((p) => p.id === lib.id && p.submittedBy.handle === "nb_ali"));
  assert.equal((await admin.req("POST", `/api/admin/places/${lib.id}/review`, { decision: "maybe" })).status, 400);
  assert.equal((await admin.req("POST", `/api/admin/places/${lib.id}/review`, { decision: "approve", note: "تم التحقق" })).status, 200);
  const nt = await db().get("SELECT kind, ref FROM notifications WHERE user_id=$1 AND kind='place_approved'", [ali.id]); assert.equal(nt.ref, lib.id);
  assert.equal((await sara.req("GET", "/api/places/" + lib.id)).place.name, "مكتبة الشاطئ العامة");
  const e = await ali.req("PATCH", "/api/places/" + lib.id, { name: "اسم جديد" }); assert.equal(e.status, 400, "approved places change through reports/staff");
  assert.equal((await admin.req("PATCH", "/api/places/" + lib.id, { hours: "24 ساعة" })).place.hours, "24 ساعة");
  // rejection with a note, then the submitter fixes it and it goes back to pending
  const cafe = (await sara.req("POST", "/api/places", place({ name: "مقهى الكورنيش", category: "cafe", lat: 21.6, lng: 39.11 }))).place;
  assert.equal((await admin.req("POST", `/api/admin/places/${cafe.id}/review`, { decision: "reject", note: "الموقع غير دقيق" })).status, 200);
  assert.equal((await sara.req("GET", "/api/places/" + cafe.id)).place.reviewNote, "الموقع غير دقيق");
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='place_rejected'", [sara.id]));
  assert.equal((await sara.req("PATCH", "/api/places/" + cafe.id, { lat: 21.601, lng: 39.111 })).place.status, "pending");
  assert.equal((await sara.req("GET", "/api/places/mine")).places.length, 1);
});

test("reports: own place refused, duplicates idempotent, 3 reports hide it, a «private home» report hides at once", async () => {
  assert.equal((await ali.req("POST", `/api/places/${lib.id}/report`, { reason: "wrong" })).status, 400, "own place");
  assert.equal((await sara.req("POST", `/api/places/${lib.id}/report`, { reason: "nope" })).status, 400);
  assert.equal((await sara.req("POST", `/api/places/${lib.id}/report`, { reason: "wrong" })).hidden, false);
  assert.equal((await sara.req("POST", `/api/places/${lib.id}/report`, { reason: "wrong" })).duplicate, true);
  assert.equal((await mona.req("POST", `/api/places/${lib.id}/report`, { reason: "closed" })).hidden, false);
  assert.equal((await rami.req("POST", `/api/places/${lib.id}/report`, { reason: "closed" })).hidden, true);
  assert.equal((await db().get("SELECT status, reports FROM places WHERE id=$1", [lib.id])).status, "review");
  assert.equal((await new H.Client().req("GET", "/api/places/" + lib.id)).status, 404, "hidden while under review");
  const q = await admin.req("GET", "/api/admin/places?status=review"); const it = q.places.find((p) => p.id === lib.id);
  assert.equal(it.reports, 3); assert.deepEqual(it.reportReasons.map((r) => r.reason).sort(), ["closed", "wrong"]);
  await admin.req("POST", `/api/admin/places/${lib.id}/review`, { decision: "approve" });
  assert.equal((await db().get("SELECT reports FROM places WHERE id=$1", [lib.id])).reports, 0, "a fresh start after review");
  const home = (await rami.req("POST", "/api/places", place({ name: "استراحة خاصة", category: "other", lat: 21.55, lng: 39.2 }))).place;
  await admin.req("POST", `/api/admin/places/${home.id}/review`, { decision: "approve" });
  assert.equal((await ali.req("POST", `/api/places/${home.id}/report`, { reason: "private" })).hidden, true);
  assert.equal((await rami.req("DELETE", "/api/places/" + home.id)).ok, true, "a hidden place can be withdrawn by its submitter");
  assert.equal((await db().get("SELECT status FROM places WHERE id=$1", [home.id])).status, "removed");
  assert.equal((await ali.req("DELETE", "/api/places/" + lib.id)).status, 403, "approved: only staff remove it");
});

test("nearby: places + pinned events, private community events for members only, radius/kind/category/text filters, approximate distance", async () => {
  // a second approved place ~30 km north of the library and an approved mosque nearby
  const far = (await mona.req("POST", "/api/places", place({ name: "حديقة الشمال", descr: "مساحات خضراء", category: "park", lat: JED[0] + 0.27, lng: JED[1] }))).place;
  const mosque = (await mona.req("POST", "/api/places", place({ name: "مسجد الحي", descr: "صلاة الجمعة", category: "mosque", lat: JED[0] + 0.01, lng: JED[1] + 0.01 }))).place;
  for (const p of [far, mosque]) await admin.req("POST", `/api/admin/places/${p.id}/review`, { decision: "approve" });
  const starts = new Date(Date.now() + 3 * 864e5).toISOString();
  const pub = await sara.req("POST", "/api/events/plus", { name: "لقاء القراءة في جدة", startsAt: starts, place: "جدة", lat: JED[0] + 0.02, lng: JED[1], address: "الكورنيش" }); assert.equal(pub.status, 200, pub.error);
  const online = await sara.req("POST", "/api/events/plus", { name: "لقاء أونلاين", startsAt: starts }); assert.equal(online.status, 200);
  H.app.ctx.rl.w.clear();
  const priv = (await rami.req("POST", "/api/communities", { name: "نادي خاص بجدة", type: "private" })).community;
  const pev = await rami.req("POST", "/api/events/plus", { name: "اجتماع النادي الخاص", startsAt: starts, community: priv.id, lat: JED[0] + 0.015, lng: JED[1] }); assert.equal(pev.status, 200, pev.error);
  const gh = G.encode(JED[0], JED[1], 5), centre = G.decode(gh);
  const n = await sara.req("GET", `/api/nearby?gh=${gh}&radius=10`); assert.equal(n.status, 200, n.error);
  assert.equal(n.center.approx, true); assert.equal(n.center.precision, 5); assert.equal(n.radiusKm, 10);
  const names = n.items.map((x) => x.name);
  assert.ok(names.includes("مكتبة الشاطئ العامة") && names.includes("مسجد الحي") && names.includes("لقاء القراءة في جدة"), names.join("|"));
  assert.ok(!names.includes("حديقة الشمال"), "30 km away is outside 10 km"); assert.ok(!names.includes("لقاء أونلاين"), "unpinned events are not on the map");
  assert.ok(!names.includes("اجتماع النادي الخاص"), "private community event hidden from non-members");
  assert.ok((await rami.req("GET", `/api/nearby?gh=${gh}`)).items.some((x) => x.name === "اجتماع النادي الخاص"), "members see it");
  for (let i = 1; i < n.items.length; i++) assert.ok(n.items[i].distanceKm >= n.items[i - 1].distanceKm, "sorted by distance");
  const libItem = n.items.find((x) => x.id === lib.id);
  const exact = G.haversine(centre.lat, centre.lng, libItem.lat, libItem.lng); assert.equal(libItem.distanceKm, G.approxKm(exact)); assert.equal(libItem.distanceKm * 2 % 1, 0, "0.5 km steps");
  assert.ok((await sara.req("GET", `/api/nearby?gh=${gh}&radius=50`)).items.some((x) => x.name === "حديقة الشمال"));
  assert.ok((await sara.req("GET", `/api/nearby?gh=${gh}&kinds=events`)).items.every((x) => x.kind === "event"));
  const m = await sara.req("GET", `/api/nearby?gh=${gh}&category=mosque`); assert.deepEqual(m.items.map((x) => x.name), ["مسجد الحي"]);
  assert.deepEqual((await sara.req("GET", `/api/nearby?gh=${gh}&q=${encodeURIComponent("مكتبه")}`)).items.map((x) => x.id), [lib.id], "Arabic-normalised text match");
  // saved preference is used when no centre is given; profile city as a last resort
  await ali.req("PUT", "/api/nearby/location", { geohash: gh, radiusKm: 5 });
  const saved = await ali.req("GET", "/api/nearby"); assert.equal(saved.center.source, "saved"); assert.equal(saved.radiusKm, 5);
  await db().run("UPDATE users SET location='الرياض' WHERE id=$1", [mona.id]);
  assert.equal((await mona.req("GET", "/api/nearby")).center.city, "الرياض");
  const none = await new H.Client().req("GET", "/api/nearby"); assert.equal(none.center, null); assert.ok(none.note); assert.ok(none.cities.length >= 30);
  assert.equal((await sara.req("GET", "/api/nearby?city=" + encodeURIComponent("أتلانتس"))).status, 400);
  const pl = await sara.req("GET", `/api/nearby?place=${lib.id}&radius=3`); assert.equal(pl.center.source, "place"); assert.equal(pl.center.approx, false);
  const detail = await sara.req("GET", "/api/places/" + lib.id); assert.ok(detail.nearbyEvents.some((e) => e.name === "لقاء القراءة في جدة"));
});

test("city pages: list with counts, page with events, places by category, local communities, trends hook, map link", async () => {
  H.app.ctx.rl.w.clear();
  const cm = await sara.req("POST", "/api/communities", { name: "مطورو جدة", type: "public", location: "جدة" }); assert.equal(cm.status, 200, cm.error);
  const l = await new H.Client().req("GET", "/api/cities"); assert.equal(l.status, 200); const j = l.cities.find((c) => c.name === "جدة"); assert.ok(j.places >= 2); assert.equal(j.countryLabel, "السعودية");
  const p = await new H.Client().req("GET", "/api/cities/" + encodeURIComponent("Jeddah")); assert.equal(p.status, 200, p.error);
  assert.equal(p.city, "جدة"); assert.equal(p.country, "SA");
  assert.ok(p.events.some((e) => e.name === "لقاء القراءة في جدة")); assert.ok(!p.events.some((e) => e.name === "اجتماع النادي الخاص"));
  assert.ok(p.places.some((x) => x.id === lib.id)); assert.ok(p.categories.find((c) => c.key === "library").count >= 1);
  assert.ok(p.communities.some((c) => c.name === "مطورو جدة")); assert.ok(Array.isArray(p.trends)); assert.match(p.mapHref, /^#\/nearby\?city=/);
  assert.equal((await new H.Client().req("GET", "/api/cities/" + encodeURIComponent("أتلانتس"))).status, 404);
});

test("geohash library: encode/decode round trip, coarsen, bbox contains the circle, nearest city", () => {
  assert.equal(G.encode(57.64911, 10.40744, 11), "u4pruydqqvj");
  const d = G.decode("u4pruydqqvj"); assert.ok(Math.abs(d.lat - 57.64911) < 1e-5 && Math.abs(d.lng - 10.40744) < 1e-5);
  assert.equal(G.coarsen("sggf5xyz12"), "sggf5"); assert.equal(G.coarsen("sggf5xyz12", 3), "sgg"); assert.equal(G.coarsen("bad!"), null); assert.equal(G.coarsen("sgg"), "sgg");
  const [a, b, c, e] = G.bbox(21.5, 39.2, 10); assert.ok(G.haversine(21.5, 39.2, a, 39.2) >= 9.9 && G.haversine(21.5, 39.2, 21.5, b) >= 9.9 && c > 21.5 && e > 39.2);
  assert.equal(G.nearestCity(21.55, 39.17).city, "جدة"); assert.equal(G.nearestCity(0.1, 0.1), null);
  assert.equal(G.approxKm(0.2), 0.5); assert.equal(G.approxKm(3.26), 3.5); assert.equal(G.validLatLng(0, 0), false);
  assert.ok(Math.abs(G.haversine(21.4858, 39.1925, 24.7136, 46.6753) - 845) < 5, "Jeddah–Riyadh ≈ 845 km");
});

test("v2.29 place pages: structured hours + open-now in local time, ratings and reviews (screened, not on own place), photos (own images, limits), saves, RSVP from the map", async () => {
  H.app.ctx.rl.w.clear();
  const week = [["08:00", "22:00"], ["08:00", "22:00"], ["08:00", "22:00"], ["08:00", "22:00"], ["08:00", "23:30"], ["14:00", "02:00"], null];
  assert.equal((await ali.req("POST", "/api/places", place({ name: "مقهى الساعات الخاطئة", category: "cafe", lat: JED[0] + 0.05, hoursWeek: [["8", "22"]] }))).status, 400, "seven days in HH:MM");
  const cafe = (await ali.req("POST", "/api/places", place({ name: "مقهى المرسى", category: "cafe", descr: "قهوة مختصة", lat: JED[0] + 0.04, lng: JED[1] + 0.01, hoursWeek: week }))).place;
  assert.ok(cafe?.id); await admin.req("POST", `/api/admin/places/${cafe.id}/review`, { decision: "approve" });
  let g = await sara.req("GET", "/api/places/" + cafe.id); assert.equal(g.status, 200, g.error);
  assert.deepEqual(g.place.hoursWeek, week); assert.equal(g.place.hoursTable.length, 7); assert.equal(g.place.hoursTable[6].hours, "مغلق");
  assert.ok(g.place.openNow && typeof g.place.openNow.open === "boolean" && /مفتوح|مغلق/.test(g.place.openNow.label), JSON.stringify(g.place.openNow));
  assert.deepEqual(g.place.rating, { avg: 0, count: 0, dist: [0, 0, 0, 0, 0] }); assert.equal(g.place.saved, false);
  // ratings
  assert.equal((await ali.req("POST", `/api/places/${cafe.id}/reviews`, { rating: 5 })).status, 400, "no rating your own place");
  assert.equal((await sara.req("POST", `/api/places/${cafe.id}/reviews`, { rating: 9 })).status, 400);
  let r = await sara.req("POST", `/api/places/${cafe.id}/reviews`, { rating: 4, text: "مكان هادئ وقهوة ممتازة" }); assert.equal(r.status, 200, r.error); assert.equal(r.status === 200 && r.rating.count, 1);
  r = await mona.req("POST", `/api/places/${cafe.id}/reviews`, { rating: 2 }); assert.equal(r.rating.avg, 3); assert.deepEqual(r.rating.dist, [0, 1, 0, 1, 0]);
  r = await sara.req("POST", `/api/places/${cafe.id}/reviews`, { rating: 5, text: "تحسّن كثيراً" }); assert.equal(r.rating.avg, 3.5, "one review per member, updated in place");
  g = await sara.req("GET", "/api/places/" + cafe.id); assert.equal(g.place.reviews.length, 1, "rating-only reviews count but are not listed"); assert.equal(g.place.reviews[0].mine, true); assert.equal(g.place.myReview.rating, 5);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='place_review'", [ali.id]), "the submitter hears about reviews");
  await mona.req("DELETE", `/api/places/${cafe.id}/reviews`); g = await sara.req("GET", "/api/places/" + cafe.id); assert.equal(g.place.rating.count, 1);
  // photos
  const at = new Date().toISOString();
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'image','image/jpeg',10,'k1','ready',$3,$4)", ["m_ph1", sara.id, JSON.stringify({ original: "/media/k1.jpg", "800": "/media/k1_800.jpg" }), at]);
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'image','image/jpeg',10,'k2','ready',$3,$4)", ["m_ph2", mona.id, JSON.stringify({ original: "/media/k2.jpg" }), at]);
  assert.equal((await sara.req("POST", `/api/places/${cafe.id}/photos`, { media: "m_ph2" })).status, 400, "only your own uploads");
  assert.equal((await kid.req("POST", `/api/places/${cafe.id}/photos`, { media: "m_ph1" })).status, 403, "minors cannot attach photos to places");
  r = await sara.req("POST", `/api/places/${cafe.id}/photos`, { media: "m_ph1", caption: "الواجهة" }); assert.equal(r.status, 200, r.error);
  assert.equal(r.photos.length, 1); assert.equal(r.photos[0].url, "/media/k1_800.jpg"); assert.equal(r.photos[0].mine, true);
  assert.equal((await mona.req("DELETE", `/api/places/${cafe.id}/photos/${r.photos[0].id}`)).status, 403, "only the uploader or staff remove a photo");
  assert.equal((await admin.req("DELETE", `/api/places/${cafe.id}/photos/${r.photos[0].id}`)).status, 200);
  assert.equal((await sara.req("GET", "/api/places/" + cafe.id)).place.photos.length, 0);
  // saves
  assert.equal((await sara.req("PUT", `/api/places/${cafe.id}/save`)).saved, true);
  const sv = await sara.req("GET", "/api/places/saved"); assert.deepEqual(sv.places.map((p) => p.id), [cafe.id]); assert.ok("openNow" in sv.places[0]);
  assert.equal((await sara.req("GET", "/api/places/" + cafe.id)).place.saves, 1);
  await sara.req("DELETE", `/api/places/${cafe.id}/save`); assert.equal((await sara.req("GET", "/api/places/saved")).places.length, 0);
  // RSVP from the map: the event item carries the going count and my answer
  const gh = G.encode(JED[0], JED[1], 5);
  let n = await mona.req("GET", `/api/nearby?gh=${gh}&radius=10&kinds=events`); const ev = n.items.find((x) => x.name === "لقاء القراءة في جدة"); assert.ok(ev, "event on the map");
  assert.equal(ev.myRsvp, null);
  assert.equal((await mona.req("PUT", `/api/events/${ev.id}/rsvp/going`)).status, 200);
  n = await mona.req("GET", `/api/nearby?gh=${gh}&radius=10&kinds=events`); const ev2 = n.items.find((x) => x.id === ev.id); assert.equal(ev2.myRsvp, "going"); assert.equal(ev2.going, ev.going + 1);
  for (const t of ["place_reviews", "place_photos", "place_saves"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [sara.id]); }
});
