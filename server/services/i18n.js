/* Interface languages & UI string management (phase 41) — FREE for everyone.
 * Languages ar (RTL, default) and en (LTR) only (v2.67: fr / ur retired; a stored fr / ur reads back as en). The bundled
 * catalogue lives in the client chunk i18n-en.js; this service stores admin overrides/additions per key + language (ui_strings), the user's
 * interface language (users.lang) and aggregated "missing string" reports from clients (ui_string_misses, no user ids). */
const { E, HttpError } = require("../lib/core");
const crypto = require("node:crypto");

const LANGUAGES = [
  { code: "ar", name: "العربية", dir: "rtl" },
  { code: "en", name: "English", dir: "ltr" }
];
const CODES = LANGUAGES.map((l) => l.code);
/** a stored interface language read back: retired fr / ur → en, anything unknown → ar */
const readLang = (l) => (l === "fr" || l === "ur" ? "en" : CODES.includes(l) ? l : "ar");
const dirOf = (l) => LANGUAGES.find((x) => x.code === l)?.dir || "rtl";
/** a UI key: either a dotted id ("nav.home") or the Arabic source string itself; no control characters, ≤ 300 chars */
const ctrl = (s, allowNl) => [...s].some((ch) => { const c = ch.charCodeAt(0); return c < 32 && !(allowNl && (c === 9 || c === 10)); });
const validKey = (k) => typeof k === "string" && k.trim().length >= 1 && k.length <= 300 && !ctrl(k, false) && !/[<>]/.test(k);
const validText = (t) => typeof t === "string" && t.trim().length >= 1 && t.length <= 1000 && !ctrl(t, true) && !/[<>]/.test(t);

/** @param {any} ctx @param {{ now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const A = ctx.requireUser, R = ctx.router;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const lang = (l) => { if (!CODES.includes(l)) throw fail(400, "lang_unsupported", "لغة غير مدعومة"); return l; };
  const versions = new Map(); // lang → version (busted on every admin write)
  async function versionOf(l) {
    if (versions.has(l)) return versions.get(l);
    const r = await db.get("SELECT COUNT(*) AS n, MAX(updated_at) AS m FROM ui_strings WHERE lang=$1", [l]);
    const v = crypto.createHash("sha256").update(`${r.n}|${r.m ? new Date(r.m).toISOString() : ""}`).digest("hex").slice(0, 12);
    versions.set(l, v);
    return v;
  }
  async function strings(l) {
    const rows = await db.all("SELECT key, text FROM ui_strings WHERE lang=$1 ORDER BY key", [l]);
    return { lang: l, dir: dirOf(l), version: await versionOf(l), strings: Object.fromEntries(rows.map((r) => [r.key, r.text])) };
  }
  const isAdmin = (u) => u?.role === "admin";
  const admin = (fn) => A(async (req, res) => { if (!isAdmin(req.user)) throw E.forbid("للإدارة فقط"); return fn(req, res); });

  R.get("/api/i18n/config", async () => {
    const v = {}; for (const c of CODES) v[c] = await versionOf(c);
    return { languages: LANGUAGES, default: "ar", fallback: "ar", versions: v, free: true };
  });
  R.get("/api/i18n/strings", async (req) => strings(lang(req.query?.lang || "ar")));
  R.get("/api/me/lang", A(async (req) => { const u = await db.get("SELECT lang FROM users WHERE id=$1", [req.user.id]); const l = readLang(u?.lang); return { lang: l, dir: dirOf(l) }; }));
  R.put("/api/me/lang", A(async (req) => { const l = lang(req.body?.lang); await db.run("UPDATE users SET lang=$1 WHERE id=$2", [l, req.user.id]); return { lang: l, dir: dirOf(l) }; }));
  R.post("/api/i18n/missing", async (req) => {
    const b = req.body || {}; const l = lang(b.lang);
    if (l === "ar") return { ok: true, counted: 0 };
    const who = req.user?.id || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "anon";
    if (!rl.hit("i18n_missing", String(who))) throw E.rate();
    if (!Array.isArray(b.keys) || b.keys.length > 50) throw E.bad();
    const keys = [...new Set(b.keys.filter((k) => validKey(k) && /[\u0600-\u06FF]/.test(k)).map((k) => k.trim()))].slice(0, 50);
    const at = nowIso();
    for (const k of keys) await db.run("INSERT INTO ui_string_misses(lang,key,count,last_seen) VALUES($1,$2,1,$3) ON CONFLICT (lang, key) DO UPDATE SET count=ui_string_misses.count+1, last_seen=$3", [l, k, at]);
    return { ok: true, counted: keys.length };
  });
  R.get("/api/admin/i18n/strings", admin(async (req) => {
    const q = req.query || {}; const l = q.lang ? lang(q.lang) : null; const s = typeof q.q === "string" ? q.q.trim().slice(0, 100).toLowerCase() : "";
    const args = []; let where = "1=1";
    if (l) { args.push(l); where += ` AND lang=$${args.length}`; }
    if (s) { args.push("%" + s + "%"); where += ` AND (LOWER(key) LIKE $${args.length} OR LOWER(text) LIKE $${args.length})`; }
    const rows = await db.all(`SELECT key, lang, text, updated_by, updated_at FROM ui_strings WHERE ${where} ORDER BY updated_at DESC LIMIT 500`, args);
    return { items: rows.map((r) => ({ key: r.key, lang: r.lang, text: r.text, updatedBy: r.updated_by || null, updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : null })), languages: LANGUAGES };
  }));
  R.put("/api/admin/i18n/strings", admin(async (req) => {
    const b = req.body || {}; const l = lang(b.lang);
    if (!validKey(b.key) || !validText(b.text)) throw fail(400, "string_invalid", "المفتاح أو النص غير صالح");
    const key = b.key.trim(), at = nowIso();
    await db.run("INSERT INTO ui_strings(key,lang,text,updated_by,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (key, lang) DO UPDATE SET text=$3, updated_by=$4, updated_at=$5", [key, l, b.text.trim(), req.user.id, at]);
    await db.run("DELETE FROM ui_string_misses WHERE lang=$1 AND key=$2", [l, key]);
    versions.delete(l);
    try { ctx.audit?.("ui_string_set", `${l}:${key.slice(0, 60)}`, null, req.user.id); } catch { /* best effort */ }
    return { item: { key, lang: l, text: b.text.trim(), updatedBy: req.user.id, updatedAt: at }, version: await versionOf(l) };
  }));
  R.del("/api/admin/i18n/strings", admin(async (req) => {
    const b = req.body || {}; const l = lang(b.lang || req.query?.lang);
    const key = typeof b.key === "string" ? b.key : req.query?.key;
    if (!validKey(key)) throw fail(400, "string_invalid", "المفتاح غير صالح");
    const r = await db.run("DELETE FROM ui_strings WHERE key=$1 AND lang=$2", [key.trim(), l]);
    versions.delete(l);
    return { ok: true, deleted: r.changes, version: await versionOf(l) };
  }));
  R.get("/api/admin/i18n/missing", admin(async (req) => {
    const l = lang(req.query?.lang || "en");
    const rows = await db.all("SELECT key, count, last_seen FROM ui_string_misses WHERE lang=$1 ORDER BY count DESC, last_seen DESC LIMIT 300", [l]);
    return { lang: l, items: rows.map((r) => ({ key: r.key, count: Number(r.count), lastSeen: new Date(r.last_seen).toISOString() })) };
  }));

  return { LANGUAGES, CODES, dirOf, strings, versionOf };
};
Object.assign(module.exports, { LANGUAGES, CODES: LANGUAGES.map((l) => l.code) });
