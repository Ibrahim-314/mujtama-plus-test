/* «مركز الذكاء» (v2.77) — a member links their OWN AI account and uses it inside مجتمع بلس. Lib: lib/aihub-lib.js. Migration 076.
 * Linking:
 *   • OpenRouter: one tap (OAuth PKCE S256). POST /api/aihub/oauth/openrouter/start → url; OpenRouter sends the member back to
 *     GET /api/aihub/oauth/openrouter/callback?code&state; the server exchanges the code for a key tied to the member's own account
 *     (billed to their OpenRouter credits) and redirects to #/aihub?linked=openrouter. The state row is used once and expires in 10 min.
 *   • Gemini, Groq, OpenAI API, Claude, DeepSeek, Mistral, Grok: the member pastes a key from the provider's own page; the server
 *     checks it live (GET /models) before saving. Keys are sealed (AES-256-GCM) and never returned — only a last-4 hint.
 *   • ChatGPT («المتابعة بـ ChatGPT»): listed, off until OpenAI approves our client id (SIWC_CLIENT_ID); honest «بانتظار موافقة OpenAI».
 * Use:
 *   • POST /api/aihub/chat — the hub's chat, on the member's chosen linked account and model, or on the app's free daily allowance
 *     (admin-adjustable, default 5/day; only when the operator set AIHUB_FREE_KEY, else 503 not_configured, honest).
 *   • providerFor(uid, "assistant") — the composer assistant (rephrase / polite replies) runs on the member's own account when they
 *     choose it in the hub (services/assistant.js asks this first); no subscription or app caps then, since it is their account.
 * Privacy: no message text is stored or logged; only request counts per day. Minors get a stricter system line. */
const { E, HttpError } = require("../lib/core");
const crypto = require("node:crypto");
const P = require("../lib/providers");
const L = require("../lib/aihub-lib");
const { secret } = require("../lib/secrets");

const OFF_FREE = "الاستخدام المجاني غير مفعّل بعد — اربط حسابك لتبدأ";
const MSG = {
  bad_key: "المفتاح غير صحيح أو أُلغي. أنشئ مفتاحاً جديداً من صفحة المزوّد.",
  quota: "انتهى رصيدك أو حدّك المجاني لدى المزوّد. جرّب لاحقاً أو اختر نموذجاً آخر.",
  rate: "طلبات كثيرة على حسابك لدى المزوّد الآن. انتظر قليلاً ثم أعد المحاولة.",
  model_not_found: "هذا النموذج غير متاح في حسابك. اختر نموذجاً آخر.",
  timeout: "تأخّر رد المزوّد. أعد المحاولة.",
  bad_request: "رفض المزوّد الطلب. جرّب نموذجاً آخر أو اختصر الرسالة.",
  provider_error: "تعذّر الوصول إلى المزوّد الآن. أعد المحاولة بعد قليل."
};

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => Date, freeProvider?: any }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const fetchImpl = opts.fetch || fetch;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const today = () => nowIso().slice(0, 10);
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const sec = (k) => (opts.env ? env[k] : secret(k));
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();
  const audit = (action, target, reason, by) => { try { ctx.audit?.(action, target, reason, by); } catch { /* best effort */ } };

  /* ---------- sealing (own key derivation so a provider_settings export never opens member keys) ---------- */
  let keyP = null;
  const storedKey = async () => {
    let r = await db.get("SELECT value FROM notify_keys WHERE name='aihub_seal'");
    if (!r) { await db.run("INSERT INTO notify_keys(name,value,created_at) VALUES('aihub_seal',$1,$2) ON CONFLICT DO NOTHING", [crypto.randomBytes(32).toString("base64url"), nowIso()]); r = await db.get("SELECT value FROM notify_keys WHERE name='aihub_seal'"); }
    return r.value;
  };
  const sealKey = () => (keyP ||= (async () => {
    const k = sec("AIHUB_SEAL_KEY") || sec("PROVIDER_SEAL_KEY");
    return k ? crypto.createHash("sha256").update("aihub|" + k).digest("base64url") : storedKey();
  })().catch((e) => { keyP = null; throw e; }));
  const seal = async (plain) => P.seal(await sealKey(), plain);
  async function unseal(s) {
    const v = P.unseal(await sealKey(), s); if (v !== null) return v;
    const prev = sec("AIHUB_SEAL_KEY_PREVIOUS") || sec("PROVIDER_SEAL_KEY_PREVIOUS"); // v2.78: rotation window
    if (prev) { const w = P.unseal(crypto.createHash("sha256").update("aihub|" + prev).digest("base64url"), s); if (w !== null) return w; }
    const legacy = await storedKey().catch(() => null); // sealed before AIHUB_SEAL_KEY / PROVIDER_SEAL_KEY was set
    return legacy ? P.unseal(legacy, s) : null;
  }

  /* ---------- settings (admin) ---------- */
  const DEFAULTS = { freeDaily: 5, enabled: Object.fromEntries(L.CATALOG.map((p) => [p.id, true])) };
  async function settings() {
    const r = await db.get("SELECT value FROM provider_settings WHERE name='aihub'").catch(() => null);
    const v = parse(r?.value, {}) || {};
    const fd = Number(v.freeDaily);
    return { freeDaily: Number.isInteger(fd) && fd >= 0 && fd <= 100 ? fd : Number.isInteger(+env.AIHUB_FREE_DAILY) ? Math.min(100, Math.max(0, +env.AIHUB_FREE_DAILY)) : DEFAULTS.freeDaily,
      enabled: { ...DEFAULTS.enabled, ...(v.enabled && typeof v.enabled === "object" ? v.enabled : {}) } };
  }
  async function saveSettings(user, b) {
    const cur = await settings(), next = { ...cur };
    if (b.freeDaily !== undefined) { const n = Number(b.freeDaily); if (!Number.isInteger(n) || n < 0 || n > 100) throw fail(400, "bad_request", "الحد اليومي المجاني بين 0 و100"); next.freeDaily = n; }
    if (b.enabled !== undefined) {
      if (!b.enabled || typeof b.enabled !== "object" || Array.isArray(b.enabled)) throw E.bad();
      for (const [k, v] of Object.entries(b.enabled)) { if (!L.byId(k) || typeof v !== "boolean") throw E.bad("مزوّد غير معروف"); next.enabled[k] = v; }
    }
    await db.run("INSERT INTO provider_settings(name,value,updated_by,updated_at) VALUES('aihub',$1,$2,$3) ON CONFLICT (name) DO UPDATE SET value=$1, updated_by=$2, updated_at=$3", [JSON.stringify(next), user.id, nowIso()]);
    audit("aihub_settings", "aihub", JSON.stringify(next), user.id);
    return next;
  }

  /* ---------- the app's free allowance (operator key, env only) ---------- */
  const freeP = (() => {
    if (opts.freeProvider) return opts.freeProvider;
    const key = sec("AIHUB_FREE_KEY"); if (!key) return null;
    const base = L.byId(env.AIHUB_FREE_PROVIDER || "groq") || L.byId("groq");
    return L.chatProvider({ provider: base, key, model: env.AIHUB_FREE_MODEL || base.defaultModel, fetchImpl });
  })();
  const freeName = () => (opts.freeProvider ? opts.freeProvider.label || "مجتمع بلس" : freeP ? (L.byId(env.AIHUB_FREE_PROVIDER || "groq") || L.byId("groq")).name : null);

  /* ---------- data ---------- */
  const linkRow = (uid, pid) => db.get("SELECT * FROM ai_links WHERE user_id=$1 AND provider=$2", [uid, pid]);
  const linkClient = (r) => r && ({ provider: r.provider, method: r.method, hint: r.hint, model: r.model || null, state: r.state, linkedAt: r.created_at, lastUsedAt: r.last_used_at || null });
  async function prefsOf(uid) {
    const r = await db.get("SELECT * FROM ai_link_prefs WHERE user_id=$1", [uid]);
    return { defaultProvider: r?.default_provider || null, features: parse(r?.features, {}) || {} };
  }
  async function usedToday(uid, pid) { return Number((await db.get("SELECT requests FROM ai_link_usage WHERE user_id=$1 AND day=$2 AND provider=$3", [uid, today(), pid]))?.requests || 0); }
  async function count(uid, pid) {
    await db.run("INSERT INTO ai_link_usage(user_id,day,provider,requests) VALUES($1,$2,$3,1) ON CONFLICT (user_id,day,provider) DO UPDATE SET requests=ai_link_usage.requests+1", [uid, today(), pid]);
    if (pid !== "free") await db.run("UPDATE ai_links SET last_used_at=$1 WHERE user_id=$2 AND provider=$3", [nowIso(), uid, pid]);
  }
  const siwcReady = () => !!sec("SIWC_CLIENT_ID") && env.SIWC_ENABLED === "1";
  const nextReset = () => { const d = clock(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString(); };
  async function isMinor(uid) { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } }

  async function overview(user) {
    const st = await settings();
    const links = await db.all("SELECT * FROM ai_links WHERE user_id=$1", [user.id]);
    const byP = new Map(links.map((r) => [r.provider, r]));
    const used = await usedToday(user.id, "free");
    const prefs = await prefsOf(user.id);
    const providers = L.CATALOG.filter((p) => st.enabled[p.id] !== false).map((p) => L.publicProvider(p, {
      available: p.link === "siwc" ? siwcReady() : true,
      ...(p.link === "siwc" && !siwcReady() ? { note: "بانتظار موافقة OpenAI — نفعّله فور وصولها" } : {}),
      link: p.link, linked: linkClient(byP.get(p.id)) || null
    }));
    return {
      providers, prefs, features: L.FEATURES,
      free: { enabled: !!freeP && st.freeDaily > 0, daily: st.freeDaily, used, left: Math.max(0, st.freeDaily - used), resetsAt: nextReset(), via: freeName(), ...(freeP ? {} : { note: OFF_FREE }) },
      linkedCount: links.length, minor: await isMinor(user.id),
      privacy: { stored: "لا نخزّن رسائلك ولا ردود الذكاء؛ نحفظ فقط عدد الطلبات اليومي.", keys: "مفاتيحك مشفّرة ولا تظهر لأحد بعد الحفظ، ويمكنك حذفها متى شئت.", never: "لا نرسل رسائلك الخاصة أو بيانات حسابك لأي مزوّد من تلقاء أنفسنا." }
    };
  }

  /* ---------- linking ---------- */
  function provOr404(id, { keyOnly = false } = {}) {
    const p = L.byId(id); if (!p) throw fail(404, "provider_not_found", "مزوّد غير معروف");
    if (keyOnly && p.link !== "key" && p.link !== "oauth") throw fail(409, "siwc_pending", "بانتظار موافقة OpenAI — نفعّله فور وصولها");
    return p;
  }
  async function enabledOr403(p) { if ((await settings()).enabled[p.id] === false) throw fail(403, "provider_disabled", "هذا المزوّد موقوف مؤقتاً من الإدارة"); }
  const mapErr = (e) => (e instanceof L.ProviderError ? fail(e.code === "bad_key" ? 400 : e.code === "rate" ? 429 : 502, e.code, MSG[e.code] || MSG.provider_error) : e);
  const modelCache = new Map(); // `${uid}:${pid}` → { at, list }
  async function liveModels(uid, p, key) {
    const k = uid + ":" + p.id, c = modelCache.get(k);
    if (c && clock().getTime() - c.at < 10 * 60e3) return c.list;
    const list = L.sortModels(p, await L.chatProvider({ provider: p, key, fetchImpl }).models());
    modelCache.set(k, { at: clock().getTime(), list }); if (modelCache.size > 2000) modelCache.delete(modelCache.keys().next().value);
    return list;
  }
  const pickModel = (p, list, wanted) => (wanted && list.some((m) => m.id === wanted) ? wanted : list.find((m) => m.id === p.defaultModel)?.id || (p.id === "openrouter" ? "openrouter/auto" : list[0]?.id) || p.defaultModel || null);
  async function store(user, p, method, key, model) {
    const at = nowIso(), sealed = await seal(key), hint = L.keyHint(key);
    await db.run(`INSERT INTO ai_links(user_id,provider,method,secret,hint,model,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'ok',$7,$7)
      ON CONFLICT (user_id,provider) DO UPDATE SET method=$3, secret=$4, hint=$5, model=$6, state='ok', updated_at=$7`, [user.id, p.id, method, sealed, hint, model, at]);
    const pr = await prefsOf(user.id);
    if (!pr.defaultProvider) await savePrefs(user, { defaultProvider: p.id }, true);
    audit("aihub_link", user.id, p.id + " " + method, user.id);
  }
  async function linkKey(user, pid, b) {
    if (!rl.hit("ai_hub_link", user.id)) throw E.rate();
    const p = provOr404(pid); if (p.link !== "key") throw fail(409, p.link === "siwc" ? "siwc_pending" : "use_oauth", p.link === "siwc" ? "بانتظار موافقة OpenAI — نفعّله فور وصولها" : "هذا المزوّد يُربط بضغطة واحدة");
    await enabledOr403(p);
    const key = L.cleanKey(b.key);
    if (!L.keyLooksValid(p, key)) throw fail(400, "key_format", `هذا لا يبدو مفتاح ${p.name}. انسخه كاملاً من صفحة المزوّد.`);
    let list;
    try { list = L.sortModels(p, await L.chatProvider({ provider: p, key, fetchImpl, timeoutMs: 20000 }).models()); } catch (e) { throw mapErr(e); } // always checks THIS key live
    modelCache.set(user.id + ":" + p.id, { at: clock().getTime(), list });
    const model = pickModel(p, list, typeof b.model === "string" ? b.model : null);
    await store(user, p, "key", key, model);
    return { link: linkClient(await linkRow(user.id, p.id)), models: list.slice(0, 200) };
  }
  async function unlink(user, pid) {
    const p = provOr404(pid);
    const r = await db.run("DELETE FROM ai_links WHERE user_id=$1 AND provider=$2", [user.id, p.id]);
    modelCache.delete(user.id + ":" + p.id);
    const pr = await prefsOf(user.id);
    const feats = Object.fromEntries(Object.entries(pr.features).filter(([, v]) => v !== p.id));
    const rest = await db.get("SELECT provider FROM ai_links WHERE user_id=$1 ORDER BY created_at LIMIT 1", [user.id]);
    await savePrefs(user, { defaultProvider: pr.defaultProvider === p.id ? rest?.provider || null : pr.defaultProvider, features: feats }, true);
    if (r.changes) audit("aihub_unlink", user.id, p.id, user.id);
    return { ok: true, removed: !!r.changes };
  }
  async function keyOf(uid, pid) {
    const r = await linkRow(uid, pid); if (!r) return null;
    const key = await unseal(r.secret);
    if (!key) { logger.warn?.("aihub: a sealed key could not be opened", { provider: pid }); return null; }
    return { row: r, key };
  }
  async function models(user, pid) {
    const p = provOr404(pid), k = await keyOf(user.id, p.id);
    if (!k) throw fail(404, "not_linked", "اربط حسابك أولاً");
    try { return { provider: p.id, current: k.row.model, models: (await liveModels(user.id, p, k.key)).slice(0, 400) }; } catch (e) { throw mapErr(e); }
  }
  async function setModel(user, pid, b) {
    const p = provOr404(pid); if (!(await linkRow(user.id, p.id))) throw fail(404, "not_linked", "اربط حسابك أولاً");
    const m = typeof b.model === "string" ? b.model.trim() : "";
    if (!m || m.length > 200 || !/^[\w./:@+-]+$/.test(m)) throw fail(400, "bad_model", "اسم النموذج غير صالح");
    await db.run("UPDATE ai_links SET model=$1, updated_at=$2 WHERE user_id=$3 AND provider=$4", [m, nowIso(), user.id, p.id]);
    return { link: linkClient(await linkRow(user.id, p.id)) };
  }

  /* ---------- one-tap (OpenRouter OAuth PKCE) ---------- */
  const origin = (req) => env.PUBLIC_ORIGIN || `${req?.headers?.["x-forwarded-proto"] && ctx.config?.trustProxy ? String(req.headers["x-forwarded-proto"]).split(",")[0] : "http"}://${req?.headers?.host || "localhost"}`;
  async function oauthStart(user, pid, req) {
    if (!rl.hit("ai_hub_link", user.id)) throw E.rate();
    const p = provOr404(pid);
    if (p.link === "siwc") throw fail(409, "siwc_pending", "بانتظار موافقة OpenAI — نفعّله فور وصولها");
    if (p.link !== "oauth") throw fail(409, "use_key", "هذا المزوّد يُربط بمفتاح");
    await enabledOr403(p);
    const state = L.stateToken(), v = L.verifier(), at = nowIso();
    await db.run("DELETE FROM ai_oauth_states WHERE created_at < $1 OR user_id=$2", [new Date(clock().getTime() - 10 * 60e3).toISOString(), user.id]);
    await db.run("INSERT INTO ai_oauth_states(state,user_id,provider,verifier,created_at) VALUES($1,$2,$3,$4,$5)", [state, user.id, p.id, v, at]);
    const cb = origin(req) + "/api/aihub/oauth/" + p.id + "/callback";
    const u = new URL("https://openrouter.ai/auth");
    u.searchParams.set("callback_url", cb); u.searchParams.set("code_challenge", L.challenge(v)); u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("state", state); u.searchParams.set("key_label", "مجتمع بلس");
    return { url: u.toString(), expiresIn: 600 };
  }
  async function oauthCallback(req, res, pid) {
    const back = (q) => { res.writeHead(302, { Location: "/#/aihub?" + q, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); res.end(); return ctx.STREAM; };
    const q = req.query || {};
    if (q.error) return back("link_error=denied");
    const code = typeof q.code === "string" ? q.code.slice(0, 400) : "", state = typeof q.state === "string" ? q.state.slice(0, 200) : "";
    if (!code || !state) return back("link_error=missing");
    const row = await db.get("SELECT * FROM ai_oauth_states WHERE state=$1 AND provider=$2", [state, pid]);
    if (row) await db.run("DELETE FROM ai_oauth_states WHERE state=$1", [state]); // single use
    if (!row || clock().getTime() - new Date(row.created_at).getTime() > 10 * 60e3) return back("link_error=expired");
    const p = L.byId(pid);
    let key = null;
    try {
      const r = await fetchImpl("https://openrouter.ai/api/v1/auth/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, code_verifier: row.verifier, code_challenge_method: "S256" }), signal: AbortSignal.timeout(20000) });
      if (r.ok) key = String((await r.json())?.key || "") || null;
    } catch { key = null; }
    if (!key) return back("link_error=exchange");
    const user = await db.get("SELECT id FROM users WHERE id=$1", [row.user_id]); if (!user) return back("link_error=user");
    await store(user, p, "oauth", key, "openrouter/auto");
    return back("linked=" + p.id);
  }

  /* ---------- prefs ---------- */
  async function savePrefs(user, b, internal = false) {
    const cur = await prefsOf(user.id), linked = new Set((await db.all("SELECT provider FROM ai_links WHERE user_id=$1", [user.id])).map((r) => r.provider));
    const ok = (v) => v === null || v === "free" || linked.has(v);
    let def = cur.defaultProvider, feats = { ...cur.features };
    if (b.defaultProvider !== undefined) { if (!internal && !ok(b.defaultProvider)) throw fail(400, "not_linked", "اربط هذا الحساب أولاً"); def = b.defaultProvider; }
    if (b.features !== undefined) {
      if (!b.features || typeof b.features !== "object" || Array.isArray(b.features)) throw E.bad();
      for (const [k, v] of Object.entries(b.features)) { if (!L.FEATURES[k]) throw E.bad("ميزة غير معروفة"); if (!internal && !ok(v)) throw fail(400, "not_linked", "اربط هذا الحساب أولاً"); if (v === null) delete feats[k]; else feats[k] = v; }
      if (internal) feats = b.features;
    }
    await db.run("INSERT INTO ai_link_prefs(user_id,default_provider,features,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET default_provider=$2, features=$3, updated_at=$4", [user.id, def, JSON.stringify(feats), nowIso()]);
    return prefsOf(user.id);
  }

  /* ---------- chat ---------- */
  const SYS = "أنت مساعد ذكي داخل «مجتمع بلس»، شبكة اجتماعية عربية. أجب بلغة المستخدم، بوضوح واختصار واحترام. لا تدّعِ أنك إنسان، ولا تختلق حقائق؛ قل «لا أعرف» عند الشك.";
  const SYS_MINOR = " المستخدم قاصر: التزم بمحتوى آمن ومناسب للعمر تماماً، وارفض بلطف أي طلب غير مناسب.";
  function cleanMessages(list) {
    if (!Array.isArray(list) || !list.length || list.length > 40) throw fail(400, "bad_request", "المحادثة غير صالحة");
    let total = 0;
    const out = list.slice(-30).map((m) => {
      const role = m?.role === "assistant" ? "assistant" : m?.role === "user" ? "user" : null;
      const content = typeof m?.content === "string" ? m.content.slice(0, 8000) : "";
      if (!role || !content.trim()) throw fail(400, "bad_request", "رسالة فارغة أو غير صالحة");
      total += content.length; return { role, content };
    });
    if (out[out.length - 1].role !== "user") throw fail(400, "bad_request", "آخر رسالة يجب أن تكون منك");
    if (total > 32000) throw fail(413, "too_long", "المحادثة طويلة جداً. ابدأ محادثة جديدة.");
    return out;
  }
  async function resolve(user, wanted, feature = "chat") {
    const pr = await prefsOf(user.id);
    let pid = wanted || pr.features[feature] || pr.defaultProvider;
    if (!pid) pid = (await db.get("SELECT provider FROM ai_links WHERE user_id=$1 ORDER BY created_at LIMIT 1", [user.id]))?.provider || "free";
    if (pid === "free") return { pid: "free" };
    const p = L.byId(pid); if (!p) throw fail(404, "provider_not_found", "مزوّد غير معروف");
    const st = await settings(); if (st.enabled[p.id] === false) throw fail(403, "provider_disabled", "هذا المزوّد موقوف مؤقتاً من الإدارة");
    const k = await keyOf(user.id, p.id); if (!k) throw fail(404, "not_linked", "اربط حسابك أولاً");
    return { pid: p.id, p, key: k.key, model: k.row.model };
  }
  async function chat(user, b) {
    if (!rl.hit("ai_hub", user.id)) throw E.rate();
    const messages = cleanMessages(b.messages);
    const r = await resolve(user, typeof b.provider === "string" ? b.provider : null);
    const sys = { role: "system", content: SYS + ((await isMinor(user.id)) ? SYS_MINOR : "") };
    if (r.pid === "free") {
      const st = await settings();
      if (!freeP || st.freeDaily <= 0) throw fail(503, "not_configured", OFF_FREE);
      const used = await usedToday(user.id, "free");
      if (used >= st.freeDaily) throw fail(429, "free_limit", `استخدمت ${st.freeDaily} من ${st.freeDaily} مجاناً اليوم. اربط حسابك لتكمل بلا حد من التطبيق، أو عُد غداً.`, { daily: st.freeDaily, resetsAt: nextReset() });
      let out; try { out = await freeP.chat([sys, ...messages], { maxTokens: 700 }); } catch (e) { throw mapErr(e); }
      await count(user.id, "free");
      return { text: out.text, provider: "free", via: freeName(), model: out.model || null, free: { used: used + 1, left: Math.max(0, st.freeDaily - used - 1), daily: st.freeDaily } };
    }
    const model = typeof b.model === "string" && /^[\w./:@+-]{1,200}$/.test(b.model) ? b.model : r.model;
    let out;
    try { out = await L.chatProvider({ provider: r.p, key: r.key, model, fetchImpl, referer: env.PUBLIC_ORIGIN }).chat([sys, ...messages], { maxTokens: Math.min(4000, Math.max(100, Number(b.maxTokens) || 1200)) }); }
    catch (e) {
      if (e instanceof L.ProviderError && (e.code === "bad_key" || e.code === "quota")) await db.run("UPDATE ai_links SET state=$1, updated_at=$2 WHERE user_id=$3 AND provider=$4", [e.code, nowIso(), user.id, r.pid]);
      throw mapErr(e);
    }
    await count(user.id, r.pid);
    await db.run("UPDATE ai_links SET state='ok' WHERE user_id=$1 AND provider=$2 AND state<>'ok'", [user.id, r.pid]);
    if (!out.text.trim()) throw fail(502, "empty", "لم يرسل النموذج رداً. جرّب نموذجاً آخر.");
    return { text: out.text, provider: r.pid, model: out.model || model, usage: out.usage };
  }

  /** for services/assistant.js: the member's own provider for a feature, or null (then the app's plan + provider apply) */
  async function providerFor(uid, feature) {
    const pr = await prefsOf(uid), pid = pr.features[feature];
    if (!pid || pid === "free") return null;
    const p = L.byId(pid); if (!p || (await settings()).enabled[p.id] === false) return null;
    const k = await keyOf(uid, p.id); if (!k) return null;
    const cp = L.chatProvider({ provider: p, key: k.key, model: k.row.model, fetchImpl, referer: env.PUBLIC_ORIGIN });
    return { name: "own:" + p.id, private: true, model: k.row.model,
      async chat(messages, o = {}) { try { const out = await cp.chat(messages, o); await count(uid, p.id); return { text: out.text, costMicros: 0 }; } catch (e) { throw mapErr(e); } } };
  }

  /* ---------- admin ---------- */
  const isAdmin = (u) => u?.role === "admin";
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });
  async function adminView() {
    const st = await settings();
    const links = await db.all("SELECT provider, COUNT(*) AS n FROM ai_links GROUP BY provider");
    const use = await db.all("SELECT provider, SUM(requests) AS n, COUNT(DISTINCT user_id) AS u FROM ai_link_usage WHERE day=$1 GROUP BY provider", [today()]);
    return { settings: st, freeConfigured: !!freeP, freeVia: freeName(), siwc: { ready: siwcReady(), note: siwcReady() ? null : "بانتظار موافقة OpenAI على «Sign in with ChatGPT»" },
      providers: L.CATALOG.map((p) => ({ id: p.id, name: p.name, link: p.link, enabled: st.enabled[p.id] !== false, links: Number(links.find((x) => x.provider === p.id)?.n || 0) })),
      today: use.map((x) => ({ provider: x.provider, requests: Number(x.n), members: Number(x.u) })) };
  }

  ctx.bus?.on?.("USER_ANONYMISED", async (e) => { if (!e?.user) return; try { for (const t of ["ai_links", "ai_link_prefs", "ai_link_usage", "ai_oauth_states"]) await db.run(`DELETE FROM ${t} WHERE user_id=$1`, [e.user]); } catch (err) { logger.warn?.("aihub anonymise failed", { err: err.message }); } });

  /* ---------- routes ---------- */
  R.get("/api/aihub", A(async (req) => overview(req.user)));
  R.post("/api/aihub/links/:provider", A(async (req) => linkKey(req.user, req.params.provider, req.body || {})));
  R.put("/api/aihub/links/:provider", A(async (req) => setModel(req.user, req.params.provider, req.body || {})));
  R.del("/api/aihub/links/:provider", A(async (req) => unlink(req.user, req.params.provider)));
  R.get("/api/aihub/links/:provider/models", A(async (req) => models(req.user, req.params.provider)));
  R.post("/api/aihub/oauth/:provider/start", A(async (req) => oauthStart(req.user, req.params.provider, req)));
  R.get("/api/aihub/oauth/:provider/callback", async (req, res) => oauthCallback(req, res, L.byId(req.params.provider)?.link === "oauth" ? req.params.provider : "openrouter"));
  R.put("/api/aihub/prefs", A(async (req) => savePrefs(req.user, req.body || {})));
  R.post("/api/aihub/chat", A(async (req) => chat(req.user, req.body || {})));
  R.get("/api/admin/aihub", admin(async () => adminView()));
  R.put("/api/admin/aihub", admin(async (req) => ({ settings: await saveSettings(req.user, req.body || {}) })));

  return { providerFor, overview, settings, chat, MSG };
};
