/* Pi Service (phase 36 — Full Pi integration). The single server-side integration point with the Pi Platform API.
 * 1. Config: PI_ENABLED (off by default), PI_NETWORK testnet by default; mainnet ONLY with PI_NETWORK=mainnet AND
 *    PI_MAINNET_CONFIRM=1 (otherwise it silently stays on testnet and the config route says so).
 * 2. Sign-in / linking (phase 36b, Pi App Studio): the client's Pi accessToken is exchanged server-side, once, with the
 *    App Studio backend (POST PI_APPSTUDIO_URL {accessToken} → {sessionToken, user:{uid, username}}); only that uid/username
 *    is trusted (never anything the browser sends). The result is then linked to the signed-in account, used to sign in
 *    the linked account, or answered with needsLink. Sign-in is gated by PI_AUTH_ENABLED (default on: it needs no API
 *    key); payments stay gated by PI_ENABLED + PI_API_KEY.
 * 3. Payments (user → app): local intent → approve → complete, each step re-reads the payment from GET /v2/payments/:id
 *    and checks owner (user_uid), direction, network, amount and, on completion, that the txid is the one Pi verified.
 *    Every transition is conditional (idempotent under retries / double taps) and logged in pi_tx_events.
 * 4. Incomplete payments (Pi.authenticate → onIncompletePaymentFound): complete when the txid is verified by Pi,
 *    cancel when there is no transaction, leave "approved" (pending) while Pi has a txid it has not verified yet.
 * 5. Wallet history with a keyset cursor, receipts with a block-explorer link, refunds recorded by staff
 *    (Pi refunds are app→user payments made outside this server; we never hold a wallet seed).
 * 6. Reconciliation: a leased hourly scheduler job runs the daily check for yesterday once; admins can read/run it.
 * Secrets: the Server API Key and user access tokens are only ever put in Authorization headers. They are never
 * logged, stored, echoed in errors or returned by any route. */
const { E, HttpError, str, id, now } = require("../lib/core");

const STATUSES = ["created", "approved", "completed", "cancelled", "refunded", "failed"];
const DEFAULT_PURPOSES = ["tip", "donation", "subscription", "boost", "purchase", "event_ticket", "ppv", "market", "ads", "ai", "transfer", "mentor", "fund", "charity", "jobs", "contract", "test"]; // fund: phase 65 creator support fund donations · charity: phase 70 charity campaign donations · transfer: phase 56 user-to-user transfers · ai: phase 41 AI subscriptions · ppv: phase 38 paid posts · market: phase 39 marketplace orders · ads: phase 40 ad budgets · mentor: phase 74 paid mentorship sessions
const OFF = "مدفوعات Pi غير مفعّلة بعد";
const AUTH_OFF = "تسجيل الدخول بحساب Pi غير مفعّل";
const APPSTUDIO_LOGIN = "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login";
const VERIFIED_TTL_MS = 10 * 60e3; // an exchanged token is remembered (by hash) so needsLink → link:true does not exchange it twice
const ymd = (d) => d.toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {any} ctx @param {{ env?: Record<string, string|undefined>, fetch?: (url: string, o: any) => Promise<any>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl, config } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const fetchImpl = opts.fetch || ((/** @type {string} */ url, /** @type {any} */ o) => fetch(url, o));
  const clock = () => (opts.now ? opts.now() : new Date());
  const users = () => ctx.services.users;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();

  /* ======================= 1. configuration ======================= */
  const enabled = opts.env ? env.PI_ENABLED === "1" : !!config.piEnabled || env.PI_ENABLED === "1";
  const apiKey = (opts.env ? env.PI_API_KEY : config.piApiKey || env.PI_API_KEY) || null;
  const apiUrl = String((opts.env ? env.PI_API_URL : null) || config.piApi || env.PI_API_URL || "https://api.minepi.com").replace(/\/+$/, "");
  const mainnetAsked = env.PI_NETWORK === "mainnet";
  const network = mainnetAsked && env.PI_MAINNET_CONFIRM === "1" ? "mainnet" : "testnet";
  const sandbox = network === "testnet" && env.PI_SANDBOX !== "0";
  const appId = env.PI_APP_ID ? String(env.PI_APP_ID).slice(0, 100) : undefined;
  const maxAmount = Math.max(0.0000001, +env.PI_MAX_AMOUNT || 1000);
  const purposes = (env.PI_PURPOSES ? env.PI_PURPOSES.split(",") : DEFAULT_PURPOSES).map(s => s.trim()).filter(s => /^[a-z0-9_]{2,30}$/.test(s));
  const explorerBase = env.PI_EXPLORER_URL || "https://blockexplorer.minepi.com";
  const piNetworkName = network === "mainnet" ? "Pi Network" : "Pi Testnet";
  const intentTtlMs = (+env.PI_INTENT_TTL_HOURS || 24) * 3600e3;
  if (enabled && mainnetAsked && network !== "mainnet") logger.warn?.("PI_NETWORK=mainnet ignored: PI_MAINNET_CONFIRM=1 is required; staying on testnet");
  const authEnabled = env.PI_AUTH_ENABLED !== "0" && env.PI_AUTH_ENABLED !== "false";
  const appStudioUrl = (() => {
    const raw = String(env.PI_APPSTUDIO_URL || APPSTUDIO_LOGIN).trim();
    try { const u = new URL(raw); if (u.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return u.toString(); } catch { /* fall through */ }
    logger.warn?.("PI_APPSTUDIO_URL ignored: must be an https URL"); return APPSTUDIO_LOGIN;
  })();
  const publicConfig = () => ({ enabled, authEnabled, network, sandbox, ...(appId ? { appId } : {}) });

  const requireOn = () => { if (!enabled) throw E.off(OFF); };
  const requireAuthOn = () => { if (!authEnabled) throw E.off(AUTH_OFF); };
  const requirePayments = () => { requireOn(); if (!apiKey) throw E.off(OFF); };
  const upstream = (m = "تعذر الاتصال بشبكة Pi الآن، حاول بعد قليل") => new HttpError(502, m, "pi_upstream");

  /* ======================= 2. Pi Platform API client ======================= */
  /** @returns {Promise<{ ok: boolean, status: number, body: any }>} */
  async function piFetch(path, { method = "GET", body, bearer } = /** @type {{ method?: string, body?: any, bearer?: string }} */ ({})) {
    const headers = { Authorization: bearer ? "Bearer " + bearer : "Key " + apiKey, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
    let r;
    try { r = await fetchImpl(apiUrl + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10e3) }); }
    catch (e) { logger.warn?.("pi api unreachable", { path: path.replace(/\/payments\/[^/]+/, "/payments/:id"), method }); throw upstream(); }
    const j = await Promise.resolve(r.json ? r.json() : {}).catch(() => ({}));
    if (!r.ok) logger.warn?.("pi api error", { path: path.replace(/\/payments\/[^/]+/, "/payments/:id"), method, status: r.status });
    return { ok: !!r.ok, status: r.status || (r.ok ? 200 : 500), body: j || {} };
  }
  async function me(accessToken) {
    const r = await piFetch("/v2/me", { bearer: accessToken });
    if (!r.ok || !r.body || typeof r.body.uid !== "string" || !r.body.uid) throw new HttpError(401, "تعذر التحقق من حساب Pi", "pi_invalid");
    return { uid: String(r.body.uid).slice(0, 200), username: r.body.username ? String(r.body.username).slice(0, 100) : null };
  }
  /* Pi App Studio login exchange (server-side only). The token and the returned sessionToken are never logged, stored or
   * returned; only a sha256 of the token is kept in memory for VERIFIED_TTL_MS so the same token is exchanged once. */
  const verified = new Map(); // sha256(token) → { who, exp }
  const tokenKey = (t) => require("node:crypto").createHash("sha256").update(t).digest("base64url");
  async function verify(accessToken) {
    const key = tokenKey(accessToken), t = Date.now(), hit = verified.get(key);
    if (hit && hit.exp > t) return hit.who;
    let r;
    try { r = await fetchImpl(appStudioUrl, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken }), signal: AbortSignal.timeout(10e3) }); }
    catch { logger.warn?.("pi app studio unreachable"); throw upstream(); }
    const status = r.status || (r.ok ? 200 : 500);
    if (status !== 200) { logger.warn?.("pi app studio login refused", { status }); throw new HttpError(401, "تعذر التحقق من حساب Pi، أعد المحاولة من متصفح Pi", "pi_invalid"); }
    const j = await Promise.resolve(r.json ? r.json() : null).catch(() => null);
    const u = j && typeof j === "object" ? j.user : null;
    if (!u || typeof u.uid !== "string" || !u.uid) { logger.warn?.("pi app studio login: unexpected response"); throw upstream(); }
    const who = { uid: u.uid.slice(0, 200), username: typeof u.username === "string" && u.username ? u.username.slice(0, 100) : null };
    if (verified.size >= 5000) { for (const [k, v] of verified) if (v.exp <= t) verified.delete(k); if (verified.size >= 5000) verified.clear(); }
    verified.set(key, { who, exp: t + VERIFIED_TTL_MS });
    return who;
  }
  const enc = (s) => encodeURIComponent(s);
  async function getPayment(paymentId, { allowMissing = false } = {}) {
    const r = await piFetch("/v2/payments/" + enc(paymentId));
    if (r.status === 404 && allowMissing) return null;
    if (r.status === 404) throw E.nf("الدفعة غير موجودة على شبكة Pi");
    if (!r.ok) throw upstream();
    return r.body;
  }
  async function postPayment(paymentId, action, body) {
    const r = await piFetch(`/v2/payments/${enc(paymentId)}/${action}`, { method: "POST", body });
    if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : 409, "رفضت شبكة Pi العملية", "pi_rejected");
    return r.body;
  }
  const verifiedTxid = (p) => (p?.transaction?.txid && (p.transaction.verified || p.status?.transaction_verified)) ? String(p.transaction.txid) : null;
  const piCancelled = (p) => !!(p?.status?.cancelled || p?.status?.user_cancelled);
  const sameAmount = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-7;

  /* ======================= 3. links & sign-in ======================= */
  const linkOf = (userId) => db.get("SELECT * FROM pi_links WHERE user_id=$1", [userId]);
  async function linkByUid(uid) {
    const l = await db.get("SELECT * FROM pi_links WHERE pi_uid=$1", [uid]); if (l) return l;
    const u = await db.get("SELECT id FROM users WHERE pi_uid=$1", [uid]); // account made by the legacy /api/auth/pi route
    if (!u) return null;
    await db.run("INSERT INTO pi_links(user_id,pi_uid,network,linked_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [u.id, uid, network, now()]);
    return db.get("SELECT * FROM pi_links WHERE pi_uid=$1", [uid]);
  }
  async function link(user, who) {
    const other = await linkByUid(who.uid);
    if (other && other.user_id !== user.id) throw E.conflict("حساب Pi هذا مرتبط بحساب آخر في مجتمع بلس");
    const mine = await linkOf(user.id);
    if (mine && mine.pi_uid !== who.uid) throw E.conflict("حسابك مرتبط بحساب Pi آخر؛ ألغِ الربط أولاً");
    const holder = await db.get("SELECT id FROM users WHERE pi_uid=$1", [who.uid]);
    if (holder && holder.id !== user.id) throw E.conflict("حساب Pi هذا مرتبط بحساب آخر في مجتمع بلس");
    const t = now();
    if (mine) await db.run("UPDATE pi_links SET pi_username=$1, last_auth_at=$2 WHERE user_id=$3", [who.username, t, user.id]);
    else await db.run("INSERT INTO pi_links(user_id,pi_uid,pi_username,network,linked_at,last_auth_at) VALUES($1,$2,$3,$4,$5,$5)", [user.id, who.uid, who.username, network, t]);
    await db.run("UPDATE users SET pi_uid=$1 WHERE id=$2", [who.uid, user.id]);
    await db.run("INSERT INTO pi_kyc(user_id,status,source,checked_at) VALUES($1,'linked','pi',$2) ON CONFLICT DO NOTHING", [user.id, t]).catch(() => { });
    if (!mine) { bus.emit("PI_LINKED", { user: user.id, actor: user.id }); ctx.audit?.("pi_link", user.id, null, user.id); }
  }
  async function auth(req, res) {
    requireAuthOn();
    if (!rl.hit("login", req.ip)) throw E.rate();
    // linking acts on the current session: keep the CSRF header requirement for it (the route itself is exempt so that
    // a plain Pi sign-in works from the Pi Browser / sandbox frame)
    if (req.body.link && req.csrfOk === false) throw E.forbid("طلب مرفوض");
    const accessToken = str(req.body.accessToken, 4000, { required: true });
    // the ONLY identity source: uid/username sent by the browser (body, query, headers) are ignored on purpose
    const who = await verify(accessToken);
    if (req.body.link && req.user) {
      await link(req.user, who);
      const u = await db.get("SELECT * FROM users WHERE id=$1", [req.user.id]);
      return { user: users().pub(u), piUsername: who.username, linked: true };
    }
    const l = await linkByUid(who.uid);
    if (!l) return { needsLink: true, username: who.username, linked: false };
    const u = await db.get("SELECT * FROM users WHERE id=$1", [l.user_id]);
    if (!u) return { needsLink: true, username: who.username, linked: false };
    if (u.status !== "active") throw E.forbid("الحساب موقوف");
    await db.run("UPDATE pi_links SET pi_username=$1, last_auth_at=$2 WHERE user_id=$3", [who.username, now(), u.id]);
    if (!req.user || req.user.id !== u.id) await users().sessionFor(res, u, req);
    return { user: users().pub(u), piUsername: who.username, linked: true };
  }
  async function unlink(user) {
    requireAuthOn();
    const l = await linkOf(user.id);
    if (!l && !user.pi_uid) return { ok: true, linked: false };
    const u = await db.get("SELECT password_hash FROM users WHERE id=$1", [user.id]);
    if (!u?.password_hash) throw E.conflict("عيّن كلمة مرور لحسابك أولاً حتى لا تفقد الدخول بعد إلغاء ربط Pi");
    await db.run("DELETE FROM pi_links WHERE user_id=$1", [user.id]);
    await db.run("UPDATE users SET pi_uid=NULL WHERE id=$1", [user.id]);
    ctx.audit?.("pi_unlink", user.id, null, user.id);
    bus.emit("PI_UNLINKED", { user: user.id, actor: user.id });
    return { ok: true, linked: false };
  }
  /** link status for Settings; works when only sign-in is on (the wallet route needs payments) */
  async function linkState(user) {
    requireAuthOn();
    const l = (await linkOf(user.id)) || (user.pi_uid ? await linkByUid(user.pi_uid) : null);
    return { linked: !!l, piUsername: l?.pi_username || null, network };
  }
  async function requireLink(user) {
    const l = (await linkOf(user.id)) || (user.pi_uid ? await linkByUid(user.pi_uid) : null);
    if (!l) throw new HttpError(409, "اربط حساب Pi أولاً", "pi_not_linked");
    return l;
  }

  /* ======================= 4. ledger helpers ======================= */
  const txById = (txId) => db.get("SELECT * FROM pi_transactions WHERE id=$1", [txId]);
  const txByPayment = (paymentId) => db.get("SELECT * FROM pi_transactions WHERE payment_id=$1", [paymentId]);
  const event = (txId, from, to, source, detail) => db.run("INSERT INTO pi_tx_events(tx_id,from_status,to_status,source,detail,at) VALUES($1,$2,$3,$4,$5,$6)", [txId, from || null, to, source, detail ? String(detail).slice(0, 300) : null, now()]);
  const STAMP = { approved: "approved_at", completed: "completed_at", cancelled: "cancelled_at", refunded: "refunded_at" };
  /** conditional transition: only moves from one of `from`; returns true when this call made the change */
  async function move(tx, to, from, source, { txid, error, detail, paymentId, piUid } = /** @type {any} */ ({})) {
    const t = now(), sets = ["status=$1", "updated_at=$2"], args = [to, t];
    const add = (col, v) => { args.push(v); sets.push(`${col}=$${args.length}`); };
    if (STAMP[to]) add(STAMP[to], t);
    if (txid !== undefined) add("txid", txid);
    if (error !== undefined) add("error", error);
    if (paymentId !== undefined) add("payment_id", paymentId);
    if (piUid !== undefined) add("pi_uid", piUid);
    args.push(tx.id); const idIdx = args.length;
    const ph = from.map((s) => { args.push(s); return "$" + args.length; }).join(",");
    const r = await db.run(`UPDATE pi_transactions SET ${sets.join(", ")} WHERE id=$${idIdx} AND status IN (${ph})`, args);
    if (r.changes) {
      await event(tx.id, tx.status, to, source, detail);
      if (to === "completed") bus.emit("PI_PAYMENT_COMPLETED", { user: tx.user_id, tx: tx.id, paymentId: paymentId || tx.payment_id, amount: tx.amount, purpose: tx.purpose, refId: tx.ref_id, actor: tx.user_id });
      if (to === "cancelled" || to === "refunded" || to === "failed") bus.emit("PI_PAYMENT_" + to.toUpperCase(), { user: tx.user_id, tx: tx.id, purpose: tx.purpose, refId: tx.ref_id, actor: tx.user_id });
    }
    return !!r.changes;
  }
  const txClient = (t) => ({ id: t.id, paymentId: t.payment_id || null, amount: Number(t.amount), memo: t.memo || "", status: STATUSES.includes(t.status) ? t.status : "failed", direction: t.direction === "in" ? "in" : "out", createdAt: t.created_at, txid: t.txid || null, purpose: t.purpose, refId: t.ref_id || null });
  const explorerUrl = (t) => t.txid ? `${explorerBase}/${t.network === "mainnet" ? "mainnet" : "testnet"}/tx/${enc(t.txid)}` : null;
  async function receiptOf(t) {
    const l = await db.get("SELECT pi_username FROM pi_links WHERE user_id=$1", [t.user_id]);
    return { id: t.id, amount: Number(t.amount), memo: t.memo || "", status: STATUSES.includes(t.status) ? t.status : "failed", txid: t.txid || null, network: t.network, createdAt: t.created_at, completedAt: t.completed_at || null, piUsername: l?.pi_username || null, purpose: t.purpose, explorerUrl: explorerUrl(t) };
  }
  /** Checks the Pi payment against the local intent/user. Returns an error message or null. */
  function mismatch(p, tx, link) {
    if (link && p.user_uid && p.user_uid !== link.pi_uid) return "owner";
    if (p.direction && p.direction !== "user_to_app") return "direction";
    if (p.network && p.network !== piNetworkName) return "network";
    if (tx && !sameAmount(p.amount, tx.amount)) return "amount";
    return null;
  }
  const MISMATCH_MSG = { owner: "الدفعة لا تخص حساب Pi المرتبط بك", direction: "اتجاه الدفعة غير مدعوم", network: "الدفعة على شبكة Pi مختلفة عن إعداد الخادم", amount: "مبلغ الدفعة لا يطابق الطلب" };

  /* ======================= 5. payments ======================= */
  async function createIntent(user, b) {
    requirePayments();
    if (!rl.hit("pi_intent", user.id)) throw E.rate();
    const l = await requireLink(user);
    const amount = Number(b.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw E.bad("مبلغ غير صالح");
    if (amount > maxAmount) throw E.bad("المبلغ أكبر من الحد المسموح");
    const amt = Math.round(amount * 1e7) / 1e7;
    const memo = str(b.memo, 200, { required: true });
    const purpose = str(b.purpose, 30, { required: true });
    if (!purposes.includes(purpose)) throw E.bad("غرض الدفع غير معروف");
    const refId = b.refId === undefined || b.refId === null || b.refId === "" ? null : str(String(b.refId), 100);
    const txId = id("pit");
    await db.run("INSERT INTO pi_transactions(id,user_id,pi_uid,amount,memo,purpose,ref_id,direction,network,status,meta,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'out',$8,'created',$9,$10,$10)",
      [txId, user.id, l.pi_uid, amt, memo, purpose, refId, network, { intentId: txId }, now()]);
    await event(txId, null, "created", "client");
    return { id: txId, amount: amt, memo, metadata: { intentId: txId } };
  }

  /** find the local row for a Pi payment, binding it to its intent (metadata.intentId) the first time; legacy clients get a row on the fly */
  async function bind(user, p, link, source) {
    const paymentId = String(p.identifier);
    let tx = await txByPayment(paymentId);
    if (tx) { if (tx.user_id !== user.id) throw E.forbid("الدفعة لا تخص حسابك"); return tx; }
    const intentId = p.metadata && typeof p.metadata.intentId === "string" ? p.metadata.intentId : null;
    if (intentId) {
      const it = await txById(intentId);
      if (!it || it.user_id !== user.id) throw E.forbid("الدفعة لا تخص حسابك");
      if (it.payment_id && it.payment_id !== paymentId) throw E.conflict("هذا الطلب مرتبط بدفعة أخرى");
      const r = await db.run("UPDATE pi_transactions SET payment_id=$1, pi_uid=$2, updated_at=$3 WHERE id=$4 AND payment_id IS NULL", [paymentId, link.pi_uid, now(), it.id]);
      if (!r.changes && (await txById(it.id)).payment_id !== paymentId) throw E.conflict("هذا الطلب مرتبط بدفعة أخرى");
      return txById(it.id);
    }
    // legacy client (pi-adapter.js without an intent): record the payment as Pi reports it
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) throw E.bad("مبلغ غير صالح");
    const txId = "pil_" + paymentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    await db.run("INSERT INTO pi_transactions(id,user_id,payment_id,pi_uid,amount,memo,purpose,direction,network,status,meta,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'legacy','out',$7,'created',$8,$9,$9) ON CONFLICT DO NOTHING",
      [txId, user.id, paymentId, link.pi_uid, amount, p.memo ? String(p.memo).slice(0, 200) : "", network, p.metadata && typeof p.metadata === "object" ? p.metadata : {}, now()]);
    tx = await txByPayment(paymentId);
    if (!tx || tx.user_id !== user.id) throw E.forbid("الدفعة لا تخص حسابك");
    await event(tx.id, null, "created", source, "legacy");
    return tx;
  }

  async function approve(user, paymentId) {
    requirePayments();
    if (!rl.hit("pi_pay", user.id)) throw E.rate();
    const l = await requireLink(user);
    const p = await getPayment(paymentId);
    const pre = mismatch(p, null, l); if (pre) throw E.forbid(MISMATCH_MSG[pre]);
    let tx = await bind(user, p, l, "client");
    if (tx.status === "approved" || tx.status === "completed") return { ok: true, id: tx.id, status: tx.status };
    if (tx.status !== "created") throw E.conflict("لا يمكن اعتماد هذه الدفعة (" + tx.status + ")");
    if (piCancelled(p)) { await move(tx, "cancelled", ["created"], "client", { detail: "cancelled on Pi before approval" }); throw E.conflict("أُلغيت الدفعة على شبكة Pi"); }
    const bad = mismatch(p, tx, l);
    if (bad) { await move(tx, "failed", ["created"], "client", { error: bad }); throw E.conflict(MISMATCH_MSG[bad]); }
    if (!p.status?.developer_approved) {
      try { await postPayment(paymentId, "approve"); }
      catch (e) { await db.run("UPDATE pi_transactions SET error=$1, updated_at=$2 WHERE id=$3", ["approve_rejected", now(), tx.id]); throw e; }
    }
    await move(tx, "approved", ["created"], "client");
    tx = await txById(tx.id);
    return { ok: true, id: tx.id, status: tx.status };
  }

  /** shared by complete / incomplete / reconcile: finish a payment Pi has a verified txid for */
  async function finish(tx, p, txid, source) {
    if (!p.status?.developer_completed) await postPayment(p.identifier, "complete", { txid });
    await move(tx, "completed", ["created", "approved"], source, { txid, error: null });
    return txById(tx.id);
  }
  async function complete(user, paymentId, txidIn) {
    requirePayments();
    if (!rl.hit("pi_pay", user.id)) throw E.rate();
    const txid = str(txidIn, 200, { required: true });
    const l = await requireLink(user);
    let tx = await txByPayment(paymentId);
    if (tx && tx.user_id !== user.id) throw E.forbid("الدفعة لا تخص حسابك");
    if (tx?.status === "completed") { if (tx.txid !== txid) throw E.conflict("الدفعة مكتملة بمعاملة مختلفة"); return { ok: true, id: tx.id, status: "completed", receipt: await receiptOf(tx) }; }
    if (tx && ["cancelled", "refunded", "failed"].includes(tx.status)) throw E.conflict("لا يمكن إكمال هذه الدفعة (" + tx.status + ")");
    const p = await getPayment(paymentId);
    const pre = mismatch(p, null, l); if (pre) throw E.forbid(MISMATCH_MSG[pre]);
    if (!tx) tx = await bind(user, p, l, "client");
    const bad = mismatch(p, tx, l);
    if (bad) { await move(tx, "failed", ["created", "approved"], "client", { error: bad }); throw E.conflict(MISMATCH_MSG[bad]); }
    if (piCancelled(p)) { await move(tx, "cancelled", ["created", "approved"], "client", { detail: "cancelled on Pi" }); throw E.conflict("أُلغيت الدفعة على شبكة Pi"); }
    const v = verifiedTxid(p);
    if (!v) throw new HttpError(409, "لم تتحقق شبكة Pi من المعاملة بعد، حاول بعد قليل", "pi_unverified");
    if (v !== txid) throw new HttpError(409, "رقم المعاملة لا يطابق ما سجلته شبكة Pi", "pi_txid_mismatch");
    tx = await finish(tx, p, txid, "client");
    return { ok: true, id: tx.id, status: tx.status, receipt: await receiptOf(tx) };
  }

  async function cancel(user, b) {
    requirePayments();
    const paymentId = b.paymentId ? str(b.paymentId, 200) : null, intentId = b.intentId ? str(b.intentId, 100) : null;
    if (!paymentId && !intentId) throw E.bad("حقل مطلوب ناقص");
    let tx = paymentId ? await txByPayment(paymentId) : await txById(intentId);
    if (!tx && paymentId) { // never seen locally (approve not reached): bind it so the cancel is recorded
      const l = await requireLink(user); const p = await getPayment(paymentId, { allowMissing: true });
      if (!p) throw E.nf();
      const pre = mismatch(p, null, l); if (pre) throw E.forbid(MISMATCH_MSG[pre]);
      tx = await bind(user, p, l, "client");
    }
    if (!tx || tx.user_id !== user.id) throw E.nf();
    if (tx.status === "cancelled") return { ok: true, id: tx.id, status: "cancelled" };
    if (tx.status !== "created" && tx.status !== "approved") throw E.conflict("لا يمكن إلغاء هذه الدفعة (" + tx.status + ")");
    if (tx.payment_id) {
      const p = await getPayment(tx.payment_id, { allowMissing: true });
      if (p && verifiedTxid(p)) throw E.conflict("وصلت المعاملة إلى شبكة Pi؛ لا يمكن إلغاؤها الآن");
      if (p && !piCancelled(p) && !p.status?.developer_completed) await postPayment(tx.payment_id, "cancel").catch(() => null);
    }
    await move(tx, "cancelled", ["created", "approved"], "client");
    return { ok: true, id: tx.id, status: "cancelled" };
  }

  async function incomplete(user, b) {
    requirePayments();
    if (!rl.hit("pi_pay", user.id)) throw E.rate();
    const given = b.payment && typeof b.payment === "object" ? b.payment : null;
    const paymentId = str(given?.identifier ?? b.paymentId, 200, { required: true });
    const l = await requireLink(user);
    const p = await getPayment(paymentId); // the client copy is never trusted beyond its identifier
    const pre = mismatch(p, null, l); if (pre) throw E.forbid(MISMATCH_MSG[pre]);
    let tx = await bind(user, p, l, "incomplete");
    if (tx.status === "completed" || tx.status === "cancelled" || tx.status === "refunded") return { ok: true, id: tx.id, status: tx.status, txid: tx.txid || null };
    if (piCancelled(p)) { await move(tx, "cancelled", ["created", "approved", "failed"], "incomplete", { detail: "cancelled on Pi" }); return { ok: true, id: tx.id, status: "cancelled", txid: null }; }
    const v = verifiedTxid(p);
    if (v) {
      const bad = mismatch(p, tx, l);
      if (bad) { await move(tx, "failed", ["created", "approved"], "incomplete", { error: bad }); throw E.conflict(MISMATCH_MSG[bad]); }
      tx = await finish(tx, p, v, "incomplete");
      return { ok: true, id: tx.id, status: tx.status, txid: tx.txid };
    }
    if (p.transaction?.txid) { // on the chain but not verified by Pi yet: never cancel a payment that may have moved funds
      if (tx.status === "created" && p.status?.developer_approved) await move(tx, "approved", ["created"], "incomplete");
      return { ok: true, id: tx.id, status: "pending", txid: null };
    }
    await postPayment(paymentId, "cancel").catch(() => null);
    await move(tx, "cancelled", ["created", "approved"], "incomplete", { detail: "no transaction" });
    return { ok: true, id: tx.id, status: "cancelled", txid: null };
  }

  /* ======================= 6. wallet, receipts, refunds ======================= */
  const cursorOf = (t) => Buffer.from(t.created_at + "|" + t.id).toString("base64url");
  function parseCursor(c) {
    if (!c) return null;
    try { const [at, txId] = Buffer.from(String(c), "base64url").toString().split("|"); if (!at || !txId || isNaN(Date.parse(at))) throw 0; return { at, id: txId }; }
    catch { throw E.bad("مؤشر غير صالح"); }
  }
  async function wallet(user, q) {
    requireOn();
    const l = (await linkOf(user.id)) || (user.pi_uid ? await linkByUid(user.pi_uid) : null);
    const limit = Math.min(50, Math.max(1, +q.limit || 20)), c = parseCursor(q.cursor);
    const args = [user.id]; let where = "user_id=$1";
    if (c) { args.push(c.at, c.id); where += " AND (created_at < $2 OR (created_at = $2 AND id < $3))"; }
    if (q.status && STATUSES.includes(q.status)) { args.push(q.status); where += ` AND status=$${args.length}`; }
    const rows = await db.all(`SELECT * FROM pi_transactions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, args);
    const more = rows.length > limit, page = rows.slice(0, limit);
    return {
      piUsername: l?.pi_username || null, network,
      balanceNote: "رصيدك يظهر في محفظة Pi فقط؛ مجتمع بلس لا يحتفظ بأي رصيد ولا يطّلع على محفظتك. هنا سجل معاملاتك عبر التطبيق.",
      tx: page.map(txClient), nextCursor: more ? cursorOf(page[page.length - 1]) : null
    };
  }
  async function receipt(user, rid) {
    requireOn();
    const t = (await txById(rid)) || (await txByPayment(rid));
    if (!t || (t.user_id !== user.id && user.role !== "admin")) throw E.nf();
    return receiptOf(t);
  }
  async function refund(by, txId, b) {
    requireOn();
    const t = (await txById(txId)) || (await txByPayment(txId)); if (!t) throw E.nf();
    if (t.status === "refunded") return { ok: true, id: t.id, status: "refunded" };
    if (t.status !== "completed" || t.direction !== "out") throw E.conflict("الاسترداد متاح للدفعات المكتملة فقط");
    const note = str(b.note, 300) || null, rtxid = b.txid ? str(b.txid, 200) : null;
    if (!(await move(t, "refunded", ["completed"], "admin", { detail: note }))) throw E.conflict("تغيّرت حالة الدفعة، حدّث الصفحة");
    const rid = id("pir");
    await db.run("INSERT INTO pi_transactions(id,user_id,pi_uid,amount,memo,purpose,ref_id,direction,network,status,txid,meta,refund_of,created_at,updated_at,completed_at) VALUES($1,$2,$3,$4,$5,'refund',$6,'in',$7,'completed',$8,$9,$10,$11,$11,$11)",
      [rid, t.user_id, t.pi_uid, t.amount, "استرداد: " + (t.memo || ""), t.ref_id, t.network, rtxid, { note, by: by.id }, t.id, now()]);
    await event(rid, null, "completed", "admin", "refund of " + t.id);
    ctx.audit?.("pi_refund", t.id, note, by.id);
    return { ok: true, id: t.id, status: "refunded", refundId: rid };
  }

  /* ======================= 7. reconciliation ======================= */
  const dayRange = (date) => { const s = new Date(date + "T00:00:00.000Z"); return [s.toISOString(), new Date(s.getTime() + 864e5).toISOString()]; };
  let running = null;
  async function reconcile(date, { trigger = "admin", by = null } = {}) {
    requirePayments();
    if (running) return running; // one run at a time per instance (the scheduler lease covers multi-instance)
    running = (async () => {
      const runId = id("pirc"), started = now();
      await db.run("INSERT INTO pi_reconciliation(id,date,kind,by_user,status,started_at) VALUES($1,$2,$3,$4,'running',$5)", [runId, date, trigger, by, started]);
      const [from, to] = dayRange(date);
      const rows = await db.all("SELECT * FROM pi_transactions WHERE payment_id IS NOT NULL AND direction='out' AND ((created_at >= $1 AND created_at < $2) OR (status IN ('created','approved') AND created_at < $2)) ORDER BY created_at", [from, to]);
      let checked = 0, matched = 0, fixed = 0; const mismatched = [];
      const note = (t, issue, remote, didFix) => { mismatched.push({ id: t.id, paymentId: t.payment_id, local: t.status, remote, issue, fixed: didFix }); if (didFix) fixed++; };
      for (const t of rows) {
        checked++;
        let p;
        try { p = await getPayment(t.payment_id, { allowMissing: true }); }
        catch { note(t, "pi_unreachable", null, false); continue; }
        if (!p) { note(t, "missing_on_pi", null, false); continue; }
        const remote = piCancelled(p) ? "cancelled" : p.status?.developer_completed ? "completed" : verifiedTxid(p) ? "verified" : p.status?.developer_approved ? "approved" : "created";
        const v = verifiedTxid(p);
        try {
          if (!sameAmount(p.amount, t.amount)) { note(t, "amount", remote, false); continue; }
          if (t.status === "completed" || t.status === "refunded") {
            if (remote === "cancelled") note(t, "cancelled_on_pi", remote, false);
            else if (v && t.txid && v !== t.txid) note(t, "txid", remote, false);
            else if (!v) note(t, "not_verified_on_pi", remote, false);
            else matched++;
          } else if (t.status === "cancelled") {
            if (v) note(t, "verified_but_cancelled_locally", remote, false); else matched++;
          } else if (t.status === "failed") {
            matched++;
          } else if (remote === "cancelled") {
            note(t, "cancelled_on_pi", remote, await move(t, "cancelled", ["created", "approved"], "reconcile"));
          } else if (v) {
            const done = await finish(t, p, v, "reconcile");
            note(t, "verified_not_completed", remote, done.status === "completed");
          } else if (t.status === "created" && p.status?.developer_approved) {
            note(t, "approved_on_pi", remote, await move(t, "approved", ["created"], "reconcile"));
          } else matched++;
        } catch (e) { note(t, "fix_failed", remote, false); }
        await db.run("UPDATE pi_transactions SET reconciled_at=$1 WHERE id=$2", [now(), t.id]);
      }
      // intents never handed to Pi expire after PI_INTENT_TTL_HOURS
      const stale = await db.all("SELECT * FROM pi_transactions WHERE status='created' AND payment_id IS NULL AND created_at < $1", [new Date(clock().getTime() - intentTtlMs).toISOString()]);
      let expired = 0; for (const t of stale) if (await move(t, "cancelled", ["created"], "reconcile", { detail: "intent expired" })) expired++;
      await db.run("UPDATE pi_reconciliation SET status='done', checked=$1, matched=$2, fixed=$3, expired=$4, payload=$5, finished_at=$6 WHERE id=$7", [checked, matched, fixed, expired, { mismatched }, now(), runId]);
      if (mismatched.some(m => !m.fixed)) logger.warn?.("pi reconciliation found unresolved mismatches", { date, count: mismatched.filter(m => !m.fixed).length });
      return { date, checked, matched, mismatched, fixed, expired, runId, at: started };
    })();
    try { return await running; } finally { running = null; }
  }
  async function reconciliationReport(date) {
    requireOn();
    const row = await db.get("SELECT * FROM pi_reconciliation WHERE date=$1 AND status='done' ORDER BY started_at DESC LIMIT 1", [date]);
    const runs = (await db.get("SELECT COUNT(*) n FROM pi_reconciliation WHERE date=$1", [date]))?.n || 0;
    if (!row) return { date, checked: 0, matched: 0, mismatched: [], fixed: 0, expired: 0, ran: false, runs: Number(runs) };
    return { date, checked: row.checked, matched: row.matched, mismatched: row.payload?.mismatched || [], fixed: row.fixed, expired: row.expired, ran: true, runs: Number(runs), runId: row.id, trigger: row.kind, at: row.started_at, finishedAt: row.finished_at };
  }
  /** daily job body: reconcile yesterday (UTC) once; the leased scheduler calls it hourly so a missed day is caught up */
  async function dailyJob() {
    if (!enabled || !apiKey) return { skipped: true };
    const y = ymd(new Date(clock().getTime() - 864e5));
    if (await db.get("SELECT 1 x FROM pi_reconciliation WHERE date=$1 AND kind='job' AND status='done'", [y])) return { skipped: true, date: y };
    return reconcile(y, { trigger: "job" });
  }
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.PI_JOBS !== "0";
  if (jobsOn && enabled && apiKey && ctx.scheduler) ctx.scheduler.every("pi.reconcile", +(env.PI_RECONCILE_INTERVAL_MS || 3600e3), dailyJob);

  /* ======================= 8. legacy backfill (kept out of the migration so 019 stays purely additive) ======================= */
  async function backfill() {
    await db.run("INSERT INTO pi_links(user_id, pi_uid, network, linked_at) SELECT id, pi_uid, 'testnet', created_at FROM users WHERE pi_uid IS NOT NULL ON CONFLICT DO NOTHING");
    await db.run(`INSERT INTO pi_transactions(id, user_id, payment_id, amount, memo, purpose, direction, network, status, txid, meta, created_at, updated_at, completed_at)
      SELECT 'pil_' || payment_id, user_id, payment_id, COALESCE(amount, 0), memo, 'legacy', 'out', 'testnet',
        CASE status WHEN 'approving' THEN 'created' WHEN 'approved' THEN 'approved' WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
        txid, metadata, created_at, updated_at, CASE WHEN status='completed' THEN COALESCE(updated_at, created_at) ELSE NULL END
      FROM pi_payments WHERE payment_id IS NOT NULL ON CONFLICT DO NOTHING`);
  }
  let ready = db ? backfill().catch((e) => logger.warn?.("pi legacy backfill skipped", { err: e.message })) : Promise.resolve();
  const whenReady = (fn) => async (...a) => { await ready; return fn(...a); };

  /* ======================= 9. routes ======================= */
  const dateQ = (v) => { const d = v ? String(v) : ymd(clock()); if (!DATE_RE.test(d) || isNaN(Date.parse(d + "T00:00:00Z"))) throw E.bad("تاريخ غير صالح"); return d; };
  R.get("/api/pi/config", async () => publicConfig());
  R.post("/api/pi/auth", auth, { piLogin: true }); // no CSRF header required: the Pi token itself authenticates this call
  R.get("/api/pi/link", A(async (req) => linkState(req.user)));
  R.del("/api/pi/link", A(async (req) => unlink(req.user)));
  R.get("/api/pi/wallet", A(whenReady(async (req) => wallet(req.user, req.query || {}))));
  R.post("/api/pi/payments", A(async (req) => createIntent(req.user, req.body)));
  // approve/complete are also routed here from the legacy handlers in platform.js (registered earlier, first match wins)
  R.post("/api/pi/payments/approve", A(async (req) => approve(req.user, str(req.body.paymentId, 200, { required: true }))));
  R.post("/api/pi/payments/complete", A(async (req) => complete(req.user, str(req.body.paymentId, 200, { required: true }), req.body.txid)));
  R.post("/api/pi/payments/cancel", A(async (req) => cancel(req.user, req.body)));
  R.post("/api/pi/payments/incomplete", A(async (req) => incomplete(req.user, req.body)));
  R.get("/api/pi/receipts/:id", A(whenReady(async (req) => receipt(req.user, req.params.id))));
  R.get("/api/admin/pi/reconciliation", admin(async (req) => reconciliationReport(dateQ(req.query.date))));
  R.post("/api/admin/pi/reconcile", admin(whenReady(async (req) => reconcile(dateQ(req.body.date), { trigger: "admin", by: req.user.id }))));
  R.post("/api/admin/pi/payments/:id/refund", admin(async (req) => refund(req.user, req.params.id, req.body)));

  /* phase 51: activation diagnostics (never returns the key itself) + a harmless key probe */
  const diag = () => ({ enabled, authEnabled, apiKeyPresent: !!apiKey, network, sandbox, mainnetAsked, mainnetConfirmed: env.PI_MAINNET_CONFIRM === "1", appId: appId || null, purposes: [...purposes], maxAmount, apiHost: (() => { try { return new URL(apiUrl).host; } catch { return null; } })() });
  async function keyCheck() { // GET a payment id that cannot exist: 404 = key accepted, 401/403 = key refused
    if (!apiKey) return { ok: false, reason: "no_key" };
    try { const r = await piFetch("/v2/payments/mp-activation-probe-" + Date.now()); return r.status === 401 || r.status === 403 ? { ok: false, reason: "key_refused", status: r.status } : { ok: r.status === 404 || r.ok, status: r.status, reason: r.status === 404 || r.ok ? "key_accepted" : "unexpected" }; }
    catch { return { ok: false, reason: "unreachable" }; }
  }
  return { diag, keyCheck, config: publicConfig, enabled: () => enabled, authEnabled: () => authEnabled, verify, network, me, approve, complete, cancel, incomplete, createIntent, wallet, receipt, refund, reconcile, reconciliationReport, dailyJob, backfill: () => (ready = backfill()), STATUSES };
};
