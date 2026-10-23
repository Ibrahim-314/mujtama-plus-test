/* Creator ↔ brand collaborations and sponsorships «تعاونات ورعايات» (phase 63).
 *  1. Media kit: a creator opens their profile to offers (headline, categories, formats, an indicative rate in Pi) with
 *     live public stats (followers, posts in 90 days, average reactions / views, top topics). Brands browse open creators.
 *  2. Brands: any adult person or organisation account adds a brand profile (allowed categories only — gambling, alcohol,
 *     tobacco, weapons, adult content, get-rich schemes and unlicensed medicine are never offered). Staff can verify or
 *     suspend a brand.
 *  3. Campaigns: a brief with deliverables, fee, deadline and slots. A prohibited-terms check holds a campaign for staff
 *     review instead of publishing it. Creators apply with a pitch and a proposed fee.
 *  4. Deals: offer (brand → creator), application (creator → brand) or a creator ↔ creator collab. Counter-offers switch
 *     the turn; the other side accepts or declines; either side can cancel with a reason. Each deliverable gets a post of
 *     the creator's; the brand approves or asks for changes; all approved → completed. A private deal room keeps the
 *     thread and every event. Both sides mark «paid» / «received» — a record only: no Pi moves through this feature
 *     (Pi payments are off; no new payment channel).
 *  5. Disclosure (the rule this phase is built around): a post delivered in a deal is labelled automatically and the label
 *     is locked — «محتوى مدفوع · شراكة مع X» (sponsored), «هدية من X» (gifted), «رابط عمولة · X» (affiliate) or
 *     «تعاون مع X» (unpaid creator collab). Creators can also self-disclose any post. Anyone can report a post that looks
 *     like an undisclosed ad; staff label it or dismiss. A public library lists disclosed partnerships.
 *  6. Minors (phase 35): no media kit, no offers, no campaigns, no deals for under-18 accounts; no contact data is ever
 *     part of a media kit, brand page or offer — conversation stays in the deal room. */
const { E, str, oneOf, id } = require("../lib/core");

const CATEGORIES = { tech: "تقنية", education: "تعليم", food: "طعام ومطاعم", fashion: "أزياء", beauty: "عناية وجمال", travel: "سفر وسياحة", sports: "رياضة ولياقة", gaming: "ألعاب", family: "أسرة وأطفال", finance: "مال وأعمال", health: "صحة (موثّقة)", books: "كتب وثقافة", home: "منزل وديكور", auto: "سيارات", charity: "عمل خيري", pi: "مشاريع Pi", other: "أخرى" };
const FORMATS = { post: "منشور", article: "مقال", video: "فيديو", short: "فيديو قصير", story: "قصة", live: "بث مباشر", audio: "صوتي" };
const KINDS = { sponsored: "محتوى مدفوع", gifted: "هدية", affiliate: "رابط عمولة", collab: "تعاون بين صنّاع" };
const STATUSES = { proposed: "عرض قيد التفاوض", active: "اتفاق ساري", completed: "مكتمل", declined: "مرفوض", cancelled: "ملغى" };
/* terms that hold a campaign for staff review (never published automatically) */
const PROHIBITED = /(قمار|مراهن|كازينو|يانصيب|خمر|كحول|نبيذ|بيرة|تبغ|سجائر|فيب|شيشة|معسل|حشيش|مخدر|سلاح|أسلحة|ذخيرة|إباح|جنس|ربح سريع|اربح يوميا|مضاعفة (?:المال|الأرباح)|هرمي|بدون وصفة|casino|gambl|betting|\bbet\b|alcohol|beer|wine|vodka|tobacco|vape|cigar|weapon|porn|adult|forex signal|double your)/i;
const MAX_DELIVERABLES = 10;

/** @param {any} ctx @param {{ now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = () => new Date(clock()).toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const adult = async (user) => { if (await isMinor(user.id)) throw Object.assign(E.forbid("التعاونات والرعايات غير متاحة لمن هم دون ١٨ سنة"), { code: "minor_restricted" }); };
  const blocked = async (a, b) => { try { return !!(await ctx.services.tips?.blockedBetween?.(a, b)); } catch { return false; } };
  const listOf = (v, allowed, max = 6) => [...new Set((Array.isArray(v) ? v : String(v || "").split(",")).map((x) => String(x).trim()).filter((x) => allowed[x]))].slice(0, max);
  const pi = (v) => { if (v === undefined || v === null || v === "") return null; const n = Math.round(+v); if (!(n >= 0 && n <= 1e6)) throw E.bad("المبلغ غير صالح"); return n; };
  const userPub = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: !!u.verified } : null);
  async function users(ids) { const a = [...new Set(ids.filter(Boolean))]; return a.length ? db.all(`SELECT id, name, handle, color, avatar, verified FROM users WHERE id IN (${ph(a)})`, a) : []; }

  /* ---------- 1. media kit ---------- */
  async function stats(uid) {
    const since = new Date(clock() - 90 * 864e5).toISOString();
    const followers = Number((await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [uid]))?.n || 0);
    const posts = await db.all("SELECT id, views, topic FROM posts WHERE author=$1 AND status='published' AND visibility='public' AND type<>'story' AND created_at > $2 ORDER BY created_at DESC LIMIT 300", [uid, since]);
    const ids = posts.map((p) => p.id);
    const rx = ids.length ? Number((await db.get(`SELECT COUNT(*) n FROM reactions WHERE target IN (${ph(ids)})`, ids))?.n || 0) : 0;
    const topics = {}; for (const p of posts) if (p.topic) topics[p.topic] = (topics[p.topic] || 0) + 1;
    const partnerships = Number((await db.get("SELECT COUNT(*) n FROM post_partnerships WHERE creator_id=$1", [uid]))?.n || 0);
    const done = Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE creator_id=$1 AND status='completed'", [uid]))?.n || 0);
    return { followers, posts90: posts.length, avgReactions: posts.length ? Math.round((rx / posts.length) * 10) / 10 : 0, avgViews: posts.length ? Math.round(posts.reduce((t, p) => t + Number(p.views || 0), 0) / posts.length) : 0, topTopics: Object.entries(topics).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k), partnerships, completedDeals: done };
  }
  const kitClient = (p, u, st) => ({ user: userPub(u), open: !!Number(p?.open), headline: p?.headline || "", categories: parse(p?.categories, []).map((k) => ({ key: k, label: CATEGORIES[k] })), formats: parse(p?.formats, []).map((k) => ({ key: k, label: FORMATS[k] })), rateFrom: p?.rate_from ?? null, rateNote: p?.rate_note || "", languages: p?.languages || "", updatedAt: p?.updated_at || null, stats: st });
  async function myKit(user) {
    const p = await db.get("SELECT * FROM collab_profiles WHERE user_id=$1", [user.id]), u = await db.get("SELECT * FROM users WHERE id=$1", [user.id]);
    return { kit: kitClient(p, u, await stats(user.id)), minor: await isMinor(user.id), categories: CATEGORIES, formats: FORMATS };
  }
  async function saveKit(user, b = {}) {
    await adult(user);
    if (!rl.hit("default", "ckit:" + user.id)) throw E.rate();
    const open = b.open ? 1 : 0, cats = listOf(b.categories, CATEGORIES), fm = listOf(b.formats, FORMATS, 7);
    if (open && !cats.length) throw E.bad("اختر مجالاً واحداً على الأقل ليجدك المعلنون");
    await db.run("INSERT INTO collab_profiles(user_id,open,headline,categories,formats,rate_from,rate_note,languages,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (user_id) DO UPDATE SET open=$2, headline=$3, categories=$4, formats=$5, rate_from=$6, rate_note=$7, languages=$8, updated_at=$9",
      [user.id, open, str(b.headline, 140) || null, JSON.stringify(cats), JSON.stringify(fm), pi(b.rateFrom), str(b.rateNote, 200) || null, str(b.languages, 60) || null, iso()]);
    return myKit(user);
  }
  async function kit(handle) {
    const u = await db.get("SELECT * FROM users WHERE handle=$1 AND status='active'", [String(handle)]); if (!u) throw E.nf();
    const p = await db.get("SELECT * FROM collab_profiles WHERE user_id=$1 AND open=1", [u.id]);
    if (!p || u.private || (await isMinor(u.id))) throw E.nf("هذا الصانع لا يستقبل عروض تعاون حالياً");
    const recent = await db.all("SELECT pp.kind, pp.brand_name, pp.created_at FROM post_partnerships pp JOIN posts p ON p.id=pp.post_id WHERE pp.creator_id=$1 AND p.status='published' AND p.visibility='public' ORDER BY pp.created_at DESC LIMIT 6", [u.id]);
    return { kit: kitClient(p, u, await stats(u.id)), recent: recent.map((r) => ({ kind: r.kind, kindLabel: KINDS[r.kind], brand: r.brand_name, at: r.created_at })) };
  }
  async function creators(user, q = {}) {
    const rows = await db.all("SELECT p.*, u.name, u.handle, u.color, u.avatar, u.verified, u.private, u.status FROM collab_profiles p JOIN users u ON u.id=p.user_id WHERE p.open=1 AND u.status='active' ORDER BY p.updated_at DESC LIMIT 300");
    const text = String(q.q || "").trim().toLowerCase().slice(0, 60), cat = CATEGORIES[q.category] ? q.category : null, fm = FORMATS[q.format] ? q.format : null;
    const out = [];
    for (const r of rows) {
      if (r.private || r.user_id === user?.id) continue;
      const cats = parse(r.categories, []), fms = parse(r.formats, []);
      if (cat && !cats.includes(cat)) continue; if (fm && !fms.includes(fm)) continue;
      if (text && !`${r.name} ${r.handle} ${r.headline || ""}`.toLowerCase().includes(text)) continue;
      if (await isMinor(r.user_id)) continue;
      out.push(kitClient(r, { id: r.user_id, name: r.name, handle: r.handle, color: r.color, avatar: r.avatar, verified: r.verified }, await stats(r.user_id)));
      if (out.length >= 40) break;
    }
    return { creators: out.sort((a, b) => b.stats.followers - a.stats.followers), categories: CATEGORIES, formats: FORMATS };
  }

  /* ---------- 2. brands ---------- */
  const brandClient = (b, extra = {}) => (b ? { id: b.user_id, name: b.name, category: b.category, categoryLabel: CATEGORIES[b.category] || b.category, website: b.website || null, about: b.about || "", status: b.status, verified: !!Number(b.verified), since: b.created_at, ...extra } : null);
  async function brandOf(uid) { return db.get("SELECT * FROM collab_brands WHERE user_id=$1", [uid]); }
  async function saveBrand(user, b = {}) {
    await adult(user);
    if (!rl.hit("default", "cbrand:" + user.id)) throw E.rate();
    const name = str(b.name, 80, { required: true, min: 2 }), category = oneOf(b.category, Object.keys(CATEGORIES), null); if (!category) throw E.bad("اختر مجال العلامة");
    const website = str(b.website, 200); if (website && !/^https:\/\/[^\s<>"']+\.[^\s<>"']+$/i.test(website)) throw E.bad("الموقع يجب أن يبدأ بـ https://");
    const about = str(b.about, 600) || null;
    if (PROHIBITED.test(`${name} ${about || ""}`)) throw E.bad("هذا المجال غير مسموح للرعايات في مجتمع بلس");
    const had = await brandOf(user.id); if (had?.status === "suspended") throw E.forbid("العلامة موقوفة من فريق المنصة");
    await db.run("INSERT INTO collab_brands(user_id,name,category,website,about,status,verified,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'active',0,$6,$6) ON CONFLICT (user_id) DO UPDATE SET name=$2, category=$3, website=$4, about=$5, updated_at=$6", [user.id, name, category, website || null, about, iso()]);
    return { brand: brandClient(await brandOf(user.id)) };
  }
  async function brandPage(bid) {
    const b = await brandOf(String(bid)); if (!b || b.status !== "active") throw E.nf("العلامة غير موجودة");
    const camps = await db.all("SELECT * FROM collab_campaigns WHERE brand_id=$1 AND status='open' ORDER BY created_at DESC LIMIT 20", [b.user_id]);
    const done = Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE brand_id=$1 AND status='completed'", [b.user_id]))?.n || 0);
    const disclosed = Number((await db.get("SELECT COUNT(*) n FROM post_partnerships WHERE brand_id=$1", [b.user_id]))?.n || 0);
    const u = (await users([b.user_id]))[0];
    return { brand: brandClient(b, { account: userPub(u), completedDeals: done, disclosedPosts: disclosed }), campaigns: camps.map((c) => campClient(c)) };
  }

  /* ---------- 3. campaigns ---------- */
  function readDeliverables(v, prev = []) {
    const a = Array.isArray(v) ? v : []; if (!a.length) throw E.bad("أضف تسليماً واحداً على الأقل (منشور، فيديو…)"); if (a.length > MAX_DELIVERABLES) throw E.bad(`الحد الأقصى ${MAX_DELIVERABLES} تسليمات`);
    return a.map((x, i) => {
      const old = prev.find((p) => p.id === x?.id);
      const due = x?.due ? (isNaN(Date.parse(x.due)) ? null : new Date(Date.parse(x.due)).toISOString().slice(0, 10)) : null;
      return { id: old?.id || `d${i + 1}${Math.random().toString(36).slice(2, 6)}`, format: oneOf(x?.format, Object.keys(FORMATS), "post"), label: str(x?.label, 140, { required: true, min: 2 }), due, postId: old?.postId || null, status: old?.status || "pending", note: old?.note || null };
    });
  }
  const campClient = (c, extra = {}) => ({ id: c.id, brandId: c.brand_id, title: c.title, summary: c.summary, deliverables: parse(c.deliverables, []), categories: parse(c.categories, []).map((k) => ({ key: k, label: CATEGORIES[k] })), formats: parse(c.formats, []).map((k) => ({ key: k, label: FORMATS[k] })), fee: c.fee ?? null, feeNote: c.fee_note || "", deadline: c.deadline || null, slots: Number(c.slots), applications: Number(c.applications || 0), status: c.status, reviewNote: c.review_note || null, createdAt: c.created_at, href: `#/collabs/c/${c.id}`, ...extra });
  async function createCampaign(user, b = {}) {
    await adult(user);
    const br = await brandOf(user.id); if (!br) throw Object.assign(E.bad("أنشئ ملف العلامة التجارية أولاً"), { code: "no_brand" }); if (br.status !== "active") throw E.forbid("العلامة موقوفة");
    if (!rl.hit("default", "ccamp:" + user.id)) throw E.rate();
    const o = readCampaign(b);
    const held = PROHIBITED.test(`${o.title} ${o.summary} ${o.deliverables.map((d) => d.label).join(" ")}`);
    const cid = id("cc"), at = iso();
    await db.run("INSERT INTO collab_campaigns(id,brand_id,title,summary,deliverables,categories,formats,fee,fee_note,deadline,slots,status,review_note,applications,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$14)",
      [cid, user.id, o.title, o.summary, JSON.stringify(o.deliverables), JSON.stringify(o.categories), JSON.stringify(o.formats), o.fee, o.fee_note, o.deadline, o.slots, held ? "review" : "open", held ? "أُحيلت للمراجعة: الوصف يتضمن مجالاً قد يكون محظوراً" : null, at]);
    await ctx.audit?.("COLLAB_CAMPAIGN", cid, held ? "held" : "open", user.id);
    return campaign(user, cid);
  }
  function readCampaign(b, prev = {}) {
    const deadline = b.deadline ? Date.parse(b.deadline) : null; if (b.deadline && (isNaN(deadline) || deadline < clock() - 864e5)) throw E.bad("الموعد النهائي غير صالح");
    return { title: str(b.title ?? prev.title, 100, { required: true, min: 4 }), summary: str(b.summary ?? prev.summary, 3000, { required: true, min: 20 }), deliverables: readDeliverables(b.deliverables ?? parse(prev.deliverables, []), parse(prev.deliverables, [])),
      categories: listOf(b.categories ?? parse(prev.categories, []), CATEGORIES, 4), formats: listOf(b.formats ?? parse(prev.formats, []), FORMATS, 7), fee: b.fee !== undefined ? pi(b.fee) : prev.fee ?? null, fee_note: str(b.feeNote ?? prev.fee_note, 200) || null,
      deadline: deadline ? new Date(deadline).toISOString() : b.deadline === null ? null : prev.deadline || null, slots: Math.max(1, Math.min(100, Math.round(+(b.slots ?? prev.slots ?? 5)))) };
  }
  async function updateCampaign(user, cid, b = {}) {
    const c = await db.get("SELECT * FROM collab_campaigns WHERE id=$1", [cid]); if (!c || c.brand_id !== user.id || c.status === "removed") throw E.nf();
    if (b.status === "closed" || b.status === "open") {
      if (b.status === "open" && c.status !== "closed") throw E.bad("لا يمكن فتح الحملة من حالتها الحالية");
      await db.run("UPDATE collab_campaigns SET status=$1, updated_at=$2 WHERE id=$3", [b.status, iso(), cid]); return campaign(user, cid);
    }
    const o = readCampaign(b, c), held = PROHIBITED.test(`${o.title} ${o.summary} ${o.deliverables.map((d) => d.label).join(" ")}`);
    await db.run("UPDATE collab_campaigns SET title=$1, summary=$2, deliverables=$3, categories=$4, formats=$5, fee=$6, fee_note=$7, deadline=$8, slots=$9, status=$10, review_note=$11, updated_at=$12 WHERE id=$13",
      [o.title, o.summary, JSON.stringify(o.deliverables), JSON.stringify(o.categories), JSON.stringify(o.formats), o.fee, o.fee_note, o.deadline, o.slots, held ? "review" : c.status === "review" ? "review" : c.status, held ? "أُحيلت للمراجعة: الوصف يتضمن مجالاً قد يكون محظوراً" : c.review_note, iso(), cid]);
    return campaign(user, cid);
  }
  async function campaigns(user, q = {}) {
    const rows = await db.all("SELECT c.*, b.name bname, b.category bcat, b.verified bver FROM collab_campaigns c JOIN collab_brands b ON b.user_id=c.brand_id WHERE c.status='open' AND b.status='active' ORDER BY c.created_at DESC LIMIT 200");
    const text = String(q.q || "").trim().toLowerCase().slice(0, 60), cat = CATEGORIES[q.category] ? q.category : null, fm = FORMATS[q.format] ? q.format : null;
    const mine = user ? await db.all("SELECT campaign_id, id, status FROM collab_deals WHERE creator_id=$1 AND campaign_id IS NOT NULL", [user.id]) : [];
    const list = rows.filter((c) => (!cat || parse(c.categories, []).includes(cat)) && (!fm || parse(c.formats, []).includes(fm)) && (!text || `${c.title} ${c.summary} ${c.bname}`.toLowerCase().includes(text)) && (!c.deadline || Date.parse(c.deadline) > clock() - 864e5));
    const own = user ? await db.all("SELECT * FROM collab_campaigns WHERE brand_id=$1 AND status<>'removed' ORDER BY updated_at DESC LIMIT 50", [user.id]) : [];
    return { campaigns: list.slice(0, 60).map((c) => campClient(c, { brand: { id: c.brand_id, name: c.bname, category: c.bcat, categoryLabel: CATEGORIES[c.bcat], verified: !!Number(c.bver) }, applied: mine.find((m) => m.campaign_id === c.id) || null })), mine: own.map((c) => campClient(c)), categories: CATEGORIES, formats: FORMATS };
  }
  async function campaign(user, cid) {
    const c = await db.get("SELECT * FROM collab_campaigns WHERE id=$1 AND status<>'removed'", [String(cid)]); if (!c) throw E.nf("الحملة غير موجودة");
    const owner = user && c.brand_id === user.id;
    if (c.status !== "open" && !owner && user?.role !== "admin") throw E.nf("الحملة غير متاحة");
    const b = await brandOf(c.brand_id);
    const applied = user ? await db.get("SELECT id, status FROM collab_deals WHERE campaign_id=$1 AND creator_id=$2", [c.id, user.id]) : null;
    let applications = undefined;
    if (owner) { const ds = await db.all("SELECT * FROM collab_deals WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT 200", [c.id]); const us = await users(ds.map((d) => d.creator_id)); applications = ds.map((d) => ({ id: d.id, status: d.status, statusLabel: STATUSES[d.status], fee: Number(d.fee), creator: userPub(us.find((u) => u.id === d.creator_id)), at: d.created_at, turn: d.turn })); }
    const accepted = Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE campaign_id=$1 AND status IN ('active','completed')", [c.id]))?.n || 0);
    return { campaign: campClient(c, { brand: brandClient(b), accepted, full: accepted >= Number(c.slots) }), owner, applied, applications, me: { minor: user ? await isMinor(user.id) : false, hasKit: user ? !!(await db.get("SELECT 1 x FROM collab_profiles WHERE user_id=$1", [user.id])) : false } };
  }
  async function apply(user, cid, b = {}) {
    await adult(user);
    if (!rl.hit("default", "capply:" + user.id)) throw E.rate();
    const c = await db.get("SELECT * FROM collab_campaigns WHERE id=$1 AND status='open'", [cid]); if (!c) throw E.nf("الحملة غير متاحة");
    if (c.brand_id === user.id) throw E.bad("لا يمكنك التقدّم لحملتك");
    if (c.deadline && Date.parse(c.deadline) < clock()) throw E.bad("انتهى موعد التقديم");
    if (await db.get("SELECT 1 x FROM collab_deals WHERE campaign_id=$1 AND creator_id=$2", [c.id, user.id])) throw E.conflict("سبق أن تقدّمت لهذه الحملة");
    if (await blocked(user.id, c.brand_id)) throw E.forbid("لا يمكن التعاون مع هذا الحساب");
    const accepted = Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE campaign_id=$1 AND status IN ('active','completed')", [c.id]))?.n || 0);
    if (accepted >= Number(c.slots)) throw E.bad("اكتمل العدد المطلوب لهذه الحملة");
    const pitch = str(b.pitch, 1500, { required: true, min: 20 });
    const did = await newDeal({ campaign: c.id, brand: c.brand_id, creator: user.id, kind: "sponsored", title: c.title, summary: c.summary, deliverables: parse(c.deliverables, []).map((d) => ({ ...d, postId: null, status: "pending", note: null })), fee: b.fee !== undefined && b.fee !== "" ? pi(b.fee) : c.fee ?? 0, turn: "brand", initiator: user.id });
    await msg(did, user.id, "msg", pitch);
    await db.run("UPDATE collab_campaigns SET applications=applications+1 WHERE id=$1", [c.id]);
    await notify(c.brand_id, "collab_offer", did);
    return deal(user, did);
  }

  /* ---------- 4. deals ---------- */
  async function newDeal(o) {
    const did = id("cd"), at = iso();
    await db.run("INSERT INTO collab_deals(id,campaign_id,brand_id,creator_id,kind,title,summary,deliverables,fee,turn,initiator,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'proposed',$12,$12)",
      [did, o.campaign || null, o.brand, o.creator, o.kind, o.title, o.summary || null, JSON.stringify(o.deliverables), o.fee || 0, o.turn, o.initiator, at]);
    await msg(did, null, "event", o.campaign ? "تقدّم الصانع للحملة" : o.kind === "collab" ? "أُرسلت دعوة تعاون" : "أُرسل عرض تعاون");
    await ctx.audit?.("COLLAB_DEAL", did, o.kind, o.initiator);
    return did;
  }
  async function msg(did, author, kind, body) { await db.run("INSERT INTO collab_messages(id,deal_id,author,kind,body,at) VALUES($1,$2,$3,$4,$5,$6)", [id("cm"), did, author, kind, String(body).slice(0, 2000), iso()]); await db.run("UPDATE collab_deals SET updated_at=$1 WHERE id=$2", [iso(), did]); }
  async function offer(user, b = {}) {
    await adult(user);
    if (!rl.hit("default", "coffer:" + user.id)) throw E.rate();
    const kind = oneOf(b.kind, Object.keys(KINDS), "sponsored");
    const target = await db.get("SELECT * FROM users WHERE handle=$1 AND status='active'", [String(b.creator || "").replace(/^@/, "")]); if (!target) throw E.nf("الصانع غير موجود");
    if (target.id === user.id) throw E.bad("لا يمكنك إرسال عرض لنفسك");
    if (await isMinor(target.id)) throw E.nf("هذا الصانع لا يستقبل عروض تعاون حالياً");
    const kitRow = await db.get("SELECT open FROM collab_profiles WHERE user_id=$1", [target.id]); if (!kitRow || !Number(kitRow.open)) throw E.bad("هذا الصانع لا يستقبل عروض تعاون حالياً");
    if (await blocked(user.id, target.id)) throw E.forbid("لا يمكن التعاون مع هذا الحساب");
    if (kind !== "collab") { const br = await brandOf(user.id); if (!br) throw Object.assign(E.bad("أنشئ ملف العلامة التجارية أولاً"), { code: "no_brand" }); if (br.status !== "active") throw E.forbid("العلامة موقوفة"); }
    const fee = kind === "collab" ? 0 : pi(b.fee) ?? 0;
    if (kind === "collab" && b.fee && +b.fee > 0) throw E.bad("التعاون بين الصنّاع بلا مقابل؛ اختر «محتوى مدفوع» إن كان هناك مبلغ");
    let camp = null; if (b.campaignId) { camp = await db.get("SELECT id FROM collab_campaigns WHERE id=$1 AND brand_id=$2 AND status IN ('open','closed')", [String(b.campaignId), user.id]); if (!camp) throw E.bad("الحملة غير موجودة"); }
    const open = await db.get("SELECT id FROM collab_deals WHERE brand_id=$1 AND creator_id=$2 AND status='proposed'", [user.id, target.id]); if (open) throw Object.assign(E.conflict("لديك عرض مفتوح مع هذا الصانع بالفعل"), { code: "open_deal", details: { id: open.id } });
    const summary = str(b.summary, 3000, { required: true, min: 20 });
    if (PROHIBITED.test(`${b.title || ""} ${summary}`)) throw E.bad("مجال العرض غير مسموح للرعايات في مجتمع بلس");
    const did = await newDeal({ campaign: camp?.id, brand: user.id, creator: target.id, kind, title: str(b.title, 100, { required: true, min: 4 }), summary, deliverables: readDeliverables(b.deliverables), fee, turn: "creator", initiator: user.id });
    if (b.message) await msg(did, user.id, "msg", str(b.message, 1500));
    await notify(target.id, "collab_offer", did);
    return deal(user, did);
  }
  async function loadDeal(user, did) {
    const d = await db.get("SELECT * FROM collab_deals WHERE id=$1", [String(did)]); if (!d) throw E.nf("الاتفاق غير موجود");
    const side = d.brand_id === user.id ? "brand" : d.creator_id === user.id ? "creator" : user.role === "admin" ? "staff" : null;
    if (!side) throw E.nf("الاتفاق غير موجود");
    d.dl = parse(d.deliverables, []); d.side = side; d.other = side === "brand" ? d.creator_id : d.brand_id; return d;
  }
  const PART = { brand: "العلامة", creator: "الصانع" };
  async function deal(user, did) {
    const d = await loadDeal(user, did);
    const us = await users([d.brand_id, d.creator_id]), br = d.kind === "collab" ? null : await brandOf(d.brand_id);
    const ms = await db.all("SELECT * FROM collab_messages WHERE deal_id=$1 ORDER BY at LIMIT 500", [d.id]);
    const postIds = d.dl.map((x) => x.postId).filter(Boolean);
    const posts = postIds.length ? await db.all(`SELECT id, title, text, type, status, created_at FROM posts WHERE id IN (${ph(postIds)})`, postIds) : [];
    const camp = d.campaign_id ? await db.get("SELECT id, title FROM collab_campaigns WHERE id=$1", [d.campaign_id]) : null;
    return { deal: { id: d.id, kind: d.kind, kindLabel: KINDS[d.kind], title: d.title, summary: d.summary || "", fee: Number(d.fee), status: d.status, statusLabel: STATUSES[d.status], turn: d.turn, initiator: d.initiator, createdAt: d.created_at, updatedAt: d.updated_at, acceptedAt: d.accepted_at || null, completedAt: d.completed_at || null, endReason: d.end_reason || null,
      paid: { brand: !!Number(d.paid_brand), creator: !!Number(d.paid_creator) }, campaign: camp ? { id: camp.id, title: camp.title } : null,
      brand: { ...userPub(us.find((u) => u.id === d.brand_id)), brandName: br?.name || null, verified: !!Number(br?.verified) }, creator: userPub(us.find((u) => u.id === d.creator_id)),
      deliverables: d.dl.map((x) => { const p = posts.find((pp) => pp.id === x.postId); return { ...x, formatLabel: FORMATS[x.format], post: p ? { id: p.id, title: p.title || String(p.text || "").slice(0, 80), status: p.status } : null }; }),
      label: labelFor(d.kind, br?.name || us.find((u) => u.id === d.brand_id)?.name) },
      side: d.side, myTurn: d.status === "proposed" && d.turn === d.side, messages: ms.map((m) => ({ id: m.id, kind: m.kind, body: m.body, at: m.at, author: m.author, mine: m.author === user.id, who: m.author ? (m.author === d.brand_id ? PART.brand : PART.creator) : null })) };
  }
  const labelFor = (kind, name) => (kind === "sponsored" ? `محتوى مدفوع · شراكة مع ${name}` : kind === "gifted" ? `هدية من ${name} · إفصاح` : kind === "affiliate" ? `رابط عمولة · ${name}` : `تعاون مع ${name}`);
  async function deals(user, q = {}) {
    const rows = await db.all("SELECT * FROM collab_deals WHERE brand_id=$1 OR creator_id=$1 ORDER BY updated_at DESC LIMIT 200", [user.id]);
    const us = await users(rows.flatMap((d) => [d.brand_id, d.creator_id])), brs = rows.length ? await db.all(`SELECT user_id, name FROM collab_brands WHERE user_id IN (${ph([...new Set(rows.map((d) => d.brand_id))])})`, [...new Set(rows.map((d) => d.brand_id))]) : [];
    const pick = (d) => { const side = d.brand_id === user.id ? "brand" : "creator", other = side === "brand" ? d.creator_id : d.brand_id, dl = parse(d.deliverables, []);
      return { id: d.id, kind: d.kind, kindLabel: KINDS[d.kind], title: d.title, fee: Number(d.fee), status: d.status, statusLabel: STATUSES[d.status], side, myTurn: d.status === "proposed" && d.turn === side, updatedAt: d.updated_at,
        other: { ...userPub(us.find((u) => u.id === other)), brandName: side === "creator" && d.kind !== "collab" ? brs.find((b) => b.user_id === other)?.name || null : null }, progress: { done: dl.filter((x) => x.status === "approved").length, total: dl.length } }; };
    const all = rows.map(pick), tab = q.tab || "all";
    const f = tab === "action" ? all.filter((d) => d.myTurn || (d.status === "active" && ((d.side === "brand" && rows.find((r) => r.id === d.id) && parse(rows.find((r) => r.id === d.id).deliverables, []).some((x) => x.status === "submitted")) || (d.side === "creator" && d.progress.done < d.progress.total)))) : tab === "active" ? all.filter((d) => d.status === "active") : tab === "done" ? all.filter((d) => ["completed", "declined", "cancelled"].includes(d.status)) : all;
    return { deals: f, counts: { all: all.length, active: all.filter((d) => d.status === "active").length, proposed: all.filter((d) => d.status === "proposed").length, myTurn: all.filter((d) => d.myTurn).length }, brand: brandClient(await brandOf(user.id)), minor: await isMinor(user.id) };
  }
  async function counter(user, did, b = {}) {
    const d = await loadDeal(user, did); if (d.side === "staff") throw E.forbid();
    if (d.status !== "proposed") throw E.bad("التفاوض متاح قبل القبول فقط"); if (d.turn !== d.side) throw E.bad("بانتظار رد الطرف الآخر");
    const set = { turn: d.side === "brand" ? "creator" : "brand" }, what = [];
    if (b.fee !== undefined) { if (d.kind === "collab" && +b.fee > 0) throw E.bad("التعاون بين الصنّاع بلا مقابل"); set.fee = pi(b.fee) ?? 0; if (set.fee !== Number(d.fee)) what.push(`المبلغ ${set.fee} Pi`); }
    if (b.deliverables !== undefined) { set.deliverables = JSON.stringify(readDeliverables(b.deliverables, d.dl)); what.push("التسليمات"); }
    if (b.summary !== undefined) { set.summary = str(b.summary, 3000, { required: true, min: 20 }); what.push("التفاصيل"); }
    const keys = Object.keys(set);
    await db.run(`UPDATE collab_deals SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => set[k]), iso(), d.id]);
    await msg(d.id, null, "event", `${PART[d.side]} اقترح تعديلاً${what.length ? ": " + what.join("، ") : ""}`);
    if (b.message) await msg(d.id, user.id, "msg", str(b.message, 1500));
    await notify(d.other, "collab_update", d.id);
    return deal(user, d.id);
  }
  async function decide(user, did, action, b = {}) {
    const d = await loadDeal(user, did); if (d.side === "staff") throw E.forbid();
    if (action === "accept" || action === "decline") {
      if (d.status !== "proposed") throw E.bad("لا يوجد عرض بانتظار ردك"); if (d.turn !== d.side) throw E.bad("بانتظار رد الطرف الآخر");
      if (action === "accept") {
        if (await isMinor(d.creator_id)) throw E.forbid("غير متاح لمن هم دون ١٨ سنة");
        if (d.campaign_id) { const c = await db.get("SELECT slots FROM collab_campaigns WHERE id=$1", [d.campaign_id]); const n = Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE campaign_id=$1 AND status IN ('active','completed')", [d.campaign_id]))?.n || 0); if (c && n >= Number(c.slots)) throw E.bad("اكتمل عدد الصنّاع في هذه الحملة"); }
        await db.run("UPDATE collab_deals SET status='active', accepted_at=$1, updated_at=$1 WHERE id=$2 AND status='proposed'", [iso(), d.id]);
        await msg(d.id, null, "event", `${PART[d.side]} قبل الاتفاق — يبدأ التنفيذ الآن`);
      } else {
        await db.run("UPDATE collab_deals SET status='declined', end_reason=$1, updated_at=$2 WHERE id=$3", [str(b.reason, 300) || null, iso(), d.id]);
        await msg(d.id, null, "event", `${PART[d.side]} اعتذر عن العرض${b.reason ? ": " + str(b.reason, 300) : ""}`);
      }
    } else if (action === "cancel") {
      if (!["proposed", "active"].includes(d.status)) throw E.bad("لا يمكن إلغاء هذا الاتفاق");
      if (d.status === "proposed" && d.initiator !== user.id) throw E.bad("اعتذر عن العرض بدلاً من الإلغاء");
      const reason = str(b.reason, 300, { required: d.status === "active", min: 3 });
      await db.run("UPDATE collab_deals SET status='cancelled', end_reason=$1, updated_at=$2 WHERE id=$3", [reason || null, iso(), d.id]);
      await msg(d.id, null, "event", `${PART[d.side]} ألغى الاتفاق${reason ? ": " + reason : ""} — تبقى المنشورات المسلَّمة موسومة بالإفصاح`);
    } else if (action === "paid") {
      if (!["active", "completed"].includes(d.status)) throw E.bad("الاتفاق غير ساري"); if (d.kind === "collab" || !Number(d.fee)) throw E.bad("لا يوجد مبلغ في هذا الاتفاق");
      await db.run(`UPDATE collab_deals SET ${d.side === "brand" ? "paid_brand" : "paid_creator"}=1, updated_at=$1 WHERE id=$2`, [iso(), d.id]);
      await msg(d.id, null, "event", d.side === "brand" ? `سجّلت العلامة أنها دفعت ${d.fee} Pi (تسجيل فقط — لا يمر الدفع عبر المنصة)` : "أكّد الصانع استلام المبلغ ✓");
    } else throw E.bad();
    await notify(d.other, "collab_update", d.id);
    return deal(user, d.id);
  }
  async function say(user, did, b = {}) {
    const d = await loadDeal(user, did); if (d.side === "staff") throw E.forbid();
    if (!rl.hit("default", "cmsg:" + user.id)) throw E.rate();
    if (["declined", "cancelled"].includes(d.status)) throw E.bad("انتهى هذا الاتفاق");
    await msg(d.id, user.id, "msg", str(b.body, 1500, { required: true, min: 1 }));
    await notify(d.other, "collab_message", d.id);
    return deal(user, d.id);
  }
  async function deliver(user, did, b = {}) {
    const d = await loadDeal(user, did); if (d.side !== "creator") throw E.forbid("يسلّم الصانع فقط");
    if (d.status !== "active") throw E.bad("الاتفاق غير ساري");
    const item = d.dl.find((x) => x.id === b.deliverableId); if (!item) throw E.nf("التسليم غير موجود"); if (item.status === "approved") throw E.bad("اعتُمد هذا التسليم");
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND status IN ('published','scheduled')", [String(b.postId || ""), user.id]); if (!p) throw E.bad("اختر منشوراً من منشوراتك");
    const used = d.dl.find((x) => x.postId === p.id && x.id !== item.id); if (used) throw E.bad("هذا المنشور مسلَّم لبند آخر");
    const other = await db.get("SELECT deal_id FROM post_partnerships WHERE post_id=$1", [p.id]); if (other?.deal_id && other.deal_id !== d.id) throw E.bad("هذا المنشور مرتبط باتفاق آخر");
    const br = d.kind === "collab" ? null : await brandOf(d.brand_id), bu = (await users([d.brand_id]))[0];
    await disclose(p, { creator: user.id, deal: d.id, brand: d.brand_id, name: br?.name || bu?.name || "علامة", handle: bu?.handle, kind: d.kind, locked: 1, source: "deal" });
    item.postId = p.id; item.status = "submitted"; item.note = null;
    await db.run("UPDATE collab_deals SET deliverables=$1, updated_at=$2 WHERE id=$3", [JSON.stringify(d.dl), iso(), d.id]);
    await msg(d.id, null, "event", `سلّم الصانع «${item.label}» — وُسم المنشور تلقائياً: ${labelFor(d.kind, br?.name || bu?.name)}`);
    await notify(d.brand_id, "collab_deliverable", d.id);
    return deal(user, d.id);
  }
  async function review(user, did, b = {}) {
    const d = await loadDeal(user, did); if (d.side !== "brand") throw E.forbid("تعتمد العلامة التسليمات");
    if (d.status !== "active") throw E.bad("الاتفاق غير ساري");
    const item = d.dl.find((x) => x.id === b.deliverableId); if (!item || item.status !== "submitted") throw E.bad("لا يوجد تسليم بانتظار المراجعة");
    const ok = b.decision === "approve"; item.status = ok ? "approved" : "changes"; item.note = ok ? null : str(b.note, 400, { required: true, min: 3 });
    const all = d.dl.every((x) => x.status === "approved");
    await db.run(`UPDATE collab_deals SET deliverables=$1, updated_at=$2${all ? ", status='completed', completed_at=$2" : ""} WHERE id=$3`, [JSON.stringify(d.dl), iso(), d.id]);
    await msg(d.id, null, "event", ok ? `اعتمدت العلامة «${item.label}»${all ? " — اكتمل الاتفاق" : ""}` : `طلبت العلامة تعديلاً على «${item.label}»: ${item.note}`);
    await notify(d.creator_id, "collab_update", d.id);
    return deal(user, d.id);
  }
  async function report(user, did) {
    const d = await loadDeal(user, did);
    const ids = d.dl.map((x) => x.postId).filter(Boolean);
    const posts = ids.length ? await db.all(`SELECT id, title, text, views, created_at, status FROM posts WHERE id IN (${ph(ids)})`, ids) : [];
    const rx = ids.length ? await db.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${ph(ids)}) GROUP BY target`, ids) : [];
    const cm = ids.length ? await db.all(`SELECT post, COUNT(*) n FROM comments WHERE status='published' AND post IN (${ph(ids)}) GROUP BY post`, ids) : [];
    const rp = ids.length ? await db.all(`SELECT repost_of t, COUNT(*) n FROM posts WHERE status='published' AND repost_of IN (${ph(ids)}) GROUP BY repost_of`, ids).catch(() => []) : [];
    const rows = d.dl.filter((x) => x.postId).map((x) => { const p = posts.find((pp) => pp.id === x.postId) || {}; return { deliverable: x.label, postId: x.postId, title: p.title || String(p.text || "").slice(0, 80), status: p.status, views: Number(p.views || 0), reactions: Number(rx.find((r) => r.target === x.postId)?.n || 0), comments: Number(cm.find((r) => r.post === x.postId)?.n || 0), reposts: Number(rp.find((r) => r.t === x.postId)?.n || 0), at: p.created_at }; });
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    return { totals: { posts: rows.length, views: sum("views"), reactions: sum("reactions"), comments: sum("comments"), reposts: sum("reposts"), engagement: sum("views") ? Math.round(((sum("reactions") + sum("comments") + sum("reposts")) / sum("views")) * 1000) / 10 : null }, posts: rows };
  }

  /* ---------- 5. disclosure ---------- */
  async function disclose(p, o) {
    await db.run("INSERT INTO post_partnerships(post_id,creator_id,deal_id,brand_id,brand_name,kind,locked,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (post_id) DO UPDATE SET deal_id=$3, brand_id=$4, brand_name=$5, kind=$6, locked=$7, source=$8",
      [p.id, o.creator, o.deal || null, o.brand || null, o.name, o.kind, o.locked ? 1 : 0, o.source || "self", iso()]);
    const data = parse(p.data, {}) || {};
    await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...data, partner: { kind: o.kind, name: o.name, handle: o.handle || null, brand: o.brand || null, paid: o.kind !== "collab", label: labelFor(o.kind, o.name) } }, p.id]);
    ctx.bus?.emit?.("POST_UPDATED", { post: p.id, actor: o.creator });
  }
  async function selfDisclose(user, pid, b = {}) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND status<>'deleted'", [pid, user.id]); if (!p) throw E.nf("المنشور غير موجود");
    const had = await db.get("SELECT * FROM post_partnerships WHERE post_id=$1", [pid]);
    if (had && Number(had.locked)) throw E.bad("الإفصاح مرتبط باتفاق ولا يمكن تغييره");
    const kind = oneOf(b.kind, ["sponsored", "gifted", "affiliate"], null); if (!kind) throw E.bad("اختر نوع الإفصاح");
    let brand = null, name = str(b.brand, 80, { required: true, min: 2 });
    const bu = await db.get("SELECT user_id, name FROM collab_brands WHERE LOWER(name)=LOWER($1) AND status='active'", [name]).catch(() => null); if (bu) { brand = bu.user_id; name = bu.name; }
    await disclose(p, { creator: user.id, brand, name, kind, locked: 0, source: "self" });
    return { partner: { kind, name, label: labelFor(kind, name) } };
  }
  async function undisclose(user, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2", [pid, user.id]); if (!p) throw E.nf();
    const had = await db.get("SELECT * FROM post_partnerships WHERE post_id=$1", [pid]); if (!had) return { ok: true };
    if (Number(had.locked)) throw E.bad("الإفصاح مرتبط باتفاق أو قرار من فريق المنصة ولا يمكن إزالته");
    await db.run("DELETE FROM post_partnerships WHERE post_id=$1", [pid]);
    const data = parse(p.data, {}) || {}; delete data.partner; await db.run("UPDATE posts SET data=$1 WHERE id=$2", [data, pid]);
    return { ok: true };
  }
  async function library(user, q = {}) {
    const args = [], where = ["p.status='published'", "p.visibility='public'"];
    if (q.brand) { args.push(String(q.brand)); where.push(`pp.brand_id=$${args.length}`); }
    if (q.kind && KINDS[q.kind]) { args.push(q.kind); where.push(`pp.kind=$${args.length}`); }
    const rows = await db.all(`SELECT p.*, pp.kind pkind, pp.brand_name, pp.brand_id, pp.source, pp.created_at pat FROM post_partnerships pp JOIN posts p ON p.id=pp.post_id WHERE ${where.join(" AND ")} ORDER BY pp.created_at DESC LIMIT 120`, args);
    const vis = rows.length ? await ctx.services.content.filterVisible(rows, user?.id || null) : [];
    const us = await users(vis.map((p) => p.author));
    const counts = await db.all("SELECT kind, COUNT(*) n FROM post_partnerships GROUP BY kind").catch(() => []);
    return { items: vis.slice(0, 60).map((p) => ({ postId: p.id, kind: p.pkind, kindLabel: KINDS[p.pkind], brand: p.brand_name, brandId: p.brand_id || null, source: p.source, creator: userPub(us.find((u) => u.id === p.author)), excerpt: (p.title || String(p.text || "")).replace(/\s+/g, " ").slice(0, 140), at: p.pat })), counts: Object.fromEntries(counts.map((c) => [c.kind, Number(c.n)])), kinds: KINDS };
  }
  async function reportPost(user, pid, b = {}) {
    if (!rl.hit("report", user.id)) throw E.rate();
    const p = await db.get("SELECT id, author FROM posts WHERE id=$1 AND status='published'", [pid]); if (!p) throw E.nf();
    if (p.author === user.id) throw E.bad("أضف الإفصاح بنفسك من قائمة المنشور");
    if (await db.get("SELECT 1 x FROM post_partnerships WHERE post_id=$1", [pid])) throw E.bad("هذا المنشور عليه إفصاح بالفعل");
    const r = await db.run("INSERT INTO collab_reports(id,post_id,by_user,note,brand,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT DO NOTHING", [id("cr"), pid, user.id, str(b.note, 300) || null, str(b.brand, 80) || null, iso()]);
    if (!r.changes) throw E.conflict("سبق أن أبلغت عن هذا المنشور");
    return { ok: true };
  }

  /* ---------- staff ---------- */
  async function adminView() {
    const held = await db.all("SELECT c.*, b.name bname FROM collab_campaigns c LEFT JOIN collab_brands b ON b.user_id=c.brand_id WHERE c.status='review' ORDER BY c.created_at LIMIT 100");
    const reps = await db.all("SELECT r.post_id, COUNT(*) n, MIN(r.created_at) first, MAX(r.brand) brand, MAX(r.note) note FROM collab_reports r WHERE r.status='open' GROUP BY r.post_id ORDER BY n DESC LIMIT 100");
    const posts = reps.length ? await db.all(`SELECT p.id, p.title, p.text, p.author, u.name, u.handle FROM posts p JOIN users u ON u.id=p.author WHERE p.id IN (${ph(reps.map((r) => r.post_id))})`, reps.map((r) => r.post_id)) : [];
    const brands = await db.all("SELECT b.*, (SELECT COUNT(*) FROM collab_deals d WHERE d.brand_id=b.user_id) deals FROM collab_brands b ORDER BY b.created_at DESC LIMIT 200");
    const totals = { deals: Number((await db.get("SELECT COUNT(*) n FROM collab_deals"))?.n || 0), active: Number((await db.get("SELECT COUNT(*) n FROM collab_deals WHERE status='active'"))?.n || 0), disclosed: Number((await db.get("SELECT COUNT(*) n FROM post_partnerships"))?.n || 0), openKits: Number((await db.get("SELECT COUNT(*) n FROM collab_profiles WHERE open=1"))?.n || 0) };
    return { totals, held: held.map((c) => campClient(c, { brand: { id: c.brand_id, name: c.bname } })), reports: reps.map((r) => { const p = posts.find((x) => x.id === r.post_id) || {}; return { postId: r.post_id, count: Number(r.n), first: r.first, brand: r.brand || null, note: r.note || null, excerpt: (p.title || String(p.text || "")).slice(0, 140), author: { name: p.name, handle: p.handle } }; }), brands: brands.map((b) => brandClient(b, { deals: Number(b.deals) })), kinds: KINDS };
  }
  async function decideCampaign(user, cid, b = {}) {
    const c = await db.get("SELECT * FROM collab_campaigns WHERE id=$1", [cid]); if (!c) throw E.nf();
    const ok = b.decision === "approve";
    await db.run("UPDATE collab_campaigns SET status=$1, review_note=$2, updated_at=$3 WHERE id=$4", [ok ? "open" : "removed", ok ? null : str(b.note, 300) || "خالفت سياسة الرعايات", iso(), cid]);
    await ctx.audit?.(ok ? "COLLAB_CAMPAIGN_APPROVED" : "COLLAB_CAMPAIGN_REMOVED", cid, b.note || null, user.id);
    await notify(c.brand_id, "collab_campaign", cid);
    return adminView();
  }
  async function decideReport(user, pid, b = {}) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p) throw E.nf();
    if (b.decision === "label") {
      const kind = oneOf(b.kind, ["sponsored", "gifted", "affiliate"], "sponsored"), name = str(b.brand, 80, { required: true, min: 2 });
      await disclose(p, { creator: p.author, kind, name, locked: 1, source: "staff" });
      await notify(p.author, "collab_labelled", pid);
    }
    await db.run("UPDATE collab_reports SET status=$1, resolved_by=$2, resolved_at=$3 WHERE post_id=$4 AND status='open'", [b.decision === "label" ? "labelled" : "dismissed", user.id, iso(), pid]);
    await ctx.audit?.(b.decision === "label" ? "COLLAB_LABELLED" : "COLLAB_REPORT_DISMISSED", pid, b.brand || null, user.id);
    return adminView();
  }
  async function decideBrand(user, bid, b = {}) {
    const br = await brandOf(bid); if (!br) throw E.nf();
    const set = {}; if (b.status) set.status = oneOf(b.status, ["active", "suspended"], br.status); if (b.verified !== undefined) set.verified = b.verified ? 1 : 0;
    const keys = Object.keys(set); if (!keys.length) throw E.bad();
    await db.run(`UPDATE collab_brands SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE user_id=$${keys.length + 2}`, [...keys.map((k) => set[k]), iso(), bid]);
    if (set.status === "suspended") await db.run("UPDATE collab_campaigns SET status='closed', updated_at=$1 WHERE brand_id=$2 AND status IN ('open','review')", [iso(), bid]);
    await ctx.audit?.("COLLAB_BRAND", bid, JSON.stringify(set), user.id);
    return adminView();
  }

  /* ---------- routes ---------- */
  R.get("/api/collabs/kit", A(async (req) => myKit(req.user)));
  R.put("/api/collabs/kit", A(async (req) => saveKit(req.user, req.body || {})));
  R.get("/api/collabs/kits/:handle", async (req) => kit(req.params.handle));
  R.get("/api/collabs/creators", A(async (req) => creators(req.user, req.query)));
  R.get("/api/collabs/brand", A(async (req) => ({ brand: brandClient(await brandOf(req.user.id)), categories: CATEGORIES, minor: await isMinor(req.user.id) })));
  R.put("/api/collabs/brand", A(async (req) => saveBrand(req.user, req.body || {})));
  R.get("/api/collabs/brands/:id", async (req) => brandPage(req.params.id));
  R.get("/api/collabs/campaigns", A(async (req) => campaigns(req.user, req.query)));
  R.post("/api/collabs/campaigns", A(async (req) => createCampaign(req.user, req.body || {})));
  R.get("/api/collabs/campaigns/:id", A(async (req) => campaign(req.user, req.params.id)));
  R.patch("/api/collabs/campaigns/:id", A(async (req) => updateCampaign(req.user, req.params.id, req.body || {})));
  R.post("/api/collabs/campaigns/:id/apply", A(async (req) => apply(req.user, req.params.id, req.body || {})));
  R.post("/api/collabs/offers", A(async (req) => offer(req.user, req.body || {})));
  R.get("/api/collabs/deals", A(async (req) => deals(req.user, req.query)));
  R.get("/api/collab-deals/:id", A(async (req) => deal(req.user, req.params.id)));
  R.post("/api/collab-deals/:id/counter", A(async (req) => counter(req.user, req.params.id, req.body || {})));
  R.post("/api/collab-deals/:id/accept", A(async (req) => decide(req.user, req.params.id, "accept", req.body || {})));
  R.post("/api/collab-deals/:id/decline", A(async (req) => decide(req.user, req.params.id, "decline", req.body || {})));
  R.post("/api/collab-deals/:id/cancel", A(async (req) => decide(req.user, req.params.id, "cancel", req.body || {})));
  R.post("/api/collab-deals/:id/paid", A(async (req) => decide(req.user, req.params.id, "paid", req.body || {})));
  R.post("/api/collab-deals/:id/messages", A(async (req) => say(req.user, req.params.id, req.body || {})));
  R.post("/api/collab-deals/:id/deliver", A(async (req) => deliver(req.user, req.params.id, req.body || {})));
  R.post("/api/collab-deals/:id/review", A(async (req) => review(req.user, req.params.id, req.body || {})));
  R.get("/api/collab-deals/:id/report", A(async (req) => report(req.user, req.params.id)));
  R.put("/api/posts/:id/partnership", A(async (req) => selfDisclose(req.user, req.params.id, req.body || {})));
  R.del("/api/posts/:id/partnership", A(async (req) => undisclose(req.user, req.params.id)));
  R.post("/api/posts/:id/undisclosed-report", A(async (req) => reportPost(req.user, req.params.id, req.body || {})));
  R.get("/api/collabs/library", async (req) => library(req.user, req.query));
  R.get("/api/collabs/my-posts", A(async (req) => ({ posts: (await db.all("SELECT id, type, title, text, status, created_at FROM posts WHERE author=$1 AND status IN ('published','scheduled') AND type<>'story' ORDER BY created_at DESC LIMIT 40", [req.user.id])).map((x) => ({ id: x.id, type: x.type, status: x.status, title: (x.title || String(x.text || "")).replace(/\s+/g, " ").slice(0, 80), at: x.created_at })) })));
  R.get("/api/admin/collabs", admin(async () => adminView()));
  R.post("/api/admin/collabs/campaigns/:id", admin(async (req) => decideCampaign(req.user, req.params.id, req.body || {})));
  R.post("/api/admin/collabs/reports/:post", admin(async (req) => decideReport(req.user, req.params.post, req.body || {})));
  R.post("/api/admin/collabs/brands/:id", admin(async (req) => decideBrand(req.user, req.params.id, req.body || {})));
  return { myKit, saveKit, kit, creators, saveBrand, brandPage, createCampaign, updateCampaign, campaigns, campaign, apply, offer, deals, deal, counter, decide, say, deliver, review, report, selfDisclose, undisclose, library, reportPost, adminView, decideCampaign, decideReport, decideBrand, labelFor, CATEGORIES, FORMATS, KINDS, PROHIBITED };
};
