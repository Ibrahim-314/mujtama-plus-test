/* Subscriptions & paid content (phase 38). Built on the Pi service (payments) and the Phase 37 tips service
 * (creator opt-in, support tiers, supporter state, double-entry ledger in lib/ledger.js).
 * 1. Paid posts: `paid:{mode:"supporters"|"ppv", minTierId?, price?, teaser?}` on POST /api/posts (or `visibility:"supporters"`).
 *    The locked body never lives in `posts`: posts.text holds only the public teaser, the body goes to paid_content and
 *    the post's media ids to paid_media. Every code path that reads `posts` directly (search index, OG pages, digests,
 *    summaries, trends, knowledge…) therefore only ever sees the teaser — protection by construction.
 * 2. Entitlement is resolved per viewer in content.filterVisible (annotate → WeakMap keyed by the row object, never
 *    serialised) and applied in content.toClient (render). No annotation for that viewer = locked (fail closed).
 *    Entitled: the author, admins (moderation), a completed PPV purchase, or (supporters mode) an active/due supporter
 *    of the creator at the minimum tier amount or higher (a cancelled support keeps its perks until active_until).
 * 3. Media of paid posts: /media/<id>… → mediaGate (403 paid_locked for non-entitled, private/no-store for entitled);
 *    GET /api/media/:id → assertMedia.
 * 4. PPV purchase: POST /api/paid/:postId/intent → ctx.services.pi.createIntent (purpose `ppv`, refId post id). Effects only
 *    on PI_PAYMENT_COMPLETED / CANCELLED / REFUNDED, conditional status update + journal (source `ppv`) in one transaction.
 * 5. Refunds: buyer may request one within PAID_REFUND_WINDOW_HOURS (24) of the creator editing / deleting / archiving the
 *    post or of a moderation removal that happened after the purchase; staff approve (pi.refund → reversing journal,
 *    access revoked) or reject. A duplicate purchase of the same post gets an automatic request.
 * Minors (minors service band < 18) can neither sell nor buy paid content; adult-labelled posts stay hidden from them
 * by the minors service (paid or not). Pi payments off → intents answer 501, reads keep working. */
const { E, HttpError, str, id, acceptId, Classifier } = require("../lib/core");
const { toUnits, pi, createLedger } = require("../lib/ledger");
const RT = require("../../richtext.js");

const HOUR = 3600e3;
const PAID_MARK = Symbol.for("mujtama.paid"); // read by content.createPost; a symbol can never arrive from JSON
const MODES = ["supporters", "ppv"];
const TYPES = ["post", "article", "video", "audio"];
const STRIP = ["doc", "media", "images", "imageDims", "video", "audio", "cover", "poll", "stances", "translations", "alts"];
const MEDIA_ID = /^\/?(?:media\/)?([a-z]{1,4}_[a-z0-9]{4,40})/i;
const LOCKED_MSG = "هذا المحتوى مدفوع";

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const fail = (status, code, msg) => new HttpError(status, msg, code);

  const cfg = {
    minPrice: toUnits(0.01),
    maxPrice: toUnits(num("PAID_MAX_PRICE", 100)),
    feeBps: Math.min(10000, Math.floor(num("CREATOR_FEE_BPS", 0))),
    refundWindowMs: num("PAID_REFUND_WINDOW_HOURS", 24) * HOUR,
    teaserChars: Math.max(40, Math.min(1000, Math.floor(num("PAID_TEASER_CHARS", 200)))),
    teaserMax: 500
  };
  const feeOf = (units) => Math.floor((units * cfg.feeBps) / 10000);
  const { postJournal, creditLines, reverseAll } = createLedger({ now: nowIso });
  const inList = (arr, start = 1) => arr.map((_, i) => "$" + (i + start)).join(",");
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());

  /* ======================= helpers ======================= */
  async function isMinor(uid) {
    const m = ctx.services.minors; // registered last; optional
    if (!uid || !m?.isMinorUser) return false;
    try { return !!(await m.isMinorUser(uid)); } catch { return false; }
  }
  const creatorEnabled = async (uid) => !!(await db.get("SELECT enabled FROM creator_settings WHERE user_id=$1", [uid]))?.enabled;
  const piOn = () => !!ctx.services.pi?.enabled?.();
  async function blockedBetween(a, b) {
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    if ((ua?.prefs?.blocked || []).includes(b) || (ub?.prefs?.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  /** entitled support: active/due, or cancelled but still inside the paid period (perks stay until active_until) */
  function supportActive(sub) {
    if (!sub || !sub.started_at || !sub.active_until) return false;
    const st = ctx.services.tips?.stateOf ? ctx.services.tips.stateOf(sub) : null;
    if (st === "active" || st === "due") return true;
    return sub.state === "cancelled" && clock().getTime() < Date.parse(iso(sub.active_until));
  }
  /** first ~200 characters, never more than 40 % of the body (a short body gets no automatic teaser) */
  function autoTeaser(text) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length < 40) return "";
    const n = Math.min(cfg.teaserChars, Math.floor(t.length * 0.4));
    let cut = t.lastIndexOf(" ", n); if (cut < n / 2) cut = n;
    return t.slice(0, cut).trim() + "…";
  }
  const mediaIdOf = (v) => (typeof v === "string" && v.startsWith("/media/") ? (MEDIA_ID.exec(v.slice(7)) || [])[1] || null : null);
  function mediaIdsOf(b) {
    const out = new Set();
    for (const v of [b.media, b.cover, ...(Array.isArray(b.images) ? b.images : [])]) { const m = mediaIdOf(v); if (m) out.add(m); }
    for (const v of [b.video?.mediaId, b.audio?.mediaId]) if (typeof v === "string" && /^[a-z]{1,4}_[a-z0-9]{4,40}$/i.test(v)) out.add(v);
    return [...out];
  }
  /** paid settings → validated { mode, price(units), minTierId, minAmount(units), teaser|null } */
  async function validatePaid(user, p, cur = null) {
    if (!p || typeof p !== "object" || Array.isArray(p)) throw fail(400, "paid_invalid", "إعدادات المحتوى المدفوع غير صالحة");
    const mode = p.mode === undefined && cur ? cur.mode : p.mode;
    if (!MODES.includes(mode)) throw fail(400, "paid_invalid", "نوع المحتوى المدفوع غير معروف");
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "المحتوى المدفوع غير متاح لمن هم دون ١٨ سنة");
    if (!(await creatorEnabled(user.id))) throw fail(409, "creator_disabled", "فعّل وضع صانع المحتوى أولاً لنشر محتوى مدفوع");
    let price = 0, minTierId = null, minAmount = 0;
    if (mode === "ppv") {
      const raw = p.price === undefined && cur ? pi(cur.price) : Number(p.price);
      price = Number.isFinite(raw) ? toUnits(raw) : NaN;
      if (!Number.isFinite(price) || price < cfg.minPrice || price > cfg.maxPrice) throw fail(400, "price_invalid", `السعر بين ${pi(cfg.minPrice)} و${pi(cfg.maxPrice)} Pi`);
    } else {
      const tiers = await db.all("SELECT * FROM creator_tiers WHERE creator_id=$1 AND active=1 ORDER BY amount", [user.id]);
      if (!tiers.length) throw fail(409, "no_tiers", "أضف مستوى دعم واحداً على الأقل قبل نشر محتوى للداعمين");
      const want = p.minTierId === undefined && cur ? cur.min_tier_id : p.minTierId;
      if (want !== undefined && want !== null && want !== "") {
        const t = tiers.find((x) => x.id === String(want));
        if (!t) throw fail(400, "tier_invalid", "المستوى غير موجود");
        minTierId = t.id; minAmount = Number(t.amount);
      }
    }
    let teaser = null;
    if (p.teaser !== undefined && p.teaser !== null) teaser = str(String(p.teaser), cfg.teaserMax) || "";
    return { mode, price, minTierId, minAmount, teaser };
  }
  const marker = (v) => ({ mode: v.mode, price: v.mode === "ppv" ? pi(v.price) : null, minTierId: v.minTierId || null });

  /* ======================= entitlement (annotate) + render ======================= */
  /** row object → Map(viewerKey → { ok, full?, lock? }). WeakMap: never serialised, gone with the row. */
  const META = new WeakMap();
  const vkey = (viewer) => viewer || "";
  async function annotate(rows, viewer) {
    const paid = (rows || []).filter((r) => r && r.data && r.data.paid);
    if (!paid.length) return;
    const ids = [...new Set(paid.map((r) => r.id))];
    const pps = new Map((await db.all(`SELECT * FROM paid_posts WHERE post_id IN (${inList(ids)})`, ids)).map((x) => [x.post_id, x]));
    let isAdmin = false, minor = false, bought = new Set(), subs = new Map();
    if (viewer) {
      isAdmin = (await db.get("SELECT role FROM users WHERE id=$1", [viewer]))?.role === "admin";
      minor = await isMinor(viewer);
      bought = new Set((await db.all(`SELECT post_id FROM paid_purchases WHERE buyer_id=$1 AND status IN ('completed','duplicate') AND post_id IN (${inList(ids, 2)})`, [viewer, ...ids])).map((x) => x.post_id)); // a purchase unlocks forever, whatever the mode later becomes
      const authors = [...new Set(paid.filter((r) => pps.get(r.id)?.mode === "supporters" && r.author !== viewer).map((r) => r.author))];
      if (authors.length) subs = new Map((await db.all(`SELECT * FROM support_subscriptions WHERE supporter_id=$1 AND creator_id IN (${inList(authors, 2)})`, [viewer, ...authors])).map((s) => [s.creator_id, s]));
    }
    // minimum tier amounts follow the tier's current amount when it still exists (snapshot otherwise)
    const tierIds = [...new Set([...pps.values()].map((x) => x.min_tier_id).filter(Boolean))];
    const tierById = new Map(tierIds.length ? (await db.all(`SELECT * FROM creator_tiers WHERE id IN (${inList(tierIds)})`, tierIds)).map((t) => [t.id, t]) : []);
    const minAmountOf = (pp) => (pp.min_tier_id && tierById.get(pp.min_tier_id) ? Number(tierById.get(pp.min_tier_id).amount) : Number(pp.min_amount || 0));
    const okFor = (r) => {
      if (!viewer) return false;
      if (r.author === viewer || isAdmin) return true;
      const pp = pps.get(r.id); if (!pp || minor) return false;
      if (bought.has(r.id)) return true;
      if (pp.mode === "supporters") { const s = subs.get(r.author); return supportActive(s) && Number(s.amount) >= minAmountOf(pp); }
      return false;
    };
    const okRows = paid.filter(okFor), lockedRows = paid.filter((r) => !okRows.includes(r));
    const okIds = [...new Set(okRows.map((r) => r.id))];
    const full = new Map(okIds.length ? (await db.all(`SELECT * FROM paid_content WHERE post_id IN (${inList(okIds)})`, okIds)).map((c) => [c.post_id, c]) : []);
    const creators = [...new Set(lockedRows.filter((r) => pps.get(r.id)?.mode === "supporters").map((r) => r.author))];
    const tiersBy = new Map();
    if (creators.length) for (const t of await db.all(`SELECT * FROM creator_tiers WHERE active=1 AND creator_id IN (${inList(creators)}) ORDER BY amount, position`, creators)) { if (!tiersBy.has(t.creator_id)) tiersBy.set(t.creator_id, []); tiersBy.get(t.creator_id).push(t); }
    const k = vkey(viewer);
    for (const r of paid) {
      let m = META.get(r); if (!m) { m = new Map(); META.set(r, m); }
      if (okRows.includes(r)) { const c = full.get(r.id); m.set(k, { ok: true, full: c ? { text: c.text || "", doc: c.data?.doc || null } : null }); continue; }
      const pp = pps.get(r.id), d = r.data || {};
      const lock = { mode: pp?.mode || d.paid.mode, price: (pp ? pp.mode : d.paid.mode) === "ppv" ? (pp ? pi(pp.price) : d.paid.price ?? null) : null, minTier: null, tiers: [], purchasable: false, reason: null,
        media: { images: Array.isArray(d.images) ? d.images.length : 0, media: !!d.media, cover: !!d.cover, video: !!d.video, audio: !!d.audio } };
      if (lock.mode === "supporters" && pp) {
        const min = minAmountOf(pp), mt = pp.min_tier_id ? tierById.get(pp.min_tier_id) : null;
        if (mt) lock.minTier = { id: mt.id, name: mt.name, amount: pi(mt.amount) };
        lock.tiers = (tiersBy.get(r.author) || []).filter((t) => Number(t.amount) >= min).map((t) => ({ id: t.id, name: t.name, amount: pi(t.amount), perks: t.perks || "" }));
        lock.purchasable = !minor && lock.tiers.length > 0;
      } else if (lock.mode === "ppv") lock.purchasable = !minor && piOn();
      lock.reason = minor ? "minor_restricted" : lock.mode === "ppv" && !piOn() ? "not_configured" : !viewer ? "sign_in" : null;
      m.set(k, { ok: false, lock });
    }
  }
  /** called by content.toClient for every post (sync): locked unless annotated as entitled for this viewer */
  function render(o, r, viewer) {
    const d = r.data || {};
    if (!d.paid) return o;
    const e = META.get(r)?.get(vkey(viewer));
    o.paid = { mode: d.paid.mode, price: d.paid.price ?? null, minTierId: d.paid.minTierId ?? null };
    o.teaser = r.text || "";
    if (e?.ok) {
      o.locked = false;
      if (e.full) { o.text = e.full.text; if (e.full.doc) o.doc = e.full.doc; }
      return o;
    }
    for (const k of STRIP) o[k] = k === "media" || k === "poll" ? null : undefined;
    o.text = r.text || "";
    o.locked = true;
    o.lock = e?.lock || { mode: d.paid.mode, price: d.paid.price ?? null, minTier: null, tiers: [], purchasable: false, reason: null, media: { images: Array.isArray(d.images) ? d.images.length : 0, media: !!d.media, cover: !!d.cover, video: !!d.video, audio: !!d.audio } };
    return o;
  }
  /** entitlement for one post row and one user, including the normal visibility rules */
  async function entitled(user, row) {
    if (!row) return false;
    const c = ctx.services.content;
    const vis = await c.filterVisible([row], user?.id || null); // annotates
    if (!vis.length) return false;
    return !!META.get(row)?.get(vkey(user?.id || null))?.ok;
  }
  async function protectedPostOf(mediaId) {
    const pm = await db.get("SELECT post_id FROM paid_media WHERE media_id=$1", [mediaId]);
    return pm ? (await db.get("SELECT * FROM posts WHERE id=$1", [pm.post_id])) || { id: pm.post_id, missing: true } : null;
  }
  /** /media/<name>: "public" (not paid media) | "private" (entitled; no shared cache) | "deny" */
  async function mediaGate(req, name) {
    const m = MEDIA_ID.exec(String(name || "")); if (!m) return "public";
    const row = await protectedPostOf(m[1]); if (!row) return "public";
    if (row.missing) return "deny";
    const user = req.user || (await ctx.services.users.resolve(req).catch(() => null));
    if (user && (user.id === row.author || user.role === "admin")) return "private";
    return (await entitled(user, row)) ? "private" : "deny";
  }
  async function assertMedia(user, mediaId) {
    const row = await protectedPostOf(mediaId); if (!row) return;
    if (!row.missing && user && (user.id === row.author || user.role === "admin")) return;
    if (row.missing || !(await entitled(user, row))) throw fail(403, "paid_locked", LOCKED_MSG);
  }

  /* ======================= create / edit (route hooks) ======================= */
  /** wraps an existing route (registered by content.js) — same technique as services/minors.js */
  function hook(method, path, { before = null, after = null, onError = null }) {
    const m = R.match(method, path); if (!m) return false;
    const route = R.routes.find((r) => r.method === method && r.re === m.re && r.handler === m.handler); if (!route || route.handler.__mpPaid) return false;
    const orig = route.handler;
    const wrapped = async (req, res) => {
      if (before) await before(req, res);
      let out;
      try { out = await orig(req, res); } catch (e) { if (onError) await onError(req).catch(() => { }); throw e; }
      return after ? ((await after(out, req, res)) ?? out) : out;
    };
    wrapped.__mpPaid = true; if (orig.__mpMinors) wrapped.__mpMinors = orig.__mpMinors;
    route.handler = wrapped; return true;
  }
  /** re-renders a post for its author with the full body (create / edit responses) */
  async function renderFor(user, pid) {
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!row) return null;
    await annotate([row], user.id);
    return ctx.services.content.toClient(row, user.id);
  }

  async function beforeCreate(req) {
    const b = req.body; if (!req.user || !b || typeof b !== "object") return;
    let p = b.paid;
    if (b.visibility === "supporters") { p = { ...(p && typeof p === "object" ? p : {}), mode: "supporters" }; b.visibility = "public"; }
    if (p === undefined || p === null || p === false) { delete b.paid; return; }
    const user = req.user, v = await validatePaid(user, p);
    const type = TYPES.includes(b.type) ? b.type : b.type === undefined ? "post" : null;
    if (!type) throw fail(400, "paid_type", "المحتوى المدفوع متاح للمنشورات والمقالات والفيديو والصوت فقط");
    if (b.community) throw fail(400, "paid_community", "المحتوى المدفوع غير متاح داخل المجتمعات بعد");
    if (b.repostOf || b.poll) throw fail(400, "paid_type", "لا يمكن جعل إعادة النشر أو الاستطلاع محتوى مدفوعاً");
    let doc = null;
    if (b.doc) doc = RT.validate(b.doc); else if (typeof b.markdown === "string" && b.markdown.trim()) doc = RT.parse(b.markdown);
    if (doc && !doc.blocks.length) doc = null;
    const max = type === "article" ? 60000 : 5000;
    const text = str(b.text, max) || (doc ? RT.toText(doc).slice(0, max) : "");
    if (doc && type !== "article" && !RT.isRich(doc)) doc = null;
    const title = str(b.title, 200);
    if (Classifier.spam(`${title || ""} ${text}`)) throw new HttpError(422, "يبدو المحتوى كرسالة مزعجة ولم يُنشر", "spam");
    if (text && await db.get("SELECT 1 x FROM paid_content c JOIN posts p ON p.id=c.post_id WHERE p.author=$1 AND c.text=$2 AND p.created_at > $3 AND p.status <> 'deleted'", [user.id, text, new Date(Date.now() - 864e5).toISOString()]))
      throw E.conflict("نشرت نفس المحتوى مؤخراً"); // content.js's duplicate check would only see the teaser
    const media = mediaIdsOf(b);
    if (media.length) {
      const own = new Set((await db.all(`SELECT id FROM media WHERE owner=$1 AND id IN (${inList(media, 2)})`, [user.id, ...media])).map((x) => x.id));
      if (media.some((m) => !own.has(m))) throw fail(400, "paid_media_owner", "يمكن بيع وسائطك أنت فقط");
      if (await db.get(`SELECT 1 x FROM paid_media WHERE media_id IN (${inList(media)}) LIMIT 1`, media)) throw fail(409, "paid_media_used", "هذه الوسائط مستخدمة في منشور مدفوع آخر");
    }
    const teaser = v.teaser !== null ? v.teaser : autoTeaser(text);
    const pid = acceptId(b.id, "p");
    if (await db.get("SELECT 1 x FROM posts WHERE id=$1", [pid])) throw E.conflict("المعرّف مستخدم");
    const at = nowIso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO paid_posts(post_id,creator_id,mode,price,min_tier_id,min_amount,teaser_custom,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)",
        [pid, user.id, v.mode, v.price, v.minTierId, v.minAmount, v.teaser !== null ? 1 : 0, at]);
      await t.run("INSERT INTO paid_content(post_id,text,data,updated_at) VALUES($1,$2,$3,$4)", [pid, text, { doc }, at]);
      for (const m of media) await t.run("INSERT INTO paid_media(media_id,post_id,creator_id,created_at) VALUES($1,$2,$3,$4)", [m, pid, user.id, at]);
    });
    const hasMedia = !!(b.media || (Array.isArray(b.images) && b.images.length) || ["video", "audio"].includes(type));
    b.id = pid; b.type = type;
    b.text = teaser || (title || hasMedia ? "" : "🔒");
    delete b.doc; delete b.markdown; delete b.paid;
    b[PAID_MARK] = marker(v);
    req._paid = { pid, sensitive: Classifier.sensitive(`${title || ""} ${text}`) };
  }
  async function afterCreate(out, req) {
    if (!req._paid || !out?.post) return out;
    await db.run("UPDATE paid_posts SET state='active', updated_at=$1 WHERE post_id=$2 AND state='pending'", [nowIso(), req._paid.pid]);
    if (req._paid.sensitive) await db.run("UPDATE posts SET sensitive=1 WHERE id=$1", [req._paid.pid]);
    ctx.audit?.("paid_post_created", req._paid.pid, null, req.user.id);
    out.post = await renderFor(req.user, req._paid.pid);
    return out;
  }
  async function createFailed(req) {
    if (!req._paid) return;
    const pid = req._paid.pid;
    if (await db.get("SELECT 1 x FROM posts WHERE id=$1", [pid])) { await db.run("UPDATE paid_posts SET state='active' WHERE post_id=$1 AND state='pending'", [pid]); return; }
    await db.tx(async (t) => {
      await t.run("DELETE FROM paid_media WHERE post_id=$1", [pid]);
      await t.run("DELETE FROM paid_content WHERE post_id=$1", [pid]);
      await t.run("DELETE FROM paid_posts WHERE post_id=$1 AND state='pending'", [pid]);
    });
  }

  async function markChanged(pid, kind) {
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1", [pid]); if (!pp) return false;
    const at = nowIso();
    await db.run("UPDATE paid_posts SET changed_at=$1, change_kind=$2, updated_at=$1 WHERE post_id=$3", [at, kind, pid]);
    // tell the buyers who can now ask for a refund (bounded)
    const buyers = await db.all("SELECT id, buyer_id FROM paid_purchases WHERE post_id=$1 AND status='completed' AND completed_at < $2 LIMIT 1000", [pid, at]);
    for (const b of buyers) await ctx.services.notify?.notify?.(b.buyer_id, "paid_refundable", { ref: b.id }).catch(() => { });
    return true;
  }

  async function beforeEdit(req) {
    const b = req.body; if (!req.user || !b || typeof b !== "object") return;
    const pid = req.params.id;
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!row) return;
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1 AND state='active'", [pid]);
    const wantsPaid = (b.paid !== undefined && b.paid !== null && b.paid !== false) || b.visibility === "supporters";
    if (!pp) { if (wantsPaid) throw fail(400, "paid_on_create_only", "يُحدَّد المحتوى المدفوع عند النشر فقط"); delete b.paid; return; }
    if (row.author !== req.user.id) { delete b.paid; return; } // content.js answers 403
    const at = nowIso();
    const content = await db.get("SELECT * FROM paid_content WHERE post_id=$1", [pid]);
    req._paidEdit = { pid };
    if (b.paid === null || b.paid === false) { // back to a normal post: the body becomes public, buyers keep access anyway
      const data = { ...(row.data || {}) }; delete data.paid; if (content?.data?.doc) data.doc = content.data.doc;
      await db.tx(async (t) => {
        await t.run("UPDATE posts SET text=$1, data=$2, updated_at=$3 WHERE id=$4", [content?.text ?? row.text, data, at, pid]);
        await t.run("DELETE FROM paid_media WHERE post_id=$1", [pid]);
        await t.run("UPDATE paid_posts SET state='free', updated_at=$1 WHERE post_id=$2", [at, pid]);
      });
      delete b.paid; ctx.cache?.del?.("feed:");
      ctx.audit?.("paid_post_freed", pid, null, req.user.id);
      return;
    }
    let teaserCustom = !!pp.teaser_custom, teaser = row.text;
    if (b.paid !== undefined) {
      const v = await validatePaid(req.user, b.paid, pp);
      if (v.teaser !== null) { teaserCustom = v.teaser !== ""; teaser = v.teaser || autoTeaser(content?.text || ""); }
      await db.tx(async (t) => {
        await t.run("UPDATE paid_posts SET mode=$1, price=$2, min_tier_id=$3, min_amount=$4, teaser_custom=$5, updated_at=$6 WHERE post_id=$7", [v.mode, v.price, v.minTierId, v.minAmount, teaserCustom ? 1 : 0, at, pid]);
        await t.run("UPDATE posts SET data=$1, text=$2 WHERE id=$3", [{ ...(row.data || {}), paid: marker(v) }, teaser || "🔒", pid]);
      });
      delete b.paid; ctx.cache?.del?.("feed:");
    }
    if (b.text !== undefined) {
      const full = str(b.text, row.type === "article" ? 60000 : 5000, { required: true });
      if (Classifier.spam(full)) throw E.bad("المحتوى مرفوض");
      if (full !== (content?.text || "")) {
        await db.run("UPDATE paid_content SET text=$1, updated_at=$2 WHERE post_id=$3", [full, at, pid]);
        if (Classifier.sensitive(full)) await db.run("UPDATE posts SET sensitive=1 WHERE id=$1", [pid]);
        await markChanged(pid, "edited");
      }
      if (!teaserCustom) teaser = autoTeaser(full);
      b.text = teaser || "🔒"; // content.js stores the teaser (and versions only ever hold teasers)
    }
    if (b.status === "archived" && row.status === "published") req._paidEdit.archived = true;
  }
  async function afterEdit(out, req) {
    if (!req._paidEdit || !out?.post) return out;
    if (req._paidEdit.archived) await markChanged(req._paidEdit.pid, "archived");
    out.post = await renderFor(req.user, req._paidEdit.pid);
    return out;
  }

  /* ======================= PPV purchases ======================= */
  const purchaseClient = (p) => ({ id: p.id, postId: p.post_id, amount: pi(p.amount), status: p.status, createdAt: iso(p.created_at), completedAt: iso(p.completed_at), refundedAt: iso(p.refunded_at) });
  async function intent(user, postId) {
    const pis = ctx.services.pi; if (!pis || !pis.enabled()) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [str(String(postId || ""), 100, { required: true })]);
    if (!row || row.status !== "published") throw E.nf("المنشور غير موجود");
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1 AND state='active'", [row.id]);
    if (!pp || !row.data?.paid) throw fail(400, "not_paid", "هذا المنشور ليس محتوى مدفوعاً");
    if (!(await ctx.services.content.canSee(row, user.id))) throw E.nf("المنشور غير موجود");
    if (row.author === user.id) throw fail(400, "own_post", "هذا منشورك");
    if (pp.mode !== "ppv") throw fail(400, "not_ppv", "هذا المنشور للداعمين؛ ادعم صاحبه للوصول إليه");
    if ((await isMinor(user.id)) || (await isMinor(row.author))) throw fail(403, "minor_restricted", "المحتوى المدفوع غير متاح لمن هم دون ١٨ سنة");
    if (await blockedBetween(user.id, row.author)) throw fail(403, "blocked", "لا يمكن الشراء من هذا الحساب");
    if (!(await creatorEnabled(row.author))) throw fail(409, "creator_disabled", "هذا الحساب لا يبيع المحتوى حالياً");
    if (await db.get("SELECT 1 x FROM paid_purchases WHERE buyer_id=$1 AND post_id=$2 AND status IN ('completed','duplicate')", [user.id, row.id])) throw fail(409, "already_unlocked", "اشتريت هذا المحتوى مسبقاً");
    const author = await db.get("SELECT handle FROM users WHERE id=$1", [row.author]);
    const amount = Number(pp.price);
    const it = await pis.createIntent(user, { amount: pi(amount), memo: `محتوى مدفوع من @${author?.handle || "?"}`.slice(0, 200), purpose: "ppv", refId: row.id });
    const purchaseId = id("ppv");
    await db.run("INSERT INTO paid_purchases(id,buyer_id,post_id,creator_id,amount,fee,intent_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)",
      [purchaseId, user.id, row.id, row.author, amount, feeOf(amount), it.id, nowIso()]);
    return { intent: { id: it.id, amount: it.amount, memo: it.memo, metadata: it.metadata }, purchaseId };
  }

  async function onPaid(p, piTx) {
    const t = nowIso();
    const out = await db.tx(async (tx) => {
      const dup = await tx.get("SELECT id FROM paid_purchases WHERE buyer_id=$1 AND post_id=$2 AND status='completed' AND id<>$3", [p.buyer_id, p.post_id, p.id]);
      const status = dup ? "duplicate" : "completed";
      const r = await tx.run("UPDATE paid_purchases SET status=$1, completed_at=$2 WHERE id=$3 AND status='pending'", [status, t, p.id]);
      if (!r.changes) return null;
      await postJournal(tx, { ikey: `ppv:${p.id}:credit`, kind: "ppv", source: "ppv", refId: p.id, creatorId: p.creator_id, senderId: p.buyer_id, postId: p.post_id, piTx,
        lines: creditLines(Number(p.amount), Number(p.fee), p.buyer_id, p.creator_id) });
      if (dup) await tx.run("INSERT INTO paid_refund_requests(id,purchase_id,buyer_id,post_id,creator_id,kind,reason,status,created_at) VALUES($1,$2,$3,$4,$5,'duplicate',$6,'pending',$7)",
        [id("prf"), p.id, p.buyer_id, p.post_id, p.creator_id, "شراء مكرر لنفس المنشور", t]);
      return status;
    });
    if (!out) return;
    if (out === "duplicate") { ctx.audit?.("ppv_duplicate", p.id, null, "system"); return; }
    bus.emit("PPV_PURCHASED", { purchase: p.id, post: p.post_id, creator: p.creator_id, buyer: p.buyer_id, amount: pi(p.amount), actor: p.buyer_id });
    await ctx.services.notify?.notify?.(p.creator_id, "ppv_purchased", { actor: p.buyer_id, post: p.post_id, ref: p.id }).catch((e) => logger.warn?.("ppv notify failed", { err: e.message }));
  }
  /** idempotent: purchase refunded, journals reversed, access revoked */
  async function applyRefund(p, reason = "refund") {
    const t = nowIso();
    const moved = await db.tx(async (tx) => {
      const r = await tx.run("UPDATE paid_purchases SET status='refunded', refunded_at=$1, revoked_at=$1 WHERE id=$2 AND status IN ('completed','duplicate')", [t, p.id]);
      await reverseAll(tx, p.id, reason);
      if (r.changes) await tx.run("UPDATE paid_refund_requests SET status='approved', decided_at=$1, decided_by=COALESCE(decided_by,'system') WHERE purchase_id=$2 AND status='pending'", [t, p.id]);
      return !!r.changes;
    });
    if (!moved) return false;
    bus.emit("PAID_ACCESS_REVOKED", { purchase: p.id, post: p.post_id, user: p.buyer_id, creator: p.creator_id, reason, actor: p.buyer_id });
    await ctx.services.notify?.notify?.(p.buyer_id, "ppv_refunded", { ref: p.id }).catch(() => { });
    return true;
  }

  /* ======================= refunds ======================= */
  async function eligibility(p) {
    if (p.status !== "completed") return { ok: false, code: "not_refundable" };
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1", [p.post_id]);
    const post = await db.get("SELECT status, updated_at FROM posts WHERE id=$1", [p.post_id]);
    let at = pp?.changed_at ? Date.parse(iso(pp.changed_at)) : null, kind = pp?.change_kind || null;
    if (!at && post && ["deleted", "removed"].includes(post.status)) { at = post.updated_at ? Date.parse(iso(post.updated_at)) : clock().getTime(); kind = post.status; }
    if (!at || !kind || at <= Date.parse(iso(p.completed_at))) return { ok: false, code: "refund_not_eligible" };
    const until = at + cfg.refundWindowMs;
    if (clock().getTime() > until) return { ok: false, code: "refund_window_passed", kind };
    return { ok: true, kind, until: new Date(until).toISOString() };
  }
  const requestClient = (r) => (r ? { id: r.id, purchaseId: r.purchase_id, postId: r.post_id, kind: r.kind, reason: r.reason || null, status: r.status, note: r.note || null, createdAt: iso(r.created_at), decidedAt: iso(r.decided_at) } : null);
  async function requestRefund(user, purchaseId, b) {
    const p = await db.get("SELECT * FROM paid_purchases WHERE id=$1", [purchaseId]);
    if (!p || p.buyer_id !== user.id) throw E.nf();
    if (await db.get("SELECT 1 x FROM paid_refund_requests WHERE purchase_id=$1 AND status='pending'", [p.id])) throw fail(409, "refund_pending", "طلب الاسترداد قيد المراجعة");
    const el = await eligibility(p);
    if (!el.ok) {
      const msg = { not_refundable: "هذه العملية غير قابلة للاسترداد", refund_not_eligible: "يتاح الاسترداد فقط إذا عدّل صاحب المنشور محتواه أو حذفه أو أُزيل بقرار إشراف بعد شرائك", refund_window_passed: "انتهت مهلة طلب الاسترداد (٢٤ ساعة من التغيير)" }[el.code];
      throw fail(409, el.code, msg);
    }
    const rid = id("prf"), at = nowIso();
    await db.run("INSERT INTO paid_refund_requests(id,purchase_id,buyer_id,post_id,creator_id,kind,reason,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)",
      [rid, p.id, user.id, p.post_id, p.creator_id, el.kind, str(b?.reason, 500) || null, at]);
    ctx.audit?.("ppv_refund_requested", p.id, el.kind, user.id);
    return { request: requestClient(await db.get("SELECT * FROM paid_refund_requests WHERE id=$1", [rid])) };
  }
  async function refundList(q) {
    const status = ["pending", "approved", "rejected", "all"].includes(q.status) ? q.status : "pending";
    const rows = await db.all(`SELECT r.*, p.amount, p.intent_id, p.status AS p_status, p.completed_at AS p_completed, b.handle AS b_handle, b.name AS b_name, c.handle AS c_handle, c.name AS c_name, po.title AS post_title, po.status AS post_status
      FROM paid_refund_requests r JOIN paid_purchases p ON p.id=r.purchase_id LEFT JOIN users b ON b.id=r.buyer_id LEFT JOIN users c ON c.id=r.creator_id LEFT JOIN posts po ON po.id=r.post_id
      ${status === "all" ? "" : "WHERE r.status=$1"} ORDER BY r.created_at ${status === "pending" ? "ASC" : "DESC"} LIMIT 200`, status === "all" ? [] : [status]);
    return { status, items: rows.map((r) => ({ ...requestClient(r), amount: pi(r.amount), intentId: r.intent_id, purchase: { id: r.purchase_id, status: r.p_status, completedAt: iso(r.p_completed) },
      buyer: { id: r.buyer_id, handle: r.b_handle, name: r.b_name }, creator: { id: r.creator_id, handle: r.c_handle, name: r.c_name }, post: { id: r.post_id, title: r.post_title || null, status: r.post_status || null } })) };
  }
  async function decide(by, rid, approve, b) {
    const r = await db.get("SELECT * FROM paid_refund_requests WHERE id=$1", [rid]); if (!r) throw E.nf();
    if (r.status !== "pending") { if ((r.status === "approved") === approve) return { ok: true, id: r.id, status: r.status }; throw E.conflict("تم البت في الطلب مسبقاً"); }
    const p = await db.get("SELECT * FROM paid_purchases WHERE id=$1", [r.purchase_id]);
    const note = str(b?.note, 300) || null, at = nowIso();
    if (approve) {
      // the Pi itself is sent back by the operator outside the app; the Pi service records it and emits PI_PAYMENT_REFUNDED
      await ctx.services.pi.refund(by, p.intent_id, { note: "استرداد محتوى مدفوع" + (note ? ": " + note : ""), txid: b?.txid });
      await applyRefund(await db.get("SELECT * FROM paid_purchases WHERE id=$1", [p.id]), "refund");
      await db.run("UPDATE paid_refund_requests SET status='approved', decided_by=$1, decided_at=$2, note=$3 WHERE id=$4", [by.id, at, note, r.id]);
      ctx.audit?.("ppv_refund_approved", p.id, note, by.id);
      const now2 = await db.get("SELECT * FROM paid_purchases WHERE id=$1", [p.id]);
      return { ok: true, id: r.id, status: "approved", purchase: purchaseClient(now2) };
    }
    const x = await db.run("UPDATE paid_refund_requests SET status='rejected', decided_by=$1, decided_at=$2, note=$3 WHERE id=$4 AND status='pending'", [by.id, at, note, r.id]);
    if (!x.changes) throw E.conflict("تغيّرت حالة الطلب، حدّث الصفحة");
    ctx.audit?.("ppv_refund_rejected", p.id, note, by.id);
    await ctx.services.notify?.notify?.(r.buyer_id, "paid_refund_rejected", { ref: p.id }).catch(() => { });
    return { ok: true, id: r.id, status: "rejected" };
  }

  /* ======================= lists ======================= */
  async function myPurchases(user, q) {
    const all = q.all === "1" || q.all === "true";
    const rows = await db.all(`SELECT p.*, po.title, po.text AS teaser, po.status AS post_status, po.type, u.handle, u.name, u.avatar FROM paid_purchases p LEFT JOIN posts po ON po.id=p.post_id LEFT JOIN users u ON u.id=p.creator_id
      WHERE p.buyer_id=$1 ${all ? "" : "AND p.status IN ('completed','duplicate','refunded')"} ORDER BY p.created_at DESC LIMIT 200`, [user.id]);
    const reqs = rows.length ? await db.all(`SELECT * FROM paid_refund_requests WHERE purchase_id IN (${inList(rows.map((r) => r.id))}) ORDER BY created_at DESC`, rows.map((r) => r.id)) : [];
    const items = [];
    for (const r of rows) {
      const el = r.status === "completed" ? await eligibility(r) : { ok: false };
      const rq = reqs.find((x) => x.purchase_id === r.id);
      items.push({ ...purchaseClient(r), post: r.post_status ? { id: r.post_id, title: r.title || null, teaser: r.teaser || "", type: r.type, status: r.post_status, author: { handle: r.handle, name: r.name, avatar: r.avatar || null } } : null,
        refundEligible: !!el.ok && !(rq && rq.status === "pending"), refundUntil: el.ok ? el.until : null, refundRequest: requestClient(rq || null) });
    }
    return { items };
  }
  async function myPaidPosts(user) {
    const rows = await db.all(`SELECT pp.*, po.title, po.text AS teaser, po.status AS post_status, po.type, po.created_at AS post_created FROM paid_posts pp JOIN posts po ON po.id=pp.post_id
      WHERE pp.creator_id=$1 AND pp.state IN ('active','free') AND po.status <> 'deleted' ORDER BY po.created_at DESC LIMIT 200`, [user.id]);
    const ids = rows.map((r) => r.post_id);
    const agg = new Map(ids.length ? (await db.all(`SELECT post_id, SUM(CASE WHEN status IN ('completed','duplicate','refunded') THEN 1 ELSE 0 END) AS n, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS unlocks,
        COALESCE(SUM(CASE WHEN status IN ('completed','duplicate') THEN amount ELSE 0 END),0) AS gross, COALESCE(SUM(CASE WHEN status IN ('completed','duplicate') THEN fee ELSE 0 END),0) AS fees,
        SUM(CASE WHEN status='refunded' THEN 1 ELSE 0 END) AS refunds FROM paid_purchases WHERE post_id IN (${inList(ids)}) GROUP BY post_id`, ids)).map((a) => [a.post_id, a]) : []);
    const tierIds = [...new Set(rows.map((r) => r.min_tier_id).filter(Boolean))];
    const tiers = new Map(tierIds.length ? (await db.all(`SELECT id, name, amount FROM creator_tiers WHERE id IN (${inList(tierIds)})`, tierIds)).map((t) => [t.id, t]) : []);
    return { currency: "Pi", feeBps: cfg.feeBps, items: rows.map((r) => {
      const a = agg.get(r.post_id) || {}, t = r.min_tier_id ? tiers.get(r.min_tier_id) : null;
      return { postId: r.post_id, title: r.title || null, teaser: r.teaser || "", type: r.type, status: r.post_status, state: r.state, mode: r.mode, price: r.mode === "ppv" ? pi(r.price) : null,
        minTier: t ? { id: t.id, name: t.name, amount: pi(t.amount) } : null, unlocks: Number(a.unlocks || 0), revenue: pi(a.gross || 0), net: pi(Number(a.gross || 0) - Number(a.fees || 0)), refunds: Number(a.refunds || 0), createdAt: iso(r.post_created) };
    }) };
  }
  async function postInfo(viewer, postId) {
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [str(String(postId || ""), 100, { required: true })]);
    if (!row || !(await ctx.services.content.canSee(row, viewer?.id || null))) throw E.nf();
    const pp = await db.get("SELECT * FROM paid_posts WHERE post_id=$1 AND state='active'", [row.id]);
    if (!pp || !row.data?.paid) return { postId: row.id, paid: false, unlocked: true };
    const o = ctx.services.content.toClient(row, viewer?.id || null);
    const purchase = viewer ? await db.get("SELECT * FROM paid_purchases WHERE buyer_id=$1 AND post_id=$2 AND status IN ('completed','duplicate','refunded','pending') ORDER BY created_at DESC LIMIT 1", [viewer.id, row.id]) : null;
    return { postId: row.id, paid: true, mode: pp.mode, price: pp.mode === "ppv" ? pi(pp.price) : null, unlocked: o.locked === false, lock: o.locked ? o.lock : null, purchase: purchase ? purchaseClient(purchase) : null };
  }

  /* ======================= bus ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("paid handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  const sameAmount = (a, units) => Math.abs(toUnits(a) - Number(units)) <= 1;
  bus.on("PI_PAYMENT_COMPLETED", track(async (e) => {
    if (e.purpose !== "ppv") return;
    const p = await db.get("SELECT * FROM paid_purchases WHERE intent_id=$1", [e.tx]); if (!p) return;
    if (e.amount !== undefined && !sameAmount(e.amount, p.amount)) { logger.warn?.("ppv amount mismatch; not unlocked", { purchase: p.id }); return; }
    await onPaid(p, e.tx);
  }));
  bus.on("PI_PAYMENT_CANCELLED", track(async (e) => { if (e.purpose === "ppv") await db.run("UPDATE paid_purchases SET status='cancelled', cancelled_at=$1 WHERE intent_id=$2 AND status='pending'", [nowIso(), e.tx]); }));
  bus.on("PI_PAYMENT_REFUNDED", track(async (e) => {
    if (e.purpose !== "ppv") return;
    const p = await db.get("SELECT * FROM paid_purchases WHERE intent_id=$1", [e.tx]); if (p) await applyRefund(p, "refund");
  }));
  bus.on("POST_DELETED", track(async (e) => { if (e?.post) await markChanged(e.post, "deleted"); }));
  bus.on("CONTENT_REMOVED", track(async (e) => { if (e?.post) await markChanged(e.post, "removed"); }));
  bus.on("USER_ANONYMISED", track(async (e) => { if (e?.user) await db.run("UPDATE paid_refund_requests SET reason=NULL WHERE buyer_id=$1", [e.user]); }));

  /* ======================= routes ======================= */
  hook("POST", "/api/posts", { before: beforeCreate, after: afterCreate, onError: createFailed });
  hook("PATCH", "/api/posts/x_probe", { before: beforeEdit, after: afterEdit });
  R.get("/api/paid/:postId", async (req) => postInfo(req.user || null, req.params.postId));
  R.post("/api/paid/:postId/intent", A(async (req) => intent(req.user, req.params.postId)));
  R.get("/api/me/purchases", A(async (req) => myPurchases(req.user, req.query || {})));
  R.get("/api/me/paid-posts", A(async (req) => myPaidPosts(req.user)));
  R.post("/api/paid/purchases/:id/refund-request", A(async (req) => requestRefund(req.user, req.params.id, req.body)));
  R.get("/api/admin/paid/refunds", admin(async (req) => refundList(req.query || {})));
  R.post("/api/admin/paid/refunds/:id/approve", admin(async (req) => decide(req.user, req.params.id, true, req.body)));
  R.post("/api/admin/paid/refunds/:id/reject", admin(async (req) => decide(req.user, req.params.id, false, req.body)));

  return { config: cfg, annotate, render, mediaGate, assertMedia, entitled, autoTeaser, settle };
};
