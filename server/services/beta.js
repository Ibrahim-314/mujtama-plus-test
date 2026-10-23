/* Invite-based beta launch (phase 54). Built ON the phase 50 launch service (waitlist, invite codes, LAUNCH_MODE) — nothing there
 * is duplicated: every beta invite IS a launch_invites row (note `beta:<cohortId>`), redeemed by the existing register / Pi sign-in
 * hooks; this service only maps redeemed codes to cohorts (syncInvites) and adds the beta tooling on top.
 *  1. Cohort waves: wave 1 (100) then wave 2 (1000) seeded once as `planned`; admins create/edit waves, OPEN the next one
 *     (optionally inviting the oldest waitlist entries up to the wave's capacity) and close them. Staff can add existing accounts.
 *  2. Invite quotas: each tester may issue `quota` personal codes (single use) while the cohort is open and has room.
 *  3. Beta tester badge 🧪 (GET /api/beta/badge/:handle; testers may hide it).
 *  4. In-app feedback (bug | idea | other) with optional screenshot (a media id the author owns) + device info → staff triage
 *     board (status, priority, assignee, reply); a staff reply or status change notifies the tester (beta_feedback_reply).
 *  5. NPS (0–10) + satisfaction (1–5) micro-surveys: prompted at most every SURVEY_DAYS, never twice on the same day.
 *  6. Cohort dashboard: members, activation (first meaningful action ≤ 7 days), D1/D7 retention, client errors (phase 1 intake,
 *     testers only) + web vitals, NPS/CSAT, top feedback.
 *  7. Kill switch per feature flag: beta_flag_rules on top of feature_flags — `cohorts` get a flag early, `killed` turns it off
 *     for everyone at once. Applied to GET /api/flags and to ops.flagsFor (server-side checks).
 * LAUNCH_MODE stays an env decision (default open). In open mode waves still work as named tester groups (codes are optional). */
const { E, HttpError, str, id } = require("../lib/core");

const STAFF = ["admin", "moderator"];
const KINDS = ["bug", "idea", "other"];
const F_STATUS = ["new", "triaged", "planned", "in_progress", "done", "wont_fix", "duplicate"];
const F_LABEL = { new: "جديدة", triaged: "قيد المراجعة", planned: "مخطط لها", in_progress: "قيد التنفيذ", done: "تم الحل", wont_fix: "لن تُنفّذ", duplicate: "مكررة" };
const PRIORITY = ["low", "normal", "high", "urgent"];
const DEFAULT_WAVES = [[1, "الموجة الأولى", 100, 3], [2, "الموجة الثانية", 1000, 2]];

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date, jobs?: boolean }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : new Date());
  const nowIso = () => clock().toISOString();
  const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
  const fail = (status, code, msg) => new HttpError(status, msg, code);
  const isStaff = (u) => !!u && STAFF.includes(u.role);
  const staff = (fn) => A(async (req, res) => { if (!isStaff(req.user)) throw E.forbid("لفريق الإطلاق التجريبي فقط"); return fn(req, res); });
  const admin = (fn) => A(async (req, res) => { if (req.user.role !== "admin") throw E.forbid("للإدارة فقط"); return fn(req, res); });
  const int = (v, d, lo, hi) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const parse = (v, d) => { if (v && typeof v === "object") return v; try { return JSON.parse(v) ?? d; } catch { return d; } };
  const hitOr = (action, key) => { if (!rl.hit(action, key)) throw E.rate(); };
  const SURVEY_DAYS = int(env.BETA_SURVEY_DAYS, 14, 1, 365);
  const launch = () => ctx.services.launch;
  const notify = async (uid, kind, o) => { try { await ctx.services.notify?.notify(uid, kind, o); } catch { /* best effort */ } };

  /* ---------- seed + cohorts ---------- */
  let seeded = null;
  const seed = () => (seeded ||= (async () => {
    if (await db.get("SELECT 1 x FROM beta_cohorts LIMIT 1")) return;
    for (const [wave, name, cap, quota] of DEFAULT_WAVES)
      await db.run("INSERT INTO beta_cohorts(id,name,wave,capacity,invite_quota,status,created_at) VALUES($1,$2,$3,$4,$5,'planned',$6) ON CONFLICT DO NOTHING", [id("bc"), name, wave, cap, quota, nowIso()]);
  })().catch((e) => { seeded = null; throw e; }));
  const count = async (sql, a = []) => Number((await db.get(sql, a))?.n || 0);
  async function cohortClient(c) {
    const members = await count("SELECT COUNT(*) n FROM beta_members WHERE cohort_id=$1", [c.id]);
    const pendingInvites = await count("SELECT COUNT(*) n FROM launch_invites WHERE note=$1 AND revoked=0 AND uses < max_uses AND (expires_at IS NULL OR expires_at > $2)", ["beta:" + c.id, nowIso()]);
    return { id: c.id, name: c.name, wave: Number(c.wave), capacity: Number(c.capacity), inviteQuota: Number(c.invite_quota), status: c.status, openedAt: c.opened_at || null, closedAt: c.closed_at || null, members, pendingInvites, room: Math.max(0, Number(c.capacity) - members - pendingInvites) };
  }
  const getCohort = async (cid) => { const c = await db.get("SELECT * FROM beta_cohorts WHERE id=$1", [String(cid || "").slice(0, 64)]); if (!c) throw E.nf("الموجة غير موجودة"); return c; };
  async function cohorts() { await seed(); await syncInvites(); return { items: await Promise.all((await db.all("SELECT * FROM beta_cohorts ORDER BY wave")).map(cohortClient)), mode: launch()?.mode?.() || "open" }; }
  async function saveCohort(user, cid, b = {}) {
    await seed();
    const prev = cid ? await getCohort(cid) : null;
    const name = b.name !== undefined ? str(b.name, 80, { required: true, min: 2 }) : prev?.name;
    if (!name) throw E.bad("اسم الموجة مطلوب");
    const capacity = b.capacity !== undefined ? int(b.capacity, 100, 1, 1000000) : Number(prev?.capacity || 100);
    const quota = b.inviteQuota !== undefined ? int(b.inviteQuota, 3, 0, 100) : Number(prev?.invite_quota ?? 3);
    if (prev) {
      await db.run("UPDATE beta_cohorts SET name=$1, capacity=$2, invite_quota=$3 WHERE id=$4", [name, capacity, quota, prev.id]);
      ctx.audit?.("beta_cohort_saved", user.id, null, prev.id);
      return { cohort: await cohortClient(await getCohort(prev.id)) };
    }
    const wave = Number((await db.get("SELECT COALESCE(MAX(wave),0) n FROM beta_cohorts"))?.n || 0) + 1;
    const nid = id("bc");
    await db.run("INSERT INTO beta_cohorts(id,name,wave,capacity,invite_quota,status,created_at) VALUES($1,$2,$3,$4,$5,'planned',$6)", [nid, name, wave, capacity, quota, nowIso()]);
    ctx.audit?.("beta_cohort_saved", user.id, null, nid);
    return { cohort: await cohortClient(await getCohort(nid)) };
  }
  /** open a wave: earlier waves must be open/closed first (waves go in order); optionally invite the oldest waitlist entries */
  async function openCohort(user, cid, b = {}) {
    await seed();
    const c = await getCohort(cid);
    if (c.status === "open") throw fail(409, "already_open", "الموجة مفتوحة بالفعل");
    const earlier = await db.get("SELECT id FROM beta_cohorts WHERE wave < $1 AND status='planned' LIMIT 1", [c.wave]);
    if (earlier) throw fail(409, "previous_wave_planned", "افتح الموجة السابقة أولاً");
    await db.run("UPDATE beta_cohorts SET status='open', opened_at=COALESCE(opened_at,$1), opened_by=$2, closed_at=NULL WHERE id=$3", [nowIso(), user.id, c.id]);
    ctx.audit?.("beta_wave_opened", user.id, null, c.id);
    let invited = [];
    if (b.inviteWaitlist) invited = (await inviteWaitlist(user, c.id, { count: b.count, days: b.days })).invited;
    return { cohort: await cohortClient(await getCohort(c.id)), invited, note: invited.length ? "أرسل الرموز يدوياً لأصحابها؛ لا يرسل الخادم بريداً تلقائياً هنا." : null };
  }
  async function closeCohort(user, cid) {
    const c = await getCohort(cid);
    await db.run("UPDATE beta_cohorts SET status='closed', closed_at=$1 WHERE id=$2", [nowIso(), c.id]);
    ctx.audit?.("beta_wave_closed", user.id, null, c.id);
    return { cohort: await cohortClient(await getCohort(c.id)) };
  }
  /** oldest `waiting` waitlist entries → single-use launch invites tagged with the cohort (never beyond the wave's room) */
  async function inviteWaitlist(user, cid, b = {}) {
    const c = await cohortClient(await getCohort(cid));
    if (c.status !== "open") throw fail(409, "wave_not_open", "افتح الموجة قبل إرسال الدعوات");
    const n = Math.min(c.room, int(b.count, c.room, 0, 1000));
    const rows = n > 0 ? await db.all("SELECT * FROM launch_waitlist WHERE status='waiting' ORDER BY created_at LIMIT $1", [n]) : [];
    const out = [];
    for (const r of rows) {
      const code = await launch().mkInvite({ by: user.id, waitlist: r.id, maxUses: 1, days: int(b.days, 14, 1, 365), note: "beta:" + c.id });
      await db.run("UPDATE launch_waitlist SET status='invited', invite_code=$1, updated_at=$2 WHERE id=$3", [code, nowIso(), r.id]);
      out.push({ waitlistId: r.id, contact: r.contact, code });
    }
    // a parked Pi account (users.status='waitlist') whose waitlist row was invited is activated by its next sign-in with the code (phase 50)
    return { invited: out, room: Math.max(0, c.room - out.length) };
  }
  async function addMembers(user, cid, b = {}) {
    const c = await cohortClient(await getCohort(cid));
    const handles = (Array.isArray(b.handles) ? b.handles : String(b.handles || "").split(/[\s,،]+/)).map((x) => String(x).replace(/^@/, "").trim()).filter(Boolean).slice(0, 200);
    if (!handles.length) throw E.bad("أدخل أسماء المستخدمين");
    const added = [], skipped = [];
    let room = c.room;
    for (const hnd of handles) {
      const u = await db.get("SELECT id, handle FROM users WHERE LOWER(handle)=LOWER($1) AND status='active'", [hnd]);
      if (!u) { skipped.push({ handle: hnd, reason: "not_found" }); continue; }
      if (await db.get("SELECT 1 x FROM beta_members WHERE user_id=$1", [u.id])) { skipped.push({ handle: u.handle, reason: "already_member" }); continue; }
      if (room <= 0) { skipped.push({ handle: u.handle, reason: "wave_full" }); continue; }
      await join(u.id, c.id, "staff", user.id, null); room--; added.push(u.handle);
    }
    ctx.audit?.("beta_members_added", user.id, String(added.length), c.id);
    return { added, skipped, cohort: await cohortClient(await getCohort(c.id)) };
  }
  async function join(uid, cid, source, by, code) {
    const c = await db.get("SELECT invite_quota FROM beta_cohorts WHERE id=$1", [cid]);
    const r = await db.run("INSERT INTO beta_members(user_id,cohort_id,source,invited_by,invite_code,quota,invites_used,badge,joined_at) VALUES($1,$2,$3,$4,$5,$6,0,1,$7) ON CONFLICT (user_id) DO NOTHING",
      [uid, cid, source, by || null, code || null, Number(c?.invite_quota ?? 3), nowIso()]);
    if (r?.changes) { memberCache = null; await markActive(uid, false); }
    return !!r?.changes;
  }
  /** map redeemed `beta:<cohort>` launch codes to cohort membership (idempotent; runs on reads + periodically) */
  let syncing = null;
  const syncInvites = () => (syncing ||= (async () => {
    const rows = await db.all("SELECT u.user_id, u.code, i.note, i.created_by, i.waitlist_id FROM launch_invite_uses u JOIN launch_invites i ON i.code=u.code LEFT JOIN beta_members m ON m.user_id=u.user_id WHERE i.note LIKE 'beta:%' AND m.user_id IS NULL LIMIT 1000");
    for (const r of rows) {
      const cid = String(r.note).slice(5);
      if (await db.get("SELECT 1 x FROM beta_cohorts WHERE id=$1", [cid])) await join(r.user_id, cid, r.waitlist_id ? "waitlist" : "invite", r.created_by, r.code);
    }
    return rows.length;
  })().finally(() => { syncing = null; }));

  /* ---------- members, quotas, badge, activity ---------- */
  let memberCache = null;
  const memberIds = async () => {
    if (memberCache && memberCache.at > Date.now() - 60e3) return memberCache.set;
    memberCache = { at: Date.now(), set: new Set((await db.all("SELECT user_id FROM beta_members")).map((r) => r.user_id)) };
    return memberCache.set;
  };
  async function markActive(uid, meaningful) {
    if (!uid || !(await memberIds()).has(uid)) return;
    const t = nowIso();
    await db.run("INSERT INTO beta_activity(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING", [uid, dayOf(t)]);
    await db.run("UPDATE beta_members SET last_active_at=$1 WHERE user_id=$2", [t, uid]);
    if (meaningful) await db.run("UPDATE beta_members SET activated_at=$1 WHERE user_id=$2 AND activated_at IS NULL", [t, uid]);
  }
  for (const ev of ["POST_CREATED", "COMMENT_CREATED", "POST_REACTED", "USER_FOLLOWED"]) bus.on(ev, (e) => markActive(e.actor, true).catch(() => { }));
  async function me(user) {
    await seed(); await syncInvites();
    const m = await db.get("SELECT * FROM beta_members WHERE user_id=$1", [user.id]);
    const base = { member: !!m, staff: isStaff(user), mode: launch()?.mode?.() || "open", feedback: true, survey: await surveyDue(user, m) };
    if (!m) return base;
    const c = await cohortClient(await getCohort(m.cohort_id));
    const invites = (await db.all("SELECT code, uses, max_uses, expires_at, revoked, created_at FROM launch_invites WHERE note=$1 AND created_by=$2 ORDER BY created_at DESC LIMIT 100", ["beta:" + c.id, user.id]))
      .map((r) => ({ code: r.code, used: Number(r.uses) >= Number(r.max_uses), revoked: !!r.revoked, expiresAt: r.expires_at, createdAt: r.created_at }));
    return { ...base, cohort: { id: c.id, name: c.name, wave: c.wave, status: c.status }, badge: !!m.badge, joinedAt: m.joined_at, quota: Number(m.quota), invitesUsed: Number(m.invites_used), invitesLeft: Math.max(0, Number(m.quota) - Number(m.invites_used)), invites };
  }
  async function memberInvite(user) {
    hitOr("invite", "beta:" + user.id);
    const m = await db.get("SELECT * FROM beta_members WHERE user_id=$1", [user.id]);
    if (!m) throw fail(403, "not_beta", "الدعوات متاحة لمختبري النسخة التجريبية");
    const c = await cohortClient(await getCohort(m.cohort_id));
    if (c.status !== "open") throw fail(409, "wave_not_open", "الموجة مغلقة حالياً");
    if (Number(m.invites_used) >= Number(m.quota)) throw fail(429, "quota_exhausted", "استخدمت كل دعواتك");
    if (c.room <= 0) throw fail(409, "wave_full", "اكتمل عدد هذه الموجة");
    const r = await db.run("UPDATE beta_members SET invites_used=invites_used+1 WHERE user_id=$1 AND invites_used < quota", [user.id]);
    if (!r?.changes) throw fail(429, "quota_exhausted", "استخدمت كل دعواتك");
    const code = await launch().mkInvite({ by: user.id, maxUses: 1, days: 30, note: "beta:" + c.id });
    return { code, invitesLeft: Math.max(0, Number(m.quota) - Number(m.invites_used) - 1) };
  }
  async function badge(handle) {
    const u = await db.get("SELECT id FROM users WHERE LOWER(handle)=LOWER($1)", [String(handle).slice(0, 40)]); if (!u) throw E.nf();
    const m = await db.get("SELECT m.badge, c.wave, c.name FROM beta_members m JOIN beta_cohorts c ON c.id=m.cohort_id WHERE m.user_id=$1", [u.id]);
    return m && Number(m.badge) ? { badge: true, label: "مختبر تجريبي", wave: Number(m.wave), cohort: m.name } : { badge: false };
  }

  /* ---------- feedback + triage ---------- */
  function device(d = {}) {
    const o = typeof d === "object" && d ? d : {};
    const pick = (k, n) => (o[k] === undefined || o[k] === null ? undefined : String(o[k]).slice(0, n));
    return { ua: pick("ua", 200), platform: pick("platform", 40), lang: pick("lang", 16), screen: pick("screen", 20), viewport: pick("viewport", 20), dpr: pick("dpr", 6), conn: pick("conn", 12), memory: pick("memory", 6), standalone: o.standalone ? 1 : 0, piBrowser: o.piBrowser ? 1 : 0, release: pick("release", 20) };
  }
  const fbClient = (f, extra = {}) => ({ id: f.id, kind: f.kind, text: f.text, status: f.status, statusLabel: F_LABEL[f.status] || f.status, priority: f.priority, route: f.route || null, mediaId: f.media_id || null, screenshot: f.media_id ? "/api/media/" + f.media_id : null, device: parse(f.device, {}), release: f.release || null, cohortId: f.cohort_id || null, assignee: f.assignee || null, lastBy: f.last_by || null, createdAt: f.created_at, updatedAt: f.updated_at, ...extra });
  async function sendFeedback(user, b = {}, req) {
    hitOr("report", "betafb:" + user.id);
    const kind = KINDS.includes(b.kind) ? b.kind : null; if (!kind) throw E.bad("اختر نوع الملاحظة: خطأ أو فكرة أو أخرى");
    const text = str(b.text, 4000, { required: true, min: 3 });
    let mediaId = null;
    if (b.mediaId) {
      const m = await db.get("SELECT id, owner, kind FROM media WHERE id=$1", [String(b.mediaId).slice(0, 64)]);
      if (!m || m.owner !== user.id) throw fail(400, "attachment_invalid", "لقطة الشاشة غير موجودة أو ليست لك");
      mediaId = m.id;
    }
    const dev = device({ ...(b.device || {}), ua: b.device?.ua || req?.headers?.["user-agent"] });
    const m = await db.get("SELECT cohort_id FROM beta_members WHERE user_id=$1", [user.id]);
    const fid = id("bf"), t = nowIso();
    await db.run("INSERT INTO beta_feedback(id,user_id,cohort_id,kind,text,media_id,route,device,release,status,priority,last_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'new',$10,'user',$11,$11)",
      [fid, user.id, m?.cohort_id || null, kind, text, mediaId, str(b.route, 200) || null, JSON.stringify(dev), dev.release || null, kind === "bug" ? "normal" : "low", t]);
    await markActive(user.id, false);
    return { feedback: fbClient(await db.get("SELECT * FROM beta_feedback WHERE id=$1", [fid])) };
  }
  async function loadFb(user, fid) {
    const f = await db.get("SELECT * FROM beta_feedback WHERE id=$1", [String(fid).slice(0, 64)]);
    if (!f || (f.user_id !== user.id && !isStaff(user))) throw E.nf();
    return f;
  }
  async function fbView(user, fid) {
    const f = await loadFb(user, fid);
    const msgs = await db.all("SELECT m.*, u.handle FROM beta_feedback_msgs m LEFT JOIN users u ON u.id=m.author_id WHERE m.feedback_id=$1 ORDER BY m.created_at, m.id", [f.id]);
    const author = isStaff(user) ? await db.get("SELECT handle, name FROM users WHERE id=$1", [f.user_id]) : null;
    return { feedback: fbClient(f, author ? { author: { handle: author.handle, name: author.name } } : {}), messages: msgs.map((x) => ({ id: x.id, staff: !!x.staff, by: x.staff ? (isStaff(user) ? "@" + x.handle : "فريق مجتمع بلس") : "أنت", text: x.text, createdAt: x.created_at })) };
  }
  async function fbReply(user, fid, b = {}) {
    const f = await loadFb(user, fid);
    const asStaff = isStaff(user) && f.user_id !== user.id;
    const text = str(b.text, 4000, { required: true, min: 1 });
    const t = nowIso();
    await db.run("INSERT INTO beta_feedback_msgs(id,feedback_id,author_id,staff,text,created_at) VALUES($1,$2,$3,$4,$5,$6)", [id("bm"), f.id, user.id, asStaff ? 1 : 0, text, t]);
    await db.run("UPDATE beta_feedback SET last_by=$1, updated_at=$2, status=CASE WHEN $3=1 AND status='new' THEN 'triaged' ELSE status END WHERE id=$4", [asStaff ? "staff" : "user", t, asStaff ? 1 : 0, f.id]);
    if (asStaff) await notify(f.user_id, "beta_feedback_reply", { ref: f.id });
    return fbView(user, f.id);
  }
  async function triage(user, fid, b = {}) {
    const f = await loadFb(user, fid);
    const status = b.status !== undefined ? (F_STATUS.includes(b.status) ? b.status : null) : f.status;
    const priority = b.priority !== undefined ? (PRIORITY.includes(b.priority) ? b.priority : null) : f.priority;
    if (!status || !priority) throw E.bad("حالة أو أولوية غير صالحة");
    let assignee = f.assignee;
    if (b.assignee !== undefined) {
      if (!b.assignee) assignee = null;
      else { const a = await db.get("SELECT id, role FROM users WHERE LOWER(handle)=LOWER($1)", [String(b.assignee).replace(/^@/, "")]); if (!a || !STAFF.includes(a.role)) throw E.bad("المسؤول يجب أن يكون من الفريق"); assignee = a.id; }
    }
    await db.run("UPDATE beta_feedback SET status=$1, priority=$2, assignee=$3, updated_at=$4 WHERE id=$5", [status, priority, assignee, nowIso(), f.id]);
    ctx.audit?.("beta_feedback_triaged", user.id, status, f.id);
    if (b.reply) return fbReply(user, f.id, { text: b.reply });
    if (status !== f.status && f.user_id !== user.id) await notify(f.user_id, "beta_feedback_reply", { ref: f.id });
    return fbView(user, f.id);
  }
  async function myFeedback(user) {
    return { items: (await db.all("SELECT * FROM beta_feedback WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [user.id])).map((f) => fbClient(f)), kinds: KINDS, statuses: F_STATUS.map((s) => ({ key: s, label: F_LABEL[s] })) };
  }
  async function board(q = {}) {
    const where = [], args = [];
    if (F_STATUS.includes(q.status)) { args.push(q.status); where.push(`f.status=$${args.length}`); }
    if (KINDS.includes(q.kind)) { args.push(q.kind); where.push(`f.kind=$${args.length}`); }
    if (q.cohort) { args.push(String(q.cohort).slice(0, 64)); where.push(`f.cohort_id=$${args.length}`); }
    const rows = await db.all(`SELECT f.*, u.handle FROM beta_feedback f LEFT JOIN users u ON u.id=f.user_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE f.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, f.created_at DESC LIMIT 300`, args);
    const columns = {}; for (const s of F_STATUS) columns[s] = 0;
    for (const r of await db.all("SELECT status, COUNT(*) n FROM beta_feedback GROUP BY status")) columns[r.status] = Number(r.n);
    return { items: rows.map((f) => fbClient(f, { author: f.handle ? "@" + f.handle : null })), columns, statuses: F_STATUS.map((s) => ({ key: s, label: F_LABEL[s] })), priorities: PRIORITY, kinds: KINDS };
  }

  /* ---------- micro-surveys ---------- */
  async function surveyDue(user, m) {
    const age = (Date.parse(nowIso()) - Date.parse(m?.joined_at || user.created_at)) / 864e5;
    if (age < 2) return null; // let people try the app first
    for (const kind of ["nps", "csat"]) {
      const s = await db.get("SELECT * FROM beta_survey_state WHERE user_id=$1 AND kind=$2", [user.id, kind]);
      const last = Math.max(Date.parse(s?.answered_at || 0) || 0, Date.parse(s?.shown_at || 0) || 0);
      if (!last || Date.parse(nowIso()) - last > SURVEY_DAYS * 864e5) return { kind, question: kind === "nps" ? "ما مدى احتمال أن توصي بمجتمع بلس لصديق؟" : "ما مدى رضاك عن تجربتك هذا الأسبوع؟", min: kind === "nps" ? 0 : 1, max: kind === "nps" ? 10 : 5 };
    }
    return null;
  }
  async function surveyShown(user, kind, dismissed) {
    if (!["nps", "csat"].includes(kind)) throw E.bad();
    await db.run("INSERT INTO beta_survey_state(user_id,kind,shown_at,dismissed) VALUES($1,$2,$3,$4) ON CONFLICT (user_id,kind) DO UPDATE SET shown_at=$3, dismissed=$4", [user.id, kind, nowIso(), dismissed ? 1 : 0]);
    return { ok: true };
  }
  async function answerSurvey(user, b = {}) {
    hitOr("report", "betasv:" + user.id);
    const kind = ["nps", "csat"].includes(b.kind) ? b.kind : null; if (!kind) throw E.bad("نوع الاستبيان غير صالح");
    const score = Math.floor(Number(b.score)), [lo, hi] = kind === "nps" ? [0, 10] : [1, 5];
    if (!Number.isFinite(score) || score < lo || score > hi) throw E.bad(`الدرجة بين ${lo} و${hi}`);
    const s = await db.get("SELECT answered_at FROM beta_survey_state WHERE user_id=$1 AND kind=$2", [user.id, kind]);
    if (s?.answered_at && dayOf(s.answered_at) === dayOf(nowIso())) throw fail(409, "already_answered", "شكراً، سجلنا إجابتك اليوم");
    const m = await db.get("SELECT cohort_id FROM beta_members WHERE user_id=$1", [user.id]);
    const t = nowIso();
    await db.run("INSERT INTO beta_surveys(id,user_id,cohort_id,kind,score,comment,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("bs"), user.id, m?.cohort_id || null, kind, score, str(b.comment, 1000) || null, t]);
    await db.run("INSERT INTO beta_survey_state(user_id,kind,shown_at,answered_at,dismissed) VALUES($1,$2,$3,$3,0) ON CONFLICT (user_id,kind) DO UPDATE SET answered_at=$3, shown_at=$3, dismissed=0", [user.id, kind, t]);
    return { ok: true };
  }
  const npsOf = (scores) => { if (!scores.length) return null; const p = scores.filter((s) => s >= 9).length, d = scores.filter((s) => s <= 6).length; return Math.round(((p - d) / scores.length) * 100); };

  /* ---------- dashboard ---------- */
  async function dashboard(q = {}) {
    await seed(); await syncInvites();
    const cid = q.cohort ? (await getCohort(q.cohort)).id : null;
    const members = await db.all(`SELECT user_id, joined_at, activated_at, last_active_at FROM beta_members ${cid ? "WHERE cohort_id=$1" : ""}`, cid ? [cid] : []);
    const ids = members.map((m) => m.user_id);
    const now = Date.parse(nowIso());
    const acts = ids.length ? await db.all(`SELECT user_id, day FROM beta_activity WHERE user_id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const byUser = new Map(); for (const a of acts) (byUser.get(a.user_id) || byUser.set(a.user_id, new Set()).get(a.user_id)).add(a.day);
    const plus = (iso, d) => dayOf(Date.parse(iso) + d * 864e5);
    const ret = (d) => { const elig = members.filter((m) => now - Date.parse(m.joined_at) >= d * 864e5); if (!elig.length) return { rate: null, eligible: 0 }; const back = elig.filter((m) => byUser.get(m.user_id)?.has(plus(m.joined_at, d))).length; return { rate: Math.round((back / elig.length) * 100), eligible: elig.length, returned: back }; };
    const activated = members.filter((m) => m.activated_at && Date.parse(m.activated_at) - Date.parse(m.joined_at) <= 7 * 864e5).length;
    const since = new Date(now - 7 * 864e5).toISOString();
    const errs = ids.length ? await db.all(`SELECT message, url, release, count, last_at FROM client_errors WHERE user_id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")}) ORDER BY count DESC LIMIT 200`, ids) : [];
    const errors = { total: errs.reduce((s, e) => s + Number(e.count || 0), 0), last7d: errs.filter((e) => e.last_at > since).reduce((s, e) => s + Number(e.count || 0), 0), affectedShare: null, top: errs.slice(0, 5).map((e) => ({ message: String(e.message).slice(0, 160), count: Number(e.count), release: e.release || null, lastAt: e.last_at })) };
    const rum = await db.all("SELECT name, value FROM rum_metrics WHERE at > $1 AND name IN ('LCP','INP','CLS')", [since]);
    const vit = {}; for (const r of rum) (vit[r.name] ||= []).push(Number(r.value));
    const webVitals = Object.fromEntries(Object.entries(vit).map(([k, v]) => { v.sort((a, b) => a - b); return [k, { p75: Math.round(v[Math.floor(v.length * 0.75)] * 1000) / 1000, n: v.length }]; }));
    const sv = await db.all(`SELECT kind, score FROM beta_surveys ${cid ? "WHERE cohort_id=$1" : ""}`, cid ? [cid] : []);
    const nps = sv.filter((s) => s.kind === "nps").map((s) => Number(s.score)), csat = sv.filter((s) => s.kind === "csat").map((s) => Number(s.score));
    const fb = await db.all(`SELECT * FROM beta_feedback WHERE status NOT IN ('done','wont_fix','duplicate') ${cid ? "AND cohort_id=$1" : ""} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at DESC LIMIT 5`, cid ? [cid] : []);
    const fbKinds = {}; for (const r of await db.all(`SELECT kind, COUNT(*) n FROM beta_feedback ${cid ? "WHERE cohort_id=$1" : ""} GROUP BY kind`, cid ? [cid] : [])) fbKinds[r.kind] = Number(r.n);
    return {
      cohort: cid, mode: launch()?.mode?.() || "open", members: members.length,
      activation: { activated, rate: members.length ? Math.round((activated / members.length) * 100) : null, rule: "أول تفاعل حقيقي (منشور أو تعليق أو تفاعل أو متابعة) خلال ٧ أيام من الانضمام" },
      retention: { d1: ret(1), d7: ret(7) }, activeToday: members.filter((m) => byUser.get(m.user_id)?.has(dayOf(now))).length,
      errors, webVitals, surveys: { nps: npsOf(nps), npsAnswers: nps.length, csat: csat.length ? Math.round((csat.reduce((a, b) => a + b, 0) / csat.length) * 10) / 10 : null, csatAnswers: csat.length },
      feedback: { byKind: fbKinds, top: fb.map((f) => fbClient(f)) }
    };
  }

  /* ---------- kill switch + cohort targeting on feature flags ---------- */
  let rulesCache = null;
  const rules = async () => { if (rulesCache && rulesCache.at > Date.now() - 15e3) return rulesCache.rows; rulesCache = { at: Date.now(), rows: await db.all("SELECT * FROM beta_flag_rules") }; return rulesCache.rows; };
  async function applyRules(user, flags) {
    const rs = await rules(); if (!rs.length) return flags;
    const out = { ...flags };
    const mine = user ? (await db.get("SELECT cohort_id FROM beta_members WHERE user_id=$1", [user.id]))?.cohort_id : null;
    for (const r of rs) {
      if (Number(r.killed)) { out[r.flag_key] = false; continue; }
      if (mine && parse(r.cohorts, []).includes(mine)) out[r.flag_key] = true;
    }
    return out;
  }
  const ops = ctx.services.ops;
  if (ops?.flagsFor && !ops.flagsFor.__mpBeta) { const orig = ops.flagsFor; ops.flagsFor = Object.assign(async (u) => applyRules(u, await orig(u)), { __mpBeta: true }); }
  const fr = R.routes.find((r) => r.method === "GET" && r.re.test("/api/flags"));
  if (fr && !fr.handler.__mpBeta) { const orig = fr.handler; fr.handler = Object.assign(async (req, res) => { const out = await orig(req, res); return out?.flags ? { ...out, flags: await applyRules(req.user, out.flags) } : out; }, orig, { __mpBeta: true }); }
  async function flagRules() {
    const flags = await db.all("SELECT key, description, enabled, rollout FROM feature_flags ORDER BY key");
    const rs = new Map((await db.all("SELECT * FROM beta_flag_rules")).map((r) => [r.flag_key, r]));
    return { items: flags.map((f) => { const r = rs.get(f.key); return { key: f.key, description: f.description, enabled: !!Number(f.enabled), rollout: Number(f.rollout), cohorts: parse(r?.cohorts, []), killed: !!Number(r?.killed || 0), killReason: r?.kill_reason || null, killedAt: r?.killed_at || null }; }) };
  }
  async function setRule(user, key, b = {}) {
    if (!/^[a-z0-9_]{2,40}$/.test(key) || !(await db.get("SELECT 1 x FROM feature_flags WHERE key=$1", [key]))) throw E.nf("الميزة غير موجودة");
    const prev = await db.get("SELECT * FROM beta_flag_rules WHERE flag_key=$1", [key]);
    let cohorts = parse(prev?.cohorts, []);
    if (b.cohorts !== undefined) {
      if (!Array.isArray(b.cohorts)) throw E.bad();
      cohorts = [];
      for (const c of b.cohorts.slice(0, 20)) { if (!(await db.get("SELECT 1 x FROM beta_cohorts WHERE id=$1", [String(c)]))) throw E.bad("موجة غير موجودة"); cohorts.push(String(c)); }
    }
    const killed = b.killed !== undefined ? (b.killed ? 1 : 0) : Number(prev?.killed || 0);
    const reason = killed ? (str(b.reason, 300) || prev?.kill_reason || null) : null;
    if (killed && !reason) throw E.bad("اكتب سبب الإيقاف الطارئ");
    const t = nowIso();
    await db.run("INSERT INTO beta_flag_rules(flag_key,cohorts,killed,kill_reason,killed_by,killed_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (flag_key) DO UPDATE SET cohorts=$2, killed=$3, kill_reason=$4, killed_by=$5, killed_at=$6, updated_at=$7",
      [key, JSON.stringify(cohorts), killed, reason, killed ? user.id : null, killed ? (Number(prev?.killed) ? prev.killed_at : t) : null, t]);
    rulesCache = null; ctx.cache?.del?.("flags");
    ctx.audit?.(killed ? "beta_flag_killed" : "beta_flag_rule", user.id, reason || cohorts.join(","), key);
    return flagRules();
  }

  /* ---------- routes ---------- */
  R.get("/api/beta/me", A(async (req) => me(req.user)));
  R.post("/api/beta/invites", A(async (req) => memberInvite(req.user)));
  R.put("/api/beta/badge", A(async (req) => { const r = await db.run("UPDATE beta_members SET badge=$1 WHERE user_id=$2", [req.body?.show ? 1 : 0, req.user.id]); if (!r?.changes) throw fail(403, "not_beta", "لست ضمن المختبرين"); return { ok: true, badge: !!req.body?.show }; }));
  R.get("/api/beta/badge/:handle", async (req) => badge(req.params.handle));
  R.post("/api/beta/ping", A(async (req) => { await markActive(req.user.id, false); return { ok: true }; }));
  R.post("/api/beta/feedback", A(async (req) => sendFeedback(req.user, req.body, req)));
  R.get("/api/beta/feedback", A(async (req) => myFeedback(req.user)));
  R.get("/api/beta/feedback/:id", A(async (req) => fbView(req.user, req.params.id)));
  R.post("/api/beta/feedback/:id/reply", A(async (req) => fbReply(req.user, req.params.id, req.body)));
  R.post("/api/beta/survey", A(async (req) => answerSurvey(req.user, req.body)));
  R.post("/api/beta/survey/shown", A(async (req) => surveyShown(req.user, req.body?.kind, !!req.body?.dismissed)));
  R.get("/api/admin/beta/cohorts", staff(async () => cohorts()));
  R.post("/api/admin/beta/cohorts", admin(async (req) => saveCohort(req.user, null, req.body)));
  R.put("/api/admin/beta/cohorts/:id", admin(async (req) => saveCohort(req.user, req.params.id, req.body)));
  R.post("/api/admin/beta/cohorts/:id/open", admin(async (req) => openCohort(req.user, req.params.id, req.body)));
  R.post("/api/admin/beta/cohorts/:id/close", admin(async (req) => closeCohort(req.user, req.params.id)));
  R.post("/api/admin/beta/cohorts/:id/invite", admin(async (req) => inviteWaitlist(req.user, req.params.id, req.body)));
  R.post("/api/admin/beta/cohorts/:id/members", admin(async (req) => addMembers(req.user, req.params.id, req.body)));
  R.get("/api/admin/beta/feedback", staff(async (req) => board(req.query)));
  R.put("/api/admin/beta/feedback/:id", staff(async (req) => triage(req.user, req.params.id, req.body)));
  R.get("/api/admin/beta/dashboard", staff(async (req) => dashboard(req.query)));
  R.get("/api/admin/beta/flags", admin(async () => flagRules()));
  R.put("/api/admin/beta/flags/:key", admin(async (req) => setRule(req.user, req.params.key, req.body)));

  if (opts.jobs !== false && ctx.scheduler?.every) ctx.scheduler.every?.("betaSync", 5 * 60e3, () => syncInvites());
  return { syncInvites, markActive, dashboard, applyRules, memberIds, seed, KINDS, F_STATUS };
};
