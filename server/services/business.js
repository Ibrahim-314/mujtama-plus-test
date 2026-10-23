/* Local business directory «دليل الأعمال المحلية التي تقبل Pi» (phase 67). A business is a phase 66 place (pin, weekly hours,
 * photos, star reviews, saves, reports, moderation queue) plus one businesses row — places stay the single source of truth.
 *  1. Add a business: name, directory category, description, storefront pin (or «home-based»: only the city / ~5 km area is
 *     public — the pin becomes the area centre, no street address, it never shows on the map), hours, contact (phone /
 *     WhatsApp / e-mail / website / Instagram), menu or catalogue link, accepts-Pi declaration + note, delivery / online.
 *     Goes through place screening + moderation. Street addresses that look like a home (apartment / house numbers) are
 *     refused: choose home-based instead.
 *  2. Ownership: «أنا صاحب هذا النشاط» claim (evidence + contact for staff only) → staff queue → approved: owner + verified
 *     badge; other open claims are closed. Owners edit the profile (contact, hours, description, Pi, links). Staff can revoke.
 *  3. Search: text, category, city, distance from a centre (phase 66 centre: city / browsing area / approximate location /
 *     a place), accepts Pi, verified, open now; sort by distance / rating / newest; category facets.
 *  4. Business page: place extras (reviews, photos, hours, open now) + contact, accepts-Pi badge (owner declaration; hidden
 *     «under review» after PI_DISPUTE_REPORTS reports «لا يقبل Pi فعلياً»), owner, catalogue (owner's active market
 *     listings → #/market/seller/:handle), reports (place reasons + pi_false / fake_owner).
 *  5. Minors (phase 34/35): cannot add or claim a business; direct contact (phone / WhatsApp / e-mail) is hidden from them —
 *     they see the website and the in-app page only. */
const { E, str, oneOf, id, now } = require("../lib/core");
const G = require("../lib/geohash");
const geo = require("../lib/geo");
const AR = require("../lib/arabic");

/* v2.55: category glyphs are Lucide sprite ids ("i:<name>"), not emoji (tofu on systems without a colour-emoji font) */
const CATS = {
  restaurant: ["مطاعم", "i:store", "restaurant"], cafe: ["مقاهٍ وحلويات", "i:store", "cafe"], grocery: ["بقالة وتموينات", "i:bag", "shop"], fashion: ["أزياء وعبايات", "i:tag", "shop"],
  beauty: ["تجميل وعناية", "i:sparkle", "shop"], electronics: ["جوالات وإلكترونيات", "i:mobile", "shop"], home: ["منزل وأثاث", "i:home", "shop"], auto: ["سيارات وخدماتها", "i:wrench", "other"],
  health: ["صحة وصيدليات", "i:heart", "health"], education: ["تعليم وتدريب", "i:cap", "education"], services: ["خدمات مهنية", "i:brief", "other"], tech: ["تقنية وبرمجة", "i:layers", "coworking"],
  crafts: ["منتجات منزلية وحرف", "i:palette", "shop"], travel: ["سفر وسياحة", "i:globe", "other"], other: ["أخرى", "i:store", "other"]
};
const FROM_PLACE = { restaurant: "restaurant", cafe: "cafe", shop: "grocery", health: "health", education: "education", coworking: "tech" };
const HOME_ADDR = /(شقة|شقه|منزل|بيت|فيلا|فله|عمارة\s*\d|الدور|apartment|apt\.?|flat|house|villa)\s*(رقم|no\.?|#)?\s*\d/i;
const PHONE = /^\+?[0-9][0-9 -]{6,18}$/;

/** @param {any} ctx @param {{ env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const PI_DISPUTE = Math.max(1, +(env.PI_DISPUTE_REPORTS || 2));
  const NB = () => ctx.services.nearby;
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("للمشرفين فقط"); return fn(req, res); });
  const isMinor = async (uid) => { if (!uid) return false; try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const iso = () => now();
  const catsList = () => Object.entries(CATS).map(([key, [label, icon]]) => ({ key, label, icon }));
  const noMinor = async (user) => { if (await isMinor(user.id)) throw Object.assign(E.forbid("إضافة الأنشطة التجارية وإدارتها غير متاحة لحسابات القاصرين"), { code: "minor_business" }); };

  /* ---------- fields ---------- */
  function readBiz(b, partial) {
    const o = {};
    const url = (v, label) => { const u = str(v, 300); if (u && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(u)) throw E.bad(`${label}: يجب أن يبدأ الرابط بـ https://`); return u || null; };
    if (!partial || b.category !== undefined) { o.category = oneOf(b.category, Object.keys(CATS), null); if (!o.category) throw E.bad("اختر تصنيف النشاط"); }
    if (!partial || b.acceptsPi !== undefined) o.accepts_pi = b.acceptsPi ? 1 : 0;
    if (!partial || b.piNote !== undefined) o.pi_note = str(b.piNote, 140) || null;
    if (!partial || b.phone !== undefined) { const v = str(b.phone, 24); if (v && !PHONE.test(v)) throw E.bad("رقم الهاتف غير صالح"); o.phone = v || null; }
    if (!partial || b.whatsapp !== undefined) { const v = str(b.whatsapp, 24); if (v && !PHONE.test(v)) throw E.bad("رقم واتساب غير صالح"); o.whatsapp = v ? v.replace(/[^\d+]/g, "") : null; }
    if (!partial || b.email !== undefined) { const v = str(b.email, 120); if (v && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v)) throw E.bad("البريد الإلكتروني غير صالح"); o.email = v || null; }
    if (!partial || b.website !== undefined) o.website = url(b.website, "الموقع");
    if (!partial || b.instagram !== undefined) { const v = str(b.instagram, 40); if (v && !/^@?[A-Za-z0-9._]{1,30}$/.test(v)) throw E.bad("اسم حساب إنستغرام غير صالح"); o.instagram = v ? v.replace(/^@/, "") : null; }
    if (!partial || b.menuUrl !== undefined) o.menu_url = url(b.menuUrl, "رابط القائمة أو الكتالوج");
    if (!partial || b.delivery !== undefined) o.delivery = b.delivery ? 1 : 0;
    if (!partial || b.onlineOnly !== undefined) o.online_only = b.onlineOnly ? 1 : 0;
    if (!partial || b.priceLevel !== undefined) { const v = Math.round(+b.priceLevel || 0); o.price_level = v >= 1 && v <= 4 ? v : null; }
    if (!partial || b.tags !== undefined) o.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(/[,،]/)).map((t) => str(String(t).trim(), 24)).filter(Boolean).slice(0, 8).join(",") || null;
    return o;
  }
  /** where a home-based business is shown: a gazetteer city or a ≤ 5-char area — never the exact spot */
  function homeLocation(b) {
    if (b.area && G.valid(String(b.area).toLowerCase())) { const h = G.coarsen(String(b.area).toLowerCase()).slice(0, 5); const c = G.decode(h); return { lat: c.lat, lng: c.lng }; }
    const r = geo.resolve(String(b.city || "")); const c = r.city && G.CITY_CENTERS[r.city];
    if (!c) throw E.bad("للنشاط المنزلي اختر المدينة فقط (لا نعرض موقع منزلك)");
    return { lat: c[0], lng: c[1] };
  }

  /* ---------- 1. add ---------- */
  async function create(user, b = {}) {
    await noMinor(user);
    if (!rl.hit("default", "biz:" + user.id)) throw E.rate();
    const f = readBiz(b, false), home = !!b.homeBased;
    if (!home && HOME_ADDR.test(String(b.address || ""))) throw Object.assign(E.bad("يبدو أن العنوان عنوان منزل. لا نعرض عناوين المنازل — اختر «نشاط منزلي» لنعرض المدينة فقط"), { code: "home_address" });
    const loc = home ? homeLocation(b) : { lat: b.lat, lng: b.lng };
    const { place } = await NB().submit(user, { name: b.name, category: CATS[f.category][2], descr: b.descr, address: home ? "" : b.address, lat: loc.lat, lng: loc.lng, hoursWeek: b.hoursWeek, url: f.website || undefined });
    await db.run(`INSERT INTO businesses(place_id,category,owner_id,verified,accepts_pi,pi_note,phone,whatsapp,email,website,instagram,menu_url,home_based,delivery,online_only,price_level,tags,created_by,created_at,updated_at)
      VALUES($1,$2,NULL,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)`,
      [place.id, f.category, f.accepts_pi, f.pi_note, f.phone, f.whatsapp, f.email, f.website, f.instagram, f.menu_url, home ? 1 : 0, f.delivery, f.online_only, f.price_level, f.tags, user.id, iso()]);
    if (b.owner !== false) await openClaim(user, place.id, { role: "owner", evidence: b.evidence || "أضفتُ النشاط بنفسي بصفتي صاحبه", contact: b.claimContact });
    await ctx.audit?.("BUSINESS_ADDED", place.id, f.category, user.id);
    return detail(user, place.id);
  }

  /* ---------- 4. page ---------- */
  async function row(pid) { return db.get("SELECT * FROM businesses WHERE place_id=$1", [String(pid)]); }
  async function piDisputed(pid) { return Number((await db.get("SELECT COUNT(*) n FROM place_reports WHERE place_id=$1 AND reason='pi_false'", [pid]))?.n || 0) >= PI_DISPUTE; }
  async function catalog(ownerId) {
    if (!ownerId) return null;
    const u = await db.get("SELECT handle FROM users WHERE id=$1", [ownerId]);
    const n = Number((await db.get("SELECT COUNT(*) n FROM market_listings WHERE seller_id=$1 AND status='active'", [ownerId]).catch(() => ({ n: 0 })))?.n || 0);
    return n && u ? { listings: n, href: `#/market/seller/${encodeURIComponent(u.handle)}` } : null;
  }
  async function detail(user, pid) {
    const b = await row(pid); if (!b) throw E.nf("النشاط التجاري غير موجود");
    const d = await NB().getPlace(user, pid); // throws 404 for non-approved places unless mine / staff
    const minor = user ? await isMinor(user.id) : false;
    const owner = b.owner_id ? await db.get("SELECT id, name, handle, color FROM users WHERE id=$1", [b.owner_id]) : null;
    const mineOwner = !!user && b.owner_id === user.id;
    const myClaim = user ? await db.get("SELECT id, status, note, created_at FROM business_claims WHERE place_id=$1 AND user_id=$2 ORDER BY created_at DESC", [pid, user.id]) : null;
    const disputed = await piDisputed(pid);
    const hideContact = minor && !mineOwner;
    return { ...d, business: {
      category: b.category, categoryLabel: CATS[b.category]?.[0] || "أخرى", icon: CATS[b.category]?.[1] || "i:store",
      acceptsPi: !!Number(b.accepts_pi) && !disputed, piDeclared: !!Number(b.accepts_pi), piDisputed: !!Number(b.accepts_pi) && disputed, piNote: b.pi_note || null,
      verified: !!Number(b.verified), owner: owner && Number(b.verified) ? { name: owner.name, handle: owner.handle, color: owner.color } : null,
      contact: hideContact ? { website: b.website || null, hidden: true } : { phone: b.phone || null, whatsapp: b.whatsapp || null, email: b.email || null, website: b.website || null, instagram: b.instagram || null },
      menuUrl: b.menu_url || null, catalog: await catalog(Number(b.verified) ? b.owner_id : null), homeBased: !!Number(b.home_based), delivery: !!Number(b.delivery), onlineOnly: !!Number(b.online_only),
      priceLevel: b.price_level ? Number(b.price_level) : null, tags: b.tags ? b.tags.split(",") : [],
      mine: mineOwner, canEdit: mineOwner || isStaff(user), canClaim: !!user && !minor && !mineOwner && (!myClaim || ["rejected", "withdrawn"].includes(myClaim.status)),
      myClaim: myClaim ? { id: myClaim.id, status: myClaim.status, note: myClaim.status === "rejected" ? myClaim.note : null, at: myClaim.created_at } : null, minorView: hideContact
    }, shareUrl: `/#/biz/${pid}` };
  }

  /* ---------- owner edits ---------- */
  async function update(user, pid, b = {}) {
    const r0 = await row(pid); if (!r0) throw E.nf("النشاط التجاري غير موجود");
    if (r0.owner_id !== user.id && !isStaff(user)) {
      const p = await db.get("SELECT submitted_by, status FROM places WHERE id=$1", [pid]);
      if (!(p && p.submitted_by === user.id && ["pending", "rejected"].includes(p.status))) throw E.forbid("يعدّل النشاط صاحبه الموثّق فقط؛ قدّم طلب إدارة أولاً");
    }
    const f = readBiz(b, true);
    if (b.homeBased !== undefined && !isStaff(user)) throw E.bad("تغيير نوع الموقع يتم عبر المشرفين");
    const keys = Object.keys(f);
    if (keys.length) await db.run(`UPDATE businesses SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE place_id=$${keys.length + 2}`, [...keys.map((k) => f[k]), iso(), pid]);
    // profile text on the place: description, hours, link — screened like any place text
    const pch = {};
    if (b.descr !== undefined) pch.descr = str(b.descr, 500) || "";
    if (b.hoursWeek !== undefined) pch.hours_week = b.hoursWeek ? JSON.stringify(NB().readWeek(b.hoursWeek)) : null;
    if (f.website !== undefined) pch.url = f.website;
    if (pch.descr) { try { const v = await ctx.services.automod?.assess?.({ text: pch.descr, author: user.id }); if (v && ["block", "remove"].includes(v.action)) throw E.bad("الوصف يخالف الإرشادات"); } catch (e) { if (e.status === 400) throw e; } }
    const pk = Object.keys(pch);
    if (pk.length) await db.run(`UPDATE places SET ${pk.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${pk.length + 1} WHERE id=$${pk.length + 2}`, [...pk.map((k) => pch[k]), iso(), pid]);
    if (!keys.length && !pk.length) throw E.bad("لا تغييرات");
    return detail(user, pid);
  }

  /* ---------- 2. claims ---------- */
  async function openClaim(user, pid, b = {}) {
    const ev = str(b.evidence, 500, { required: true, min: 10 });
    const ex = await db.get("SELECT id FROM business_claims WHERE place_id=$1 AND user_id=$2 AND status='pending'", [pid, user.id]);
    if (ex) throw E.conflict("لديك طلب قيد المراجعة لهذا النشاط");
    const cid = id("bc");
    await db.run("INSERT INTO business_claims(id,place_id,user_id,role,evidence,contact,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)", [cid, pid, user.id, oneOf(b.role, ["owner", "manager"], "owner"), ev, str(b.contact, 120) || null, iso()]);
    return cid;
  }
  async function claim(user, pid, b = {}) {
    await noMinor(user);
    if (!rl.hit("report", "bizclaim:" + user.id)) throw E.rate();
    let r0 = await row(pid);
    if (!r0) { // claiming an approved place that is not in the directory yet turns it into a business
      const p = await db.get("SELECT * FROM places WHERE id=$1 AND status='approved'", [pid]); if (!p) throw E.nf("المكان غير موجود");
      await db.run("INSERT INTO businesses(place_id,category,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$4)", [pid, FROM_PLACE[p.category] || "other", user.id, iso()]);
      r0 = await row(pid);
    }
    if (r0.owner_id === user.id) throw E.bad("أنت صاحب هذا النشاط بالفعل");
    const cid = await openClaim(user, pid, b);
    await ctx.audit?.("BUSINESS_CLAIMED", pid, cid, user.id);
    return { ok: true, claim: { id: cid, status: "pending" } };
  }
  async function withdraw(user, cid) {
    const r = await db.run("UPDATE business_claims SET status='withdrawn', decided_at=$1 WHERE id=$2 AND user_id=$3 AND status='pending'", [iso(), cid, user.id]);
    if (!r.changes) throw E.nf("لا يوجد طلب قيد المراجعة");
    return { ok: true };
  }
  async function claimsQueue(q = {}) {
    const st = oneOf(q.status, ["pending", "approved", "rejected"], "pending");
    const rows = await db.all("SELECT c.*, p.name pname, p.status pstatus, p.city, b.category, b.owner_id, u.name uname, u.handle uhandle, u.created_at ucreated FROM business_claims c JOIN places p ON p.id=c.place_id LEFT JOIN businesses b ON b.place_id=c.place_id LEFT JOIN users u ON u.id=c.user_id WHERE c.status=$1 ORDER BY c.created_at LIMIT 100", [st]);
    const counts = Object.fromEntries((await db.all("SELECT status, COUNT(*) n FROM business_claims GROUP BY status")).map((r) => [r.status, Number(r.n)]));
    return { filter: st, counts, claims: rows.map((c) => ({ id: c.id, placeId: c.place_id, place: { name: c.pname, status: c.pstatus, city: c.city, categoryLabel: CATS[c.category]?.[0] || "" }, hasOwner: !!c.owner_id, role: c.role, roleLabel: c.role === "manager" ? "مدير" : "مالك",
      evidence: c.evidence, contact: c.contact, status: c.status, note: c.note, at: c.created_at, by: { name: c.uname, handle: c.uhandle, since: c.ucreated } })) };
  }
  async function decide(user, cid, b = {}) {
    const c = await db.get("SELECT * FROM business_claims WHERE id=$1", [cid]); if (!c) throw E.nf();
    if (c.status !== "pending") throw E.conflict("قُرِّر هذا الطلب مسبقاً");
    const d = oneOf(b.decision, ["approve", "reject"], null); if (!d) throw E.bad("اختر قبول أو رفض");
    const note = str(b.note, 300) || null, at = iso();
    if (d === "reject" && !note) throw E.bad("اكتب سبب الرفض ليعرفه صاحب الطلب");
    if (d === "approve" && (await isMinor(c.user_id))) throw E.bad("لا يمكن تعيين حساب قاصر صاحباً لنشاط تجاري");
    await db.run("UPDATE business_claims SET status=$1, note=$2, reviewed_by=$3, decided_at=$4 WHERE id=$5 AND status='pending'", [d === "approve" ? "approved" : "rejected", note, user.id, at, cid]);
    if (d === "approve") {
      await db.run("UPDATE businesses SET owner_id=$1, verified=1, verified_by=$2, verified_at=$3, updated_at=$3 WHERE place_id=$4", [c.user_id, user.id, at, c.place_id]);
      const others = await db.all("SELECT id, user_id FROM business_claims WHERE place_id=$1 AND status='pending' AND id<>$2", [c.place_id, cid]);
      for (const o of others) { await db.run("UPDATE business_claims SET status='rejected', note=$1, reviewed_by=$2, decided_at=$3 WHERE id=$4", ["تمت الموافقة على طلب آخر لهذا النشاط", user.id, at, o.id]); await notify(o.user_id, "biz_claim_rejected", c.place_id); }
      await db.run("DELETE FROM place_reports WHERE place_id=$1 AND reason='fake_owner'", [c.place_id]);
    }
    await ctx.audit?.(d === "approve" ? "BUSINESS_CLAIM_APPROVED" : "BUSINESS_CLAIM_REJECTED", c.place_id, cid, user.id);
    await notify(c.user_id, d === "approve" ? "biz_claim_approved" : "biz_claim_rejected", c.place_id);
    return { ok: true, decision: d === "approve" ? "approved" : "rejected" };
  }
  async function revokeOwner(user, pid, b = {}) {
    const r0 = await row(pid); if (!r0) throw E.nf();
    await db.run("UPDATE businesses SET owner_id=NULL, verified=0, verified_by=$1, verified_at=NULL, updated_at=$2 WHERE place_id=$3", [user.id, iso(), pid]);
    await ctx.audit?.("BUSINESS_OWNER_REVOKED", pid, str(b.note, 300) || null, user.id);
    return { ok: true };
  }
  async function mine(user) {
    const owned = await db.all("SELECT b.*, p.name, p.status, p.city FROM businesses b JOIN places p ON p.id=b.place_id WHERE b.owner_id=$1 OR (b.created_by=$1 AND p.status IN ('pending','rejected')) ORDER BY b.updated_at DESC LIMIT 50", [user.id]);
    const claims = await db.all("SELECT c.id, c.place_id, c.status, c.note, c.created_at, p.name FROM business_claims c JOIN places p ON p.id=c.place_id WHERE c.user_id=$1 ORDER BY c.created_at DESC LIMIT 50", [user.id]);
    return { businesses: owned.map((b) => ({ id: b.place_id, name: b.name, status: b.status, city: b.city, categoryLabel: CATS[b.category]?.[0], verified: !!Number(b.verified), mine: b.owner_id === user.id, href: `#/biz/${b.place_id}` })),
      claims: claims.map((c) => ({ id: c.id, placeId: c.place_id, name: c.name, status: c.status, note: c.note, at: c.created_at })) };
  }

  /* ---------- 3. search ---------- */
  async function search(user, q = {}) {
    let c = null;
    try { if (q.area || q.gh || q.place || q.near === "1") c = await NB().centre(user, q); } catch { c = null; }
    const city = q.city ? geo.resolve(String(q.city)).city : null;
    if (q.city && !city) throw E.bad("مدينة غير معروفة");
    const cat = q.category && CATS[q.category] ? q.category : null;
    const radiusKm = Math.max(1, Math.min(100, Math.round(+q.radius || 25)));
    const where = ["p.status='approved'"], args = [];
    if (cat) { args.push(cat); where.push(`b.category=$${args.length}`); }
    if (q.pi === "1") where.push("b.accepts_pi=1");
    if (q.verified === "1") where.push("b.verified=1");
    if (q.delivery === "1") where.push("b.delivery=1");
    if (city) { args.push(city); where.push(`p.city=$${args.length}`); }
    else if (c) { const [a, bb, cc, d] = G.bbox(c.lat, c.lng, radiusKm); args.push(a, cc, bb, d); where.push(`p.lat >= $${args.length - 3} AND p.lat <= $${args.length - 2} AND p.lng >= $${args.length - 1} AND p.lng <= $${args.length}`); }
    const rows = await db.all(`SELECT b.*, p.name, p.descr, p.city, p.country, p.lat, p.lng, p.hours_week, p.created_at pcreated FROM businesses b JOIN places p ON p.id=b.place_id WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT 1000`, args);
    const qn = q.q ? AR.normalize(String(q.q).slice(0, 60)).trim() : "";
    const list = rows.filter((r) => !qn || AR.normalize(`${r.name} ${r.descr || ""} ${r.tags || ""} ${CATS[r.category]?.[0] || ""}`).includes(qn));
    const ids = list.map((r) => r.place_id);
    const rate = ids.length ? await db.all(`SELECT place_id, AVG(rating) a, COUNT(*) n FROM place_reviews WHERE status='visible' AND place_id IN (${ph(ids)}) GROUP BY place_id`, ids) : [];
    const pics = ids.length ? await db.all(`SELECT place_id, url FROM place_photos WHERE status='visible' AND place_id IN (${ph(ids)}) ORDER BY created_at`, ids) : [];
    const disp = ids.length ? await db.all(`SELECT place_id, COUNT(*) n FROM place_reports WHERE reason='pi_false' AND place_id IN (${ph(ids)}) GROUP BY place_id`, ids) : [];
    let items = list.map((r) => {
      const km = c && !Number(r.home_based) ? G.haversine(c.lat, c.lng, r.lat, r.lng) : null;
      const rt = rate.find((x) => x.place_id === r.place_id), disputed = Number(disp.find((x) => x.place_id === r.place_id)?.n || 0) >= PI_DISPUTE;
      const open = NB().openNow(NB().parseWeek(r.hours_week), r.country);
      return { id: r.place_id, name: r.name, descr: String(r.descr || "").slice(0, 140), category: r.category, categoryLabel: CATS[r.category]?.[0] || "أخرى", icon: CATS[r.category]?.[1] || "i:store", city: r.city,
        km, distanceKm: km === null ? null : G.approxKm(km), acceptsPi: !!Number(r.accepts_pi) && !disputed, verified: !!Number(r.verified), homeBased: !!Number(r.home_based), delivery: !!Number(r.delivery), onlineOnly: !!Number(r.online_only), priceLevel: r.price_level ? Number(r.price_level) : null,
        rating: rt ? { avg: Math.round(Number(rt.a) * 10) / 10, count: Number(rt.n) } : { avg: 0, count: 0 }, open, thumb: pics.find((x) => x.place_id === r.place_id)?.url || null, createdAt: r.pcreated, href: `#/biz/${r.place_id}` };
    });
    if (c && !city) items = items.filter((x) => x.km === null || x.km <= radiusKm);
    if (q.open === "1") items = items.filter((x) => x.open?.open);
    const sort = oneOf(q.sort, ["distance", "rating", "new"], c && !city ? "distance" : "rating");
    items.sort(sort === "distance" ? (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9) : sort === "new" ? (a, b) => (a.createdAt < b.createdAt ? 1 : -1) : (a, b) => b.rating.avg * Math.min(1, b.rating.count / 3) - a.rating.avg * Math.min(1, a.rating.count / 3) || b.rating.count - a.rating.count);
    const facets = Object.keys(CATS).map((k) => ({ key: k, n: items.filter((x) => x.category === k).length })).filter((x) => x.n);
    const { radiusKm: _r, ...center } = c || {};
    return { center: c ? center : null, city, radiusKm, sort, total: items.length, items: items.slice(0, 100).map(({ km, createdAt, ...x }) => x), facets, piCount: items.filter((x) => x.acceptsPi).length };
  }
  function config() {
    return { categories: catsList(), cities: Object.keys(G.CITY_CENTERS), reasons: NB().REPORT_REASONS, piDisputeReports: PI_DISPUTE,
      note: "«يقبل Pi» تصريح من صاحب النشاط. الأنشطة الموثّقة راجع المشرفون ملكيتها. لا نعرض عناوين المنازل: النشاط المنزلي يظهر بمدينته فقط." };
  }

  /* ---------- routes ---------- */
  R.get("/api/biz/config", async () => config());
  R.get("/api/biz", async (req) => search(req.user, req.query));
  R.get("/api/biz/mine", A(async (req) => mine(req.user)));
  R.post("/api/biz", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/biz/:id", async (req) => detail(req.user, req.params.id));
  R.patch("/api/biz/:id", A(async (req) => update(req.user, req.params.id, req.body || {})));
  R.post("/api/biz/:id/claim", A(async (req) => claim(req.user, req.params.id, req.body || {})));
  R.del("/api/biz/claims/:id", A(async (req) => withdraw(req.user, req.params.id)));
  R.get("/api/admin/biz/claims", staff(async (req) => claimsQueue(req.query)));
  R.post("/api/admin/biz/claims/:id", staff(async (req) => decide(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/biz/:id/revoke", staff(async (req) => revokeOwner(req.user, req.params.id, req.body || {})));
  return { create, detail, update, claim, withdraw, claimsQueue, decide, revokeOwner, mine, search, config, CATS };
};
