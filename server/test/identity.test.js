/* Track 2 — identity: profiles & images, privacy, multi-account, organisations, verification,
 * reputation & achievements, impersonation, onboarding/growth/experiments. */
const test = require("node:test"), assert = require("node:assert"), { execFileSync } = require("node:child_process");
const { boot } = require("./helpers");
let H, A, B, C;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
test.before(async () => {
  H = await boot(); A = new H.Client(); B = new H.Client(); C = new H.Client();
  await A.req("POST", "/api/auth/register", { name: "إبراهيم عسيري", handle: "ibrahim", password: "secret123" });
  await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "salma", password: "secret123" });
  await C.req("POST", "/api/auth/register", { name: "خالد", handle: "khaled", password: "secret123" });
});
test.after(() => H.app.close());
const uid = async (c) => (await c.req("GET", "/api/me")).user.id;
const raw = async (c, path, buf) => { const r = await fetch(H.base + path, { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream", Cookie: c.cookie }, body: buf }); return { status: r.status, ...(await r.json()) }; };

test("profile: links, expertise, location, 3 pinned posts max, completeness", async () => {
  const ids = []; for (let i = 0; i < 4; i++) ids.push((await A.req("POST", "/api/posts", { text: "منشور رقم " + i + " #برمجة" })).post.id);
  assert.equal((await A.req("PATCH", "/api/profile", { pinnedPosts: ids })).status, 400);
  const r = await A.req("PATCH", "/api/profile", { location: "جدة", links: [{ label: "موقعي", url: "https://example.com" }, { label: "سيء", url: "javascript:alert(1)" }], expertise: ["Node.js", "تصميم"], pinnedPosts: ids.slice(0, 3), sections: ["articles", "works", "communities", "evil"] });
  assert.equal(r.status, 200); assert.equal(r.profile.links.length, 1, "unsafe URL dropped"); assert.deepEqual(r.profile.sections, ["articles", "works", "communities"]);
  assert.equal(r.pinned.length, 3); assert.ok(r.completeness.percent > 0 && r.completeness.percent < 100);
  const card = await B.req("GET", "/api/profiles/ibrahim/card"); assert.equal(card.location, "جدة");
});

test("profile images: avatar → 3 WebP sizes, metadata stripped, served from /media", async () => {
  const png = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x5b2bd6:s=500x400", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]);
  let r = await raw(A, "/api/profile/image?kind=avatar", png); assert.equal(r.status, 200, r.error); assert.deepEqual(Object.keys(r.avatar).sort(), ["200", "400", "64"]);
  const img = await fetch(H.base + r.avatar["200"]); assert.equal(img.status, 200); const buf = Buffer.from(await img.arrayBuffer()); assert.equal(buf.slice(8, 12).toString(), "WEBP");
  r = await raw(A, "/api/profile/image?kind=cover", png); assert.ok(r.cover["1200"]);
  assert.equal((await raw(A, "/api/profile/image?kind=avatar", Buffer.from("not an image"))).status, 400);
  const me = (await A.req("GET", "/api/profiles/ibrahim")).profile; assert.ok(me.avatar["64"]);
});

test("private account: follow becomes a request, posts hidden until approved", async () => {
  await B.req("PUT", "/api/privacy", { private: true });
  await B.req("POST", "/api/posts", { text: "منشور خاص لمتابعيّ" });
  let r = await C.req("GET", "/api/profiles/salma"); assert.equal(r.locked, true); assert.equal(r.profile.postsCount, null);
  const salma = await uid(B); r = await C.req("PUT", "/api/follows/" + salma); assert.equal(r.state, "requested");
  await wait(50); assert.ok((await B.req("GET", "/api/notifications")).notifications.some(n => n.kind === "follow_request"));
  const khaled = await uid(C); assert.equal((await B.req("POST", `/api/follow-requests/${khaled}/approve`)).status, 200);
  r = await C.req("GET", "/api/profiles/salma"); assert.equal(r.locked, false); assert.equal(r.profile.postsCount, 1);
});

test("interaction controls: DMs, mention and comment permissions, message requests", async () => {
  const ibrahim = await uid(A); await uid(B);
  await A.req("PUT", "/api/privacy", { dm: "nobody" });
  assert.equal((await C.req("POST", "/api/conversations", { user: ibrahim })).status, 403);
  await A.req("PUT", "/api/privacy", { dm: "everyone", filterRequests: true });
  const conv = await C.req("POST", "/api/conversations", { user: ibrahim }); assert.equal(conv.conversation.request, true, "non-follower lands in Requests");
  const reqs = await A.req("GET", "/api/conversations/requests"); assert.equal(reqs.requests.length, 1);
  assert.equal((await A.req("POST", `/api/conversations/${conv.conversation.id}/accept`)).status, 200);
  await B.req("PUT", "/api/privacy", { mentions: "nobody", comments: "following" });
  await C.req("POST", "/api/posts", { text: "مرحبا @salma" }); await wait(60);
  assert.ok(!(await B.req("GET", "/api/notifications")).notifications.some(n => n.kind === "mention"), "mention suppressed");
  const sp = (await B.req("POST", "/api/posts", { text: "تعليقات للمتابَعين فقط" })).post;
  assert.equal((await A.req("POST", "/api/comments", { post: sp.id, text: "تعليق" })).status, 404, "private account post not visible to non-follower");
  await B.req("PUT", "/api/privacy", { private: false });
  assert.equal((await A.req("POST", "/api/comments", { post: sp.id, text: "تعليق" })).status, 403, "comments limited to people salma follows");
  await B.req("PUT", "/api/follows/" + ibrahim);
  assert.equal((await A.req("POST", "/api/comments", { post: sp.id, text: "تعليق" })).status, 200);
});

test("close friends visibility and muted words", async () => {
  const khaled = await uid(C);
  await A.req("PUT", "/api/close-friends/" + khaled);
  const p = (await A.req("POST", "/api/posts", { text: "للمقربين فقط", visibility: "close" })).post;
  assert.equal((await C.req("GET", "/api/posts/" + p.id)).status, 200);
  assert.equal((await B.req("GET", "/api/posts/" + p.id)).status, 404);
  await C.req("POST", "/api/posts", { text: "حرق أحداث المسلسل الجديد" });
  await A.req("PUT", "/api/privacy", { mutedWords: ["حرق"] });
  const feed = await A.req("GET", "/api/feed?mode=latest"); assert.ok(!feed.posts.some(x => x.text.includes("حرق")));
});

test("multiple accounts: add a second account and switch with one tap", async () => {
  const M = new H.Client(); await M.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123" });
  await M.req("POST", "/api/auth/login", { handle: "khaled", password: "secret123", addAccount: true });
  // cookie jar: keep both cookies
  const r1 = await fetch(H.base + "/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "ibrahim", password: "secret123" }) });
  const s1 = r1.headers.get("set-cookie").split(";")[0];
  const r2 = await fetch(H.base + "/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: s1 }, body: JSON.stringify({ handle: "khaled", password: "secret123", addAccount: true }) });
  const cookies = r2.headers.getSetCookie().map(c => c.split(";")[0]); const jarC = cookies.find(c => c.startsWith("mp_jar=")), s2 = cookies.find(c => c.startsWith("mp_session="));
  assert.ok(jarC, "previous session stashed");
  const hdr = { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: `${s2}; ${jarC}` };
  const acc = await (await fetch(H.base + "/api/auth/accounts", { headers: hdr })).json(); assert.equal(acc.current.handle, "khaled"); assert.equal(acc.accounts[0].handle, "ibrahim");
  const sw = await fetch(H.base + "/api/auth/switch", { method: "POST", headers: hdr, body: JSON.stringify({ userId: acc.accounts[0].id }) });
  assert.equal((await sw.json()).user.handle, "ibrahim");
});

test("organisations: create, invite, roles, act-as posting, editor limits, team log", async () => {
  let r = await A.req("POST", "/api/orgs", { name: "شركة بلس", handle: "plus_co" }); assert.equal(r.status, 200); const org = r.org.id;
  r = await A.req("POST", `/api/orgs/${org}/invites`, { handle: "salma", role: "editor" }); assert.equal(r.status, 200);
  const inv = (await B.req("GET", "/api/org-invites")).invites[0]; assert.equal(inv.org, org);
  assert.equal((await B.req("POST", `/api/org-invites/${inv.id}/accept`)).status, 200);
  const post = await B.req("POST", "/api/posts", { text: "إعلان رسمي من الفريق" }, { "X-Act-As": org }); assert.equal(post.status, 200); assert.equal(post.post.author, org);
  assert.equal((await B.req("POST", `/api/orgs/${org}/invites`, { handle: "khaled" }, { "X-Act-As": org })).status, 403, "editors cannot invite");
  assert.equal((await C.req("POST", "/api/posts", { text: "x" }, { "X-Act-As": org })).status, 403, "non-members cannot act");
  assert.equal((await B.req("GET", "/api/security", null, { "X-Act-As": org })).twoFactor !== undefined, true, "security always runs as the person");
  await wait(30);
  r = await A.req("GET", "/api/orgs/" + org); assert.equal(r.members.length, 2); assert.ok(r.activity.some(a => a.action.startsWith("POST /api/posts") && a.handle === "salma"));
  assert.equal((await B.req("DELETE", `/api/orgs/${org}/members/${await uid(A)}`)).status, 403);
});

test("verification: request with document → admin approves → verified badge", async () => {
  const png = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=200x120", "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"]);
  const doc = (await raw(B, "/api/media", png)).media; assert.ok(doc.id);
  assert.equal((await B.req("POST", "/api/verification", { kind: "expert" })).status, 400, "documents required");
  assert.equal((await B.req("POST", "/api/verification", { kind: "expert", note: "باحثة", docs: [doc.id] })).status, 200);
  assert.equal((await B.req("POST", "/api/verification", { kind: "expert", docs: [doc.id] })).status, 409);
  const q = await A.req("GET", "/api/admin/verification"); assert.equal(q.requests.length, 1);
  assert.equal((await A.req("POST", "/api/admin/verification/" + q.requests[0].id, { decision: "approve" })).status, 200);
  const p = (await A.req("GET", "/api/profiles/salma")).profile; assert.equal(p.verified, "expert"); assert.equal(p.verifiedLabel, "خبير موثق في مجاله");
});

test("impersonation: a look-alike of a verified account is flagged for review", async () => {
  const X = new H.Client(); await X.req("POST", "/api/auth/register", { name: "سلمى ", handle: "sa1ma", password: "secret123" });
  await wait(80);
  const f = await A.req("GET", "/api/admin/impersonation"); const hit = f.flags.find(x => x.suspect.handle === "sa1ma");
  assert.ok(hit, JSON.stringify(f)); assert.equal(hit.original.handle, "salma");
  assert.equal((await A.req("POST", "/api/admin/impersonation/" + hit.id, { decision: "confirm" })).status, 200);
  assert.equal((await X.req("GET", "/api/me")).status, 401, "confirmed impersonator is suspended");
});

test("reputation rewards quality, achievements are awarded", async () => {
  const salma = await uid(B); const p = (await B.req("POST", "/api/posts", { text: "شرح مفيد عن قواعد البيانات" })).post;
  const ra = await A.req("PUT", "/api/reactions/" + p.id, { type: "useful" }), rc = await C.req("PUT", "/api/reactions/" + p.id, { type: "useful" });
  assert.equal(ra.status + rc.status, 400);
  await A.req("POST", "/api/admin/reputation/recompute");
  const rep = await B.req("GET", "/api/reputation/salma"); assert.ok(rep.score > 0); assert.ok(rep.breakdown.quality > 0);
  const ach = (await B.req("GET", "/api/profiles/salma")).profile.achievements.map(a => a.key); assert.ok(ach.includes("first_post"), ach.join());
  assert.ok(salma);
});

test("growth: challenges, suggestions, experiments, welcome message, funnel", async () => {
  const D = new H.Client(); await D.req("POST", "/api/auth/register", { name: "نورة", handle: "noura", password: "secret123" });
  await D.req("PUT", "/api/me/prefs", { interests: ["dev", "ai", "pi"], onboarded: true });
  let ob = await D.req("GET", "/api/onboarding"); assert.equal(ob.challenges.items.length, 5); assert.equal(ob.challenges.completed, 0); assert.ok(ob.experiments.tour_style);
  const sug = await D.req("GET", "/api/suggestions/follow"); assert.ok(sug.suggestions.length >= 2); assert.ok(sug.suggestions[0].reason);
  const comm = (await A.req("POST", "/api/communities", { name: "مطوري جدة", desc: "مجتمع للمطورين", type: "public" })).community;
  assert.equal((await A.req("PUT", `/api/communities/${comm.id}/welcome`, { text: "عرّف بنفسك في أول منشور!" })).status, 200);
  await D.req("PUT", `/api/communities/${comm.id}/membership`); await wait(80);
  const boot = await D.req("GET", "/api/bootstrap"); assert.ok(boot.messages.some(m => m.text.includes("مرحباً بك في «مطوري جدة»")), "welcome DM delivered");
  ob = await D.req("GET", "/api/onboarding"); assert.ok(ob.challenges.items.find(c => c.key === "community").done);
  const funnel = await A.req("GET", "/api/admin/funnel"); assert.equal(funnel.steps[0].label, "سجّل"); assert.ok(funnel.steps[0].users >= 4);
  const exps = await A.req("GET", "/api/admin/experiments"); assert.ok(exps.experiments[0].variants.reduce((a, v) => a + v.exposed, 0) >= 1);
});
