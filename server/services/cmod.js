/* Community Moderation (Phase 17): unified review queue (pending posts, reports, join requests),
 * automatic rules (blocked words, links, new accounts, abusive-content classifier), warnings,
 * temporary mutes and bans, private moderator notes, a transparent exportable moderation log,
 * and batched moderator notifications. */
const { E, str, oneOf, id, now } = require("../lib/core");
const Tox = require("../lib/toxicity");
const MOD = ["owner", "admin", "moderator"];
const CS = require("../lib/community-settings");
const CATEGORY = { identity_updated: "settings", settings_updated: "settings", automod_updated: "settings", channel_created: "channels", channel_deleted: "channels", channel_updated: "channels", partner_accepted: "integrations", role_changed: "members", role_saved: "roles", role_deleted: "roles", role_granted: "roles", role_revoked: "roles", join_approve: "members", join_reject: "members", invite_created: "members", invite_revoked: "members", member_invited: "members", transfer_requested: "danger", transfer_cancelled: "danger", transfer_accepted: "danger", transfer_declined: "danger", archived: "danger", restored: "danger", lockdown: "danger", lockdown_lifted: "danger", exported: "danger", note: "moderation", note_deleted: "moderation", wiki_revert: "knowledge" };
/* CSV cells that start with = + - @ TAB CR are read as formulas by spreadsheet apps: prefix them with ' (OWASP) */
const csvCell = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
const DAY = 864e5;
const LABEL = { approve: "قبول منشور", reject: "رفض منشور", remove: "حذف محتوى", dismiss: "رفض بلاغ", warn: "إنذار", mute: "كتم مؤقت", unmute: "إلغاء كتم", ban: "حظر", unban: "إلغاء حظر", join_approve: "قبول عضو", join_reject: "رفض طلب انضمام", automod_queue: "تحويل آلي للمراجعة", automod_reject: "رفض آلي", automod_flag: "بلاغ آلي", automod_penalty: "عقوبة آلية (سُلَّم)", autoguard_strike: "الحارس التلقائي: تحذير", autoguard_lock: "الحارس التلقائي: إيقاف عن الكتابة", appeal_accepted: "قبول استئناف", appeal_rejected: "رفض استئناف", claim: "تولّي عنصر", assign: "إسناد عنصر", macro_saved: "حفظ قالب", macro_deleted: "حذف قالب", note: "ملاحظة مشرف", identity_updated: "تعديل الهوية", channel_created: "إنشاء قناة", automod_updated: "تعديل القواعد الآلية", partner_accepted: "شراكة", wiki_revert: "استرجاع نسخة ويكي", settings_updated: "تعديل الإعدادات", role_changed: "تغيير دور", role_saved: "حفظ دور", role_deleted: "حذف دور", role_granted: "منح دور", role_revoked: "سحب دور", note_deleted: "حذف ملاحظة", channel_deleted: "أرشفة قناة", channel_updated: "تعديل قناة" };

module.exports = (ctx) => {
  const { db, router: R, bus } = ctx; const A = ctx.requireUser;
  const role = async (cid, uid) => (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role;
  const P = ctx.cperm;
  const needMod = async (cid, uid, key = "queue_review") => (await P.need(cid, uid, key, "للمشرفين فقط")).role;
  /* one audit log for moderation AND settings: category + before→after diff of the changed fields */
  async function log(cid, actor, { post = null, user = null, action, reason = null, meta = null, category = null, diff = null }) {
    const at = now();
    await db.run("INSERT INTO mod_actions(id,community,actor,target_user,target_post,action,reason,meta,created_at,category,diff) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [id("ma"), cid, actor, user, post, action, reason ? String(reason).slice(0, 300) : null, meta, at, category || CATEGORY[action] || "moderation", diff && Object.keys(diff).length ? diff : null]);
    ctx.bus.emit("COMMUNITY_LOGGED", { community: cid, actor, action, post, user, at }); // v2.60: insight counters (moderation health, automod caught)
  }

  /* ---------- automatic rules ---------- */
  const defaults = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "queue", action: "queue" };
  /* v2.59: legacy rules — byte-for-byte the v2.58 behaviour (asserted by the golden set in server/test/automod-v2.test.js) */
  async function legacyAutomod(community, user, r, text) {
    if (MOD.includes(r)) return null;
    const cfg = { ...defaults, ...(community.settings?.automod || {}) }, reasons = []; let hard = false;
    const low = Tox.norm(text);
    const words = (cfg.words || []).filter(w => w && low.includes(Tox.norm(w))); if (words.length) reasons.push(`كلمات محظورة: ${words.slice(0, 3).join("، ")}`);
    if (cfg.blockLinks && /https?:\/\/|www\./i.test(text)) reasons.push("يحتوي رابطاً");
    if (cfg.newAccountDays > 0) { const u = await db.get("SELECT created_at FROM users WHERE id=$1", [user.id]); if (Date.now() - new Date(u.created_at) < cfg.newAccountDays * DAY) reasons.push(`حساب أحدث من ${cfg.newAccountDays} أيام`); }
    if (cfg.toxicity !== "off") { const t = Tox.score(text); if (t.score >= 0.6) { reasons.push(`محتوى مسيء محتمل (${Math.round(t.score * 100)}٪)`); if (cfg.toxicity === "reject" && t.score >= 0.8) hard = true; } }
    if (!reasons.length) return null;
    const action = hard || cfg.action === "reject" ? "reject" : "queue";
    if (action === "reject") await log(community.id, "system", { user: user.id, action: "automod_reject", reason: reasons.join("، ") });
    return { action, reasons, message: "القواعد الآلية للمجتمع منعت هذا المنشور: " + reasons.join("، ") };
  }
  /** v2.59: legacy rules (posts) + automod v2 rules (services/cmod2.js; all OFF by default). With no v2 rule enabled the
   * result is exactly legacyAutomod's. kind "comment" runs only the v2 rules, and only when «التعليقات» is on. */
  async function automod(community, user, r, text, kind = "post") {
    if (MOD.includes(r)) return null;
    const guard = await ctx.services.cmod2?.guardCheck?.(community, user, text, kind); // v2.62: the guard first; its hits never reach the ladder
    if (guard) return guard;
    const legacy = kind === "post" ? await legacyAutomod(community, user, r, text) : null;
    const v2 = await ctx.services.cmod2?.evalV2(community, user, text, kind);
    if (!v2) { if (legacy?.action === "reject") await ctx.services.cmod2?.ladder(community, user.id); return legacy; }
    const rules = [...new Set(v2.matches.map(m => m.rule))], v2reasons = v2.matches.map(m => m.reason);
    if (legacy?.action === "reject") { await ctx.services.cmod2?.ladder(community, user.id); return { ...legacy, rules }; }
    if (v2.action === "reject") {
      await log(community.id, "system", { user: user.id, action: "automod_reject", reason: v2reasons.join("، "), meta: { rules, kind } });
      await ctx.services.cmod2?.ladder(community, user.id);
      return { action: "reject", reasons: v2reasons, rules, message: (kind === "comment" ? "القواعد الآلية للمجتمع منعت هذا التعليق: " : "القواعد الآلية للمجتمع منعت هذا المنشور: ") + v2reasons.join("، ") };
    }
    const reasons = [...(legacy?.reasons || []), ...v2reasons];
    if (legacy?.action === "queue" || v2.action === "queue") return { action: "queue", reasons, rules, message: "القواعد الآلية للمجتمع: " + reasons.join("، ") };
    return { action: "report", reasons, rules, message: null };
  }
  R.get("/api/communities/:id/automod", A(async (req) => { await needMod(req.params.id, req.user.id, "view_automod"); const c = await db.get("SELECT settings FROM communities WHERE id=$1", [req.params.id]); return { automod: { ...defaults, ...(c.settings?.automod || {}) }, publicLog: !!c.settings?.publicModLog }; }));
  R.patch("/api/communities/:id/automod", A(async (req) => {
    await needMod(req.params.id, req.user.id, "view_automod"); await P.need(req.params.id, req.user.id, "manage_automod", "للمالك والمديرين");
    const b = req.body; let automod = CS.automodOf(b);
    const res = await CS.mutate(db, req.params.id, async (s) => { automod = CS.keepV2(s.automod, automod); return { ...s, automod, publicModLog: b.publicLog !== undefined ? !!b.publicLog : !!s.publicModLog }; }); if (!res) throw E.nf(); // v2.59: a legacy body never wipes the v2 rules
    await log(req.params.id, req.user.id, { action: "automod_updated", diff: CS.diff({ automod: res.before.automod, publicModLog: res.before.publicModLog }, { automod: res.after.automod, publicModLog: res.after.publicModLog }) });
    return { automod };
  }));
  /* abusive comments in communities become reports in the queue */
  bus.on("COMMENT_CREATED", async (e) => {
    const p = await db.get("SELECT community FROM posts WHERE id=$1", [e.post]); if (!p?.community) return;
    const c = await db.get("SELECT text FROM comments WHERE id=$1", [e.comment]); const t = Tox.score(c?.text || "");
    if (t.score >= 0.6) await db.run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,'comment',$3,'system','open',$4)", [id("rp"), e.comment, `مسيء آلياً ${Math.round(t.score * 100)}٪: ${t.reasons.join(", ")}`, now()]);
  });

  /* ---------- unified queue ---------- */
  async function queue(cid) {
    const posts = await db.all("SELECT p.*, u.name, u.handle, u.avatar, u.color, u.created_at ucreated FROM posts p JOIN users u ON u.id=p.author WHERE p.community=$1 AND p.status='pending' ORDER BY p.created_at", [cid]);
    const reasons = Object.fromEntries((posts.length ? await db.all(`SELECT target_post, reason FROM mod_actions WHERE action='automod_queue' AND target_post IN (${posts.map((_, i) => "$" + (i + 1)).join(",")})`, posts.map(p => p.id)) : []).map(x => [x.target_post, x.reason]));
    const reports = await db.all(`SELECT r.*, COALESCE(p.id, cp.id) post_id, COALESCE(p.text, c.text) body, COALESCE(p.author, c.author) author, u.name, u.handle, u.avatar, u.color FROM reports r
      LEFT JOIN posts p ON p.id=r.target AND p.community=$1 LEFT JOIN comments c ON c.id=r.target LEFT JOIN posts cp ON cp.id=c.post AND cp.community=$1
      LEFT JOIN users u ON u.id=COALESCE(p.author, c.author) WHERE r.status='open' AND (p.id IS NOT NULL OR cp.id IS NOT NULL) ORDER BY r.created_at`, [cid]);
    const comments = await db.all("SELECT c.id, c.post, c.text, c.author, c.created_at, u.name, u.handle, u.avatar, u.color FROM comments c JOIN posts p ON p.id=c.post JOIN users u ON u.id=c.author WHERE p.community=$1 AND c.status='pending' ORDER BY c.created_at", [cid]); // v2.59: held by an automod v2 rule
    const creasons = Object.fromEntries((comments.length ? await db.all(`SELECT target_post, reason FROM mod_actions WHERE action='automod_queue' AND target_post IN (${comments.map((_, i) => "$" + (i + 1)).join(",")})`, comments.map(c => c.id)) : []).map(x => [x.target_post, x.reason]));
    const joins = await db.all("SELECT m.user_id, m.joined_at, u.name, u.handle, u.avatar, u.color, u.created_at ucreated, j.answers FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN join_requests j ON j.community=m.community AND j.user_id=m.user_id WHERE m.community=$1 AND m.role='pending' ORDER BY m.joined_at", [cid]);
    const uids = [...new Set([...posts.map(p => p.author), ...comments.map(c => c.author), ...reports.map(r => r.author), ...joins.map(j => j.user_id)].filter(Boolean))];
    const mem = uids.length ? Object.fromEntries((await db.all(`SELECT user_id, role, warnings FROM memberships WHERE community=$1 AND user_id IN (${uids.map((_, i) => "$" + (i + 2)).join(",")})`, [cid, ...uids])).map(m => [m.user_id, m])) : {};
    const notes = uids.length ? Object.fromEntries((await db.all(`SELECT user_id, COUNT(*) n FROM mod_notes WHERE community=$1 AND user_id IN (${uids.map((_, i) => "$" + (i + 2)).join(",")}) GROUP BY user_id`, [cid, ...uids])).map(n => [n.user_id, Number(n.n)])) : {};
    const who = (uid, x) => ({ id: uid, name: x.name, handle: x.handle, avatar: x.avatar, color: x.color, warnings: mem[uid]?.warnings || 0, role: mem[uid]?.role || null, notes: notes[uid] || 0 });
    const items = [
      ...posts.map(p => ({ kind: "post", id: p.id, at: p.created_at, user: who(p.author, p), text: (p.title ? p.title + " — " : "") + p.text.slice(0, 400), reason: reasons[p.id] || "يتطلب موافقة", toxicity: Tox.score(p.text).score })),
      ...reports.map(r => ({ kind: "report", id: r.id, at: r.created_at, target: r.target, targetKind: r.kind, post: r.post_id, user: r.author ? who(r.author, r) : null, text: (r.body || "").slice(0, 400), reason: r.reason || "بلاغ", toxicity: Tox.score(r.body || "").score, auto: r.by_user === "system" })),
      ...comments.map(c => ({ kind: "comment", id: c.id, at: c.created_at, post: c.post, user: who(c.author, c), text: c.text.slice(0, 400), reason: creasons[c.id] || "تعليق ينتظر الموافقة", toxicity: Tox.score(c.text).score })),
      ...joins.map(j => ({ kind: "join", id: j.user_id, at: j.joined_at, user: { ...who(j.user_id, j), createdAt: j.ucreated }, answers: j.answers || [], reason: "طلب انضمام" }))
    ].sort((a, b) => (b.toxicity || 0) - (a.toxicity || 0) || (a.at > b.at ? 1 : -1));
    return { items, counts: { posts: posts.length, reports: reports.length, joins: joins.length, comments: comments.length } };
  }
  R.get("/api/communities/:id/modqueue", A(async (req) => { await needMod(req.params.id, req.user.id); return queue(req.params.id); }));
  R.post("/api/communities/:id/modqueue/act", A(async (req) => act(req.user, req.params.id, req.body || {})));
  /** one queue decision (also used by the v2.59 bulk endpoint). A claim held by ANOTHER moderator blocks it (409). */
  async function act(user, cid, body) {
    await needMod(cid, user.id); const { kind, action } = body, itemId = body.id, reason = str(body.reason, 300);
    const req = { user, body }; // keeps the v2.58 handler body below unchanged
    await ctx.services.cmod2?.guardClaim(cid, kind, itemId, user.id);
    if (kind === "comment") { // v2.59: a comment held by an automod v2 rule
      if (!["approve", "reject"].includes(action)) throw E.bad();
      const c = await db.get("SELECT c.*, p.community, p.author post_author FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [itemId]); if (!c || c.community !== cid || c.status !== "pending") throw E.nf();
      await P.need(cid, user.id, action === "reject" ? "remove_content" : "queue_review");
      const r = await db.run("UPDATE comments SET status=$1 WHERE id=$2 AND status='pending'", [action === "approve" ? "published" : "removed", itemId]); if (!r.changes) throw E.conflict("تمت معالجة هذا التعليق");
      if (action === "approve") { const parent = c.parent ? await db.get("SELECT author FROM comments WHERE id=$1", [c.parent]) : null; bus.emit("COMMENT_CREATED", { comment: c.id, post: c.post, postAuthor: c.post_author, parentAuthor: parent?.author, actor: c.author }); }
      await log(cid, user.id, { post: c.post, user: c.author, action, reason, meta: { comment: c.id } });
    } else if (kind === "post") {
      if (!["approve", "reject"].includes(action)) throw E.bad();
      const p = await db.get("SELECT author FROM posts WHERE id=$1 AND community=$2", [itemId, cid]); if (!p) throw E.nf();
      await ctx.services.communities.queueAction(req.user, cid, itemId, action);
      await log(cid, req.user.id, { post: itemId, user: p.author, action, reason });
    } else if (kind === "report") {
      const rp = await db.get("SELECT * FROM reports WHERE id=$1 AND status='open'", [itemId]); if (!rp) throw E.nf();
      let author = null;
      if (action === "remove") {
        if (rp.kind === "comment") { const c = await db.get("SELECT c.author, p.community FROM comments c JOIN posts p ON p.id=c.post WHERE c.id=$1", [rp.target]); if (c?.community !== cid) throw E.forbid(); author = c.author; await db.run("UPDATE comments SET status='removed' WHERE id=$1", [rp.target]); }
        else { const p = await db.get("SELECT author, community FROM posts WHERE id=$1", [rp.target]); if (p?.community !== cid) throw E.forbid(); author = p.author; await db.run("UPDATE posts SET status='removed' WHERE id=$1", [rp.target]); bus.emit("CONTENT_REMOVED", { user: p.author, post: rp.target, decision: reason || "مخالفة قواعد المجتمع" }); ctx.cache.del("feed:"); }
      } else if (action !== "dismiss") throw E.bad();
      await db.run("UPDATE reports SET status=$1, resolved_by=$2, resolved_at=$3 WHERE id=$4", [action === "remove" ? "actioned" : "dismissed", req.user.id, now(), rp.id]);
      await log(cid, req.user.id, { post: rp.kind === "post" ? rp.target : null, user: author, action, reason: reason || rp.reason, meta: { report: rp.id, kind: rp.kind } });
    } else if (kind === "join") {
      if (!["approve", "reject"].includes(action)) throw E.bad();
      await P.need(cid, req.user.id, "approve_requests");
      const m = await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, itemId]); if (m?.role !== "pending") throw E.nf();
      if (action === "approve") { await db.run("UPDATE memberships SET role='member', status='active' WHERE community=$1 AND user_id=$2 AND role='pending'", [cid, itemId]); bus.emit("COMMUNITY_JOINED", { community: cid, actor: itemId, approvedBy: req.user.id }); }
      else await db.run("DELETE FROM memberships WHERE community=$1 AND user_id=$2 AND role='pending'", [cid, itemId]);
      await ctx.services.communities.mevent(cid, itemId, action === "approve" ? "approve" : "reject", { by: req.user.id });
      await ctx.services.cadmin?.decideRequestRow(cid, itemId, action === "approve" ? "approved" : "rejected", req.user.id, reason); // v2.57: kept as history (was deleted)
      await log(cid, req.user.id, { user: itemId, action: action === "approve" ? "join_approve" : "join_reject", reason });
    } else throw E.bad();
    await ctx.services.cmod2?.clearClaim(cid, kind, itemId);
    return { ok: true };
  }

  /* ---------- discipline: warn, timed mute, ban ---------- */
  R.post("/api/communities/:id/members/:user/discipline", A(async (req) => discipline(req.user, req.params.id, req.params.user, req.body || {})));
  /** warn / timed mute / ban (route above, v2.59 macros and bulk). Same checks as v2.58: permission per action + strict rank. */
  async function discipline(user, cid, target, body) {
    const req = { user, body }; await needMod(cid, req.user.id);
    const m = await db.get("SELECT * FROM memberships WHERE community=$1 AND user_id=$2", [cid, target]); if (!m) throw E.nf();
    if (m.role === "owner") throw E.forbid();
    const action = oneOf(req.body.action, ["warn", "mute", "unmute", "ban", "unban"], null); if (!action) throw E.bad(); const reason = str(req.body.reason, 300);
    await P.need(cid, req.user.id, { warn: "warn", mute: "mute", unmute: "mute", ban: "ban", unban: "ban" }[action]);
    await P.needAct(cid, req.user.id, target, "لا يمكن معاقبة مشرف في رتبتك أو أعلى"); // strict hierarchy (a muted admin keeps an admin's rank)
    /* v2.62 T6: lifting a «الحارس التلقائي» lock needs the guard's liftMin base role (moderator | admin | owner); an unmute
     * also clears the active guard strikes when reset:true, or by default when the guard says resetOnLift (reset:false opts out) */
    let reset = false, lock = false;
    if (action === "unmute") {
      const C2 = ctx.services.cmod2, com = await db.get("SELECT * FROM communities WHERE id=$1", [cid]), g = C2?.guardOf?.(com) || null;
      lock = m.role === "muted" && !!(await C2?.guardLocked?.(cid, target));
      if (lock) { const need = g?.liftMin || "moderator", RANK = require("../lib/cperm").RANK; if ((RANK[await role(cid, req.user.id)] ?? -2) < RANK[need]) throw E.forbid({ moderator: "رفع إيقاف الحارس للمشرفين فأعلى", admin: "رفع إيقاف الحارس للمديرين فأعلى", owner: "رفع إيقاف الحارس للمالك فقط" }[need]); }
      reset = typeof req.body.reset === "boolean" ? req.body.reset : !!(g && g.resetOnLift);
    }
    await ctx.services.communities.sanction(req.user.id, cid, target, action, { hours: req.body.hours, reason, reset });
    if (action === "warn") await ctx.services.messaging.notify(target, "mod_warning", { actor: req.user.id, ref: cid });
    await log(cid, req.user.id, { user: target, action, reason, meta: action === "mute" ? { hours: +req.body.hours || 24 } : action === "unmute" && (lock || reset) ? { autoguardLock: lock, reset } : null });
    const after = await db.get("SELECT role, warnings, muted_until FROM memberships WHERE community=$1 AND user_id=$2", [cid, target]);
    return { member: after ? { role: after.role, warnings: after.warnings, mutedUntil: after.muted_until } : null };
  }
  async function unmuteDue() { // an expired mute gives the member back the role they held before it
    const t = now(), n = (await db.run("UPDATE memberships SET role=COALESCE(prev_role,'member'), status='active', prev_role=NULL, muted_until=NULL WHERE role='muted' AND muted_until IS NOT NULL AND muted_until < $1", [t])).changes;
    if (n) await db.run("UPDATE community_sanctions SET lifted_at=$1, lifted_by='system' WHERE kind='mute' AND lifted_at IS NULL AND until IS NOT NULL AND until < $1", [t]);
    return n;
  }

  /* ---------- private moderator notes ---------- */
  R.get("/api/communities/:id/members/:user/notes", A(async (req) => {
    await needMod(req.params.id, req.user.id, "view_notes");
    const notes = await db.all("SELECT n.id, n.text, n.created_at, n.author author_id, u.name author FROM mod_notes n JOIN users u ON u.id=n.author WHERE n.community=$1 AND n.user_id=$2 ORDER BY n.created_at DESC", [req.params.id, req.params.user]);
    const history = await db.all("SELECT action, reason, created_at FROM mod_actions WHERE community=$1 AND target_user=$2 ORDER BY created_at DESC LIMIT 30", [req.params.id, req.params.user]);
    const m = await db.get("SELECT role, warnings, muted_until, joined_at FROM memberships WHERE community=$1 AND user_id=$2", [req.params.id, req.params.user]);
    const gs = m ? await ctx.services.cmod2?.guardState?.({ id: req.params.id, settings: (await db.get("SELECT settings FROM communities WHERE id=$1", [req.params.id]))?.settings }, req.params.user) : null;
    return { notes, history: history.map(h => ({ ...h, label: LABEL[h.action] || h.action })), member: m ? { role: m.role, warnings: m.warnings, mutedUntil: m.muted_until, joinedAt: m.joined_at } : null, guard: gs ? { strikes: gs.strikes, max: gs.max, locked: gs.locked } : null };
  }));
  R.post("/api/communities/:id/members/:user/notes", A(async (req) => {
    await needMod(req.params.id, req.user.id, "view_notes"); const nid = id("mn");
    await db.run("INSERT INTO mod_notes(id,community,user_id,author,text,created_at) VALUES($1,$2,$3,$4,$5,$6)", [nid, req.params.id, req.params.user, req.user.id, str(req.body.text, 1000, { required: true }), now()]);
    return { id: nid };
  }));
  /* a moderator deletes their own notes, or notes written by someone of a LOWER rank; every deletion is logged */
  R.del("/api/communities/:id/notes/:note", A(async (req) => {
    await needMod(req.params.id, req.user.id, "view_notes");
    const n = await db.get("SELECT * FROM mod_notes WHERE id=$1 AND community=$2", [req.params.note, req.params.id]); if (!n) throw E.nf();
    if (n.author !== req.user.id) await P.needAct(req.params.id, req.user.id, n.author, "لا يمكنك حذف ملاحظة كتبها مشرف في رتبتك أو أعلى");
    await db.run("DELETE FROM mod_notes WHERE id=$1 AND community=$2", [n.id, req.params.id]);
    await log(req.params.id, req.user.id, { user: n.user_id, action: "note_deleted", meta: { author: n.author } });
    return { ok: true };
  }));

  /* ---------- transparent moderation log (JSON or CSV) ---------- */
  R.get("/api/communities/:id/modlog", A(async (req, res) => {
    const r = await role(req.params.id, req.user.id); const c = await db.get("SELECT settings FROM communities WHERE id=$1", [req.params.id]); if (!c) throw E.nf();
    const isMod = MOD.includes(r) && await P.has(req.params.id, req.user.id, "export_log"); if (!isMod && !(c.settings?.publicModLog && r && !["pending", "banned"].includes(r))) throw E.forbid();
    const rows = await db.all("SELECT a.*, u.name actor_name, t.name target_name FROM mod_actions a LEFT JOIN users u ON u.id=a.actor LEFT JOIN users t ON t.id=a.target_user WHERE a.community=$1 ORDER BY a.created_at DESC LIMIT 2000", [req.params.id]);
    const out = rows.map(a => ({ at: a.created_at, action: a.action, label: LABEL[a.action] || a.action, actor: a.actor === "system" ? (String(a.action).startsWith("autoguard") ? "الحارس التلقائي" : "النظام") : isMod ? a.actor_name : "مشرف", target: isMod ? a.target_name : a.target_user ? "عضو" : null, post: a.target_post, reason: a.reason }));
    if (req.query.format === "csv") {
      const csv = "\uFEFF" + ["time,action,actor,target,post,reason", ...out.map(o => [o.at, o.label, o.actor, o.target, o.post, o.reason].map(csvCell).join(","))].join("\r\n");
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="modlog-${req.params.id}.csv"`, "Cache-Control": "no-store" }); res.end(csv);
      return ctx.STREAM;
    }
    return { log: out };
  }));

  /* ---------- batched moderator notifications ---------- */
  async function digest() {
    const window = Math.floor(Date.now() / (6 * 3600e3));
    for (const c of await db.all("SELECT id FROM communities")) {
      const q = await queue(c.id); const total = q.items.length; if (!total) continue;
      const prefs = await ctx.services.cmod2?.prefsMap(c.id).catch(() => ({})) || {}; // v2.59: per-moderator cadence (default 6 h, as before)
      for (const m of await db.all("SELECT user_id FROM memberships WHERE community=$1 AND role IN ('owner','admin','moderator')", [c.id])) {
        const cad = prefs[m.user_id]?.digest || "6h"; if (cad === "off") continue;
        const ins = await db.run("INSERT INTO reminder_log(event,user_id,kind,sent_at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [c.id, m.user_id, cad === "daily" ? "digestd:" + Math.floor(Date.now() / 864e5) : "digest:" + window, now()]);
        if (ins.changes) await ctx.services.messaging.notify(m.user_id, "mod_digest", { ref: c.id });
      }
    }
  }
  ctx.scheduler.every("unmuteDue", 60e3, unmuteDue);
  ctx.scheduler.every("modDigest", 30 * 60e3, digest);
  return { automod, legacyAutomod, act, discipline, log, queue, unmuteDue, digest, csvCell, LABEL };
};
