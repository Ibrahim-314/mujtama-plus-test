/* Phase 42 — AI assistant «المساعد الذكي». Stub provider via config.assistantOpts.provider (records everything it receives, to prove
 * that only public content / the user's own draft ever leaves the server). SQLite by default and PostgreSQL with TEST_DATABASE_URL
 * (vector store: pgvector when already installed, else JS cosine — the scratch PG has no extension → JS path).
 * Covers: migration 025 (down/up, static additive), pure helpers (vectors, cosine top-k, reply parsing, provider HTTP shapes, env-key
 * only), gate (401, 402 + upsell for non-subscribers, plan seeded once with `assistant`, admin removal respected, 503 not_configured
 * «المساعد الذكي غير مفعّل بعد» without a provider), writing modes, polite replies (public only: 409 private_content, 404 invisible),
 * indexing public posts/comments only (no followers-only, paid or private-community content), semantic search, cited Q&A
 * (verification drops unsupported points → extractive fallback), caps (usage_limit) + metering, deletion forgets vectors, admin status. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/assistant-lib");

const DIM = 64;
const toks = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2);
const h = (w) => { let x = 0; for (const c of w) x = (x * 31 + c.codePointAt(0)) >>> 0; return x % DIM; };
const emb = (t) => { const v = new Array(DIM).fill(0); for (const w of toks(t)) v[h(w)] += 1; return v; };
const seen = []; // every string the provider received
let askMode = "good";
const stub = {
  name: "stub", private: true, model: "stub-chat", embedModel: "stub-embed",
  async embed(texts) { seen.push(...texts); return { vectors: texts.map(emb), costMicros: 5 * texts.length, model: "stub-embed" }; },
  async chat(messages) {
    const all = messages.map((m) => m.content).join("\n"); seen.push(all);
    const sys = messages[0].content, user = messages[1].content;
    if (/ثلاثة ردود/.test(sys)) return { text: JSON.stringify({ replies: ["شكراً على المشاركة المفيدة", "فكرة رائعة، أتفق معك", "شكراً على المشاركة المفيدة", "سؤال جميل"] }), costMicros: 20 };
    if (/أجب عن السؤال/.test(sys)) {
      const m = /\[s1\] ([^\n]+)/.exec(user);
      if (askMode === "bad") return { text: JSON.stringify({ points: [{ text: "سعر الاشتراك 999 دولار في المريخ", cites: ["s1"] }, { text: "x", cites: ["s9"] }] }), costMicros: 30 };
      return { text: JSON.stringify({ points: [{ text: m[1].split(/[.،]/)[0], cites: ["s1"] }] }), costMicros: 30 };
    }
    return { text: "✓ " + user, costMicros: 10 };
  }
};

let H, admin, sara, bob, lina;
const db = () => H.app.ctx.db;
const as = () => H.app.ctx.services.assistant;
const P = {};
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);
  return c;
};
const post = async (c, text, extra = {}) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/posts", { text, ...extra }); assert.equal(r.status, 200, r.error); return r.post.id; };
const grant = async (c) => { const r = await admin.req("POST", "/api/admin/ai/grants", { user: c.handle, days: 30 }); assert.equal(r.status, 200, r.error); };

test.before(async () => {
  H = await boot({ piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { env: { AI_PROVIDER_MONTHLY_USD: "5" }, jobs: false },
    translateOpts: { env: {} }, assistantOpts: { provider: stub, jobs: false, env: {} } });
  admin = await mk("as_admin"); sara = await mk("as_sara"); bob = await mk("as_bob"); lina = await mk("as_lina");
  P.code = await post(bob, "تعلم البرمجة خطوة بخطوة هو أفضل طريق لبدء مسيرتك المهنية في التقنية. ابدأ بلغة بايثون ثم انتقل إلى الويب");
  P.food = await post(lina, "أفضل مطاعم المأكولات البحرية في جدة على الكورنيش، والسمك الطازج يومياً");
  P.priv = await post(bob, "سرّي للمتابعين فقط: خطة البرمجة الخاصة بي", { visibility: "followers" });
  H.app.ctx.rl.w.clear();
  const c = await lina.req("POST", "/api/comments", { post: P.food, text: "أنصح بمطعم السمك الطازج قرب الكورنيش" });
  assert.equal(c.status, 200, c.error); P.foodComment = c.comment?.id || (await db().get("SELECT id FROM comments WHERE post=$1", [P.food])).id;
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 025: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '025_assistant' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "025_assistant"]);
  await assert.rejects(() => db().get("SELECT 1 FROM assistant_vectors"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ai_plans")).n) >= 0, "024 tables untouched");
  assert.deepEqual(await mig.up(db()), ["025_assistant", ...later]);
  for (const t of ["assistant_vectors", "assistant_meta"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some((x) => x.file === "025_assistant.js"));
});

test("helpers: vectors, cosine top-k, replies parsing, env-key-only OpenAI-compatible provider", async () => {
  const v = [0.5, -1.25, 3, 0];
  assert.deepEqual(Array.from(L.decodeVec(L.encodeVec(v))), v);
  assert.ok(Math.abs(L.cosine([1, 0], [1, 0]) - 1) < 1e-9 && L.cosine([1, 0], [0, 1]) === 0);
  const top = L.topK([1, 0, 0], [{ id: "a", vec: L.encodeVec([0, 1, 0]) }, { id: "b", vec: L.encodeVec([0.9, 0.1, 0]) }, { id: "c", vec: L.encodeVec([1, 1]) }], 2);
  assert.deepEqual(top.map((x) => x.id), ["b", "a"]); assert.equal(top[0].vec, undefined);
  assert.equal(L.pgVector([1, 0.5]), "[1,0.5]");
  assert.deepEqual(L.cleanReplies('{"replies":["أ","ب","أ","ج","د"]}'), ["أ", "ب", "ج"]);
  assert.deepEqual(L.cleanReplies("1. شكراً\n- رائع"), ["شكراً", "رائع"]);
  assert.equal(L.createProvider({}), null, "no key → no provider");
  const calls = [];
  const f = async (url, o) => { calls.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization });
    return { ok: true, json: async () => (url.endsWith("/embeddings") ? { data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 1e6 } } : { choices: [{ message: { content: "مرحبا" } }], usage: { prompt_tokens: 1e6, completion_tokens: 0 } }) }; };
  const p = L.createProvider({ ASSISTANT_API_KEY: "k1", ASSISTANT_BASE_URL: "https://llm.local/v1/", ASSISTANT_USD_PER_MTOK_IN: "0.15" }, { fetch: f });
  assert.equal(p.private, true);
  assert.deepEqual(await p.chat([{ role: "user", content: "x" }], { json: true }), { text: "مرحبا", costMicros: 0.15 * 1e6 });
  const e = await p.embed(["a", "b"]); assert.deepEqual(e.vectors, [[1], [2]]); assert.equal(e.costMicros, 0, "no embed rate in env → 0, never hard-coded");
  assert.equal(calls[0].url, "https://llm.local/v1/chat/completions"); assert.equal(calls[0].auth, "Bearer k1"); assert.equal(calls[0].body.response_format.type, "json_object");
  assert.equal(calls[1].url, "https://llm.local/v1/embeddings"); assert.equal(calls[1].body.model, "text-embedding-3-small");
  assert.ok(L.TRANSPARENCY.never.some((x) => /المشفّرة/.test(x)));
});

test("gate: 401, non-subscriber 402 + upsell, plan seeded once with assistant, config + transparency", async () => {
  const anon = new H.Client();
  assert.equal((await anon.req("POST", "/api/assistant/write", { text: "x", mode: "improve" })).status, 401);
  const cfg = await anon.req("GET", "/api/assistant/config");
  assert.equal(cfg.status, 200); assert.equal(cfg.available, true); assert.equal(cfg.store, "js"); // scratch PG has no pgvector; SQLite always js
  assert.equal(cfg.transparency.title, "ما الذي يراه المساعد؟"); assert.deepEqual(cfg.modes, ["rephrase", "improve", "shorter", "polite"]);
  const plan = await db().get("SELECT features FROM ai_plans WHERE slug='ai_plus'");
  assert.deepEqual(JSON.parse(typeof plan.features === "string" ? plan.features : JSON.stringify(plan.features)), ["translate", "assistant"]);
  const r = await sara.req("POST", "/api/assistant/write", { text: "مرحبا", mode: "improve" });
  assert.equal(r.status, 402); assert.equal(r.code, "subscription_required"); assert.ok(r.upsell?.plan?.features.includes("assistant"));
  const me = await sara.req("GET", "/api/assistant/me"); assert.equal(me.entitled, false); assert.equal(me.available, true);
  assert.equal((await sara.req("GET", "/api/ai/me")).entitlements.assistant, false);
  // an admin removing the feature is respected (seed runs once)
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { features: ["translate"] })).status, 200);
  await as().seed(); assert.ok(!(await anon.req("GET", "/api/ai/config")).plans[0].features.includes("assistant"));
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { features: ["translate", "assistant"] })).status, 200);
  await grant(sara); await grant(bob);
  assert.equal((await sara.req("GET", "/api/assistant/me")).entitled, true);
  // no provider key → 503 «المساعد الذكي غير مفعّل بعد»
  as().setProvider(null);
  const off = await sara.req("POST", "/api/assistant/write", { text: "مرحبا", mode: "improve" });
  assert.equal(off.status, 503); assert.equal(off.code, "not_configured"); assert.equal(off.error, "المساعد الذكي غير مفعّل بعد");
  assert.equal((await anon.req("GET", "/api/assistant/config")).note, "المساعد الذكي غير مفعّل بعد");
  assert.deepEqual(await as().indexPending(), { indexed: 0, skipped: "not_configured" });
  as().setProvider(stub);
});

test("writing assistant: modes, validation, metering in ai_usage", async () => {
  for (const mode of ["rephrase", "improve", "shorter", "polite"]) {
    const r = await sara.req("POST", "/api/assistant/write", { text: "اريد ان اكتب منشور جميل", mode });
    assert.equal(r.status, 200, r.error); assert.equal(r.text, "✓ اريد ان اكتب منشور جميل"); assert.equal(r.ai, true); assert.equal(r.label, "مقترح من المساعد الذكي");
  }
  assert.equal((await sara.req("POST", "/api/assistant/write", { text: "x", mode: "hack" })).status, 400);
  assert.equal((await sara.req("POST", "/api/assistant/write", { text: "", mode: "improve" })).status, 400);
  const u = await db().get("SELECT * FROM ai_usage WHERE user_id=$1 AND feature='assistant'", [sara.id]);
  assert.equal(Number(u.requests), 4); assert.equal(Number(u.chars), 4 * "اريد ان اكتب منشور جميل".length); assert.equal(Number(u.cost_micros), 40);
  const me = await sara.req("GET", "/api/assistant/me"); assert.equal(me.usage.requests, 4); assert.equal(me.usage.limitChars, 100000);
});

test("polite replies: public content only (409 private_content), invisible → 404", async () => {
  const r = await sara.req("POST", "/api/assistant/replies", { kind: "post", id: P.code, draft: "حلو" });
  assert.equal(r.status, 200, r.error); assert.deepEqual(r.suggestions, ["شكراً على المشاركة المفيدة", "فكرة رائعة، أتفق معك", "سؤال جميل"]);
  assert.equal((await sara.req("POST", "/api/assistant/replies", { kind: "comment", id: P.foodComment })).status, 200);
  assert.equal((await sara.req("POST", "/api/assistant/replies", { kind: "post", id: P.priv })).status, 404, "sara cannot see it");
  const own = await bob.req("POST", "/api/assistant/replies", { kind: "post", id: P.priv });
  assert.equal(own.status, 409); assert.equal(own.code, "private_content");
  assert.equal((await sara.req("POST", "/api/assistant/replies", { kind: "message", id: "x" })).status, 400, "messages are never read");
  assert.ok(!seen.some((s) => s.includes("سرّي")), "private post text never reached the provider");
});

test("vector index (public only) + semantic search + cited Q&A with verification fallback", async () => {
  const before = seen.length;
  const r = await as().indexPending();
  assert.equal(r.indexed, 3, JSON.stringify(r)); // 2 public posts + 1 public comment
  assert.deepEqual((await as().indexPending()).indexed, 0, "idempotent");
  const docs = (await db().all("SELECT doc_id, model, dims FROM assistant_vectors ORDER BY doc_id")).map((x) => x.doc_id);
  assert.ok(docs.includes("post:" + P.code) && docs.includes("comment:" + P.foodComment) && !docs.includes("post:" + P.priv));
  assert.ok(!seen.slice(before).some((s) => s.includes("سرّي")), "followers-only content never embedded");
  const cols = (await db().all("SELECT * FROM assistant_vectors")).flatMap((x) => Object.values(x).map(String));
  for (const u of [bob.id, lina.id]) assert.ok(!cols.includes(u), "no user ids in the vector store");
  const st = await db().get("SELECT * FROM ai_period_stats WHERE feature='assistant_index'"); assert.equal(Number(st.cost_micros), 15);

  const s = await sara.req("POST", "/api/assistant/search", { q: "مطاعم السمك الطازج في جدة" });
  assert.equal(s.status, 200, s.error); assert.equal(s.store, "js");
  assert.equal(s.items[0].postId, P.food); assert.ok(s.items[0].href === "#/post/" + P.food && s.items[0].score > 0);
  assert.ok(!s.items.some((x) => x.postId === P.priv));

  const a = await sara.req("POST", "/api/assistant/ask", { q: "كيف أبدأ تعلم البرمجة؟" });
  assert.equal(a.status, 200, a.error); assert.equal(a.grounded, "model");
  assert.equal(a.points.length, 1); assert.deepEqual(a.points[0].cites, ["s1"]);
  assert.equal(a.sources[0].postId, P.code); assert.equal(a.sources[0].cited, true); assert.match(a.points[0].text, /تعلم البرمجة/);
  askMode = "bad";
  const b = await sara.req("POST", "/api/assistant/ask", { q: "كيف أبدأ تعلم البرمجة؟" });
  assert.equal(b.status, 200); assert.equal(b.grounded, "extractive", "unsupported numbers / unknown citations are dropped");
  assert.ok(!b.points.some((p) => /999/.test(p.text))); assert.ok(b.points.length >= 1);
  askMode = "good";
  // a post that becomes invisible is skipped at query time; deletion forgets its vectors
  H.app.ctx.rl.w.clear();
  assert.equal((await lina.req("DELETE", "/api/posts/" + P.food)).status, 200);
  await new Promise((r2) => setTimeout(r2, 50));
  assert.ok(!(await db().get("SELECT 1 x FROM assistant_vectors WHERE post_id=$1", [P.food])));
  const s2 = await sara.req("POST", "/api/assistant/search", { q: "مطاعم السمك الطازج في جدة" });
  assert.ok(!s2.items.some((x) => x.postId === P.food));
  const none = await sara.req("POST", "/api/assistant/ask", { q: "ما هو الطقس على المريخ؟" });
  assert.equal(none.status, 200); if (!none.points.length) assert.match(none.note, /لم أجد/);
});

test("caps: plan limits for assistant → 429 usage_limit; admin status", async () => {
  const p = await db().get("SELECT limits FROM ai_plans WHERE slug='ai_plus'");
  const lim = typeof p.limits === "string" ? JSON.parse(p.limits) : p.limits || {};
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { assistant: { chars: -1, costUsd: 1 } } })).status, 400);
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { assistant: { chars: 10, costUsd: 1 } } })).status, 200);
  const pl = await db().get("SELECT limits FROM ai_plans WHERE slug='ai_plus'"); const pj = typeof pl.limits === "string" ? JSON.parse(pl.limits) : pl.limits;
  assert.deepEqual(pj.assistant, { chars: 10, costUsd: 1 }); if (lim.translate) assert.deepEqual(pj.translate, lim.translate);
  const r = await bob.req("POST", "/api/assistant/write", { text: "نص طويل يتجاوز الحد المسموح", mode: "improve" });
  assert.equal(r.status, 429); assert.equal(r.code, "usage_limit");
  await db().run("UPDATE ai_plans SET limits=$1 WHERE slug='ai_plus'", [JSON.stringify(lim)]);
  assert.equal((await sara.req("GET", "/api/admin/assistant/status")).status, 403);
  const s = await admin.req("GET", "/api/admin/assistant/status");
  assert.equal(s.status, 200); assert.equal(s.store, "js"); assert.ok(s.docs >= 1);
});
