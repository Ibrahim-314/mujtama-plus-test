/* «مركز الذكاء» helpers (v2.77) — pure, no DB. A member links their OWN AI account and uses it inside مجتمع بلس.
 * • CATALOG: every provider the hub offers, how it links (oauth = one tap, key = paste a key from the provider's own page,
 *   siwc = «المتابعة بـ ChatGPT», shown but off until OpenAI approves our client id), its OpenAI-compatible base URL and a
 *   conservative default model. Model lists are read live from the provider with the member's own key (GET /models).
 * • chatProvider(): one adapter for every OpenAI-compatible endpoint (chat/completions). Errors are mapped to stable codes
 *   (bad_key, quota, rate, provider_error, timeout) so the UI can say something useful; inputs are never logged.
 * • PKCE (S256) helpers for the OpenRouter one-tap link: verifier, challenge, state.
 * • keyHint(): last 4 characters only — the key itself is never returned by any API after it is saved. */
const crypto = require("node:crypto");

/** @typedef {{ id:string, name:string, maker:string, link:"oauth"|"key"|"siwc", base:string, models:string, keyUrl?:string, keyPrefix?:RegExp, defaultModel:string, free:boolean, blurb:string, steps?:string[], privacy:string, color:string, mono:string, extraHeaders?:(key:string)=>Record<string,string> }} Provider */
/** @type {Provider[]} */
const CATALOG = [
  { id: "openrouter", name: "OpenRouter", maker: "OpenRouter", link: "oauth", base: "https://openrouter.ai/api/v1", models: "/models", defaultModel: "openrouter/auto", free: true,
    blurb: "ضغطة واحدة تفتح لك نماذج ChatGPT وClaude وGemini وDeepSeek وغيرها من حسابك، ومنها نماذج مجانية.",
    privacy: "تُرسل رسالتك إلى OpenRouter ثم إلى مزوّد النموذج الذي تختاره، وتُحتسب على رصيدك في OpenRouter.", color: "#6467F2", mono: "OR" },
  { id: "chatgpt", name: "ChatGPT", maker: "OpenAI", link: "siwc", base: "https://api.openai.com/v1", models: "/models", defaultModel: "", free: false,
    blurb: "سجّل دخولك بحساب ChatGPT واستخدم اشتراك Plus أو Pro داخل التطبيق دون أي مفتاح.",
    privacy: "يُستخدم اشتراكك في ChatGPT بإذنك، ويمكنك فصل الربط متى شئت من إعدادات ChatGPT أو من هنا.", color: "#10A37F", mono: "GPT" },
  { id: "gemini", name: "Gemini", maker: "Google", link: "key", base: "https://generativelanguage.googleapis.com/v1beta/openai", models: "/models", keyUrl: "https://aistudio.google.com/app/apikey", keyPrefix: /^AIza[0-9A-Za-z_-]{30,}$/, defaultModel: "gemini-2.5-flash", free: true,
    blurb: "مفتاح مجاني من Google AI Studio بدقيقة واحدة، بحدود استخدام يومية مجانية.",
    steps: ["افتح Google AI Studio وسجّل دخولك بحساب Google", "اضغط «Create API key»", "انسخ المفتاح والصقه هنا"],
    privacy: "في الطبقة المجانية قد تستخدم Google ما ترسله لتحسين منتجاتها. لا ترسل معلومات خاصة.", color: "#4285F4", mono: "G" },
  { id: "groq", name: "Groq", maker: "Groq", link: "key", base: "https://api.groq.com/openai/v1", models: "/models", keyUrl: "https://console.groq.com/keys", keyPrefix: /^gsk_[0-9A-Za-z]{20,}$/, defaultModel: "openai/gpt-oss-120b", free: true,
    blurb: "سريع جداً، ومفتاحه مجاني بحدود يومية.",
    steps: ["افتح لوحة Groq وسجّل دخولك", "اضغط «Create API Key»", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى Groq لمعالجتها فقط.", color: "#F55036", mono: "Gq" },
  { id: "openai", name: "OpenAI API", maker: "OpenAI", link: "key", base: "https://api.openai.com/v1", models: "/models", keyUrl: "https://platform.openai.com/api-keys", keyPrefix: /^sk-[0-9A-Za-z_-]{20,}$/, defaultModel: "gpt-4o-mini", free: false,
    blurb: "نماذج GPT عبر منصة مطوري OpenAI، بالدفع حسب الاستخدام من رصيدك.",
    steps: ["افتح منصة OpenAI وسجّل دخولك", "اضغط «Create new secret key»", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى OpenAI وتُحتسب على رصيدك في المنصة.", color: "#0D0D0D", mono: "AI" },
  { id: "anthropic", name: "Claude", maker: "Anthropic", link: "key", base: "https://api.anthropic.com/v1", models: "/models", keyUrl: "https://console.anthropic.com/settings/keys", keyPrefix: /^sk-ant-[0-9A-Za-z_-]{20,}$/, defaultModel: "", free: false,
    blurb: "نماذج Claude من Anthropic، بالدفع حسب الاستخدام من رصيدك.",
    steps: ["افتح لوحة Anthropic وسجّل دخولك", "اضغط «Create Key»", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى Anthropic وتُحتسب على رصيدك.", color: "#D97757", mono: "C",
    extraHeaders: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }) },
  { id: "deepseek", name: "DeepSeek", maker: "DeepSeek", link: "key", base: "https://api.deepseek.com", models: "/models", keyUrl: "https://platform.deepseek.com/api_keys", keyPrefix: /^sk-[0-9A-Za-z]{20,}$/, defaultModel: "deepseek-chat", free: false,
    blurb: "نماذج قوية بأسعار منخفضة جداً.",
    steps: ["افتح منصة DeepSeek وسجّل دخولك", "اضغط «Create new API key»", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى DeepSeek وتُحتسب على رصيدك.", color: "#4D6BFE", mono: "DS" },
  { id: "mistral", name: "Mistral", maker: "Mistral AI", link: "key", base: "https://api.mistral.ai/v1", models: "/models", keyUrl: "https://console.mistral.ai/api-keys", defaultModel: "mistral-small-latest", free: false,
    blurb: "نماذج أوروبية سريعة، وفيها خطة تجريبية.",
    steps: ["افتح لوحة Mistral وسجّل دخولك", "اختر «API Keys» ثم «Create new key»", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى Mistral وتُحتسب على حسابك.", color: "#FA520F", mono: "M" },
  { id: "xai", name: "Grok", maker: "xAI", link: "key", base: "https://api.x.ai/v1", models: "/models", keyUrl: "https://console.x.ai", keyPrefix: /^xai-[0-9A-Za-z]{20,}$/, defaultModel: "", free: false,
    blurb: "نماذج Grok من xAI، بالدفع حسب الاستخدام.",
    steps: ["افتح لوحة xAI وسجّل دخولك", "أنشئ مفتاح API جديداً", "انسخ المفتاح والصقه هنا"],
    privacy: "تُرسل رسالتك إلى xAI وتُحتسب على رصيدك.", color: "#111111", mono: "X" }
];
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));
const byId = (id) => BY_ID.get(String(id || "")) || null;
/** features a member can point at one of their linked accounts */
const FEATURES = { chat: "المحادثة في مركز الذكاء", assistant: "مساعد الكتابة واقتراح الردود", digest: "نشرتك الذكية في «فاتك اليوم»", community: "مساعد لوحة المجتمع للمشرفين", search: "البحث الذكي", studio: "مساعد استوديو المنشئ (عناوين، ترجمة، فحص قبل النشر، شرح الأرقام والتعليقات، أفكار المحتوى، تحويل الصيغ)" };

const keyHint = (k) => { const s = String(k || ""); return s.length >= 8 ? "••••" + s.slice(-4) : "••••"; };
const cleanKey = (k) => String(k || "").trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
/** a light shape check before calling the provider (the provider's own answer is the real check) */
function keyLooksValid(p, key) {
  if (!key || key.length < 16 || key.length > 400 || /[^\x21-\x7E]/.test(key)) return false;
  return p.keyPrefix ? p.keyPrefix.test(key) : true;
}

/* ---------- PKCE (S256) ---------- */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const verifier = () => b64u(crypto.randomBytes(48));
const challenge = (v) => b64u(crypto.createHash("sha256").update(v).digest());
const stateToken = () => b64u(crypto.randomBytes(24));

/* ---------- OpenAI-compatible adapter ---------- */
const CODES = { 400: "bad_request", 401: "bad_key", 403: "bad_key", 402: "quota", 404: "model_not_found", 429: "rate" };
class ProviderError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status || 0; } }
/** @param {{ provider: Provider, key: string, model?: string, fetchImpl?: typeof fetch, timeoutMs?: number, referer?: string }} o */
function chatProvider({ provider: p, key, model, fetchImpl = fetch, timeoutMs = 45000, referer }) {
  const url = (path) => p.base.replace(/\/$/, "") + path;
  const headers = () => ({ "Content-Type": "application/json", Authorization: "Bearer " + key, ...(p.extraHeaders ? p.extraHeaders(key) : {}),
    ...(p.id === "openrouter" ? { "HTTP-Referer": referer || "https://mujtama.plus", "X-Title": "Mujtama Plus" } : {}) });
  async function call(method, path, body) {
    let r;
    try { r = await fetchImpl(url(path), { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new ProviderError(e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : "provider_error"); }
    if (!r.ok) {
      let code = CODES[r.status] || "provider_error";
      if (r.status === 429 || r.status === 400) { const t = await r.text().catch(() => ""); if (/quota|insufficient|credit|billing|balance/i.test(t)) code = "quota"; else if (r.status === 400 && /api.?key|invalid.*key|unauthori/i.test(t)) code = "bad_key"; }
      throw new ProviderError(code, r.status);
    }
    return r.json().catch(() => { throw new ProviderError("provider_error", r.status); });
  }
  return {
    name: p.id, model: model || p.defaultModel, private: true,
    async models() {
      const j = await call("GET", p.models);
      const list = (Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : []).map((m) => ({
        id: String(m.id || m.name || "").replace(/^models\//, ""), name: String(m.display_name || m.name || m.id || "").replace(/^models\//, ""),
        free: p.id === "openrouter" ? /:free$/.test(String(m.id || "")) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0) : undefined,
        ctx: Number(m.context_length || m.context_window || 0) || undefined
      })).filter((m) => m.id && !/embed|whisper|tts|dall-e|image|moderation|audio|transcri|realtime|guard|rerank/i.test(m.id));
      return list.slice(0, 400);
    },
    async chat(messages, { maxTokens = 800, json = false, temperature = 0.4, model: m } = {}) {
      const j = await call("POST", "/chat/completions", { model: m || model || p.defaultModel, messages, max_tokens: maxTokens, temperature, ...(json ? { response_format: { type: "json_object" } } : {}) });
      const text = String(j?.choices?.[0]?.message?.content ?? "");
      return { text, model: j?.model || m || model, usage: { in: j?.usage?.prompt_tokens || 0, out: j?.usage?.completion_tokens || 0 }, costMicros: 0 };
    }
  };
}
/** a model list ordered so the best first pick is on top: the provider default, then «free», then by name */
function sortModels(p, list) {
  const def = p.defaultModel;
  return [...list].sort((a, b) => (b.id === def) - (a.id === def) || (b.free === true) - (a.free === true) || a.id.localeCompare(b.id));
}
/** catalog entry → what the client may see (no regexes, no functions) */
/* English copy for the catalogue (v2.77): exposed as provider.en, picked by the client when the app is in English */
const EN = {
  openrouter: { blurb: "One tap opens ChatGPT, Claude, Gemini, DeepSeek and more from your own account, including free models." },
  chatgpt: { blurb: "Sign in with your ChatGPT account and use your Plus or Pro plan in the app, no key needed." },
  gemini: { blurb: "A free key from Google AI Studio in a minute, with free daily limits.", steps: ["Open Google AI Studio and sign in with your Google account", "Tap «Create API key»", "Copy the key and paste it here"] },
  groq: { blurb: "Very fast, with a free key and daily limits.", steps: ["Open the Groq console and sign in", "Tap «Create API Key»", "Copy the key and paste it here"] },
  openai: { blurb: "GPT models through the OpenAI developer platform, paid per use from your credit.", steps: ["Open the OpenAI platform and sign in", "Tap «Create new secret key»", "Copy the key and paste it here"] },
  anthropic: { blurb: "Claude models from Anthropic, paid per use from your credit.", steps: ["Open the Anthropic console and sign in", "Tap «Create Key»", "Copy the key and paste it here"] },
  deepseek: { blurb: "Strong models at very low prices.", steps: ["Open the DeepSeek platform and sign in", "Tap «Create new API key»", "Copy the key and paste it here"] },
  mistral: { blurb: "Fast European models, with a trial plan.", steps: ["Open the Mistral console and sign in", "Choose «API Keys», then «Create new key»", "Copy the key and paste it here"] },
  xai: { blurb: "Grok models from xAI, paid per use.", steps: ["Open the xAI console and sign in", "Create a new API key", "Copy the key and paste it here"] }
};
for (const p of CATALOG) if (EN[p.id]) p.en = EN[p.id];

function publicProvider(p, extra = {}) {
  const { keyPrefix: _k, extraHeaders: _h, base: _b, models: _m, ...pub } = p;
  return { ...pub, ...extra };
}

module.exports = { CATALOG, FEATURES, byId, keyHint, cleanKey, keyLooksValid, verifier, challenge, stateToken, chatProvider, sortModels, publicProvider, ProviderError };
