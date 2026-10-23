/* Open knowledge library «المكتبة المعرفية المفتوحة» (phase 75), platform-wide — separate from the per-community wiki / Q&A of
 * phase 18 (services/knowledge.js). No keys.
 *  1. Open contributions: any signed-in member writes an article (title, summary, body in lightweight Markdown — the shared
 *     RichText parser sanitises it — category, tags, sources) under an open licence (CC BY 4.0, CC BY-SA 4.0 or CC0) and
 *     confirms the contribution is their own or properly attributed. Anyone may propose an edit to a published article;
 *     the edit inherits the article's licence.
 *  2. Review: every version is a revision. New articles and edits wait for a trusted reviewer (granted by staff) or staff;
 *     reviewers' and staff's own edits are approved directly (minors' never). Approving a stale edit (written on an older
 *     version) is refused so nothing is silently overwritten. Reviewers can revert to any approved version (a new revision).
 *  3. History: every approved version with author, note and size change, any version readable, line diff between versions;
 *     contributors listed on the article (attribution for the CC licence).
 *  4. Discovery: Arabic-normalised search (title, summary, tags, body), categories with counts, sort by recent / popular /
 *     helpful; «هل كان مفيداً؟» votes; view counts.
 *  5. Moderation: reports (inaccurate, copyright, harmful, spam, other) go to the review queue; KB_FLAG_REPORTS (3) open
 *     reports flag the article (banner, hidden from minors) until a reviewer decides; staff hide / restore / archive and
 *     mark an article adults-only (sensitive) — all audited.
 *  6. Minors (phase 35): read published, non-sensitive, unflagged articles; may contribute, always through review; their
 *     name never appears in public history or contributor lists («مساهم يافع»); cannot be reviewers. */
const { E, str, oneOf, id } = require("../lib/core");
const RichText = require("../../richtext.js");
const { normalize } = require("../lib/arabic");

const CATS = { science: "علوم", tech: "تقنية وبرمجة", islamic: "دراسات إسلامية", history: "تاريخ وحضارة", language: "لغة وأدب", health: "صحة", economy: "اقتصاد ومال", society: "مجتمع وثقافة", howto: "أدلة عملية", pi: "شبكة Pi", other: "أخرى" };
const LICENSES = {
  "cc-by-4.0": { label: "CC BY 4.0", name: "نسب المصنَّف", url: "https://creativecommons.org/licenses/by/4.0/deed.ar" },
  "cc-by-sa-4.0": { label: "CC BY-SA 4.0", name: "نسب المصنَّف — الترخيص بالمثل", url: "https://creativecommons.org/licenses/by-sa/4.0/deed.ar" },
  cc0: { label: "CC0 1.0", name: "إهداء للملك العام", url: "https://creativecommons.org/publicdomain/zero/1.0/deed.ar" }
};
const A_STATUS = { review: "بانتظار المراجعة", published: "منشورة", hidden: "مخفية", archived: "مؤرشفة" };
const R_STATUS = { pending: "بانتظار المراجعة", approved: "معتمدة", rejected: "مرفوضة", withdrawn: "مسحوبة" };
const REASONS = { inaccurate: "معلومة غير دقيقة", copyright: "انتهاك حقوق نشر", harmful: "محتوى ضار أو غير لائق", spam: "إعلان أو محتوى مزعج", other: "سبب آخر" };
const MINOR_NAME = "مساهم يافع";

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const FLAG_AT = +(env.KB_FLAG_REPORTS || 3);
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const n = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; return a.length ? db.all(`SELECT id, name, handle, color, avatar FROM users WHERE id IN (${ph(a)})`, a) : []; }
  async function minorsOf(ids) { const s = new Set(); for (const u of new Set(ids.filter(Boolean))) if (await isMinor(u)) s.add(u); return s; }
  const pub = (u, minors) => (!u ? null : minors?.has(u.id) ? { id: null, name: MINOR_NAME, handle: null, minor: true } : { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null });
  const isReviewer = async (user) => !!user && (user.role === "admin" || (!!(await db.get("SELECT 1 x FROM kb_reviewers WHERE user_id=$1", [user.id]))) && !(await isMinor(user.id)));
  const lic = (k) => ({ key: k, ...(LICENSES[k] || { label: k, name: k, url: null }) });

  /* ---------- content validation ---------- */
  function urlOk(s) { try { const x = new URL(String(s).trim()); return ["https:", "http:"].includes(x.protocol) ? x.toString().slice(0, 300) : null; } catch { return null; } }
  function fields(b, prev) {
    const title = str(b.title ?? prev?.title, 160, { required: true, min: 4 });
    const summary = str(b.summary ?? prev?.summary ?? undefined, 400);
    const raw = String(b.body ?? prev?.body ?? "").replace(/\r\n?/g, "\n").trim();
    if (raw.length < 200) throw E.bad("المحتوى قصير؛ اكتب ٢٠٠ حرف على الأقل");
    if (raw.length > 60000) throw E.bad("المحتوى أطول من الحد (٦٠ ألف حرف)");
    const doc = RichText.parse(raw); if (!doc.blocks.length) throw E.bad("المحتوى فارغ");
    const category = oneOf(b.category ?? prev?.category, Object.keys(CATS), null); if (!category) throw E.bad("اختر تصنيفاً");
    const tagsIn = b.tags !== undefined ? b.tags : parse(prev?.tags, []);
    const tags = [...new Set((Array.isArray(tagsIn) ? tagsIn : String(tagsIn || "").split(/[,،\n]/)).map((t) => String(t).replace(/^#/, "").trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
    const srcIn = b.sources !== undefined ? b.sources : parse(prev?.sources, []);
    const srcList = (Array.isArray(srcIn) ? srcIn : String(srcIn || "").split(/\s+/)).map((s) => String(s).trim()).filter(Boolean);
    if (srcList.length > 12) throw E.bad("حتى ١٢ مصدراً");
    const sources = srcList.map((s) => { const u = urlOk(s); if (!u) throw E.bad("رابط مصدر غير صالح"); return u; });
    return { title, summary, body: raw, category, tags, sources };
  }

  /* ---------- views ---------- */
  async function viewerCtx(viewer) { return { viewer, minor: viewer ? await isMinor(viewer.id) : false, reviewer: await isReviewer(viewer), staff: viewer?.role === "admin" }; }
  const visible = (a, v) => {
    if (a.status === "published") return !(v.minor && (Number(a.sensitive) || Number(a.flagged)));
    if (v.staff || v.reviewer) return true;
    return a.status === "review" && v.viewer && a.created_by === v.viewer.id; // the author sees the first version waiting
  };
  async function card(a, extra = {}) {
    const text = RichText.toText(RichText.parse(a.body || ""));
    return { id: a.id, title: a.title, summary: a.summary || text.slice(0, 180), category: { key: a.category, label: CATS[a.category] || a.category }, tags: parse(a.tags, []), license: lic(a.license), status: a.status, statusLabel: A_STATUS[a.status], sensitive: !!Number(a.sensitive), flagged: !!Number(a.flagged), rev: Number(a.rev), views: Number(a.views || 0), minutes: Math.max(1, Math.round(text.split(/\s+/).length / 200)), updatedAt: a.updated_at, publishedAt: a.published_at || null, ...extra };
  }
  async function helpfulOf(aid) { const r = await db.get("SELECT COALESCE(SUM(CASE WHEN vote>0 THEN 1 ELSE 0 END),0) up, COALESCE(SUM(CASE WHEN vote<0 THEN 1 ELSE 0 END),0) down FROM kb_votes WHERE article_id=$1", [aid]); return { up: Number(r?.up || 0), down: Number(r?.down || 0) }; }
  async function contributors(aid) {
    const rows = await db.all("SELECT author_id, COUNT(*) c, MIN(n) first FROM kb_revisions WHERE article_id=$1 AND status='approved' GROUP BY author_id ORDER BY first", [aid]);
    const us = await usersOf(rows.map((r) => r.author_id)), minors = await minorsOf(rows.map((r) => r.author_id));
    return rows.map((r) => ({ user: pub(us.find((u) => u.id === r.author_id), minors), edits: Number(r.c) }));
  }
  async function articleView(viewer, aid, { count = true } = {}) {
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a) throw E.nf();
    const v = await viewerCtx(viewer); if (!visible(a, v)) throw E.nf();
    if (count && a.status === "published" && viewer?.id !== a.created_by) await db.run("UPDATE kb_articles SET views=views+1 WHERE id=$1", [aid]);
    const mine = viewer ? await db.get("SELECT id, status, created_at FROM kb_revisions WHERE article_id=$1 AND author_id=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1", [aid, viewer.id]) : null;
    const vote = viewer ? (await db.get("SELECT vote FROM kb_votes WHERE article_id=$1 AND user_id=$2", [aid, viewer.id]))?.vote : null;
    const pending = v.reviewer ? await n("SELECT COUNT(*) n FROM kb_revisions WHERE article_id=$1 AND status='pending'", [aid]) : 0;
    const cur = a.rev ? await db.get("SELECT sources, created_at FROM kb_revisions WHERE article_id=$1 AND n=$2", [aid, a.rev]) : null;
    const related = (await db.all("SELECT * FROM kb_articles WHERE status='published' AND category=$1 AND id<>$2 ORDER BY views DESC LIMIT 6", [a.category, aid])).filter((x) => visible(x, v)).slice(0, 4);
    const rel = []; for (const x of related) rel.push(await card(x));
    return { article: { ...(await card(a)), body: a.body, sources: parse(cur?.sources, []), helpful: await helpfulOf(aid), contributors: await contributors(aid) }, related: rel,
      me: { signedIn: !!viewer, canEdit: !!viewer && a.status === "published", pendingEdit: mine ? { id: mine.id, at: mine.created_at } : null, vote: vote === undefined || vote === null ? 0 : Number(vote), reviewer: v.reviewer, staff: v.staff, pendingRevisions: pending, canReport: !!viewer && a.created_by !== viewer.id, minor: v.minor },
      reasons: REASONS, licenses: Object.keys(LICENSES).map(lic) };
  }
  async function list(viewer, q = {}) {
    const v = await viewerCtx(viewer);
    const cat = CATS[q.category] ? q.category : null, sort = oneOf(q.sort, ["recent", "popular", "helpful"], "recent"), text = normalize(String(q.q || "").slice(0, 80));
    let rows = await db.all("SELECT * FROM kb_articles WHERE status='published' ORDER BY updated_at DESC LIMIT 1000");
    rows = rows.filter((a) => visible(a, v));
    const counts = {}; for (const a of rows) counts[a.category] = (counts[a.category] || 0) + 1;
    if (cat) rows = rows.filter((a) => a.category === cat);
    const tag = String(q.tag || "").replace(/^#/, "").trim();
    if (tag) rows = rows.filter((a) => parse(a.tags, []).includes(tag));
    let scored = rows.map((a) => ({ a, s: 0 }));
    if (text) {
      const words = text.split(" ").filter((w) => w.length > 1);
      scored = scored.map(({ a }) => {
        const t = normalize(a.title), su = normalize(a.summary || ""), tg = normalize(parse(a.tags, []).join(" ")), bd = normalize(a.body);
        let s = 0; for (const w of words) { if (t.includes(w)) s += 5; if (tg.includes(w)) s += 3; if (su.includes(w)) s += 2; if (bd.includes(w)) s += 1; }
        if (t.includes(text)) s += 5; return { a, s };
      }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
    }
    if (!text && sort === "popular") scored.sort((x, y) => Number(y.a.views) - Number(x.a.views));
    if (!text && sort === "helpful") { const hv = {}; for (const r of await db.all("SELECT article_id, SUM(vote) s FROM kb_votes GROUP BY article_id")) hv[r.article_id] = Number(r.s); scored.sort((x, y) => (hv[y.a.id] || 0) - (hv[x.a.id] || 0)); }
    const page = Math.max(0, Math.min(50, Number(q.page) || 0)), per = 20;
    const out = []; for (const { a } of scored.slice(page * per, page * per + per)) out.push(await card(a));
    const tagsAll = {}; for (const a of rows) for (const t of parse(a.tags, [])) tagsAll[t] = (tagsAll[t] || 0) + 1;
    return { articles: out, total: scored.length, page, more: scored.length > (page + 1) * per, counts, categories: CATS, tags: Object.entries(tagsAll).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([t, c]) => ({ tag: t, count: c })),
      totals: { articles: await n("SELECT COUNT(*) n FROM kb_articles WHERE status='published'"), contributors: await n("SELECT COUNT(DISTINCT author_id) n FROM kb_revisions WHERE status='approved'"), edits: await n("SELECT COUNT(*) n FROM kb_revisions WHERE status='approved'") },
      licenses: Object.keys(LICENSES).map(lic), me: { signedIn: !!viewer, reviewer: v.reviewer, staff: v.staff, minor: v.minor } };
  }

  /* ---------- contributions ---------- */
  async function createArticle(user, b = {}) {
    if (!rl.hit("default", "kbnew:" + user.id)) throw E.rate();
    if (!b.agree) throw fail(400, "license_required", "يلزم الموافقة على ترخيص المساهمة");
    const license = oneOf(b.license, Object.keys(LICENSES), null); if (!license) throw E.bad("اختر ترخيصاً مفتوحاً");
    if ((await n("SELECT COUNT(*) n FROM kb_revisions WHERE author_id=$1 AND status='pending'", [user.id])) >= 10) throw E.conflict("لديك ١٠ مساهمات بانتظار المراجعة؛ انتظر قرارها أولاً");
    const f = fields(b), aid = id("kb"), t = iso(), minor = await isMinor(user.id), direct = !minor && (await isReviewer(user));
    await db.run("INSERT INTO kb_articles(id,title,summary,body,category,tags,license,status,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'review',$8,$9,$9)", [aid, f.title, f.summary, f.body, f.category, JSON.stringify(f.tags), license, user.id, t]);
    const rid = id("kbr");
    await db.run("INSERT INTO kb_revisions(id,article_id,base,author_id,title,summary,body,category,tags,sources,note,status,minor,size,created_at) VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12,$13)", [rid, aid, user.id, f.title, f.summary, f.body, f.category, JSON.stringify(f.tags), JSON.stringify(f.sources), str(b.note, 300) || "النسخة الأولى", minor ? 1 : 0, f.body.length, t]);
    if (direct) await approve(user, rid, { self: true });
    return { id: aid, revision: rid, state: direct ? "published" : "review" };
  }
  async function proposeEdit(user, aid, b = {}) {
    if (!rl.hit("default", "kbedit:" + user.id)) throw E.rate();
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a) throw E.nf();
    const v = await viewerCtx(user); if (!visible(a, v) || a.status !== "published") throw E.nf();
    if (!b.agree) throw fail(400, "license_required", "يلزم الموافقة على ترخيص المساهمة");
    if (Number(b.base) !== Number(a.rev)) throw fail(409, "stale", "تغيّرت المقالة منذ بدأت التعديل؛ افتح النسخة الحالية وأعد تعديلك");
    if (await db.get("SELECT 1 x FROM kb_revisions WHERE article_id=$1 AND author_id=$2 AND status='pending'", [aid, user.id])) throw E.conflict("لديك تعديل بانتظار المراجعة على هذه المقالة");
    const cur = await db.get("SELECT sources FROM kb_revisions WHERE article_id=$1 AND n=$2", [aid, a.rev]);
    const f = fields(b, { ...a, sources: cur?.sources }); const note = str(b.note, 300, { required: true, min: 3 });
    if (f.title === a.title && (f.summary || "") === (a.summary || "") && f.body === a.body && f.category === a.category && JSON.stringify(f.tags) === (a.tags || "[]") && JSON.stringify(f.sources) === (cur?.sources || "[]")) throw E.bad("لم يتغيّر شيء");
    const rid = id("kbr"), minor = v.minor;
    await db.run("INSERT INTO kb_revisions(id,article_id,base,author_id,title,summary,body,category,tags,sources,note,status,minor,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14)", [rid, aid, a.rev, user.id, f.title, f.summary, f.body, f.category, JSON.stringify(f.tags), JSON.stringify(f.sources), note, minor ? 1 : 0, f.body.length - String(a.body).length, iso()]);
    if (!minor && v.reviewer) { await approve(user, rid, { self: true }); return { revision: rid, state: "approved" }; }
    return { revision: rid, state: "pending" };
  }
  async function withdraw(user, rid) {
    const r = await db.run("UPDATE kb_revisions SET status='withdrawn', decided_at=$1 WHERE id=$2 AND author_id=$3 AND status='pending'", [iso(), rid, user.id]); if (!r.changes) throw E.nf();
    const rev = await db.get("SELECT article_id FROM kb_revisions WHERE id=$1", [rid]);
    const a = await db.get("SELECT status, rev FROM kb_articles WHERE id=$1", [rev.article_id]);
    if (a && a.status === "review" && !Number(a.rev)) await db.run("UPDATE kb_articles SET status='archived', updated_at=$1 WHERE id=$2", [iso(), rev.article_id]);
    return { ok: true };
  }

  /* ---------- review ---------- */
  async function needReviewer(user) { if (!(await isReviewer(user))) throw E.forbid("للمراجعين فقط"); }
  async function approve(user, rid, { self = false, reason } = {}) {
    if (!self) await needReviewer(user);
    const r = await db.get("SELECT * FROM kb_revisions WHERE id=$1", [rid]); if (!r) throw E.nf(); if (r.status !== "pending") throw E.conflict("تمت مراجعة هذه النسخة");
    if (!self && r.author_id === user.id && user.role !== "admin") throw E.forbid("لا تراجع مساهمتك بنفسك");
    const t = iso();
    const ok = await db.tx(async (tx) => {
      const a = await tx.get("SELECT * FROM kb_articles WHERE id=$1", [r.article_id]);
      if (Number(r.base) !== Number(a.rev)) return "stale";
      const nn = Number(a.rev) + 1;
      const ch = await tx.run("UPDATE kb_revisions SET status='approved', n=$1, reviewer_id=$2, reason=$3, decided_at=$4 WHERE id=$5 AND status='pending'", [nn, user.id, reason || null, t, rid]); if (!ch.changes) return "done";
      await tx.run("UPDATE kb_articles SET title=$1, summary=$2, body=$3, category=$4, tags=$5, rev=$6, status=CASE WHEN status='review' THEN 'published' ELSE status END, published_at=COALESCE(published_at,$7), updated_at=$7 WHERE id=$8", [r.title, r.summary, r.body, r.category, r.tags, nn, t, r.article_id]);
      return a;
    });
    if (ok === "stale") throw fail(409, "stale", "كُتبت هذه النسخة على نسخة أقدم من الحالية؛ ارفضها واطلب من المساهم إعادة التعديل");
    if (ok === "done") throw E.conflict("تمت مراجعة هذه النسخة");
    if (!self) await notify(r.author_id, "kb_decision", r.article_id, user.id);
    if (ok.created_by !== r.author_id && Number(r.base) > 0) await notify(ok.created_by, "kb_edited", r.article_id, r.author_id);
    return { ok: true };
  }
  async function reject(user, rid, b = {}) {
    await needReviewer(user);
    const reason = str(b.reason, 400, { required: true, min: 3 });
    const r = await db.get("SELECT * FROM kb_revisions WHERE id=$1", [rid]); if (!r) throw E.nf();
    const ch = await db.run("UPDATE kb_revisions SET status='rejected', reviewer_id=$1, reason=$2, decided_at=$3 WHERE id=$4 AND status='pending'", [user.id, reason, iso(), rid]); if (!ch.changes) throw E.conflict("تمت مراجعة هذه النسخة");
    const a = await db.get("SELECT status, rev FROM kb_articles WHERE id=$1", [r.article_id]);
    if (a.status === "review" && !Number(a.rev) && !(await db.get("SELECT 1 x FROM kb_revisions WHERE article_id=$1 AND status='pending'", [r.article_id]))) await db.run("UPDATE kb_articles SET status='archived', updated_at=$1 WHERE id=$2", [iso(), r.article_id]);
    await notify(r.author_id, "kb_decision", r.article_id, user.id);
    return { ok: true };
  }
  async function revert(user, aid, b = {}) {
    await needReviewer(user);
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a || a.status === "review") throw E.nf();
    const old = await db.get("SELECT * FROM kb_revisions WHERE article_id=$1 AND n=$2 AND status='approved'", [aid, Number(b.n)]); if (!old) throw E.nf("النسخة غير موجودة");
    if (Number(old.n) === Number(a.rev)) throw E.bad("هذه هي النسخة الحالية");
    const rid = id("kbr");
    await db.run("INSERT INTO kb_revisions(id,article_id,base,author_id,title,summary,body,category,tags,sources,note,status,size,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13)", [rid, aid, a.rev, user.id, old.title, old.summary, old.body, old.category, old.tags, old.sources, `استرجاع النسخة ${old.n}${b.reason ? " — " + String(b.reason).slice(0, 200) : ""}`, old.body.length - String(a.body).length, iso()]);
    await approve(user, rid, { self: true });
    ctx.audit?.("kb_revert", aid, `→ ${old.n}`, user.id);
    return articleView(user, aid, { count: false });
  }
  async function queue(user) {
    await needReviewer(user);
    const rows = await db.all("SELECT r.*, a.title atitle, a.rev arev, a.status astatus, a.license FROM kb_revisions r JOIN kb_articles a ON a.id=r.article_id WHERE r.status='pending' ORDER BY r.created_at LIMIT 200");
    const us = await usersOf(rows.map((r) => r.author_id));
    const reps = await db.all("SELECT * FROM kb_reports WHERE status='open' ORDER BY created_at LIMIT 200");
    const ra = await db.all(`SELECT id, title, flagged FROM kb_articles WHERE id IN (${reps.length ? ph(reps.map((r) => r.article_id)) : "''"})`, reps.map((r) => r.article_id));
    return { revisions: rows.map((r) => ({ id: r.id, article: { id: r.article_id, title: r.atitle, status: r.astatus, isNew: !Number(r.arev) }, title: r.title, note: r.note || "", size: Number(r.size), minor: !!Number(r.minor), stale: Number(r.base) !== Number(r.arev), at: r.created_at, author: (() => { const u = us.find((x) => x.id === r.author_id); return u ? { id: u.id, name: u.name, handle: u.handle } : null; })() })),
      reports: reps.map((r) => ({ id: r.id, article: { id: r.article_id, title: ra.find((x) => x.id === r.article_id)?.title || "", flagged: !!Number(ra.find((x) => x.id === r.article_id)?.flagged) }, reason: REASONS[r.reason] || r.reason, note: r.note || "", at: r.created_at })) };
  }
  async function revisionView(viewer, rid) {
    const r = await db.get("SELECT * FROM kb_revisions WHERE id=$1", [rid]); if (!r) throw E.nf();
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [r.article_id]);
    const v = await viewerCtx(viewer);
    const own = viewer && r.author_id === viewer.id;
    if (r.status !== "approved" && !own && !v.reviewer) throw E.nf();
    if (r.status === "approved" && !visible(a, v)) throw E.nf();
    const prev = r.status === "approved" ? await db.get("SELECT body FROM kb_revisions WHERE article_id=$1 AND status='approved' AND n<$2 ORDER BY n DESC LIMIT 1", [a.id, r.n]) : await db.get("SELECT body FROM kb_revisions WHERE article_id=$1 AND n=$2", [a.id, r.base]);
    const us = await usersOf([r.author_id]), minors = await minorsOf([r.author_id]);
    return { revision: { id: r.id, n: r.n === null || r.n === undefined ? null : Number(r.n), base: Number(r.base), title: r.title, summary: r.summary || "", body: r.body, category: { key: r.category, label: CATS[r.category] }, tags: parse(r.tags, []), sources: parse(r.sources, []), note: r.note || "", status: r.status, statusLabel: R_STATUS[r.status], reason: own || v.reviewer ? r.reason || null : null, size: Number(r.size), at: r.created_at, decidedAt: r.decided_at || null, author: pub(us[0], v.reviewer ? null : minors), stale: r.status === "pending" && Number(r.base) !== Number(a.rev) },
      article: { id: a.id, title: a.title, rev: Number(a.rev), license: lic(a.license) }, diff: diff(prev?.body || "", r.body), me: { reviewer: v.reviewer, own: !!own } };
  }
  async function history(viewer, aid) {
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a) throw E.nf();
    const v = await viewerCtx(viewer); if (!visible(a, v)) throw E.nf();
    const rows = await db.all("SELECT id, n, author_id, note, size, created_at, decided_at, status FROM kb_revisions WHERE article_id=$1 AND (status='approved'" + (v.reviewer ? " OR status='pending'" : "") + ") ORDER BY COALESCE(n, 999999) DESC, created_at DESC LIMIT 300", [aid]);
    const us = await usersOf(rows.map((r) => r.author_id)), minors = v.reviewer ? null : await minorsOf(rows.map((r) => r.author_id));
    return { article: await card(a), revisions: rows.map((r) => ({ id: r.id, n: r.n === null || r.n === undefined ? null : Number(r.n), status: r.status, statusLabel: R_STATUS[r.status], note: r.note || "", size: Number(r.size), at: r.decided_at || r.created_at, current: Number(r.n) === Number(a.rev), author: pub(us.find((u) => u.id === r.author_id), minors) })), me: { reviewer: v.reviewer } };
  }
  /** line diff (LCS) between two texts; equal runs longer than 6 lines are collapsed to their ends */
  function diff(x, y) {
    const A0 = String(x).split("\n"), B0 = String(y).split("\n");
    if (A0.length * B0.length > 250000) return { ops: [{ op: "-", t: `(${A0.length} سطراً)` }, { op: "+", t: `(${B0.length} سطراً)` }], added: B0.length, removed: A0.length, big: true };
    const m = A0.length, k = B0.length, L = Array.from({ length: m + 1 }, () => new Uint16Array(k + 1));
    for (let i = m - 1; i >= 0; i--) for (let j = k - 1; j >= 0; j--) L[i][j] = A0[i] === B0[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = []; let i = 0, j = 0, added = 0, removed = 0;
    while (i < m && j < k) { if (A0[i] === B0[j]) { ops.push({ op: "=", t: A0[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ op: "-", t: A0[i++] }); removed++; } else { ops.push({ op: "+", t: B0[j++] }); added++; } }
    while (i < m) { ops.push({ op: "-", t: A0[i++] }); removed++; } while (j < k) { ops.push({ op: "+", t: B0[j++] }); added++; }
    const out = []; let run = [];
    const flush = () => { if (run.length > 6) { out.push(...run.slice(0, 2), { op: "~", t: `${run.length - 4} سطراً دون تغيير` }, ...run.slice(-2)); } else out.push(...run); run = []; };
    for (const o of ops) { if (o.op === "=") run.push(o); else { flush(); out.push(o); } } flush();
    return { ops: out, added, removed };
  }

  /* ---------- feedback, reports, staff ---------- */
  async function vote(user, aid, b = {}) {
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a || !visible(a, await viewerCtx(user)) || a.status !== "published") throw E.nf();
    const val = Math.sign(Number(b.vote) || 0);
    if (!val) await db.run("DELETE FROM kb_votes WHERE article_id=$1 AND user_id=$2", [aid, user.id]);
    else await db.run("INSERT INTO kb_votes(article_id,user_id,vote,created_at) VALUES($1,$2,$3,$4) ON CONFLICT (article_id, user_id) DO UPDATE SET vote=EXCLUDED.vote", [aid, user.id, val, iso()]);
    return { helpful: await helpfulOf(aid), vote: val };
  }
  async function report(user, aid, b = {}) {
    if (!rl.hit("report", "kbrep:" + user.id)) throw E.rate();
    const reason = oneOf(b.reason, Object.keys(REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a || !visible(a, await viewerCtx(user))) throw E.nf();
    if (a.created_by === user.id) throw E.bad("لا يمكنك الإبلاغ عن مقالتك");
    const r = await db.run("INSERT INTO kb_reports(id,article_id,by_user,reason,note,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6) ON CONFLICT DO NOTHING", [id("kbp"), aid, user.id, reason, str(b.note, 600), iso()]);
    if (!r.changes) throw E.conflict("سبق أن أبلغت عن هذه المقالة");
    if ((await n("SELECT COUNT(*) n FROM kb_reports WHERE article_id=$1 AND status='open'", [aid])) >= FLAG_AT) await db.run("UPDATE kb_articles SET flagged=1 WHERE id=$1 AND flagged=0", [aid]);
    return { ok: true };
  }
  async function closeReport(user, rid, b = {}) {
    await needReviewer(user);
    const r = await db.get("SELECT * FROM kb_reports WHERE id=$1 AND status='open'", [rid]); if (!r) throw E.nf();
    await db.run("UPDATE kb_reports SET status=$1, decided_at=$2 WHERE id=$3", [b.action === "action" ? "actioned" : "dismissed", iso(), rid]);
    if ((await n("SELECT COUNT(*) n FROM kb_reports WHERE article_id=$1 AND status='open'", [r.article_id])) < FLAG_AT) await db.run("UPDATE kb_articles SET flagged=0 WHERE id=$1", [r.article_id]);
    ctx.audit?.("kb_report_" + (b.action === "action" ? "actioned" : "dismissed"), rid, r.article_id, user.id);
    return { ok: true };
  }
  async function moderate(user, aid, b = {}) {
    const a = await db.get("SELECT * FROM kb_articles WHERE id=$1", [aid]); if (!a) throw E.nf();
    const action = oneOf(b.action, ["hide", "restore", "archive", "sensitive", "unsensitive", "unflag"], null); if (!action) throw E.bad();
    const reason = str(b.reason, 400, { required: ["hide", "archive"].includes(action), min: 3 }), t = iso();
    if (action === "hide") await db.run("UPDATE kb_articles SET status='hidden', hidden_reason=$1, updated_at=$2 WHERE id=$3", [reason, t, aid]);
    else if (action === "archive") await db.run("UPDATE kb_articles SET status='archived', hidden_reason=$1, updated_at=$2 WHERE id=$3", [reason, t, aid]);
    else if (action === "restore") { if (!Number(a.rev)) throw E.conflict("لا نسخة معتمدة لهذه المقالة"); await db.run("UPDATE kb_articles SET status='published', hidden_reason=NULL, updated_at=$1 WHERE id=$2", [t, aid]); }
    else if (action === "unflag") { await db.run("UPDATE kb_articles SET flagged=0 WHERE id=$1", [aid]); await db.run("UPDATE kb_reports SET status='dismissed', decided_at=$1 WHERE article_id=$2 AND status='open'", [t, aid]); }
    else await db.run("UPDATE kb_articles SET sensitive=$1 WHERE id=$2", [action === "sensitive" ? 1 : 0, aid]);
    ctx.audit?.("kb_" + action, aid, reason || a.title, user.id);
    return { ok: true };
  }
  async function adminView() {
    const reviewers = await db.all("SELECT r.user_id, r.created_at, u.name, u.handle FROM kb_reviewers r LEFT JOIN users u ON u.id=r.user_id ORDER BY r.created_at");
    const hidden = await db.all("SELECT * FROM kb_articles WHERE status IN ('hidden','archived') OR flagged=1 OR sensitive=1 ORDER BY updated_at DESC LIMIT 200");
    const hs = []; for (const a of hidden) hs.push(await card(a, { reason: a.hidden_reason || null }));
    return { totals: { published: await n("SELECT COUNT(*) n FROM kb_articles WHERE status='published'"), pending: await n("SELECT COUNT(*) n FROM kb_revisions WHERE status='pending'"), reports: await n("SELECT COUNT(*) n FROM kb_reports WHERE status='open'"), reviewers: reviewers.length },
      reviewers: reviewers.map((r) => ({ id: r.user_id, name: r.name, handle: r.handle, since: r.created_at })), articles: hs };
  }
  async function setReviewer(by, b = {}) {
    const u = await db.get("SELECT id, status FROM users WHERE LOWER(handle)=LOWER($1)", [String(b.handle || "").replace(/^@/, "")]); if (!u || u.status !== "active") throw E.nf("الحساب غير موجود");
    if (b.remove) await db.run("DELETE FROM kb_reviewers WHERE user_id=$1", [u.id]);
    else { if (await isMinor(u.id)) throw fail(403, "minor_restricted", "المراجعون من البالغين فقط"); await db.run("INSERT INTO kb_reviewers(user_id,granted_by,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [u.id, by.id, iso()]); await notify(u.id, "kb_reviewer", null, by.id); }
    ctx.audit?.(b.remove ? "kb_reviewer_removed" : "kb_reviewer_added", u.id, "", by.id);
    return adminView();
  }
  async function mine(user) {
    const arts = await db.all("SELECT * FROM kb_articles WHERE created_by=$1 ORDER BY updated_at DESC LIMIT 100", [user.id]);
    const revs = await db.all("SELECT r.id, r.article_id, r.n, r.status, r.note, r.reason, r.created_at, r.decided_at, a.title FROM kb_revisions r JOIN kb_articles a ON a.id=r.article_id WHERE r.author_id=$1 ORDER BY r.created_at DESC LIMIT 100", [user.id]);
    const as = []; for (const a of arts) as.push(await card(a));
    return { articles: as, revisions: revs.map((r) => ({ id: r.id, article: { id: r.article_id, title: r.title }, n: r.n === null || r.n === undefined ? null : Number(r.n), status: r.status, statusLabel: R_STATUS[r.status], note: r.note || "", reason: r.reason || null, at: r.created_at })), approved: revs.filter((r) => r.status === "approved").length, reviewer: await isReviewer(user) };
  }

  /* ---------- routes ---------- */
  R.get("/api/knowledge", async (req) => list(req.user || null, req.query || {}));
  R.post("/api/knowledge", A(async (req) => createArticle(req.user, req.body || {})));
  R.get("/api/knowledge/me", A(async (req) => mine(req.user)));
  R.get("/api/knowledge/review", A(async (req) => queue(req.user)));
  R.get("/api/knowledge/articles/:id", async (req) => articleView(req.user || null, req.params.id));
  R.get("/api/knowledge/articles/:id/history", async (req) => history(req.user || null, req.params.id));
  R.post("/api/knowledge/articles/:id/edits", A(async (req) => proposeEdit(req.user, req.params.id, req.body || {})));
  R.post("/api/knowledge/articles/:id/vote", A(async (req) => vote(req.user, req.params.id, req.body || {})));
  R.post("/api/knowledge/articles/:id/report", A(async (req) => report(req.user, req.params.id, req.body || {})));
  R.post("/api/knowledge/articles/:id/revert", A(async (req) => revert(req.user, req.params.id, req.body || {})));
  R.get("/api/knowledge/revisions/:id", async (req) => revisionView(req.user || null, req.params.id));
  R.post("/api/knowledge/revisions/:id/approve", A(async (req) => approve(req.user, req.params.id, { reason: str((req.body || {}).reason, 400) })));
  R.post("/api/knowledge/revisions/:id/reject", A(async (req) => reject(req.user, req.params.id, req.body || {})));
  R.post("/api/knowledge/revisions/:id/withdraw", A(async (req) => withdraw(req.user, req.params.id)));
  R.post("/api/knowledge/reports/:id", A(async (req) => closeReport(req.user, req.params.id, req.body || {})));
  R.get("/api/admin/knowledge", admin(async () => adminView()));
  R.post("/api/admin/knowledge/reviewers", admin(async (req) => setReviewer(req.user, req.body || {})));
  R.post("/api/admin/knowledge/articles/:id", admin(async (req) => moderate(req.user, req.params.id, req.body || {})));

  return { diff, CATS, LICENSES };
};
