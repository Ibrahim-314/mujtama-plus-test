/* v2.125 search stage 2 — local sentence embeddings, no paid API, no native deps.
 * Model: minishlab/potion-multilingual-128M (Model2Vec static embeddings distilled from BAAI/bge-m3, MIT licence), pruned to the
 * Arabic + common Latin vocabulary (≈106k sub-word pieces × 256 dims), int8 per-row quantised (~27 MB, shipped in <4 MB parts).
 * A sentence vector = mean of its pieces' vectors, L2-normalised; pieces come from a pure-JS SentencePiece-unigram (Viterbi)
 * tokenizer over the model's own vocabulary and scores. Cross-lingual by construction: «سيرة ذاتية» sits near «CV».
 * Loaded lazily on first use; if the files are missing everything degrades to lexical search (available() = false). */
const fs = require("fs"), path = require("path");
const DIR = process.env.SEARCH_MODEL_DIR || path.join(__dirname, "..", "models", "m2v");
const DIM = 256, MAXP = 24;
let M = null, failed = false;
function readParts(base) {
  if (fs.existsSync(base)) return fs.readFileSync(base);
  const parts = []; for (let i = 0; ; i++) { const p = `${base}.part${String(i).padStart(2, "0")}`; if (!fs.existsSync(p)) break; parts.push(fs.readFileSync(p)); }
  if (!parts.length) throw new Error("model file missing: " + base);
  return Buffer.concat(parts);
}
function load() {
  if (M || failed) return M;
  try {
    const vocab = JSON.parse(fs.readFileSync(path.join(DIR, "vocab.json"), "utf8"));
    const vec = readParts(path.join(DIR, "vec.i8")), sc = readParts(path.join(DIR, "scale.f32"));
    if (vec.length !== vocab.length * DIM || sc.length !== vocab.length * 4) throw new Error("model size mismatch");
    const map = new Map(); let maxLen = 1;
    vocab.forEach(([t, s], i) => { map.set(t, i); if (t.length > maxLen) maxLen = t.length; });
    M = { vocab, map, maxLen: Math.min(maxLen, MAXP), q: new Int8Array(vec.buffer, vec.byteOffset, vec.length), scale: new Float32Array(sc.buffer.slice(sc.byteOffset, sc.byteOffset + sc.length)) };
  } catch (e) { failed = true; M = null; if (process.env.NODE_ENV !== "test") console.warn("[search-embed] semantic search off:", e.message); }
  return M;
}
const UNK = 1;
/* SentencePiece unigram, Metaspace «▁» before every word; best segmentation by summed log-probabilities (Viterbi) */
function pieces(word) {
  const m = M, s = "\u2581" + word, n = s.length, best = new Float64Array(n + 1).fill(-Infinity), from = new Int32Array(n + 1), tok = new Int32Array(n + 1);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === -Infinity) continue;
    let any = false;
    for (let j = i + 1; j <= Math.min(n, i + m.maxLen); j++) {
      const id = m.map.get(s.slice(i, j)); if (id === undefined) continue;
      any = true; const v = best[i] + m.vocab[id][1];
      if (v > best[j]) { best[j] = v; from[j] = i; tok[j] = id; }
    }
    if (!any && best[i] - 20 > best[i + 1]) { best[i + 1] = best[i] - 20; from[i + 1] = i; tok[i + 1] = UNK; } // unknown character
  }
  const out = []; for (let j = n; j > 0; j = from[j]) out.push(tok[j]);
  return out.reverse();
}
function tokenize(text) {
  if (!load()) return [];
  const words = String(text || "").normalize("NFKC").replace(/https?:\/\/\S+/g, " ").split(/\s+/).filter(Boolean).slice(0, 400);
  const ids = []; for (const w of words) for (const id of pieces(w.slice(0, 60))) if (id > 3) ids.push(id);
  return ids;
}
/* SIF weight a/(a+p(piece)): frequent pieces («▁في», «▁ال») count less, the rare meaning-bearing ones more */
const SIF_A = 1e-4, sif = (id) => SIF_A / (SIF_A + Math.exp(M.vocab[id][1]));
/* weighted mean of piece vectors → unit vector (Float32Array) or null when nothing known */
function embed(text) {
  const ids = tokenize(text); if (!ids.length) return null;
  const v = new Float32Array(DIM), q = M.q;
  for (const id of ids) { const k = (M.scale[id] / 127) * sif(id), o = id * DIM; for (let d = 0; d < DIM; d++) v[d] += q[o + d] * k; }
  let n = 0; for (let d = 0; d < DIM; d++) n += v[d] * v[d]; n = Math.sqrt(n); if (!n) return null;
  for (let d = 0; d < DIM; d++) v[d] /= n;
  return v;
}
function cos(a, b) { let s = 0; for (let d = 0; d < DIM; d++) s += a[d] * b[d]; return s; }
/* compact storage: int8 of a unit vector (×127) as base64 — 344 chars per document */
const pack = (v) => Buffer.from(Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127)))).buffer).toString("base64");
const unpack = (s) => { const b = Buffer.from(s, "base64"); const i8 = new Int8Array(b.buffer, b.byteOffset, b.length); const v = new Float32Array(DIM); let n = 0; for (let d = 0; d < DIM; d++) { v[d] = i8[d]; n += v[d] * v[d]; } n = Math.sqrt(n) || 1; for (let d = 0; d < DIM; d++) v[d] /= n; return v; };
/* LSH for scale: 64 random hyperplanes (fixed seed) → 8 bands × 8 bits; near vectors share a band bucket with high probability */
let PLANES = null;
function planes() {
  if (PLANES) return PLANES;
  let x = 0x9e3779b9; const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) * 2 - 1; };
  PLANES = Array.from({ length: 64 }, () => Float32Array.from({ length: DIM }, rnd)); return PLANES;
}
function bands(v) { const P = planes(), out = []; for (let b = 0; b < 8; b++) { let k = 0; for (let i = 0; i < 8; i++) if (cos(P[b * 8 + i], v) > 0) k |= 1 << i; out.push(k); } return out; }
/* multi-probe: the exact bucket + every one-bit neighbour, per band */
function probes(v) { const out = []; bands(v).forEach((k, b) => { out.push([b, k]); for (let i = 0; i < 8; i++) out.push([b, k ^ (1 << i)]); }); return out; }
module.exports = { DIM, available: () => !!load(), tokenize, embed, cos, pack, unpack, bands, probes, _reset: () => { M = null; failed = false; } };
