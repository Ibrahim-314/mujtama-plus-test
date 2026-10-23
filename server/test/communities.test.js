/* Track 4 — communities: channels & permissions, rules & join questions, tags, welcome, page data;
 * moderation (automod, queue, discipline, notes, log/CSV, digest); knowledge (wiki revisions & diff,
 * FAQ, Q&A duplicates, resources, scoped search); events (tickets, waitlist, QR check-in, reminders,
 * recurrence, iCal); growth (invites, partners, challenges, health, suggestions, directory, SSR). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H, O, M, U, X, cid, uid, xid;
const mk = async (handle) => { const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
test.before(async () => {
  H = await boot(); O = await mk("owner_c"); M = await mk("mod_c"); U = await mk("user_c"); X = await mk("user_x"); uid = U.id; xid = X.id;
  cid = (await O.req("POST", "/api/communities", { name: "مطوري Pi العرب", desc: "مجتمع للمطورين", topic: "dev", rules: ["الاحترام", "لا إعلانات"] })).community.id;
  await M.req("PUT", `/api/communities/${cid}/membership`); await O.req("PATCH", `/api/communities/${cid}/members/${M.id}`, { role: "moderator" });
});
test.after(() => H.app.close());

test("identity, tags, rules acceptance, welcome and channel permissions", async () => {
  const idn = await O.req("PATCH", `/api/communities/${cid}/identity`, { icon: "🛠️", accent: "#0f766e", category: "dev", rulesRequired: true, tags: [{ name: "سؤال", color: "#2563eb" }, { name: "مشروع" }], welcome: { message: "أهلاً بك!", steps: ["عرّف بنفسك", "اقرأ الويكي"] } });
  assert.equal(idn.identity.icon, "🛠️"); assert.equal(idn.identity.tags.length, 2);
  assert.equal((await U.req("PATCH", `/api/communities/${cid}/identity`, { icon: "x" })).status, 403);
  const ann = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "الإعلانات", kind: "announcements" })).channel; assert.equal(ann.postPerm, "mods");
  const gen = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "نقاش عام" })).channel; assert.equal(gen.viewPerm, "public");
  const secret = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "خاص بالأعضاء", viewPerm: "members" })).channel;
  assert.equal((await U.req("POST", `/api/communities/${cid}/join`, {})).status, 400, "rules must be accepted");
  const j = await U.req("POST", `/api/communities/${cid}/join`, { acceptRules: true }); assert.equal(j.role, "member"); assert.equal(j.welcome.message, "أهلاً بك!");
  assert.equal((await U.req("POST", "/api/posts", { text: "إعلان مهم", community: cid, channel: ann.id })).status, 403);
  const p = await U.req("POST", "/api/posts", { text: "سؤال عن الـSDK", community: cid, channel: gen.id, ctag: "سؤال" }); assert.equal(p.status, 200, p.error); assert.equal(p.post.channel, gen.id); assert.equal(p.post.ctag, "سؤال");
  const hidden = (await U.req("POST", "/api/posts", { text: "منشور للأعضاء فقط", community: cid, channel: secret.id })).post;
  assert.equal((await U.req("POST", "/api/posts", { text: "وسم وهمي", community: cid, ctag: "غير-موجود" })).status, 400);
  const outsider = await mk("outsider_c");
  const vis = await outsider.req("GET", `/api/communities/${cid}/posts`); assert.ok(vis.posts.some(x => x.id === p.post.id)); assert.ok(!vis.posts.some(x => x.id === hidden.id), "members-only channel hidden");
  assert.equal((await outsider.req("GET", `/api/communities/${cid}/posts?channel=${gen.id}`)).posts.length, 1);
  const sp = await U.req("GET", `/api/communities/${cid}/space`); assert.equal(sp.channels.length, 3); assert.equal(sp.role, "member"); assert.ok(sp.onboarding.steps.length); assert.equal(sp.moderators[0].role, "owner");
  assert.equal((await outsider.req("GET", `/api/communities/${cid}/space`)).channels.length, 2);
  const notes = (await U.req("GET", "/api/bootstrap")).notifications || []; assert.ok(notes.some(n => n.kind === "community_welcome"));
});

test("private community: join questions are answered and reviewed in the unified queue", async () => {
  const pc = (await O.req("POST", "/api/communities", { name: "نادي المستثمرين", type: "private" })).community.id;
  await O.req("PATCH", `/api/communities/${pc}/identity`, { joinQuestions: ["ما خبرتك؟", "لماذا تنضم؟"] });
  assert.equal((await X.req("POST", `/api/communities/${pc}/join`, { answers: ["خمس سنوات"] })).status, 400);
  assert.equal((await X.req("POST", `/api/communities/${pc}/join`, { answers: ["خمس سنوات", "للتعلم"] })).role, "pending");
  const q = await O.req("GET", `/api/communities/${pc}/modqueue`); const item = q.items.find(i => i.kind === "join"); assert.equal(item.answers[1].a, "للتعلم");
  await O.req("POST", `/api/communities/${pc}/modqueue/act`, { kind: "join", id: xid, action: "approve" });
  assert.equal((await X.req("GET", `/api/communities/${pc}/space`)).role, "member");
});

test("automod: words, links, new accounts, abusive content → queue or reject", async () => {
  await O.req("PATCH", `/api/communities/${cid}/automod`, { words: ["كازينو"], blockLinks: true, toxicity: "reject" });
  const a = await U.req("POST", "/api/posts", { text: "أفضل كازينو أونلاين", community: cid }); assert.equal(a.post.status, "pending");
  const b = await U.req("POST", "/api/posts", { text: "شوفوا https://spam.example", community: cid }); assert.equal(b.post.status, "pending");
  const c = await U.req("POST", "/api/posts", { text: "راح اقتلك يا غبي", community: cid }); assert.equal(c.status, 400); assert.match(c.error, /القواعد الآلية/);
  const m = await M.req("POST", "/api/posts", { text: "رابط رسمي https://minepi.com", community: cid }); assert.equal(m.post.status, "published", "moderators are exempt");
  const q = await M.req("GET", `/api/communities/${cid}/modqueue`); const it = q.items.find(i => i.id === a.post.id); assert.match(it.reason, /كلمات محظورة/);
  await M.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: a.post.id, action: "reject", reason: "قمار" });
  await M.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: b.post.id, action: "approve" });
  await O.req("PATCH", `/api/communities/${cid}/automod`, { words: [], blockLinks: false, toxicity: "queue" });
});

test("abusive comments become reports; remove; warn, timed mute (auto-expires), ban; notes; log & CSV", async () => {
  const p = (await M.req("POST", "/api/posts", { text: "ما رأيكم في التحديث؟", community: cid })).post;
  const cm = await U.req("POST", "/api/comments", { post: p.id, text: "انت غبي وحمار" }); await new Promise(r => setTimeout(r, 150));
  const q = await M.req("GET", `/api/communities/${cid}/modqueue`); const rep = q.items.find(i => i.kind === "report" && i.target === cm.comment.id); assert.ok(rep && rep.auto && rep.toxicity >= 0.6);
  await M.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "report", id: rep.id, action: "remove", reason: "إساءة" });
  let d = await M.req("POST", `/api/communities/${cid}/members/${uid}/discipline`, { action: "warn", reason: "إساءة لفظية" }); assert.equal(d.member.warnings, 1);
  d = await M.req("POST", `/api/communities/${cid}/members/${uid}/discipline`, { action: "mute", hours: 2, reason: "تكرار" }); assert.equal(d.member.role, "muted");
  assert.equal((await U.req("POST", "/api/posts", { text: "هل أستطيع النشر؟", community: cid })).status, 403);
  await H.app.ctx.db.run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 1000).toISOString(), cid, uid]);
  assert.equal(await H.app.ctx.services.cmod.unmuteDue(), 1);
  assert.equal((await M.req("POST", `/api/communities/${cid}/members/${O.id}/discipline`, { action: "ban" })).status, 403, "cannot discipline the owner");
  await M.req("POST", `/api/communities/${cid}/members/${uid}/notes`, { text: "تحسّن سلوكه بعد الإنذار" });
  const n = await M.req("GET", `/api/communities/${cid}/members/${uid}/notes`); assert.equal(n.notes.length, 1); assert.ok(n.history.some(h => h.action === "mute")); assert.equal(n.member.warnings, 1);
  assert.equal((await U.req("GET", `/api/communities/${cid}/members/${uid}/notes`)).status, 403, "notes are private to moderators");
  const log = await M.req("GET", `/api/communities/${cid}/modlog`); assert.ok(log.log.some(l => l.action === "remove")); assert.ok(log.log.some(l => l.action === "automod_queue"));
  const buf = Buffer.from(await (await fetch(`${H.base}/api/communities/${cid}/modlog?format=csv`, { headers: { Cookie: M.cookie } })).arrayBuffer());
  assert.equal(buf.slice(0, 3).toString("hex"), "efbbbf", "UTF-8 BOM so Excel shows Arabic"); const csv = buf.toString("utf8"); assert.match(csv, /time,action/); assert.match(csv, /إنذار/);
  assert.equal((await U.req("GET", `/api/communities/${cid}/modlog`)).status, 403);
  await O.req("PATCH", `/api/communities/${cid}/automod`, { publicLog: true }); const pub = await U.req("GET", `/api/communities/${cid}/modlog`); assert.equal(pub.status, 200); assert.ok(pub.log.every(l => l.actor === "مشرف" || l.actor === "النظام"));
  await U.req("POST", "/api/posts", { text: "منشور ينتظر", community: cid, markdown: undefined }).then(() => { });
  await H.app.ctx.services.cmod.digest(); await H.app.ctx.services.cmod.digest();
});

test("wiki: create, edit with conflict detection, history, diff, revert, lock; FAQ", async () => {
  const w = await U.req("PUT", `/api/communities/${cid}/wiki/new`, { title: "البداية مع Pi SDK", body: "# التثبيت\n\nشغّل الأمر.\n\n# الإعداد\n\nأضف المفتاح." }); assert.equal(w.page.version, 1); const slug = w.page.slug;
  const e2 = await M.req("PUT", `/api/communities/${cid}/wiki/${slug}`, { title: w.page.title, body: "# التثبيت\n\nشغّل الأمر npm.\n\n# الإعداد\n\nأضف المفتاح.\n\n# الاختبار", baseVersion: 1, summary: "إضافة الاختبار" }); assert.equal(e2.page.version, 2);
  const stale = await U.req("PUT", `/api/communities/${cid}/wiki/${slug}`, { title: w.page.title, body: "قديم", baseVersion: 1 }); assert.equal(stale.status, 409); assert.equal(stale.current.version, 2);
  const h = await U.req("GET", `/api/communities/${cid}/wiki/${slug}/history`); assert.equal(h.revisions.length, 2); assert.equal(h.revisions[0].summary, "إضافة الاختبار");
  const d = await U.req("GET", `/api/communities/${cid}/wiki/${slug}/diff?from=1&to=2`); assert.ok(d.added >= 2); assert.ok(d.lines.some(l => l.op === "-" && l.text === "شغّل الأمر."));
  assert.equal((await U.req("POST", `/api/communities/${cid}/wiki/${slug}/revert`, { version: 1 })).status, 403);
  const rv = await M.req("POST", `/api/communities/${cid}/wiki/${slug}/revert`, { version: 1 }); assert.equal(rv.page.version, 3); assert.ok(!rv.page.body.includes("الاختبار"));
  await M.req("PATCH", `/api/communities/${cid}/wiki/${slug}`, { locked: true });
  assert.equal((await U.req("PUT", `/api/communities/${cid}/wiki/${slug}`, { title: "x", body: "y", baseVersion: 3 })).status, 403);
  const page = await X.req("GET", `/api/communities/${cid}/wiki/${slug}`); assert.ok(page.page.toc.length >= 2); assert.match(page.page.html, /<h2/);
  assert.equal((await U.req("PUT", `/api/communities/${cid}/wiki/new`, { title: "كيف أحصل على مفتاح API؟", body: "من لوحة المطورين", kind: "faq" })).status, 403);
  await M.req("PUT", `/api/communities/${cid}/wiki/new`, { title: "كيف أحصل على مفتاح API للتطبيق؟", body: "من لوحة المطورين في متصفح Pi.", kind: "faq" });
  assert.equal((await X.req("GET", `/api/communities/${cid}/faq`)).faq.length, 1);
});

test("Q&A: duplicate detection suggests earlier answers; resources; community-only search", async () => {
  H.app.ctx.rl.w.clear();
  await U.req("POST", `/api/communities/${cid}/rules/accept`);
  const q = (await U.req("POST", "/api/posts", { type: "question", title: "كيف أربط محفظة Pi بالتطبيق؟", text: "أحاول ربط محفظة Pi بتطبيقي ولا أعرف الخطوات", community: cid })).post;
  const a = (await M.req("POST", "/api/comments", { post: q.id, text: "استخدم Pi.authenticate ثم createPayment" })).comment;
  await U.req("POST", `/api/posts/${q.id}/accept`, { comment: a.id });
  const sim = await X.req("POST", `/api/communities/${cid}/similar`, { text: "طريقة ربط محفظة Pi مع تطبيقي" });
  assert.equal(sim.similar[0].id, q.id); assert.match(sim.similar[0].answer, /authenticate/);
  const faqHit = await X.req("POST", `/api/communities/${cid}/similar`, { text: "من أين أحصل على مفتاح API" }); assert.equal(faqHit.similar[0].kind, "faq");
  assert.equal((await X.req("GET", `/api/communities/${cid}/questions?filter=answered`)).questions[0].id, q.id);
  const r = await U.req("POST", `/api/communities/${cid}/resources`, { title: "توثيق Pi SDK", url: "https://github.com/pi-apps/pi-platform-docs", category: "توثيق" }); assert.equal(r.status, 200);
  assert.equal((await U.req("POST", `/api/communities/${cid}/resources`, { title: "مكرر", url: "https://github.com/pi-apps/pi-platform-docs", category: "x" })).status, 409);
  await M.req("PUT", `/api/communities/${cid}/resources/${r.resource.id}/vote`); await M.req("PUT", `/api/communities/${cid}/resources/${r.resource.id}/vote`);
  const lib = await M.req("GET", `/api/communities/${cid}/resources`); assert.equal(lib.resources[0].votes, 1); assert.equal(lib.resources[0].voted, true); assert.equal(lib.resources[0].host, "github.com");
  const s = await X.req("GET", `/api/communities/${cid}/search?q=محفظة`); assert.ok(s.posts.some(p => p.id === q.id));
  assert.ok((await X.req("GET", `/api/communities/${cid}/search?q=SDK`)).pages.length >= 1);
  await X.req("POST", "/api/posts", { text: "محفظة خارج المجتمع" }); assert.ok(!(await X.req("GET", `/api/communities/${cid}/search?q=خارج المجتمع`)).posts.length);
});

test("events: capacity, waitlist promotion, QR check-in, reminders 24h/1h once, recurrence, iCal feeds", async () => {
  const starts = new Date(Date.now() + 20 * 3600e3);
  const ev = (await O.req("POST", "/api/events/plus", { name: "لقاء مطوري جدة", startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 2 * 3600e3).toISOString(), place: "جدة", address: "حي الشاطئ، جدة", lat: 21.5433, lng: 39.1728, capacity: 1, recurrence: "weekly", community: cid })).event;
  assert.equal(ev.capacity, 1); assert.equal(ev.recurrence, "weekly"); assert.equal(ev.tickets.remaining, 1);
  const t1 = (await U.req("POST", `/api/events/${ev.id}/tickets`)).event; assert.equal(t1.myTicket.status, "confirmed");
  const t2 = (await X.req("POST", `/api/events/${ev.id}/tickets`)).event; assert.equal(t2.myTicket.status, "waitlist"); assert.equal(t2.myTicket.position, 1);
  assert.equal((await U.req("GET", `/api/events/${ev.id}/attendees`)).status, 403);
  const cancel = await U.req("DELETE", `/api/events/${ev.id}/tickets`); assert.equal(cancel.promoted, true);
  const x = (await X.req("GET", `/api/events/${ev.id}/details`)).event; assert.equal(x.myTicket.status, "confirmed");
  assert.equal((await O.req("POST", `/api/events/${ev.id}/checkin`, { code: "MPT:e_other0000:" + x.myTicket.code })).status, 400);
  const ci = await O.req("POST", `/api/events/${ev.id}/checkin`, { code: `MPT:${ev.id}:${x.myTicket.code}` }); assert.equal(ci.already, false); assert.equal(ci.attendee.handle, "user_x");
  assert.equal((await O.req("POST", `/api/events/${ev.id}/checkin`, { code: x.myTicket.code })).already, true);
  assert.equal((await O.req("POST", `/api/events/${ev.id}/checkin`, { code: "ZZZZZZZZ" })).status, 404);
  const sent1 = await H.app.ctx.services.eventsPlus.reminders(); const sent2 = await H.app.ctx.services.eventsPlus.reminders();
  assert.ok(sent1 >= 1); assert.equal(sent2, 0, "reminders are sent once");
  await H.app.ctx.db.run("UPDATE events SET starts_at=$1, ends_at=$2 WHERE id=$3", [new Date(Date.now() + 30 * 60e3).toISOString(), new Date(Date.now() + 90 * 60e3).toISOString(), ev.id]);
  assert.ok(await H.app.ctx.services.eventsPlus.reminders() >= 1, "1h reminder");
  await H.app.ctx.db.run("UPDATE events SET starts_at=$1, ends_at=$2 WHERE id=$3", [new Date(Date.now() - 5 * 3600e3).toISOString(), new Date(Date.now() - 4 * 3600e3).toISOString(), ev.id]);
  const tick = await H.app.ctx.services.eventsPlus.tick(); assert.equal(tick.made, 1);
  const next = await H.app.ctx.db.get("SELECT * FROM events WHERE series_id=$1 AND id<>$1", [ev.id]); assert.ok(new Date(next.starts_at) > new Date()); assert.equal(next.capacity, 1);
  assert.equal((await H.app.ctx.services.eventsPlus.tick()).made, 0, "next occurrence created once");
  const ics = await (await fetch(`${H.base}/e/${next.id}.ics`)).text();
  assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /RRULE:FREQ=WEEKLY/); assert.match(ics, /GEO:21.5433;39.1728/); assert.match(ics, /TRIGGER:-PT1H/);
  const feed = await X.req("GET", "/api/me/calendar"); const f = await (await fetch(H.base + feed.url)).text(); assert.match(f, /X-WR-CALNAME/);
  assert.equal((await fetch(H.base + feed.url.replace(/\.[a-f0-9]{32}\./, "." + "0".repeat(32) + "."))).status, 404);
});

test("growth: invite links with stats, partners, challenges, health, metrics job, suggestions, directory, SSR", async () => {
  H.app.ctx.rl.w.clear();
  const inv = (await M.req("POST", `/api/communities/${cid}/invites`, { label: "تويتر", maxUses: 10 })).invite;
  const v = await new H.Client().req("GET", "/api/invites/" + inv.code); assert.equal(v.invite.community.name, "مطوري Pi العرب");
  const newbie = await mk("invited_c"); await newbie.req("POST", `/api/communities/${cid}/join`, { acceptRules: true, invite: inv.code });
  await newbie.req("POST", "/api/posts", { text: "شكراً على الدعوة", community: cid });
  const stats = (await M.req("GET", `/api/communities/${cid}/invites`)).invites.find(i => i.code === inv.code); assert.equal(stats.joins, 1); assert.equal(stats.active, 1); assert.ok(stats.clicks >= 1);
  const html = await (await fetch(`${H.base}/j/${inv.code}`)).text(); assert.match(html, /og:title/); assert.match(html, /انضم الآن/);
  assert.match(await (await fetch(`${H.base}/c/${cid}`)).text(), /<title>مطوري Pi العرب/);
  const other = (await X.req("POST", "/api/communities", { name: "مصممو الواجهات", topic: "design" })).community.id;
  assert.equal((await O.req("POST", `/api/communities/${cid}/partners`, { community: other })).status, "pending");
  assert.equal((await X.req("POST", `/api/communities/${other}/partners`, { community: cid })).status, "accepted");
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).partners[0].id, other);
  const ch = (await M.req("POST", `/api/communities/${cid}/challenges`, { title: "تحدي أول تطبيق", tag: "تحدي_التطبيق", endsAt: new Date(Date.now() + 864e5).toISOString(), prize: "شارة ذهبية" })).challenge;
  const entry = (await newbie.req("POST", "/api/posts", { text: "مشاركتي في #تحدي_التطبيق: تطبيق محفظة", community: cid })).post;
  await M.req("PUT", "/api/reactions/" + entry.id, { type: "like" });
  const list = await U.req("GET", `/api/communities/${cid}/challenges`); assert.equal(list.challenges[0].leaderboard[0].post, entry.id); assert.equal(list.challenges[0].status, "live");
  await new Promise(r => setTimeout(r, 5)); await H.app.ctx.db.run("UPDATE community_challenges SET ends_at=$1 WHERE id=$2", [new Date().toISOString(), ch.id]); await new Promise(r => setTimeout(r, 5));
  await H.app.ctx.services.cspace.closeChallenges(); assert.equal((await U.req("GET", `/api/communities/${cid}/challenges`)).challenges[0].winners[0].post, entry.id);
  await H.app.ctx.services.cspace.computeMetrics();
  const day = await H.app.ctx.db.get("SELECT * FROM community_metrics WHERE community=$1", [cid]); assert.ok(day.posts >= 3 && day.active_users >= 3);
  const h = await O.req("GET", `/api/communities/${cid}/health`); assert.ok(h.score >= 0 && h.score <= 100); assert.ok(h.tips.length); assert.ok(h.series.length >= 1);
  assert.equal((await M.req("GET", `/api/communities/${cid}/health`)).status, 403);
  await newbie.req("PUT", "/api/follows/" + xid);
  const sug = await newbie.req("GET", "/api/communities/suggested"); assert.ok(sug.suggestions.some(s => s.id === other && s.reasons.some(r => r.includes("تتابعهم"))));
  const dir = await new H.Client().req("GET", "/api/communities/directory?category=dev"); assert.ok(dir.communities.some(c => c.id === cid)); assert.ok(dir.categories.some(c => c.slug === "dev"));
  assert.equal((await new H.Client().req("GET", "/api/communities/directory?q=مصممو")).communities[0].id, other);
});

test("scheduler leases: a job runs on one holder at a time", async () => {
  const S2 = require("../lib/scheduler").createScheduler(H.app.ctx.db, { log: { error() { } } }); let n = 0;
  const slow = () => new Promise(r => setTimeout(() => { n++; r(); }, 150));
  const [a, b] = await Promise.all([H.app.ctx.scheduler.runOnce("lease_test", slow, 5000), S2.runOnce("lease_test", slow, 5000)]);
  assert.equal(n, 1); assert.ok(a.skipped || b.skipped);
});
