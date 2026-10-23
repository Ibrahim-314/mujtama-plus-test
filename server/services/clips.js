/* v2.70 — خلاصة اللقطات (clips feed) + watch progress.
 * • GET  /api/clips/feed?tab=foryou|following&cursor=&limit=8 — signed-in only, exactly like /api/feed (visitors 401).
 *   Eligibility = the old client filter in content-ui.js shortsView: type video, published, data.video.short or
 *   data.video.variants. Visibility/blocks/private authors/minors/paid go through the same content().filterVisible
 *   (minors + paid hooks are installed on it) plus the viewer's own block list and muted words, as ranking.js does.
 *   foryou: score = quality(completion rate, likes, comments, shares) × recency decay + boost when the author is
 *   followed; clips the viewer completed in the last RECENT_DAYS are left out. following: authors the viewer follows,
 *   newest first. Cursor = opaque base64url keyset {t: tab, at: frozen scoring time, s: score|created_at, id}; the
 *   ranked list is snapshotted per (viewer, tab, at) for SNAP_TTL, so pages never repeat or skip while the user scrolls.
 * • POST /api/clips/:id/watch {ms, durationMs, completed} — signed-in, rate-limited; upserts clip_watch (070). ms = played
 *   media time, clamped to durationMs; ms 0 never completes. Beacon route (CSRF header exempt, cookie still required).
 *   watched_ms keeps the furthest point; completed is sticky (explicit flag or ≥ COMPLETE_RATIO of the duration).
 * • Completion per post = COUNT(*)/SUM(completed) over clip_watch_post (post_id, completed) for a chunk of ids. */
const { E, str } = require("../lib/core");
const PAGE = 8, MAX_PAGE = 30, CANDIDATES = 500, WINDOW_DAYS = 60, RECENT_DAYS = 3, SNAP_TTL = 10 * 60e3;
const HALF_LIFE_H = 72, FOLLOW_BOOST = 1.5, COMPLETE_RATIO = 0.9, MAX_MS = 6 * 3600e3;
const TABS = ["foryou", "following"];
const WATCH_SRC = ["foryou", "following", "profile", "tag", "sound", "challenge", "link", "other"]; // v2.80 clip_watch.src (078)

/* ---------- pure model (unit-tested) ---------- */
/** Bayesian-smoothed completion rate: new clips start near the prior instead of 0/1 extremes */
const completionRate = (watchers = 0, completed = 0) => (completed + 1) / (watchers + 3);
/** @param {{created_at:string, author:string}} p @param {{watchers?:number,completed?:number,likes?:number,comments?:number,shares?:number}} st */
function clipScore(p, st = {}, { followed = false, at = Date.now() } = {}) {
  const q = completionRate(st.watchers, st.completed) * 4 + Math.log2(1 + (st.likes || 0)) + Math.log2(1 + (st.comments || 0)) * 1.5 + Math.log2(1 + (st.shares || 0)) * 2;
  const ageH = Math.max(0, (at - Date.parse(p.created_at)) / 3600e3);
  const s = q * Math.pow(0.5, ageH / HALF_LIFE_H) + (followed ? FOLLOW_BOOST : 0);
  return Math.round(s * 1e6) / 1e6; // fixed precision keeps keyset comparisons exact across pages
}
// v2.75 Vidtik: new videos carry data.video.source ("clips" from the Vidtik editor, "post" from the regular composer).
// Legacy videos (no source) keep the old rule so nothing already published disappears.
const isClip = (r) => {
  if (!r || r.type !== "video" || r.status !== "published") return false;
  const v = r.data?.video || {};
  if (v.source === "clips") return true;
  if (v.source === "post") return false;
  return !!(v.short || v.variants);
};
const encCursor = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function decCursor(c, tab) {
  if (!c) return null;
  try {
    const o = JSON.parse(Buffer.from(String(c), "base64url").toString("utf8"));
    if (o && o.t === tab && typeof o.id === "string" && Number.isFinite(+o.at) && (typeof o.s === "number" || typeof o.s === "string")) return o;
  } catch { /* fall through */ }
  throw E.bad("مؤشر صفحة غير صالح");
}

module.exports = (ctx) => {
  const { db, cache, rl } = ctx;
  const R = ctx.router, A = ctx.requireUser;
  const content = () => ctx.services.content;
  const rd = db.read || db;
  const ph = (a, o = 0) => a.map((_, i) => "$" + (i + 1 + o)).join(",");
  const chunks = (a, n = 400) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

  async function candidates(viewer, tab) {
    const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
    const rows = tab === "following"
      ? await rd.all(`SELECT p.* FROM posts p JOIN follows f ON f.dst=p.author AND f.src=$1 WHERE p.type='video' AND p.status='published' AND p.sponsored=0 ORDER BY p.created_at DESC LIMIT ${CANDIDATES}`, [viewer.id])
      : await rd.all(`SELECT * FROM posts WHERE type='video' AND status='published' AND sponsored=0 AND created_at > $1 ORDER BY created_at DESC LIMIT ${CANDIDATES}`, [since]);
    const pr = viewer.prefs || {}, blocked = new Set(pr.blocked || []);
    const raw = rows.filter(r => isClip(r) && !blocked.has(r.author) && (r.author === viewer.id || !ctx.policy.mutedWordHit((r.title || "") + " " + (r.text || ""), pr.mutedWords)));
    return content().filterVisible(raw, viewer.id);
  }

  /** likes/comments/shares + completion aggregate for a set of post ids (chunked, index-backed) */
  async function stats(ids) {
    const st = {};
    for (const part of chunks(ids)) {
      const q = ph(part);
      for (const r of await rd.all(`SELECT target, COUNT(*) n FROM reactions WHERE target IN (${q}) GROUP BY target`, part)) (st[r.target] ||= {}).likes = Number(r.n);
      for (const r of await rd.all(`SELECT post, COUNT(*) n FROM comments WHERE post IN (${q}) AND status='published' GROUP BY post`, part)) (st[r.post] ||= {}).comments = Number(r.n);
      for (const r of await rd.all(`SELECT post, COUNT(*) n FROM engagement_signals WHERE post IN (${q}) AND kind IN ('share','quote') GROUP BY post`, part)) (st[r.post] ||= {}).shares = Number(r.n);
      for (const r of await rd.all(`SELECT post_id, COUNT(*) n, SUM(completed) c FROM clip_watch WHERE post_id IN (${q}) GROUP BY post_id`, part)) Object.assign((st[r.post_id] ||= {}), { watchers: Number(r.n), completed: Number(r.c || 0) });
    }
    return st;
  }

  /** ranked snapshot: [{id, s}] sorted by s DESC, id DESC (s = score for foryou, created_at for following) */
  async function snapshot(viewer, tab, at) {
    return cache.wrap(`clips:${viewer.id}:${tab}:${at}`, SNAP_TTL, async () => {
      const list = await candidates(viewer, tab);
      if (tab === "following") return list.map(p => ({ id: p.id, s: new Date(p.created_at).toISOString() })).sort((a, b) => (a.s < b.s ? 1 : a.s > b.s ? -1 : a.id < b.id ? 1 : -1));
      const recent = new Date(at - RECENT_DAYS * 864e5).toISOString();
      const done = new Set((await rd.all("SELECT post_id FROM clip_watch WHERE user_id=$1 AND completed=1 AND updated_at > $2", [viewer.id, recent])).map(r => r.post_id));
      const following = new Set((await rd.all("SELECT dst FROM follows WHERE src=$1", [viewer.id])).map(r => r.dst));
      const pool = list.filter(p => !done.has(p.id)), st = await stats(pool.map(p => p.id));
      return pool.map(p => ({ id: p.id, s: clipScore(p, st[p.id], { followed: following.has(p.author), at }) })).sort((a, b) => b.s - a.s || (a.id < b.id ? 1 : -1));
    });
  }

  const after = (x, c) => (x.s < c.s || (x.s === c.s && x.id < c.id)); // strictly after the cursor in (s DESC, id DESC)

  async function feed(viewer, { tab = "foryou", cursor, limit } = {}) {
    tab = String(tab || "foryou"); if (!TABS.includes(tab)) throw E.bad("تبويب غير معروف");
    limit = Math.min(Math.max(Math.floor(+limit) || PAGE, 1), MAX_PAGE);
    const cur = decCursor(cursor, tab), at = cur ? +cur.at : Date.now();
    const snap = await snapshot(viewer, tab, at);
    const rest = cur ? snap.filter(x => after(x, cur)) : snap;
    const page = rest.slice(0, limit), ids = page.map(x => x.id);
    const rows = ids.length ? await rd.all(`SELECT * FROM posts WHERE id IN (${ph(ids)})`, ids) : [];
    const visible = await content().filterVisible(rows.filter(isClip), viewer.id); // re-check: a clip deleted/hidden since the snapshot never leaks
    const byId = Object.fromEntries(visible.map(r => [r.id, r]));
    const st = await stats(ids);
    const authorIds = [...new Set(visible.map(r => r.author))];
    const users = authorIds.length ? Object.fromEntries((await rd.all(`SELECT * FROM users WHERE id IN (${ph(authorIds)})`, authorIds)).map(u => [u.id, ctx.services.users.pub(u)])) : {};
    const links = await linksFor(page.filter(x => byId[x.id]).map(x => byId[x.id]), viewer.id);
    const items = page.filter(x => byId[x.id]).map(x => {
      const s = st[x.id] || {};
      return { ...content().toClient(byId[x.id], viewer.id), user: users[byId[x.id].author] || null, link: links[x.id] || null,
        counts: { likes: s.likes || 0, comments: s.comments || 0, shares: s.shares || 0, watchers: s.watchers || 0, completion: s.watchers ? Math.round((s.completed / s.watchers) * 100) / 100 : null } };
    });
    const last = page[page.length - 1];
    return { tab, items, next: last && rest.length > limit ? encCursor({ t: tab, at, s: last.s, id: last.id }) : null };
  }

  async function watch(user, pid, b = {}) {
    if (!rl.hit("clip_watch", user.id)) throw E.rate();
    pid = str(pid, 80, { required: true });
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!isClip(row) || (user.prefs?.blocked || []).includes(row.author) || !(await content().canSee(row, user.id))) throw E.nf(); // viewer's own blocks too, as the feed
    const dur = Math.min(MAX_MS, Math.max(0, Math.floor(+b.durationMs) || 0));
    let ms = Math.min(MAX_MS, Math.max(0, Math.floor(+b.ms) || 0)); if (dur > 0) ms = Math.min(ms, dur); // watched time never exceeds the clip
    const reached = ms > 0 && (b.completed === true || (dur > 0 && ms >= dur * COMPLETE_RATIO)); // nothing played → never completed
    const old = await db.get("SELECT watched_ms, completed FROM clip_watch WHERE user_id=$1 AND post_id=$2", [user.id, pid]);
    const wm = Math.max(ms, Number(old?.watched_ms || 0)), done = reached || Number(old?.completed) === 1 ? 1 : 0, at = new Date().toISOString();
    // v2.80: src (where the viewer met the clip) + first_at are written on the FIRST watch only; later visits keep them
    const src = WATCH_SRC.includes(b.src) ? b.src : "other";
    await db.run("INSERT INTO clip_watch(user_id, post_id, watched_ms, completed, updated_at, src, first_at) VALUES($1,$2,$3,$4,$5,$6,$5) ON CONFLICT (user_id, post_id) DO UPDATE SET watched_ms=$3, completed=$4, updated_at=$5", [user.id, pid, wm, done, at, src]);
    return { ok: true, watchedMs: wm, completed: !!done };
  }

  /* ---------- v2.75 clip ↔ product / job link · v2.76 + community / event / course, clicks, «يظهر في فيديوتك», pinned clip ----------
   * The clip's author may point it at ONE of their own live targets: an active market listing, an open job, a community they
   * run (owner / admin / moderator), an upcoming event they organise, or a published course they wrote. Resolved on read: a
   * listing that sold out, a job that closed, a past event or an unpublished course simply shows nothing (the row stays, harmless).
   * product/job rows live in clip_links (074); community/event/course in clip_links_ext (075); setting one clears the other.
   * PUT /api/clips/:id/link {kind, id} · DELETE /api/clips/:id/link · GET /api/clips/linkables (my live targets of every kind)
   * POST /api/clips/:id/link/click — one counted click per viewer per clip per day (never the author's own); the author sees
   *   link.clicks on their own clips. GET /api/clips/linked?kind=product|job&id= — the visible clips that link a listing / job.
   * PUT /api/clips/:id/pin · DELETE /api/clips/pin — the one clip a creator pins to the top of their Vidtik profile. */
  const BASE_KINDS = ["product", "job"], EXT_KINDS = ["community", "event", "course"], LINK_KINDS = [...BASE_KINDS, ...EXT_KINDS], PI_U = 1e7;
  const piTxt = (u) => (Math.round(Number(u || 0)) / PI_U).toLocaleString("en-US", { maximumFractionDigits: 7 });
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v || ""));
  const today = () => new Date().toISOString().slice(0, 10);
  async function ownedClip(user, pid) {
    pid = str(pid, 80, { required: true });
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [pid]);
    if (!row || row.type !== "video" || row.status === "removed") throw E.nf("المقطع غير موجود");
    if (row.author !== user.id) throw E.forbid("هذا المقطع ليس لك");
    return row;
  }
  async function runsCommunity(cid, uid) {
    const c = await rd.get("SELECT owner FROM communities WHERE id=$1", [cid]); if (!c) return false;
    if (c.owner === uid) return true;
    return !!(await rd.get("SELECT 1 x FROM memberships WHERE community=$1 AND user_id=$2 AND role IN ('owner','admin','moderator')", [cid, uid]));
  }
  async function linkTarget(kind, tid, ownerId) {
    if (kind === "product") {
      const l = await rd.get("SELECT id, seller_id, title, price, status FROM market_listings WHERE id=$1", [tid]);
      if (!l || l.status !== "active" || (ownerId && l.seller_id !== ownerId)) return null;
      return { kind, id: l.id, title: l.title, sub: piTxt(l.price) + " Pi", href: "#/market/item/" + encodeURIComponent(l.id) };
    }
    if (kind === "job") {
      const j = await rd.get("SELECT id, poster_id, title, kind, status FROM jobs WHERE id=$1", [tid]);
      if (!j || j.status !== "open" || (ownerId && j.poster_id !== ownerId)) return null;
      return { kind, id: j.id, title: j.title, sub: j.kind === "freelance" ? "مشروع حرّ" : "وظيفة", href: "#/job/" + encodeURIComponent(j.id) };
    }
    if (kind === "community") {
      const c = await rd.get("SELECT id, name, type FROM communities WHERE id=$1", [tid]).catch(() => null);
      if (!c || c.type === "secret" || (ownerId && !(await runsCommunity(c.id, ownerId)))) return null;
      const m = await rd.get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('banned')", [c.id]).catch(() => null);
      return { kind, id: c.id, title: c.name, sub: "مجتمع", members: Number(m?.n || 0), href: "#/c/" + encodeURIComponent(c.id) };
    }
    if (kind === "event") {
      const e = await rd.get("SELECT id, name, starts_at, organizer, status FROM events WHERE id=$1", [tid]).catch(() => null);
      if (!e || e.status !== "upcoming" || Date.parse(iso(e.starts_at)) <= Date.now() || (ownerId && e.organizer !== ownerId)) return null;
      return { kind, id: e.id, title: e.name, sub: "فعالية", at: iso(e.starts_at), href: "#/event/" + encodeURIComponent(e.id) };
    }
    if (kind === "course") {
      const c = await rd.get("SELECT id, title, author, status, access FROM courses WHERE id=$1", [tid]).catch(() => null);
      if (!c || c.status !== "published" || (ownerId && c.author !== ownerId)) return null;
      return { kind, id: c.id, title: c.title, sub: c.access === "free" ? "دورة مجانية" : "دورة", href: "#/course/" + encodeURIComponent(c.id) };
    }
    return null;
  }
  async function setLink(user, pid, b = {}) {
    const row = await ownedClip(user, pid);
    const kind = String(b.kind || ""), tid = str(b.id, 80, { required: true });
    if (!LINK_KINDS.includes(kind)) throw E.bad("نوع الربط غير صالح");
    const t = await linkTarget(kind, tid, user.id);
    if (!t) throw E.bad({ product: "اختر منتجاً نشطاً من منتجاتك", job: "اختر إعلاناً مفتوحاً من إعلاناتك", community: "اختر مجتمعاً تديره", event: "اختر فعالية قادمة تنظّمها", course: "اختر دورة منشورة من دوراتك" }[kind]);
    const at = new Date().toISOString(), base = BASE_KINDS.includes(kind);
    await db.run(`INSERT INTO ${base ? "clip_links" : "clip_links_ext"}(post_id, kind, target_id, author_id, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT (post_id) DO UPDATE SET kind=$2, target_id=$3, author_id=$4, updated_at=$5`, [row.id, kind, tid, user.id, at]);
    await db.run(`DELETE FROM ${base ? "clip_links_ext" : "clip_links"} WHERE post_id=$1`, [row.id]);
    ctx.audit?.("clip_link_set", "post", row.id, user.id);
    return { link: (await linksFor([row], user.id))[row.id] || t };
  }
  async function clearLink(user, pid) {
    const row = await ownedClip(user, pid);
    await db.run("DELETE FROM clip_links WHERE post_id=$1", [row.id]);
    await db.run("DELETE FROM clip_links_ext WHERE post_id=$1", [row.id]);
    return { link: null };
  }
  async function linkables(user) {
    const q = (sql) => rd.all(sql, [user.id]).catch(() => []);
    const sets = [
      ["product", await q("SELECT id FROM market_listings WHERE seller_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 30")],
      ["job", await q("SELECT id FROM jobs WHERE poster_id=$1 AND status='open' ORDER BY published_at DESC LIMIT 30")],
      ["community", await q("SELECT c.id FROM communities c WHERE c.owner=$1 OR EXISTS (SELECT 1 FROM memberships m WHERE m.community=c.id AND m.user_id=$1 AND m.role IN ('owner','admin','moderator')) ORDER BY c.created_at DESC LIMIT 30")],
      ["event", await q("SELECT id FROM events WHERE organizer=$1 AND status='upcoming' ORDER BY starts_at ASC LIMIT 30")],
      ["course", await q("SELECT id FROM courses WHERE author=$1 AND status='published' ORDER BY created_at DESC LIMIT 30")]
    ];
    const out = [];
    for (const [kind, rows] of sets) for (const r of rows) { const t = await linkTarget(kind, r.id, user.id); if (t) out.push(t); }
    return { items: out };
  }
  /** links for a page of clips: { postId: resolved link } (only live targets still owned by the clip's author).
   *  With viewerId: the clip's author also gets link.clicks; an event link carries reminded (the viewer asked for a reminder). */
  async function linksFor(posts, viewerId) {
    const ids = posts.map((p) => p.id); if (!ids.length) return {};
    const rows = [...await rd.all(`SELECT * FROM clip_links WHERE post_id IN (${ph(ids)})`, ids).catch(() => []), ...await rd.all(`SELECT * FROM clip_links_ext WHERE post_id IN (${ph(ids)})`, ids).catch(() => [])];
    const by = Object.fromEntries(posts.map((p) => [p.id, p.author])), out = {};
    for (const r of rows) {
      if (out[r.post_id]) continue;
      const t = await linkTarget(r.kind, r.target_id, by[r.post_id]); if (!t) continue;
      if (viewerId && by[r.post_id] === viewerId) { const c = await rd.get("SELECT COUNT(*) n FROM clip_link_clicks WHERE post_id=$1", [r.post_id]).catch(() => null); t.clicks = Number(c?.n || 0); }
      if (viewerId && t.kind === "event") t.reminded = !!(await rd.get("SELECT 1 x FROM event_rsvps WHERE event_id=$1 AND user_id=$2 AND kind='reminder'", [t.id, viewerId]).catch(() => null));
      out[r.post_id] = t;
    }
    return out;
  }
  async function visibleClip(user, pid) {
    const row = await db.get("SELECT * FROM posts WHERE id=$1", [str(pid, 80, { required: true })]);
    if (!row || row.status !== "published" || (user.prefs?.blocked || []).includes(row.author) || !(await content().canSee(row, user.id))) throw E.nf();
    return row;
  }
  async function linkClick(user, pid) {
    const row = await visibleClip(user, pid);
    const link = (await linksFor([row]))[row.id];
    if (!link) return { ok: true, counted: false };
    if (row.author === user.id) return { ok: true, counted: false }; // the author's own taps never count
    const r = await db.run("INSERT INTO clip_link_clicks(post_id, user_id, day, at) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [row.id, user.id, today(), new Date().toISOString()]);
    return { ok: true, counted: Number(r?.changes ?? r?.rowCount ?? 0) > 0 };
  }
  /** the visible published clips linking a listing / job (newest first) — the «يظهر في فيديوتك» strip on its page */
  async function linked(user, kind, tid) {
    kind = String(kind || ""); tid = str(tid, 80, { required: true });
    if (!BASE_KINDS.includes(kind)) throw E.bad("نوع غير صالح");
    if (!(await linkTarget(kind, tid, null))) return { items: [] };
    const lr = await rd.all("SELECT post_id, author_id FROM clip_links WHERE kind=$1 AND target_id=$2 ORDER BY updated_at DESC LIMIT 60", [kind, tid]).catch(() => []);
    if (!lr.length) return { items: [] };
    const pids = lr.map((x) => x.post_id);
    const rows = (await rd.all(`SELECT * FROM posts WHERE id IN (${ph(pids)}) AND type='video' AND status='published' AND sponsored=0`, pids)).filter(isClip);
    const owner = Object.fromEntries(lr.map((x) => [x.post_id, x.author_id]));
    const vis = (await content().filterVisible(rows.filter((r) => r.author === owner[r.id]), user.id)).filter((r) => !(user.prefs?.blocked || []).includes(r.author));
    vis.sort((x, y) => (iso(y.created_at) > iso(x.created_at) ? 1 : -1));
    const page = vis.slice(0, 12), st = await stats(page.map((r) => r.id));
    const authorIds = [...new Set(page.map((r) => r.author))];
    const users = authorIds.length ? Object.fromEntries((await rd.all(`SELECT * FROM users WHERE id IN (${ph(authorIds)})`, authorIds)).map((u) => [u.id, ctx.services.users.pub(u)])) : {};
    return { items: page.map((r) => { const x = st[r.id] || {}; return { ...content().toClient(r, user.id), user: users[r.author] || null, counts: { likes: x.likes || 0, comments: x.comments || 0, shares: x.shares || 0, watchers: x.watchers || 0 } }; }) };
  }
  async function pin(user, pid) {
    const row = await ownedClip(user, pid);
    if (row.status !== "published" || !isClip(row)) throw E.bad("ثبّت فيديو منشوراً في فيديوتك");
    await db.run("INSERT INTO clip_pins(user_id, post_id, at) VALUES($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET post_id=$2, at=$3", [user.id, row.id, new Date().toISOString()]);
    return { pinned: row.id };
  }
  async function unpin(user) { await db.run("DELETE FROM clip_pins WHERE user_id=$1", [user.id]); return { pinned: null }; }
  R.put("/api/clips/:id/link", A(async (req) => setLink(req.user, req.params.id, req.body || {})));
  R.del("/api/clips/:id/link", A(async (req) => clearLink(req.user, req.params.id)));
  R.get("/api/clips/linkables", A(async (req) => linkables(req.user)));
  R.get("/api/clips/linked", A(async (req) => linked(req.user, req.query.kind, req.query.id)));
  R.del("/api/clips/pin", A(async (req) => unpin(req.user)));
  R.put("/api/clips/:id/pin", A(async (req) => pin(req.user, req.params.id)));
  R.post("/api/clips/:id/link/click", A(async (req) => linkClick(req.user, req.params.id)));
  R.get("/api/clips/:id/link", A(async (req) => {
    const row = await visibleClip(req.user, req.params.id);
    return { link: (await linksFor([row], req.user.id))[row.id] || null };
  }));
  /* ---------- v2.75 Vidtik creator profile ----------
   * GET /api/clips/creator/:handle?cursor=&limit= → { user, counts:{clips, likes, followers, following}, following, items, next }.
   * Newest first, same visibility checks as the feed (blocks, private authors, minors) via content().filterVisible. */
  async function creator(viewer, handle, { cursor, limit } = {}) {
    handle = str(String(handle || "").replace(/^@/, ""), 40, { required: true });
    const u = await rd.get("SELECT * FROM users WHERE LOWER(handle)=LOWER($1)", [handle]);
    if (!u || (viewer.prefs?.blocked || []).includes(u.id) || (u.prefs?.blocked || []).includes(viewer.id)) throw E.nf("المستخدم غير موجود");
    limit = Math.min(Math.max(Math.floor(+limit) || 24, 1), 48);
    let before = null;
    if (cursor) { try { const o = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8")); if (o && typeof o.c === "string" && typeof o.id === "string") before = o; } catch { /* bad cursor */ } if (!before) throw E.bad("مؤشر صفحة غير صالح"); }
    const rows = await rd.all(`SELECT * FROM posts WHERE author=$1 AND type='video' AND status='published' AND sponsored=0 ${before ? "AND (created_at < $2 OR (created_at = $2 AND id < $3))" : ""} ORDER BY created_at DESC, id DESC LIMIT ${limit * 3}`, before ? [u.id, before.c, before.id] : [u.id]);
    const clipsAll = rows.filter(isClip), visible = await content().filterVisible(clipsAll, viewer.id);
    // v2.76 pinned clip: first on page one, never repeated further down
    const pinRow = await rd.get("SELECT post_id FROM clip_pins WHERE user_id=$1", [u.id]).catch(() => null);
    let pinned = null;
    if (pinRow && !before) {
      const pr = await rd.get("SELECT * FROM posts WHERE id=$1 AND author=$2 AND type='video' AND status='published' AND sponsored=0", [pinRow.post_id, u.id]);
      if (pr && isClip(pr) && (await content().filterVisible([pr], viewer.id)).length) pinned = pr;
    }
    const rest = pinRow ? visible.filter((r) => r.id !== pinRow.post_id) : visible;
    const page = [...(pinned ? [pinned] : []), ...rest.slice(0, limit)], ids = page.map((r) => r.id), st = await stats(ids), links = await linksFor(page, viewer.id);
    const pub = ctx.services.users.pub(u);
    const items = page.map((r) => { const x = st[r.id] || {}; return { ...content().toClient(r, viewer.id), user: pub, link: links[r.id] || null, pinned: !!pinned && r.id === pinned.id, counts: { likes: x.likes || 0, comments: x.comments || 0, shares: x.shares || 0, watchers: x.watchers || 0 } }; });
    const lastRow = page.filter((r) => !pinned || r.id !== pinned.id).pop();
    const more = !!lastRow && (rest.length > limit || rows.length === limit * 3);
    let counts = { clips: 0, likes: 0, followers: 0, following: 0 }, follows = false;
    if (!before) {
      const all = (await rd.all("SELECT * FROM posts WHERE author=$1 AND type='video' AND status='published' AND sponsored=0 ORDER BY created_at DESC LIMIT 500", [u.id])).filter(isClip);
      const allIds = all.map((r) => r.id); let likes = 0;
      for (const part of chunks(allIds)) { const r = await rd.get(`SELECT COUNT(*) n FROM reactions WHERE target IN (${ph(part)})`, part); likes += Number(r?.n || 0); }
      const fr = await rd.get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [u.id]), fg = await rd.get("SELECT COUNT(*) n FROM follows WHERE src=$1", [u.id]);
      follows = !!(await rd.get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [viewer.id, u.id]));
      counts = { clips: all.length, likes, followers: Number(fr?.n || 0), following: Number(fg?.n || 0) };
    }
    let processing = [];
    if (!before && viewer.id === u.id) processing = (await rd.all("SELECT id, text, data, created_at FROM posts WHERE author=$1 AND type='video' AND status='processing' ORDER BY created_at DESC LIMIT 12", [u.id]))
      .filter((r) => { const d = typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {}); return d.video?.source === "clips"; })
      .map((r) => { const d = typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {}); return { id: r.id, text: String(r.text || "").slice(0, 80), cover: d.cover || null }; });
    let scheduled = []; // v2.80: my scheduled Vidtik clips (edit / cancel from #/scheduled)
    if (!before && viewer.id === u.id) scheduled = (await rd.all("SELECT id, text, data, publish_at FROM posts WHERE author=$1 AND type='video' AND status='scheduled' ORDER BY publish_at ASC LIMIT 12", [u.id]))
      .map((r) => ({ r, d: typeof r.data === "string" ? JSON.parse(r.data || "{}") : (r.data || {}) })).filter(({ d }) => d.video?.source === "clips")
      .map(({ r, d }) => ({ id: r.id, text: String(r.text || "").slice(0, 80), cover: d.cover || null, publishAt: r.publish_at instanceof Date ? r.publish_at.toISOString() : String(r.publish_at || "") }));
    return { user: pub, counts, following: follows, self: viewer.id === u.id, processing, scheduled, items, next: more ? Buffer.from(JSON.stringify({ c: lastRow.created_at instanceof Date ? lastRow.created_at.toISOString() : String(lastRow.created_at), id: lastRow.id })).toString("base64url") : null };
  }
  R.get("/api/clips/creator/:handle", A(async (req) => creator(req.user, req.params.handle, { cursor: req.query.cursor, limit: req.query.limit })));
  R.get("/api/clips/feed", A(async (req) => feed(req.user, { tab: req.query.tab, cursor: req.query.cursor, limit: req.query.limit })));
  R.post("/api/clips/:id/watch", A(async (req) => watch(req.user, req.params.id, req.body || {})), { beacon: true }); // sendBeacon on pagehide (no custom header); session cookie still required
  return { feed, watch, stats, setLink, clearLink, linkables, linksFor, linked, linkClick, pin, unpin, creator, linkTarget, isClip };
};
Object.assign(module.exports, { clipScore, completionRate, isClip, TABS, PAGE, WATCH_SRC });
