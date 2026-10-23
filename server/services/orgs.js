/* Organisations (Phase 9): organisation accounts with a team (owner, admin, editor), invitations,
 * delegated posting without shared passwords (X-Act-As), and a team activity log.
 *   owner  — everything, incl. transferring/removing admins
 *   admin  — manage members & invites, edit the org profile, post
 *   editor — post, comment, react and upload as the organisation */
const { E, str, id, now } = require("../lib/core");
const ROLES = ["owner", "admin", "editor"], RANK = { owner: 3, admin: 2, editor: 1 };
const HANDLE = /^[a-zA-Z0-9_]{3,24}$/;
const EDITOR_PATHS = [/^\/api\/posts/, /^\/api\/comments/, /^\/api\/reactions/, /^\/api\/media/, /^\/api\/polls/, /^\/api\/bootstrap/, /^\/api\/feed/, /^\/api\/profiles/, /^\/api\/notifications/, /^\/api\/search/, /^\/api\/trends/, /^\/api\/flags/, /^\/api\/orgs/];
const NEVER_AS_ORG = [/^\/api\/security/, /^\/api\/auth/, /^\/api\/me\/export/, /^\/api\/privacy/, /^\/api\/admin/, /^\/api\/verification/];

module.exports = (ctx) => {
  const { db, router: R, rl } = ctx; const A = ctx.requireUser; const users = () => ctx.services.users;
  const roleIn = async (org, uid) => (await db.get("SELECT role FROM org_members WHERE org=$1 AND user_id=$2", [org, uid]))?.role;
  const need = async (org, uid, min) => { const r = await roleIn(org, uid); if (!r || RANK[r] < RANK[min]) throw E.forbid(); return r; };
  const log = (org, actor, action, target) => db.run("INSERT INTO team_activity(org,actor,action,target,at) VALUES($1,$2,$3,$4,$5)", [org, actor, action, target || null, now()]);
  const me = (req) => req.actor || req.user; // the human, even while acting as an org

  /* Resolve delegation for a request; called by the server after authentication. */
  async function applyActAs(req) {
    const orgId = req.headers["x-act-as"]; if (!orgId || !req.user) return;
    const path = req.url.split("?")[0];
    if (NEVER_AS_ORG.some(r => r.test(path))) return; // these always run as the person
    const role = await roleIn(orgId, req.user.id); if (!role) throw E.forbid("لست عضواً في فريق هذه المؤسسة");
    if (role === "editor" && req.method !== "GET" && !EDITOR_PATHS.some(r => r.test(path))) throw E.forbid("صلاحية المحرر لا تسمح بهذا الإجراء");
    const org = await db.get("SELECT * FROM users WHERE id=$1 AND account_type='org' AND status='active'", [orgId]); if (!org) throw E.nf();
    req.actor = req.user; req.actorRole = role; req.user = org;
  }
  async function afterAction(req) {
    if (!req.actor || req.method === "GET") return;
    const path = req.url.split("?")[0].replace(/\/[a-z]{1,3}_[a-z0-9]{6,}/gi, "/:id");
    await log(req.user.id, req.actor.id, `${req.method} ${path}`, null);
  }

  R.post("/api/orgs", A(async (req) => {
    if (req.actor) throw E.forbid();
    if (!rl.hit("community", "org:" + req.user.id)) throw E.rate();
    const name = str(req.body.name, 60, { required: true, min: 2 }), handle = str(req.body.handle, 24, { required: true });
    if (!HANDLE.test(handle)) throw E.bad("اسم المستخدم: حروف إنجليزية وأرقام و _ فقط (٣-٢٤)");
    if (await db.get("SELECT 1 x FROM users WHERE LOWER(handle)=LOWER($1)", [handle])) throw E.conflict("اسم المستخدم محجوز");
    const oid = id("u"), at = now();
    await db.tx(async t => {
      await t.run("INSERT INTO users(id,handle,name,bio,color,role,account_type,prefs,created_at) VALUES($1,$2,$3,$4,$5,'user','org',$6,$7)", [oid, handle, name, str(req.body.bio, 300) || "", "#1f2a44", { onboarded: true, interests: [] }, at]);
      await t.run("INSERT INTO org_members(org,user_id,role,added_at) VALUES($1,$2,'owner',$3)", [oid, req.user.id, at]);
    });
    await log(oid, req.user.id, "org_created", null);
    return { org: users().pub(await db.get("SELECT * FROM users WHERE id=$1", [oid])) };
  }));
  R.get("/api/orgs", A(async (req) => ({ orgs: (await db.all("SELECT o.*, m.role AS my_role FROM org_members m JOIN users o ON o.id=m.org WHERE m.user_id=$1 ORDER BY m.added_at", [me(req).id])).map(o => ({ ...users().pub(o), myRole: o.my_role })) })));
  R.get("/api/orgs/:id", A(async (req) => {
    const role = await need(req.params.id, me(req).id, "editor");
    const org = await db.get("SELECT * FROM users WHERE id=$1", [req.params.id]);
    const members = await db.all("SELECT u.id, u.name, u.handle, u.avatar, u.color, m.role, m.added_at FROM org_members m JOIN users u ON u.id=m.user_id WHERE m.org=$1 ORDER BY m.added_at", [org.id]);
    const invites = RANK[role] >= 2 ? await db.all("SELECT i.id, i.role, i.created_at, u.name, u.handle FROM org_invites i JOIN users u ON u.id=i.user_id WHERE i.org=$1 AND i.status='pending'", [org.id]) : [];
    const activity = await db.all("SELECT a.action, a.target, a.at, u.name, u.handle FROM team_activity a JOIN users u ON u.id=a.actor WHERE a.org=$1 ORDER BY a.id DESC LIMIT 50", [org.id]);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const stats = { followers: (await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [org.id])).n, posts30: (await db.get("SELECT COUNT(*) n FROM posts WHERE author=$1 AND created_at > $2 AND status='published'", [org.id, since])).n,
      reactions30: (await db.get("SELECT COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND r.at > $2", [org.id, since])).n, views30: (await db.get("SELECT COALESCE(SUM(views),0) n FROM posts WHERE author=$1 AND created_at > $2", [org.id, since])).n };
    return { org: users().pub(org), myRole: role, members: members.map(m => ({ ...m })), invites, activity, stats };
  }));
  R.post("/api/orgs/:id/invites", A(async (req) => {
    await need(req.params.id, me(req).id, "admin");
    const role = ROLES.includes(req.body.role) && req.body.role !== "owner" ? req.body.role : "editor";
    const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1) AND account_type='person'", [String(req.body.handle || "")]); if (!u) throw E.nf("المستخدم غير موجود");
    if (await roleIn(req.params.id, u.id)) throw E.conflict("عضو في الفريق بالفعل");
    const iid = id("iv"); await db.run("INSERT INTO org_invites(id,org,user_id,role,by_user,created_at) VALUES($1,$2,$3,$4,$5,$6)", [iid, req.params.id, u.id, role, me(req).id, now()]);
    await ctx.services.messaging.notify(u.id, "org_invite", { actor: req.params.id, ref: iid });
    await log(req.params.id, me(req).id, "invite_sent", u.id);
    return { invite: { id: iid, role } };
  }));
  R.get("/api/org-invites", A(async (req) => ({ invites: await db.all("SELECT i.id, i.role, i.created_at, o.id AS org, o.name, o.handle, o.avatar FROM org_invites i JOIN users o ON o.id=i.org WHERE i.user_id=$1 AND i.status='pending'", [me(req).id]) })));
  R.post("/api/org-invites/:id/:decision", A(async (req) => {
    const inv = await db.get("SELECT * FROM org_invites WHERE id=$1 AND user_id=$2 AND status='pending'", [req.params.id, me(req).id]); if (!inv) throw E.nf();
    const accept = req.params.decision === "accept";
    await db.run("UPDATE org_invites SET status=$1 WHERE id=$2", [accept ? "accepted" : "declined", inv.id]);
    if (accept) { await db.run("INSERT INTO org_members(org,user_id,role,added_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [inv.org, inv.user_id, inv.role, now()]); await log(inv.org, inv.user_id, "joined_team", inv.role); }
    return { ok: true };
  }));
  R.put("/api/orgs/:id/members/:uid", A(async (req) => {
    const myRole = await need(req.params.id, me(req).id, "admin"); const target = await roleIn(req.params.id, req.params.uid); if (!target) throw E.nf();
    const role = req.body.role; if (!ROLES.includes(role)) throw E.bad();
    if (role === "owner" || target === "owner") { if (myRole !== "owner") throw E.forbid("نقل الملكية للمالك فقط"); }
    if (RANK[target] >= RANK[myRole] && myRole !== "owner") throw E.forbid();
    if (role === "owner") await db.run("UPDATE org_members SET role='admin' WHERE org=$1 AND user_id=$2", [req.params.id, me(req).id]); // ownership transfer
    await db.run("UPDATE org_members SET role=$1 WHERE org=$2 AND user_id=$3", [role, req.params.id, req.params.uid]);
    await log(req.params.id, me(req).id, "role_changed", `${req.params.uid}:${role}`); return { ok: true };
  }));
  R.del("/api/orgs/:id/members/:uid", A(async (req) => {
    const self = req.params.uid === me(req).id; const myRole = await need(req.params.id, me(req).id, self ? "editor" : "admin");
    const target = await roleIn(req.params.id, req.params.uid); if (!target) throw E.nf();
    if (target === "owner") throw E.forbid("انقل الملكية أولاً");
    if (!self && RANK[target] >= RANK[myRole]) throw E.forbid();
    await db.run("DELETE FROM org_members WHERE org=$1 AND user_id=$2", [req.params.id, req.params.uid]);
    await log(req.params.id, me(req).id, self ? "left_team" : "member_removed", req.params.uid); return { ok: true };
  }));
  return { applyActAs, afterAction, roleIn };
};
