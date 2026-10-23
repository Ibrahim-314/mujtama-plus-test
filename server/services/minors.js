/* Minors & Sensitive-Content Service (Track 7, phase 35 — حماية الأطفال والمحتوى الحساس).
 * 1. Age: self-declared birth date at sign-up or in settings (no ID upload), an age gate below MINORS_MIN_AGE
 *    (default 13), raises from minor → adult wait for staff review, optional env-gated Pi KYC signal.
 * 2. Stricter defaults for minors: private account, DMs/mentions from followed people only, no location,
 *    sensitive content off, never suggested to adults in people search/suggestions. A minor cannot loosen them.
 * 3. Publisher-side sensitive-content labels per post or per media item (content_labels).
 * 4. Server-side age filtering: filterPosts(rows, viewerId) / filterUsers(users, viewerId) — wired into
 *    content.filterVisible/canSee/toClient (feed, search, profiles, collections, tags…) when the service registers.
 * 5. Escalation path: severe reports become safety_cases in a priority queue, staff are alerted, evidence is
 *    preserved in a SHA-256 hash chain, access is restricted to safety staff and every access is logged.
 * 6. Official reporting bodies: structured authority_reports for export; NOTHING is sent automatically —
 *    the operator configures and uses the actual channel (docs/MINORS-SAFETY.md).
 * 8. Family links: two-sided consent between an adult guardian and a minor, a few tighten-only controls,
 *    and a transparency log the minor can always read.
 * Pure rules live in /minors-core.js (shared with the browser). */
const crypto = require("node:crypto");
const { E, HttpError, str, oneOf, id, now, Classifier } = require("../lib/core");
const M = require("../../minors-core.js");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
/** stable JSON (sorted keys) so evidence hashes are reproducible */
const stable = (v) => v === null || typeof v !== "object" ? JSON.stringify(v ?? null) : Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
const ph = (arr, from = 1) => arr.map((_, i) => "$" + (i + from)).join(",");
const DEFAULT_HELPLINES = [{ name: "الطوارئ", number: "911" }, { name: "خط مساندة الطفل", number: "116111" }];

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, fetch?: (url: string, o: any) => Promise<any>, now?: () => Date, install?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl, cache, router: R, config } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser;
  const MIN_AGE = Math.min(17, Math.max(M.DEFAULT_MIN_AGE, +env.MINORS_MIN_AGE || M.DEFAULT_MIN_AGE)); // never below 13
  const REQUIRE_DOB = env.MINORS_REQUIRE_DOB === "1";
  const KYC = env.MINORS_PI_KYC === "1";
  const BODIES = (env.MINORS_AUTHORITY_BODIES || "ncmec,national_hotline,police").split(",").map(s => s.trim()).filter(s => /^[a-z0-9_.-]{2,40}$/.test(s));
  let HELPLINES = DEFAULT_HELPLINES; try { if (env.MINORS_HELPLINES) HELPLINES = JSON.parse(env.MINORS_HELPLINES).filter(h => h && h.name && h.number).slice(0, 6); } catch { }
  const fetchImpl = opts.fetch || ((/** @type {string} */ url, /** @type {any} */ o) => fetch(url, o));
  const today = () => (opts.now ? opts.now() : new Date());
  const users = () => ctx.services.users, content = () => ctx.services.content;
  const notify = (uid, kind, o) => ctx.services.notify?.notify(uid, kind, o).catch(() => null);
  const log = (uid, action, detail, actor = null) => db.run("INSERT INTO minors_events(user_id,actor,action,detail,at) VALUES($1,$2,$3,$4,$5)", [uid, actor, action, detail ? String(detail).slice(0, 300) : null, now()]);

  /* ======================= 1. age ======================= */
  const profileRow = (uid) => db.get("SELECT * FROM age_profiles WHERE user_id=$1", [uid]);
  function describe(row) {
    const age = row?.birth_date ? M.ageOn(row.birth_date, today()) : null, b = M.band(age, MIN_AGE);
    return { age, band: b, minor: M.isMinor(b), pref: M.isMinor(b) ? "hide" : (row?.content_pref || "blur") };
  }
  async function viewer(uid) {
    if (!uid) return { band: "unknown", pref: "blur", minor: false, staff: false, anon: true };
    return cache.wrap("minors:v:" + uid, 30e3, async () => {
      const [row, u, st] = await Promise.all([profileRow(uid), db.get("SELECT role FROM users WHERE id=$1", [uid]), db.get("SELECT role FROM safety_staff WHERE user_id=$1", [uid])]);
      const admin = u?.role === "admin";
      return { ...describe(row), staff: admin || !!st, staffRole: admin ? "admin" : st?.role || null };
    });
  }
  const forget = (uid) => { cache.del("minors:v:" + uid); cache.del("feed:" + uid); cache.del("card:"); };
  /** ids of minors among `ids` (declared birth date says 13–17 today) */
  async function minorIds(ids) {
    const uniq = [...new Set(ids.filter(Boolean))]; if (!uniq.length) return new Set();
    const out = new Set();
    for (let i = 0; i < uniq.length; i += 400) {
      const ch = uniq.slice(i, i + 400);
      for (const r of await db.all(`SELECT user_id, birth_date FROM age_profiles WHERE birth_date IS NOT NULL AND user_id IN (${ph(ch)})`, ch)) if (M.isMinor(M.band(M.ageOn(r.birth_date, today()), MIN_AGE))) out.add(r.user_id);
    }
    return out;
  }
  const isMinorUser = async (uid) => (await minorIds([uid])).has(uid);

  async function summary(uid) {
    const row = await profileRow(uid), d = describe(row);
    const guardians = d.minor ? (await db.get("SELECT COUNT(*) n FROM guardian_links WHERE minor_id=$1 AND status='active'", [uid])).n : 0;
    return {
      declared: !!row?.birth_date, birthDate: row?.birth_date || null, age: d.age, band: d.band, minor: d.minor, minAge: MIN_AGE, source: row?.source || null,
      contentPref: d.pref, pending: row?.pending_birth_date ? { since: row.pending_at } : null, changesLeft: Math.max(0, 3 - (row?.changes || 0)),
      adultOn: d.minor && row?.birth_date ? M.birthdayAt(row.birth_date, M.ADULT_AGE) : null,
      protections: d.minor ? { private: true, dm: "following", mentions: "following", location: false, sensitive: "hide", discoverable: false } : null,
      guardians, staff: (await viewer(uid)).staff, kyc: { enabled: KYC, signal: row?.kyc_signal || null, at: row?.kyc_at || null }, requireDob: REQUIRE_DOB, helplines: HELPLINES
    };
  }

  async function upsertProfile(uid, fields) {
    const ex = await profileRow(uid), at = now();
    if (!ex) await db.run("INSERT INTO age_profiles(user_id,updated_at) VALUES($1,$2) ON CONFLICT DO NOTHING", [uid, at]);
    const keys = Object.keys(fields); if (!keys.length) return;
    await db.run(`UPDATE age_profiles SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE user_id=$${keys.length + 2}`, [...keys.map(k => fields[k]), at, uid]);
  }

  /** an existing account declares an age below the minimum: suspend it (sessions end), keep no birth date */
  async function ageGateExisting(uid, actor) {
    await db.run("UPDATE users SET status='suspended' WHERE id=$1 AND role<>'admin'", [uid]);
    await db.run("DELETE FROM sessions WHERE user_id=$1", [uid]);
    await upsertProfile(uid, { pending_birth_date: null, pending_at: null });
    await log(uid, "age_gate", `under ${MIN_AGE}`, actor);
    await ctx.audit("AGE_GATE", uid, `declared under ${MIN_AGE}`, actor || "system");
    forget(uid);
  }

  /** declare or correct a birth date. Lowering to a minor applies at once; raising a minor to adult waits for review. */
  async function declare(user, raw, { source = "self", actor = null } = {}) {
    const bd = M.parseBirthDate(raw, today()); if (!bd) throw E.bad("تاريخ الميلاد غير صالح");
    const row = await profileRow(user.id), oldD = describe(row), age = M.ageOn(bd, today()), nb = M.band(age, MIN_AGE);
    if (row?.birth_date === bd) return { ...(await summary(user.id)), changed: false };
    if (nb === "child") { await ageGateExisting(user.id, actor || user.id); return { blocked: true, minAge: MIN_AGE }; }
    if (row?.birth_date) {
      if ((row.changes || 0) >= 3 && source === "self") throw E.forbid("بلغت حد تعديل تاريخ الميلاد. تواصل مع فريق الدعم");
      if (oldD.minor && nb === "adult" && source === "self") { // a minor cannot make themselves an adult
        await upsertProfile(user.id, { pending_birth_date: bd, pending_at: now(), changes: (row.changes || 0) + 1 });
        await log(user.id, "age_raise_requested", null, user.id);
        await ctx.audit("AGE_RAISE_REQUESTED", user.id, null, user.id);
        return { ...(await summary(user.id)), changed: false, review: true };
      }
    }
    await upsertProfile(user.id, { birth_date: bd, source, declared_at: now(), changes: row?.birth_date ? (row.changes || 0) + 1 : 0, pending_birth_date: null, pending_at: null });
    forget(user.id);
    if (M.isMinor(nb)) await applyMinorDefaults(user.id, actor || "system");
    else if (oldD.minor) await becameAdult(user.id, actor);
    await log(user.id, row?.birth_date ? "age_corrected" : "age_declared", nb, actor || user.id);
    return { ...(await summary(user.id)), changed: true };
  }

  /* ======================= 2. defaults for minors ======================= */
  async function floorFor(uid) {
    const f = { ...M.MINOR_PRIVACY };
    for (const l of await db.all("SELECT settings FROM guardian_links WHERE minor_id=$1 AND status='active'", [uid]))
      for (const [k, v] of Object.entries(M.normalizeControls(l.settings || {}))) f[k] = M.stricter(f[k] || "everyone", v);
    return f;
  }
  async function applyMinorDefaults(uid, actor = "system") {
    const u = await db.get("SELECT * FROM users WHERE id=$1", [uid]); if (!u) return;
    const f = await floorFor(uid), privacy = { ...ctx.policy.privacyOf(u) };
    for (const k of ["dm", "mentions", "comments"]) if (f[k]) privacy[k] = M.stricter(privacy[k] || "everyone", f[k]);
    privacy.filterRequests = true;
    await db.run("UPDATE users SET private=1, privacy=$1, location=NULL WHERE id=$2", [privacy, uid]);
    await db.run("UPDATE posts SET location=NULL WHERE author=$1 AND location IS NOT NULL", [uid]);
    await upsertProfile(uid, { defaults_applied_at: now() });
    await log(uid, "defaults_applied", Object.entries(privacy).filter(([k]) => k !== "filterRequests").map(([k, v]) => `${k}:${v}`).join(" "), actor);
    forget(uid); cache.del("feed:");
  }
  async function becameAdult(uid, actor) {
    for (const l of await db.all("SELECT id, guardian_id FROM guardian_links WHERE minor_id=$1 AND status IN ('active','pending')", [uid])) {
      await db.run("UPDATE guardian_links SET status='ended', ended_at=$1, ended_by='system' WHERE id=$2", [now(), l.id]);
      await notify(l.guardian_id, "family_update", { actor: uid, ref: l.id });
    }
    await log(uid, "became_adult", "protections lifted; your current privacy settings were kept", actor);
  }

  /* ======================= 3. labels ======================= */
  async function labelsFor(ids) {
    const out = new Map(); const uniq = [...new Set(ids)]; if (!uniq.length) return out;
    for (let i = 0; i < uniq.length; i += 400) {
      const ch = uniq.slice(i, i + 400);
      for (const r of await db.read.all(`SELECT target, idx, labels FROM content_labels WHERE target IN (${ph(ch)})`, ch)) {
        const e = out.get(r.target) || { post: [], media: {} }; const l = M.normalizeLabels(r.labels);
        if (+r.idx < 0) e.post = l; else e.media[+r.idx] = l; out.set(r.target, e);
      }
    }
    return out;
  }
  async function setLabels(user, pid, b, { fromCreate = false } = {}) {
    const p = await db.get("SELECT id, author, text, title, data FROM posts WHERE id=$1 AND status<>'deleted'", [pid]); if (!p) throw E.nf();
    const v = await viewer(user.id), own = p.author === user.id;
    if (!own && !v.staff) throw E.forbid();
    const source = own ? "publisher" : "moderator";
    const nMedia = Math.max(p.data?.images?.length || 0, p.data?.media || p.data?.video || p.data?.cover ? 1 : 0);
    const want = new Map([[-1, M.normalizeLabels(b.labels)]]);
    const media = M.normalizeMediaLabels(b.media); for (const [i, l] of Object.entries(media)) if (+i < Math.max(1, nMedia)) want.set(+i, l);
    if (fromCreate && !want.get(-1).length && !Object.keys(media).length) return null;
    const existing = await db.all("SELECT idx, labels, source FROM content_labels WHERE target=$1", [pid]);
    const at = now();
    for (const [idx, l0] of want) {
      const ex = existing.find(e => +e.idx === idx);
      const l = ex?.source === "moderator" && !v.staff ? M.normalizeLabels([...M.normalizeLabels(ex.labels), ...l0]) : l0; // publishers cannot drop a moderator's label
      if (!l.length) { await db.run("DELETE FROM content_labels WHERE target=$1 AND idx=$2", [pid, idx]); continue; }
      if (ex) await db.run("UPDATE content_labels SET labels=$1, source=$2, by_user=$3, updated_at=$4 WHERE target=$5 AND idx=$6", [l.join(","), ex.source === "moderator" && !v.staff ? "moderator" : source, user.id, at, pid, idx]);
      else await db.run("INSERT INTO content_labels(target,idx,labels,source,by_user,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)", [pid, idx, l.join(","), source, user.id, at]);
    }
    if (b.media && typeof b.media === "object") for (const ex of existing) if (+ex.idx >= 0 && !want.has(+ex.idx) && Object.prototype.hasOwnProperty.call(b.media, String(ex.idx)) && (ex.source !== "moderator" || v.staff)) await db.run("DELETE FROM content_labels WHERE target=$1 AND idx=$2", [pid, ex.idx]);
    const labels = (await labelsFor([pid])).get(pid) || { post: [], media: {} };
    const any = M.allLabels(labels).length > 0;
    await db.run("UPDATE posts SET sensitive=$1 WHERE id=$2", [any || Classifier.sensitive(`${p.title || ""} ${p.text || ""}`) ? 1 : 0, pid]);
    if (!own) await ctx.audit("CONTENT_LABELED", pid, M.allLabels(labels).join(","), user.id);
    cache.del("feed:"); bus.emit("CONTENT_LABELED", { post: pid, labels, actor: user.id, source });
    return labels;
  }

  /* ======================= 4. age-based filtering ======================= */
  const meta = new WeakMap(); // row → { labels, cover: Map(viewerKey → bool) } — per viewer, rows can be shared by caches
  const recent = new Map();   // "viewer|post" → { labels, cover } for callers that re-read rows after filtering (ranking's page fetch)
  const remember = (k, v) => { recent.delete(k); recent.set(k, v); if (recent.size > 20000) recent.delete(recent.keys().next().value); };
  async function heldSet(ids) {
    if (!ids.length) return new Set();
    const out = new Set();
    for (let i = 0; i < ids.length; i += 400) { const ch = ids.slice(i, i + 400); for (const r of await db.read.all(`SELECT target FROM safety_cases WHERE hold=1 AND status<>'closed' AND target IN (${ph(ch)})`, ch)) out.add(r.target); }
    return out;
  }
  /** THE exported filter: drop posts a viewer must not see (age, preference, held evidence) and remember
   *  labels + cover decision for toClient. Safe on any array of post rows; keeps order. */
  async function filterPosts(rows, viewerId) {
    if (!Array.isArray(rows) || !rows.length) return rows || [];
    const v = await viewer(viewerId), ids = [...new Set(rows.map(r => r.id))];
    const [labels, held] = await Promise.all([labelsFor(ids), heldSet(ids)]);
    const out = [];
    for (const r of rows) {
      const own = !!viewerId && r.author === viewerId;
      if (held.has(r.id) && !own && !v.staff) continue;
      const l = labels.get(r.id) || { post: [], media: {} };
      const d = M.decide(v, { own, labels: l, sensitive: !!r.sensitive });
      if (d === "hide") continue;
      let m = meta.get(r); if (!m) meta.set(r, (m = { labels: l, cover: new Map() }));
      m.labels = l; m.cover.set(viewerId || "", d === "cover");
      remember((viewerId || "") + "|" + r.id, { labels: l, cover: d === "cover" });
      out.push(r);
    }
    return out;
  }
  /** add contentLabels + cover to a client post (toClient output) */
  function decorate(o, row, viewerId) {
    if (!o || !row) return o;
    const m = meta.get(row), k = recent.get((viewerId || "") + "|" + row.id);
    const labels = m?.labels || k?.labels; if (!labels) return o;
    const any = M.allLabels(labels).length > 0 || !!row.sensitive;
    if (M.allLabels(labels).length) o.contentLabels = labels;
    const c = m?.cover.has(viewerId || "") ? m.cover.get(viewerId || "") : k?.cover;
    if (any) o.cover = (c ?? true) ? "blur" : "none";
    return o;
  }
  /** people lists: minors are never suggested to adults/unknown viewers, unless already connected */
  async function filterUsers(list, viewerId) {
    if (!Array.isArray(list) || !list.length) return list || [];
    const v = await viewer(viewerId); if (v.minor || v.staff) return list;
    const minors = await minorIds(list.map(u => u.id)); if (!minors.size) return list;
    const linked = viewerId ? new Set((await db.read.all(`SELECT src, dst FROM follows WHERE (src=$1 AND dst IN (${ph([...minors], 2)})) OR (dst=$1 AND src IN (${ph([...minors], 2)}))`, [viewerId, ...minors])).map(f => f.src === viewerId ? f.dst : f.src)) : new Set();
    return list.filter(u => !minors.has(u.id) || u.id === viewerId || linked.has(u.id));
  }

  /** v2.67 PYMK (no-query suggestion pools: follow suggestions, bootstrap pool): age bands never cross.
   * Adult/unknown viewers never get minors (filterUsers). A minor never gets adults or undeclared accounts unless already
   * connected (a follow either way) or linked as their guardian (active/pending family link). Staff see everything. */
  async function filterSuggest(list, viewerId) {
    if (!Array.isArray(list) || !list.length) return list || [];
    const v = await viewer(viewerId); if (!v.minor || v.staff) return filterUsers(list, viewerId);
    const ids = [...new Set(list.map(u => u?.id).filter(id => id && id !== viewerId))];
    const minors = await minorIds(ids), others = ids.filter(id => !minors.has(id)); if (!others.length) return list;
    const linked = new Set();
    for (const f of await db.read.all(`SELECT src, dst FROM follows WHERE (src=$1 AND dst IN (${ph(others, 2)})) OR (dst=$1 AND src IN (${ph(others, 2)}))`, [viewerId, ...others])) linked.add(f.src === viewerId ? f.dst : f.src);
    for (const l of await db.read.all(`SELECT guardian_id FROM guardian_links WHERE minor_id=$1 AND status IN ('active','pending') AND guardian_id IN (${ph(others, 2)})`, [viewerId, ...others])) linked.add(l.guardian_id);
    return list.filter(u => u?.id === viewerId || minors.has(u?.id) || linked.has(u?.id));
  }

  /* ======================= 5. escalation ======================= */
  async function staffIds() { return [...new Set([...(await db.all("SELECT id FROM users WHERE role='admin' AND status='active'")).map(r => r.id), ...(await db.all("SELECT s.user_id AS id FROM safety_staff s JOIN users u ON u.id=s.user_id WHERE u.status='active'")).map(r => r.id)])]; }
  async function requireStaff(user, lead = false) {
    const v = await viewer(user.id);
    if (!v.staff) throw E.nf(); // the queue does not exist for anyone else
    if (lead && !["admin", "lead"].includes(v.staffRole)) throw E.forbid("لقائد فريق السلامة فقط");
    return v;
  }
  async function snapshot(target, kind) {
    if (!target) return null;
    if (kind === "post" || !kind) {
      const p = await db.get("SELECT * FROM posts WHERE id=$1", [target]);
      if (p) {
        const media = [];
        for (const ref of [p.data?.media, p.data?.cover, ...(p.data?.images || [])].filter(x => typeof x === "string" && x.startsWith("/media/"))) {
          const key = ref.slice(7); let hash = null, size = null;
          try { const b = await ctx.storage.get(key); const buf = Buffer.isBuffer(b) ? b : b?.body; if (buf) { hash = sha256(buf); size = buf.length; } } catch { }
          media.push({ ref, sha256: hash, size });
        }
        return { kind: "post", ref: target, data: { id: p.id, author: p.author, type: p.type, title: p.title, text: p.text, visibility: p.visibility, status: p.status, community: p.community, location: p.location, createdAt: p.created_at, updatedAt: p.updated_at, data: p.data || null, media, labels: (await labelsFor([p.id])).get(p.id) || null } };
      }
      if (kind === "post") return null;
    }
    if (kind === "comment" || !kind) { const c = await db.get("SELECT * FROM comments WHERE id=$1", [target]); if (c) return { kind: "comment", ref: target, data: { id: c.id, post: c.post, author: c.author, parent: c.parent, text: c.text, status: c.status, createdAt: c.created_at } }; if (kind) return null; }
    if (kind === "message" || !kind) { const m = await db.get("SELECT id, conv, sender, text, kind, created_at, deleted_at FROM messages WHERE id=$1", [target]); if (m) return { kind: "message", ref: target, data: { id: m.id, conv: m.conv, sender: m.sender, text: m.text, kind: m.kind, createdAt: m.created_at, deletedAt: m.deleted_at || null, note: "رسائل مشفرة طرفياً لا يمكن قراءتها؛ يُحفظ النص فقط إن كان غير مشفر" } }; if (kind) return null; }
    if (kind === "user" || !kind) { const u = await db.get("SELECT id, handle, name, bio, status, created_at, location FROM users WHERE id=$1", [target]); if (u) return { kind: "user", ref: target, data: { id: u.id, handle: u.handle, name: u.name, bio: u.bio, status: u.status, createdAt: u.created_at } }; if (kind) return null; }
    if (kind === "community") { const c = await db.get("SELECT id, name, descr, owner, type, created_at FROM communities WHERE id=$1", [target]); if (c) return { kind: "community", ref: target, data: { ...c } }; }
    return null;
  }
  /** append to the case's evidence hash chain */
  async function addEvidence(caseId, kind, ref, payload, by) {
    const last = await db.get("SELECT seq, hash FROM case_evidence WHERE case_id=$1 ORDER BY seq DESC LIMIT 1", [caseId]);
    const seq = (last?.seq || 0) + 1, at = now(), digest = sha256(stable(payload));
    const hash = sha256([last?.hash || "", caseId, seq, kind, ref || "", digest, at].join("|"));
    await db.run("INSERT INTO case_evidence(id,case_id,seq,kind,ref,payload,sha256,prev_hash,hash,captured_by,captured_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id("ev"), caseId, seq, kind, ref || null, payload, digest, last?.hash || null, hash, by || "system", at]);
    return { seq, sha256: digest, hash };
  }
  async function verifyChain(caseId) {
    let prev = null, checked = 0;
    for (const e of await db.all("SELECT * FROM case_evidence WHERE case_id=$1 ORDER BY seq", [caseId])) {
      const digest = sha256(stable(e.payload));
      const at = new Date(e.captured_at).toISOString();
      if (digest !== e.sha256 || (e.prev_hash || null) !== prev || sha256([prev || "", caseId, e.seq, e.kind, e.ref || "", digest, at].join("|")) !== e.hash) return { ok: false, brokenAt: e.seq, checked };
      prev = e.hash; checked++;
    }
    return { ok: true, checked, head: prev };
  }
  async function subjectOf(target, kind) {
    if (!target) return null;
    if (kind === "user") return target;
    const p = await db.get("SELECT author FROM posts WHERE id=$1", [target]); if (p) return p.author;
    const c = await db.get("SELECT author FROM comments WHERE id=$1", [target]); if (c) return c.author;
    const m = await db.get("SELECT sender FROM messages WHERE id=$1", [target]); if (m) return m.sender;
    return null;
  }
  async function alertStaff(c) {
    for (const uid of await staffIds()) { await notify(uid, "safety_case", { ref: c.id }); ctx.realtime?.send(uid, "safety_case", { id: c.id, severity: c.severity, category: c.category }); }
    const to = env.SAFETY_ALERT_EMAIL;
    if (to && ctx.mailer?.enabled && c.severity === "critical") ctx.mailer.send({ to, subject: `[مجتمع بلس] حالة سلامة عاجلة ${c.id}`, text: `فُتحت حالة بأولوية ${c.severity} (${M.CATEGORIES[c.category] || c.category}).\nلا تُرسل تفاصيل المحتوى بالبريد. راجع طابور السلامة داخل المنصة: #/safety-cases/${c.id}` }).catch(() => { });
  }
  /** open (or merge into) a case. Returns the case row. */
  async function openCase({ severity, category, target = null, targetKind = null, reportId = null, summary = null, reasons = [], minorInvolved = false, by = null }) {
    severity = M.SEV[severity] ? severity : "high"; category = M.CATEGORIES[category] ? category : "other";
    const at = now();
    const ex = target ? await db.get("SELECT * FROM safety_cases WHERE target=$1 AND status<>'closed' ORDER BY created_at LIMIT 1", [target]) : null;
    if (ex) {
      const sev = M.SEV[severity] > M.SEV[ex.severity] ? severity : ex.severity;
      await db.run("UPDATE safety_cases SET severity=$1, priority=$2, minor_involved=$3, hold=$4, updated_at=$5 WHERE id=$6", [sev, M.priority(sev, ex.created_at), ex.minor_involved || minorInvolved ? 1 : 0, ex.hold || shouldHold(sev, category) ? 1 : 0, at, ex.id]);
      await addEvidence(ex.id, "report", reportId, { reportId, summary, reasons, severity, category, by: by ? "user" : "system" }, by);
      if (M.SEV[sev] > M.SEV[ex.severity]) await alertStaff({ ...ex, severity: sev });
      cache.del("feed:");
      return { ...(await db.get("SELECT * FROM safety_cases WHERE id=$1", [ex.id])), merged: true };
    }
    const cid = id("sc"), subject = await subjectOf(target, targetKind);
    await db.run(`INSERT INTO safety_cases(id,severity,category,status,target,target_kind,subject_user,report_id,summary,reasons,minor_involved,hold,created_by,priority,sla_due_at,created_at,updated_at)
      VALUES($1,$2,$3,'open',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`, [cid, severity, category, target, targetKind, subject, reportId, summary ? String(summary).slice(0, 1000) : null, reasons.join(",").slice(0, 300), minorInvolved ? 1 : 0, shouldHold(severity, category) ? 1 : 0, by, M.priority(severity, at), new Date(Date.now() + M.SLA_MIN[severity] * 60e3).toISOString(), at]);
    const snap = await snapshot(target, targetKind);
    if (snap) await addEvidence(cid, snap.kind, snap.ref, snap.data, "system");
    await addEvidence(cid, "report", reportId, { reportId, summary, reasons, severity, category, by: by ? "user" : "system" }, by);
    await ctx.audit("SAFETY_CASE_OPENED", cid, `${severity}/${category}`, by || "system");
    const c = await db.get("SELECT * FROM safety_cases WHERE id=$1", [cid]);
    await alertStaff(c); bus.emit("SAFETY_CASE_OPENED", { case: cid, severity, category });
    cache.del("feed:");
    return c;
  }
  const shouldHold = (severity, category) => severity === "critical" && ["child_safety", "exploitation", "trafficking"].includes(category);
  async function involvesMinor(target, kind, reporterId) {
    const subj = await subjectOf(target, kind);
    const ms = await minorIds([subj, reporterId]);
    return ms.size > 0;
  }
  /* every ordinary report is screened; only severe ones enter the escalation queue */
  bus.on("REPORT_CREATED", async (e) => {
    const r = await db.get("SELECT * FROM reports WHERE id=$1", [e.report]); if (!r) return;
    const minor = await involvesMinor(r.target, r.kind, r.by_user);
    const cls = M.classifySeverity(r.reason, { minorInvolved: false });
    let { severity } = cls;
    if (minor && severity !== "normal") severity = "critical"; // a minor + a severe signal is always critical
    if (severity === "normal") return;
    await openCase({ severity, category: cls.category, target: r.target, targetKind: r.kind, reportId: r.id, summary: r.reason, reasons: [...cls.reasons, ...(minor ? ["minor_involved"] : [])], minorInvolved: minor, by: r.by_user });
  });
  async function escalate(user, b) {
    if (!rl.hit("report", user.id)) throw E.rate();
    const target = str(b.target, 60), kind = oneOf(b.kind, ["post", "comment", "user", "message", "community"], target ? "post" : null), details = str(b.details, 1000) || "";
    const category = M.CATEGORIES[b.category] ? b.category : null;
    if (!category && !details) throw E.bad("اختر نوع الخطر أو صِف ما حدث");
    if (target && kind === "message") { const m = await db.get("SELECT m.conv FROM messages m JOIN conversation_members cm ON cm.conv=m.conv AND cm.user_id=$2 WHERE m.id=$1", [target, user.id]); if (!m) throw E.nf(); }
    else if (target && kind === "post") { const p = await db.get("SELECT * FROM posts WHERE id=$1", [target]); if (!p || !(await content().canSee(p, user.id))) throw E.nf(); }
    const minor = await involvesMinor(target, kind, user.id);
    const cls = M.classifySeverity(details, { category, minorInvolved: minor });
    const severity = cls.severity === "normal" ? "high" : cls.severity; // a user-raised urgent flag is never «normal»
    const c = await openCase({ severity, category: cls.category, target, targetKind: kind, summary: details || M.CATEGORIES[cls.category], reasons: cls.reasons, minorInvolved: minor, by: user.id });
    return { ok: true, reference: c.id.slice(-6).toUpperCase(), severity: c.severity, helplines: HELPLINES, selfHarm: cls.category === "self_harm" };
  }
  const caseClient = (c, extra = {}) => ({ id: c.id, severity: c.severity, category: c.category, categoryName: M.CATEGORIES[c.category] || c.category, status: c.status, target: c.target, targetKind: c.target_kind, subject: c.subject_user, summary: c.summary, reasons: c.reasons ? c.reasons.split(",").filter(Boolean) : [],
    minorInvolved: !!c.minor_involved, hold: !!c.hold, assignedTo: c.assigned_to, priority: M.priority(c.severity, c.created_at), slaDueAt: c.sla_due_at, overdue: c.status !== "closed" && c.sla_due_at && new Date(c.sla_due_at) < new Date(), createdAt: c.created_at, updatedAt: c.updated_at, closedAt: c.closed_at, outcome: c.outcome, ...extra });
  const accessLog = (caseId, uid, action, detail) => db.run("INSERT INTO case_access_log(case_id,user_id,action,detail,at) VALUES($1,$2,$3,$4,$5)", [caseId, uid, action, detail || null, now()]);
  async function listCases(user, q) {
    await requireStaff(user);
    const status = oneOf(q.status, ["open", "active", "closed", "all"], "active");
    const where = status === "all" ? "1=1" : status === "closed" ? "status='closed'" : status === "open" ? "status='open'" : "status<>'closed'";
    const rows = (await db.all(`SELECT * FROM safety_cases WHERE ${where} ORDER BY created_at DESC LIMIT 300`)).map(c => caseClient(c));
    rows.sort((a, b) => Number(b.status !== "closed") - Number(a.status !== "closed") || b.priority - a.priority);
    const counts = {}; for (const c of await db.all("SELECT severity, COUNT(*) n FROM safety_cases WHERE status<>'closed' GROUP BY severity")) counts[c.severity] = c.n;
    return { cases: rows, counts, me: { role: (await viewer(user.id)).staffRole } };
  }
  async function getCase(user, cid) {
    const v = await requireStaff(user);
    const c = await db.get("SELECT * FROM safety_cases WHERE id=$1", [cid]); if (!c) throw E.nf();
    await accessLog(cid, user.id, "view");
    const evidence = (await db.all("SELECT * FROM case_evidence WHERE case_id=$1 ORDER BY seq", [cid])).map(e => ({ seq: e.seq, kind: e.kind, ref: e.ref, payload: e.payload, sha256: e.sha256, hash: e.hash, capturedBy: e.captured_by, capturedAt: e.captured_at }));
    const subject = c.subject_user ? await db.get("SELECT id, handle, name, status, created_at FROM users WHERE id=$1", [c.subject_user]) : null;
    return { case: caseClient(c), evidence, chain: await verifyChain(cid), subject: subject ? { ...subject, minor: await isMinorUser(subject.id) } : null,
      access: ["admin", "lead"].includes(v.staffRole) ? await db.all("SELECT user_id AS \"user\", action, detail, at FROM case_access_log WHERE case_id=$1 ORDER BY id DESC LIMIT 100", [cid]) : undefined,
      authorityReports: (await db.all("SELECT id, body, jurisdiction, status, created_at, exported_at, submitted_at, external_ref FROM authority_reports WHERE case_id=$1 ORDER BY created_at", [cid])),
      bodies: BODIES, channelConfigured: !!env.MINORS_AUTHORITY_CHANNEL, channel: env.MINORS_AUTHORITY_CHANNEL || null };
  }
  const OUTCOMES = ["actioned", "no_violation", "referred", "duplicate"];
  async function caseAction(user, cid, b) {
    const v = await requireStaff(user);
    const c = await db.get("SELECT * FROM safety_cases WHERE id=$1", [cid]); if (!c) throw E.nf();
    const action = oneOf(b.action, ["assign", "triage", "escalate", "note", "preserve", "hold", "release", "close", "reopen"], null); if (!action) throw E.bad();
    if (c.status === "closed" && !["reopen", "note"].includes(action)) throw E.bad("الحالة مغلقة");
    const at = now(), set = {};
    if (action === "assign") set.assigned_to = b.to === null ? null : str(b.to, 40) || user.id;
    if (action === "triage") set.status = "triage";
    if (action === "escalate") { const order = ["normal", "high", "critical"]; const sev = order[Math.min(2, order.indexOf(c.severity) + 1)]; set.severity = sev; set.priority = M.priority(sev, c.created_at); set.status = "escalated"; }
    if (action === "note") await addEvidence(cid, "note", null, { text: str(b.note, 2000, { required: true }) }, user.id);
    if (action === "preserve") { const s = await snapshot(c.target, c.target_kind); if (!s) throw E.nf("الهدف غير موجود"); await addEvidence(cid, s.kind, s.ref, s.data, user.id); }
    if (action === "hold") set.hold = 1;
    if (action === "release") { if (!["admin", "lead"].includes(v.staffRole)) throw E.forbid("لقائد فريق السلامة فقط"); set.hold = 0; }
    if (action === "close") { const o = oneOf(b.outcome, OUTCOMES, null); if (!o) throw E.bad("حدّد نتيجة الإغلاق"); set.status = "closed"; set.outcome = o; set.closed_at = at; set.hold = o === "actioned" || o === "referred" ? c.hold : 0; }
    if (action === "reopen") { set.status = "open"; set.closed_at = null; set.outcome = null; }
    const keys = Object.keys(set);
    if (keys.length) await db.run(`UPDATE safety_cases SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map(k => set[k]), at, cid]);
    await accessLog(cid, user.id, action, b.outcome || null);
    await ctx.audit("SAFETY_CASE_" + action.toUpperCase(), cid, b.outcome || null, user.id);
    cache.del("feed:");
    return { case: caseClient(await db.get("SELECT * FROM safety_cases WHERE id=$1", [cid])) };
  }

  /* ======================= 6. official reporting bodies (records only; manual delivery) ======================= */
  async function buildAuthorityPayload(c, b, user, rid) {
    const subj = c.subject_user ? await db.get("SELECT id, handle, name, status, created_at, pi_uid FROM users WHERE id=$1", [c.subject_user]) : null;
    const ap = subj ? await profileRow(subj.id) : null;
    const sessions = subj ? await db.all("SELECT ip, ua, created_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5", [subj.id]) : [];
    const evidence = (await db.all("SELECT * FROM case_evidence WHERE case_id=$1 ORDER BY seq", [c.id])).map(e => ({ seq: e.seq, kind: e.kind, ref: e.ref, capturedAt: e.captured_at, sha256: e.sha256, hash: e.hash, payload: e.payload }));
    return {
      schema: "mujtama.authority-report/1", reportId: rid, generatedAt: now(), delivery: "manual",
      platform: { name: "مجتمع بلس", version: config.version, operatorContact: env.MINORS_OPERATOR_CONTACT || null },
      recipient: { body: b.body, jurisdiction: b.jurisdiction || null },
      incident: { caseId: c.id, category: c.category, categoryName: M.CATEGORIES[c.category], severity: c.severity, openedAt: c.created_at, summary: c.summary, minorInvolved: !!c.minor_involved, reasons: c.reasons ? c.reasons.split(",").filter(Boolean) : [], origin: c.created_by ? "user_report" : "system" },
      subject: subj ? { userId: subj.id, handle: subj.handle, displayName: subj.name, accountCreatedAt: subj.created_at, accountStatus: subj.status, piUid: subj.pi_uid || null,
        declaredAge: ap?.birth_date ? { band: describe(ap).band, source: ap.source, selfDeclared: ap.source === "self" } : null,
        recentSessions: sessions.map(s => ({ ip: s.ip, userAgent: s.ua, at: s.created_at })) } : null,
      evidence, chain: await verifyChain(c.id), preparedBy: user.id, notes: b.notes || null
    };
  }
  async function createAuthorityReport(user, cid, b) {
    await requireStaff(user, true);
    const c = await db.get("SELECT * FROM safety_cases WHERE id=$1", [cid]); if (!c) throw E.nf();
    const body = oneOf(b.body, BODIES, null); if (!body) throw E.bad("جهة غير معروفة");
    const rid = id("ar"), payload = await buildAuthorityPayload(c, { body, jurisdiction: str(b.jurisdiction, 40), notes: str(b.notes, 2000) }, user, rid);
    await db.run("INSERT INTO authority_reports(id,case_id,body,jurisdiction,status,payload,payload_sha256,notes,created_by,created_at) VALUES($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9)", [rid, cid, body, payload.recipient.jurisdiction, payload, sha256(stable(payload)), payload.notes, user.id, now()]);
    if (c.status !== "closed") await db.run("UPDATE safety_cases SET status='escalated', hold=1, updated_at=$1 WHERE id=$2", [now(), cid]); // keep the evidence held while a referral is open
    await accessLog(cid, user.id, "authority_draft", body);
    await ctx.audit("AUTHORITY_REPORT_DRAFTED", cid, body, user.id);
    return { report: { id: rid, body, status: "draft", sha256: sha256(stable(payload)) }, delivery: "manual", channelConfigured: !!env.MINORS_AUTHORITY_CHANNEL };
  }
  async function exportAuthorityReport(user, rid) {
    await requireStaff(user, true);
    const r = await db.get("SELECT * FROM authority_reports WHERE id=$1", [rid]); if (!r) throw E.nf();
    await db.run("UPDATE authority_reports SET status=CASE WHEN status='draft' THEN 'exported' ELSE status END, exported_at=$1 WHERE id=$2", [now(), rid]);
    await accessLog(r.case_id, user.id, "authority_export", rid);
    await ctx.audit("AUTHORITY_REPORT_EXPORTED", rid, r.body, user.id);
    return { filename: `authority-report-${rid}.json`, sha256: r.payload_sha256, verified: sha256(stable(r.payload)) === r.payload_sha256, payload: r.payload,
      instructions: env.MINORS_AUTHORITY_CHANNEL ? `سلّم الملف عبر القناة التي أعدّها المشغّل: ${env.MINORS_AUTHORITY_CHANNEL}` : "لا توجد قناة مُعدّة. يجب على مشغّل المنصة تحديد قناة الإبلاغ الرسمية (MINORS_AUTHORITY_CHANNEL) والتسليم يدوياً." };
  }
  async function markSubmitted(user, rid, b) {
    await requireStaff(user, true);
    const r = await db.get("SELECT * FROM authority_reports WHERE id=$1", [rid]); if (!r) throw E.nf();
    const status = oneOf(b.status, ["submitted", "acknowledged"], "submitted");
    await db.run("UPDATE authority_reports SET status=$1, submitted_at=COALESCE(submitted_at,$2), submitted_by=COALESCE(submitted_by,$3), channel=$4, external_ref=$5 WHERE id=$6", [status, now(), user.id, str(b.channel, 120) || env.MINORS_AUTHORITY_CHANNEL || null, str(b.externalRef, 120), rid]);
    await accessLog(r.case_id, user.id, "authority_" + status, str(b.externalRef, 120));
    await ctx.audit("AUTHORITY_REPORT_" + status.toUpperCase(), rid, str(b.externalRef, 120), user.id);
    return { ok: true, state: status };
  }

  /* ======================= 8. family links ======================= */
  /* M3-5/F6: guardian_links.settings also carries the weekly mentoring summary switch (mentorWeekly: 0 = off; default on)
   *  and the last ISO week it was sent (mentorWeeklyWeek, written by the mentor tick). Both survive control changes. */
  const linkSettings = (v) => { if (v && typeof v === "object") return v; try { const o = JSON.parse(v || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
  const linkExtras = (v) => { const o = linkSettings(v), out = {}; for (const k of ["mentorWeekly", "mentorWeeklyWeek"]) if (o[k] !== undefined) out[k] = o[k]; return out; };
  const weeklyOn = (v) => { const w = linkSettings(v).mentorWeekly; return !(w === 0 || w === false); };
  async function setWeekly(user, lid, b) {
    const l = await db.get("SELECT * FROM guardian_links WHERE id=$1 AND status='active' AND guardian_id=$2", [lid, user.id]); if (!l) throw E.nf();
    if (typeof b.on !== "boolean") throw E.bad("قيمة غير صالحة");
    await db.run("UPDATE guardian_links SET settings=$1 WHERE id=$2", [{ ...linkSettings(l.settings), mentorWeekly: b.on ? 1 : 0 }, lid]);
    return { link: await linkClient(await db.get("SELECT * FROM guardian_links WHERE id=$1", [lid]), user.id) };
  }
  const linkClient = async (l, me) => {
    const otherId = l.guardian_id === me ? l.minor_id : l.guardian_id;
    const o = await db.get("SELECT * FROM users WHERE id=$1", [otherId]);
    return { id: l.id, role: l.guardian_id === me ? "guardian" : "minor", status: l.status, other: o ? users().pub(o) : null, controls: M.normalizeControls(linkSettings(l.settings)), ...(l.guardian_id === me ? { mentorWeekly: weeklyOn(l.settings) } : {}), initiatedByMe: l.initiated_by === me, createdAt: l.created_at, acceptedAt: l.accepted_at, endedAt: l.ended_at };
  };
  /** what a guardian sees about a linked minor — the minor sees exactly the same object */
  async function guardianView(minorId) {
    const u = await db.get("SELECT * FROM users WHERE id=$1", [minorId]);
    const count = async (sql) => (await db.get(sql, [minorId])).n;
    return { user: users().pub(u), privacy: { private: !!u.private, ...ctx.policy.privacyOf(u) }, followers: await count("SELECT COUNT(*) n FROM follows WHERE dst=$1"), following: await count("SELECT COUNT(*) n FROM follows WHERE src=$1"),
      pendingFollowRequests: await count("SELECT COUNT(*) n FROM follow_requests WHERE dst=$1"), note: "لا يرى وليّ الأمر الرسائل ولا المنشورات الخاصة ولا سجل التصفح" };
  }
  async function family(user) {
    const me = describe(await profileRow(user.id));
    const links = await db.all("SELECT * FROM guardian_links WHERE (guardian_id=$1 OR minor_id=$1) AND status IN ('pending','active') ORDER BY created_at DESC", [user.id]);
    const out = []; for (const l of links) out.push(await linkClient(l, user.id));
    return { me: { band: me.band, minor: me.minor }, links: out, whatGuardiansSee: me.minor && out.some(l => l.role === "minor" && l.status === "active") ? await guardianView(user.id) : null,
      activity: me.minor ? await db.all("SELECT actor, action, detail, at FROM minors_events WHERE user_id=$1 ORDER BY id DESC LIMIT 50", [user.id]) : [] };
  }
  async function invite(user, b) {
    if (!rl.hit("invite", user.id)) throw E.rate();
    const handle = str(b.handle, 30, { required: true }).replace(/^@/, "");
    const other = await db.get("SELECT id, status FROM users WHERE LOWER(handle)=LOWER($1)", [handle]); if (!other || other.status !== "active" || other.id === user.id) throw E.nf("الحساب غير موجود");
    const as = oneOf(b.as, ["guardian", "minor"], null); if (!as) throw E.bad();
    const guardian = as === "guardian" ? user.id : other.id, minor = as === "guardian" ? other.id : user.id;
    const [g, m] = await Promise.all([profileRow(guardian), profileRow(minor)]);
    if (describe(g).band !== "adult") throw E.bad(as === "guardian" ? "يجب أن تؤكد أن عمرك ١٨ سنة أو أكثر لتكون وليّ أمر" : "وليّ الأمر يجب أن يكون قد أكّد أن عمره ١٨ سنة أو أكثر");
    if (describe(m).band !== "teen") throw E.bad("الربط العائلي متاح فقط لحساب عمره المُصرَّح دون ١٨ سنة");
    const mutual = await ctx.policy.follows(guardian, minor) && await ctx.policy.follows(minor, guardian);
    if (!mutual) throw E.forbid("يجب أن يتابع كل منكما الآخر قبل الربط العائلي");
    if (await db.get("SELECT 1 x FROM guardian_links WHERE guardian_id=$1 AND minor_id=$2 AND status IN ('pending','active')", [guardian, minor])) throw E.conflict("يوجد ربط أو طلب قائم");
    if ((await db.get("SELECT COUNT(*) n FROM guardian_links WHERE minor_id=$1 AND status='active'", [minor])).n >= 2) throw E.bad("الحد الأقصى وليّا أمر لكل حساب");
    if ((await db.get("SELECT COUNT(*) n FROM guardian_links WHERE guardian_id=$1 AND status IN ('pending','active')", [guardian])).n >= 6) throw E.bad("بلغت الحد الأقصى من الحسابات المرتبطة");
    const lid = id("gl");
    await db.run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES($1,$2,$3,'pending',$4,$5,$6)", [lid, guardian, minor, user.id, {}, now()]);
    await log(minor, "family_requested", as === "guardian" ? "guardian invited you" : "you invited a guardian", user.id);
    await notify(other.id, "family_request", { actor: user.id, ref: lid });
    return { link: await linkClient(await db.get("SELECT * FROM guardian_links WHERE id=$1", [lid]), user.id) };
  }
  async function respond(user, lid, accept) {
    const l = await db.get("SELECT * FROM guardian_links WHERE id=$1 AND status='pending' AND (guardian_id=$2 OR minor_id=$2)", [lid, user.id]); if (!l) throw E.nf();
    if (l.initiated_by === user.id) throw E.forbid("بانتظار موافقة الطرف الآخر");
    if (accept) {
      if (describe(await profileRow(l.minor_id)).band !== "teen" || describe(await profileRow(l.guardian_id)).band !== "adult") throw E.bad("تغيّر العمر المُصرَّح؛ لم يعد الربط ممكناً");
      await db.run("UPDATE guardian_links SET status='active', accepted_at=$1 WHERE id=$2", [now(), lid]);
      await log(l.minor_id, "family_linked", null, user.id);
      await applyMinorDefaults(l.minor_id, user.id);
    } else {
      await db.run("UPDATE guardian_links SET status='declined', ended_at=$1, ended_by=$2 WHERE id=$3", [now(), user.id, lid]);
      await log(l.minor_id, "family_declined", null, user.id);
    }
    await notify(l.initiated_by, "family_update", { actor: user.id, ref: lid });
    return { link: await linkClient(await db.get("SELECT * FROM guardian_links WHERE id=$1", [lid]), user.id) };
  }
  async function unlink(user, lid) {
    const l = await db.get("SELECT * FROM guardian_links WHERE id=$1 AND status IN ('pending','active') AND (guardian_id=$2 OR minor_id=$2)", [lid, user.id]); if (!l) throw E.nf();
    await db.run("UPDATE guardian_links SET status='ended', ended_at=$1, ended_by=$2 WHERE id=$3", [now(), user.id, lid]);
    await log(l.minor_id, "family_ended", user.id === l.minor_id ? "ended by you" : "ended by guardian", user.id);
    await notify(user.id === l.minor_id ? l.guardian_id : l.minor_id, "family_update", { actor: user.id, ref: lid });
    return { ok: true };
  }
  async function setControls(user, lid, b) {
    const l = await db.get("SELECT * FROM guardian_links WHERE id=$1 AND status='active' AND guardian_id=$2", [lid, user.id]); if (!l) throw E.nf();
    if (!(await isMinorUser(l.minor_id))) { await becameAdult(l.minor_id, "system"); throw E.bad("لم يعد الحساب لقاصر"); }
    const keep = linkExtras(l.settings); // M3-5: keep the weekly-summary switch + its week marker
    const next = { ...keep, ...M.normalizeControls(linkSettings(l.settings)), ...M.normalizeControls(b) };
    await db.run("UPDATE guardian_links SET settings=$1 WHERE id=$2", [next, lid]);
    const changed = Object.entries(M.normalizeControls(b)).map(([k, v]) => `${M.GUARDIAN_CONTROLS[k].name}: ${v}`).join("، ");
    await log(l.minor_id, "guardian_controls", changed, user.id);
    await applyMinorDefaults(l.minor_id, user.id);
    await notify(l.minor_id, "family_update", { actor: user.id, ref: lid });
    return { link: await linkClient(await db.get("SELECT * FROM guardian_links WHERE id=$1", [lid]), user.id), view: await guardianView(l.minor_id) };
  }
  async function overview(user, lid) {
    const l = await db.get("SELECT * FROM guardian_links WHERE id=$1 AND status='active' AND guardian_id=$2", [lid, user.id]); if (!l) throw E.nf();
    return { view: await guardianView(l.minor_id), activity: await db.all("SELECT actor, action, detail, at FROM minors_events WHERE user_id=$1 AND action LIKE 'guardian_%' ORDER BY id DESC LIMIT 20", [l.minor_id]) };
  }

  /* ======================= hooks into existing services (no shared file edited) ======================= */
  const hooked = [];
  /** @param {string} method @param {string} path @param {{ before?: (req: any, res: any) => Promise<any>, after?: (out: any, req: any, res: any) => Promise<any> }} fns */
  function hook(method, path, { before = null, after = null }) {
    const m = R.match(method, path); if (!m) return false;
    const route = R.routes.find(r => r.method === method && r.re === m.re && r.handler === m.handler); if (!route || route.handler.__mpMinors?.includes(path)) return false;
    const orig = route.handler;
    const wrapped = async (req, res) => { if (before) await before(req, res); const out = await orig(req, res); return after ? ((await after(out, req, res)) ?? out) : out; };
    wrapped.__mpMinors = [...(orig.__mpMinors || []), path];
    route.handler = wrapped; hooked.push(`${method} ${path}`); return true;
  }
  function install() {
    const c = content();
    if (c && !c.__mpMinors) {
      const fv = c.filterVisible, cs = c.canSee, tc = c.toClient;
      c.filterVisible = async (rows, viewerId) => filterPosts(await fv(rows, viewerId), viewerId);
      c.canSee = async (row, viewerId) => !!(await cs(row, viewerId)) && (await filterPosts([row], viewerId)).length === 1;
      c.toClient = (r, viewerId) => decorate(tc(r, viewerId), r, viewerId);
      c.__mpMinors = true;
    }
    // sign-up: optional/required birth date and the age gate
    hook("POST", "/api/auth/register", {
      before: async (req) => {
        if (req.cookies?.mp_agegate) throw new HttpError(403, `عذراً، يجب أن يكون عمرك ${MIN_AGE} سنة على الأقل لإنشاء حساب`, "age_gate");
        const raw = req.body?.birthDate;
        if (!raw) { if (REQUIRE_DOB) throw new HttpError(400, "تاريخ الميلاد مطلوب", "dob_required"); return; }
        const bd = M.parseBirthDate(raw, today()); if (!bd) throw E.bad("تاريخ الميلاد غير صالح");
        if (M.band(M.ageOn(bd, today()), MIN_AGE) === "child") { req._mpGate = true; throw new HttpError(403, `عذراً، يجب أن يكون عمرك ${MIN_AGE} سنة على الأقل لإنشاء حساب`, "age_gate"); }
        req._mpDob = bd;
      },
      after: async (out, req) => { if (req._mpDob && out?.user?.id) { await declare({ id: out.user.id }, req._mpDob, { actor: out.user.id }); out.age = await summary(out.user.id); } return out; }
    });
    // the age gate sets a one-day cookie so the form cannot simply be retried with another date
    const reg = R.routes.find(r => r.method === "POST" && r.re.test("/api/auth/register"));
    if (reg) { const h = reg.handler; reg.handler = async (req, res) => { try { return await h(req, res); } catch (e) { if (e.code === "age_gate" && req._mpGate) res.cookie("mp_agegate", "1", { maxAge: 86400 }); throw e; } }; reg.handler.__mpMinors = h.__mpMinors; }
    // privacy: a minor cannot loosen the protected floor
    hook("PUT", "/api/privacy", {
      before: async (req) => {
        if (!req.user || !(await isMinorUser(req.user.id))) return;
        const b = req.body || {}, floor = await floorFor(req.user.id);
        if (b.private !== undefined && !b.private) throw E.forbid("حسابات من هم دون ١٨ سنة تبقى خاصة");
        if (b.filterRequests !== undefined && !b.filterRequests) throw E.forbid("طلبات المراسلة تبقى مفلترة لحسابات من هم دون ١٨ سنة");
        for (const k of ["dm", "mentions", "comments"]) if (b[k] !== undefined && !M.allowedForMinor(k, b[k], floor)) throw E.forbid("هذا الإعداد مقيّد لحماية الحسابات دون ١٨ سنة");
      }
    });
    hook("PATCH", "/api/profile", { before: async (req) => { if (req.user && req.body?.location && await isMinorUser(req.user.id)) throw E.forbid("إظهار الموقع غير متاح لحسابات من هم دون ١٨ سنة"); } });
    // posting: minors never attach a location; labels chosen in the composer are saved with the post
    hook("POST", "/api/posts", {
      before: async (req) => { if (req.user && req.body && await isMinorUser(req.user.id)) delete req.body.location; },
      after: async (out, req) => {
        const b = req.body || {}, pid = out?.post?.id; if (!pid || (!b.labels && !b.mediaLabels)) return out;
        const labels = await setLabels(req.user, pid, { labels: b.labels, media: b.mediaLabels }, { fromCreate: true }).catch(() => null);
        if (labels) { out.post.contentLabels = labels; out.post.sensitive = M.allLabels(labels).length > 0 || out.post.sensitive; }
        return out;
      }
    });
    // direct post links obey the same age filter as lists
    for (const p of ["/api/posts/:id", "/api/posts/:id/comments"]) hook("GET", p.replace(":id", "x_probe"), {
      before: async (req) => { const row = await db.get("SELECT * FROM posts WHERE id=$1", [req.params.id]); if (row && !(await filterPosts([row], req.user?.id)).length) throw E.nf(); req._mpRow = row; },
      after: async (out, req) => { if (out?.post && req._mpRow) decorate(out.post, req._mpRow, req.user?.id); return out; }
    });
    // people lists: never suggest minors to adults
    hook("GET", "/api/search", { after: async (out, req) => { if (out?.users) out.users = await filterUsers(out.users, req.user?.id); return out; } });
    hook("GET", "/api/search/full", { after: async (out, req) => { if (out?.groups?.people?.items) { const before = out.groups.people.items.length; out.groups.people.items = await filterUsers(out.groups.people.items, req.user?.id); out.groups.people.total = Math.max(0, out.groups.people.total - (before - out.groups.people.items.length)); } if (Array.isArray(out?.users)) out.users = await filterUsers(out.users, req.user?.id); return out; } });
    hook("GET", "/api/search/suggest", { after: async (out, req) => { if (out?.people) out.people = await filterUsers(out.people, req.user?.id); return out; } });
    hook("GET", "/api/bootstrap", {
      after: async (out, req) => {
        if (!out?.users || !req.user) return out;
        const keep = await filterSuggest(out.users, req.user.id); if (keep.length === out.users.length) return out;
        const ref = new Set([req.user.id, ...(out.posts || []).map(p => p.author), ...(out.comments || []).map(c => c.author), ...(out.memberships || []).map(m => m.user), ...(out.conversations || []).flatMap(c => c.members || []), ...(out.notifications || []).map(n => n.actor), ...(out.reactions || []).map(r => r.user)]);
        const allowed = new Set(keep.map(u => u.id));
        out.users = out.users.filter(u => allowed.has(u.id) || ref.has(u.id));
        const present = new Set(out.users.map(u => u.id));
        if (out.follows) out.follows = out.follows.filter(f => present.has(f.from) && present.has(f.to));
        return out;
      }
    });
    return hooked;
  }
  // defence in depth for paths that bypass the routes above
  bus.on("POST_CREATED", async (e) => { const p = e.post; if (p?.location && await isMinorUser(p.author)) await db.run("UPDATE posts SET location=NULL WHERE id=$1", [p.id]); });
  bus.on("PROFILE_UPDATED", async (e) => { if (e.user && await isMinorUser(e.user)) await db.run("UPDATE users SET location=NULL WHERE id=$1 AND location IS NOT NULL", [e.user]); });

  /* ======================= routes ======================= */
  R.get("/api/age", A(async (req) => summary(req.user.id)));
  R.post("/api/age", A(async (req) => declare(req.user, req.body.birthDate)));
  R.put("/api/age/preferences", A(async (req) => {
    const mode = oneOf(req.body.sensitive, ["blur", "show", "hide"], null); if (!mode) throw E.bad();
    const d = describe(await profileRow(req.user.id));
    if (d.minor && mode !== "hide") throw E.forbid("المحتوى الحساس مخفي دائماً لمن هم دون ١٨ سنة");
    if (mode === "show" && d.band !== "adult") throw E.forbid("أكّد عمرك أولاً لعرض المحتوى الحساس دون تغطية");
    await upsertProfile(req.user.id, { content_pref: mode }); forget(req.user.id);
    return summary(req.user.id);
  }));
  R.post("/api/age/pi-kyc", A(async (req) => {
    if (!KYC) throw E.off("إشارة توثيق Pi غير مفعّلة");
    const u = req.user; if (!u.pi_uid) throw E.bad("اربط حساب Pi أولاً");
    const r = await fetchImpl(config.piApi + "/v2/me", { headers: { Authorization: "Bearer " + str(req.body.accessToken, 2000, { required: true }) } });
    if (!r.ok) throw new HttpError(401, "تعذر التحقق من حساب Pi", "pi_invalid");
    const me = await r.json();
    if (me.uid !== u.pi_uid) throw E.forbid("حساب Pi لا يطابق حسابك");
    const verified = me.kyc_verified === true || me.kyc === "verified" || me.credentials?.kyc_verified === true; // stub: Pi exposes no age; KYC is treated only as an adult signal
    await upsertProfile(u.id, { kyc_signal: verified ? "verified" : "unverified", kyc_at: now() });
    const row = await profileRow(u.id);
    if (verified && row.pending_birth_date) { await upsertProfile(u.id, { birth_date: row.pending_birth_date, source: "pi_kyc", pending_birth_date: null, pending_at: null }); forget(u.id); await becameAdult(u.id, "pi_kyc"); await log(u.id, "age_raised", "pi_kyc", "system"); }
    return summary(u.id);
  }));
  R.get("/api/safety/age-reviews", A(async (req) => { await requireStaff(req.user); return { reviews: await db.all("SELECT a.user_id AS \"user\", u.handle, u.name, a.birth_date AS \"current\", a.pending_birth_date AS \"requested\", a.pending_at AS \"since\", a.kyc_signal AS kyc FROM age_profiles a JOIN users u ON u.id=a.user_id WHERE a.pending_birth_date IS NOT NULL ORDER BY a.pending_at", []) }; }));
  R.post("/api/safety/age-reviews/:id", A(async (req) => {
    await requireStaff(req.user, true);
    const row = await profileRow(req.params.id); if (!row?.pending_birth_date) throw E.nf();
    const approve = req.body.action === "approve";
    if (approve) { await upsertProfile(req.params.id, { birth_date: row.pending_birth_date, source: "review", pending_birth_date: null, pending_at: null }); forget(req.params.id); await becameAdult(req.params.id, req.user.id); }
    else await upsertProfile(req.params.id, { pending_birth_date: null, pending_at: null });
    await log(req.params.id, approve ? "age_raised" : "age_raise_rejected", null, req.user.id);
    await ctx.audit(approve ? "AGE_RAISE_APPROVED" : "AGE_RAISE_REJECTED", req.params.id, null, req.user.id);
    return { ok: true };
  }));

  R.get("/api/content-labels", async () => ({ labels: M.LABEL_KEYS.map(k => ({ key: k, ...M.LABELS[k] })) }));
  R.get("/api/content-labels/batch", async (req) => {
    const ids = String(req.query.ids || "").split(",").map(s => s.trim()).filter(s => /^[\w-]{3,40}$/.test(s)).slice(0, 50);
    if (!ids.length) return { items: {} };
    const rows = await db.all(`SELECT * FROM posts WHERE id IN (${ph(ids)})`, ids);
    const vis = await content().filterVisible(rows, req.user?.id), items = {};
    for (const r of vis) { const o = decorate({}, r, req.user?.id); items[r.id] = { labels: o.contentLabels || { post: [], media: {} }, cover: o.cover || "none" }; }
    return { items };
  });
  R.put("/api/posts/:id/labels", A(async (req) => ({ labels: await setLabels(req.user, req.params.id, req.body || {}) })));

  R.post("/api/safety/escalate", A(async (req) => escalate(req.user, req.body || {})));
  R.get("/api/safety/helplines", async () => ({ helplines: HELPLINES }));
  R.get("/api/safety/cases", A(async (req) => listCases(req.user, req.query)));
  R.get("/api/safety/cases/:id", A(async (req) => getCase(req.user, req.params.id)));
  R.post("/api/safety/cases/:id", A(async (req) => caseAction(req.user, req.params.id, req.body || {})));
  R.get("/api/safety/cases/:id/verify", A(async (req) => { await requireStaff(req.user); return verifyChain(req.params.id); }));
  R.post("/api/safety/cases/:id/authority-reports", A(async (req) => createAuthorityReport(req.user, req.params.id, req.body || {})));
  R.get("/api/safety/authority-reports/:id/export", A(async (req) => exportAuthorityReport(req.user, req.params.id)));
  R.post("/api/safety/authority-reports/:id/submitted", A(async (req) => markSubmitted(req.user, req.params.id, req.body || {})));
  R.get("/api/safety/staff", A(async (req) => { await requireStaff(req.user, true); return { staff: await db.all("SELECT s.user_id AS id, u.handle, u.name, s.role, s.created_at AS \"since\" FROM safety_staff s JOIN users u ON u.id=s.user_id ORDER BY s.created_at", []) }; }));
  R.put("/api/safety/staff/:id", A(async (req) => {
    if (req.user.role !== "admin") throw E.forbid("للإدارة فقط");
    if (!(await db.get("SELECT 1 x FROM users WHERE id=$1", [req.params.id]))) throw E.nf();
    if (await isMinorUser(req.params.id)) throw E.bad("لا يمكن إضافة حساب قاصر لفريق السلامة");
    const role = oneOf(req.body.role, ["agent", "lead"], "agent");
    await db.run("INSERT INTO safety_staff(user_id,role,added_by,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role", [req.params.id, role, req.user.id, now()]);
    await ctx.audit("SAFETY_STAFF_SET", req.params.id, role, req.user.id); forget(req.params.id);
    return { ok: true, role };
  }));
  R.del("/api/safety/staff/:id", A(async (req) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); await db.run("DELETE FROM safety_staff WHERE user_id=$1", [req.params.id]); await ctx.audit("SAFETY_STAFF_REMOVED", req.params.id, null, req.user.id); forget(req.params.id); return { ok: true }; }));

  R.get("/api/family", A(async (req) => family(req.user)));
  R.post("/api/family/links", A(async (req) => invite(req.user, req.body || {})));
  R.post("/api/family/links/:id/accept", A(async (req) => respond(req.user, req.params.id, true)));
  R.post("/api/family/links/:id/decline", A(async (req) => respond(req.user, req.params.id, false)));
  R.del("/api/family/links/:id", A(async (req) => unlink(req.user, req.params.id)));
  R.put("/api/family/links/:id/controls", A(async (req) => setControls(req.user, req.params.id, req.body || {})));
  R.put("/api/family/links/:id/weekly", A(async (req) => setWeekly(req.user, req.params.id, req.body || {})));
  R.get("/api/family/links/:id/overview", A(async (req) => overview(req.user, req.params.id)));

  const installed = opts.install === false ? [] : install();
  return { filterPosts, filterUsers, filterSuggest, decorate, viewer, isMinorUser, minorIds, declare, summary, applyMinorDefaults, setLabels, labelsFor, openCase, verifyChain, snapshot, heldSet,
    isPreserved: async (target) => (await db.get("SELECT 1 x FROM safety_cases WHERE target=$1 AND (hold=1 OR status<>'closed')", [target])) ? true : !!(await db.get("SELECT 1 x FROM case_evidence WHERE ref=$1", [target])),
    install, hooked: installed, MIN_AGE };
};
