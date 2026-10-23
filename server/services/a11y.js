/* Full accessibility (phase 43) — FREE for everyone.
 * • Display settings: a fixed whitelist of `a11y.*` keys stored per user in a11y_prefs (not a generic prefs system;
 *   phase 44 owns themes/density). The client also keeps a local copy so signed-out users get the same settings.
 * • Image alt text: user-provided first; otherwise an automatic description from an OpenAI-compatible vision model
 *   ONLY when A11Y_VISION_KEY (or OPENAI_API_KEY) is set AND the image is public (published public post, not paid);
 *   otherwise a heuristic built from the post text (computed on read, never stored, never sent anywhere).
 * • Video captions: WebVTT upload/edit per language (stored in video_captions, mirrored into the media variants the
 *   player already reads); automatic captions only when a speech-to-text endpoint is configured — else manual only.
 * • Periodic audit: a cheap leased job (counts only, no content) recorded in a11y_audits, plus staff-posted CI axe
 *   reports (tools/a11y-audit.mjs). */
const { E, HttpError, id } = require("../lib/core");
const { secret } = require("../lib/secrets");

/** the display settings whitelist: key → validator/normaliser (returns undefined when invalid) */
const oneOf = (...xs) => (v) => (xs.includes(v) ? v : undefined);
const bool = (v) => (typeof v === "boolean" ? v : undefined);
const PREFS = {
  fontScale: (v) => (typeof v === "number" && isFinite(v) && v >= 0.85 && v <= 2 ? Math.round(v * 20) / 20 : undefined),
  contrast: oneOf("normal", "high"),
  dyslexia: bool,
  spacing: oneOf("normal", "wide", "wider"),
  motion: oneOf("system", "reduce", "full"),
  underlineLinks: bool,
  focusRing: oneOf("normal", "strong"),
  captions: bool,
  altReminder: bool
};
const DEFAULTS = { fontScale: 1, contrast: "normal", dyslexia: false, spacing: "normal", motion: "system", underlineLinks: false, focusRing: "normal", captions: false, altReminder: true };
const MID = /^md_[\w]{4,40}$/;
const LANG = /^[a-z]{2}$/;
const LABELS = { ar: "العربية", en: "English", fr: "Français", ur: "اردو" };
const ctrl = (s) => [...s].some((ch) => { const c = ch.charCodeAt(0); return c < 32 && c !== 10 && c !== 9; });
const cleanAlt = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
const validAlt = (s) => s.length >= 1 && s.length <= 500 && !ctrl(s) && !/[<>]/.test(s);

/** heuristic alt text from the post that carries the image (Arabic): first sentence of the text, ≤ 120 chars */
function heuristicAlt(text, handle) {
  const t = String(text || "").replace(/https?:\/\/\S+/g, "").replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, "").replace(/\s+/g, " ").trim();
  const first = (t.split(/(?<=[.!؟?…])\s/)[0] || "").slice(0, 120).trim();
  const who = handle ? ` من منشور @${handle}` : "";
  return first ? `صورة${who}: ${first}` : `صورة${who}`;
}
/** speech segments → WebVTT */
const ts = (s) => { const ms = Math.max(0, Math.round(s * 1000)); const h = Math.floor(ms / 36e5), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; };
const segmentsToVtt = (segs) => "WEBVTT\n\n" + segs.filter((s) => s && String(s.text || "").trim()).map((s, i) => `${i + 1}\n${ts(+s.start || 0)} --> ${ts(Math.max(+s.end || 0, (+s.start || 0) + 0.5))}\n${String(s.text).replace(/-->/g, "→").replace(/[<>]/g, "").trim()}`).join("\n\n") + "\n";

/** OpenAI-compatible vision provider (chat/completions with an image part). Only built when a key is configured. */
function createVision(env = process.env) {
  const key = secret("A11Y_VISION_KEY") || secret("OPENAI_API_KEY");
  if (!key) return null;
  const base = (env.A11Y_VISION_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = env.A11Y_VISION_MODEL || "gpt-4o-mini";
  return {
    name: "openai-vision",
    async describe(buf, mime, { lang = "ar", hint = "" } = {}) {
      const body = { model, max_tokens: 120, temperature: 0.2, messages: [
        { role: "system", content: "You write concise alt text for screen-reader users. One sentence, at most 25 words, no 'image of'. Describe only what is visible. Never identify real people by name. Reply in " + (lang === "ar" ? "Arabic" : lang) + "." },
        { role: "user", content: [{ type: "text", text: hint ? "Context (may be unrelated): " + hint.slice(0, 200) : "Describe this image." }, { type: "image_url", image_url: { url: `data:${mime};base64,${buf.toString("base64")}` } }] }] };
      const r = await fetch(base + "/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error("vision " + r.status);
      const j = await r.json();
      return cleanAlt(j.choices?.[0]?.message?.content || "").replace(/[<>]/g, "").slice(0, 300);
    }
  };
}
/** speech-to-text for captions: any OpenAI-compatible /audio/transcriptions endpoint (Whisper accepts mp4/webm). */
function createCaptioner(env = process.env) {
  const key = secret("A11Y_ASR_KEY") || secret("OPENAI_API_KEY") || secret("WHISPER_API_KEY");
  const url = env.WHISPER_URL || (key ? "https://api.openai.com/v1/audio/transcriptions" : null);
  if (!url) return null;
  return {
    name: "whisper",
    async transcribe(buf, { lang = "ar", filename = "video.mp4" } = {}) {
      const form = new FormData();
      form.append("file", new Blob([buf]), filename); form.append("model", env.WHISPER_MODEL || "whisper-1"); form.append("language", lang); form.append("response_format", "verbose_json");
      const r = await fetch(url, { method: "POST", body: form, headers: key ? { Authorization: "Bearer " + key } : {}, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error("asr " + r.status);
      const j = await r.json();
      return { segments: (j.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })) };
    }
  };
}

/** @param {any} ctx @param {{ now?: () => Date, vision?: any, captioner?: any, jobs?: boolean, env?: any }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const A = ctx.requireUser, R = ctx.router;
  const env = opts.env || process.env;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const vision = opts.vision !== undefined ? opts.vision : createVision(env);
  const captioner = opts.captioner !== undefined ? opts.captioner : createCaptioner(env);
  const isAdmin = (u) => u?.role === "admin";
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

  /* ---------------- display settings ---------------- */
  async function getPrefs(uid) {
    const rows = await db.all("SELECT key, value FROM a11y_prefs WHERE user_id=$1", [uid]);
    const out = { ...DEFAULTS };
    for (const r of rows) { const k = r.key.replace(/^a11y\./, ""); if (PREFS[k]) { const v = PREFS[k](parse(r.value, undefined)); if (v !== undefined) out[k] = v; } }
    return out;
  }
  async function setPrefs(uid, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw E.bad();
    const at = nowIso(); let n = 0;
    for (const [k, raw] of Object.entries(patch)) {
      if (!PREFS[k]) throw fail(400, "pref_unknown", "إعداد غير معروف");
      const v = PREFS[k](raw); if (v === undefined) throw fail(400, "pref_invalid", "قيمة غير صالحة");
      if (++n > 20) throw E.bad();
      if (v === DEFAULTS[k]) await db.run("DELETE FROM a11y_prefs WHERE user_id=$1 AND key=$2", [uid, "a11y." + k]);
      else await db.run("INSERT INTO a11y_prefs(user_id,key,value,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id, key) DO UPDATE SET value=$3, updated_at=$4", [uid, "a11y." + k, JSON.stringify(v), at]);
    }
    return getPrefs(uid);
  }

  /* ---------------- media visibility ---------------- */
  const mediaRow = (mid) => (MID.test(mid || "") ? db.get("SELECT id, owner, kind, mime, size, storage_key, variants FROM media WHERE id=$1", [mid]) : null);
  /** the published public post that shows this media (null if none / paid / private) */
  async function publicPost(mid) {
    if (await db.get("SELECT 1 AS x FROM paid_media WHERE media_id=$1", [mid]).catch(() => null)) return null;
    return db.get("SELECT p.id, p.text, u.handle FROM posts p JOIN users u ON u.id=p.author WHERE p.status='published' AND p.visibility='public' AND CAST(p.data AS TEXT) LIKE $1 ORDER BY p.created_at LIMIT 1", ["%" + mid + "%"]);
  }

  /* ---------------- alt text ---------------- */
  async function resolveAlt(mid, viewer) {
    const m = await mediaRow(mid); if (!m || m.kind !== "image") return null;
    const own = viewer && viewer === m.owner;
    const post = await publicPost(mid);
    if (!own && !post) return null; // never reveal anything about media the caller cannot see publicly
    const row = await db.get("SELECT alt, source, lang FROM media_alt WHERE media_id=$1", [mid]);
    if (row) return { mediaId: mid, alt: row.alt, source: row.source, lang: row.lang || "ar" };
    return { mediaId: mid, alt: heuristicAlt(post?.text, post?.handle), source: "heuristic", lang: "ar" };
  }
  async function setAlt(user, mid, alt) {
    const m = await mediaRow(mid); if (!m || m.owner !== user.id) throw E.nf();
    if (m.kind !== "image") throw fail(400, "not_image", "ليست صورة");
    const a = cleanAlt(alt);
    if (!a) { await db.run("DELETE FROM media_alt WHERE media_id=$1", [mid]); return resolveAlt(mid, user.id); }
    if (!validAlt(a)) throw fail(400, "alt_invalid", "النص البديل غير صالح");
    const at = nowIso();
    await db.run("INSERT INTO media_alt(media_id,owner,alt,source,lang,provider,created_at,updated_at) VALUES($1,$2,$3,'user',$4,NULL,$5,$5) ON CONFLICT (media_id) DO UPDATE SET alt=$3, source='user', lang=$4, provider=NULL, updated_at=$5", [mid, user.id, a, /[\u0600-\u06FF]/.test(a) ? "ar" : "en", at]);
    return { mediaId: mid, alt: a, source: "user", lang: /[\u0600-\u06FF]/.test(a) ? "ar" : "en" };
  }
  /** automatic description: vision only for public images with a configured key; otherwise heuristic (not stored) */
  async function autoAlt(mid, { force = false } = {}) {
    const m = await mediaRow(mid); if (!m || m.kind !== "image") return null;
    const existing = await db.get("SELECT source FROM media_alt WHERE media_id=$1", [mid]);
    if (existing && (existing.source === "user" || !force)) return null;
    const post = await publicPost(mid);
    if (!vision || !post || (m.size || 0) > 4 * 1024 * 1024) return { mediaId: mid, alt: heuristicAlt(post?.text, post?.handle), source: "heuristic", lang: "ar" };
    const buf = await readMedia(m); if (!buf) return { mediaId: mid, alt: heuristicAlt(post.text, post.handle), source: "heuristic", lang: "ar" };
    let alt = "";
    try { alt = await vision.describe(buf, m.mime || "image/jpeg", { lang: "ar", hint: post.text || "" }); } catch (e) { ctx.log?.warn?.("a11y vision failed", { err: e.message }); }
    if (!alt || !validAlt(alt)) return { mediaId: mid, alt: heuristicAlt(post.text, post.handle), source: "heuristic", lang: "ar" };
    const at = nowIso();
    // never overwrite a user's own text, even if they wrote it while the model was running
    await db.run("INSERT INTO media_alt(media_id,owner,alt,source,lang,provider,created_at,updated_at) VALUES($1,$2,$3,'auto','ar',$4,$5,$5) ON CONFLICT (media_id) DO UPDATE SET alt=$3, source='auto', provider=$4, updated_at=$5 WHERE media_alt.source<>'user'", [mid, m.owner, alt, vision.name || "vision", at]);
    return { mediaId: mid, alt, source: "auto", lang: "ar" };
  }
  async function readMedia(m) {
    try {
      const svc = ctx.services.media;
      if (svc?.ensureLocal) { const f = await svc.ensureLocal(m.storage_key); return require("node:fs").readFileSync(f); }
    } catch { /* fall through */ }
    try { return await ctx.storage?.get?.(m.storage_key); } catch { return null; }
  }

  /* ---------------- captions ---------------- */
  const toVtt = (t) => {
    if (ctx.services.media?.toVtt) return ctx.services.media.toVtt(t);
    let s = String(t).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
    if (!s.startsWith("WEBVTT")) s = "WEBVTT\n\n" + s.replace(/^\d+\n(?=\d{2}:\d{2})/gm, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    if (!/\d{2}:\d{2}(:\d{2})?\.\d{3}\s+-->\s+/.test(s)) throw E.bad("ملف الترجمة غير صالح");
    return s.replace(/<(?!\/?(b|i|u|c|v|lang)\b)[^>]*>/gi, "") + "\n";
  };
  async function videoFor(user, mid, { own = true } = {}) {
    const m = await mediaRow(mid); if (!m || m.kind !== "video") throw E.nf();
    if (own && m.owner !== user?.id) throw E.nf();
    return m;
  }
  async function canSeeVideo(user, m) {
    if (user && user.id === m.owner) return true;
    if (await publicPost(m.id)) return true;
    try { await ctx.services.paid?.assertMedia?.(user, m.id); } catch { return false; }
    return !!user && !!(await db.get("SELECT 1 AS x FROM posts WHERE status='published' AND CAST(data AS TEXT) LIKE $1", ["%" + m.id + "%"]));
  }
  /** mirror the caption list into media.variants (+ posts) so the existing player shows <track>s */
  async function mirror(m) {
    const rows = await db.all("SELECT lang, label, source FROM video_captions WHERE media_id=$1 ORDER BY lang", [m.id]);
    const captions = rows.map((r) => ({ lang: r.lang, label: r.label, url: `/api/a11y/captions/${m.id}/${r.lang}.vtt`, source: r.source }));
    const fresh = await db.get("SELECT variants FROM media WHERE id=$1", [m.id]);
    const v = typeof fresh?.variants === "string" ? parse(fresh.variants, {}) : (fresh?.variants || {});
    await db.run("UPDATE media SET variants=$1 WHERE id=$2", [{ ...v, captions }, m.id]);
    for (const p of await db.all("SELECT id, data FROM posts WHERE author=$1 AND type IN ('video','story') AND CAST(data AS TEXT) LIKE $2", [m.owner, "%" + m.id + "%"])) {
      const d = typeof p.data === "string" ? parse(p.data, {}) : p.data;
      if (d?.video?.mediaId === m.id) await db.run("UPDATE posts SET data=$1 WHERE id=$2", [{ ...d, video: { ...d.video, variants: { ...(d.video.variants || {}), captions } } }, p.id]);
    }
    return captions;
  }
  async function saveCaptions(m, lang, vttText, source, label) {
    if (typeof vttText !== "string" || !vttText.trim() || vttText.length > 512 * 1024) throw fail(400, "vtt_invalid", "ملف الترجمة كبير أو فارغ");
    const vtt = toVtt(vttText), at = nowIso();
    const lb = typeof label === "string" && label.trim() && label.length <= 40 && !/[<>]/.test(label) ? label.trim() : (LABELS[lang] || lang);
    await db.run("INSERT INTO video_captions(media_id,lang,owner,label,vtt,source,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (media_id, lang) DO UPDATE SET label=$4, vtt=$5, source=$6, updated_at=$7", [m.id, lang, m.owner, lb, vtt, source, at]);
    return { lang, label: lb, source, vtt, captions: await mirror(m) };
  }
  const langOf = (l) => { const x = l || "ar"; if (!LANG.test(x)) throw fail(400, "lang_invalid", "لغة غير صالحة"); return x; };

  /* ---------------- audit ---------------- */
  async function audit() {
    const started = nowIso(), since = new Date(Date.parse(started) - 7 * 864e5).toISOString();
    const n = async (sql, args) => Number((await db.get(sql, args))?.n || 0);
    const images = await n("SELECT COUNT(*) AS n FROM media WHERE kind='image' AND created_at >= $1", [since]);
    const imagesAlt = await n("SELECT COUNT(*) AS n FROM media m JOIN media_alt a ON a.media_id=m.id WHERE m.kind='image' AND m.created_at >= $1", [since]);
    const videos = await n("SELECT COUNT(*) AS n FROM media WHERE kind='video' AND created_at >= $1", [since]);
    const videosCc = await n("SELECT COUNT(DISTINCT m.id) AS n FROM media m JOIN video_captions c ON c.media_id=m.id WHERE m.kind='video' AND m.created_at >= $1", [since]);
    const usersWithPrefs = await n("SELECT COUNT(DISTINCT user_id) AS n FROM a11y_prefs", []);
    const lastCi = await db.get("SELECT started_at, ok, issues FROM a11y_audits WHERE kind='ci' ORDER BY started_at DESC LIMIT 1");
    const missingAlt = images - imagesAlt, missingCc = videos - videosCc;
    const summary = { window: "7d", images, imagesWithAlt: imagesAlt, missingAlt, videos, videosWithCaptions: videosCc, missingCaptions: missingCc, usersWithPrefs,
      altCoverage: images ? Math.round((imagesAlt / images) * 100) : 100, captionCoverage: videos ? Math.round((videosCc / videos) * 100) : 100,
      lastCi: lastCi ? { at: new Date(lastCi.started_at).toISOString(), ok: !!lastCi.ok, issues: Number(lastCi.issues) } : null,
      vision: !!vision, autoCaptions: !!captioner };
    const issues = missingAlt + missingCc + (lastCi && !lastCi.ok ? Number(lastCi.issues) : 0);
    const rid = id("a11y");
    await db.run("INSERT INTO a11y_audits(id,kind,started_at,finished_at,ok,issues,summary) VALUES($1,'server',$2,$3,$4,$5,$6)", [rid, started, nowIso(), issues === 0 ? 1 : 0, issues, JSON.stringify(summary)]);
    await db.run("DELETE FROM a11y_audits WHERE started_at < $1", [new Date(Date.parse(started) - 180 * 864e5).toISOString()]);
    return { id: rid, kind: "server", ok: issues === 0, issues, summary };
  }
  /** maintenance: run the cheap audit; when a vision key exists, describe a few recent public images without alt */
  async function maintain() {
    const out = { audit: await audit(), described: 0 };
    if (vision) {
      const max = Math.max(0, Math.min(50, +(env.A11Y_VISION_MAX_PER_RUN || 10)));
      const rows = max ? await db.all("SELECT m.id FROM media m LEFT JOIN media_alt a ON a.media_id=m.id WHERE m.kind='image' AND a.media_id IS NULL ORDER BY m.created_at DESC LIMIT $1", [max * 3]) : [];
      for (const r of rows) { if (out.described >= max) break; const x = await autoAlt(r.id).catch(() => null); if (x?.source === "auto") out.described++; }
    }
    return out;
  }
  const rowAudit = (r) => ({ id: r.id, kind: r.kind, startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null, ok: !!r.ok, issues: Number(r.issues), summary: parse(r.summary, {}) });

  /* ---------------- routes ---------------- */
  R.get("/api/a11y/config", async () => ({ free: true, defaults: DEFAULTS, keys: Object.keys(PREFS).map((k) => "a11y." + k), vision: !!vision, autoCaptions: !!captioner, fontScale: { min: 0.85, max: 2, step: 0.05 } }));
  R.get("/api/me/a11y", A(async (req) => ({ prefs: await getPrefs(req.user.id) })));
  R.put("/api/me/a11y", A(async (req) => { if (!rl.hit("a11y_prefs", req.user.id)) throw E.rate(); return { prefs: await setPrefs(req.user.id, req.body?.prefs ?? req.body) }; }));
  R.del("/api/me/a11y", A(async (req) => { await db.run("DELETE FROM a11y_prefs WHERE user_id=$1", [req.user.id]); return { prefs: { ...DEFAULTS } }; }));

  R.get("/api/a11y/alt", async (req) => {
    const ids = String(req.query?.ids || "").split(",").map((s) => s.trim()).filter((s) => MID.test(s));
    if (!ids.length || ids.length > 40) throw E.bad();
    const alts = {};
    for (const mid of [...new Set(ids)]) { const a = await resolveAlt(mid, req.user?.id); if (a) alts[mid] = { alt: a.alt, source: a.source, lang: a.lang }; }
    return { alts };
  });
  R.get("/api/a11y/alt/:mid", async (req) => { const a = await resolveAlt(req.params.mid, req.user?.id); if (!a) throw E.nf(); return a; });
  R.put("/api/a11y/alt/:mid", A(async (req) => setAlt(req.user, req.params.mid, req.body?.alt)));
  R.post("/api/a11y/alt/:mid/auto", A(async (req) => {
    const m = await mediaRow(req.params.mid); if (!m || m.owner !== req.user.id || m.kind !== "image") throw E.nf();
    if (!rl.hit("a11y_auto", req.user.id)) throw E.rate();
    const cur = await db.get("SELECT alt, source FROM media_alt WHERE media_id=$1", [m.id]);
    if (cur?.source === "user" && !req.body?.replace) return { mediaId: m.id, alt: cur.alt, source: "user", lang: "ar" };
    if (cur?.source === "user") await db.run("DELETE FROM media_alt WHERE media_id=$1 AND source='user'", [m.id]);
    return (await autoAlt(m.id, { force: true })) || (await resolveAlt(m.id, req.user.id));
  }));

  R.get("/api/a11y/captions/:mid", async (req) => {
    const m = await mediaRow(req.params.mid); if (!m || m.kind !== "video" || !(await canSeeVideo(req.user, m))) throw E.nf();
    const rows = await db.all("SELECT lang, label, source, updated_at FROM video_captions WHERE media_id=$1 ORDER BY lang", [m.id]);
    return { mediaId: m.id, autoAvailable: !!captioner, captions: rows.map((r) => ({ lang: r.lang, label: r.label, source: r.source, url: `/api/a11y/captions/${m.id}/${r.lang}.vtt`, updatedAt: new Date(r.updated_at).toISOString() })) };
  });
  R.get("/api/a11y/captions/:mid/:file", async (req, res) => {
    const mm = /^([a-z]{2})\.vtt$/.exec(req.params.file || ""); if (!mm) throw E.nf();
    const m = await mediaRow(req.params.mid); if (!m || m.kind !== "video" || !(await canSeeVideo(req.user, m))) throw E.nf();
    const r = await db.get("SELECT vtt FROM video_captions WHERE media_id=$1 AND lang=$2", [m.id, mm[1]]); if (!r) throw E.nf();
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, max-age=60", "X-Content-Type-Options": "nosniff" });
    res.end(r.vtt); return ctx.STREAM;
  });
  R.put("/api/a11y/captions/:mid/:lang", A(async (req) => {
    const m = await videoFor(req.user, req.params.mid); const lang = langOf(req.params.lang);
    if (!rl.hit("a11y_captions", req.user.id)) throw E.rate();
    const r = await saveCaptions(m, lang, req.body?.vtt, "manual", req.body?.label);
    return { lang: r.lang, label: r.label, source: r.source, vtt: r.vtt, captions: r.captions };
  }));
  R.del("/api/a11y/captions/:mid/:lang", A(async (req) => {
    const m = await videoFor(req.user, req.params.mid); const lang = langOf(req.params.lang);
    await db.run("DELETE FROM video_captions WHERE media_id=$1 AND lang=$2", [m.id, lang]);
    return { captions: await mirror(m) };
  }));
  R.get("/api/a11y/captions/:mid/:lang/source", A(async (req) => {
    const m = await videoFor(req.user, req.params.mid); const lang = langOf(req.params.lang);
    const r = await db.get("SELECT vtt, label, source FROM video_captions WHERE media_id=$1 AND lang=$2", [m.id, lang]); if (!r) throw E.nf();
    return { lang, label: r.label, source: r.source, vtt: r.vtt };
  }));
  R.post("/api/a11y/captions/:mid/auto", A(async (req) => {
    const m = await videoFor(req.user, req.params.mid); const lang = langOf(req.body?.lang);
    if (!captioner) throw fail(503, "not_configured", "الترجمة النصية الآلية غير مفعّلة — أضف ملف ترجمة يدوياً");
    if (!rl.hit("a11y_asr", req.user.id)) throw E.rate();
    if ((m.size || 0) > 25 * 1024 * 1024) throw fail(400, "too_large", "الفيديو أكبر من حد التفريغ الآلي");
    const buf = await readMedia(m); if (!buf) throw fail(409, "media_unavailable", "ملف الفيديو غير متاح بعد");
    let segs;
    try { segs = (await captioner.transcribe(buf, { lang, filename: "video" + (/webm/.test(m.mime || "") ? ".webm" : ".mp4") })).segments || []; } catch { throw fail(502, "provider_failed", "تعذّر التفريغ الآلي، حاول لاحقاً"); }
    if (!segs.length) throw fail(422, "no_speech", "لم يُعثر على كلام في الفيديو");
    const r = await saveCaptions(m, lang, segmentsToVtt(segs), "auto");
    return { lang: r.lang, label: r.label, source: r.source, vtt: r.vtt, captions: r.captions };
  }));

  R.get("/api/admin/a11y/audits", admin(async (req) => {
    const k = req.query?.kind; const rows = k === "ci" || k === "server" ? await db.all("SELECT * FROM a11y_audits WHERE kind=$1 ORDER BY started_at DESC LIMIT 30", [k]) : await db.all("SELECT * FROM a11y_audits ORDER BY started_at DESC LIMIT 30");
    return { items: rows.map(rowAudit) };
  }));
  R.post("/api/admin/a11y/audits/run", admin(async () => audit()));
  /** staff upload of a CI axe report produced by tools/a11y-audit.mjs (counts + rule ids only) */
  R.post("/api/admin/a11y/audits", admin(async (req) => {
    const b = req.body || {};
    const pages = Array.isArray(b.pages) ? b.pages.slice(0, 50).filter((p) => p && typeof p.route === "string" && p.route.length <= 100).map((p) => ({ route: p.route, violations: Math.max(0, Math.min(1000, +p.violations || 0)), rules: Array.isArray(p.rules) ? p.rules.filter((x) => typeof x === "string" && /^[\w-]{1,60}$/.test(x)).slice(0, 30) : [] })) : null;
    if (!pages) throw E.bad();
    const issues = pages.reduce((s, p) => s + p.violations, 0), at = nowIso(), rid = id("a11y");
    const summary = { pages, release: typeof b.release === "string" ? b.release.slice(0, 40) : null, tool: "axe-core" };
    await db.run("INSERT INTO a11y_audits(id,kind,started_at,finished_at,ok,issues,summary,created_by) VALUES($1,'ci',$2,$2,$3,$4,$5,$6)", [rid, at, issues === 0 ? 1 : 0, issues, JSON.stringify(summary), req.user.id]);
    return { id: rid, kind: "ci", ok: issues === 0, issues, summary };
  }));

  const jobsOn = opts.jobs !== undefined ? opts.jobs : env.A11Y_JOBS !== "0";
  if (jobsOn && ctx.scheduler) ctx.scheduler.every("a11y.audit", +(env.A11Y_AUDIT_INTERVAL_MS || 24 * 3600e3), maintain);

  return { getPrefs, setPrefs, resolveAlt, setAlt, autoAlt, audit, maintain, heuristicAlt, segmentsToVtt, DEFAULTS, PREFS: Object.keys(PREFS), vision: () => !!vision, captioner: () => !!captioner };
};
module.exports.heuristicAlt = heuristicAlt;
module.exports.segmentsToVtt = segmentsToVtt;
