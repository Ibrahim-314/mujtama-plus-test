/* v2.58.0 «المجتمع 3.0» stage 3 — channels, content, rules & welcome: slow mode, role channels (see / post), archive
 * without leaks, categories + order, unread counts, per-channel approval and content types, pin limits, announcement
 * schedule/expiry/dismissal (+ one notified announcement a day), structured rules mirrored both ways with
 * communities.rules, server-side welcome steps (import from localStorage, auto steps, stats), and migration 064. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, MO, U, V, X, cid;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const db = () => H.app.ctx.db;
const post = (c, b) => c.req("POST", "/api/posts", { community: cid, ...b });
test.before(async () => {
  H = await boot();
  [O, MO, U, V, X] = [await mk("ch_own"), await mk("ch_mod"), await mk("ch_usr"), await mk("ch_v"), await mk("ch_out")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع القنوات", desc: "اختبار القنوات والمحتوى", rules: ["الاحترام", "لا إعلانات"] })).community.id;
  for (const c of [MO, U, V]) await c.req("PUT", `/api/communities/${cid}/membership`);
  await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" });
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());

test("slow mode: one post per window for members, moderators exempt, the wait is shown on the page", async () => {
  const ch = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "بطيئة", viewPerm: "public", slowModeSec: 60 })).channel;
  assert.equal(ch.slowModeSec, 60);
  assert.equal((await post(U, { text: "أول منشور في القناة البطيئة", channel: ch.id })).status, 200);
  const r = await post(U, { text: "منشور ثانٍ سريع جداً", channel: ch.id }); assert.equal(r.status, 429); assert.match(r.error || r.message || JSON.stringify(r), /الوضع البطيء/);
  const sp = await U.req("GET", `/api/communities/${cid}/space`); const mine = sp.channels.find(x => x.id === ch.id); assert.ok(mine.waitSec > 0 && mine.waitSec <= 60);
  assert.equal((await post(MO, { text: "مشرف أول", channel: ch.id })).status, 200);
  assert.equal((await post(MO, { text: "مشرف ثانٍ بلا انتظار", channel: ch.id })).status, 200, "moderators are not slowed");
  assert.equal((await post(V, { text: "عضو آخر له نافذته", channel: ch.id })).status, 200, "the window is per member");
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/channels/${ch.id}`, { slowModeSec: 0 })).channel.slowModeSec, 0);
  assert.equal((await post(U, { text: "بعد إيقاف الوضع البطيء", channel: ch.id })).status, 200);
});

test("role channels: only the role (and the team) see the channel and its posts; post roles limit who writes", async () => {
  const role = (await O.req("POST", `/api/communities/${cid}/roles`, { name: "متحدث", color: "#2563eb", perms: [] })).role;
  await O.req("PUT", `/api/communities/${cid}/members/${V.id}/roles/${role.id}`);
  const ch = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "غرفة المتحدثين", viewPerm: "members", viewRoles: [role.id] })).channel;
  assert.deepEqual(ch.viewRoles, [role.id]);
  assert.ok(!(await U.req("GET", `/api/communities/${cid}/space`)).channels.some(x => x.id === ch.id), "a member without the role does not see it");
  assert.ok((await V.req("GET", `/api/communities/${cid}/space`)).channels.some(x => x.id === ch.id), "the role sees it");
  assert.ok((await MO.req("GET", `/api/communities/${cid}/space`)).channels.some(x => x.id === ch.id), "the team sees it");
  assert.equal((await post(U, { text: "محاولة نشر بلا دور", channel: ch.id })).status, 403);
  const p = (await post(V, { text: "حديث داخل غرفة المتحدثين", channel: ch.id })).post; assert.ok(p.id);
  const anon = new H.Client();
  for (const [c, see] of [[anon, false], [X, false], [U, false], [V, true], [MO, true]]) {
    const all = (await c.req("GET", `/api/communities/${cid}/posts`)).posts || [];
    assert.equal(all.some(x => x.id === p.id), see, "stream visibility for a role channel post");
  }
  assert.notEqual((await U.req("GET", `/api/posts/${p.id}`)).post?.id, p.id, "a direct link does not reveal it either");
  // post roles: everyone sees, only the role writes
  const stage = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "المنصة", viewPerm: "public", postRoles: [role.id] })).channel;
  assert.ok((await U.req("GET", `/api/communities/${cid}/space`)).channels.find(x => x.id === stage.id).canPost === false);
  assert.equal((await post(U, { text: "لست متحدثاً", channel: stage.id })).status, 403);
  assert.equal((await post(V, { text: "أنا المتحدث هنا", channel: stage.id })).status, 200);
  assert.equal((await post(MO, { text: "المشرف يعلن هنا", channel: stage.id })).status, 200, "moderators may announce anywhere");
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/channels/${stage.id}`, { viewRoles: ["nope_123"] })).channel.viewRoles.length, 0, "unknown roles are ignored");
});

test("archive: read-only, nothing widens — a members-only archived channel stays with the members; restore", async () => {
  const sec = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "أرشيف الأعضاء", viewPerm: "members" })).channel;
  const pub = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "أرشيف عام", viewPerm: "public" })).channel;
  const hp = (await post(U, { text: "سر من أسرار الأعضاء", channel: sec.id })).post, pp = (await post(U, { text: "منشور في قناة عامة ستُؤرشف", channel: pub.id })).post;
  assert.equal((await U.req("POST", `/api/communities/${cid}/channels/${sec.id}/archive`)).status, 403, "members cannot archive");
  for (const ch of [sec, pub]) assert.ok((await O.req("POST", `/api/communities/${cid}/channels/${ch.id}/archive`)).channel.archivedAt);
  const anon = new H.Client(), a = (await anon.req("GET", `/api/communities/${cid}/posts`)).posts;
  assert.ok(!a.some(x => x.id === hp.id), "members-only posts stay hidden after archive"); assert.ok(a.some(x => x.id === pp.id), "public posts stay public");
  assert.ok(!(await anon.req("GET", `/api/communities/${cid}/space`)).channels.some(x => x.id === sec.id), "the archived members channel is not listed to outsiders");
  assert.ok((await U.req("GET", `/api/communities/${cid}/posts?channel=${sec.id}`)).posts.some(x => x.id === hp.id), "members still read it");
  const r = await post(U, { text: "نشر في قناة مؤرشفة", channel: sec.id }); assert.equal(r.status, 403);
  assert.ok((await U.req("GET", `/api/communities/${cid}/space`)).channels.find(x => x.id === sec.id).archivedAt);
  await O.req("POST", `/api/communities/${cid}/channels/${sec.id}/restore`);
  assert.equal((await post(U, { text: "عادت القناة للعمل", channel: sec.id })).status, 200);
  assert.ok((await O.req("GET", `/api/communities/${cid}/modlog`)).log.some(l => l.action === "channel_archived"));
});

test("categories and order; unread counts; per-channel approval; content types", async () => {
  const g = (await O.req("POST", `/api/communities/${cid}/channel-groups`, { name: "عام" })).group; assert.ok(g.id);
  const a = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "نقاش مفتوح", viewPerm: "public", group: g.id })).channel; assert.equal(a.group, g.id);
  const b = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "صور", viewPerm: "public", allowedTypes: ["image"] })).channel;
  const ord = await O.req("PUT", `/api/communities/${cid}/channels/order`, { groups: [g.id], channels: [{ id: b.id, group: g.id }, { id: a.id, group: g.id }] });
  const ia = ord.channels.findIndex(x => x.id === a.id), ib = ord.channels.findIndex(x => x.id === b.id); assert.ok(ib < ia, "the new order is kept"); assert.equal(ord.channels[ib].group, g.id);
  assert.equal((await MO.req("PUT", `/api/communities/${cid}/channels/order`, { channels: [a.id] })).status, 403);
  // unread
  await U.req("POST", `/api/communities/${cid}/channels/${a.id}/read`);
  await post(V, { text: "رسالة جديدة لم تُقرأ", channel: a.id });
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).channels.find(x => x.id === a.id).unread, 1);
  await U.req("POST", `/api/communities/${cid}/channels/${a.id}/read`);
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).channels.find(x => x.id === a.id).unread, 0);
  // allowed types: a poll in a pictures-only channel is refused, plain text passes
  const poll = await post(U, { text: "ما رأيكم؟", channel: b.id, poll: { options: ["نعم", "لا"] } }); assert.equal(poll.status, 400); assert.match(poll.error || JSON.stringify(poll), /الاستطلاعات/);
  assert.equal((await post(U, { text: "نص عادي مسموح دائماً", channel: b.id })).status, 200);
  // community-level types
  await O.req("PATCH", `/api/communities/${cid}/settings/content`, { contentTypes: ["image", "poll"] });
  assert.deepEqual((await U.req("GET", `/api/communities/${cid}/space`)).contentTypes, ["image", "poll"]);
  assert.equal((await post(U, { type: "question", title: "سؤال في مجتمع لا يقبل الأسئلة", text: "تفاصيل" })).status, 400);
  await O.req("PATCH", `/api/communities/${cid}/settings/content`, { contentTypes: [] });
  assert.equal((await post(U, { type: "question", title: "سؤال بعد السماح بكل الأنواع", text: "تفاصيل" })).status, 200);
  // approval per channel
  const rv = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "بمراجعة", viewPerm: "public", requireApproval: true })).channel;
  assert.equal((await post(U, { text: "ينتظر المراجعة", channel: rv.id })).post.status, "pending");
  assert.equal((await post(MO, { text: "المشرف لا ينتظر", channel: rv.id })).post.status, "published");
  // default channel: one at a time
  await O.req("PATCH", `/api/communities/${cid}/channels/${a.id}`, { isDefault: true }); await O.req("PATCH", `/api/communities/${cid}/channels/${b.id}`, { isDefault: true });
  const sp = await U.req("GET", `/api/communities/${cid}/space`); assert.deepEqual(sp.channels.filter(x => x.isDefault).map(x => x.id), [b.id]);
  // deleting a category keeps its channels
  await O.req("DELETE", `/api/communities/${cid}/channel-groups/${g.id}`);
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).channels.find(x => x.id === a.id).group, null);
});

test("pins: 5 per community, 3 per channel, no duplicates, team only, expiry", async () => {
  const ch = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "مثبتات", viewPerm: "public" })).channel;
  const ps = []; for (let i = 0; i < 10; i++) { H.app.ctx.rl.w?.clear?.(); const r = await post(MO, { text: `منشور للتثبيت رقم ${i} ${Math.random()}`, channel: ch.id }); assert.ok(r.post, JSON.stringify(r)); ps.push(r.post); }
  assert.equal((await U.req("POST", `/api/communities/${cid}/pins`, { post: ps[0].id })).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[i].id })).status, 200);
  const six = await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[5].id }); assert.equal(six.status, 400); assert.match(six.error || JSON.stringify(six), /5/);
  assert.equal((await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[0].id })).status, 409);
  for (let i = 5; i < 8; i++) assert.equal((await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[i].id, scope: "channel" })).status, 200);
  assert.equal((await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[8].id, scope: "channel" })).status, 400, "3 per channel");
  const sp = await new H.Client().req("GET", `/api/communities/${cid}/space`); assert.equal(sp.pins.length, 8); assert.equal(sp.pins.filter(p => !p.channel).length, 5);
  await db().run("UPDATE community_pins SET until=$1 WHERE post=$2", [new Date(Date.now() - 1000).toISOString(), ps[0].id]);
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).pins.length, 7, "an expired pin is gone");
  assert.equal((await MO.req("POST", `/api/communities/${cid}/pins`, { post: ps[9].id, days: 7 })).pin.until !== null, true, "the freed slot is usable again, with an expiry");
  const one = (await U.req("GET", `/api/communities/${cid}/pins`)).pins[0]; assert.equal((await MO.req("DELETE", `/api/communities/${cid}/pins/${one.id}`)).status, 200);
  assert.equal((await O.req("PUT", `/api/communities/${cid}/pins/order`, { ids: [] })).status, 200);
});

test("announcements: schedule and expiry, dismissal per member, non-dismissible, one notified announcement a day", async () => {
  assert.equal((await U.req("POST", `/api/communities/${cid}/announcements`, { title: "ليس لك" })).status, 403);
  const live = (await MO.req("POST", `/api/communities/${cid}/announcements`, { title: "لقاء الخميس", body: "الساعة التاسعة مساءً", endsAt: new Date(Date.now() + 3600e3).toISOString() })).announcement;
  assert.equal(live.status, "live");
  await MO.req("POST", `/api/communities/${cid}/announcements`, { title: "إعلان قادم", startsAt: new Date(Date.now() + 864e5).toISOString() });
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).announcement?.id, live.id, "the scheduled one is not shown yet");
  await U.req("POST", `/api/communities/${cid}/announcements/${live.id}/dismiss`);
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).announcement, null, "dismissed for this member");
  assert.equal((await V.req("GET", `/api/communities/${cid}/space`)).announcement?.id, live.id, "but not for the others");
  await db().run("UPDATE community_announcements SET ends_at=$1 WHERE id=$2", [new Date(Date.now() - 1000).toISOString(), live.id]);
  assert.equal((await V.req("GET", `/api/communities/${cid}/space`)).announcement, null, "an expired announcement disappears");
  assert.equal((await MO.req("POST", `/api/communities/${cid}/announcements`, { title: "خطأ", startsAt: new Date(Date.now() + 7200e3).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString() })).status, 400);
  const imp = await O.req("POST", `/api/communities/${cid}/announcements`, { title: "تحديث مهم للقواعد", level: "important", dismissible: false, notify: true });
  assert.equal(imp.announcement.level, "important"); assert.ok(imp.notified >= 3);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='community_announcement' AND ref=$2", [U.id, cid]));
  assert.equal((await U.req("POST", `/api/communities/${cid}/announcements/${imp.announcement.id}/dismiss`)).status, 400, "a non-dismissible announcement stays");
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).announcement.id, imp.announcement.id);
  const again = await O.req("POST", `/api/communities/${cid}/announcements`, { title: "مهم ثانٍ في اليوم نفسه", level: "important", notify: true }); assert.equal(again.notified, 0); assert.equal(again.notifySkipped, true);
  const list = (await MO.req("GET", `/api/communities/${cid}/announcements`)).announcements; assert.ok(list.some(a => a.status === "scheduled") && list.some(a => a.status === "ended"));
  assert.equal((await MO.req("DELETE", `/api/communities/${cid}/announcements/${again.announcement.id}`)).status, 200);
});

test("rules: seeded from the legacy list, structured edits mirror to communities.rules, legacy edits mirror back (bodies kept)", async () => {
  let r = await U.req("GET", `/api/communities/${cid}/rules`); assert.deepEqual(r.rules.map(x => x.title), ["الاحترام", "لا إعلانات"]);
  assert.equal((await MO.req("PUT", `/api/communities/${cid}/rules`, { rules: [] })).status, 403, "rules are the owner's");
  const put = await O.req("PUT", `/api/communities/${cid}/rules`, { rules: [{ id: r.rules[0].id, title: "الاحترام", body: "لا إساءة ولا سخرية", severity: "serious" }, { title: "ابقَ في الموضوع", severity: "warn" }, { title: "لا إعلانات", id: r.rules[1].id }], required: true });
  assert.deepEqual(put.mirror, ["الاحترام", "ابقَ في الموضوع", "لا إعلانات"]); assert.equal(put.required, true);
  const pub = (await new H.Client().req("GET", "/api/communities")).communities.find(c => c.id === cid); assert.deepEqual(pub.rules, ["الاحترام", "ابقَ في الموضوع", "لا إعلانات"], "the mirror is what every legacy reader sees");
  await O.req("PATCH", `/api/communities/${cid}`, { rules: ["الاحترام", "لا إعلانات", "قاعدة من المحرر القديم"] });
  r = await U.req("GET", `/api/communities/${cid}/rules`);
  assert.deepEqual(r.rules.map(x => x.title), ["الاحترام", "لا إعلانات", "قاعدة من المحرر القديم"], "titles follow the legacy editor");
  assert.equal(r.rules[0].body, "لا إساءة ولا سخرية"); assert.equal(r.rules[0].severity, "serious", "an unchanged rule keeps its body and severity");
  const row = await db().get("SELECT rules FROM communities WHERE id=$1", [cid]); assert.deepEqual(row.rules, r.rules.map(x => x.title), "mirror identical");
  await O.req("PUT", `/api/communities/${cid}/rules`, { rules: [{ title: "الاحترام" }, { title: "لا إعلانات" }], required: false });
});

test("welcome steps on the server: import from localStorage once, toggle, auto steps, team stats", async () => {
  await O.req("PATCH", `/api/communities/${cid}/identity`, { welcome: { message: "أهلاً بك بيننا", steps: ["اقرأ القواعد", "اكتب أول منشور", "تابع قناة الإعلانات"] } });
  const W = await mk("ch_new"); await W.req("PUT", `/api/communities/${cid}/membership`);
  assert.equal((await X.req("GET", `/api/communities/${cid}/onboarding`)).status, 403);
  let o = (await W.req("GET", `/api/communities/${cid}/onboarding`)).onboarding; assert.equal(o.total, 3); assert.equal(o.done, 0); assert.equal(o.steps[1].auto, "post");
  const imp = await W.req("POST", `/api/communities/${cid}/onboarding/import`, { done: [0, 2, 9, "x"] }); assert.equal(imp.imported, 2); assert.equal(imp.onboarding.done, 2);
  assert.equal((await W.req("POST", `/api/communities/${cid}/onboarding/import`, { done: [0, 2] })).imported, 0, "idempotent");
  o = (await W.req("PUT", `/api/communities/${cid}/onboarding/2`, { done: false })).onboarding; assert.equal(o.steps[2].done, false);
  await post(W, { text: "مرحباً أنا عضو جديد هنا" });
  o = (await W.req("GET", `/api/communities/${cid}/onboarding`)).onboarding; assert.equal(o.steps[1].done, true, "writing a post completes the post step");
  const sp = await W.req("GET", `/api/communities/${cid}/space`); assert.equal(sp.onboarding.total, 3); assert.equal(sp.onboarding.message, "أهلاً بك بيننا");
  assert.equal((await U.req("GET", `/api/communities/${cid}/onboarding/stats`)).status, 403);
  const st = await MO.req("GET", `/api/communities/${cid}/onboarding/stats`); assert.ok(st.newMembers >= 1 && st.started >= 1); assert.equal(st.perStep.length, 3);
  assert.equal((await W.req("PUT", `/api/communities/${cid}/onboarding/7`, {})).status, 400);
});

test("members filter «new» and knowledge sections", async () => {
  const m = await U.req("GET", `/api/communities/${cid}/members?role=new`); assert.ok(m.members.length >= 4);
  const q = await U.req("GET", `/api/communities/${cid}/members?q=ch_own`); assert.deepEqual(q.members.map(x => x.user.handle), ["ch_own"], "an underscore in a handle is matched literally");
  assert.equal((await U.req("GET", `/api/communities/${cid}/members?q=ch%25own`)).members.length, 0, "% is not a wildcard");
  await O.req("PUT", `/api/communities/${cid}/wiki/start`, { title: "البداية", body: "مرحباً" });
  assert.equal((await U.req("PATCH", `/api/communities/${cid}/wiki/start/section`, { section: "أساسيات" })).status, 403);
  assert.equal((await MO.req("PATCH", `/api/communities/${cid}/wiki/start/section`, { section: "أساسيات" })).status, 200);
  assert.equal((await U.req("GET", `/api/communities/${cid}/wiki`)).pages.find(p => p.slug === "start").section, "أساسيات");
  assert.ok((await MO.req("GET", `/api/communities/${cid}/wiki-recent`)).edits.length >= 1);
});

test("migration 064: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '064_channels_content' ORDER BY id")).map(r => r.id);
  const ch = Number((await db().get("SELECT COUNT(*) n FROM community_channels")).n), wk = Number((await db().get("SELECT COUNT(*) n FROM wiki_pages")).n);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "064_channels_content"]);
  await assert.rejects(() => db().get("SELECT 1 FROM community_pins"));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM community_channels")).n), ch, "no channel lost");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM wiki_pages")).n), wk, "no page lost");
  assert.ok((await db().get("SELECT rules FROM communities WHERE id=$1", [cid])).rules.length, "communities.rules (the mirror) survives the rollback");
  assert.deepEqual(await mig.up(db()), ["064_channels_content", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("064")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "064_channels_content.js"));
});
