/* Smart summaries service (Phase 25).
 * • Thread summaries: bullet points for long discussions/articles, every point citing the post/comment ids
 *   it came from; cached per source hash so a summary is recomputed only when the thread changes.
 * • Daily «فاتك اليوم»: what the viewer missed in the last 24 h (ranked by the ranking service), summarised.
 * • Weekly email digest (opt-in, needs SMTP_URL): hourly leased job, at most one email per 7 days per user.
 * • All generation goes through ctx.llm (lib/llm.js): swappable providers, cost limits, verification, and an
 *   extractive fallback. Results are always labelled as AI-generated with their provider. */
const { E, str, now, sha, id } = require("../lib/core");
const { log } = require("../lib/log");
const LABEL = "ملخص مولّد آلياً — قد يغفل تفاصيل، راجع المصادر المشار إليها";

module.exports = (ctx) => {
  const { db, llm, mailer } = ctx;
  const content = () => ctx.services.content;

  async function cached(kind, ref, hash, make) {
    const hit = await db.get("SELECT * FROM summaries WHERE kind=$1 AND ref=$2 AND source_hash=$3 ORDER BY created_at DESC LIMIT 1", [kind, ref, hash]);
    if (hit) return { ...hit.points, cached: true };
    const out = await make();
    await db.run("DELETE FROM summaries WHERE kind=$1 AND ref=$2", [kind, ref]);
    await db.run("INSERT INTO summaries(id,kind,ref,source_hash,provider,points,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)", [id("sm"), kind, ref, hash, out.provider, out, now()]);
    return { ...out, cached: false };
  }
  /** turn provider citations (ids) into rich citations the UI can link to */
  function decorate(sum, meta) {
    return { ai: true, label: LABEL, provider: sum.provider, model: sum.model, fallback: sum.fallback, generatedAt: sum.generatedAt, sourceCount: sum.sources,
      points: (sum.points || []).map(p => ({ text: p.text, cites: p.cites.map(id => meta[id]).filter(Boolean) })) };
  }

  /* ---------- thread summary ---------- */
  async function thread(viewer, pid, { refresh = false } = {}) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p || p.status !== "published" || !(await content().canSee(p, viewer?.id))) throw E.nf();
    const comments = await db.all("SELECT c.id, c.text, c.author, c.parent, c.created_at, u.name, (SELECT COUNT(*) FROM reactions r WHERE r.target=c.id) rx, (SELECT COUNT(*) FROM comments k WHERE k.parent=c.id) replies FROM comments c JOIN users u ON u.id=c.author WHERE c.post=$1 AND c.status='published' ORDER BY c.created_at", [pid]);
    const author = await db.get("SELECT name FROM users WHERE id=$1", [p.author]);
    const long = (p.text || "").length >= 600 || p.type === "article";
    if (comments.length < 4 && !long) return { summary: null, reason: "النقاش قصير ولا يحتاج إلى ملخص", comments: comments.length };
    const sources = [{ id: p.id, text: p.text || "", weight: 3 } /* body only: the title is shown above the card and is not a claim */, ...comments.map(c => ({ id: c.id, text: c.text, weight: c.rx + c.replies * 2 }))];
    const meta = { [p.id]: { id: p.id, kind: "post", author: author?.name } };
    for (const c of comments) meta[c.id] = { id: c.id, kind: "comment", author: c.name };
    const hash = sha(sources.map(s => s.id + ":" + s.text).join("|") + "|" + llm.active);
    const run = () => llm.summarize({ kind: p.type === "article" ? "مقال" : "نقاش", sources, maxPoints: comments.length >= 10 ? 5 : 4 });
    if (refresh) await db.run("DELETE FROM summaries WHERE kind='thread' AND ref=$1", [pid]);
    const sum = await cached("thread", pid, hash, run);
    return { summary: { ...decorate(sum, meta), cached: sum.cached }, comments: comments.length };
  }

  /* ---------- daily / weekly digests ---------- */
  async function digest(viewer, hours) {
    const since = new Date(Date.now() - hours * 3600e3).toISOString();
    const list = (await ctx.services.ranking.ranked(viewer, "for")).filter(x => x.at > since);
    const ids = list.slice(0, 12).map(x => x.id);
    const rows = ids.length ? await db.all(`SELECT p.*, u.name uname FROM posts p JOIN users u ON u.id=p.author WHERE p.id IN (${ids.map((_, i) => "$" + (i + 1)).join(",")})`, ids) : [];
    const byId = new Map(rows.map(r => [r.id, r])); const posts = ids.map(i => byId.get(i)).filter(Boolean).filter(p => p.author !== viewer.id);
    const counts = {
      posts: list.length,
      people: new Set(list.length ? (await db.all(`SELECT DISTINCT author FROM posts WHERE id IN (${list.slice(0, 400).map((_, i) => "$" + (i + 1)).join(",")})`, list.slice(0, 400).map(x => x.id))).map(r => r.author) : []).size,
      comments: (await db.get("SELECT COUNT(*) n FROM comments c JOIN posts p ON p.id=c.post WHERE p.author=$1 AND c.author<>$1 AND c.created_at > $2", [viewer.id, since])).n
    };
    const meta = Object.fromEntries(posts.map(p => [p.id, { id: p.id, kind: "post", author: p.uname }]));
    const sources = posts.slice(0, 8).map((p, i) => ({ id: p.id, text: p.text || p.title || "", weight: 8 - i }));
    const hash = sha(sources.map(s => s.id).join("|") + "|" + llm.active);
    const sum = sources.length ? await cached(hours > 48 ? "weekly" : "daily", viewer.id, hash, () => llm.summarize({ kind: "ملخص ما فات", sources, maxPoints: 5, perSource: 1 })) : null;
    const trends = (await ctx.services.trends.list({ scope: "global" })).trends.slice(0, 3).map(t => ({ tag: t.tag, posts: t.posts }));
    return { since, hours, counts, summary: sum ? decorate(sum, meta) : null, posts: posts.slice(0, 6).map(p => content().toClient(p, viewer.id)), trends, users: await ctx.services.ranking.authors(posts.slice(0, 6)), caughtUp: !list.length };
  }

  /* ---------- weekly email ---------- */
  async function settings(uid) {
    const r = await db.get("SELECT * FROM digest_settings WHERE user_id=$1", [uid]);
    return { weeklyEmail: !!r?.weekly_email, email: r?.email || null, daily: r ? !!r.daily : true, lastWeekly: r?.last_weekly || null, mailEnabled: mailer.enabled };
  }
  async function saveSettings(uid, b) {
    const cur = await settings(uid);
    const acct = await db.get("SELECT email FROM users WHERE id=$1 AND email_verified_at IS NOT NULL", [uid]); // Phase 29: verified account email is the default
    const email = b.email !== undefined ? str(b.email, 120) : cur.email || acct?.email || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw E.bad("البريد الإلكتروني غير صالح");
    const weekly = b.weeklyEmail !== undefined ? !!b.weeklyEmail : cur.weeklyEmail;
    if (weekly && !email) throw E.bad("أدخل بريدك الإلكتروني لتصلك النشرة الأسبوعية");
    await db.run("INSERT INTO digest_settings(user_id,weekly_email,email,daily,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO UPDATE SET weekly_email=$2, email=$3, daily=$4, updated_at=$5", [uid, weekly ? 1 : 0, email, (b.daily !== undefined ? !!b.daily : cur.daily) ? 1 : 0, now()]);
    return settings(uid);
  }
  /* Phase 29: the email itself is rendered by the shared Arabic RTL templates (lib/email-templates.js) and sent
   * through services/mail.js (List-Unsubscribe one-click, suppression list, delivery log, DKIM) */
  const weeklyContent = (d) => ({ counts: d.counts, points: d.summary?.points || [], posts: d.posts, label: LABEL });
  function emailHtml(user, d, origin) { return require("../lib/email-templates").weekly({ ...weeklyContent(d), name: user.name, origin, prefsUrl: origin + "/#/emailprefs" }).html; }
  async function weeklyFor(user, origin = process.env.PUBLIC_ORIGIN || "") {
    const viewer = await db.get("SELECT * FROM users WHERE id=$1", [user]);
    const d = await digest(viewer, 7 * 24);
    const text = [`أسبوعك في مجتمع بلس — ${d.counts.posts} منشوراً`, ...(d.summary?.points || []).map(p => "• " + p.text), "", "(ملخص مولّد آلياً)"].join("\n");
    return { viewer, d, subject: "أسبوعك في مجتمع بلس ✨", html: emailHtml(viewer, d, origin), text };
  }
  async function weeklyJob() {
    if (!mailer.enabled) return { skipped: "mail_not_configured" };
    const due = await db.all("SELECT * FROM digest_settings WHERE weekly_email=1 AND email IS NOT NULL AND (last_weekly IS NULL OR last_weekly < $1) LIMIT 200", [new Date(Date.now() - 7 * 864e5).toISOString()]);
    let sent = 0;
    for (const s of due) {
      try {
        const m = await weeklyFor(s.user_id);
        await db.run("UPDATE digest_settings SET last_weekly=$1 WHERE user_id=$2", [now(), s.user_id]); // mark first: never double-send on retry
        if (!m.d.counts.posts) continue;
        const out = ctx.services.mail ? await ctx.services.mail.sendWeekly(m.viewer, s.email, weeklyContent(m.d)) : await mailer.send({ to: s.email, subject: m.subject, html: m.html, text: m.text });
        if (!out?.status || out.status === "sent") sent++;
      } catch (e) { log.error("weekly digest failed", { user: s.user_id, err: e.message }); }
    }
    return { due: due.length, sent };
  }
  ctx.scheduler.every("weeklyDigest", 3600e3, weeklyJob);

  const r = ctx.router, AU = ctx.requireUser;
  r.get("/api/posts/:id/summary", async (req) => thread(req.user, req.params.id, { refresh: req.query.refresh === "1" && !!req.user }));
  r.get("/api/digest/daily", AU(async (req) => digest(req.user, 24)));
  r.get("/api/digest/settings", AU(async (req) => settings(req.user.id)));
  r.put("/api/digest/settings", AU(async (req) => saveSettings(req.user.id, req.body)));
  r.get("/api/digest/weekly/preview", AU(async (req) => { const m = await weeklyFor(req.user.id); return { subject: m.subject, html: m.html, text: m.text, posts: m.d.counts.posts }; }));
  r.get("/api/summaries/status", AU(async (req) => { const s = await llm.status(); return req.user.role === "admin" ? { ...s, mail: { enabled: mailer.enabled, transport: mailer.transport || null } } : { active: s.active, label: LABEL }; }));
  return { thread, digest, weeklyJob, weeklyFor, settings };
};
