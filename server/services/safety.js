/* Trust & Safety + Moderation Engine + Administration Layer:
 * reports (with malicious-report analysis), decisions, appeals, audit log, abuse flags, admin dashboard. */
const { E, str, oneOf, acceptId, id, now } = require("../lib/core");

module.exports = (ctx) => {
  const { db, bus, rl } = ctx;
  const admin = (user) => { if (user.role !== "admin") throw E.forbid("للإدارة فقط"); };
  bus.on("ABUSE_DETECTED", e => ctx.audit("ABUSE_FLAG", e.key, "Mass " + e.action, "system"));

  async function reporterAccuracy(uid) {
    const r = await db.get("SELECT SUM(CASE WHEN status='actioned' THEN 1 ELSE 0 END) a, COUNT(*) n FROM reports WHERE by_user=$1 AND status<>'open'", [uid]);
    return r && r.n ? Math.round(r.a / r.n * 100) : 100;
  }
  /* H3-02: a report needs a real target the reporter can actually see; reuses the existing visibility rules. */
  async function canReport(user, kind, target) {
    const content = ctx.services.content;
    if (kind === "post") {
      const p = await db.get("SELECT * FROM posts WHERE id=$1", [target]); if (!p) return false;
      if (await content.canSee(p, user.id)) return true;
      // automod «smart delay» keeps an existing feature: a cooling-off post can still be reported (which escalates it),
      // but only by someone who would see it once published, so private-community posts stay a plain 404.
      if (p.status !== "held" || !(await db.get("SELECT 1 x FROM automod_items WHERE target_kind='post' AND target_id=$1 AND state='delayed'", [p.id]))) return false;
      return content.canSee({ ...p, status: "published" }, user.id);
    }
    if (kind === "comment") {
      const c = await db.get("SELECT post FROM comments WHERE id=$1", [target]); if (!c) return false;
      return content.canSee(await db.get("SELECT * FROM posts WHERE id=$1", [c.post]), user.id);
    }
    if (kind === "user") return !!(await db.get("SELECT 1 x FROM users WHERE id=$1", [target]));
    if (kind === "community") { // same discoverability as GET /api/communities: invite-only ones only for members
      const c = await db.get("SELECT id, type FROM communities WHERE id=$1", [target]); if (!c) return false;
      return c.type !== "invite" || !!(await db.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2", [c.id, user.id]));
    }
    if (kind === "message") return !!(await db.get("SELECT 1 x FROM messages m JOIN conversation_members cm ON cm.conv=m.conv WHERE m.id=$1 AND cm.user_id=$2", [target, user.id]));
    return false;
  }
  async function report(user, b) {
    if (!rl.hit("report", user.id)) throw E.rate();
    const target = str(b.target, 60, { required: true }), kind = oneOf(b.kind, ["post", "comment", "user", "community", "message"], "post"), reason = str(b.reason, 200, { required: true });
    if (!(await canReport(user, kind, target))) throw E.nf(); // H3-02: same 404 for missing and not-visible (no existence leak)
    if (await db.get("SELECT 1 x FROM reports WHERE target=$1 AND by_user=$2", [target, user.id])) throw E.conflict("سبق أن أبلغت عن هذا");
    const acc = await reporterAccuracy(user.id);
    const rid = acceptId(b.id, "r");
    await db.run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES($1,$2,$3,$4,$5,'open',$6)", [rid, target, kind, reason, user.id, now()]);
    // weighted signal: low-accuracy reporters don't move content state alone
    const open = await db.all("SELECT by_user FROM reports WHERE target=$1 AND status='open'", [target]);
    let weight = 0; for (const o of open) weight += (await reporterAccuracy(o.by_user)) / 100;
    if (kind === "post" && weight >= 1) await db.run("UPDATE posts SET moderation='reported' WHERE id=$1", [target]);
    await ctx.audit("REPORT_CREATED", target, `${reason} (accuracy ${acc}%)`, user.id);
    bus.emit("REPORT_CREATED", { report: rid, target, actor: user.id });
    return { id: rid };
  }
  async function resolveReport(user, rid, action) {
    admin(user);
    const r = await db.get("SELECT * FROM reports WHERE id=$1", [rid]); if (!r || r.status !== "open") throw E.nf();
    action = oneOf(action, ["remove", "keep"], null); if (!action) throw E.bad();
    if (action === "remove") {
      const p = await db.get("SELECT * FROM posts WHERE id=$1", [r.target]);
      const c = !p && await db.get("SELECT * FROM comments WHERE id=$1", [r.target]);
      const owner = p?.author || c?.author; if (!owner) throw E.nf();
      if (p) await db.run("UPDATE posts SET status='removed', moderation='removed' WHERE id=$1", [p.id]); else await db.run("UPDATE comments SET status='removed' WHERE id=$1", [c.id]);
      const did = id("dc");
      await db.run("INSERT INTO decisions(id,target,user_id,action,reason,by_user,created_at) VALUES($1,$2,$3,'REMOVED',$4,$5,$6)", [did, r.target, owner, r.reason, user.id, now()]);
      await db.run("UPDATE reports SET status='actioned', resolved_by=$1, resolved_at=$2 WHERE target=$3 AND status='open'", [user.id, now(), r.target]);
      bus.emit("CONTENT_REMOVED", { post: p?.id || null, user: owner, decision: did });
      await ctx.audit("CONTENT_REMOVED", r.target, r.reason, user.id);
    } else {
      await db.run("UPDATE reports SET status='dismissed', resolved_by=$1, resolved_at=$2 WHERE target=$3 AND status='open'", [user.id, now(), r.target]);
      await db.run("UPDATE posts SET moderation=NULL WHERE id=$1", [r.target]);
      await ctx.audit("REPORT_DISMISSED", r.target, null, user.id);
    }
    ctx.cache.del("feed:");
  }
  async function appeal(user, b) {
    const d = await db.get("SELECT * FROM decisions WHERE id=$1 AND user_id=$2", [b.decision, user.id]); if (!d) throw E.nf();
    if (await db.get("SELECT 1 x FROM appeals WHERE decision_id=$1", [d.id])) throw E.conflict("سبق تقديم استئناف");
    const aid = acceptId(b.id, "ap");
    await db.run("INSERT INTO appeals(id,decision_id,text,by_user,created_at) VALUES($1,$2,$3,$4,$5)", [aid, d.id, str(b.text, 1000, { required: true }), user.id, now()]);
    bus.emit("APPEAL_CREATED", { appeal: aid }); return { id: aid };
  }
  async function resolveAppeal(user, aid, action) {
    admin(user);
    const a = await db.get("SELECT * FROM appeals WHERE id=$1 AND status='open'", [aid]); if (!a) throw E.nf();
    action = oneOf(action, ["accept", "reject"], null); if (!action) throw E.bad();
    await db.run("UPDATE appeals SET status=$1, resolved_at=$2 WHERE id=$3", [action === "accept" ? "accepted" : "rejected", now(), aid]);
    if (action === "accept") {
      const d = await db.get("SELECT * FROM decisions WHERE id=$1", [a.decision_id]);
      await db.run("UPDATE decisions SET restored=1 WHERE id=$1", [d.id]);
      await db.run("UPDATE posts SET status='published', moderation=NULL WHERE id=$1", [d.target]);
      await db.run("UPDATE comments SET status='published' WHERE id=$1", [d.target]);
    }
    await ctx.audit(action === "accept" ? "APPEAL_ACCEPTED" : "APPEAL_REJECTED", a.decision_id, null, user.id);
  }

  async function dashboard(user) {
    admin(user);
    const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
    const active = async (d) => (await db.get("SELECT COUNT(DISTINCT user_id) n FROM analytics_events WHERE at > $1 AND user_id IS NOT NULL", [ago(d)])).n;
    const count = async (sql, p = []) => (await db.get(sql, p)).n;
    const cohort = await db.all("SELECT id FROM users WHERE created_at BETWEEN $1 AND $2", [ago(14), ago(7)]);
    let retained = 0; for (const u of cohort) if (await db.get("SELECT 1 x FROM analytics_events WHERE user_id=$1 AND at > $2", [u.id, ago(7)])) retained++;
    const topCreators = await db.all(`SELECT p.author AS id, COUNT(r.target) score FROM posts p JOIN reactions r ON r.target=p.id WHERE p.created_at > $1 GROUP BY p.author ORDER BY score DESC LIMIT 5`, [ago(30)]);
    const topCommunities = await db.all(`SELECT c.id, c.name, (SELECT COUNT(*) FROM memberships m WHERE m.community=c.id) + (SELECT COUNT(*) FROM posts p WHERE p.community=c.id AND p.created_at > $1) score FROM communities c ORDER BY score DESC LIMIT 5`, [ago(30)]);
    return {
      dau: await active(1), mau: await active(30), users: await count("SELECT COUNT(*) n FROM users"), online: ctx.realtime.online(),
      posts: await count("SELECT COUNT(*) n FROM posts WHERE status='published'"), comments: await count("SELECT COUNT(*) n FROM comments"),
      views: (await db.get("SELECT COALESCE(SUM(views),0) n FROM posts")).n, reactions: await count("SELECT COUNT(*) n FROM reactions"),
      communities: await count("SELECT COUNT(*) n FROM communities"), retention7d: cohort.length ? Math.round(retained / cohort.length * 100) : null,
      reports: await db.all("SELECT * FROM reports WHERE status='open' ORDER BY created_at DESC LIMIT 50"),
      appeals: await db.all("SELECT a.*, d.reason AS decision_reason, d.target FROM appeals a JOIN decisions d ON d.id=a.decision_id WHERE a.status='open'"),
      audit: await db.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 50"), topCreators, topCommunities,
      trends: (await ctx.services.discovery.trends("global", null)).slice(0, 5)
    };
  }

  const r = ctx.router, A = ctx.requireUser;
  r.post("/api/reports", A(async (req) => report(req.user, req.body)));
  r.post("/api/admin/reports/:id", A(async (req) => (await resolveReport(req.user, req.params.id, req.body.action), { ok: true })));
  r.post("/api/appeals", A(async (req) => appeal(req.user, req.body)));
  r.post("/api/admin/appeals/:id", A(async (req) => (await resolveAppeal(req.user, req.params.id, req.body.action), { ok: true })));
  r.get("/api/admin/dashboard", A(async (req) => dashboard(req.user)));
  r.get("/api/me/decisions", A(async (req) => ({ decisions: await db.all("SELECT d.*, a.status AS appeal_status FROM decisions d LEFT JOIN appeals a ON a.decision_id=d.id WHERE d.user_id=$1 ORDER BY d.created_at DESC", [req.user.id]) })));
  r.post("/api/admin/users/:id/status", A(async (req) => { admin(req.user); const s = oneOf(req.body.status, ["active", "suspended"], null); if (!s) throw E.bad(); await db.run("UPDATE users SET status=$1 WHERE id=$2 AND role<>'admin'", [s, req.params.id]); if (s === "suspended") await db.run("DELETE FROM sessions WHERE user_id=$1", [req.params.id]); await ctx.audit("USER_" + s.toUpperCase(), req.params.id, str(req.body.reason, 200), req.user.id); return { ok: true }; }));
  return { reporterAccuracy, report };
};
