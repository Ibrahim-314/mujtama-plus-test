/* v2.78 — «تحدي الأسبوع» weekly Vidtik challenges (migration 077_clip_challenges).
 * A challenge is a hashtag with a window: staff (admin / moderator) set a title, a #tag, a short brief and the dates.
 * A clip takes part when its caption carries that #tag and it was published inside the window — nothing to "join",
 * nothing stored per entry, so a deleted / hidden / private clip simply drops out.
 *  • GET  /api/clips/challenges                 → { current, upcoming[], past[], staff }   (signed-in)
 *  • GET  /api/clips/challenges/:id?sort=top|new&offset=&limit=
 *        → { challenge, items[], next, me }  items carry rank (top) and score; top = each creator's best clip once.
 *  • POST   /api/clips/challenges               staff: {title, tag, body, startsAt, endsAt}
 *  • PATCH  /api/clips/challenges/:id           staff: title / body always; tag / startsAt only before it starts;
 *                                               endsAt while it has not been finalised (never before now / startsAt)
 *  • POST   /api/clips/challenges/:id/cancel    staff, reversible  ·  POST /api/clips/challenges/:id/restore
 * Score (pure, unit-tested) = likes + 2·comments + 3·shares + completed watches — plain engagement, no recency decay,
 * so an early entry is not punished for being early. Ties: earlier clip first.
 * Finalising: the first read after ends_at picks the top three creators among clips anyone can see (public view),
 * stores them in winners (one guarded UPDATE, so two readers never both notify) and sends clip_challenge_win. */
const { E, str, id: mkId, normalizeTag, canonTag } = require("../lib/core");
const PAGE = 24, MAX_PAGE = 48, CANDIDATES = 400, MIN_H = 1, MAX_DAYS = 31, WINNERS = 3;
const TAG_RE = /^[\p{L}\p{N}_]{2,40}$/u;

/* ---------- pure model (unit-tested) ---------- */
const challengeScore = (st = {}) => (st.likes || 0) + (st.comments || 0) * 2 + (st.shares || 0) * 3 + (st.completed || 0);
/** clean a staff-typed hashtag the same way captions are indexed (post_hashtags), or null when it is not a valid tag */
function cleanTag(raw) {
  const t = canonTag(normalizeTag(String(raw || "").trim().replace(/^#+/, "#").replace(/\s+/g, "_")));
  return TAG_RE.test(t) ? t : null;
}
/** phase of a challenge at time `at` (ms) */
function phase(c, at = Date.now()) {
  if (c.status === "cancelled") return "cancelled";
  if (at < Date.parse(c.starts_at)) return "upcoming";
  if (at < Date.parse(c.ends_at)) return "live";
  return "ended";
}
/** rank entries: score DESC, then earlier created first, then id; `perCreator` keeps each author's best clip only */
function rank(entries, perCreator = true) {
  const sorted = entries.slice().sort((a, b) => b.score - a.score || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  if (!perCreator) return sorted;
  const seen = new Set(), out = [];
  for (const e of sorted) { if (seen.has(e.author)) continue; seen.add(e.author); out.push(e); }
  return out;
}

module.exports = (ctx) => {
  const { db } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const rd = db.read || db;
  const content = () => ctx.services.content, clips = () => ctx.services.clips;
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v || ""));
  const isStaff = (u) => !!u && ["admin", "moderator"].includes(u.role);
  const staff = (fn) => A(async (req) => { if (!isStaff(req.user)) throw E.forbid("للفريق فقط"); return fn(req); });
  const notify = async (uid, kind, o) => { try { await ctx.services.notify?.notify(uid, kind, o); } catch { /* best effort */ } };
  const parseW = (w) => { if (!w) return null; if (Array.isArray(w)) return w; try { const x = JSON.parse(w); return Array.isArray(x) ? x : null; } catch { return null; } };

  async function row(cid) {
    const c = await db.get("SELECT * FROM clip_challenges WHERE id=$1", [str(cid, 80, { required: true })]);
    if (!c) throw E.nf("التحدي غير موجود");
    return c;
  }

  /** the published clips carrying the tag inside the window, as `viewer` may see them (null = public view) */
  async function entries(c, viewer) {
    const rows = await rd.all(`SELECT p.* FROM posts p JOIN post_hashtags h ON h.post_id=p.id WHERE h.tag=$1 AND p.type='video' AND p.status='published' AND p.sponsored=0 AND p.created_at >= $2 AND p.created_at < $3 ORDER BY p.created_at DESC LIMIT ${CANDIDATES}`, [c.tag, c.starts_at, c.ends_at]);
    const isClip = require("./clips").isClip;
    const blocked = new Set(viewer?.prefs?.blocked || []);
    const vis = await content().filterVisible(rows.filter((r) => isClip(r) && !blocked.has(r.author)), viewer ? viewer.id : null);
    const st = vis.length ? await clips().stats(vis.map((r) => r.id)) : {};
    return vis.map((r) => ({ row: r, id: r.id, author: r.author, created_at: iso(r.created_at), st: st[r.id] || {}, score: challengeScore(st[r.id]) }));
  }

  async function counts(c) {
    const r = await rd.get("SELECT COUNT(*) n, COUNT(DISTINCT p.author) a FROM posts p JOIN post_hashtags h ON h.post_id=p.id WHERE h.tag=$1 AND p.type='video' AND p.status='published' AND p.sponsored=0 AND p.created_at >= $2 AND p.created_at < $3", [c.tag, c.starts_at, c.ends_at]);
    return { entries: Number(r?.n || 0), creators: Number(r?.a || 0) };
  }

  async function users(ids) {
    ids = [...new Set(ids)].filter(Boolean);
    return ids.length ? Object.fromEntries((await rd.all(`SELECT * FROM users WHERE id IN (${ph(ids)})`, ids)).map((u) => [u.id, ctx.services.users.pub(u)])) : {};
  }

  /** after the window closes: store the top three once and tell the winners */
  async function finalize(c) {
    if (c.finalized_at || phase(c) !== "ended") return c;
    const top = rank(await entries(c, null)).filter((e) => e.score > 0).slice(0, WINNERS); // a clip nobody engaged with never «wins»
    const winners = top.map((e, i) => ({ rank: i + 1, postId: e.id, userId: e.author, score: e.score }));
    const at = new Date().toISOString();
    const r = await db.run("UPDATE clip_challenges SET winners=$1, finalized_at=$2, updated_at=$2 WHERE id=$3 AND finalized_at IS NULL", [JSON.stringify(winners), at, c.id]);
    if (Number(r?.changes ?? r?.rowCount ?? 0) > 0) for (const w of winners) await notify(w.userId, "clip_challenge_win", { ref: c.id });
    return { ...c, winners: JSON.stringify(winners), finalized_at: at };
  }

  async function toClient(c, { withCounts = true, withWinners = false } = {}) {
    const out = { id: c.id, title: c.title, tag: c.tag, body: c.body || "", startsAt: iso(c.starts_at), endsAt: iso(c.ends_at), status: c.status, phase: phase(c) };
    if (withCounts) out.counts = await counts(c);
    if (withWinners) {
      const w = parseW(c.winners) || [];
      const us = await users(w.map((x) => x.userId));
      const posts = w.length ? Object.fromEntries((await rd.all(`SELECT * FROM posts WHERE id IN (${ph(w.map((x) => x.postId))})`, w.map((x) => x.postId))).map((p) => [p.id, p])) : {};
      out.winners = w.filter((x) => us[x.userId]).map((x) => { const p = posts[x.postId]; const v = (p?.data?.video) || {}; return { rank: x.rank, score: x.score, postId: x.postId, user: us[x.userId], poster: v.variants?.poster || v.poster || null, live: !!p && p.status === "published" }; });
    }
    return out;
  }

  async function list(viewer) {
    const now = new Date().toISOString();
    const live = await rd.all("SELECT * FROM clip_challenges WHERE status='active' AND starts_at <= $1 AND ends_at > $1 ORDER BY ends_at ASC LIMIT 3", [now]);
    const up = await rd.all("SELECT * FROM clip_challenges WHERE status='active' AND starts_at > $1 ORDER BY starts_at ASC LIMIT 5", [now]);
    let past = await rd.all("SELECT * FROM clip_challenges WHERE status='active' AND ends_at <= $1 ORDER BY ends_at DESC LIMIT 8", [now]);
    past = await Promise.all(past.map(finalize));
    const cancelled = isStaff(viewer) ? await rd.all("SELECT * FROM clip_challenges WHERE status='cancelled' ORDER BY updated_at DESC LIMIT 8") : [];
    return {
      current: live[0] ? await toClient(live[0]) : null,
      others: await Promise.all(live.slice(1).map((c) => toClient(c))),
      upcoming: await Promise.all(up.map((c) => toClient(c, { withCounts: false }))),
      past: await Promise.all(past.map((c) => toClient(c, { withWinners: true }))),
      cancelled: await Promise.all(cancelled.map((c) => toClient(c, { withCounts: false }))),
      staff: isStaff(viewer)
    };
  }

  async function get(viewer, cid, { sort = "top", offset, limit } = {}) {
    let c = await row(cid);
    if (c.status === "cancelled" && !isStaff(viewer)) throw E.nf("التحدي غير موجود");
    sort = sort === "new" ? "new" : "top";
    limit = Math.min(Math.max(Math.floor(+limit) || PAGE, 1), MAX_PAGE);
    offset = Math.max(0, Math.floor(+offset) || 0);
    c = await finalize(c);
    const all = phase(c) === "upcoming" ? [] : await entries(c, viewer);
    const ranked = rank(all), rankOf = new Map(ranked.map((e, i) => [e.id, i + 1]));
    const list = sort === "top" ? ranked : all.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
    const page = list.slice(offset, offset + limit);
    const us = await users(page.map((e) => e.author));
    const items = page.map((e) => ({ ...content().toClient(e.row, viewer.id), user: us[e.author] || null, rank: rankOf.get(e.id) || null, score: e.score,
      counts: { likes: e.st.likes || 0, comments: e.st.comments || 0, shares: e.st.shares || 0, watchers: e.st.watchers || 0 } }));
    const mine = all.filter((e) => e.author === viewer.id);
    const best = ranked.find((e) => e.author === viewer.id);
    return { challenge: await toClient(c, { withWinners: !!c.finalized_at }), sort, items, next: offset + limit < list.length ? String(offset + limit) : null,
      me: { entries: mine.length, rank: best ? rankOf.get(best.id) : null, score: best ? best.score : 0 }, staff: isStaff(viewer) };
  }

  function times(b, cur) {
    const s = b.startsAt !== undefined ? Date.parse(b.startsAt) : Date.parse(cur?.starts_at);
    const e = b.endsAt !== undefined ? Date.parse(b.endsAt) : Date.parse(cur?.ends_at);
    if (!Number.isFinite(s) || !Number.isFinite(e)) throw E.bad("حدّد تاريخ البداية والنهاية");
    if (e - s < MIN_H * 3600e3) throw E.bad("مدة التحدي ساعة على الأقل");
    if (e - s > MAX_DAYS * 864e5) throw E.bad("مدة التحدي 31 يوماً على الأكثر");
    return { s: new Date(s).toISOString(), e: new Date(e).toISOString() };
  }

  async function create(user, b = {}) {
    const title = str(b.title, 80, { required: true, min: 3 }), body = (str(b.body || "", 500) ?? "");
    const tag = cleanTag(b.tag); if (!tag) throw E.bad("اكتب وسماً صحيحاً من حرفين إلى 40 (حروف وأرقام و _)");
    const { s, e } = times(b);
    if (Date.parse(e) <= Date.now()) throw E.bad("موعد النهاية مضى");
    const clash = await db.get("SELECT id FROM clip_challenges WHERE status='active' AND tag=$1 AND starts_at < $2 AND ends_at > $3", [tag, e, s]);
    if (clash) throw E.bad("يوجد تحدٍّ آخر بنفس الوسم في هذه الفترة");
    const at = new Date().toISOString(), cid = mkId("chl");
    await db.run("INSERT INTO clip_challenges(id, title, tag, body, starts_at, ends_at, status, created_by, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$8)", [cid, title, tag, body, s, e, user.id, at]);
    return { challenge: await toClient(await row(cid)) };
  }

  async function update(user, cid, b = {}) {
    const c = await row(cid);
    if (c.finalized_at) throw E.bad("انتهى التحدي وأُعلنت النتائج");
    const ph0 = phase(c), set = {};
    if (b.title !== undefined) set.title = str(b.title, 80, { required: true, min: 3 });
    if (b.body !== undefined) set.body = (str(b.body || "", 500) ?? "");
    if (b.tag !== undefined && cleanTag(b.tag) !== c.tag) {
      if (ph0 !== "upcoming") throw E.bad("لا يتغيّر الوسم بعد بدء التحدي");
      set.tag = cleanTag(b.tag); if (!set.tag) throw E.bad("اكتب وسماً صحيحاً من حرفين إلى 40 (حروف وأرقام و _)");
    }
    if (b.startsAt !== undefined && Date.parse(b.startsAt) !== Date.parse(c.starts_at) && ph0 !== "upcoming") throw E.bad("لا يتغيّر موعد البداية بعد بدء التحدي");
    if (b.startsAt !== undefined || b.endsAt !== undefined) {
      const { s, e } = times(b, c);
      if (Date.parse(e) <= Date.now()) throw E.bad("موعد النهاية مضى");
      set.starts_at = s; set.ends_at = e;
    }
    const keys = Object.keys(set);
    if (!keys.length) return { challenge: await toClient(c) };
    const tag = set.tag || c.tag, s = set.starts_at || c.starts_at, e = set.ends_at || c.ends_at;
    const clash = await db.get("SELECT id FROM clip_challenges WHERE status='active' AND id<>$1 AND tag=$2 AND starts_at < $3 AND ends_at > $4", [c.id, tag, e, s]);
    if (clash) throw E.bad("يوجد تحدٍّ آخر بنفس الوسم في هذه الفترة");
    const at = new Date().toISOString();
    await db.run(`UPDATE clip_challenges SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(", ")}, updated_at=$${keys.length + 1} WHERE id=$${keys.length + 2}`, [...keys.map((k) => set[k]), at, c.id]);
    return { challenge: await toClient(await row(c.id)) };
  }

  async function setStatus(user, cid, status) {
    const c = await row(cid);
    if (c.finalized_at) throw E.bad("انتهى التحدي وأُعلنت النتائج");
    if (status === "active") {
      const clash = await db.get("SELECT id FROM clip_challenges WHERE status='active' AND id<>$1 AND tag=$2 AND starts_at < $3 AND ends_at > $4", [c.id, c.tag, c.ends_at, c.starts_at]);
      if (clash) throw E.bad("يوجد تحدٍّ آخر بنفس الوسم في هذه الفترة");
    }
    await db.run("UPDATE clip_challenges SET status=$1, updated_at=$2 WHERE id=$3", [status, new Date().toISOString(), c.id]);
    return { challenge: await toClient(await row(c.id), { withCounts: false }) };
  }

  R.get("/api/clips/challenges", A(async (req) => list(req.user)));
  R.post("/api/clips/challenges", staff(async (req) => create(req.user, req.body || {})));
  R.get("/api/clips/challenges/:id", A(async (req) => get(req.user, req.params.id, { sort: req.query.sort, offset: req.query.offset, limit: req.query.limit })));
  R.patch("/api/clips/challenges/:id", staff(async (req) => update(req.user, req.params.id, req.body || {})));
  R.post("/api/clips/challenges/:id/cancel", staff(async (req) => setStatus(req.user, req.params.id, "cancelled")));
  R.post("/api/clips/challenges/:id/restore", staff(async (req) => setStatus(req.user, req.params.id, "active")));
  return { list, get, create, update, finalize };
};
Object.assign(module.exports, { challengeScore, cleanTag, phase, rank });
