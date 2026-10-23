/* Swappable language-model provider layer (Phase 25).
 * • Providers: "extractive" (built in, always available, zero cost) and "openai" (only when OPENAI_API_KEY
 *   is set; any OpenAI-compatible endpoint via OPENAI_BASE_URL). Others can be registered at runtime.
 * • Cost limits: a daily budget in USD (LLM_DAILY_BUDGET_USD, default 1), an input cap per call
 *   (LLM_MAX_INPUT_CHARS) and an output cap (max_tokens). Spend is recorded per day in `llm_usage`;
 *   when a call would exceed the budget the layer falls back to the extractive provider.
 * • Anti-hallucination: models only see numbered source passages and must answer JSON points that each
 *   cite source ids. verify() drops any point that cites an unknown id, introduces numbers absent from its
 *   sources, or whose content words are not supported by the cited text. If nothing survives, the
 *   extractive summary (verbatim source sentences) is returned instead.
 * Every result carries ai:true, the provider name and the citations, so the UI can label it clearly. */
const A = require("./arabic");

/* ---------- extractive provider (verbatim sentences, centroid scoring + redundancy control) ---------- */
function extractive({ sources, maxPoints = 4, perSource = Infinity }) {
  const sents = [];
  for (const src of sources) {
    A.sentences(src.text).forEach((s, i) => {
      let text = s.replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, ""); // trailing hashtag lists are labels, not content
      const toks = A.tokens(text);
      if (toks.length < 3) return;
      if (text.length > 220) { text = text.slice(0, 220).replace(/\s+\S*$/, "") + "…"; }
      sents.push({ id: src.id, text, toks: new Set(toks), pos: i, weight: src.weight || 0 });
    });
  }
  if (!sents.length) return { points: [] };
  const tf = {};
  for (const s of sents) for (const t of s.toks) tf[t] = (tf[t] || 0) + 1;
  const docFreq = (t) => sents.filter(s => s.toks.has(t)).length;
  for (const s of sents) {
    let sc = 0; for (const t of s.toks) sc += tf[t] > 1 ? Math.log2(1 + tf[t]) * (1 + Math.min(docFreq(t), 5) / 5) : 0.15;
    // gentle length normalisation (size^0.3, not sqrt: informative long sentences should not lose to short
    // fragments) and a clear lead bonus: a source's first sentence usually states its point
    s.score = sc / Math.pow(s.toks.size, 0.3) * (1 + Math.log2(1 + s.weight) * 0.3) * (s.pos === 0 ? 1.35 : 1);
  }
  const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
  const chosen = [];
  for (const s of [...sents].sort((a, b) => b.score - a.score)) {
    if (chosen.length >= maxPoints) break;
    if (chosen.some(c => jac(c.toks, s.toks) > 0.45)) continue;
    if (chosen.filter(c => c.id === s.id).length >= perSource) continue; // digests: one point per source
    // supporting citations: other sources that say nearly the same thing
    const cites = [s.id, ...new Set(sents.filter(o => o.id !== s.id && jac(o.toks, s.toks) > 0.35).map(o => o.id))].slice(0, 3);
    chosen.push({ ...s, cites });
  }
  return { points: chosen.map(c => ({ text: c.text, cites: c.cites })) };
}

/* ---------- verification ---------- */
function verify(points, sources) {
  const byId = new Map(sources.map(s => [String(s.id), s]));
  const kept = [], dropped = [];
  for (const p of Array.isArray(points) ? points : []) {
    const text = typeof p?.text === "string" ? p.text.trim().slice(0, 400) : "";
    const cites = (Array.isArray(p?.cites) ? p.cites : []).map(String).filter(c => byId.has(c));
    if (!text || !cites.length) { dropped.push({ text, why: "no_valid_citation" }); continue; }
    const srcText = cites.map(c => byId.get(c).text).join(" ");
    const srcToks = new Set(A.tokens(srcText)), srcNorm = A.normalize(srcText);
    const nums = (A.normalize(text).match(/\d+(?:[.,]\d+)?/g) || []);
    if (nums.some(n => !srcNorm.includes(n))) { dropped.push({ text, why: "unsupported_number" }); continue; }
    const words = A.tokens(text).filter(w => w.length > 2);
    const supported = words.filter(w => srcToks.has(w) || [...srcToks].some(s => s.length > 3 && (s.startsWith(w.slice(0, 4)) || w.startsWith(s.slice(0, 4)))));
    const ratio = words.length ? supported.length / words.length : 0;
    if (ratio < 0.6) { dropped.push({ text, why: "unsupported_content", ratio }); continue; }
    kept.push({ text, cites });
  }
  return { kept, dropped };
}

/* ---------- OpenAI adapter ---------- */
function openaiProvider({ key, base = "https://api.openai.com/v1", model = "gpt-4o-mini", fetchImpl = fetch }) {
  return {
    name: "openai", model, paid: true,
    async complete({ sources, maxPoints, kind, maxTokens }) {
      const passages = sources.map(s => `[${s.id}] ${s.text}`).join("\n");
      const sys = "أنت أداة تلخيص صارمة. لخّص فقط مما ورد في المقاطع المرقّمة، دون أي معلومة أو رقم أو اسم غير موجود فيها. " +
        `أعد JSON فقط بالشكل {"points":[{"text":"…","cites":["id"]}]} بحد أقصى ${maxPoints} نقاط قصيرة بالعربية، وكل نقطة تذكر معرّفات المقاطع التي تستند إليها حرفياً. إن لم يكفِ النص فأعد points فارغة.`;
      const r = await fetchImpl(base.replace(/\/$/, "") + "/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: `نوع المحتوى: ${kind}\n${passages}` }] })
      });
      if (!r.ok) throw new Error("openai " + r.status);
      const j = await r.json();
      const out = JSON.parse(j.choices?.[0]?.message?.content || "{}");
      return { points: out.points || [], usage: { in: j.usage?.prompt_tokens || 0, out: j.usage?.completion_tokens || 0 } };
    }
  };
}

function createLLM(db, { env = process.env, log = console, secret = (k) => env[k] } = {}) {
  const providers = { extractive: { name: "extractive", paid: false, async complete(o) { return extractive(o); } } };
  const key = secret("OPENAI_API_KEY");
  if (key) providers.openai = openaiProvider({ key, base: env.OPENAI_BASE_URL || undefined, model: env.OPENAI_MODEL || undefined });
  const limits = {
    dailyBudget: +(env.LLM_DAILY_BUDGET_USD || 1), maxInputChars: +(env.LLM_MAX_INPUT_CHARS || 12000), maxTokens: +(env.LLM_MAX_OUTPUT_TOKENS || 400),
    priceIn: +(env.LLM_PRICE_IN_PER_1K || 0.00015), priceOut: +(env.LLM_PRICE_OUT_PER_1K || 0.0006)
  };
  let active = env.LLM_PROVIDER && providers[env.LLM_PROVIDER] ? env.LLM_PROVIDER : key ? "openai" : "extractive";
  const day = () => new Date().toISOString().slice(0, 10);
  async function spentToday() { return (await db.get("SELECT COALESCE(SUM(cost),0) c FROM llm_usage WHERE day=$1", [day()]))?.c || 0; }
  async function record(provider, tin, tout, cost) {
    await db.run("INSERT INTO llm_usage(day,provider,calls,tokens_in,tokens_out,cost) VALUES($1,$2,1,$3,$4,$5) ON CONFLICT (day,provider) DO UPDATE SET calls=llm_usage.calls+1, tokens_in=llm_usage.tokens_in+$3, tokens_out=llm_usage.tokens_out+$4, cost=llm_usage.cost+$5", [day(), provider, tin, tout, cost]);
  }
  /** @param {{ kind: string, sources: {id:string,text:string,weight?:number}[], maxPoints?: number, perSource?: number, provider?: string }} o */
  async function summarize(o) {
    const maxPoints = Math.min(o.maxPoints || 4, 6);
    // trim sources to the input budget, keeping the highest-weighted first
    let budget = limits.maxInputChars; const sources = [];
    for (const s of [...o.sources].filter(s => s.text && s.text.trim()).sort((a, b) => (b.weight || 0) - (a.weight || 0))) {
      if (budget <= 0) break; const text = s.text.slice(0, Math.min(budget, 1500)); budget -= text.length; sources.push({ ...s, id: String(s.id), text });
    }
    const name = o.provider && providers[o.provider] ? o.provider : active, p = providers[name];
    const base = { ai: true, generatedAt: new Date().toISOString(), sources: sources.length };
    const fallback = (reason) => ({ ...base, provider: "extractive", fallback: reason, points: extractive({ sources, maxPoints, perSource: o.perSource }).points });
    if (!sources.length) return { ...base, provider: name, points: [] };
    if (!p.paid) {
      const r = await p.complete({ sources, maxPoints, perSource: o.perSource, kind: o.kind, maxTokens: limits.maxTokens });
      const v = name === "extractive" ? { kept: r.points, dropped: [] } : verify(r.points, sources);
      return v.kept.length ? { ...base, provider: name, points: v.kept, dropped: v.dropped.length } : fallback("verification");
    }
    const chars = sources.reduce((a, s) => a + s.text.length, 0);
    const est = (chars / 3.5 / 1000) * limits.priceIn + (limits.maxTokens / 1000) * limits.priceOut;
    if ((await spentToday()) + est > limits.dailyBudget) return fallback("budget");
    try {
      const r = await p.complete({ sources, maxPoints, kind: o.kind, maxTokens: limits.maxTokens });
      const tin = r.usage?.in || Math.round(chars / 3.5), tout = r.usage?.out || 0;
      await record(name, tin, tout, (tin / 1000) * limits.priceIn + (tout / 1000) * limits.priceOut);
      const v = verify(r.points, sources);
      if (!v.kept.length) return fallback("verification");
      return { ...base, provider: name, model: p.model, points: v.kept.slice(0, maxPoints), dropped: v.dropped.length };
    } catch (e) {
      log.error?.("llm call failed", { provider: name, err: e.message });
      return fallback("provider_error");
    }
  }
  return {
    summarize, verify, limits,
    register(name, impl) { providers[name] = { name, paid: !!impl.paid, model: impl.model, complete: impl.complete }; return this; },
    use(name) { if (!providers[name]) throw new Error("unknown provider " + name); active = name; return this; },
    get active() { return active; },
    providers: () => Object.keys(providers),
    async status() { return { active, providers: Object.keys(providers), openaiConfigured: !!key, budgetUsd: limits.dailyBudget, spentTodayUsd: Math.round((await spentToday()) * 10000) / 10000, maxInputChars: limits.maxInputChars, maxOutputTokens: limits.maxTokens }; }
  };
}
module.exports = { createLLM, extractive, verify };
