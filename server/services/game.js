/* v2.88 «المدينة الرقمية» — the game's save (migration 080_game_players). The game itself lives in game/ (its own folder,
 * its own bundle); the server only keeps one save per member so the story continues on any device.
 *   GET  /api/game/profile   → { player: null } before the member created a character, else the save
 *   PUT  /api/game/profile   create or update the save. Only known fields, validated:
 *        char      one of CHARS (the characters the game ships)
 *        name      the name they play under: 2–20 letters/digits/space/_ (Arabic or Latin), trimmed
 *        scene     one of SCENES (where they are); pos {x,z,r} numbers inside the scene bounds
 *        flags     story flags: a flat object of short keys → boolean/number/short string (≤ 64 keys)
 *        settings  game settings: music/sfx/ambient 0–1, quality low|medium|high|auto
 *   chapter, level and xp are NOT client-writable: the story advances them on the server in later chapters.
 * Guests (no account) get 401 from requireUser. No money moves here; MJT stays in services/mjt.js + mining.js. */
const { E } = require("../lib/core");

const CHARS = ["hoodie", "casual", "suit", "casual-f", "suit-f"];
const SCENES = ["room"];
const QUALITY = ["auto", "low", "medium", "high"];
const NAME_RE = /^[\p{L}\p{N}_ ]{2,20}$/u;

/** @param {any} ctx */
module.exports = (ctx) => {
  const { db } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } }; // db.js already parses some JSON columns (settings)
  const bad = (m) => E.bad(m);

  const view = (r) => r ? ({
    char: r.char, name: r.name, chapter: Number(r.chapter), scene: r.scene, pos: parse(r.pos, null),
    level: Number(r.level), xp: Number(r.xp), flags: parse(r.flags, {}), settings: parse(r.settings, {}),
    createdAt: r.created_at, updatedAt: r.updated_at
  }) : null;

  function cleanName(v) {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!NAME_RE.test(s)) throw bad("اختر اسماً من 2 إلى 20 حرفاً (حروف وأرقام فقط)");
    return s;
  }
  function cleanPos(v) {
    if (v == null) return null;
    const n = (k, lim) => { const x = Number(v[k]); if (!Number.isFinite(x) || Math.abs(x) > lim) throw bad("موقع غير صالح"); return Math.round(x * 100) / 100; };
    return { x: n("x", 50), z: n("z", 50), r: n("r", 10) };
  }
  function cleanFlags(v) {
    if (v == null) return null;
    if (typeof v !== "object" || Array.isArray(v)) throw bad("flags");
    const out = {}, keys = Object.keys(v);
    if (keys.length > 64) throw bad("flags");
    for (const k of keys) {
      if (!/^[a-z0-9_.-]{1,40}$/i.test(k)) throw bad("flags");
      const x = v[k];
      if (typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) out[k] = x;
      else if (typeof x === "string" && x.length <= 80) out[k] = x;
      else throw bad("flags");
    }
    return out;
  }
  function cleanSettings(v) {
    if (v == null) return null;
    if (typeof v !== "object" || Array.isArray(v)) throw bad("settings");
    const out = {};
    for (const k of ["music", "sfx", "ambient"]) if (v[k] != null) { const x = Number(v[k]); if (!Number.isFinite(x) || x < 0 || x > 1) throw bad("settings"); out[k] = Math.round(x * 100) / 100; }
    if (v.quality != null) { if (!QUALITY.includes(v.quality)) throw bad("settings"); out.quality = v.quality; }
    return out;
  }

  async function get(user) { return { player: view(await db.get("SELECT * FROM game_players WHERE user_id=$1", [user.id])) }; }

  async function put(user, b = {}) {
    const cur = await db.get("SELECT * FROM game_players WHERE user_id=$1", [user.id]);
    const at = new Date().toISOString();
    const char = b.char != null ? String(b.char) : cur?.char;
    if (!CHARS.includes(char)) throw bad("اختر شخصية");
    const name = b.name != null ? cleanName(b.name) : cur?.name;
    if (!name) throw bad("اختر اسماً من 2 إلى 20 حرفاً (حروف وأرقام فقط)");
    const scene = b.scene != null ? String(b.scene) : (cur?.scene || "room");
    if (!SCENES.includes(scene)) throw bad("مكان غير معروف");
    const pos = b.pos !== undefined ? cleanPos(b.pos) : parse(cur?.pos, null);
    const flags = b.flags !== undefined ? { ...parse(cur?.flags, {}), ...cleanFlags(b.flags) } : parse(cur?.flags, {});
    if (Object.keys(flags).length > 64) throw bad("flags");
    const settings = b.settings !== undefined ? { ...parse(cur?.settings, {}), ...cleanSettings(b.settings) } : parse(cur?.settings, {});
    if (!cur) {
      await db.run("INSERT INTO game_players(user_id,char,name,chapter,scene,pos,level,xp,flags,settings,created_at,updated_at) VALUES($1,$2,$3,0,$4,$5,1,0,$6,$7,$8,$8) ON CONFLICT (user_id) DO NOTHING",
        [user.id, char, name, scene, pos ? JSON.stringify(pos) : null, JSON.stringify(flags), JSON.stringify(settings), at]);
    } else {
      await db.run("UPDATE game_players SET char=$2, name=$3, scene=$4, pos=$5, flags=$6, settings=$7, updated_at=$8 WHERE user_id=$1",
        [user.id, char, name, scene, pos ? JSON.stringify(pos) : null, JSON.stringify(flags), JSON.stringify(settings), at]);
    }
    return get(user);
  }

  R.get("/api/game/profile", A(async (req) => get(req.user)));
  R.put("/api/game/profile", A(async (req) => put(req.user, req.body || {})));

  return { get, put, CHARS, SCENES };
};
