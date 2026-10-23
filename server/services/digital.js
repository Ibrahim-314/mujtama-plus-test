/* Digital products store — متجر المنتجات الرقمية (phase 58). Extends the phase 39 marketplace instead of duplicating it:
 * a digital product is a market_listings row with kind 'digital' (title, price, cover images, search, reviews, disputes,
 * orders, escrow, fees and the Pi payment all stay the market's) plus a digital_products row (migration 038).
 * 1. Files: deliverables (PDF / e-book, ZIP templates or course bundles incl. EPUB/DOCX/XLSX, images, audio, video) are uploaded
 *    to the existing media storage (ctx.storage; STORAGE_DRIVER=db → blobs, so the database caps apply: DIGITAL_MAX_FILE_MB,
 *    default 20, per seller DIGITAL_SELLER_MAX_MB, default 60, and the global STORAGE_DB_MAX_TOTAL_MB → 413) under private
 *    dg_ keys. /media/dg_… is always refused (paid.mediaGate is wrapped), so files are reachable only through download links.
 * 2. Instant delivery: MARKET_ORDER_PAID (the Pi payment completed) → entitlement + optional license key, order → delivered,
 *    system message in the order conversation, buyer notified. The market's escrow and auto-release stay as they are.
 * 3. Downloads: POST /api/digital/library/:id/link issues an expiring link (DIGITAL_LINK_TTL_MIN, per product 5–60 min) bound
 *    to the buyer's session; each link uses one download from the product's limit (1–50). Only the token hash is stored.
 * 4. Library «مشترياتي», previews (public preview file + sample text), license keys (seller can list / verify).
 * 5. Refund policy per product: none | undownloaded (within 48 h and never downloaded) | 7days. A self-refund is allowed while
 *    the escrow is still held: order → refunded, escrow refunded through the market's settle(), entitlement revoked, the Pi
 *    refund recorded (the operator sends the Pi back from the app wallet, as for every market refund). Market disputes apply.
 * 6. Creator sales stats (per product, 30-day series, downloads, refunds). Minors can neither sell nor buy (market rules).
 * 7. Abuse / copyright reports: digital_reports + a `reports` row (kind listing) for the moderation queue; admin takedown removes
 *    the listing, blocks its files (same sha256 can't be uploaded again) and can revoke buyers' downloads.
 * Disabled until Pi payments are enabled (DIGITAL_ENABLED=0 forces it off): config says enabled:false and writes answer 501. */
const crypto = require("node:crypto");
const { E, HttpError, str, id } = require("../lib/core");
const { pi } = require("../lib/ledger");

const DAY = 864e5, HOUR = 3600e3, MB = 1024 * 1024;
const TYPES = { ebook: "كتاب إلكتروني", template: "قالب", course: "دورة", file: "ملف" };
const POLICIES = { none: "لا استرداد بعد الشراء (يبقى النزاع متاحاً إن لم يطابق الوصف)", undownloaded: "استرداد خلال ٤٨ ساعة إن لم تنزّل الملف", "7days": "استرداد خلال ٧ أيام" };
const REASONS = { copyright: "انتهاك حقوق النشر", abuse: "محتوى مسيء أو مخالف", malware: "ملف ضار", fraud: "احتيال أو تضليل", other: "سبب آخر" };
const SIG = [
  { ext: ".pdf", mime: "application/pdf", test: (b) => b.slice(0, 5).toString() === "%PDF-" },
  { ext: ".zip", mime: "application/zip", test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4 },
  { ext: ".png", mime: "image/png", test: (b) => b.slice(0, 4).toString("hex") === "89504e47" },
  { ext: ".jpg", mime: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { ext: ".webp", mime: "image/webp", test: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" },
  { ext: ".mp3", mime: "audio/mpeg", test: (b) => b.slice(0, 3).toString() === "ID3" },
  { ext: ".mp4", mime: "video/mp4", test: (b) => b.slice(4, 8).toString() === "ftyp" }
];
const ZIP_EXT = { epub: "application/epub+zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx, R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const cfg = { maxFile: Math.round(num("DIGITAL_MAX_FILE_MB", 20) * MB), sellerMax: Math.round(num("DIGITAL_SELLER_MAX_MB", 60) * MB), maxFiles: 10,
    linkTtlMin: Math.min(60, Math.max(5, num("DIGITAL_LINK_TTL_MIN", 15))), dlDefault: 5, dlMax: 50, undownloadedMs: 48 * HOUR, sevenMs: 7 * DAY };
  const M = () => ctx.services.market, I = () => M().internal;
  const piOn = () => !!ctx.services.pi?.enabled?.();
  const enabled = () => env.DIGITAL_ENABLED !== "0" && piOn();
  const OFF = "متجر المنتجات الرقمية يعمل فور تفعيل مدفوعات Pi";
  const requireOn = () => { if (!enabled()) throw fail(501, "not_configured", OFF); };
  const iso = (v) => (v == null ? null : typeof v === "string" ? v : new Date(v).toISOString());
  const parse = (v, d) => { if (Array.isArray(v)) return v; try { const x = JSON.parse(v || "null"); return x ?? d; } catch { return d; } };
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const isMinor = (uid) => I().isMinor(uid);
  const adultOnly = async (uid) => { if (await isMinor(uid)) throw fail(403, "minor_restricted", "بيع المنتجات الرقمية وشراؤها غير متاحين لمن هم دون ١٨ سنة"); };
  const notify = (uid, kind, o) => ctx.services.notify?.notify?.(uid, kind, o)?.catch?.((e) => logger.warn?.("digital notify failed", { err: e.message }));

  /* private files are never served through /media/ */
  const paid = ctx.services.paid;
  if (paid?.mediaGate) { const orig = paid.mediaGate; paid.mediaGate = async (req, name) => (/^dg_/i.test(String(name || "")) ? "deny" : orig(req, name)); }

  /* ======================= 1. files ======================= */
  const fileClient = (f) => ({ id: f.id, name: f.name, mime: f.mime, size: Number(f.size), role: f.role, createdAt: iso(f.created_at) });
  async function sellerUsage(uid) { return Number((await db.get("SELECT COALESCE(SUM(size),0) s FROM digital_files WHERE seller_id=$1 AND deleted_at IS NULL", [uid])).s); }
  async function upload(user, req) {
    requireOn(); await adultOnly(user.id);
    if (!rl.hit("upload", "dg:" + user.id)) throw E.rate();
    const buf = req.rawBody; if (!buf || buf.length < 8) throw E.bad("ملف فارغ");
    if (buf.length > cfg.maxFile) throw fail(413, "file_too_large", `أقصى حجم للملف ${Math.round(cfg.maxFile / MB)} ميغابايت`);
    const sig = SIG.find((s) => s.test(buf)); if (!sig) throw fail(400, "type_unsupported", "نوع الملف غير مدعوم (PDF، ZIP/EPUB/Office، صور، MP3، MP4)");
    if ((await sellerUsage(user.id)) + buf.length > cfg.sellerMax) throw fail(413, "seller_quota", `تجاوزت مساحة ملفاتك (${Math.round(cfg.sellerMax / MB)} ميغابايت) — احذف ملفات غير مستخدمة`);
    const hash = sha(buf);
    if (await db.get("SELECT 1 x FROM digital_files WHERE sha256=$1 AND blocked=1", [hash])) throw fail(451, "file_blocked", "أُزيل هذا الملف سابقاً بسبب بلاغ حقوق نشر أو إساءة");
    let name = str(String(req.query?.name || "file").replace(/[\\/:*?"<>|]|\p{Cc}/gu, "_"), 120) || "file";
    const ext = (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] || "").toLowerCase();
    const mime = sig.ext === ".zip" && ZIP_EXT[ext] ? ZIP_EXT[ext] : sig.mime;
    if (!ext) name += sig.ext;
    const fid = id("dgf"), key = `dg_${fid}_${crypto.randomBytes(9).toString("hex")}${sig.ext === ".zip" && ZIP_EXT[ext] ? "." + ext : sig.ext}`;
    const role = req.query?.role === "preview" ? "preview" : "file";
    await ctx.storage.put(key, buf, mime); // db driver: per-file / total caps → 413
    await db.run("INSERT INTO digital_files(id,seller_id,storage_key,name,mime,size,sha256,role,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [fid, user.id, key, name, mime, buf.length, hash, role, nowIso()]);
    return { file: fileClient(await db.get("SELECT * FROM digital_files WHERE id=$1", [fid])), usage: { used: await sellerUsage(user.id), max: cfg.sellerMax } };
  }
  async function myFiles(user) {
    const rows = await db.all("SELECT * FROM digital_files WHERE seller_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200", [user.id]);
    return { files: rows.map(fileClient), usage: { used: await sellerUsage(user.id), max: cfg.sellerMax } };
  }
  async function delFile(user, fid) {
    const f = await db.get("SELECT * FROM digital_files WHERE id=$1 AND seller_id=$2 AND deleted_at IS NULL", [String(fid).slice(0, 60), user.id]); if (!f) throw E.nf("الملف غير موجود");
    const used = await db.all("SELECT p.listing_id FROM digital_products p WHERE p.seller_id=$1 AND (p.files LIKE $2 OR p.preview_file=$3)", [user.id, `%"${f.id}"%`, f.id]);
    for (const u of used) if (await db.get("SELECT 1 x FROM digital_entitlements WHERE listing_id=$1 AND status='active'", [u.listing_id])) throw fail(409, "file_in_use", "لا يمكن حذف ملف اشتراه أحد — المشترون يحتاجونه");
    if (used.length) throw fail(409, "file_in_use", "أزل الملف من المنتج أولاً");
    await db.run("UPDATE digital_files SET deleted_at=$1 WHERE id=$2", [nowIso(), f.id]);
    if (!Number(f.blocked)) await ctx.storage.del?.(f.storage_key).catch(() => null);
    return { ok: true };
  }

  /* ======================= 2. products ======================= */
  async function validateDigital(user, b, cur = null) {
    const out = {}, has = (k) => b[k] !== undefined;
    if (!cur || has("type")) { const t = b.type ?? "file"; if (!TYPES[t]) throw fail(400, "type_invalid", "النوع: كتاب أو قالب أو دورة أو ملف"); out.ptype = t; }
    if (!cur || has("files")) {
      const ids = Array.isArray(b.files) ? [...new Set(b.files.map(String))] : [];
      if (!ids.length || ids.length > cfg.maxFiles) throw fail(400, "files_invalid", `أرفق من ملف إلى ${cfg.maxFiles} ملفات`);
      const rows = await db.all(`SELECT id, seller_id, role, blocked, deleted_at FROM digital_files WHERE id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids);
      if (rows.length !== ids.length || rows.some((f) => f.seller_id !== user.id || f.deleted_at || Number(f.blocked))) throw fail(400, "files_invalid", "استخدم ملفاتك المرفوعة فقط");
      out.files = JSON.stringify(ids);
    }
    if (has("previewFile")) {
      if (b.previewFile === null || b.previewFile === "") out.preview_file = null;
      else { const f = await db.get("SELECT * FROM digital_files WHERE id=$1", [String(b.previewFile)]); if (!f || f.seller_id !== user.id || f.deleted_at || Number(f.blocked)) throw fail(400, "files_invalid", "ملف المعاينة غير صالح"); out.preview_file = f.id; }
    }
    if (has("sampleText")) out.sample_text = str(b.sampleText, 4000) || null;
    if (has("license")) out.license = b.license ? 1 : 0;
    if (has("downloadLimit")) { const n = Number(b.downloadLimit); if (!Number.isInteger(n) || n < 1 || n > cfg.dlMax) throw fail(400, "limit_invalid", `حد التنزيل من ١ إلى ${cfg.dlMax}`); out.download_limit = n; }
    if (has("linkTtlMin")) { const n = Number(b.linkTtlMin); if (!Number.isInteger(n) || n < 5 || n > 60) throw fail(400, "limit_invalid", "مدة الرابط من ٥ إلى ٦٠ دقيقة"); out.link_ttl_min = n; }
    if (has("refundPolicy")) { if (!POLICIES[b.refundPolicy]) throw fail(400, "policy_invalid", "سياسة الاسترداد غير معروفة"); out.refund_policy = b.refundPolicy; }
    return out;
  }
  const LISTING_KEYS = ["title", "description", "price", "images", "status", "communityId", "category"];
  const pick = (b) => Object.fromEntries(LISTING_KEYS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));
  async function create(user, b) {
    requireOn(); await adultOnly(user.id);
    if (!b || typeof b !== "object") throw E.bad();
    const d = await validateDigital(user, b);
    const { listing } = await I().createListing(user, { ...pick(b), category: b.category || "digital", kind: "digital", quantity: null, condition: "na" }, { digital: true });
    const at = nowIso();
    try {
      await db.run("INSERT INTO digital_products(listing_id,seller_id,ptype,files,preview_file,sample_text,license,download_limit,link_ttl_min,refund_policy,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$11)",
        [listing.id, user.id, d.ptype, d.files, d.preview_file ?? null, d.sample_text ?? null, d.license ?? 0, d.download_limit ?? cfg.dlDefault, d.link_ttl_min ?? cfg.linkTtlMin, d.refund_policy ?? "undownloaded", at]);
    } catch (e) { await db.run("UPDATE market_listings SET status='removed', removed_at=$1 WHERE id=$2", [at, listing.id]); throw e; }
    ctx.audit?.("digital_product_created", listing.id, null, user.id);
    return read(user, listing.id);
  }
  async function update(user, lid, b) {
    requireOn(); await adultOnly(user.id);
    const p = await db.get("SELECT * FROM digital_products WHERE listing_id=$1", [String(lid).slice(0, 100)]);
    if (!p || p.seller_id !== user.id) throw E.nf("المنتج غير موجود");
    if (p.status === "blocked") throw fail(409, "blocked", "أُزيل هذا المنتج بقرار من الإشراف");
    const d = await validateDigital(user, b || {}, p);
    const lb = pick(b || {});
    if (Object.keys(lb).length) await I().updateListing(user, p.listing_id, lb);
    const cols = Object.keys(d);
    if (cols.length) await db.run(`UPDATE digital_products SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(", ")}, updated_at=$${cols.length + 1} WHERE listing_id=$${cols.length + 2}`, [...cols.map((c) => d[c]), nowIso(), p.listing_id]);
    return read(user, p.listing_id);
  }
  const productRow = (lid) => db.get("SELECT * FROM digital_products WHERE listing_id=$1", [String(lid || "").slice(0, 100)]);
  async function entOf(uid, lid) {
    if (!uid) return null;
    return db.get("SELECT e.* FROM digital_entitlements e JOIN market_orders o ON o.id=e.order_id WHERE e.buyer_id=$1 AND e.listing_id=$2 AND e.status='active' AND o.status NOT IN ('refunded','cancelled') ORDER BY e.granted_at DESC", [uid, lid]);
  }
  async function productClient(p, viewer) {
    const ids = parse(p.files, []);
    const files = ids.length ? await db.all(`SELECT * FROM digital_files WHERE id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const mine = viewer && viewer.id === p.seller_id;
    return { type: p.ptype, typeLabel: TYPES[p.ptype] || p.ptype, status: p.status, files: ids.map((x) => files.find((f) => f.id === x)).filter(Boolean).map((f) => ({ ...(mine ? { id: f.id } : {}), name: f.name, mime: f.mime, size: Number(f.size) })),
      preview: p.preview_file ? `/api/digital/products/${encodeURIComponent(p.listing_id)}/preview` : null, sampleText: p.sample_text || "", license: !!Number(p.license),
      downloadLimit: Number(p.download_limit), linkTtlMin: Number(p.link_ttl_min), refundPolicy: p.refund_policy, refundPolicyText: POLICIES[p.refund_policy] || "", ...(mine ? { previewFile: p.preview_file || null, fileIds: ids } : {}) };
  }
  async function read(viewer, lid) {
    const p = await productRow(lid); if (!p) throw E.nf("المنتج غير موجود");
    const l = await I().getListing(p.listing_id);
    const listing = l ? await I().listingFull(l, viewer) : null;
    if (!listing || (listing.status === "removed" && !(viewer && (viewer.role === "admin"))) || (!["active", "sold_out"].includes(listing.status) && !(viewer && (viewer.id === p.seller_id || viewer.role === "admin")))) throw E.nf("المنتج غير موجود");
    const ent = await entOf(viewer?.id, p.listing_id);
    const out = { listing, product: await productClient(p, viewer), owned: ent ? { entitlementId: ent.id } : null, enabled: enabled(), ...(enabled() ? {} : { note: OFF }) };
    if (ent && out.listing.canBuy) { out.listing.canBuy = false; out.listing.buyReason = "owned"; }
    if (p.status === "blocked") { out.listing.canBuy = false; out.listing.buyReason = "unavailable"; }
    return out;
  }
  async function preview(req, res, lid) {
    const p = await productRow(lid); if (!p || !p.preview_file || p.status !== "active") throw E.nf("لا توجد معاينة");
    const l = await I().getListing(p.listing_id); if (!l || !["active", "sold_out"].includes(l.status)) throw E.nf("لا توجد معاينة");
    const f = await db.get("SELECT * FROM digital_files WHERE id=$1 AND deleted_at IS NULL AND blocked=0", [p.preview_file]); if (!f) throw E.nf("لا توجد معاينة");
    return stream(res, f, { inline: true });
  }
  async function stream(res, f, { inline = false } = {}) {
    const buf = await ctx.storage.get(f.storage_key); if (!buf) throw E.nf("الملف غير متاح");
    const safe = encodeURIComponent(f.name).replace(/['()]/g, escape);
    res.writeHead(200, { "Content-Type": inline && /^(image\/|application\/pdf)/.test(f.mime) ? f.mime : "application/octet-stream", "Content-Length": buf.length,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.id}${(/\.[a-z0-9]{2,5}$/i.exec(f.name) || [""])[0]}"; filename*=UTF-8''${safe}`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "no-referrer" });
    res.end(buf);
    return ctx.STREAM;
  }
  async function store(viewer, q) {
    const type = TYPES[q.type] ? q.type : null, term = q.q ? String(q.q).slice(0, 80) : null;
    const args = [], where = ["l.kind='digital'", "l.status='active'", "p.status='active'"];
    if (type) { args.push(type); where.push(`p.ptype=$${args.length}`); }
    if (term) { args.push("%" + term.replace(/[%_]/g, "") + "%"); where.push(`(l.title LIKE $${args.length} OR l.description LIKE $${args.length})`); }
    const rows = await db.all(`SELECT l.*, p.ptype FROM market_listings l JOIN digital_products p ON p.listing_id=l.id JOIN users u ON u.id=l.seller_id AND u.status='active' WHERE ${where.join(" AND ")} ORDER BY l.created_at DESC LIMIT 48`, args);
    const blocked = new Set(viewer?.prefs?.blocked || []);
    const vis = rows.filter((r) => !blocked.has(r.seller_id));
    const cards = await I().cards(vis, viewer);
    return { items: cards.map((c, i) => ({ ...c, type: vis[i].ptype, typeLabel: TYPES[vis[i].ptype] })), types: Object.entries(TYPES).map(([k, v]) => ({ key: k, label: v })), enabled: enabled(), ...(enabled() ? {} : { note: OFF }) };
  }

  /* ======================= 3. order hook + instant delivery ======================= */
  I().hooks.beforeOrder.push(async (user, l, b) => {
    if (l.kind !== "digital") return;
    const p = await productRow(l.id);
    if (!p || p.status !== "active") throw fail(409, "unavailable", "المنتج غير متاح");
    if (!enabled()) throw fail(409, "not_configured", OFF);
    if (b?.qty !== undefined && b.qty !== null && b.qty !== 1) throw fail(400, "qty_invalid", "المنتج الرقمي يُشترى مرة واحدة");
    if (await entOf(user.id, l.id)) throw fail(409, "owned", "اشتريت هذا المنتج من قبل — تجده في «مشترياتي»");
    if (await db.get("SELECT 1 x FROM market_orders WHERE buyer_id=$1 AND listing_id=$2 AND status='pending_payment'", [user.id, l.id])) throw fail(409, "pending", "لديك طلب شراء لهذا المنتج بانتظار الدفع");
  });
  function licenseKey() { const b = crypto.randomBytes(20); let s = ""; for (let i = 0; i < 20; i++) s += B32[b[i] % 32]; return s.match(/.{5}/g).join("-"); }
  async function deliver(oid) {
    const o = await I().getOrder(oid); if (!o) return;
    const l = await I().getListing(o.listing_id); if (!l || l.kind !== "digital") return;
    const p = await productRow(l.id); if (!p) return;
    const at = nowIso();
    const n = await db.tx(async (t) => {
      const ins = await t.run("INSERT INTO digital_entitlements(id,order_id,listing_id,buyer_id,seller_id,license_key,downloads,download_limit,status,granted_at) VALUES($1,$2,$3,$4,$5,$6,0,$7,'active',$8) ON CONFLICT (order_id) DO NOTHING",
        [id("dge"), o.id, l.id, o.buyer_id, o.seller_id, Number(p.license) ? licenseKey() : null, Number(p.download_limit), at]);
      if (!ins.changes) return null;
      return I().transition(t, o, "delivered", ["paid_held"], { delivered_at: at });
    });
    if (!n) return;
    await I().systemMessage(n, "digital_delivered", { actor: o.seller_id });
    await notify(o.buyer_id, "market_order_delivered", { actor: o.seller_id, ref: o.id });
    bus.emit("DIGITAL_DELIVERED", { order: o.id, listing: l.id, buyer: o.buyer_id, seller: o.seller_id });
  }

  /* ======================= 4. library, links, downloads ======================= */
  async function refundState(e, p, o, esc) {
    if (!o || ["refunded", "cancelled"].includes(o.status)) return { allowed: false, reason: "refunded" };
    if (!esc || esc.state !== "held") return { allowed: false, reason: "settled" };
    const age = clock().getTime() - Date.parse(iso(e.granted_at));
    if (p.refund_policy === "undownloaded") return Number(e.downloads) === 0 && age <= cfg.undownloadedMs ? { allowed: true, until: new Date(Date.parse(iso(e.granted_at)) + cfg.undownloadedMs).toISOString() } : { allowed: false, reason: Number(e.downloads) ? "downloaded" : "window" };
    if (p.refund_policy === "7days") return age <= cfg.sevenMs ? { allowed: true, until: new Date(Date.parse(iso(e.granted_at)) + cfg.sevenMs).toISOString() } : { allowed: false, reason: "window" };
    return { allowed: false, reason: "policy" };
  }
  async function library(user) {
    const rows = await db.all(`SELECT e.*, o.status AS order_status, l.title FROM digital_entitlements e JOIN market_orders o ON o.id=e.order_id JOIN market_listings l ON l.id=e.listing_id WHERE e.buyer_id=$1 ORDER BY e.granted_at DESC LIMIT 200`, [user.id]);
    const items = [];
    for (const e of rows) {
      const p = await productRow(e.listing_id), l = await I().getListing(e.listing_id);
      const active = e.status === "active" && !["refunded", "cancelled"].includes(e.order_status) && p?.status !== "blocked";
      const [card] = l ? await I().cards([l], user) : [null];
      const esc = await db.get("SELECT state FROM market_escrow WHERE order_id=$1", [e.order_id]);
      items.push({ id: e.id, orderId: e.order_id, listingId: e.listing_id, title: e.title, cover: card?.cover || null, seller: card?.seller || null, grantedAt: iso(e.granted_at),
        status: active ? "active" : e.status === "active" ? (["refunded", "cancelled"].includes(e.order_status) ? "refunded" : "unavailable") : e.status,
        licenseKey: active ? e.license_key || null : null, downloads: Number(e.downloads), downloadLimit: Number(e.download_limit), downloadsLeft: Math.max(0, Number(e.download_limit) - Number(e.downloads)),
        product: p && active ? await productClient(p, null).then((x) => ({ ...x, files: parse(p.files, []).map((fid, i) => ({ id: fid, ...x.files[i] })) })) : null,
        refund: p ? await refundState(e, p, { status: e.order_status }, esc) : { allowed: false } });
    }
    return { items };
  }
  async function link(user, eid, b) {
    const e = await db.get("SELECT * FROM digital_entitlements WHERE id=$1", [String(eid).slice(0, 60)]);
    if (!e || e.buyer_id !== user.id) throw E.nf("غير موجود في مشترياتك");
    const o = await I().getOrder(e.order_id), p = await productRow(e.listing_id);
    if (e.status !== "active" || !o || ["refunded", "cancelled"].includes(o.status) || !p || p.status === "blocked") throw fail(403, "revoked", "لم يعد هذا المنتج متاحاً للتنزيل");
    const fid = String(b?.fileId || ""); if (!parse(p.files, []).includes(fid)) throw E.bad("الملف غير موجود في المنتج");
    const f = await db.get("SELECT * FROM digital_files WHERE id=$1 AND blocked=0", [fid]); if (!f) throw fail(410, "file_gone", "الملف غير متاح");
    if (!rl.hit("default", "dglink:" + user.id)) throw E.rate();
    const r = await db.run("UPDATE digital_entitlements SET downloads=downloads+1, last_download_at=$1 WHERE id=$2 AND status='active' AND downloads < download_limit", [nowIso(), e.id]);
    if (!r.changes) throw fail(429, "download_limit", `استنفدت عدد مرات التنزيل (${e.download_limit}) — تواصل مع البائع`);
    const token = crypto.randomBytes(24).toString("base64url"), exp = new Date(clock().getTime() + Number(p.link_ttl_min) * 60e3).toISOString();
    await db.run("INSERT INTO digital_downloads(id,entitlement_id,file_id,buyer_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("dgd"), e.id, f.id, user.id, sha(token), exp, nowIso()]);
    return { url: `/api/digital/dl/${token}`, expiresAt: exp, downloadsLeft: Math.max(0, Number(e.download_limit) - Number(e.downloads) - 1), name: f.name };
  }
  async function download(req, res, token) {
    const d = await db.get("SELECT * FROM digital_downloads WHERE token_hash=$1", [sha(String(token || ""))]);
    if (!d || Date.parse(iso(d.expires_at)) < clock().getTime()) throw fail(410, "link_expired", "انتهت صلاحية رابط التنزيل — اطلب رابطاً جديداً من «مشترياتي»");
    if (!req.user || req.user.id !== d.buyer_id) throw fail(403, "not_owner", "الرابط خاص بحساب المشتري");
    const e = await db.get("SELECT * FROM digital_entitlements WHERE id=$1", [d.entitlement_id]), o = e && (await I().getOrder(e.order_id));
    if (!e || e.status !== "active" || !o || ["refunded", "cancelled"].includes(o.status)) throw fail(403, "revoked", "لم يعد هذا المنتج متاحاً للتنزيل");
    const f = await db.get("SELECT * FROM digital_files WHERE id=$1 AND blocked=0", [d.file_id]); if (!f) throw fail(410, "file_gone", "الملف غير متاح");
    await db.run("UPDATE digital_downloads SET fetched=fetched+1 WHERE id=$1", [d.id]);
    return stream(res, f);
  }
  async function refund(user, eid, b) {
    const e = await db.get("SELECT * FROM digital_entitlements WHERE id=$1", [String(eid).slice(0, 60)]);
    if (!e || e.buyer_id !== user.id) throw E.nf("غير موجود في مشترياتك");
    const o = await I().getOrder(e.order_id), p = await productRow(e.listing_id), esc = await db.get("SELECT * FROM market_escrow WHERE order_id=$1", [e.order_id]);
    const st = await refundState(e, p, o, esc);
    if (!st.allowed) throw fail(409, "refund_not_allowed", { downloaded: "نزّلت الملف، وسياسة هذا المنتج تسمح بالاسترداد قبل التنزيل فقط", window: "انتهت مدة الاسترداد", policy: "سياسة هذا المنتج لا تسمح بالاسترداد — يمكنك فتح نزاع إن لم يطابق الوصف", settled: "أُفرج عن المبلغ للبائع — افتح نزاعاً من صفحة الطلب", refunded: "استُرد المبلغ من قبل" }[st.reason] || "غير مسموح");
    const reason = str(b?.reason, 300) || "digital_refund";
    const n = await db.tx(async (t) => {
      const x = await I().transition(t, o, "refunded", ["paid_held", "delivered"], { refunded_at: nowIso(), cancelled_at: nowIso(), cancel_reason: reason, cancelled_by: user.id });
      if (!x) return null;
      if (!(await I().settle(t, x, "refund"))) throw new Error("escrow not held for " + o.id);
      await t.run("UPDATE digital_entitlements SET status='refunded', revoked_at=$1, revoke_reason='refund' WHERE id=$2", [nowIso(), e.id]);
      return x;
    });
    if (!n) throw fail(409, "invalid_state", "تغيّرت حالة الطلب، حدّث الصفحة");
    await I().recordPiRefund(user, n, "استرداد منتج رقمي حسب سياسة البائع");
    await I().systemMessage(n, "refunded", { actor: user.id });
    bus.emit("DIGITAL_REFUNDED", { order: o.id, listing: e.listing_id, buyer: user.id });
    return { ok: true, status: "refunded", note: "سُجّل الاسترداد؛ تُعاد عملة Pi إلى محفظتك من محفظة التطبيق" };
  }

  /* ======================= 5. seller stats + licenses ======================= */
  async function sales(user) {
    const products = await db.all("SELECT p.*, l.title, l.price, l.status AS listing_status FROM digital_products p JOIN market_listings l ON l.id=p.listing_id WHERE p.seller_id=$1 ORDER BY p.created_at DESC", [user.id]);
    const orders = await db.all("SELECT o.id, o.listing_id, o.total, o.fee, o.status, o.paid_at, o.created_at FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE o.seller_id=$1 AND l.kind='digital' AND o.paid_at IS NOT NULL", [user.id]);
    const ents = await db.all("SELECT listing_id, SUM(downloads) d FROM digital_entitlements WHERE seller_id=$1 GROUP BY listing_id", [user.id]);
    const since = clock().getTime() - 30 * DAY, days = {};
    for (let i = 29; i >= 0; i--) days[new Date(clock().getTime() - i * DAY).toISOString().slice(0, 10)] = { sales: 0, net: 0 };
    const per = new Map(products.map((p) => [p.listing_id, { sales: 0, gross: 0, net: 0, refunds: 0 }]));
    for (const o of orders) {
      const s = per.get(o.listing_id); if (!s) continue;
      if (o.status === "refunded") { s.refunds++; continue; }
      s.sales++; s.gross += Number(o.total); s.net += Number(o.total) - Number(o.fee);
      const t = Date.parse(iso(o.paid_at)); if (t >= since) { const k = iso(o.paid_at).slice(0, 10); if (days[k]) { days[k].sales++; days[k].net += Number(o.total) - Number(o.fee); } }
    }
    const items = products.map((p) => { const s = per.get(p.listing_id); return { listingId: p.listing_id, title: p.title, type: p.ptype, price: pi(p.price), status: p.status === "blocked" ? "blocked" : p.listing_status, sales: s.sales, gross: pi(s.gross), net: pi(s.net), refunds: s.refunds, downloads: Number(ents.find((x) => x.listing_id === p.listing_id)?.d || 0) }; });
    const tot = items.reduce((a, x) => ({ sales: a.sales + x.sales, net: a.net + x.net, refunds: a.refunds + x.refunds, downloads: a.downloads + x.downloads }), { sales: 0, net: 0, refunds: 0, downloads: 0 });
    return { items, totals: { ...tot, net: Math.round(tot.net * 1e7) / 1e7 }, series: Object.entries(days).map(([d, v]) => ({ day: d, sales: v.sales, net: pi(v.net) })), feePct: M().config.feePct, note: "صافي المبيعات بعد رسوم المنصة؛ يُفرج عنه من الضمان بعد التأكيد أو تلقائياً" };
  }
  async function licenses(user, q) {
    if (q.key) {
      const e = await db.get("SELECT e.*, l.title FROM digital_entitlements e JOIN market_listings l ON l.id=e.listing_id WHERE e.license_key=$1 AND e.seller_id=$2", [String(q.key).trim().toUpperCase().slice(0, 40), user.id]);
      return e ? { valid: e.status === "active", status: e.status, listingId: e.listing_id, title: e.title, grantedAt: iso(e.granted_at) } : { valid: false, status: "unknown" };
    }
    const lid = q.listingId ? String(q.listingId).slice(0, 100) : null;
    const rows = await db.all(`SELECT e.id, e.listing_id, e.license_key, e.status, e.granted_at, e.downloads, u.handle FROM digital_entitlements e JOIN users u ON u.id=e.buyer_id WHERE e.seller_id=$1 AND e.license_key IS NOT NULL ${lid ? "AND e.listing_id=$2" : ""} ORDER BY e.granted_at DESC LIMIT 500`, lid ? [user.id, lid] : [user.id]);
    return { items: rows.map((r) => ({ id: r.id, listingId: r.listing_id, key: r.license_key, status: r.status, buyer: r.handle, grantedAt: iso(r.granted_at), downloads: Number(r.downloads) })) };
  }

  /* ======================= 6. reports + moderation ======================= */
  async function report(user, lid, b) {
    if (!rl.hit("report", user.id)) throw E.rate();
    const p = await productRow(lid); if (!p) throw E.nf("المنتج غير موجود");
    if (!REASONS[b?.reason]) throw fail(400, "reason_invalid", "سبب البلاغ غير معروف");
    if (await db.get("SELECT 1 x FROM digital_reports WHERE listing_id=$1 AND reporter_id=$2 AND status='open'", [p.listing_id, user.id])) throw E.conflict("سبق أن أبلغت عن هذا المنتج");
    const details = str(b.details, 2000) || null, rid = id("rp"), did = id("dgr"), at = nowIso();
    await db.run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,'listing',$3,$4,'open',$5)", [rid, p.listing_id, ("منتج رقمي: " + REASONS[b.reason] + (details ? " — " + details : "")).slice(0, 200), user.id, at]);
    await db.run("INSERT INTO digital_reports(id,listing_id,reporter_id,reason,details,report_id,status,created_at) VALUES($1,$2,$3,$4,$5,$6,'open',$7)", [did, p.listing_id, user.id, b.reason, details, rid, at]);
    await ctx.audit?.("REPORT_CREATED", p.listing_id, "digital:" + b.reason, user.id);
    bus.emit("REPORT_CREATED", { report: rid, target: p.listing_id, actor: user.id });
    return { id: did, note: b.reason === "copyright" ? "سيراجع فريق الإشراف البلاغ؛ أرفق ما يثبت ملكيتك في التفاصيل إن أمكن" : "شكراً، سيراجع فريق الإشراف البلاغ" };
  }
  async function adminReports(q) {
    const st = ["open", "actioned", "dismissed"].includes(q.status) ? q.status : "open";
    const rows = await db.all("SELECT r.*, l.title, l.seller_id, u.handle AS reporter FROM digital_reports r JOIN market_listings l ON l.id=r.listing_id LEFT JOIN users u ON u.id=r.reporter_id WHERE r.status=$1 ORDER BY r.created_at DESC LIMIT 100", [st]);
    return { items: rows.map((r) => ({ id: r.id, listingId: r.listing_id, title: r.title, sellerId: r.seller_id, reporter: r.reporter, reason: r.reason, reasonLabel: REASONS[r.reason], details: r.details, status: r.status, resolution: r.resolution, createdAt: iso(r.created_at) })) };
  }
  async function resolve(by, rid, b) {
    const r = await db.get("SELECT * FROM digital_reports WHERE id=$1", [String(rid).slice(0, 60)]); if (!r) throw E.nf();
    if (r.status !== "open") throw E.conflict("حُسم البلاغ من قبل");
    const action = b?.action; if (!["takedown", "dismiss"].includes(action)) throw E.bad("الإجراء: takedown أو dismiss");
    const at = nowIso(), note = str(b.note, 300) || null;
    if (action === "takedown") {
      const p = await productRow(r.listing_id);
      await db.tx(async (t) => {
        await t.run("UPDATE digital_products SET status='blocked', blocked_reason=$1, updated_at=$2 WHERE listing_id=$3", [r.reason, at, r.listing_id]);
        await t.run("UPDATE market_listings SET status='removed', removed_at=COALESCE(removed_at,$1), removed_by=$2, updated_at=$1 WHERE id=$3", [at, by.id, r.listing_id]);
        for (const fid of [...parse(p?.files, []), ...(p?.preview_file ? [p.preview_file] : [])]) await t.run("UPDATE digital_files SET blocked=1 WHERE id=$1", [fid]);
        if (b.revoke) await t.run("UPDATE digital_entitlements SET status='revoked', revoked_at=$1, revoke_reason=$2 WHERE listing_id=$3 AND status='active'", [at, "takedown:" + r.reason, r.listing_id]);
        await t.run("UPDATE digital_reports SET status='actioned', resolution=$1, resolved_by=$2, resolved_at=$3 WHERE listing_id=$4 AND status='open'", ["takedown" + (b.revoke ? "+revoke" : ""), by.id, at, r.listing_id]);
        await t.run("UPDATE reports SET status='actioned', resolved_by=$1, resolved_at=$2 WHERE target=$3 AND status='open'", [by.id, at, r.listing_id]);
        await t.run("INSERT INTO decisions(id,target,user_id,action,reason,by_user,created_at) VALUES($1,$2,$3,'REMOVED',$4,$5,$6)", [id("dc"), r.listing_id, p?.seller_id || "", ("منتج رقمي: " + REASONS[r.reason]).slice(0, 200), by.id, at]);
      });
      await M().reindex(r.listing_id).catch(() => null);
      ctx.audit?.("DIGITAL_TAKEDOWN", r.listing_id, r.reason + (note ? ": " + note : ""), by.id);
    } else {
      await db.run("UPDATE digital_reports SET status='dismissed', resolution='dismiss', resolved_by=$1, resolved_at=$2 WHERE id=$3", [by.id, at, r.id]);
      if (r.report_id) await db.run("UPDATE reports SET status='dismissed', resolved_by=$1, resolved_at=$2 WHERE id=$3 AND status='open'", [by.id, at, r.report_id]);
      ctx.audit?.("DIGITAL_REPORT_DISMISSED", r.listing_id, note, by.id);
    }
    return { ok: true };
  }

  /* ======================= bus + routes ======================= */
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => logger.error?.("digital handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const settle = async () => { await M().settle(); for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); while (inflight.size) await Promise.all([...inflight]); } };
  bus.on("MARKET_ORDER_PAID", track(async (e) => deliver(e.order)));
  bus.on("USER_ANONYMISED", track(async (e) => { if (e?.user) await db.run("UPDATE digital_reports SET details=NULL WHERE reporter_id=$1", [e.user]); }));

  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  R.get("/api/digital/config", async () => ({ enabled: enabled(), ...(enabled() ? {} : { reason: "not_configured", note: OFF }), types: Object.entries(TYPES).map(([k, v]) => ({ key: k, label: v })),
    refundPolicies: Object.entries(POLICIES).map(([k, v]) => ({ key: k, label: v })), reportReasons: Object.entries(REASONS).map(([k, v]) => ({ key: k, label: v })),
    limits: { maxFileMb: Math.round(cfg.maxFile / MB), sellerMaxMb: Math.round(cfg.sellerMax / MB), maxFiles: cfg.maxFiles, downloadLimit: { min: 1, max: cfg.dlMax, default: cfg.dlDefault }, linkTtlMin: cfg.linkTtlMin }, feePct: M().config.feePct }));
  R.get("/api/digital/store", async (req) => store(req.user || null, req.query || {}));
  R.post("/api/digital/files", A(async (req) => upload(req.user, req)), { raw: true });
  R.get("/api/me/digital/files", A(async (req) => myFiles(req.user)));
  R.del("/api/digital/files/:id", A(async (req) => delFile(req.user, req.params.id)));
  R.post("/api/digital/products", A(async (req) => create(req.user, req.body)));
  R.get("/api/digital/products/:id", async (req) => read(req.user || null, req.params.id));
  R.patch("/api/digital/products/:id", A(async (req) => update(req.user, req.params.id, req.body)));
  R.get("/api/digital/products/:id/preview", async (req, res) => preview(req, res, req.params.id));
  R.post("/api/digital/products/:id/report", A(async (req) => report(req.user, req.params.id, req.body)));
  R.get("/api/me/digital/library", A(async (req) => library(req.user)));
  R.post("/api/digital/library/:id/link", A(async (req) => link(req.user, req.params.id, req.body)));
  R.post("/api/digital/library/:id/refund", A(async (req) => refund(req.user, req.params.id, req.body)));
  R.get("/api/digital/dl/:token", async (req, res) => download(req, res, req.params.token));
  R.get("/api/me/digital/sales", A(async (req) => sales(req.user)));
  R.get("/api/me/digital/licenses", A(async (req) => licenses(req.user, req.query || {})));
  R.get("/api/admin/digital/reports", admin(async (req) => adminReports(req.query || {})));
  R.post("/api/admin/digital/reports/:id/resolve", admin(async (req) => resolve(req.user, req.params.id, req.body)));

  return { enabled, deliver, settle, config: cfg, TYPES };
};
