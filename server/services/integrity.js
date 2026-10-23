/* Integrity Service (Track 7, Phase 32 — مكافحة الحسابات الوهمية). Anti-fake-account signals, all
 * heuristics that rank accounts for human review; nothing here deletes data or bans on its own.
 *  1. Coordinated networks: near-duplicate content (SimHash), repeated timing bursts (same accounts
 *     acting on the same target within seconds, again and again) and shared device signals become a
 *     weighted co-ordination graph; connected groups become review flags.
 *  2. Device fingerprint: the client sends SHA-256 hashes of coarse device traits + a random device id;
 *     the server keeps only an HMAC of those hashes (salted, never raw traits) and matches accounts.
 *     More than DEVICE_MAX_ACCOUNTS accounts on one device → a flag + a reversible soft limit on the extras.
 *  3. Optional phone verification: OTP with hashed code, attempts and expiry; phone stored as HMAC only.
 *     SMS goes out only through an explicitly configured provider (SMS_PROVIDER=webhook); in dev/test the
 *     code lands in an in-memory test sink; production without a provider answers 501.
 *  4. Pi KYC: when PI_ENABLED, /v2/me is re-checked server-side and a KYC (or "linked") status is stored.
 *  5. Relationship graph (lib/graph.js): follow + interaction edges, label propagation, density,
 *     reciprocity, conductance → dense inward-looking clusters.
 *  6. Fake-follower cleanup on ctx.scheduler: follows by accounts that look fake are soft-hidden in
 *     follower_flags (follows rows untouched), auto-restored when the account earns trust, admin restore.
 *  7. Transparent "new account" badge via a public, cached badges endpoint.
 *  8. Admin-only investigations API (flags, users, graph, limits, followers, manual scans). */
const crypto = require("node:crypto");
const { E, HttpError, str, id, now, sha } = require("../lib/core");
const G = require("../lib/graph");
const { secret } = require("../lib/secrets");

const DAY = 864e5;
const J = v => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const envNum = (k, d) => (process.env[k] !== undefined && process.env[k] !== "" && !isNaN(+process.env[k]) ? +process.env[k] : d);

/* ---------- pure helpers (exported for unit tests) ---------- */
const AR_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
const toLatinDigits = s => String(s).replace(AR_DIGITS, d => String((d.charCodeAt(0) & 0xf) % 10));
function normText(s = "") {
  return toLatinDigits(String(s))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#][\p{L}\p{N}_]+/gu, " ")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/(\p{L})\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
const h64 = s => BigInt("0x" + crypto.createHash("md5").update(s).digest("hex").slice(0, 16));
/** 64-bit SimHash (hex) over word bigrams (or char trigrams for very short texts) */
function simhash(text) {
  const t = normText(text);
  if (!t) return null;
  const w = t.split(" ");
  const feats = w.length >= 4 ? w.slice(1).map((x, i) => w[i] + " " + x) : [...t.replace(/ /g, "")].map((c, i, a) => a.slice(i, i + 3).join("")).filter(x => x.length === 3);
  if (!feats.length) return null;
  const v = new Array(64).fill(0);
  for (const f of feats) {
    const h = h64(f);
    for (let i = 0; i < 64; i++) v[i] += (h >> BigInt(i)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let i = 0; i < 64; i++) if (v[i] > 0) out |= 1n << BigInt(i);
  return out.toString(16).padStart(16, "0");
}
function hamming(a, b) {
  if (!a || !b) return 64;
  let x = BigInt("0x" + a) ^ BigInt("0x" + b),
    n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
/** groups items {id, actor, hash} whose SimHash differ by <= maxDist (band bucketing, pigeonhole for maxDist <= 3) */
function nearDuplicateGroups(items, { maxDist = 3, minActors = 3 } = {}) {
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const buckets = new Map();
  items.forEach((it, i) => {
    if (!it.hash) return;
    for (let b = 0; b < 4; b++) {
      const k = b + ":" + it.hash.slice(b * 4, b * 4 + 4);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(i);
    }
  });
  for (const list of buckets.values()) {
    if (list.length > 400) continue; // degenerate bucket (e.g. empty-ish texts): skip rather than go quadratic
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x],
          j = list[y];
        if (find(i) !== find(j) && hamming(items[i].hash, items[j].hash) <= maxDist) parent[find(i)] = find(j);
      }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    if (!it.hash) return;
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  return [...groups.values()].filter(g => new Set(g.map(x => x.actor)).size >= minActors);
}
/** non-overlapping bursts: >= minActors distinct actors acting on the same key within windowMs */
function bursts(events, { windowMs = 120e3, minActors = 4 } = {}) {
  const byKey = new Map();
  for (const e of events) {
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push(e);
  }
  const out = [];
  for (const [key, list] of byKey) {
    if (list.length < minActors) continue;
    list.sort((a, b) => a.at - b.at);
    let i = 0;
    while (i < list.length) {
      let j = i;
      while (j + 1 < list.length && list[j + 1].at - list[i].at <= windowMs) j++;
      const actors = [...new Set(list.slice(i, j + 1).map(e => e.actor))];
      if (actors.length >= minActors) {
        out.push({ key, actors: actors.sort(), start: list[i].at, end: list[j].at });
        i = j + 1;
      } else i++;
    }
  }
  return out;
}
/** E.164 normalisation; local numbers get the default country code (966 → Saudi Arabia) */
function e164(raw, cc = "966") {
  if (typeof raw !== "string") return null;
  let s = toLatinDigits(raw).replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  else if (s.startsWith("0")) s = "+" + cc + s.slice(1);
  else if (!s.startsWith("+") && s.startsWith(cc)) s = "+" + s;
  else if (!s.startsWith("+")) s = "+" + cc + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
/** 0..1 likelihood that an account is a fake follower; trust signals pull it down */
function fakeFollowerScore(f) {
  if (f.suspended) return 1;
  if (f.verified) return 0;
  let s = 0;
  if (f.ageDays < 7) s += 0.2;
  if (!f.posts && !f.comments) s += 0.25;
  if (!f.hasAvatar) s += 0.1;
  if (!f.hasBio) s += 0.05;
  if (f.following >= 100 && f.followers * 10 < f.following) s += 0.25;
  if (f.following >= 500) s += 0.1;
  if (f.limited) s += 0.3;
  if (f.flagged) s += 0.3;
  if (f.phoneVerified) s -= 0.4;
  if (f.piVerified) s -= 0.4;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}
/** Pi /v2/me → "verified" | "linked". Pi does not document a KYC field publicly, so several shapes are accepted */
function piKycStatus(me) {
  if (!me) return null;
  const k = me.kyc_verified ?? me.kycVerified ?? me.kyc?.verified ?? me.kyc?.status ?? me.credentials?.kyc;
  return k === true || k === "verified" || k === "approved" ? "verified" : "linked";
}
const sigOf = members => sha([...members].sort().join(",")).slice(0, 32);
const ageDays = iso => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));

/* soft limits for accounts under review (level → action → [max, windowMs]) */
const LIMITS = {
  limited: { follow: [20, 3600e3], post: [6, 3600e3], comment: [15, 3600e3], message: [15, 3600e3], react: [60, 3600e3] },
  restricted: { follow: [5, 3600e3], post: [2, 3600e3], comment: [5, 3600e3], message: [5, 3600e3], react: [20, 3600e3] }
};
const LIMIT_TEXT = { limited: "حسابك تحت مراجعة تلقائية مؤقتة، لذا بعض الإجراءات محدودة. توثيق رقم الجوال يرفع القيود غالباً.", restricted: "قيّد فريق الأمان بعض إجراءات حسابك مؤقتاً أثناء المراجعة." };

module.exports = ctx => {
  const { db, router: R, bus, config } = ctx;
  const A = ctx.requireUser;
  const log = require("../lib/log").log;
  const isAdmin = req => (req.actor || req.user)?.role === "admin";
  const admin = fn => A(async (req, res) => {
    if (!isAdmin(req)) throw E.forbid("للفريق فقط");
    return fn(req, res);
  });
  const opt = {
    newDays: () => +(config.newAccountDays ?? envNum("NEW_ACCOUNT_DAYS", 30)),
    deviceMax: () => +(config.deviceMaxAccounts ?? envNum("DEVICE_MAX_ACCOUNTS", 5)),
    phoneMax: () => +(config.phoneMaxAccounts ?? envNum("PHONE_MAX_ACCOUNTS", 1)),
    cc: () => String(process.env.PHONE_DEFAULT_CC || "966"),
    fakeThreshold: () => +(config.fakeFollowerThreshold ?? envNum("FAKE_FOLLOWER_THRESHOLD", 0.7)),
    sms: () => config.smsProvider || process.env.SMS_PROVIDER || (process.env.NODE_ENV === "production" ? "off" : "log")
  };

  /* ---------- salted hashing ---------- */
  let saltP = null;
  const salt = () =>
    (saltP ||= (async () => {
      const s = secret("INTEGRITY_SALT");
      if (s) return s;
      const row = await db.get("SELECT value FROM integrity_meta WHERE key='salt'");
      if (row) return row.value;
      await db.run("INSERT INTO integrity_meta(key,value) VALUES('salt',$1) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString("hex")]);
      return (await db.get("SELECT value FROM integrity_meta WHERE key='salt'")).value;
    })().catch(e => {
      saltP = null;
      throw e;
    }));
  const hmac = async (kind, v) => crypto.createHmac("sha256", await salt()).update(kind + ":" + v).digest("hex");

  /* tiny sliding-window limiter for OTP + soft limits (separate from ctx.rl so tests can reset it) */
  const windows = new Map();
  const hit = (key, max, ms) => {
    const t = Date.now(),
      arr = (windows.get(key) || []).filter(x => t - x < ms);
    if (arr.length >= max) {
      windows.set(key, arr);
      return false;
    }
    arr.push(t);
    windows.set(key, arr);
    return true;
  };

  /* ---------- limits ---------- */
  const limitOf = uid => db.get("SELECT level, reason, flag_id, created_at FROM integrity_limits WHERE user_id=$1", [uid]);
  async function setLimit(uid, level, reason, { flagId = null, by = "system" } = {}) {
    const u = await db.get("SELECT role, verified FROM users WHERE id=$1", [uid]);
    if (!u || u.role === "admin") return false;
    if (level === "none") {
      const r = await db.run("DELETE FROM integrity_limits WHERE user_id=$1", [uid]);
      if (r.changes) await ctx.audit("integrity_limit_lifted", uid, reason || null, by);
      return !!r.changes;
    }
    if (!LIMITS[level]) throw E.bad();
    await db.run("INSERT INTO integrity_limits(user_id,level,reason,flag_id,by_user,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO UPDATE SET level=$2, reason=$3, flag_id=$4, by_user=$5", [uid, level, reason || null, flagId, by, now()]);
    await ctx.audit("integrity_limit_" + level, uid, reason || null, by);
    return true;
  }
  /** call before follow/post/comment/message/react; throws 429 integrity_limited for soft-limited accounts */
  async function guard(uid, action) {
    if (!uid) return;
    const l = await limitOf(uid);
    const lim = l && LIMITS[l.level]?.[action];
    if (lim && !hit(`g:${l.level}:${action}:${uid}`, lim[0], lim[1])) throw new HttpError(429, LIMIT_TEXT[l.level], "integrity_limited");
  }

  /* ---------- flags ---------- */
  async function upsertFlag(kind, members, score, reason, evidence) {
    const sig = sigOf(members);
    const ex = await db.get("SELECT id, status FROM integrity_flags WHERE kind=$1 AND sig=$2", [kind, sig]);
    if (!ex) {
      // a growing group (one more account on the device, one more bot in the ring) extends its open case
      const set = new Set(members);
      for (const f of await db.all("SELECT id, members FROM integrity_flags WHERE kind=$1 AND status='open' ORDER BY created_at DESC LIMIT 500", [kind])) {
        const old = J(f.members) || [];
        if (old.filter(m => set.has(m)).length * 2 >= Math.min(old.length, set.size)) {
          const all = [...new Set([...old, ...members])].sort();
          await db.run("UPDATE integrity_flags SET members=$1, sig=$2, score=$3, reason=$4, evidence=$5, updated_at=$6 WHERE id=$7", [all, sigOf(all), score, reason, evidence, now(), f.id]);
          return { id: f.id, created: false, status: "open" };
        }
      }
    }
    if (ex) {
      if (ex.status === "open") await db.run("UPDATE integrity_flags SET score=$1, reason=$2, evidence=$3, updated_at=$4 WHERE id=$5", [score, reason, evidence, now(), ex.id]);
      return { id: ex.id, created: false, status: ex.status };
    }
    const fid = id("ig");
    await db.run("INSERT INTO integrity_flags(id,kind,sig,members,score,reason,evidence,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8,$8)", [fid, kind, sig, [...members].sort(), score, reason, evidence, now()]);
    bus.emit("INTEGRITY_FLAGGED", { flag: fid, kind, members: members.length, score });
    return { id: fid, created: true, status: "open" };
  }
  const flaggedUsers = async () => {
    const s = new Set();
    for (const f of await db.all("SELECT members FROM integrity_flags WHERE status IN ('open','confirmed') AND score >= 0.6")) for (const m of J(f.members) || []) s.add(m);
    return s;
  };

  /* ---------- 2. device fingerprint ---------- */
  async function recordDevice(user, { fp, did }, req) {
    const HEX = /^[a-f0-9]{64}$/;
    const sig = [];
    if (typeof did === "string" && HEX.test(did)) sig.push(["did", await hmac("did", did)]);
    if (typeof fp === "string" && HEX.test(fp)) sig.push(["fp", await hmac("fp", fp)]);
    if (!sig.length) throw E.bad("بصمة غير صالحة");
    for (const [kind, h] of sig) await db.run("INSERT INTO device_signals(user_id,kind,hash,first_seen,last_seen,hits) VALUES($1,$2,$3,$4,$4,1) ON CONFLICT (user_id,kind,hash) DO UPDATE SET last_seen=$4, hits=device_signals.hits+1", [user.id, kind, h, now()]);
    return evaluateDevice(user.id);
  }
  /** accounts sharing a device with uid: a device id is strong; a coarse fingerprint only counts with the same network (known_devices) */
  async function linkedAccounts(uid) {
    const strong = await db.all("SELECT DISTINCT o.user_id id FROM device_signals m JOIN device_signals o ON o.kind='did' AND o.hash=m.hash AND o.user_id<>m.user_id WHERE m.user_id=$1 AND m.kind='did'", [uid]);
    const weak = await db.all(
      "SELECT DISTINCT o.user_id id FROM device_signals m JOIN device_signals o ON o.kind='fp' AND o.hash=m.hash AND o.user_id<>m.user_id JOIN known_devices k1 ON k1.user_id=m.user_id JOIN known_devices k2 ON k2.user_id=o.user_id AND k2.fingerprint=k1.fingerprint WHERE m.user_id=$1 AND m.kind='fp'",
      [uid]
    );
    const out = new Map();
    for (const r of weak) out.set(r.id, "fingerprint+network");
    for (const r of strong) out.set(r.id, "device");
    return out;
  }
  async function evaluateDevice(uid) {
    const linked = await linkedAccounts(uid);
    const max = opt.deviceMax();
    if (linked.size + 1 <= max) return { limited: !!(await limitOf(uid)) };
    const members = [uid, ...linked.keys()];
    const rows = await db.all(`SELECT id, created_at, role, verified FROM users WHERE id IN (${members.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY created_at, id`, members);
    const f = await upsertFlag("multi_account", rows.map(r => r.id), Math.min(1, 0.5 + 0.1 * (rows.length - max)), `${rows.length} حسابات على جهاز واحد (الحد ${max})`, { device: [...linked.values()].filter(v => v === "device").length, weak: [...linked.values()].filter(v => v !== "device").length });
    if (f.status !== "dismissed") for (const r of rows.slice(max)) if (r.role !== "admin" && !r.verified && !(await limitOf(r.id))) await setLimit(r.id, "limited", "multi_account", { flagId: f.id });
    return { limited: !!(await limitOf(uid)) };
  }

  /* ---------- 3. phone verification ---------- */
  const outbox = [];
  async function sendSms(to, text, meta) {
    const mode = opt.sms();
    if (mode === "log") {
      outbox.push({ to, text, at: Date.now(), ...meta });
      if (outbox.length > 50) outbox.shift();
      if (process.env.NODE_ENV !== "production") log.info("sms test sink", { to: to.slice(0, 4) + "•••" + to.slice(-2), code: meta.code });
      return;
    }
    if (mode === "webhook" && process.env.SMS_WEBHOOK_URL) {
      const tok = secret("SMS_WEBHOOK_TOKEN");
      const r = await fetch(process.env.SMS_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify({ to, text }), signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (!r || !r.ok) throw new HttpError(502, "تعذر إرسال الرسالة الآن، حاول لاحقاً", "sms_failed");
      return;
    }
    throw E.off("التحقق برقم الجوال غير متاح حالياً");
  }
  async function phoneStart(user, raw) {
    if (opt.sms() === "off" || (opt.sms() === "webhook" && !process.env.SMS_WEBHOOK_URL)) throw E.off("التحقق برقم الجوال غير متاح حالياً");
    const phone = e164(raw, opt.cc());
    if (!phone) throw E.bad("رقم الجوال غير صالح");
    const ph = await hmac("phone", phone);
    if (!hit("otp:u:" + user.id, 3, 10 * 60e3) || !hit("otp:p:" + ph, 5, 3600e3)) throw E.rate();
    const mine = await db.get("SELECT phone_hash FROM phone_verifications WHERE user_id=$1", [user.id]);
    if (mine?.phone_hash === ph) throw E.conflict("هذا الرقم موثّق لحسابك مسبقاً");
    const others = (await db.get("SELECT COUNT(*) n FROM phone_verifications WHERE phone_hash=$1 AND user_id<>$2", [ph, user.id])).n;
    if (others >= opt.phoneMax()) throw E.conflict("هذا الرقم مرتبط بحساب آخر");
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"),
      oid = id("otp");
    await db.run("DELETE FROM phone_otps WHERE user_id=$1", [user.id]);
    await db.run("INSERT INTO phone_otps(id,user_id,phone_hash,phone_hint,code_hash,attempts,expires_at,created_at) VALUES($1,$2,$3,$4,$5,0,$6,$7)", [oid, user.id, ph, phone.slice(-2), await hmac("otp", oid + ":" + code), new Date(Date.now() + 10 * 60e3).toISOString(), now()]);
    await sendSms(phone, `رمز التحقق في مجتمع بلس: ${code}\nلا تشاركه مع أحد.`, { code, user: user.id });
    return { sent: true, hint: "•••• " + phone.slice(-2), expiresIn: 600 };
  }
  async function phoneVerify(user, code) {
    const o = await db.get("SELECT * FROM phone_otps WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1", [user.id]);
    if (!o || Date.parse(o.expires_at) < Date.now()) throw E.bad("انتهت صلاحية الرمز، اطلب رمزاً جديداً");
    if (o.attempts >= 5) throw E.rate();
    const c = toLatinDigits(String(code || "")).replace(/\D/g, "");
    const want = Buffer.from(o.code_hash, "hex"),
      got = Buffer.from(await hmac("otp", o.id + ":" + c), "hex");
    if (c.length !== 6 || !crypto.timingSafeEqual(want, got)) {
      await db.run("UPDATE phone_otps SET attempts=attempts+1 WHERE id=$1", [o.id]);
      throw new HttpError(400, "الرمز غير صحيح", "otp_invalid");
    }
    const others = (await db.get("SELECT COUNT(*) n FROM phone_verifications WHERE phone_hash=$1 AND user_id<>$2", [o.phone_hash, user.id])).n;
    if (others >= opt.phoneMax()) throw E.conflict("هذا الرقم مرتبط بحساب آخر");
    await db.run("INSERT INTO phone_verifications(user_id,phone_hash,phone_hint,verified_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET phone_hash=$2, phone_hint=$3, verified_at=$4", [user.id, o.phone_hash, o.phone_hint, now()]);
    await db.run("DELETE FROM phone_otps WHERE user_id=$1", [user.id]);
    const l = await limitOf(user.id);
    if (l?.level === "limited" && l.reason === "multi_account") await setLimit(user.id, "none", "phone_verified");
    await ctx.audit("phone_verified", user.id, null, user.id);
    bus.emit("PHONE_VERIFIED", { user: user.id });
    ctx.cache.del("ibadge:");
    return { verified: true, hint: "•••• " + o.phone_hint };
  }

  /* ---------- 4. Pi KYC ---------- */
  async function piKyc(user, accessToken) {
    if (!config.piEnabled) throw E.off("Pi غير مفعّل بعد");
    if (!user.pi_uid) throw E.bad("سجّل الدخول عبر Pi Browser أولاً لربط حسابك بـ Pi");
    const r = await fetch(config.piApi + "/v2/me", { headers: { Authorization: "Bearer " + accessToken }, signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r || !r.ok) throw new HttpError(401, "تعذر التحقق من حساب Pi", "pi_invalid");
    const me = await r.json();
    if (me.uid !== user.pi_uid) throw E.forbid("حساب Pi لا يطابق حسابك");
    const status = piKycStatus(me);
    await db.run("INSERT INTO pi_kyc(user_id,status,source,checked_at) VALUES($1,$2,'pi',$3) ON CONFLICT (user_id) DO UPDATE SET status=$2, checked_at=$3", [user.id, status, now()]);
    ctx.cache.del("ibadge:");
    return { kyc: status };
  }
  bus.on("USER_REGISTERED", async e => {
    const u = await db.get("SELECT pi_uid FROM users WHERE id=$1", [e.user]);
    if (u?.pi_uid) await db.run("INSERT INTO pi_kyc(user_id,status,source,checked_at) VALUES($1,'linked','pi',$2) ON CONFLICT DO NOTHING", [e.user, now()]);
  });

  /* ---------- trust signals ---------- */
  async function trustSignals(uid, { forStaff = false } = {}) {
    const u = await db.get("SELECT id, created_at, verified, reputation, status, role FROM users WHERE id=$1", [uid]);
    if (!u) throw E.nf();
    const [phone, pi, tfa, lim, hidden] = await Promise.all([
      db.get("SELECT phone_hint, verified_at FROM phone_verifications WHERE user_id=$1", [uid]),
      db.get("SELECT status, checked_at FROM pi_kyc WHERE user_id=$1", [uid]),
      db.get("SELECT enabled FROM user_2fa WHERE user_id=$1", [uid]).catch(() => null),
      limitOf(uid),
      hiddenFollowerCount(uid)
    ]);
    const age = ageDays(u.created_at);
    const openFlags = forStaff ? (await db.all("SELECT id, members FROM integrity_flags WHERE status='open'")).filter(f => (J(f.members) || []).includes(uid)).length : 0;
    let score = 30 + Math.min(20, age / 3) + (phone ? 20 : 0) + (pi?.status === "verified" ? 20 : pi ? 8 : 0) + (tfa?.enabled ? 10 : 0) + (u.verified ? 15 : 0) + Math.min(10, (u.reputation || 0) / 50);
    if (lim) score -= lim.level === "restricted" ? 40 : 25;
    score -= Math.min(30, openFlags * 15);
    return {
      ageDays: age,
      newAccount: age < opt.newDays(),
      newAccountDays: opt.newDays(),
      phone: phone ? { verified: true, hint: "•••• " + phone.phone_hint, at: phone.verified_at } : { verified: false },
      pi: { enabled: !!config.piEnabled, status: pi?.status || null },
      twoFactor: !!tfa?.enabled,
      verified: u.verified || null,
      limit: lim ? { level: lim.level, text: LIMIT_TEXT[lim.level], since: lim.created_at, ...(forStaff ? { reason: lim.reason, flag: lim.flag_id } : {}) } : null,
      hiddenFollowers: hidden,
      score: Math.max(0, Math.min(100, Math.round(score))),
      ...(forStaff ? { openFlags, status: u.status } : {})
    };
  }

  /* ---------- 7. badges ---------- */
  async function badges(ids) {
    const out = {};
    for (const uid of ids)
      out[uid] = await ctx.cache.wrap("ibadge:" + uid, 60e3, async () => {
        const u = await db.get("SELECT created_at FROM users WHERE id=$1 AND status='active'", [uid]);
        if (!u) return null;
        const age = ageDays(u.created_at);
        const signals = [];
        if (await db.get("SELECT 1 x FROM phone_verifications WHERE user_id=$1", [uid])) signals.push("phone");
        if ((await db.get("SELECT status FROM pi_kyc WHERE user_id=$1", [uid]))?.status === "verified") signals.push("pi");
        return { newAccount: age < opt.newDays(), ageDays: age, joinedAt: u.created_at, signals };
      });
    return out;
  }

  /* ---------- 1. coordinated networks ---------- */
  async function scanNetworks({ sinceMs = DAY, minSize = 3 } = {}) {
    const since = new Date(Date.now() - sinceMs).toISOString();
    const g = new G.WGraph();
    const ev = { content: [], bursts: [] };
    // content: near-duplicate posts and comments from different accounts
    const texts = [
      ...(await db.all("SELECT id, author, text FROM posts WHERE created_at > $1 AND status='published' ORDER BY created_at DESC LIMIT 3000", [since])),
      ...(await db.all("SELECT id, author, text FROM comments WHERE created_at > $1 AND status='published' ORDER BY created_at DESC LIMIT 3000", [since]))
    ].filter(r => normText(r.text).length >= 20);
    const groups = nearDuplicateGroups(texts.map(r => ({ id: r.id, actor: r.author, hash: simhash(r.text), text: r.text })));
    const contentGroupsOf = new Map();
    for (const grp of groups) {
      const actors = [...new Set(grp.map(x => x.actor))];
      for (const [k, n] of G.coOccurrence([actors])) {
        const [a, b] = k.split("|");
        g.addEdge(a, b, 2 * n, "content");
      }
      for (const a of actors) contentGroupsOf.set(a, (contentGroupsOf.get(a) || 0) + 1);
      ev.content.push({ items: grp.slice(0, 5).map(x => x.id), actors, sample: String(grp[0].text).slice(0, 140) });
    }
    // timing: the same accounts repeatedly acting on the same target within two minutes
    const events = [
      ...(await db.all("SELECT src actor, dst k, at FROM follows WHERE at > $1 LIMIT 20000", [since])).map(r => ({ key: "f:" + r.k, actor: r.actor, at: Date.parse(r.at) })),
      ...(await db.all("SELECT user_id actor, target k, at FROM reactions WHERE at > $1 LIMIT 20000", [since])).map(r => ({ key: "r:" + r.k, actor: r.actor, at: Date.parse(r.at) })),
      ...(await db.all("SELECT author actor, post k, created_at at FROM comments WHERE created_at > $1 LIMIT 20000", [since])).map(r => ({ key: "c:" + r.k, actor: r.actor, at: Date.parse(r.at) }))
    ];
    const bs = bursts(events, { windowMs: 120e3, minActors: 4 });
    const co = G.coOccurrence(bs.map(b => b.actors));
    for (const [k, n] of co)
      if (n >= 2) {
        const [a, b] = k.split("|");
        g.addEdge(a, b, n, "timing");
      }
    ev.bursts = bs.filter(b => b.actors.some(a => g.adj.has(a))).slice(0, 30).map(b => ({ key: b.key, actors: b.actors.length, at: new Date(b.start).toISOString(), seconds: Math.round((b.end - b.start) / 1000) }));
    // shared devices (strong) and shared fingerprints on the same network (weak)
    for (const r of await db.all("SELECT a.user_id x, b.user_id y FROM device_signals a JOIN device_signals b ON a.kind=b.kind AND a.hash=b.hash AND a.user_id < b.user_id WHERE a.kind='did' LIMIT 5000")) g.addEdge(r.x, r.y, 3, "device");
    for (const r of await db.all("SELECT DISTINCT a.user_id x, b.user_id y FROM device_signals a JOIN device_signals b ON a.kind='fp' AND b.kind='fp' AND a.hash=b.hash AND a.user_id < b.user_id JOIN known_devices k1 ON k1.user_id=a.user_id JOIN known_devices k2 ON k2.user_id=b.user_id AND k2.fingerprint=k1.fingerprint LIMIT 5000")) g.addEdge(r.x, r.y, 1, "device");
    const flags = [];
    for (const comp of G.components(g, 2)) {
      if (comp.length < minSize) continue;
      const S = new Set(comp),
        kinds = { content: 0, timing: 0, device: 0 };
      for (const [a, b, , k] of g.edges()) if (S.has(a) && S.has(b)) for (const kk in k) kinds[kk] = (kinds[kk] || 0) + k[kk];
      const cg = ev.content.filter(c => c.actors.filter(a => S.has(a)).length >= 2);
      const sc = Math.min(0.8, 0.25 * cg.length),
        st = Math.min(0.7, 0.04 * kinds.timing),
        sd = Math.min(0.8, (0.4 * kinds.device) / 3 / Math.max(1, comp.length - 1));
      const score = Math.round((1 - (1 - sc) * (1 - st) * (1 - sd)) * 100) / 100;
      if (score < 0.3) continue;
      const reasons = [cg.length ? `محتوى متطابق تقريباً (${cg.length})` : "", kinds.timing ? "تفاعل متزامن متكرر" : "", kinds.device ? "إشارات جهاز مشتركة" : ""].filter(Boolean).join("، ");
      const evidence = { signals: kinds, content: cg.slice(0, 5).map(c => ({ items: c.items, sample: c.sample, accounts: c.actors.length })), bursts: ev.bursts.filter(b => b.actors >= 4).slice(0, 10) };
      flags.push({ ...(await upsertFlag("network", comp, score, reasons, evidence)), size: comp.length, score });
    }
    return { scanned: { texts: texts.length, events: events.length, bursts: bs.length }, flags };
  }

  /* ---------- 5. relationship graph ---------- */
  async function interactionGraph(nodeIds, { sinceMs = 90 * DAY } = {}) {
    const ids = [...new Set(nodeIds)].slice(0, 400);
    const g = new G.WGraph();
    ids.forEach(n => g.addNode(n));
    if (ids.length < 2) return { g, directed: [] };
    const IN = ids.map((_, i) => "$" + (i + 1)).join(",");
    const directed = (await db.all(`SELECT src, dst FROM follows WHERE src IN (${IN}) AND dst IN (${IN})`, ids)).map(r => [r.src, r.dst]);
    for (const [s, d] of directed) g.addEdge(s, d, 1, "follow");
    const since = new Date(Date.now() - sinceMs).toISOString();
    for (const r of await db.all(`SELECT r.user_id s, p.author d, COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.target WHERE r.user_id IN (${IN}) AND p.author IN (${IN}) AND r.user_id<>p.author AND r.at > $${ids.length + 1} GROUP BY r.user_id, p.author`, [...ids, since])) g.addEdge(r.s, r.d, Math.min(3, 0.5 * r.n), "reaction");
    for (const r of await db.all(`SELECT c.author s, p.author d, COUNT(*) n FROM comments c JOIN posts p ON p.id=c.post WHERE c.author IN (${IN}) AND p.author IN (${IN}) AND c.author<>p.author AND c.created_at > $${ids.length + 1} GROUP BY c.author, p.author`, [...ids, since])) g.addEdge(r.s, r.d, Math.min(3, 0.5 * r.n), "comment");
    return { g, directed };
  }
  async function neighborhood(uid, { limit = 120 } = {}) {
    const near = (await db.all("SELECT dst x FROM follows WHERE src=$1 UNION SELECT src x FROM follows WHERE dst=$1", [uid])).map(r => r.x).slice(0, limit);
    const { g, directed } = await interactionGraph([uid, ...near]);
    const clusters = G.labelPropagation(g).filter(c => c.length >= 2);
    const suspicious = G.suspiciousClusters(g, directed, { minSize: 4 });
    const ids = g.nodes();
    const users = ids.length ? await db.all(`SELECT u.id, u.name, u.handle, u.avatar, u.color, u.created_at, u.status, l.level FROM users u LEFT JOIN integrity_limits l ON l.user_id=u.id WHERE u.id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const cl = new Map();
    clusters.forEach((c, i) => c.forEach(n => cl.set(n, i)));
    const flagged = await flaggedUsers();
    return {
      center: uid,
      nodes: users.map(u => ({ id: u.id, name: u.name, handle: u.handle, avatar: J(u.avatar), color: u.color, ageDays: ageDays(u.created_at), status: u.status, limit: u.level || null, flagged: flagged.has(u.id), cluster: cl.has(u.id) ? cl.get(u.id) : null })),
      edges: g.edges().map(([a, b, w, k]) => ({ a, b, w: Math.round(w * 100) / 100, kinds: Object.keys(k) })),
      follows: directed.length,
      clusters: clusters.map(c => ({ size: c.length, density: Math.round(G.density(c, directed) * 100) / 100, conductance: Math.round(G.conductance(g, c) * 100) / 100 })),
      suspicious
    };
  }
  /** dense clusters among recently active / recently created accounts */
  async function scanDensity({ days = 30 } = {}) {
    const since = new Date(Date.now() - days * DAY).toISOString();
    const ids = (await db.all("SELECT id FROM users WHERE created_at > $1 UNION SELECT src FROM follows WHERE at > $1", [since])).map(r => r.id).slice(0, 400);
    const { g, directed } = await interactionGraph(ids);
    const flags = [];
    for (const c of G.suspiciousClusters(g, directed, { minSize: 4, minDensity: 0.5 }))
      if (c.score >= 0.6) flags.push({ ...(await upsertFlag("cluster", c.members, c.score, `مجموعة مغلقة كثيفة (${c.size} حسابات، كثافة ${Math.round(c.density * 100)}٪)`, { density: c.density, reciprocity: c.reciprocity, conductance: c.conductance })), size: c.size });
    return { nodes: ids.length, flags };
  }

  /* ---------- 6. fake-follower cleanup ---------- */
  async function features(uid, flagged) {
    const u = await db.get("SELECT id, created_at, avatar, bio, status, verified FROM users WHERE id=$1", [uid]);
    if (!u) return null;
    const one = async (sql) => (await db.get(sql, [uid])).n;
    return {
      ageDays: ageDays(u.created_at),
      posts: await one("SELECT COUNT(*) n FROM posts WHERE author=$1 AND status='published'"),
      comments: await one("SELECT COUNT(*) n FROM comments WHERE author=$1"),
      followers: await one("SELECT COUNT(*) n FROM follows WHERE dst=$1"),
      following: await one("SELECT COUNT(*) n FROM follows WHERE src=$1"),
      hasAvatar: !!u.avatar,
      hasBio: (u.bio || "").length > 0,
      suspended: u.status !== "active",
      verified: !!u.verified,
      limited: !!(await limitOf(uid)),
      flagged: flagged.has(uid),
      phoneVerified: !!(await db.get("SELECT 1 x FROM phone_verifications WHERE user_id=$1", [uid])),
      piVerified: (await db.get("SELECT status FROM pi_kyc WHERE user_id=$1", [uid]))?.status === "verified"
    };
  }
  async function cleanupFakeFollowers({ days = 30, max = 3000 } = {}) {
    const since = new Date(Date.now() - days * DAY).toISOString();
    const flagged = await flaggedUsers();
    const cand = new Set((await db.all("SELECT DISTINCT src id FROM follows WHERE at > $1 LIMIT $2", [since, max])).map(r => r.id));
    for (const r of await db.all("SELECT user_id id FROM integrity_limits")) cand.add(r.id);
    for (const r of await db.all("SELECT DISTINCT src id FROM follower_flags WHERE status='hidden'")) cand.add(r.id);
    for (const r of await db.all("SELECT id FROM users WHERE status<>'active'")) cand.add(r.id);
    flagged.forEach(m => cand.add(m));
    const th = opt.fakeThreshold();
    let hidden = 0,
      restored = 0,
      scanned = 0;
    for (const uid of [...cand].slice(0, max)) {
      const f = await features(uid, flagged);
      if (!f) continue;
      scanned++;
      const score = fakeFollowerScore(f);
      if (score >= th) {
        const reason = [f.suspended && "حساب موقوف", f.ageDays < 7 && "حساب حديث جداً", !f.posts && !f.comments && "بلا أي نشاط", f.following >= 100 && f.followers * 10 < f.following && "يتابع بكثافة دون متابعين", f.limited && "تحت قيود", f.flagged && "ضمن شبكة مشبوهة"].filter(Boolean).join("، ");
        for (const r of await db.all("SELECT dst FROM follows WHERE src=$1", [uid])) {
          const x = await db.run("INSERT INTO follower_flags(src,dst,score,reason,status,flagged_at) VALUES($1,$2,$3,$4,'hidden',$5) ON CONFLICT (src,dst) DO UPDATE SET status='hidden', score=$3, reason=$4, flagged_at=$5, restored_at=NULL, restored_by=NULL WHERE follower_flags.status='restored' AND follower_flags.restored_by='system'", [uid, r.dst, score, reason, now()]);
          hidden += x.changes;
        }
      } else {
        const x = await db.run("UPDATE follower_flags SET status='restored', restored_at=$1, restored_by='system' WHERE src=$2 AND status='hidden'", [now(), uid]);
        restored += x.changes;
      }
    }
    if (hidden || restored) {
      await ctx.audit("fake_followers_cleanup", null, `hidden ${hidden}, restored ${restored}`, "system");
      ctx.cache.del("card:");
    }
    return { scanned, hidden, restored, threshold: th };
  }
  async function hiddenFollowerCount(uid) {
    return (await db.get("SELECT COUNT(*) n FROM follower_flags ff JOIN follows f ON f.src=ff.src AND f.dst=ff.dst WHERE ff.dst=$1 AND ff.status='hidden'", [uid])).n;
  }
  /** follower count that public surfaces should show (fake followers soft-hidden) */
  async function visibleFollowerCount(uid) {
    return (await db.get("SELECT COUNT(*) n FROM follows f WHERE f.dst=$1 AND NOT EXISTS (SELECT 1 FROM follower_flags ff WHERE ff.src=f.src AND ff.dst=f.dst AND ff.status='hidden')", [uid])).n;
  }
  bus.on("USER_FOLLOWED", async e => {
    if (!e?.from || !e?.to) return;
    const fake = await db.get("SELECT score, reason FROM follower_flags WHERE src=$1 AND status='hidden' LIMIT 1", [e.from]);
    if (fake) await db.run("INSERT INTO follower_flags(src,dst,score,reason,status,flagged_at) VALUES($1,$2,$3,$4,'hidden',$5) ON CONFLICT DO NOTHING", [e.from, e.to, fake.score, fake.reason, now()]);
  });

  /* ---------- routes: members ---------- */
  R.get("/api/integrity/me", A(async req => trustSignals(req.user.id)));
  R.post("/api/integrity/device", A(async req => {
    if (!hit("dev:" + req.user.id, 20, 3600e3)) throw E.rate();
    const r = await recordDevice(req.user, req.body || {}, req);
    return { ok: true, limited: r.limited };
  }));
  R.post("/api/integrity/phone/start", A(async req => phoneStart(req.user, str(req.body.phone, 32, { required: true }))));
  R.post("/api/integrity/phone/verify", A(async req => phoneVerify(req.user, req.body.code)));
  R.del("/api/integrity/phone", A(async req => {
    await db.run("DELETE FROM phone_verifications WHERE user_id=$1", [req.user.id]);
    await db.run("DELETE FROM phone_otps WHERE user_id=$1", [req.user.id]);
    ctx.cache.del("ibadge:" + req.user.id);
    await ctx.audit("phone_removed", req.user.id, null, req.user.id);
    return { verified: false };
  }));
  R.post("/api/integrity/pi-kyc", A(async req => piKyc(req.user, str(req.body.accessToken, 2000, { required: true }))));
  R.get("/api/integrity/badges", async req => {
    let ids = String(req.query.ids || "").split(",").map(s => s.trim()).filter(s => /^[A-Za-z0-9_-]{1,40}$/.test(s));
    if (req.query.handle) {
      const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(req.query.handle)]);
      if (u) ids.push(u.id);
    }
    ids = [...new Set(ids)].slice(0, 50);
    return { badges: await badges(ids), newAccountDays: opt.newDays() };
  });

  /* ---------- routes: investigations (admin only) ---------- */
  const memberCards = async ids => {
    if (!ids.length) return [];
    const rows = await db.all(`SELECT u.id, u.name, u.handle, u.avatar, u.color, u.created_at, u.status, u.verified, l.level FROM users u LEFT JOIN integrity_limits l ON l.user_id=u.id WHERE u.id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids);
    return rows.map(u => ({ id: u.id, name: u.name, handle: u.handle, avatar: J(u.avatar), color: u.color, ageDays: ageDays(u.created_at), status: u.status, verified: u.verified || null, limit: u.level || null }));
  };
  const flagOut = async (f, full) => {
    const members = J(f.members) || [];
    return { id: f.id, kind: f.kind, score: f.score, reason: f.reason, status: f.status, size: members.length, createdAt: f.created_at, updatedAt: f.updated_at, decidedAt: f.decided_at, note: f.note, members: await memberCards(full ? members.slice(0, 200) : members.slice(0, 8)), evidence: full ? J(f.evidence) : undefined };
  };
  async function userIdOf(x) {
    const u = await db.get("SELECT id FROM users WHERE id=$1 OR LOWER(handle)=LOWER($1)", [String(x)]);
    if (!u) throw E.nf();
    return u.id;
  }
  R.get("/api/admin/integrity/overview", admin(async () => {
    const c = async (sql, p = []) => (await db.get(sql, p)).n;
    const byKind = await db.all("SELECT kind, COUNT(*) n FROM integrity_flags WHERE status='open' GROUP BY kind");
    const flags = await db.all("SELECT * FROM integrity_flags WHERE status='open' ORDER BY score DESC, created_at DESC LIMIT 50");
    return {
      stats: {
        openFlags: byKind.reduce((a, r) => a + r.n, 0),
        byKind: Object.fromEntries(byKind.map(r => [r.kind, r.n])),
        limited: await c("SELECT COUNT(*) n FROM integrity_limits"),
        hiddenFollowers: await c("SELECT COUNT(*) n FROM follower_flags WHERE status='hidden'"),
        phoneVerified: await c("SELECT COUNT(*) n FROM phone_verifications"),
        piVerified: await c("SELECT COUNT(*) n FROM pi_kyc WHERE status='verified'"),
        newAccounts7d: await c("SELECT COUNT(*) n FROM users WHERE created_at > $1", [new Date(Date.now() - 7 * DAY).toISOString()])
      },
      flags: await Promise.all(flags.map(f => flagOut(f, false))),
      jobs: { integrityScan: ctx.scheduler.state.integrityScan || null, fakeFollowerCleanup: ctx.scheduler.state.fakeFollowerCleanup || null },
      sms: opt.sms(),
      pi: !!config.piEnabled
    };
  }));
  R.get("/api/admin/integrity/flags", admin(async req => {
    const status = ["open", "confirmed", "dismissed"].includes(req.query.status) ? req.query.status : "open";
    return { flags: await Promise.all((await db.all("SELECT * FROM integrity_flags WHERE status=$1 ORDER BY score DESC, created_at DESC LIMIT 100", [status])).map(f => flagOut(f, false))) };
  }));
  R.get("/api/admin/integrity/flags/:id", admin(async req => {
    const f = await db.get("SELECT * FROM integrity_flags WHERE id=$1", [req.params.id]);
    if (!f) throw E.nf();
    const members = J(f.members) || [];
    const { g, directed } = await interactionGraph(members);
    return { flag: await flagOut(f, true), graph: { edges: g.edges().map(([a, b, w, k]) => ({ a, b, w: Math.round(w * 100) / 100, kinds: Object.keys(k) })), density: Math.round(G.density(members, directed) * 100) / 100, reciprocity: Math.round(G.reciprocity(members, directed) * 100) / 100 } };
  }));
  R.post("/api/admin/integrity/flags/:id", admin(async req => {
    const f = await db.get("SELECT * FROM integrity_flags WHERE id=$1", [req.params.id]);
    if (!f) throw E.nf();
    const d = req.body.decision;
    if (!["confirm", "dismiss", "reopen"].includes(d)) throw E.bad();
    const note = str(req.body.note, 300);
    const status = d === "confirm" ? "confirmed" : d === "dismiss" ? "dismissed" : "open";
    await db.run("UPDATE integrity_flags SET status=$1, decided_by=$2, decided_at=$3, note=$4 WHERE id=$5", [status, req.user.id, now(), note, f.id]);
    const members = J(f.members) || [];
    let changed = 0;
    if (d === "confirm") for (const m of members) changed += (await setLimit(m, "restricted", note || f.reason, { flagId: f.id, by: req.user.id })) ? 1 : 0;
    if (d === "dismiss") for (const m of members) if ((await limitOf(m))?.flag_id === f.id) changed += (await setLimit(m, "none", "flag_dismissed", { by: req.user.id })) ? 1 : 0;
    await ctx.audit("integrity_flag_" + status, f.id, note || f.reason, req.user.id);
    return { ok: true, state: status, changed };
  }));
  R.get("/api/admin/integrity/users/:id", admin(async req => {
    const uid = await userIdOf(req.params.id);
    const linked = await linkedAccounts(uid);
    const flags = (await db.all("SELECT * FROM integrity_flags ORDER BY created_at DESC LIMIT 500")).filter(f => (J(f.members) || []).includes(uid)).slice(0, 20);
    return {
      user: (await memberCards([uid]))[0],
      signals: await trustSignals(uid, { forStaff: true }),
      linked: (await memberCards([...linked.keys()])).map(u => ({ ...u, via: linked.get(u.id) })),
      flags: await Promise.all(flags.map(f => flagOut(f, false))),
      graph: await neighborhood(uid)
    };
  }));
  R.post("/api/admin/integrity/users/:id/limit", admin(async req => {
    const uid = await userIdOf(req.params.id);
    const level = ["none", "limited", "restricted"].includes(req.body.level) ? req.body.level : null;
    if (!level) throw E.bad();
    await setLimit(uid, level, str(req.body.reason, 300) || "staff", { by: req.user.id });
    return { ok: true, limit: (await limitOf(uid)) || null };
  }));
  R.get("/api/admin/integrity/followers", admin(async req => {
    const dst = req.query.user ? await userIdOf(req.query.user) : null;
    const rows = await db.all(`SELECT ff.*, a.name sn, a.handle sh, b.name dn, b.handle dh FROM follower_flags ff JOIN users a ON a.id=ff.src JOIN users b ON b.id=ff.dst WHERE ff.status='hidden'${dst ? " AND ff.dst=$1" : ""} ORDER BY ff.score DESC, ff.flagged_at DESC LIMIT 200`, dst ? [dst] : []);
    return { followers: rows.map(r => ({ src: { id: r.src, name: r.sn, handle: r.sh }, dst: { id: r.dst, name: r.dn, handle: r.dh }, score: r.score, reason: r.reason, at: r.flagged_at })) };
  }));
  R.post("/api/admin/integrity/followers/restore", admin(async req => {
    const src = str(req.body.src, 60, { required: true }),
      dst = str(req.body.dst, 60);
    const r = await db.run(`UPDATE follower_flags SET status='restored', restored_at=$1, restored_by=$2 WHERE src=$3 AND status='hidden'${dst ? " AND dst=$4" : ""}`, dst ? [now(), req.user.id, src, dst] : [now(), req.user.id, src]);
    await ctx.audit("fake_followers_restored", src, String(r.changes), req.user.id);
    ctx.cache.del("card:");
    return { restored: r.changes };
  }));
  R.post("/api/admin/integrity/scan", admin(async req => {
    const net = await scanNetworks({ sinceMs: Math.min(30, Math.max(1, +req.body.days || 1)) * DAY });
    const dens = await scanDensity();
    return { networks: net, clusters: dens };
  }));
  R.post("/api/admin/integrity/cleanup", admin(async () => cleanupFakeFollowers()));

  /* ---------- scheduled jobs (leased: one instance runs each) ---------- */
  ctx.scheduler.every("integrityScan", +(config.integrityScanMs || envNum("INTEGRITY_SCAN_MS", 30 * 60e3)), async () => ({ n: (await scanNetworks()).flags.length, c: (await scanDensity()).flags.length }));
  ctx.scheduler.every("fakeFollowerCleanup", +(config.fakeFollowerCleanupMs || envNum("FAKE_FOLLOWER_CLEANUP_MS", 6 * 3600e3)), () => cleanupFakeFollowers());

  return { guard, setLimit, limitOf, trustSignals, badges, recordDevice, linkedAccounts, scanNetworks, scanDensity, neighborhood, cleanupFakeFollowers, hiddenFollowerCount, visibleFollowerCount, smsOutbox: outbox, resetLimiter: () => windows.clear() };
};
Object.assign(module.exports, { normText, simhash, hamming, nearDuplicateGroups, bursts, e164, fakeFollowerScore, piKycStatus, LIMITS });
