/* Pi payments activation readiness (phase 51). Makes switching Pi payments on a turnkey, checkable step.
 * 1. Checklist (GET /api/admin/pi/activation): every requirement for payments (PI_ENABLED, PI_API_KEY presence — never its
 *    value, network Testnet/Mainnet with PI_MAINNET_CONFIRM, app wallet address, validation file, HTTPS domain, purposes) and
 *    for the Pi App Directory (privacy policy, terms, app name/description/icons, about page, help center, Pi frame-ancestors,
 *    minors policy), each with ok/missing, whether it blocks, and the exact fix in Arabic.
 * 2. Startup self-check: one log line at boot naming what is missing (never blocks start-up, never logs secrets).
 * 3. Live key probe (POST /api/admin/pi/activation/probe): asks Pi for a payment id that cannot exist (404 = key accepted).
 * 4. Dry run (POST /api/admin/pi/dryrun): runs the REAL Pi service code (services/pi.js) against an in-memory SQLite database
 *    and a simulated Pi Platform API — happy path, incomplete-payment recovery, cancel, unverified txid kept pending, amount
 *    tamper and owner mismatch. Nothing touches the network or the production database; works while payments are off.
 * 5. Incomplete-payment recovery on sign-in (POST /api/pi/recover): the signed-in user's own stuck payments (created/approved
 *    with a Pi payment id, older than a minute) are re-checked with Pi via pi.incomplete(); 501 while payments are off.
 * 6. Domain validation key: PI_VALIDATION_KEY (Developer Portal) is served at /validation-key.txt; the App Studio file
 *    /pi-app-validation.txt stays a static file.
 * 7. Readiness summary for the status page (GET /api/pi/readiness): mode + counts only, no details. */
const fs = require("node:fs"), path = require("node:path");
const { E } = require("../lib/core");

const WALLET_RE = /^G[A-Z2-7]{55}$/;
const MODE_AR = { off: "مدفوعات Pi متوقفة", sandbox: "Testnet (وضع Sandbox للتجربة)", testnet: "Testnet", mainnet: "Mainnet (أموال حقيقية)" };

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, webRoot?: string, fetch?: any }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db } = ctx, R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const pis = () => ctx.services.pi;
  const roots = () => [opts.webRoot || ctx.config?.webRoot, path.join(__dirname, "..", ".."), path.join(__dirname, "..", "..", "public")].filter(Boolean);
  const findFile = (name) => { for (const r of roots()) { const f = path.join(r, name); try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } } return null; };
  const readJson = (name) => { const f = findFile(name); if (!f) return null; try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
  const validationKey = env.PI_VALIDATION_KEY ? String(env.PI_VALIDATION_KEY).trim().slice(0, 300) : null;

  function modeOf(d) { if (!d.enabled || !d.apiKeyPresent) return "off"; if (d.network === "mainnet") return "mainnet"; return d.sandbox ? "sandbox" : "testnet"; }
  function hostOf(req) {
    const pub = env.PUBLIC_URL || env.APP_URL || "";
    if (pub) { try { const u = new URL(pub); return { host: u.host, https: u.protocol === "https:", source: "PUBLIC_URL" }; } catch { /* fall through */ } }
    if (!req) return { host: null, https: false, source: "none" };
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || (req.socket?.encrypted ? "https" : "http");
    return { host: host || null, https: proto === "https", source: "request" };
  }

  /* ======================= 1. checklist ======================= */
  async function checklist(req) {
    const d = pis()?.diag ? pis().diag() : { enabled: false, apiKeyPresent: false, network: "testnet", sandbox: true, mainnetAsked: false, mainnetConfirmed: false, appId: null, purposes: [] };
    const mode = modeOf(d), wallet = env.PI_WALLET_ADDRESS ? String(env.PI_WALLET_ADDRESS).trim() : "";
    const dom = hostOf(req), local = !dom.host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(dom.host);
    const vfile = findFile("pi-app-validation.txt");
    const items = [];
    const add = (group, key, ok, label, fix, blocks = true, extra = {}) => items.push({ group, key, ok: !!ok, blocks: !!blocks, label, ...(ok ? {} : { fix }), ...extra });
    // payments
    add("payments", "pi_enabled", d.enabled, "تشغيل المدفوعات (PI_ENABLED=1)", "أضف المتغير PI_ENABLED بالقيمة 1 في Railway ← الخدمة web ← Variables.");
    add("payments", "api_key", d.apiKeyPresent, "مفتاح Pi API للخادم (PI_API_KEY)", "انسخ «API Key» من Pi Developer Portal (develop.pi في متصفح Pi ← تطبيقك) وضعه في المتغير PI_API_KEY. لا ترسله في المحادثة.");
    add("payments", "network", !(d.mainnetAsked && !d.mainnetConfirmed), `الشبكة: ${d.network === "mainnet" ? "Mainnet" : "Testnet"}${d.sandbox && d.network !== "mainnet" ? " (Sandbox)" : ""}`,
      "طلبت Mainnet لكن ينقص PI_MAINNET_CONFIRM=1؛ الخادم باقٍ على Testnet حتى تضيفه.", true, { value: d.network });
    add("payments", "wallet", WALLET_RE.test(wallet), "عنوان محفظة التطبيق (PI_WALLET_ADDRESS)", wallet ? "العنوان غير صالح: يبدأ بحرف G وطوله 56 حرفاً." : "انسخ العنوان العام لمحفظة التطبيق من Developer Portal ← App Wallet وضعه في PI_WALLET_ADDRESS (العنوان العام فقط، ليس العبارة السرية).", d.network === "mainnet");
    add("payments", "app_id", !!d.appId, "معرّف التطبيق (PI_APP_ID)", "اختياري: اسم/معرّف التطبيق كما في Developer Portal.", false);
    add("payments", "validation", !!vfile || !!validationKey, "ملف التحقق من النطاق", "ضع مفتاح التحقق من Developer Portal في PI_VALIDATION_KEY (يُقدَّم على /validation-key.txt) أو أبقِ /pi-app-validation.txt.", true, { files: [vfile ? "/pi-app-validation.txt" : null, validationKey ? "/validation-key.txt" : null].filter(Boolean) });
    add("payments", "domain", dom.https && !local, `النطاق عبر HTTPS${dom.host ? ": " + dom.host : ""}`, "يجب أن يعمل التطبيق على نطاق عام عبر HTTPS ويطابق «App URL» في Developer Portal.", true, { value: dom.host });
    add("payments", "purposes", ["tip", "transfer", "test"].every((p) => d.purposes.includes(p)), "أغراض الدفع (tip/transfer/test…)", "أزل PI_PURPOSES أو أضف إليه tip,transfer,test.", false);
    // Pi App Directory
    let docs = [];
    try { docs = require("../lib/compliance-policies").documents(env); } catch { /* optional */ }
    const has = (slug) => docs.some((x) => x.slug === slug && (x.sections?.length || x.body || x.summary));
    add("directory", "privacy", has("privacy"), "سياسة الخصوصية (/legal/privacy)", "سياسة الخصوصية مطلوبة لدليل تطبيقات Pi.");
    add("directory", "terms", has("terms"), "شروط الاستخدام (/legal/terms)", "شروط الاستخدام مطلوبة لدليل تطبيقات Pi.");
    const man = readJson("manifest.json") || {};
    const icons = Array.isArray(man.icons) ? man.icons : [];
    add("directory", "app_name", !!(man.name && String(man.name).length >= 2), "اسم التطبيق", "أضف name في manifest.json.", true, { value: man.name || null });
    add("directory", "app_description", !!(man.description && String(man.description).length >= 10), "وصف التطبيق", "أضف وصفاً (10 أحرف على الأقل) في manifest.json.", true, { value: man.description || null });
    add("directory", "app_icon", icons.some((i) => /512/.test(String(i.sizes || ""))), "أيقونة 512×512", "أضف أيقونة 512×512 في manifest.json.");
    add("directory", "categories", Array.isArray(man.categories) && man.categories.length > 0, "تصنيف التطبيق", "أضف categories في manifest.json.", false);
    add("directory", "about", !!findFile("about.html"), "صفحة التعريف (/about)", "أضف صفحة تعريف عامة.", false);
    let help = 0; try { help = Number((await db.get("SELECT COUNT(*) n FROM help_articles WHERE status='published'"))?.n || 0); } catch { /* no table */ }
    add("directory", "support", help > 0, "مركز المساعدة والدعم", "انشر مقالة واحدة على الأقل في مركز المساعدة (#/staff/help).", false, { value: help });
    let csp = ""; try { csp = String(require("../lib/http").buildCsp?.() || ""); } catch { /* optional */ }
    add("directory", "frame", !csp || /minepi\.com/.test(csp), "السماح بالفتح داخل متصفح Pi (frame-ancestors)", "أضف *.minepi.com إلى frame-ancestors.");
    add("directory", "minors", !!ctx.services.minors, "سياسة القُصّر (تُستثنى المدفوعات لمن دون 18)", "", false);
    const blocking = items.filter((i) => !i.ok && i.blocks);
    const payBlocking = blocking.filter((i) => i.group === "payments"), dirBlocking = blocking.filter((i) => i.group === "directory");
    return {
      mode, modeLabel: MODE_AR[mode], network: d.network, sandbox: d.sandbox, authEnabled: !!d.authEnabled,
      paymentsReady: payBlocking.length === 0, directoryReady: dirBlocking.length === 0,
      missing: blocking.map((i) => i.key), items, checkedAt: new Date().toISOString(),
      steps: [
        "افتح متصفح Pi ← develop.pi ← تطبيقك ← انسخ API Key.",
        "Railway (التطبيق على الجوال أو railway.com) ← المشروع mujtama-plus ← الخدمة web ← Variables ← أضف PI_API_KEY ثم PI_ENABLED=1.",
        "ابقَ على Testnet أولاً وجرّب دفعة 0.01 Pi من صفحة التفعيل؛ ثم للانتقال: PI_NETWORK=mainnet و PI_MAINNET_CONFIRM=1 و PI_WALLET_ADDRESS.",
        "يعيد Railway تشغيل الخدمة تلقائياً؛ افتح صفحة التفعيل للتأكد أن كل البنود خضراء."
      ]
    };
  }

  /* ======================= 2. startup self-check ======================= */
  setImmediate(() => checklist(null).then((c) => {
    const miss = c.items.filter((i) => !i.ok && i.blocks && i.key !== "domain").map((i) => i.key);
    if (c.mode === "off") logger.info?.("pi activation: payments off", { missing: miss });
    else if (miss.length) logger.warn?.("pi activation: payments on but checklist incomplete", { mode: c.mode, missing: miss });
    else logger.info?.("pi activation: ready", { mode: c.mode });
  }).catch(() => { }));

  /* ======================= 4. dry run (in-memory, simulated Pi) ======================= */
  async function dryRun() {
    let mem;
    try { mem = await require("../lib/db").connect("sqlite::memory:"); }
    catch (e) { return { ok: false, reason: "sqlite_unavailable", steps: [] }; }
    const started = Date.now(), steps = [];
    try {
      await require("../lib/schema").migrate(mem, { log: () => { } });
      const real = pis()?.diag ? pis().diag() : { network: "testnet" };
      const NETNAME = real.network === "mainnet" ? "Pi Network" : "Pi Testnet";
      const payments = new Map(); let seq = 0;
      const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
      const fakeFetch = async (url, o = {}) => {
        const u = new URL(url), m = u.pathname.match(/^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/);
        if (!m) return json(404, {});
        const p = payments.get(decodeURIComponent(m[1])); if (!p) return json(404, { error: "not_found" });
        if ((o.method || "GET") === "GET") return json(200, p);
        if (m[2] === "approve") p.status.developer_approved = true;
        if (m[2] === "complete") { const b = JSON.parse(o.body || "{}"); if (!p.transaction || b.txid !== p.transaction.txid) return json(400, {}); p.status.developer_completed = true; }
        if (m[2] === "cancel") p.status.cancelled = true;
        return json(200, p);
      };
      const bus = { emit() { }, on() { } }, noop = () => { };
      const mctx = { db: mem, bus, rl: { hit: () => true }, config: {}, requireUser: (fn) => fn, router: { get: noop, post: noop, del: noop, put: noop }, services: { users: { pub: (u) => u, sessionFor: async () => { } } } };
      const sim = require("./pi")(mctx, { env: { PI_ENABLED: "1", PI_API_KEY: "dry-run", PI_API_URL: "https://dry-run.invalid", PI_NETWORK: real.network, PI_MAINNET_CONFIRM: real.network === "mainnet" ? "1" : "0" }, fetch: fakeFetch, jobs: false });
      const t0 = new Date().toISOString();
      await mem.run("INSERT INTO users(id,handle,name,created_at) VALUES('dry_u','dry_user','تجربة',$1), ('dry_o','dry_other','آخر',$1)", [t0]);
      await mem.run("INSERT INTO pi_links(user_id,pi_uid,pi_username,network,linked_at) VALUES('dry_u','uid-dry','dry_pioneer',$1,$2)", [real.network, t0]);
      const user = { id: "dry_u", role: "user" };
      const wallet = (intent, { amount, uid = "uid-dry" } = {}) => { const id = "dry-pay-" + (++seq); payments.set(id, { identifier: id, user_uid: uid, amount: amount ?? intent.amount, memo: intent.memo, metadata: intent.metadata, network: NETNAME, direction: "user_to_app", status: { developer_approved: false, developer_completed: false, cancelled: false, user_cancelled: false, transaction_verified: false }, transaction: null }); return id; };
      const sign = (id, verified = true) => { const p = payments.get(id); p.transaction = { txid: "dry-tx-" + id, verified }; p.status.transaction_verified = verified; return p.transaction.txid; };
      const step = async (name, fn) => { const t = Date.now(); try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t, detail }); } catch (e) { steps.push({ name, ok: false, ms: Date.now() - t, detail: e.message }); } };
      const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
      const intent = (amount = 0.01) => sim.createIntent(user, { amount, memo: "دفعة تجريبية", purpose: "test" });
      await step("دفعة كاملة: طلب ← موافقة ← توقيع ← إكمال ← إيصال", async () => {
        const it = await intent(); const pid = wallet(it); await sim.approve(user, pid); const txid = sign(pid);
        const r = await sim.complete(user, pid, txid); expect(r.status === "completed" && r.receipt?.txid === txid, "لم تكتمل الدفعة"); return "completed";
      });
      await step("استعادة دفعة غير مكتملة عند تسجيل الدخول", async () => {
        const it = await intent(); const pid = wallet(it); await sim.approve(user, pid); sign(pid);
        const r = await sim.incomplete(user, { payment: { identifier: pid } }); expect(r.status === "completed", "لم تُستعد الدفعة: " + r.status); return "completed";
      });
      await step("إلغاء قبل التوقيع", async () => {
        const it = await intent(); const pid = wallet(it); await sim.approve(user, pid);
        const r = await sim.cancel(user, { paymentId: pid }); expect(r.status === "cancelled", "لم تُلغَ"); return "cancelled";
      });
      await step("معاملة لم تتحقق منها Pi تبقى معلّقة ولا تُلغى", async () => {
        const it = await intent(); const pid = wallet(it); await sim.approve(user, pid); sign(pid, false);
        const r = await sim.incomplete(user, { paymentId: pid }); expect(r.status === "pending", "الحالة " + r.status); return "pending";
      });
      await step("رفض مبلغ معدَّل", async () => {
        const it = await intent(1); const pid = wallet(it, { amount: 0.5 });
        let refused = false; try { await sim.approve(user, pid); } catch { refused = true; } expect(refused, "قُبل مبلغ مختلف"); return "refused";
      });
      await step("رفض دفعة من حساب Pi آخر", async () => {
        const it = await intent(); const pid = wallet(it, { uid: "uid-someone-else" });
        let refused = false; try { await sim.approve(user, pid); } catch { refused = true; } expect(refused, "قُبلت دفعة حساب آخر"); return "refused";
      });
    } finally { try { await mem.close?.(); } catch { /* ignore */ } }
    return { ok: steps.every((s) => s.ok), network: pis()?.diag?.().network || "testnet", simulated: true, touchedNetwork: false, touchedDatabase: false, ms: Date.now() - started, steps };
  }

  /* ======================= 5. recovery on sign-in ======================= */
  async function recover(user) {
    const p = pis(); if (!p?.diag || !p.diag().enabled || !p.diag().apiKeyPresent) throw E.off("مدفوعات Pi غير مفعّلة بعد");
    const cutoff = new Date(Date.now() - 60e3).toISOString();
    const rows = await db.all("SELECT id, payment_id FROM pi_transactions WHERE user_id=$1 AND status IN ('created','approved') AND payment_id IS NOT NULL AND created_at < $2 ORDER BY created_at LIMIT 10", [user.id, cutoff]);
    const out = [];
    for (const r of rows) { try { const x = await p.incomplete(user, { paymentId: r.payment_id }); out.push({ id: r.id, status: x.status }); } catch (e) { out.push({ id: r.id, status: "error", error: e.code || "error" }); } }
    return { checked: rows.length, results: out };
  }

  /* ======================= 6. validation key ======================= */
  async function ssr(req, res, url) {
    if (url.pathname !== "/validation-key.txt" || !validationKey) return false;
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" });
    res.end(validationKey); return true;
  }

  /* ======================= routes ======================= */
  R.get("/api/admin/pi/activation", admin(async (req) => checklist(req)));
  R.post("/api/admin/pi/activation/probe", admin(async () => { const p = pis(); return p?.keyCheck ? p.keyCheck() : { ok: false, reason: "no_key" }; }));
  R.post("/api/admin/pi/dryrun", admin(async () => dryRun()));
  R.post("/api/pi/recover", A(async (req) => recover(req.user)));
  R.get("/api/pi/readiness", async (req) => { const c = await checklist(req); return { mode: c.mode, modeLabel: c.modeLabel, paymentsReady: c.paymentsReady, directoryReady: c.directoryReady, missingCount: c.missing.length }; });

  return { checklist, dryRun, recover, ssr, modeOf };
};
