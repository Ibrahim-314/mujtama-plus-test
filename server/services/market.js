/* Community marketplace — السوق المجتمعي (phase 39). Built on the Pi service (payments, purpose `market`), the shared
 * double-entry ledger (lib/ledger.js), chat (order conversation), search (type `listing`), notify, compliance and minors.
 * 1. Listings: products & services priced in Pi (MARKET_MAX_PRICE, 7 decimals), 1–8 of the seller's own image uploads,
 *    fixed categories, draft | active | paused | sold_out | removed. Title + description go through the same spam check
 *    as posts (422 spam) and the automod assessment (hold/escalate → 422 listing_rejected). Active listings are indexed
 *    in the search service as kind `listing`; anything else is removed from the index.
 * 2. Orders: POST /order reserves the quantity, opens the order conversation (a two-member chat conversation titled
 *    with the listing; system messages on every transition) and a Pi intent (purpose `market`, refId = order id).
 *    Effects happen only on PI_PAYMENT_COMPLETED / CANCELLED / REFUNDED from the Pi service (conditional updates).
 * 3. Escrow: paid → journal buyer pi_out → `escrow:market`; release → `escrow:market` → `seller:<id>:earnings`
 *    (+ `platform:fees`, MARKET_FEE_PCT, default 0); refund → back to the buyer; split → both. One market_escrow row per
 *    order, every settlement is a conditional state change + one balanced journal in one transaction (idempotent).
 *    Auto-release MARKET_AUTO_RELEASE_DAYS (7) after the seller marks the order delivered (leased scheduler job).
 * 4. Reviews: one per completed order (buyer → seller), seller reply; aggregates on the seller page and listing cards.
 * 5. Disputes: buyer or seller opens one on a paid, not yet completed order (escrow frozen, auto-release skipped);
 *    thread with evidence; admins resolve refund_buyer | release_seller | split {buyerAmount}.
 * Minors (minors service) can neither buy nor sell (403 minor_restricted). Pi payments off → reads work, order → 409
 * not_configured, listings say canBuy:false buyReason:not_configured. Pi itself never moves here: refunds to the
 * buyer are A2U payments made by the operator outside this server; pi.refund records them. */
const { E, HttpError, str, id, Classifier } = require("../lib/core");
const { toUnits, pi, ACC, createLedger } = require("../lib/ledger");

const DAY = 864e5, HOUR = 3600e3;
const OFF = "مدفوعات Pi غير مفعّلة بعد";
const CATEGORIES = ["electronics", "fashion", "home", "books", "digital", "services", "education", "crafts", "other"];
const KINDS = ["product", "service", "digital"]; // digital: phase 58 (created only through services/digital.js)
const CONDITIONS = ["new", "used", "na"];
const DELIVERY = ["pickup", "shipping", "digital", "onsite"];
const LISTING_STATUSES = ["draft", "active", "paused", "sold_out", "removed"];
const ORDER_STATUSES = ["pending_payment", "paid_held", "shipped", "delivered", "completed", "cancelled", "refunded", "disputed"];
const DISPUTE_REASONS = ["not_received", "not_as_described", "damaged", "other"];
const RESOLUTIONS = ["refund_buyer", "release_seller", "split"];
const SORTS = ["new", "price_asc", "price_desc", "rating"];
const ESCROW = "escrow:market";
const SELLER = (uid) => `seller:${uid}:earnings`;
const MEDIA_ID = /^(?:\/?media\/)?([a-z]{1,4}_[a-z0-9]{4,40})/i;
const STEP_TEXT = {
  pending_payment: "أُنشئ الطلب وبانتظار الدفع",
  paid_held: "تم الدفع، والمبلغ محفوظ لدى الضمان حتى الاستلام",
  shipped: "شحن البائع الطلب",
  delivered: "أكّد البائع تسليم الطلب",
  completed: "اكتمل الطلب وأُفرج عن المبلغ للبائع",
  cancelled: "أُلغي الطلب",
  refunded: "أُعيد المبلغ إلى المشتري",
  disputed: "فُتح نزاع على الطلب",
  dispute_resolved: "حُسم النزاع",
  digital_delivered: "سُلّم المنتج الرقمي فوراً — تجده في «مشترياتي» مع روابط التنزيل"
};

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl, realtime } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const cfg = {
    minPrice: toUnits(0.01),
    maxPrice: toUnits(num("MARKET_MAX_PRICE", 1000)),
    feePct: Math.min(100, num("MARKET_FEE_PCT", 0)),
    autoReleaseMs: num("MARKET_AUTO_RELEASE_DAYS", 7) * DAY,
    pendingTtlMs: num("MARKET_PENDING_TTL_HOURS", 24) * HOUR,
    maxQty: Math.max(1, Math.floor(num("MARKET_MAX_QTY", 100))),
    pageSize: 24
  };
  const feeOf = (units) => Math.floor((Number(units) * cfg.feePct) / 100);
  const hooks = { beforeOrder: [] }; // phase 58
  const { postJournal } = createLedger({ now: nowIso });
  const inList = (arr, start = 1) => arr.map((_, i) => "$" + (i + start)).join(",");
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());
  const parseList = (v) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "[]"); return Array.isArray(x) ? x : []; } catch { return []; } };
  const isAdmin = (u) => u?.role === "admin";
  const piSvc = () => ctx.services.pi;
  const piOn = () => !!piSvc()?.enabled?.();

  /* ======================= helpers ======================= */
  async function isMinor(uid) {
    const m = ctx.services.minors; // registered last
    if (!uid || !m?.isMinorUser) return false;
    try { return !!(await m.isMinorUser(uid)); } catch { return false; }
  }
  async function blockedBetween(a, b) {
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    if ((ua?.prefs?.blocked || []).includes(b) || (ub?.prefs?.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function usersMap(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    const m = new Map();
    if (list.length) for (const u of await db.all(`SELECT id, handle, name, avatar, status, created_at FROM users WHERE id IN (${inList(list)})`, list)) m.set(u.id, u);
    return m;
  }
  const userBrief = (u) => (u ? { id: u.id, handle: u.handle, name: u.name, avatar: u.avatar || null } : null);
  async function ratingsOf(sellerIds) {
    const list = [...new Set(sellerIds.filter(Boolean))];
    const m = new Map();
    if (!list.length) return m;
    for (const r of await db.all(`SELECT seller_id, COUNT(*) AS n, AVG(rating * 1.0) AS avg FROM market_reviews WHERE hidden=0 AND seller_id IN (${inList(list)}) GROUP BY seller_id`, list))
      m.set(r.seller_id, { avg: Math.round(Number(r.avg || 0) * 10) / 10, count: Number(r.n || 0) });
    return m;
  }
  async function salesOf(sellerIds) {
    const list = [...new Set(sellerIds.filter(Boolean))];
    const m = new Map();
    if (!list.length) return m;
    for (const r of await db.all(`SELECT seller_id, COUNT(*) AS n FROM market_orders WHERE status='completed' AND seller_id IN (${inList(list)}) GROUP BY seller_id`, list)) m.set(r.seller_id, Number(r.n || 0));
    return m;
  }
  async function mediaMap(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    const m = new Map();
    if (list.length) for (const x of await db.all(`SELECT id, owner, kind, status, storage_key, variants FROM media WHERE id IN (${inList(list)})`, list)) m.set(x.id, x);
    return m;
  }
  function imageClient(ref, row) {
    if (!row) return null;
    const v = row.variants || {};
    const url = v.original || "/media/" + row.storage_key;
    return { id: row.id, url, thumb: v.thumb || v.sm || url, w: Number(v.w || v.width) || null, h: Number(v.h || v.height) || null, alt: ref.alt || "" };
  }
  const cursorOf = (n) => Buffer.from(String(n)).toString("base64url");
  const offsetOf = (c) => { if (!c) return 0; const n = Number(Buffer.from(String(c), "base64url").toString()); if (!Number.isInteger(n) || n < 0 || n > 1e6) throw fail(400, "bad_request", "مؤشر غير صالح"); return n; };

  /* ======================= validation ======================= */
  function priceUnits(v) {
    const x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof x !== "number" || !Number.isFinite(x)) throw fail(400, "price_invalid", `السعر بين ${pi(cfg.minPrice)} و${pi(cfg.maxPrice)} Pi`);
    const u = toUnits(x);
    if (Math.abs(u - x * 1e7) > 1e-3 * Math.max(1, x)) throw fail(400, "price_invalid", "السعر بحد أقصى ٧ خانات عشرية");
    if (u < cfg.minPrice || u > cfg.maxPrice) throw fail(400, "price_invalid", `السعر بين ${pi(cfg.minPrice)} و${pi(cfg.maxPrice)} Pi`);
    return u;
  }
  const invalid = (msg) => fail(400, "listing_invalid", msg);
  function textField(v, { min = 0, max, required = false, label }) {
    if (v === undefined || v === null || v === "") { if (required) throw invalid(`${label} مطلوب`); return null; }
    if (typeof v !== "string") throw invalid(`${label} غير صالح`);
    const s = v.trim();
    if (s.length < min || s.length > max) throw invalid(`${label}: من ${min} إلى ${max} حرفاً`);
    return s;
  }
  async function validateImages(user, v) {
    if (!Array.isArray(v) || v.length < 1 || v.length > 8) throw fail(400, "images_invalid", "أضف من صورة إلى ٨ صور");
    const refs = v.map((x) => {
      const raw = typeof x === "string" ? x : x && typeof x === "object" ? x.id || x.url : null;
      const m = typeof raw === "string" ? MEDIA_ID.exec(raw) : null;
      if (!m) throw fail(400, "images_invalid", "صورة غير صالحة");
      const alt = x && typeof x === "object" && typeof x.alt === "string" ? x.alt.trim().slice(0, 300) : "";
      return { id: m[1], alt };
    });
    if (new Set(refs.map((r) => r.id)).size !== refs.length) throw fail(400, "images_invalid", "صورة مكررة");
    const rows = await mediaMap(refs.map((r) => r.id));
    for (const r of refs) {
      const m = rows.get(r.id);
      if (!m || m.owner !== user.id || m.kind !== "image" || m.status !== "ready") throw fail(400, "images_invalid", "استخدم صورك أنت المرفوعة فقط");
    }
    if (await db.get(`SELECT 1 x FROM paid_media WHERE media_id IN (${inList(refs.map((r) => r.id))}) LIMIT 1`, refs.map((r) => r.id)).catch(() => null))
      throw fail(400, "images_invalid", "هذه الصورة مستخدمة في محتوى مدفوع");
    return refs;
  }
  /** full validation for create (cur = null) or a partial PATCH (cur = the stored listing) */
  async function validateListing(user, b, cur = null, o = {}) {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw invalid("بيانات الإعلان غير صالحة");
    const has = (k) => b[k] !== undefined;
    const out = {};
    const kind = has("kind") ? b.kind : cur ? cur.kind : "product";
    if (!KINDS.includes(kind)) throw invalid("نوع الإعلان: منتج أو خدمة");
    if ((kind === "digital") !== (o.digital || cur?.kind === "digital") || (cur?.kind === "digital" && kind !== "digital")) throw invalid("المنتجات الرقمية تُدار من متجر المنتجات الرقمية");
    out.kind = kind;
    if (!cur || has("title")) out.title = textField(b.title, { min: 3, max: 120, required: true, label: "العنوان" });
    if (!cur || has("description")) out.description = textField(b.description, { max: 5000, label: "الوصف" }) || "";
    if (!cur || has("price")) out.price = priceUnits(b.price);
    if (has("currency") && b.currency !== "PI" && b.currency !== "Pi") throw fail(400, "price_invalid", "العملة المدعومة Pi فقط");
    if (!cur || has("category")) { if (!CATEGORIES.includes(b.category)) throw fail(400, "category_invalid", "التصنيف غير معروف"); out.category = b.category; }
    if (!cur || has("condition")) {
      const c = b.condition === undefined || b.condition === null ? (kind === "product" ? "new" : "na") : b.condition;
      if (!CONDITIONS.includes(c)) throw invalid("الحالة: جديد أو مستعمل أو غير منطبق");
      out.item_condition = c;
    }
    if (!cur || has("quantity") || has("kind")) {
      const q = has("quantity") ? b.quantity : cur ? cur.quantity : kind === "service" ? null : 1;
      if (q === null || q === undefined) { if (kind === "product") throw invalid("الكمية مطلوبة للمنتجات"); out.quantity = null; }
      else { if (!Number.isInteger(q) || q < 0 || q > 1e6) throw invalid("الكمية عدد صحيح ≥ ٠"); out.quantity = q; }
    }
    if (!cur || has("images")) out.images = JSON.stringify(await validateImages(user, b.images));
    if (!cur || has("location")) out.location = textField(b.location, { max: 120, label: "الموقع" });
    if (!cur || has("delivery")) {
      const d = kind === "digital" ? "digital" : b.delivery === undefined || b.delivery === null ? (kind === "service" ? "onsite" : "pickup") : b.delivery;
      if (!DELIVERY.includes(d)) throw invalid("طريقة التسليم غير معروفة");
      out.delivery = d;
    }
    if (has("status") || !cur) {
      const s = b.status === undefined ? "active" : b.status;
      if (!["draft", "active", "paused"].includes(s)) throw invalid("الحالة: مسودة أو نشط أو موقوف");
      out.status = s;
    }
    if (has("communityId") || has("community")) {
      const cid = b.communityId !== undefined ? b.communityId : b.community;
      if (cid === null || cid === "") out.community_id = null;
      else {
        if (typeof cid !== "string") throw invalid("المجتمع غير صالح");
        const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, user.id]);
        if (!m || ["pending", "banned", "muted"].includes(m.role)) throw invalid("انضم إلى المجتمع أولاً");
        out.community_id = cid;
      }
    } else if (!cur) out.community_id = null;
    const title = out.title ?? cur?.title ?? "", descr = out.description ?? cur?.description ?? "";
    const full = `${title} ${descr}`;
    if (Classifier.spam(full)) { ctx.audit?.("SPAM_BLOCKED", user.id, "market listing", "system"); throw fail(422, "spam", "يبدو الإعلان كرسالة مزعجة ولم يُنشر"); }
    const am = ctx.services.automod;
    if (am?.assess && user.role !== "admin" && env.AUTOMOD_ENABLED !== "0") {
      const v = await am.assess({ text: full, author: user.id }).catch(() => null);
      if (v && (v.action === "hold" || v.action === "escalate")) {
        ctx.audit?.("MARKET_LISTING_REJECTED", user.id, (v.reasons || []).join(","), "system");
        throw new HttpError(422, "لا يمكن نشر هذا الإعلان لأنه قد يخالف إرشادات المجتمع" + (v.explanations?.length ? ": " + v.explanations.map((x) => x.label || x).join("، ") : ""), "listing_rejected");
      }
    }
    return out;
  }

  /* ======================= serialisation ======================= */
  async function cards(rows, viewer) {
    if (!rows.length) return [];
    const um = await usersMap(rows.map((r) => r.seller_id)), rt = await ratingsOf(rows.map((r) => r.seller_id));
    const imgs = rows.map((r) => parseList(r.images)), mm = await mediaMap(imgs.map((x) => x[0]?.id));
    return rows.map((r, i) => {
      const u = um.get(r.seller_id), cover = imgs[i][0] ? imageClient(imgs[i][0], mm.get(imgs[i][0].id)) : null;
      return {
        id: r.id, kind: r.kind, title: r.title, price: pi(r.price), currency: "PI", category: r.category, condition: r.item_condition, delivery: r.delivery,
        location: r.location || null, status: r.status, quantity: r.quantity == null ? null : Number(r.quantity), soldOut: r.status === "sold_out",
        cover, imageCount: imgs[i].length, communityId: r.community_id || null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
        seller: u ? { ...userBrief(u), rating: rt.get(u.id) || { avg: 0, count: 0 } } : null,
        ...(viewer && viewer.id === r.seller_id ? { mine: true, views: Number(r.views || 0) } : {})
      };
    });
  }
  async function buyState(viewer, l) {
    if (!viewer) return "sign_in";
    if (viewer.id === l.seller_id) return "own_listing";
    if (await isMinor(viewer.id)) return "minor_restricted";
    if (await blockedBetween(viewer.id, l.seller_id)) return "blocked";
    if (l.status === "sold_out" || (l.quantity != null && Number(l.quantity) <= 0)) return "sold_out";
    if (l.status !== "active") return "unavailable";
    if (!piOn()) return "not_configured";
    return null;
  }
  async function listingFull(l, viewer) {
    const [card] = await cards([l], viewer);
    const refs = parseList(l.images), mm = await mediaMap(refs.map((r) => r.id));
    const sales = (await salesOf([l.seller_id])).get(l.seller_id) || 0;
    const reason = await buyState(viewer, l);
    return {
      ...card, description: l.description || "", images: refs.map((r) => imageClient(r, mm.get(r.id))).filter(Boolean), views: Number(l.views || 0),
      seller: card.seller ? { ...card.seller, sales } : null, canBuy: !reason, ...(reason ? { buyReason: reason } : {}), piEnabled: piOn(),
      ...(reason === "not_configured" ? { buyNote: OFF } : {}), maxQty: l.quantity == null ? cfg.maxQty : Math.min(cfg.maxQty, Number(l.quantity))
    };
  }
  const visibleTo = (l, viewer) => l && (["active", "sold_out"].includes(l.status) || (viewer && (viewer.id === l.seller_id || isAdmin(viewer)) && l.status !== "removed") || (isAdmin(viewer) && l.status === "removed"));
  async function getListing(lid) { return db.get("SELECT * FROM market_listings WHERE id=$1", [String(lid || "").slice(0, 100)]); }

  /* ======================= search index ======================= */
  async function reindex(lid) {
    const s = ctx.services.search;
    if (!s?.indexDoc) return;
    const l = await getListing(lid);
    const seller = l ? await db.get("SELECT status FROM users WHERE id=$1", [l.seller_id]) : null;
    try {
      if (!l || l.status !== "active" || seller?.status !== "active") await s.removeDoc("listing", lid);
      else await s.indexDoc({ kind: "listing", id: l.id, title: l.title, body: `${l.description || ""} ${l.location || ""}`, ptype: l.category, community: l.community_id || null, author: l.seller_id, visibility: "public", created_at: iso(l.created_at) });
    } catch (e) { logger.warn?.("market index failed", { listing: lid, err: e.message }); }
  }
  async function searchIds(q) {
    const s = ctx.services.search;
    if (!q) return null;
    if (s?.engineIds) { const r = await s.engineIds(q, ["listing"], {}); return r.ids.filter((x) => x.kind === "listing").map((x) => x.id); }
    const like = "%" + q.toLowerCase().replace(/[%_\\]/g, "") + "%";
    return (await db.all("SELECT id FROM market_listings WHERE status='active' AND (LOWER(title) LIKE $1 OR LOWER(description) LIKE $1) LIMIT 200", [like])).map((x) => x.id);
  }

  /* ======================= listings ======================= */
  async function browse(viewer, q) {
    const where = ["l.status='active'", "u.status='active'"], args = [];
    const add = (sql, v) => { args.push(v); where.push(sql.replace("?", "$" + args.length)); };
    const text = q.q ? str(String(q.q), 120) : null;
    if (text) {
      const ids = (await searchIds(text)).slice(0, 200);
      if (!ids.length) return { items: [], next: null };
      where.push(`l.id IN (${inList(ids, args.length + 1)})`); args.push(...ids);
    }
    if (q.category) { if (!CATEGORIES.includes(q.category)) throw fail(400, "category_invalid", "التصنيف غير معروف"); add("l.category=?", q.category); }
    if (q.kind) { if (!KINDS.includes(q.kind)) throw invalid("نوع غير معروف"); add("l.kind=?", q.kind); }
    if (q.condition && CONDITIONS.includes(q.condition)) add("l.item_condition=?", q.condition);
    if (q.delivery && DELIVERY.includes(q.delivery)) add("l.delivery=?", q.delivery);
    if (q.community) add("l.community_id=?", String(q.community).slice(0, 80));
    for (const [k, op] of [["min", ">="], ["max", "<="]]) if (q[k] !== undefined && q[k] !== "") {
      const v = Number(q[k]); if (!Number.isFinite(v) || v < 0) throw fail(400, "price_invalid", "نطاق السعر غير صالح");
      add(`l.price ${op} ?`, toUnits(v));
    }
    const blocked = viewer?.prefs?.blocked || [];
    if (blocked.length) { where.push(`l.seller_id NOT IN (${inList(blocked, args.length + 1)})`); args.push(...blocked); }
    const sort = SORTS.includes(q.sort) ? q.sort : "new";
    const order = { new: "l.created_at DESC, l.id DESC", price_asc: "l.price ASC, l.created_at DESC, l.id DESC", price_desc: "l.price DESC, l.created_at DESC, l.id DESC",
      rating: "COALESCE((SELECT AVG(r.rating * 1.0) FROM market_reviews r WHERE r.seller_id=l.seller_id AND r.hidden=0), 0) DESC, l.created_at DESC, l.id DESC" }[sort];
    const limit = Math.min(48, Math.max(1, Number(q.limit) || cfg.pageSize)), off = offsetOf(q.cursor);
    const rows = await db.all(`SELECT l.* FROM market_listings l JOIN users u ON u.id=l.seller_id WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${off}`, args);
    const more = rows.length > limit;
    return { items: await cards(rows.slice(0, limit), viewer), next: more ? cursorOf(off + limit) : null };
  }
  async function readListing(viewer, lid) {
    const l = await getListing(lid);
    if (!visibleTo(l, viewer)) throw E.nf("الإعلان غير موجود");
    const seller = await db.get("SELECT status FROM users WHERE id=$1", [l.seller_id]);
    if (seller?.status !== "active" && !isAdmin(viewer) && viewer?.id !== l.seller_id) throw E.nf("الإعلان غير موجود");
    if (!viewer || viewer.id !== l.seller_id) await db.run("UPDATE market_listings SET views=views+1 WHERE id=$1", [l.id]);
    return { listing: await listingFull(l, viewer) };
  }
  async function createListing(user, b, o = {}) {
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "البيع والشراء في السوق غير متاحين لمن هم دون ١٨ سنة");
    if (!rl.hit("post", "market:" + user.id)) throw E.rate();
    const v = await validateListing(user, b, null, o);
    if (v.quantity === 0 && v.status === "active") v.status = "sold_out";
    const lid = id("ml"), at = nowIso();
    await db.run(`INSERT INTO market_listings(id,seller_id,kind,title,description,price,currency,category,item_condition,quantity,images,location,delivery,status,community_id,views,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'PI',$7,$8,$9,$10,$11,$12,$13,$14,0,$15,$15)`,
    [lid, user.id, v.kind, v.title, v.description, v.price, v.category, v.item_condition, v.quantity, v.images, v.location, v.delivery, v.status, v.community_id, at]);
    ctx.audit?.("market_listing_created", lid, null, user.id);
    bus.emit("MARKET_LISTING_CREATED", { listing: lid, seller: user.id, actor: user.id });
    await reindex(lid);
    return { listing: await listingFull(await getListing(lid), user) };
  }
  async function updateListing(user, lid, b) {
    const l = await getListing(lid);
    if (!l || l.status === "removed") throw E.nf("الإعلان غير موجود");
    if (l.seller_id !== user.id) throw E.forbid("هذا الإعلان ليس لك");
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "البيع والشراء في السوق غير متاحين لمن هم دون ١٨ سنة");
    const v = await validateListing(user, b, l);
    const q = v.quantity !== undefined ? v.quantity : l.quantity == null ? null : Number(l.quantity);
    let status = v.status !== undefined ? v.status : l.status;
    if (status === "active" && q !== null && q <= 0) status = "sold_out";
    if (status === "sold_out" && (q === null || q > 0) && v.status === undefined) status = "active";
    v.status = status;
    const cols = Object.keys(v);
    await db.run(`UPDATE market_listings SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(", ")}, updated_at=$${cols.length + 1} WHERE id=$${cols.length + 2}`, [...cols.map((c) => v[c]), nowIso(), l.id]);
    await reindex(l.id);
    return { listing: await listingFull(await getListing(l.id), user) };
  }
  async function removeListing(user, lid) {
    const l = await getListing(lid);
    if (!l || l.status === "removed") throw E.nf("الإعلان غير موجود");
    if (l.seller_id !== user.id && !isAdmin(user)) throw E.forbid("هذا الإعلان ليس لك");
    const at = nowIso();
    await db.run("UPDATE market_listings SET status='removed', removed_at=$1, removed_by=$2, updated_at=$1 WHERE id=$3", [at, user.id, l.id]);
    if (l.seller_id !== user.id) ctx.audit?.("market_listing_removed", l.id, null, user.id);
    await reindex(l.id);
    return { ok: true, listing: { id: l.id, status: "removed" } };
  }
  async function myListings(user, q) {
    const st = LISTING_STATUSES.includes(q.status) ? q.status : null;
    const rows = await db.all(`SELECT * FROM market_listings WHERE seller_id=$1 ${st ? "AND status=$2" : "AND status<>'removed'"} ORDER BY created_at DESC LIMIT 200`, st ? [user.id, st] : [user.id]);
    return { items: await cards(rows, user), next: null };
  }

  /* ======================= order conversation ======================= */
  async function openConversation(t, buyer, seller, title, at) {
    const cid = id("cv");
    await t.run("INSERT INTO conversations(id,created_at,updated_at,kind,title,owner) VALUES($1,$2,$2,'group',$3,NULL)", [cid, at, ("طلب: " + title).slice(0, 80)]);
    for (const uid of [buyer, seller]) await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at,last_read_at) VALUES($1,$2,'accepted','member',$3,$3)", [cid, uid, at]);
    return cid;
  }
  async function systemMessage(order, step, extra = {}) {
    if (!order.conversation_id) return;
    try {
      const mid = id("ms"), at = nowIso(), meta = { event: "market", step, order: order.id, ...extra };
      const text = STEP_TEXT[step] || step;
      await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,meta) VALUES($1,$2,$3,$4,$5,'system',$6)", [mid, order.conversation_id, extra.actor || order.seller_id, text, at, meta]);
      await db.run("UPDATE conversations SET updated_at=$1 WHERE id=$2", [at, order.conversation_id]);
      const msg = { id: mid, conv: order.conversation_id, from: extra.actor || order.seller_id, kind: "system", at, text, meta, replyTo: null, expiresAt: null, deleted: false, reactions: [] };
      for (const uid of [order.buyer_id, order.seller_id]) realtime?.send?.(uid, "chat", { type: "message", message: msg });
    } catch (e) { logger.warn?.("market system message failed", { order: order.id, err: e.message }); }
  }
  const notify = (uid, kind, o) => ctx.services.notify?.notify?.(uid, kind, o).catch((e) => logger.warn?.("market notify failed", { kind, err: e.message }));

  /* ======================= orders ======================= */
  const getOrder = (oid) => db.get("SELECT * FROM market_orders WHERE id=$1", [String(oid || "").slice(0, 100)]);
  async function restoreQty(t, o) {
    await t.run("UPDATE market_listings SET quantity = CASE WHEN quantity IS NULL THEN NULL ELSE quantity + $1 END, status = CASE WHEN status='sold_out' THEN 'active' ELSE status END, updated_at=$2 WHERE id=$3",
      [Number(o.qty), nowIso(), o.listing_id]);
  }
  async function placeOrder(user, lid, b) {
    const l = await getListing(lid);
    if (!l || !["active", "sold_out"].includes(l.status)) throw E.nf("الإعلان غير موجود");
    const seller = await db.get("SELECT id, handle, status FROM users WHERE id=$1", [l.seller_id]);
    if (seller?.status !== "active") throw E.nf("الإعلان غير موجود");
    if (l.seller_id === user.id) throw fail(400, "own_listing", "هذا إعلانك");
    if ((await isMinor(user.id)) || (await isMinor(l.seller_id))) throw fail(403, "minor_restricted", "البيع والشراء في السوق غير متاحين لمن هم دون ١٨ سنة");
    if (await blockedBetween(user.id, l.seller_id)) throw fail(403, "blocked", "لا يمكن الشراء من هذا الحساب");
    const qty = b?.qty === undefined || b?.qty === null ? 1 : b.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > cfg.maxQty) throw fail(400, "qty_invalid", `الكمية من ١ إلى ${cfg.maxQty}`);
    if (l.status === "sold_out" || (l.quantity != null && Number(l.quantity) <= 0)) throw fail(409, "sold_out", "نفدت الكمية");
    if (l.quantity != null && Number(l.quantity) < qty) throw fail(409, "insufficient_quantity", `المتاح ${Number(l.quantity)} فقط`);
    if (!piOn()) throw fail(409, "not_configured", OFF);
    for (const f of hooks.beforeOrder) await f(user, l, b); // phase 58: digital products (one per buyer, qty 1, product not blocked)
    if (!rl.hit("pi_intent", "market:" + user.id)) throw E.rate();
    const unit = Number(l.price), total = unit * qty;
    if (total > cfg.maxPrice) throw fail(400, "qty_invalid", `إجمالي الطلب أكبر من الحد (${pi(cfg.maxPrice)} Pi)`);
    const oid = id("mo"), at = nowIso();
    // reserve the quantity and open the conversation; the Pi intent comes last and is compensated on failure
    await db.tx(async (t) => {
      const r = await t.run("UPDATE market_listings SET quantity = CASE WHEN quantity IS NULL THEN NULL ELSE quantity - $1 END, updated_at=$2 WHERE id=$3 AND status='active' AND (quantity IS NULL OR quantity >= $1)", [qty, at, l.id]);
      if (!r.changes) throw fail(409, "sold_out", "نفدت الكمية");
      await t.run("UPDATE market_listings SET status='sold_out' WHERE id=$1 AND quantity IS NOT NULL AND quantity <= 0 AND status='active'", [l.id]);
      const cid = await openConversation(t, user.id, l.seller_id, l.title, at);
      await t.run(`INSERT INTO market_orders(id,listing_id,buyer_id,seller_id,title,qty,unit_price,total,fee,status,conversation_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_payment',$10,$11,$11)`,
        [oid, l.id, user.id, l.seller_id, l.title, qty, unit, total, feeOf(total), cid, at]);
    });
    let it;
    try {
      it = await piSvc().createIntent(user, { amount: pi(total), memo: `السوق: ${l.title}`.slice(0, 200), purpose: "market", refId: oid });
    } catch (e) {
      await db.tx(async (t) => {
        const o = await t.get("SELECT * FROM market_orders WHERE id=$1", [oid]);
        if (!o) return;
        await restoreQty(t, o);
        await t.run("DELETE FROM market_orders WHERE id=$1", [oid]);
        if (o.conversation_id) await t.run("DELETE FROM conversations WHERE id=$1", [o.conversation_id]);
      });
      await reindex(l.id);
      throw e;
    }
    await db.run("UPDATE market_orders SET intent_id=$1 WHERE id=$2", [it.id, oid]);
    await reindex(l.id);
    const o = await getOrder(oid);
    await systemMessage(o, "pending_payment", { actor: user.id });
    await notify(l.seller_id, "market_order_new", { actor: user.id, ref: oid });
    bus.emit("MARKET_ORDER_CREATED", { order: oid, listing: l.id, buyer: user.id, seller: l.seller_id, actor: user.id });
    return { order: await orderClient(o, user), intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata } };
  }

  async function escrowOf(oid) { return db.get("SELECT * FROM market_escrow WHERE order_id=$1", [oid]); }
  const escrowClient = (e) => (e ? { state: e.state, amount: pi(e.amount), fee: pi(e.fee), buyerAmount: pi(e.buyer_amount), sellerAmount: pi(e.seller_amount), heldAt: iso(e.created_at), settledAt: iso(e.settled_at) } : null);
  function timelineOf(o) {
    const steps = [["pending_payment", o.created_at], ["paid_held", o.paid_at], ["shipped", o.shipped_at], ["delivered", o.delivered_at], ["disputed", o.disputed_at], ["completed", o.completed_at], ["cancelled", o.cancelled_at], ["refunded", o.refunded_at]];
    return steps.filter(([, at]) => at).map(([status, at]) => ({ status, at: iso(at), label: STEP_TEXT[status] })).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
  function actionsFor(o, role, dispute, review) {
    const a = [];
    if (role === "buyer") {
      if (o.status === "pending_payment") a.push("pay", "cancel");
      if (["paid_held", "shipped", "delivered"].includes(o.status)) a.push("confirm", "dispute");
      if (o.status === "completed" && !review) a.push("review");
    }
    if (role === "seller") {
      if (o.status === "pending_payment") a.push("cancel");
      if (o.status === "paid_held") a.push("ship", "deliver", "cancel", "dispute");
      if (o.status === "shipped") a.push("deliver", "dispute");
      if (o.status === "delivered") a.push("dispute");
    }
    if (dispute && dispute.status !== "resolved") return a.filter((x) => x !== "dispute" && x !== "confirm" && x !== "cancel" && x !== "ship" && x !== "deliver");
    return a;
  }
  async function orderClient(o, viewer, { brief = false } = {}) {
    const role = viewer?.id === o.buyer_id ? "buyer" : viewer?.id === o.seller_id ? "seller" : isAdmin(viewer) ? "admin" : null;
    const um = await usersMap([o.buyer_id, o.seller_id]);
    const l = await getListing(o.listing_id), refs = l ? parseList(l.images) : [], mm = await mediaMap(refs.slice(0, 1).map((r) => r.id));
    const dispute = await db.get("SELECT * FROM market_disputes WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1", [o.id]);
    const review = await db.get("SELECT * FROM market_reviews WHERE order_id=$1", [o.id]);
    const out = {
      id: o.id, listingId: o.listing_id, title: o.title,
      listing: l ? { id: l.id, title: l.title, kind: l.kind, delivery: l.delivery, status: l.status, cover: refs[0] ? imageClient(refs[0], mm.get(refs[0].id)) : null } : null,
      buyer: userBrief(um.get(o.buyer_id)), seller: userBrief(um.get(o.seller_id)), role,
      qty: Number(o.qty), unitPrice: pi(o.unit_price), total: pi(o.total), fee: pi(o.fee), currency: "PI", status: o.status,
      conversationId: o.conversation_id || null, createdAt: iso(o.created_at), updatedAt: iso(o.updated_at),
      autoReleaseAt: o.status === "delivered" && o.delivered_at ? new Date(Date.parse(iso(o.delivered_at)) + cfg.autoReleaseMs).toISOString() : null,
      dispute: dispute ? { id: dispute.id, status: dispute.status, reason: dispute.reason, resolution: dispute.resolution || null } : null,
      review: review ? reviewClient(review, um) : null,
      actions: role ? actionsFor(o, role, dispute, review) : []
    };
    if (brief) return out;
    out.escrow = escrowClient(await escrowOf(o.id));
    out.timeline = timelineOf(o);
    out.tracking = o.tracking || null;
    out.paymentIntentId = role === "buyer" || role === "admin" ? o.intent_id || null : null;
    if (role === "buyer" && o.status === "pending_payment" && o.intent_id) {
      const tx = await db.get("SELECT id, amount, memo, status FROM pi_transactions WHERE id=$1", [o.intent_id]);
      out.intent = tx && ["created", "approved"].includes(tx.status) ? { id: tx.id, amount: Number(tx.amount), memo: tx.memo || "", metadata: { intentId: tx.id } } : null;
    }
    return out;
  }
  async function readOrder(viewer, oid) {
    const o = await getOrder(oid);
    if (!o || (o.buyer_id !== viewer.id && o.seller_id !== viewer.id && !isAdmin(viewer))) throw E.nf("الطلب غير موجود");
    return { order: await orderClient(o, viewer) };
  }
  async function myOrders(user, q) {
    const role = q.role === "seller" ? "seller" : "buyer";
    const st = ORDER_STATUSES.includes(q.status) ? q.status : null;
    const off = offsetOf(q.cursor), limit = 50;
    const rows = await db.all(`SELECT * FROM market_orders WHERE ${role === "seller" ? "seller_id" : "buyer_id"}=$1 ${st ? "AND status=$2" : ""} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${off}`, st ? [user.id, st] : [user.id]);
    const items = [];
    for (const o of rows.slice(0, limit)) items.push(await orderClient(o, user, { brief: true }));
    return { role, items, next: rows.length > limit ? cursorOf(off + limit) : null };
  }

  /** conditional status change; returns the fresh row or null when the order was not in one of `from` */
  async function transition(t, o, to, from, sets = {}) {
    const at = nowIso(), cols = { status: to, updated_at: at, ...sets };
    const keys = Object.keys(cols), args = keys.map((k) => cols[k]);
    args.push(o.id);
    const ph = from.map((s) => { args.push(s); return "$" + args.length; }).join(",");
    const r = await t.run(`UPDATE market_orders SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")} WHERE id=$${keys.length + 1} AND status IN (${ph})`, args);
    return r.changes ? t.get("SELECT * FROM market_orders WHERE id=$1", [o.id]) : null;
  }
  /** escrow settlement: one conditional state change + one balanced journal (idempotent by ikey) */
  async function settle(t, o, mode, buyerUnits = 0) {
    const e = await t.get("SELECT * FROM market_escrow WHERE order_id=$1", [o.id]);
    if (!e || e.state !== "held") return null;
    const total = Number(e.amount);
    let b = 0, s = 0, fee = 0;
    if (mode === "release") { s = total; fee = Number(e.fee); }
    else if (mode === "refund") b = total;
    else { b = buyerUnits; s = total - b; fee = feeOf(s); }
    const state = { release: "released", refund: "refunded", split: "split" }[mode];
    const r = await t.run("UPDATE market_escrow SET state=$1, buyer_amount=$2, seller_amount=$3, fee=$4, settled_at=$5 WHERE order_id=$6 AND state='held'", [state, b, s - fee, fee, nowIso(), o.id]);
    if (!r.changes) return null;
    const jid = await postJournal(t, {
      ikey: `market:${o.id}:${mode}`, kind: "market_" + mode, source: "market", refId: o.id, senderId: o.buyer_id, piTx: o.intent_id,
      lines: [
        { account: ESCROW, debit: total },
        { account: ACC.out(o.buyer_id), userId: o.buyer_id, credit: b },
        { account: SELLER(o.seller_id), userId: o.seller_id, credit: s - fee },
        { account: ACC.fees, credit: fee }
      ]
    });
    await t.run("UPDATE market_escrow SET settle_journal=$1 WHERE order_id=$2", [jid, o.id]);
    return state;
  }
  /** record the Pi refund on the payment (operator sends the Pi back outside the app); never fatal */
  async function recordPiRefund(by, o, note) {
    if (!o.intent_id) return;
    try { await piSvc()?.refund?.(by, o.intent_id, { note }); } catch (e) { logger.warn?.("market pi refund record failed", { order: o.id, err: e.message }); }
  }

  async function onPaid(o, e) {
    const out = await db.tx(async (t) => {
      const cur = await t.get("SELECT * FROM market_orders WHERE id=$1", [o.id]);
      if (!cur || !["pending_payment", "cancelled"].includes(cur.status)) return null;
      const late = cur.status === "cancelled";
      const n = await transition(t, cur, "paid_held", ["pending_payment", "cancelled"], { paid_at: nowIso(), payment_id: e.paymentId || null, ...(late ? { cancelled_at: null, cancel_reason: null, cancelled_by: null } : {}) });
      if (!n) return null;
      if (late) await t.run("UPDATE market_listings SET quantity = CASE WHEN quantity IS NULL THEN NULL WHEN quantity >= $1 THEN quantity - $1 ELSE 0 END, updated_at=$2 WHERE id=$3", [Number(cur.qty), nowIso(), cur.listing_id]);
      await t.run("INSERT INTO market_escrow(order_id,amount,fee,state,created_at) VALUES($1,$2,$3,'held',$4) ON CONFLICT DO NOTHING", [cur.id, Number(cur.total), Number(cur.fee), nowIso()]);
      const jid = await postJournal(t, { ikey: `market:${cur.id}:hold`, kind: "market_hold", source: "market", refId: cur.id, senderId: cur.buyer_id, piTx: e.tx,
        lines: [{ account: ACC.out(cur.buyer_id), userId: cur.buyer_id, debit: Number(cur.total) }, { account: ESCROW, credit: Number(cur.total) }] });
      if (jid) await t.run("UPDATE market_escrow SET hold_journal=$1 WHERE order_id=$2", [jid, cur.id]);
      return { order: n, late };
    });
    if (!out) return;
    if (out.late) await reindex(out.order.listing_id);
    await systemMessage(out.order, "paid_held", { actor: out.order.buyer_id });
    await notify(out.order.seller_id, "market_order_paid", { actor: out.order.buyer_id, ref: out.order.id });
    bus.emit("MARKET_ORDER_PAID", { order: out.order.id, buyer: out.order.buyer_id, seller: out.order.seller_id, amount: pi(out.order.total), actor: out.order.buyer_id });
  }
  async function cancelPending(o, by, reason) {
    const n = await db.tx(async (t) => {
      const x = await transition(t, o, "cancelled", ["pending_payment"], { cancelled_at: nowIso(), cancel_reason: reason, cancelled_by: by });
      if (x) await restoreQty(t, o);
      return x;
    });
    if (n) { await reindex(o.listing_id); await systemMessage(n, "cancelled", { actor: by && by !== "system" ? by : o.seller_id, reason }); }
    return n;
  }

  async function act(user, oid, action, b) {
    const o = await getOrder(oid);
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id)) throw E.nf("الطلب غير موجود");
    const role = o.buyer_id === user.id ? "buyer" : "seller";
    const bad = () => fail(409, "invalid_state", "لا يمكن تنفيذ هذا الإجراء على الطلب في حالته الحالية");
    const party = (want) => { if (role !== want) throw E.forbid(want === "seller" ? "هذا الإجراء للبائع فقط" : "هذا الإجراء للمشتري فقط"); };
    let n = null;
    if (action === "ship") {
      party("seller");
      const tracking = b?.tracking !== undefined ? str(b.tracking, 200) : null;
      n = await db.tx((t) => transition(t, o, "shipped", ["paid_held"], { shipped_at: nowIso(), ...(tracking ? { tracking } : {}) }));
      if (!n) throw bad();
      await systemMessage(n, "shipped", { actor: user.id, ...(tracking ? { tracking } : {}) });
      await notify(o.buyer_id, "market_order_shipped", { actor: user.id, ref: o.id });
    } else if (action === "deliver") {
      party("seller");
      n = await db.tx((t) => transition(t, o, "delivered", ["paid_held", "shipped"], { delivered_at: nowIso() }));
      if (!n) throw bad();
      await systemMessage(n, "delivered", { actor: user.id });
      await notify(o.buyer_id, "market_order_delivered", { actor: user.id, ref: o.id });
    } else if (action === "confirm") {
      party("buyer");
      n = await db.tx(async (t) => {
        const x = await transition(t, o, "completed", ["paid_held", "shipped", "delivered"], { completed_at: nowIso(), ...(o.delivered_at ? {} : { delivered_at: nowIso() }) });
        if (x && !(await settle(t, x, "release"))) throw new Error("escrow not held for " + o.id);
        return x;
      });
      if (!n) throw bad();
      await systemMessage(n, "completed", { actor: user.id });
      await notify(o.seller_id, "market_order_completed", { actor: user.id, ref: o.id });
      bus.emit("MARKET_ORDER_COMPLETED", { order: o.id, buyer: o.buyer_id, seller: o.seller_id, auto: false, actor: user.id });
    } else if (action === "cancel") {
      const reason = b?.reason !== undefined ? str(b.reason, 300) : null;
      if (o.status === "pending_payment") {
        n = await cancelPending(o, user.id, reason || (role === "buyer" ? "buyer_cancelled" : "seller_cancelled"));
        if (!n) throw bad();
        if (role === "buyer" && o.intent_id) await piSvc()?.cancel?.(user, { intentId: o.intent_id }).catch(() => null);
      } else if (o.status === "paid_held" && role === "seller") {
        n = await db.tx(async (t) => {
          const x = await transition(t, o, "refunded", ["paid_held"], { cancelled_at: nowIso(), refunded_at: nowIso(), cancel_reason: reason || "seller_cancelled", cancelled_by: user.id });
          if (x) { if (!(await settle(t, x, "refund"))) throw new Error("escrow not held for " + o.id); await restoreQty(t, o); }
          return x;
        });
        if (!n) throw bad();
        await recordPiRefund(user, n, "إلغاء طلب من السوق بواسطة البائع");
        await reindex(o.listing_id);
        await systemMessage(n, "refunded", { actor: user.id });
      } else throw bad();
    } else throw E.nf();
    bus.emit("MARKET_ORDER_" + n.status.toUpperCase(), { order: o.id, actor: user.id });
    return { order: await orderClient(n, user) };
  }

  /** auto-release + pending expiry (leased scheduler job) */
  async function releaseJob() {
    const at = clock().getTime();
    let released = 0, expired = 0;
    const due = await db.all("SELECT * FROM market_orders WHERE status='delivered' AND delivered_at < $1 ORDER BY delivered_at LIMIT 500", [new Date(at - cfg.autoReleaseMs).toISOString()]);
    for (const o of due) {
      const n = await db.tx(async (t) => {
        const x = await transition(t, o, "completed", ["delivered"], { completed_at: nowIso(), auto_released: 1 });
        if (x && !(await settle(t, x, "release"))) throw new Error("escrow not held for " + o.id);
        return x;
      }).catch((e) => { logger.error?.("market auto-release failed", { order: o.id, err: e.message }); return null; });
      if (!n) continue;
      released++;
      await systemMessage(n, "completed", { auto: true });
      await notify(n.seller_id, "market_order_completed", { ref: n.id });
      await notify(n.buyer_id, "market_order_completed", { ref: n.id });
      bus.emit("MARKET_ORDER_COMPLETED", { order: n.id, buyer: n.buyer_id, seller: n.seller_id, auto: true, actor: "system" });
    }
    const stale = await db.all("SELECT o.* FROM market_orders o LEFT JOIN pi_transactions p ON p.id=o.intent_id WHERE o.status='pending_payment' AND o.created_at < $1 AND (p.id IS NULL OR (p.payment_id IS NULL AND p.status='created') OR p.status IN ('cancelled','failed')) LIMIT 500",
      [new Date(at - cfg.pendingTtlMs).toISOString()]);
    for (const o of stale) if (await cancelPending(o, "system", "payment_expired")) expired++;
    return { released, expired };
  }

  /* ======================= reviews ======================= */
  function reviewClient(r, um) {
    const u = um?.get(r.buyer_id);
    return { id: r.id, orderId: r.order_id, listingId: r.listing_id, rating: Number(r.rating), text: r.text || "", reply: r.reply || null, repliedAt: iso(r.replied_at),
      buyer: u && u.status !== "deleted" ? userBrief(u) : null, createdAt: iso(r.created_at) };
  }
  const reviewBad = (m) => fail(400, "review_invalid", m);
  async function review(user, oid, b) {
    const o = await getOrder(oid);
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id)) throw E.nf("الطلب غير موجود");
    if (o.buyer_id !== user.id) throw E.forbid("التقييم للمشتري فقط");
    if (o.status !== "completed") throw fail(409, "invalid_state", "يمكن التقييم بعد اكتمال الطلب");
    const rating = b?.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw reviewBad("التقييم من ١ إلى ٥");
    if (b.text !== undefined && b.text !== null && typeof b.text !== "string") throw reviewBad("نص غير صالح");
    const text = (b.text || "").trim();
    if (text.length > 1000) throw reviewBad("التعليق حتى ١٠٠٠ حرف");
    if (text && Classifier.spam(text)) throw fail(422, "spam", "يبدو التعليق كرسالة مزعجة");
    const rid = id("mr"), at = nowIso();
    const ins = await db.run("INSERT INTO market_reviews(id,order_id,listing_id,buyer_id,seller_id,rating,text,hidden,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$8) ON CONFLICT DO NOTHING",
      [rid, o.id, o.listing_id, o.buyer_id, o.seller_id, rating, text || null, at]);
    if (!ins.changes) throw fail(409, "review_exists", "قيّمت هذا الطلب مسبقاً");
    const seller = await db.get("SELECT handle FROM users WHERE id=$1", [o.seller_id]);
    await notify(o.seller_id, "market_review", { actor: user.id, ref: seller?.handle || null });
    bus.emit("MARKET_REVIEW", { review: rid, order: o.id, seller: o.seller_id, rating, actor: user.id });
    return { review: reviewClient(await db.get("SELECT * FROM market_reviews WHERE id=$1", [rid]), await usersMap([o.buyer_id])) };
  }
  async function reply(user, rid, b) {
    const r = await db.get("SELECT * FROM market_reviews WHERE id=$1", [String(rid || "").slice(0, 100)]);
    if (!r) throw E.nf("التقييم غير موجود");
    if (r.seller_id !== user.id) throw E.forbid("الرد للبائع فقط");
    if (typeof b?.text !== "string" || !b.text.trim() || b.text.trim().length > 1000) throw reviewBad("الرد من ١ إلى ١٠٠٠ حرف");
    const text = b.text.trim();
    if (Classifier.spam(text)) throw fail(422, "spam", "يبدو الرد كرسالة مزعجة");
    await db.run("UPDATE market_reviews SET reply=$1, replied_at=$2, updated_at=$2 WHERE id=$3", [text, nowIso(), r.id]);
    return { review: reviewClient(await db.get("SELECT * FROM market_reviews WHERE id=$1", [r.id]), await usersMap([r.buyer_id])) };
  }
  async function sellerPage(viewer, handle, q) {
    const h = String(handle || "").replace(/^@/, "").slice(0, 60);
    const u = await db.get("SELECT id, handle, name, avatar, bio, status, created_at FROM users WHERE LOWER(handle)=LOWER($1)", [h]);
    if (!u || u.status !== "active") throw E.nf("البائع غير موجود");
    const rating = (await ratingsOf([u.id])).get(u.id) || { avg: 0, count: 0 }, sales = (await salesOf([u.id])).get(u.id) || 0;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const d of await db.all("SELECT rating, COUNT(*) AS n FROM market_reviews WHERE seller_id=$1 AND hidden=0 GROUP BY rating", [u.id])) dist[Number(d.rating)] = Number(d.n);
    const off = offsetOf(q.cursor), limit = 20;
    const rows = await db.all(`SELECT * FROM market_reviews WHERE seller_id=$1 AND hidden=0 ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${off}`, [u.id]);
    const um = await usersMap(rows.map((r) => r.buyer_id));
    const listings = off ? [] : await cards(await db.all("SELECT * FROM market_listings WHERE seller_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 24", [u.id]), viewer);
    return {
      seller: { ...userBrief(u), bio: u.bio || "", joinedAt: iso(u.created_at), rating, sales, distribution: dist },
      listings, reviews: { items: rows.slice(0, limit).map((r) => reviewClient(r, um)), next: rows.length > limit ? cursorOf(off + limit) : null }
    };
  }

  /* ======================= disputes ======================= */
  async function evidenceOf(user, v) {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 8) throw fail(400, "evidence_invalid", "حتى ٨ صور كدليل");
    const ids = v.map((x) => { const m = typeof x === "string" ? MEDIA_ID.exec(x) : x && typeof x.id === "string" ? MEDIA_ID.exec(x.id) : null; if (!m) throw fail(400, "evidence_invalid", "دليل غير صالح"); return m[1]; });
    const mm = await mediaMap(ids);
    for (const i of ids) { const m = mm.get(i); if (!m || m.owner !== user.id || m.kind !== "image") throw fail(400, "evidence_invalid", "استخدم صورك أنت المرفوعة فقط"); }
    return [...new Set(ids)];
  }
  async function evidenceClient(ids) { const mm = await mediaMap(ids); return ids.map((i) => imageClient({ id: i }, mm.get(i))).filter(Boolean); }
  async function disputeClient(d, viewer) {
    const o = await getOrder(d.order_id);
    const msgs = await db.all("SELECT * FROM market_dispute_messages WHERE dispute_id=$1 ORDER BY created_at, id", [d.id]);
    const um = await usersMap([d.opened_by, d.buyer_id, d.seller_id, d.resolver_id, ...msgs.map((m) => m.author_id)]);
    const messages = [];
    for (const m of msgs) messages.push({ id: m.id, author: userBrief(um.get(m.author_id)), role: m.role, text: m.text || "", evidence: await evidenceClient(parseList(m.evidence)), createdAt: iso(m.created_at) });
    return {
      id: d.id, orderId: d.order_id, order: o ? await orderClient(o, viewer, { brief: true }) : null, openedBy: userBrief(um.get(d.opened_by)),
      openerRole: d.opened_by === d.buyer_id ? "buyer" : "seller", reason: d.reason, text: d.text || "", evidence: await evidenceClient(parseList(d.evidence)), status: d.status,
      resolution: d.resolution || null, buyerAmount: d.buyer_amount == null ? null : pi(d.buyer_amount), resolver: isAdmin(viewer) ? userBrief(um.get(d.resolver_id)) : null,
      note: d.resolution_note || null, createdAt: iso(d.created_at), updatedAt: iso(d.updated_at), respondedAt: iso(d.responded_at), resolvedAt: iso(d.resolved_at), messages
    };
  }
  async function openDispute(user, oid, b) {
    const o = await getOrder(oid);
    if (!o || (o.buyer_id !== user.id && o.seller_id !== user.id)) throw E.nf("الطلب غير موجود");
    if (!DISPUTE_REASONS.includes(b?.reason)) throw fail(400, "dispute_invalid", "سبب النزاع غير معروف");
    if (b.text !== undefined && b.text !== null && typeof b.text !== "string") throw fail(400, "dispute_invalid", "نص غير صالح");
    const text = (b.text || "").trim();
    if (text.length > 2000) throw fail(400, "dispute_invalid", "الشرح حتى ٢٠٠٠ حرف");
    if (b.reason === "other" && text.length < 5) throw fail(400, "dispute_invalid", "اشرح المشكلة");
    const evidence = await evidenceOf(user, b.evidence);
    if (await db.get("SELECT 1 x FROM market_disputes WHERE order_id=$1 AND status<>'resolved'", [o.id])) throw fail(409, "dispute_exists", "يوجد نزاع مفتوح على هذا الطلب");
    const did = id("md"), at = nowIso();
    const n = await db.tx(async (t) => {
      const x = await transition(t, o, "disputed", ["paid_held", "shipped", "delivered"], { prev_status: o.status, disputed_at: at });
      if (!x) return null;
      await t.run("INSERT INTO market_disputes(id,order_id,opened_by,buyer_id,seller_id,reason,text,evidence,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'open',$9,$9)",
        [did, o.id, user.id, o.buyer_id, o.seller_id, b.reason, text || null, JSON.stringify(evidence), at]);
      return x;
    });
    if (!n) throw fail(409, "invalid_state", "لا يمكن فتح نزاع على الطلب في حالته الحالية");
    await systemMessage(n, "disputed", { actor: user.id, dispute: did });
    await notify(user.id === o.buyer_id ? o.seller_id : o.buyer_id, "market_dispute_opened", { actor: user.id, ref: o.id });
    ctx.audit?.("market_dispute_opened", did, b.reason, user.id);
    bus.emit("MARKET_DISPUTE_OPENED", { dispute: did, order: o.id, actor: user.id });
    return { dispute: await disputeClient(await db.get("SELECT * FROM market_disputes WHERE id=$1", [did]), user) };
  }
  async function disputeFor(user, did) {
    const d = await db.get("SELECT * FROM market_disputes WHERE id=$1", [String(did || "").slice(0, 100)]);
    if (!d || (d.buyer_id !== user.id && d.seller_id !== user.id && !isAdmin(user))) throw E.nf("النزاع غير موجود");
    return d;
  }
  async function disputeMessage(user, did, b) {
    const d = await disputeFor(user, did);
    if (d.status === "resolved") throw fail(409, "dispute_resolved", "حُسم هذا النزاع");
    if (!rl.hit("message", "market:" + user.id)) throw E.rate();
    if (b?.text !== undefined && b.text !== null && typeof b.text !== "string") throw fail(400, "dispute_invalid", "نص غير صالح");
    const text = (b?.text || "").trim(), evidence = await evidenceOf(user, b?.evidence);
    if (!text && !evidence.length) throw fail(400, "dispute_invalid", "اكتب رسالة أو أرفق دليلاً");
    if (text.length > 2000) throw fail(400, "dispute_invalid", "الرسالة حتى ٢٠٠٠ حرف");
    const role = user.id === d.buyer_id ? "buyer" : user.id === d.seller_id ? "seller" : "staff", at = nowIso();
    await db.run("INSERT INTO market_dispute_messages(id,dispute_id,author_id,role,text,evidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("mdm"), d.id, user.id, role, text, JSON.stringify(evidence), at]);
    const responder = d.opened_by === d.buyer_id ? d.seller_id : d.buyer_id;
    if (user.id === responder && d.status === "open") await db.run("UPDATE market_disputes SET status='seller_responded', responded_at=$1, updated_at=$1 WHERE id=$2 AND status='open'", [at, d.id]);
    else await db.run("UPDATE market_disputes SET updated_at=$1 WHERE id=$2", [at, d.id]);
    return { dispute: await disputeClient(await db.get("SELECT * FROM market_disputes WHERE id=$1", [d.id]), user) };
  }
  async function adminDisputes(q) {
    const st = q.status === "all" ? null : ["open", "seller_responded", "resolved"].includes(q.status) ? [q.status] : ["open", "seller_responded"];
    const rows = await db.all(`SELECT * FROM market_disputes ${st ? `WHERE status IN (${inList(st)})` : ""} ORDER BY created_at ${st && !st.includes("resolved") ? "ASC" : "DESC"} LIMIT 200`, st || []);
    const um = await usersMap(rows.flatMap((d) => [d.buyer_id, d.seller_id, d.opened_by]));
    const orders = new Map(rows.length ? (await db.all(`SELECT * FROM market_orders WHERE id IN (${inList(rows.map((d) => d.order_id))})`, rows.map((d) => d.order_id))).map((o) => [o.id, o]) : []);
    return { status: q.status === "all" ? "all" : st.length === 1 ? st[0] : "unresolved", items: await Promise.all(rows.map(async (d) => {
      const o = orders.get(d.order_id);
      return { id: d.id, orderId: d.order_id, title: o?.title || null, total: o ? pi(o.total) : null, reason: d.reason, text: d.text || "", status: d.status, resolution: d.resolution || null,
        buyer: userBrief(um.get(d.buyer_id)), seller: userBrief(um.get(d.seller_id)), openedBy: userBrief(um.get(d.opened_by)), createdAt: iso(d.created_at), updatedAt: iso(d.updated_at), resolvedAt: iso(d.resolved_at),
        evidence: await evidenceClient(parseList(d.evidence)) };
    })) };
  }
  async function resolve(by, did, b) {
    const d = await db.get("SELECT * FROM market_disputes WHERE id=$1", [String(did || "").slice(0, 100)]);
    if (!d) throw E.nf("النزاع غير موجود");
    if (d.status === "resolved") throw fail(409, "dispute_resolved", "حُسم هذا النزاع مسبقاً");
    const resolution = b?.resolution;
    if (!RESOLUTIONS.includes(resolution)) throw fail(400, "resolution_invalid", "القرار: refund_buyer أو release_seller أو split");
    const o = await getOrder(d.order_id), total = Number(o.total);
    let buyerUnits = 0;
    if (resolution === "split") {
      const x = Number(b.buyerAmount);
      buyerUnits = Number.isFinite(x) ? toUnits(x) : NaN;
      if (!Number.isFinite(buyerUnits) || buyerUnits <= 0 || buyerUnits >= total) throw fail(400, "split_invalid", `مبلغ المشتري بين 0 و${pi(total)} Pi (غير شامل)`);
    }
    const note = b?.note !== undefined ? str(b.note, 500) : null, at = nowIso();
    const to = resolution === "refund_buyer" ? "refunded" : "completed";
    const n = await db.tx(async (t) => {
      const r = await t.run("UPDATE market_disputes SET status='resolved', resolution=$1, buyer_amount=$2, resolver_id=$3, resolution_note=$4, resolved_at=$5, updated_at=$5 WHERE id=$6 AND status<>'resolved'",
        [resolution, resolution === "refund_buyer" ? total : resolution === "release_seller" ? 0 : buyerUnits, by.id, note, at, d.id]);
      if (!r.changes) return null;
      const x = await transition(t, o, to, ["disputed"], to === "refunded" ? { refunded_at: at } : { completed_at: at });
      if (!x) throw fail(409, "invalid_state", "تغيّرت حالة الطلب، حدّث الصفحة");
      const mode = { refund_buyer: "refund", release_seller: "release", split: "split" }[resolution];
      if (!(await settle(t, x, mode, buyerUnits))) throw fail(409, "invalid_state", "لا يوجد مبلغ محفوظ لهذا الطلب");
      if (mode === "refund") await restoreQty(t, x);
      return x;
    });
    if (!n) throw fail(409, "dispute_resolved", "حُسم هذا النزاع مسبقاً");
    if (resolution === "refund_buyer") { await recordPiRefund(by, n, "استرداد بقرار نزاع في السوق" + (note ? ": " + note : "")); await reindex(n.listing_id); }
    ctx.audit?.("market_dispute_resolved", d.id, resolution + (note ? ": " + note : ""), by.id);
    await systemMessage(n, "dispute_resolved", { actor: by.id, resolution, ...(resolution === "split" ? { buyerAmount: pi(buyerUnits) } : {}) });
    for (const uid of [n.buyer_id, n.seller_id]) await notify(uid, "market_dispute_resolved", { ref: n.id });
    bus.emit("MARKET_DISPUTE_RESOLVED", { dispute: d.id, order: n.id, resolution, actor: by.id });
    return { dispute: await disputeClient(await db.get("SELECT * FROM market_disputes WHERE id=$1", [d.id]), by) };
  }

  /* ======================= search routes (type=listing) ======================= */
  function hook(method, path, after) {
    const m = R.match(method, path); if (!m) return false;
    const route = R.routes.find((r) => r.method === method && r.re === m.re && r.handler === m.handler); if (!route || route.handler.__mpMarket) return false;
    const orig = route.handler;
    const wrapped = async (req, res) => after(req, res, orig);
    wrapped.__mpMarket = true;
    for (const k of ["__mpPaid", "__mpMinors"]) if (orig[k]) wrapped[k] = orig[k];
    route.handler = wrapped; return true;
  }
  async function listingHits(viewer, q, limit) {
    const ids = (await searchIds(q)).slice(0, 200);
    if (!ids.length) return [];
    const rows = await db.all(`SELECT l.* FROM market_listings l JOIN users u ON u.id=l.seller_id AND u.status='active' WHERE l.status='active' AND l.id IN (${inList(ids)})`, ids);
    const blocked = new Set(viewer?.prefs?.blocked || []), by = new Map(rows.filter((r) => !blocked.has(r.seller_id)).map((r) => [r.id, r]));
    return cards(ids.map((i) => by.get(i)).filter(Boolean).slice(0, limit), viewer);
  }
  hook("GET", "/api/search", async (req, res, orig) => {
    const q = req.query?.q ? String(req.query.q).slice(0, 120) : "";
    if (req.query?.type === "listing") {
      const qq = str(q, 120, { required: true });
      const items = await listingHits(req.user, qq, 48);
      return { q: qq, type: "listing", users: [], posts: [], communities: [], topics: [], hashtags: [], events: [], listings: items, total: items.length };
    }
    const out = await orig(req, res);
    if (out && typeof out === "object" && q) out.listings = await listingHits(req.user, q, 6).catch(() => []);
    return out;
  });
  hook("GET", "/api/search/full", async (req, res, orig) => {
    if (req.query?.type !== "listing") return orig(req, res);
    const q = str(req.query.q, 120, { required: true });
    const items = await listingHits(req.user, q, 48);
    return { q, type: "listing", filters: { type: "listing" }, engine: ctx.services.search?.engine || "builtin", groups: { listings: { total: items.length, items } }, total: items.length };
  });

  /* ======================= bus ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("market handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settleAll = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "market") return;
    const o = await db.get("SELECT * FROM market_orders WHERE intent_id=$1", [e.tx]); if (!o) return;
    if (e.amount !== undefined && Math.abs(toUnits(e.amount) - Number(o.total)) > 1) { logger.warn?.("market amount mismatch; order not paid", { order: o.id }); return; }
    await onPaid(o, e);
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => {
    if (e.purpose !== "market") return;
    const o = await db.get("SELECT * FROM market_orders WHERE intent_id=$1", [e.tx]);
    if (o && o.status === "pending_payment") await cancelPending(o, "system", "payment_cancelled");
  }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => { // staff refunded the Pi payment directly: unwind a still-held escrow
    if (e.purpose !== "market") return;
    const o = await db.get("SELECT * FROM market_orders WHERE intent_id=$1", [e.tx]);
    if (!o || !["paid_held", "shipped", "delivered", "disputed"].includes(o.status)) return;
    const n = await db.tx(async (t) => {
      const x = await transition(t, o, "refunded", ["paid_held", "shipped", "delivered", "disputed"], { refunded_at: nowIso() });
      if (x && !(await settle(t, x, "refund"))) throw new Error("escrow not held for " + o.id);
      if (x) await t.run("UPDATE market_disputes SET status='resolved', resolution='refund_buyer', buyer_amount=$1, resolved_at=$2, updated_at=$2 WHERE order_id=$3 AND status<>'resolved'", [Number(o.total), nowIso(), o.id]);
      return x;
    });
    if (n) await systemMessage(n, "refunded", {});
  }));
  bus.on("USER_ANONYMISED", track(async (e) => {
    if (!e?.user) return;
    const ls = await db.all("SELECT id FROM market_listings WHERE seller_id=$1", [e.user]);
    await db.run("UPDATE market_listings SET status='removed', title='إعلان محذوف', description='', images='[]', location=NULL, removed_at=COALESCE(removed_at,$2), updated_at=$2 WHERE seller_id=$1", [e.user, nowIso()]);
    for (const l of ls) await reindex(l.id);
    await db.run("UPDATE market_reviews SET text=NULL WHERE buyer_id=$1", [e.user]);
    await db.run("UPDATE market_reviews SET reply=NULL WHERE seller_id=$1", [e.user]);
    await db.run("UPDATE market_disputes SET text=NULL, evidence='[]' WHERE opened_by=$1", [e.user]);
    await db.run("UPDATE market_dispute_messages SET text='', evidence='[]' WHERE author_id=$1", [e.user]);
  }));

  /* ======================= jobs ======================= */
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.MARKET_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("market.release", +(env.MARKET_RELEASE_INTERVAL_MS || 15 * 60e3), releaseJob);

  /* ======================= routes ======================= */
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  R.get("/api/market/config", async () => ({ enabled: true, piEnabled: piOn(), currency: "PI", categories: CATEGORIES, kinds: KINDS, conditions: CONDITIONS, delivery: DELIVERY,
    minPrice: pi(cfg.minPrice), maxPrice: pi(cfg.maxPrice), feePct: cfg.feePct, autoReleaseDays: cfg.autoReleaseMs / DAY, maxImages: 8, maxQty: cfg.maxQty, ...(piOn() ? {} : { piNote: OFF }) }));
  R.get("/api/market/listings", async (req) => browse(req.user || null, req.query || {}));
  R.post("/api/market/listings", A(async (req) => createListing(req.user, req.body)));
  R.get("/api/market/listings/:id", async (req) => readListing(req.user || null, req.params.id));
  R.patch("/api/market/listings/:id", A(async (req) => updateListing(req.user, req.params.id, req.body)));
  R.del("/api/market/listings/:id", A(async (req) => removeListing(req.user, req.params.id)));
  R.post("/api/market/listings/:id/order", A(async (req) => placeOrder(req.user, req.params.id, req.body)));
  R.get("/api/me/market/listings", A(async (req) => myListings(req.user, req.query || {})));
  R.get("/api/me/market/orders", A(async (req) => myOrders(req.user, req.query || {})));
  R.get("/api/market/orders/:id", A(async (req) => readOrder(req.user, req.params.id)));
  for (const action of ["ship", "deliver", "confirm", "cancel"]) R.post(`/api/market/orders/:id/${action}`, A(async (req) => act(req.user, req.params.id, action, req.body)));
  R.post("/api/market/orders/:id/review", A(async (req) => review(req.user, req.params.id, req.body)));
  R.post("/api/market/reviews/:id/reply", A(async (req) => reply(req.user, req.params.id, req.body)));
  R.get("/api/market/sellers/:handle", async (req) => sellerPage(req.user || null, req.params.handle, req.query || {}));
  R.post("/api/market/orders/:id/dispute", A(async (req) => openDispute(req.user, req.params.id, req.body)));
  R.get("/api/market/disputes/:id", A(async (req) => ({ dispute: await disputeClient(await disputeFor(req.user, req.params.id), req.user) })));
  R.post("/api/market/disputes/:id/messages", A(async (req) => disputeMessage(req.user, req.params.id, req.body)));
  R.get("/api/admin/market/disputes", admin(async (req) => adminDisputes(req.query || {})));
  R.post("/api/admin/market/disputes/:id/resolve", admin(async (req) => resolve(req.user, req.params.id, req.body)));

  // phase 58: the digital store reuses listings, orders and escrow instead of duplicating them
  const internal = { createListing, updateListing, getListing, getOrder, transition, settle, restoreQty, recordPiRefund, systemMessage, listingFull, cards, isMinor, blockedBetween, notify, hooks };
  return { config: cfg, releaseJob, reindex, settle: settleAll, CATEGORIES, internal };
};
