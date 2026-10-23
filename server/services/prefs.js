/* Server-stored preferences + cross-device sync (phase 44: personalization) — FREE for everyone.
 * user_prefs (027_prefs): key/value JSON per user, grouped by namespace. The `ui` namespace is validated strictly
 * (theme mode, colour palette, OLED, density, nav order, app icon, sync on/off); other namespaces are free-form JSON
 * within size caps so later phases can reuse the store. `a11y` is reserved (phase 43 keeps it in its own table).
 * Last write wins per key (server time); every write bumps `rev` and pings the user's other open sessions (realtime
 * "prefs") so their devices re-fetch. Also serves the alternate app icons (PNG) and a per-icon web manifest. */
const { E, HttpError } = require("../lib/core");
const crypto = require("node:crypto");
const L = require("../lib/prefs-lib");
const fs = require("node:fs"), path = require("node:path");

/* Phase 46: the default web manifest (/manifest.json: share target, shortcuts, display_override…) is the base of every
 * per-icon manifest, so choosing an alternative icon keeps the installed app's features; only icons + colours change. */
let baseManifest;
function defaultManifest() {
  if (baseManifest !== undefined) return baseManifest;
  baseManifest = null;
  const root = process.env.WEB_ROOT || path.join(__dirname, "..", "..");
  for (const f of [path.join(root, "manifest.json"), path.join(root, "public", "manifest.json")]) {
    try { baseManifest = JSON.parse(fs.readFileSync(f, "utf8")); break; } catch { /* try next */ }
  }
  return baseManifest;
}

const NS_RE = /^[a-z][a-z0-9_]{1,23}$/, KEY_RE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,47}$/;
const RESERVED = ["a11y"];
const MAX_NS = 16, MAX_KEYS = 64, MAX_VALUE = 4096;

/** @param {any} ctx @param {{ now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const A = ctx.requireUser, R = ctx.router;
  const nowIso = () => (opts.now ? opts.now() : new Date()).toISOString();
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const iso = (v) => new Date(v).toISOString();

  async function read(uid, only) {
    const rows = await db.all("SELECT ns, key, value, updated_at FROM user_prefs WHERE user_id=$1 ORDER BY ns, key", [uid]);
    const prefs = {}, updatedAt = {};
    let last = "";
    for (const r of rows) {
      const at = iso(r.updated_at); if (at > last) last = at;
      if (only && !only.includes(r.ns)) continue;
      let v; try { v = JSON.parse(r.value); } catch { continue; }
      (prefs[r.ns] ||= {})[r.key] = v; (updatedAt[r.ns] ||= {})[r.key] = at;
    }
    const rev = crypto.createHash("sha256").update(`${rows.length}|${last}|${rows.map((r) => r.ns + "." + r.key + "=" + r.value).join("\n")}`).digest("hex").slice(0, 16);
    return { prefs, updatedAt, rev, syncedAt: last || null };
  }

  function checkNs(ns) {
    if (typeof ns !== "string" || !NS_RE.test(ns)) throw fail(400, "bad_namespace", "اسم مجموعة الإعدادات غير صالح");
    if (RESERVED.includes(ns)) throw fail(400, "reserved_namespace", "هذه المجموعة تُدار في مكان آخر");
    return ns;
  }
  /** validate a write batch: { ns: { key: value | null } } → flat list */
  function validate(batch) {
    if (!batch || typeof batch !== "object" || Array.isArray(batch)) throw E.bad();
    const out = [];
    for (const [ns, values] of Object.entries(batch)) {
      checkNs(ns);
      if (!values || typeof values !== "object" || Array.isArray(values)) throw E.bad();
      for (const [key, v0] of Object.entries(values)) {
        const v = ns === "ui" ? L.normUi(key, v0) : v0;
        if (!KEY_RE.test(key)) throw fail(400, "bad_key", "اسم إعداد غير صالح");
        if (v === undefined) continue;
        if (v !== null) {
          if (ns === "ui") { const m = L.checkUi(key, v); if (m) throw fail(400, "bad_pref", m); }
          const s = JSON.stringify(v);
          if (Buffer.byteLength(s) > MAX_VALUE) throw fail(413, "pref_too_large", "قيمة الإعداد كبيرة جداً");
          out.push({ ns, key, value: s });
        } else out.push({ ns, key, value: null });
      }
    }
    if (out.length > MAX_KEYS) throw fail(400, "too_many", "إعدادات كثيرة في طلب واحد");
    return out;
  }
  async function write(uid, list) {
    const at = nowIso();
    for (const w of list) {
      if (w.value === null) await db.run("DELETE FROM user_prefs WHERE user_id=$1 AND ns=$2 AND key=$3", [uid, w.ns, w.key]);
      else await db.run("INSERT INTO user_prefs(user_id,ns,key,value,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, ns, key) DO UPDATE SET value=$4, updated_at=$5", [uid, w.ns, w.key, w.value, at]);
    }
    const counts = await db.all("SELECT ns, COUNT(*) AS n FROM user_prefs WHERE user_id=$1 GROUP BY ns", [uid]);
    if (counts.length > MAX_NS || counts.some((c) => Number(c.n) > MAX_KEYS)) {
      // roll back this batch's inserts (keeps previous values of overwritten keys only approximately: limit hits are abuse, not normal use)
      for (const w of list) if (w.value !== null) await db.run("DELETE FROM user_prefs WHERE user_id=$1 AND ns=$2 AND key=$3 AND updated_at=$4", [uid, w.ns, w.key, at]);
      throw fail(400, "too_many", "تجاوزت الحد الأقصى لعدد الإعدادات");
    }
  }
  const ping = (uid, rev) => { try { ctx.realtime?.send?.(uid, "prefs", { rev }); } catch { /* best effort */ } };
  const onlyOf = (q) => (q ? String(q).split(",").filter((x) => NS_RE.test(x)) : null);

  R.get("/api/prefs/catalog", async () => L.catalog());
  R.get("/api/prefs", A(async (req) => {
    const out = await read(req.user.id, onlyOf(req.query?.ns));
    if (req.query?.rev && req.query.rev === out.rev) return { rev: out.rev, unchanged: true, syncedAt: out.syncedAt };
    return out;
  }));
  R.put("/api/prefs", A(async (req) => {
    if (!rl.hit("prefs", req.user.id)) throw E.rate();
    const b = req.body || {};
    const batch = b.prefs !== undefined ? b.prefs : { [b.ns]: b.values };
    if (b.prefs === undefined) checkNs(b.ns);
    await write(req.user.id, validate(batch));
    const out = await read(req.user.id);
    ping(req.user.id, out.rev);
    return out;
  }));
  R.del("/api/prefs", A(async (req) => {
    const ns = checkNs(req.query?.ns);
    await db.run("DELETE FROM user_prefs WHERE user_id=$1 AND ns=$2", [req.user.id, ns]);
    const out = await read(req.user.id);
    ping(req.user.id, out.rev);
    return out;
  }));

  /* alternate app icons + manifest (public, cacheable; the client swaps <link rel=manifest|apple-touch-icon|icon>) */
  R.get("/api/prefs/icons/:file", async (req, res) => {
    const m = /^([a-z]+)-(\d+)\.png$/.exec(req.params.file || "");
    const png = m && L.iconPng(m[1], Number(m[2]));
    if (!png) throw E.nf();
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=604800, immutable", "X-Content-Type-Options": "nosniff" });
    res.end(png);
    return ctx.STREAM;
  });
  R.get("/api/prefs/manifest.webmanifest", async (req, res) => {
    const id = String(req.query?.icon || "classic");
    if (!L.ICONS.some((i) => i.id === id)) throw E.nf();
    const own = L.manifest(id), base = defaultManifest();
    const body = JSON.stringify(base ? { ...base, background_color: own.background_color, theme_color: own.theme_color, icons: own.icons } : own);
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" });
    res.end(body);
    return ctx.STREAM;
  });

  return { read, validate, write, catalog: L.catalog };
};
