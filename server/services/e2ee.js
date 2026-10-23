/* End-to-end encryption key directory (Track 6, Phase 27).
 * The server is a dumb directory: it stores each device's ECDH P-256 *public* key (JWK) and the
 * opaque envelopes chat.js accepts. Private keys never leave the device (non-extractable WebCrypto
 * keys in IndexedDB). Every message key is wrapped once per recipient device, including the sender's
 * other devices (multi-device). Safety-number verifications are stored per (user, peer) so clients can
 * show «تم التحقق» and warn when a peer's key set changes.
 * Realtime: "chat" {type:"keys", user} to everyone sharing an encrypted chat when a device is added or revoked.
 * Bus: E2EE_DEVICE_ADDED, E2EE_DEVICE_REVOKED, E2EE_ENABLED. */
const { E, str, now } = require("../lib/core");
const MAX_DEVICES = 10;
const B64U = /^[A-Za-z0-9_-]{40,48}$/;
const DEVICE_ID = /^dk_[a-z0-9]{8,32}$/i;

module.exports = (ctx) => {
  const { db, bus, realtime, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const shape = d => ({ id: d.id, user: d.user_id, name: d.name, pub: d.data, createdAt: d.created_at, lastSeen: d.last_seen, revoked: !!d.revoked_at });
  function validJwk(j) {
    return j && j.kty === "EC" && j.crv === "P-256" && B64U.test(j.x || "") && B64U.test(j.y || "") && !j.d;
  }
  async function notifyPeers(uid) {
    const peers = await db.all("SELECT DISTINCT b.user_id FROM conversation_members a JOIN conversations c ON c.id=a.conv AND c.e2ee=1 JOIN conversation_members b ON b.conv=a.conv WHERE a.user_id=$1", [uid]);
    const set = new Set([uid, ...peers.map(p => p.user_id)]);
    for (const p of set) realtime.send(p, "chat", { type: "keys", user: uid });
  }
  async function register(user, b) {
    if (!rl.hit("default", "e2ee:" + user.id)) throw E.rate();
    if (typeof b.id !== "string" || !DEVICE_ID.test(b.id)) throw E.bad("معرّف جهاز غير صالح");
    if (!validJwk(b.pub)) throw E.bad("مفتاح عام غير صالح");
    const pub = { kty: "EC", crv: "P-256", x: b.pub.x, y: b.pub.y };
    const name = str(b.name, 60) || "جهاز";
    const ex = await db.get("SELECT * FROM device_keys WHERE id=$1", [b.id]);
    if (ex) {
      if (ex.user_id !== user.id || ex.revoked_at) throw E.forbid("هذا الجهاز أُلغي، أنشئ مفتاحاً جديداً");
      if (ex.data.x !== pub.x || ex.data.y !== pub.y) throw E.conflict("لا يمكن تغيير مفتاح جهاز مسجّل");
      await db.run("UPDATE device_keys SET last_seen=$1, name=$2 WHERE id=$3", [now(), name, b.id]);
      return { device: shape({ ...ex, name }) };
    }
    const n = (await db.get("SELECT COUNT(*) n FROM device_keys WHERE user_id=$1 AND revoked_at IS NULL", [user.id])).n;
    if (Number(n) >= MAX_DEVICES) throw E.bad(`الحد الأقصى ${MAX_DEVICES} أجهزة؛ ألغِ جهازاً قديماً أولاً`);
    const at = now();
    await db.run("INSERT INTO device_keys(id,user_id,name,data,created_at,last_seen) VALUES($1,$2,$3,$4,$5,$5)", [b.id, user.id, name, pub, at]);
    bus.emit("E2EE_DEVICE_ADDED", { user: user.id, device: b.id });
    await notifyPeers(user.id);
    return { device: shape({ id: b.id, user_id: user.id, name, data: pub, created_at: at, last_seen: at }) };
  }
  async function revoke(user, did) {
    const r = await db.run("UPDATE device_keys SET revoked_at=$1 WHERE id=$2 AND user_id=$3 AND revoked_at IS NULL", [now(), did, user.id]);
    if (!r.changes) throw E.nf();
    bus.emit("E2EE_DEVICE_REVOKED", { user: user.id, device: did });
    await notifyPeers(user.id);
    return { ok: true };
  }
  async function keys(ids) {
    const users = [...new Set(String(ids || "").split(",").map(s => s.trim()).filter(Boolean))].slice(0, 50);
    if (!users.length) return { keys: {} };
    const rows = await db.all(`SELECT * FROM device_keys WHERE revoked_at IS NULL AND user_id IN (${users.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY created_at`, users);
    return { keys: Object.fromEntries(users.map(u => [u, rows.filter(r => r.user_id === u).map(shape)])) };
  }
  async function enable(user, cid) {
    const c = await db.get("SELECT * FROM conversations WHERE id=$1", [cid]); if (!c) throw E.nf();
    if ((c.kind || "dm") !== "dm") throw E.bad("التشفير طرف لطرف متاح للمحادثات الخاصة");
    const ms = await db.all("SELECT user_id FROM conversation_members WHERE conv=$1", [cid]);
    if (!ms.some(m => m.user_id === user.id)) throw E.forbid();
    if (c.e2ee) return { ok: true, e2ee: true };
    for (const m of ms) {
      const n = (await db.get("SELECT COUNT(*) n FROM device_keys WHERE user_id=$1 AND revoked_at IS NULL", [m.user_id])).n;
      if (!Number(n)) throw E.conflict("الطرف الآخر لم يفعّل التشفير على أي جهاز بعد");
    }
    const at = now(), mid = "ms_" + require("node:crypto").randomBytes(8).toString("hex");
    await db.tx(async t => {
      await t.run("UPDATE conversations SET e2ee=1, updated_at=$1 WHERE id=$2", [at, cid]);
      await t.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,meta) VALUES($1,$2,$3,'e2ee',$4,'system',$5)", [mid, cid, user.id, at, { event: "e2ee" }]);
    });
    for (const m of ms) realtime.send(m.user_id, "chat", { type: "conv", conv: cid });
    bus.emit("E2EE_ENABLED", { conv: cid, actor: user.id });
    return { ok: true, e2ee: true };
  }

  R.post("/api/e2ee/devices", A(req => register(req.user, req.body)));
  R.get("/api/e2ee/devices", A(async req => ({ devices: (await db.all("SELECT * FROM device_keys WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id])).map(shape) })));
  R.del("/api/e2ee/devices/:id", A(req => revoke(req.user, req.params.id)));
  // any device's public key by id, revoked ones included, so old messages from it still decrypt
  R.get("/api/e2ee/devices/:id", A(async req => { const d = await db.get("SELECT * FROM device_keys WHERE id=$1", [req.params.id]); if (!d) throw E.nf(); return { device: shape(d) }; }));
  R.get("/api/e2ee/keys", A(req => keys(req.query.users)));
  R.post("/api/e2ee/conversations/:id/enable", A(req => enable(req.user, req.params.id)));
  R.get("/api/e2ee/verify/:peer", A(async req => ({ verification: (await db.get("SELECT fingerprint, at FROM key_verifications WHERE user_id=$1 AND peer=$2", [req.user.id, req.params.peer])) || null })));
  R.put("/api/e2ee/verify/:peer", A(async req => {
    const fp = req.body.fingerprint; if (typeof fp !== "string" || !/^\d{60}$/.test(fp)) throw E.bad("رمز أمان غير صالح");
    await db.run("INSERT INTO key_verifications(user_id,peer,fingerprint,at) VALUES($1,$2,$3,$4) ON CONFLICT (user_id,peer) DO UPDATE SET fingerprint=excluded.fingerprint, at=excluded.at", [req.user.id, req.params.peer, fp, now()]);
    return { ok: true };
  }));
  R.del("/api/e2ee/verify/:peer", A(async req => (await db.run("DELETE FROM key_verifications WHERE user_id=$1 AND peer=$2", [req.user.id, req.params.peer]), { ok: true })));
  return { keys, enable, validJwk };
};
