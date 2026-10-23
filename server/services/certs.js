/* Verifiable certificates «شهادات قابلة للتحقق» (phase 73). Free; no external service, no new keys in the environment.
 *  1. Issuance (idempotent, one per kind + reference + holder):
 *       course  ← bus COURSE_COMPLETED (phase 72: every published lesson done, quizzes passed)
 *       study   ← bus STUDY_COMPLETED (phase 71: a teacher confirmed completion of a study group / halaqa)
 *       exam    ← a passed exam with «certificate on pass» (services/exams.js)
 *     Missing certificates for completions that happened before v2.31 are issued when the holder opens #/certificates.
 *  2. Signature: Ed25519 over a canonical JSON payload (code, kind, title, holder, issuer, date, details). The key pair is
 *     generated once and kept in notify_keys with the private half sealed (AES-256-GCM, same seal key as phase 52 provider
 *     settings). Public keys: /api/certificates/keys and /.well-known/mujtama-certificates.json — anyone can verify offline.
 *  3. Verification: /cert/<code> (server-rendered, printable A4, QR, no script) and /api/certificates/verify/<code>
 *     (payload + signature + key + status). Verification views are counted per day, never who looked.
 *  4. Holder: list, show / hide on profile (public | unlisted — an unlisted one still verifies by code), share, print.
 *  5. Issuer: teachers / group admins revoke (with a reason) and restore; the revocation shows on every verification.
 *     A phase 71 completion withdrawn by the teacher revokes its certificate automatically.
 *  6. Minors (phase 35): the certificate shows the first name + initial only, is unlisted by default and never listed on a
 *     profile; no contact data is ever part of a certificate. */
const crypto = require("node:crypto");
const fs = require("node:fs"), path = require("node:path");
const { E, str, id } = require("../lib/core");
const P = require("../lib/providers");
const { secret } = require("../lib/secrets");

const B32 = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KINDS = { course: "إتمام دورة", study: "إتمام مجموعة دراسة", exam: "اجتياز اختبار", volunteer: "شهادة تطوّع", mentorship: "إتمام برنامج إرشاد" }; // mentorship: M5-1/F11 (a mentor certifies a mentee after ≥1 completed session) // volunteer: phase 70 (confirmed volunteering hours)
const MANAGER_ROLES = ["owner", "admin", "moderator"];
const normCode = (c) => { const s = String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); const b = s.startsWith("MP") ? s.slice(2) : s; return /^[A-Z0-9]{8}$/.test(b) ? `MP-${b.slice(0, 4)}-${b.slice(4)}` : null; };
const canonical = (o) => (Array.isArray(o) ? `[${o.map(canonical).join(",")}]` : o && typeof o === "object" ? `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(o[k])).join(",")}}` : JSON.stringify(o));
let QR = null;
function qrSvg(text) {
  if (QR === null) { QR = false; for (const p of [process.env.WEB_ROOT && path.join(process.env.WEB_ROOT, "vendor", "qrcode.js"), path.join(__dirname, "..", "..", "vendor", "qrcode.js")].filter(Boolean)) { try { if (fs.existsSync(p)) { QR = require(p); break; } } catch { /* next */ } } }
  if (!QR) return "";
  try { const q = QR(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 1, scalable: true }).replace("<svg ", '<svg role="img" aria-label="رمز QR لصفحة التحقق" '); } catch { return ""; }
}

/** @param {any} ctx @param {{ now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = () => new Date(clock()).toISOString();
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const inflight = new Set();
  const track = (fn) => (e) => { const p = Promise.resolve().then(() => fn(e)).catch((err) => ctx.log?.error?.("certs handler failed", { err: err.message })).finally(() => inflight.delete(p)); inflight.add(p); return p; };
  const notify = async (uid, kind, ref) => { try { await ctx.services.notify?.notify(uid, kind, { ref }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };

  /* ---------- signing key ---------- */
  let sealP = null, keyP = null;
  const sealKey = () => (sealP ||= (async () => {
    const k = secret("PROVIDER_SEAL_KEY"); if (k) return crypto.createHash("sha256").update(k).digest("base64url");
    let r = await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'");
    if (!r) { await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('provider_seal',$1,$2) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString("base64url"), iso()]); r = await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'"); }
    return r.value;
  })().catch((e) => { sealP = null; throw e; }));
  const key = () => (keyP ||= (async () => {
    let r = await db.get("SELECT value FROM notify_keys WHERE name='cert_ed25519'");
    if (!r) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
      const pub = publicKey.export({ type: "spki", format: "pem" }), kid = crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 16);
      await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('cert_ed25519',$1,$2) ON CONFLICT DO NOTHING", [JSON.stringify({ kid, pub, priv: P.seal(await sealKey(), privateKey.export({ type: "pkcs8", format: "pem" })), created: iso() }), iso()]);
      r = await db.get("SELECT value FROM notify_keys WHERE name='cert_ed25519'");
    }
    const v = JSON.parse(r.value), primary = await sealKey();
    let pem = P.unseal(primary, v.priv);
    if (!pem) { // v2.68.1: PROVIDER_SEAL_KEY set after the key was sealed with the stored key → unseal with it, then re-seal with the env key
      const prev = secret("PROVIDER_SEAL_KEY_PREVIOUS"), legacy = (await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'"))?.value; // v2.78: rotation window
      for (const k of [prev && crypto.createHash("sha256").update(prev).digest("base64url"), legacy]) if (!pem && k && k !== primary) pem = P.unseal(k, v.priv);
      if (pem) await db.run("UPDATE notify_keys SET value=$1 WHERE name='cert_ed25519'", [JSON.stringify({ ...v, priv: P.seal(primary, pem) })]);
    }
    if (!pem) throw new Error("certificate key cannot be unsealed");
    return { kid: v.kid, pub: v.pub, created: v.created, priv: crypto.createPrivateKey(pem), pubKey: crypto.createPublicKey(v.pub) };
  })().catch((e) => { keyP = null; throw e; }));
  async function publicKeys() { const k = await key(); return { keys: [{ kid: k.kid, alg: "Ed25519", spki: k.pub, created: k.created, jwk: k.pubKey.export({ format: "jwk" }) }], canonicalization: "JSON with object keys sorted, no whitespace", signature: "base64url(Ed25519(utf8(payload)))" }; }

  /* ---------- 1. issuance ---------- */
  const newCode = () => "MP-" + Array.from(crypto.randomBytes(8), (b, i) => B32[b % 32] + (i === 3 ? "-" : "")).join("");
  async function holderName(uid) {
    const u = await db.get("SELECT name, handle FROM users WHERE id=$1", [uid]); const full = String(u?.name || u?.handle || "عضو").trim();
    if (!(await isMinor(uid))) return { name: full, minor: false };
    const [a, b] = full.split(/\s+/); return { name: b ? `${a} ${b.slice(0, 1)}.` : a, minor: true };
  }
  async function issue(kind, refId, holderId, info = {}) {
    if (!KINDS[kind]) throw new Error("bad kind");
    const had = await db.get("SELECT * FROM certificates WHERE kind=$1 AND ref_id=$2 AND holder_id=$3", [kind, refId, holderId]);
    if (had) { if (had.status === "revoked" && info.reissue) { await db.run("UPDATE certificates SET status='valid', revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL WHERE id=$1", [had.id]); } return { cert: had, created: false }; }
    const k = await key(), h = await holderName(holderId), at = iso();
    const details = info.details || {};
    for (let i = 0; i < 5; i++) {
      const code = newCode();
      const payload = canonical({ v: 1, platform: "mujtama.plus", code, kind, kindLabel: KINDS[kind], title: info.title, holder: h.name, issuer: info.issuer, issuedAt: at, details });
      const signature = crypto.sign(null, Buffer.from(payload, "utf8"), k.priv).toString("base64url");
      const r = await db.run("INSERT INTO certificates(id,code,kind,ref_id,community_id,holder_id,holder_name,title,issuer_name,issuer_user,details,signed,signature,key_id,status,visibility,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'valid',$15,$16) ON CONFLICT DO NOTHING",
        [id("ce"), code, kind, refId, info.community || null, holderId, h.name, String(info.title).slice(0, 160), String(info.issuer).slice(0, 160), info.issuerUser || null, JSON.stringify(details), payload, signature, k.kid, h.minor ? "unlisted" : "public", at]).catch(() => ({ changes: 0 }));
      if (r.changes) {
        const cert = await db.get("SELECT * FROM certificates WHERE code=$1", [code]);
        await notify(holderId, "cert_issued", code); await ctx.audit?.("CERT_ISSUED", code, `${kind}:${refId}`, info.issuerUser || "system");
        return { cert, created: true };
      }
      const dup = await db.get("SELECT * FROM certificates WHERE kind=$1 AND ref_id=$2 AND holder_id=$3", [kind, refId, holderId]); if (dup) return { cert: dup, created: false };
    }
    throw new Error("could not allocate a certificate code");
  }
  async function fromCourse(courseId, uid) {
    const e = await db.get("SELECT e.completion, e.completed_at, c.title, c.community_id, c.author, cm.name gname, u.name aname FROM course_enrolments e JOIN courses c ON c.id=e.course_id JOIN communities cm ON cm.id=c.community_id LEFT JOIN users u ON u.id=c.author WHERE e.course_id=$1 AND e.user_id=$2 AND e.completed_at IS NOT NULL", [courseId, uid]);
    if (!e) return null;
    const s = parse(e.completion, {});
    return issue("course", courseId, uid, { title: e.title, issuer: e.gname, community: e.community_id, issuerUser: e.author, details: { lessons: s.lessons ?? null, minutes: s.minutes ?? null, avgQuiz: s.avgQuiz ?? null, teacher: e.aname || null, completedAt: new Date(e.completed_at).toISOString() } });
  }
  async function fromStudy(cid, uid) {
    const c = await db.get("SELECT s.criteria, s.issued_at, s.issued_by, s.note, cm.name gname, g.mode, u.name tname FROM study_completions s JOIN communities cm ON cm.id=s.community_id LEFT JOIN study_groups g ON g.community_id=s.community_id LEFT JOIN users u ON u.id=s.issued_by WHERE s.community_id=$1 AND s.user_id=$2", [cid, uid]);
    if (!c) return null;
    const cr = parse(c.criteria, {});
    return issue("study", cid, uid, { title: `${c.mode === "halaqa" ? "إتمام الحلقة" : "إتمام مجموعة الدراسة"}: ${c.gname}`, issuer: c.gname, community: cid, issuerUser: c.issued_by, reissue: true, details: { attendance: cr.attendance ?? null, assignmentsPct: cr.assignmentsPct ?? null, teacher: c.tname || null, note: c.note || null } });
  }
  bus.on("COURSE_COMPLETED", track(async (e) => { await fromCourse(e.course, e.user); }));
  bus.on("STUDY_COMPLETED", track(async (e) => { await fromStudy(e.community, e.user); }));
  bus.on("STUDY_COMPLETION_REVOKED", track(async (e) => { await db.run("UPDATE certificates SET status='revoked', revoked_at=$1, revoked_by=$2, revoke_reason=$3 WHERE kind='study' AND ref_id=$4 AND holder_id=$5 AND status='valid'", [iso(), e.by, "سحب المعلّم تأكيد الإتمام", e.community, e.user]); }));
  async function ensureMine(uid) { // completions from before v2.31 (or a missed event)
    const cs = await db.all("SELECT e.course_id FROM course_enrolments e LEFT JOIN certificates c ON c.kind='course' AND c.ref_id=e.course_id AND c.holder_id=e.user_id WHERE e.user_id=$1 AND e.completed_at IS NOT NULL AND c.id IS NULL LIMIT 50", [uid]).catch(() => []);
    for (const r of cs) await fromCourse(r.course_id, uid).catch(() => null);
    const ss = await db.all("SELECT s.community_id FROM study_completions s LEFT JOIN certificates c ON c.kind='study' AND c.ref_id=s.community_id AND c.holder_id=s.user_id WHERE s.user_id=$1 AND c.id IS NULL LIMIT 50", [uid]).catch(() => []);
    for (const r of ss) await fromStudy(r.community_id, uid).catch(() => null);
  }

  /* ---------- 3. verification ---------- */
  async function byCode(code) { const c = normCode(code); if (!c) return null; return db.get("SELECT * FROM certificates WHERE code=$1", [c]); }
  async function sigOk(c) { try { const k = await key(); if (c.key_id !== k.kid) return false; return crypto.verify(null, Buffer.from(c.signed, "utf8"), k.pubKey, Buffer.from(c.signature, "base64url")); } catch { return false; } }
  const pubClient = (c) => ({ code: c.code, kind: c.kind, kindLabel: KINDS[c.kind], title: c.title, holder: c.holder_name, issuer: c.issuer_name, issuedAt: new Date(c.issued_at).toISOString(), details: parse(c.details, {}), status: c.status, revokedAt: c.revoked_at ? new Date(c.revoked_at).toISOString() : null, revokeReason: c.status === "revoked" ? c.revoke_reason || null : null, url: `/cert/${c.code}` });
  async function count(c, viewer) {
    if (viewer && viewer.id === c.holder_id) return;
    const d = iso().slice(0, 10);
    await db.run("INSERT INTO cert_verifications(cert_id,day,n) VALUES($1,$2,1) ON CONFLICT (cert_id, day) DO UPDATE SET n=cert_verifications.n+1", [c.id, d]).catch(() => null);
    await db.run("UPDATE certificates SET verifications=verifications+1 WHERE id=$1", [c.id]).catch(() => null);
  }
  async function verify(code, viewer) {
    if (!rl.hit("default", "certv:" + (viewer?.id || "anon"))) throw E.rate();
    const c = await byCode(code); if (!c) throw E.nf("لا توجد شهادة بهذا الرمز — تأكد من كتابته كما يظهر على الشهادة");
    const ok = await sigOk(c); await count(c, viewer);
    const k = await key();
    return { valid: ok && c.status === "valid", signatureValid: ok, certificate: pubClient(c), payload: c.signed, signature: c.signature, keyId: c.key_id, publicKey: c.key_id === k.kid ? k.pub : null, mine: !!viewer && viewer.id === c.holder_id, canManage: !!viewer && viewer.id !== c.holder_id && (await canManage(viewer, c)) };
  }

  /* ---------- 4. holder ---------- */
  async function mine(user) {
    await ensureMine(user.id);
    const rows = await db.all("SELECT * FROM certificates WHERE holder_id=$1 ORDER BY issued_at DESC LIMIT 200", [user.id]);
    return { certificates: rows.map((c) => ({ ...pubClient(c), visibility: c.visibility, verifications: Number(c.verifications || 0) })), minor: await isMinor(user.id) };
  }
  async function setVisibility(user, code, b = {}) {
    const c = await byCode(code); if (!c || c.holder_id !== user.id) throw E.nf();
    const v = b.visibility === "unlisted" ? "unlisted" : "public";
    if (v === "public" && (await isMinor(user.id))) throw E.forbid("الشهادات لا تُعرض على الملف الشخصي لمن هم دون ١٨ سنة");
    await db.run("UPDATE certificates SET visibility=$1 WHERE id=$2", [v, c.id]);
    return { visibility: v };
  }
  async function onProfile(handle) {
    const u = await db.get("SELECT id, private FROM users WHERE handle=$1 AND status='active'", [String(handle)]); if (!u) throw E.nf();
    if (await isMinor(u.id)) return { certificates: [] };
    const rows = await db.all("SELECT * FROM certificates WHERE holder_id=$1 AND visibility='public' AND status='valid' ORDER BY issued_at DESC LIMIT 50", [u.id]);
    return { certificates: rows.map(pubClient) };
  }

  /* ---------- 5. issuer ---------- */
  async function canManage(user, c) {
    if (user.role === "admin") return true;
    if (c.kind === "mentorship") return !!c.issuer_user && c.issuer_user === user.id;
    if (!c.community_id) return false;
    const role = (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [c.community_id, user.id]))?.role;
    if (MANAGER_ROLES.includes(role)) return true;
    const g = await db.get("SELECT teachers FROM study_groups WHERE community_id=$1", [c.community_id]).catch(() => null);
    return !!role && parse(g?.teachers, []).includes(user.id);
  }
  async function revoke(user, code, b = {}, restore = false) {
    const c = await byCode(code); if (!c) throw E.nf();
    if (!(await canManage(user, c))) throw E.forbid("يسحب الشهادة معلّمو الجهة المانحة ومشرفوها فقط");
    if (restore) await db.run("UPDATE certificates SET status='valid', revoked_at=NULL, revoked_by=NULL, revoke_reason=NULL WHERE id=$1", [c.id]);
    else await db.run("UPDATE certificates SET status='revoked', revoked_at=$1, revoked_by=$2, revoke_reason=$3 WHERE id=$4", [iso(), user.id, str(b.reason, 300, { required: true, min: 3 }), c.id]);
    await ctx.audit?.(restore ? "CERT_RESTORED" : "CERT_REVOKED", c.code, b.reason || null, user.id);
    if (!restore) await notify(c.holder_id, "cert_revoked", c.code);
    return pubClient(await byCode(code));
  }
  async function issued(user, cid) {
    const fake = { community_id: String(cid) };
    if (!(await canManage(user, fake))) throw E.forbid("للمعلمين والمشرفين فقط");
    const rows = await db.all("SELECT c.*, u.handle FROM certificates c LEFT JOIN users u ON u.id=c.holder_id WHERE c.community_id=$1 ORDER BY c.issued_at DESC LIMIT 500", [String(cid)]);
    return { certificates: rows.map((c) => ({ ...pubClient(c), verifications: Number(c.verifications || 0) })) };
  }


  /* ---------- M5-1/F11: mentorship completion certificate «شهادة إتمام الإرشاد» ----------
   * Reuses the signed certificates table (kind 'mentorship', ref_id = mentor id → one per mentor ↔ mentee pair; no migration).
   * Only the mentor of a pair with ≥1 completed session issues it (title ≤80, optional note ≤200). The mentee sees it in
   * #/certificates; an active guardian of a MINOR mentee can list it; verification by code shows the public minimum
   * (holder display name — first name + initial for minors —, mentor, title, date, sessions, note; never age or contact). */
  const MC_TITLE = 80, MC_NOTE = 200;
  const mcErr = (code, msg, st = 400) => { const e = st === 403 ? E.forbid(msg) : st === 404 ? E.nf(msg) : E.bad(msg); e.code = code; return e; };
  async function completedWith(mentorId, menteeId) { return Number((await db.get("SELECT COUNT(*) n FROM mentor_sessions WHERE mentor_id=$1 AND learner_id=$2 AND status='completed'", [mentorId, menteeId]))?.n || 0); }
  async function mentorIssue(user, b = {}) {
    const menteeId = String(b.menteeId || "");
    if (!menteeId || menteeId === user.id) throw mcErr("mcert_mentee_required", "اختر المتدرّب");
    const title = String(b.title ?? "").replace(/\s+/g, " ").trim(), note = String(b.note ?? "").replace(/\s+/g, " ").trim();
    if (title.length < 3) throw mcErr("mcert_title_required", "اكتب عنوان الشهادة (٣ أحرف على الأقل)");
    if ([...title].length > MC_TITLE) throw mcErr("mcert_title_too_long", `العنوان ${MC_TITLE} حرفاً كحد أقصى`);
    if ([...note].length > MC_NOTE) throw mcErr("mcert_note_too_long", `الملاحظة ${MC_NOTE} حرفاً كحد أقصى`);
    const n = await completedWith(user.id, menteeId);
    if (!n) throw mcErr("mcert_no_completed_session", "تُمنح الشهادة بعد جلسة مكتملة واحدة على الأقل مع هذا المتدرّب", 403);
    const me = await db.get("SELECT name, handle FROM users WHERE id=$1", [user.id]);
    const r = await issue("mentorship", user.id, menteeId, { title, issuer: String(me?.name || me?.handle || "مرشد"), issuerUser: user.id, details: { sessions: n, note: note || null } });
    return { certificate: pubClient(r.cert), created: r.created };
  }
  async function mentorIssued(user) {
    const rows = await db.all("SELECT * FROM certificates WHERE kind='mentorship' AND issuer_user=$1 ORDER BY issued_at DESC LIMIT 200", [user.id]);
    const done = await db.all("SELECT s.learner_id, COUNT(*) n, MAX(s.completed_at) last FROM mentor_sessions s WHERE s.mentor_id=$1 AND s.status='completed' GROUP BY s.learner_id ORDER BY MAX(s.completed_at) DESC LIMIT 200", [user.id]);
    const ids = done.map((d) => d.learner_id), us = ids.length ? await db.all(`SELECT id, name, handle FROM users WHERE id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const has = new Map(rows.map((c) => [c.holder_id, c.code]));
    const mentees = [];
    for (const d of done) { const u = us.find((x) => x.id === d.learner_id); if (!u) continue; const minor = await isMinor(u.id); mentees.push({ id: u.id, name: minor ? (await holderName(u.id)).name : String(u.name || u.handle), handle: minor ? null : u.handle, minor, sessions: Number(d.n), certificate: has.get(u.id) || null }); }
    return { mentees, certificates: rows.map((c) => ({ ...pubClient(c), verifications: Number(c.verifications || 0) })), limits: { title: MC_TITLE, note: MC_NOTE } };
  }
  async function guardianCerts(user, minorId) {
    const l = await db.get("SELECT 1 x FROM guardian_links WHERE guardian_id=$1 AND minor_id=$2 AND status='active'", [user.id, String(minorId)]).catch(() => null);
    if (!l || !(await isMinor(String(minorId)))) throw mcErr("mcert_not_guardian", "غير متاح", 404);
    const rows = await db.all("SELECT * FROM certificates WHERE holder_id=$1 AND kind='mentorship' ORDER BY issued_at DESC LIMIT 100", [String(minorId)]);
    return { certificates: rows.map(pubClient) };
  }

  /* ---------- server-rendered certificate: /cert/<code> (+ keys) ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const origin = (req) => process.env.PUBLIC_URL || `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
  const arDate = (d) => new Date(d).toLocaleDateString("ar-SA-u-ca-gregory-nu-arab", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh" });
  const hijriDate = (d) => { try { return new Date(d).toLocaleDateString("ar-SA-u-ca-islamic-umalqura-nu-arab", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Riyadh" }); } catch { return ""; } };
  function detailLines(c) {
    const d = parse(c.details, {}), L = [];
    if (c.kind === "course") { if (d.lessons) L.push(`${d.lessons} درساً`); if (d.minutes) L.push(`${Math.max(1, Math.round(d.minutes / 60 * 10) / 10)} ساعة تعلّم`); if (d.avgQuiz !== null && d.avgQuiz !== undefined) L.push(`متوسط الاختبارات ${d.avgQuiz}٪`); }
    if (c.kind === "study") { if (d.attendance !== null && d.attendance !== undefined) L.push(`الحضور ${d.attendance}٪`); if (d.assignmentsPct !== null && d.assignmentsPct !== undefined) L.push(`الواجبات ${d.assignmentsPct}٪`); }
    if (c.kind === "exam") { if (d.score !== undefined) L.push(`الدرجة ${d.score}٪`); if (d.passPct !== undefined) L.push(`درجة النجاح ${d.passPct}٪`); if (d.questions) L.push(`${d.questions} سؤالاً`); }
    if (c.kind === "mentorship") { if (d.sessions) L.push(`${d.sessions} جلسة إرشاد مكتملة`); if (d.note) L.push(d.note); }
    if (c.kind === "volunteer") { if (d.hours) L.push(`${d.hours} ساعة تطوّع مؤكَّدة`); if (d.date) L.push(`بتاريخ ${d.date}`); if (d.place) L.push(d.place); }
    return { lines: L, teacher: d.teacher || null };
  }
  function page(res, status, html) { res.writeHead(status, { ...require("../lib/http").SEC_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }); res.end(html); }
  const CSS = `:root{--ink:#1d1b26;--mut:#5f5b72;--bg:#f4f1fb;--paper:#fffdf8;--acc:#5b2bd6;--gold:#a8741a;--ok:#0f7a4a;--bad:#b42318;--line:#e4dff0}
*{box-sizing:border-box}main{padding:0 12px}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 "IBM Plex Sans Arabic","Noto Naskh Arabic",system-ui,sans-serif}
.top{display:flex;justify-content:space-between;align-items:center;max-width:880px;margin:auto;padding:12px 16px}.top a{color:var(--acc);font-weight:700;text-decoration:none;min-height:44px;display:inline-flex;align-items:center}
.st{max-width:880px;margin:0 auto 12px;box-sizing:border-box;padding:12px 16px;border-radius:14px;display:flex;gap:12px;align-items:center;font-weight:700}.st.ok{background:#e3f5ec;color:#0b5a37;border:1px solid #9fd9bd}.st.bad{background:#fdecea;color:#8a1c12;border:1px solid #f3b1aa}.st .i{font-size:26px}.st small{display:block;font-weight:400;color:inherit;opacity:.9}
.cert{max-width:880px;margin:0 auto;background:var(--paper);border-radius:18px;padding:14px;box-shadow:0 10px 40px #2a1f5a1f}
.frame{border:2px solid var(--gold);border-radius:12px;padding:28px 22px;position:relative;text-align:center;background:radial-gradient(circle at 50% 0,#f7efd9 0,transparent 55%)}.frame:before{content:"";position:absolute;inset:6px;border:1px solid #d9c08a;border-radius:8px;pointer-events:none}
.brand{color:var(--acc);font-weight:800;letter-spacing:.5px}.kind{display:inline-block;margin:14px 0 6px;padding:2px 14px;border-radius:999px;background:#f1eafc;color:var(--acc);font-weight:700;font-size:14px}
h1{font-size:30px;line-height:1.3;margin:6px 0 2px;color:var(--gold);font-weight:800}.to{color:var(--mut);margin:14px 0 0}.holder{font-size:30px;font-weight:800;margin:2px 0 6px;line-height:1.35}.title{font-size:20px;font-weight:700;margin:8px auto;max-width:620px;line-height:1.6}
.issuer{color:var(--mut)}.facts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:14px 0}.facts span{background:#f6f2ff;border-radius:999px;padding:2px 12px;font-size:14px}
.foot{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:end;text-align:start;margin-top:22px;padding-top:14px;border-top:1px dashed var(--line)}.foot dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13.5px}.foot dt{color:var(--mut)}.foot dd{margin:0;font-weight:600;overflow-wrap:anywhere}.qr{width:112px;height:112px;background:#fff;padding:4px;border-radius:8px;border:1px solid var(--line)}.qr svg{width:100%;height:100%;display:block}
code{font-family:ui-monospace,monospace;direction:ltr;unicode-bidi:isolate}.tech{max-width:880px;margin:14px auto;padding:0 16px;color:var(--mut);font-size:13.5px}.tech details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 14px}.tech summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:var(--ink)}.tech pre{white-space:pre-wrap;word-break:break-all;direction:ltr;text-align:left;font-size:12px;background:#f7f6fb;padding:8px;border-radius:8px}
.acts{max-width:880px;margin:12px auto 40px;padding:0 16px;display:flex;gap:8px;flex-wrap:wrap}.acts a{min-height:44px;display:inline-flex;align-items:center;padding:0 18px;border-radius:999px;background:var(--acc);color:#fff;text-decoration:none;font-weight:700}.acts a.g{background:#fff;color:var(--acc);border:1px solid var(--line)}
.revoked .frame{filter:grayscale(.8);opacity:.75}.revoked .frame:after{content:"مسحوبة";position:absolute;top:40%;inset-inline:0;font-size:64px;font-weight:900;color:#b4231833;transform:rotate(-14deg)}
@media(max-width:560px){h1{font-size:24px}.holder{font-size:24px}.title{font-size:17px}.frame{padding:22px 14px}.foot{grid-template-columns:1fr}.qr{margin:auto}}
@media(prefers-color-scheme:dark){:root{--bg:#121019;--ink:#efedf7;--mut:#b4b0c8;--line:#2f2b40}.top a,.acts a.g{color:#c9b6ff}.acts a.g{background:#1d1a28}.tech details{background:#1d1a28}.tech pre{background:#14121c}.cert{background:#fffdf8;color:#1d1b26}.cert .issuer,.cert .to,.cert .foot dt{color:#5f5b72}}
@media print{@page{size:A4 landscape;margin:10mm}body{background:#fff}.top,.acts,.tech,.st{display:none}.cert{box-shadow:none;max-width:none;padding:0}}`;
  async function ssr(req, res, url) {
    if (url.pathname === "/.well-known/mujtama-certificates.json") { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(await publicKeys())); return true; }
    const m = /^\/cert\/([A-Za-z0-9-]{8,16})\/?$/.exec(url.pathname); if (!m) return false;
    const c = await byCode(m[1]);
    if (!c) { page(res, 404, `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>شهادة غير موجودة · مجتمع بلس</title><style>${CSS}</style></head><body><header class="top"><a href="/">مجتمع بلس</a></header><main><div class="st bad" role="alert"><span class="i" aria-hidden="true">✕</span><div>لا توجد شهادة بهذا الرمز<small>تأكد من كتابة الرمز كما يظهر على الشهادة، مثل MP-7K3Q-9XPA</small></div></div><div class="acts"><a href="/#/verify-cert">التحقق من رمز آخر</a></div></main></body></html>`); return true; }
    const ok = await sigOk(c); await count(c, null);
    const valid = ok && c.status === "valid", o = origin(req), link = `${o}/cert/${c.code}`, { lines, teacher } = detailLines(c);
    const status = !ok ? `<div class="st bad" role="alert"><span class="i" aria-hidden="true">✕</span><div>التوقيع الرقمي غير صحيح<small>لا تعتمد هذه الشهادة؛ تواصل مع الجهة المانحة</small></div></div>`
      : c.status === "revoked" ? `<div class="st bad" role="alert"><span class="i" aria-hidden="true">✕</span><div>سُحبت هذه الشهادة بتاريخ ${esc(arDate(c.revoked_at))}<small>${esc(c.revoke_reason || "")}</small></div></div>`
        : `<div class="st ok" role="status"><span class="i" aria-hidden="true">✓</span><div>شهادة صحيحة وموقّعة رقمياً من مجتمع بلس<small>تحقق منها ${Number(c.verifications || 0) + 1} مرة · التوقيع Ed25519 سليم</small></div></div>`;
    page(res, 200, `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)} · ${esc(c.holder_name)} · شهادة مجتمع بلس</title><meta name="robots" content="noindex">
<meta property="og:title" content="${esc(`${KINDS[c.kind]}: ${c.title}`)}"><meta property="og:description" content="${esc(`${c.holder_name} — ${c.issuer_name} · رمز التحقق ${c.code}`)}"><style>${CSS}</style></head>
<body><header class="top"><a href="/">مجتمع بلس</a><a href="/#/verify-cert">تحقق من شهادة</a></header><main>${status}
<article class="cert${c.status === "revoked" ? " revoked" : ""}" aria-label="الشهادة"><div class="frame"><div class="brand">مجتمع بلس ✦</div><span class="kind">${esc(KINDS[c.kind])}</span><h1>شهادة ${c.kind === "exam" ? "اجتياز" : c.kind === "volunteer" ? "تطوّع" : c.kind === "mentorship" ? "إتمام إرشاد" : "إتمام"}</h1>
<p class="to">${c.kind === "mentorship" ? "يشهد المرشد" : "تشهد"} ${esc(c.issuer_name)} بأن</p><p class="holder">${esc(c.holder_name)}</p><p class="title">${c.kind === "exam" ? "اجتاز" : c.kind === "volunteer" ? "تطوّع في" : c.kind === "mentorship" ? "أتمّ برنامج الإرشاد" : "أتمّ"} «${esc(c.title)}»</p>
${lines.length ? `<div class="facts">${lines.map((l) => `<span>${esc(l)}</span>`).join("")}</div>` : ""}
<div class="foot"><dl><dt>تاريخ الإصدار</dt><dd>${esc(arDate(c.issued_at))}${hijriDate(c.issued_at) ? ` · ${esc(hijriDate(c.issued_at))}` : ""}</dd><dt>الجهة المانحة</dt><dd>${esc(c.issuer_name)}${teacher ? ` · ${esc(teacher)}` : ""}</dd><dt>رمز التحقق</dt><dd><code>${esc(c.code)}</code></dd><dt>رابط التحقق</dt><dd><code>${esc(link.replace(/^https?:\/\//, ""))}</code></dd></dl><div class="qr">${qrSvg(link)}</div></div></div></article>
<div class="acts"><a href="/#/verify-cert">تحقق من رمز آخر</a><a class="g" href="/#/cert/${esc(c.code)}">افتح في التطبيق</a></div>
<section class="tech"><details><summary>التحقق التقني (للمطورين وجهات التوظيف)</summary><p>النص الموقّع (JSON بمفاتيح مرتبة) والتوقيع بخوارزمية Ed25519. المفتاح العام: <code>/.well-known/mujtama-certificates.json</code> · المعرّف <code>${esc(c.key_id)}</code></p><pre>${esc(c.signed)}</pre><p>التوقيع:</p><pre>${esc(c.signature)}</pre></details></section></main></body></html>`);
    void valid; return true;
  }

  /* ---------- routes ---------- */
  R.get("/api/certificates", A(async (req) => mine(req.user)));
  R.get("/api/certificates/keys", async () => publicKeys());
  R.get("/api/certificates/verify/:code", async (req) => verify(req.params.code, req.user));
  R.patch("/api/certificates/:code", A(async (req) => setVisibility(req.user, req.params.code, req.body || {})));
  R.post("/api/certificates/:code/revoke", A(async (req) => revoke(req.user, req.params.code, req.body || {})));
  R.post("/api/certificates/:code/restore", A(async (req) => revoke(req.user, req.params.code, {}, true)));
  R.get("/api/communities/:id/certificates", A(async (req) => issued(req.user, req.params.id)));
  R.post("/api/mentor-certificates", A(async (req) => mentorIssue(req.user, req.body || {})));
  R.get("/api/mentor-certificates", A(async (req) => mentorIssued(req.user)));
  R.get("/api/guardian/certificates/:minor", A(async (req) => guardianCerts(req.user, req.params.minor)));
  R.get("/api/users/:handle/certificates", async (req) => onProfile(req.params.handle));
  return { issue, fromCourse, fromStudy, ensureMine, verify, mine, setVisibility, onProfile, revoke, issued, publicKeys, ssr, canManage, mentorIssue, mentorIssued, guardianCerts, normCode, canonical, flush: () => Promise.all([...inflight]), KINDS };
};
