/* Track 7 — phase 33 user protection: blocks that cover linked accounts (org control + accounts signed in
 * together), legacy prefs path reconciliation, timed/scoped Arabic-aware mutes and notification suppression,
 * protection mode (manual limits, trusted = followed-before-start, wave suggestion, auto mode), per-post reply
 * audience, hidden replies, help center resources with admin-filled placeholders, versioned content policies,
 * per-post safety summary and the 3-step report on top of safety.report(). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, ADMIN, A, B, C, D, E, F, G;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => H.app.ctx.db;
const P = () => H.app.ctx.services.protection;
const mk = async (handle, name) => { H.app.ctx.rl.w.clear(); const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c; };
const post = async (c, body) => { const r = await c.req("POST", "/api/posts", typeof body === "string" ? { text: body } : body); assert.equal(r.status, 200, r.error); return r.post; };
const notifs = async (uid, kind) => db().all("SELECT * FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind]);
async function until(fn, ms = 3000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(30); } }

test.before(async () => {
  H = await boot();
  // the integrator registers the service in server.js (INTEGRATION.md); tests attach it to the booted app
  if (!H.app.ctx.services.protection) H.app.ctx.services.protection = require("../services/protection")(H.app.ctx);
  ADMIN = await mk("p33_admin", "المشرف");
  A = await mk("p33_amal", "أمل"); B = await mk("p33_badr", "بدر"); C = await mk("p33_jood", "جود"); D = await mk("p33_dana", "دانة");
  E = await mk("p33_eyad", "إياد"); F = await mk("p33_fahd", "فهد"); G = await mk("p33_ghada", "غادة");
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("block covers linked accounts: orgs the person controls, preview names orgs only, unblock restores", async () => {
  const org = await A.req("POST", "/api/orgs", { name: "مؤسسة أمل", handle: "p33_amal_org" }); assert.equal(org.status, 200, org.error);
  const O = org.org.id;
  const pv = await B.req("GET", `/api/protection/blocks/${A.id}/preview`);
  assert.equal(pv.linked, 1); assert.equal(pv.orgs[0].handle, "p33_amal_org"); assert.equal(pv.hidden, 0);
  const bp = await post(B, "منشور بدر العام");
  await A.req("PUT", `/api/follows/${B.id}`, null, { "X-Act-As": O }); // the org follows B before the block
  const r = await B.req("PUT", `/api/protection/blocks/${A.id}`, {}); assert.equal(r.status, 200, r.error); assert.equal(r.linkedBlocked, 1);
  const me = await B.req("GET", "/api/me");
  assert.deepEqual(me.prefs.blocked, [A.id]); assert.deepEqual(me.prefs.blockedLinked, [O]);
  assert.ok(!(await db().get("SELECT 1 x FROM follows WHERE src=$1 AND dst=$2", [O, B.id])), "linked follow severed");
  // acting as the org: B's post is invisible, following / commenting is refused
  assert.equal((await A.req("GET", `/api/posts/${bp.id}`, null, { "X-Act-As": O })).status, 404);
  assert.equal((await A.req("PUT", `/api/follows/${B.id}`, null, { "X-Act-As": O })).status, 403);
  const list = await B.req("GET", "/api/protection/blocks");
  assert.equal(list.blocks.length, 1); assert.equal(list.blocks[0].id, A.id); assert.equal(list.blocks[0].linkedBlocked, 1); assert.equal(list.linkedTotal, 1);
  // blocking the org instead reaches its owner
  const r2 = await C.req("PUT", `/api/protection/blocks/${O}`, {}); assert.equal(r2.linkedBlocked, 1);
  assert.deepEqual((await C.req("GET", "/api/me")).prefs.blockedLinked, [A.id]);
  // opt out of linked blocking for one block
  await C.req("DELETE", `/api/protection/blocks/${O}`);
  const r3 = await C.req("PUT", `/api/protection/blocks/${O}`, { linked: false }); assert.equal(r3.linkedBlocked, 0);
  assert.deepEqual((await C.req("GET", "/api/me")).prefs.blockedLinked, []);
  await C.req("DELETE", `/api/protection/blocks/${O}`);
  // unblock restores
  assert.equal((await B.req("DELETE", `/api/protection/blocks/${A.id}`)).ok, true);
  const me2 = await B.req("GET", "/api/me"); assert.deepEqual(me2.prefs.blocked, []); assert.deepEqual(me2.prefs.blockedLinked, []);
  assert.equal((await A.req("GET", `/api/posts/${bp.id}`, null, { "X-Act-As": O })).status, 200);
  // never blocks yourself or an org you belong to
  assert.equal((await B.req("PUT", `/api/protection/blocks/${B.id}`, {})).status, 400);
});

test("legacy /api/me/prefs block path is reconciled (PREFS_UPDATED) and linked accounts follow", async () => {
  const O = (await db().get("SELECT org FROM org_members WHERE user_id=$1", [A.id])).org;
  await D.req("PUT", "/api/me/prefs", { blocked: [A.id] });
  const p = await until(async () => { const m = await D.req("GET", "/api/me"); return (m.prefs.blockedLinked || []).includes(O) && m.prefs; });
  assert.ok(p, "linked org added after a legacy prefs block");
  await D.req("PUT", "/api/me/prefs", { blocked: [] });
  const p2 = await until(async () => { const m = await D.req("GET", "/api/me"); return !(m.prefs.blockedLinked || []).length && m.prefs; });
  assert.ok(p2, "unblocking through prefs drops the linked accounts");
  assert.equal((await db().get("SELECT COUNT(*) n FROM user_blocks WHERE owner=$1", [D.id])).n, 0);
});

test("accounts signed in together are linked; counts only (no identity) in the preview; new links extend old blocks", async () => {
  // E signs in, then adds F in the same browser (multi-account jar)
  const r1 = await fetch(H.base + "/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" }, body: JSON.stringify({ handle: "p33_eyad", password: "secret123" }) });
  const s1 = r1.headers.get("set-cookie").split(";")[0];
  const r2 = await fetch(H.base + "/api/auth/login", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", Cookie: s1 }, body: JSON.stringify({ handle: "p33_fahd", password: "secret123", addAccount: true }) });
  const ck = r2.headers.getSetCookie().map(c => c.split(";")[0]); const jar = ck.find(c => c.startsWith("mp_jar=")), s2 = ck.find(c => c.startsWith("mp_session="));
  await fetch(H.base + "/api/auth/accounts", { headers: { "X-Requested-With": "mujtama", Cookie: `${s2}; ${jar}` } });
  await until(async () => db().get("SELECT 1 x FROM account_links WHERE (a=$1 AND b=$2) OR (a=$2 AND b=$1)", [E.id, F.id]));
  const pv = await G.req("GET", `/api/protection/blocks/${F.id}/preview`);
  assert.equal(pv.linked, 1); assert.equal(pv.orgs.length, 0); assert.equal(pv.hidden, 1, "session-linked accounts are counted, never named");
  const b = await G.req("PUT", `/api/protection/blocks/${F.id}`, {}); assert.equal(b.linkedBlocked, 1);
  assert.deepEqual((await G.req("GET", "/api/me")).prefs.blockedLinked, [E.id]);
  // a link discovered after the block extends it
  assert.equal(await P().noteLinked(F.id, D.id, "session"), true);
  assert.deepEqual((await G.req("GET", "/api/me")).prefs.blockedLinked.sort(), [D.id, E.id].sort());
  // E (linked) cannot comment on G's posts / message G
  const gp = await post(G, "منشور غادة");
  assert.ok([403, 404].includes((await E.req("POST", "/api/comments", { post: gp.id, text: "مرحبا" })).status));
  assert.equal((await E.req("POST", "/api/conversations", { user: G.id })).status, 403);
  await G.req("DELETE", `/api/protection/blocks/${F.id}`);
});

test("timed, scoped, Arabic-aware mutes: rules API, expiry, legacy words, notification suppression", async () => {
  const m = await B.req("POST", "/api/protection/mutes", { kind: "word", value: "إساءة", scope: "notifications", wholeWord: true, duration: "1d" });
  assert.equal(m.status, 200, m.error); assert.equal(m.mute.scope, "notifications"); assert.ok(Date.parse(m.mute.expiresAt) > Date.now() + 23 * 3600e3);
  assert.ok(await P().isMuted(B.id, { text: "هذه الاساءه مرفوضة" }, "notifications"), "hamza/taa-marbuta folding + whole word with ال");
  assert.equal(await P().isMuted(B.id, { text: "هذه الاساءه مرفوضة" }, "feed"), null, "scoped to notifications only");
  // re-adding updates instead of duplicating
  await B.req("POST", "/api/protection/mutes", { kind: "word", value: "إساءة", scope: "all", duration: "forever" });
  const list = (await B.req("GET", "/api/protection/mutes")).mutes.filter(r => r.kind === "word" && r.value === "إساءة");
  assert.equal(list.length, 1); assert.equal(list[0].expiresAt, null); assert.equal(list[0].scope, "all");
  // expired rules are ignored
  await db().run("INSERT INTO mute_rules(id,owner,kind,value,scope,whole_word,expires_at,created_at) VALUES('mt_expired1','" + B.id + "','word','قديمة','all',0,$1,$1)", [new Date(Date.now() - 1000).toISOString()]);
  assert.equal(await P().isMuted(B.id, { text: "كلمة قديمة" }, "feed"), null);
  // legacy prefs.mutedWords still count, and lib/policy mutedWordHit now folds Arabic forms
  await B.req("PUT", "/api/privacy", { mutedWords: ["حرق"] });
  assert.ok(await P().isMuted(B.id, { text: "حرق الأحداث" }, "feed"));
  assert.equal(H.app.ctx.policy.mutedWordHit("مسلسل جديد بدون أحداث", ["احداث"]), true);
  // filterMuted for feed integration
  const rows = await P().filterMuted([{ text: "حرق المسلسل", author: C.id }, { text: "عادي", author: C.id }], B.id, "feed"); assert.equal(rows.length, 1);
  // timed account mute: suppresses C's comment notifications to B; muted words in comments too
  const bp = await post(B, "منشور للكتم");
  await C.req("POST", "/api/comments", { post: bp.id, text: "هذه إساءة واضحة" });
  await D.req("POST", "/api/comments", { post: bp.id, text: "تعليق لطيف" });
  await until(async () => (await notifs(B.id, "comment")).some(n => n.actor === D.id));
  const ns = await notifs(B.id, "comment");
  assert.ok(ns.some(n => n.actor === D.id)); assert.ok(!ns.some(n => n.actor === C.id), "comment containing a muted word does not notify");
  const um = await B.req("POST", "/api/protection/mutes", { kind: "user", value: D.id, duration: "1h", scope: "notifications" }); assert.equal(um.status, 200);
  await D.req("POST", "/api/comments", { post: bp.id, text: "تعليق ثان" });
  await sleep(150);
  assert.equal((await notifs(B.id, "comment")).filter(n => n.actor === D.id).length, 1, "muted account does not notify");
  assert.equal((await B.req("DELETE", `/api/protection/mutes/${um.mute.id}`)).ok, true);
  assert.equal((await B.req("POST", "/api/protection/mutes", { kind: "user", value: B.id })).status, 400);
  assert.equal((await B.req("POST", "/api/protection/mutes", { kind: "nope", value: "x" })).status, 400);
});

test("protection mode: replies, mentions and DMs limited to trusted accounts; new followers don't count; off restores", async () => {
  const W = await mk("p33_wafa", "وفاء"), old = await mk("p33_old", "قديم"), stranger = await mk("p33_str", "غريب"), friend = await mk("p33_frd", "صديق");
  await old.req("PUT", `/api/follows/${W.id}`); // followed before the mode starts
  await W.req("PUT", `/api/follows/${friend.id}`); // W follows friend
  await db().run("UPDATE follows SET at=$1 WHERE src=$2 AND dst=$3", [new Date(Date.now() - 3600e3).toISOString(), old.id, W.id]);
  const wp = await post(W, "منشور وفاء");
  const on = await W.req("PUT", "/api/protection/mode", { active: true, hours: 6, limits: { replies: true, dms: true, mentions: true } });
  assert.equal(on.status, 200, on.error); assert.equal(on.mode.active, true); assert.ok(Date.parse(on.mode.endsAt) - Date.now() > 5.9 * 3600e3);
  assert.equal((await stranger.req("POST", "/api/comments", { post: wp.id, text: "رد من غريب" })).status, 403);
  assert.equal((await old.req("POST", "/api/comments", { post: wp.id, text: "رد متابع قديم" })).status, 200);
  assert.equal((await friend.req("POST", "/api/comments", { post: wp.id, text: "رد صديق" })).status, 200);
  await stranger.req("PUT", `/api/follows/${W.id}`); // following during the wave does not help
  assert.equal((await stranger.req("POST", "/api/comments", { post: wp.id, text: "تابعت الآن" })).status, 403);
  assert.equal((await stranger.req("POST", "/api/conversations", { user: W.id })).status, 403);
  await post(stranger, "@p33_wafa انظري هنا"); await sleep(150);
  assert.equal((await notifs(W.id, "mention")).length, 0, "mention from an untrusted account is dropped");
  // only DMs limited → replies open again
  await W.req("PUT", "/api/protection/mode", { limits: { replies: false } });
  assert.equal((await stranger.req("POST", "/api/comments", { post: wp.id, text: "الآن مسموح" })).status, 200);
  const off = await W.req("PUT", "/api/protection/mode", { active: false }); assert.equal(off.mode.active, false);
  assert.equal((await stranger.req("POST", "/api/conversations", { user: W.id })).status, 200);
  // expired windows are inactive
  await W.req("PUT", "/api/protection/mode", { active: true, hours: 1 });
  await db().run("UPDATE protection_modes SET ends_at=$1 WHERE user_id=$2", [new Date(Date.now() - 1000).toISOString(), W.id]);
  await sleep(5100); // mode cache TTL
  assert.equal((await W.req("GET", "/api/protection/mode")).mode.active, false);
});

test("abuse wave → suggestion + notification; dismiss; auto mode turns protection on", async () => {
  H.app.ctx.config.protectionWave = { minEvents: 3, minStrangers: 3, minToxicActors: 99 };
  try {
    const V = await mk("p33_victim", "ضحية"), V2 = await mk("p33_victim2", "ضحية٢");
    const vp = await post(V, "منشور عادي"), vp2 = await post(V2, "منشور آخر");
    const ss = []; for (let i = 0; i < 3; i++) ss.push(await mk("p33_w" + i, "موجة " + i));
    for (const s of ss) { H.app.ctx.rl.w.clear(); await s.req("POST", "/api/comments", { post: vp.id, text: "تعليق من حساب جديد" }); }
    const m = await until(async () => (await V.req("GET", "/api/protection/mode")).mode.suggestion);
    assert.ok(m, "suggested"); assert.deepEqual(m.reasons, ["strangers"]); assert.equal(m.strangers, 3);
    assert.equal((await V.req("GET", "/api/protection/mode")).mode.active, false, "suggestion only");
    assert.ok(await until(async () => (await notifs(V.id, "protection_suggest")).length));
    const d = await V.req("POST", "/api/protection/mode/dismiss"); assert.equal(d.mode.suggestion, null);
    // auto mode
    await V2.req("PUT", "/api/protection/mode", { auto: true });
    for (const s of ss) { H.app.ctx.rl.w.clear(); await s.req("POST", "/api/comments", { post: vp2.id, text: "تعليق" }); }
    const on = await until(async () => { const x = (await V2.req("GET", "/api/protection/mode")).mode; return x.active && x; }, 7000);
    assert.ok(on, "auto-enabled"); assert.equal(on.reason, "auto");
  } finally { delete H.app.ctx.config.protectionWave; }
});

test("who can reply: followers / mentioned / community; author-only setting", async () => {
  const p1 = await post(A, "سؤال لمتابعيّ فقط @p33_jood");
  assert.equal((await C.req("PUT", `/api/posts/${p1.id}/reply-settings`, { audience: "followers" })).status, 403);
  assert.equal((await A.req("PUT", `/api/posts/${p1.id}/reply-settings`, { audience: "community" })).status, 400);
  assert.equal((await A.req("PUT", `/api/posts/${p1.id}/reply-settings`, { audience: "followers" })).audience, "followers");
  const rs = await D.req("GET", `/api/posts/${p1.id}/reply-settings`); assert.equal(rs.audience, "followers"); assert.equal(rs.canReply, false);
  assert.equal((await D.req("POST", "/api/comments", { post: p1.id, text: "رد" })).status, 403);
  assert.equal((await C.req("POST", "/api/comments", { post: p1.id, text: "مذكور" })).status, 200, "mentioned accounts can always reply");
  await D.req("PUT", `/api/follows/${A.id}`);
  assert.equal((await D.req("POST", "/api/comments", { post: p1.id, text: "صرت متابعاً" })).status, 200);
  await A.req("PUT", `/api/posts/${p1.id}/reply-settings`, { audience: "mentioned" });
  assert.equal((await D.req("POST", "/api/comments", { post: p1.id, text: "مرة أخرى" })).status, 403);
  assert.equal((await A.req("POST", "/api/comments", { post: p1.id, text: "الكاتب يرد دائماً" })).status, 200);
  // community audience
  const cm = await A.req("POST", "/api/communities", { name: "مجتمع الحماية", desc: "اختبار", topic: "dev", type: "public" }); assert.equal(cm.status, 200, cm.error);
  const cid = cm.community?.id || cm.id;
  await E.req("PUT", `/api/communities/${cid}/membership`);
  const p2 = await post(A, { text: "للأعضاء", community: cid });
  await A.req("PUT", `/api/posts/${p2.id}/reply-settings`, { audience: "community" });
  assert.equal((await E.req("POST", "/api/comments", { post: p2.id, text: "عضو" })).status, 200);
  assert.equal((await F.req("POST", "/api/comments", { post: p2.id, text: "ليس عضواً" })).status, 403);
});

test("hidden replies: post author hides / unhides; listed for viewers; others cannot", async () => {
  const p = await post(B, "منشور فيه ردود");
  const c1 = (await C.req("POST", "/api/comments", { post: p.id, text: "رد مزعج" })).comment;
  assert.equal((await C.req("PUT", `/api/comments/${c1.id}/hidden`)).status, 403);
  assert.equal((await B.req("PUT", `/api/comments/${c1.id}/hidden`)).hidden, true);
  const h = await D.req("GET", `/api/posts/${p.id}/hidden-replies`); assert.deepEqual(h.hidden, [c1.id]); assert.equal(h.canHide, false);
  assert.equal((await B.req("GET", `/api/posts/${p.id}/hidden-replies`)).canHide, true);
  assert.ok((await D.req("GET", `/api/posts/${p.id}/comments`)).comments.some(c => c.id === c1.id), "hidden ≠ deleted: still readable behind a tap");
  await B.req("DELETE", `/api/comments/${c1.id}/hidden`);
  assert.deepEqual((await D.req("GET", `/api/posts/${p.id}/hidden-replies`)).hidden, []);
  // safety summary for the one-tap menu
  const s = await D.req("GET", `/api/posts/${p.id}/safety`);
  assert.equal(s.isAuthor, false); assert.equal(s.author.id, B.id); assert.equal(s.audience, "everyone"); assert.equal(s.canReply, true); assert.equal(s.protection.active, false);
  assert.equal((await B.req("GET", `/api/posts/${p.id}/safety`)).isAuthor, true);
});

test("help center: verified Saudi resources, placeholders filled by admins only", async () => {
  const h = await new H.Client().req("GET", "/api/help");
  assert.match(h.disclaimer, /للتوعية/); assert.match(h.disclaimer, /911/);
  const r = Object.fromEntries(h.resources.map(x => [x.key, x]));
  assert.equal(r.emergency.phone, "911"); assert.equal(r.emergency.verified, true); assert.match(r.emergency.source, /my\.gov\.sa/);
  assert.equal(r.family1919.phone, "1919"); assert.equal(r.extortion.phone, null); assert.equal(r.extortion.placeholder, true);
  assert.ok(h.articles.some(a => a.slug === "mental-health"));
  assert.equal((await new H.Client().req("GET", "/api/help/articles/protection-mode")).article.title, "وضع الحماية");
  assert.equal((await A.req("PUT", "/api/admin/help/resources/extortion", { phone: "1909" })).status, 403);
  assert.equal((await ADMIN.req("PUT", "/api/admin/help/resources/extortion", { phone: "abc" })).status, 400);
  const up = await ADMIN.req("PUT", "/api/admin/help/resources/extortion", { phone: "1909", source: "https://example.gov.sa/x" });
  assert.equal(up.resource.phone, "1909"); assert.equal(up.resource.verified, true); assert.equal(up.resource.placeholder, false);
  await ADMIN.req("PUT", "/api/admin/help/resources/extortion", { phone: null });
  assert.equal((await new H.Client().req("GET", "/api/help")).resources.find(x => x.key === "extortion").placeholder, true);
});

test("content policies: seeded v1, admin draft → publish v2, revision changes, old versions readable, drafts hidden", async () => {
  const l = await new H.Client().req("GET", "/api/policies");
  assert.ok(l.policies.length >= 3); assert.ok(l.revision);
  assert.deepEqual(await new H.Client().req("GET", "/api/policies?since=" + l.revision).then(x => ({ unchanged: x.unchanged })), { unchanged: true });
  assert.equal((await A.req("POST", "/api/admin/policies", { slug: "community-guidelines", title: "x", body: "نص طويل بما يكفي" })).status, 403);
  const d = await ADMIN.req("POST", "/api/admin/policies", { slug: "community-guidelines", title: "إرشادات المجتمع", summary: "محدثة", body: "## جديد\n- بند جديد عن الهجوم المنسق", changelog: "إضافة بند" });
  assert.equal(d.policy.version, 2); assert.equal(d.policy.status, "draft");
  assert.equal((await new H.Client().req("GET", "/api/policies/community-guidelines?version=2")).status, 404, "drafts are not public");
  assert.equal((await new H.Client().req("GET", "/api/policies/community-guidelines")).policy.version, 1);
  const pub = await ADMIN.req("POST", "/api/admin/policies/community-guidelines/publish", { version: 2 }); assert.equal(pub.policy.status, "published");
  const g = await new H.Client().req("GET", "/api/policies/community-guidelines");
  assert.equal(g.policy.version, 2); assert.match(g.policy.body, /بند جديد/); assert.deepEqual(g.versions.map(v => [v.version, v.status]), [[2, "published"], [1, "archived"]]);
  assert.equal((await new H.Client().req("GET", "/api/policies/community-guidelines?version=1")).policy.version, 1);
  const l2 = await new H.Client().req("GET", "/api/policies?since=" + l.revision); assert.notEqual(l2.revision, l.revision); assert.ok(!l2.unchanged);
  assert.equal((await ADMIN.req("POST", "/api/admin/policies", { slug: "Bad Slug", title: "x", body: "نص طويل بما يكفي" })).status, 400);
  assert.ok((await db().all("SELECT action FROM audit_log WHERE action='POLICY_PUBLISHED'")).length >= 1);
});

test("3-step report: category → detail → protect (block + hide); urgent first in the admin queue; self-harm returns help", async () => {
  const opts = await new H.Client().req("GET", "/api/protection/report-options");
  assert.ok(opts.categories.find(c => c.key === "self_harm").help);
  const p = await post(G, "منشور غادة للبلاغ");
  const c = (await F.req("POST", "/api/comments", { post: p.id, text: "سأقتلك" })).comment;
  assert.equal((await G.req("POST", "/api/protection/reports", { target: c.id, kind: "comment", category: "nope" })).status, 400);
  const r = await G.req("POST", "/api/protection/reports", { target: c.id, kind: "comment", category: "harassment", subcategory: "threat", details: "تهديد صريح", block: true, hide: true });
  assert.equal(r.status, 200, r.error); assert.equal(r.priority, 2); assert.deepEqual(r.actions.sort(), ["block", "hide"]); assert.equal(r.help, null);
  assert.ok((await G.req("GET", "/api/me")).prefs.blocked.includes(F.id));
  assert.deepEqual((await G.req("GET", `/api/posts/${p.id}/hidden-replies`)).hidden, [c.id]);
  const row = await db().get("SELECT reason, status FROM reports WHERE id=$1", [r.id]); assert.equal(row.status, "open"); assert.match(row.reason, /تهديد/);
  assert.equal((await G.req("POST", "/api/protection/reports", { target: c.id, kind: "comment", category: "spam" })).status, 409, "safety.report de-duplicates");
  const sp = await post(E, "منشور مزعج");
  const low = await D.req("POST", "/api/protection/reports", { target: sp.id, kind: "post", category: "spam", subcategory: "ads", mute: true });
  assert.equal(low.priority, 0); assert.deepEqual(low.actions, ["mute"]);
  const sh = await D.req("POST", "/api/protection/reports", { target: E.id, kind: "user", category: "self_harm", subcategory: "risk" });
  assert.ok(sh.help.resources.some(x => x.phone === "911")); assert.ok(sh.help.resources.every(x => ["emergency", "mental"].includes(x.category)));
  assert.equal((await G.req("GET", "/api/admin/protection/reports")).status, 403);
  const q = await ADMIN.req("GET", "/api/admin/protection/reports");
  assert.equal(q.reports[0].priority, 2); assert.ok(q.reports.some(x => x.id === low.id && x.category === "spam"));
});
