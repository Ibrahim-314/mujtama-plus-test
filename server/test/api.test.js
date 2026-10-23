/* End-to-end API tests: two real users interacting through the server (SQLite in-memory). */
const test = require("node:test"), assert = require("node:assert");
const { createApp } = require("../server");
let app, base;
class Client {
  constructor() { this.cookie = ""; }
  async req(method, path, body, raw) {
    const r = await fetch(base + path, { method, headers: { "X-Requested-With": "mujtama", ...(raw ? { "Content-Type": "application/octet-stream" } : { "Content-Type": "application/json" }), Cookie: this.cookie }, body: raw || (body ? JSON.stringify(body) : undefined) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const j = await r.json().catch(() => ({})); return { status: r.status, ...j };
  }
}
const A = new Client(), B = new Client();
test.before(async () => { require("../lib/core").LIMITS.post = [14, 60e3]; process.env.LOG_SILENT = "1"; if (process.env.TEST_DATABASE_URL) { const { Client } = require("pg"); const c = new Client({ connectionString: process.env.TEST_DATABASE_URL }); await c.connect(); await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public"); await c.end(); } app = await createApp({ databaseUrl: process.env.TEST_DATABASE_URL || "sqlite::memory:", storageDir: require("os").tmpdir() + "/mp-st-" + Date.now(), fakeVideoMs: 200, adaptiveRateLimits: false }); await new Promise(r => app.server.listen(0, r)); base = "http://127.0.0.1:" + app.server.address().port; });
test.after(async () => app.close());
const wait = (ms) => new Promise(r => setTimeout(r, ms));

test("auth: register, duplicate handle, login, CSRF", async () => {
  let r = await A.req("POST", "/api/auth/register", { name: "إبراهيم", handle: "ibrahim", password: "secret123" }); assert.equal(r.status, 200); assert.equal(r.user.role, "admin");
  r = await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "IBRAHIM", password: "secret123" }); assert.equal(r.status, 409);
  r = await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "salma", password: "secret123" }); assert.equal(r.status, 200); assert.equal(r.user.role, undefined);
  const bad = await fetch(base + "/api/posts", { method: "POST", headers: { "Content-Type": "application/json", Cookie: A.cookie }, body: "{}" }); assert.equal(bad.status, 403);
  const C = new Client(); r = await C.req("POST", "/api/auth/login", { handle: "salma", password: "wrong" }); assert.equal(r.status, 401);
  r = await C.req("POST", "/api/auth/login", { handle: "salma", password: "secret123" }); assert.equal(r.status, 200);
});

test("social graph + notifications from events", async () => {
  const me = (await A.req("GET", "/api/me")).user;
  await B.req("GET", "/api/me");
  assert.equal((await B.req("PUT", "/api/follows/" + me.id)).status, 200);
  const p = (await A.req("POST", "/api/posts", { text: "أول منشور على الخادم #برمجة @salma" })).post;
  assert.equal(p.topic, "dev"); assert.equal(p.status, "published");
  assert.equal((await B.req("PUT", "/api/reactions/" + p.id, { type: "useful" })).status, 200);
  const c = (await B.req("POST", "/api/comments", { post: p.id, text: "رائع 👏" })).comment;
  await A.req("POST", "/api/comments", { post: p.id, text: "شكراً", parent: c.id });
  await wait(100);
  const kinds = (await A.req("GET", "/api/notifications")).notifications.map(n => n.kind);
  assert.ok(kinds.includes("follow") && kinds.includes("reaction") && kinds.includes("comment"), kinds.join());
  const bk = (await B.req("GET", "/api/notifications")).notifications.map(n => n.kind);
  assert.ok(bk.includes("mention") && bk.includes("reply"), bk.join());
});

test("content types, validation, spam, duplicates, edit history, visibility", async () => {
  assert.equal((await A.req("POST", "/api/posts", { text: "اربح 1000 دولار الآن" })).status, 422);
  assert.equal((await A.req("POST", "/api/posts", { type: "article", text: "بدون عنوان" })).status, 400);
  const poll = (await A.req("POST", "/api/posts", { type: "poll", text: "أي لغة؟", poll: { options: ["JS", "Python", "Go"], multi: true } })).post;
  assert.equal((await B.req("POST", `/api/posts/${poll.id}/vote`, { option: [0, 2] })).status, 200);
  const disc = (await A.req("POST", "/api/posts", { type: "discussion", title: "العمل عن بعد؟", text: "نقاش", stances: ["مع", "ضد"] })).post;
  assert.equal((await B.req("POST", `/api/posts/${disc.id}/stance`, { index: 1 })).status, 200);
  const priv = (await A.req("POST", "/api/posts", { text: "للمتابعين فقط", visibility: "followers" })).post;
  assert.equal((await B.req("GET", "/api/posts/" + priv.id)).status, 200); // salma follows A
  const secret = (await A.req("POST", "/api/posts", { text: "خاص جداً", visibility: "private" })).post;
  assert.equal((await B.req("GET", "/api/posts/" + secret.id)).status, 404);
  assert.equal((await A.req("POST", "/api/posts", { text: "خاص جداً", visibility: "private" })).status, 409);
  await A.req("PATCH", "/api/posts/" + priv.id, { text: "نص معدّل" });
  const got = (await A.req("GET", "/api/posts/" + priv.id)).post; assert.equal(got.edited, true); assert.equal(got.history[0].text, "للمتابعين فقط");
  assert.equal((await B.req("PATCH", "/api/posts/" + priv.id, { text: "اختراق" })).status, 403);
  const sch = (await A.req("POST", "/api/posts", { text: "مجدول", publishAt: new Date(Date.now() + 3600e3).toISOString() })).post; assert.equal(sch.status, "scheduled");
  const vid = (await A.req("POST", "/api/posts", { type: "video", text: "فيديو", media: "linear-gradient(135deg,#111111,#222222)" })).post; assert.equal(vid.status, "processing");
  await wait(400); assert.equal((await A.req("GET", "/api/posts/" + vid.id)).post.status, "published");
  const bad = (await A.req("POST", "/api/posts", { text: "x", media: "url(javascript:alert(1))" })).post; assert.equal(bad.media, null);
});

test("communities: permissions, approval queue, roles, invite-only", async () => {
  const salma = (await B.req("GET", "/api/me")).user;
  const c = (await A.req("POST", "/api/communities", { name: "بناة جدة", desc: "مجتمع محلي", type: "public", requireApproval: true })).community;
  assert.equal((await B.req("POST", "/api/posts", { text: "قبل الانضمام", community: c.id })).status, 403);
  await B.req("PUT", `/api/communities/${c.id}/membership`);
  const pend = (await B.req("POST", "/api/posts", { text: "منشور يحتاج موافقة", community: c.id })).post; assert.equal(pend.status, "pending");
  assert.equal((await B.req("POST", `/api/communities/${c.id}/queue/${pend.id}`, { action: "approve" })).status, 403);
  assert.equal((await A.req("POST", `/api/communities/${c.id}/queue/${pend.id}`, { action: "approve" })).status, 200);
  assert.equal((await B.req("PATCH", `/api/communities/${c.id}`, { allowLinks: false })).status, 403);
  await A.req("PATCH", `/api/communities/${c.id}`, { allowLinks: false, requireApproval: false });
  await A.req("PATCH", `/api/communities/${c.id}/members/${salma.id}`, { role: "moderator" });
  assert.equal((await B.req("POST", "/api/posts", { text: "رابط https://x.com", community: c.id })).status, 400);
  const inv = (await A.req("POST", "/api/communities", { name: "نادي خاص", type: "invite" })).community;
  assert.equal((await B.req("PUT", `/api/communities/${inv.id}/membership`)).status, 403);
  await A.req("POST", "/api/invites", { kind: "community", ref: inv.id, to: salma.id }); await wait(100);
  assert.equal((await B.req("PUT", `/api/communities/${inv.id}/membership`)).role, "member");
  const an = await A.req("GET", `/api/communities/${c.id}/analytics`); assert.ok(an.members >= 2);
});

test("events, messaging, feed pagination, trends, search", async () => {
  const salma = (await B.req("GET", "/api/me")).user;
  const ev = (await A.req("POST", "/api/events", { name: "لقاء المطورين", startsAt: new Date(Date.now() + 864e5).toISOString(), place: "جدة" })).event;
  await B.req("PUT", `/api/events/${ev.id}/rsvp/going`);
  assert.ok((await B.req("GET", "/api/events")).events.find(e => e.id === ev.id).going.includes(salma.id));
  const conv = (await A.req("POST", "/api/conversations", { user: salma.id })).conversation;
  assert.equal((await A.req("POST", "/api/messages", { conv: conv.id, text: "أهلاً سلمى" })).status, 200);
  const C = new Client(); await C.req("POST", "/api/auth/register", { name: "طرف ثالث", handle: "third", password: "secret123" });
  assert.equal((await C.req("POST", "/api/messages", { conv: conv.id, text: "تطفل" })).status, 403);
  const f1 = await B.req("GET", "/api/feed?mode=for&limit=5"); assert.equal(f1.posts.length, 5); assert.ok(f1.nextCursor);
  const f2 = await B.req("GET", `/api/feed?mode=for&limit=5&cursor=${f1.nextCursor}`); assert.ok(!f2.posts.some(p => f1.posts.find(x => x.id === p.id)));
  assert.ok((await B.req("GET", "/api/feed?mode=latest")).posts.length > 0);
  assert.ok((await B.req("GET", "/api/trends")).trends.length > 0);
  const s = await B.req("GET", "/api/search?q=" + encodeURIComponent("المطورين")); assert.ok(s.events.length >= 1);
  const t = await B.req("GET", "/api/tags/" + encodeURIComponent("الذكاء_الاصطناعي")); assert.ok(t.posts.length > 0);
});

test("trust & safety: report → remove → decision → appeal → restore; malicious repeat", async () => {
  const p = (await B.req("POST", "/api/posts", { text: "منشور سيتم الإبلاغ عنه" })).post;
  assert.equal((await A.req("POST", "/api/reports", { target: p.id, kind: "post", reason: "Spam" })).status, 200);
  assert.equal((await A.req("POST", "/api/reports", { target: p.id, kind: "post", reason: "Spam" })).status, 409);
  const dash = await A.req("GET", "/api/admin/dashboard"); assert.ok(dash.reports.length >= 1);
  assert.equal((await B.req("GET", "/api/admin/dashboard")).status, 403);
  await A.req("POST", "/api/admin/reports/" + dash.reports.find(r => r.target === p.id).id, { action: "remove" });
  assert.equal((await A.req("GET", "/api/posts/" + p.id)).status, 404);
  const d = (await B.req("GET", "/api/me/decisions")).decisions[0];
  const ap = await B.req("POST", "/api/appeals", { decision: d.id, text: "لم يكن سبام" });
  await A.req("POST", "/api/admin/appeals/" + ap.id, { action: "accept" });
  assert.equal((await A.req("GET", "/api/posts/" + p.id)).post.status, "published");
});

test("bootstrap snapshot + media upload validation + rate limit", async () => {
  const b = await B.req("GET", "/api/bootstrap");
  assert.ok(b.users.length && b.posts.length && b.communities.length && b.me);
  assert.ok(!b.posts.find(p => p.visibility === "private" && p.author !== b.me));
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]);
  const up = await B.req("POST", "/api/media", null, png); assert.equal(up.media.kind, "image");
  const r = await fetch(base + up.media.url); assert.equal(r.status, 200);
  assert.equal((await B.req("POST", "/api/media", null, Buffer.from("<script>alert(1)</script>"))).status, 400);
  let limited = false; for (let i = 0; i < 16; i++) { const x = await B.req("POST", "/api/posts", { text: "حد " + i }); if (x.status === 429) limited = true; }
  assert.ok(limited);
});
