/* Provider activation at zero cost (phase 52). One admin checklist «التفعيل» for everything that needs switching on:
 * Pi payments (phase 51 checklist, summarised), web push, email (SMTP) and machine translation.
 * 1. Push: the VAPID pair is generated and stored on first start (lib/providers.vapidPolicy, production included) — this
 *    service warms it at boot so /api/pwa/config reports push on at once. Env keys override; VAPID_ENV_ONLY=1 opts out.
 *    Admin test: the existing POST /api/push/test (sends to the admin's own devices).
 * 2. Email: SMTP_URL in the environment, or SMTP entered by an admin (form fields, no URL typing) and stored in
 *    provider_settings (password sealed, never returned). Saved settings hot-swap ctx.mailer (no restart). Test send to the
 *    admin's own verified address (or one typed), template previews, and GET /api/providers/status so screens fall back to
 *    in-app notifications when mail is off. No external account is ever created by the app.
 * 3. Translation: env keys (lib/translate.js), or an admin-stored provider: LibreTranslate URL (self-hosted / free instance),
 *    DeepL Free key (only keys ending ":fx" — the paid API is refused here), or any OpenAI-compatible endpoint (e.g. a
 *    self-hosted model; cost rates default to 0). Test button translates a sample before or after saving. Hot-swapped via
 *    translate.setProvider. Env always wins over stored settings.
 * 4. Unified checklist GET /api/admin/activation (+ phone-friendly steps), public GET /api/providers/status (booleans only). */
const crypto = require("node:crypto");
const { E, HttpError, str, now } = require("../lib/core");
const P = require("../lib/providers");
const T = require("../lib/translate");
const { secret } = require("../lib/secrets");
const { createMailer } = require("../lib/mailer");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FROM_RE = /^[^\r\n<>]{0,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}>$|^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, fetch?: typeof fetch }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx, R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const state = { push: { on: false, source: "none" }, email: { source: ctx.mailer?.enabled ? "env" : "none" }, translate: { source: "none" } };

  /* ---------- sealed settings ---------- */
  let keyP = null;
  const sealKey = () => keyP ||= (async () => {
    const k = secret("PROVIDER_SEAL_KEY"); if (k) return crypto.createHash("sha256").update(k).digest("base64url");
    let r = await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'");
    if (!r) { await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('provider_seal',$1,$2) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString("base64url"), now()]); r = await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'"); }
    return r.value;
  })().catch((e) => { keyP = null; throw e; });
  async function getStored(name) {
    const r = await db.get("SELECT value, updated_at FROM provider_settings WHERE name=$1", [name]).catch(() => null);
    if (!r) return null;
    try {
      const v = JSON.parse(r.value);
      if (v.secret) {
        const primary = await sealKey(), sealed = v.secret;
        v.secret = P.unseal(primary, sealed);
        if (v.secret === null) { // v2.68.1: sealed before PROVIDER_SEAL_KEY was set → unseal with the stored key, re-seal with the env key
          const prev = secret("PROVIDER_SEAL_KEY_PREVIOUS"), legacy = (await db.get("SELECT value FROM notify_keys WHERE name='provider_seal'"))?.value; // v2.78: rotation window
          v.secret = null;
          for (const k of [prev && crypto.createHash("sha256").update(prev).digest("base64url"), legacy]) if (v.secret === null && k && k !== primary) v.secret = P.unseal(k, sealed);
          if (v.secret !== null) { const { updatedAt: _u, ...keep } = v; await db.run("UPDATE provider_settings SET value=$1 WHERE name=$2", [JSON.stringify({ ...keep, secret: P.seal(primary, v.secret) }), name]); }
        }
      }
      return { ...v, updatedAt: r.updated_at };
    } catch { return null; }
  }
  async function putStored(name, v, by) {
    const out = { ...v }; if (out.secret) out.secret = P.seal(await sealKey(), out.secret);
    await db.run("INSERT INTO provider_settings(name,value,updated_by,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (name) DO UPDATE SET value=$2, updated_by=$3, updated_at=$4", [name, JSON.stringify(out), by, now()]);
    ctx.audit?.("provider_settings_saved", name, null, by);
  }
  async function delStored(name, by) { await db.run("DELETE FROM provider_settings WHERE name=$1", [name]); ctx.audit?.("provider_settings_cleared", name, null, by); }

  /* ======================= 1. push ======================= */
  async function warmPush() {
    try { const v = await ctx.services.notify.vapid(); state.push = { on: true, source: v.source }; }
    catch { state.push = { on: false, source: "none" }; }
    return state.push;
  }
  async function pushStatus() {
    const subs = Number((await db.get("SELECT COUNT(*) n FROM push_subscriptions").catch(() => ({ n: 0 })))?.n || 0);
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const rows = await db.all("SELECT status, COUNT(*) n FROM notify_deliveries WHERE channel='push' AND created_at > $1 GROUP BY status", [since]).catch(() => []);
    return { ...state.push, policy: P.vapidPolicy(env), subscriptions: subs, last7d: rows.map((r) => ({ status: r.status, n: Number(r.n) })) };
  }

  /* ======================= 2. email ======================= */
  const envSmtp = () => !!secret("SMTP_URL");
  async function applyEmail() {
    if (envSmtp()) { state.email.source = "env"; return; }
    const s = await getStored("smtp");
    if (!s?.secret) { if (ctx.mailer?.swap && ctx.mailer.source === "db") ctx.mailer.swap(createMailer(null)); state.email.source = "none"; return; }
    try { ctx.mailer.swap(createMailer(s.secret, s.from ? { from: s.from } : undefined), "db"); state.email.source = "db"; }
    catch (e) { logger.warn?.("stored SMTP settings invalid", { err: e.message }); state.email.source = "none"; }
  }
  async function emailStatus() {
    const s = envSmtp() ? null : await getStored("smtp");
    const dns = ctx.services.mail?.dnsStatus ? ctx.services.mail.dnsStatus() : {};
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const rows = await db.all("SELECT status, COUNT(*) n FROM email_log WHERE created_at > $1 GROUP BY status", [since]).catch(() => []);
    return { enabled: !!ctx.mailer?.enabled, source: ctx.mailer?.enabled ? (envSmtp() ? "env" : "db") : "none", from: ctx.mailer?.from || null, transport: ctx.mailer?.transport || null,
      stored: s ? { ...P.maskSmtp(s.secret), from: s.from || null, updatedAt: s.updatedAt } : null, envOverrides: envSmtp(),
      dkim: !!ctx.mailer?.dkim, publicOrigin: !!env.PUBLIC_ORIGIN, dns, last7d: rows.map((r) => ({ status: r.status, n: Number(r.n) })) };
  }
  async function saveEmail(user, b) {
    if (envSmtp()) throw fail(409, "env_overrides", "البريد مضبوط من متغير SMTP_URL في Railway؛ عدّله هناك");
    let url;
    try {
      const cur = await getStored("smtp");
      const keepPass = !b.pass && !b.url && cur?.secret ? decodeURIComponent(new URL(cur.secret).password || "") : null;
      url = P.smtpUrlFrom({ url: b.url, host: b.host, port: b.port, secure: !!b.secure, user: str(b.user, 200), pass: b.pass ? String(b.pass).slice(0, 300) : keepPass });
    } catch (e) { throw fail(400, "smtp_invalid", e.message === "smtp_port" ? "منفذ غير صالح" : "عنوان خادم SMTP غير صالح"); }
    const from = b.from ? String(b.from).trim() : "";
    if (from && !FROM_RE.test(from)) throw fail(400, "from_invalid", "عنوان المرسل غير صالح (مثال: مجتمع بلس <no-reply@example.com>)");
    await putStored("smtp", { secret: url, from: from || null }, user.id);
    await applyEmail();
    return emailStatus();
  }
  async function clearEmail(user) { await delStored("smtp", user.id); await applyEmail(); return emailStatus(); }
  const lastTests = new Map();
  const throttle = (k, ms = 20e3, max = 1) => { const t = Date.now(), a = (lastTests.get(k) || []).filter((x) => t - x < ms); if (a.length >= max) throw fail(429, "slow_down", "انتظر قليلاً قبل تجربة جديدة"); a.push(t); lastTests.set(k, a); };
  async function testEmail(user, b) {
    if (!ctx.mailer?.enabled) throw fail(409, "not_configured", "البريد غير مفعّل بعد؛ احفظ إعدادات SMTP أولاً");
    throttle("email:" + user.id);
    const me = await db.get("SELECT email, email_verified_at, name FROM users WHERE id=$1", [user.id]);
    const to = String(b.to || me?.email || "").trim().toLowerCase();
    if (!EMAIL.test(to)) throw fail(400, "no_address", "اكتب عنوان بريد لتجربة الإرسال");
    const t = preview("test", { name: me?.name });
    const started = Date.now();
    try {
      const r = await ctx.mailer.send({ to, subject: t.subject, html: t.html, text: t.text });
      if (r?.skipped) throw new Error(r.skipped);
      return { ok: true, to, ms: Date.now() - started, messageId: r?.messageId || null };
    } catch (e) { return { ok: false, to, ms: Date.now() - started, error: String(e.message || e).replace(/\/\/[^@\s]*@/g, "//***@").slice(0, 200) }; }
  }
  /* templates: the real ones from lib/email-templates.js with sample data, plus the test message */
  const TPL = ["test", "verify", "reset", "security", "notification", "weekly"];
  function preview(name, o = {}) {
    const ET = require("../lib/email-templates"), origin = env.PUBLIC_ORIGIN || "https://example.app", nm = o.name || "صديقنا";
    if (name === "test") return { subject: "رسالة تجريبية من مجتمع بلس", html: ET.layout({ title: "البريد يعمل ✓", preheader: "إعدادات البريد صحيحة", body: `<p dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px">مرحباً ${ET.esc(nm)}، وصلتك هذه الرسالة لأن إعدادات البريد في مجتمع بلس تعمل بشكل صحيح.</p>`, origin }), text: `مرحباً ${nm}، إعدادات البريد في مجتمع بلس تعمل بشكل صحيح.` };
    if (name === "verify") return ET.verify({ name: nm, url: origin + "/api/email/verify?t=sample", origin });
    if (name === "reset") return ET.reset({ name: nm, url: origin + "/#/reset?t=sample", origin, ip: "0.0.0.0", device: "Pi Browser" });
    if (name === "security") return ET.security({ name: nm, kind: "login", detail: "Pi Browser", when: new Date().toISOString(), origin });
    if (name === "notification") return ET.notification({ name: nm, sentence: "أعجب أحمد بمنشورك", url: origin + "/#/notifications", origin, unsubscribeUrl: origin + "/api/email/unsubscribe?t=sample", prefsUrl: origin + "/#/emailprefs", kindLabel: "الإعجابات" });
    return ET.weekly({ name: nm, counts: { posts: 3, comments: 5, followers: 2 }, posts: [], label: "هذا الأسبوع", origin, unsubscribeUrl: origin + "/api/email/unsubscribe?t=sample", prefsUrl: origin + "/#/emailprefs" });
  }

  /* ======================= 3. translation ======================= */
  const envTranslate = () => P.TRANSLATE_ENV_KEYS.some((k) => !!env[k]);
  function buildTranslate(c) {
    return T.createProvider(P.translateEnv(c), { fetch: opts.fetch });
  }
  function validTranslate(b, cur) {
    const provider = String(b.provider || "").toLowerCase();
    if (!["libre", "deepl", "openai"].includes(provider)) throw fail(400, "provider_invalid", "اختر مزوداً: LibreTranslate أو DeepL Free أو خادم متوافق مع OpenAI");
    const keep = (k) => (b[k] === undefined || b[k] === "") && cur?.provider === provider ? cur[k] : b[k];
    const c = { provider };
    const url = (u) => { try { const x = new URL(String(u)); if (!["https:", "http:"].includes(x.protocol)) throw 0; return x.toString(); } catch { throw fail(400, "url_invalid", "رابط غير صالح"); } };
    if (provider === "libre") { c.url = url(b.url || cur?.url); if (!/\/translate\/?$/.test(new URL(c.url).pathname)) c.url = c.url.replace(/\/?$/, "/translate"); c.key = keep("key") ? String(keep("key")).slice(0, 300) : ""; c.private = !!b.private; }
    if (provider === "deepl") { c.key = String(keep("key") || "").trim().slice(0, 300); if (!/:fx$/.test(c.key)) throw fail(400, "deepl_paid", "يُقبل مفتاح DeepL API Free فقط (ينتهي بـ :fx) — الخطة المدفوعة غير مسموحة"); }
    if (provider === "openai") { c.key = String(keep("key") || "").trim().slice(0, 300); if (!c.key) throw fail(400, "key_required", "أدخل مفتاح الخادم"); c.baseUrl = b.baseUrl ? url(b.baseUrl).replace(/\/+$/, "") : cur?.baseUrl || ""; c.model = str(b.model, 100) || cur?.model || ""; }
    return c;
  }
  async function applyTranslate() {
    const ts = ctx.services.translate; if (!ts?.setProvider) return;
    if (envTranslate()) { state.translate.source = "env"; return; }
    const s = await getStored("translate");
    if (!s) { if (state.translate.source === "db") ts.setProvider(null); state.translate.source = "none"; return; }
    const c = { ...s, key: s.secret || "" }; const p = buildTranslate(c);
    ts.setProvider(p); state.translate.source = p ? "db" : "none";
  }
  async function translateStatus() {
    const st = ctx.services.translate?.status ? ctx.services.translate.status() : { available: false };
    const s = envTranslate() ? null : await getStored("translate");
    return { ...st, source: st.available ? (envTranslate() ? "env" : "db") : "none", envOverrides: envTranslate(),
      stored: s ? { provider: s.provider, url: s.url || null, baseUrl: s.baseUrl || null, model: s.model || null, private: !!s.private, keySet: !!s.secret, updatedAt: s.updatedAt } : null };
  }
  async function saveTranslate(user, b) {
    if (envTranslate()) throw fail(409, "env_overrides", "الترجمة مضبوطة من متغيرات Railway؛ عدّلها هناك");
    const cur = await getStored("translate"); const c = validTranslate(b, cur ? { ...cur, key: cur.secret } : null);
    const { key, ...rest } = c;
    await putStored("translate", { ...rest, secret: key || null }, user.id);
    await applyTranslate();
    return translateStatus();
  }
  async function clearTranslate(user) { await delStored("translate", user.id); await applyTranslate(); return translateStatus(); }
  async function testTranslate(user, b) {
    let p;
    if (b.provider) { const cur = await getStored("translate"); p = buildTranslate(validTranslate(b, cur ? { ...cur, key: cur.secret } : null)); }
    else { const st = ctx.services.translate?.status?.(); if (!st?.available) throw fail(409, "not_configured", "الترجمة غير مفعّلة بعد"); p = null; }
    throttle("tr:" + user.id, 60e3, 10);
    const text = str(b.text, 500) || "مرحباً بكم في مجتمع بلس", target = T.LANGS.includes(b.target) ? b.target : "en";
    const started = Date.now();
    try {
      const out = p ? await p.translate(text, target, null) : await ctx.services.translate.providerTranslate(text, target);
      return { ok: true, provider: p ? p.name : ctx.services.translate.status().provider, text: out.text, target, ms: Date.now() - started };
    } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200), ms: Date.now() - started }; }
  }

  /* ======================= 4. unified checklist ======================= */
  async function checklist(req) {
    const items = [];
    const add = (group, key, ok, label, fix, blocks = true, extra = {}) => items.push({ group, key, ok: !!ok, blocks: !!blocks, label, ...(ok ? {} : { fix }), ...extra });
    // Pi (phase 51 summary)
    let pi = null; try { pi = await ctx.services.piActivation?.checklist(req); } catch { /* optional */ }
    if (pi) {
      add("pi", "pi_payments", pi.paymentsReady, `مدفوعات Pi — ${pi.modeLabel}`, "افتح صفحة تفعيل Pi لرؤية البنود الناقصة.", true, { link: "#/admin/pi-activation", missing: pi.missing.filter((k) => pi.items.find((i) => i.key === k)?.group === "payments") });
      add("pi", "pi_directory", pi.directoryReady, "متطلبات دليل تطبيقات Pi", "افتح صفحة تفعيل Pi.", false, { link: "#/admin/pi-activation" });
    }
    const ps = await pushStatus();
    add("push", "vapid", ps.on, "مفاتيح VAPID لإشعارات Push", ps.policy === "env-only" ? "أزل VAPID_ENV_ONLY=1 ليولّد الخادم المفاتيح تلقائياً، أو أضف VAPID_PUBLIC_KEY و VAPID_PRIVATE_KEY." : "أعد تشغيل الخدمة؛ تُولَّد المفاتيح تلقائياً عند البدء.", true, { value: ps.source });
    add("push", "push_devices", ps.subscriptions > 0, "جهاز مشترك واحد على الأقل", "افتح الإعدادات ← الإشعارات على جوالك وفعّل «إشعارات الجهاز»، ثم اضغط «إشعار تجريبي».", false, { value: ps.subscriptions });
    const es = await emailStatus();
    add("email", "smtp", es.enabled, "خادم بريد SMTP", "أدخل بيانات SMTP لحساب بريد تملكه (Gmail بكلمة مرور تطبيق، Zoho، Brevo…) في نموذج البريد أدناه. لا ينشئ التطبيق أي حساب بنفسه.", false, { value: es.source });
    add("email", "public_origin", es.publicOrigin, "رابط الموقع العام لروابط البريد (PUBLIC_ORIGIN)", "أضف PUBLIC_ORIGIN=https://mjt.up.railway.app في Railway لتكون روابط الرسائل صحيحة.", false);
    add("email", "dkim", es.dkim, "توقيع DKIM (اختياري)", "اختياري: يحسّن وصول الرسائل عند استخدام نطاقك الخاص.", false);
    add("email", "fallback", true, "بديل داخل التطبيق عند توقف البريد", "", false);
    const ts = await translateStatus();
    add("translate", "provider", ts.available, "مزود الترجمة الآلية", "اختر LibreTranslate (رابط خادم مجاني أو مستضاف ذاتياً) أو مفتاح DeepL API Free أو خادماً متوافقاً مع OpenAI في نموذج الترجمة أدناه.", false, { value: ts.provider });
    add("translate", "private", !ts.available || ts.private, "مزود خاص لترجمة الرسائل", "الرسائل الخاصة لا تُرسل إلى خادم LibreTranslate عام بلا مفتاح؛ فعّل «خادم خاص» فقط إن كان الخادم لك.", false);
    let price = false; try { price = !!(await db.get("SELECT 1 x FROM ai_plans WHERE active=1 AND price > 0 LIMIT 1")); } catch { /* table/column may differ */ }
    add("translate", "plan_price", price, "سعر اشتراك «مجتمع+ ذكاء»", "حدّد سعر الخطة من #/admin/ai (الترجمة متاحة للمشتركين).", false, { link: "#/admin/ai" });
    const MAIN = { pi: "pi_payments", push: "vapid", email: "smtp", translate: "provider" };
    const groups = Object.entries(MAIN).map(([g, k]) => ({ id: g, ready: !!items.find((i) => i.key === k)?.ok }));
    return {
      groups, items, checkedAt: new Date().toISOString(),
      active: { pi: !!pi?.paymentsReady, push: ps.on, email: es.enabled, translate: ts.available },
      steps: {
        push: ["لا يحتاج أي إعداد: المفاتيح تُولّد تلقائياً وتُحفظ في قاعدة البيانات.", "من جوالك: الإعدادات ← الإشعارات ← فعّل إشعارات الجهاز ← «إشعار تجريبي». على iPhone أضف التطبيق للشاشة الرئيسية أولاً (iOS 16.4+)."],
        email: ["أنشئ أنت (لا التطبيق) كلمة مرور تطبيق لبريد تملكه، مثلاً Gmail: myaccount.google.com ← الأمان ← التحقق بخطوتين ← كلمات مرور التطبيقات.", "في هذه الصفحة ← البريد: الخادم smtp.gmail.com، المنفذ 465، المستخدم بريدك، كلمة المرور = كلمة مرور التطبيق، ثم «حفظ».", "اضغط «إرسال رسالة تجريبية» وتأكد من وصولها.", "(اختياري) أضف PUBLIC_ORIGIN في Railway."],
        translate: ["الخيار المجاني الأسهل: DeepL API Free (deepl.com/pro-api ← Free؛ قد يطلب الموقع بطاقة للتحقق دون خصم) ← انسخ المفتاح المنتهي بـ :fx.", "أو رابط خادم LibreTranslate تستضيفه أنت.", "في هذه الصفحة ← الترجمة: اختر المزود والصق المفتاح/الرابط ← «تجربة» ثم «حفظ».", "حدّد سعر «مجتمع+ ذكاء» من #/admin/ai لتصل الترجمة للمشتركين."]
      }
    };
  }
  const publicStatus = async () => ({ push: state.push.on, email: !!ctx.mailer?.enabled, translate: !!ctx.services.translate?.status?.().available, fallback: ctx.mailer?.enabled ? null : "inapp",
    note: ctx.mailer?.enabled ? null : "البريد غير مفعّل حالياً؛ تصلك كل الإشعارات داخل التطبيق" });

  /* ---------- boot ---------- */
  const ready = (async () => { await warmPush(); await applyEmail().catch(() => { }); await applyTranslate().catch(() => { }); })().catch(() => { });

  /* ---------- routes ---------- */
  R.get("/api/providers/status", async () => { await ready; return publicStatus(); });
  R.get("/api/admin/activation", admin(async (req) => { await ready; return checklist(req); }));
  R.get("/api/admin/activation/push", admin(async () => pushStatus()));
  R.get("/api/admin/activation/email", admin(async () => ({ ...(await emailStatus()), templates: TPL })));
  R.put("/api/admin/activation/email", admin(async (req) => saveEmail(req.user, req.body || {})));
  R.del("/api/admin/activation/email", admin(async (req) => clearEmail(req.user)));
  R.post("/api/admin/activation/email/test", admin(async (req) => testEmail(req.user, req.body || {})));
  R.get("/api/admin/activation/email/preview/:tpl", admin(async (req) => { if (!TPL.includes(req.params.tpl)) throw E.nf(); const t = preview(req.params.tpl, { name: req.user.name }); return { template: req.params.tpl, subject: t.subject, html: t.html, text: t.text }; }));
  R.get("/api/admin/activation/translate", admin(async () => translateStatus()));
  R.put("/api/admin/activation/translate", admin(async (req) => saveTranslate(req.user, req.body || {})));
  R.del("/api/admin/activation/translate", admin(async (req) => clearTranslate(req.user)));
  R.post("/api/admin/activation/translate/test", admin(async (req) => testTranslate(req.user, req.body || {})));

  return { checklist, publicStatus, pushStatus, emailStatus, translateStatus, ready, state: () => state, applyEmail, applyTranslate };
};
