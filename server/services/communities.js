/* Community Engine + Event Engine + Reputation: communities, memberships, roles & permissions,
 * moderation queue, settings, invites, community analytics, calendar events and RSVPs.
 * v2.56.0: every permission check goes through lib/cperm.js (hierarchy: nobody acts on an equal or higher rank);
 * mute/ban keep the member's role in prev_role (status apart from role); public responses carry an allow-list of
 * settings only (lib/community-settings.js); reputation reads community_member_stats instead of a per-member scan;
 * private communities' events and member lists stay with their members. */
const { E, str, oneOf, acceptId, now, id } = require("../lib/core");
const CP = require("../lib/cperm");
const CS = require("../lib/community-settings");
const PERMS = { // legacy view of the base grants (kept for compatibility; the engine is lib/cperm.js)
  owner: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanEditRules", "CanManageMembers", "CanManagePosts"],
  admin: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanManageMembers", "CanManagePosts"],
  moderator: ["CanPost", "CanComment", "CanInvite", "CanModerate", "CanManagePosts"],
  member: ["CanPost", "CanComment", "CanInvite"], muted: [], pending: [], banned: [] // v2.62 T6: muted members no longer comment (T5)
};
const GRAD = /^linear-gradient\(135deg,\s?#[0-9a-f]{3,8},\s?#[0-9a-f]{3,8}\)$/i;
const DAY = 864e5;
const ROLE_AR = { owner: "مالك", admin: "مدير", moderator: "مشرف", member: "عضو", muted: "مكتوم", pending: "بانتظار الموافقة", banned: "محظور" };

module.exports = (ctx) => {
  const { db, bus, rl } = ctx;
  const P = ctx.cperm;
  const role = async (cid, uid) => uid ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role : undefined;
  const can = async (cid, uid, perm) => P.has(cid, uid, perm);
  /* public shape: identity fields + the PUBLIC settings only (never automod word lists, join questions, welcome, …) */
  const toClient = (c) => ({ id: c.id, name: c.name, desc: c.descr, topic: c.topic, type: c.type, color: c.color, owner: c.owner, rules: c.rules || [], location: c.location, createdAt: c.created_at, archivedAt: c.archived_at || null, ...CS.publicSettings(c.settings || {}) });
  /* v2.60: every member event is also announced on the bus (incremental insight counters, webhooks, notify defaults) */
  const mevent = (cid, uid, kind, meta = null) => { const at = now(); return db.run("INSERT INTO community_member_events(community,user_id,kind,at,meta) VALUES($1,$2,$3,$4,$5)", [cid, uid, kind, at, meta]).then(() => { bus.emit("COMMUNITY_MEMBER_EVENT", { community: cid, user: uid, kind, meta, at }); }).catch(() => {}); };
  /** may this viewer see members / events of this community? (public: anyone; private/invite: active members) */
  async function visibleTo(c, uid) { if (!c) return false; if (c.type === "public") return true; const r = await role(c.id, uid); return CP.ACTIVE(r); }

  async function create(user, b) {
    if (!rl.hit("community", user.id)) throw E.rate();
    const c = { id: acceptId(b.id, "m"), name: str(b.name, 60, { required: true, min: 3 }), descr: str(b.desc, 300) || "", topic: str(b.topic, 20), type: oneOf(b.type, ["public", "private", "invite"], "public"),
      color: GRAD.test(b.color || "") ? b.color : "linear-gradient(135deg,#5b2bd6,#c04cf0)", rules: (Array.isArray(b.rules) ? b.rules : []).map(x => str(x, 200)).filter(Boolean).slice(0, 20) };
    if (await db.get("SELECT 1 x FROM communities WHERE LOWER(name)=LOWER($1)", [c.name])) throw E.conflict("يوجد مجتمع بنفس الاسم");
    const settings = { requireApproval: !!b.requireApproval };
    await db.tx(async t => {
      await t.run("INSERT INTO communities(id,name,descr,topic,type,color,owner,rules,settings,location,created_at,member_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)", [c.id, c.name, c.descr, c.topic, c.type, c.color, user.id, c.rules, settings, str(b.location, 60), now()]);
      await t.run("INSERT INTO memberships(community,user_id,role,joined_at) VALUES($1,$2,'owner',$3)", [c.id, user.id, now()]);
    });
    if (c.rules.length) await ctx.services.cchannels.ensureRules(c.id, c.rules).catch(() => {}); // v2.58: structured rules from day one
    bus.emit("COMMUNITY_CREATED", { community: c.id, actor: user.id });
    return toClient(await db.get("SELECT * FROM communities WHERE id=$1", [c.id]));
  }
  async function update(user, cid, b) {
    await P.need(cid, user.id, "edit_settings");
    const cur = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!cur) throw E.nf();
    const patch = CS.parseSection("general", b);
    const res = await CS.mutate(db, cid, async (s) => ({ ...s, ...patch }));
    await db.run("UPDATE communities SET name=$1, descr=$2, type=$3, rules=$4, location=$5 WHERE id=$6", [
      b.name !== undefined ? str(b.name, 60, { required: true, min: 3 }) : cur.name, b.desc !== undefined ? (str(b.desc, 300) || "") : cur.descr, oneOf(b.type, ["public", "private", "invite"], cur.type),
      Array.isArray(b.rules) ? b.rules.map(x => str(x, 200)).filter(Boolean).slice(0, 20) : cur.rules, b.location !== undefined ? str(b.location, 60) : cur.location, cid]);
    if (Array.isArray(b.rules)) await ctx.services.cchannels.syncFromLegacy(cid, b.rules.map(x => str(x, 200)).filter(Boolean).slice(0, 20)); // v2.58: structured rules follow the legacy editor (mirror)
    const after = await db.get("SELECT * FROM communities WHERE id=$1", [cid]);
    const d = CS.diff({ ...res.before, name: cur.name, desc: cur.descr, type: cur.type, rules: cur.rules, location: cur.location }, { ...res.after, name: after.name, desc: after.descr, type: after.type, rules: after.rules, location: after.location });
    await ctx.audit("COMMUNITY_SETTINGS_UPDATED", cid, null, user.id);
    if (Object.keys(d).length) await ctx.services.cmod.log(cid, user.id, { action: "settings_updated", category: "settings", diff: d });
    return toClient(after);
  }
  async function join(user, cid, inviteFrom) {
    const c = await db.get("SELECT * FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf();
    const ex = await role(cid, user.id); if (ex === "banned") throw E.forbid("أنت محظور من هذا المجتمع"); if (ex) return { role: ex };
    if (c.archived_at) throw E.forbid("المجتمع مؤرشف: لا يقبل أعضاء جدداً");
    let r = c.type === "public" ? "member" : "pending";
    /* v2.57: a direct invitation (community_member_invites) first, then the legacy invite notification (pre-v2.57 invitees) */
    const direct = await db.get("SELECT id FROM community_member_invites WHERE community=$1 AND user_id=$2 AND status='pending'", [cid, user.id]).catch(() => null);
    if (direct && c.type !== "public") r = "member";
    const answered = !direct && await db.get("SELECT status FROM community_member_invites WHERE community=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1", [cid, user.id]).catch(() => null);
    if (c.type === "invite" && answered) throw E.forbid("هذا المجتمع بالدعوة فقط"); // a declined or revoked invitation no longer admits
    if (c.type === "invite" && !direct) { const inv = await db.get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='invite' AND ref=$2", [user.id, cid]); if (!inv) throw E.forbid("هذا المجتمع بالدعوة فقط"); r = "member"; }
    await db.run("INSERT INTO memberships(community,user_id,role,joined_at,status) VALUES($1,$2,$3,$4,$5)", [cid, user.id, r, now(), r === "pending" ? "pending" : "active"]);
    if (direct) await db.run("UPDATE community_member_invites SET status='accepted', responded_at=$1 WHERE id=$2", [now(), direct.id]);
    bus.emit(r === "pending" ? "COMMUNITY_JOIN_REQUESTED" : "COMMUNITY_JOINED", { community: cid, owner: c.owner, actor: user.id });
    await mevent(cid, user.id, r === "pending" ? "request" : "join");
    return { role: r };
  }
  async function leave(user, cid) {
    const r = await role(cid, user.id); if (r === "owner") throw E.bad("المالك لا يستطيع المغادرة");
    const d = await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2 AND role<>'banned'", [cid, user.id]);
    if (d.changes && r === "pending") await db.run("UPDATE join_requests SET status='cancelled', decided_by=$1, decided_at=$2 WHERE community=$3 AND user_id=$4 AND status='pending'", [user.id, now(), cid, user.id]).catch(() => {});
    if (d.changes) { await db.run("DELETE FROM member_roles WHERE community=$1 AND user_id=$2", [cid, user.id]).catch(() => {}); await mevent(cid, user.id, "leave"); }
  }

  /* ---- sanctions: status apart from role. mute/ban remember the role (prev_role); lifting restores it ---- */
  /* opts (all optional, old callers unchanged): hours (mute, clamped 1..720), reason,
   * indefinite (mute only: muted_until/until NULL, so unmuteDue never auto-lifts it; only a manual unmute does),
   * ruleId (≤64 chars, recorded in community_sanctions.rule_id, e.g. "autoguard" / "autoguard_lock"),
   * reset (unmute only: also lifts the active automatic-guard strikes, rule_id 'autoguard%' warns). */
  async function sanction(actorId, cid, target, action, { hours, reason, indefinite, ruleId, reset } = {}) {
    const m = await db.get("SELECT * FROM memberships WHERE community=$1 AND user_id=$2", [cid, target]); if (!m) throw E.nf();
    const keep = ["muted", "banned"].includes(m.role) ? (m.prev_role || "member") : (m.role === "pending" ? "member" : m.role);
    const at = now(), rule = ruleId == null || ruleId === "" ? null : String(ruleId).slice(0, 64);
    if (action === "mute") {
      const until = indefinite === true ? null : new Date(Date.now() + Math.max(1, Math.min(24 * 30, +hours || 24)) * 3600e3).toISOString();
      await db.run("UPDATE memberships SET prev_role=$1, role='muted', status='muted', muted_until=$2 WHERE community=$3 AND user_id=$4", [keep, until, cid, target]);
      await db.run("INSERT INTO community_sanctions(id,community,user_id,kind,until,reason,rule_id,actor,created_at) VALUES($1,$2,$3,'mute',$4,$5,$6,$7,$8)", [id("sn"), cid, target, until, reason || null, rule, actorId, at]);
    } else if (action === "unmute") {
      const r = await db.run("UPDATE memberships SET role=COALESCE(prev_role,'member'), status='active', prev_role=NULL, muted_until=NULL WHERE community=$1 AND user_id=$2 AND role='muted'", [cid, target]);
      if (r.changes) await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE community=$3 AND user_id=$4 AND kind='mute' AND lifted_at IS NULL", [at, actorId, cid, target]);
      if (reset === true) await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE community=$3 AND user_id=$4 AND kind='warn' AND rule_id LIKE 'autoguard%' AND lifted_at IS NULL", [at, actorId, cid, target]);
    } else if (action === "ban") {
      await db.run("UPDATE memberships SET prev_role=$1, role='banned', status='banned', muted_until=NULL WHERE community=$2 AND user_id=$3", [keep, cid, target]);
      await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE community=$3 AND user_id=$4 AND kind='mute' AND lifted_at IS NULL", [at, actorId, cid, target]);
      await db.run("INSERT INTO community_sanctions(id,community,user_id,kind,reason,rule_id,actor,created_at) VALUES($1,$2,$3,'ban',$4,$5,$6,$7)", [id("sn"), cid, target, reason || null, rule, actorId, at]);
      await mevent(cid, target, "ban");
    } else if (action === "unban") {
      // the ban is lifted: the person may join again (the membership row goes, as before); the ban stays in the history
      const r = await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2 AND role='banned'", [cid, target]);
      if (r.changes) await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE community=$3 AND user_id=$4 AND kind='ban' AND lifted_at IS NULL", [at, actorId, cid, target]);
    } else if (action === "warn") {
      await db.run("UPDATE memberships SET warnings=warnings+1 WHERE community=$1 AND user_id=$2", [cid, target]);
      await db.run("INSERT INTO community_sanctions(id,community,user_id,kind,reason,rule_id,actor,created_at) VALUES($1,$2,$3,'warn',$4,$5,$6,$7)", [id("sn"), cid, target, reason || null, rule, actorId, at]);
    }
  }
  async function setRole(user, cid, target, newRole) {
    const me = await P.need(cid, user.id, "manage_roles");
    const cur = await role(cid, target); if (!cur) throw E.nf(); if (cur === "owner") throw E.forbid("لا يمكن تغيير دور المالك");
    newRole = oneOf(newRole, ["admin", "moderator", "member", "muted", "banned", "remove"], null); if (!newRole) throw E.bad();
    if (newRole === "admin" && me.role !== "owner") throw E.forbid("تعيين المديرين للمالك فقط");
    await P.needAct(cid, user.id, target); // strict hierarchy: an admin cannot demote, ban or remove another admin
    if (["admin", "moderator", "member"].includes(newRole) && !P.assignable(me.role).includes(newRole)) throw E.forbid("لا يمكنك منح رتبة تساوي رتبتك أو أعلى");
    if (cur === "pending" && ["member", "remove"].includes(newRole)) await ctx.services.cadmin?.decideRequestRow(cid, target, newRole === "member" ? "approved" : "rejected", user.id, null); // v2.57 history
    if (newRole === "remove") { await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2", [cid, target]); await db.run("DELETE FROM member_roles WHERE community=$1 AND user_id=$2", [cid, target]).catch(() => {}); await mevent(cid, target, cur === "pending" ? "reject" : "remove", { by: user.id }); }
    else if (newRole === "muted") await sanction(user.id, cid, target, "mute", { hours: 24 });
    else if (newRole === "banned") await sanction(user.id, cid, target, "ban");
    else {
      await db.run("UPDATE memberships SET role=$1, status='active', prev_role=NULL, muted_until=NULL WHERE community=$2 AND user_id=$3", [newRole, cid, target]);
      if (["muted", "banned"].includes(cur)) await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by=$2 WHERE community=$3 AND user_id=$4 AND lifted_at IS NULL AND kind IN ('mute','ban')", [now(), user.id, cid, target]);
      await mevent(cid, target, cur === "pending" ? "approve" : "role", { from: cur, to: newRole, by: user.id });
    }
    if (cur === "pending" && newRole === "member") bus.emit("COMMUNITY_JOINED", { community: cid, actor: target, approvedBy: user.id });
    await ctx.audit("ROLE_CHANGED", target, `${cid}:${newRole}`, user.id);
    if (cur !== "pending") await ctx.services.cmod.log(cid, user.id, { user: target, action: "role_changed", category: "members", diff: { role: { from: cur, to: newRole } } });
  }
  async function queueAction(user, cid, pid, action) {
    await P.need(cid, user.id, "queue_review");
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND community=$2 AND status='pending'", [pid, cid]); if (!p) throw E.nf();
    const status = { approve: "published", reject: "rejected", edit: "draft" }[action]; if (!status) throw E.bad();
    await db.run("UPDATE posts SET status=$1, created_at=$2 WHERE id=$3", [status, status === "published" ? now() : p.created_at, pid]);
    if (status === "published") { bus.emit("POST_APPROVED", { post: pid, author: p.author, actor: user.id }); bus.emit("POST_PUBLISHED", { post: p }); }
    await ctx.audit({ approve: "POST_APPROVED", reject: "POST_REJECTED", edit: "EDIT_REQUESTED" }[action], pid, null, user.id);
    ctx.cache.del("feed:");
  }
  async function invite(user, kind, refId, to) {
    if (!rl.hit("invite", user.id)) throw E.rate();
    if (!(await db.get("SELECT 1 x FROM users WHERE id=$1", [to]))) throw E.nf();
    if (kind === "community" && !(await can(refId, user.id, "invite"))) throw E.forbid();
    if (kind === "event" && !(await db.get("SELECT 1 x FROM events WHERE id=$1", [refId]))) throw E.nf();
    if (kind === "community" && !(await db.get("SELECT 1 x FROM community_member_invites WHERE community=$1 AND user_id=$2 AND status='pending'", [refId, to]).catch(() => null)))
      await db.run("INSERT INTO community_member_invites(id,community,user_id,invited_by,status,created_at) VALUES($1,$2,$3,$4,'pending',$5)", [id("ci"), refId, to, user.id, now()]).catch(() => {}); // v2.57: one record of every direct invitation
    bus.emit("INVITE_SENT", { kind, ref: refId, to, actor: user.id });
  }

  /* ---- member stats & reputation: aggregate once (GROUP BY), store per member, read a top-N index ---- */
  const scoreOf = (posts, reacts, joinedAt) => Math.round(posts * 5 + reacts * 2 + Math.min((Date.now() - new Date(joinedAt)) / DAY, 365) * 0.1);
  const statsAt = new Map(), inflight = new Map();
  async function refreshStats(cid) {
    if (inflight.has(cid)) return inflight.get(cid);
    const job = (async () => {
      const members = await db.all("SELECT user_id, joined_at FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid]);
      const posts = Object.fromEntries((await db.all("SELECT author, COUNT(*) AS n, MAX(created_at) AS last_at FROM posts WHERE community=$1 AND status='published' GROUP BY author", [cid])).map(r => [r.author, r]));
      const reacts = Object.fromEntries((await db.all("SELECT p.author, COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.target WHERE p.community=$1 GROUP BY p.author", [cid])).map(r => [r.author, Number(r.n)]));
      const at = now();
      for (let i = 0; i < members.length; i += 400) {
        const ch = members.slice(i, i + 400), args = [], vals = ch.map((m, j) => { const p = posts[m.user_id], n = Number(p?.n || 0), rc = reacts[m.user_id] || 0; args.push(cid, m.user_id, n, rc, p?.last_at || null, scoreOf(n, rc, m.joined_at), at); const b = j * 7; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`; });
        await db.run(`INSERT INTO community_member_stats(community,user_id,posts,reactions_received,last_active_at,score,updated_at) VALUES ${vals.join(",")} ON CONFLICT (community,user_id) DO UPDATE SET posts=excluded.posts, reactions_received=excluded.reactions_received, last_active_at=excluded.last_active_at, score=excluded.score, updated_at=excluded.updated_at`, args);
      }
      await db.run("DELETE FROM community_member_stats WHERE community=$1 AND updated_at < $2", [cid, at]); // people who left
      const since14 = new Date(Date.now() - 14 * DAY).toISOString();
      const p14 = Number((await db.get("SELECT COUNT(*) n FROM posts WHERE community=$1 AND status='published' AND created_at > $2", [cid, since14])).n);
      const last = Object.values(posts).reduce((a, p) => (p.last_at && (!a || p.last_at > a) ? p.last_at : a), null);
      await db.run("UPDATE communities SET member_count=$1, posts_14d=$2, last_activity_at=COALESCE($3, last_activity_at) WHERE id=$4", [members.length, p14, last, cid]);
      statsAt.set(cid, Date.now());
    })().finally(() => inflight.delete(cid));
    inflight.set(cid, job); return job;
  }
  /** fresh enough stats: first read computes them; afterwards a stale read refreshes in the background */
  async function ensureStats(cid) {
    const t = statsAt.get(cid);
    if (!t) { const has = await db.get("SELECT 1 x FROM community_member_stats WHERE community=$1 LIMIT 1", [cid]); if (!has) return refreshStats(cid); statsAt.set(cid, Date.now() - 9 * 60e3); return; }
    if (Date.now() - t > 10 * 60e3) refreshStats(cid).catch(() => {});
  }
  /* incremental: a published post / a reaction moves its author's counters right away (the reconcile stays the truth) */
  const bump = async (cid, uid, dPosts, dReacts, at) => {
    await db.run(`INSERT INTO community_member_stats(community,user_id,posts,reactions_received,last_active_at,score,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (community,user_id) DO UPDATE SET posts=community_member_stats.posts+$3, reactions_received=community_member_stats.reactions_received+$4, last_active_at=COALESCE($5, community_member_stats.last_active_at), score=community_member_stats.score+$6, updated_at=$7`, [cid, uid, dPosts, dReacts, at, dPosts * 5 + dReacts * 2, now()]);
  };
  bus.on("POST_PUBLISHED", async (e) => { const p = e.post; if (!p?.community || !p.author) return; if (!(await db.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2 AND role NOT IN ('pending','banned')", [p.community, p.author]))) return; await bump(p.community, p.author, 1, 0, p.created_at || now()); });
  bus.on("POST_REACTED", async (e) => { const p = await db.get("SELECT community, author FROM posts WHERE id=$1", [e.target]); if (!p?.community) return; if (!(await db.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2 AND role NOT IN ('pending','banned')", [p.community, p.author]))) return; await bump(p.community, p.author, 0, 1, null); });

  /* Reputation is contextual per community (spec: reputation engine) — same shape as before, read from member stats */
  async function reputation(cid, limit = 0) {
    await ensureStats(cid);
    const rows = await db.all(`SELECT s.user_id, s.score FROM community_member_stats s JOIN memberships m ON m.community=s.community AND m.user_id=s.user_id WHERE s.community=$1 AND m.role NOT IN ('pending','banned') ORDER BY s.score DESC, s.user_id${limit ? " LIMIT " + (+limit | 0) : ""}`, [cid]);
    return rows.map(r => ({ user: r.user_id, score: Number(r.score) }));
  }
  async function analytics(user, cid) {
    await P.need(cid, user.id, "view_analytics");
    const since = (d) => new Date(Date.now() - d * DAY).toISOString();
    const members = (await db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid])).n;
    const newMembers = (await db.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND joined_at > $2", [cid, since(7)])).n;
    const posts = await db.all("SELECT id, created_at, views FROM posts WHERE community=$1 AND status='published'", [cid]);
    const hours = Array(24).fill(0); posts.forEach(p => hours[new Date(p.created_at).getUTCHours()]++);
    const top = await db.all(`SELECT p.id, p.title, p.text, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) + (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) AS engagement FROM posts p WHERE p.community=$1 AND p.status='published' ORDER BY engagement DESC LIMIT 5`, [cid]);
    const engagement = top.reduce((a, x) => a + x.engagement, 0);
    return { members, newMembers7d: newMembers, posts: posts.length, views: posts.reduce((a, p) => a + p.views, 0), engagement, activeHoursUTC: hours, topPosts: top, reputation: await reputation(cid, 10) };
  }

  /* ---- server-paginated member list: GET /api/communities/:id/members?q=&role=&cursor=&limit= ---- */
  async function members(viewer, cid, qs = {}) {
    const c = await db.get("SELECT id, type FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf();
    if (!(await visibleTo(c, viewer?.id))) throw E.forbid("قائمة الأعضاء للأعضاء فقط");
    const staff = viewer ? await P.has(cid, viewer.id, "queue_review") : false;
    const limit = Math.max(1, Math.min(100, +qs.limit || 50)), where = ["m.community=$1"], args = [cid];
    const roleF = oneOf(qs.role, ["owner", "admin", "moderator", "member", "muted", "pending", "banned", "staff", "new"], null);
    if (roleF === "staff") where.push("m.role IN ('owner','admin','moderator')");
    else if (roleF === "new") { args.push(new Date(Date.now() - 14 * 864e5).toISOString()); where.push(`m.joined_at > $${args.length}`); } // v2.58: joined in the last 14 days
    else if (roleF && (staff || !["muted", "pending", "banned"].includes(roleF))) { args.push(roleF); where.push(`m.role=$${args.length}`); }
    if (!staff) where.push("m.role NOT IN ('pending','banned')"); // sanctions and requests are for moderators
    const q = String(qs.q || "").trim().toLowerCase().slice(0, 40);
    if (q) { args.push("%" + q.replace(/[\\%_]/g, (c) => "\\" + c) + "%"); where.push(`(LOWER(u.name) LIKE $${args.length} ESCAPE '\\' OR LOWER(u.handle) LIKE $${args.length} ESCAPE '\\')`); } // v2.58: «_» in a handle is matched literally, not dropped
    if (qs.cursor) { const [t, u] = String(qs.cursor).split("|"); args.push(t, u || ""); where.push(`(m.joined_at > $${args.length - 1} OR (m.joined_at = $${args.length - 1} AND m.user_id > $${args.length}))`); }
    const csv = qs.format === "csv" && viewer && await P.has(cid, viewer.id, "manage_roles"); // v2.57: owner/admins export the list
    const cap = csv ? 20000 : limit + 1;
    const rows = await db.all(`SELECT m.user_id, m.role, m.prev_role, m.joined_at, m.warnings, m.muted_until, m.invited_via, u.name, u.handle, u.avatar, u.color, u.verified FROM memberships m JOIN users u ON u.id=m.user_id WHERE ${where.join(" AND ")} ORDER BY m.joined_at, m.user_id LIMIT ${cap}`, args);
    if (csv) {
      const cell = ctx.services.cmod.csvCell;
      return { csv: "\uFEFF" + ["handle,name,role,joined_at,warnings,muted_until,invited_via", ...rows.map(r => [r.handle, r.name, ROLE_AR[r.role] || r.role, r.joined_at, r.warnings, r.muted_until, r.invited_via].map(cell).join(","))].join("\r\n") };
    }
    const more = rows.length > limit, page = rows.slice(0, limit), last = page[page.length - 1];
    const total = Number((await db.get(`SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')`, [cid])).n);
    const extra = staff && page.length ? await db.all(`SELECT user_id, role_id FROM member_roles WHERE community=$1 AND user_id IN (${page.map((_, i) => "$" + (i + 2)).join(",")})`, [cid, ...page.map(r => r.user_id)]) : [];
    return { total, next: more && last ? `${last.joined_at}|${last.user_id}` : null, members: page.map(r => {
      const shown = !staff && r.role === "muted" ? (r.prev_role || "member") : r.role; // a mute is between the member and the moderators
      return { user: { id: r.user_id, name: r.name, handle: r.handle, avatar: r.avatar, color: r.color, verified: r.verified }, role: shown, roleLabel: ROLE_AR[shown] || shown, joinedAt: r.joined_at, ...(staff ? { warnings: r.warnings, mutedUntil: r.muted_until, prevRole: r.prev_role, invitedVia: r.invited_via || null, roles: extra.filter(x => x.user_id === r.user_id).map(x => x.role_id) } : {}) };
    }) };
  }

  /* ---- custom roles (foundation; the editor arrives with the admin panel in v2.57) ---- */
  const roleClient = (r) => ({ id: r.id, name: r.name, color: r.color, icon: r.icon, position: r.position, perms: Array.isArray(r.perms) ? r.perms : [], system: !!r.is_system, mentionable: !!r.mentionable });
  async function listRoles(viewer, cid) {
    const c = await db.get("SELECT id, type FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf();
    if (!(await visibleTo(c, viewer?.id))) throw E.forbid();
    const counts = Object.fromEntries((await db.all("SELECT role_id, COUNT(*) n FROM member_roles WHERE community=$1 GROUP BY role_id", [cid])).map(r => [r.role_id, Number(r.n)]));
    const custom = (await db.all("SELECT * FROM community_roles WHERE community=$1 ORDER BY position DESC, created_at", [cid])).map(r => ({ ...roleClient(r), members: counts[r.id] || 0 }));
    return { base: ["owner", "admin", "moderator", "member"].map(k => ({ key: k, name: ROLE_AR[k], rank: CP.RANK[k], perms: CP.BASE[k] })), custom, groups: CP.GROUPS, ownerOnly: CP.OWNER_ONLY };
  }
  const parsePerms = (a) => [...new Set((Array.isArray(a) ? a : []).filter(k => CP.KEYS.includes(k) && !CP.OWNER_ONLY.includes(k)))];
  async function saveRole(user, cid, rid, b) {
    const me = await P.need(cid, user.id, "manage_roles");
    const mine = await P.keys(cid, user.id, me);
    const perms = parsePerms(b.perms).filter(k => mine.has(k)); // nobody hands out a permission they do not hold
    const HEXC = /^#[0-9a-f]{6}$/i;
    if (rid) {
      const r = await db.get("SELECT * FROM community_roles WHERE id=$1 AND community=$2", [rid, cid]); if (!r) throw E.nf();
      await db.run("UPDATE community_roles SET name=$1, color=$2, perms=$3, mentionable=$4, position=$5 WHERE id=$6", [b.name !== undefined ? str(b.name, 30, { required: true }) : r.name, b.color !== undefined ? (HEXC.test(b.color || "") ? b.color : null) : r.color, b.perms !== undefined ? perms : r.perms, b.mentionable !== undefined ? (b.mentionable ? 1 : 0) : r.mentionable, Number.isInteger(b.position) ? Math.max(0, Math.min(1000, b.position)) : r.position, rid]);
    } else {
      if (Number((await db.get("SELECT COUNT(*) n FROM community_roles WHERE community=$1", [cid])).n) >= 25) throw E.bad("الحد الأقصى 25 دوراً");
      rid = id("cr");
      const pos = Number((await db.get("SELECT COALESCE(MAX(position),0)+1 n FROM community_roles WHERE community=$1", [cid])).n);
      await db.run("INSERT INTO community_roles(id,community,name,color,icon,position,perms,is_system,mentionable,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,0,$8,$9)", [rid, cid, str(b.name, 30, { required: true }), HEXC.test(b.color || "") ? b.color : null, null, pos, perms, b.mentionable ? 1 : 0, now()]);
    }
    P.invalidate(cid);
    await ctx.services.cmod.log(cid, user.id, { action: "role_saved", category: "roles", reason: str(b.name, 30) || null, diff: { perms: { to: perms } } });
    return roleClient(await db.get("SELECT * FROM community_roles WHERE id=$1", [rid]));
  }
  async function deleteRole(user, cid, rid) {
    await P.need(cid, user.id, "manage_roles");
    const r = await db.get("SELECT * FROM community_roles WHERE id=$1 AND community=$2 AND is_system=0", [rid, cid]); if (!r) throw E.nf();
    await db.run("DELETE FROM member_roles WHERE role_id=$1", [rid]); await db.run("DELETE FROM community_roles WHERE id=$1", [rid]); P.invalidate(cid);
    await ctx.services.cmod.log(cid, user.id, { action: "role_deleted", category: "roles", reason: r.name });
  }
  async function grantRole(user, cid, target, rid, on) {
    await P.need(cid, user.id, "manage_roles");
    if (!(await db.get("SELECT 1 x FROM community_roles WHERE id=$1 AND community=$2", [rid, cid]))) throw E.nf();
    const t = await role(cid, target); if (!CP.ACTIVE(t)) throw E.nf("ليس عضواً");
    if (target !== user.id) await P.needAct(cid, user.id, target);
    if (on) await db.run("INSERT INTO member_roles(community,user_id,role_id,granted_by,granted_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [cid, target, rid, user.id, now()]);
    else await db.run("DELETE FROM member_roles WHERE community=$1 AND user_id=$2 AND role_id=$3", [cid, target, rid]);
    P.invalidate(cid);
    await ctx.services.cmod.log(cid, user.id, { user: target, action: on ? "role_granted" : "role_revoked", category: "roles" });
  }

  /* ---- Event Engine ---- */
  const evShape = (e, rs) => ({ id: e.id, name: e.name, desc: e.descr, startsAt: e.starts_at, place: e.place, organizer: e.organizer, community: e.community, color: e.color, status: e.status,
    going: rs.filter(r => r.kind === "going").map(r => r.user_id), interested: rs.filter(r => r.kind === "interested").map(r => r.user_id), reminders: rs.filter(r => r.kind === "reminder").map(r => r.user_id) });
  const evClient = async (e) => evShape(e, await db.all("SELECT user_id, kind FROM event_rsvps WHERE event_id=$1", [e.id]));
  /** many events, one RSVP query (no N+1) */
  async function evClients(rows) {
    if (!rows.length) return [];
    const ids = rows.map(e => e.id), rs = await db.all(`SELECT event_id, user_id, kind FROM event_rsvps WHERE event_id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids);
    const by = new Map(ids.map(i => [i, []])); for (const r of rs) by.get(r.event_id)?.push(r);
    return rows.map(e => evShape(e, by.get(e.id)));
  }
  /** drop events of private / invite-only communities unless the viewer is an active member there */
  async function visibleEvents(rows, uid) {
    const cids = [...new Set(rows.map(e => e.community).filter(Boolean))]; if (!cids.length) return rows;
    const types = Object.fromEntries((await db.all(`SELECT id, type FROM communities WHERE id IN (${cids.map((_, i) => "$" + (i + 1)).join(",")})`, cids)).map(c => [c.id, c.type]));
    const closed = cids.filter(c => types[c] && types[c] !== "public"); if (!closed.length) return rows;
    const mine = uid ? new Set((await db.all(`SELECT community FROM memberships WHERE user_id=$1 AND role NOT IN ('pending','banned') AND community IN (${closed.map((_, i) => "$" + (i + 2)).join(",")})`, [uid, ...closed])).map(m => m.community)) : new Set();
    return rows.filter(e => !e.community || types[e.community] === "public" || !types[e.community] || mine.has(e.community) || e.organizer === uid);
  }
  async function canSeeEvent(e, uid) { return (await visibleEvents([e], uid)).length === 1; }
  async function createEvent(user, b) {
    const startsAt = new Date(b.startsAt); if (isNaN(startsAt) || startsAt < new Date()) throw E.bad("موعد الحدث غير صالح");
    if (b.community && !(await can(b.community, user.id, "event"))) throw E.forbid();
    const e = { id: acceptId(b.id, "e"), name: str(b.name, 100, { required: true }), descr: str(b.desc, 2000) || "", place: str(b.place, 100) || "أونلاين" };
    await db.run("INSERT INTO events(id,name,descr,starts_at,place,organizer,community,color,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [e.id, e.name, e.descr, startsAt.toISOString(), e.place, user.id, b.community || null, GRAD.test(b.color || "") ? b.color : "linear-gradient(135deg,#9b51e0,#e0559b)", now()]);
    await db.run("INSERT INTO event_rsvps(event_id,user_id,kind,at) VALUES($1,$2,'going',$3)", [e.id, user.id, now()]);
    bus.emit("EVENT_CREATED", { event: e.id, actor: user.id });
    return evClient(await db.get("SELECT * FROM events WHERE id=$1", [e.id]));
  }
  async function rsvp(user, eid, kind, on) {
    const e = await db.get("SELECT * FROM events WHERE id=$1", [eid]); if (!e || !(await canSeeEvent(e, user.id))) throw E.nf();
    kind = oneOf(kind, ["going", "interested", "reminder"], null); if (!kind) throw E.bad();
    if (on) await db.run("INSERT INTO event_rsvps(event_id,user_id,kind,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [eid, user.id, kind, now()]);
    else await db.run("DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2 AND kind=$3", [eid, user.id, kind]);
  }
  async function remindDue() { // reminder 1 hour before (job)
    const soon = await db.all("SELECT e.id, r.user_id, e.organizer FROM events e JOIN event_rsvps r ON r.event_id=e.id AND r.kind='reminder' WHERE e.status='upcoming' AND e.starts_at <= $1 AND e.starts_at > $2", [new Date(Date.now() + 3600e3).toISOString(), now()]);
    for (const s of soon) { if (await db.get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='event' AND ref=$2", [s.user_id, s.id])) continue; bus.emit("EVENT_REMINDER", { user: s.user_id, event: s.id, actor: s.organizer }); }
    await db.run("UPDATE events SET status='past' WHERE status='upcoming' AND starts_at < $1", [new Date(Date.now() - 6 * 3600e3).toISOString()]);
  }
  /** communities a viewer may list: invite-only ones only for people who belong to them */
  async function listFor(uid, { limit = 200, before = null } = {}) {
    const args = [], where = [];
    if (before) { args.push(before); where.push(`c.created_at < $${args.length}`); }
    if (uid) { args.push(uid); where.push(`(c.type<>'invite' OR EXISTS (SELECT 1 FROM memberships m WHERE m.community=c.id AND m.user_id=$${args.length}))`); }
    else where.push("c.type<>'invite'");
    return db.all(`SELECT c.* FROM communities c WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC LIMIT ${Math.max(1, Math.min(200, +limit || 200))}`, args);
  }

  const r = ctx.router, A = ctx.requireUser;
  r.get("/api/communities", async (req) => { const lim = Math.max(1, Math.min(200, +req.query.limit || 200)); const rows = await listFor(req.user?.id, { limit: lim, before: req.query.before || null }); return { communities: rows.map(toClient), next: rows.length === lim ? rows[rows.length - 1].created_at : null }; });
  r.post("/api/communities", A(async (req) => ({ community: await create(req.user, req.body) })));
  r.patch("/api/communities/:id", A(async (req) => ({ community: await update(req.user, req.params.id, req.body) })));
  r.put("/api/communities/:id/membership", A(async (req) => join(req.user, req.params.id)));
  r.del("/api/communities/:id/membership", A(async (req) => (await leave(req.user, req.params.id), { ok: true })));
  r.get("/api/communities/:id/members", async (req, res) => {
    const out = await members(req.user, req.params.id, req.query);
    if (out.csv === undefined) return out;
    res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="members-${req.params.id}.csv"`, "Cache-Control": "no-store" }); res.end(out.csv);
    return ctx.STREAM;
  });
  r.patch("/api/communities/:id/members/:user", A(async (req) => (await setRole(req.user, req.params.id, req.params.user, req.body.role), { ok: true })));
  r.get("/api/communities/:id/roles", async (req) => listRoles(req.user, req.params.id));
  r.post("/api/communities/:id/roles", A(async (req) => ({ role: await saveRole(req.user, req.params.id, null, req.body) })));
  r.patch("/api/communities/:id/roles/:role", A(async (req) => ({ role: await saveRole(req.user, req.params.id, req.params.role, req.body) })));
  r.del("/api/communities/:id/roles/:role", A(async (req) => (await deleteRole(req.user, req.params.id, req.params.role), { ok: true })));
  r.put("/api/communities/:id/members/:user/roles/:role", A(async (req) => (await grantRole(req.user, req.params.id, req.params.user, req.params.role, true), { ok: true })));
  r.del("/api/communities/:id/members/:user/roles/:role", A(async (req) => (await grantRole(req.user, req.params.id, req.params.user, req.params.role, false), { ok: true })));
  r.post("/api/communities/:id/queue/:post", A(async (req) => (await queueAction(req.user, req.params.id, req.params.post, req.body.action), { ok: true })));
  r.get("/api/communities/:id/analytics", A(async (req) => analytics(req.user, req.params.id)));
  r.get("/api/communities/:id/reputation", async (req) => { const c = await db.get("SELECT id, type FROM communities WHERE id=$1", [req.params.id]); if (!c) throw E.nf(); if (!(await visibleTo(c, req.user?.id))) throw E.forbid(); return { reputation: await reputation(req.params.id) }; });
  r.post("/api/invites", A(async (req) => (await invite(req.user, oneOf(req.body.kind, ["community", "event"], "community"), req.body.ref, req.body.to), { ok: true })));
  r.get("/api/events", async (req) => ({ events: await evClients(await visibleEvents(await db.all("SELECT * FROM events WHERE status='upcoming' ORDER BY starts_at LIMIT 100"), req.user?.id)) }));
  r.post("/api/events", A(async (req) => ({ event: await createEvent(req.user, req.body) })));
  r.put("/api/events/:id/rsvp/:kind", A(async (req) => (await rsvp(req.user, req.params.id, req.params.kind, true), { ok: true })));
  r.del("/api/events/:id/rsvp/:kind", A(async (req) => (await rsvp(req.user, req.params.id, req.params.kind, false), { ok: true })));
  ctx.scheduler.every("communityStats", 30 * 60e3, async () => { for (const cid of [...statsAt.keys()]) await refreshStats(cid).catch(() => {}); }); // only communities opened recently
  return { toClient, evClient, evClients, visibleEvents, canSeeEvent, visibleTo, role, can, remindDue, PERMS, join, reputation, refreshStats, ensureStats, setRole, sanction, queueAction, createEvent, rsvp, create, members, listFor, mevent };
};
