/* Advanced creator analytics (phase 61) — extends the Phase 15 creator studio (services/studio.js), nothing duplicated:
 * the studio keeps its overview / per-post / calendar / recycle screens; this service adds the deeper reports.
 *  1. Attention beacon: signed-in viewers report time on a post page and media progress (read time / watch time / listen
 *     time, furthest point reached) → content_attention, one row per post, viewer and day (capped, idempotent upsert).
 *  2. Audience: growth (new − lost followers per day, from audience_events + follows), returning-viewer retention between
 *     periods, follower cohorts (of those who followed in week w, how many still follow), active-follower share.
 *  3. Demographics, coarse and k-anonymous: country, interface language, device class of unique viewers. A bucket is shown
 *     only when at least K distinct viewers are in it (CREATOR_K_ANON, default 5); the rest folds into «أخرى» (shown only
 *     when that also reaches K); fewer than K viewers in total → nothing is shown. Never a list of people.
 *  4. Content performance per post and per type: views, reach, average attention, completion, engagement rate, saves and
 *     shares, compared with the creator's own median; best time to post from the creator's own results (falls back to the
 *     studio's audience-activity heat map).
 *  5. Earnings across every stream in the double-entry ledger (lib/ledger.js): tips, monthly support / creator
 *     subscriptions, paid posts, digital products, market sales — gross, platform fee, net, reversals — plus ad spend on
 *     the creator's own promotions; daily series and distinct supporters.
 *  6. Comparisons: every report carries the previous period of the same length; /compare puts any two ranges side by side.
 *  7. CSV exports (UTF-8 BOM for spreadsheet apps; formula-injection safe) for audience, content and earnings.
 * Reads only; the only writes are the attention rows and the follow/unfollow audience events. */
const { E, now } = require("../lib/core");
const { SEC_HEADERS } = require("../lib/http");
const { U } = require("../lib/ledger");
const geo = require("../lib/geo");

const DAY = 864e5;
const LANGS = { ar: "العربية", en: "English", fr: "Français", ur: "اردو" };
const DEVICES = { mobile: "جوال", tablet: "جهاز لوحي", desktop: "حاسوب", pi: "متصفح Pi" };
const STREAMS = { tips: "الإكراميات", subs: "الدعم الشهري والاشتراكات", paid: "المنشورات المدفوعة", digital: "المنتجات الرقمية", market: "مبيعات السوق" };
const TYPE_LABEL = { post: "منشور", article: "مقال", question: "سؤال", poll: "استطلاع", discussion: "نقاش", video: "فيديو", short: "فيديو قصير", audio: "صوت", image: "صورة", event: "فعالية", share: "مشاركة" };
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (a, b) => (b ? r1((a / b) * 100) : 0);
const delta = (a, b) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const piOf = (u) => Math.round(Number(u || 0)) / U;

/** device class from a User-Agent (coarse on purpose) */
function deviceOf(ua = "") {
  if (/PiBrowser/i.test(ua)) return "pi";
  if (/iPad|Tablet|Nexus (7|9|10)|SM-T\d/i.test(ua)) return "tablet";
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return "mobile";
  return "desktop";
}
/** k-anonymous breakdown: { key → count } → buckets with ≥ k members; the rest folds into «other» (shown only when ≥ k) */
function kAnon(counts, k, labels = {}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total < k) return { total, shown: false, buckets: [], suppressed: Object.keys(counts).length };
  const buckets = [], small = []; let other = 0;
  for (const [key, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) { if (key !== "other" && n >= k) buckets.push({ key, label: labels[key] || key, share: pct(n, total) }); else { other += n; small.push(key); } }
  if (other >= k) buckets.push({ key: "other", label: "أخرى", share: pct(other, total) });
  return { total, shown: true, buckets, suppressed: other >= k ? 0 : small.length };
}
/** cell-safe CSV (Excel formula injection guarded) */
const csvCell = (v) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
const csv = (head, rows) => "\ufeff" + [head.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");

/** @param {any} ctx @param {{ env?: Record<string,string|undefined>, now?: () => Date }} [opts] */
module.exports = (ctx, opts = {}) => {
  const { db, bus, rl, cache } = ctx;
  const env = opts.env || process.env;
  const R = ctx.router, A = ctx.requireUser;
  const K = Math.max(2, +(env.CREATOR_K_ANON || 5));
  const clock = () => (opts.now ? opts.now() : new Date());
  const rdb = () => db.read || db;
  const ph = (a, off = 0) => a.map((_, i) => "$" + (i + 1 + off)).join(",");

  /* ---------- helpers ---------- */
  /** a period [f, t) and the previous one of the same length; days = 7..365, or explicit from/to (YYYY-MM-DD, ≤ 366 days) */
  function period(q = {}) {
    const okD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !isNaN(Date.parse(v));
    let t = clock().getTime(), f;
    if (okD(q.from) && okD(q.to)) {
      f = Date.parse(q.from + "T00:00:00Z"); t = Date.parse(q.to + "T00:00:00Z") + DAY;
      if (t <= f) throw E.bad("نطاق التاريخ غير صالح");
      if (t - f > 366 * DAY) throw E.bad("أقصى مدة للتقرير سنة واحدة");
    } else f = t - Math.min(365, Math.max(7, Math.round(+q.days || 28))) * DAY;
    const len = t - f, tz = Math.max(-720, Math.min(840, Math.round(+q.tz || 0)));
    return { f: new Date(f).toISOString(), t: new Date(t).toISOString(), pf: new Date(f - len).toISOString(), days: Math.round(len / DAY), tz, fMs: f, tMs: t };
  }
  const dayKey = (ms, tz) => new Date(ms + tz * 60e3).toISOString().slice(0, 10);
  function dayList(p) { const out = []; for (let ms = p.fMs; ms < p.tMs; ms += DAY) out.push(dayKey(ms, p.tz)); out.push(dayKey(p.tMs - 1, p.tz)); return [...new Set(out)]; }
  async function inChunks(ids, fn) { const list = [...new Set(ids.filter(Boolean))], out = []; for (let i = 0; i < list.length; i += 300) out.push(...(await fn(list.slice(i, i + 300)))); return out; }
  const isMinor = async (uid) => { try { return !!(await ctx.services.minors?.isMinorUser?.(uid)); } catch { return false; } };
  const typeOf = (p) => (p.type === "video" && (p.data?.video?.short || p.data?.short) ? "short" : p.data?.images?.length && p.type === "post" ? "image" : p.type);

  /* ======================= 1. attention beacon ======================= */
  async function attention(user, b = {}) {
    if (!user) return { ok: false, recorded: false };
    if (!rl.hit("default", "attn:" + user.id)) throw E.rate();
    const post = typeof b.post === "string" ? b.post.slice(0, 64) : ""; if (!post) throw E.bad("منشور غير محدد");
    const p = await db.get("SELECT id, author, type, status FROM posts WHERE id=$1", [post]);
    if (!p || p.status !== "published") throw E.nf();
    if (p.author === user.id) return { ok: true, recorded: false, reason: "own" };
    const kind = ["page", "video", "audio"].includes(b.kind) ? b.kind : "page";
    const ms = Math.max(0, Math.min(30 * 60e3, Math.round(+b.ms || 0)));          // ≤ 30 min per beacon
    const mediaMs = Math.max(0, Math.min(30 * 60e3, Math.round(+b.mediaMs || 0)));
    const progress = Math.max(0, Math.min(100, Math.round(+b.progress || 0)));
    if (ms < 1000 && mediaMs < 1000 && !progress) return { ok: true, recorded: false, reason: "too_short" };
    const day = new Date().toISOString().slice(0, 10), cap = 4 * 3600e3; // ≤ 4 h per post, viewer and day
    const ex = await db.get("SELECT id, ms, media_ms, progress, kind FROM content_attention WHERE post=$1 AND user_id=$2 AND day=$3", [p.id, user.id, day]);
    if (ex) await db.run("UPDATE content_attention SET ms=$1, media_ms=$2, progress=$3, kind=$4, at=$5 WHERE id=$6",
      [Math.min(cap, Number(ex.ms) + ms), Math.min(cap, Number(ex.media_ms) + mediaMs), Math.max(Number(ex.progress), progress), ex.kind === "page" ? kind : ex.kind, now(), ex.id]);
    else await db.run("INSERT INTO content_attention(post,author,user_id,day,kind,ms,progress,media_ms,at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING", [p.id, p.author, user.id, day, kind, ms, progress, mediaMs, now()]);
    forget(p.author);
    return { ok: true, recorded: true };
  }
  const forget = (uid) => { for (const k of ["ov", "au", "ct"]) cache.del(`can:${k}:${uid}:`); };
  const flow = (kind) => (e) => { if (e?.from && e?.to && e.from !== e.to) db.run("INSERT INTO audience_events(creator_id,user_id,kind,at) VALUES($1,$2,$3,$4)", [e.to, e.from, kind, now()]).then(() => forget(e.to), () => { }); };
  bus.on("USER_FOLLOWED", flow("follow"));
  bus.on("USER_UNFOLLOWED", flow("unfollow"));

  /* ======================= shared raw data ======================= */
  async function views(uid, from, to) {
    return rdb().all("SELECT v.post, v.user_id, v.at FROM post_views v JOIN posts p ON p.id=v.post WHERE p.author=$1 AND v.at >= $2 AND v.at < $3 LIMIT 300000", [uid, from, to]);
  }
  async function engagement(uid, from, to) {
    const rx = await rdb().all("SELECT r.target AS post, r.at FROM reactions r JOIN posts p ON p.id=r.target WHERE p.author=$1 AND r.user_id<>$1 AND r.at >= $2 AND r.at < $3", [uid, from, to]);
    const cm = await rdb().all("SELECT c.post, c.created_at AS at FROM comments c JOIN posts p ON p.id=c.post WHERE p.author=$1 AND c.author<>$1 AND c.created_at >= $2 AND c.created_at < $3", [uid, from, to]);
    const sg = await rdb().all("SELECT s.post, s.kind, s.at FROM engagement_signals s WHERE s.author=$1 AND s.user_id<>$1 AND s.kind IN ('save','share','quote') AND s.at >= $2 AND s.at < $3", [uid, from, to]);
    return { rx, cm, sg };
  }
  async function attentionRows(uid, from, to) {
    return rdb().all("SELECT post, user_id, kind, ms, media_ms, progress, at FROM content_attention WHERE author=$1 AND at >= $2 AND at < $3 LIMIT 300000", [uid, from, to]);
  }
  /** follower flow in [from, to): gained = follow events (recorded since phase 61) + current follows from before tracking began
   *  (no event for them); lost = unfollow events. */
  async function followerFlow(uid, from, to) {
    const ev = await rdb().all("SELECT user_id, kind, at FROM audience_events WHERE creator_id=$1 AND at >= $2 AND at < $3 ORDER BY at", [uid, from, to]);
    const rows = await rdb().all("SELECT src, at FROM follows WHERE dst=$1 AND at >= $2 AND at < $3", [uid, from, to]);
    const tracked = new Set(ev.filter((x) => x.kind === "follow").map((x) => x.user_id));
    const fl = [...ev.filter((x) => x.kind === "follow").map((x) => ({ src: x.user_id, at: x.at })), ...rows.filter((r) => !tracked.has(r.src))];
    return { ev, fl };
  }
  const attnSummary = (rows) => {
    const n = rows.length, ms = rows.reduce((a, r) => a + Number(r.ms) + Number(r.media_ms), 0);
    const tracked = rows.filter((r) => r.kind !== "page" || Number(r.progress) > 0);
    return { sessions: n, avgSeconds: n ? Math.round(ms / n / 1000) : 0, totalMinutes: Math.round(ms / 60e3), completionRate: pct(tracked.filter((r) => Number(r.progress) >= 90).length, tracked.length) };
  };

  /* ======================= 2. KPI block (used by overview + compare) ======================= */
  async function kpis(uid, f, t) {
    const [v, e, a, ff, earn] = await Promise.all([views(uid, f, t), engagement(uid, f, t), attentionRows(uid, f, t), followerFlow(uid, f, t), earningsRaw(uid, f, t)]);
    const eng = e.rx.length + e.cm.length + e.sg.length;
    const gained = ff.fl.length, lost = ff.ev.filter((x) => x.kind === "unfollow").length;
    const at = attnSummary(a);
    const net = earn.streams.reduce((s, x) => s + x.net, 0);
    return { views: v.length, reach: new Set(v.map((x) => x.user_id).filter(Boolean)).size, engagement: eng, engagementRate: pct(eng, v.length),
      followersGained: gained, followersLost: lost, followersNet: gained - lost, avgAttentionSeconds: at.avgSeconds, completionRate: at.completionRate, watchMinutes: at.totalMinutes,
      earningsNet: Math.round(net * 1e7) / 1e7, supporters: earn.supporters };
  }
  const KPI_KEYS = ["views", "reach", "engagement", "engagementRate", "followersGained", "followersLost", "followersNet", "avgAttentionSeconds", "completionRate", "watchMinutes", "earningsNet", "supporters"];
  const deltas = (cur, prev) => Object.fromEntries(KPI_KEYS.map((k) => [k, delta(cur[k], prev[k])]));

  async function overview(user, q) {
    const p = period(q);
    return cache.wrap(`can:ov:${user.id}:${p.f.slice(0, 13)}:${p.t.slice(0, 13)}:${p.tz}`, 60e3, async () => {
      const [cur, prev] = await Promise.all([kpis(user.id, p.f, p.t), kpis(user.id, p.pf, p.f)]);
      const days = dayList(p), v = await views(user.id, p.f, p.t), e = await engagement(user.id, p.f, p.t);
      const byDay = (rows, field = "at") => { const m = Object.fromEntries(days.map((d) => [d, 0])); for (const r of rows) { const k = dayKey(Date.parse(r[field]), p.tz); if (k in m) m[k]++; } return days.map((d) => ({ day: d, value: m[d] })); };
      const weekly = []; const vd = byDay(v); for (let i = 0; i < vd.length; i += 7) { const w = vd.slice(i, i + 7); weekly.push({ from: w[0].day, views: w.reduce((a, x) => a + x.value, 0) }); }
      const trend = weekly.length >= 2 ? delta(weekly[weekly.length - 1].views, weekly[weekly.length - 2].views) : 0;
      return { range: { from: p.f, to: p.t, days: p.days }, kpis: cur, previous: prev, deltas: deltas(cur, prev), daily: { views: vd, engagement: byDay([...e.rx, ...e.cm, ...e.sg]) }, weekly, weekTrend: trend, minor: await isMinor(user.id), k: K };
    });
  }

  /* ======================= 3. audience ======================= */
  async function audience(user, q) {
    const p = period(q), uid = user.id;
    return cache.wrap(`can:au:${uid}:${p.f.slice(0, 13)}:${p.t.slice(0, 13)}:${p.tz}`, 60e3, async () => {
      const days = dayList(p);
      const total = Number((await rdb().get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [uid]))?.n || 0);
      const { ev, fl } = await followerFlow(uid, p.f, new Date(Date.parse(p.t) + DAY).toISOString());
      const gained = Object.fromEntries(days.map((d) => [d, 0])), lost = Object.fromEntries(days.map((d) => [d, 0]));
      for (const x of fl) { const k = dayKey(Date.parse(x.at), p.tz); if (k in gained) gained[k]++; }
      for (const x of ev) if (x.kind === "unfollow") { const k = dayKey(Date.parse(x.at), p.tz); if (k in lost) lost[k]++; }
      // running total, walked back from today's count
      let run = total; const growth = [];
      for (let i = days.length - 1; i >= 0; i--) { const d = days[i]; growth.unshift({ day: d, gained: gained[d], lost: lost[d], net: gained[d] - lost[d], total: run }); run -= gained[d] - lost[d]; }
      // retention 1: returning viewers (viewed in the previous period AND in this one)
      const [vNow, vPrev] = await Promise.all([views(uid, p.f, p.t), views(uid, p.pf, p.f)]);
      const nowSet = new Set(vNow.map((x) => x.user_id).filter(Boolean)), prevSet = new Set(vPrev.map((x) => x.user_id).filter(Boolean));
      const returning = [...prevSet].filter((x) => nowSet.has(x)).length;
      // retention 2: follower cohorts by week of following (still following now?)
      const since = Math.max(p.fMs, clock().getTime() - 12 * 7 * DAY);
      const coh = await rdb().all("SELECT user_id, kind, at FROM audience_events WHERE creator_id=$1 AND at >= $2 ORDER BY at", [uid, new Date(since).toISOString()]);
      const stillIds = new Set();
      const followIds = [...new Set(coh.filter((x) => x.kind === "follow").map((x) => x.user_id))];
      for (const r of await inChunks(followIds, (part) => rdb().all(`SELECT src FROM follows WHERE dst=$1 AND src IN (${ph(part, 1)})`, [uid, ...part]))) stillIds.add(r.src);
      const weeks = {};
      for (const x of coh.filter((c) => c.kind === "follow")) { const w = new Date(Date.parse(x.at) - new Date(x.at).getUTCDay() * DAY).toISOString().slice(0, 10); /* weeks start on Sunday */ (weeks[w] ||= new Set()).add(x.user_id); }
      const cohorts = Object.entries(weeks).sort().map(([week, s]) => ({ week, gained: s.size, retained: [...s].filter((x) => stillIds.has(x)).length, rate: pct([...s].filter((x) => stillIds.has(x)).length, s.size) }));
      // active followers: followers who viewed something in the period
      const followerViewers = [...nowSet].length ? (await inChunks([...nowSet], (part) => rdb().all(`SELECT src FROM follows WHERE dst=$1 AND src IN (${ph(part, 1)})`, [uid, ...part]))).length : 0;
      return { range: { from: p.f, to: p.t, days: p.days }, followers: total, growth, gained: fl.length, lost: ev.filter((x) => x.kind === "unfollow").length,
        retention: { viewers: nowSet.size, previousViewers: prevSet.size, returning, returningRate: pct(returning, prevSet.size), newViewers: nowSet.size - returning, cohorts },
        activeFollowers: { count: followerViewers, share: pct(followerViewers, total) }, demographics: await demographics(uid, [...nowSet]), k: K,
        note: "تبدأ أرقام إلغاء المتابعة من تاريخ تفعيل هذه التحليلات؛ الفئات الصغيرة تُدمج أو تُحجب لحماية خصوصية المتابعين." };
    });
  }
  async function demographics(uid, viewerIds) {
    const ids = viewerIds.filter((x) => x && x !== uid);
    const users = await inChunks(ids, (part) => rdb().all(`SELECT id, lang, location, country FROM users WHERE id IN (${ph(part)})`, part));
    const sess = await inChunks(ids, (part) => rdb().all(`SELECT user_id, ua, created_at FROM sessions WHERE user_id IN (${ph(part)})`, part));
    const lastUa = new Map(); for (const s of sess) { const c = lastUa.get(s.user_id); if (!c || c.created_at < s.created_at) lastUa.set(s.user_id, s); }
    const country = {}, lang = {}, device = {};
    for (const u of users) {
      const c = geo.resolve(u.location, u.country).country || "unknown"; country[c] = (country[c] || 0) + 1;
      const l = LANGS[u.lang] ? u.lang : "other"; lang[l] = (lang[l] || 0) + 1;
      const s = lastUa.get(u.id); const d = s ? deviceOf(s.ua || "") : "unknown"; device[d] = (device[d] || 0) + 1;
    }
    const cl = { ...geo.COUNTRY_AR, unknown: "غير محدد" };
    return { k: K, countries: kAnon(country, K, cl), languages: kAnon(lang, K, LANGS), devices: kAnon(device, K, { ...DEVICES, unknown: "غير محدد" }) };
  }

  /* ======================= 4. content performance ======================= */
  async function contentReport(user, q) {
    const p = period(q), uid = user.id;
    const key = `can:ct:${uid}:${p.f.slice(0, 13)}:${p.t.slice(0, 13)}:${p.tz}`;
    const base = await cache.wrap(key, 60e3, async () => {
      const posts = await rdb().all("SELECT id, type, title, text, data, created_at, views FROM posts WHERE author=$1 AND status='published' AND type<>'story' AND repost_of IS NULL AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC LIMIT 500", [uid, new Date(p.fMs - 0).toISOString(), p.t]);
      const ids = posts.map((x) => x.id);
      const v = ids.length ? await inChunks(ids, (part) => rdb().all(`SELECT post, user_id FROM post_views WHERE post IN (${ph(part)})`, part)) : [];
      const rx = ids.length ? await inChunks(ids, (part) => rdb().all(`SELECT target AS post FROM reactions WHERE target IN (${ph(part)}) AND user_id<>$${part.length + 1}`, [...part, uid])) : [];
      const cm = ids.length ? await inChunks(ids, (part) => rdb().all(`SELECT post FROM comments WHERE post IN (${ph(part)}) AND author<>$${part.length + 1} AND status='published'`, [...part, uid])) : [];
      const sg = ids.length ? await inChunks(ids, (part) => rdb().all(`SELECT post, kind FROM engagement_signals WHERE post IN (${ph(part)}) AND kind IN ('save','share','quote')`, part)) : [];
      const at = ids.length ? await inChunks(ids, (part) => rdb().all(`SELECT post, kind, ms, media_ms, progress FROM content_attention WHERE post IN (${ph(part)})`, part)) : [];
      const group = (rows) => { const m = new Map(); for (const r of rows) { const a = m.get(r.post) || []; a.push(r); m.set(r.post, a); } return m; };
      const V = group(v), RX = group(rx), CM = group(cm), SG = group(sg), AT = group(at);
      const rows = posts.map((x) => {
        const vv = V.get(x.id) || [], n = Math.max(Number(x.views || 0), vv.length), r = (RX.get(x.id) || []).length, c = (CM.get(x.id) || []).length;
        const s = SG.get(x.id) || [], saves = s.filter((y) => y.kind === "save").length, shares = s.length - saves, a = attnSummary(AT.get(x.id) || []);
        const eng = r + c + saves + shares;
        const pubAt = new Date(Date.parse(x.created_at) + p.tz * 60e3);
        return { id: x.id, type: typeOf(x), typeLabel: TYPE_LABEL[typeOf(x)] || x.type, title: (x.title || x.text || "").slice(0, 90), at: x.created_at, weekday: pubAt.getUTCDay(), hour: pubAt.getUTCHours(),
          views: n, reach: new Set(vv.map((y) => y.user_id).filter(Boolean)).size, reactions: r, comments: c, saves, shares, engagementRate: pct(eng, n),
          avgAttentionSeconds: a.avgSeconds, completionRate: a.completionRate, attentionSessions: a.sessions };
      });
      return rows;
    });
    const mViews = median(base.map((x) => x.views)), mEng = median(base.map((x) => x.engagementRate));
    const rows = base.map((x) => ({ ...x, vsMedian: { views: mViews ? Math.round(((x.views - mViews) / mViews) * 100) : 0, engagementRate: r1(x.engagementRate - mEng) } }));
    const SORTS = { views: (a, b) => b.views - a.views, engagement: (a, b) => b.engagementRate - a.engagementRate, attention: (a, b) => b.avgAttentionSeconds - a.avgAttentionSeconds, completion: (a, b) => b.completionRate - a.completionRate, recent: (a, b) => (a.at < b.at ? 1 : -1) };
    const type = typeof q.type === "string" && TYPE_LABEL[q.type] ? q.type : null;
    const list = rows.filter((x) => !type || x.type === type).sort(SORTS[q.sort] || SORTS.views);
    const byType = Object.values(rows.reduce((m, x) => { const g = (m[x.type] ||= { type: x.type, label: x.typeLabel, posts: 0, views: 0, eng: 0, att: 0, attN: 0, comp: [], }); g.posts++; g.views += x.views; g.eng += x.reactions + x.comments + x.saves + x.shares; if (x.attentionSessions) { g.att += x.avgAttentionSeconds * x.attentionSessions; g.attN += x.attentionSessions; g.comp.push(x.completionRate); } return m; }, {}))
      .map((g) => ({ type: g.type, label: g.label, posts: g.posts, avgViews: Math.round(g.views / g.posts), engagementRate: pct(g.eng, g.views), avgAttentionSeconds: g.attN ? Math.round(g.att / g.attN) : 0, completionRate: g.comp.length ? r1(g.comp.reduce((a, b) => a + b, 0) / g.comp.length) : 0 }))
      .sort((a, b) => b.avgViews - a.avgViews);
    return { range: { from: p.f, to: p.t, days: p.days }, posts: list.slice(0, Math.min(200, Math.max(1, +q.limit || 50))), count: list.length, byType, medians: { views: mViews, engagementRate: mEng }, bestTime: await bestTime(user, rows, p.tz), types: Object.entries(TYPE_LABEL).map(([key, label]) => ({ key, label })) };
  }
  /** best time to post from the creator's own results (≥ 2 posts in a slot), else the studio's audience-activity heat map */
  async function bestTime(user, rows, tz) {
    const slots = {}; for (const x of rows) { if (!x.views) continue; const k = `${x.weekday}:${Math.floor(x.hour / 3) * 3}`; (slots[k] ||= []).push(x); }
    const ranked = Object.entries(slots).filter(([, a]) => a.length >= 2).map(([k, a]) => { const [d, h] = k.split(":").map(Number); return { day: d, hour: h, posts: a.length, avgViews: Math.round(a.reduce((s, x) => s + x.views, 0) / a.length), engagementRate: r1(a.reduce((s, x) => s + x.engagementRate, 0) / a.length) }; })
      .sort((a, b) => b.avgViews * (1 + b.engagementRate / 100) - a.avgViews * (1 + a.engagementRate / 100));
    if (ranked.length) return { source: "own", slots: ranked.slice(0, 3) };
    try { const s = await ctx.services.studio.bestTime(user, tz); return { source: "audience", slots: (s.best.length ? s.best : s.fallback || []).slice(0, 3).map((x) => ({ day: x.day, hour: x.hour })), enough: s.enough }; } catch { return { source: "none", slots: [] }; }
  }

  /* ======================= 5. earnings ======================= */
  async function earningsRaw(uid, from, to) {
    const accs = [`creator:${uid}:earnings`, `seller:${uid}:earnings`, `user:${uid}:pi_out`];
    const ent = await rdb().all("SELECT e.journal_id, e.account, e.debit, e.credit, j.kind, j.source, j.ref_id, j.sender_id, j.reverses, j.created_at FROM ledger_entries e JOIN ledger_journals j ON j.id=e.journal_id WHERE e.account IN ($1,$2,$3) AND j.created_at >= $4 AND j.created_at < $5 ORDER BY j.created_at", [...accs, from, to]);
    const jids = [...new Set(ent.filter((e) => e.account !== accs[2]).map((e) => e.journal_id))];
    const fees = new Map(); for (const r of await inChunks(jids, (part) => rdb().all(`SELECT journal_id, credit, debit FROM ledger_entries WHERE account='platform:fees' AND journal_id IN (${ph(part)})`, part))) fees.set(r.journal_id, (fees.get(r.journal_id) || 0) + Number(r.credit) - Number(r.debit));
    const marketRefs = [...new Set(ent.filter((e) => e.source === "market").map((e) => e.ref_id))];
    const digital = new Set(); try { for (const r of await inChunks(marketRefs, (part) => rdb().all(`SELECT o.id FROM market_orders o JOIN market_listings l ON l.id=o.listing_id WHERE l.kind='digital' AND o.id IN (${ph(part)})`, part))) digital.add(r.id); } catch { /* market not installed */ }
    const streamOf = (e) => ({ tip: "tips", support: "subs", ppv: "paid" })[e.source] || (e.source === "market" ? (digital.has(e.ref_id) ? "digital" : "market") : null);
    const S = Object.fromEntries(Object.keys(STREAMS).map((k) => [k, { key: k, label: STREAMS[k], gross: 0, fees: 0, net: 0, reversed: 0, count: 0 }]));
    const supporters = new Set(), daily = []; let adSpend = 0, adRefund = 0, payouts = 0;
    for (const e of ent) {
      const d = Number(e.debit), c = Number(e.credit);
      if (e.account === accs[2]) { if (e.source === "ads") { adSpend += d; adRefund += c; } continue; }
      if (/payout/.test(e.kind)) { payouts += d; continue; }
      const st = streamOf(e); if (!st) continue;
      if (e.kind === "reversal") { S[st].reversed += d - c; S[st].net -= d - c; daily.push({ at: e.created_at, v: -(d - c) }); continue; }
      if (c > 0 && /(hold)$/.test(e.kind)) continue; // held funds are not earned yet
      const fee = Math.max(0, fees.get(e.journal_id) || 0);
      S[st].gross += c - d + fee; S[st].fees += fee; S[st].net += c - d; if (c > d) S[st].count++;
      if (e.sender_id) supporters.add(e.sender_id);
      daily.push({ at: e.created_at, v: c - d });
    }
    const streams = Object.values(S).map((s) => ({ ...s, gross: piOf(s.gross), fees: piOf(s.fees), net: piOf(s.net), reversed: piOf(s.reversed) }));
    return { streams, supporters: supporters.size, daily, adSpend: piOf(adSpend - adRefund), payouts: piOf(payouts) };
  }
  async function earnings(user, q) {
    const p = period(q);
    const [cur, prev] = await Promise.all([earningsRaw(user.id, p.f, p.t), earningsRaw(user.id, p.pf, p.f)]);
    const days = dayList(p), m = Object.fromEntries(days.map((d) => [d, 0]));
    for (const x of cur.daily) { const k = dayKey(Date.parse(x.at), p.tz); if (k in m) m[k] += x.v; }
    const sum = (r, k) => Math.round(r.streams.reduce((a, s) => a + s[k], 0) * 1e7) / 1e7;
    const totals = { gross: sum(cur, "gross"), fees: sum(cur, "fees"), net: sum(cur, "net"), reversed: sum(cur, "reversed"), supporters: cur.supporters, adSpend: cur.adSpend, payouts: cur.payouts };
    totals.perSupporter = cur.supporters ? Math.round((totals.net / cur.supporters) * 1e7) / 1e7 : 0;
    totals.afterAds = Math.round((totals.net - cur.adSpend) * 1e7) / 1e7;
    const previous = { gross: sum(prev, "gross"), net: sum(prev, "net"), supporters: prev.supporters, adSpend: prev.adSpend };
    const prevBy = Object.fromEntries(prev.streams.map((s) => [s.key, s.net]));
    const pi = ctx.services.pi?.diag?.(), piOn = !!(pi && pi.enabled && pi.apiKeyPresent);
    const minor = await isMinor(user.id);
    return { range: { from: p.f, to: p.t, days: p.days }, totals, previous, deltas: { net: delta(totals.net, previous.net), gross: delta(totals.gross, previous.gross), supporters: delta(totals.supporters, previous.supporters) },
      streams: cur.streams.map((s) => ({ ...s, share: pct(s.net, totals.net || 1), previousNet: prevBy[s.key] || 0, delta: delta(s.net, prevBy[s.key] || 0) })),
      daily: days.map((d) => ({ day: d, value: Math.round((m[d] / U) * 1e7) / 1e7 })), piEnabled: piOn, minor,
      note: minor ? "حسابات القاصرين لا تستقبل أرباحاً." : !piOn ? "مدفوعات Pi غير مفعّلة بعد، لذلك لا توجد أرباح. ستظهر هنا تلقائياً فور تفعيلها." : null };
  }

  /* ======================= 6. compare two ranges ======================= */
  async function compare(user, q) {
    const a = period({ from: q.aFrom, to: q.aTo, days: q.days }), b = period({ from: q.bFrom, to: q.bTo, days: q.days });
    if (!(q.aFrom && q.aTo && q.bFrom && q.bTo)) throw E.bad("حدد الفترتين للمقارنة");
    const [A1, B1] = await Promise.all([kpis(user.id, a.f, a.t), kpis(user.id, b.f, b.t)]);
    return { a: { from: a.f, to: a.t, days: a.days, kpis: A1 }, b: { from: b.f, to: b.t, days: b.days, kpis: B1 }, deltas: deltas(B1, A1), keys: KPI_KEYS };
  }

  /* ======================= 8. one post, in depth (v2.29) ======================= */
  const SOURCE_LABEL = { feed: "الخلاصة", following: "خلاصة المتابَعين", story: "القصص", profile: "ملفك الشخصي", explore: "استكشف", community: "المجتمعات", notification: "الإشعارات", shorts: "الفيديو القصير", search: "البحث", direct: "رابط مباشر أو مشاركة", share: "رابط مباشر أو مشاركة" };
  const RX_LABEL = { like: "❤️ إعجاب", support: "👏 دعم", haha: "😂 ضحك", useful: "💡 مفيد" };
  async function postDetail(user, id, q = {}) {
    const x = await rdb().get("SELECT id, author, type, title, text, data, created_at, views, status FROM posts WHERE id=$1", [String(id || "").slice(0, 64)]);
    if (!x || x.author !== user.id || x.status === "removed") throw E.nf("المنشور غير موجود أو ليس لك");
    let data = x.data; if (typeof data === "string") { try { data = JSON.parse(data); } catch { data = {}; } }
    const tz = Math.max(-720, Math.min(840, Math.round(+q.tz || 0)));
    const v = await rdb().all("SELECT user_id, source, at FROM post_views WHERE post=$1 ORDER BY at LIMIT 300000", [x.id]);
    const rx = await rdb().all("SELECT type, at FROM reactions WHERE target=$1 AND user_id<>$2", [x.id, user.id]);
    const cm = await rdb().all("SELECT created_at AS at FROM comments WHERE post=$1 AND author<>$2 AND status='published'", [x.id, user.id]);
    const sg = await rdb().all("SELECT kind, at FROM engagement_signals WHERE post=$1 AND user_id<>$2 AND kind IN ('save','share','quote')", [x.id, user.id]);
    const at = await rdb().all("SELECT kind, ms, media_ms, progress FROM content_attention WHERE post=$1", [x.id]);
    const views = Math.max(Number(x.views || 0), v.length), saves = sg.filter((s) => s.kind === "save").length, shares = sg.length - saves;
    const eng = rx.length + cm.length + saves + shares, a = attnSummary(at);
    // daily series from publication: up to 30 days (or until today)
    const start = Date.parse(x.created_at), nDays = Math.max(1, Math.min(30, Math.ceil((clock().getTime() - start) / DAY) || 1)), days = [];
    for (let i = 0; i < nDays; i++) days.push(dayKey(start + i * DAY, tz));
    const series = (rows) => { const m = Object.fromEntries(days.map((d) => [d, 0])); for (const r of rows) { const k = dayKey(Date.parse(r.at), tz); if (k in m) m[k]++; } return days.map((d) => ({ day: d, value: m[d] })); };
    const first24 = v.filter((r) => Date.parse(r.at) - start < DAY).length;
    // read / watch depth: how far people got (only when enough sessions to be meaningful)
    const tracked = at.filter((r) => r.kind !== "page" || Number(r.progress) > 0);
    const BK = [[0, 25, "أقل من الربع"], [25, 50, "حتى النصف"], [50, 75, "أكثر من النصف"], [75, 90, "قرب النهاية"], [90, 101, "حتى النهاية"]];
    const depth = tracked.length >= 3 ? BK.map(([lo, hi, label]) => { const n = tracked.filter((r) => Number(r.progress) >= lo && Number(r.progress) < hi).length; return { label, count: n, share: pct(n, tracked.length) }; }) : [];
    // where views came from (aggregated; a source is a screen, never a person)
    const src = {}; for (const r of v) { const k = SOURCE_LABEL[r.source] ? (r.source === "share" ? "direct" : r.source) : "direct"; src[k] = (src[k] || 0) + 1; }
    const sources = Object.entries(src).map(([k, n]) => ({ key: k, label: SOURCE_LABEL[k], count: n, share: pct(n, v.length) })).sort((p1, p2) => p2.count - p1.count);
    const reactions = Object.entries(rx.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {})).map(([k, n]) => ({ key: k, label: RX_LABEL[k] || k, count: n })).sort((p1, p2) => p2.count - p1.count);
    // compared with the creator's own posts of the last 90 days
    const others = await contentReport(user, { days: 90, tz, limit: 200, sort: "recent" });
    const med = others.medians, rank = [...others.posts].sort((p1, p2) => p2.views - p1.views).findIndex((p) => p.id === x.id);
    const tips = [];
    if (views >= 10 && pct(eng, views) < 2) tips.push("التفاعل أقل من المعتاد: اختم المنشور بسؤال مفتوح أو استطلاع صغير ليشارك القرّاء رأيهم.");
    if (tracked.length >= 5 && a.completionRate < 35) tips.push(x.type === "video" ? "كثيرون يتوقفون مبكراً: اجعل الثواني الخمس الأولى أقوى وقصّر المقدمة." : "أغلب القرّاء لا يصلون للنهاية: قدّم الفكرة الأهم في أول سطرين واستخدم عناوين فرعية.");
    if (sources.length && sources[0].key === "direct" && sources[0].share >= 50) tips.push("أغلب المشاهدات من روابط مباشرة: المشاركة خارج التطبيق تعمل معك — شاركه في مجتمع مناسب أيضاً.");
    if (med.views && views > med.views * 1.5) tips.push("هذا من أفضل منشوراتك: فكّر في جزء ثانٍ أو تحويله إلى مقال أو فيديو قصير.");
    if (!views) tips.push("لم يشاهده أحد بعد: شاركه في مجتمع مهتم بالموضوع أو أعد نشره في أفضل وقت لجمهورك.");
    return { post: { id: x.id, type: typeOf({ ...x, data }), typeLabel: TYPE_LABEL[typeOf({ ...x, data })] || x.type, title: (x.title || x.text || "").slice(0, 140), at: x.created_at },
      totals: { views, reach: new Set(v.map((r) => r.user_id).filter(Boolean)).size, reactions: rx.length, comments: cm.length, saves, shares, engagement: eng, engagementRate: pct(eng, views), first24h: first24,
        avgAttentionSeconds: a.avgSeconds, completionRate: a.completionRate, attentionSessions: a.sessions, watchMinutes: a.totalMinutes },
      daily: { views: series(v), engagement: series([...rx, ...cm, ...sg]) }, depth, sources, reactions,
      versus: { medianViews: med.views, medianEngagementRate: med.engagementRate, viewsVsMedian: med.views ? Math.round(((views - med.views) / med.views) * 100) : 0, rank: rank >= 0 ? rank + 1 : null, of: others.count }, tips };
  }

  /* ======================= 9. goals (v2.29) ======================= */
  const GOALS = { followers: { label: "إجمالي المتابعين", unit: "متابع", max: 1e7 }, views: { label: "مشاهدات هذا الشهر", unit: "مشاهدة", max: 1e9 }, posts: { label: "منشورات هذا الأسبوع", unit: "منشور", max: 100 }, engagementRate: { label: "معدل التفاعل (آخر 28 يوماً)", unit: "%", max: 100 } };
  async function goalProgress(uid, metric) {
    const t = clock(), monthStart = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)).toISOString(), weekStart = new Date(t.getTime() - t.getUTCDay() * DAY).toISOString().slice(0, 10) + "T00:00:00.000Z";
    if (metric === "followers") return Number((await rdb().get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [uid]))?.n || 0);
    if (metric === "views") return Number((await rdb().get("SELECT COUNT(*) n FROM post_views v JOIN posts p ON p.id=v.post WHERE p.author=$1 AND v.at >= $2", [uid, monthStart]))?.n || 0);
    if (metric === "posts") return Number((await rdb().get("SELECT COUNT(*) n FROM posts WHERE author=$1 AND status='published' AND type<>'story' AND repost_of IS NULL AND created_at >= $2", [uid, weekStart]))?.n || 0);
    if (metric === "engagementRate") { const k = await kpis(uid, new Date(t.getTime() - 28 * DAY).toISOString(), t.toISOString()); return k.engagementRate; }
    return 0;
  }
  async function goals(user) {
    const rows = await db.all("SELECT metric, target, updated_at FROM creator_goals WHERE user_id=$1", [user.id]);
    const out = [];
    for (const r of rows) { if (!GOALS[r.metric]) continue; const cur = await goalProgress(user.id, r.metric), target = Number(r.target); out.push({ metric: r.metric, ...GOALS[r.metric], target, current: cur, percent: Math.min(100, pct(cur, target)), done: cur >= target }); }
    return { goals: out, available: Object.entries(GOALS).map(([key, g]) => ({ key, label: g.label, unit: g.unit })) };
  }
  async function setGoal(user, b = {}) {
    const g = GOALS[b.metric]; if (!g) throw E.bad("هدف غير معروف");
    const target = Math.round(Number(b.target) * 10) / 10; if (!(target > 0) || target > g.max) throw E.bad("قيمة الهدف غير صالحة");
    const ts = now();
    await db.run("INSERT INTO creator_goals(user_id,metric,target,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT (user_id, metric) DO UPDATE SET target=$3, updated_at=$4", [user.id, b.metric, target, ts]);
    return goals(user);
  }
  async function deleteGoal(user, metric) { await db.run("DELETE FROM creator_goals WHERE user_id=$1 AND metric=$2", [user.id, String(metric || "")]); return goals(user); }

  /* ======================= 10. insights: plain-language tips from the creator's own numbers (v2.29) ======================= */
  async function insights(user, q = {}) {
    const ov = await overview(user, q), ct = await contentReport(user, { ...q, limit: 200 }), K1 = ov.kpis, out = [];
    const days = ov.range.days, posts = ct.count;
    if (!posts) {
      out.push({ id: "first", tone: "tip", title: "ابدأ بأول منشور", body: "التحليلات تمتلئ بمجرد أن تنشر. منشور قصير بسؤال لجمهورك بداية ممتازة.", action: { label: "اكتب منشوراً", compose: true } });
      return { insights: out, empty: true };
    }
    const perWeek = Math.round((posts / Math.max(1, days)) * 7 * 10) / 10;
    if (perWeek < 2) out.push({ id: "cadence", tone: "tip", title: "انشر بانتظام", body: `تنشر نحو ${perWeek} منشور أسبوعياً. الصنّاع الذين ينشرون 3 مرات أسبوعياً على الأقل ينمو جمهورهم أسرع — جدول منشوراتك مسبقاً.`, action: { label: "جدولة منشور", href: "#/studio" } });
    else out.push({ id: "cadence", tone: "good", title: "إيقاع نشر جيد", body: `تنشر نحو ${perWeek} منشور أسبوعياً — حافظ على هذا الإيقاع.` });
    const bt = ct.byType.filter((t) => t.posts >= 2);
    if (bt.length >= 2 && bt[0].avgViews > bt[bt.length - 1].avgViews * 1.3) out.push({ id: "type", tone: "good", title: `«${bt[0].label}» هو الأقوى عندك`, body: `يحصل على ${bt[0].avgViews} مشاهدة في المتوسط مقابل ${bt[bt.length - 1].avgViews} لـ«${bt[bt.length - 1].label}». أكثِر منه.`, action: { label: "تفاصيل المحتوى", href: "#/analytics/content" } });
    const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"], s = ct.bestTime.slots[0];
    if (s) out.push({ id: "time", tone: "tip", title: "أفضل وقت للنشر", body: `جرّب النشر يوم ${DAYS_AR[s.day]} قرابة الساعة ${String(s.hour).padStart(2, "0")}:00 ${ct.bestTime.source === "own" ? "— هذا ما حققت فيه أفضل نتائجك." : "— وقت نشاط جمهورك عادةً."}` });
    if (K1.views >= 20 && K1.engagementRate < 2) out.push({ id: "eng", tone: "warn", title: "التفاعل منخفض", body: `معدل التفاعل ${K1.engagementRate}%. اختم منشوراتك بسؤال، واستخدم الاستطلاعات، ورد على أول التعليقات خلال ساعة.` });
    else if (K1.views >= 20 && K1.engagementRate >= 6) out.push({ id: "eng", tone: "good", title: "جمهورك متفاعل جداً", body: `معدل التفاعل ${K1.engagementRate}% — أعلى من المعتاد. هذا وقت مناسب لتجربة الدعم الشهري أو منتج رقمي.`, action: { label: "أدوات الدخل", href: "#/analytics/earnings" } });
    if (K1.followersLost > K1.followersGained && K1.followersLost >= 3) out.push({ id: "loss", tone: "warn", title: "خسرت متابعين أكثر مما كسبت", body: "راجع آخر منشوراتك قبل أيام الانخفاض في تبويب «الجمهور»، وعد للموضوعات التي جذبت جمهورك أول مرة.", action: { label: "نمو الجمهور", href: "#/analytics/audience" } });
    if (K1.completionRate && K1.completionRate < 35) out.push({ id: "completion", tone: "tip", title: "اجذب القارئ حتى النهاية", body: `${K1.completionRate}% فقط يكملون المحتوى. ضع الفكرة الأهم في البداية وقسّم النص بعناوين قصيرة.` });
    const top = [...ct.posts].sort((p1, p2) => p2.views - p1.views)[0];
    if (top && top.views >= 5) out.push({ id: "top", tone: "good", title: "منشورك الأبرز", body: `«${top.title.slice(0, 60)}» حقق ${top.views} مشاهدة. اطّلع على تفاصيله لتعرف لماذا نجح.`, action: { label: "تحليل المنشور", href: "#/analytics/post/" + encodeURIComponent(top.id) } });
    return { insights: out.slice(0, 6), empty: false };
  }

  /* ======================= 7. CSV ======================= */
  async function exportCsv(req, res) {
    const rep = String(req.query.report || "content"), q = req.query;
    let body;
    if (rep === "audience") { const d = await audience(req.user, q); body = csv(["day", "gained", "lost", "net", "total_followers"], d.growth.map((g) => [g.day, g.gained, g.lost, g.net, g.total])); }
    else if (rep === "earnings") { const d = await earnings(req.user, q); body = csv(["stream", "gross_pi", "fees_pi", "net_pi", "reversed_pi", "payments", "previous_net_pi"], [...d.streams.map((s) => [s.label, s.gross, s.fees, s.net, s.reversed, s.count, s.previousNet]), ["الإنفاق الإعلاني", "", "", -d.totals.adSpend, "", "", ""]]); }
    else if (rep === "content") { const d = await contentReport(req.user, { ...q, limit: 200 }); body = csv(["published_at", "type", "title", "views", "reach", "reactions", "comments", "saves", "shares", "engagement_rate_pct", "avg_attention_s", "completion_pct", "post_id"], d.posts.map((x) => [x.at, x.typeLabel, x.title, x.views, x.reach, x.reactions, x.comments, x.saves, x.shares, x.engagementRate, x.avgAttentionSeconds, x.completionRate, x.id])); }
    else throw E.bad("تقرير غير معروف");
    res.writeHead(200, { ...SEC_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="creator-${rep}-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.end(body); return ctx.STREAM;
  }

  R.post("/api/analytics/attention", async (req) => attention(req.user, req.body || {}));
  R.get("/api/creator/analytics/overview", A(async (req) => overview(req.user, req.query)));
  R.get("/api/creator/analytics/audience", A(async (req) => audience(req.user, req.query)));
  R.get("/api/creator/analytics/content", A(async (req) => contentReport(req.user, req.query)));
  R.get("/api/creator/analytics/earnings", A(async (req) => earnings(req.user, req.query)));
  R.get("/api/creator/analytics/compare", A(async (req) => compare(req.user, req.query)));
  R.get("/api/creator/analytics/export.csv", A(exportCsv));
  R.get("/api/creator/analytics/post/:id", A(async (req) => postDetail(req.user, req.params.id, req.query)));
  R.get("/api/creator/analytics/insights", A(async (req) => insights(req.user, req.query)));
  R.get("/api/creator/analytics/goals", A(async (req) => goals(req.user)));
  R.put("/api/creator/analytics/goals", A(async (req) => setGoal(req.user, req.body || {})));
  R.del("/api/creator/analytics/goals/:metric", A(async (req) => deleteGoal(req.user, req.params.metric)));
  return { attention, overview, audience, demographics, contentReport, earnings, earningsRaw, compare, postDetail, insights, goals, setGoal, deleteGoal, kAnon, deviceOf, K };
};
module.exports.kAnon = kAnon;
module.exports.deviceOf = deviceOf;
module.exports.csvCell = csvCell;
