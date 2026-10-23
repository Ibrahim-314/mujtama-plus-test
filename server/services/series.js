/* Scheduled publishing + content series «جدولة النشر وسلاسل المحتوى» (phase 62). Builds on what exists instead of duplicating it:
 * posts.status='scheduled' + posts.publish_at (phase 12 composer), synced drafts (/api/drafts, phase 12), the studio calendar.
 *  1. Schedule queue: every scheduled post or story of a member (from the composer or POST /api/schedule) with the author's
 *     time zone (IANA, validated), the target series, attempts and the last error. Edit text / title / time / zone / series
 *     while it waits, publish now, or cancel — cancelling moves it back to the member's drafts (nothing is lost).
 *  2. Publisher: content.publishDue() now claims each post with a conditional UPDATE (… WHERE status='scheduled'), so two
 *     instances or two ticks never publish (or notify) twice; a story's 24 h starts when it is published. A post that cannot
 *     be published (author suspended / deleted) is retried and marked failed after SCHEDULE_MAX_ATTEMPTS (default 5), and
 *     the author is told (schedule_failed).
 *  3. Series: an ordered set of the author's own posts (a post is in at most one series), public or unlisted, description and
 *     cover, reorder (move up / down or a full order), next / previous navigation on the post page, «episode N of M».
 *  4. Follow a series; when a new episode is published (immediately, from the schedule, or added within 48 h of publication)
 *     followers get one series_episode notification — idempotent per series, post and follower — only if they may see it.
 *  5. Series analytics (phase 61): unique readers per episode, retention against episode 1, reactions / comments, followers
 *     gained per week, linking to the phase 61 per-post drilldown. */
const { E, str, oneOf, id } = require("../lib/core");

const DAY = 864e5;
const KINDS = { series: "سلسلة", collection: "مجموعة" };
const VIS = ["public", "unlisted"];
function validTz(tz) { try { if (!tz || typeof tz !== "string" || tz.length > 64) return false; new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, jobs?: boolean, now?: () => number }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const clock = () => (opts.now ? opts.now() : Date.now());
  const iso = (ms = clock()) => new Date(ms).toISOString();
  const MAX_ATTEMPTS = Math.max(1, +(env.SCHEDULE_MAX_ATTEMPTS || 5));
  const MAX_AHEAD = Math.max(1, +(env.SCHEDULE_MAX_DAYS || 365)) * DAY;
  const content = () => ctx.services.content;
  const notify = async (uid, kind, extra) => { try { await ctx.services.notify?.notify(uid, kind, extra); } catch { /* best effort */ } };
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const n = (r) => Number(r?.n || 0);
  const excerpt = (p) => (p.title || String(p.text || "").replace(/\s+/g, " ").trim()).slice(0, 120) || (p.type === "story" ? "قصة" : p.type === "audio" ? "مقطع صوتي" : "منشور");

  /* =================== 1. schedule queue =================== */
  async function track(post, tz = null, seriesId = null) {
    await db.run("INSERT INTO post_schedules(post_id,author,tz,series_id,state,attempts,queued_at,updated_at) VALUES($1,$2,$3,$4,'queued',0,$5,$5) ON CONFLICT (post_id) DO UPDATE SET tz=COALESCE($3, post_schedules.tz), series_id=COALESCE($4, post_schedules.series_id), state='queued', updated_at=$5",
      [post.id, post.author, validTz(tz) ? tz : null, seriesId, iso()]);
  }
  function readWhen(v) {
    const t = Date.parse(v); if (!Number.isFinite(t)) throw E.bad("اختر موعد النشر");
    if (t < clock() + 60e3) throw E.bad("اختر موعداً بعد دقيقة على الأقل من الآن");
    if (t > clock() + MAX_AHEAD) throw E.bad("لا يمكن الجدولة لأكثر من سنة");
    return new Date(t).toISOString();
  }
  async function scheduled(user, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2", [pid, user.id]);
    if (!p || p.status !== "scheduled") throw E.nf("ليس منشوراً مجدولاً (ربما نُشر أو أُلغي)");
    return p;
  }
  async function schedule(user, b = {}) {
    const publishAt = readWhen(b.publishAt), tz = validTz(b.tz) ? b.tz : null;
    const sid = b.seriesId ? (await ownSeries(user, b.seriesId)).id : null;
    const post = { ...(b.post && typeof b.post === "object" ? b.post : {}), publishAt };
    delete post.series; delete post.part; delete post.parts;
    const row = await content().createPost(user, post);
    if (row.status === "scheduled") await track({ id: row.id, author: user.id }, tz, sid);
    if (sid) await attach(user, sid, row.id);
    return { post: { id: row.id, status: row.status, publishAt: row.publishAt || row.publish_at || publishAt }, item: row.status === "scheduled" ? await item(user, row.id) : null,
      note: row.status === "pending" ? "المجتمع يراجع المنشورات قبل نشرها؛ أُرسل للمراجعة بدل الجدولة" : undefined };
  }
  async function item(user, pid) { return (await queue(user, { only: pid })).items[0] || null; }
  async function queue(user, q = {}) {
    const rows = await db.all(`SELECT p.id, p.type, p.title, p.text, p.status, p.publish_at, p.visibility, p.community, p.data, p.created_at, s.tz, s.series_id, s.state, s.attempts, s.last_error, s.published_at
      FROM posts p LEFT JOIN post_schedules s ON s.post_id=p.id WHERE p.author=$1 AND (p.status='scheduled' OR (s.state='failed' AND p.status='scheduled'))${q.only ? " AND p.id=$2" : ""} ORDER BY p.publish_at LIMIT 300`, q.only ? [user.id, q.only] : [user.id]);
    const sids = [...new Set(rows.map((r) => r.series_id).filter(Boolean))];
    const its = rows.length ? await db.all(`SELECT i.post_id, i.position, c.id, c.title FROM content_series_items i JOIN content_series c ON c.id=i.series_id WHERE i.post_id IN (${ph(rows.map((r) => r.id))})`, rows.map((r) => r.id)) : [];
    const items = rows.map((r) => {
      const ser = its.find((x) => x.post_id === r.id);
      const d = typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data || {};
      return { id: r.id, type: r.type, title: excerpt(r), text: String(r.text || "").slice(0, 280), hasTitle: !!r.title, publishAt: r.publish_at, tz: r.tz || null, visibility: r.visibility, community: r.community || null,
        thumb: d.cover || (Array.isArray(d.images) ? d.images[0] : null) || (r.type === "story" && typeof d.media === "string" && d.media.startsWith("/") ? d.media : null),
        state: r.state === "failed" ? "failed" : "queued", attempts: Number(r.attempts || 0), lastError: r.last_error || null, series: ser ? { id: ser.id, title: ser.title, position: Number(ser.position) } : null };
    });
    if (q.only) return { items };
    const recent = await db.all("SELECT p.id, p.type, p.title, p.text, s.published_at FROM post_schedules s JOIN posts p ON p.id=s.post_id WHERE s.author=$1 AND s.state='published' AND s.published_at > $2 ORDER BY s.published_at DESC LIMIT 10", [user.id, iso(clock() - 7 * DAY)]);
    const drafts = n(await db.get("SELECT COUNT(*) n FROM drafts WHERE user_id=$1", [user.id]));
    return { items, recent: recent.map((r) => ({ id: r.id, type: r.type, title: excerpt(r), publishedAt: r.published_at })), drafts, sids };
  }
  async function editScheduled(user, pid, b = {}) {
    const p = await scheduled(user, pid), at = iso();
    if (b.publishAt !== undefined) await db.run("UPDATE posts SET publish_at=$1 WHERE id=$2 AND status='scheduled'", [readWhen(b.publishAt), pid]);
    if (b.text !== undefined || b.title !== undefined) {
      const text = b.text !== undefined ? str(b.text, 5000, { required: p.type !== "story" && p.type !== "audio" && !p.title }) : p.text;
      const title = b.title !== undefined ? (p.type === "article" ? str(b.title, 200, { required: true }) : null) : p.title;
      await db.run("UPDATE posts SET text=$1, title=$2, updated_at=$3 WHERE id=$4 AND status='scheduled'", [text || "", title, at, pid]);
    }
    await track(p, b.tz !== undefined && validTz(b.tz) ? b.tz : null);
    if (b.seriesId !== undefined) {
      if (b.seriesId) await attach(user, (await ownSeries(user, b.seriesId)).id, pid);
      else await db.run("DELETE FROM content_series_items WHERE post_id=$1", [pid]);
    }
    await db.run("UPDATE post_schedules SET state='queued', attempts=0, last_error=NULL, updated_at=$1 WHERE post_id=$2", [at, pid]);
    return { item: await item(user, pid) };
  }
  async function cancel(user, pid, b = {}) {
    const p = await scheduled(user, pid), at = iso();
    const r = await db.run("UPDATE posts SET status='deleted', updated_at=$1 WHERE id=$2 AND status='scheduled'", [at, pid]);
    if (!r.changes) throw E.conflict("نُشر المنشور للتو");
    await db.run("UPDATE post_schedules SET state='cancelled', updated_at=$1 WHERE post_id=$2", [at, pid]);
    await db.run("DELETE FROM content_series_items WHERE post_id=$1", [pid]);
    let draftId = null;
    if (b.keepDraft !== false) {
      const d = p.data && typeof p.data === "object" ? p.data : JSON.parse(p.data || "{}");
      const cnt = n(await db.get("SELECT COUNT(*) n FROM drafts WHERE user_id=$1", [user.id]));
      if (cnt < 50) {
        draftId = id("dr");
        const data = { type: ["post", "article", "story", "audio"].includes(p.type) ? p.type : "post", title: p.title || "", markdown: p.text || "", images: Array.isArray(d.images) ? d.images.slice(0, 10) : [], alts: Array.isArray(d.alts) ? d.alts : [], visibility: p.visibility || "public", publishAt: "", series: "" };
        await db.run("INSERT INTO drafts(id,user_id,data,device,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$5)", [draftId, user.id, data, "schedule", at]);
      }
    }
    bus.emit("POST_DELETED", { post: pid, actor: user.id });
    return { ok: true, draftId };
  }
  async function publishNow(user, pid) {
    await scheduled(user, pid);
    await db.run("UPDATE posts SET publish_at=$1 WHERE id=$2 AND status='scheduled'", [iso(), pid]);
    await content().publishDue();
    const p = await db.get("SELECT status FROM posts WHERE id=$1", [pid]);
    return { ok: p?.status === "published", status: p?.status };
  }
  /* publisher guard (content.publishDue asks before claiming): authors who are suspended or gone are retried, then failed */
  async function canPublish(p) {
    const u = await db.get("SELECT id, status FROM users WHERE id=$1", [p.author]);
    if (u && !["banned", "suspended", "deleted"].includes(u.status || "")) return true;
    const s = await db.get("SELECT attempts FROM post_schedules WHERE post_id=$1", [p.id]);
    const attempts = Number(s?.attempts || 0) + 1, failed = attempts >= MAX_ATTEMPTS, at = iso();
    if (!s) await db.run("INSERT INTO post_schedules(post_id,author,state,attempts,last_error,queued_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (post_id) DO NOTHING", [p.id, p.author, failed ? "failed" : "queued", attempts, "الحساب غير نشط", at]);
    else await db.run("UPDATE post_schedules SET attempts=$1, state=$2, last_error=$3, updated_at=$4 WHERE post_id=$5", [attempts, failed ? "failed" : "queued", "الحساب غير نشط", at, p.id]);
    if (failed) { await db.run("UPDATE posts SET publish_at=$1 WHERE id=$2 AND status='scheduled'", [iso(clock() + 3650 * DAY), p.id]); if (u) await notify(p.author, "schedule_failed", { post: p.id, ref: p.id }); }
    return false;
  }

  /* =================== 3. series =================== */
  const seriesClient = (s, extra = {}) => ({ id: s.id, title: s.title, descr: s.descr || "", cover: s.cover || null, kind: s.kind, kindLabel: KINDS[s.kind] || "سلسلة", visibility: s.visibility, status: s.status, followers: Number(s.followers || 0), lastEpisodeAt: s.last_episode_at || null, createdAt: s.created_at, updatedAt: s.updated_at, href: `#/series/${s.id}`, ...extra });
  async function ownSeries(user, sid) {
    const s = await db.get("SELECT * FROM content_series WHERE id=$1 AND status<>'deleted'", [String(sid || "")]);
    if (!s || (s.author !== user.id && user.role !== "admin")) throw E.nf("السلسلة غير موجودة");
    return s;
  }
  function readSeries(b, partial) {
    const o = {};
    if (!partial || b.title !== undefined) o.title = str(b.title, 90, { required: true, min: 2 });
    if (!partial || b.descr !== undefined) o.descr = str(b.descr, 600) || null;
    if (!partial || b.cover !== undefined) { const c = b.cover ? String(b.cover) : ""; if (c && !/^\/(media|uploads)\/[\w./-]{1,200}$/.test(c) && !/^https:\/\/[^\s"'<>]{4,300}$/.test(c)) throw E.bad("صورة الغلاف غير صالحة"); o.cover = c || null; }
    if (!partial || b.kind !== undefined) o.kind = oneOf(b.kind, Object.keys(KINDS), "series");
    if (!partial || b.visibility !== undefined) o.visibility = oneOf(b.visibility, VIS, "public");
    return o;
  }
  async function createSeries(user, b = {}) {
    if (!rl.hit("default", "series:" + user.id)) throw E.rate();
    const cnt = n(await db.get("SELECT COUNT(*) n FROM content_series WHERE author=$1 AND status='active'", [user.id]));
    if (cnt >= 50) throw E.bad("الحد الأقصى ٥٠ سلسلة");
    const o = readSeries(b, false), sid = id("cs"), at = iso();
    await db.run("INSERT INTO content_series(id,author,title,descr,cover,kind,visibility,status,followers,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',0,$8,$8)", [sid, user.id, o.title, o.descr, o.cover, o.kind, o.visibility, at]);
    for (const pid of (Array.isArray(b.postIds) ? b.postIds : []).slice(0, 100)) await attach(user, sid, String(pid)).catch(() => { });
    return getSeries(user, sid);
  }
  async function updateSeries(user, sid, b = {}) {
    const s = await ownSeries(user, sid), o = readSeries(b, true);
    if (b.status !== undefined) o.status = oneOf(b.status, ["active", "archived"], s.status);
    const keys = Object.keys(o); if (!keys.length) throw E.bad("لا تغييرات");
    await db.run(`UPDATE content_series SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => o[k]), iso(), s.id]);
    return getSeries(user, s.id);
  }
  async function deleteSeries(user, sid) {
    const s = await ownSeries(user, sid);
    await db.run("UPDATE content_series SET status='deleted', updated_at=$1 WHERE id=$2", [iso(), s.id]);
    await db.run("DELETE FROM content_series_items WHERE series_id=$1", [s.id]);
    await db.run("DELETE FROM content_series_follows WHERE series_id=$1", [s.id]);
    return { ok: true };
  }
  async function renumber(sid) {
    const rows = await db.all("SELECT post_id, position FROM content_series_items WHERE series_id=$1 ORDER BY position, added_at", [sid]);
    for (let i = 0; i < rows.length; i++) if (Number(rows[i].position) !== i + 1) await db.run("UPDATE content_series_items SET position=$1 WHERE series_id=$2 AND post_id=$3", [i + 1, sid, rows[i].post_id]);
    return rows.length;
  }
  async function attach(user, sid, pid, position) {
    const s = await ownSeries(user, sid);
    const p = await db.get("SELECT id, author, status, created_at, type FROM posts WHERE id=$1", [pid]);
    if (!p || p.author !== s.author || !["published", "scheduled", "processing", "pending"].includes(p.status)) throw E.bad("يمكن إضافة منشوراتك المنشورة أو المجدولة فقط");
    if (p.type === "story") throw E.bad("القصص مؤقتة ولا تُضاف إلى السلاسل");
    const other = await db.get("SELECT series_id FROM content_series_items WHERE post_id=$1", [pid]);
    if (other && other.series_id === s.id) return listItems(s, user);
    const total = n(await db.get("SELECT COUNT(*) n FROM content_series_items WHERE series_id=$1", [s.id]));
    if (total >= 200) throw E.bad("الحد الأقصى ٢٠٠ حلقة في السلسلة");
    if (other) { await db.run("DELETE FROM content_series_items WHERE post_id=$1", [pid]); await renumber(other.series_id); }
    const pos = Math.max(1, Math.min(total + 1, Math.round(+position || total + 1)));
    await db.run("UPDATE content_series_items SET position=position+1 WHERE series_id=$1 AND position >= $2", [s.id, pos]);
    await db.run("INSERT INTO content_series_items(series_id,post_id,position,added_at) VALUES($1,$2,$3,$4)", [s.id, pid, pos, iso()]);
    await renumber(s.id);
    await db.run("UPDATE content_series SET updated_at=$1 WHERE id=$2", [iso(), s.id]);
    // a published post added soon after publication counts as a new episode for followers
    if (p.status === "published" && Date.parse(p.created_at) > clock() - 2 * DAY) await episodePublished(pid);
    return listItems(s, user);
  }
  async function detach(user, sid, pid) {
    const s = await ownSeries(user, sid);
    await db.run("DELETE FROM content_series_items WHERE series_id=$1 AND post_id=$2", [s.id, pid]);
    await renumber(s.id);
    return listItems(s, user);
  }
  async function reorder(user, sid, b = {}) {
    const s = await ownSeries(user, sid);
    const cur = (await db.all("SELECT post_id FROM content_series_items WHERE series_id=$1 ORDER BY position", [s.id])).map((r) => r.post_id);
    let order;
    if (Array.isArray(b.postIds)) {
      order = b.postIds.map(String);
      if (order.length !== cur.length || new Set(order).size !== cur.length || order.some((x) => !cur.includes(x))) throw E.bad("الترتيب يجب أن يشمل كل حلقات السلسلة مرة واحدة");
    } else if (b.postId && ["up", "down"].includes(b.move)) {
      const i = cur.indexOf(String(b.postId)); if (i < 0) throw E.nf("ليست في هذه السلسلة");
      const j = b.move === "up" ? i - 1 : i + 1; order = [...cur];
      if (j >= 0 && j < cur.length) [order[i], order[j]] = [order[j], order[i]];
    } else throw E.bad("حدد الترتيب الجديد");
    for (let i = 0; i < order.length; i++) await db.run("UPDATE content_series_items SET position=$1 WHERE series_id=$2 AND post_id=$3", [i + 1, s.id, order[i]]);
    await db.run("UPDATE content_series SET updated_at=$1 WHERE id=$2", [iso(), s.id]);
    return listItems(s, user);
  }
  async function listItems(s, viewer) {
    const rows = await db.all("SELECT p.*, i.position FROM content_series_items i JOIN posts p ON p.id=i.post_id WHERE i.series_id=$1 ORDER BY i.position", [s.id]);
    const owner = viewer && viewer.id === s.author;
    const pub = rows.filter((p) => p.status === "published");
    const visible = await content().filterVisible(pub, viewer?.id || null);
    const ok = new Set(visible.map((p) => p.id));
    const ids = rows.map((r) => r.id);
    const rx = ids.length ? await db.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${ph(ids)}) GROUP BY target`, ids) : [];
    const cm = ids.length ? await db.all(`SELECT post, COUNT(*) n FROM comments WHERE status='published' AND post IN (${ph(ids)}) GROUP BY post`, ids) : [];
    const seen = viewer && ids.length ? new Set((await db.all(`SELECT DISTINCT post FROM post_views WHERE user_id=$1 AND post IN (${ph(ids, 1)})`, [viewer.id, ...ids])).map((r) => r.post)) : new Set();
    let ep = 0;
    const out = [];
    for (const p of rows) {
      const live = ok.has(p.id); if (!live && !owner) continue;
      if (live) ep++;
      const d = p.data && typeof p.data === "object" ? p.data : JSON.parse(p.data || "{}");
      out.push({ id: p.id, position: Number(p.position), episode: live ? ep : null, type: p.type, title: excerpt(p), status: live ? "published" : p.status, publishAt: p.status === "scheduled" ? p.publish_at : null, createdAt: p.created_at,
        readingMin: d.readingMin || null, cover: d.cover || (Array.isArray(d.images) ? d.images[0] : null) || null, views: Number(p.views || 0), reactions: n(rx.find((x) => x.target === p.id)), comments: n(cm.find((x) => x.post === p.id)), seen: seen.has(p.id) });
    }
    return { items: out, episodes: ep };
  }
  async function getSeries(viewer, sid) {
    const s = await db.get("SELECT c.*, u.name, u.handle, u.avatar, u.color FROM content_series c JOIN users u ON u.id=c.author WHERE c.id=$1 AND c.status<>'deleted'", [String(sid)]);
    if (!s) throw E.nf("السلسلة غير موجودة");
    const owner = !!viewer && (viewer.id === s.author || viewer.role === "admin");
    if (s.status === "archived" && !owner) throw E.nf("السلسلة غير متاحة");
    const { items, episodes } = await listItems(s, viewer);
    const f = viewer ? await db.get("SELECT notify FROM content_series_follows WHERE series_id=$1 AND user_id=$2", [s.id, viewer.id]) : null;
    const done = items.filter((x) => x.episode && x.seen).length;
    const next = items.find((x) => x.episode && !x.seen) || null;
    return { series: seriesClient(s, { author: { id: s.author, name: s.name, handle: s.handle, avatar: s.avatar, color: s.color }, episodes }), items,
      me: { owner, following: !!f, notify: f ? !!Number(f.notify) : false, seen: done, resume: next ? { id: next.id, episode: next.episode, title: next.title } : null },
      shareUrl: `/#/series/${s.id}` };
  }
  async function listSeries(viewer, q = {}) {
    let rows;
    if (q.following) {
      if (!viewer) throw E.auth();
      rows = await db.all("SELECT c.*, u.name, u.handle, u.color, f.notify FROM content_series_follows f JOIN content_series c ON c.id=f.series_id JOIN users u ON u.id=c.author WHERE f.user_id=$1 AND c.status='active' ORDER BY COALESCE(c.last_episode_at, c.updated_at) DESC LIMIT 100", [viewer.id]);
    } else if (q.mine) {
      if (!viewer) throw E.auth();
      rows = await db.all("SELECT c.*, u.name, u.handle, u.color FROM content_series c JOIN users u ON u.id=c.author WHERE c.author=$1 AND c.status<>'deleted' ORDER BY c.status, c.updated_at DESC LIMIT 100", [viewer.id]);
    } else {
      const author = q.author ? await db.get("SELECT id FROM users WHERE handle=$1 OR id=$1", [String(q.author).replace(/^@/, "")]) : null;
      if (!author) throw E.bad("حدد صاحب السلاسل");
      rows = await db.all("SELECT c.*, u.name, u.handle, u.color FROM content_series c JOIN users u ON u.id=c.author WHERE c.author=$1 AND c.status='active' AND c.visibility='public' ORDER BY c.updated_at DESC LIMIT 100", [author.id]);
    }
    const ids = rows.map((r) => r.id);
    const counts = ids.length ? await db.all(`SELECT i.series_id, COUNT(*) n FROM content_series_items i JOIN posts p ON p.id=i.post_id WHERE p.status='published' AND i.series_id IN (${ph(ids)}) GROUP BY i.series_id`, ids) : [];
    const sched = q.mine && ids.length ? await db.all(`SELECT i.series_id, COUNT(*) n FROM content_series_items i JOIN posts p ON p.id=i.post_id WHERE p.status='scheduled' AND i.series_id IN (${ph(ids)}) GROUP BY i.series_id`, ids) : [];
    const firstCover = ids.length ? await db.all(`SELECT i.series_id, p.data FROM content_series_items i JOIN posts p ON p.id=i.post_id WHERE i.position=1 AND i.series_id IN (${ph(ids)})`, ids) : [];
    return { series: rows.map((s) => {
      const fc = firstCover.find((x) => x.series_id === s.id), d = fc ? (typeof fc.data === "string" ? JSON.parse(fc.data || "{}") : fc.data || {}) : {};
      return seriesClient(s, { cover: s.cover || d.cover || (Array.isArray(d.images) ? d.images[0] : null) || null, author: { id: s.author, name: s.name, handle: s.handle, color: s.color }, episodes: n(counts.find((x) => x.series_id === s.id)), scheduled: q.mine ? n(sched.find((x) => x.series_id === s.id)) : undefined, notify: s.notify !== undefined ? !!Number(s.notify) : undefined });
    }) };
  }
  async function follow(user, sid, on, b = {}) {
    const s = await db.get("SELECT * FROM content_series WHERE id=$1 AND status='active'", [String(sid)]); if (!s) throw E.nf("السلسلة غير موجودة");
    if (s.author === user.id && on) throw E.bad("هذه سلسلتك");
    if (on) {
      if (!rl.hit("follow", user.id)) throw E.rate();
      await db.run("INSERT INTO content_series_follows(series_id,user_id,notify,at) VALUES($1,$2,$3,$4) ON CONFLICT (series_id, user_id) DO UPDATE SET notify=$3", [s.id, user.id, b.notify === false ? 0 : 1, iso()]);
    } else await db.run("DELETE FROM content_series_follows WHERE series_id=$1 AND user_id=$2", [s.id, user.id]);
    const cnt = n(await db.get("SELECT COUNT(*) n FROM content_series_follows WHERE series_id=$1", [s.id]));
    await db.run("UPDATE content_series SET followers=$1 WHERE id=$2", [cnt, s.id]);
    const f = on ? await db.get("SELECT notify FROM content_series_follows WHERE series_id=$1 AND user_id=$2", [s.id, user.id]) : null;
    return { following: !!on, notify: f ? !!Number(f.notify) : false, followers: cnt };
  }
  /** next / previous navigation for the post page */
  async function forPost(viewer, pid) {
    const it = await db.get("SELECT i.series_id, i.position FROM content_series_items i JOIN content_series c ON c.id=i.series_id WHERE i.post_id=$1 AND c.status='active'", [String(pid)]);
    if (!it) return { series: null };
    const s = await db.get("SELECT c.*, u.name, u.handle FROM content_series c JOIN users u ON u.id=c.author WHERE c.id=$1", [it.series_id]);
    const { items, episodes } = await listItems(s, viewer);
    const live = items.filter((x) => x.episode), i = live.findIndex((x) => x.id === pid);
    if (i < 0 && !(viewer && viewer.id === s.author)) return { series: null };
    const f = viewer ? await db.get("SELECT notify FROM content_series_follows WHERE series_id=$1 AND user_id=$2", [s.id, viewer.id]) : null;
    const pick = (x) => (x ? { id: x.id, title: x.title, episode: x.episode } : null);
    return { series: seriesClient(s, { author: { id: s.author, name: s.name, handle: s.handle }, episodes }), episode: i >= 0 ? i + 1 : null, total: episodes,
      prev: pick(live[i - 1]), next: pick(i >= 0 ? live[i + 1] : null), following: !!f, owner: !!viewer && viewer.id === s.author,
      upcoming: items.filter((x) => x.status === "scheduled").length ? items.filter((x) => x.status === "scheduled").length : 0 };
  }
  async function candidates(user, sid) {
    const s = await ownSeries(user, sid);
    const rows = await db.all("SELECT p.id, p.type, p.title, p.text, p.status, p.publish_at, p.created_at, i.series_id FROM posts p LEFT JOIN content_series_items i ON i.post_id=p.id WHERE p.author=$1 AND p.status IN ('published','scheduled') AND p.type NOT IN ('story') AND p.repost_of IS NULL AND (i.series_id IS NULL OR i.series_id<>$2) ORDER BY COALESCE(p.publish_at, p.created_at) DESC LIMIT 60", [s.author, s.id]);
    const other = rows.filter((r) => r.series_id).map((r) => r.series_id);
    const names = other.length ? await db.all(`SELECT id, title FROM content_series WHERE id IN (${ph([...new Set(other)])})`, [...new Set(other)]) : [];
    return { posts: rows.map((p) => ({ id: p.id, type: p.type, title: excerpt(p), status: p.status, at: p.status === "scheduled" ? p.publish_at : p.created_at, inSeries: p.series_id ? names.find((x) => x.id === p.series_id)?.title || "سلسلة أخرى" : null })) };
  }

  /* =================== 4. new episode → followers =================== */
  async function episodePublished(pid) {
    const it = await db.get("SELECT i.series_id FROM content_series_items i JOIN content_series c ON c.id=i.series_id WHERE i.post_id=$1 AND c.status='active'", [pid]);
    if (!it) return 0;
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND status='published'", [pid]); if (!p) return 0;
    await db.run("UPDATE content_series SET last_episode_at=$1 WHERE id=$2", [iso(), it.series_id]);
    const fs = await db.all("SELECT user_id FROM content_series_follows WHERE series_id=$1 AND notify=1 LIMIT 20000", [it.series_id]);
    let sent = 0;
    for (const f of fs) {
      if (f.user_id === p.author) continue;
      if (!(await content().canSee(p, f.user_id))) continue;
      const r = await db.run("INSERT INTO content_series_notified(series_id,post_id,user_id,at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [it.series_id, pid, f.user_id, iso()]);
      if (r.changes) { await notify(f.user_id, "series_episode", { post: pid, ref: pid, actor: p.author }); sent++; }
    }
    return sent;
  }
  bus.on("POST_PUBLISHED", async (e) => {
    const pid = typeof e.post === "string" ? e.post : e.post?.id; if (!pid) return;
    try {
      if (e.scheduled) await db.run("UPDATE post_schedules SET state='published', published_at=$1, updated_at=$1, last_error=NULL WHERE post_id=$2", [iso(), pid]);
      await episodePublished(pid);
    } catch { /* best effort */ }
  });
  bus.on("POST_CREATED", async (e) => { try { if (e.post?.status === "scheduled") await track(e.post); } catch { /* best effort */ } });

  /* =================== 5. series analytics (phase 61) =================== */
  async function stats(user, sid) {
    const s = await ownSeries(user, sid);
    const rows = await db.all("SELECT p.id, p.title, p.text, p.type, p.views, p.created_at, i.position FROM content_series_items i JOIN posts p ON p.id=i.post_id WHERE i.series_id=$1 AND p.status='published' ORDER BY i.position", [s.id]);
    const ids = rows.map((r) => r.id);
    const readers = ids.length ? await db.all(`SELECT post, COUNT(DISTINCT user_id) n FROM post_views WHERE user_id IS NOT NULL AND post IN (${ph(ids)}) GROUP BY post`, ids) : [];
    const rx = ids.length ? await db.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${ph(ids)}) GROUP BY target`, ids) : [];
    const cm = ids.length ? await db.all(`SELECT post, COUNT(*) n FROM comments WHERE status='published' AND post IN (${ph(ids)}) GROUP BY post`, ids) : [];
    const first = ids.length ? n(readers.find((x) => x.post === ids[0])) : 0;
    // completion: members who read episode 1 and also the latest episode
    const both = ids.length > 1 ? n(await db.get("SELECT COUNT(DISTINCT a.user_id) n FROM post_views a JOIN post_views b ON b.user_id=a.user_id WHERE a.post=$1 AND b.post=$2 AND a.user_id IS NOT NULL", [ids[0], ids[ids.length - 1]])) : first;
    const fol = await db.all("SELECT at FROM content_series_follows WHERE series_id=$1", [s.id]);
    const weeks = Array.from({ length: 8 }, (_, i) => { const end = clock() - i * 7 * DAY, start = end - 7 * DAY; return { from: iso(start), to: iso(end), value: fol.filter((f) => { const t = Date.parse(f.at); return t > start && t <= end; }).length }; }).reverse();
    const episodes = rows.map((r, i) => { const rd = n(readers.find((x) => x.post === r.id)); return { id: r.id, episode: i + 1, title: excerpt(r), type: r.type, publishedAt: r.created_at, views: Number(r.views || 0), readers: rd, retention: first ? Math.round((rd / first) * 100) : null, reactions: n(rx.find((x) => x.target === r.id)), comments: n(cm.find((x) => x.post === r.id)), href: `#/analytics/post/${r.id}` }; });
    const drop = episodes.slice(1).reduce((w, e, i) => (e.retention !== null && episodes[i].retention !== null && (!w || episodes[i].retention - e.retention > w.delta) ? { episode: e.episode, delta: episodes[i].retention - e.retention } : w), null);
    return { series: seriesClient(s), totals: { episodes: episodes.length, followers: fol.length, views: episodes.reduce((t, e) => t + e.views, 0), readersFirst: first, completion: first ? Math.round((both / first) * 100) : null },
      episodes, followersWeekly: weeks, insight: drop && drop.delta >= 20 ? `أكبر تراجع في القراء عند الحلقة ${drop.episode} (−${drop.delta}%) — جرّب تلخيص ما سبق في بدايتها أو عنواناً أوضح.` : episodes.length >= 2 ? "القراء يتابعون السلسلة بثبات بين الحلقات 👏" : null };
  }

  /* =================== routes =================== */
  R.get("/api/schedule", A(async (req) => queue(req.user)));
  R.post("/api/schedule", A(async (req) => schedule(req.user, req.body || {})));
  R.patch("/api/schedule/:id", A(async (req) => editScheduled(req.user, req.params.id, req.body || {})));
  R.del("/api/schedule/:id", A(async (req) => cancel(req.user, req.params.id, { keepDraft: req.query.keepDraft !== "0" })));
  R.post("/api/schedule/:id/now", A(async (req) => publishNow(req.user, req.params.id)));
  R.get("/api/cseries", async (req) => listSeries(req.user, { mine: req.query.mine === "1", following: req.query.following === "1", author: req.query.author }));
  R.post("/api/cseries", A(async (req) => createSeries(req.user, req.body || {})));
  R.get("/api/cseries/for-post/:id", async (req) => forPost(req.user, req.params.id));
  R.get("/api/cseries/:id", async (req) => getSeries(req.user, req.params.id));
  R.patch("/api/cseries/:id", A(async (req) => updateSeries(req.user, req.params.id, req.body || {})));
  R.del("/api/cseries/:id", A(async (req) => deleteSeries(req.user, req.params.id)));
  R.get("/api/cseries/:id/candidates", A(async (req) => candidates(req.user, req.params.id)));
  R.get("/api/cseries/:id/stats", A(async (req) => stats(req.user, req.params.id)));
  R.post("/api/cseries/:id/items", A(async (req) => attach(req.user, req.params.id, String(req.body?.postId || ""), req.body?.position)));
  R.del("/api/cseries/:id/items/:post", A(async (req) => detach(req.user, req.params.id, req.params.post)));
  R.put("/api/cseries/:id/order", A(async (req) => reorder(req.user, req.params.id, req.body || {})));
  R.put("/api/cseries/:id/follow", A(async (req) => follow(req.user, req.params.id, true, req.body || {})));
  R.del("/api/cseries/:id/follow", A(async (req) => follow(req.user, req.params.id, false)));
  return { schedule, queue, editScheduled, cancel, publishNow, canPublish, createSeries, updateSeries, deleteSeries, attach, detach, reorder, getSeries, listSeries, follow, forPost, candidates, stats, episodePublished, validTz };
};
module.exports.validTz = validTz;
