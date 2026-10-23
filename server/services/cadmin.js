/* Community admin panel API (v2.57.0, «المجتمع 3.0» stage 2 — «لوحة الإدارة: الأساسيات»).
 * Feeds #/cadmin/:id: the overview (counts, what needs attention, setup checklist, last log entries), the communities I
 * manage, join-request history + bulk decisions, invite-link revoke, direct member invitations, and the danger zone:
 * ownership transfer (the recipient accepts within 72 h; the previous owner becomes an admin), archive / restore
 * (read-only, reversible), lockdown (posting paused for N hours) and a data export.
 * Every permission goes through lib/cperm.js; every change is written to the unified community log (category + diff).
 * Nothing here deletes community data: requests keep their history, invites are revoked (not deleted), archive is a flag. */
const { E, str, oneOf, id, now } = require("../lib/core");
const CP = require("../lib/cperm");
const CS = require("../lib/community-settings");
const DAY = 864e5, TRANSFER_HOURS = 72;
const ROLE_AR = { owner: "المالك", admin: "مدير", moderator: "مشرف", member: "عضو", muted: "مكتوم", pending: "بانتظار الموافقة", banned: "محظور" };

module.exports = (ctx) => {
  const { db, router: R, bus, rl } = ctx; const A = ctx.requireUser; const P = ctx.cperm;
  const log = (cid, actor, o) => ctx.services.cmod.log(cid, actor, o);
  const getC = async (cid) => { const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); return c; };
  const userShape = (u) => u ? { id: u.id, name: u.name, handle: u.handle, avatar: u.avatar, color: u.color, verified: u.verified } : null;
  const notify = async (uid, kind, o) => { try { await ctx.services.notify?.notify(uid, kind, o); } catch { /* best effort */ } };
  /** staff only (owner, admin, moderator — anyone who reviews the queue) */
  async function needStaff(cid, uid) { const m = await P.need(cid, uid, "queue_review", "لوحة الإدارة لفريق الإشراف"); return m; }
  async function needOwner(cid, uid) { const m = await P.member(cid, uid); if (m?.role !== "owner") throw E.forbid("هذا الإجراء للمالك فقط"); return m; }

  /* ---------- join-request history: decided requests are kept (status, who, when, why) ---------- */
  async function decideRequestRow(cid, uid, status, by, reason) {
    const at = now();
    const r = await db.run("UPDATE join_requests SET status=$1, decided_by=$2, decided_at=$3, reason=$4 WHERE community=$5 AND user_id=$6", [status, by, at, reason || null, cid, uid]);
    if (!r.changes) await db.run("INSERT INTO join_requests(community,user_id,answers,created_at,status,decided_by,decided_at,reason,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'direct') ON CONFLICT (community,user_id) DO NOTHING", [cid, uid, [], at, status, by, at, reason || null]);
  }
  async function decide(user, cid, uid, action, reason) {
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]); if (m?.role !== "pending") return false;
    if (action === "approve") {
      await db.run("UPDATE memberships SET role='member', status='active' WHERE community=$1 AND user_id=$2 AND role='pending'", [cid, uid]);
      bus.emit("COMMUNITY_JOINED", { community: cid, actor: uid, approvedBy: user.id });
    } else await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2 AND role='pending'", [cid, uid]);
    await ctx.services.communities.mevent(cid, uid, action === "approve" ? "approve" : "reject", { by: user.id });
    await decideRequestRow(cid, uid, action === "approve" ? "approved" : "rejected", user.id, reason);
    await log(cid, user.id, { user: uid, action: action === "approve" ? "join_approve" : "join_reject", reason });
    return true;
  }
  R.get("/api/communities/:id/requests/history", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "approve_requests");
    const status = oneOf(req.query.status, ["approved", "rejected", "cancelled"], null);
    const args = [cid], where = ["j.community=$1", "j.status<>'pending'"];
    if (status) { args.push(status); where.push(`j.status=$${args.length}`); }
    if (req.query.before) { args.push(String(req.query.before)); where.push(`j.decided_at < $${args.length}`); }
    const rows = await db.all(`SELECT j.user_id, j.status, j.decided_at, j.decided_by, j.reason, j.source, j.created_at, u.name, u.handle, u.avatar, u.color, d.name dname FROM join_requests j JOIN users u ON u.id=j.user_id LEFT JOIN users d ON d.id=j.decided_by WHERE ${where.join(" AND ")} ORDER BY j.decided_at DESC LIMIT 31`, args);
    const page = rows.slice(0, 30);
    return { history: page.map(r => ({ user: userShape({ id: r.user_id, ...r }), status: r.status, decidedAt: r.decided_at, decidedBy: r.decided_by === "invite" ? "رابط دعوة" : r.decided_by === r.user_id ? "صاحب الطلب" : r.dname || null, reason: r.reason, source: r.source, requestedAt: r.created_at })), next: rows.length > 30 ? page[page.length - 1].decided_at : null };
  }));
  R.post("/api/communities/:id/requests/decide", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "approve_requests");
    const action = oneOf(req.body.action, ["approve", "reject"], null); if (!action) throw E.bad();
    const users = [...new Set((Array.isArray(req.body.users) ? req.body.users : []).map(String))].slice(0, 50); if (!users.length) throw E.bad("اختر طلباً واحداً على الأقل");
    if (users.length > 1 && !rl.hit("invite", "bulk:" + req.user.id)) throw E.rate();
    const reason = str(req.body.reason, 300) || null; let done = 0;
    for (const u of users) if (await decide(req.user, cid, u, action, reason)) done++;
    return { ok: true, done };
  }));

  /* ---------- invite links: revoke (kept for its stats) ---------- */
  R.del("/api/communities/:id/invites/:code", A(async (req) => {
    const cid = req.params.id; const inv = await db.get("SELECT * FROM community_invites WHERE code=$1 AND community=$2", [req.params.code, cid]); if (!inv) throw E.nf();
    if (inv.created_by !== req.user.id) await P.need(cid, req.user.id, "approve_requests"); else await P.need(cid, req.user.id, "invite");
    if (!inv.revoked_at) { await db.run("UPDATE community_invites SET revoked_at=$1 WHERE code=$2", [now(), inv.code]); await log(cid, req.user.id, { action: "invite_revoked", category: "members", reason: inv.label || inv.code }); }
    return { ok: true };
  }));

  /* ---------- direct member invitations (one person) ---------- */
  R.post("/api/communities/:id/member-invites", A(async (req) => {
    const cid = req.params.id, c = await getC(cid); await P.need(cid, req.user.id, "invite");
    if (c.archived_at) throw E.forbid("المجتمع مؤرشف");
    if (!rl.hit("invite", req.user.id)) throw E.rate();
    const handle = String(req.body.handle || "").trim().replace(/^@/, "").toLowerCase().slice(0, 40);
    const to = req.body.user ? await db.get("SELECT id, name, handle FROM users WHERE id=$1", [String(req.body.user)]) : handle ? await db.get("SELECT id, name, handle FROM users WHERE LOWER(handle)=$1", [handle]) : null;
    if (!to) throw E.nf("لم نجد هذا الحساب");
    const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, to.id]);
    if (m?.role === "banned") throw E.bad("هذا الحساب محظور من المجتمع");
    if (m && m.role !== "pending") throw E.conflict("عضو في المجتمع بالفعل");
    const ex = await db.get("SELECT id FROM community_member_invites WHERE community=$1 AND user_id=$2 AND status='pending'", [cid, to.id]);
    const iid = ex?.id || id("ci");
    if (!ex) await db.run("INSERT INTO community_member_invites(id,community,user_id,invited_by,status,created_at) VALUES($1,$2,$3,$4,'pending',$5)", [iid, cid, to.id, req.user.id, now()]);
    bus.emit("INVITE_SENT", { kind: "community", ref: cid, to: to.id, actor: req.user.id });
    await log(cid, req.user.id, { user: to.id, action: "member_invited", category: "members" });
    return { invite: { id: iid, user: userShape(to), status: "pending" } };
  }));
  R.get("/api/communities/:id/member-invites", A(async (req) => {
    const cid = req.params.id; await P.need(cid, req.user.id, "invite");
    const mine = !(await P.has(cid, req.user.id, "approve_requests"));
    const rows = await db.all(`SELECT i.*, u.name, u.handle, u.avatar, u.color, b.name bname FROM community_member_invites i JOIN users u ON u.id=i.user_id LEFT JOIN users b ON b.id=i.invited_by WHERE i.community=$1${mine ? " AND i.invited_by=$2" : ""} ORDER BY i.created_at DESC LIMIT 100`, mine ? [cid, req.user.id] : [cid]);
    return { invites: rows.map(r => ({ id: r.id, user: userShape({ id: r.user_id, ...r }), invitedBy: r.bname, status: r.status, createdAt: r.created_at, respondedAt: r.responded_at })) };
  }));
  R.del("/api/communities/:id/member-invites/:iid", A(async (req) => {
    const cid = req.params.id; const inv = await db.get("SELECT * FROM community_member_invites WHERE id=$1 AND community=$2", [req.params.iid, cid]); if (!inv) throw E.nf();
    if (inv.invited_by !== req.user.id) await P.need(cid, req.user.id, "approve_requests");
    await db.run("UPDATE community_member_invites SET status='revoked', responded_at=$1 WHERE id=$2 AND status='pending'", [now(), inv.id]);
    return { ok: true };
  }));
  R.get("/api/me/community-invites", A(async (req) => {
    const rows = await db.all("SELECT i.id, i.community, i.created_at, c.name, c.color, c.settings, u.name iname FROM community_member_invites i JOIN communities c ON c.id=i.community LEFT JOIN users u ON u.id=i.invited_by WHERE i.user_id=$1 AND i.status='pending' ORDER BY i.created_at DESC LIMIT 50", [req.user.id]);
    return { invites: rows.map(r => ({ id: r.id, community: { id: r.community, name: r.name, color: r.color, icon: r.settings?.icon || null }, invitedBy: r.iname, createdAt: r.created_at })) };
  }));
  R.post("/api/community-invites/:iid/decline", A(async (req) => {
    await db.run("UPDATE community_member_invites SET status='declined', responded_at=$1 WHERE id=$2 AND user_id=$3 AND status='pending'", [now(), req.params.iid, req.user.id]);
    return { ok: true };
  }));

  /* ---------- ownership transfer: owner requests, recipient (an admin) accepts within 72 h ---------- */
  const tShape = (t, names = {}) => t ? { id: t.id, community: t.community, from: names[t.from_user] || { id: t.from_user }, to: names[t.to_user] || { id: t.to_user }, status: t.status, createdAt: t.created_at, expiresAt: t.expires_at, decidedAt: t.decided_at } : null;
  async function expire() { await db.run("UPDATE community_transfers SET status='expired', decided_at=$1 WHERE status='pending' AND expires_at < $1", [now()]); }
  async function pendingTransfer(cid) {
    await expire();
    const t = await db.get("SELECT * FROM community_transfers WHERE community=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1", [cid]); if (!t) return null;
    const us = await db.all("SELECT id, name, handle, avatar, color, verified FROM users WHERE id IN ($1,$2)", [t.from_user, t.to_user]);
    return tShape(t, Object.fromEntries(us.map(u => [u.id, userShape(u)])));
  }
  R.get("/api/communities/:id/transfer", A(async (req) => {
    const cid = req.params.id; const t = await pendingTransfer(cid);
    if (t && (t.to.id === req.user.id || t.from.id === req.user.id)) return { transfer: t };
    await P.need(cid, req.user.id, "manage_roles"); return { transfer: t };
  }));
  R.post("/api/communities/:id/transfer", A(async (req) => {
    const cid = req.params.id, c = await getC(cid); await needOwner(cid, req.user.id);
    if (str(req.body.confirm, 80) !== c.name) throw E.bad("اكتب اسم المجتمع كما هو للتأكيد");
    const to = String(req.body.to || ""); const tm = await P.member(cid, to);
    if (!tm || tm.role !== "admin") throw E.bad("اختر مديراً في المجتمع (عيّنه مديراً أولاً)");
    if (await pendingTransfer(cid)) throw E.conflict("يوجد طلب نقل ملكية قائم. ألغه أولاً");
    const tid = id("tr"), at = now(), exp = new Date(Date.now() + TRANSFER_HOURS * 3600e3).toISOString();
    await db.run("INSERT INTO community_transfers(id,community,from_user,to_user,status,created_at,expires_at) VALUES($1,$2,$3,$4,'pending',$5,$6)", [tid, cid, req.user.id, to, at, exp]);
    await log(cid, req.user.id, { user: to, action: "transfer_requested", category: "danger", meta: { expiresAt: exp } });
    await notify(to, "community_transfer", { actor: req.user.id, ref: cid });
    return { transfer: await pendingTransfer(cid) };
  }));
  R.del("/api/communities/:id/transfer", A(async (req) => {
    const cid = req.params.id; await needOwner(cid, req.user.id);
    const r = await db.run("UPDATE community_transfers SET status='cancelled', decided_at=$1 WHERE community=$2 AND status='pending'", [now(), cid]);
    if (r.changes) await log(cid, req.user.id, { action: "transfer_cancelled", category: "danger" });
    return { ok: true };
  }));
  R.post("/api/community-transfers/:tid/:act", A(async (req) => {
    const act = oneOf(req.params.act, ["accept", "decline"], null); if (!act) throw E.nf();
    await expire();
    const t = await db.get("SELECT * FROM community_transfers WHERE id=$1", [req.params.tid]);
    if (!t || t.to_user !== req.user.id) throw E.nf();
    if (t.status !== "pending") throw E.bad(t.status === "expired" ? "انتهت مهلة الطلب" : "الطلب لم يعد قائماً");
    if (act === "decline") {
      await db.run("UPDATE community_transfers SET status='declined', decided_at=$1 WHERE id=$2 AND status='pending'", [now(), t.id]);
      await log(t.community, req.user.id, { user: t.from_user, action: "transfer_declined", category: "danger" });
      return { ok: true, status: "declined" };
    }
    /* accept: one transaction — the request must still be pending, the sender still the owner, the recipient still an admin */
    const ok = await db.tx(async (x) => {
      const cur = await x.get(`SELECT * FROM community_transfers WHERE id=$1${db.dialect === "postgres" ? " FOR UPDATE" : ""}`, [t.id]); if (cur?.status !== "pending") return false;
      const c = await x.get(`SELECT owner FROM communities WHERE id=$1${db.dialect === "postgres" ? " FOR UPDATE" : ""}`, [t.community]);
      const from = await x.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [t.community, t.from_user]);
      const to = await x.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [t.community, t.to_user]);
      if (c?.owner !== t.from_user || from?.role !== "owner" || to?.role !== "admin") return false;
      const at = now();
      await x.run("UPDATE communities SET owner=$1 WHERE id=$2", [t.to_user, t.community]);
      await x.run("UPDATE memberships SET role='owner', status='active', prev_role=NULL WHERE community=$1 AND user_id=$2", [t.community, t.to_user]);
      await x.run("UPDATE memberships SET role='admin', status='active', prev_role=NULL WHERE community=$1 AND user_id=$2", [t.community, t.from_user]);
      await x.run("UPDATE community_transfers SET status='accepted', decided_at=$1 WHERE id=$2", [at, t.id]);
      return true;
    });
    if (!ok) throw E.conflict("تغيّرت الأدوار منذ إرسال الطلب. اطلب من المالك إرساله من جديد");
    P.invalidate(t.community);
    await ctx.services.communities.mevent(t.community, t.to_user, "role", { from: "admin", to: "owner", by: t.from_user, transfer: t.id });
    await ctx.services.communities.mevent(t.community, t.from_user, "role", { from: "owner", to: "admin", transfer: t.id });
    await log(t.community, req.user.id, { user: t.from_user, action: "transfer_accepted", category: "danger", diff: { owner: { from: t.from_user, to: t.to_user } } });
    await ctx.audit("COMMUNITY_OWNER_CHANGED", t.community, `${t.from_user}→${t.to_user}`, req.user.id);
    await notify(t.from_user, "community_transfer", { actor: req.user.id, ref: t.community });
    return { ok: true, status: "accepted" };
  }));

  /* ---------- archive / restore (owner): read-only, reversible ---------- */
  R.post("/api/communities/:id/archive", A(async (req) => {
    const cid = req.params.id, c = await getC(cid); await needOwner(cid, req.user.id);
    if (str(req.body.confirm, 80) !== c.name) throw E.bad("اكتب اسم المجتمع كما هو للتأكيد");
    if (!c.archived_at) { await db.run("UPDATE communities SET archived_at=$1 WHERE id=$2", [now(), cid]); await log(cid, req.user.id, { action: "archived", category: "danger" }); ctx.cache.del("feed:"); }
    return { ok: true, archivedAt: (await getC(cid)).archived_at };
  }));
  R.post("/api/communities/:id/restore", A(async (req) => {
    const cid = req.params.id, c = await getC(cid); await needOwner(cid, req.user.id);
    if (c.archived_at) { await db.run("UPDATE communities SET archived_at=NULL WHERE id=$1", [cid]); await log(cid, req.user.id, { action: "restored", category: "danger" }); ctx.cache.del("feed:"); }
    return { ok: true, archivedAt: null };
  }));

  /* ---------- lockdown: posting paused for N hours (owner/admins) ---------- */
  R.post("/api/communities/:id/lockdown", A(async (req) => {
    const cid = req.params.id; await getC(cid); await P.need(cid, req.user.id, "manage_automod", "للمالك والمديرين");
    const hours = Math.max(0, Math.min(168, Math.round(+req.body.hours || 0)));
    const until = hours ? new Date(Date.now() + hours * 3600e3).toISOString() : null;
    const res = await CS.mutate(db, cid, async (s) => ({ ...s, lockdownUntil: CS.FIELDS.lockdownUntil.parse(until) }));
    await log(cid, req.user.id, { action: hours ? "lockdown" : "lockdown_lifted", category: "danger", reason: hours ? `${hours} ساعة` : null, diff: CS.diff({ lockdownUntil: res.before.lockdownUntil }, { lockdownUntil: res.after.lockdownUntil }) });
    return { lockdownUntil: res.after.lockdownUntil || null };
  }));

  /* ---------- data export (owner): JSON with members, posts, wiki, rules, channels and the log ---------- */
  R.get("/api/communities/:id/export", A(async (req, res) => {
    const cid = req.params.id, c = await getC(cid); await needOwner(cid, req.user.id);
    if (!rl.hit("community", "export:" + req.user.id)) throw E.rate();
    const members = await db.all("SELECT u.handle, u.name, m.role, m.joined_at, m.warnings FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.community=$1 ORDER BY m.joined_at", [cid]);
    const posts = await db.all("SELECT p.id, u.handle author, p.type, p.title, p.text, p.status, p.channel, p.created_at FROM posts p LEFT JOIN users u ON u.id=p.author WHERE p.community=$1 ORDER BY p.created_at LIMIT 50000", [cid]);
    const channels = await db.all("SELECT id, name, slug, descr, kind, position, post_perm, view_perm, group_id, icon, archived_at, slow_mode_sec, require_approval, allowed_types, view_roles, post_roles, is_default, created_at FROM community_channels WHERE community=$1 ORDER BY position", [cid]);
    const wiki = await db.all("SELECT * FROM wiki_pages WHERE community=$1", [cid]).catch(() => []);
    /* v2.58: categories, structured rules, pins and announcements travel with the export */
    const extra = { channelGroups: await db.all("SELECT id, name, position FROM community_channel_groups WHERE community=$1 ORDER BY position", [cid]).catch(() => []), rules: await db.all("SELECT position, title, body, severity FROM community_rules WHERE community=$1 ORDER BY position", [cid]).catch(() => []),
      pins: await db.all("SELECT post, channel, position, until, created_at FROM community_pins WHERE community=$1", [cid]).catch(() => []), announcements: await db.all("SELECT title, body, level, starts_at, ends_at, created_at FROM community_announcements WHERE community=$1 ORDER BY created_at", [cid]).catch(() => []) };
    const logRows = await db.all("SELECT a.created_at, a.action, a.category, a.reason, u.handle actor FROM mod_actions a LEFT JOIN users u ON u.id=a.actor WHERE a.community=$1 ORDER BY a.created_at DESC LIMIT 5000", [cid]);
    const out = { exportedAt: now(), version: ctx.config.version, community: { id: c.id, name: c.name, desc: c.descr, type: c.type, topic: c.topic, location: c.location, rules: c.rules || [], createdAt: c.created_at, archivedAt: c.archived_at, settings: c.settings || {} },
      channels, ...extra, members, posts, wiki: wiki.map(w => ({ slug: w.slug, title: w.title, body: w.body, version: w.version, locked: !!w.locked, updatedAt: w.updated_at })), log: logRows };
    await log(cid, req.user.id, { action: "exported", category: "danger", meta: { members: members.length, posts: posts.length } });
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="community-${cid}.json"`, "Cache-Control": "no-store" });
    res.end(JSON.stringify(out, null, 1));
    return ctx.STREAM;
  }));

  /* ---------- the communities I manage (#/cadmin index, «مجتمعاتي التي أديرها») ---------- */
  R.get("/api/me/communities/managed", A(async (req) => {
    const rows = await db.all("SELECT c.id, c.name, c.color, c.type, c.settings, c.archived_at, m.role, (SELECT COUNT(*) FROM memberships x WHERE x.community=c.id AND x.role NOT IN ('pending','banned')) members, (SELECT COUNT(*) FROM memberships x WHERE x.community=c.id AND x.role='pending') pending, (SELECT COUNT(*) FROM posts p WHERE p.community=c.id AND p.status='pending') queued FROM memberships m JOIN communities c ON c.id=m.community WHERE m.user_id=$1 AND m.role IN ('owner','admin','moderator') ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, c.name", [req.user.id]);
    await expire();
    const incoming = await db.all("SELECT t.id, t.community, t.expires_at, c.name, u.name fname FROM community_transfers t JOIN communities c ON c.id=t.community LEFT JOIN users u ON u.id=t.from_user WHERE t.to_user=$1 AND t.status='pending'", [req.user.id]);
    return { communities: rows.map(r => ({ id: r.id, name: r.name, color: r.color, type: r.type, icon: r.settings?.icon || null, accent: r.settings?.accent || null, archivedAt: r.archived_at || null, role: r.role, roleLabel: ROLE_AR[r.role], members: Number(r.members), pending: Number(r.pending), queued: Number(r.queued) })),
      transfers: incoming.map(t => ({ id: t.id, community: { id: t.community, name: t.name }, from: t.fname, expiresAt: t.expires_at })) };
  }));

  /* ---------- overview: what the panel's home shows ---------- */
  /* H3-06: a quiet pre-check (always 200 for a signed-in user) so the panel never fires a 403 /admin call for a plain
   * member. Same rule as /admin below: an incoming ownership transfer, or the queue_review permission. */
  R.get("/api/communities/:id/admin/access", A(async (req) => {
    const cid = req.params.id; await getC(cid);
    const t = await pendingTransfer(cid); if (t && t.to.id === req.user.id) return { allowed: true };
    const me = await P.member(cid, req.user.id);
    return { allowed: !!me && (await P.has(cid, req.user.id, "queue_review")) };
  }));
  R.get("/api/communities/:id/admin", A(async (req) => {
    const cid = req.params.id, c = await getC(cid), me = await P.member(cid, req.user.id);
    const t = await pendingTransfer(cid); const incoming = t && t.to.id === req.user.id ? t : null;
    if (!incoming) await needStaff(cid, req.user.id);
    const keys = [...(await P.keys(cid, req.user.id, me))];
    const s = c.settings || {}, week = new Date(Date.now() - 7 * DAY).toISOString(), month = new Date(Date.now() - 30 * DAY).toISOString();
    const n = async (sql, a) => Number((await db.get(sql, a)).n);
    const members = await n("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid]);
    const requests = await n("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role='pending'", [cid]);
    const pendingPosts = await n("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='pending'", [cid]);
    const reports = await n(`SELECT COUNT(*) n FROM reports r LEFT JOIN posts p ON p.id=r.target AND p.community=$1 LEFT JOIN comments cm ON cm.id=r.target LEFT JOIN posts cp ON cp.id=cm.post AND cp.community=$1 WHERE r.status='open' AND (p.id IS NOT NULL OR cp.id IS NOT NULL)`, [cid]);
    const posts7d = await n("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at > $2", [cid, week]);
    const wau = await n("SELECT COUNT(DISTINCT a) n FROM (SELECT author a FROM posts WHERE community=$1 AND status='published' AND created_at > $2 UNION SELECT c.author a FROM comments c JOIN posts p ON p.id=c.post WHERE p.community=$1 AND c.created_at > $2) x", [cid, week]);
    const joined30 = await n("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned') AND joined_at > $2", [cid, month]);
    const channels = await db.all("SELECT kind FROM community_channels WHERE community=$1", [cid]);
    const events = await n("SELECT COUNT(*) n FROM events WHERE community=$1", [cid]);
    const invites = await n("SELECT COUNT(*) n FROM community_invites WHERE community=$1", [cid]);
    const sanctions = await n("SELECT COUNT(*) n FROM community_sanctions WHERE community=$1 AND kind IN ('mute','ban') AND lifted_at IS NULL", [cid]);
    const setup = [
      { key: "cover", label: "غلاف وأيقونة للمجتمع", done: !!(s.cover || s.icon), section: "general" },
      { key: "desc", label: "وصف يعرّف بالمجتمع", done: (c.descr || "").length >= 20, section: "general" },
      { key: "rules", label: "قواعد واضحة", done: (c.rules || []).length > 0, section: "rules" },
      { key: "welcome", label: "رسالة ترحيب للأعضاء الجدد", done: !!s.welcome?.message, section: "rules" },
      { key: "announce", label: "قناة إعلانات", done: channels.some(x => x.kind === "announcements"), section: "channels" },
      { key: "event", label: "أول فعالية", done: events > 0, href: `#/c/${cid}` },
      { key: "invite", label: "رابط دعوة", done: invites > 0, section: "privacy" }
    ];
    const recent = (await db.all("SELECT a.action, a.category, a.reason, a.created_at, u.name actor, x.name target FROM mod_actions a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users x ON x.id=a.target_user WHERE a.community=$1 ORDER BY a.created_at DESC LIMIT 5", [cid]))
      .map(r => ({ action: r.action, category: r.category, reason: r.reason, at: r.created_at, actor: r.actor || (r.actor === null ? "النظام" : null), target: r.target }));
    const lock = s.lockdownUntil && new Date(s.lockdownUntil) > new Date() ? s.lockdownUntil : null;
    return {
      community: { ...ctx.services.communities.toClient(c), icon: s.icon || null, accent: s.accent || null, cover: s.cover || null, lockdownUntil: lock },
      role: me?.role || null, roleLabel: ROLE_AR[me?.role] || null, rank: CP.rankOf(me), keys, assignable: P.assignable(me?.role),
      counts: { members, requests, pendingPosts, reports, queue: requests + pendingPosts + reports, posts7d, wau, joined30, sanctions },
      setup, recent, transfer: t && (keys.includes("manage_roles") || t.from.id === req.user.id) ? t : null, incomingTransfer: incoming
    };
  }));

  /* one-time, idempotent: community_invites.uses from the memberships each link brought (runtime backfill, migration stays additive) */
  db.run("UPDATE community_invites SET uses=(SELECT COUNT(*) FROM memberships m WHERE m.invited_via=community_invites.code) WHERE uses=0 AND EXISTS (SELECT 1 FROM memberships m WHERE m.invited_via=community_invites.code)").catch(() => {});

  return { decideRequestRow, decide, pendingTransfer };
};
