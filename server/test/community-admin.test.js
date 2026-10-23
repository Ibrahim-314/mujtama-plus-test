/* v2.57.0 «المجتمع 3.0» stage 2 — the admin panel API: overview + permission lock, join-request history and bulk
 * decisions, invite options (role on join, skip approval, revoke), direct member invitations (invite-only reads them
 * first), ownership transfer with the recipient's acceptance, archive/restore (read-only), lockdown, export, member CSV
 * (formula-safe), and migration 063 (reversible, additive). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, AD, MO, U, X, Y, cid, pc, ic;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; c.handle = handle; return c; };
const db = () => H.app.ctx.db;
test.before(async () => {
  H = await boot();
  [O, AD, MO, U, X, Y] = [await mk("ca_own"), await mk("ca_adm"), await mk("ca_mod"), await mk("ca_usr"), await mk("ca_out"), await mk("ca_y")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع لوحة الإدارة", desc: "اختبار اللوحة", rules: ["الاحترام"] })).community.id;
  for (const c of [AD, MO, U]) await c.req("PUT", `/api/communities/${cid}/membership`);
  await O.req("PATCH", `/api/communities/${cid}/members/${AD.id}`, { role: "admin" });
  await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" });
  H.app.ctx.rl.w?.clear?.();
  pc = (await O.req("POST", "/api/communities", { name: "نادي اللوحة الخاص", type: "private" })).community.id;
  H.app.ctx.rl.w?.clear?.();
  ic = (await O.req("POST", "/api/communities", { name: "دائرة اللوحة بالدعوة", type: "invite" })).community.id;
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());

test("overview: staff only; keys and counts; moderators get their keys (no owner keys)", async () => {
  const o = await O.req("GET", `/api/communities/${cid}/admin`); assert.equal(o.status, 200);
  assert.equal(o.role, "owner"); assert.ok(o.keys.includes("edit_settings")); assert.ok(o.counts.members >= 4); assert.ok(Array.isArray(o.setup) && o.setup.length >= 6);
  const m = await MO.req("GET", `/api/communities/${cid}/admin`); assert.equal(m.status, 200); assert.ok(!m.keys.includes("edit_identity") && !m.keys.includes("manage_roles"));
  assert.equal((await U.req("GET", `/api/communities/${cid}/admin`)).status, 403, "a member is refused");
  assert.equal((await X.req("GET", `/api/communities/${cid}/admin`)).status, 403, "an outsider is refused");
  const managed = await MO.req("GET", "/api/me/communities/managed"); assert.ok(managed.communities.some(c => c.id === cid && c.role === "moderator"));
  assert.ok(!(await U.req("GET", "/api/me/communities/managed")).communities.some(c => c.id === cid));
});

test("join requests: kept as history after a bulk decision (who, when, why); a cancelled request too", async () => {
  await X.req("POST", `/api/communities/${pc}/join`, {}); await Y.req("POST", `/api/communities/${pc}/join`, {});
  const row = await db().get("SELECT status, source FROM join_requests WHERE community=$1 AND user_id=$2", [pc, X.id]); assert.equal(row.status, "pending"); assert.equal(row.source, "direct");
  const r = await O.req("POST", `/api/communities/${pc}/requests/decide`, { users: [X.id, Y.id], action: "reject", reason: "غير مناسب" }); assert.equal(r.done, 2);
  const h = await O.req("GET", `/api/communities/${pc}/requests/history`); assert.equal(h.history.length, 2); assert.ok(h.history.every(x => x.status === "rejected" && x.reason === "غير مناسب" && x.decidedBy));
  assert.equal((await U.req("GET", `/api/communities/${pc}/requests/history`)).status, 403);
  // a new request → pending again; the requester cancels → cancelled
  await X.req("POST", `/api/communities/${pc}/join`, {}); await X.req("DELETE", `/api/communities/${pc}/membership`);
  assert.equal((await db().get("SELECT status FROM join_requests WHERE community=$1 AND user_id=$2", [pc, X.id])).status, "cancelled");
  // approve through the classic queue keeps the row too
  await Y.req("POST", `/api/communities/${pc}/join`, {});
  await O.req("POST", `/api/communities/${pc}/modqueue/act`, { kind: "join", id: Y.id, action: "approve" });
  assert.equal((await db().get("SELECT status FROM join_requests WHERE community=$1 AND user_id=$2", [pc, Y.id])).status, "approved");
});

test("invite links: role on join (owner/admins only), skip approval for a private community, revoke", async () => {
  assert.equal((await MO.req("POST", `/api/communities/${pc}/invites`, { grantRole: "moderator" })).status, 403, "a moderator cannot hand out a moderator role");
  const skip = (await O.req("POST", `/api/communities/${pc}/invites`, { label: "مباشر", skipApproval: true })).invite; assert.equal(skip.skipApproval, true);
  const Z = await mk("ca_z"); const j = await Z.req("POST", `/api/communities/${pc}/join`, { invite: skip.code }); assert.equal(j.role, "member", "skip approval admits directly");
  const modLink = (await O.req("POST", `/api/communities/${cid}/invites`, { grantRole: "moderator" })).invite; assert.equal(modLink.grantRole, "moderator");
  const W = await mk("ca_w"); assert.equal((await W.req("POST", `/api/communities/${cid}/join`, { invite: modLink.code })).role, "member", "public join stays member unless the link admits");
  const inv = (await O.req("GET", `/api/communities/${pc}/invites`)).invites.find(i => i.code === skip.code); assert.equal(inv.uses, 1); assert.equal(inv.revokedAt, null);
  assert.equal((await O.req("DELETE", `/api/communities/${pc}/invites/${skip.code}`)).status, 200);
  assert.equal((await new H.Client().req("GET", `/api/invites/${skip.code}`)).status, 400, "a revoked link no longer opens");
  const V = await mk("ca_v"); assert.equal((await V.req("POST", `/api/communities/${pc}/join`, { invite: skip.code })).role, "pending", "a revoked link no longer admits");
  assert.ok((await O.req("GET", `/api/communities/${pc}/invites`)).invites.find(i => i.code === skip.code).revokedAt, "kept with its stats");
});

test("direct member invitations: invite-only reads them first; decline; already-members refused", async () => {
  const P = await mk("ca_p");
  assert.equal((await P.req("PUT", `/api/communities/${ic}/membership`)).status, 403, "not invited yet");
  const r = await O.req("POST", `/api/communities/${ic}/member-invites`, { handle: "@ca_p" }); assert.equal(r.status, 200); assert.equal(r.invite.user.handle, "ca_p");
  assert.ok((await P.req("GET", "/api/me/community-invites")).invites.some(i => i.community.id === ic));
  assert.equal((await P.req("PUT", `/api/communities/${ic}/membership`)).role, "member");
  assert.equal((await db().get("SELECT status FROM community_member_invites WHERE id=$1", [r.invite.id])).status, "accepted");
  assert.equal((await O.req("POST", `/api/communities/${ic}/member-invites`, { user: P.id })).status, 409, "already a member");
  const Q = await mk("ca_q"); const q = await O.req("POST", `/api/communities/${ic}/member-invites`, { user: Q.id });
  await Q.req("POST", `/api/community-invites/${q.invite.id}/decline`);
  assert.equal((await Q.req("PUT", `/api/communities/${ic}/membership`)).status, 403, "a declined invite does not admit");
  assert.ok((await O.req("GET", `/api/communities/${ic}/member-invites`)).invites.some(i => i.status === "declined"));
});

test("ownership transfer: owner only, typed name, recipient must be an admin and must accept; previous owner becomes admin", async () => {
  assert.equal((await AD.req("POST", `/api/communities/${cid}/transfer`, { to: AD.id, confirm: "مجتمع لوحة الإدارة" })).status, 403, "an admin cannot start it");
  assert.equal((await O.req("POST", `/api/communities/${cid}/transfer`, { to: AD.id, confirm: "اسم خاطئ" })).status, 400, "the typed name must match");
  assert.equal((await O.req("POST", `/api/communities/${cid}/transfer`, { to: U.id, confirm: "مجتمع لوحة الإدارة" })).status, 400, "only to an admin");
  const t = (await O.req("POST", `/api/communities/${cid}/transfer`, { to: AD.id, confirm: "مجتمع لوحة الإدارة" })).transfer; assert.equal(t.status, "pending"); assert.equal(t.to.id, AD.id);
  assert.equal((await O.req("POST", `/api/communities/${cid}/transfer`, { to: AD.id, confirm: "مجتمع لوحة الإدارة" })).status, 409, "one pending transfer at a time");
  assert.equal((await MO.req("POST", `/api/community-transfers/${t.id}/accept`)).status, 404, "nobody else can accept it");
  assert.ok((await AD.req("GET", `/api/communities/${cid}/admin`)).incomingTransfer, "the recipient sees it in the panel");
  const n = await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='community_transfer' AND ref=$2", [AD.id, cid]); assert.ok(n, "the recipient is notified");
  assert.equal((await AD.req("POST", `/api/community-transfers/${t.id}/accept`)).status, "accepted");
  const c = await db().get("SELECT owner FROM communities WHERE id=$1", [cid]); assert.equal(c.owner, AD.id);
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, AD.id])).role, "owner");
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, O.id])).role, "admin");
  assert.equal((await AD.req("POST", `/api/community-transfers/${t.id}/accept`)).status, 400, "cannot be accepted twice");
  // back to the original owner (decline path + cancel path)
  const t2 = (await AD.req("POST", `/api/communities/${cid}/transfer`, { to: O.id, confirm: "مجتمع لوحة الإدارة" })).transfer;
  assert.equal((await O.req("POST", `/api/community-transfers/${t2.id}/decline`)).status, "declined");
  const t3 = (await AD.req("POST", `/api/communities/${cid}/transfer`, { to: O.id, confirm: "مجتمع لوحة الإدارة" })).transfer;
  await AD.req("DELETE", `/api/communities/${cid}/transfer`);
  assert.equal((await O.req("POST", `/api/community-transfers/${t3.id}/accept`)).status, 400, "a cancelled request cannot be accepted");
  const t4 = (await AD.req("POST", `/api/communities/${cid}/transfer`, { to: O.id, confirm: "مجتمع لوحة الإدارة" })).transfer;
  assert.equal((await O.req("POST", `/api/community-transfers/${t4.id}/accept`)).status, "accepted");
  assert.equal((await db().get("SELECT owner FROM communities WHERE id=$1", [cid])).owner, O.id);
  const log = (await O.req("GET", `/api/communities/${cid}/modlog`)).log.map(l => l.action); assert.ok(log.includes("transfer_accepted") && log.includes("transfer_declined"));
});

test("archive: read-only (no posts, comments or joins), visible to everyone, restorable; owner only", async () => {
  const p = (await U.req("POST", "/api/posts", { text: "منشور قبل الأرشفة في المجتمع", community: cid })).post; assert.ok(p);
  assert.equal((await AD.req("POST", `/api/communities/${cid}/archive`, { confirm: "مجتمع لوحة الإدارة" })).status, 403);
  assert.equal((await O.req("POST", `/api/communities/${cid}/archive`, { confirm: "لا" })).status, 400);
  assert.ok((await O.req("POST", `/api/communities/${cid}/archive`, { confirm: "مجتمع لوحة الإدارة" })).archivedAt);
  assert.equal((await U.req("POST", "/api/posts", { text: "محاولة نشر في مجتمع مؤرشف", community: cid })).status, 403);
  assert.equal((await U.req("POST", "/api/comments", { post: p.id, text: "تعليق" })).status, 403);
  const N = await mk("ca_n"); assert.equal((await N.req("PUT", `/api/communities/${cid}/membership`)).status, 403);
  assert.ok((await N.req("GET", `/api/communities/${cid}/space`)).community.archivedAt, "the page shows it as archived");
  assert.equal((await O.req("POST", `/api/communities/${cid}/restore`)).archivedAt, null);
  assert.ok((await U.req("POST", "/api/posts", { text: "النشر يعود بعد الاستعادة", community: cid })).post);
});

test("lockdown: members cannot post, moderators can; lifting restores posting", async () => {
  assert.equal((await MO.req("POST", `/api/communities/${cid}/lockdown`, { hours: 2 })).status, 403, "moderators cannot lock");
  const l = await AD.req("POST", `/api/communities/${cid}/lockdown`, { hours: 2 }); assert.ok(l.lockdownUntil);
  assert.equal((await U.req("POST", "/api/posts", { text: "منشور أثناء الإيقاف المؤقت", community: cid })).status, 403);
  assert.ok((await MO.req("POST", "/api/posts", { text: "إعلان المشرف أثناء الإيقاف", community: cid })).post);
  assert.ok((await new H.Client().req("GET", "/api/communities")).communities.find(c => c.id === cid).lockdownUntil, "public so the editor can say why");
  assert.equal((await AD.req("POST", `/api/communities/${cid}/lockdown`, { hours: 0 })).lockdownUntil, null);
  assert.ok((await U.req("POST", "/api/posts", { text: "النشر بعد رفع الإيقاف المؤقت", community: cid })).post);
});

test("export (owner only) and members CSV (owner/admins, formula-safe)", async () => {
  const r = await fetch(H.base + `/api/communities/${cid}/export`, { headers: { Cookie: O.cookie, "X-Requested-With": "mujtama" } }); assert.equal(r.status, 200);
  const j = await r.json(); assert.equal(j.community.id, cid); assert.ok(j.members.length >= 4 && Array.isArray(j.posts) && Array.isArray(j.log));
  assert.equal((await AD.req("GET", `/api/communities/${cid}/export`)).status, 403);
  await db().run("UPDATE users SET name='=HYPERLINK(1)' WHERE id=$1", [U.id]);
  const csv = await (await fetch(H.base + `/api/communities/${cid}/members?format=csv`, { headers: { Cookie: AD.cookie, "X-Requested-With": "mujtama" } })).text();
  assert.match(csv, /"'=HYPERLINK\(1\)"/, "formula cells are neutralised"); assert.match(csv, /^\uFEFF?handle,name,role/);
  const asMod = await MO.req("GET", `/api/communities/${cid}/members?format=csv`); assert.ok(Array.isArray(asMod.members), "moderators get JSON, not the export");
});

test("roles: position + member counts; staff member rows carry custom roles", async () => {
  const r = (await O.req("POST", `/api/communities/${cid}/roles`, { name: "مُرحِّب", color: "#16a34a", perms: ["approve_requests", "invite"] })).role;
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/roles/${r.id}`, { position: 7 })).role.position, 7);
  await O.req("PUT", `/api/communities/${cid}/members/${U.id}/roles/${r.id}`);
  const list = await O.req("GET", `/api/communities/${cid}/roles`); assert.equal(list.custom.find(x => x.id === r.id).members, 1);
  const mem = await O.req("GET", `/api/communities/${cid}/members?q=hyperlink`); assert.deepEqual(mem.members[0].roles, [r.id]);
});

test("migration 063: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '063_membership' ORDER BY id")).map(r => r.id);
  const n = Number((await db().get("SELECT COUNT(*) n FROM join_requests")).n), inv = Number((await db().get("SELECT COUNT(*) n FROM community_invites")).n);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "063_membership"]);
  await assert.rejects(() => db().get("SELECT 1 FROM community_transfers"));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM join_requests")).n), n, "no request row lost");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM community_invites")).n), inv, "no invite lost");
  assert.deepEqual(await mig.up(db()), ["063_membership", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("063")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "063_membership.js"));
});
