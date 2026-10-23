/* v2.77 «مركز الذكاء» — members link their own AI accounts. A fake fetch plays OpenRouter / Gemini / Groq so nothing leaves the box.
 * Covers: migration 076 (down/up, additive), catalog + overview (ChatGPT listed but pending without SIWC_CLIENT_ID), key linking
 * (format check, live check rejects a bad key, sealed at rest, never returned, last-4 hint), model list + model change, OpenRouter
 * one-tap PKCE (start url carries S256 challenge + state; callback exchanges with the verifier, single-use state, expired/unknown state),
 * chat on the member's own account (right base URL, Bearer key, chosen model, system line, no text stored), error mapping (bad_key
 * marks the link, quota), the app's free allowance (not configured → 503; daily limit 429 free_limit; admin can change it), prefs
 * (feature → provider, only linked ones), assistant writing runs on the member's own account with no subscription, unlink, admin. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/aihub-lib");

const GEMINI = "AIza" + "x".repeat(35), GEMINI_BAD = "AIza" + "y".repeat(35), GROQ = "gsk_" + "g".repeat(40), OR_KEY = "sk-or-v1-" + "o".repeat(40);
const calls = [];
let freeCalls = 0;
async function fakeFetch(url, o = {}) {
  const u = String(url), auth = o.headers?.Authorization || "", body = o.body ? JSON.parse(o.body) : null;
  calls.push({ url: u, method: o.method || "GET", auth, body });
  const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  const no = (status, t = "") => ({ ok: false, status, json: async () => ({}), text: async () => t });
  if (u === "https://openrouter.ai/api/v1/auth/keys") return body?.code === "good-code" && body?.code_challenge_method === "S256" && body?.code_verifier ? ok({ key: OR_KEY }) : no(403);
  if (/\/models$/.test(u)) {
    if (auth === "Bearer " + GEMINI_BAD) return no(400, "API key not valid. Please pass a valid API key.");
    if (u.startsWith("https://generativelanguage")) return ok({ data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-2.5-pro" }, { id: "models/text-embedding-004" }] });
    if (u.startsWith("https://api.groq.com")) return ok({ data: [{ id: "openai/gpt-oss-120b" }, { id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }] });
    if (u.startsWith("https://openrouter.ai")) return ok({ data: [{ id: "openai/gpt-4o", pricing: { prompt: "0.000005", completion: "0.00001" } }, { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" } }] });
  }
  if (/\/chat\/completions$/.test(u)) {
    const last = body.messages[body.messages.length - 1].content;
    if (last === "QUOTA") return no(429, "You exceeded your current quota");
    if (last === "REVOKED") return no(401);
    return ok({ model: body.model, choices: [{ message: { content: "رد: " + last } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  return no(404);
}
const freeStub = { label: "مجتمع بلس", async chat(messages) { freeCalls++; return { text: "مجاني: " + messages[messages.length - 1].content, model: "free-model" }; } };

let H, admin, sara, bob;
const db = () => H.app.ctx.db;
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
};

test.before(async () => {
  H = await boot({ piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { jobs: false }, translateOpts: { env: {} },
    assistantOpts: { jobs: false, env: {} }, aihubOpts: { env: { AIHUB_SEAL_KEY: "test-seal" }, fetch: fakeFetch, freeProvider: freeStub } });
  admin = await mk("hub_admin"); sara = await mk("hub_sara"); bob = await mk("hub_bob");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 076: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '076_ai_hub' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "076_ai_hub"]);
  await assert.rejects(() => db().get("SELECT 1 FROM ai_links"));
  assert.deepEqual(await mig.up(db()), ["076_ai_hub", ...later]);
  for (const t of ["ai_links", "ai_link_prefs", "ai_link_usage", "ai_oauth_states"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
});

test("lib: PKCE S256, key hints, format checks, model sorting, public catalog hides internals", () => {
  const v = L.verifier(); assert.ok(v.length >= 43);
  assert.equal(L.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "RFC 7636 test vector");
  assert.equal(L.keyHint("abcdefgh1234"), "••••1234");
  assert.equal(L.cleanKey("  Bearer  AIza 123 "), "AIza123");
  assert.equal(L.keyLooksValid(L.byId("gemini"), GEMINI), true);
  assert.equal(L.keyLooksValid(L.byId("gemini"), GROQ), false);
  assert.equal(L.keyLooksValid(L.byId("groq"), "short"), false);
  const sorted = L.sortModels(L.byId("groq"), [{ id: "b" }, { id: "openai/gpt-oss-120b" }, { id: "a", free: true }]);
  assert.deepEqual(sorted.map((m) => m.id), ["openai/gpt-oss-120b", "a", "b"]);
  const pub = L.publicProvider(L.byId("anthropic"));
  for (const k of ["keyPrefix", "extraHeaders", "base"]) assert.equal(pub[k], undefined, k);
  assert.ok(L.CATALOG.length >= 8 && L.CATALOG.every((p) => p.privacy && p.blurb));
});

test("overview: catalog, ChatGPT pending without client id, free allowance, privacy lines", async () => {
  assert.equal((await new H.Client().req("GET", "/api/aihub")).status, 401);
  const r = await sara.req("GET", "/api/aihub");
  assert.equal(r.status, 200, r.error);
  const ids = r.providers.map((p) => p.id);
  for (const id of ["openrouter", "chatgpt", "gemini", "groq", "openai", "anthropic", "deepseek", "mistral", "xai"]) assert.ok(ids.includes(id), id);
  const g = r.providers.find((p) => p.id === "chatgpt");
  assert.equal(g.available, false); assert.match(g.note, /OpenAI/);
  assert.equal(r.providers.find((p) => p.id === "openrouter").link, "oauth");
  assert.equal(r.free.enabled, true); assert.equal(r.free.daily, 5); assert.equal(r.free.left, 5);
  assert.ok(r.privacy.keys && r.linkedCount === 0);
  assert.equal(JSON.stringify(r).includes("keyPrefix"), false);
});

test("link by key: format, live check, sealed at rest, never returned, model list, change model", async () => {
  let r = await sara.req("POST", "/api/aihub/links/gemini", { key: "hello" });
  assert.equal(r.status, 400); assert.equal(r.code, "key_format");
  r = await sara.req("POST", "/api/aihub/links/gemini", { key: GEMINI_BAD });
  assert.equal(r.status, 400); assert.equal(r.code, "bad_key");
  assert.equal(await db().get("SELECT 1 x FROM ai_links WHERE user_id=$1", [sara.id]), undefined, "bad key not saved");
  r = await sara.req("POST", "/api/aihub/links/gemini", { key: "  " + GEMINI + " " });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.link.hint, "••••" + GEMINI.slice(-4)); assert.equal(r.link.model, "gemini-2.5-flash");
  assert.ok(!r.models.some((m) => /embed/.test(m.id)), "embedding models filtered");
  const row = await db().get("SELECT * FROM ai_links WHERE user_id=$1 AND provider='gemini'", [sara.id]);
  assert.ok(row.secret.startsWith("v1.") && !row.secret.includes(GEMINI), "sealed at rest");
  const all = JSON.stringify(await sara.req("GET", "/api/aihub"));
  assert.equal(all.includes(GEMINI), false, "key never returned");
  assert.equal((await sara.req("GET", "/api/aihub")).prefs.defaultProvider, "gemini", "first link becomes the default");
  r = await sara.req("GET", "/api/aihub/links/gemini/models");
  assert.equal(r.status, 200); assert.equal(r.current, "gemini-2.5-flash");
  r = await sara.req("PUT", "/api/aihub/links/gemini", { model: "gemini-2.5-pro" });
  assert.equal(r.link.model, "gemini-2.5-pro");
  assert.equal((await sara.req("PUT", "/api/aihub/links/gemini", { model: "bad model!" })).code, "bad_model");
  assert.equal((await sara.req("POST", "/api/aihub/links/chatgpt", { key: "sk-" + "x".repeat(30) })).code, "siwc_pending");
  assert.equal((await sara.req("POST", "/api/aihub/links/openrouter", { key: OR_KEY })).code, "use_oauth");
  assert.equal((await sara.req("POST", "/api/aihub/links/nope", { key: GEMINI })).status, 404);
});

test("chat on the member's own account: base URL, Bearer key, model, system line, nothing stored", async () => {
  calls.length = 0;
  const r = await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "مرحبا" }] });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.text, "رد: مرحبا"); assert.equal(r.provider, "gemini"); assert.equal(r.model, "gemini-2.5-pro");
  const c = calls.find((x) => /chat\/completions$/.test(x.url));
  assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(c.auth, "Bearer " + GEMINI);
  assert.equal(c.body.messages[0].role, "system"); assert.match(c.body.messages[0].content, /مجتمع بلس/);
  const u = await db().get("SELECT * FROM ai_link_usage WHERE user_id=$1 AND provider='gemini'", [sara.id]);
  assert.equal(Number(u.requests), 1);
  for (const t of ["ai_links", "ai_link_usage", "ai_link_prefs"]) assert.equal(JSON.stringify(await db().all(`SELECT * FROM ${t}`)).includes("مرحبا"), false, t);
  // validation
  assert.equal((await sara.req("POST", "/api/aihub/chat", { messages: [] })).status, 400);
  assert.equal((await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "assistant", content: "x" }] })).status, 400);
  assert.equal((await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "x".repeat(8000) }, { role: "assistant", content: "x".repeat(8000) }, { role: "user", content: "x".repeat(8000) }, { role: "assistant", content: "x".repeat(8000) }, { role: "user", content: "x".repeat(8000) }] })).status, 413);
});

test("provider errors: quota and revoked key map to clear codes, revoked marks the link", async () => {
  let r = await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "QUOTA" }] });
  assert.equal(r.code, "quota"); assert.match(r.error, /رصيدك/);
  r = await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "REVOKED" }] });
  assert.equal(r.status, 400); assert.equal(r.code, "bad_key");
  assert.equal((await sara.req("GET", "/api/aihub")).providers.find((p) => p.id === "gemini").linked.state, "bad_key");
  r = await sara.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "عاد" }] });
  assert.equal(r.status, 200);
  assert.equal((await sara.req("GET", "/api/aihub")).providers.find((p) => p.id === "gemini").linked.state, "ok", "a good call clears it");
});

test("OpenRouter one tap: PKCE start, callback exchange, single-use state, expired + denied", async () => {
  let r = await bob.req("POST", "/api/aihub/oauth/openrouter/start", {});
  assert.equal(r.status, 200, r.error);
  const u = new URL(r.url);
  assert.equal(u.origin + u.pathname, "https://openrouter.ai/auth");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  const state = u.searchParams.get("state"); assert.ok(state.length > 20);
  assert.match(u.searchParams.get("callback_url"), /\/api\/aihub\/oauth\/openrouter\/callback$/);
  const row = await db().get("SELECT * FROM ai_oauth_states WHERE state=$1", [state]);
  assert.equal(L.challenge(row.verifier), u.searchParams.get("code_challenge"));
  const go = async (q) => { const res = await fetch(H.base + "/api/aihub/oauth/openrouter/callback?" + q, { redirect: "manual" }); return res.headers.get("location"); };
  assert.equal(await go("code=bad-code&state=" + state), "/#/aihub?link_error=exchange");
  assert.equal(await go("code=good-code&state=" + state), "/#/aihub?link_error=expired", "state is single use");
  r = await bob.req("POST", "/api/aihub/oauth/openrouter/start", {});
  const s2 = new URL(r.url).searchParams.get("state");
  assert.equal(await go("code=good-code&state=" + s2), "/#/aihub?linked=openrouter");
  const ex = calls.filter((x) => x.url.endsWith("/auth/keys")).pop();
  assert.equal(ex.body.code_challenge_method, "S256"); assert.ok(ex.body.code_verifier.length >= 43);
  const ov = await bob.req("GET", "/api/aihub");
  const or = ov.providers.find((p) => p.id === "openrouter").linked;
  assert.equal(or.method, "oauth"); assert.equal(or.model, "openrouter/auto"); assert.equal(ov.prefs.defaultProvider, "openrouter");
  assert.equal(await go("error=access_denied"), "/#/aihub?link_error=denied");
  assert.equal(await go("code=x&state=nope"), "/#/aihub?link_error=expired");
  r = await bob.req("POST", "/api/aihub/oauth/openrouter/start", {});
  const s3 = new URL(r.url).searchParams.get("state");
  await db().run("UPDATE ai_oauth_states SET created_at=$1 WHERE state=$2", [new Date(Date.now() - 11 * 60e3).toISOString(), s3]);
  assert.equal(await go("code=good-code&state=" + s3), "/#/aihub?link_error=expired");
  // chat through OpenRouter carries attribution headers and the chosen model
  calls.length = 0;
  r = await bob.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "hi" }], model: "meta-llama/llama-3.3-70b-instruct:free" });
  assert.equal(r.status, 200, r.error); assert.equal(r.model, "meta-llama/llama-3.3-70b-instruct:free");
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions"); assert.equal(calls[0].auth, "Bearer " + OR_KEY);
  const m = await bob.req("GET", "/api/aihub/links/openrouter/models");
  assert.equal(m.models.find((x) => x.id.endsWith(":free")).free, true);
  assert.equal((await bob.req("POST", "/api/aihub/oauth/chatgpt/start", {})).code, "siwc_pending");
  assert.equal((await bob.req("POST", "/api/aihub/oauth/gemini/start", {})).code, "use_key");
});

test("free allowance: daily limit, admin adjusts, explicit provider 'free'", async () => {
  const lina = await mk("hub_lina");
  freeCalls = 0;
  for (let i = 0; i < 5; i++) { const r = await lina.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "س" + i }] }); assert.equal(r.status, 200, r.error); assert.equal(r.provider, "free"); assert.equal(r.free.left, 4 - i); }
  let r = await lina.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "زيادة" }] });
  assert.equal(r.status, 429); assert.equal(r.code, "free_limit"); assert.equal(freeCalls, 5);
  assert.equal((await sara.req("PUT", "/api/admin/aihub", { freeDaily: 8 })).status, 403);
  r = await admin.req("PUT", "/api/admin/aihub", { freeDaily: 7 }); assert.equal(r.status, 200, r.error); assert.equal(r.settings.freeDaily, 7);
  assert.equal((await admin.req("PUT", "/api/admin/aihub", { freeDaily: 500 })).status, 400);
  r = await lina.req("POST", "/api/aihub/chat", { messages: [{ role: "user", content: "مرة" }] }); assert.equal(r.status, 200); assert.equal(r.free.left, 1);
  r = await sara.req("POST", "/api/aihub/chat", { provider: "free", messages: [{ role: "user", content: "مجاني" }] });
  assert.equal(r.provider, "free");
  r = await admin.req("GET", "/api/admin/aihub");
  assert.equal(r.freeConfigured, true); assert.equal(r.siwc.ready, false);
  assert.ok(r.today.some((x) => x.provider === "free" && x.requests >= 7));
  // admin pauses a provider
  await admin.req("PUT", "/api/admin/aihub", { enabled: { groq: false } });
  assert.equal((await sara.req("GET", "/api/aihub")).providers.some((p) => p.id === "groq"), false);
  assert.equal((await sara.req("POST", "/api/aihub/links/groq", { key: GROQ })).code, "provider_disabled");
  await admin.req("PUT", "/api/admin/aihub", { enabled: { groq: true }, freeDaily: 5 });
});

test("prefs + assistant writing on the member's own account (no subscription needed), then unlink", async () => {
  let r = await sara.req("PUT", "/api/aihub/prefs", { features: { assistant: "groq" } });
  assert.equal(r.status, 400); assert.equal(r.code, "not_linked");
  assert.equal((await sara.req("POST", "/api/aihub/links/groq", { key: GROQ })).status, 200);
  r = await sara.req("PUT", "/api/aihub/prefs", { features: { assistant: "groq" }, defaultProvider: "groq" });
  assert.equal(r.features.assistant, "groq"); assert.equal(r.defaultProvider, "groq");
  calls.length = 0;
  r = await sara.req("POST", "/api/assistant/write", { mode: "polite", text: "أرسل لي الملف" });
  assert.equal(r.status, 200, r.error); assert.equal(r.provider, "own:groq"); assert.match(r.text, /رد:/);
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  // bob has no own assistant provider and no subscription → 402 as before
  assert.equal((await bob.req("POST", "/api/assistant/write", { mode: "polite", text: "x" })).status, 402);
  r = await sara.req("DELETE", "/api/aihub/links/groq");
  assert.equal(r.status, 200); assert.equal(r.removed, true);
  const ov = await sara.req("GET", "/api/aihub");
  assert.equal(ov.prefs.features.assistant, undefined, "feature routing to an unlinked provider is cleared");
  assert.equal(ov.prefs.defaultProvider, "gemini", "default falls back to another linked account");
  assert.equal((await sara.req("POST", "/api/assistant/write", { mode: "polite", text: "x" })).status, 402);
});

test("anonymised member: links, prefs and usage are erased", async () => {
  H.app.ctx.bus.emit("USER_ANONYMISED", { user: sara.id });
  await new Promise((r) => setTimeout(r, 50));
  for (const t of ["ai_links", "ai_link_prefs", "ai_link_usage"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t} WHERE user_id=$1`, [sara.id])).n), 0, t);
});
