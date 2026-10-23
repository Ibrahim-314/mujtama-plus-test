/* =====================================================================
 * مجتمع بلس — v2.0.0 Remote mode (client ⇄ server)
 * When the app is served by the مجتمع بلس server, this layer:
 *  • authenticates (handle/password, or Pi when enabled server-side)
 *  • hydrates the store from /api/bootstrap (viewer-scoped snapshot)
 *  • turns every local state change into API calls (diff on save → ordered ops)
 *  • listens to realtime events (SSE) and reconciles
 *  • uploads real images/videos to the Media Engine
 * Opened as a plain file (or without the server) the app stays in offline demo mode.
 * ===================================================================== */
const APP_VERSION = "__APP_VERSION__";
/* v2.68: version shown as a number in the reader's script (Arabic-Indic digits in Arabic) */
const verLabel = (v) => { v = String(v || "").replace(/^mp-/, "").replace(/^v/i, ""); const en = (document.documentElement.lang || "ar").startsWith("en"); return en ? v : v.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]).replace(/\./g, "٫"); };
/* v2.51: one API client with a middleware list instead of modules re-assigning Remote.api.
 * Remote.use(fn) — fn(req, next) where req = { method, path, body, raw, headers }; call next(req) (or next(changedReq)) to
 * continue. The middleware registered last runs first (the same order the old wrappers ran in). Per-request headers (e.g.
 * X-Act-As for "post as organisation") go in req.headers and touch only that request — window.fetch is never patched.
 * Remote.api(method, path, body, raw) keeps its signature and works unbound. */
const Remote = {
  on: false, health: null, me: null, queue: Promise.resolve(), snap: null, es: null, uploads: { images: [], video: null }, mw: [],
  use(fn) { if (typeof fn === "function" && !Remote.mw.includes(fn)) Remote.mw.push(fn); return fn; },
  async base(req) {
    const { method, path, body, raw } = req;
    const r = await fetch(path, { method, credentials: "same-origin", headers: { "X-Requested-With": "mujtama", ...(raw ? { "Content-Type": raw.type || "application/octet-stream" } : body ? { "Content-Type": "application/json" } : {}), ...(req.headers || {}) }, body: raw || (body ? JSON.stringify(body) : undefined) }).catch((err) => { if (err?.name === "AbortError") throw err; /* v2.55: a network failure reads as Arabic, not «Failed to fetch» */ const e = new Error("لا يوجد اتصال بالإنترنت — تحقق من الشبكة ثم أعد المحاولة"); e.status = 0; e.code = "offline"; e.cause = err; throw e; });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "تعذر الاتصال بالخادم"); e.status = r.status; e.code = j.code; throw e; }
    return j;
  },
  run(req, i) { if (i < 0) return Remote.base(req); const fn = Remote.mw[i]; return Promise.resolve().then(() => fn(req, (r) => Remote.run(r || req, i - 1))); },
  /** the chain below one middleware (what that middleware's next() would call) */
  below(fn, method, path, body, raw) { const i = Remote.mw.indexOf(fn); return Remote.run({ method, path, body, raw, headers: {} }, (i < 0 ? Remote.mw.length : i) - 1); },
  api(method, path, body, raw) { return Remote.run({ method, path, body, raw, headers: {} }, Remote.mw.length - 1); }
};
const cssMedia = (u) => `url('${u}') center/cover no-repeat`;
const rawMedia = (m) => { const x = /^url\('(\/media\/[^']+)'\)/.exec(m || ""); return x ? x[1] : m; };

/* ---------- Hydration ---------- */
function hydrate(b) {
  const p = b.prefs || {};
  DB.me = b.me; DB.isAdmin = b.isAdmin; DB.serverVersion = b.version;
  DB.users = b.users;
  DB.posts = b.posts.map(x => { const y = { ...x }; if (y.media && y.media.startsWith("/media/")) y.media = cssMedia(y.media); if (y.images) y.images = y.images.map(i => i.startsWith("/media/") ? cssMedia(i) : i); return y; });
  Object.assign(DB, { comments: b.comments, reactions: b.reactions, follows: b.follows, communities: b.communities, memberships: b.memberships, events: b.events, conversations: b.conversations, messages: b.messages, notifications: b.notifications, reports: b.reports, decisions: b.decisions, appeals: b.appeals, audit: b.audit });
  DB.onboarded = !!p.onboarded; DB.interests = p.interests || []; DB.interestWeights = p.interestWeights || {};
  DB.muted = { users: [], topics: [], posts: [], hashtags: [], communities: [], ...(p.muted || {}) }; DB.blocked = p.blocked || [];
  DB.lists = p.lists || []; DB.collections = p.collections || [{ id: "col1", name: "لاحقاً", items: [] }, { id: "col2", name: "تعلم", items: [] }, { id: "col3", name: "أفكار", items: [] }];
  DB.drafts = p.drafts || []; DB.history = p.history || [];
  DB.settings = { lang: "ar", theme: "system", sensitive: "warn", contentTypes: { video: true, article: true, poll: true }, languages: ["ar", "en"], ...(p.settings || {}) };
  if (DB.settings.lang === "fr" || DB.settings.lang === "ur") DB.settings.lang = "en"; // v2.67: ar + en only
  DB.impressions ||= {}; DB.interactions ||= []; DB.v12 = true;
  Remote.snap = snapshot();
}
const PREF_FIELDS = ["onboarded", "interests", "interestWeights", "muted", "blocked", "lists", "collections", "drafts", "history", "settings"];
function snapshot() {
  const me = DB.me, m = {};
  m.posts = new Map(DB.posts.map(p => [p.id, JSON.stringify(p)]));
  m.comments = new Set(DB.comments.map(c => c.id));
  m.reactions = new Map(DB.reactions.filter(r => r.user === me).map(r => [r.target, r.type]));
  m.follows = new Set(DB.follows.filter(f => f.from === me).map(f => f.to));
  m.memberships = new Map(DB.memberships.map(x => [x.community + "|" + x.user, x.role]));
  m.communities = new Map(DB.communities.map(c => [c.id, JSON.stringify(c)]));
  m.events = new Map(DB.events.map(e => [e.id, JSON.stringify({ going: e.going.includes(me), interested: e.interested.includes(me), reminder: (e.reminders || []).includes(me) })]));
  m.reports = new Map(DB.reports.map(r => [r.id, r.status]));
  m.appeals = new Map(DB.appeals.map(a => [a.id, a.status]));
  m.conversations = new Set(DB.conversations.map(c => c.id));
  m.messages = new Set(DB.messages.map(x => x.id));
  m.unread = DB.notifications.filter(n => !n.read).length;
  const u = DB.users.find(x => x.id === me) || {}; m.me = JSON.stringify({ name: u.name, bio: u.bio, pinned: u.pinned || null });
  m.prefs = JSON.stringify(Object.fromEntries(PREF_FIELDS.map(k => [k, DB[k]])));
  return m;
}

/* ---------- Diff → ordered API operations ---------- */
function toServerPost(p) {
  const o = { id: p.id, type: p.type, text: p.text, title: p.title, topic: p.topic, visibility: p.visibility, list: p.list, community: p.community, quoteOf: p.quoteOf, repostOf: p.repostOf,
    location: p.location, publishAt: p.publishAt, sensitive: p.sensitive, worlds: p.worlds, media: rawMedia(p.media), images: p.images && p.images.map(rawMedia), series: p.series, part: p.part, parts: p.parts, event: p.event };
  if (p.poll) o.poll = { options: p.poll.options.map(x => x.t), multi: p.poll.multi, hideResults: p.poll.hideResults, endsAt: p.poll.endsAt };
  if (p.stances) o.stances = p.stances.map(s => s.t);
  if (p.type === "video") o.video = { short: p.video?.short, mediaId: p.video?.mediaId || null, duration: p.video?.duration, source: p.video?.source };
  return o;
}
function diffOps() {
  const s = Remote.snap, me = DB.me, ops = []; if (!s) return ops;
  const add = (order, fn) => ops.push({ order, fn });
  const enc = encodeURIComponent;
  DB.communities.forEach(c => { const old = s.communities.get(c.id);
    if (!old && c.owner === me) add(1, () => Remote.api("POST", "/api/communities", { id: c.id, name: c.name, desc: c.desc, topic: c.topic, type: c.type, color: c.color, rules: c.rules, requireApproval: c.requireApproval, location: c.location }));
    else if (old && old !== JSON.stringify(c)) add(5, () => Remote.api("PATCH", "/api/communities/" + c.id, { name: c.name, desc: c.desc, type: c.type, rules: c.rules, location: c.location, whoCanPost: c.whoCanPost, requireApproval: c.requireApproval, allowLinks: c.allowLinks, allowMedia: c.allowMedia, allowCommercial: c.allowCommercial, aiModeration: c.aiModeration }));
  });
  DB.events.forEach(e => { const old = s.events.get(e.id);
    if (!old) { if (e.organizer === me) add(2, () => Remote.api("POST", "/api/events", { id: e.id, name: e.name, desc: e.desc, startsAt: e.startsAt, place: e.place, community: e.community, color: e.color })); return; }
    const o = JSON.parse(old), n = { going: e.going.includes(me), interested: e.interested.includes(me), reminder: (e.reminders || []).includes(me) };
    for (const k of ["going", "interested", "reminder"]) if (o[k] !== n[k]) add(5, () => Remote.api(n[k] ? "PUT" : "DELETE", `/api/events/${e.id}/rsvp/${k}`));
  });
  DB.posts.forEach(p => { const oldS = s.posts.get(p.id);
    if (!oldS) { if (p.author === me && p.status !== "deleted") add(3, async () => { try { await Remote.api("POST", "/api/posts", toServerPost(p)); } catch (e) { DB.posts = DB.posts.filter(x => x.id !== p.id); throw e; } }); return; }
    if (oldS === JSON.stringify(p)) return;
    const o = JSON.parse(oldS);
    if (p.author === me && o.text !== p.text && p.status !== "deleted") add(5, () => Remote.api("PATCH", "/api/posts/" + p.id, { text: p.text }));
    if (o.status !== p.status) {
      if (p.status === "deleted") add(5, () => Remote.api("DELETE", "/api/posts/" + p.id));
      else if (p.author === me && ["published", "archived"].includes(o.status) && ["published", "archived"].includes(p.status)) add(5, () => Remote.api("PATCH", "/api/posts/" + p.id, { status: p.status }));
      else if (o.status === "pending" && p.community) add(5, () => Remote.api("POST", `/api/communities/${p.community}/queue/${p.id}`, { action: { published: "approve", rejected: "reject", draft: "edit" }[p.status] || "reject" }));
    }
    if (p.poll && JSON.stringify(o.poll?.voters?.[me]) !== JSON.stringify(p.poll.voters?.[me]) && p.poll.voters?.[me] !== undefined) { const v = p.poll.voters[me], prev = [].concat(o.poll?.voters?.[me] ?? []); add(5, () => Remote.api("POST", `/api/posts/${p.id}/vote`, { option: Array.isArray(v) ? v.filter(i => !prev.includes(i)) : v })); }
    if (p.stanceVoters && o.stanceVoters?.[me] === undefined && p.stanceVoters[me] !== undefined) add(5, () => Remote.api("POST", `/api/posts/${p.id}/stance`, { index: p.stanceVoters[me] }));
    if (p.author === me && p.type === "question" && o.acceptedAnswer !== p.acceptedAnswer) add(5, () => Remote.api("POST", `/api/posts/${p.id}/accept`, { comment: p.acceptedAnswer }));
    if (p.views > o.views) add(9, () => Remote.api("POST", `/api/posts/${p.id}/view`));
    if (p.video && o.video) { const ev = []; if (p.video.starts > o.video.starts) ev.push({ name: "video_start", props: { post: p.id } }); if (p.video.completions > o.video.completions) ev.push({ name: "video_complete", props: { post: p.id } }); if (ev.length) add(9, () => Remote.api("POST", "/api/analytics", { events: ev })); }
  });
  DB.comments.forEach(c => { if (!s.comments.has(c.id) && c.author === me) add(4, () => Remote.api("POST", "/api/comments", { id: c.id, post: c.post, text: c.text, parent: c.parent })); });
  const myR = new Map(DB.reactions.filter(r => r.user === me).map(r => [r.target, r.type]));
  myR.forEach((t, target) => { if (s.reactions.get(target) !== t) add(5, () => Remote.api("PUT", "/api/reactions/" + enc(target), { type: t })); });
  s.reactions.forEach((t, target) => { if (!myR.has(target)) add(5, () => Remote.api("DELETE", "/api/reactions/" + enc(target))); });
  const myF = new Set(DB.follows.filter(f => f.from === me).map(f => f.to));
  myF.forEach(u => { if (!s.follows.has(u)) add(5, () => Remote.api("PUT", "/api/follows/" + u)); });
  s.follows.forEach(u => { if (!myF.has(u)) add(5, () => Remote.api("DELETE", "/api/follows/" + u)); });
  const mem = new Map(DB.memberships.map(x => [x.community + "|" + x.user, x.role]));
  mem.forEach((role, k) => { const [c, u] = k.split("|"), old = s.memberships.get(k);
    if (u === me && !old && role !== "owner") add(4, () => Remote.api("PUT", `/api/communities/${c}/membership`));
    else if (u !== me && old && old !== role) add(5, () => Remote.api("PATCH", `/api/communities/${c}/members/${u}`, { role }));
  });
  s.memberships.forEach((role, k) => { if (mem.has(k)) return; const [c, u] = k.split("|");
    if (u === me) add(5, () => Remote.api("DELETE", `/api/communities/${c}/membership`)); else add(5, () => Remote.api("PATCH", `/api/communities/${c}/members/${u}`, { role: "remove" }));
  });
  DB.reports.forEach(r => { const old = s.reports.get(r.id);
    if (!old && r.by === me) add(6, () => Remote.api("POST", "/api/reports", { id: r.id, target: r.target, kind: r.kind, reason: r.reason }));
    else if (old === "open" && r.status !== "open") add(6, () => Remote.api("POST", "/api/admin/reports/" + r.id, { action: r.status === "actioned" ? "remove" : "keep" }));
  });
  DB.appeals.forEach(a => { const old = s.appeals.get(a.id);
    if (!old && a.by === me) add(6, () => Remote.api("POST", "/api/appeals", { id: a.id, decision: a.decisionId, text: a.text }));
    else if (old === "open" && a.status !== "open") add(6, () => Remote.api("POST", "/api/admin/appeals/" + a.id, { action: a.status === "accepted" ? "accept" : "reject" }));
  });
  DB.conversations.forEach(c => { if (!s.conversations.has(c.id)) add(2, () => Remote.api("POST", "/api/conversations", { id: c.id, user: c.members.find(x => x !== me) })); });
  DB.messages.forEach(x => { if (!s.messages.has(x.id) && x.from === me) add(7, () => Remote.api("POST", "/api/messages", { id: x.id, conv: x.conv, text: x.text })); });
  if (DB.notifications.filter(n => !n.read).length < s.unread) add(8, () => Remote.api("POST", "/api/notifications/read"));
  const u = DB.users.find(x => x.id === me) || {}, meNow = JSON.stringify({ name: u.name, bio: u.bio, pinned: u.pinned || null });
  if (meNow !== s.me) add(5, () => Remote.api("PATCH", "/api/me", JSON.parse(meNow)));
  const prefs = JSON.stringify(Object.fromEntries(PREF_FIELDS.map(k => [k, DB[k]])));
  if (prefs !== s.prefs) add(8, () => Remote.api("PUT", "/api/me/prefs", JSON.parse(prefs)));
  return ops.sort((a, b) => a.order - b.order);
}
let flushTimer = null;
function scheduleFlush() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 60); }
function flush() {
  flushTimer = null;
  const ops = diffOps(); Remote.snap = snapshot(); if (!ops.length) return;
  Remote.queue = Remote.queue.then(async () => {
    let failed = false;
    for (const op of ops) { try { await op.fn(); } catch (e) { failed = true; toast(e.message); if (e.status === 401) return showAuth(); } }
    refreshSoon(failed ? 50 : 1200);
  });
}

/* ---------- Refresh / realtime ---------- */
/* what the screens draw from (view counters left out: they tick constantly and are not worth a re-render) */
function viewSig() {
  const posts = DB.posts.map(p => { const { views: _views, ...rest } = p; return rest; });
  return JSON.stringify([DB.me, posts, DB.comments.map(c => [c.id, c.status, c.text, c.parent]), DB.reactions.map(r => r.target + "|" + r.user + "|" + r.type).sort(), DB.follows.map(f => f.from + ">" + f.to).sort(),
    DB.memberships.map(m => m.community + "|" + m.user + "|" + m.role).sort(), DB.communities, DB.events.map(e => [e.id, e.going, e.interested, e.status]), DB.users.map(u => [u.id, u.name, u.handle, u.avatar, u.badge, u.color, u.verified]),
    DB.conversations.map(c => c.id), DB.messages.map(x => x.id + (x.read ? 1 : 0)), DB.notifications.map(n => n.id + (n.read ? 1 : 0)), DB.collections, DB.muted, DB.blocked]);
}
/* v2.52: the screen holds something the member typed or picked (a wizard, a form) — a background re-render would wipe it */
function formDirty(root = typeof view !== "undefined" ? view : document) {
  const ae = document.activeElement; if (ae && ["TEXTAREA", "INPUT", "SELECT"].includes(ae.tagName) && root.contains(ae)) return true;
  return [...root.querySelectorAll("input:not([type=hidden]):not([type=search]),textarea,select")].some((c) => c.closest("form,[role=dialog],.sheet") && (c.type === "checkbox" || c.type === "radio" ? c.checked !== c.defaultChecked : c.tagName === "SELECT" ? [...c.options].some((o) => o.selected !== o.defaultSelected) : c.value !== c.defaultValue));
}
window.formDirty = formDirty;
let refreshTimer = null;
/* v2.54: the user just opened a disclosure (focus still on its <summary>, e.g. «واجب جديد») — a background re-render would snap it
 * shut before they reach the first field; hold the render like we do while typing (it runs on the next refresh) */
const openedDisclosure = () => { const a = document.activeElement; return !!(a && a.tagName === "SUMMARY" && a.parentElement?.open && view.contains(a)); };
function refreshSoon(ms = 800) { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, ms); }
async function refresh() {
  await Remote.queue; const q0 = Remote.queue;
  try {
    const b = await Remote.api("GET", "/api/bootstrap");
    // v2.52: a local change made while this request was in flight has not been diffed yet (flush is ~60 ms behind save());
    // hydrating now would overwrite it with the older server copy and reset the snapshot, losing the change (e.g. an edit).
    // Push it first — flush() schedules its own refresh once the server has it.
    if (flushTimer || Remote.queue !== q0) { if (flushTimer) { clearTimeout(flushTimer); flush(); } refreshSoon(300); return; }
    const before = viewSig(); hydrate(b);
    App.refreshBadges && App.refreshBadges();
    if (viewSig() === before && !Remote.pendingRender) return; // v2.29: nothing on screen changed (e.g. the server just confirmed our own like) → no re-render, no flicker
    const busy = !DB.onboarded || document.body.classList.contains("ob") || !$("#sheet").classList.contains("hidden") || (document.activeElement && ["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement.tagName)) || formDirty() || openedDisclosure();
    if (!busy) rerender(); else Remote.pendingRender = true;
  } catch (e) { if (e.status === 401) showAuth(); }
}
function connectStream() {
  if (!window.EventSource) return setInterval(refresh, 30e3);
  Remote.es?.close(); const es = new EventSource("/api/stream"); Remote.es = es;
  es.addEventListener("notification", () => refreshSoon(300));
  es.addEventListener("message", () => refreshSoon(200));
  es.addEventListener("changed", () => refreshSoon(2500));
}

const _closeSheet = closeSheet;
closeSheet = function () { _closeSheet(); if (Remote.pendingRender && DB.onboarded) { Remote.pendingRender = false; setTimeout(rerender, 0); } };

/* ---------- Auth screen ---------- */
function showAuth(mode = "login") {
  window.MPSession?.set("out"); // v2.51: guests never start the protected modules (see chunks.js / MPSession)
  document.body.classList.add("ob"); $(".bottomnav").style.display = "none"; $("#fab").style.display = "none";
  const piBtn = Remote.health?.pi && PiAdapter.available() ? `<button class="u-mt10 btn ghost block" id="pi-login">الدخول بحساب Pi</button>` : "";
  view.innerHTML = `<div class="wrap" style="max-width:420px;margin:auto;padding-top:40px">
    <div class="u-tc"><div class="logo" style="font-size:44px">✦</div><h1 class="u-my8">مجتمع بلس</h1><p class="muted">نظام اجتماعي يجمع الناس حول ما يهمهم</p></div>
    <div class="u-my18 seg"><button data-m="login" class="${mode === "login" ? "on" : ""}">تسجيل الدخول</button><button data-m="register" class="${mode === "register" ? "on" : ""}">حساب جديد</button></div>
    <div class="card">
      ${mode === "register" ? `<label class="muted">الاسم</label><input id="a-name" autocomplete="name" placeholder="اسمك كما يظهر للناس">` : ""}
      <label class="u-db u-mt8 muted">اسم المستخدم</label><input id="a-handle" dir="ltr" autocomplete="username" placeholder="username">
      <label class="u-db u-mt8 muted">كلمة المرور</label><input id="a-pass" type="password" dir="ltr" autocomplete="${mode === "register" ? "new-password" : "current-password"}" placeholder="8 أحرف على الأقل">
      <button class="u-mt14 btn block" id="a-go">${mode === "register" ? "إنشاء الحساب" : "دخول"}</button>${piBtn}
      ${Remote.health?.demo ? `<button class="u-mt10 btn ghost block" id="demo-login">دخول تجريبي</button><p class="muted u-tc" style="font-size:12px;margin:6px 0 0">حساب وهمي لنسخة التجربة فقط، وبياناته مؤقتة وقد تُمسح.</p>` : ""}
      <p class="u-c-dg u-mh1e muted" id="a-err"></p></div>
    <p class="u-tc muted">الإصدار <bdi>${verLabel(Remote.health?.version || APP_VERSION)}</bdi></p></div>`;
  view.querySelectorAll("[data-m]").forEach(b => b.onclick = () => showAuth(b.dataset.m));
  $("#a-go").onclick = async () => {
    const body = { handle: $("#a-handle").value.trim(), password: $("#a-pass").value, name: $("#a-name")?.value.trim() };
    try { await Remote.api("POST", mode === "register" ? "/api/auth/register" : "/api/auth/login", body); await start(); }
    catch (e) { $("#a-err").textContent = e.message; }
  };
  if ($("#demo-login")) $("#demo-login").onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    try { await Remote.api("POST", "/api/auth/demo", {}); await start(); }
    catch (e) { $("#a-err").textContent = e.message; ev.currentTarget.disabled = false; }
  };
  if ($("#pi-login")) $("#pi-login").onclick = async () => {
    try { const auth = await PiAdapter.authenticate(); if (!auth) throw new Error("تعذر الدخول بـ Pi"); await Remote.api("POST", "/api/auth/pi", { accessToken: auth.accessToken }); await start(); }
    catch (e) { $("#a-err").textContent = e.message; }
  };
}
async function start() {
  const b = await Remote.api("GET", "/api/bootstrap");
  document.body.classList.remove("ob"); $(".bottomnav").style.display = ""; $("#fab").style.display = "";
  hydrate(b); window.MPSession?.set("in"); connectStream(); applyShell(); App.refreshBadges && App.refreshBadges();
  if (!location.hash || location.hash === "#/") location.hash = "#/home";
  route();
}

/* ---------- Media uploads (real files) ---------- */
document.addEventListener("change", async (e) => {
  if (!Remote.on || !["imf", "vf"].includes(e.target.id)) return;
  const files = [...e.target.files]; if (!files.length) return;
  toast("جاري رفع الملفات…");
  try {
    if (e.target.id === "imf") { Remote.uploads.images = []; for (const f of files.slice(0, 6)) Remote.uploads.images.push((await Remote.api("POST", "/api/media", null, f)).media); }
    else Remote.uploads.video = (await Remote.api("POST", "/api/media", null, files[0])).media;
    toast("✓ تم الرفع");
  } catch (err) { toast(err.message); }
}, true);
function wrapCreate() {
  const inner = Cmd.createPost;
  Cmd.createPost = (data) => {
    if (Remote.on && Remote.uploads.images.length && (data.images || data.media === null || data.type === "post")) { data.images = Remote.uploads.images.map(m => cssMedia(m.url)); data.media = data.images.length === 1 ? data.images[0] : null; if (data.images.length === 1) delete data.images; Remote.uploads.images = []; }
    const r = inner(data);
    if (Remote.on && !r.error && r.post.type === "video" && Remote.uploads.video) { r.post.video = { ...(r.post.video || {}), mediaId: Remote.uploads.video.id }; Remote.uploads.video = null; save(); }
    return r;
  };
}

/* real video playback when the Media Engine produced variants */
const _play = typeof playVideo === "function" ? playVideo : null;
playVideo = function (pid) {
  const p = S.post(pid), v = p.video || {};
  if (!v.variants) return _play && _play(pid);
  const poster = (window.MPVideoSources ? MPVideoSources.poster(v.variants) : v.variants.poster) || "";
  v.starts = (v.starts || 0) + 1; save();
  const s = sheet(`<video controls playsinline autoplay preload="metadata" ${poster ? `poster="${poster}"` : ""} style="width:100%;border-radius:12px;max-height:70vh;background:#000">
      ${v.variants["720p"] ? `<source src="${v.variants["720p"]}" type="video/mp4">` : ""}${v.variants["360p"] ? `<source src="${v.variants["360p"]}" type="video/mp4" media="(max-width:480px)">` : ""}<source src="${v.variants.original}"></video><p class="body">${richText(p.text)}</p>`);
  const el = s.querySelector("video"); el.onended = () => { v.completions = (v.completions || 0) + 1; save(); };
};

/* phase 41: server translation moved to the lazy `ai` chunk (subscribers, ai-ui.js) */
function wrapRender() {
  const inner = postInner;
  postInner = function (p, opts) {
    return inner(p, opts);
  };
  MPSettings.add(function () {
    const ver = $("#ver"); if (ver) ver.textContent = verLabel(Remote.health?.version || APP_VERSION) + (Remote.on ? " · متصل بالخادم" : " · وضع تجريبي محلي");
    if (!Remote.on) return;
    const me = S.me();
    view.querySelector(".wrap").insertAdjacentHTML("beforeend", `<section class="set-grp"><h3 class="set-h">الحساب</h3><div class="list"><div class="li"><span class="ico">${UI.icon("user", "sm")}</span><span class="t"><b><bdi>@${esc(me.handle)}</bdi></b>${DB.isAdmin ? "<small>مدير المنصة</small>" : ""}</span></div>
      ${UI.li({ href: "#/creator", icon: "chart", title: "إحصائيات المبدع" })}<button type="button" class="li danger" id="logout"><span class="ico">${UI.icon("x", "sm")}</span><span class="t"><b>تسجيل الخروج</b></span></button></div></section>`);
    if (!DB.isAdmin) view.querySelectorAll('a[href="#/admin"]').forEach(a => a.remove());
    $("#logout").onclick = async () => { await Remote.api("POST", "/api/auth/logout").catch(() => { }); Remote.es?.close(); location.hash = ""; location.reload(); };
  });
  // Admin dashboard enriched with server KPIs (retention, online)
  const admin = V12.admin;
  V12.admin = async function () {
    admin();
    if (!Remote.on || !DB.isAdmin) return;
    try { const d = await Remote.api("GET", "/api/admin/dashboard"); const k = view.querySelector(".kpi");
      if (k) { k.children[0].innerHTML = `<b>${d.dau}</b>نشط يومياً (DAU)`; k.children[1].innerHTML = `<b>${d.mau}</b>نشط شهرياً (MAU)`; k.querySelectorAll(".kpi-srv").forEach((x) => x.remove()); /* v2.55: two overlapping renders appended the server tiles twice */ k.insertAdjacentHTML("beforeend", `<div class="kpi-srv"><b>${d.users}</b>مستخدم</div><div class="kpi-srv"><b>${d.online}</b>متصل الآن</div><div class="kpi-srv"><b>${d.retention7d ?? "—"}${d.retention7d != null ? "%" : ""}</b>الاحتفاظ 7 أيام</div>`); }
    } catch (e) { }
  };
  // Creator analytics from the server (reach, best hours in the viewer's timezone, sources)
  MPRoutes.extend((a, b) => ({ creator: () => creatorView() }));
}
async function creatorView() {
  view.innerHTML = `<div class="wrap"><a href="#/settings" class="muted">→ الإعدادات</a><h2><svg class="ic hi" aria-hidden="true"><use href="#i-trendUp"/></svg>إحصائيات المبدع</h2><div class="empty">جاري التحميل…</div></div>`;
  try {
    const d = await Remote.api("GET", "/api/creator/analytics");
    const tzHour = (h) => { const dt = new Date(); dt.setUTCHours(h, 0, 0, 0); return dt.toLocaleTimeString("ar", { hour: "numeric" }); };
    view.querySelector(".wrap").innerHTML = `<a href="#/settings" class="muted">→ الإعدادات</a><h2><svg class="ic hi" aria-hidden="true"><use href="#i-trendUp"/></svg>إحصائيات المبدع</h2>
      <div class="kpi"><div><b>${d.views}</b>مشاهدة</div><div><b>${d.reach}</b>وصول (٣٠ يوماً)</div><div><b>${d.engagement}</b>تفاعل</div><div><b>${d.followers}</b>متابِع (+${d.newFollowers7d} هذا الأسبوع)</div></div>
      <h4>أفضل أوقات النشر</h4><div class="card">${d.bestHoursUTC.map(h => `<div class="trend"><span>${tzHour(h.hourUTC)}</span><span class="muted">متوسط ${h.avg.toFixed(1)} تفاعل</span></div>`).join("") || '<p class="muted">انشر أكثر لنحدد أوقاتك الأفضل</p>'}</div>
      <h4>مصادر الوصول</h4><div class="card">${Object.entries(d.sources).map(([k, v]) => `<div class="trend"><span>${k === "app" ? "داخل التطبيق" : esc(k)}</span><b>${v}</b></div>`).join("") || '<p class="muted">لا بيانات بعد</p>'}</div>
      <h4>أفضل المنشورات</h4>${d.topPosts.map(p => `<a class="u-db card" href="#/post/${p.id}"><div class="body">${esc(p.title)}</div><div class="muted">${p.views} مشاهدة · ${p.engagement} تفاعل</div></a>`).join("") || '<div class="empty">لا منشورات</div>'}`;
  } catch (e) { toast(e.message); }
}

/* ---------- Boot ---------- */
(async function boot() {
  wrapCreate(); wrapRender();
  Bus.on("INVITE_SENT", e => Remote.on && Remote.api("POST", "/api/invites", { kind: e.kind, ref: e.id, to: e.to }).catch(err => toast(err.message)));
  if (!location.protocol.startsWith("http")) return window.MPSession?.set("in"); // opened as a file: local demo user
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 2500);
    const r = await fetch("/api/health", { signal: ctl.signal }); if (!r.ok) throw 0;
    Remote.health = await r.json(); if (!Remote.health.ok) throw 0;
  } catch { window.__deferRoute = false; window.MPSession?.set("in"); return route(); } // no server → offline demo mode (local demo user)
  Remote.on = window.REMOTE = true;
  const localSave = save;
  save = function () { if (!Remote.on || !Remote.snap) return localSave(); scheduleFlush(); };
  try { await start(); } catch (e) { if (e.status === 401) showAuth(); else { toast(e.message); showAuth(); } }
})();
