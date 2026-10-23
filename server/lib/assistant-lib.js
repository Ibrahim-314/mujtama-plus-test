/* AI assistant helpers (phase 42) — pure, no DB. Provider adapter (any OpenAI-compatible endpoint, env key only),
 * vector encoding + cosine top-k (the JS fallback when pgvector is not installed), prompts and the transparency text.
 * Prices are never hard-coded: provider cost per million tokens comes from env (default 0 → only the character caps bite). */
const crypto = require("node:crypto");

const NOT_ON = "المساعد الذكي غير مفعّل بعد";
const LABEL = "مقترح من المساعد الذكي";
const MODES = {
  rephrase: "أعد صياغة النص بأسلوب مختلف مع الحفاظ على المعنى نفسه تماماً.",
  improve: "حسّن النص: صحّح الإملاء والنحو ووضّح العبارات دون إضافة معلومات جديدة.",
  shorter: "اختصر النص مع الحفاظ على فكرته الأساسية.",
  polite: "اجعل النص أكثر لطفاً وتهذيباً واحتراماً دون تغيير مضمونه."
};

/* ---------- vectors ---------- */
function encodeVec(arr) { return Buffer.from(new Float32Array(arr).buffer).toString("base64"); }
function decodeVec(s) { const b = Buffer.from(String(s || ""), "base64"); return new Float32Array(new Uint8Array(b).buffer); }
function cosine(a, b) {
  const n = Math.min(a.length, b.length); let d = 0, x = 0, y = 0;
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}
/** rows: [{vec: base64|Float32Array, ...}] → best k by cosine (score added, vec dropped) */
function topK(query, rows, k = 6, min = 0) {
  const q = query instanceof Float32Array ? query : new Float32Array(query);
  const out = [];
  for (const r of rows) {
    const v = typeof r.vec === "string" ? decodeVec(r.vec) : r.vec;
    if (v.length !== q.length) continue;
    const score = cosine(q, v);
    if (score >= min) { const { vec: _v, ...rest } = r; out.push({ ...rest, score }); }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
const pgVector = (arr) => "[" + Array.from(arr, (x) => (Number.isFinite(x) ? +x.toFixed(6) : 0)).join(",") + "]";
const hashText = (model, text) => crypto.createHash("sha256").update(model + "\n" + text).digest("hex");

/* ---------- provider (OpenAI-compatible) ---------- */
/** @param {{ key: string, base?: string, model?: string, embedModel?: string, rates?: { in?: number, out?: number, embed?: number }, fetchImpl?: typeof fetch, timeoutMs?: number }} o */
function openaiProvider({ key, base = "https://api.openai.com/v1", model = "gpt-4o-mini", embedModel = "text-embedding-3-small", rates = {}, fetchImpl = fetch, timeoutMs = 20000 }) {
  const url = (p) => base.replace(/\/$/, "") + p;
  const post = async (p, body) => {
    const r = await fetchImpl(url(p), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error("provider " + r.status);
    return r.json();
  };
  const cost = (tokIn, tokOut, perIn, perOut) => Math.round((tokIn || 0) * (perIn || 0) + (tokOut || 0) * (perOut || 0)); // micro-USD (rate = USD per 1M tokens)
  return {
    name: "openai", private: true, model, embedModel,
    async chat(messages, { maxTokens = 400, json = false } = {}) {
      const j = await post("/chat/completions", { model, temperature: 0.3, max_tokens: maxTokens, ...(json ? { response_format: { type: "json_object" } } : {}), messages });
      return { text: String(j?.choices?.[0]?.message?.content || ""), costMicros: cost(j?.usage?.prompt_tokens, j?.usage?.completion_tokens, rates.in, rates.out) };
    },
    async embed(texts) {
      const j = await post("/embeddings", { model: embedModel, input: texts });
      return { vectors: (j?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding), costMicros: cost(j?.usage?.prompt_tokens || j?.usage?.total_tokens, 0, rates.embed, 0), model: embedModel };
    }
  };
}
/** env key only: ASSISTANT_API_KEY (or the shared OPENAI_API_KEY), ASSISTANT_BASE_URL / OPENAI_BASE_URL, ASSISTANT_MODEL, ASSISTANT_EMBED_MODEL */
/** @param {Record<string,string|undefined>} env @param {{ fetch?: typeof fetch, provider?: any }} [o] */
function createProvider(env, { fetch: f, provider } = {}) {
  if (provider) return provider;
  const key = env.ASSISTANT_API_KEY || env.OPENAI_API_KEY;
  if (!key) return null;
  const rate = (k) => { const v = Number(env[k]); return Number.isFinite(v) && v > 0 ? v : 0; };
  return openaiProvider({ key, base: env.ASSISTANT_BASE_URL || env.OPENAI_BASE_URL || undefined, model: env.ASSISTANT_MODEL || undefined, embedModel: env.ASSISTANT_EMBED_MODEL || undefined,
    rates: { in: rate("ASSISTANT_USD_PER_MTOK_IN"), out: rate("ASSISTANT_USD_PER_MTOK_OUT"), embed: rate("ASSISTANT_USD_PER_MTOK_EMBED") }, fetchImpl: f || fetch });
}

/* ---------- prompts ---------- */
const SAFE = "لا تضف أي معلومات أو أرقام أو أسماء غير موجودة في النص. أجب بلغة النص الأصلي.";
function writePrompt(mode, text) {
  return [{ role: "system", content: `أنت مساعد كتابة في شبكة اجتماعية. ${MODES[mode]} ${SAFE} أعد النص الناتج فقط دون شرح.` }, { role: "user", content: text }];
}
function repliesPrompt(context, draft) {
  return [{ role: "system", content: 'اقترح ثلاثة ردود قصيرة ومهذبة ومحترمة على المحتوى التالي، بلغته. لا إساءة ولا ادعاءات. أعد JSON فقط بالشكل {"replies":["…","…","…"]}.' },
    { role: "user", content: `المحتوى:\n${context}${draft ? `\n\nمسودة المستخدم (يمكن تحسينها):\n${draft}` : ""}` }];
}
function askPrompt(question, sources) {
  return [{ role: "system", content: "أجب عن السؤال فقط مما ورد في المقاطع المرقّمة من محتوى المجتمع العام، دون أي معلومة أو رقم أو اسم غير موجود فيها. " +
    'أعد JSON فقط بالشكل {"points":[{"text":"…","cites":["s1"]}]} بحد أقصى 4 نقاط قصيرة بلغة السؤال، وكل نقطة تذكر معرّفات المقاطع التي تستند إليها. إن لم تكفِ المقاطع فأعد points فارغة.' },
  { role: "user", content: `السؤال: ${question}\n\n${sources.map((s) => `[${s.id}] ${s.text}`).join("\n")}` }];
}
function parseJson(t) {
  const s = String(t || ""); const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
function cleanReplies(text) {
  const j = parseJson(text);
  const list = Array.isArray(j?.replies) ? j.replies : String(text || "").split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""));
  return [...new Set(list.filter((x) => typeof x === "string").map((x) => x.trim().slice(0, 280)).filter(Boolean))].slice(0, 3);
}

/* ---------- transparency: what the assistant sees ---------- */
const TRANSPARENCY = {
  title: "ما الذي يراه المساعد؟",
  actions: [
    { key: "write", label: "إعادة الصياغة والتحسين", sends: ["النص الذي كتبته في المحرر فقط، عند ضغطك على الزر"] },
    { key: "replies", label: "اقتراح ردود مهذبة", sends: ["نص المنشور أو التعليق العام الذي ترد عليه", "مسودتك إن كتبت شيئاً"] },
    { key: "ask", label: "اسأل المجتمع", sends: ["سؤالك", "مقتطفات من منشورات وتعليقات عامة ذات صلة (حتى 6) تظهر لك مع روابطها"] },
    { key: "search", label: "البحث بالمعنى", sends: ["عبارة البحث فقط"] }
  ],
  never: ["الرسائل الخاصة والمحادثات المشفّرة طرفياً — لا تُرسل أبداً", "المنشورات غير العامة أو المدفوعة أو منشورات المجتمعات الخاصة",
    "اسمك وبريدك ورقمك وموقعك وأي بيانات من حسابك"],
  storage: "لا نخزّن ما ترسله ولا ردود المساعد؛ نحفظ فقط عدد الأحرف لاحتساب حدّك الشهري. فهرس البحث بالمعنى يضم المحتوى العام فقط، بلا معرّفات مستخدمين.",
  control: "المساعد لا ينشر شيئاً بنفسه: أنت تختار استخدام المقترح أو تجاهله."
};

module.exports = { NOT_ON, LABEL, MODES, TRANSPARENCY, encodeVec, decodeVec, cosine, topK, pgVector, hashText, openaiProvider, createProvider, writePrompt, repliesPrompt, askPrompt, parseJson, cleanReplies };
