/* Real machine translation (phase 41) — subscribers of an AI plan with the `translate` feature (services/ai.js).
 * Posts, comments and messages, into the user's language (prefs.target → users.lang → ar). Originals are never overwritten.
 * Provider: lib/translate.js (openai | deepl | libre via env keys only). No provider → 503 not_configured «خدمة الترجمة غير مفعّلة بعد».
 * Privacy:
 *  • messages only go to a PRIVATE provider (keyed or TRANSLATE_PRIVATE=1) — never to a keyless public instance (409 provider_not_private);
 *  • E2EE messages: the server has only ciphertext, so the client sends the plaintext it shows with consent:true after a disclosure;
 *    that text is translated and dropped — never cached, stored or logged (409 e2ee_plaintext_required without it);
 *  • cache scopes: '' shared (public posts/comments outside communities), p:<post> (other visible posts), m:<conv> (non-E2EE,
 *    non-disappearing chats; purged on delete and after AI_MESSAGE_CACHE_DAYS), none for paid posts and E2EE text.
 * Metering/caps through ai.meter / ai.checkCaps (cache hits are free and do not count against the monthly limit). */
const { E, HttpError, str } = require("../lib/core");
const T = require("../lib/translate");

const DAY = 864e5;
const NOT_ON = "خدمة الترجمة غير مفعّلة بعد";
const KINDS = ["post", "comment", "message"];

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, fetch?: typeof fetch, provider?: any, now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const maxChars = Math.max(100, Math.floor(num("AI_TRANSLATE_MAX_CHARS", 5000)));
  const msgCacheMs = num("AI_MESSAGE_CACHE_DAYS", 30) * DAY;
  let provider = T.createProvider(env, { fetch: opts.fetch, provider: opts.provider });
  const ai = () => ctx.services.ai;
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
  const status = () => ({ available: !!provider, provider: provider ? provider.name : null, private: !!provider?.private });

  /* ---------- prefs ---------- */
  async function prefsOf(uid) {
    const r = await db.get("SELECT * FROM translate_prefs WHERE user_id=$1", [uid]);
    return { auto: r ? !!Number(r.auto) : true, target: r?.target && T.LANGS.includes(r.target) ? r.target : null, skip: r ? parse(r.skip, []).filter((l) => T.LANGS.includes(l)) : [] };
  }
  async function putPrefs(user, b) {
    const cur = await prefsOf(user.id);
    if (b.auto !== undefined && typeof b.auto !== "boolean") throw E.bad();
    if (b.target !== undefined && b.target !== null && !T.LANGS.includes(b.target)) throw fail(400, "lang_unsupported", "لغة غير مدعومة");
    if (b.skip !== undefined && (!Array.isArray(b.skip) || b.skip.some((l) => !T.LANGS.includes(l)))) throw fail(400, "lang_unsupported", "لغة غير مدعومة");
    const n = { auto: b.auto ?? cur.auto, target: b.target === undefined ? cur.target : b.target, skip: b.skip === undefined ? cur.skip : [...new Set(b.skip)] };
    await db.run("INSERT INTO translate_prefs(user_id,auto,target,skip,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET auto=$2, target=$3, skip=$4, updated_at=$5",
      [user.id, n.auto ? 1 : 0, n.target, JSON.stringify(n.skip), nowIso()]);
    return n;
  }
  async function targetFor(user, b) {
    if (b.target !== undefined && b.target !== null && b.target !== "") { if (!T.LANGS.includes(b.target)) throw fail(400, "lang_unsupported", "لغة غير مدعومة"); return b.target; }
    const p = await prefsOf(user.id); if (p.target) return p.target;
    const u = await db.get("SELECT lang FROM users WHERE id=$1", [user.id]);
    const l = u?.lang === "fr" || u?.lang === "ur" ? "en" : u?.lang; // v2.67: interface is ar + en only
    return l && T.LANGS.includes(l) ? l : "ar";
  }

  /* ---------- loading the source text (access checked) ---------- */
  const truncate = (t) => (t.length > maxChars ? { text: t.slice(0, maxChars), truncated: true } : { text: t, truncated: false });
  async function load(user, kind, ref, b) {
    if (kind === "post") {
      const row = await db.get("SELECT * FROM posts WHERE id=$1", [ref]);
      if (!row || row.status !== "published" || !(await ctx.services.content.canSee(row, user.id))) throw E.nf();
      const d = parse(row.data, {}) || {};
      const text = [row.title, row.text].filter((x) => typeof x === "string" && x.trim()).join("\n\n"); // posts.text of a paid post is only the public teaser
      const scope = d.paid ? null : row.visibility === "public" && !row.community ? "" : "p:" + row.id;
      return { ...truncate(text), scope, message: false };
    }
    if (kind === "comment") {
      const c = await db.get("SELECT * FROM comments WHERE id=$1", [ref]);
      if (!c || c.status !== "published") throw E.nf();
      const row = await db.get("SELECT * FROM posts WHERE id=$1", [c.post]);
      if (!row || !(await ctx.services.content.canSee(row, user.id))) throw E.nf();
      return { ...truncate(c.text || ""), scope: row.visibility === "public" && !row.community ? "" : "p:" + row.id, message: false };
    }
    const m = await db.get("SELECT * FROM messages WHERE id=$1", [ref]);
    if (!m || m.deleted_at || (m.expires_at && new Date(m.expires_at).getTime() <= clock().getTime())) throw E.nf();
    const mem = await db.get("SELECT 1 x FROM conversation_members WHERE conv=$1 AND user_id=$2", [m.conv, user.id]);
    if (!mem) throw E.nf();
    if (!["text", "image"].includes(m.kind || "text")) throw fail(400, "bad_request", "لا يمكن ترجمة هذا النوع من الرسائل");
    if (m.payload) { // end-to-end encrypted: only the plaintext the client chose to send, with consent; never cached or stored
      if (typeof b.text !== "string" || !b.text.trim()) throw fail(409, "e2ee_plaintext_required", "هذه الرسالة مشفّرة طرفياً؛ يلزم إرسال نصها من جهازك بموافقتك", { disclosure: "e2ee" });
      if (b.consent !== true) throw fail(400, "consent_required", "يلزم تأكيد الموافقة على إرسال نص الرسالة للترجمة");
      return { ...truncate(str(b.text, 20000, { required: true })), scope: null, message: true, e2ee: true };
    }
    const conv = await db.get("SELECT ttl FROM conversations WHERE id=$1", [m.conv]);
    return { ...truncate(m.text || ""), scope: Number(conv?.ttl) > 0 ? null : "m:" + m.conv, message: true };
  }

  /* ---------- cache ---------- */
  async function cacheGet(scope, text, target) {
    const h = T.hashOf(scope, text);
    const r = await db.get("SELECT text, source_lang, provider FROM translations_cache WHERE hash=$1 AND target=$2", [h, target]);
    if (r) await db.run("UPDATE translations_cache SET hits=hits+1, last_hit_at=$1 WHERE hash=$2 AND target=$3", [nowIso(), h, target]);
    return r;
  }
  async function cachePut(scope, text, target, source, prov, out) {
    await db.run("INSERT INTO translations_cache(hash,target,scope,source_lang,provider,text,chars,hits,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8) ON CONFLICT DO NOTHING",
      [T.hashOf(scope, text), target, scope, source, prov, out, text.length, nowIso()]);
  }

  /* ---------- translate ---------- */
  async function gate(user) {
    const ent = await ai().requireFeature(user.id, "translate"); // 402 subscription_required (+ upsell)
    if (!provider) throw fail(503, "not_configured", NOT_ON);
    return ent;
  }
  async function one(user, ent, target, kind, ref, b) {
    if (!KINDS.includes(kind)) throw fail(400, "bad_request", "نوع غير صالح");
    if (typeof ref !== "string" || !ref || ref.length > 100) throw fail(400, "bad_request", "معرّف غير صالح");
    const src = await load(user, kind, ref, b || {});
    const base = { kind, id: ref, target, ai: true, label: "ترجمة آلية", ...(src.truncated ? { truncated: true } : {}) };
    const source = T.detectLang(src.text);
    if (!src.text.trim() || !source || source === target) return { ...base, text: src.text, source: source || target, cached: false, same: true, provider: null };
    if (src.message && !provider.private) throw fail(409, "provider_not_private", "لا تُرسل الرسائل الخاصة إلى خدمة ترجمة عامة غير مؤمّنة");
    if (!provider.supports(target)) throw fail(400, "lang_unsupported", "مزود الترجمة الحالي لا يدعم هذه اللغة");
    if (src.scope !== null) {
      const hit = await cacheGet(src.scope, src.text, target);
      if (hit) { await ai().meter(user.id, "translate", { cached: true }); return { ...base, text: hit.text, source: hit.source_lang || source, cached: true, provider: hit.provider }; }
    }
    await ai().checkCaps(user.id, "translate", ent.limits, src.text.length); // 429 usage_limit / 503 budget_exhausted
    let out;
    try { out = await provider.translate(src.text, target, source); }
    catch { throw fail(503, "provider_error", "تعذرت الترجمة الآن، حاول لاحقاً"); } // never log the text
    await ai().meter(user.id, "translate", { chars: src.text.length, costMicros: out.costMicros || 0, provider: provider.name });
    if (src.scope !== null) await cachePut(src.scope, src.text, target, source, provider.name, out.text);
    return { ...base, text: out.text, source, cached: false, provider: provider.name };
  }
  async function translate(user, b) {
    if (!rl.hit("ai_translate", user.id)) throw E.rate();
    if (!KINDS.includes(b.kind)) throw fail(400, "bad_request", "نوع غير صالح");
    const ent = await gate(user);
    return one(user, ent, await targetFor(user, b), b.kind, b.id, b);
  }
  async function batch(user, b) {
    if (!rl.hit("ai_translate", user.id)) throw E.rate();
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 25) throw fail(400, "bad_request", "من 1 إلى 25 عنصراً");
    const ent = await gate(user);
    const target = await targetFor(user, b);
    const seen = new Set(), items = [];
    for (const it of b.items) {
      const kind = it?.kind, ref = it?.id, k = kind + ":" + ref;
      if (seen.has(k)) continue; seen.add(k);
      try { const r = await one(user, ent, target, kind, ref, kind === "message" ? { text: it.text, consent: it.consent } : {}); items.push({ ok: true, ...r }); }
      catch (e) { if (!(e instanceof HttpError)) throw e; items.push({ kind, id: ref, ok: false, code: e.code, error: e.message }); }
    }
    return { target, items };
  }
  /** legacy POST /api/translate {post, target} (platform.js) → same entitlement path */
  async function legacy(user, b) {
    if (!b?.post) throw fail(400, "bad_request", "استخدم /api/ai/translate");
    const r = await translate(user, { kind: "post", id: b.post, target: b.target });
    return { text: r.text, cached: r.cached, same: r.same || undefined };
  }

  /* ---------- hygiene ---------- */
  async function purge() {
    const cut = new Date(clock().getTime() - msgCacheMs).toISOString();
    return (await db.run("DELETE FROM translations_cache WHERE scope LIKE 'm:%' AND created_at < $1", [cut])).changes;
  }
  if ((opts.jobs !== undefined ? opts.jobs : env.AI_JOBS !== "0") && ctx.scheduler) ctx.scheduler.every("translate.purge", 6 * 3600e3, purge);
  bus.on("MESSAGE_DELETED", (e) => { if (e?.conv) db.run("DELETE FROM translations_cache WHERE scope=$1", ["m:" + e.conv]).catch(() => { }); });
  bus.on("POST_DELETED", (e) => { const pid = e?.post || e?.id; if (pid) db.run("DELETE FROM translations_cache WHERE scope=$1", ["p:" + pid]).catch(() => { }); });

  R.post("/api/ai/translate", A(async (req) => translate(req.user, req.body || {})));
  R.post("/api/ai/translate/batch", A(async (req) => batch(req.user, req.body || {})));
  R.get("/api/ai/translate/prefs", A(async (req) => prefsOf(req.user.id)));
  R.put("/api/ai/translate/prefs", A(async (req) => putPrefs(req.user, req.body || {})));

  return { status, prefsOf, translate, batch, legacy, purge, setProvider: (p) => { provider = p; }, providerTranslate: (text, target) => { if (!provider) throw fail(503, "not_configured", NOT_ON); return provider.translate(text, target, null); } }; // phase 52: admin test
};
