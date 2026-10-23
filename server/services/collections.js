/* Lists & collections service (Phase 24).
 * • People lists, public or private (a public list can be viewed and read as a feed by anyone).
 * • Saved-item collections organised as folders, ordered by drag and drop (positions), with items that
 *   can be moved between folders and reordered.
 * • Sharing a collection by an unguessable link (read-only; private notes are never shared, and only
 *   posts the visitor may see are shown).
 * • Private notes on saved items, read-later reminders (leased job every minute → notification).
 * • Offline sync: GET /api/collections/sync?since= returns changes + tombstones since a timestamp, and
 *   POST /api/collections/sync replays operations queued while offline (idempotent, last-write-wins).
 * The legacy client-side collections (prefs.collections) are imported once on first use. */
const crypto = require("node:crypto");
const { E, str, id, now } = require("../lib/core");
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_COLLECTIONS = 50, MAX_ITEMS = 1000, MAX_LISTS = 30, MAX_MEMBERS = 500;

module.exports = (ctx) => {
  const { db } = ctx;
  const content = () => ctx.services.content;
  const ph = (a) => a.map((_, i) => "$" + (i + 1)).join(",");

  /* =================== people lists =================== */
  const listClient = (l, count, member) => ({ id: l.id, owner: l.owner, name: l.name, descr: l.descr || "", visibility: l.visibility, members: count, createdAt: l.created_at, ...(member !== undefined ? { includes: member } : {}) });
  async function getList(viewer, lid) {
    const l = await db.get("SELECT * FROM people_lists WHERE id=$1", [lid]);
    if (!l || (l.visibility !== "public" && l.owner !== viewer?.id)) throw E.nf("القائمة غير موجودة");
    return l;
  }
  async function myLists(uid, forUser) {
    const rows = await db.all("SELECT l.*, (SELECT COUNT(*) FROM people_list_members m WHERE m.list=l.id) n" + (forUser ? ", (SELECT COUNT(*) FROM people_list_members m2 WHERE m2.list=l.id AND m2.user_id=$2) inc" : "") + " FROM people_lists l WHERE l.owner=$1 ORDER BY l.created_at DESC", forUser ? [uid, forUser] : [uid]);
    return rows.map(l => listClient(l, l.n, forUser ? l.inc > 0 : undefined));
  }
  async function createList(uid, b) {
    if ((await db.get("SELECT COUNT(*) n FROM people_lists WHERE owner=$1", [uid])).n >= MAX_LISTS) throw E.bad("الحد الأقصى 30 قائمة");
    const l = { id: id("pl"), name: str(b.name, 50, { required: true }), descr: str(b.descr, 200) || "", visibility: b.visibility === "public" ? "public" : "private" };
    await db.run("INSERT INTO people_lists(id,owner,name,descr,visibility,created_at) VALUES($1,$2,$3,$4,$5,$6)", [l.id, uid, l.name, l.descr, l.visibility, now()]);
    if (Array.isArray(b.members)) for (const m of b.members.slice(0, 50)) await setMember(uid, l.id, m, true).catch(() => { });
    return listClient(await db.get("SELECT * FROM people_lists WHERE id=$1", [l.id]), (await db.get("SELECT COUNT(*) n FROM people_list_members WHERE list=$1", [l.id])).n);
  }
  async function updateList(uid, lid, b) {
    const l = await db.get("SELECT * FROM people_lists WHERE id=$1 AND owner=$2", [lid, uid]); if (!l) throw E.nf();
    await db.run("UPDATE people_lists SET name=$1, descr=$2, visibility=$3 WHERE id=$4", [str(b.name, 50) || l.name, b.descr !== undefined ? str(b.descr, 200) || "" : l.descr, b.visibility ? (b.visibility === "public" ? "public" : "private") : l.visibility, lid]);
    ctx.cache.del("rank:");
    return listClient(await db.get("SELECT * FROM people_lists WHERE id=$1", [lid]), (await db.get("SELECT COUNT(*) n FROM people_list_members WHERE list=$1", [lid])).n);
  }
  async function setMember(uid, lid, member, on) {
    const l = await db.get("SELECT * FROM people_lists WHERE id=$1 AND owner=$2", [lid, uid]); if (!l) throw E.nf();
    const u = await db.get("SELECT id FROM users WHERE id=$1 OR handle=$1", [member]); if (!u) throw E.nf("المستخدم غير موجود");
    if (on) {
      if ((await db.get("SELECT COUNT(*) n FROM people_list_members WHERE list=$1", [lid])).n >= MAX_MEMBERS) throw E.bad("القائمة ممتلئة");
      await db.run("INSERT INTO people_list_members(list,user_id,added_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [lid, u.id, now()]);
    } else await db.run("DELETE FROM people_list_members WHERE list=$1 AND user_id=$2", [lid, u.id]);
    ctx.cache.del(`rank:${uid}:list:${lid}`);
    return { ok: true, member: u.id, on };
  }
  async function listDetail(viewer, lid) {
    const l = await getList(viewer, lid);
    const members = await db.all("SELECT u.* FROM people_list_members m JOIN users u ON u.id=m.user_id WHERE m.list=$1 ORDER BY m.added_at DESC", [lid]);
    const owner = await db.get("SELECT * FROM users WHERE id=$1", [l.owner]);
    return { list: listClient(l, members.length), owner: ctx.services.users.pub(owner), mine: l.owner === viewer?.id, members: members.map(ctx.services.users.pub) };
  }

  /* =================== collections =================== */
  async function importLegacy(uid) {
    const u = await db.get("SELECT prefs FROM users WHERE id=$1", [uid]); const prefs = u?.prefs || {};
    if (prefs.collectionsImported) return;
    const legacy = Array.isArray(prefs.collections) && prefs.collections.length ? prefs.collections : [{ name: "لاحقاً", items: [] }];
    const at = now();
    for (const [i, c] of legacy.slice(0, MAX_COLLECTIONS).entries()) {
      const cid = id("col");
      await db.run("INSERT INTO collections(id,owner,name,position,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", [cid, uid, String(c.name || "مجموعة").slice(0, 50), i, at]);
      for (const [j, pid] of (Array.isArray(c.items) ? c.items : []).filter(x => typeof x === "string").slice(0, MAX_ITEMS).entries())
        if (await db.get("SELECT id FROM posts WHERE id=$1", [pid])) await db.run("INSERT INTO collection_items(collection,post,position,added_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING", [cid, pid, j, at]);
    }
    await db.run("UPDATE users SET prefs=$1 WHERE id=$2", [{ ...prefs, collectionsImported: true }, uid]);
  }
  async function own(uid, cid) { const c = await db.get("SELECT * FROM collections WHERE id=$1 AND owner=$2", [cid, uid]); if (!c) throw E.nf("المجموعة غير موجودة"); return c; }
  const touch = (cid) => db.run("UPDATE collections SET updated_at=$1 WHERE id=$2", [now(), cid]);
  const thumb = (p) => p ? { id: p.id, media: (p.data && !p.data.paid && (p.data.cover || p.data.media || (p.data.images && p.data.images[0]))) || null, /* phase 38: no paid media thumbs */ title: (p.title || p.text || "").slice(0, 60), type: p.type } : null;
  async function covers(cids, viewer) {
    if (!cids.length) return {};
    const rows = await db.all(`SELECT i.collection, p.* FROM collection_items i JOIN posts p ON p.id=i.post WHERE i.collection IN (${ph(cids)}) AND p.status='published' ORDER BY i.position, i.added_at DESC`, cids);
    const vis = new Set((await content().filterVisible(rows, viewer)).map(p => p.id)), out = {};
    for (const r of rows) if (vis.has(r.id) && (out[r.collection] ||= []).length < 4) out[r.collection].push(thumb(r));
    return out;
  }
  const colClient = (c, count, cover) => ({ id: c.id, name: c.name, color: c.color, emoji: c.emoji, position: c.position, shared: !!c.share_code, shareCode: c.share_code || null, count: count || 0, cover: cover || [], updatedAt: c.updated_at });
  async function listCollections(uid) {
    await importLegacy(uid);
    const rows = await db.all("SELECT c.*, (SELECT COUNT(*) FROM collection_items i WHERE i.collection=c.id) n FROM collections c WHERE c.owner=$1 ORDER BY c.position, c.created_at", [uid]);
    const cv = await covers(rows.map(r => r.id), uid);
    return rows.map(r => colClient(r, r.n, cv[r.id]));
  }
  async function createCollection(uid, b) {
    await importLegacy(uid);
    if ((await db.get("SELECT COUNT(*) n FROM collections WHERE owner=$1", [uid])).n >= MAX_COLLECTIONS) throw E.bad("الحد الأقصى 50 مجموعة");
    const pos = (await db.get("SELECT COALESCE(MAX(position),-1)+1 p FROM collections WHERE owner=$1", [uid])).p;
    const c = { id: typeof b.id === "string" && /^col_[a-z0-9]{6,30}$/i.test(b.id) ? b.id : id("col"), at: now() };
    await db.run("INSERT INTO collections(id,owner,name,color,emoji,position,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)", [c.id, uid, str(b.name, 50, { required: true }), HEX.test(b.color || "") ? b.color : null, str(b.emoji, 8), pos, c.at]);
    return colClient(await db.get("SELECT * FROM collections WHERE id=$1", [c.id]), 0, []);
  }
  async function updateCollection(uid, cid, b) {
    const c = await own(uid, cid);
    await db.run("UPDATE collections SET name=$1, color=$2, emoji=$3, updated_at=$4 WHERE id=$5", [str(b.name, 50) || c.name, b.color !== undefined ? (HEX.test(b.color || "") ? b.color : null) : c.color, b.emoji !== undefined ? str(b.emoji, 8) : c.emoji, now(), cid]);
    return colClient(await db.get("SELECT * FROM collections WHERE id=$1", [cid]));
  }
  async function deleteCollection(uid, cid) {
    await own(uid, cid);
    await db.run("DELETE FROM collections WHERE id=$1", [cid]);
    await db.run("INSERT INTO collection_tombstones(owner,collection,post,at) VALUES($1,$2,'',$3)", [uid, cid, now()]);
    return { ok: true };
  }
  async function reorderCollections(uid, ids) {
    if (!Array.isArray(ids)) throw E.bad();
    const mine = new Set((await db.all("SELECT id FROM collections WHERE owner=$1", [uid])).map(r => r.id)), at = now();
    let i = 0; for (const cid of ids) if (mine.has(cid)) await db.run("UPDATE collections SET position=$1, updated_at=$2 WHERE id=$3", [i++, at, cid]);
    return { collections: await listCollections(uid) };
  }
  const itemClient = (i, p, viewer) => ({ post: p ? content().toClient(p, viewer) : null, postId: i.post, note: i.note || "", remindAt: i.remind_at || null, reminded: !!i.reminded, position: i.position, addedAt: i.added_at, updatedAt: i.updated_at });
  async function collectionDetail(uid, cid) {
    const c = await own(uid, cid);
    const items = await db.all("SELECT * FROM collection_items WHERE collection=$1 ORDER BY position, added_at DESC", [cid]);
    const posts = items.length ? await db.all(`SELECT * FROM posts WHERE id IN (${ph(items.map(i => i.post))})`, items.map(i => i.post)) : [];
    const vis = new Map((await content().filterVisible(posts.filter(p => p.status === "published"), uid)).map(p => [p.id, p]));
    return { collection: colClient(c, items.length), items: items.map(i => itemClient(i, vis.get(i.post), uid)), users: await ctx.services.ranking.authors([...vis.values()]) };
  }
  async function addItem(uid, cid, b) {
    await own(uid, cid);
    const pid = str(b.post, 80, { required: true });
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p || !(await content().canSee(p, uid))) throw E.nf("المنشور غير موجود");
    if ((await db.get("SELECT COUNT(*) n FROM collection_items WHERE collection=$1", [cid])).n >= MAX_ITEMS) throw E.bad("المجموعة ممتلئة");
    const at = now(), pos = (await db.get("SELECT COALESCE(MIN(position),1)-1 p FROM collection_items WHERE collection=$1", [cid])).p;
    const r = await db.run("INSERT INTO collection_items(collection,post,note,position,remind_at,added_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT DO NOTHING", [cid, pid, str(b.note, 1000), pos, validWhen(b.remindAt), at]);
    await touch(cid);
    if (r.changes) ctx.services.ranking?.signal(uid, pid, "save").catch(() => { });
    return { ok: true, added: !!r.changes };
  }
  function validWhen(v) { if (!v) return null; const t = Date.parse(v); if (isNaN(t)) throw E.bad("موعد التذكير غير صالح"); return new Date(t).toISOString(); }
  async function updateItem(uid, cid, pid, b) {
    await own(uid, cid);
    const it = await db.get("SELECT * FROM collection_items WHERE collection=$1 AND post=$2", [cid, pid]); if (!it) throw E.nf();
    const at = now();
    if (b.moveTo && b.moveTo !== cid) {
      await own(uid, b.moveTo);
      const pos = (await db.get("SELECT COALESCE(MIN(position),1)-1 p FROM collection_items WHERE collection=$1", [b.moveTo])).p;
      await db.tx(async (t) => {
        await t.run("DELETE FROM collection_items WHERE collection=$1 AND post=$2", [cid, pid]);
        await t.run("INSERT INTO collection_items(collection,post,note,position,remind_at,reminded,added_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (collection, post) DO UPDATE SET note=$3, updated_at=$8", [b.moveTo, pid, it.note, pos, it.remind_at, it.reminded, it.added_at, at]);
        await t.run("INSERT INTO collection_tombstones(owner,collection,post,at) VALUES($1,$2,$3,$4)", [uid, cid, pid, at]);
      });
      await touch(cid); await touch(b.moveTo);
      return { ok: true, movedTo: b.moveTo };
    }
    const note = b.note !== undefined ? str(b.note, 1000) : it.note;
    const remind = b.remindAt !== undefined ? validWhen(b.remindAt) : it.remind_at;
    await db.run("UPDATE collection_items SET note=$1, remind_at=$2, reminded=$3, updated_at=$4 WHERE collection=$5 AND post=$6", [note, remind, b.remindAt !== undefined ? 0 : it.reminded, at, cid, pid]);
    await touch(cid);
    return { ok: true, note: note || "", remindAt: remind };
  }
  async function removeItem(uid, cid, pid) {
    await own(uid, cid);
    const r = await db.run("DELETE FROM collection_items WHERE collection=$1 AND post=$2", [cid, pid]);
    if (r.changes) await db.run("INSERT INTO collection_tombstones(owner,collection,post,at) VALUES($1,$2,$3,$4)", [uid, cid, pid, now()]);
    await touch(cid);
    return { ok: true };
  }
  async function reorderItems(uid, cid, posts) {
    await own(uid, cid); if (!Array.isArray(posts)) throw E.bad();
    const at = now(); let i = 0;
    for (const pid of posts) { const r = await db.run("UPDATE collection_items SET position=$1, updated_at=$2 WHERE collection=$3 AND post=$4", [i, at, cid, pid]); if (r.changes) i++; }
    await touch(cid);
    return { ok: true };
  }

  /* ---------- sharing ---------- */
  async function share(uid, cid, on) {
    await own(uid, cid);
    const code = on ? crypto.randomBytes(9).toString("base64url") : null;
    await db.run("UPDATE collections SET share_code=$1, updated_at=$2 WHERE id=$3", [code, now(), cid]);
    return { shared: !!code, shareCode: code, url: code ? `/#/sc/${code}` : null };
  }
  async function shared(viewer, code) {
    const c = await db.get("SELECT * FROM collections WHERE share_code=$1", [code]); if (!c) throw E.nf("الرابط غير صالح أو أُلغيت المشاركة");
    const items = await db.all("SELECT * FROM collection_items WHERE collection=$1 ORDER BY position, added_at DESC", [c.id]);
    const posts = items.length ? await db.all(`SELECT * FROM posts WHERE id IN (${ph(items.map(i => i.post))}) AND status='published'`, items.map(i => i.post)) : [];
    const vis = new Map((await content().filterVisible(posts, viewer?.id || null)).map(p => [p.id, p]));
    const owner = await db.get("SELECT * FROM users WHERE id=$1", [c.owner]);
    // private notes and reminders are never part of a shared view
    return { collection: { id: c.id, name: c.name, color: c.color, emoji: c.emoji, count: vis.size }, owner: ctx.services.users.pub(owner), posts: items.map(i => vis.get(i.post)).filter(Boolean).map(p => content().toClient(p, viewer?.id)), users: await ctx.services.ranking.authors([...vis.values()]) };
  }

  /* ---------- reminders ---------- */
  async function remindDue() {
    const due = await db.all("SELECT i.collection, i.post, c.owner FROM collection_items i JOIN collections c ON c.id=i.collection WHERE i.reminded=0 AND i.remind_at IS NOT NULL AND i.remind_at <= $1 LIMIT 500", [now()]);
    for (const d of due) {
      const r = await db.run("UPDATE collection_items SET reminded=1 WHERE collection=$1 AND post=$2 AND reminded=0", [d.collection, d.post]);
      if (r.changes) await ctx.services.messaging.notify(d.owner, "read_later", { post: d.post, ref: d.collection });
    }
    return { sent: due.length };
  }
  ctx.scheduler.every("readLater", 60e3, remindDue);
  async function readLater(uid) {
    const rows = await db.all("SELECT i.*, c.name cname FROM collection_items i JOIN collections c ON c.id=i.collection WHERE c.owner=$1 AND i.remind_at IS NOT NULL ORDER BY i.reminded, i.remind_at", [uid]);
    const posts = rows.length ? await db.all(`SELECT * FROM posts WHERE id IN (${ph(rows.map(r => r.post))})`, rows.map(r => r.post)) : [];
    const vis = new Map((await content().filterVisible(posts, uid)).map(p => [p.id, p]));
    return rows.map(r => ({ ...itemClient(r, vis.get(r.post), uid), collection: r.collection, collectionName: r.cname }));
  }

  /* ---------- offline sync ---------- */
  async function syncPull(uid, since) {
    await importLegacy(uid);
    const t = since && !isNaN(Date.parse(since)) ? new Date(since).toISOString() : "1970-01-01T00:00:00.000Z", serverTime = now();
    const cols = await listCollections(uid);
    const items = await db.all("SELECT i.* FROM collection_items i JOIN collections c ON c.id=i.collection WHERE c.owner=$1 AND i.updated_at > $2 ORDER BY i.updated_at", [uid, t]);
    const posts = items.length ? await db.all(`SELECT * FROM posts WHERE id IN (${ph([...new Set(items.map(i => i.post))])})`, [...new Set(items.map(i => i.post))]) : [];
    const vis = new Map((await content().filterVisible(posts.filter(p => p.status === "published"), uid)).map(p => [p.id, p]));
    const authors = [...new Set([...vis.values()].map(p => p.author))];
    const users = authors.length ? (await db.all(`SELECT * FROM users WHERE id IN (${ph(authors)})`, authors)).map(ctx.services.users.pub) : [];
    const tomb = await db.all("SELECT collection, post, at FROM collection_tombstones WHERE owner=$1 AND at > $2", [uid, t]);
    return { serverTime, full: t.startsWith("1970"), collections: cols, items: items.map(i => ({ collection: i.collection, ...itemClient(i, vis.get(i.post), uid) })), users, tombstones: tomb.map(x => ({ collection: x.collection, post: x.post || null, at: x.at })) };
  }
  /** replay operations queued offline, in order; each op is idempotent so retries are safe */
  async function syncPush(uid, ops) {
    if (!Array.isArray(ops) || ops.length > 200) throw E.bad("دفعة مزامنة غير صالحة");
    const results = [];
    for (const op of ops) {
      try {
        if (op.op === "create") results.push({ ok: true, collection: await createCollection(uid, op) });
        else if (op.op === "add") results.push(await addItem(uid, op.collection, op));
        else if (op.op === "remove") results.push(await removeItem(uid, op.collection, op.post));
        else if (op.op === "update") results.push(await updateItem(uid, op.collection, op.post, op));
        else if (op.op === "rename") results.push({ ok: true, collection: await updateCollection(uid, op.collection, op) });
        else results.push({ ok: false, error: "عملية غير معروفة" });
      } catch (e) { results.push({ ok: false, error: e.message, status: e.status || 500 }); }
    }
    return { results, serverTime: now() };
  }

  const r = ctx.router, AU = ctx.requireUser;
  // people lists
  r.get("/api/plists", AU(async (req) => ({ lists: await myLists(req.user.id, req.query.for || null) })));
  r.post("/api/plists", AU(async (req) => ({ list: await createList(req.user.id, req.body) })));
  r.get("/api/plists/:id", async (req) => listDetail(req.user, req.params.id));
  r.patch("/api/plists/:id", AU(async (req) => ({ list: await updateList(req.user.id, req.params.id, req.body) })));
  r.del("/api/plists/:id", AU(async (req) => { const x = await db.run("DELETE FROM people_lists WHERE id=$1 AND owner=$2", [req.params.id, req.user.id]); if (!x.changes) throw E.nf(); return { ok: true }; }));
  r.put("/api/plists/:id/members/:user", AU(async (req) => setMember(req.user.id, req.params.id, req.params.user, true)));
  r.del("/api/plists/:id/members/:user", AU(async (req) => setMember(req.user.id, req.params.id, req.params.user, false)));
  r.get("/api/users/:id/plists", async (req) => { const u = await db.get("SELECT id FROM users WHERE id=$1 OR handle=$1", [req.params.id]); if (!u) throw E.nf(); const all = await myLists(u.id); return { lists: u.id === req.user?.id ? all : all.filter(l => l.visibility === "public") }; });
  // collections (static paths before :id)
  r.get("/api/collections/sync", AU(async (req) => syncPull(req.user.id, req.query.since)));
  r.post("/api/collections/sync", AU(async (req) => syncPush(req.user.id, req.body.ops)));
  r.put("/api/collections/order", AU(async (req) => reorderCollections(req.user.id, req.body.ids)));
  r.get("/api/collections/later", AU(async (req) => { const items = await readLater(req.user.id); return { items, users: await ctx.services.ranking.authors(items.map(i => i.post)) }; }));
  r.get("/api/collections", AU(async (req) => ({ collections: await listCollections(req.user.id) })));
  r.post("/api/collections", AU(async (req) => ({ collection: await createCollection(req.user.id, req.body) })));
  r.get("/api/collections/:id", AU(async (req) => collectionDetail(req.user.id, req.params.id)));
  r.patch("/api/collections/:id", AU(async (req) => ({ collection: await updateCollection(req.user.id, req.params.id, req.body) })));
  r.del("/api/collections/:id", AU(async (req) => deleteCollection(req.user.id, req.params.id)));
  r.post("/api/collections/:id/share", AU(async (req) => share(req.user.id, req.params.id, req.body.on !== false)));
  r.put("/api/collections/:id/items/order", AU(async (req) => reorderItems(req.user.id, req.params.id, req.body.posts)));
  r.post("/api/collections/:id/items", AU(async (req) => addItem(req.user.id, req.params.id, req.body)));
  r.patch("/api/collections/:id/items/:post", AU(async (req) => updateItem(req.user.id, req.params.id, req.params.post, req.body)));
  r.del("/api/collections/:id/items/:post", AU(async (req) => removeItem(req.user.id, req.params.id, req.params.post)));
  r.get("/api/shared/collections/:code", async (req) => shared(req.user, req.params.code));
  return { listCollections, addItem, remindDue, syncPull, syncPush, myLists };
};
