/* v2.80 — «أدوات صانع فيديوتك»: Vidtik drafts, per-clip stats, best time to post (migration 078_clip_creator).
 *  • GET    /api/clips/drafts                → { items[], max }   my drafts, newest first (signed-in)
 *  • PUT    /api/clips/drafts/:id            {mediaId, caption, coverPos, link:{kind,id}|null, publishAt|null} → { draft }
 *           id = cd_<6..24 alnum> chosen by the client (so a retry after a network drop never makes two drafts);
 *           the video must be MY uploaded video; at most MAX_DRAFTS; publishAt is kept only when it is in the future.
 *  • DELETE /api/clips/drafts/:id            → { ok }   (also called after the draft is published)
 *  • GET    /api/clips/:id/stats             → the clip's numbers for its author (and staff): views (= distinct viewers),
 *           completed, completion %, average watched seconds, likes, comments, shares, link taps, sources{}, daily[14].
 *           Nobody else may read them (404, the clip's existence is not revealed beyond what the feed shows).
 *  • GET    /api/clips/insights/best-time    → { enough, sample, hours[24] (UTC), top[≤3] (UTC hours) }
 *           when my followers watch clips (their clip_watch activity, last 30 days). Below MIN_SAMPLE → enough:false.
 * Pure helpers (bestHours, completionPct, sourceShares, dayBuckets) are exported for unit tests. */
const { E, str } = require("../lib/core");
const MAX_DRAFTS = 20, MAX_CAP = 2200, DAYS = 14, BEST_DAYS = 30, MIN_SAMPLE = 30, BEST_ROWS = 5000;
const ID_RE = /^cd_[a-z0-9]{6,24}$/i;
const SOURCES = ["foryou", "following", "profile", "tag", "sound", "challenge", "link", "other"];

/* ---------- pure helpers (unit-tested) ---------- */
const completionPct = (views, completed) => (views > 0 ? Math.round((completed / views) * 100) : 0);
/** counts by source → [{src, n, pct}] in SOURCES order, zero rows dropped; NULL / unknown sources count as "other" */
function sourceShares(rows) {
  const by = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const r of rows || []) { const k = SOURCES.includes(r.src) ? r.src : "other"; by[k] += Number(r.n || 0); }
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return SOURCES.filter((s) => by[s] > 0).map((s) => ({ src: s, n: by[s], pct: total ? Math.round((by[s] / total) * 100) : 0 }));
}
/** first-watch timestamps → the last `days` UTC days (oldest first), each {day:'YYYY-MM-DD', n} */
function dayBuckets(stamps, days = DAYS, now = Date.now()) {
  const out = [], idx = {};
  for (let i = days - 1; i >= 0; i--) { const d = new Date(now - i * 864e5).toISOString().slice(0, 10); idx[d] = out.length; out.push({ day: d, n: 0 }); }
  for (const t of stamps || []) { const ms = t instanceof Date ? t.getTime() : Date.parse(t); if (!Number.isFinite(ms)) continue; const k = new Date(ms).toISOString().slice(0, 10); if (k in idx) out[idx[k]].n++; }
  return out;
}
/** activity timestamps → { hours[24] (UTC), top: up to 3 busiest UTC hours (ties: earlier hour), enough, sample } */
function bestHours(stamps, min = MIN_SAMPLE) {
  const hours = Array(24).fill(0); let sample = 0;
  for (const t of stamps || []) { const ms = t instanceof Date ? t.getTime() : Date.parse(t); if (!Number.isFinite(ms)) continue; hours[new Date(ms).getUTCHours()]++; sample++; }
  const enough = sample >= min;
  const top = enough ? hours.map((n, h) => ({ h, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.h - b.h).slice(0, 3).map((x) => x.h) : [];
  return { hours, top, enough, sample };
}

module.exports = (ctx) => {
  const { db, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const rd = db.read || db;
  const clips = () => ctx.services.clips;
  const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const parse = (v) => { if (v == null) return null; if (typeof v === "object") return v; try { return JSON.parse(v); } catch { return null; } };
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);

  /* ---------- drafts ---------- */
  function mediaView(m) {
    if (!m) return null;
    const v = parse(m.variants) || {};
    const mp4 = ["720p", "540p", "360p", "240p", "1080p"].map((k) => v[k]).find((u) => typeof u === "string" && /\.mp4(\?|$)/.test(u));
    const src = mp4 || (ctx.services.media?.storage ? ctx.services.media.storage.url(m.storage_key) : null);
    return { id: m.id, status: m.status, src, poster: typeof v.poster === "string" ? v.poster : null, duration: Number(v.duration) || null };
  }
  async function draftView(user, r) {
    const m = await rd.get("SELECT * FROM media WHERE id=$1 AND owner=$2", [r.media_id, user.id]);
    const ln = parse(r.link);
    const link = ln && ln.kind && ln.id ? await clips().linkTarget(ln.kind, ln.id, user.id).catch(() => null) : null;
    const pa = iso(r.publish_at);
    return { id: r.id, media: mediaView(m), missing: !m || m.status === "failed", caption: r.caption || "", coverPos: r.cover_pos == null ? null : Number(r.cover_pos), link, publishAt: pa && Date.parse(pa) > Date.now() ? pa : null, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) };
  }
  async function listDrafts(user) {
    const rows = await rd.all("SELECT * FROM clip_drafts WHERE user_id=$1 ORDER BY updated_at DESC LIMIT $2", [user.id, MAX_DRAFTS]);
    const items = []; for (const r of rows) items.push(await draftView(user, r));
    return { items, max: MAX_DRAFTS };
  }
  async function saveDraft(user, id, b = {}) {
    if (!ID_RE.test(String(id || ""))) throw E.bad("معرّف المسودة غير صالح");
    if (!rl.hit("clip_draft", user.id)) throw E.rate();
    const mid = str(b.mediaId, 80, { required: true });
    const m = await db.get("SELECT id, kind, status FROM media WHERE id=$1 AND owner=$2", [mid, user.id]);
    if (!m || m.kind !== "video") throw E.bad("الفيديو غير موجود");
    if (m.status === "failed") throw E.bad("تعذّرت معالجة هذا الفيديو، اختر فيديو آخر");
    const caption = String(b.caption ?? "").slice(0, MAX_CAP);
    const cp = b.coverPos == null || b.coverPos === "" ? null : Math.round(+b.coverPos);
    const coverPos = Number.isFinite(cp) && cp >= 0 && cp <= 1000 ? cp : null;
    let link = null;
    if (b.link && typeof b.link === "object" && b.link.kind && b.link.id) {
      const t = await clips().linkTarget(String(b.link.kind), str(b.link.id, 80), user.id).catch(() => null);
      if (t) link = { kind: t.kind, id: t.id };
    }
    const pa = b.publishAt ? new Date(b.publishAt) : null;
    const publishAt = pa && Number.isFinite(pa.getTime()) && pa.getTime() > Date.now() ? pa.toISOString() : null;
    const at = new Date().toISOString();
    const ex = await db.get("SELECT id FROM clip_drafts WHERE id=$1", [id]);
    if (ex) {
      const r = await db.run("UPDATE clip_drafts SET media_id=$1, caption=$2, cover_pos=$3, link=$4, publish_at=$5, updated_at=$6 WHERE id=$7 AND user_id=$8", [mid, caption, coverPos, link, publishAt, at, id, user.id]);
      if (!r.changes) throw E.nf("المسودة غير موجودة"); // someone else's id: never overwritten, never revealed
    } else {
      const n = Number((await db.get("SELECT COUNT(*) n FROM clip_drafts WHERE user_id=$1", [user.id]))?.n || 0);
      if (n >= MAX_DRAFTS) throw E.bad(`الحد الأقصى ${MAX_DRAFTS} مسودة؛ احذف مسودة قديمة أولاً`);
      await db.run("INSERT INTO clip_drafts(id, user_id, media_id, caption, cover_pos, link, publish_at, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)", [id, user.id, mid, caption, coverPos, link, publishAt, at]);
    }
    return { draft: await draftView(user, await db.get("SELECT * FROM clip_drafts WHERE id=$1", [id])) };
  }
  async function deleteDraft(user, id) {
    await db.run("DELETE FROM clip_drafts WHERE id=$1 AND user_id=$2", [String(id || ""), user.id]);
    return { ok: true };
  }

  /* ---------- per-clip stats ---------- */
  async function clipStats(user, pid) {
    pid = str(pid, 80, { required: true });
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!row || row.type !== "video" || ["deleted", "removed"].includes(row.status)) throw E.nf("المقطع غير موجود");
    if (row.author !== user.id && !isStaff(user)) throw E.nf("المقطع غير موجود");
    const st = (await clips().stats([row.id]))[row.id] || {};
    const agg = await rd.get("SELECT COUNT(*) n, SUM(completed) c, AVG(watched_ms) a FROM clip_watch WHERE post_id=$1 AND user_id<>$2", [row.id, row.author]);
    const views = Number(agg?.n || 0), completed = Number(agg?.c || 0);
    const src = await rd.all("SELECT src, COUNT(*) n FROM clip_watch WHERE post_id=$1 AND user_id<>$2 GROUP BY src", [row.id, row.author]);
    const since = new Date(Date.now() - DAYS * 864e5).toISOString();
    const firsts = (await rd.all("SELECT first_at FROM clip_watch WHERE post_id=$1 AND user_id<>$2 AND first_at IS NOT NULL AND first_at >= $3", [row.id, row.author, since])).map((r) => r.first_at);
    const clicks = await rd.get("SELECT COUNT(*) n FROM clip_link_clicks WHERE post_id=$1", [row.id]).catch(() => null);
    const data = parse(row.data) || {};
    return {
      clip: { id: row.id, text: String(row.text || "").slice(0, 120), cover: data.cover || data.video?.variants?.poster || null, status: row.status, createdAt: iso(row.created_at), publishAt: iso(row.publish_at), duration: Number(data.video?.duration) || null },
      views, completed, completionPct: completionPct(views, completed), avgWatchSec: Math.round(Number(agg?.a || 0) / 100) / 10,
      likes: st.likes || 0, comments: st.comments || 0, shares: st.shares || 0, linkClicks: Number(clicks?.n || 0),
      sources: sourceShares(src), daily: dayBuckets(firsts)
    };
  }

  /* ---------- best time to post ---------- */
  async function bestTime(user) {
    const since = new Date(Date.now() - BEST_DAYS * 864e5).toISOString();
    const rows = await rd.all(`SELECT w.updated_at FROM clip_watch w JOIN follows f ON f.src=w.user_id AND f.dst=$1 WHERE w.updated_at >= $2 ORDER BY w.updated_at DESC LIMIT ${BEST_ROWS}`, [user.id, since]);
    const followers = Number((await rd.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [user.id]))?.n || 0);
    return { ...bestHours(rows.map((r) => r.updated_at)), followers, days: BEST_DAYS };
  }

  R.get("/api/clips/drafts", A(async (req) => listDrafts(req.user)));
  R.put("/api/clips/drafts/:id", A(async (req) => saveDraft(req.user, req.params.id, req.body || {})));
  R.del("/api/clips/drafts/:id", A(async (req) => deleteDraft(req.user, req.params.id)));
  R.get("/api/clips/insights/best-time", A(async (req) => bestTime(req.user)));
  R.get("/api/clips/:id/stats", A(async (req) => clipStats(req.user, req.params.id)));
  return { listDrafts, saveDraft, deleteDraft, clipStats, bestTime };
};
Object.assign(module.exports, { completionPct, sourceShares, dayBuckets, bestHours, SOURCES, MAX_DRAFTS });
