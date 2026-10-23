/* Teams & group projects «الفرق والمشاريع» (phase 79).
 *  1. A member creates a team or a project (name, about, private or listed in the public directory). Roles: owner (one,
 *     transferable), admin (invites, removes members, edits), member (tasks, files, updates), viewer (reads, replies).
 *     Owners complete / archive / reopen; staff can archive any team.
 *  2. Joining: a direct invite to a member (accept / decline), an invite link (code, expiry 1–30 days, use cap), or a join
 *     request on a listed team that an owner / admin accepts. WT_MAX_MEMBERS (50), WT_MAX_OWNED (20).
 *  3. Task board: to do → doing → review → done, assignee (a member), due date, priority, order within a column, optional
 *     link to a milestone of the linked contract. Assignees are notified.
 *  4. Files & links: http(s) links or uploaded images (the existing media upload), with a note.
 *  5. Updates & discussion: updates / questions with replies; updates notify members, replies notify the author; risky
 *     text (fees, off-platform payment, wallet passphrase) carries a warning for readers.
 *  6. Contracts (phase 78): a team can be linked to a contract its owner is party to; the team shows the contract and its
 *     milestones, the contract page links back for members, and tasks can point at a milestone. A team linked to a paid
 *     contract does not take minors.
 *  7. Minors (phase 35): may join private teams by invite; cannot create listed teams, use invite links to listed teams,
 *     or join teams linked to paid contracts. */
const { E, str, oneOf, id, token } = require("../lib/core");
const { normalize } = require("../lib/arabic");

const KIND = { team: "فريق", project: "مشروع" };
const ROLES = { owner: "المالك", admin: "مشرف", member: "عضو", viewer: "مشاهد" };
const RANK = { owner: 4, admin: 3, member: 2, viewer: 1 };
const STATUS = { active: "نشط", completed: "مكتمل", archived: "مؤرشف" };
const COLS = { todo: "للتنفيذ", doing: "قيد العمل", review: "للمراجعة", done: "منجزة" };
const PRIO = { low: "منخفضة", normal: "عادية", high: "عالية" };
const VIS = { private: "خاص (بالدعوة فقط)", listed: "ظاهر في دليل المشاريع" };

/** @param {any} ctx @param {{ now?: () => number, env?: Record<string,string|undefined> }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const env = opts.env || process.env;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const today = () => iso().slice(0, 10);
  const isoOf = (v) => (v ? new Date(v).toISOString() : null);
  const MAX_MEMBERS = +(env.WT_MAX_MEMBERS || 50), MAX_OWNED = +(env.WT_MAX_OWNED || 20);
  const notify = async (uid, kind, ref, actor = null) => { if (!uid || uid === actor) return; try { await ctx.services.notify?.notify(uid, kind, { ref, actor }); } catch { /* best effort */ } };
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const fail = (status, code, msg) => Object.assign(status === 403 ? E.forbid(msg) : status === 409 ? E.conflict(msg) : status === 404 ? E.nf(msg) : E.bad(msg), { code });
  const parse = (v, d) => { try { return v ? (typeof v === "string" ? JSON.parse(v) : v) : d; } catch { return d; } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const risky = (text) => { try { return (ctx.services.jobs?.risks?.(text) || []).some((r) => ["fee", "offplatform", "phrase", "income"].includes(r.key)); } catch { return false; } };
  const url = (v) => { let u; try { u = new URL(String(v || "").trim()); } catch { throw fail(400, "bad_link", "رابط غير صالح"); } if (!["https:", "http:"].includes(u.protocol)) throw fail(400, "bad_link", "رابط غير صالح"); return u.toString().slice(0, 600); };

  async function blockedBetween(a, b) {
    if (!a || !b || a === b) return false;
    const ua = await db.get("SELECT prefs FROM users WHERE id=$1", [a]), ub = await db.get("SELECT prefs FROM users WHERE id=$1", [b]);
    const pa = parse(ua?.prefs, {}), pb = parse(ub?.prefs, {});
    if ((pa.blocked || []).includes(b) || (pb.blocked || []).includes(a)) return true;
    return !!(await db.get("SELECT 1 x FROM user_blocks WHERE (owner=$1 AND target=$2) OR (owner=$2 AND target=$1) LIMIT 1", [a, b]).catch(() => null));
  }
  async function usersOf(ids) { const a = [...new Set(ids.filter(Boolean))]; const m = new Map(); if (!a.length) return m; for (const u of await db.all(`SELECT id, name, handle, color, avatar, verified FROM users WHERE id IN (${ph(a)})`, a)) m.set(u.id, u); return m; }
  const pubU = (u) => (u ? { id: u.id, name: u.name, handle: u.handle, color: u.color || null, avatar: u.avatar || null, verified: u.verified || null } : null);
  const teamRow = (tid) => db.get("SELECT * FROM wt_teams WHERE id=$1", [String(tid)]);
  const memberOf = (tid, uid) => (uid ? db.get("SELECT * FROM wt_members WHERE team_id=$1 AND user_id=$2", [tid, uid]) : null);
  const count = async (sql, a) => Number((await db.get(sql, a))?.n || 0);
  async function paidContract(t) { if (!t?.contract_id) return false; const c = await db.get("SELECT paid, status FROM contracts WHERE id=$1", [t.contract_id]).catch(() => null); return !!(c && Number(c.paid)); }
  /** role gate: returns { t, m, role, staff } or throws */
  async function gate(user, tid, need = "viewer") {
    const t = await teamRow(tid); if (!t) throw E.nf();
    const m = await memberOf(t.id, user?.id), staff = user?.role === "admin";
    const role = m?.role || null;
    if (!role && !staff && !(need === "visitor" && t.visibility === "listed")) throw E.nf();
    if (need !== "visitor" && (RANK[role || ""] || 0) < RANK[need] && !(staff && need === "viewer")) throw E.forbid(need === "admin" ? "للمالك والمشرفين" : need === "owner" ? "للمالك فقط" : "لا تملك الصلاحية");
    return { t, m, role, staff };
  }
  const writable = (t) => { if (t.status === "archived") throw fail(409, "archived", "الفريق مؤرشف؛ أعد تفعيله أولاً"); };

  /* ---------- teams ---------- */
  async function create(user, b) {
    if (!rl.hit("default", "wtnew:" + user.id)) throw E.rate();
    const name = str(b.name, 80, { required: true, min: 3 }), about = str(b.about, 2000), kind = oneOf(b.kind, Object.keys(KIND), "project");
    const visibility = oneOf(b.visibility, Object.keys(VIS), "private");
    if (visibility === "listed" && (await isMinor(user.id))) throw fail(403, "minor_restricted", "الفرق الظاهرة في الدليل متاحة لمن هم ١٨ سنة فأكثر");
    if ((await count("SELECT COUNT(*) n FROM wt_teams WHERE owner_id=$1 AND status<>'archived'", [user.id])) >= MAX_OWNED) throw fail(409, "limit", "وصلت للحد الأقصى من الفرق النشطة");
    const contractId = b.contractId ? await checkContract(user, String(b.contractId)) : null;
    const tid = id("wt"), now = iso();
    await db.tx(async (t) => {
      await t.run("INSERT INTO wt_teams (id, owner_id, kind, name, about, visibility, status, contract_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$8)", [tid, user.id, kind, name, about, visibility, contractId, now]);
      await t.run("INSERT INTO wt_members (team_id, user_id, role, title, joined_at) VALUES ($1,$2,'owner',$3,$4)", [tid, user.id, str(b.title, 60), now]);
    });
    return { id: tid, state: "active" };
  }
  async function checkContract(user, cid) {
    const c = await db.get("SELECT id, client_id, worker_id, paid FROM contracts WHERE id=$1", [cid]).catch(() => null);
    if (!c || (c.client_id !== user.id && c.worker_id !== user.id)) throw fail(404, "no_contract", "لم نجد هذا العقد بين عقودك");
    return c.id;
  }
  async function edit(user, tid, b) {
    const { t } = await gate(user, tid, "admin"); writable(t);
    const name = b.name !== undefined ? str(b.name, 80, { required: true, min: 3 }) : t.name, about = b.about !== undefined ? str(b.about, 2000) : t.about;
    const visibility = b.visibility !== undefined ? oneOf(b.visibility, Object.keys(VIS), t.visibility) : t.visibility;
    if (visibility === "listed" && t.visibility !== "listed") {
      if (await isMinor(user.id)) throw fail(403, "minor_restricted", "الفرق الظاهرة في الدليل متاحة لمن هم ١٨ سنة فأكثر");
    }
    let contractId = t.contract_id;
    if (b.contractId !== undefined) {
      if (user.id !== t.owner_id) throw E.forbid("يربط المالك العقد");
      contractId = b.contractId ? await checkContract(user, String(b.contractId)) : null;
      if (contractId && (await paidContract({ contract_id: contractId }))) {
        const ms = await db.all("SELECT user_id FROM wt_members WHERE team_id=$1", [t.id]);
        for (const m of ms) if (await isMinor(m.user_id)) throw fail(409, "minor_member", "في الفريق عضو دون ١٨ سنة؛ لا يمكن ربطه بعقد مدفوع");
      }
    }
    await db.run("UPDATE wt_teams SET name=$1, about=$2, visibility=$3, contract_id=$4, updated_at=$5 WHERE id=$6", [name, about, visibility, contractId, iso(), t.id]);
    return view(user, t.id);
  }
  async function setState(user, tid, b) {
    const t = await teamRow(tid); if (!t) throw E.nf();
    const staff = user.role === "admin", owner = t.owner_id === user.id;
    if (!owner && !staff) throw E.forbid("للمالك فقط");
    const to = oneOf(b.status, Object.keys(STATUS), null); if (!to) throw E.bad();
    await db.run("UPDATE wt_teams SET status=$1, updated_at=$2, closed_at=$3 WHERE id=$4", [to, iso(), to === "active" ? null : iso(), t.id]);
    if (staff && !owner) ctx.audit?.("team_" + to, t.id, str(b.reason, 400) || t.name, user.id);
    return view(user, t.id);
  }
  async function list(user, q = {}) {
    const mine = await db.all("SELECT t.*, m.role FROM wt_teams t JOIN wt_members m ON m.team_id=t.id WHERE m.user_id=$1 ORDER BY (t.status='active') DESC, t.updated_at DESC LIMIT 200", [user.id]);
    const ids = mine.map((t) => t.id);
    const mc = ids.length ? await db.all(`SELECT team_id, COUNT(*) n FROM wt_members WHERE team_id IN (${ph(ids)}) GROUP BY team_id`, ids) : [];
    const tc = ids.length ? await db.all(`SELECT team_id, status, COUNT(*) n FROM wt_tasks WHERE team_id IN (${ph(ids)}) GROUP BY team_id, status`, ids) : [];
    const card = (t) => ({ id: t.id, name: t.name, kind: { key: t.kind, label: KIND[t.kind] }, about: (t.about || "").slice(0, 200), visibility: t.visibility, status: t.status, statusLabel: STATUS[t.status], role: t.role ? { key: t.role, label: ROLES[t.role] } : null,
      members: Number(mc.find((x) => x.team_id === t.id)?.n || 0), tasks: { open: tc.filter((x) => x.team_id === t.id && x.status !== "done").reduce((s, x) => s + Number(x.n), 0), done: Number(tc.find((x) => x.team_id === t.id && x.status === "done")?.n || 0) }, contract: !!t.contract_id, updatedAt: isoOf(t.updated_at) });
    const invites = await db.all("SELECT i.*, t.name, t.kind FROM wt_invites i JOIN wt_teams t ON t.id=i.team_id WHERE i.user_id=$1 AND i.kind='invite' AND i.status='pending' ORDER BY i.created_at DESC", [user.id]);
    const iu = await usersOf(invites.map((i) => i.by_user));
    return { teams: mine.map(card), invites: invites.map((i) => ({ id: i.id, team: { id: i.team_id, name: i.name, kind: KIND[i.kind] }, role: ROLES[i.role], note: i.note || null, by: pubU(iu.get(i.by_user)), at: isoOf(i.created_at) })), options: options(), minor: await isMinor(user.id) };
  }
  async function directory(user, q = {}) {
    const text = normalize(String(q.q || "")).toLowerCase().trim().slice(0, 80);
    const rows = await db.all("SELECT * FROM wt_teams WHERE visibility='listed' AND status='active' ORDER BY updated_at DESC LIMIT 500");
    const out = [];
    for (const t of rows) {
      if (text && !normalize(`${t.name} ${t.about || ""}`).toLowerCase().includes(text)) continue;
      if (user && (await blockedBetween(user.id, t.owner_id))) continue;
      out.push(t); if (out.length >= 50) break;
    }
    const ids = out.map((t) => t.id), us = await usersOf(out.map((t) => t.owner_id));
    const mc = ids.length ? await db.all(`SELECT team_id, COUNT(*) n FROM wt_members WHERE team_id IN (${ph(ids)}) GROUP BY team_id`, ids) : [];
    const mine = user && ids.length ? new Set((await db.all(`SELECT team_id FROM wt_members WHERE user_id=$1 AND team_id IN (${ph(ids, 1)})`, [user.id, ...ids])).map((r) => r.team_id)) : new Set();
    return { teams: out.map((t) => ({ id: t.id, name: t.name, kind: { key: t.kind, label: KIND[t.kind] }, about: (t.about || "").slice(0, 240), owner: pubU(us.get(t.owner_id)), members: Number(mc.find((x) => x.team_id === t.id)?.n || 0), member: mine.has(t.id), updatedAt: isoOf(t.updated_at) })) };
  }
  const options = () => ({ kinds: KIND, roles: ROLES, statuses: STATUS, columns: COLS, priorities: PRIO, visibility: VIS, maxMembers: MAX_MEMBERS });

  async function view(user, tid) {
    const t = await teamRow(tid); if (!t) throw E.nf();
    const m = await memberOf(t.id, user?.id), staff = user?.role === "admin", role = m?.role || null;
    if (!role && !staff) {
      if (t.visibility !== "listed" || t.status !== "active" || (user && (await blockedBetween(user.id, t.owner_id)))) throw E.nf();
      const us = await usersOf([t.owner_id]);
      const req = user ? await db.get("SELECT status FROM wt_invites WHERE team_id=$1 AND user_id=$2 AND kind='request' ORDER BY created_at DESC LIMIT 1", [t.id, user.id]) : null;
      const minor = user ? await isMinor(user.id) : false;
      return { team: { id: t.id, name: t.name, kind: { key: t.kind, label: KIND[t.kind] }, about: t.about || "", visibility: t.visibility, status: t.status, statusLabel: STATUS[t.status], owner: pubU(us.get(t.owner_id)), members: await count("SELECT COUNT(*) n FROM wt_members WHERE team_id=$1", [t.id]) },
        me: { role: null, outsider: true, signedIn: !!user, request: req?.status || null, canRequest: !!user && !minor && req?.status !== "pending" && !(await paidContract(t)) }, options: options() };
    }
    const members = await db.all("SELECT * FROM wt_members WHERE team_id=$1 ORDER BY joined_at", [t.id]);
    const tasks = await db.all("SELECT * FROM wt_tasks WHERE team_id=$1 ORDER BY pos, created_at", [t.id]);
    const items = await db.all("SELECT * FROM wt_items WHERE team_id=$1 ORDER BY created_at DESC LIMIT 200", [t.id]);
    const ups = await db.all("SELECT * FROM wt_updates WHERE team_id=$1 ORDER BY created_at, id", [t.id]);
    const admin = (RANK[role || ""] || 0) >= RANK.admin;
    const invites = admin ? await db.all("SELECT * FROM wt_invites WHERE team_id=$1 AND status='pending' ORDER BY created_at DESC", [t.id]) : [];
    const us = await usersOf([...members.map((x) => x.user_id), ...ups.map((x) => x.user_id), ...items.map((x) => x.by_user), ...invites.map((x) => x.user_id)]);
    const media = items.filter((x) => x.media_id).length ? await db.all(`SELECT id, variants FROM media WHERE id IN (${ph(items.filter((x) => x.media_id).map((x) => x.media_id))})`, items.filter((x) => x.media_id).map((x) => x.media_id)).catch(() => []) : [];
    let contract = null;
    if (t.contract_id) {
      const c = await db.get("SELECT * FROM contracts WHERE id=$1", [t.contract_id]).catch(() => null);
      if (c) { const ms = await db.all("SELECT id, pos, title, status, amount FROM contract_milestones WHERE contract_id=$1 ORDER BY pos", [c.id]); const party = user && [c.client_id, c.worker_id].includes(user.id);
        contract = { id: c.id, title: c.title, status: c.status, statusLabel: ctx.services.contracts?.C_STATUS?.[c.status] || c.status, paid: !!Number(c.paid), party: !!party, milestones: ms.map((x) => ({ id: x.id, title: x.title, status: x.status, statusLabel: ctx.services.contracts?.M_STATUS?.[x.status] || x.status })) }; }
    }
    const can = { edit: admin, invite: admin && t.status !== "archived", tasks: (RANK[role || ""] || 0) >= RANK.member && t.status !== "archived", items: (RANK[role || ""] || 0) >= RANK.member && t.status !== "archived", post: !!role && t.status !== "archived", announce: (RANK[role || ""] || 0) >= RANK.member && t.status !== "archived", owner: role === "owner", leave: !!role && role !== "owner" };
    const uv = (uid) => pubU(us.get(uid));
    return {
      team: { id: t.id, name: t.name, kind: { key: t.kind, label: KIND[t.kind] }, about: t.about || "", visibility: t.visibility, visibilityLabel: VIS[t.visibility], status: t.status, statusLabel: STATUS[t.status], ownerId: t.owner_id, createdAt: isoOf(t.created_at), updatedAt: isoOf(t.updated_at) },
      members: members.map((x) => ({ user: uv(x.user_id), role: x.role, roleLabel: ROLES[x.role], title: x.title || null, joinedAt: isoOf(x.joined_at) })),
      tasks: tasks.map((x) => ({ id: x.id, title: x.title, body: x.body || "", status: x.status, statusLabel: COLS[x.status], assignee: uv(x.assignee_id), due: x.due || null, overdue: !!x.due && x.due < today() && x.status !== "done", priority: x.priority, priorityLabel: PRIO[x.priority], pos: Number(x.pos), milestoneId: x.milestone_id || null, mine: x.assignee_id === user?.id, by: x.created_by === user?.id })),
      items: items.map((x) => { const md = media.find((q) => q.id === x.media_id); const v = md ? parse(md.variants, {}) : null; return { id: x.id, kind: x.kind, title: x.title, url: x.kind === "file" ? v?.original || null : x.url, note: x.note || null, by: uv(x.by_user), at: isoOf(x.created_at), canDelete: admin || x.by_user === user?.id }; }),
      updates: ups.filter((x) => !x.parent_id).reverse().map((x) => ({ id: x.id, kind: x.kind, body: x.body, user: uv(x.user_id), at: isoOf(x.created_at), warn: !!Number(x.warn) && x.user_id !== user?.id, canDelete: admin || x.user_id === user?.id,
        replies: ups.filter((r) => r.parent_id === x.id).map((r) => ({ id: r.id, body: r.body, user: uv(r.user_id), at: isoOf(r.created_at), warn: !!Number(r.warn) && r.user_id !== user?.id, canDelete: admin || r.user_id === user?.id })) })),
      invites: invites.map((x) => ({ id: x.id, kind: x.kind, user: uv(x.user_id), role: x.role, roleLabel: ROLES[x.role], code: x.kind === "link" ? x.code : undefined, uses: Number(x.uses), maxUses: x.max_uses === null || x.max_uses === undefined ? null : Number(x.max_uses), expiresAt: isoOf(x.expires_at), note: x.note || null })),
      contract, me: { role, roleLabel: role ? ROLES[role] : null, staff, can }, options: options()
    };
  }

  /* ---------- membership ---------- */
  async function canJoin(t, uid) {
    if ((await count("SELECT COUNT(*) n FROM wt_members WHERE team_id=$1", [t.id])) >= MAX_MEMBERS) throw fail(409, "full", "اكتمل عدد أعضاء الفريق");
    if (await memberOf(t.id, uid)) throw fail(409, "member", "أنت عضو في هذا الفريق");
    if ((await isMinor(uid)) && (await paidContract(t))) throw fail(403, "minor_restricted", "هذا الفريق مرتبط بعقد مدفوع ومتاح لمن هم ١٨ سنة فأكثر");
  }
  async function addMember(tx, t, uid, role) { await tx.run("INSERT INTO wt_members (team_id, user_id, role, joined_at) VALUES ($1,$2,$3,$4)", [t.id, uid, role, iso()]); await tx.run("UPDATE wt_teams SET updated_at=$1 WHERE id=$2", [iso(), t.id]); }
  async function invite(user, tid, b) {
    const { t, role } = await gate(user, tid, "admin"); writable(t);
    if (!rl.hit("default", "wtinv:" + user.id)) throw E.rate();
    const r = oneOf(b.role, ["admin", "member", "viewer"], "member");
    if (r === "admin" && role !== "owner") throw E.forbid("يعيّن المالك المشرفين");
    if (b.link) {
      if (t.visibility === "listed" && (await isMinor(user.id))) throw E.forbid();
      const days = Math.max(1, Math.min(30, Math.round(Number(b.days) || 7))), max = b.maxUses ? Math.max(1, Math.min(MAX_MEMBERS, Math.round(Number(b.maxUses)))) : null;
      const code = token().slice(0, 22), iid = id("wti");
      await db.run("INSERT INTO wt_invites (id, team_id, kind, by_user, code, role, status, max_uses, expires_at, created_at) VALUES ($1,$2,'link',$3,$4,$5,'pending',$6,$7,$8)", [iid, t.id, user.id, code, r === "admin" ? "member" : r, max, iso(clock() + days * 864e5), iso()]);
      return { id: iid, code, path: "#/teams/join/" + code };
    }
    const h = String(b.handle || "").replace(/^@/, "").trim().toLowerCase(); if (!h) throw E.bad("اكتب اسم المستخدم");
    const u = await db.get("SELECT id, status FROM users WHERE LOWER(handle)=$1", [h]);
    if (!u || ["banned", "deleted"].includes(u.status) || (await blockedBetween(user.id, u.id))) throw fail(404, "no_user", "لم نجد هذا العضو");
    await canJoin(t, u.id);
    if (await db.get("SELECT 1 x FROM wt_invites WHERE team_id=$1 AND user_id=$2 AND kind='invite' AND status='pending'", [t.id, u.id])) throw fail(409, "invited", "دعوته قائمة بانتظار الرد");
    const iid = id("wti");
    await db.run("INSERT INTO wt_invites (id, team_id, kind, by_user, user_id, role, note, status, created_at) VALUES ($1,$2,'invite',$3,$4,$5,$6,'pending',$7)", [iid, t.id, user.id, u.id, r, str(b.note, 300), iso()]);
    await notify(u.id, "team_invite", t.id, user.id);
    return { id: iid };
  }
  async function revoke(user, tid, iid) {
    const { t } = await gate(user, tid, "admin");
    const r = await db.run("UPDATE wt_invites SET status='revoked', decided_at=$1 WHERE id=$2 AND team_id=$3 AND status='pending'", [iso(), String(iid), t.id]);
    if (!r.changes) throw E.nf(); return { ok: true };
  }
  async function respond(user, iid, b) {
    const i = await db.get("SELECT * FROM wt_invites WHERE id=$1", [String(iid)]); if (!i || i.user_id !== user.id || i.kind !== "invite") throw E.nf();
    if (i.status !== "pending") throw fail(409, "not_pending", "انتهت هذه الدعوة");
    const t = await teamRow(i.team_id); if (!t || t.status === "archived") throw fail(409, "archived", "الفريق مؤرشف");
    const accept = b.accept === true;
    if (accept) await canJoin(t, user.id);
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE wt_invites SET status=$1, decided_at=$2 WHERE id=$3 AND status='pending'", [accept ? "accepted" : "declined", iso(), i.id]); if (!r.changes) throw fail(409, "not_pending", "انتهت هذه الدعوة");
      if (accept) await addMember(tx, t, user.id, i.role);
    });
    await notify(i.by_user, accept ? "team_joined" : "team_declined", t.id, user.id);
    return { ok: true, team: t.id, joined: accept };
  }
  async function linkInfo(user, code) {
    const i = await db.get("SELECT * FROM wt_invites WHERE code=$1 AND kind='link'", [String(code)]);
    if (!i || i.status !== "pending" || new Date(i.expires_at).getTime() < clock() || (i.max_uses && Number(i.uses) >= Number(i.max_uses))) throw fail(404, "expired", "رابط الدعوة منتهٍ أو غير صالح");
    const t = await teamRow(i.team_id); if (!t || t.status === "archived") throw fail(404, "expired", "رابط الدعوة منتهٍ أو غير صالح");
    return { i, t };
  }
  async function linkView(user, code) {
    const { i, t } = await linkInfo(user, code);
    const us = await usersOf([t.owner_id]);
    return { team: { id: t.id, name: t.name, kind: KIND[t.kind], about: (t.about || "").slice(0, 400), owner: pubU(us.get(t.owner_id)), members: await count("SELECT COUNT(*) n FROM wt_members WHERE team_id=$1", [t.id]) }, role: ROLES[i.role], member: !!(user && (await memberOf(t.id, user.id))), expiresAt: isoOf(i.expires_at) };
  }
  async function joinByCode(user, b) {
    if (!rl.hit("default", "wtjoin:" + user.id)) throw E.rate();
    const { i, t } = await linkInfo(user, b.code);
    if (await blockedBetween(user.id, t.owner_id)) throw fail(404, "expired", "رابط الدعوة منتهٍ أو غير صالح");
    if (t.visibility === "listed" && (await isMinor(user.id))) throw fail(403, "minor_restricted", "الانضمام عبر الروابط للفرق العامة متاح لمن هم ١٨ سنة فأكثر");
    await canJoin(t, user.id);
    await db.tx(async (tx) => {
      const r = await tx.run("UPDATE wt_invites SET uses=uses+1 WHERE id=$1 AND status='pending' AND (max_uses IS NULL OR uses < max_uses)", [i.id]); if (!r.changes) throw fail(404, "expired", "رابط الدعوة منتهٍ أو غير صالح");
      await addMember(tx, t, user.id, i.role);
    });
    await notify(t.owner_id, "team_joined", t.id, user.id);
    return { ok: true, team: t.id };
  }
  async function request(user, tid, b) {
    const t = await teamRow(tid); if (!t || t.visibility !== "listed" || t.status !== "active") throw E.nf();
    if (await blockedBetween(user.id, t.owner_id)) throw E.nf();
    if (await isMinor(user.id)) throw fail(403, "minor_restricted", "طلبات الانضمام للفرق العامة متاحة لمن هم ١٨ سنة فأكثر");
    await canJoin(t, user.id);
    if (await db.get("SELECT 1 x FROM wt_invites WHERE team_id=$1 AND user_id=$2 AND kind='request' AND status='pending'", [t.id, user.id])) throw fail(409, "requested", "طلبك بانتظار الرد");
    if (!rl.hit("default", "wtreq:" + user.id)) throw E.rate();
    await db.run("INSERT INTO wt_invites (id, team_id, kind, by_user, user_id, role, note, status, created_at) VALUES ($1,$2,'request',$3,$3,'member',$4,'pending',$5)", [id("wti"), t.id, user.id, str(b.note, 300), iso()]);
    for (const a of await db.all("SELECT user_id FROM wt_members WHERE team_id=$1 AND role IN ('owner','admin')", [t.id])) await notify(a.user_id, "team_request", t.id, user.id);
    return { ok: true };
  }
  async function decide(user, tid, iid, b) {
    const { t } = await gate(user, tid, "admin"); writable(t);
    const i = await db.get("SELECT * FROM wt_invites WHERE id=$1 AND team_id=$2 AND kind='request'", [String(iid), t.id]); if (!i) throw E.nf();
    if (i.status !== "pending") throw fail(409, "not_pending", "حُسم هذا الطلب");
    const accept = b.accept === true; if (accept) await canJoin(t, i.user_id);
    await db.tx(async (tx) => { await tx.run("UPDATE wt_invites SET status=$1, decided_at=$2 WHERE id=$3", [accept ? "accepted" : "declined", iso(), i.id]); if (accept) await addMember(tx, t, i.user_id, "member"); });
    await notify(i.user_id, accept ? "team_joined" : "team_declined", t.id, user.id);
    return view(user, t.id);
  }
  async function setMember(user, tid, uid, b) {
    const { t, role } = await gate(user, tid, "admin"); writable(t);
    const m = await memberOf(t.id, String(uid)); if (!m) throw E.nf();
    if (m.role === "owner") throw E.forbid("انقل الملكية بدلاً من ذلك");
    const to = b.role !== undefined ? oneOf(b.role, ["admin", "member", "viewer"], null) : m.role; if (!to) throw E.bad();
    if ((to === "admin" || m.role === "admin") && role !== "owner") throw E.forbid("يعيّن المالك المشرفين");
    await db.run("UPDATE wt_members SET role=$1, title=$2 WHERE team_id=$3 AND user_id=$4", [to, b.title !== undefined ? str(b.title, 60) : m.title, t.id, m.user_id]);
    return view(user, t.id);
  }
  async function setTitle(user, tid, b) { const { t, m } = await gate(user, tid, "viewer"); if (!m) throw E.forbid(); await db.run("UPDATE wt_members SET title=$1 WHERE team_id=$2 AND user_id=$3", [str(b.title, 60), t.id, user.id]); return view(user, t.id); }
  async function removeMember(user, tid, uid) {
    const t = await teamRow(tid); if (!t) throw E.nf();
    const self = String(uid) === user.id, me = await memberOf(t.id, user.id), m = await memberOf(t.id, String(uid));
    if (!m || (!me && user.role !== "admin")) throw E.nf();
    if (m.role === "owner") throw fail(409, "owner", "انقل الملكية قبل المغادرة");
    if (!self && (RANK[me?.role || ""] || 0) < RANK.admin) throw E.forbid();
    if (!self && m.role === "admin" && me.role !== "owner") throw E.forbid("يزيل المالك المشرفين");
    await db.tx(async (tx) => { await tx.run("DELETE FROM wt_members WHERE team_id=$1 AND user_id=$2", [t.id, m.user_id]); await tx.run("UPDATE wt_tasks SET assignee_id=NULL WHERE team_id=$1 AND assignee_id=$2 AND status<>'done'", [t.id, m.user_id]); });
    if (!self) await notify(m.user_id, "team_removed", t.id, user.id);
    return { ok: true, left: self };
  }
  async function transfer(user, tid, b) {
    const { t } = await gate(user, tid, "owner");
    const m = await memberOf(t.id, String(b.userId || "")); if (!m || m.user_id === user.id) throw E.bad("اختر عضواً في الفريق");
    await db.tx(async (tx) => { await tx.run("UPDATE wt_members SET role='owner' WHERE team_id=$1 AND user_id=$2", [t.id, m.user_id]); await tx.run("UPDATE wt_members SET role='admin' WHERE team_id=$1 AND user_id=$2", [t.id, user.id]); await tx.run("UPDATE wt_teams SET owner_id=$1, updated_at=$2 WHERE id=$3", [m.user_id, iso(), t.id]); });
    await notify(m.user_id, "team_owner", t.id, user.id);
    return view(user, t.id);
  }

  /* ---------- tasks ---------- */
  async function taskFields(t, b, prev) {
    const title = b.title !== undefined ? str(b.title, 160, { required: true, min: 2 }) : prev.title;
    const body = b.body !== undefined ? str(b.body, 3000) : prev?.body || null;
    const status = b.status !== undefined ? oneOf(b.status, Object.keys(COLS), null) : prev?.status || "todo"; if (!status) throw E.bad();
    const priority = b.priority !== undefined ? oneOf(b.priority, Object.keys(PRIO), "normal") : prev?.priority || "normal";
    const assignee = b.assignee !== undefined ? b.assignee || null : prev?.assignee_id || null;
    if (assignee && !(await memberOf(t.id, String(assignee)))) throw fail(400, "not_member", "المكلَّف ليس عضواً في الفريق");
    if (assignee && (await memberOf(t.id, String(assignee)))?.role === "viewer") throw fail(400, "viewer", "لا تُسند المهام للمشاهدين");
    const due = b.due !== undefined ? b.due || null : prev?.due || null; if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw fail(400, "bad_date", "تاريخ غير صالح");
    const milestone = b.milestoneId !== undefined ? b.milestoneId || null : prev?.milestone_id || null;
    if (milestone && !(t.contract_id && (await db.get("SELECT 1 x FROM contract_milestones WHERE id=$1 AND contract_id=$2", [String(milestone), t.contract_id]).catch(() => null)))) throw fail(400, "bad_milestone", "المرحلة ليست من العقد المرتبط");
    return { title, body, status, priority, assignee, due, milestone };
  }
  async function addTask(user, tid, b) {
    const { t } = await gate(user, tid, "member"); writable(t);
    if (!rl.hit("default", "wttask:" + user.id)) throw E.rate();
    if ((await count("SELECT COUNT(*) n FROM wt_tasks WHERE team_id=$1", [t.id])) >= 500) throw fail(409, "limit", "وصل الفريق للحد الأقصى من المهام");
    const f = await taskFields(t, b, null), pos = await count("SELECT COALESCE(MAX(pos),-1)+1 n FROM wt_tasks WHERE team_id=$1 AND status=$2", [t.id, f.status]);
    const kid = id("wtt"), now = iso();
    await db.run("INSERT INTO wt_tasks (id, team_id, title, body, status, assignee_id, due, priority, pos, milestone_id, created_by, created_at, updated_at, done_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13)",
      [kid, t.id, f.title, f.body, f.status, f.assignee, f.due, f.priority, pos, f.milestone, user.id, now, f.status === "done" ? now : null]);
    await db.run("UPDATE wt_teams SET updated_at=$1 WHERE id=$2", [now, t.id]);
    if (f.assignee) await notify(f.assignee, "team_task", t.id, user.id);
    return { id: kid };
  }
  async function editTask(user, kid, b) {
    const k = await db.get("SELECT * FROM wt_tasks WHERE id=$1", [String(kid)]); if (!k) throw E.nf();
    const { t } = await gate(user, k.team_id, "member"); writable(t);
    const f = await taskFields(t, b, k), now = iso();
    let pos = Number(k.pos);
    if (f.status !== k.status) pos = await count("SELECT COALESCE(MAX(pos),-1)+1 n FROM wt_tasks WHERE team_id=$1 AND status=$2", [t.id, f.status]);
    if (b.move === "up" || b.move === "down") {
      const sib = await db.get(`SELECT id, pos FROM wt_tasks WHERE team_id=$1 AND status=$2 AND pos ${b.move === "up" ? "<" : ">"} $3 ORDER BY pos ${b.move === "up" ? "DESC" : "ASC"} LIMIT 1`, [t.id, k.status, k.pos]);
      if (sib) { await db.run("UPDATE wt_tasks SET pos=$1 WHERE id=$2", [k.pos, sib.id]); pos = Number(sib.pos); }
    }
    await db.run("UPDATE wt_tasks SET title=$1, body=$2, status=$3, assignee_id=$4, due=$5, priority=$6, pos=$7, milestone_id=$8, updated_at=$9, done_at=$10 WHERE id=$11",
      [f.title, f.body, f.status, f.assignee, f.due, f.priority, pos, f.milestone, now, f.status === "done" ? k.done_at || now : null, k.id]);
    await db.run("UPDATE wt_teams SET updated_at=$1 WHERE id=$2", [now, t.id]);
    if (f.assignee && f.assignee !== k.assignee_id) await notify(f.assignee, "team_task", t.id, user.id);
    return { ok: true };
  }
  async function delTask(user, kid) {
    const k = await db.get("SELECT * FROM wt_tasks WHERE id=$1", [String(kid)]); if (!k) throw E.nf();
    const { t, role } = await gate(user, k.team_id, "member"); writable(t);
    if (k.created_by !== user.id && (RANK[role || ""] || 0) < RANK.admin) throw E.forbid("يحذف المهمة منشئها أو المشرفون");
    await db.run("DELETE FROM wt_tasks WHERE id=$1", [k.id]); return { ok: true };
  }

  /* ---------- files & links ---------- */
  async function addItem(user, tid, b) {
    const { t } = await gate(user, tid, "member"); writable(t);
    if (!rl.hit("default", "wtitem:" + user.id)) throw E.rate();
    const title = str(b.title, 120, { required: true, min: 2 }), note = str(b.note, 600);
    let kind = "link", link = null, media = null;
    if (b.mediaId) { const m = await db.get("SELECT id, owner, kind, status FROM media WHERE id=$1", [String(b.mediaId)]); if (!m || m.owner !== user.id || m.kind !== "image") throw fail(400, "bad_media", "الملف غير صالح"); kind = "file"; media = m.id; }
    else link = url(b.url);
    if ((await count("SELECT COUNT(*) n FROM wt_items WHERE team_id=$1", [t.id])) >= 300) throw fail(409, "limit", "وصل الفريق للحد الأقصى من الملفات والروابط");
    const iid = id("wtf");
    await db.run("INSERT INTO wt_items (id, team_id, kind, title, url, media_id, note, by_user, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [iid, t.id, kind, title, link, media, note, user.id, iso()]);
    await db.run("UPDATE wt_teams SET updated_at=$1 WHERE id=$2", [iso(), t.id]);
    return { id: iid };
  }
  async function delItem(user, iid) {
    const x = await db.get("SELECT * FROM wt_items WHERE id=$1", [String(iid)]); if (!x) throw E.nf();
    const { role } = await gate(user, x.team_id, "viewer");
    if (x.by_user !== user.id && (RANK[role || ""] || 0) < RANK.admin) throw E.forbid();
    await db.run("DELETE FROM wt_items WHERE id=$1", [x.id]); return { ok: true };
  }

  /* ---------- updates & discussion ---------- */
  async function post(user, tid, b) {
    const { t, role } = await gate(user, tid, "viewer"); writable(t); if (!role) throw E.forbid();
    if (!rl.hit("default", "wtpost:" + user.id)) throw E.rate();
    const body = str(b.body, 4000, { required: true, min: 2 });
    let parent = null;
    if (b.parentId) { parent = await db.get("SELECT * FROM wt_updates WHERE id=$1 AND team_id=$2 AND parent_id IS NULL", [String(b.parentId), t.id]); if (!parent) throw E.nf(); }
    const kind = parent ? "reply" : oneOf(b.kind, ["update", "question"], "update");
    if (!parent && (RANK[role] || 0) < RANK.member) throw E.forbid("يكتب المشاهدون ردوداً فقط");
    const uid = id("wtu");
    await db.run("INSERT INTO wt_updates (id, team_id, user_id, kind, parent_id, body, warn, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [uid, t.id, user.id, kind, parent?.id || null, body, risky(body) ? 1 : 0, iso()]);
    await db.run("UPDATE wt_teams SET updated_at=$1 WHERE id=$2", [iso(), t.id]);
    if (parent) await notify(parent.user_id, "team_update", t.id, user.id);
    else for (const m of await db.all("SELECT user_id FROM wt_members WHERE team_id=$1 AND user_id<>$2 LIMIT 60", [t.id, user.id])) await notify(m.user_id, "team_update", t.id, user.id);
    return { id: uid };
  }
  async function delPost(user, pid) {
    const x = await db.get("SELECT * FROM wt_updates WHERE id=$1", [String(pid)]); if (!x) throw E.nf();
    const { role } = await gate(user, x.team_id, "viewer");
    if (x.user_id !== user.id && (RANK[role || ""] || 0) < RANK.admin) throw E.forbid();
    await db.run("DELETE FROM wt_updates WHERE id=$1 OR parent_id=$1", [x.id]); return { ok: true };
  }

  /** teams linked to a contract that this user belongs to (shown on the contract page) */
  async function forContract(uid, cid) { return (await db.all("SELECT t.id, t.name FROM wt_teams t JOIN wt_members m ON m.team_id=t.id AND m.user_id=$1 WHERE t.contract_id=$2", [uid, cid]).catch(() => [])).map((t) => ({ id: t.id, name: t.name })); }

  /* ---------- routes ---------- */
  R.get("/api/teams", A(async (req) => list(req.user, req.query || {})));
  R.post("/api/teams", A(async (req) => create(req.user, req.body || {})));
  R.get("/api/teams/directory", async (req) => directory(req.user || null, req.query || {}));
  R.get("/api/teams/join/:code", async (req) => linkView(req.user || null, req.params.code));
  R.post("/api/teams/join", A(async (req) => joinByCode(req.user, req.body || {})));
  R.get("/api/teams/:id", async (req) => view(req.user || null, req.params.id));
  R.patch("/api/teams/:id", A(async (req) => edit(req.user, req.params.id, req.body || {})));
  R.post("/api/teams/:id/state", A(async (req) => setState(req.user, req.params.id, req.body || {})));
  R.post("/api/teams/:id/invites", A(async (req) => invite(req.user, req.params.id, req.body || {})));
  R.post("/api/teams/:id/invites/:iid/revoke", A(async (req) => revoke(req.user, req.params.id, req.params.iid)));
  R.post("/api/teams/:id/request", A(async (req) => request(req.user, req.params.id, req.body || {})));
  R.post("/api/teams/:id/requests/:iid", A(async (req) => decide(req.user, req.params.id, req.params.iid, req.body || {})));
  R.put("/api/teams/:id/me", A(async (req) => setTitle(req.user, req.params.id, req.body || {})));
  R.patch("/api/teams/:id/members/:uid", A(async (req) => setMember(req.user, req.params.id, req.params.uid, req.body || {})));
  R.del("/api/teams/:id/members/:uid", A(async (req) => removeMember(req.user, req.params.id, req.params.uid)));
  R.post("/api/teams/:id/transfer", A(async (req) => transfer(req.user, req.params.id, req.body || {})));
  R.post("/api/teams/:id/tasks", A(async (req) => addTask(req.user, req.params.id, req.body || {})));
  R.patch("/api/team-tasks/:id", A(async (req) => editTask(req.user, req.params.id, req.body || {})));
  R.del("/api/team-tasks/:id", A(async (req) => delTask(req.user, req.params.id)));
  R.post("/api/teams/:id/items", A(async (req) => addItem(req.user, req.params.id, req.body || {})));
  R.del("/api/team-items/:id", A(async (req) => delItem(req.user, req.params.id)));
  R.post("/api/teams/:id/updates", A(async (req) => post(req.user, req.params.id, req.body || {})));
  R.del("/api/team-updates/:id", A(async (req) => delPost(req.user, req.params.id)));
  R.post("/api/team-invites/:id/respond", A(async (req) => respond(req.user, req.params.id, req.body || {})));

  return { view, list, forContract, completedFor: async (uid) => db.all("SELECT t.* FROM wt_teams t JOIN wt_members m ON m.team_id=t.id WHERE m.user_id=$1 AND t.status='completed'", [uid]), ROLES, KIND };
};
