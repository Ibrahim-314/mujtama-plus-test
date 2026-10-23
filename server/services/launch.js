/* Launch readiness (phase 50) — help center + FAQ (admin-editable), support tickets, community ambassadors, waitlist + invite rollout.
 * • LAUNCH_MODE=open|invite (env, default open → production stays open). In invite mode a NEW account needs a valid invite code:
 *   password sign-up (`POST /api/auth/register {invite}`) is refused with 403 invite_required; a NEW Pi account created without a
 *   code is parked with users.status='waitlist' (no usable session) and added to the waitlist; signing in again with `{invite}` activates it.
 *   Existing accounts are never affected. Hooks wrap the existing auth routes (users.js is not edited).
 * • Referral: `ref` (ambassador code) on register/Pi sign-in/waitlist is recorded once per account (ambassador_referrals).
 * • Staff = users.role admin|moderator (tickets queue, ambassador review); help articles + invites = admin|moderator too.
 * • Ticket attachments = ids of media rows the author owns (existing /api/media upload). */
const crypto = require("node:crypto");
const { E, HttpError, str, id } = require("../lib/core");
const { normalize } = require("../lib/arabic");

const STAFF = ["admin", "moderator"];
const T_STATUS = ["open", "pending", "answered", "resolved", "closed"];
const T_CATS = ["general", "account", "pi", "safety", "bug", "content", "other"];
const PRIORITY = ["normal", "high", "urgent"];
const H_CATS = ["start", "account", "pi", "safety", "communities", "general"];
const CODE_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** default Arabic help-center content, inserted once (admins edit/delete afterwards; never re-seeded) */
const SEED = [
  ["article", "start", "getting-started", "البدء في مجتمع بلس", "أنشئ حسابك وأكمل ملفك وتابع المواضيع التي تهمك.", "سجّل بحساب Pi أو باسم مستخدم وكلمة مرور، ثم اختر اهتماماتك لتظهر لك خلاصة مناسبة.\n\nأكمل ملفك الشخصي بصورة ونبذة قصيرة، وتابع المجتمعات والأشخاص الذين يهمونك. يمكنك تغيير اهتماماتك في أي وقت من الإعدادات."],
  ["article", "account", "account-security", "حماية حسابك", "التحقق بخطوتين والأجهزة المتصلة وكلمة المرور.", "فعّل التحقق بخطوتين من الإعدادات ← الأمان، وراجع الأجهزة المتصلة وأنهِ أي جلسة لا تعرفها.\n\nلا نطلب منك كلمة المرور أو عبارة محفظة Pi أبداً عبر الرسائل. أي رسالة تطلب ذلك احتيال: أبلغ عنها فوراً."],
  ["article", "pi", "pi-payments", "مدفوعات Pi في التطبيق", "الدعم والاشتراكات والسوق والإيصالات.", "كل دفعة بعملة Pi تمر عبر نافذة Pi الرسمية وتحتاج موافقتك. تجد إيصالاتك في المحفظة.\n\nإن توقفت دفعة في منتصفها فلا تكررها؛ نطابق المدفوعات تلقائياً ونعيد ما لم يكتمل."],
  ["article", "safety", "report-abuse", "الإبلاغ عن الإساءة", "كيف تبلغ عن منشور أو حساب أو رسالة.", "اضغط زر الأمان بجانب أي منشور أو تعليق أو حساب واختر «إبلاغ». نراجع البلاغات العاجلة أولاً ونخبرك بالقرار.\n\nإن كنت في خطر فوري فاتصل بالرقم الموحد للطوارئ 911."],
  ["article", "communities", "communities-guide", "المجتمعات", "الانضمام والإنشاء والإشراف.", "انضم إلى مجتمعات عامة مباشرة أو اطلب الانضمام إلى الخاصة. يمكنك إنشاء مجتمعك وتعيين مشرفين ووضع قواعد واضحة."],
  ["faq", "general", "faq-free", "هل التطبيق مجاني؟", null, "نعم، الاستخدام الأساسي مجاني بالكامل. بعض الميزات اختيارية بعملة Pi مثل دعم صناع المحتوى واشتراك «مجتمع+ ذكاء»."],
  ["faq", "account", "faq-delete", "كيف أحذف حسابي أو أنزّل بياناتي؟", null, "من الإعدادات ← بياناتي يمكنك تنزيل نسخة من بياناتك أو طلب حذف الحساب. يُحذف الحساب بعد مهلة تراجع قصيرة."],
  ["faq", "pi", "faq-pi-link", "كيف أربط حساب Pi؟", null, "افتح التطبيق من متصفح Pi ثم الإعدادات ← Pi Network ← ربط الحساب، ووافق في نافذة Pi."],
  ["faq", "safety", "faq-block", "ما الفرق بين الكتم والحظر؟", null, "الكتم يخفي المحتوى عنك دون علم الطرف الآخر. الحظر يمنعه من رؤية ملفك والتفاعل معك ومراسلتك."],
  ["faq", "general", "faq-invite", "لماذا أحتاج دعوة للتسجيل؟", null, "أثناء الإطلاق التدريجي قد نفتح التسجيل بالدعوات فقط لضمان جودة التجربة. انضم إلى قائمة الانتظار وسنرسل لك دعوة قريباً، أو اطلب دعوة من أحد سفراء المجتمع."],
  ["faq", "general", "faq-support", "كيف أتواصل مع فريق الدعم؟", null, "من مركز المساعدة ← «تواصل مع الدعم» افتح تذكرة واشرح المشكلة، ويمكنك إرفاق صورة. ستصلك الردود في صفحة تذاكري."],
  ["faq", "general", "faq-ambassador", "كيف أصبح سفيراً للمجتمع؟", null, "قدّم طلبك من صفحة «سفراء المجتمع». يراجع الفريق الطلبات، وعند القبول تحصل على شارة ورابط دعوة خاص وإحصاءات لمن انضم عن طريقك."]
];

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const mode = () => (String(env.LAUNCH_MODE || "open").toLowerCase() === "invite" ? "invite" : "open");
  const isStaff = (u) => !!u && STAFF.includes(u.role);
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("لفريق الدعم فقط"); return fn(req, res); });
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const hitOr = (action, key) => { if (!rl.hit(action, key)) throw E.rate(); };
  const newCode = (n = 8) => { const b = crypto.randomBytes(n); let s = ""; for (const x of b) s += CODE_ALPHA[x % CODE_ALPHA.length]; return s; };
  const normCode = (c) => (typeof c === "string" ? c.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32) : "");

  /* ======================= help center + FAQ ======================= */
  const searchText = (a) => normalize([a.title, a.summary || "", a.body].join(" "));
  let seeded = null;
  const seed = () => (seeded ||= (async () => {
    if (await db.get("SELECT 1 x FROM launch_meta WHERE key='help_seeded'")) return;
    const t = nowIso();
    let i = 0;
    for (const [kind, category, slug, title, summary, body] of SEED) {
      if (await db.get("SELECT 1 x FROM help_articles WHERE lang='ar' AND slug=$1", [slug])) continue;
      await db.run("INSERT INTO help_articles(id,slug,lang,kind,category,title,summary,body,search,status,sort,author,created_at,updated_at) VALUES($1,$2,'ar',$3,$4,$5,$6,$7,$8,'published',$9,NULL,$10,$10)",
        [id("ha"), slug, kind, category, title, summary, body, searchText({ title, summary, body }), (i += 10), t]);
    }
    await db.run("INSERT INTO launch_meta(key,value,updated_at) VALUES('help_seeded','1',$1) ON CONFLICT (key) DO NOTHING", [t]);
  })().catch((e) => { seeded = null; throw e; }));
  const artClient = (r, full) => ({ id: r.id, slug: r.slug, lang: r.lang, kind: r.kind, category: r.category, title: r.title, summary: r.summary || "", status: r.status, sort: r.sort, updatedAt: r.updated_at, ...(full ? { body: r.body } : {}) });
  async function listArticles(q, viewer) {
    await seed();
    const lang = /^[a-z]{2}$/.test(q.lang || "") ? q.lang : "ar";
    const all = isStaff(viewer) && q.all === "1";
    const where = ["lang=$1"], args = [lang];
    if (!all) where.push("status='published'");
    if (q.kind === "faq" || q.kind === "article") { args.push(q.kind); where.push(`kind=$${args.length}`); }
    if (H_CATS.includes(q.category)) { args.push(q.category); where.push(`category=$${args.length}`); }
    const terms = normalize(String(q.q || "").slice(0, 100)).split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
    for (const w of terms) { args.push("%" + w.replace(/[%_\\]/g, "") + "%"); where.push(`search LIKE $${args.length}`); }
    const rows = await db.all(`SELECT * FROM help_articles WHERE ${where.join(" AND ")} ORDER BY sort, created_at LIMIT 200`, args);
    return { items: rows.map((r) => artClient(r, r.kind === "faq")), categories: H_CATS, q: q.q || "" };
  }
  async function getArticle(slug, viewer) {
    await seed();
    const r = await db.get("SELECT * FROM help_articles WHERE lang='ar' AND slug=$1", [String(slug).slice(0, 80)]);
    if (!r || (r.status !== "published" && !isStaff(viewer))) throw E.nf();
    return { article: artClient(r, true) };
  }
  function artInput(b, prev = {}) {
    const title = b.title !== undefined ? str(b.title, 160, { required: true, min: 2 }) : prev.title;
    const body = b.body !== undefined ? str(b.body, 20000, { required: true, min: 2 }) : prev.body;
    if (!title || !body) throw E.bad("العنوان والمحتوى مطلوبان");
    const summary = b.summary !== undefined ? str(b.summary, 300) : prev.summary || null;
    const kind = b.kind !== undefined ? (["faq", "article"].includes(b.kind) ? b.kind : null) : prev.kind || "article";
    const category = b.category !== undefined ? (H_CATS.includes(b.category) ? b.category : null) : prev.category || "general";
    const status = b.status !== undefined ? (["published", "draft"].includes(b.status) ? b.status : null) : prev.status || "published";
    if (!kind || !category || !status) throw E.bad("نوع أو تصنيف أو حالة غير صالحة");
    const lang = b.lang !== undefined ? (/^[a-z]{2}$/.test(b.lang) ? b.lang : null) : prev.lang || "ar";
    if (!lang) throw E.bad("لغة غير صالحة");
    const slug = b.slug !== undefined ? String(b.slug).trim().toLowerCase() : prev.slug || (kind + "-" + newCode(6).toLowerCase());
    if (!/^[a-z0-9-]{2,80}$/.test(slug)) throw E.bad("المعرّف: حروف إنجليزية صغيرة وأرقام و - فقط");
    return { title, body, summary, kind, category, status, lang, slug, sort: b.sort !== undefined ? int(b.sort, 0, -100000, 100000) : prev.sort ?? 1000 };
  }
  async function saveArticle(user, idv, b) {
    await seed();
    const prev = idv ? await db.get("SELECT * FROM help_articles WHERE id=$1", [idv]) : null;
    if (idv && !prev) throw E.nf();
    const a = artInput(b || {}, prev || {});
    const clash = await db.get("SELECT id FROM help_articles WHERE lang=$1 AND slug=$2", [a.lang, a.slug]);
    if (clash && clash.id !== idv) throw E.conflict("المعرّف مستخدم");
    const t = nowIso(), s = searchText(a);
    if (prev) await db.run("UPDATE help_articles SET slug=$1,lang=$2,kind=$3,category=$4,title=$5,summary=$6,body=$7,search=$8,status=$9,sort=$10,author=$11,updated_at=$12 WHERE id=$13",
      [a.slug, a.lang, a.kind, a.category, a.title, a.summary, a.body, s, a.status, a.sort, user.id, t, idv]);
    else { idv = id("ha"); await db.run("INSERT INTO help_articles(id,slug,lang,kind,category,title,summary,body,search,status,sort,author,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)",
      [idv, a.slug, a.lang, a.kind, a.category, a.title, a.summary, a.body, s, a.status, a.sort, user.id, t]); }
    ctx.audit?.("help_article_saved", user.id, null, idv);
    return { article: artClient(await db.get("SELECT * FROM help_articles WHERE id=$1", [idv]), true) };
  }

  /* ======================= support tickets ======================= */
  async function attachmentsFor(user, list) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list) || list.length > 4) throw E.bad("أربعة مرفقات كحد أقصى");
    const out = [];
    for (const m of list) {
      if (typeof m !== "string" || m.length > 64) throw E.bad("مرفق غير صالح");
      const row = await db.get("SELECT id, kind, owner, variants FROM media WHERE id=$1", [m]);
      if (!row || row.owner !== user.id) throw fail(400, "attachment_invalid", "المرفق غير موجود أو ليس لك");
      out.push(row.id);
    }
    return [...new Set(out)];
  }
  async function mediaInfo(ids) {
    const out = [];
    for (const m of ids || []) { const r = await db.get("SELECT id, kind, status, variants FROM media WHERE id=$1", [m]); if (r) out.push({ id: r.id, kind: r.kind, status: r.status, variants: parse(r.variants, {}) }); }
    return out;
  }
  const ticketClient = (t, extra = {}) => ({ id: t.id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, assignee: t.assignee || null, lastBy: t.last_by, createdAt: t.created_at, updatedAt: t.updated_at, ...extra });
  async function loadTicket(user, tid) {
    const t = await db.get("SELECT * FROM support_tickets WHERE id=$1", [String(tid).slice(0, 64)]);
    if (!t || (t.user_id !== user.id && !isStaff(user))) throw E.nf(); // no existence oracle for other users' tickets
    return t;
  }
  async function openTicket(user, b) {
    hitOr("support_ticket", user.id);
    const subject = str(b.subject, 140, { required: true, min: 3 }), body = str(b.body, 5000, { required: true, min: 3 });
    const category = T_CATS.includes(b.category) ? b.category : "general";
    const att = await attachmentsFor(user, b.attachments);
    const open = await db.get("SELECT COUNT(*) n FROM support_tickets WHERE user_id=$1 AND status IN ('open','pending','answered')", [user.id]);
    if (Number(open?.n || 0) >= 10) throw fail(429, "too_many_open", "لديك تذاكر مفتوحة كثيرة؛ أغلق بعضها أولاً");
    const t = nowIso(), tid = id("tk");
    await db.run("INSERT INTO support_tickets(id,user_id,subject,category,status,priority,last_by,created_at,updated_at) VALUES($1,$2,$3,$4,'open','normal','user',$5,$5)", [tid, user.id, subject, category, t]);
    await db.run("INSERT INTO support_messages(id,ticket_id,author_id,staff,internal,body,attachments,created_at) VALUES($1,$2,$3,0,0,$4,$5,$6)", [id("tm"), tid, user.id, body, JSON.stringify(att), t]);
    bus.emit?.("SUPPORT_TICKET_OPENED", { ticket: tid });
    return ticketView(user, tid);
  }
  async function ticketView(user, tid) {
    const t = await loadTicket(user, tid), st = isStaff(user);
    const msgs = await db.all(`SELECT m.*, u.handle, u.name FROM support_messages m LEFT JOIN users u ON u.id=m.author_id WHERE m.ticket_id=$1 ${st ? "" : "AND m.internal=0"} ORDER BY m.created_at, m.id`, [t.id]);
    const messages = [];
    for (const m of msgs) messages.push({ id: m.id, staff: !!m.staff, internal: !!m.internal, body: m.body, createdAt: m.created_at, attachments: await mediaInfo(parse(m.attachments, [])),
      author: m.staff && !st ? { name: "فريق الدعم" } : { handle: m.handle, name: m.name } });
    let owner;
    if (st) { const u = await db.get("SELECT id, handle, name FROM users WHERE id=$1", [t.user_id]); owner = u ? { id: u.id, handle: u.handle, name: u.name } : null; }
    return { ticket: ticketClient(t, owner ? { owner } : {}), messages };
  }
  async function reply(user, tid, b) {
    hitOr("support_reply", user.id);
    const t = await loadTicket(user, tid), st = isStaff(user), mine = t.user_id === user.id;
    const body = str(b.body, 5000, { required: true, min: 1 });
    const internal = st && !mine && b.internal === true ? 1 : 0;
    if (t.status === "closed" && !st) throw fail(409, "ticket_closed", "التذكرة مغلقة؛ افتح تذكرة جديدة");
    const att = await attachmentsFor(user, b.attachments);
    const asStaff = st && !mine ? 1 : 0, ts = nowIso();
    await db.run("INSERT INTO support_messages(id,ticket_id,author_id,staff,internal,body,attachments,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id("tm"), t.id, user.id, asStaff, internal, body, JSON.stringify(att), ts]);
    if (!internal) {
      const status = asStaff ? "answered" : (t.status === "answered" || t.status === "resolved" ? "open" : t.status);
      await db.run("UPDATE support_tickets SET status=$1, last_by=$2, updated_at=$3, assignee=COALESCE(assignee,$4) WHERE id=$5", [status, asStaff ? "staff" : "user", ts, asStaff ? user.id : null, t.id]);
      if (asStaff) { try { await ctx.services.notify?.notify(t.user_id, "support_reply", { ref: t.id }); } catch { /* notification is best effort */ } }
    }
    return ticketView(user, t.id);
  }
  async function setStatus(user, tid, b) {
    const t = await loadTicket(user, tid), st = isStaff(user);
    const status = T_STATUS.includes(b.status) ? b.status : null;
    if (!status) throw E.bad("حالة غير صالحة");
    if (!st && !["resolved", "closed", "open"].includes(status)) throw E.forbid();
    if (!st && status === "open" && t.status === "closed") throw fail(409, "ticket_closed", "التذكرة مغلقة؛ افتح تذكرة جديدة");
    const priority = st && PRIORITY.includes(b.priority) ? b.priority : t.priority;
    await db.run("UPDATE support_tickets SET status=$1, priority=$2, updated_at=$3 WHERE id=$4", [status, priority, nowIso(), t.id]);
    return ticketView(user, t.id);
  }
  async function myTickets(user) {
    const rows = await db.all("SELECT * FROM support_tickets WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 100", [user.id]);
    return { items: rows.map((t) => ticketClient(t)) };
  }
  async function queue(q) {
    const where = [], args = [];
    if (T_STATUS.includes(q.status)) { args.push(q.status); where.push(`t.status=$${args.length}`); }
    else if (q.status !== "all") where.push("t.status IN ('open','pending')");
    if (T_CATS.includes(q.category)) { args.push(q.category); where.push(`t.category=$${args.length}`); }
    if (q.assignee === "me" && q.uid) { args.push(q.uid); where.push(`t.assignee=$${args.length}`); }
    const rows = await db.all(`SELECT t.*, u.handle FROM support_tickets t LEFT JOIN users u ON u.id=t.user_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.updated_at LIMIT 200`, args);
    const counts = {};
    for (const r of await db.all("SELECT status, COUNT(*) n FROM support_tickets GROUP BY status")) counts[r.status] = Number(r.n);
    return { items: rows.map((t) => ticketClient(t, { owner: { handle: t.handle } })), counts };
  }
  async function assign(user, tid, b) {
    const t = await loadTicket(user, tid);
    let to = null;
    if (b.assignee === "me") to = user.id;
    else if (typeof b.assignee === "string" && b.assignee) { const u = await db.get("SELECT id, role FROM users WHERE id=$1", [b.assignee.slice(0, 64)]); if (!u || !STAFF.includes(u.role)) throw E.bad("عضو الفريق غير موجود"); to = u.id; }
    await db.run("UPDATE support_tickets SET assignee=$1, status=CASE WHEN status='open' THEN 'pending' ELSE status END, updated_at=$2 WHERE id=$3", [to, nowIso(), t.id]);
    return ticketView(user, t.id);
  }

  /* ======================= ambassadors ======================= */
  const ambClient = (a) => a && ({ status: a.status, refCode: a.status === "approved" ? a.ref_code : null, region: a.region || null, motivation: a.motivation, note: a.note || null, createdAt: a.created_at, reviewedAt: a.reviewed_at || null });
  async function apply(user, b) {
    hitOr("ambassador_apply", user.id);
    const motivation = str(b.motivation, 1500, { required: true, min: 20 }), region = str(b.region, 80);
    const links = Array.isArray(b.links) ? b.links.filter((x) => typeof x === "string" && /^https:\/\/\S{3,300}$/.test(x)).slice(0, 3) : [];
    const cur = await db.get("SELECT * FROM ambassadors WHERE user_id=$1", [user.id]);
    if (cur && ["pending", "approved"].includes(cur.status)) throw fail(409, "already_applied", cur.status === "approved" ? "أنت سفير بالفعل" : "طلبك قيد المراجعة");
    if (cur && cur.status === "revoked") throw fail(409, "revoked", "أُلغيت عضويتك في البرنامج؛ تواصل مع الدعم");
    const t = nowIso();
    if (cur) await db.run("UPDATE ambassadors SET status='pending', motivation=$1, region=$2, links=$3, note=NULL, reviewed_by=NULL, reviewed_at=NULL, updated_at=$4 WHERE user_id=$5", [motivation, region, JSON.stringify(links), t, user.id]);
    else await db.run("INSERT INTO ambassadors(user_id,status,motivation,region,links,ref_code,created_at,updated_at) VALUES($1,'pending',$2,$3,$4,$5,$6,$6)", [user.id, motivation, region, JSON.stringify(links), "A" + newCode(7), t]);
    return ambassadorMe(user);
  }
  async function stats(uid) {
    const since = new Date(Date.parse(nowIso()) - 30 * 86400e3).toISOString();
    const total = await db.get("SELECT COUNT(*) n FROM ambassador_referrals WHERE ambassador_id=$1", [uid]);
    const recent = await db.get("SELECT COUNT(*) n FROM ambassador_referrals WHERE ambassador_id=$1 AND created_at >= $2", [uid, since]);
    const active = await db.get("SELECT COUNT(DISTINCT r.user_id) n FROM ambassador_referrals r JOIN posts p ON p.author=r.user_id WHERE r.ambassador_id=$1 AND p.created_at >= $2", [uid, since]);
    const inv = await db.get("SELECT COUNT(*) n, COALESCE(SUM(uses),0) u FROM launch_invites WHERE ambassador_id=$1", [uid]);
    return { referrals: Number(total?.n || 0), last30d: Number(recent?.n || 0), activeLast30d: Number(active?.n || 0), invitesIssued: Number(inv?.n || 0), invitesUsed: Number(inv?.u || 0) };
  }
  async function ambassadorMe(user) {
    const a = await db.get("SELECT * FROM ambassadors WHERE user_id=$1", [user.id]);
    return { ambassador: ambClient(a), stats: a?.status === "approved" ? await stats(user.id) : null,
      invites: a?.status === "approved" ? (await db.all("SELECT code, max_uses, uses, expires_at, revoked FROM launch_invites WHERE ambassador_id=$1 ORDER BY created_at DESC LIMIT 50", [user.id])).map(invClient) : [] };
  }
  async function ambassadorInvite(user) {
    const a = await db.get("SELECT status FROM ambassadors WHERE user_id=$1", [user.id]);
    if (a?.status !== "approved") throw E.forbid("للسفراء المعتمدين فقط");
    const n = await db.get("SELECT COUNT(*) n FROM launch_invites WHERE ambassador_id=$1", [user.id]);
    const cap = int(env.AMBASSADOR_INVITES_MAX, 20, 0, 1000);
    if (Number(n?.n || 0) >= cap) throw fail(429, "invite_cap", "وصلت إلى الحد الأقصى من الدعوات");
    const code = await mkInvite({ by: user.id, ambassador: user.id, maxUses: 5, days: 30, note: "ambassador" });
    return { invite: invClient(await db.get("SELECT * FROM launch_invites WHERE code=$1", [code])) };
  }
  async function reviewAmbassador(user, uid, b) {
    const a = await db.get("SELECT * FROM ambassadors WHERE user_id=$1", [String(uid).slice(0, 64)]); if (!a) throw E.nf();
    const to = { approve: "approved", reject: "rejected", revoke: "revoked" }[b.decision];
    if (!to) throw E.bad("قرار غير صالح");
    if (to === "revoked" && a.status !== "approved") throw fail(409, "invalid_state", "ليس سفيراً معتمداً");
    if (to !== "revoked" && a.status !== "pending") throw fail(409, "invalid_state", "الطلب ليس قيد المراجعة");
    const note = str(b.note, 500);
    if (to !== "approved" && !note) throw E.bad("اذكر سبب القرار");
    await db.run("UPDATE ambassadors SET status=$1, note=$2, reviewed_by=$3, reviewed_at=$4, updated_at=$4 WHERE user_id=$5", [to, note, user.id, nowIso(), a.user_id]);
    if (to === "revoked") await db.run("UPDATE launch_invites SET revoked=1 WHERE ambassador_id=$1", [a.user_id]);
    try { await ctx.services.notify?.notify(a.user_id, "ambassador_" + to, { ref: a.user_id }); } catch { /* best effort */ }
    ctx.audit?.("ambassador_" + to, user.id, null, a.user_id);
    return { ambassador: ambClient(await db.get("SELECT * FROM ambassadors WHERE user_id=$1", [a.user_id])) };
  }
  async function ambassadorsAdmin(q) {
    const st = ["pending", "approved", "rejected", "revoked"].includes(q.status) ? q.status : "pending";
    const rows = await db.all("SELECT a.*, u.handle, u.name FROM ambassadors a JOIN users u ON u.id=a.user_id WHERE a.status=$1 ORDER BY a.created_at LIMIT 200", [st]);
    const items = [];
    for (const r of rows) items.push({ userId: r.user_id, handle: r.handle, name: r.name, ...ambClient(r), refCode: r.ref_code, links: parse(r.links, []), ...(st === "approved" ? { stats: await stats(r.user_id) } : {}) });
    return { items };
  }
  let badgeCache = { at: 0, list: [] };
  async function publicAmbassadors() {
    if (Date.now() - badgeCache.at > 60e3) badgeCache = { at: Date.now(), list: (await db.all("SELECT u.handle, u.name FROM ambassadors a JOIN users u ON u.id=a.user_id WHERE a.status='approved' AND u.status='active' ORDER BY a.reviewed_at LIMIT 500")).map((r) => ({ handle: r.handle, name: r.name })) };
    return { items: badgeCache.list };
  }
  async function recordReferral(uid, ref) {
    const code = normCode(ref); if (!code) return false;
    const a = await db.get("SELECT user_id FROM ambassadors WHERE ref_code=$1 AND status='approved'", [code]);
    if (!a || a.user_id === uid) return false;
    await db.run("INSERT INTO ambassador_referrals(user_id,ambassador_id,ref_code,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO NOTHING", [uid, a.user_id, code, nowIso()]);
    return true;
  }

  /* ======================= invites + waitlist ======================= */
  const invClient = (r) => r && ({ code: r.code, maxUses: r.max_uses, uses: r.uses, expiresAt: r.expires_at || null, revoked: !!r.revoked, note: r.note || null, createdAt: r.created_at });
  async function mkInvite({ by, ambassador = null, waitlist = null, maxUses = 1, days = 30, note = null }) {
    const exp = days > 0 ? new Date(Date.parse(nowIso()) + days * 86400e3).toISOString() : null;
    for (let i = 0; i < 5; i++) {
      const code = newCode(4) + "-" + newCode(4);
      if (await db.get("SELECT 1 x FROM launch_invites WHERE code=$1", [code])) continue;
      await db.run("INSERT INTO launch_invites(code,created_by,ambassador_id,waitlist_id,max_uses,uses,expires_at,revoked,note,created_at) VALUES($1,$2,$3,$4,$5,0,$6,0,$7,$8)", [code, by, ambassador, waitlist, maxUses, exp, note, nowIso()]);
      return code;
    }
    throw new Error("invite code space exhausted");
  }
  async function inviteState(code) {
    const c = normCode(code); if (!c) return { valid: false, reason: "missing" };
    const r = await db.get("SELECT * FROM launch_invites WHERE code=$1", [c]);
    if (!r) return { valid: false, reason: "unknown" };
    if (r.revoked) return { valid: false, reason: "revoked" };
    if (r.expires_at && Date.parse(r.expires_at) < Date.parse(nowIso())) return { valid: false, reason: "expired" };
    if (r.uses >= r.max_uses) return { valid: false, reason: "used" };
    return { valid: true, row: r };
  }
  async function redeem(code, uid) {
    const s = await inviteState(code); if (!s.valid) return false;
    const r = await db.run("UPDATE launch_invites SET uses=uses+1 WHERE code=$1 AND uses < max_uses AND revoked=0", [s.row.code]);
    if (r && r.changes === 0) return false; // lost a race for the last use
    await db.run("INSERT INTO launch_invite_uses(code,user_id,at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [s.row.code, uid, nowIso()]);
    if (s.row.waitlist_id) await db.run("UPDATE launch_waitlist SET status='joined', user_id=$1, updated_at=$2 WHERE id=$3", [uid, nowIso(), s.row.waitlist_id]);
    if (s.row.ambassador_id) await recordReferral(uid, (await db.get("SELECT ref_code FROM ambassadors WHERE user_id=$1", [s.row.ambassador_id]))?.ref_code);
    return true;
  }
  async function joinWaitlist(req) {
    hitOr("waitlist", req.ip || "anon");
    const b = req.body || {};
    let contact = req.user ? "@" + req.user.handle.toLowerCase() : str(b.contact, 120, { required: true, min: 3 });
    if (!req.user) {
      contact = contact.toLowerCase();
      if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(contact)) { /* email */ }
      else if (/^@?[a-z0-9_]{3,24}$/.test(contact)) contact = "@" + contact.replace(/^@/, ""); // Pi username / handle
      else throw E.bad("أدخل بريداً إلكترونياً صحيحاً أو اسم مستخدم Pi");
    }
    const name = str(b.name, 50);
    const ref = normCode(b.ref) || null;
    const prev = await db.get("SELECT * FROM launch_waitlist WHERE contact=$1", [contact]);
    const t = nowIso();
    if (!prev) await db.run("INSERT INTO launch_waitlist(id,contact,name,ref,status,created_at,updated_at) VALUES($1,$2,$3,$4,'waiting',$5,$5)", [id("wl"), contact, name, ref, t]);
    const me = prev || await db.get("SELECT * FROM launch_waitlist WHERE contact=$1", [contact]);
    const ahead = await db.get("SELECT COUNT(*) n FROM launch_waitlist WHERE status='waiting' AND created_at < $1", [me.created_at]);
    return { ok: true, already: !!prev, state: me.status, position: me.status === "waiting" ? Number(ahead?.n || 0) + 1 : null };
  }
  async function waitlistAdmin(q) {
    const st = ["waiting", "invited", "joined"].includes(q.status) ? q.status : "waiting";
    const rows = await db.all("SELECT * FROM launch_waitlist WHERE status=$1 ORDER BY created_at LIMIT 500", [st]);
    const counts = {};
    for (const r of await db.all("SELECT status, COUNT(*) n FROM launch_waitlist GROUP BY status")) counts[r.status] = Number(r.n);
    return { items: rows.map((r) => ({ id: r.id, contact: r.contact, name: r.name, ref: r.ref, status: r.status, inviteCode: r.invite_code, createdAt: r.created_at })), counts };
  }
  async function inviteFromWaitlist(user, wid, b) {
    const ids = wid === "next" ? (await db.all("SELECT id FROM launch_waitlist WHERE status='waiting' ORDER BY created_at LIMIT $1", [int(b.count, 10, 1, 200)])).map((r) => r.id) : [String(wid).slice(0, 64)];
    const out = [];
    for (const w of ids) {
      const r = await db.get("SELECT * FROM launch_waitlist WHERE id=$1", [w]); if (!r) { if (wid !== "next") throw E.nf(); continue; }
      if (r.status !== "waiting") { if (wid !== "next") throw fail(409, "invalid_state", "سبق دعوته"); continue; }
      const code = await mkInvite({ by: user.id, waitlist: r.id, maxUses: 1, days: int(b.days, 14, 1, 365), note: "waitlist" });
      await db.run("UPDATE launch_waitlist SET status='invited', invite_code=$1, updated_at=$2 WHERE id=$3", [code, nowIso(), r.id]);
      out.push({ id: r.id, contact: r.contact, code });
    }
    return { invited: out, note: "أرسل الرموز يدوياً؛ لا يرسل الخادم بريداً تلقائياً هنا." };
  }
  async function createInvites(user, b) {
    const count = int(b.count, 1, 1, 100), maxUses = int(b.maxUses, 1, 1, 10000), days = int(b.days, 30, 0, 365);
    const note = str(b.note, 120);
    const codes = [];
    for (let i = 0; i < count; i++) codes.push(await mkInvite({ by: user.id, maxUses, days, note }));
    return { codes };
  }
  async function launchStats() {
    const one = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
    return { mode: mode(), users: await one("SELECT COUNT(*) n FROM users WHERE status='active'"), parked: await one("SELECT COUNT(*) n FROM users WHERE status='waitlist'"),
      waitlist: await one("SELECT COUNT(*) n FROM launch_waitlist WHERE status='waiting'"), invited: await one("SELECT COUNT(*) n FROM launch_waitlist WHERE status='invited'"),
      invitesRedeemed: await one("SELECT COUNT(*) n FROM launch_invite_uses"), ambassadors: await one("SELECT COUNT(*) n FROM ambassadors WHERE status='approved'"),
      ambassadorsPending: await one("SELECT COUNT(*) n FROM ambassadors WHERE status='pending'"), ticketsOpen: await one("SELECT COUNT(*) n FROM support_tickets WHERE status IN ('open','pending')") };
  }

  /* ======================= hooks on the existing auth routes (users.js untouched) ======================= */
  function hook(method, path, { before = null, after = null }) {
    const route = R.routes.find((r) => r.method === method && r.re.test(path));
    if (!route || route.handler.__mpLaunch) return false;
    const orig = route.handler;
    const wrapped = async (req, res) => { if (before) await before(req, res); const out = await orig(req, res); return after ? ((await after(out, req, res)) ?? out) : out; };
    wrapped.__mpLaunch = true;
    Object.assign(wrapped, { __mpMinors: orig.__mpMinors });
    route.handler = wrapped; return true;
  }
  const inviteRequired = () => fail(403, "invite_required", "التسجيل حالياً بالدعوة فقط. انضم إلى قائمة الانتظار أو أدخل رمز دعوة.");
  hook("POST", "/api/auth/register", {
    before: async (req) => {
      if (mode() !== "invite") return;
      const s = await inviteState(req.body?.invite);
      if (!s.valid) throw Object.assign(inviteRequired(), { details: { reason: s.reason, waitlist: true } });
    },
    after: async (out, req) => {
      const uid = out?.user?.id; if (!uid) return;
      if (req.body?.invite) await redeem(req.body.invite, uid).catch(() => { });
      if (req.body?.ref) await recordReferral(uid, req.body.ref).catch(() => { });
    }
  });
  hook("POST", "/api/auth/pi", {
    before: async (req) => { req.__launchT = Date.now() - 1000; }, // users.created_at is real wall-clock time
    after: async (out, req, res) => {
      const uid = out?.user?.id; if (!uid) return;
      const u = await db.get("SELECT id, handle, status, created_at FROM users WHERE id=$1", [uid]);
      const fresh = !!u && Date.parse(u.created_at) >= req.__launchT && !(await db.get("SELECT 1 x FROM launch_invite_uses WHERE user_id=$1", [uid]));
      if (fresh && req.body?.ref) await recordReferral(uid, req.body.ref).catch(() => { });
      if (mode() !== "invite" || !u) return;
      if (fresh || u.status === "waitlist") {
        if (await redeem(req.body?.invite, uid)) { if (u.status === "waitlist") await db.run("UPDATE users SET status='active' WHERE id=$1", [uid]); return; }
        if (u.status === "active" && !fresh) return;
        await db.run("UPDATE users SET status='waitlist' WHERE id=$1 AND status='active'", [uid]);
        await db.run("DELETE FROM sessions WHERE user_id=$1", [uid]).catch(() => { });
        res.cookie?.("mp_session", "", { maxAge: 0 });
        await db.run("INSERT INTO launch_waitlist(id,contact,name,ref,status,user_id,created_at,updated_at) VALUES($1,$2,NULL,$3,'waiting',$4,$5,$5) ON CONFLICT (contact) DO NOTHING", [id("wl"), "@" + String(u.handle).toLowerCase(), normCode(req.body?.ref) || null, uid, nowIso()]);
        throw Object.assign(inviteRequired(), { details: { waitlist: true, parked: true } });
      }
    }
  });

  /* ======================= routes ======================= */
  R.get("/api/launch/config", async (req) => ({ mode: mode(), inviteRequired: mode() === "invite", waitlist: true, ambassadors: true, helpCenter: true, staff: isStaff(req.user) }));
  R.post("/api/launch/waitlist", async (req) => joinWaitlist(req));
  R.get("/api/launch/invites/:code", async (req) => { hitOr("invite_check", req.ip || "anon"); const s = await inviteState(req.params.code); return { valid: s.valid, reason: s.valid ? null : s.reason }; });
  R.get("/api/launch/stats", staff(async () => launchStats()));
  R.get("/api/admin/launch/waitlist", staff(async (req) => waitlistAdmin(req.query)));
  R.post("/api/admin/launch/waitlist/:id/invite", staff(async (req) => inviteFromWaitlist(req.user, req.params.id, req.body)));
  R.get("/api/admin/launch/invites", staff(async () => ({ items: (await db.all("SELECT * FROM launch_invites ORDER BY created_at DESC LIMIT 300")).map(invClient) })));
  R.post("/api/admin/launch/invites", staff(async (req) => createInvites(req.user, req.body)));
  R.post("/api/admin/launch/invites/:code/revoke", staff(async (req) => { const r = await db.run("UPDATE launch_invites SET revoked=1 WHERE code=$1", [normCode(req.params.code)]); if (r && r.changes === 0) throw E.nf(); return { ok: true }; }));

  R.get("/api/helpcenter/articles", async (req) => listArticles(req.query, req.user));
  R.get("/api/helpcenter/articles/:slug", async (req) => getArticle(req.params.slug, req.user));
  R.post("/api/admin/helpcenter/articles", staff(async (req) => saveArticle(req.user, null, req.body)));
  R.put("/api/admin/helpcenter/articles/:id", staff(async (req) => saveArticle(req.user, req.params.id, req.body)));
  R.del("/api/admin/helpcenter/articles/:id", staff(async (req) => { const r = await db.run("DELETE FROM help_articles WHERE id=$1", [req.params.id]); if (r && r.changes === 0) throw E.nf(); return { ok: true }; }));

  R.post("/api/tickets", A(async (req) => openTicket(req.user, req.body)));
  R.get("/api/tickets", A(async (req) => myTickets(req.user)));
  R.get("/api/tickets/:id", A(async (req) => ticketView(req.user, req.params.id)));
  R.post("/api/tickets/:id/messages", A(async (req) => reply(req.user, req.params.id, req.body)));
  R.post("/api/tickets/:id/status", A(async (req) => setStatus(req.user, req.params.id, req.body)));
  R.get("/api/staff/tickets", staff(async (req) => queue({ ...req.query, uid: req.user.id })));
  R.post("/api/staff/tickets/:id/assign", staff(async (req) => assign(req.user, req.params.id, req.body)));

  R.get("/api/ambassadors", async () => publicAmbassadors());
  R.get("/api/ambassadors/me", A(async (req) => ambassadorMe(req.user)));
  R.post("/api/ambassadors/apply", A(async (req) => apply(req.user, req.body)));
  R.post("/api/ambassadors/me/invites", A(async (req) => ambassadorInvite(req.user)));
  R.get("/api/admin/ambassadors", staff(async (req) => ambassadorsAdmin(req.query)));
  R.post("/api/admin/ambassadors/:uid/review", staff(async (req) => { const r = await reviewAmbassador(req.user, req.params.uid, req.body); badgeCache.at = 0; return r; }));

  return { mode, inviteState, redeem, recordReferral, stats, seed, isStaff, mkInvite }; // mkInvite: phase 54 beta waves issue launch codes tagged beta:<cohort>
};
