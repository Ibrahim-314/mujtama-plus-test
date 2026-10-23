/* Phase 67 — local business directory on phase 66 places: add (storefront / home-based — area only, never on the map, home
 * addresses refused), moderation, claims (evidence for staff only, approve → owner + verified, other claims closed, reject
 * needs a reason, minors refused), owner edits, search (category / city / distance / accepts Pi / open now / text, facets,
 * sort), accepts-Pi disputes (badge hidden, place not hidden), reviews reused, minors never see direct contact, catalogue
 * link to the owner's market listings, migration 046. PostgreSQL + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, admin, owner, rival, fan, fan2, kid, cafe, home;
const db = () => H.app.ctx.db;
const ymd = (years) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - years); return d.toISOString().slice(0, 10); };
async function mk(handle, extra = {}) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...extra });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const week = Array.from({ length: 7 }, () => ["00:00", "00:00"]);
test.before(async () => {
  H = await boot({ nearbyOpts: { jobs: false } });
  admin = await mk("bz_admin"); owner = await mk("bz_owner"); rival = await mk("bz_rival"); fan = await mk("bz_fan"); fan2 = await mk("bz_fan2"); kid = await mk("bz_kid", { birthDate: ymd(14) });
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 046 reversible + additive; data map entries", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '046_business' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "046_business"]);
  await assert.rejects(() => db().get("SELECT 1 FROM businesses"));
  assert.deepEqual(await mig.up(db()), ["046_business", ...after]);
  for (const t of ["businesses", "business_claims"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [owner.id]); }
});

test("add a storefront business (→ moderation + owner claim) and a home-based one (area only, no address, never on the map)", async () => {
  const cfg = await fan.req("GET", "/api/biz/config"); assert.ok(cfg.categories.length >= 10); assert.ok(cfg.reasons.pi_false);
  assert.equal((await kid.req("POST", "/api/biz", { name: "متجر القاصر", category: "fashion", lat: 21.54, lng: 39.17 })).code, "minor_business");
  assert.equal((await owner.req("POST", "/api/biz", { name: "بلا تصنيف", lat: 21.54, lng: 39.17 })).status, 400);
  const homeAddr = await owner.req("POST", "/api/biz", { name: "حلويات أم سارة", category: "crafts", address: "حي الصفا، شقة رقم 12", lat: 21.55, lng: 39.2 });
  assert.equal(homeAddr.code, "home_address", "a home address is refused");
  const r = await owner.req("POST", "/api/biz", { name: "مقهى الواحة", category: "cafe", descr: "قهوة مختصة ومساحة عمل هادئة", address: "طريق الكورنيش، جدة", lat: 21.5433, lng: 39.1728, hoursWeek: week, acceptsPi: true, piNote: "نقبل Pi في كل الطلبات", phone: "+966 55 123 4567", whatsapp: "+966551234567", website: "https://oasis.example.com", instagram: "@oasis.cafe", menuUrl: "https://oasis.example.com/menu", delivery: true, priceLevel: 2, tags: "قهوة، واي فاي" });
  assert.equal(r.status, 200, r.error); cafe = r.place.id;
  assert.equal(r.place.status, "pending"); assert.equal(r.business.verified, false); assert.equal(r.business.myClaim.status, "pending", "the submitter's claim is opened automatically");
  assert.deepEqual(r.business.tags, ["قهوة", "واي فاي"]);
  assert.equal((await fan.req("GET", "/api/biz/" + cafe)).status, 404, "pending: not public yet");
  const hb = await owner.req("POST", "/api/biz", { name: "مخبوزات البيت", category: "crafts", homeBased: true, city: "جدة", address: "يجب ألا يُحفظ", lat: 21.6, lng: 39.3, delivery: true, owner: false });
  assert.equal(hb.status, 200, hb.error); home = hb.place.id;
  const pl = await db().get("SELECT lat, lng, address FROM places WHERE id=$1", [home]);
  assert.equal(pl.address, ""); assert.ok(Math.abs(pl.lat - 21.4858) < 0.001, "the pin is the city centre, not the home");
  assert.equal((await owner.req("POST", "/api/biz", { name: "منزلي بلا مدينة", category: "crafts", homeBased: true })).status, 400);
  for (const pid of [cafe, home]) await admin.req("POST", `/api/admin/places/${pid}/review`, { decision: "approve" });
  const h = await fan.req("GET", "/api/biz/" + home);
  assert.equal(h.business.homeBased, true); assert.equal(h.place.lat, null); assert.equal(h.place.address, "");
  const map = await fan.req("GET", "/api/nearby?city=" + encodeURIComponent("جدة") + "&radius=30&kinds=places");
  assert.ok(map.items.some((x) => x.id === cafe)); assert.ok(!map.items.some((x) => x.id === home), "home-based never on the map");
  const pg = await fan.req("GET", "/api/places/" + home); assert.equal(pg.place.business, true); assert.equal(pg.place.lat, null);
});

test("claims: evidence for staff only; approve → owner + verified + other claims closed; reject needs a reason; withdraw", async () => {
  const c2 = await rival.req("POST", `/api/biz/${cafe}/claim`, { evidence: "أنا مدير الفرع وأملك السجل التجاري", contact: "0500000000" });
  assert.equal(c2.status, 200, c2.error);
  assert.equal((await rival.req("POST", `/api/biz/${cafe}/claim`, { evidence: "مرة أخرى للتأكيد" })).status, 409, "one open claim");
  assert.equal((await kid.req("POST", `/api/biz/${cafe}/claim`, { evidence: "أنا صاحب المقهى فعلاً" })).code, "minor_business");
  assert.equal((await fan.req("GET", "/api/admin/biz/claims")).status, 403);
  const q = await admin.req("GET", "/api/admin/biz/claims");
  assert.equal(q.claims.length, 2); assert.ok(q.claims.find((c) => c.by.handle === "bz_rival").contact, "contact visible to staff");
  const pub = await fan.req("GET", "/api/biz/" + cafe); assert.ok(!JSON.stringify(pub).includes("السجل التجاري"), "evidence never public");
  const mineClaim = q.claims.find((c) => c.by.handle === "bz_owner");
  assert.equal((await admin.req("POST", "/api/admin/biz/claims/" + c2.claim.id, { decision: "reject" })).status, 400, "a reason is required");
  const ok = await admin.req("POST", "/api/admin/biz/claims/" + mineClaim.id, { decision: "approve" });
  assert.equal(ok.decision, "approved");
  assert.equal((await db().get("SELECT status FROM business_claims WHERE id=$1", [c2.claim.id])).status, "rejected", "other open claims closed");
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='biz_claim_approved'", [owner.id])).length, 1);
  assert.equal((await db().all("SELECT id FROM notifications WHERE user_id=$1 AND kind='biz_claim_rejected'", [rival.id])).length, 1);
  const d = await fan.req("GET", "/api/biz/" + cafe);
  assert.equal(d.business.verified, true); assert.equal(d.business.owner.handle, "bz_owner"); assert.equal(d.business.canEdit, false); assert.equal(d.business.canClaim, true);
  const rv = await rival.req("GET", "/api/biz/" + cafe); assert.equal(rv.business.myClaim.status, "rejected"); assert.match(rv.business.myClaim.note, /طلب آخر/);
  const w = await fan.req("POST", `/api/biz/${cafe}/claim`, { evidence: "أظن أنني المالك الجديد" }); assert.equal(w.status, 200);
  assert.equal((await fan.req("DELETE", "/api/biz/claims/" + w.claim.id)).ok, true);
  assert.equal((await fan.req("DELETE", "/api/biz/claims/" + w.claim.id)).status, 404);
  const m = await owner.req("GET", "/api/biz/mine"); assert.ok(m.businesses.some((b) => b.id === cafe && b.verified));
});

test("owner edits contact, hours, description and the Pi declaration; others cannot; claiming a plain place turns it into a business", async () => {
  assert.equal((await rival.req("PATCH", "/api/biz/" + cafe, { phone: "+966500000000" })).status, 403);
  const e = await owner.req("PATCH", "/api/biz/" + cafe, { descr: "قهوة مختصة، حلويات منزلية، وجلسات خارجية", phone: "+966 55 765 4321", piNote: "خصم ٥٪ للدفع بـ Pi", hoursWeek: week });
  assert.equal(e.status, 200, e.error); assert.equal(e.business.contact.phone, "+966 55 765 4321"); assert.match(e.place.descr, /جلسات خارجية/); assert.equal(e.business.piNote, "خصم ٥٪ للدفع بـ Pi");
  assert.equal((await owner.req("PATCH", "/api/biz/" + cafe, { website: "http://insecure.example" })).status, 400);
  assert.equal((await owner.req("PATCH", "/api/biz/" + cafe, { homeBased: true })).status, 400);
  // a plain approved place (phase 66) claimed → becomes a business with a derived category
  const pl = await fan2.req("POST", "/api/places", { name: "صيدلية الحي", category: "health", address: "شارع التحلية، جدة", lat: 21.55, lng: 39.16 });
  await admin.req("POST", `/api/admin/places/${pl.place.id}/review`, { decision: "approve" });
  const c = await rival.req("POST", `/api/biz/${pl.place.id}/claim`, { evidence: "أنا الصيدلي المسؤول عن الصيدلية" });
  assert.equal(c.status, 200, c.error);
  assert.equal((await db().get("SELECT category FROM businesses WHERE place_id=$1", [pl.place.id])).category, "health");
});

test("search: category, city, distance, accepts Pi, open now, text, facets, sort; disputes hide the badge (not the place)", async () => {
  // a second cafe without Pi, farther away
  const far = await rival.req("POST", "/api/biz", { name: "مقهى الميناء", category: "cafe", address: "البلد، جدة", lat: 21.4858, lng: 39.1925, acceptsPi: false, owner: false });
  await admin.req("POST", `/api/admin/places/${far.place.id}/review`, { decision: "approve" });
  let r = await fan.req("GET", "/api/biz?city=" + encodeURIComponent("جدة"));
  assert.ok(r.total >= 4); assert.ok(r.facets.some((f) => f.key === "cafe" && f.n === 2));
  r = await fan.req("GET", "/api/biz?category=cafe&pi=1&city=" + encodeURIComponent("جدة"));
  assert.deepEqual(r.items.map((x) => x.id), [cafe]); assert.equal(r.items[0].acceptsPi, true); assert.equal(r.items[0].verified, true);
  r = await fan.req("GET", "/api/biz?category=cafe&place=" + cafe + "&radius=20");
  assert.equal(r.sort, "distance"); assert.equal(r.items[0].id, cafe); assert.ok(r.items[1].distanceKm >= 5);
  r = await fan.req("GET", "/api/biz?q=" + encodeURIComponent("واي فاي"));
  assert.deepEqual(r.items.map((x) => x.id), [cafe], "tags are searchable");
  r = await fan.req("GET", "/api/biz?open=1&category=cafe&city=" + encodeURIComponent("جدة"));
  assert.deepEqual(r.items.map((x) => x.id), [cafe], "only the cafe with hours that are open now");
  assert.equal((await fan.req("GET", "/api/biz?city=Atlantis")).status, 400);
  // reviews are the place's
  await fan.req("POST", `/api/places/${cafe}/reviews`, { rating: 5, text: "أفضل قهوة ودفعت بـ Pi بسهولة" });
  r = await fan.req("GET", "/api/biz?sort=rating&city=" + encodeURIComponent("جدة"));
  assert.equal(r.items[0].id, cafe); assert.equal(r.items[0].rating.count, 1);
  // two «doesn't accept Pi» reports → badge hidden, place stays
  for (const u of [fan, fan2]) assert.equal((await u.req("POST", `/api/places/${cafe}/report`, { reason: "pi_false" })).ok, true);
  const d = await fan.req("GET", "/api/biz/" + cafe);
  assert.equal(d.place.status, "approved"); assert.equal(d.business.acceptsPi, false); assert.equal(d.business.piDisputed, true);
  assert.equal((await fan.req("GET", "/api/biz?pi=1&city=" + encodeURIComponent("جدة"))).items.filter((x) => x.acceptsPi).length, 0);
});

test("minors never see direct contact; catalogue links to the owner's active market listings; staff revoke ownership", async () => {
  const k = await kid.req("GET", "/api/biz/" + cafe);
  assert.equal(k.status, 200); assert.equal(k.business.contact.hidden, true); assert.equal(k.business.contact.phone, undefined); assert.equal(k.business.contact.whatsapp, undefined);
  assert.equal(k.business.canClaim, false);
  assert.ok((await fan.req("GET", "/api/biz/" + cafe)).business.contact.phone);
  const at = new Date().toISOString();
  await db().run("INSERT INTO market_listings(id,seller_id,kind,title,description,price,currency,category,status,created_at,updated_at) VALUES('ml_bz1',$1,'product','قهوة مختصة ٢٥٠ غ','',5,'PI','food','active',$2,$2)", [owner.id, at]).catch((e) => { throw new Error("market insert: " + e.message); });
  const d = await fan.req("GET", "/api/biz/" + cafe);
  assert.equal(d.business.catalog.listings, 1); assert.equal(d.business.catalog.href, "#/market/seller/bz_owner");
  assert.equal((await admin.req("POST", `/api/admin/biz/${cafe}/revoke`, { note: "انتقلت الملكية" })).ok, true);
  const after = await fan.req("GET", "/api/biz/" + cafe); assert.equal(after.business.verified, false); assert.equal(after.business.owner, null); assert.equal(after.business.catalog, null);
});
