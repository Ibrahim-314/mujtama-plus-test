/* Chat service (Track 6, Phase 26 + the server half of Phase 27).
 *  • group conversations up to 256 members (admins, add/remove/leave, ownership hand-over)
 *  • replies/quotes, one reaction per member per message, voice + image attachments stored as
 *    member-only blobs (opaque ciphertext in encrypted chats)
 *  • typing indicators (WebSocket frame or HTTP fallback) and read cursors per member
 *  • disappearing messages (per-conversation timer, swept by a leased scheduled job)
 *  • delete for everyone; message requests from strangers (policy.messageMode) with a 3-message cap
 *    until accepted, no read receipts / typing leaks to unaccepted senders
 *  • encrypted conversations accept only E2EE envelopes: the server never sees plaintext
 * Realtime events (SSE + WebSocket): "chat" {type: message|reaction|delete|read|conv}, "typing".
 * Bus events: MESSAGE_RECEIVED {conv, message, from, to[], kind, encrypted, preview, group, request},
 *             MESSAGE_SENT (legacy), CHAT_GROUP_CREATED, CHAT_MEMBER_ADDED, MESSAGE_DELETED. */
const { E, str, acceptId, id, now } = require("../lib/core");
const MAX_GROUP = 256, REQUEST_CAP = 3, DELETE_WINDOW_MS = 48 * 3600e3;
const TTLS = [0, 300, 3600, 86400, 604800];
const REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "👏"];
const B64 = /^[A-Za-z0-9+/=_-]*$/;
const BLOB_LIMIT = 8 * 1024 * 1024;
const MAGIC = [
  ["image/jpeg", b => b[0] === 0xff && b[1] === 0xd8], ["image/png", b => b.slice(0, 4).toString("hex") === "89504e47"],
  ["image/gif", b => b.slice(0, 3).toString() === "GIF"], ["image/webp", b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP"],
  ["audio/webm", b => b.slice(0, 4).toString("hex") === "1a45dfa3"], ["audio/ogg", b => b.slice(0, 4).toString() === "OggS"],
  ["audio/mp4", b => b.slice(4, 8).toString() === "ftyp"], ["audio/wav", b => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WAVE"]
];

module.exports = (ctx) => {
  const { db, bus, rl, realtime } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const iso = (ms) => new Date(ms).toISOString();
  const inList = (arr, start = 1) => arr.map((_, i) => "$" + (i + start)).join(",");

  async function conv(cid) { const c = await db.get("SELECT * FROM conversations WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; }
  async function membership(cid, uid) { return db.get("SELECT conv, user_id, state, role, last_read_at, joined_at FROM conversation_members WHERE conv=$1 AND user_id=$2", [cid, uid]); }
  async function need(cid, uid) { const m = await membership(cid, uid); if (!m) throw E.forbid(); return m; }
  const members = (cid) => db.all("SELECT user_id, state, role, last_read_at, joined_at FROM conversation_members WHERE conv=$1", [cid]);
  const people = async (ids) => ids.length ? db.all(`SELECT id, name, handle, color, avatar FROM users WHERE id IN (${inList(ids)})`, ids) : [];
  const fanout = async (cid, type, data, { except = null, acceptedOnly = false } = {}) => {
    for (const m of await members(cid)) if (m.user_id !== except && (!acceptedOnly || m.state === "accepted")) realtime.send(m.user_id, type, data);
  };

  /* ---- serialisation ---- */
  function shapeMessage(m, c, reacts = []) {
    const deleted = !!m.deleted_at;
    const out = { id: m.id, conv: m.conv, from: m.sender, kind: m.kind || "text", at: m.created_at, replyTo: m.reply_to || null, expiresAt: m.expires_at || null, deleted };
    if (deleted) return out;
    out.text = m.text || "";
    if (m.meta) out.meta = m.meta;
    if (m.payload) out.enc = m.payload;
    else if (c?.e2ee && out.kind !== "system") out.plain = true; // server-originated or pre-encryption message
    out.reactions = reacts;
    return out;
  }
  async function reactionsFor(ids) {
    if (!ids.length) return {};
    const rows = await db.all(`SELECT msg, user_id, emoji FROM message_reactions WHERE msg IN (${inList(ids)}) ORDER BY at`, ids), out = {};
    for (const r of rows) { const list = (out[r.msg] ||= []); let e = list.find(x => x.emoji === r.emoji); if (!e) list.push(e = { emoji: r.emoji, users: [] }); e.users.push(r.user_id); }
    return out;
  }
  const replyPreview = (m) => !m ? null : m.deleted_at ? { id: m.id, from: m.sender, deleted: true } : { id: m.id, from: m.sender, kind: m.kind, text: m.payload ? "" : String(m.text || "").slice(0, 140), enc: m.payload || null };

  /* ---- conversations ---- */
  async function list(user) {
    const t = now();
    const convs = await db.all(`SELECT c.id, c.kind, c.title, c.owner, c.e2ee, c.ttl, c.updated_at, m.state, m.role, m.last_read_at FROM conversations c JOIN conversation_members m ON m.conv=c.id AND m.user_id=$1 ORDER BY c.updated_at DESC LIMIT 200`, [user.id]);
    if (!convs.length) return { conversations: [], people: [] };
    const ids = convs.map(c => c.id);
    const mem = await db.all(`SELECT conv, user_id FROM conversation_members WHERE conv IN (${inList(ids)})`, ids);
    const last = await db.all(`SELECT * FROM (SELECT id, conv, sender, kind, text, payload, meta, created_at, deleted_at, ROW_NUMBER() OVER (PARTITION BY conv ORDER BY created_at DESC) rn FROM messages WHERE conv IN (${inList(ids, 2)}) AND (expires_at IS NULL OR expires_at > $1)) x WHERE rn=1`, [t, ...ids]);
    const unread = await db.all(`SELECT m.conv, COUNT(*) n FROM messages m JOIN conversation_members cm ON cm.conv=m.conv AND cm.user_id=$1 WHERE m.sender<>$1 AND m.deleted_at IS NULL AND m.read_at IS NULL AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at) AND (m.expires_at IS NULL OR m.expires_at > $2) GROUP BY m.conv`, [user.id, t]);
    const uids = [...new Set(mem.map(x => x.user_id))];
    return {
      conversations: convs.map(c => {
        const ms = mem.filter(x => x.conv === c.id).map(x => x.user_id), l = last.find(x => x.conv === c.id);
        return { id: c.id, kind: c.kind || "dm", title: c.title, owner: c.owner, e2ee: !!c.e2ee, ttl: Number(c.ttl || 0), updatedAt: c.updated_at, state: c.state, role: c.role, members: ms, peer: c.kind === "group" ? null : ms.find(x => x !== user.id) || null,
          last: l ? shapeMessage(l, c) : null, unread: Number(unread.find(x => x.conv === c.id)?.n || 0) };
      }),
      people: await people(uids)
    };
  }
  async function info(user, cid) {
    const c = await conv(cid); await need(cid, user.id);
    const ms = await members(cid);
    return { conversation: { id: c.id, kind: c.kind || "dm", title: c.title, owner: c.owner, e2ee: !!c.e2ee, ttl: Number(c.ttl || 0), createdAt: c.created_at,
      members: ms.map(m => ({ user: m.user_id, role: m.role, state: m.state, lastReadAt: m.state === "accepted" ? m.last_read_at : null })) }, people: await people(ms.map(m => m.user_id)) };
  }
  async function eligible(actor, uid) {
    const other = await db.get("SELECT id, prefs, privacy, status FROM users WHERE id=$1", [uid]);
    if (!other || other.id === actor.id || (other.status && other.status !== "active")) return null;
    if ((actor.prefs?.blocked || []).includes(uid)) return null;
    const mode = await ctx.policy.messageMode(actor.id, other);
    return mode ? (mode === "requests" ? "request" : "accepted") : null;
  }
  async function systemMessage(t, cid, actor, event, extra = {}) {
    const m = { id: id("ms"), at: now() };
    await t.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,meta) VALUES($1,$2,$3,$4,$5,'system',$6)", [m.id, cid, actor, event, m.at, { event, ...extra }]);
    await t.run("UPDATE conversations SET updated_at=$1 WHERE id=$2", [m.at, cid]);
    return m.id;
  }
  async function createGroup(user, b) {
    if (!rl.hit("invite", "chatgroup:" + user.id)) throw E.rate();
    const title = str(b.title, 80, { required: true });
    const wanted = [...new Set(Array.isArray(b.members) ? b.members.filter(x => typeof x === "string") : [])].filter(x => x !== user.id);
    if (!wanted.length) throw E.bad("أضف عضواً واحداً على الأقل");
    if (wanted.length + 1 > MAX_GROUP) throw E.bad(`الحد الأقصى ${MAX_GROUP} عضواً`);
    const add = [], skipped = [];
    for (const uid of wanted) { const st = await eligible(user, uid); if (st) add.push([uid, st]); else skipped.push(uid); }
    if (!add.length) throw E.forbid("لا يمكن إضافة هؤلاء الأعضاء");
    const cid = acceptId(b.id, "cv"), at = now();
    await db.tx(async t => {
      await t.run("INSERT INTO conversations(id,created_at,updated_at,kind,title,owner) VALUES($1,$2,$2,'group',$3,$4)", [cid, at, title, user.id]);
      await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at,last_read_at) VALUES($1,$2,'accepted','admin',$3,$3)", [cid, user.id, at]);
      for (const [uid, st] of add) await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at) VALUES($1,$2,$3,'member',$4)", [cid, uid, st, at]);
      await systemMessage(t, cid, user.id, "created", { title });
    });
    for (const [uid] of add) realtime.send(uid, "chat", { type: "conv", conv: cid });
    bus.emit("CHAT_GROUP_CREATED", { conv: cid, actor: user.id, members: add.map(x => x[0]) });
    return { ...(await info(user, cid)), skipped };
  }
  async function addMembers(user, cid, users) {
    const c = await conv(cid); if (c.kind !== "group") throw E.bad();
    const me = await need(cid, user.id); if (me.role !== "admin") throw E.forbid("للمشرفين فقط");
    const cur = await members(cid), have = new Set(cur.map(m => m.user_id));
    const wanted = [...new Set((Array.isArray(users) ? users : []).filter(x => typeof x === "string" && !have.has(x)))];
    if (cur.length + wanted.length > MAX_GROUP) throw E.bad(`الحد الأقصى ${MAX_GROUP} عضواً`);
    const add = [], skipped = [];
    for (const uid of wanted) { const st = await eligible(user, uid); if (st) add.push([uid, st]); else skipped.push(uid); }
    if (add.length) await db.tx(async t => {
      for (const [uid, st] of add) await t.run("INSERT INTO conversation_members(conv,user_id,state,role,joined_at) VALUES($1,$2,$3,'member',$4)", [cid, uid, st, now()]);
      await systemMessage(t, cid, user.id, "added", { users: add.map(x => x[0]) });
    });
    await fanout(cid, "chat", { type: "conv", conv: cid });
    for (const [uid] of add) bus.emit("CHAT_MEMBER_ADDED", { conv: cid, actor: user.id, user: uid });
    return { added: add.map(x => x[0]), skipped };
  }
  async function removeMember(user, cid, target) {
    const c = await conv(cid); if (c.kind !== "group") throw E.bad();
    const me = await need(cid, user.id), t0 = await membership(cid, target); if (!t0) throw E.nf();
    if (target !== user.id && (me.role !== "admin" || target === c.owner)) throw E.forbid();
    await db.tx(async t => {
      await t.run("DELETE FROM conversation_members WHERE conv=$1 AND user_id=$2", [cid, target]);
      const rest = await t.all("SELECT user_id, role FROM conversation_members WHERE conv=$1 ORDER BY joined_at", [cid]);
      if (!rest.length) { await t.run("DELETE FROM conversations WHERE id=$1", [cid]); return; }
      if (target === c.owner) { const next = rest.find(r => r.role === "admin") || rest[0]; await t.run("UPDATE conversations SET owner=$1 WHERE id=$2", [next.user_id, cid]); await t.run("UPDATE conversation_members SET role='admin' WHERE conv=$1 AND user_id=$2", [cid, next.user_id]); }
      await systemMessage(t, cid, user.id, target === user.id ? "left" : "removed", { users: [target] });
    });
    realtime.send(target, "chat", { type: "conv", conv: cid });
    await fanout(cid, "chat", { type: "conv", conv: cid }).catch(() => { });
    return { ok: true };
  }
  async function updateConv(user, cid, b) {
    const c = await conv(cid), me = await need(cid, user.id);
    if (me.state !== "accepted") throw E.forbid();
    if (c.kind === "group" && me.role !== "admin") throw E.forbid("للمشرفين فقط");
    await db.tx(async t => {
      if (b.title !== undefined && c.kind === "group") { const title = str(b.title, 80, { required: true }); await t.run("UPDATE conversations SET title=$1 WHERE id=$2", [title, cid]); await systemMessage(t, cid, user.id, "title", { title }); }
      if (b.ttl !== undefined) { const ttl = Number(b.ttl); if (!TTLS.includes(ttl)) throw E.bad("مدة غير مدعومة"); await t.run("UPDATE conversations SET ttl=$1 WHERE id=$2", [ttl, cid]); await systemMessage(t, cid, user.id, "ttl", { ttl }); }
      if (b.role && c.kind === "group") { const tm = await t.get("SELECT user_id FROM conversation_members WHERE conv=$1 AND user_id=$2", [cid, b.role.user]); if (!tm || b.role.user === c.owner) throw E.bad(); await t.run("UPDATE conversation_members SET role=$1 WHERE conv=$2 AND user_id=$3", [b.role.role === "admin" ? "admin" : "member", cid, b.role.user]); }
    });
    await fanout(cid, "chat", { type: "conv", conv: cid });
    return info(user, cid);
  }

  /* ---- messages ---- */
  /* v2.130 search stage 7 — search inside the reader's own messages. Only conversations the reader is a member of; never encrypted
   * conversations (the server holds ciphertext only); deleted and expired messages are skipped. Arabic-aware: the same normalisation
   * and word forms as the main search (clitics, plurals, typos-free prefix matching), every query word must match. Newest first. */
  async function searchMessages(user, q) {
    const AR = require("../lib/arabic"), AN = require("../lib/search-analyzer");
    q = String(q || "").trim().slice(0, 100); const words = AN.words(q).filter((w) => !AR.STOP.has(w)); if (!words.length) return { results: [] };
    const forms = words.map((w) => [...new Set([w, AN.base(w), ...[...AN.forms(w)].map(([f]) => f)])].filter((x) => x && x.length > 1));
    const convs = await db.all(`SELECT c.id, c.kind, c.title FROM conversations c JOIN conversation_members m ON m.conv=c.id AND m.user_id=$1 WHERE (c.e2ee IS NULL OR c.e2ee=0)`, [user.id]);
    if (!convs.length) return { results: [] };
    const ids = convs.map((c) => c.id), t = now(), out = [];
    const rows = await db.all(`SELECT id, conv, sender, text, created_at FROM messages WHERE conv IN (${inList(ids)}) AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > $${ids.length + 1}) AND kind='text' AND text <> '' ORDER BY created_at DESC LIMIT 5000`, [...ids, t]);
    for (const r of rows) {
      const toks = AN.words(r.text || ""); if (!toks.length) continue;
      const set = new Set(toks.flatMap((x) => [x, AN.base(x)]));
      if (forms.every((fs) => fs.some((f) => set.has(f) || toks.some((x) => f.length >= 3 && x.startsWith(f))))) out.push(r);
      if (out.length >= 50) break;
    }
    const byConv = new Map(convs.map((c) => [c.id, c]));
    const ppl = await people([...new Set(out.map((r) => r.sender))]);
    return { results: out.map((r) => ({ id: r.id, conv: r.conv, kind: byConv.get(r.conv)?.kind, title: byConv.get(r.conv)?.title || null, sender: ppl.find((u) => u.id === r.sender) || { id: r.sender }, text: String(r.text).slice(0, 240), createdAt: r.created_at })) };
  }
  async function history(user, cid, q) {
    const c = await conv(cid); const me = await need(cid, user.id);
    const limit = Math.min(Math.max(+q.limit || 50, 1), 100), t = now();
    const rows = await db.all(`SELECT * FROM messages WHERE conv=$1 AND (expires_at IS NULL OR expires_at > $2)${q.before ? " AND created_at < $4" : ""} ORDER BY created_at DESC LIMIT $3`, q.before ? [cid, t, limit, q.before] : [cid, t, limit]);
    rows.reverse();
    const reacts = await reactionsFor(rows.map(r => r.id));
    const replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))];
    const replies = replyIds.length ? await db.all(`SELECT id, sender, kind, text, payload, deleted_at FROM messages WHERE id IN (${inList(replyIds)})`, replyIds) : [];
    const ms = await members(cid);
    return { messages: rows.map(r => ({ ...shapeMessage(r, c, reacts[r.id] || []), ...(r.reply_to && !r.deleted_at ? { reply: replyPreview(replies.find(x => x.id === r.reply_to)) || { id: r.reply_to, deleted: true } } : {}) })),
      reads: Object.fromEntries(ms.filter(m => m.state === "accepted" && m.user_id !== user.id).map(m => [m.user_id, m.last_read_at])), state: me.state, more: rows.length === limit };
  }
  function validEnvelope(env) {
    if (!env || typeof env !== "object" || env.v !== 1 || typeof env.from !== "string" || typeof env.iv !== "string" || typeof env.ct !== "string") return false;
    if (env.iv.length > 32 || env.ct.length > 900000 || !B64.test(env.iv) || !B64.test(env.ct)) return false;
    const keys = env.keys; if (!keys || typeof keys !== "object") return false;
    const ks = Object.entries(keys); if (!ks.length || ks.length > 64) return false;
    return ks.every(([k, v]) => k.length <= 40 && typeof v === "string" && v.length <= 400 && B64.test(v.replace(/\./g, "")));
  }
  function cleanMeta(meta, e2ee) {
    if (!meta || typeof meta !== "object") return null;
    const out = {};
    if (typeof meta.blob === "string" && meta.blob.length <= 40) out.blob = meta.blob;
    if (e2ee) return Object.keys(out).length ? out : null; // everything else lives inside the ciphertext
    if (typeof meta.mime === "string") out.mime = meta.mime.slice(0, 40);
    for (const k of ["w", "h", "duration"]) if (Number.isFinite(+meta[k])) out[k] = Math.max(0, Math.min(+meta[k], 1e5));
    if (Array.isArray(meta.wave)) out.wave = meta.wave.slice(0, 64).map(v => Math.max(0, Math.min(Math.round(+v || 0), 100)));
    return Object.keys(out).length ? out : null;
  }
  async function send(user, cid, b) {
    if (!rl.hit("message", user.id)) throw E.rate();
    const c = await conv(cid), me = await need(cid, user.id);
    if (me.state !== "accepted") await db.run("UPDATE conversation_members SET state='accepted' WHERE conv=$1 AND user_id=$2", [cid, user.id]); // replying accepts the request
    const ms = await members(cid), others = ms.filter(m => m.user_id !== user.id);
    if (c.kind !== "group" && others.some(o => o.state === "request")) {
      const n = (await db.get("SELECT COUNT(*) n FROM messages WHERE conv=$1 AND sender=$2", [cid, user.id])).n;
      if (Number(n) >= REQUEST_CAP) throw E.forbid("بانتظار قبول طلب المراسلة");
    }
    const kind = ["text", "image", "voice"].includes(b.kind) ? b.kind : "text";
    let text = "", payload = null;
    if (c.e2ee) {
      if (!validEnvelope(b.enc)) throw E.bad("هذه المحادثة مشفرة: الرسالة يجب أن تكون مشفرة");
      const dev = await db.get("SELECT id FROM device_keys WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [b.enc.from, user.id]);
      if (!dev) throw E.bad("مفتاح جهاز غير معروف");
      payload = { v: 1, from: b.enc.from, iv: b.enc.iv, ct: b.enc.ct, keys: b.enc.keys };
    } else {
      text = str(b.text, 4000, { required: kind === "text" }) || "";
      if (b.enc) throw E.bad();
    }
    const meta = cleanMeta(b.meta, !!c.e2ee);
    if (kind !== "text" && !meta?.blob) throw E.bad("المرفق مفقود");
    if (meta?.blob) { const bl = await db.get("SELECT id FROM chat_blobs WHERE id=$1 AND conv=$2 AND owner=$3 AND msg IS NULL", [meta.blob, cid, user.id]); if (!bl) throw E.bad("المرفق غير صالح"); }
    let replyTo = null;
    if (typeof b.replyTo === "string") { const r = await db.get("SELECT id FROM messages WHERE id=$1 AND conv=$2", [b.replyTo, cid]); if (r) replyTo = r.id; }
    const at = now(), mid = acceptId(b.id, "ms");
    const expires = Number(c.ttl) ? iso(Date.now() + Number(c.ttl) * 1000) : null;
    const ins = await db.run("INSERT INTO messages(id,conv,sender,text,created_at,kind,reply_to,meta,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING", [mid, cid, user.id, text, at, kind, replyTo, meta, payload, expires]);
    if (!ins.changes) { const ex = await db.get("SELECT * FROM messages WHERE id=$1 AND sender=$2", [mid, user.id]); if (!ex) throw E.conflict("معرّف مكرر"); return { message: shapeMessage(ex, c) }; }
    if (meta?.blob) await db.run("UPDATE chat_blobs SET msg=$1 WHERE id=$2", [mid, meta.blob]);
    await db.run("UPDATE conversations SET updated_at=$1 WHERE id=$2", [at, cid]);
    await db.run("UPDATE conversation_members SET last_read_at=$1 WHERE conv=$2 AND user_id=$3", [at, cid, user.id]);
    const row = await db.get("SELECT * FROM messages WHERE id=$1", [mid]);
    const msg = { ...shapeMessage(row, c, []), ...(replyTo ? { reply: replyPreview(await db.get("SELECT id, sender, kind, text, payload, deleted_at FROM messages WHERE id=$1", [replyTo])) } : {}) };
    for (const o of others) realtime.send(o.user_id, "chat", { type: "message", message: msg });
    bus.emit("MESSAGE_RECEIVED", { conv: cid, message: mid, from: user.id, to: others.map(o => o.user_id), kind, encrypted: !!payload, group: c.kind === "group", title: c.title || null,
      preview: payload ? null : kind === "text" ? text.slice(0, 120) : null, request: others.filter(o => o.state === "request").map(o => o.user_id) });
    bus.emit("MESSAGE_SENT", { conv: cid, actor: user.id, message: mid });
    return { message: msg };
  }
  async function react(user, mid, emoji) {
    const m = await db.get("SELECT id, conv, sender, deleted_at FROM messages WHERE id=$1", [mid]); if (!m || m.deleted_at) throw E.nf();
    const me = await need(m.conv, user.id); if (me.state !== "accepted") throw E.forbid();
    if (!rl.hit("react", user.id)) throw E.rate();
    if (emoji) { if (!REACTIONS.includes(emoji)) throw E.bad("تفاعل غير مدعوم");
      await db.run("INSERT INTO message_reactions(msg,user_id,emoji,at) VALUES($1,$2,$3,$4) ON CONFLICT (msg,user_id) DO UPDATE SET emoji=excluded.emoji, at=excluded.at", [mid, user.id, emoji, now()]); }
    else await db.run("DELETE FROM message_reactions WHERE msg=$1 AND user_id=$2", [mid, user.id]);
    const reactions = (await reactionsFor([mid]))[mid] || [];
    await fanout(m.conv, "chat", { type: "reaction", conv: m.conv, msg: mid, user: user.id, emoji: emoji || null, reactions }, { except: user.id, acceptedOnly: true });
    if (emoji && m.sender !== user.id) bus.emit("MESSAGE_REACTED", { conv: m.conv, message: mid, actor: user.id, owner: m.sender, emoji });
    return { reactions };
  }
  async function dropBlobs(where, args) {
    const blobs = await db.all(`SELECT id FROM chat_blobs WHERE ${where}`, args);
    for (const b of blobs) await ctx.storage.del("chat/" + b.id).catch(() => { });
    if (blobs.length) await db.run(`DELETE FROM chat_blobs WHERE id IN (${inList(blobs.map(b => b.id))})`, blobs.map(b => b.id));
  }
  async function deleteForEveryone(user, mid) {
    const m = await db.get("SELECT m.id, m.conv, m.sender, m.created_at, m.deleted_at, c.kind FROM messages m JOIN conversations c ON c.id=m.conv WHERE m.id=$1", [mid]);
    if (!m || m.deleted_at) throw E.nf();
    const me = await need(m.conv, user.id);
    const mine = m.sender === user.id, mod = m.kind === "group" && me.role === "admin";
    if (!mine && !mod) throw E.forbid();
    if (mine && !mod && Date.now() - Date.parse(m.created_at) > DELETE_WINDOW_MS) throw E.forbid("انتهت مهلة الحذف للجميع (48 ساعة)");
    await db.run("UPDATE messages SET text='', payload=NULL, meta=NULL, deleted_at=$1 WHERE id=$2", [now(), mid]);
    await db.run("DELETE FROM message_reactions WHERE msg=$1", [mid]);
    await dropBlobs("msg=$1", [mid]);
    await fanout(m.conv, "chat", { type: "delete", conv: m.conv, msg: mid, by: user.id }, { except: user.id });
    bus.emit("MESSAGE_DELETED", { conv: m.conv, message: mid, actor: user.id });
    return { ok: true };
  }
  async function markRead(user, cid) {
    const c = await conv(cid), me = await need(cid, user.id), at = now();
    if (me.state !== "accepted") return { ok: true, at: null }; // reading a request never tells the sender
    await db.run("UPDATE conversation_members SET last_read_at=$1 WHERE conv=$2 AND user_id=$3", [at, cid, user.id]);
    if (c.kind !== "group") await db.run("UPDATE messages SET read_at=$1 WHERE conv=$2 AND sender<>$3 AND read_at IS NULL", [at, cid, user.id]);
    await fanout(cid, "chat", { type: "read", conv: cid, user: user.id, at }, { except: user.id, acceptedOnly: true });
    return { ok: true, at };
  }
  async function typing(user, cid, on) {
    if (!rl.hit("default", "typing:" + user.id)) return { ok: false };
    const me = await membership(cid, user.id); if (!me || me.state !== "accepted") return { ok: false };
    await fanout(cid, "typing", { conv: cid, user: user.id, on: on !== false }, { except: user.id, acceptedOnly: true });
    return { ok: true };
  }

  /* ---- member-only attachments ---- */
  async function uploadBlob(user, cid, req) {
    if (!rl.hit("upload", user.id)) throw E.rate();
    const c = await conv(cid), me = await need(cid, user.id); if (me.state !== "accepted") throw E.forbid();
    const buf = req.rawBody; if (!buf?.length) throw E.bad("ملف فارغ");
    if (buf.length > BLOB_LIMIT) throw E.bad("الحد الأقصى 8 ميغابايت");
    let mime = "application/octet-stream", enc = 0;
    if (c.e2ee || req.query.enc === "1") enc = 1; // opaque ciphertext: the server cannot (and must not) inspect it
    else { const hit = MAGIC.find(([, t]) => t(buf)); if (!hit) throw E.bad("نوع ملف غير مدعوم"); mime = hit[0]; }
    const bid = id("cb");
    await ctx.storage.put("chat/" + bid, buf, mime);
    await db.run("INSERT INTO chat_blobs(id,conv,owner,mime,size,enc,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [bid, cid, user.id, mime, buf.length, enc, now()]);
    return { blob: { id: bid, mime, size: buf.length, enc: !!enc } };
  }
  async function serveBlob(user, bid, res) {
    const b = await db.get("SELECT * FROM chat_blobs WHERE id=$1", [bid]); if (!b) throw E.nf();
    await need(b.conv, user.id);
    const buf = await ctx.storage.get("chat/" + bid); if (!buf) throw E.nf();
    const { SEC_HEADERS } = require("../lib/http");
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": b.mime, "Content-Length": buf.length, "Cache-Control": "private, max-age=86400", "Content-Disposition": "inline" });
    res.end(buf);
    return ctx.STREAM;
  }

  /* ---- disappearing messages sweeper (leased: one instance at a time) ---- */
  async function sweep() {
    const t = now();
    const gone = await db.all("SELECT id, conv FROM messages WHERE expires_at IS NOT NULL AND expires_at <= $1 LIMIT 500", [t]);
    if (gone.length) {
      const ids = gone.map(g => g.id);
      await dropBlobs(`msg IN (${inList(ids)})`, ids);
      await db.run(`DELETE FROM messages WHERE id IN (${inList(ids)})`, ids);
      for (const cid of new Set(gone.map(g => g.conv))) await fanout(cid, "chat", { type: "expired", conv: cid, msgs: gone.filter(g => g.conv === cid).map(g => g.id) }).catch(() => { });
    }
    await dropBlobs("msg IS NULL AND created_at < $1", [iso(Date.now() - 864e5)]); // abandoned uploads
    return gone.length;
  }
  ctx.scheduler.every("chatExpiry", 30e3, sweep);

  /* ---- WebSocket inbound frames ---- */
  ctx.ws.on("typing", (user, m) => typeof m.conv === "string" && typing(user, m.conv, m.on));
  ctx.ws.on("read", (user, m) => typeof m.conv === "string" && markRead(user, m.conv));

  R.get("/api/chat/conversations", A(req => list(req.user)));
  R.get("/api/chat/search", A(req => searchMessages(req.user, req.query.q))); // v2.130 search stage 7
  R.post("/api/chat/groups", A(req => createGroup(req.user, req.body)));
  R.get("/api/chat/conversations/:id", A(req => info(req.user, req.params.id)));
  R.patch("/api/chat/conversations/:id", A(req => updateConv(req.user, req.params.id, req.body)));
  R.post("/api/chat/conversations/:id/members", A(req => addMembers(req.user, req.params.id, req.body.users)));
  R.del("/api/chat/conversations/:id/members/:user", A(req => removeMember(req.user, req.params.id, req.params.user)));
  R.get("/api/chat/conversations/:id/messages", A(req => history(req.user, req.params.id, req.query)));
  R.post("/api/chat/conversations/:id/messages", A(req => send(req.user, req.params.id, req.body)));
  R.post("/api/chat/conversations/:id/read", A(req => markRead(req.user, req.params.id)));
  R.post("/api/chat/conversations/:id/typing", A(req => typing(req.user, req.params.id, req.body.on)));
  R.post("/api/chat/conversations/:id/blobs", A(req => uploadBlob(req.user, req.params.id, req)), { raw: true });
  R.get("/api/chat/blobs/:id", A((req, res) => serveBlob(req.user, req.params.id, res)));
  R.post("/api/chat/messages/:id/react", A(req => react(req.user, req.params.id, req.body.emoji || null)));
  R.del("/api/chat/messages/:id", A(req => deleteForEveryone(req.user, req.params.id)));
  return { list, info, send, markRead, typing, sweep, membership, REACTIONS, TTLS, MAX_GROUP };
};
