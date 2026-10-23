/* AI assistant «المساعد الذكي» (phase 42) — subscribers of an AI plan with the `assistant` feature (services/ai.js).
 * • Writing assistant (rephrase / improve / shorter / polite), polite reply suggestions, Q&A answered only from PUBLIC community
 *   content with citations (verified by lib/llm.verify, extractive fallback), semantic search.
 * • Vector store: assistant_vectors (025). PostgreSQL with pgvector ALREADY installed → `embedding vector` column + `<=>`;
 *   otherwise (SQLite, or PG without the extension) JS cosine over base64 Float32 arrays. Never installs the extension unless
 *   ASSISTANT_PGVECTOR=create (and it is available); ASSISTANT_PGVECTOR=off forces the JS path.
 * • Provider: lib/assistant-lib.js (OpenAI-compatible, env key only). No key → 503 not_configured «المساعد الذكي غير مفعّل بعد».
 * • Gate: ai.requireFeature(uid, "assistant") → 402 subscription_required + upsell. Caps/cost via ai.checkCaps / ai.meter
 *   (plan.limits.assistant or AI_ASSISTANT_MONTHLY_CHARS / AI_ASSISTANT_MONTHLY_USD). Index cost → ai_period_stats (no user ids).
 * • Privacy: only the user's own draft, public posts/comments (not paid, not in private communities) and the query ever reach
 *   the provider. Messages / E2EE are never read. Inputs and outputs are not stored or logged. */
const { E, HttpError, str } = require("../lib/core");
const L = require("../lib/assistant-lib");
const { verify, extractive } = require("../lib/llm");

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, fetch?: typeof fetch, provider?: any, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const A = ctx.requireUser, R = ctx.router;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});
  const num = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== "" && Number.isFinite(v) && v >= 0 ? v : d; };
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { const x = JSON.parse(v); return x ?? d; } catch { return d; } };
  const cfg = { chars: Math.floor(num("AI_ASSISTANT_MONTHLY_CHARS", 100000)), usd: num("AI_ASSISTANT_MONTHLY_USD", 0.5), maxInput: Math.max(200, Math.floor(num("ASSISTANT_MAX_INPUT_CHARS", 4000))),
    docChars: 1500, k: 6, scanMax: Math.max(100, Math.floor(num("ASSISTANT_VECTOR_SCAN_MAX", 5000))), batch: Math.max(1, Math.floor(num("ASSISTANT_INDEX_BATCH", 32))), pgvector: env.ASSISTANT_PGVECTOR || "auto" };
  let provider = L.createProvider(env, { fetch: opts.fetch, provider: opts.provider });
  const ai = () => ctx.services.ai;
  const logger = (() => { try { return require("../lib/log").log; } catch { return console; } })();

  /* ---------- plan: the «مجتمع+ ذكاء» plan gets `assistant` once (an admin can remove it later; we never re-add) ---------- */
  let seeded = null;
  const seed = () => (seeded ||= (async () => {
    if (env.AI_ASSISTANT_IN_PLAN === "0") return;
    if (await db.get("SELECT 1 x FROM assistant_meta WHERE key='plan_seeded'")) return;
    await ai().ensurePlans();
    const p = await db.get("SELECT id, features FROM ai_plans WHERE slug='ai_plus'");
    if (p) { const f = parse(p.features, []); if (!f.includes("assistant")) await db.run("UPDATE ai_plans SET features=$1, updated_at=$2 WHERE id=$3", [JSON.stringify([...f, "assistant"]), nowIso(), p.id]); }
    await db.run("INSERT INTO assistant_meta(key,value,updated_at) VALUES('plan_seeded','1',$1) ON CONFLICT (key) DO NOTHING", [nowIso()]);
  })().catch((e) => { seeded = null; throw e; }));

  async function limitsFor(ent) {
    const p = ent?.plan ? await db.get("SELECT limits FROM ai_plans WHERE slug=$1", [ent.plan]) : null;
    const l = parse(p?.limits, {})?.assistant || {};
    return { chars: Number.isFinite(+l.chars) && +l.chars >= 0 ? Math.floor(+l.chars) : cfg.chars, costUsd: Number.isFinite(+l.costUsd) && +l.costUsd >= 0 ? +l.costUsd : cfg.usd };
  }
  async function gate(user, { allowOwn = false } = {}) {
    if (!rl.hit("ai_assistant", user.id)) throw E.rate();
    // v2.77 «مركز الذكاء»: writing + replies run on the member's OWN linked account when they chose one (no plan, no app caps)
    if (allowOwn) { const own = await ctx.services.aihub?.providerFor?.(user.id, "assistant").catch(() => null); if (own) return { own }; }
    await seed();
    const ent = await ai().requireFeature(user.id, "assistant"); // 402 subscription_required (+ upsell)
    if (!provider) throw fail(503, "not_configured", L.NOT_ON);
    return { ...ent, limits: await limitsFor(ent) };
  }
  async function guarded(fn) { try { return await fn(); } catch (e) { if (e instanceof HttpError) throw e; throw fail(503, "provider_error", "تعذّر الوصول إلى المساعد الآن، حاول لاحقاً"); } } // never log inputs
  async function chat(user, ent, messages, chars, o) {
    if (ent.own) return ent.own.chat(messages, o); // the member's own account: errors already carry a clear message
    await ai().checkCaps(user.id, "assistant", ent.limits, chars); // 429 usage_limit / 503 budget_exhausted
    const out = await guarded(() => provider.chat(messages, o));
    await ai().meter(user.id, "assistant", { chars, costMicros: out.costMicros || 0, provider: provider.name });
    return out;
  }
  async function embedFor(user, ent, text) {
    await ai().checkCaps(user.id, "assistant", ent.limits, text.length);
    const out = await guarded(() => provider.embed([text]));
    await ai().meter(user.id, "assistant", { chars: text.length, costMicros: out.costMicros || 0, provider: provider.name });
    if (!Array.isArray(out.vectors?.[0])) throw fail(503, "provider_error", "تعذّر الوصول إلى المساعد الآن، حاول لاحقاً");
    return { vec: out.vectors[0], model: out.model || provider.embedModel || provider.name };
  }

  /* ---------- what may be sent: public content only ---------- */
  async function eligiblePost(row) {
    if (!row || row.status !== "published" || row.visibility !== "public") return false;
    if ((parse(row.data, {}) || {}).paid) return false;
    if (row.community) { const c = await db.get("SELECT type FROM communities WHERE id=$1", [row.community]); if (!c || c.type !== "public") return false; }
    return true;
  }
  /** a post or comment the viewer can see AND that is public; returns {text, postId} or throws 404 / 409 private_content */
  async function publicSource(kind, ref, viewer) {
    if (!["post", "comment"].includes(kind) || typeof ref !== "string" || !ref || ref.length > 100) throw fail(400, "bad_request", "نوع أو معرّف غير صالح");
    let text, post;
    if (kind === "comment") { const c = await db.get("SELECT * FROM comments WHERE id=$1", [ref]); if (!c || c.status !== "published") throw E.nf(); post = await db.get("SELECT * FROM posts WHERE id=$1", [c.post]); text = c.text || ""; }
    else { post = await db.get("SELECT * FROM posts WHERE id=$1", [ref]); text = [post?.title, post?.text].filter((x) => typeof x === "string" && x.trim()).join("\n\n"); }
    if (!post || post.status !== "published" || !(await ctx.services.content.canSee(post, viewer))) throw E.nf();
    if (!(await eligiblePost(post))) throw fail(409, "private_content", "لا يُرسل المساعد المحتوى غير العام إلى مزود الذكاء");
    return { text: text.slice(0, cfg.docChars), postId: post.id };
  }

  /* ---------- vector store ---------- */
  const store = { mode: "js", ready: null };
  const initStore = () => (store.ready ||= (async () => {
    if (db.dialect !== "postgres" || cfg.pgvector === "off") return;
    try {
      let has = await db.get("SELECT 1 x FROM pg_extension WHERE extname='vector'");
      if (!has && cfg.pgvector === "create" && (await db.get("SELECT 1 x FROM pg_available_extensions WHERE name='vector'"))) { await db.exec("CREATE EXTENSION IF NOT EXISTS vector"); has = true; }
      if (!has) return;
      await db.exec("ALTER TABLE assistant_vectors ADD COLUMN IF NOT EXISTS embedding vector");
      store.mode = "pgvector";
    } catch (e) { store.mode = "js"; logger.warn?.("assistant: pgvector unavailable, JS cosine fallback", { err: e.message }); }
  })());
  async function upsert(doc, vec, model, hash) {
    const at = nowIso();
    await db.run(`INSERT INTO assistant_vectors(doc_id,kind,ref_id,post_id,model,dims,vec,text_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
      ON CONFLICT (doc_id) DO UPDATE SET model=$5, dims=$6, vec=$7, text_hash=$8, updated_at=$9`, [doc.docId, doc.kind, doc.ref, doc.postId, model, vec.length, L.encodeVec(vec), hash, at]);
    if (store.mode === "pgvector") await db.run("UPDATE assistant_vectors SET embedding=$1::vector WHERE doc_id=$2", [L.pgVector(vec), doc.docId]);
  }
  async function nearest(vec, model, k) {
    await initStore();
    if (store.mode === "pgvector") {
      try {
        return await db.all("SELECT doc_id, kind, ref_id, post_id, 1 - (embedding <=> $1::vector) AS score FROM assistant_vectors WHERE model=$2 AND dims=$3 AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $4",
          [L.pgVector(vec), model, vec.length, k]);
      } catch (e) { logger.warn?.("assistant: pgvector query failed, JS fallback", { err: e.message }); }
    }
    const rows = await db.all("SELECT doc_id, kind, ref_id, post_id, vec FROM assistant_vectors WHERE model=$1 AND dims=$2 ORDER BY updated_at DESC LIMIT $3", [model, vec.length, cfg.scanMax]);
    return L.topK(vec, rows, k, 0.05);
  }
  /** index pending public posts + comments (newest first). Cost → ai_period_stats feature assistant_index (no user ids). */
  async function indexPending(limit = cfg.batch) {
    if (!provider) return { indexed: 0, skipped: "not_configured" };
    await initStore();
    try { await ai().checkCaps(null, "assistant", null, 0); } catch { return { indexed: 0, skipped: "budget" }; } // global provider budget
    const posts = await db.all(`SELECT p.* FROM posts p LEFT JOIN assistant_vectors v ON v.doc_id = 'post:' || p.id WHERE p.status='published' AND p.visibility='public' AND v.doc_id IS NULL ORDER BY p.created_at DESC LIMIT $1`, [limit * 2]);
    const docs = [];
    for (const p of posts) { if (docs.length >= limit) break; if (!(await eligiblePost(p))) continue; const text = [p.title, p.text].filter((x) => typeof x === "string" && x.trim()).join("\n\n").slice(0, cfg.docChars); if (text.trim().length >= 3) docs.push({ docId: "post:" + p.id, kind: "post", ref: p.id, postId: p.id, text }); }
    if (docs.length < limit) {
      const cs = await db.all(`SELECT c.id, c.text, c.post FROM comments c JOIN posts p ON p.id=c.post LEFT JOIN assistant_vectors v ON v.doc_id = 'comment:' || c.id WHERE c.status='published' AND p.status='published' AND p.visibility='public' AND v.doc_id IS NULL ORDER BY c.created_at DESC LIMIT $1`, [limit * 2]);
      for (const c of cs) { if (docs.length >= limit) break; if (!(await eligiblePost(await db.get("SELECT * FROM posts WHERE id=$1", [c.post])))) continue; const text = String(c.text || "").slice(0, cfg.docChars); if (text.trim().length >= 3) docs.push({ docId: "comment:" + c.id, kind: "comment", ref: c.id, postId: c.post, text }); }
    }
    if (!docs.length) return { indexed: 0 };
    let out;
    try { out = await provider.embed(docs.map((d) => d.text)); } catch (e) { logger.warn?.("assistant index: provider error", { err: e.message }); return { indexed: 0, skipped: "provider_error" }; }
    const model = out.model || provider.embedModel || provider.name;
    let n = 0;
    for (let i = 0; i < docs.length; i++) { const v = out.vectors?.[i]; if (!Array.isArray(v) || !v.length) continue; await upsert(docs[i], v, model, L.hashText(model, docs[i].text)); n++; }
    const chars = docs.reduce((s, d) => s + d.text.length, 0), period = nowIso().slice(0, 7);
    await db.run(`INSERT INTO ai_period_stats(period,feature,provider,requests,chars,cache_hits,cost_micros) VALUES($1,'assistant_index',$2,1,$3,0,$4)
      ON CONFLICT (period, feature, provider) DO UPDATE SET requests=ai_period_stats.requests+1, chars=ai_period_stats.chars+$3, cost_micros=ai_period_stats.cost_micros+$4`, [period, provider.name, chars, Math.max(0, Math.round(out.costMicros || 0))]);
    return { indexed: n };
  }
  const forget = (postId) => db.run("DELETE FROM assistant_vectors WHERE post_id=$1", [postId]).catch(() => { });

  /** nearest docs the viewer can see that are still public; with their text */
  async function retrieve(user, vec, model, k) {
    const out = [];
    for (const h of await nearest(vec, model, k * 3)) {
      if (out.length >= k) break;
      try { const s = await publicSource(h.kind, h.ref_id, user.id); out.push({ kind: h.kind, id: h.ref_id, postId: s.postId, score: Math.round(Number(h.score) * 1000) / 1000, text: s.text }); }
      catch { /* deleted / hidden / no longer public / blocked: skip */ }
    }
    return out;
  }
  const snippet = (t) => (t.length > 220 ? t.slice(0, 220).replace(/\s+\S*$/, "") + "…" : t);

  /* ---------- features ---------- */
  async function write(user, b) {
    const ent = await gate(user, { allowOwn: true });
    const mode = typeof b.mode === "string" && L.MODES[b.mode] ? b.mode : null; if (!mode) throw fail(400, "bad_request", "نوع المساعدة غير صالح");
    const text = str(b.text, cfg.maxInput, { required: true }).trim(); if (!text) throw E.bad("اكتب نصاً أولاً");
    const out = await chat(user, ent, L.writePrompt(mode, text), text.length, { maxTokens: Math.min(1200, Math.ceil(text.length * 1.5) + 50) });
    const t = out.text.trim(); if (!t) throw fail(503, "provider_error", "تعذّر الوصول إلى المساعد الآن، حاول لاحقاً");
    return { mode, text: t.slice(0, cfg.maxInput * 2), ai: true, label: L.LABEL, provider: ent.own ? ent.own.name : provider.name };
  }
  async function replies(user, b) {
    const ent = await gate(user, { allowOwn: true });
    const src = await publicSource(b.kind, b.id, user.id);
    const draft = b.draft == null || b.draft === "" ? "" : str(b.draft, 1000).trim();
    const out = await chat(user, ent, L.repliesPrompt(src.text, draft), src.text.length + draft.length, { maxTokens: 400, json: true });
    const list = L.cleanReplies(out.text); if (!list.length) throw fail(503, "provider_error", "تعذّر الوصول إلى المساعد الآن، حاول لاحقاً");
    return { kind: b.kind, id: b.id, suggestions: list, ai: true, label: L.LABEL, provider: ent.own ? ent.own.name : provider.name };
  }
  async function search(user, b) {
    const ent = await gate(user);
    const q = str(b.q, 300, { required: true }).trim(); if (q.length < 2) throw E.bad("عبارة البحث قصيرة");
    const e = await embedFor(user, ent, q);
    const hits = await retrieve(user, e.vec, e.model, Math.min(20, Math.max(1, Number(b.limit) || 10)));
    return { q, store: store.mode, items: hits.map((h) => ({ kind: h.kind, id: h.id, postId: h.postId, score: h.score, snippet: snippet(h.text), href: "#/post/" + h.postId })), ai: true };
  }
  async function ask(user, b) {
    const ent = await gate(user);
    const q = str(b.q, 500, { required: true }).trim(); if (q.length < 3) throw E.bad("السؤال قصير");
    const e = await embedFor(user, ent, q);
    const hits = await retrieve(user, e.vec, e.model, cfg.k);
    if (!hits.length) return { q, points: [], sources: [], grounded: "none", note: "لم أجد في محتوى المجتمع العام ما يجيب عن سؤالك", ai: true, label: L.LABEL };
    const srcs = hits.map((h, i) => ({ id: "s" + (i + 1), text: h.text }));
    const out = await chat(user, ent, L.askPrompt(q, srcs), q.length + srcs.reduce((s, x) => s + x.text.length, 0), { maxTokens: 500, json: true });
    let { kept } = verify(L.parseJson(out.text)?.points, srcs), grounded = "model";
    if (!kept.length) { kept = extractive({ sources: srcs, maxPoints: 3 }).points; grounded = "extractive"; } // verbatim sentences rather than an unsupported answer
    const used = new Set(kept.flatMap((p) => p.cites));
    return { q, points: kept, grounded, store: store.mode, ai: true, label: L.LABEL,
      sources: hits.map((h, i) => ({ id: "s" + (i + 1), kind: h.kind, refId: h.id, postId: h.postId, snippet: snippet(h.text), href: "#/post/" + h.postId, cited: used.has("s" + (i + 1)) })) };
  }
  async function config() {
    await seed();
    return { available: !!provider, provider: provider ? provider.name : null, ...(provider ? {} : { note: L.NOT_ON }), modes: Object.keys(L.MODES), label: L.LABEL, store: (await initStore(), store.mode), transparency: L.TRANSPARENCY };
  }
  async function me(user) {
    await seed();
    const ent = await ai().entitled(user.id, "assistant");
    const lim = await limitsFor(ent.ok ? ent : { plan: "ai_plus" });
    const u = (await db.get("SELECT * FROM ai_usage WHERE user_id=$1 AND period=$2 AND feature='assistant'", [user.id, nowIso().slice(0, 7)])) || { requests: 0, chars: 0 };
    return { entitled: !!ent.ok, available: !!provider, ...(provider ? {} : { note: L.NOT_ON }),
      usage: { period: nowIso().slice(0, 7), requests: Number(u.requests), chars: Number(u.chars), limitChars: lim.chars, pct: lim.chars ? Math.min(100, Math.round((Number(u.chars) / lim.chars) * 100)) : 0 } };
  }
  const admin = (fn) => A(async (req, res) => { if (req.user?.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  async function status() {
    await initStore();
    const n = await db.get("SELECT COUNT(*) AS n FROM assistant_vectors");
    return { available: !!provider, provider: provider ? provider.name : null, store: store.mode, docs: Number(n.n) };
  }

  /* ---------- events + job ---------- */
  bus.on("POST_DELETED", (e) => e?.post && forget(e.post));
  bus.on("POST_UPDATED", (e) => e?.post && forget(e.post)); // re-indexed by the next run with the new text (and only if still public)
  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.ASSISTANT_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("assistant.index", +(env.ASSISTANT_INDEX_INTERVAL_MS || 10 * 60e3), () => indexPending());

  /* ---------- routes ---------- */
  R.get("/api/assistant/config", async () => config());
  R.get("/api/assistant/me", A(async (req) => me(req.user)));
  R.post("/api/assistant/write", A(async (req) => write(req.user, req.body || {})));
  R.post("/api/assistant/replies", A(async (req) => replies(req.user, req.body || {})));
  R.post("/api/assistant/ask", A(async (req) => ask(req.user, req.body || {})));
  R.post("/api/assistant/search", A(async (req) => search(req.user, req.body || {}))); // POST: the query never lands in access logs
  R.get("/api/admin/assistant/status", admin(async () => status()));
  R.post("/api/admin/assistant/reindex", admin(async () => indexPending()));

  return { indexPending, status, store, seed, setProvider: (p) => { provider = p; }, eligiblePost };
};
