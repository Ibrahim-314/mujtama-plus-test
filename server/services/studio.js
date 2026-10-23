/* Creator Studio (Phase 15): overview with daily series, per-post analytics (reach, engagement,
 * traffic sources, first-48h curve), best time to post from the audience's own activity, a visual
 * scheduling calendar, recycling of past winners, and a weekly report. */
const { E, id, now } = require("../lib/core");
const DAY = 864e5;
const SOURCE_LABEL = { feed: "الخلاصة", following: "المتابَعون", profile: "الملف الشخصي", search: "البحث", explore: "استكشف", community: "المجتمعات", share: "روابط خارجية", notification: "الإشعارات", direct: "مباشر", shorts: "الفيديو القصير", story: "القصص" };

module.exports = (ctx) => {
  const { db, router: R } = ctx; const A = ctx.requireUser; const content = () => ctx.services.content;
  const n = (r) => Number(r?.n || 0);
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const series = (rows, days, end = Date.now()) => { const m = Object.fromEntries(rows.map(r => [dayKey(r.d), Number(r.n)])); return Array.from({ length: days }, (_, i) => { const k = dayKey(end - (days - 1 - i) * DAY); return { day: k, value: m[k] || 0 }; }); };
  /* group timestamps by UTC day in JS (portable across SQLite/PostgreSQL) */
  const byDay = (rows, field = "at") => { const m = {}; for (const r of rows) { const k = dayKey(r[field]); m[k] = (m[k] || 0) + 1; } return Object.entries(m).map(([d, c]) => ({ d, n: c })); };

  async function overview(u, days) {
    const since = new Date(Date.now() - days * DAY).toISOString(), prevSince = new Date(Date.now() - 2 * days * DAY).toISOString();
    const views = await db.all("SELECT v.at, v.user_id, v.source FROM post_views v JOIN posts p ON p.id=v.post WHERE p.author=$1 AND v.at > $2", [u.id, prevSince]);
    const cur = views.filter(v => new Date(v.at) > new Date(since)), prev = views.filter(v => new Date(v.at) <= new Date(since));
    const rx = await db.all("SELECT r.at FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND r.at > $2 AND r.user_id<>$1", [u.id, prevSince]);
    const cm = await db.all("SELECT c.created_at AS at FROM comments c JOIN posts p ON p.id=c.post WHERE p.author=$1 AND c.created_at > $2 AND c.author<>$1", [u.id, prevSince]);
    const fl = await db.all("SELECT at FROM follows WHERE dst=$1 AND at > $2", [u.id, prevSince]);
    const inCur = (x) => new Date(x.at) > new Date(since);
    const eng = [...rx, ...cm];
    const sources = {}; for (const v of cur) sources[v.source] = (sources[v.source] || 0) + 1;
    const top = await db.all("SELECT p.id, p.type, p.title, p.text, p.created_at, p.views, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) rx, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) cm FROM posts p WHERE p.author=$1 AND p.status='published' AND p.type<>'story' AND p.created_at > $2 ORDER BY p.views DESC LIMIT 5", [u.id, since]);
    const delta = (a, b) => b ? Math.round((a - b) / b * 100) : a ? 100 : 0;
    const totals = { views: cur.length, reach: new Set(cur.map(v => v.user_id)).size, engagement: eng.filter(inCur).length, followers: fl.filter(inCur).length, followersTotal: n(await db.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u.id])) };
    return {
      days, totals, deltas: { views: delta(totals.views, prev.length), reach: delta(totals.reach, new Set(prev.map(v => v.user_id)).size), engagement: delta(totals.engagement, eng.length - totals.engagement), followers: delta(totals.followers, fl.length - totals.followers) },
      engagementRate: totals.views ? Math.round(totals.engagement / totals.views * 1000) / 10 : 0,
      daily: { views: series(byDay(cur), days), engagement: series(byDay(eng.filter(inCur)), days), followers: series(byDay(fl.filter(inCur)), days) },
      sources: Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ source: k, label: SOURCE_LABEL[k] || k, views: v, share: Math.round(v / Math.max(1, cur.length) * 100) })),
      top: top.map(p => ({ id: p.id, type: p.type, title: p.title || p.text.slice(0, 80), at: p.created_at, views: p.views, reactions: n({ n: p.rx }), comments: n({ n: p.cm }) }))
    };
  }
  async function postStats(u, pid) {
    const p = await db.get("SELECT * FROM posts WHERE id=$1", [pid]); if (!p || p.author !== u.id) throw E.nf();
    const views = await db.all("SELECT user_id, source, at FROM post_views WHERE post=$1", [pid]);
    const reactions = await db.all("SELECT type, COUNT(*) n FROM reactions WHERE target=$1 GROUP BY type", [pid]);
    const comments = n(await db.get("SELECT COUNT(*) n FROM comments WHERE post=$1 AND status='published'", [pid]));
    const shares = n(await db.get("SELECT COUNT(*) n FROM posts WHERE (repost_of=$1 OR quote_of=$1) AND status='published'", [pid]));
    const start = new Date(p.created_at).getTime(), curve = Array.from({ length: 48 }, () => 0);
    for (const v of views) { const h = Math.floor((new Date(v.at) - start) / 3600e3); if (h >= 0 && h < 48) curve[h]++; }
    const src = {}; for (const v of views) src[v.source] = (src[v.source] || 0) + 1;
    const rxTotal = reactions.reduce((a, r) => a + Number(r.n), 0), engaged = rxTotal + comments + shares;
    return { post: { id: p.id, title: p.title || p.text.slice(0, 100), type: p.type, createdAt: p.created_at }, views: Math.max(p.views, views.length), reach: new Set(views.map(v => v.user_id)).size,
      reactions: Object.fromEntries(reactions.map(r => [r.type, Number(r.n)])), comments, shares, engagementRate: views.length ? Math.round(engaged / views.length * 1000) / 10 : 0,
      sources: Object.entries(src).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ source: k, label: SOURCE_LABEL[k] || k, views: v, share: Math.round(v / Math.max(1, views.length) * 100) })), first48h: curve };
  }
  /* audience activity heatmap: when do *your followers* react, comment and post? (60 days) */
  async function bestTime(u, tzMin) {
    const since = new Date(Date.now() - 60 * DAY).toISOString();
    const rows = [
      ...await db.all("SELECT r.at FROM reactions r JOIN follows f ON f.src=r.user_id AND f.dst=$1 WHERE r.at > $2", [u.id, since]),
      ...await db.all("SELECT c.created_at AS at FROM comments c JOIN follows f ON f.src=c.author AND f.dst=$1 WHERE c.created_at > $2", [u.id, since]),
      ...await db.all("SELECT p.created_at AS at FROM posts p JOIN follows f ON f.src=p.author AND f.dst=$1 WHERE p.created_at > $2", [u.id, since])
    ];
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of rows) { const d = new Date(new Date(r.at).getTime() + tzMin * 60e3); grid[d.getUTCDay()][d.getUTCHours()]++; }
    const max = Math.max(1, ...grid.flat());
    const slots = []; grid.forEach((row, d) => row.forEach((v, h) => slots.push({ day: d, hour: h, score: v })));
    const best = slots.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    return { samples: rows.length, enough: rows.length >= 30, grid: grid.map(r => r.map(v => Math.round(v / max * 100) / 100)), best, fallback: rows.length < 30 ? [{ day: 0, hour: 21 }, { day: 4, hour: 20 }, { day: 6, hour: 21 }] : undefined };
  }
  async function calendar(u, month) {
    const [y, m] = /^\d{4}-\d{2}$/.test(month || "") ? month.split("-").map(Number) : [new Date().getUTCFullYear(), new Date().getUTCMonth() + 1];
    const from = new Date(Date.UTC(y, m - 1, 1)).toISOString(), to = new Date(Date.UTC(y, m, 1)).toISOString();
    const rows = await db.all("SELECT id, type, title, text, status, publish_at, created_at, views FROM posts WHERE author=$1 AND status IN ('published','scheduled') AND type<>'story' AND ((status='scheduled' AND publish_at >= $2 AND publish_at < $3) OR (status='published' AND created_at >= $2 AND created_at < $3)) ORDER BY COALESCE(publish_at, created_at)", [u.id, from, to]);
    return { month: `${y}-${String(m).padStart(2, "0")}`, items: rows.map(p => ({ id: p.id, type: p.type, title: p.title || p.text.slice(0, 60), status: p.status, at: p.status === "scheduled" ? p.publish_at : p.created_at, views: p.views })) };
  }
  async function recycle(u) {
    const old = new Date(Date.now() - 30 * DAY).toISOString();
    const rows = await db.all("SELECT p.*, (SELECT COUNT(*) FROM reactions r WHERE r.target=p.id) rx, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id) cm, (SELECT MAX(created_at) FROM posts q WHERE q.repost_of=p.id AND q.author=$1) last FROM posts p WHERE p.author=$1 AND p.status='published' AND p.type IN ('post','article','question','poll','discussion') AND p.repost_of IS NULL AND p.created_at < $2 ORDER BY p.views DESC LIMIT 60", [u.id, old]);
    return { candidates: rows.map(p => ({ id: p.id, title: p.title || p.text.slice(0, 90), type: p.type, createdAt: p.created_at, views: p.views, reactions: n({ n: p.rx }), comments: n({ n: p.cm }), score: Math.round((n({ n: p.rx }) * 2 + n({ n: p.cm }) * 3 + p.views * 0.05) * 10) / 10, lastRecycled: p.last })).filter(p => !p.lastRecycled || new Date(p.lastRecycled) < new Date(Date.now() - 30 * DAY)).sort((a, b) => b.score - a.score).slice(0, 10) };
  }
  async function weekly(u) {
    const o = await overview(u, 7);
    const best = o.daily.views.reduce((a, b) => b.value > a.value ? b : a, { value: -1 });
    return { range: { from: o.daily.views[0].day, to: o.daily.views[6].day }, totals: o.totals, deltas: o.deltas, engagementRate: o.engagementRate, bestDay: best.value > 0 ? best.day : null, topPost: o.top[0] || null, daily: o.daily.views, user: { name: u.name, handle: u.handle } };
  }

  R.get("/api/studio/overview", A(async (req) => overview(req.user, Math.min(90, Math.max(7, +req.query.days || 28)))));
  R.get("/api/studio/posts/:id", A(async (req) => postStats(req.user, req.params.id)));
  R.get("/api/studio/best-time", A(async (req) => bestTime(req.user, Math.max(-720, Math.min(840, +req.query.tz || 0)))));
  R.get("/api/studio/calendar", A(async (req) => calendar(req.user, req.query.month)));
  R.patch("/api/studio/schedule/:id", A(async (req) => {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND status='scheduled'", [req.params.id, req.user.id]); if (!p) throw E.nf("ليس منشوراً مجدولاً");
    const at = new Date(req.body.publishAt); if (isNaN(at) || at < new Date(Date.now() + 60e3)) throw E.bad("اختر موعداً في المستقبل");
    await db.run("UPDATE posts SET publish_at=$1 WHERE id=$2", [at.toISOString(), p.id]); return { ok: true, publishAt: at.toISOString() };
  }));
  R.post("/api/studio/schedule/:id/now", A(async (req) => {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND status='scheduled'", [req.params.id, req.user.id]); if (!p) throw E.nf();
    await db.run("UPDATE posts SET publish_at=$1 WHERE id=$2", [now(), p.id]); await content().publishDue(); return { ok: true };
  }));
  R.get("/api/studio/recycle", A(async (req) => recycle(req.user)));
  R.post("/api/studio/recycle/:id", A(async (req) => {
    const p = await db.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND status='published'", [req.params.id, req.user.id]); if (!p) throw E.nf();
    const publishAt = req.body.publishAt && new Date(req.body.publishAt) > new Date() ? req.body.publishAt : undefined;
    const body = req.body.mode === "copy" ? { type: p.type, title: p.title, text: p.text, doc: p.data?.doc, images: p.data?.images, alts: p.data?.alts, topic: p.topic, publishAt, id: id("p") } : { type: "post", text: "", repostOf: p.id, publishAt, id: id("p") };
    if (req.body.mode === "copy" && body.text) body.text = body.text + "\u200b"; // avoid the 24h duplicate guard on intentional re-shares
    return { post: await content().createPost(req.user, body) };
  }));
  R.get("/api/studio/weekly", A(async (req) => weekly(req.user)));
  return { overview, postStats, bestTime, calendar, recycle, weekly };
};
