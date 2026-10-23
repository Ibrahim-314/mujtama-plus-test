/* Professional profile & CV «الملف المهني والسيرة الذاتية» (phase 76). No keys, no payments.
 *  1. One professional profile per member, separate from the social profile: headline, about, city / country, what they are
 *     open to (a job, freelance projects, hiring, mentoring, volunteering), languages with level, links (http/https only).
 *  2. Entries: experience, education, portfolio (a link and/or one of the member's own published posts), volunteering and
 *     awards — dates as YYYY-MM with «حتى الآن», reorderable. Up to 30 skills with level (1–5) and years. Verified
 *     certificates (phase 73, incl. volunteer hours of phase 70) the member already shows publicly are listed with their
 *     verification link; a mentor profile (phase 74) is linked.
 *  3. Privacy: whole-profile visibility public | members | followers | private, plus a stricter per-section setting;
 *     the talent directory lists only profiles that opted in (public or members). Blocked members see nothing. The owner
 *     can preview the profile as a stranger, a member or a follower would see it.
 *  4. Export: a printable Arabic RTL CV page at /cv/<handle> (A4 print stylesheet → «حفظ PDF» from the browser), the same
 *     viewer rules; JSON export in the open JSON Resume format (data portability).
 *  5. Talent directory: Arabic-normalised search on headline, about, skills and city, filters (open to, skill, city).
 *  6. Safety: reports (fake credentials, impersonation, scam, inappropriate); PRO_FLAG_REPORTS (3) open reports take the
 *     profile out of the directory until staff decide; staff hide / restore (audited, owner notified).
 *  7. Minors (phase 35): may build a CV (students) but it is never public or listed — visibility at most followers — and
 *     they cannot advertise paid work (open to: mentoring / volunteering only). */
const { E, str, oneOf, id } = require("../lib/core");
const { normalize } = require("../lib/arabic");
const { SEC_HEADERS } = require("../lib/http");

const OPEN = { jobs: "وظيفة", freelance: "عمل حر ومشاريع", hiring: "أوظّف الآن", mentoring: "إرشاد وتعاون", volunteer: "تطوّع" };
const MINOR_OPEN = ["mentoring", "volunteer"];
const KINDS = { experience: "الخبرات", education: "التعليم", portfolio: "معرض الأعمال", volunteering: "التطوّع", award: "الجوائز والإنجازات" };
const SECTIONS = { about: "نبذة", experience: "الخبرات", education: "التعليم", skills: "المهارات", portfolio: "معرض الأعمال", volunteering: "التطوّع", award: "الجوائز والإنجازات", languages: "اللغات", links: "الروابط", certificates: "الشهادات الموثّقة" };
const VIS = { public: "الجميع", members: "أعضاء مجتمع بلس", followers: "متابعيّ فقط", private: "أنا فقط" };
const RANK = { public: 0, members: 1, followers: 2, private: 3 };
const LEVELS = { native: "اللغة الأم", fluent: "طلاقة", good: "جيد", basic: "مبتدئ" };
const REASONS = { fake: "بيانات أو شهادات مزيّفة", impersonation: "انتحال شخصية", scam: "احتيال أو طلب أموال", inappropriate: "محتوى غير لائق", other: "سبب آخر" };
const YM = /^(19[5-9]\d|20\d\d)-(0[1-9]|1[0-2])$/;
const MAX_ITEMS = 30, MAX_SKILLS = 30;

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const FLAG_AT = +(env.PRO_FLAG_REPORTS || 3);
  const admin = (fn) => A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req); });
  const notify = async (uid, kind, ref, actor = null) => { try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : status === 404 ? E.nf(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : d; } catch { return d; } };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ymNow = () => iso().slice(0, 7);
  const isoOf = (v) => { try { return v ? new Date(v).toISOString() : null; } catch { return null; } };

  async function blockedBetween(a, b) {
    if (!a || !b) return false;
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    const pa = parse(ua?.prefs, {}), pb = parse(ub?.prefs, {});
    if ((pa.blocked || []).includes(b) || (pb.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  const userByHandle = (h) => db.get("SELECT id, name, handle, color, avatar, verified, role, status FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [String(h || "").replace(/^@/, "")]);
  const pubUser = (u) => ({ id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null });

  /* ---------- validation ---------- */
  function urlOk(s) { try { const x = new URL(String(s).trim()); return ["https:", "http:"].includes(x.protocol) && x.hostname.includes(".") ? x.toString().slice(0, 300) : null; } catch { return null; } }
  function cleanList(v, max) { return (Array.isArray(v) ? v : String(v || "").split(/[,،\n]/)).map((x) => (typeof x === "string" ? x.trim() : x)).filter(Boolean).slice(0, max); }
  async function profileFields(b, prev, minor) {
    const headline = str(b.headline ?? prev?.headline, 120, { required: true, min: 3 });
    const about = str(b.about ?? prev?.about ?? undefined, 2600);
    const city = str(b.city ?? prev?.city ?? undefined, 60), country = str(b.country ?? prev?.country ?? undefined, 60);
    const openIn = b.openTo !== undefined ? cleanList(b.openTo, 5) : parse(prev?.open_to, []);
    const openTo = [...new Set(openIn.filter((k) => OPEN[k]))];
    if (minor && openTo.some((k) => !MINOR_OPEN.includes(k))) throw fail(403, "minor_restricted", "الحسابات دون ١٨ سنة لا تعرض عملاً مدفوعاً؛ اختر الإرشاد أو التطوّع");
    const langIn = b.languages !== undefined ? (Array.isArray(b.languages) ? b.languages : []) : parse(prev?.languages, []);
    if (langIn.length > 8) throw E.bad("حتى ٨ لغات");
    const languages = langIn.map((l) => ({ name: str(String(l?.name ?? ""), 30, { required: true, min: 2 }), level: oneOf(l?.level, Object.keys(LEVELS), "good") }));
    const linkIn = b.links !== undefined ? (Array.isArray(b.links) ? b.links : []) : parse(prev?.links, []);
    if (linkIn.length > 6) throw E.bad("حتى ٦ روابط");
    const links = linkIn.map((l) => { const url = urlOk(l?.url); if (!url) throw fail(400, "bad_link", "رابط غير صالح (يبدأ بـ https://)"); return { label: str(l?.label ? String(l.label) : undefined, 40) || new URL(url).hostname, url }; });
    const visibility = oneOf(b.visibility ?? prev?.visibility, Object.keys(VIS), "members");
    if (minor && RANK[visibility] < RANK.followers) throw fail(403, "minor_restricted", "ملف من هم دون ١٨ سنة لا يكون عاماً؛ اختر «متابعيّ فقط» أو «أنا فقط»");
    const secIn = b.sections !== undefined ? (b.sections && typeof b.sections === "object" ? b.sections : {}) : parse(prev?.sections, {});
    const sections = {}; for (const [k, v] of Object.entries(secIn)) if (SECTIONS[k] && VIS[v] && v !== "public") sections[k] = v; // a section can only be stricter
    const searchable = minor ? 0 : (b.searchable !== undefined ? (b.searchable ? 1 : 0) : prev ? Number(prev.searchable) : 1);
    const showCerts = b.showCerts !== undefined ? (b.showCerts ? 1 : 0) : prev ? Number(prev.show_certs) : 1;
    return { headline, about, city, country, openTo, languages, links, visibility, sections, searchable, showCerts };
  }
  async function itemFields(user, b, prev) {
    const kind = prev ? prev.kind : oneOf(b.kind, Object.keys(KINDS), null); if (!kind) throw E.bad("نوع غير معروف");
    const title = str(b.title ?? prev?.title, 120, { required: true, min: 2 });
    const org = str(b.org ?? prev?.org ?? undefined, 120), place = str(b.place ?? prev?.place ?? undefined, 120);
    const body = str(b.body ?? prev?.body ?? undefined, 2000);
    const current = b.current !== undefined ? (b.current ? 1 : 0) : prev ? Number(prev.current) : 0;
    const start = b.start !== undefined ? (b.start || null) : prev?.start_ym || null, end = current ? null : (b.end !== undefined ? (b.end || null) : prev?.end_ym || null);
    for (const v of [start, end]) if (v && (!YM.test(v) || v > ymNow())) throw fail(400, "bad_date", "تاريخ غير صالح (شهر وسنة، وليس في المستقبل)");
    if (start && end && end < start) throw fail(400, "bad_date", "تاريخ الانتهاء قبل البداية");
    if (["experience", "education"].includes(kind) && !start) throw fail(400, "bad_date", "أضف تاريخ البداية");
    let url = b.url !== undefined ? b.url : prev?.url || null; if (url) { url = urlOk(url); if (!url) throw fail(400, "bad_link", "رابط غير صالح (يبدأ بـ https://)"); }
    let postId = b.postId !== undefined ? (b.postId || null) : prev?.post_id || null;
    if (postId) { if (kind !== "portfolio") postId = null; else { const p = await db.get("SELECT author, status FROM posts WHERE id=$1", [String(postId)]); if (!p || p.author !== user.id || p.status !== "published") throw fail(400, "bad_post", "اختر منشوراً منشوراً من منشوراتك"); } }
    return { kind, title, org, place, body, current, start, end, url: url || null, postId };
  }

  /* ---------- reads ---------- */
  const profileRow = (uid) => db.get("SELECT * FROM pro_profiles WHERE user_id=$1", [uid]);
  async function canSee(level, owner, viewer) {
    if (viewer && (viewer.id === owner || viewer.role === "admin")) return true;
    if (level === "public") return true;
    if (level === "members") return !!viewer;
    if (level === "followers") return !!viewer && (await ctx.policy.follows(viewer.id, owner));
    return false;
  }
  /** the viewer the owner previews as: stranger | member | follower */
  function previewViewer(as) { return as === "stranger" ? null : as === "member" ? { id: "_preview", role: "user" } : as === "follower" ? { id: "_preview", role: "user", follower: true } : undefined; }
  async function seeAs(level, owner, viewer) { if (viewer && viewer.id === "_preview") return level === "public" || level === "members" || (level === "followers" && !!viewer.follower); return canSee(level, owner, viewer); }
  const itemClient = (r) => ({ id: r.id, kind: r.kind, title: r.title, org: r.org || null, place: r.place || null, start: r.start_ym || null, end: r.end_ym || null, current: !!Number(r.current), body: r.body || "", url: r.url || null, postId: r.post_id || null });
  async function certsOf(u) { try { return (await ctx.services.certs?.onProfile?.(u.handle))?.certificates || []; } catch { return []; } }
  async function mentorOf(uid) { try { const m = await db.get("SELECT headline FROM mentor_profiles WHERE user_id=$1 AND status='active'", [uid]); return m ? { headline: m.headline } : null; } catch { return null; } }
  async function repOf(uid) { try { return (await ctx.services.proreviews?.card?.(uid)) || null; } catch { return null; } }
  async function openReports(uid) { return Number((await db.get("SELECT COUNT(*) n FROM pro_reports WHERE user_id=$1 AND status='open'", [uid]))?.n || 0); }

  function completeness(p, items, skills) {
    const has = (k) => items.some((i) => i.kind === k);
    const checks = [["headline", !!p?.headline, "اكتب عنواناً مهنياً واضحاً"], ["about", (p?.about || "").length >= 80, "اكتب نبذة من ٨٠ حرفاً على الأقل"], ["experience", has("experience") || has("education"), "أضف خبرة أو مؤهلاً دراسياً"],
      ["skills", skills.length >= 3, "أضف ٣ مهارات على الأقل"], ["portfolio", has("portfolio"), "أضف عملاً واحداً إلى معرض أعمالك"], ["location", !!(p?.city || p?.country), "أضف مدينتك أو بلدك"],
      ["languages", parse(p?.languages, []).length > 0, "أضف اللغات التي تتقنها"], ["open", parse(p?.open_to, []).length > 0, "حدّد ما أنت منفتح عليه"]];
    const done = checks.filter((c) => c[1]).length;
    return { percent: Math.round((done / checks.length) * 100), missing: checks.filter((c) => !c[1]).map((c) => ({ key: c[0], text: c[2] })) };
  }

  /** the professional profile as `viewer` may see it (null when nothing is visible) */
  async function build(u, viewer, { preview } = {}) {
    const p = await profileRow(u.id); if (!p) return null;
    const self = !!viewer && viewer.id === u.id, staff = viewer?.role === "admin";
    const as = preview !== undefined ? preview : viewer;
    if (Number(p.hidden) && !self && !staff) return null;
    if (!(await seeAs(p.visibility, u.id, as))) return { locked: true, visibility: p.visibility, user: pubUser(u), headline: p.visibility === "private" ? null : p.headline };
    const secs = parse(p.sections, {});
    const lvl = (k) => (RANK[secs[k] || "public"] > RANK[p.visibility] ? secs[k] : p.visibility);
    const vis = {}; for (const k of Object.keys(SECTIONS)) vis[k] = await seeAs(lvl(k), u.id, as);
    const items = (await db.all("SELECT * FROM pro_items WHERE user_id=$1 ORDER BY kind, pos, start_ym DESC", [u.id])).map(itemClient);
    const skills = (await db.all("SELECT name, norm, level, years FROM pro_skills WHERE user_id=$1 ORDER BY pos, name", [u.id])).map((s) => ({ name: s.name, key: s.norm, level: Number(s.level), years: s.years === null || s.years === undefined ? null : Number(s.years) }));
    const sec = {}; for (const k of Object.keys(KINDS)) sec[k] = vis[k] ? items.filter((i) => i.kind === k) : null;
    // portfolio posts: title + first image for the cards
    const pids = (sec.portfolio || []).map((i) => i.postId).filter(Boolean);
    const posts = {}; for (const pid of pids) { const r = await db.get("SELECT id, type, data, text FROM posts WHERE id=$1 AND status='published'", [pid]); if (r) { const d = parse(r.data, {}); posts[pid] = { id: r.id, title: (d.title || r.text || "").slice(0, 90), image: (d.images && d.images[0]) || null, type: r.type }; } }
    if (sec.portfolio) for (const i of sec.portfolio) i.post = i.postId ? posts[i.postId] || null : null;
    return {
      user: pubUser(u), self, staff, hidden: !!Number(p.hidden), hiddenReason: self || staff ? p.hidden_reason || null : undefined,
      profile: { headline: p.headline, about: vis.about ? p.about || "" : null, city: p.city || null, country: p.country || null, openTo: parse(p.open_to, []).map((k) => ({ key: k, label: OPEN[k] })),
        languages: vis.languages ? parse(p.languages, []).map((l) => ({ ...l, levelLabel: LEVELS[l.level] })) : null, links: vis.links ? parse(p.links, []) : null, updatedAt: isoOf(p.updated_at),
        visibility: self || staff ? p.visibility : undefined, views: self ? Number(p.views || 0) : undefined },
      sections: sec, skills: vis.skills ? skills : null,
      certificates: vis.certificates && Number(p.show_certs) ? (await certsOf(u)).map((c) => ({ code: c.code, kind: c.kind, title: c.title, issuer: c.issuer || c.issuerName || c.issuer_name || null, issuedAt: c.issuedAt || c.issued_at || null, url: "/cert/" + c.code })) : null,
      mentor: await mentorOf(u.id), cvUrl: "/cv/" + encodeURIComponent(u.handle),
      reputation: await repOf(u.id) // phase 80
    };
  }

  const seen = new Set();
  async function view(viewer, handle, q = {}) {
    const u = await userByHandle(handle); if (!u) throw E.nf();
    if (viewer && viewer.id !== u.id && (await blockedBetween(viewer.id, u.id))) throw E.nf();
    const self = viewer?.id === u.id;
    const preview = self && q.as ? previewViewer(String(q.as)) : undefined;
    const v = await build(u, viewer, { preview });
    if (!v) throw fail(404, "no_profile", "لا يوجد ملف مهني لهذا العضو");
    if (viewer && !self && !v.locked) { const k = viewer.id + ":" + u.id; if (!seen.has(k)) { if (seen.size > 20000) seen.clear(); seen.add(k); await db.run("UPDATE pro_profiles SET views=views+1 WHERE user_id=$1", [u.id]); } }
    if (preview !== undefined) { v.preview = q.as; v.self = false; }
    return v;
  }
  async function mine(user) {
    const p = await profileRow(user.id), minor = await isMinor(user.id);
    const items = (await db.all("SELECT * FROM pro_items WHERE user_id=$1 ORDER BY kind, pos, start_ym DESC", [user.id])).map(itemClient);
    const skills = (await db.all("SELECT name, norm, level, years FROM pro_skills WHERE user_id=$1 ORDER BY pos, name", [user.id])).map((s) => ({ name: s.name, key: s.norm, level: Number(s.level), years: s.years === null || s.years === undefined ? null : Number(s.years) }));
    const certs = await certsOf({ handle: user.handle });
    return {
      profile: p ? { headline: p.headline, about: p.about || "", city: p.city || "", country: p.country || "", openTo: parse(p.open_to, []), languages: parse(p.languages, []), links: parse(p.links, []), visibility: p.visibility,
        sections: parse(p.sections, {}), searchable: !!Number(p.searchable), showCerts: !!Number(p.show_certs), hidden: !!Number(p.hidden), hiddenReason: p.hidden_reason || null, views: Number(p.views || 0), updatedAt: p.updated_at } : null,
      items, skills, certificates: certs.length, completeness: completeness(p, items, skills), minor,
      options: { openTo: Object.entries(OPEN).filter(([k]) => !minor || MINOR_OPEN.includes(k)).map(([key, label]) => ({ key, label })), kinds: KINDS, sections: SECTIONS, visibility: Object.entries(VIS).filter(([k]) => !minor || RANK[k] >= RANK.followers).map(([key, label]) => ({ key, label })), levels: LEVELS },
      cvUrl: "/cv/" + encodeURIComponent(user.handle)
    };
  }

  /* ---------- writes ---------- */
  async function save(user, b) {
    if (!rl.hit("default", "prosave:" + user.id)) throw E.rate();
    const prev = await profileRow(user.id), minor = await isMinor(user.id);
    const f = await profileFields(b, prev, minor), now = iso();
    const vals = [f.headline, f.about, f.city, f.country, JSON.stringify(f.openTo), JSON.stringify(f.languages), JSON.stringify(f.links), f.visibility, JSON.stringify(f.sections), f.searchable, f.showCerts, now, user.id];
    if (prev) await db.run("UPDATE pro_profiles SET headline=$1, about=$2, city=$3, country=$4, open_to=$5, languages=$6, links=$7, visibility=$8, sections=$9, searchable=$10, show_certs=$11, updated_at=$12 WHERE user_id=$13", vals);
    else await db.run("INSERT INTO pro_profiles (headline, about, city, country, open_to, languages, links, visibility, sections, searchable, show_certs, created_at, updated_at, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)", vals);
    return mine(user);
  }
  async function needProfile(user) { const p = await profileRow(user.id); if (!p) throw fail(409, "no_profile", "أنشئ ملفك المهني أولاً (العنوان المهني)"); return p; }
  const touch = (uid) => db.run("UPDATE pro_profiles SET updated_at=$1 WHERE user_id=$2", [iso(), uid]);
  async function addItem(user, b) {
    await needProfile(user); if (!rl.hit("default", "proitem:" + user.id)) throw E.rate();
    const f = await itemFields(user, b);
    const n = Number((await db.get("SELECT COUNT(*) n FROM pro_items WHERE user_id=$1 AND kind=$2", [user.id, f.kind]))?.n || 0);
    if (n >= MAX_ITEMS) throw E.bad("وصلت إلى الحد الأقصى لهذا القسم (٣٠)");
    const iid = id("pri"), now = iso();
    await db.run("INSERT INTO pro_items (id, user_id, kind, title, org, place, start_ym, end_ym, current, body, url, post_id, pos, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)", [iid, user.id, f.kind, f.title, f.org, f.place, f.start, f.end, f.current, f.body, f.url, f.postId, n, now]);
    await touch(user.id);
    return { item: itemClient(await db.get("SELECT * FROM pro_items WHERE id=$1", [iid])) };
  }
  async function ownItem(user, iid) { const r = await db.get("SELECT * FROM pro_items WHERE id=$1", [String(iid)]); if (!r || r.user_id !== user.id) throw E.nf(); return r; }
  async function editItem(user, iid, b) {
    const prev = await ownItem(user, iid); const f = await itemFields(user, b, prev);
    await db.run("UPDATE pro_items SET title=$1, org=$2, place=$3, start_ym=$4, end_ym=$5, current=$6, body=$7, url=$8, post_id=$9, updated_at=$10 WHERE id=$11", [f.title, f.org, f.place, f.start, f.end, f.current, f.body, f.url, f.postId, iso(), prev.id]);
    await touch(user.id);
    return { item: itemClient(await db.get("SELECT * FROM pro_items WHERE id=$1", [prev.id])) };
  }
  async function delItem(user, iid) { const r = await ownItem(user, iid); await db.run("DELETE FROM pro_items WHERE id=$1", [r.id]); await touch(user.id); return { ok: true }; }
  async function reorder(user, b) {
    const kind = oneOf(b.kind, Object.keys(KINDS), null); if (!kind) throw E.bad();
    const ids = cleanList(b.ids, MAX_ITEMS).map(String);
    const have = (await db.all("SELECT id FROM pro_items WHERE user_id=$1 AND kind=$2", [user.id, kind])).map((r) => r.id);
    if (ids.length !== have.length || ids.some((x) => !have.includes(x))) throw E.bad("قائمة الترتيب لا تطابق عناصر القسم");
    for (let i = 0; i < ids.length; i++) await db.run("UPDATE pro_items SET pos=$1 WHERE id=$2", [i, ids[i]]);
    return { ok: true };
  }
  async function setSkills(user, b) {
    await needProfile(user);
    const list = Array.isArray(b.skills) ? b.skills : []; if (list.length > MAX_SKILLS) throw E.bad("حتى ٣٠ مهارة");
    const seenK = new Set(), out = [];
    for (const s of list) {
      const name = str(String((s && s.name) ?? s ?? ""), 40, { required: true, min: 2 }), key = normalize(name).toLowerCase().slice(0, 40);
      if (!key || seenK.has(key)) continue; seenK.add(key);
      const level = Math.max(1, Math.min(5, Math.round(Number(s?.level) || 3)));
      const years = s?.years === undefined || s?.years === null || s?.years === "" ? null : Math.max(0, Math.min(60, Math.round(Number(s.years) || 0)));
      out.push({ name, key, level, years });
    }
    const now = iso();
    await db.tx(async (t) => {
      await t.run("DELETE FROM pro_skills WHERE user_id=$1", [user.id]);
      for (let i = 0; i < out.length; i++) await t.run("INSERT INTO pro_skills (user_id, norm, name, level, years, pos, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [user.id, out[i].key, out[i].name, out[i].level, out[i].years, i, now]);
    });
    await touch(user.id);
    return { skills: out };
  }
  async function remove(user) {
    await db.run("DELETE FROM pro_items WHERE user_id=$1", [user.id]); await db.run("DELETE FROM pro_skills WHERE user_id=$1", [user.id]); await db.run("DELETE FROM pro_profiles WHERE user_id=$1", [user.id]);
    return { ok: true };
  }

  /* ---------- talent directory ---------- */
  async function search(viewer, q = {}) {
    const text = normalize(String(q.q || "")).toLowerCase().trim().slice(0, 80), skill = normalize(String(q.skill || "")).toLowerCase().trim().slice(0, 40), city = normalize(String(q.city || "")).toLowerCase().trim().slice(0, 60);
    const open = OPEN[q.open] ? q.open : null, page = Math.max(0, Math.min(50, Number(q.page) || 0)), per = 20;
    const levels = viewer ? ["public", "members"] : ["public"];
    const rows = await db.all(`SELECT p.*, u.name, u.handle, u.color, u.avatar, u.verified, u.prefs FROM pro_profiles p JOIN users u ON u.id=p.user_id WHERE p.searchable=1 AND p.hidden=0 AND u.status='active' AND p.visibility IN (${levels.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY p.updated_at DESC LIMIT 2000`, levels);
    const flagged = new Set((await db.all("SELECT user_id FROM pro_reports WHERE status='open' GROUP BY user_id HAVING COUNT(*) >= $1", [FLAG_AT])).map((r) => r.user_id));
    const skillRows = rows.length ? await db.all(`SELECT user_id, name, norm, level FROM pro_skills WHERE user_id IN (${rows.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY pos`, rows.map((r) => r.user_id)) : [];
    const skillsBy = {}; for (const s of skillRows) (skillsBy[s.user_id] ||= []).push(s);
    const scored = [];
    for (const r of rows) {
      if (flagged.has(r.user_id) || (viewer && r.user_id !== viewer.id && (await blockedBetween(viewer.id, r.user_id)))) continue;
      if (await isMinor(r.user_id)) continue;
      const sk = skillsBy[r.user_id] || [];
      if (open && !parse(r.open_to, []).includes(open)) continue;
      if (skill && !sk.some((s) => s.norm.includes(skill))) continue;
      if (city && !normalize(`${r.city || ""} ${r.country || ""}`).toLowerCase().includes(city)) continue;
      let s = 1;
      if (text) {
        const terms = text.split(/\s+/).filter(Boolean), head = normalize(r.headline).toLowerCase(), about = normalize(r.about || "").toLowerCase(), sks = sk.map((x) => x.norm).join(" "), nm = normalize(r.name || "").toLowerCase();
        s = 0; for (const t of terms) { if (head.includes(t)) s += 5; if (sks.includes(t)) s += 4; if (nm.includes(t)) s += 3; if (about.includes(t)) s += 1; }
        if (!s) continue;
      }
      scored.push({ r, s, sk });
    }
    const tsv = (v) => (v ? new Date(v).getTime() || 0 : 0);
    scored.sort((a, b) => b.s - a.s || tsv(b.r.updated_at) - tsv(a.r.updated_at));
    const slice = scored.slice(page * per, (page + 1) * per);
    let reps = new Map(); try { reps = (await ctx.services.proreviews?.cards?.(slice.map((x) => x.r.user_id))) || reps; } catch { /* phase 80 optional */ }
    return {
      profiles: slice.map(({ r, sk }) => ({ user: pubUser(r), headline: r.headline, city: r.city || null, country: r.country || null, openTo: parse(r.open_to, []).map((k) => ({ key: k, label: OPEN[k] })), skills: sk.slice(0, 6).map((s) => s.name), updatedAt: r.updated_at, rep: reps.get(r.user_id) || null })),
      total: scored.length, page, more: scored.length > (page + 1) * per, options: { openTo: Object.entries(OPEN).map(([key, label]) => ({ key, label })) }
    };
  }

  /* ---------- the social profile badge (identity.fullProfile) ---------- */
  async function badge(u, viewer) {
    try {
      const p = await profileRow(u.id); if (!p || (Number(p.hidden) && viewer?.id !== u.id)) return null;
      if (!(await canSee(p.visibility, u.id, viewer))) return null;
      return { headline: p.headline, openTo: parse(p.open_to, []).map((k) => ({ key: k, label: OPEN[k] })) };
    } catch { return null; }
  }

  /* ---------- reports + staff ---------- */
  async function report(user, handle, b) {
    const u = await userByHandle(handle); if (!u || !(await profileRow(u.id))) throw E.nf();
    if (u.id === user.id) throw E.bad("لا يمكنك الإبلاغ عن ملفك");
    if (!rl.hit("report", "prorep:" + user.id)) throw E.rate();
    const reason = oneOf(b.reason, Object.keys(REASONS), null); if (!reason) throw E.bad("اختر سبب البلاغ");
    const note = str(b.note, 600);
    if (await db.get("SELECT 1 x FROM pro_reports WHERE user_id=$1 AND by_user=$2", [u.id, user.id])) throw fail(409, "already_reported", "أبلغت عن هذا الملف من قبل؛ سيراجعه فريق المنصة");
    await db.run("INSERT INTO pro_reports (id, user_id, by_user, reason, note, status, created_at) VALUES ($1,$2,$3,$4,$5,'open',$6)", [id("prr"), u.id, user.id, reason, note, iso()]);
    return { ok: true, flagged: (await openReports(u.id)) >= FLAG_AT };
  }
  async function adminView() {
    const reps = await db.all("SELECT r.*, u.handle, u.name, p.headline, p.hidden FROM pro_reports r JOIN users u ON u.id=r.user_id LEFT JOIN pro_profiles p ON p.user_id=r.user_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 300");
    const by = {}; for (const r of reps) { const g = (by[r.user_id] ||= { user: { id: r.user_id, handle: r.handle, name: r.name }, headline: r.headline, hidden: !!Number(r.hidden), reports: [] }); g.reports.push({ id: r.id, reason: r.reason, reasonLabel: REASONS[r.reason], note: r.note || "", at: r.created_at }); }
    const hidden = await db.all("SELECT p.user_id, p.headline, p.hidden_reason, p.updated_at, u.handle, u.name FROM pro_profiles p JOIN users u ON u.id=p.user_id WHERE p.hidden=1 ORDER BY p.updated_at DESC LIMIT 100");
    return { flagAt: FLAG_AT, queue: Object.values(by).sort((a, b) => b.reports.length - a.reports.length), hidden: hidden.map((h) => ({ user: { id: h.user_id, handle: h.handle, name: h.name }, headline: h.headline, reason: h.hidden_reason || "" })),
      totals: { profiles: Number((await db.get("SELECT COUNT(*) n FROM pro_profiles"))?.n || 0), listed: Number((await db.get("SELECT COUNT(*) n FROM pro_profiles WHERE searchable=1 AND hidden=0"))?.n || 0), open: reps.length }, reasons: REASONS };
  }
  async function moderate(staff, handle, b) {
    const u = await userByHandle(handle); if (!u) throw E.nf(); const p = await profileRow(u.id); if (!p) throw E.nf();
    const action = oneOf(b.action, ["hide", "restore", "dismiss"], null); if (!action) throw E.bad();
    const reason = str(b.reason, 400); const now = iso();
    if (action === "hide") { if (!reason) throw E.bad("اكتب سبب الإخفاء ليصل لصاحب الملف"); await db.run("UPDATE pro_profiles SET hidden=1, hidden_reason=$1 WHERE user_id=$2", [reason, u.id]); await notify(u.id, "pro_hidden", u.handle, staff.id); }
    if (action === "restore") { await db.run("UPDATE pro_profiles SET hidden=0, hidden_reason=NULL WHERE user_id=$1", [u.id]); if (Number(p.hidden)) await notify(u.id, "pro_restored", u.handle, staff.id); }
    await db.run("UPDATE pro_reports SET status=$1, decided_at=$2, decided_by=$3 WHERE user_id=$4 AND status='open'", [action === "dismiss" || action === "restore" ? "dismissed" : "actioned", now, staff.id, u.id]);
    ctx.audit?.("pro_" + action, u.id, reason || p.headline, staff.id);
    return adminView();
  }

  /* ---------- export ---------- */
  function jsonResume(v) {
    const ym = (s) => s || undefined, P = v.profile, S = v.sections;
    const work = (S.experience || []).map((i) => ({ name: i.org || undefined, position: i.title, location: i.place || undefined, startDate: ym(i.start), endDate: i.current ? undefined : ym(i.end), summary: i.body || undefined, url: i.url || undefined }));
    return {
      $schema: "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
      basics: { name: v.user.name, label: P.headline, summary: P.about || undefined, location: { city: P.city || undefined, countryCode: undefined, region: P.country || undefined }, profiles: (P.links || []).map((l) => ({ network: l.label, url: l.url })), url: undefined },
      work, volunteer: (S.volunteering || []).map((i) => ({ organization: i.org || undefined, position: i.title, startDate: ym(i.start), endDate: i.current ? undefined : ym(i.end), summary: i.body || undefined, url: i.url || undefined })),
      education: (S.education || []).map((i) => ({ institution: i.org || i.title, area: i.org ? i.title : undefined, startDate: ym(i.start), endDate: i.current ? undefined : ym(i.end), url: i.url || undefined })),
      awards: (S.award || []).map((i) => ({ title: i.title, awarder: i.org || undefined, date: ym(i.end || i.start), summary: i.body || undefined })),
      certificates: (v.certificates || []).map((c) => ({ name: c.title, issuer: c.issuer || "مجتمع بلس", date: c.issuedAt ? String(c.issuedAt).slice(0, 10) : undefined, url: c.url })),
      skills: (v.skills || []).map((s) => ({ name: s.name, level: ["", "مبتدئ", "أساسي", "متوسط", "متقدم", "خبير"][s.level] })),
      languages: (P.languages || []).map((l) => ({ language: l.name, fluency: l.levelLabel })),
      projects: (S.portfolio || []).map((i) => ({ name: i.title, description: i.body || undefined, url: i.url || undefined, startDate: ym(i.start), endDate: ym(i.end) })),
      meta: { canonical: v.cvUrl, version: "v1.0.0", lastModified: P.updatedAt }
    };
  }
  const SKILL_LVL = ["", "مبتدئ", "أساسي", "متوسط", "متقدم", "خبير"];
  const ymTxt = (s) => (s ? s.replace(/^(\d{4})-(\d{2})$/, "$2/$1") : "");
  const range = (i) => [ymTxt(i.start), i.current ? "حتى الآن" : ymTxt(i.end)].filter(Boolean).join(" – ");
  const CSS = `:root{--ink:#1d1b26;--mut:#5f5b72;--bg:#f4f1fb;--paper:#fff;--acc:#5b2bd6;--line:#e4dff0}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.75 "IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif}a{color:var(--acc)}
.top{display:flex;justify-content:space-between;align-items:center;gap:8px;max-width:820px;margin:auto;padding:10px 16px;flex-wrap:wrap}.top a{font-weight:700;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.cv{max-width:820px;margin:0 auto 32px;background:var(--paper);border-radius:16px;padding:32px 34px;box-shadow:0 8px 32px #2a1f5a17}
header.h{display:flex;gap:18px;align-items:center;border-bottom:3px solid var(--acc);padding-bottom:16px;margin-bottom:8px}header.h img,header.h .ini{width:84px;height:84px;border-radius:50%;object-fit:cover;flex:none}.ini{display:grid;place-items:center;background:var(--acc);color:#fff;font-size:34px;font-weight:800}
h1{margin:0;font-size:28px;line-height:1.3}.hl{font-size:18px;color:var(--acc);font-weight:700;margin:2px 0}.meta{color:var(--mut);font-size:14px;display:flex;flex-wrap:wrap;gap:4px 14px}
h2{font-size:17px;color:var(--acc);margin:22px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--line)}.it{margin:10px 0;break-inside:avoid}.it b{font-size:16px}.it .sub{color:var(--mut);font-size:14px}.it p{margin:4px 0;white-space:pre-line}
.sk{display:flex;flex-wrap:wrap;gap:6px}.sk span{border:1px solid var(--line);border-radius:999px;padding:1px 12px;font-size:14px}.sk small{color:var(--mut)}.about{white-space:pre-line}
.foot{margin-top:26px;color:var(--mut);font-size:12.5px;border-top:1px dashed var(--line);padding-top:10px}.locked{text-align:center;padding:40px 10px}
@media(max-width:560px){.cv{padding:20px 16px;border-radius:0}header.h img,header.h .ini{width:64px;height:64px}h1{font-size:22px}}
@media(prefers-color-scheme:dark){:root{--bg:#121019}.top a{color:#c9b6ff}}
@media print{@page{size:A4;margin:14mm}body{background:#fff;font-size:12.5pt}.top{display:none}.cv{box-shadow:none;max-width:none;margin:0;padding:0;border-radius:0}a{color:var(--ink);text-decoration:none}}`;
  function cvHtml(v, base) {
    const P = v.profile, S = v.sections, img = v.user.avatar && (v.user.avatar["200"] || v.user.avatar["400"] || (typeof v.user.avatar === "string" ? v.user.avatar : null));
    const items = (k) => (S[k] && S[k].length ? `<section><h2>${KINDS[k]}</h2>${S[k].map((i) => `<div class="it"><b>${esc(i.title)}</b>${i.org || i.place || i.start ? `<div class="sub">${[i.org, i.place, range(i)].filter(Boolean).map(esc).join(" · ")}</div>` : ""}${i.body ? `<p>${esc(i.body)}</p>` : ""}${i.url ? `<div class="sub"><a href="${esc(i.url)}" rel="nofollow noopener">${esc(i.url.replace(/^https?:\/\//, "").slice(0, 70))}</a></div>` : i.post ? `<div class="sub"><a href="${esc(base)}/post/${esc(i.post.id)}">${esc(i.post.title || "منشور في مجتمع بلس")}</a></div>` : ""}</div>`).join("")}</section>` : "");
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(v.user.name)} — السيرة الذاتية · مجتمع بلس</title><style>${CSS}</style></head>
<body><nav class="top" aria-label="روابط"><a href="/#/cv/${esc(encodeURIComponent(v.user.handle))}">→ الملف المهني في التطبيق</a><span class="meta">للحفظ PDF: «طباعة» من قائمة المتصفح ثم «حفظ كملف PDF»</span></nav>
<main class="cv"><header class="h">${img ? `<img src="${esc(img)}" alt="">` : `<span class="ini" aria-hidden="true">${esc((v.user.name || "?")[0])}</span>`}<div><h1>${esc(v.user.name)}</h1><div class="hl">${esc(P.headline)}</div>
<div class="meta">${[P.city, P.country].filter(Boolean).length ? `<span>${esc([P.city, P.country].filter(Boolean).join("، "))}</span>` : ""}<span dir="ltr">@${esc(v.user.handle)}</span>${(P.links || []).map((l) => `<a href="${esc(l.url)}" rel="nofollow noopener">${esc(l.label)}</a>`).join("")}</div></div></header>
${P.openTo.length ? `<div class="meta">منفتح على: ${P.openTo.map((o) => esc(o.label)).join("، ")}</div>` : ""}
${P.about ? `<section><h2>نبذة</h2><p class="about">${esc(P.about)}</p></section>` : ""}
${items("experience")}${items("education")}
${v.skills && v.skills.length ? `<section><h2>المهارات</h2><div class="sk">${v.skills.map((s) => `<span>${esc(s.name)} <small>${SKILL_LVL[s.level]}${s.years ? ` · ${s.years} سنوات` : ""}</small></span>`).join("")}</div></section>` : ""}
${items("portfolio")}
${v.certificates && v.certificates.length ? `<section><h2>الشهادات الموثّقة</h2>${v.certificates.map((c) => `<div class="it"><b>${esc(c.title)}</b><div class="sub">${esc(c.issuer || "مجتمع بلس")}${c.issuedAt ? " · " + esc(String(c.issuedAt).slice(0, 10)) : ""} · <a href="${esc(base + c.url)}">تحقّق: ${esc(c.code)}</a></div></div>`).join("")}</section>` : ""}
${items("volunteering")}${items("award")}
${P.languages && P.languages.length ? `<section><h2>اللغات</h2><div class="sk">${P.languages.map((l) => `<span>${esc(l.name)} <small>${esc(l.levelLabel || "")}</small></span>`).join("")}</div></section>` : ""}
<div class="foot">السيرة الذاتية من مجتمع بلس · آخر تحديث ${esc(String(P.updatedAt || "").slice(0, 10))} · ${esc(base)}/cv/${esc(encodeURIComponent(v.user.handle))}</div></main></body></html>`;
  }
  function page(res, status, html, extra = {}) { res.writeHead(status, { ...SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", ...extra }); res.end(html); }
  async function ssr(req, res, url) {
    const m = /^\/cv\/([A-Za-z0-9_.-]{2,40})\/?$/.exec(url.pathname); if (!m) return false;
    let viewer = null; try { viewer = await ctx.services.users.resolve(req); } catch { viewer = null; }
    const base = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host || "localhost"}`.replace(/[^\w:/.\-[\]]/g, "");
    const shell = (body) => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>السيرة الذاتية · مجتمع بلس</title><style>${CSS}</style></head><body><main class="cv locked">${body}<p><a href="/">مجتمع بلس</a></p></main></body></html>`;
    const u = await userByHandle(m[1]);
    if (!u || (viewer && viewer.id !== u.id && (await blockedBetween(viewer.id, u.id)))) { page(res, 404, shell("<h1>لا توجد سيرة ذاتية</h1>")); return true; }
    const v = await build(u, viewer);
    if (!v) { page(res, 404, shell("<h1>لا توجد سيرة ذاتية</h1>")); return true; }
    if (v.locked) { page(res, 403, shell(`<h1>${esc(u.name)}</h1><p>${v.visibility === "members" ? "هذه السيرة متاحة لأعضاء مجتمع بلس — سجّل الدخول لعرضها." : "هذه السيرة خاصة بمتابعي صاحبها."}</p>`)); return true; }
    page(res, 200, cvHtml(v, base), url.searchParams.get("download") ? { "Content-Disposition": `attachment; filename="cv-${u.handle}.html"` } : {});
    return true;
  }
  async function exportJson(user) { const u = await userByHandle(user.handle); const v = await build(u, user); if (!v || v.locked) throw fail(409, "no_profile", "أنشئ ملفك المهني أولاً"); return jsonResume(v); }

  /* ---------- routes ---------- */
  R.get("/api/pro/me", A(async (req) => mine(req.user)));
  R.put("/api/pro/me", A(async (req) => save(req.user, req.body || {})));
  R.del("/api/pro/me", A(async (req) => remove(req.user)));
  R.get("/api/pro/me/export", A(async (req) => exportJson(req.user)));
  R.post("/api/pro/me/items", A(async (req) => addItem(req.user, req.body || {})));
  R.post("/api/pro/me/items/reorder", A(async (req) => reorder(req.user, req.body || {})));
  R.patch("/api/pro/me/items/:id", A(async (req) => editItem(req.user, req.params.id, req.body || {})));
  R.del("/api/pro/me/items/:id", A(async (req) => delItem(req.user, req.params.id)));
  R.put("/api/pro/me/skills", A(async (req) => setSkills(req.user, req.body || {})));
  R.get("/api/pro/search", async (req) => search(req.user || null, req.query || {}));
  R.get("/api/pro/u/:handle", async (req) => view(req.user || null, req.params.handle, req.query || {}));
  R.post("/api/pro/u/:handle/report", A(async (req) => report(req.user, req.params.handle, req.body || {})));
  R.get("/api/admin/pro", admin(async () => adminView()));
  R.post("/api/admin/pro/:handle", admin(async (req) => moderate(req.user, req.params.handle, req.body || {})));

  return { badge, view, build, search, ssr, completeness, jsonResume, OPEN, KINDS, SECTIONS, VIS, REASONS, profileRow };
};
