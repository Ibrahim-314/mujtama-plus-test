/* Email service (Phase 29): transactional mail (verify email, password recovery, security alerts),
 * notification emails, the weekly digest transport, RFC 8058 one-click unsubscribe with signed tokens,
 * delivery & bounce tracking (provider webhook + SMTP 5xx), a suppression list, and email preferences.
 * Sending goes through lib/mailer.js (SMTP + DKIM); transactional mail is queued (lib/queue.js) so a
 * flaky SMTP server is retried with exponential backoff. Templates: lib/email-templates.js (Arabic, RTL). */
const crypto = require("node:crypto");
const { E, HttpError, str, id, now, sha, token, hashPassword, verifyPassword } = require("../lib/core");
const T = require("../lib/email-templates");
const L = require("../lib/notify-lib");
const DKIM = require("../lib/dkim");
const { secret } = require("../lib/secrets");
const { log } = require("../lib/log");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = (e) => String(e || "").trim().toLowerCase();

module.exports = (ctx) => {
  const { db, mailer, queue, config } = ctx;
  const origin = (req) => process.env.PUBLIC_ORIGIN || (req ? `${req.headers["x-forwarded-proto"] && config.trustProxy ? req.headers["x-forwarded-proto"] : "http"}://${req.headers.host}` : "http://localhost:" + (config.port || 8080));
  let lastOrigin = null; const originOf = (req) => (lastOrigin = origin(req)); const bgOrigin = () => process.env.PUBLIC_ORIGIN || lastOrigin || origin();

  /* tiny per-key limiter for mail-sending endpoints (5 per hour) */
  const hits = new Map();
  const limited = (k, max = 5, ms = 3600e3) => { const t = Date.now(), a = (hits.get(k) || []).filter(x => t - x < ms); if (a.length >= max) return true; a.push(t); hits.set(k, a); return false; };

  /* ---------- signed unsubscribe tokens (stateless, long-lived, bound to user + address + category) ---------- */
  let keyP = null;
  const tokenKey = () => keyP ||= (async () => {
    const env = secret("MAIL_TOKEN_SECRET"); if (env) return env;
    let r = await db.get("SELECT value FROM notify_keys WHERE name='mail_token'");
    if (!r) { await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('mail_token',$1,$2) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString("base64url"), now()]); r = await db.get("SELECT value FROM notify_keys WHERE name='mail_token'"); }
    return r.value;
  })().catch(e => { keyP = null; throw e; });
  async function signToken(o) { const body = Buffer.from(JSON.stringify(o)).toString("base64url"); const sig = crypto.createHmac("sha256", await tokenKey()).update(body).digest().subarray(0, 16).toString("base64url"); return `${body}.${sig}`; }
  async function readToken(t) {
    const [body, sig] = String(t || "").split("."); if (!body || !sig) return null;
    const want = crypto.createHmac("sha256", await tokenKey()).update(body).digest().subarray(0, 16);
    const got = Buffer.from(sig, "base64url"); if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  }
  /** categories: weekly · notify (all notification emails) · notify:<kind> · all (every non-transactional email) */
  const unsubUrl = async (o, userId, email, category) => `${o}/api/email/unsubscribe?t=${await signToken({ u: userId, e: email, c: category })}`;

  /* ---------- suppression + log ---------- */
  const suppression = (email) => db.get("SELECT * FROM email_suppressions WHERE email=$1", [normEmail(email)]);
  async function suppress(email, reason, detail = null) {
    await db.run("INSERT INTO email_suppressions(email,reason,detail,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT (email) DO UPDATE SET reason=$2, detail=$3, updated_at=$4", [normEmail(email), reason, detail ? String(detail).slice(0, 300) : null, now()]);
  }
  /** hard_bounce / complaint block everything except password recovery for complaint; unsubscribed blocks non-transactional */
  const blocks = (sup, transactional) => sup && (sup.reason === "hard_bounce" || (!transactional && ["complaint", "unsubscribed", "soft_bounce"].includes(sup.reason)));
  const logRow = async (o) => { const lid = id("em"); await db.run("INSERT INTO email_log(id,user_id,email,kind,subject,message_id,status,detail,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)", [lid, o.userId || null, normEmail(o.to), o.kind, o.subject || null, o.messageId || null, o.status, o.detail || null, now()]); return lid; };
  const setLog = (lid, status, detail = null, messageId = null) => db.run("UPDATE email_log SET status=$1, detail=$2, message_id=COALESCE($3, message_id), updated_at=$4 WHERE id=$5", [status, detail ? String(detail).slice(0, 300) : null, messageId, now(), lid]);

  /**
   * send now. m: { to, userId, kind, subject, html, text, transactional, unsubscribeUrl }
   * resolves { status: sent|suppressed|skipped, messageId } · throws on transient SMTP errors (callers may retry)
   */
  async function sendNow(m, { lid = null } = {}) {
    const to = normEmail(m.to); if (!EMAIL.test(to)) throw E.bad("البريد الإلكتروني غير صالح");
    const sup = await suppression(to);
    if (blocks(sup, m.transactional)) { lid ? await setLog(lid, "suppressed", sup.reason) : await logRow({ ...m, status: "suppressed", detail: sup.reason }); return { status: "suppressed", reason: sup.reason }; }
    if (!mailer.enabled) { lid ? await setLog(lid, "skipped", "not_configured") : await logRow({ ...m, status: "skipped", detail: "not_configured" }); return { status: "skipped", reason: "not_configured" }; }
    const headers = { "Auto-Submitted": "auto-generated", "X-Entity-Ref-ID": m.kind };
    if (m.unsubscribeUrl) Object.assign(headers, { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "List-Id": `mujtama-${m.kind.replace(/[^a-z0-9-]/gi, "-")} <${m.kind.replace(/[^a-z0-9-]/gi, "-")}.${process.env.DKIM_DOMAIN || "mujtama.plus"}>` });
    try {
      const r = await mailer.send({ to, subject: m.subject, html: m.html, text: m.text, headers });
      lid ? await setLog(lid, "sent", null, r.messageId) : await logRow({ ...m, to, status: "sent", messageId: r.messageId });
      return { status: "sent", messageId: r.messageId };
    } catch (e) {
      if (/smtp 55\d/i.test(e.message)) { await suppress(to, "hard_bounce", e.message); lid ? await setLog(lid, "bounced", e.message) : await logRow({ ...m, status: "bounced", detail: e.message }); return { status: "bounced", reason: "hard_bounce" }; }
      lid ? await setLog(lid, "retrying", e.message) : null;
      throw e;
    }
  }
  /** queued send with retry/backoff (transactional mail) */
  async function enqueue(m) {
    const lid = await logRow({ ...m, status: "queued" });
    await queue.enqueue("mail.send", { lid, m });
    return { status: "queued", id: lid };
  }
  queue.on("mail.send", async (p) => { await sendNow(p.m, { lid: p.lid }); });

  /* ---------- templates bound to a user ---------- */
  async function sendSecurity(userId, kind, detail, { to = null } = {}) {
    const u = await db.get("SELECT id, name, email, email_verified_at, tz FROM users WHERE id=$1", [userId]); const addr = to || (u?.email_verified_at ? u.email : null); if (!u || !addr) return { status: "skipped", reason: "no_email" };
    const when = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short", timeZone: L.validTz(u.tz) ? u.tz : "Asia/Riyadh" }).format(new Date());
    const t = T.security({ name: u.name, kind, detail, when, origin: bgOrigin() });
    return enqueue({ to: addr, userId, kind: "security_" + kind, transactional: true, ...t });
  }
  /** called by the notify service's email job */
  async function sendNotification(n) {
    const u = await db.get("SELECT id, name, email, email_verified_at FROM users WHERE id=$1", [n.user]); if (!u?.email || !u.email_verified_at) return { status: "skipped", reason: "no_email" };
    if (n.kind === "security_login") return sendNow({ to: u.email, userId: u.id, kind: n.kind, transactional: true, ...T.security({ name: u.name, kind: "login", detail: n.ref, when: null, origin: bgOrigin() }) });
    if (n.kind.startsWith("security_")) return { status: "skipped", reason: "sent_directly" }; // password / email changes are mailed by their own flows
    const a = n.actor ? await db.get("SELECT name FROM users WHERE id=$1", [n.actor]) : null, o = bgOrigin();
    const unsubscribeUrl = await unsubUrl(o, u.id, u.email, "notify:" + n.kind);
    const t = T.notification({ name: u.name, sentence: L.sentence(n.kind, a ? [a.name] : [], 1, n.ref), url: o + L.hrefFor(n).replace(/^\//, "/"), origin: o, unsubscribeUrl, prefsUrl: o + "/#/emailprefs", kindLabel: L.kindOf(n.kind).label });
    return sendNow({ to: u.email, userId: u.id, kind: "notify_" + n.kind, unsubscribeUrl, ...t });
  }
  /** weekly digest transport (services/summaries.js builds the content); synchronous so the job can count sends */
  async function sendWeekly(user, to, content) {
    const o = bgOrigin(), unsubscribeUrl = await unsubUrl(o, user.id, normEmail(to), "weekly");
    const t = T.weekly({ ...content, name: user.name, origin: o, unsubscribeUrl, prefsUrl: o + "/#/emailprefs" });
    return { ...(await sendNow({ to, userId: user.id, kind: "weekly", unsubscribeUrl, ...t })), template: t };
  }
  const weeklyTemplate = (user, content) => T.weekly({ ...content, name: user.name, origin: bgOrigin(), prefsUrl: bgOrigin() + "/#/emailprefs" });

  /* ---------- one-time tokens ---------- */
  async function issue(userId, kind, email, ttlMs) {
    const t = token();
    await db.run("DELETE FROM email_tokens WHERE user_id=$1 AND kind=$2 AND used_at IS NULL", [userId, kind]);
    await db.run("INSERT INTO email_tokens(token_hash,user_id,kind,email,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6)", [sha(t), userId, kind, email, new Date(Date.now() + ttlMs).toISOString(), now()]);
    return t;
  }
  async function consume(t, kind) {
    const row = await db.get("SELECT * FROM email_tokens WHERE token_hash=$1 AND kind=$2", [sha(String(t || "")), kind]);
    if (!row || row.used_at || new Date(row.expires_at) < new Date()) return null;
    const r = await db.run("UPDATE email_tokens SET used_at=$1 WHERE token_hash=$2 AND used_at IS NULL", [now(), row.token_hash]);
    return r.changes ? row : null;
  }

  /* ---------- account email + verification ---------- */
  async function sendVerify(user, req) {
    const t = await issue(user.id, "verify", user.email, 24 * 3600e3), o = originOf(req);
    return enqueue({ to: user.email, userId: user.id, kind: "verify", transactional: true, ...T.verify({ name: user.name, url: `${o}/api/email/verify?t=${t}`, origin: o }) });
  }
  async function setEmail(req) {
    const u = req.user, email = normEmail(str(req.body.email, 120, { required: true }));
    if (!EMAIL.test(email)) throw E.bad("البريد الإلكتروني غير صالح");
    if (u.email === email) return accountEmail(await db.get("SELECT * FROM users WHERE id=$1", [u.id]));
    if (u.email && u.email_verified_at && u.password_hash && !verifyPassword(String(req.body.password || ""), u.password_hash)) throw new HttpError(401, "أدخل كلمة المرور الحالية لتغيير البريد", "password_required");
    if (limited("email:" + u.id)) throw E.rate();
    if (await db.get("SELECT 1 x FROM users WHERE email=$1 AND id<>$2", [email, u.id])) throw E.conflict("هذا البريد مرتبط بحساب آخر");
    const old = u.email_verified_at ? u.email : null;
    await db.run("UPDATE users SET email=$1, email_verified_at=NULL WHERE id=$2", [email, u.id]);
    const fresh = await db.get("SELECT * FROM users WHERE id=$1", [u.id]);
    await sendVerify(fresh, req);
    if (old) { await sendSecurity(u.id, "email", email, { to: old }); await ctx.services.notify.notify(u.id, "security_email", { ref: email }); ctx.audit?.("email_changed", u.id, null, u.id); }
    return accountEmail(fresh);
  }
  const accountEmail = async (u) => { const sup = u.email ? await suppression(u.email) : null; return { email: u.email || null, verified: !!u.email_verified_at, suppressed: sup?.reason || null, mailEnabled: !!mailer.enabled }; };

  /* ---------- password recovery & change ---------- */
  async function forgot(req) {
    const login = normEmail(str(req.body.login || req.body.email || req.body.handle, 120, { required: true }));
    if (limited("forgot:" + req.ip, 10) || limited("forgot:" + login)) throw E.rate();
    const u = await db.get("SELECT * FROM users WHERE (LOWER(handle)=$1 OR email=$1) AND status='active'", [login]);
    if (u?.email && u.email_verified_at) {
      const t = await issue(u.id, "reset", u.email, 3600e3), o = originOf(req);
      await enqueue({ to: u.email, userId: u.id, kind: "reset", transactional: true, ...T.reset({ name: u.name, url: `${o}/#/reset?t=${t}`, origin: o, ip: String(req.ip || "").replace(/^::ffff:/, ""), device: ctx.services.security?.describeUA(req.headers["user-agent"]) }) });
    }
    return { ok: true, message: "إن كان الحساب مرتبطاً ببريد مؤكد فستصلك رسالة خلال دقائق" }; // same answer either way: no account enumeration
  }
  const checkPw = (p) => { if (typeof p !== "string" || p.length < 8 || p.length > 200) throw E.bad("كلمة المرور 8 أحرف على الأقل"); return p; };
  async function reset(req) {
    const password = checkPw(req.body.password);
    const row = await consume(req.body.token, "reset"); if (!row) throw E.bad("الرابط غير صالح أو انتهت صلاحيته");
    await db.run("UPDATE users SET password_hash=$1 WHERE id=$2", [hashPassword(password), row.user_id]);
    await db.run("DELETE FROM sessions WHERE user_id=$1", [row.user_id]);
    ctx.audit?.("password_reset", row.user_id, null, row.user_id);
    await afterPasswordChange(row.user_id);
    return { ok: true };
  }
  async function changePassword(req) {
    const u = req.user, password = checkPw(req.body.password);
    if (u.password_hash && !verifyPassword(String(req.body.current || ""), u.password_hash)) throw new HttpError(401, "كلمة المرور الحالية غير صحيحة", "bad_credentials");
    await db.run("UPDATE users SET password_hash=$1 WHERE id=$2", [hashPassword(password), u.id]);
    await db.run("DELETE FROM sessions WHERE user_id=$1 AND (sid IS NULL OR sid<>$2)", [u.id, u.session_sid || ""]);
    ctx.audit?.("password_changed", u.id, null, u.id);
    await afterPasswordChange(u.id);
    return { ok: true };
  }
  async function afterPasswordChange(uid) { await sendSecurity(uid, "password"); await ctx.services.notify.notify(uid, "security_password", {}); }

  /* ---------- preferences ---------- */
  async function prefs(u) {
    const st = await ctx.services.notify.settings(u.id), d = await db.get("SELECT * FROM digest_settings WHERE user_id=$1", [u.id]), legacy = u.prefs?.settings?.notify || {};
    return { ...(await accountEmail(u)), weekly: !!d?.weekly_email, weeklyEmail: d?.email || null, notifyEmails: st.emailNotify,
      kinds: Object.entries(L.KINDS).map(([kind, K]) => ({ kind, label: K.label, tab: K.tab, email: !!L.channelsFor(kind, st.channels, legacy).email, locked: (K.lock || []).includes("email") })) };
  }
  async function savePrefs(u, b = {}) {
    if (b.weekly !== undefined) {
      const d = await db.get("SELECT * FROM digest_settings WHERE user_id=$1", [u.id]), addr = d?.email || (u.email_verified_at ? u.email : null);
      if (b.weekly && !addr) throw E.bad("أضف بريداً مؤكداً لتصلك النشرة الأسبوعية");
      await db.run("INSERT INTO digest_settings(user_id,weekly_email,email,daily,updated_at) VALUES($1,$2,$3,1,$4) ON CONFLICT (user_id) DO UPDATE SET weekly_email=$2, email=$3, updated_at=$4", [u.id, b.weekly ? 1 : 0, addr, now()]);
    }
    const patch = {};
    if (b.notifyEmails !== undefined) patch.emailNotify = !!b.notifyEmails;
    if (b.kinds && typeof b.kinds === "object") patch.channels = Object.fromEntries(Object.entries(b.kinds).map(([k, v]) => [k, { email: !!v }]));
    if (Object.keys(patch).length) await ctx.services.notify.saveSettings(u.id, patch);
    if (b.resubscribe && u.email) await db.run("DELETE FROM email_suppressions WHERE email=$1 AND reason IN ('unsubscribed','complaint')", [u.email]);
    return prefs(await db.get("SELECT * FROM users WHERE id=$1", [u.id]));
  }
  async function applyUnsubscribe(tok) {
    const t = await readToken(tok); if (!t) throw E.bad("رابط إلغاء الاشتراك غير صالح");
    const u = await db.get("SELECT * FROM users WHERE id=$1", [t.u]);
    if (t.c === "weekly") await db.run("UPDATE digest_settings SET weekly_email=0, updated_at=$1 WHERE user_id=$2", [now(), t.u]);
    else if (t.c === "notify") { if (u) await ctx.services.notify.saveSettings(u.id, { emailNotify: false }); }
    else if (String(t.c).startsWith("notify:")) { const k = t.c.slice(7); if (u && L.KINDS[k]) await ctx.services.notify.saveSettings(u.id, { channels: { [k]: { email: false } } }); }
    else if (t.c === "all") await suppress(t.e, "unsubscribed", "one-click");
    else throw E.bad();
    await logRow({ to: t.e, userId: t.u, kind: "unsubscribe", subject: t.c, status: "unsubscribed" });
    return t;
  }
  const CATEGORY_AR = (c) => c === "weekly" ? "النشرة الأسبوعية" : c === "notify" ? "رسائل الإشعارات" : c === "all" ? "كل الرسائل غير الضرورية" : String(c).startsWith("notify:") ? `إشعارات «${L.kindOf(c.slice(7)).label}» بالبريد` : "هذه الرسائل";
  const html = (res, status, body) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" }); res.end(body); return ctx.STREAM; };

  /* ---------- delivery & bounce webhook ---------- */
  /** normalise provider payloads to [{ type: delivered|bounce|complaint|deferred|dropped, email, messageId, hard, reason }] */
  function normalizeEvents(body) {
    const out = [], arr = Array.isArray(body) ? body : Array.isArray(body?.events) ? body.events : [body];
    for (const e of arr) {
      if (!e || typeof e !== "object") continue;
      if (e.Type === "Notification" && typeof e.Message === "string") { try { out.push(...normalizeEvents(JSON.parse(e.Message))); } catch { /* ignore */ } continue; } // AWS SNS envelope
      if (e.notificationType || e.eventType) { // Amazon SES
        const t = e.notificationType || e.eventType, mid = e.mail?.messageId;
        if (t === "Bounce") for (const r of e.bounce?.bouncedRecipients || []) out.push({ type: "bounce", email: r.emailAddress, messageId: mid, hard: e.bounce.bounceType === "Permanent", reason: r.diagnosticCode || e.bounce.bounceSubType });
        else if (t === "Complaint") for (const r of e.complaint?.complainedRecipients || []) out.push({ type: "complaint", email: r.emailAddress, messageId: mid });
        else if (t === "Delivery") for (const r of e.delivery?.recipients || e.mail?.destination || []) out.push({ type: "delivered", email: r, messageId: mid });
        continue;
      }
      if (e.RecordType) { // Postmark
        const map = { Delivery: "delivered", Bounce: "bounce", SpamComplaint: "complaint" }; if (!map[e.RecordType]) continue;
        out.push({ type: map[e.RecordType], email: e.Email || e.Recipient, messageId: e.MessageID, hard: e.Type === "HardBounce" || e.Type === "BadEmailAddress", reason: e.Description });
        continue;
      }
      if (e.event && e.email) { // SendGrid / Mailgun-like
        const ev = String(e.event).toLowerCase();
        const type = ev === "delivered" ? "delivered" : ev === "bounce" || ev === "failed" ? "bounce" : ev === "spamreport" || ev === "complained" ? "complaint" : ev === "deferred" ? "deferred" : ev === "dropped" ? "dropped" : null; if (!type) continue;
        out.push({ type, email: e.email, messageId: e["smtp-id"] || e.message_id || e.sg_message_id, hard: e.type === "bounce" || e.severity === "permanent" || ev === "dropped", reason: e.reason });
        continue;
      }
      if (e.type && e.email) out.push({ type: e.type, email: e.email, messageId: e.messageId || e.message_id, hard: e.hard !== false && e.bounceType !== "soft", reason: e.reason }); // generic
    }
    return out.filter(x => x.email);
  }
  async function applyEvent(ev) {
    const email = normEmail(ev.email), mid = ev.messageId ? (String(ev.messageId).startsWith("<") ? ev.messageId : `<${ev.messageId}>`) : null;
    const row = mid ? await db.get("SELECT id FROM email_log WHERE message_id=$1 OR message_id=$2 ORDER BY created_at DESC LIMIT 1", [mid, ev.messageId]) : null;
    const status = ev.type === "bounce" ? (ev.hard ? "bounced" : "soft_bounced") : ev.type === "complaint" ? "complained" : ev.type;
    if (row) await setLog(row.id, status, ev.reason || null);
    if (ev.type === "bounce" && ev.hard) await suppress(email, "hard_bounce", ev.reason);
    else if (ev.type === "dropped") await suppress(email, "hard_bounce", ev.reason || "dropped");
    else if (ev.type === "complaint") await suppress(email, "complaint", ev.reason);
    else if (ev.type === "bounce") { // soft: 5 within the suppression row's lifetime → stop non-transactional mail
      await db.run("INSERT INTO email_suppressions(email,reason,detail,soft_count,created_at,updated_at) VALUES($1,'soft',$2,1,$3,$3) ON CONFLICT (email) DO UPDATE SET soft_count=email_suppressions.soft_count+1, updated_at=$3", [email, ev.reason || null, now()]);
      await db.run("UPDATE email_suppressions SET reason='soft_bounce' WHERE email=$1 AND reason='soft' AND soft_count>=5", [email]);
    } else if (ev.type === "delivered") await db.run("DELETE FROM email_suppressions WHERE email=$1 AND reason='soft'", [email]);
    return status;
  }
  function webhookAuthorized(req) {
    const key = secret("MAIL_WEBHOOK_SECRET"); if (!key) return false;
    const sig = String(req.headers["x-webhook-signature"] || req.headers["x-mujtama-signature"] || "").replace(/^sha256=/, "");
    if (sig) { const want = crypto.createHmac("sha256", key).update(req.rawBody || Buffer.alloc(0)).digest("hex"); return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)); }
    const q = String(req.query.token || ""); return q.length === key.length && crypto.timingSafeEqual(Buffer.from(q), Buffer.from(key));
  }

  /* ---------- provider / DNS status (admin) ---------- */
  function dnsStatus() {
    const dk = DKIM.fromEnv(secret), domain = dk?.domain || (mailer.fromAddr || "").split("@")[1] || "mujtama.plus";
    return {
      from: mailer.from, transport: mailer.transport || null, enabled: !!mailer.enabled,
      dkim: dk ? { enabled: true, selector: dk.selector, domain: dk.domain, record: DKIM.dnsRecord(dk) } : { enabled: false, hint: "node server/scripts/dkim-keygen.js <selector> <domain>" },
      spf: { name: domain, type: "TXT", value: process.env.SPF_HINT || "v=spf1 include:<مزود البريد> -all" },
      dmarc: { name: `_dmarc.${domain}`, type: "TXT", value: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}; adkim=s; aspf=s; pct=100` },
      webhook: { configured: !!secret("MAIL_WEBHOOK_SECRET"), path: "/api/email/events" }
    };
  }

  /* ---------- routes ---------- */
  const r = ctx.router, A = ctx.requireUser, admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid(); return fn(req, res); });
  r.get("/api/account/email", A(async (req) => accountEmail(req.user)));
  r.put("/api/account/email", A(async (req) => setEmail(req)));
  r.post("/api/account/email/resend", A(async (req) => { if (!req.user.email) throw E.bad("أضف بريداً أولاً"); if (req.user.email_verified_at) return accountEmail(req.user); if (limited("verify:" + req.user.id, 3)) throw E.rate(); await sendVerify(req.user, req); return accountEmail(req.user); }));
  r.get("/api/email/verify", async (req, res) => {
    const row = await consume(req.query.t, "verify"); let ok = false;
    if (row) { const x = await db.run("UPDATE users SET email_verified_at=$1 WHERE id=$2 AND email=$3", [now(), row.user_id, row.email]); ok = !!x.changes; }
    res.writeHead(302, { Location: `/#/emailprefs?verified=${ok ? 1 : 0}`, "Cache-Control": "no-store" }); res.end(); return ctx.STREAM;
  });
  r.post("/api/auth/forgot", async (req) => forgot(req));
  r.post("/api/auth/reset", async (req) => reset(req));
  r.post("/api/account/password", A(async (req) => changePassword(req)));
  r.get("/api/email/prefs", A(async (req) => prefs(req.user)));
  r.put("/api/email/prefs", A(async (req) => savePrefs(req.user, req.body)));
  /* RFC 8058: GET shows a confirmation page (link scanners must not unsubscribe); POST unsubscribes.
   * POST is exempt from the CSRF header (mail providers post "List-Unsubscribe=One-Click"); the signed token is the authority. */
  r.get("/api/email/unsubscribe", async (req, res) => {
    const t = await readToken(req.query.t);
    if (!t) return html(res, 400, T.page({ title: "رابط غير صالح", body: `<h1>رابط غير صالح</h1><p>تعذّر قراءة رابط إلغاء الاشتراك. يمكنك إدارة رسائلك من الإعدادات داخل التطبيق.</p><p><a href="/#/emailprefs">تفضيلات البريد</a></p>` }));
    return html(res, 200, T.page({ title: "إلغاء الاشتراك", body: `<h1>إلغاء الاشتراك</h1><p>هل تريد إيقاف <b>${T.esc(CATEGORY_AR(t.c))}</b> على العنوان <b dir="ltr">${T.esc(t.e)}</b>؟</p><form method="post" action="/api/email/unsubscribe?t=${encodeURIComponent(req.query.t)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">تأكيد إلغاء الاشتراك</button></form><p style="font-size:13px">رسائل الأمان واستعادة الحساب تصلك دائماً. <a href="/#/emailprefs">كل التفضيلات</a></p>` }));
  });
  r.post("/api/email/unsubscribe", async (req, res) => {
    const t = await applyUnsubscribe(req.query.t || (String(req.rawBody || "").match(/(?:^|&)t=([^&]+)/) || [])[1]);
    if (String(req.headers.accept || "").includes("text/html")) return html(res, 200, T.page({ title: "تم إلغاء الاشتراك", body: `<h1>تم إلغاء الاشتراك ✓</h1><p>لن تصلك ${T.esc(CATEGORY_AR(t.c))} على <b dir="ltr">${T.esc(t.e)}</b>. يمكنك إعادة تفعيلها في أي وقت من تفضيلات البريد.</p><p><a class="b" href="/#/emailprefs">تفضيلات البريد</a></p>` }));
    return { ok: true, category: t.c };
  }, { raw: true, beacon: true });
  r.post("/api/email/events", async (req) => {
    if (!secret("MAIL_WEBHOOK_SECRET")) throw E.off("لم يُضبط MAIL_WEBHOOK_SECRET");
    if (!webhookAuthorized(req)) throw E.forbid("توقيع غير صالح");
    let body; try { body = JSON.parse(String(req.rawBody || "") || "{}"); } catch { throw E.bad("JSON غير صالح"); }
    if (body?.Type === "SubscriptionConfirmation") { log.warn?.("SNS subscription confirmation received; confirm it from the AWS console", { topic: body.TopicArn }); return { ok: true, confirm: "manual" }; }
    const evs = normalizeEvents(body); const statuses = [];
    for (const ev of evs.slice(0, 1000)) statuses.push(await applyEvent(ev));
    return { ok: true, processed: statuses.length, statuses };
  }, { raw: true, beacon: true });
  r.get("/api/email/suppressions", admin(async () => ({ suppressions: await db.all("SELECT email, reason, detail, soft_count AS \"softCount\", updated_at AS \"updatedAt\" FROM email_suppressions ORDER BY updated_at DESC LIMIT 500") })));
  r.del("/api/email/suppressions/:email", admin(async (req) => { await db.run("DELETE FROM email_suppressions WHERE email=$1", [normEmail(req.params.email)]); return { ok: true }; }));
  r.get("/api/email/status", admin(async () => {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    return { ...dnsStatus(), last7d: (await db.all("SELECT status, COUNT(*) n FROM email_log WHERE created_at > $1 GROUP BY status", [since])).map(x => ({ status: x.status, n: Number(x.n) })) };
  }));

  return { sendNow, enqueue, sendSecurity, sendNotification, sendWeekly, weeklyTemplate, suppress, suppression, signToken, readToken, applyUnsubscribe, normalizeEvents, applyEvent, dnsStatus, prefs, savePrefs };
};
