/* v2.88 «المدينة الرقمية» — the game's save (migration 080_game_players). The game itself lives in game/ (its own folder,
 * its own bundle); the server only keeps one save per member so the story continues on any device.
 *   GET  /api/game/profile   → { player: null } before the member created a character, else the save
 *   PUT  /api/game/profile   create or update the save. Only known fields, validated:
 *        char      one of CHARS (the characters the game ships)
 *        name      the name they play under: 2–20 letters/digits/space/_ (Arabic or Latin), trimmed
 *        scene     one of SCENES (where they are); pos {x,z,r} numbers inside the scene bounds
 *        flags     story flags: a flat object of short keys → boolean/number/short string (≤ 64 keys)
 *        settings  game settings: music/sfx/ambient 0–1, quality low|medium|high|auto
 *   chapter, level and xp are NOT client-writable: only the missions below change them, on the server.
 * Phase 2D-A — server-authoritative missions (migration 081_game_missions, catalogue in services/game-missions.js):
 *   GET  /api/game/missions                → { progress, missions[] }
 *   POST /api/game/missions/:id/complete   no body is read. One DB transaction: prerequisites + check → INSERT the
 *        completion (PRIMARY KEY (user_id, mission_id) → a repeat inserts nothing) → xp += the catalogue's XP, level from
 *        the server's curve, chapter opened. A repeated or concurrent request returns { already: true } and grants nothing.
 *   Story flags stay presentation only: they never grant XP and are never read by the missions.
 *   scene "street" (v2D-A): accepted only after the member left the room (mission c0.leave, or the room.out story flag
 *        of saves made before missions existed), with the street's own position bounds; a scene change without a
 *        position clears the old scene's position.
 * Guests (no account) get 401 from requireUser. No money moves here; MJT stays in services/mjt.js + mining.js. */
const { E, HttpError } = require("../lib/core");
const GM = require("./game-missions");

const CHARS = ["hoodie", "casual", "suit", "casual-f", "suit-f"];
const SCENES = ["room", "street"];
const BOUNDS = { room: { x: [-50, 50], z: [-50, 50] }, street: { x: [-9, 9], z: [-38, 4] } }; // street: the walkable boulevard (scenes/street.js WALK=9, GATE_Z+0.55 … HOME_Z-0.45)
const QUALITY = ["auto", "low", "medium", "high"];
const NAME_RE = /^[\p{L}\p{N}_ ]{2,20}$/u;

/** @param {any} ctx */
module.exports = (ctx) => {
  const { db, rl } = ctx;
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
  function cleanPos(v, scene = "room") {
    if (v == null) return null;
    if (typeof v !== "object") throw bad("موقع غير صالح");
    const b = BOUNDS[scene] || BOUNDS.room;
    const n = (k, lo, hi) => { const x = Number(v[k]); if (!Number.isFinite(x) || x < lo || x > hi) throw bad("موقع غير صالح"); return Math.round(x * 100) / 100; };
    return { x: n("x", b.x[0], b.x[1]), z: n("z", b.z[0], b.z[1]), r: n("r", -10, 10) };
  }
  const fail = (status, code, msg) => new HttpError(status, msg, code);
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
    const flags = b.flags !== undefined ? { ...parse(cur?.flags, {}), ...cleanFlags(b.flags) } : parse(cur?.flags, {});
    if (Object.keys(flags).length > 64) throw bad("flags");
    if (scene === "street" && cur?.scene !== "street" && !(await leftRoom(user.id, cur, flags))) throw bad("لم تخرج من شقتك بعد");
    const sceneChanged = scene !== (cur?.scene || "room");
    const pos = b.pos !== undefined ? cleanPos(b.pos, scene) : sceneChanged ? null : parse(cur?.pos, null);
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

  /** may this member be saved in the street? (a legitimate transition: they left the room) */
  async function leftRoom(uid, cur, flags) {
    if (!cur) return false; // a brand-new save always starts in the room
    if (await db.get("SELECT 1 AS ok FROM game_missions WHERE user_id=$1 AND mission_id='c0.leave'", [uid])) return true;
    // the room.out story flag (also in the same save request, as the door writes it) covers saves from before missions
    // existed and offline exits. It only decides WHERE the save resumes — it never grants XP or completes a mission.
    return flags?.["room.out"] === true;
  }

  /* ---------- missions (Phase 2D-A) ---------- */
  const doneMapOf = async (uid, q = db) => new Map((await q.all("SELECT mission_id, xp, completed_at FROM game_missions WHERE user_id=$1", [uid])).map((r) => [r.mission_id, r]));

  async function missions(user) {
    const p = await db.get("SELECT xp, level, chapter FROM game_players WHERE user_id=$1", [user.id]);
    const done = await doneMapOf(user.id);
    return { progress: GM.progressOf(p), missions: GM.listFor(done) };
  }

  /** read-only checks for verify "server" missions: a record the server itself wrote */
  async function serverCheck(t, m, uid) {
    if (m.check === "mining_session") return !!(await t.get("SELECT 1 AS ok FROM mjt_mining WHERE user_id=$1 LIMIT 1", [uid]));
    return false;
  }

  async function complete(user, missionId) {
    const mid = String(missionId || "");
    const m = GM.ID_RE.test(mid) ? GM.BY_ID.get(mid) : null;
    if (!m) throw fail(404, "unknown_mission", "مهمة غير معروفة");
    const r = await db.tx(async (t) => {
      const p = await t.get("SELECT user_id, xp, level, chapter, created_at FROM game_players WHERE user_id=$1", [user.id]);
      if (!p) throw fail(409, "no_player", "أنشئ شخصيتك أولاً");
      const done = await doneMapOf(user.id, t);
      if (done.has(m.id)) return { already: true };
      if (m.requires.some((x) => !done.has(x))) throw fail(409, "locked", "أكمل المهمة السابقة أولاً");
      const now = Date.now();
      if (m.minAfterStart && !(now - GM.ms(p.created_at) >= m.minAfterStart)) throw fail(422, "invalid_objective", "لم يكتمل الهدف بعد");
      if (m.verify === "server" && !(await serverCheck(t, m, user.id))) throw fail(422, "invalid_objective", "لم يكتمل الهدف بعد");
      const at = new Date(now).toISOString();
      const ins = await t.run("INSERT INTO game_missions(user_id,mission_id,xp,verify,completed_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id, mission_id) DO NOTHING", [user.id, m.id, m.xp, m.verify, at]);
      if (!ins.changes) return { already: true }; // a concurrent request won the PRIMARY KEY: nothing more is granted
      const opens = Number(m.opens ?? m.chapter);
      await t.run("UPDATE game_players SET xp = xp + $2, chapter = CASE WHEN chapter < $3 THEN $3 ELSE chapter END, updated_at=$4 WHERE user_id=$1", [user.id, m.xp, opens, at]);
      const row = await t.get("SELECT xp FROM game_players WHERE user_id=$1", [user.id]);
      await t.run("UPDATE game_players SET level=$2 WHERE user_id=$1", [user.id, GM.levelFor(row.xp)]);
      return { already: false, xpGained: m.xp };
    });
    const out = await missions(user);
    return { mission: m.id, completed: !r.already, already: !!r.already, xpGained: r.already ? 0 : r.xpGained, ...out };
  }

  R.get("/api/game/profile", A(async (req) => get(req.user)));
  R.put("/api/game/profile", A(async (req) => put(req.user, req.body || {})));
  R.get("/api/game/missions", A(async (req) => missions(req.user)));
  R.post("/api/game/missions/:id/complete", A(async (req) => { if (!rl.hit("game_mission", req.user.id)) throw E.rate(); return complete(req.user, req.params.id); }));

  return { get, put, missions, complete, CHARS, SCENES };
};
