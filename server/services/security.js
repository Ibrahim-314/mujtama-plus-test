/* Security Service (Phase 4): two-factor (TOTP + backup codes), passkeys (WebAuthn), session &
 * device management, new-device alerts, security score. Secrets never leave the server except the
 * one-time TOTP enrolment secret shown to its owner. */
const crypto = require("node:crypto");
const { E, HttpError, str, sha, now, verifyPassword } = require("../lib/core");
const TOTP = require("../lib/totp"), WA = require("../lib/webauthn");
const Sessions = require("../repos/sessions");

module.exports = (ctx) => {
  const { db, router: R, rl, config } = ctx; const S = Sessions(db);
  const need2fa = () => new HttpError(401, "أدخل رمز التحقق من تطبيق المصادقة", "2fa_required");
  const rp = (req) => {
    const origin = req.headers.origin || `${config.secureCookies ? "https" : "http"}://${req.headers.host}`;
    const rpId = config.rpId || new URL(origin).hostname;
    const origins = config.origins || [origin];
    return { rpId, origins };
  };
  const newCodes = () => Array.from({ length: 10 }, () => crypto.randomBytes(5).toString("hex").replace(/(.{5})/, "$1-"));

  async function twoFactor(userId) { return db.get("SELECT * FROM user_2fa WHERE user_id=$1", [userId]); }
  /* Called by the login flow: throws 2fa_required / bad code when a second factor is enrolled. */
  async function checkSecondFactor(user, code) {
    const t = await twoFactor(user.id); if (!t || !t.enabled) return false;
    if (!code) throw need2fa();
    if (!rl.hit("login", "2fa:" + user.id)) throw E.rate();
    const c = String(code).trim().toLowerCase();
    const st = TOTP.verify(t.secret, c, { lastStep: t.last_step ?? null });
    if (st !== null) { await db.run("UPDATE user_2fa SET last_step=$1 WHERE user_id=$2", [st, user.id]); return true; }
    const codes = t.backup_codes || []; const h = sha(c.replace(/\s/g, ""));
    if (codes.includes(h)) { await db.run("UPDATE user_2fa SET backup_codes=$1 WHERE user_id=$2", [codes.filter(x => x !== h), user.id]); ctx.audit("2fa_backup_used", user.id, null, user.id); return true; }
    throw new HttpError(401, "رمز التحقق غير صحيح", "2fa_invalid");
  }
  /* New-device alert: fingerprint = UA family + /24 network. First device is silent. */
  async function noteDevice(user, req) {
    const ua = (req.headers["user-agent"] || "").replace(/[\d.]+/g, "").slice(0, 120);
    const net = String(req.ip || "").replace(/^::ffff:/, "").split(".").slice(0, 3).join(".");
    const fp = sha(ua + "|" + net).slice(0, 32);
    const known = await db.get("SELECT 1 x FROM known_devices WHERE user_id=$1 AND fingerprint=$2", [user.id, fp]);
    if (known) return db.run("UPDATE known_devices SET last_seen=$1 WHERE user_id=$2 AND fingerprint=$3", [now(), user.id, fp]);
    const any = await db.get("SELECT 1 x FROM known_devices WHERE user_id=$1", [user.id]);
    await db.run("INSERT INTO known_devices(user_id,fingerprint,first_seen,last_seen) VALUES($1,$2,$3,$4)", [user.id, fp, now(), now()]);
    if (any) { await ctx.services.messaging.notify(user.id, "security_login", { ref: describeUA(req.headers["user-agent"]) }); ctx.audit("new_device_login", user.id, describeUA(req.headers["user-agent"]), user.id); }
  }
  const describeUA = (ua = "") => {
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "جهاز";
    const br = /PiBrowser/i.test(ua) ? "Pi Browser" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
    return `${br} على ${os}`;
  };

  async function overview(user, req) {
    const t = await twoFactor(user.id);
    const keys = await db.all("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id=$1 ORDER BY created_at DESC", [user.id]);
    const sessions = (await S.listForUser(user.id)).map(s => ({
      sid: s.sid,
      device: describeUA(s.ua),
      ip: maskIp(s.ip),
      createdAt: s.created_at,
      lastSeen: s.last_seen || s.created_at,
      current: s.sid === user.session_sid,
      mfa: !!s.mfa
    }));
    const tips = [];
    let score = 40;
    if (t?.enabled) score += 30;
    else tips.push({ key: "2fa", text: "فعّل التحقق بخطوتين لحماية حسابك حتى لو تسربت كلمة المرور" });
    if (keys.length) score += 20;
    else tips.push({ key: "passkey", text: "أضف مفتاح مرور لتدخل ببصمتك أو وجهك بدل كلمة المرور" });
    if (sessions.length <= 3) score += 10;
    else tips.push({ key: "sessions", text: `حسابك مفتوح على ${sessions.length} أجهزة. سجّل الخروج من التي لا تستخدمها` });
    if (t?.enabled && (t.backup_codes || []).length < 3)
      tips.push({ key: "codes", text: "بقي لديك أقل من 3 رموز احتياطية. أنشئ رموزاً جديدة واحفظها في مكان آمن" }); // v2.79
    const staffRole = user.staff_locked || (STAFF.has(user.role) ? user.role : null),
      p = staffRole ? await policy().catch(() => null) : null;
    const staff = staffRole ? { role: staffRole, locked: !!user.staff_locked, required: !!p?.staff2fa, enforceAt: p?.staff2fa ? p.enforceAt : null } : null;
    return {
      score: Math.min(100, score),
      twoFactor: { enabled: !!t?.enabled, backupCodesLeft: t?.enabled ? (t.backup_codes || []).length : 0 },
      passkeys: keys.map(k => ({ id: k.id, name: k.name, createdAt: k.created_at, lastUsedAt: k.last_used_at })),
      sessions,
      tips,
      staff
    };
  }
  const maskIp = (ip = "") => String(ip).replace(/^::ffff:/, "").replace(/(\d+\.\d+\.\d+)\.\d+/, "$1.x");

  R.get(
    "/api/security",
    ctx.requireUser(async req => overview(req.user, req))
  );
  R.post(
    "/api/security/2fa/setup",
    ctx.requireUser(async req => {
      const t = await twoFactor(req.user.id);
      if (t?.enabled) throw E.conflict("التحقق بخطوتين مفعّل مسبقاً");
      const secret = TOTP.newSecret();
      await db.run("DELETE FROM user_2fa WHERE user_id=$1", [req.user.id]);
      await db.run("INSERT INTO user_2fa(user_id,secret,enabled,backup_codes,created_at) VALUES($1,$2,0,$3,$4)", [req.user.id, secret, [], now()]);
      return { secret, uri: TOTP.uri(secret, "@" + req.user.handle) };
    })
  );
  R.post(
    "/api/security/2fa/enable",
    ctx.requireUser(async req => {
      const t = await twoFactor(req.user.id);
      if (!t) throw E.bad("ابدأ الإعداد أولاً");
      const st = TOTP.verify(t.secret, req.body.code);
      if (st === null) throw new HttpError(400, "الرمز غير صحيح، تأكد من وقت جهازك", "2fa_invalid");
      const codes = newCodes();
      await db.run("UPDATE user_2fa SET enabled=1, last_step=$1, backup_codes=$2 WHERE user_id=$3", [st, codes.map(c => sha(c)), req.user.id]);
      ctx.audit("2fa_enabled", req.user.id, null, req.user.id);
      has2fa.delete(req.user.id);
      return { enabled: true, backupCodes: codes };
    })
  );
  R.post(
    "/api/security/2fa/disable",
    ctx.requireUser(async req => {
      const ok =
        (req.body.password && verifyPassword(String(req.body.password), req.user.password_hash)) ||
        (req.body.code && (await checkSecondFactor(req.user, req.body.code).catch(() => false)));
      if (!ok) throw new HttpError(401, "تحقق بكلمة المرور أو رمز صحيح", "reauth_required");
      await db.run("DELETE FROM user_2fa WHERE user_id=$1", [req.user.id]);
      ctx.audit("2fa_disabled", req.user.id, null, req.user.id);
      has2fa.delete(req.user.id);
      return { enabled: false };
    })
  );
  R.post(
    "/api/security/2fa/backup-codes",
    ctx.requireUser(async req => {
      await checkSecondFactor(req.user, req.body.code);
      const codes = newCodes();
      await db.run("UPDATE user_2fa SET backup_codes=$1 WHERE user_id=$2", [codes.map(c => sha(c)), req.user.id]);
      return { backupCodes: codes };
    })
  );
  R.get(
    "/api/security/sessions",
    ctx.requireUser(async req => ({ sessions: (await overview(req.user, req)).sessions }))
  );
  R.del(
    "/api/security/sessions/:sid",
    ctx.requireUser(async req => {
      const r = await S.revoke(req.user.id, req.params.sid);
      if (!r.changes) throw E.nf();
      ctx.audit("session_revoked", req.user.id, null, req.user.id);
      return { ok: true };
    })
  );
  R.post(
    "/api/security/sessions/revoke-others",
    ctx.requireUser(async req => {
      const r = await S.revokeOthers(req.user.id, req.user.session_sid);
      ctx.audit("sessions_revoked_others", req.user.id, String(r.changes), req.user.id);
      return { revoked: r.changes };
    })
  );

  /* ---- v2.79 account guard ----
   * • Staff 2FA policy: an admin (who has 2FA themselves) can require 2FA for platform staff (admin, moderator) after a grace
   *   period; a session signed in with Pi (strong auth on the Pi app) or a second factor also satisfies it.
   *   Once enforced, a staff account without 2FA is served as a regular member (role "user", staff_locked = old role)
   *   until it enables 2FA, so every existing role check denies staff powers without touching 100 call sites. Nothing is
   *   demoted in the database. Kill switch for operators: SECURITY_STAFF2FA_OFF=1.
   * • Repeated failed passwords (5 within an hour) alert the owner once per 24 h (security_failed).
   * • Own security activity: the member's security events from the audit chain.
   * • Incident response: an admin with 2FA can sign out every session on the platform except their own. */
  const STAFF = new Set(["admin", "moderator"]);
  let pol = { at: 0, v: null };
  async function policy() {
    if (pol.v && Date.now() - pol.at < 30e3) return pol.v;
    const r = await db.get("SELECT value FROM provider_settings WHERE name='security_policy'").catch(() => null);
    let v = {};
    try {
      v = JSON.parse(r?.value || "{}") || {};
    } catch {
      v = {};
    }
    pol = {
      at: Date.now(),
      v: { staff2fa: !!v.staff2fa && process.env.SECURITY_STAFF2FA_OFF !== "1", enforceAt: v.enforceAt || null, updatedAt: v.updatedAt || null }
    };
    return pol.v;
  }
  const has2fa = new Map();
  async function enabled2fa(uid) {
    const c = has2fa.get(uid);
    if (c && Date.now() - c.at < 30e3) return c.v;
    const v = !!(await twoFactor(uid))?.enabled;
    if (has2fa.size > 5000) has2fa.clear();
    has2fa.set(uid, { v, at: Date.now() });
    return v;
  }
  async function gate(row) {
    if (!row || !STAFF.has(row.role)) return row;
    const p = await policy().catch(() => null);
    if (!p?.staff2fa || !p.enforceAt || Date.now() < Date.parse(p.enforceAt)) return row;
    if (Number(row.session_mfa) || row.session_mfa === true || (await enabled2fa(row.id))) return row; // a Pi or 2FA-verified session satisfies the policy
    return { ...row, role: "user", staff_locked: row.role };
  }
  const fails = new Map();
  function noteFailed(u) {
    const t = Date.now(),
      f = fails.get(u.id) || { at: [], alerted: 0 };
    f.at = f.at.filter(x => t - x < 3600e3);
    f.at.push(t);
    if (fails.size > 10000) for (const [k, v] of fails) if (!v.at.length || t - v.at[v.at.length - 1] > 3600e3) fails.delete(k);
    fails.set(u.id, f);
    if (f.at.length >= 5 && t - f.alerted > 864e5) {
      f.alerted = t;
      ctx.services.messaging?.notify?.(u.id, "security_failed", { ref: String(f.at.length) })?.catch?.(() => {});
      ctx.audit("login_failed_burst", u.id, String(f.at.length), null);
    }
  }
  const ACTIVITY = [
    "new_device_login",
    "login_failed_burst",
    "2fa_enabled",
    "2fa_disabled",
    "2fa_backup_used",
    "passkey_added",
    "passkey_removed",
    "session_revoked",
    "sessions_revoked_others",
    "password_changed",
    "email_changed",
    "pi_link",
    "pi_unlink"
  ];
  R.get(
    "/api/security/activity",
    ctx.requireUser(async req => {
      const before = Number.parseInt(String(req.query?.before || ""), 10);
      const ph = ACTIVITY.map((_, i) => "$" + (i + 2)).join(",");
      const args = [req.user.id, ...ACTIVITY];
      let extra = "";
      if (Number.isInteger(before) && before > 0) {
        args.push(before);
        extra = ` AND id < $${args.length}`;
      }
      const rows = await db.all(`SELECT id, action, reason, at FROM audit_log WHERE target=$1 AND action IN (${ph})${extra} ORDER BY id DESC LIMIT 31`, args);
      return {
        items: rows
          .slice(0, 30)
          .map(r => ({
            id: Number(r.id),
            action: r.action,
            detail: r.action === "new_device_login" || r.action === "login_failed_burst" ? r.reason || null : null,
            at: r.at
          })),
        more: rows.length > 30
      };
    })
  );
  const admin = fn =>
    ctx.requireUser(async (req, res) => {
      if (req.user.role !== "admin") throw E.forbid("للإدارة فقط");
      return fn(req, res);
    });
  R.get(
    "/api/admin/security/policy",
    admin(async req => {
      const p = await policy();
      const staff = await db.all(
        "SELECT u.id, u.handle, u.name, u.role, COALESCE(t.enabled,0) AS tfa FROM users u LEFT JOIN user_2fa t ON t.user_id=u.id WHERE u.role IN ('admin','moderator') AND u.status='active' ORDER BY u.role, u.handle LIMIT 200"
      );
      const sessions = Number((await db.get("SELECT COUNT(*) n FROM sessions WHERE expires_at > $1", [now()]))?.n || 0);
      return {
        policy: {
          staff2fa: p.staff2fa,
          enforceAt: p.enforceAt,
          enforced: !!(p.staff2fa && p.enforceAt && Date.now() >= Date.parse(p.enforceAt)),
          killSwitch: process.env.SECURITY_STAFF2FA_OFF === "1"
        },
        me2fa: await enabled2fa(req.user.id),
        sessions,
        staff: staff.map(u => ({ id: u.id, handle: u.handle, name: u.name, role: u.role, twoFactor: !!Number(u.tfa) }))
      };
    })
  );
  R.put(
    "/api/admin/security/policy",
    admin(async req => {
      const on = req.body.staff2fa === true,
        grace = Number(req.body.graceHours ?? 72);
      if (typeof req.body.staff2fa !== "boolean") throw E.bad();
      if (on && ![0, 24, 72, 168].includes(grace)) throw E.bad("مهلة غير صالحة");
      if (on && !(await enabled2fa(req.user.id))) throw new HttpError(409, "فعّل التحقق بخطوتين لحسابك أولاً حتى لا تفقد صلاحياتك", "self_2fa_required");
      const cur = await policy();
      const enforceAt = on ? (cur.staff2fa && cur.enforceAt ? cur.enforceAt : new Date(Date.now() + grace * 3600e3).toISOString()) : null;
      await db.run(
        "INSERT INTO provider_settings(name,value,updated_by,updated_at) VALUES('security_policy',$1,$2,$3) ON CONFLICT (name) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3",
        [JSON.stringify({ staff2fa: on, enforceAt, updatedAt: now() }), req.user.id, now()]
      );
      pol = { at: 0, v: null };
      ctx.audit(on ? "staff_2fa_required" : "staff_2fa_optional", "security_policy", on ? enforceAt : null, req.user.id);
      if (on && !cur.staff2fa) {
        const need = await db.all(
          "SELECT u.id FROM users u LEFT JOIN user_2fa t ON t.user_id=u.id WHERE u.role IN ('admin','moderator') AND u.status='active' AND COALESCE(t.enabled,0)=0 LIMIT 200"
        );
        for (const u of need) await ctx.services.messaging?.notify?.(u.id, "security_staff2fa", { ref: enforceAt })?.catch?.(() => {});
      }
      return { policy: await policy() };
    })
  );
  R.post(
    "/api/admin/security/revoke-all",
    admin(async req => {
      if (String(req.body.confirm || "").trim() !== "تسجيل خروج الجميع") throw E.bad("اكتب العبارة كما هي للتأكيد");
      if (!(await enabled2fa(req.user.id))) throw new HttpError(409, "هذا الإجراء يحتاج التحقق بخطوتين على حسابك", "self_2fa_required");
      if (!req.body.code) throw need2fa();
      await checkSecondFactor(req.user, req.body.code);
      const r = await S.revokeAllExcept(req.user.session_sid);
      const n = Number(r?.changes ?? r?.rowCount ?? 0);
      ctx.audit("sessions_revoked_all", "platform", String(n), req.user.id);
      return { revoked: n };
    })
  );

  /* ---- Passkeys ---- */
  async function challenge(kind, userId) {
    const c = WA.b64u(crypto.randomBytes(32));
    await db.run("DELETE FROM webauthn_challenges WHERE expires_at < $1", [now()]);
    await db.run("INSERT INTO webauthn_challenges(challenge,user_id,kind,expires_at) VALUES($1,$2,$3,$4)", [c, userId || null, kind, new Date(Date.now() + 5 * 60e3).toISOString()]);
    return c;
  }
  async function takeChallenge(clientDataJSON, kind) {
    let c; try { c = JSON.parse(WA.fromB64u(clientDataJSON).toString("utf8")).challenge; } catch { c = null; } // phase 50 audit: malformed input → 400, not 500
    if (typeof c !== "string" || !c) throw E.bad("بيانات مفتاح المرور غير صالحة");
    const row = await db.get("SELECT * FROM webauthn_challenges WHERE challenge=$1 AND kind=$2 AND expires_at > $3", [c, kind, now()]);
    if (!row) throw E.bad("انتهت صلاحية الطلب، حاول مرة أخرى");
    await db.run("DELETE FROM webauthn_challenges WHERE challenge=$1", [c]); return row;
  }
  R.post("/api/security/passkeys/options", ctx.requireUser(async (req) => {
    const { rpId } = rp(req); const existing = await db.all("SELECT id FROM passkeys WHERE user_id=$1", [req.user.id]);
    return { publicKey: { challenge: await challenge("reg", req.user.id), rp: { id: rpId, name: "مجتمع بلس" }, user: { id: WA.b64u(Buffer.from(req.user.id)), name: req.user.handle, displayName: req.user.name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60000, attestation: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" }, excludeCredentials: existing.map(k => ({ type: "public-key", id: k.id })) } };
  }));
  R.post("/api/security/passkeys", ctx.requireUser(async (req) => {
    const resp = req.body.response || {}; const row = await takeChallenge(resp.clientDataJSON, "reg");
    if (row.user_id !== req.user.id) throw E.forbid();
    let v; try { v = WA.verifyRegistration({ response: resp, challenge: row.challenge, ...rp(req) }); } catch (e) { throw E.bad("تعذر التحقق من مفتاح المرور: " + e.message); }
    await db.run("INSERT INTO passkeys(id,user_id,public_key,alg,sign_count,name,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [v.credentialId, req.user.id, v.publicKey, v.alg, v.signCount, str(req.body.name, 40) || "مفتاح مرور", now()]);
    ctx.audit("passkey_added", req.user.id, null, req.user.id);
    return { id: v.credentialId };
  }));
  R.del("/api/security/passkeys/:id", ctx.requireUser(async (req) => { const r = await db.run("DELETE FROM passkeys WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]); if (!r.changes) throw E.nf(); ctx.audit("passkey_removed", req.user.id, null, req.user.id); return { ok: true }; }));
  R.post("/api/auth/passkey/options", async (req) => {
    if (!rl.hit("login", req.ip)) throw E.rate();
    let allow = [];
    if (req.body.handle) { const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(req.body.handle)]); if (u) allow = (await db.all("SELECT id FROM passkeys WHERE user_id=$1", [u.id])).map(k => ({ type: "public-key", id: k.id })); }
    return { publicKey: { challenge: await challenge("auth"), rpId: rp(req).rpId, timeout: 60000, userVerification: "preferred", allowCredentials: allow } };
  });
  R.post("/api/auth/passkey", async (req, res) => {
    if (!rl.hit("login", req.ip)) throw E.rate();
    const resp = req.body.response || {}; const row = await takeChallenge(resp.clientDataJSON, "auth");
    const key = await db.get("SELECT * FROM passkeys WHERE id=$1", [String(req.body.id || "")]); if (!key) throw new HttpError(401, "مفتاح المرور غير معروف", "bad_credentials");
    let v; try { v = WA.verifyAssertion({ response: resp, challenge: row.challenge, ...rp(req), publicKey: key.public_key, alg: key.alg, signCount: key.sign_count }); } catch (e) { throw new HttpError(401, "فشل التحقق من مفتاح المرور", "bad_credentials"); }
    await db.run("UPDATE passkeys SET sign_count=$1, last_used_at=$2 WHERE id=$3", [v.signCount, now(), key.id]);
    const u = await db.get("SELECT * FROM users WHERE id=$1", [key.user_id]); if (!u || u.status !== "active") throw E.forbid("الحساب موقوف");
    await ctx.services.users.sessionFor(res, u, req, { mfa: true });
    return { user: ctx.services.users.pub(u) };
  });

  return {
    checkSecondFactor,
    noteDevice,
    describeUA,
    gate,
    noteFailed,
    policy,
    resetGuardCache: () => {
      pol = { at: 0, v: null };
      has2fa.clear();
    }
  };
};
