/* Phase 41 — AI subscriptions «مجتمع+ ذكاء» + real translation + interface languages. Stubbed Pi Platform API (same stub as
 * ads/market tests via config.piOpts), stubbed translation provider via config.translateOpts.provider, injectable clock.
 * SQLite by default and PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 024 (down/up, static additive), pure helpers (language detection, hashing, provider selection + privacy flags,
 * provider HTTP shapes for deepl/openai/libre), i18n (config, user language, admin overrides, versions, aggregated misses),
 * entitlements (402 + upsell, minors 403, price unset, Pi off → not_configured, admin price), Pi subscription (intent purpose ai →
 * active, ledger journal platform:ai, renew extends, cancel/resume, refund cuts the period), staff grants/revoke, translation of
 * posts/comments/messages (access checks, same-language free, shared cache across users, scopes, E2EE plaintext with consent,
 * never cached, private-provider rule for messages, delete purges), caps (usage_limit, budget_exhausted), batch, legacy route,
 * no provider → 503 not_configured, maintenance (reminder once, expiry), finance (revenue vs provider cost), compliance map. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_ai_41";
const TOKEN = (uid, name) => `at-secret-${uid}-${name}`;
const payments = new Map();
let seq = 0;
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
const pay = (o) => { const p = { identifier: "aipay_" + (++seq), user_uid: o.uid, amount: o.amount, memo: o.memo || "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", created_at: new Date().toISOString(), status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
async function fakeFetch(url, o = {}) {
  if (new URL(url).pathname === "/pi/auth/v1/login") {
    const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || ""));
    return m ? res(200, { sessionToken: "st-" + m[1], user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {});
  }
  const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path);
  const p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  const body = o.body ? JSON.parse(o.body) : {};
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const PI_ENV = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_MAX_AMOUNT: "1000" };
const DAY = 864e5;
let offset = 0;
const now = () => new Date(Date.now() + offset);

/* stub provider: records every text it receives (to prove caching / privacy) */
const calls = [];
const stub = { name: "stub", private: true, supports: (l) => ["ar", "en", "fr", "ur"].includes(l),
  async translate(text, target) { calls.push({ text, target }); if (text.includes("FAILME")) throw new Error("boom"); return { text: `[${target}] ${text}`, costMicros: text.length * 10 }; } };

let H, admin, sara, omar, lina, minnie, bob;
const db = () => H.app.ctx.db;
const ai = () => H.app.ctx.services.ai;
const P = {};
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
  return c;
};
const linkPi = async (c) => { const r = await c.req("POST", "/api/pi/auth", { accessToken: TOKEN(c.handle.replace(/_/g, ""), c.handle), link: true }); assert.equal(r.status, 200, r.error); c.uid = "uid_" + c.handle.replace(/_/g, ""); };
const settle = async () => { await H.app.ctx.services.paid.settle(); await ai().settle(); };
async function payIntent(c, intent) {
  const p = pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
  const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
  p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
  const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
  await settle();
  return p;
}
const check = async () => { const r = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(r.status, 200); assert.equal(r.balanced, true, JSON.stringify(r.imbalances)); };
const balance = async (account) => { const r = await db().get("SELECT COALESCE(SUM(credit),0) AS c, COALESCE(SUM(debit),0) AS d FROM ledger_entries WHERE account=$1", [account]); return (Number(r.c) - Number(r.d)) / 1e7; };
const post = async (c, text, extra = {}) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/posts", { text, ...extra }); assert.equal(r.status, 200, r.error); return r.post.id; };
const tr = async (c, body) => { H.app.ctx.rl.w.clear(); return c.req("POST", "/api/ai/translate", body); };
async function dm(a, b, text, { e2ee = false, ttl = 0 } = {}) {
  const at = new Date().toISOString(), cid = "cv_ai" + (++seq), mid = "mg_ai" + (++seq);
  await db().run("INSERT INTO conversations(id,created_at,updated_at,kind,e2ee,ttl) VALUES($1,$2,$2,'dm',$3,$4)", [cid, at, e2ee ? 1 : 0, ttl]);
  for (const u of [a, b]) await db().run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at) VALUES($1,$2,'accepted','member',$3)", [cid, u.id, at]);
  await db().run("INSERT INTO messages(id,conv,sender,text,created_at,kind,payload) VALUES($1,$2,$3,$4,$5,'text',$6)", [mid, cid, a.id, e2ee ? "" : text, at, e2ee ? JSON.stringify({ v: 1, iv: "x", ct: "opaque" }) : null]);
  return { cid, mid };
}

test.before(async () => {
  H = await boot({ piOpts: { env: PI_ENV, fetch: fakeFetch, jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false, now },
    aiOpts: { env: { AI_PROVIDER_MONTHLY_USD: "5" }, now, jobs: false }, translateOpts: { provider: stub, now, jobs: false, env: {} } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, body: j, status: r.status, headers: r.headers };
  };
  admin = await mk("ai_admin"); sara = await mk("ai_sara"); omar = await mk("ai_omar"); lina = await mk("ai_lina"); minnie = await mk("ai_minnie"); bob = await mk("ai_bob");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
  for (const c of [sara, omar, minnie]) await linkPi(c);
  assert.equal((await minnie.req("POST", "/api/age", { birthDate: "2012-05-01" })).status, 200);
  P.en = await post(bob, "Learning to code step by step is the best way to start your career in tech");
  P.ar = await post(bob, "تعلم البرمجة خطوة بخطوة هو أفضل طريق لبدء مسيرتك");
  P.fr = await post(lina, "Nous organisons une rencontre pour les développeurs à Djeddah cette semaine");
  P.priv = await post(bob, "This post is only for my followers and nobody else", { visibility: "followers" });
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 024: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '024_ai_translate' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "024_ai_translate"]);
  await assert.rejects(() => db().get("SELECT 1 FROM ai_plans"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ad_campaigns")).n) >= 0, "023 tables untouched");
  assert.deepEqual(await mig.up(db()), ["024_ai_translate", ...later]);
  for (const t of ["ai_plans", "ai_subscriptions", "ai_payments", "ai_usage", "ai_period_stats", "translations_cache", "translate_prefs", "ui_strings", "ui_string_misses"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some((x) => x.file === "024_ai_translate.js"));
});

test("pure helpers: language detection, hashing, provider selection and privacy, provider HTTP shapes", async () => {
  const T = require("../lib/translate");
  assert.equal(T.detectLang("مرحبا بكم في مجتمع بلس"), "ar");
  assert.equal(T.detectLang("یہ ایک اچھا دن ہے اور میں خوش ہوں"), "ur");
  assert.equal(T.detectLang("Hello and welcome to the community, this is great"), "en");
  assert.equal(T.detectLang("Bonjour et bienvenue dans la communauté, nous sommes très heureux"), "fr");
  assert.equal(T.detectLang("😀 123 https://x.y #وسم"), null);
  assert.equal(T.hashOf("", "a  b\n c"), T.hashOf("", " a b c "));
  assert.notEqual(T.hashOf("", "abc"), T.hashOf("m:cv1", "abc"), "scope is part of the key");
  assert.equal(T.createProvider({}), null, "no keys → no provider");
  assert.equal(T.createProvider({ AI_TRANSLATE_PROVIDER: "none", DEEPL_API_KEY: "k" }), null);
  const libreOpen = T.createProvider({ TRANSLATE_URL: "https://lt.example/translate" });
  assert.equal(libreOpen.name, "libre"); assert.equal(libreOpen.private, false, "keyless public LibreTranslate is not private");
  assert.equal(T.createProvider({ TRANSLATE_URL: "https://lt/x", TRANSLATE_KEY: "k" }).private, true);
  assert.equal(T.createProvider({ TRANSLATE_URL: "http://lt.internal/translate", TRANSLATE_PRIVATE: "1" }).private, true);
  assert.equal(T.createProvider({ DEEPL_API_KEY: "k:fx", OPENAI_API_KEY: "o", TRANSLATE_URL: "u" }).name, "deepl", "auto order deepl > openai > libre");
  assert.equal(T.createProvider({ AI_TRANSLATE_PROVIDER: "openai", DEEPL_API_KEY: "k", OPENAI_API_KEY: "o" }).name, "openai");
  assert.equal(T.createProvider({ DEEPL_API_KEY: "k" }).supports("ur"), false, "DeepL has no Urdu");
  const seen = [];
  const f = async (url, o) => { seen.push({ url, o }); const b = JSON.parse(o.body);
    if (url.includes("deepl")) return res(200, { translations: [{ text: "DL:" + b.text[0] }] });
    if (url.includes("chat/completions")) return res(200, { choices: [{ message: { content: " OA:" + b.messages[1].content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
    return res(200, { translatedText: "LT:" + b.q }); };
  const d = await T.createProvider({ DEEPL_API_KEY: "abc:fx" }, { fetch: f }).translate("مرحبا", "fr");
  assert.equal(d.text, "DL:مرحبا"); assert.match(seen[0].url, /api-free\.deepl\.com/); assert.equal(seen[0].o.headers.Authorization, "DeepL-Auth-Key abc:fx"); assert.equal(JSON.parse(seen[0].o.body).target_lang, "FR");
  const o = await T.createProvider({ OPENAI_API_KEY: "sk", OPENAI_BASE_URL: "https://llm.example/v1/" }, { fetch: f }).translate("hi", "ar");
  assert.equal(o.text, "OA:hi"); assert.equal(seen[1].url, "https://llm.example/v1/chat/completions"); assert.equal(seen[1].o.headers.Authorization, "Bearer sk"); assert.ok(o.costMicros > 0);
  const l = await T.createProvider({ TRANSLATE_URL: "https://lt/translate", TRANSLATE_KEY: "kk" }, { fetch: f }).translate("hi", "ur", "en");
  assert.equal(l.text, "LT:hi"); assert.equal(JSON.parse(seen[2].o.body).api_key, "kk"); assert.equal(JSON.parse(seen[2].o.body).source, "en");
  await assert.rejects(() => T.createProvider({ DEEPL_API_KEY: "x" }, { fetch: async () => res(500, {}) }).translate("a", "en"), /provider_error/);
});

test("i18n (free): languages, user language, admin string overrides, versions, aggregated misses", async () => {
  const anon = new H.Client();
  const cfg = await anon.req("GET", "/api/i18n/config");
  assert.equal(cfg.status, 200);
  assert.deepEqual(cfg.languages.map((l) => l.code + ":" + l.dir), ["ar:rtl", "en:ltr"]);
  assert.equal(cfg.default, "ar"); assert.equal(cfg.free, true);
  assert.equal((await anon.req("GET", "/api/i18n/strings?lang=xx")).code, "lang_unsupported");
  assert.equal((await sara.req("PUT", "/api/me/lang", { lang: "de" })).status, 400);
  // v2.67: the interface is Arabic + English only — fr / ur are rejected on write …
  for (const L of ["fr", "ur"]) { const r = await sara.req("PUT", "/api/me/lang", { lang: L }); assert.equal(r.status, 400); assert.equal(r.code, "lang_unsupported"); }
  for (const L of ["fr", "ur"]) assert.equal((await anon.req("GET", "/api/i18n/strings?lang=" + L)).code, "lang_unsupported");
  assert.deepEqual(Object.keys((await anon.req("GET", "/api/i18n/config")).versions), ["ar", "en"]);
  const ml = await sara.req("PUT", "/api/me/lang", { lang: "en" });
  assert.deepEqual([ml.lang, ml.dir], ["en", "ltr"]);
  assert.equal((await sara.req("GET", "/api/me/lang")).lang, "en");
  assert.equal((await db().get("SELECT lang FROM users WHERE id=$1", [sara.id])).lang, "en");
  // … and a stored legacy fr / ur reads back as English (no migration needed)
  for (const L of ["fr", "ur"]) { await db().run("UPDATE users SET lang=$1 WHERE id=$2", [L, sara.id]); assert.deepEqual(await sara.req("GET", "/api/me/lang").then((r) => [r.lang, r.dir]), ["en", "ltr"]); }
  await db().run("UPDATE users SET lang=$1 WHERE id=$2", ["xx", sara.id]); assert.equal((await sara.req("GET", "/api/me/lang")).lang, "ar");
  await sara.req("PUT", "/api/me/lang", { lang: "en" });
  // admin overrides
  assert.equal((await sara.req("PUT", "/api/admin/i18n/strings", { key: "الرئيسية", lang: "en", text: "Home (edited)" })).status, 403);
  const v0 = (await anon.req("GET", "/api/i18n/strings?lang=en")).version;
  assert.equal((await admin.req("PUT", "/api/admin/i18n/strings", { key: "<b>", lang: "en", text: "x" })).code, "string_invalid");
  assert.equal((await admin.req("PUT", "/api/admin/i18n/strings", { key: "الرئيسية", lang: "en", text: "<script>" })).code, "string_invalid");
  const put = await admin.req("PUT", "/api/admin/i18n/strings", { key: "الرئيسية", lang: "en", text: "Home (edited)" });
  assert.equal(put.status, 200, put.error);
  const s = await anon.req("GET", "/api/i18n/strings?lang=en");
  assert.equal(s.strings["الرئيسية"], "Home (edited)"); assert.notEqual(s.version, v0, "version busts on write"); assert.equal(s.dir, "ltr");
  assert.equal((await anon.req("GET", "/api/i18n/config")).versions.en, s.version);
  const list = await admin.req("GET", "/api/admin/i18n/strings?lang=en&q=edited");
  assert.equal(list.items.length, 1); assert.equal(list.items[0].updatedBy, admin.id);
  // misses: aggregated, Arabic sources only, no user ids
  for (const c of [anon, sara]) assert.equal((await c.req("POST", "/api/i18n/missing", { lang: "en", keys: ["إعدادات الخصوصية", "إعدادات الخصوصية", "plain", "الرئيسية"] })).counted, 2);
  assert.equal((await anon.req("POST", "/api/i18n/missing", { lang: "ar", keys: ["x"] })).counted, 0);
  const miss = await admin.req("GET", "/api/admin/i18n/missing?lang=en");
  assert.equal(miss.items.find((m) => m.key === "إعدادات الخصوصية").count, 2);
  const cols = (await db().all("SELECT * FROM ui_string_misses")).flatMap((r) => Object.values(r).map(String));
  for (const u of [sara.id]) assert.ok(!cols.includes(u), "no user id in ui_string_misses");
  // writing an override clears its miss
  await admin.req("PUT", "/api/admin/i18n/strings", { key: "إعدادات الخصوصية", lang: "en", text: "Privacy settings (edited)" });
  assert.ok(!(await admin.req("GET", "/api/admin/i18n/missing?lang=en")).items.some((m) => m.key === "إعدادات الخصوصية"));
  const del = await admin.req("DELETE", "/api/admin/i18n/strings", { key: "الرئيسية", lang: "en" });
  assert.equal(del.deleted, 1);
  assert.equal((await anon.req("GET", "/api/i18n/strings?lang=en")).strings["الرئيسية"], undefined);
});

test("entitlements: 402 + upsell for non-subscribers, minors 403, price unset, Pi off, admin sets price", async () => {
  const cfg = await new H.Client().req("GET", "/api/ai/config");
  assert.equal(cfg.status, 200);
  assert.equal(cfg.plans[0].slug, "ai_plus"); assert.equal(cfg.plans[0].name, "مجتمع+ ذكاء"); assert.deepEqual(cfg.plans[0].features, ["translate"]);
  assert.equal(cfg.plans[0].price, null, "no hard-coded price"); assert.equal(cfg.plans[0].priceNote, "لم يُحدَّد سعر الاشتراك بعد");
  assert.deepEqual(cfg.features.translate, { available: true, provider: "stub", private: true });
  assert.deepEqual(cfg.languages, ["ar", "en", "fr", "ur"]);
  const me = await sara.req("GET", "/api/ai/me");
  assert.equal(me.subscription, null); assert.deepEqual(me.entitlements, { translate: false, assistant: false });
  assert.equal(me.prefs.auto, true);
  const t = await tr(sara, { kind: "post", id: P.en });
  assert.equal(t.status, 402); assert.equal(t.code, "subscription_required"); assert.equal(t.upsell.plan.slug, "ai_plus");
  assert.equal(calls.length, 0, "nothing sent to the provider");
  assert.equal((await minnie.req("POST", "/api/ai/subscribe", {})).code, "minor_restricted");
  assert.equal((await sara.req("POST", "/api/ai/subscribe", { plan: "nope" })).status, 404);
  const pu = await sara.req("POST", "/api/ai/subscribe", {});
  assert.equal(pu.status, 409); assert.equal(pu.code, "price_unset");
  // admin price (no hard-coded price; admin wins)
  assert.equal((await sara.req("PUT", "/api/admin/ai/plans/ai_plus", { price: 1 })).status, 403);
  assert.equal((await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { price: -1 })).code, "plan_invalid");
  const up = await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { price: 2.5, limits: { translate: { chars: 100000, costUsd: 1 } } });
  assert.equal(up.status, 200, up.error); assert.equal(up.plan.price, 2.5); assert.equal(up.plan.limits.translate.chars, 100000);
  assert.equal((await admin.req("GET", "/api/admin/ai/plans")).plans[0].priceSetBy, "admin");
  // Pi off
  const pis = H.app.ctx.services.pi, orig = pis.enabled;
  pis.enabled = () => false;
  try {
    const r = await sara.req("POST", "/api/ai/subscribe", {});
    assert.equal(r.status, 409); assert.equal(r.code, "not_configured"); assert.equal(r.error, "مدفوعات Pi غير مفعّلة بعد");
    assert.equal((await new H.Client().req("GET", "/api/ai/config")).piNote, "مدفوعات Pi غير مفعّلة بعد");
  } finally { pis.enabled = orig; }
  assert.equal((await lina.req("POST", "/api/ai/subscribe", {})).code, "pi_not_linked");
});

test("subscription: Pi intent purpose ai → active + ledger platform:ai; renew extends; cancel/resume", async () => {
  const s = await sara.req("POST", "/api/ai/subscribe", {});
  assert.equal(s.status, 200, s.error); assert.equal(s.intent.amount, 2.5);
  const tx = await db().get("SELECT purpose, ref_id FROM pi_transactions WHERE id=$1", [s.intent.id]);
  assert.deepEqual({ ...tx }, { purpose: "ai", ref_id: "ai_plus" });
  assert.equal((await sara.req("POST", "/api/ai/subscribe", {})).intent.id, s.intent.id, "open intent reused");
  await payIntent(sara, s.intent);
  const me = await sara.req("GET", "/api/ai/me");
  assert.equal(me.subscription.state, "active"); assert.equal(me.subscription.source, "pi"); assert.equal(me.entitlements.translate, true);
  assert.ok(me.subscription.daysLeft >= 29 && me.subscription.daysLeft <= 30);
  assert.equal(await balance("platform:ai"), 2.5);
  assert.equal((await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='ai_subscribed'", [sara.id])).length, 1);
  const end1 = Date.parse(me.subscription.periodEnd);
  const s2 = await sara.req("POST", "/api/ai/subscribe", {});
  await payIntent(sara, s2.intent);
  const me2 = await sara.req("GET", "/api/ai/me");
  assert.equal(Date.parse(me2.subscription.periodEnd) - end1, 30 * DAY, "renewing early extends from the current end");
  assert.equal(await balance("platform:ai"), 5);
  const c = await sara.req("POST", "/api/ai/subscription/cancel", {});
  assert.equal(c.subscription.cancelAtPeriodEnd, true); assert.equal(c.subscription.state, "active", "access stays until the end");
  assert.equal((await sara.req("POST", "/api/ai/subscription/resume", {})).subscription.cancelAtPeriodEnd, false);
  assert.equal((await omar.req("POST", "/api/ai/subscription/cancel", {})).code, "invalid_state");
  // omar subscribes too (for the shared-cache test)
  const o = await omar.req("POST", "/api/ai/subscribe", {}); await payIntent(omar, o.intent);
  assert.equal((await omar.req("GET", "/api/ai/me")).entitlements.translate, true);
  await check();
});

test("translate: posts and comments, same language free, access checks, shared cache across subscribers", async () => {
  const before = calls.length;
  const r = await tr(sara, { kind: "post", id: P.en, target: "ar" });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.text, "[ar] " + "Learning to code step by step is the best way to start your career in tech");
  assert.deepEqual([r.source, r.target, r.cached, r.ai, r.label, r.provider], ["en", "ar", false, true, "ترجمة آلية", "stub"]);
  const r2 = await tr(omar, { kind: "post", id: P.en, target: "ar" });
  assert.equal(r2.cached, true, "shared cache hit for another subscriber"); assert.equal(r2.text, r.text);
  assert.equal(calls.length, before + 1, "provider called once");
  const same = await tr(sara, { kind: "post", id: P.ar, target: "ar" });
  assert.equal(same.same, true); assert.equal(calls.length, before + 1, "same language costs nothing");
  // default target = prefs.target → users.lang (sara chose en earlier)
  const d = await tr(sara, { kind: "post", id: P.fr });
  assert.equal(d.target, "en"); assert.equal(d.source, "fr");
  assert.equal((await tr(sara, { kind: "post", id: P.fr, target: "de" })).code, "lang_unsupported");
  assert.equal((await tr(sara, { kind: "post", id: P.priv, target: "ar" })).status, 404, "followers-only post is not visible to her");
  assert.equal((await tr(sara, { kind: "post", id: "nope" })).status, 404);
  assert.equal((await tr(sara, { kind: "user", id: "x" })).status, 400);
  // comments
  H.app.ctx.rl.w.clear();
  const cm = await bob.req("POST", "/api/comments", { post: P.ar, text: "This is a really helpful answer, thank you so much" });
  assert.equal(cm.status, 200, cm.error);
  const rc = await tr(sara, { kind: "comment", id: cm.comment.id, target: "fr" });
  assert.equal(rc.status, 200, rc.error); assert.equal(rc.source, "en"); assert.match(rc.text, /^\[fr\] /);
  const row = await db().get("SELECT scope FROM translations_cache WHERE target='fr'");
  assert.equal(row.scope, "", "public comment → shared scope");
  // usage metered, cache hits free
  const u = await db().get("SELECT * FROM ai_usage WHERE user_id=$1 AND feature='translate'", [omar.id]);
  assert.equal(Number(u.cache_hits), 1); assert.equal(Number(u.chars), 0);
  // batch
  const b = await sara.req("POST", "/api/ai/translate/batch", { items: [{ kind: "post", id: P.en }, { kind: "post", id: P.en }, { kind: "post", id: P.ar }, { kind: "post", id: "nope" }], target: "ar" });
  assert.equal(b.status, 200, b.error); assert.equal(b.items.length, 3, "deduplicated");
  assert.equal(b.items[0].cached, true); assert.equal(b.items[1].same, true); assert.deepEqual([b.items[2].ok, b.items[2].code], [false, "not_found"]);
  assert.equal((await sara.req("POST", "/api/ai/translate/batch", { items: [] })).status, 400);
  assert.equal((await bob.req("POST", "/api/ai/translate/batch", { items: [{ kind: "post", id: P.en }] })).code, "subscription_required");
  // legacy route goes through the entitlement
  assert.equal((await bob.req("POST", "/api/translate", { post: P.en, target: "ar" })).code, "subscription_required");
  const lg = await sara.req("POST", "/api/translate", { post: P.en, target: "ar" });
  assert.deepEqual([lg.status, lg.cached], [200, true]);
  assert.equal((await sara.req("POST", "/api/translate", { text: "hello" })).status, 400);
  // provider failure → 503 provider_error, nothing cached
  const pf = await post(bob, "Please FAILME translate this sentence for everyone");
  const e = await tr(sara, { kind: "post", id: pf, target: "ar" });
  assert.deepEqual([e.status, e.code], [503, "provider_error"]);
  assert.ok(!(await db().get("SELECT 1 x FROM translations_cache WHERE text LIKE '%FAILME%'")));
});

test("messages: membership, chat-scoped cache, E2EE plaintext with consent never cached, private provider only, delete purges", async () => {
  const { cid, mid } = await dm(bob, sara, "Are you coming to the meetup tomorrow evening with us?");
  assert.equal((await tr(omar, { kind: "message", id: mid, target: "ar" })).status, 404, "not a member");
  const r = await tr(sara, { kind: "message", id: mid, target: "ar" });
  assert.equal(r.status, 200, r.error); assert.match(r.text, /^\[ar\] Are you coming/);
  assert.equal((await db().get("SELECT scope FROM translations_cache WHERE scope LIKE 'm:%'")).scope, "m:" + cid);
  // a keyless public provider never receives messages
  const svc = H.app.ctx.services.translate;
  svc.setProvider({ ...stub, name: "public", private: false });
  try {
    const x = await dm(bob, sara, "Here is my private phone number, please keep it secret");
    const n = calls.length;
    const p = await tr(sara, { kind: "message", id: x.mid, target: "ar" });
    assert.deepEqual([p.status, p.code], [409, "provider_not_private"]); assert.equal(calls.length, n);
    assert.equal((await tr(sara, { kind: "post", id: P.fr, target: "ar" })).status, 200, "public posts may use it");
  } finally { svc.setProvider(stub); }
  // E2EE
  const enc = await dm(bob, sara, null, { e2ee: true });
  const need = await tr(sara, { kind: "message", id: enc.mid, target: "ar" });
  assert.deepEqual([need.status, need.code, need.disclosure], [409, "e2ee_plaintext_required", "e2ee"]);
  assert.equal((await tr(sara, { kind: "message", id: enc.mid, target: "ar", text: "Secret plan for the weekend trip" })).code, "consent_required");
  const n0 = (await db().get("SELECT COUNT(*) n FROM translations_cache")).n;
  const ok = await tr(sara, { kind: "message", id: enc.mid, target: "ar", text: "Secret plan for the weekend trip", consent: true });
  assert.equal(ok.status, 200, ok.error); assert.equal(ok.cached, false);
  assert.equal((await db().get("SELECT COUNT(*) n FROM translations_cache")).n, n0, "E2EE text is never cached");
  assert.ok(!(await db().get("SELECT 1 x FROM translations_cache WHERE text LIKE '%Secret plan%'")));
  // disappearing chat → not cached
  const ttl = await dm(bob, sara, "This message will disappear after one hour from now", { ttl: 3600 });
  assert.equal((await tr(sara, { kind: "message", id: ttl.mid, target: "fr" })).status, 200);
  assert.ok(!(await db().get("SELECT 1 x FROM translations_cache WHERE scope=$1", ["m:" + ttl.cid])));
  // delete for everyone purges the chat's cache
  H.app.ctx.bus.emit("MESSAGE_DELETED", { conv: cid, message: mid, actor: bob.id });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!(await db().get("SELECT 1 x FROM translations_cache WHERE scope=$1", ["m:" + cid])));
  await db().run("UPDATE messages SET deleted_at=$1 WHERE id=$2", [new Date().toISOString(), mid]);
  assert.equal((await tr(sara, { kind: "message", id: mid, target: "ar" })).status, 404);
});

test("caps: monthly char limit → 429 usage_limit, global provider budget → 503 budget_exhausted; prefs", async () => {
  const big = await post(lina, "Une très longue phrase en français pour tester la limite mensuelle de caractères de la traduction ".repeat(6));
  await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { translate: { chars: 400, costUsd: 1 } } });
  const r = await tr(omar, { kind: "post", id: big, target: "ar" });
  assert.deepEqual([r.status, r.code], [429, "usage_limit"]); assert.equal(r.usage.limitChars, 400);
  await admin.req("PUT", "/api/admin/ai/plans/ai_plus", { limits: { translate: { chars: 100000, costUsd: 1 } } });
  const period = new Date().toISOString().slice(0, 7);
  await db().run("INSERT INTO ai_period_stats(period,feature,provider,requests,chars,cache_hits,cost_micros) VALUES($1,'translate','other',1,0,0,$2)", [period, 5e6]);
  const b = await tr(omar, { kind: "post", id: big, target: "ar" });
  assert.deepEqual([b.status, b.code], [503, "budget_exhausted"]);
  assert.equal((await tr(omar, { kind: "post", id: P.en, target: "ar" })).cached, true, "cache hits still served");
  await db().run("DELETE FROM ai_period_stats WHERE provider='other'");
  // prefs
  assert.equal((await sara.req("PUT", "/api/ai/translate/prefs", { target: "xx" })).code, "lang_unsupported");
  const p = await sara.req("PUT", "/api/ai/translate/prefs", { auto: false, target: "fr", skip: ["en"] });
  assert.deepEqual([p.auto, p.target, p.skip], [false, "fr", ["en"]]);
  assert.equal((await tr(sara, { kind: "post", id: P.en })).target, "fr");
  assert.equal((await sara.req("GET", "/api/ai/me")).prefs.target, "fr");
});

test("no provider → 503 not_configured «خدمة الترجمة غير مفعّلة بعد» (subscribers), config says unavailable", async () => {
  const svc = H.app.ctx.services.translate;
  svc.setProvider(null);
  try {
    const r = await tr(sara, { kind: "post", id: P.en, target: "ar" });
    assert.deepEqual([r.status, r.code, r.error], [503, "not_configured", "خدمة الترجمة غير مفعّلة بعد"]);
    assert.equal((await bob.req("POST", "/api/ai/translate", { kind: "post", id: P.en })).code, "subscription_required");
    const c = await new H.Client().req("GET", "/api/ai/config");
    assert.deepEqual(c.features.translate, { available: false, provider: null, private: false, note: "خدمة الترجمة غير مفعّلة بعد" });
    assert.equal((await new H.Client().req("GET", "/api/health")).translate, false);
  } finally { svc.setProvider(stub); }
});

test("staff grants/revoke, refund cuts the period, maintenance (reminder once, expiry), finance, compliance map", async () => {
  assert.equal((await sara.req("POST", "/api/admin/ai/grants", { user: "ai_lina", days: 7 })).status, 403);
  assert.equal((await admin.req("POST", "/api/admin/ai/grants", { user: "ai_lina", days: 0 })).status, 400);
  const g = await admin.req("POST", "/api/admin/ai/grants", { user: "@ai_lina", days: 7, note: "شريك" });
  assert.equal(g.status, 200, g.error); assert.equal(g.subscription.source, "grant"); assert.equal(g.subscription.daysLeft, 7);
  assert.equal((await lina.req("GET", "/api/ai/me")).entitlements.translate, true);
  assert.equal((await admin.req("POST", "/api/admin/ai/grants", { user: "ai_minnie", days: 3 })).status, 200, "grants are allowed for minors (no payment)");
  const rv = await admin.req("POST", "/api/admin/ai/grants/revoke", { user: "ai_minnie" });
  assert.equal(rv.subscription.state, "revoked");
  assert.equal((await minnie.req("GET", "/api/ai/me")).entitlements.translate, false);
  assert.ok((await admin.req("GET", "/api/admin/ai/subscribers?state=active")).items.some((x) => x.user.handle === "ai_lina"));
  // refund omar's only payment → period cut, access ends, reversing journal
  const op = await db().get("SELECT * FROM ai_payments WHERE user_id=$1 AND status='completed'", [omar.id]);
  await H.app.ctx.services.pi.refund({ id: admin.id }, op.intent_id, { note: "طلب استرداد" });
  await settle();
  assert.equal((await db().get("SELECT status FROM ai_payments WHERE id=$1", [op.id])).status, "refunded");
  assert.equal((await omar.req("GET", "/api/ai/me")).entitlements.translate, false);
  assert.equal(await balance("platform:ai"), 5, "sara 2×2.5 kept, omar's 2.5 reversed");
  await check();
  // maintenance: reminder 3 days before the end (once), then expiry
  const end = Date.parse((await lina.req("GET", "/api/ai/me")).subscription.periodEnd);
  const sub = await db().get("SELECT id FROM ai_subscriptions WHERE user_id=$1", [lina.id]);
  await db().run("UPDATE ai_subscriptions SET source='pi' WHERE id=$1", [sub.id]);
  offset = end - Date.now() - 2 * DAY;
  assert.equal((await ai().maintain()).reminded, 1);
  assert.equal((await ai().maintain()).reminded, 0, "once per period");
  offset = end - Date.now() + 1000;
  assert.equal((await ai().maintain()).expired, 1);
  offset = 0;
  assert.equal((await db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind='ai_expired'", [lina.id])).length, 1);
  const href = require("../lib/notify-lib").hrefFor({ kind: "ai_expired", ref: "ai_plus" });
  assert.equal(href, "/#/ai");
  // finance
  const f = await admin.req("GET", "/api/admin/ai/finance");
  assert.equal(f.status, 200, f.error);
  assert.equal(f.revenue, 7.5); assert.equal(f.refunds, 2.5); assert.equal(f.net, 5); assert.equal(f.payments, 3);
  assert.ok(f.providerCostUsd > 0); assert.ok(f.byFeature.some((x) => x.provider === "stub" && x.chars > 0)); assert.ok(f.byFeature.some((x) => x.provider === "cache" && x.cacheHits > 0));
  assert.equal(f.marginUsd, null, "no Pi/USD rate configured"); assert.equal(f.months.length, 6);
  assert.equal((await sara.req("GET", "/api/admin/ai/finance")).status, 403);
  const stats = (await db().all("SELECT * FROM ai_period_stats")).flatMap((r) => Object.values(r).map(String));
  for (const u of [sara.id, omar.id, lina.id]) assert.ok(!stats.includes(u), "no user ids in ai_period_stats");
  // compliance data map
  const L = require("../lib/compliance-lib");
  for (const t of ["ai_subscriptions", "ai_payments", "ai_usage", "translate_prefs", "ui_strings"]) assert.ok(L.DATA_MAP.some((m) => m.t === t), t);
  assert.equal(L.DATA_MAP.find((m) => m.t === "ai_usage").erase, "delete");
});
