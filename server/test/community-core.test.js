/* v2.56.0 «المجتمع 3.0» stage 1 — the safe foundation. Regression tests for every security fix:
 * settings leak (public list/bootstrap/search), private memberships & events, members-only channel delete, strict
 * hierarchy, mute/ban keep the role, CSV formula injection, invite max_uses race + rate limit, note deletion by rank,
 * atomic settings save; plus the permission engine parity (role × route), custom roles, paginated members, member stats,
 * and migration 062 (reversible, additive). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const CP = require("../lib/cperm");
let H, O, A1, A2, M1, M2, U, X, cid, pc, ic;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; return c; };
const db = () => H.app.ctx.db;
test.before(async () => {
  H = await boot();
  const all = []; for (const h of ["own_k", "adm_k1", "adm_k2", "mod_k1", "mod_k2", "usr_k", "out_k"]) all.push(await mk(h)); [O, A1, A2, M1, M2, U, X] = all;
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع الأساس الآمن", desc: "اختبار", topic: "dev", rules: ["الاحترام"] })).community.id;
  for (const c of [A1, A2, M1, M2, U]) await c.req("PUT", `/api/communities/${cid}/membership`);
  for (const [c, r] of [[A1, "admin"], [A2, "admin"], [M1, "moderator"], [M2, "moderator"]]) assert.equal((await O.req("PATCH", `/api/communities/${cid}/members/${c.id}`, { role: r })).status, 200);
  await O.req("PATCH", `/api/communities/${cid}/automod`, { words: ["كلمةسرية"], blockLinks: true });
  await O.req("PATCH", `/api/communities/${cid}/identity`, { joinQuestions: ["سؤال خاص؟"], welcome: { message: "رسالة ترحيب للأعضاء", steps: ["خطوة"] } });
  pc = (await O.req("POST", "/api/communities", { name: "نادي خاص جداً", type: "private" })).community.id;
  await O.req("PATCH", `/api/communities/${pc}/automod`, { words: ["سرّيخاص"] });
  await O.req("PATCH", `/api/communities/${pc}/identity`, { joinQuestions: ["لماذا تنضم؟"] });
  ic = (await O.req("POST", "/api/communities", { name: "مجتمع بالدعوة فقط", type: "invite" })).community.id;
  await O.req("PATCH", `/api/communities/${ic}/automod`, { words: ["كلمةالدعوة"] });
  await O.req("PATCH", `/api/communities/${ic}/identity`, { joinQuestions: ["سؤال الدعوة؟"] });
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w?.clear?.());

const SECRET = /كلمةسرية|سرّيخاص|كلمةالدعوة|سؤال خاص|لماذا تنضم|سؤال الدعوة|رسالة ترحيب|automod|joinQuestions|"welcome":|publicModLog/;

test("leak 1: anonymous/other users never receive automod words, join questions or welcome; invite-only is not listed", async () => {
  const anon = new H.Client();
  const r = await fetch(H.base + "/api/communities"); const raw = await r.text(); assert.equal(r.status, 200);
  assert.doesNotMatch(raw, SECRET, "public list carries only the allow-listed settings");
  const list = JSON.parse(raw).communities; assert.ok(list.some(c => c.id === cid) && list.some(c => c.id === pc)); assert.ok(!list.some(c => c.id === ic), "invite-only hidden from non-members");
  assert.ok((await O.req("GET", "/api/communities")).communities.some(c => c.id === ic), "the owner still sees it");
  const boot1 = JSON.stringify(await X.req("GET", "/api/bootstrap")); assert.doesNotMatch(boot1, SECRET, "bootstrap");
  assert.ok(!JSON.parse(boot1).communities.some(c => c.id === ic));
  const dir = JSON.stringify(await anon.req("GET", "/api/communities/directory")); assert.doesNotMatch(dir, SECRET);
  const sr = JSON.stringify(await X.req("GET", "/api/search?q=" + encodeURIComponent("بالدعوة"))); assert.ok(!sr.includes(ic), "search does not surface invite-only");
  // the community page: join questions for signed-in prospective joiners (public/private), never for invite-only outsiders
  const spAnon = await anon.req("GET", `/api/communities/${pc}/space`); assert.deepEqual(spAnon.identity.joinQuestions, []); assert.equal(spAnon.identity.welcome, null);
  assert.doesNotMatch(JSON.stringify(spAnon), /سرّيخاص|automod/);
  assert.deepEqual((await X.req("GET", `/api/communities/${pc}/space`)).identity.joinQuestions, ["لماذا تنضم؟"], "a signed-in visitor can answer them");
  assert.deepEqual((await X.req("GET", `/api/communities/${ic}/space`)).identity.joinQuestions, []);
  assert.equal((await X.req("GET", `/api/communities/${cid}/space`)).identity.welcome, null, "welcome is for members");
  assert.equal((await U.req("GET", `/api/communities/${cid}/space`)).identity.welcome.message, "رسالة ترحيب للأعضاء");
  // staff still get everything through the authorised endpoints
  assert.deepEqual((await M1.req("GET", `/api/communities/${cid}/automod`)).automod.words, ["كلمةسرية"]);
  assert.equal((await U.req("GET", `/api/communities/${cid}/automod`)).status, 403);
});

test("leak 2: bootstrap memberships — private communities, requests and bans stay with members/moderators", async () => {
  await X.req("POST", `/api/communities/${pc}/join`, { answers: ["للتعلم"] }); // X is pending in the private community
  const Y = await mk("pvt_member"); await Y.req("POST", `/api/communities/${pc}/join`, { answers: ["عضو"] });
  await O.req("POST", `/api/communities/${pc}/modqueue/act`, { kind: "join", id: Y.id, action: "approve" });
  const Z = await mk("nosy_k");
  const zb = await Z.req("GET", "/api/bootstrap");
  assert.ok(!zb.memberships.some(m => m.community === pc), "an outsider sees nobody of a private community");
  assert.ok(!zb.memberships.some(m => ["pending", "banned"].includes(m.role)), "no requests or bans of others");
  const xb = await X.req("GET", "/api/bootstrap");
  assert.ok(xb.memberships.some(m => m.community === pc && m.user === X.id && m.role === "pending"), "the user sees their own request");
  assert.ok(!xb.memberships.some(m => m.community === pc && m.user === Y.id), "a pending user is not a member yet");
  const yb = await Y.req("GET", "/api/bootstrap");
  // v2.57 lean bootstrap (flag community_lean_bootstrap, on by default): a member gets their own row only
  assert.ok(yb.memberships.some(m => m.community === pc && m.user === Y.id), "members see their own membership");
  assert.ok(!yb.memberships.some(m => m.community === pc && m.user === O.id), "lean: other members come from the paged members API");
  await db().run("UPDATE feature_flags SET enabled=0 WHERE key='community_lean_bootstrap'"); H.app.ctx.cache.del("flags");
  assert.ok((await Y.req("GET", "/api/bootstrap")).memberships.some(m => m.community === pc && m.user === O.id), "kill switch off: members see their community (v2.56 behaviour)");
  await db().run("UPDATE feature_flags SET enabled=1 WHERE key='community_lean_bootstrap'"); H.app.ctx.cache.del("flags");
  assert.ok(!yb.memberships.some(m => m.community === pc && m.role === "pending"), "but not the requests");
  assert.ok((await O.req("GET", "/api/bootstrap")).memberships.some(m => m.community === pc && m.role === "pending"), "moderators see requests");
  // members list API mirrors it
  assert.equal((await Z.req("GET", `/api/communities/${pc}/members`)).status, 403);
  assert.equal((await Z.req("GET", `/api/communities/${pc}/reputation`)).status, 403);
  assert.ok((await Y.req("GET", `/api/communities/${pc}/members`)).members.length >= 2);
  const zs = await Z.req("GET", `/api/communities/${pc}/space`); assert.deepEqual(zs.featured, []);
});

test("leak 3: deleting a members-only channel never makes its posts public", async () => {
  const secret = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "غرفة الأعضاء", viewPerm: "members" })).channel;
  const pub = (await O.req("POST", `/api/communities/${cid}/channels`, { name: "ساحة عامة", viewPerm: "public" })).channel;
  const hp = (await U.req("POST", "/api/posts", { text: "نقاش داخلي للأعضاء فقط", community: cid, channel: secret.id })).post;
  const pp = (await U.req("POST", "/api/posts", { text: "منشور عام في الساحة", community: cid, channel: pub.id })).post;
  const anon = new H.Client();
  const before = (await anon.req("GET", `/api/communities/${cid}/posts`)).posts; assert.ok(!before.some(p => p.id === hp.id));
  assert.equal((await M1.req("DELETE", `/api/communities/${cid}/channels/${secret.id}`)).status, 403, "moderators cannot delete channels");
  assert.equal((await O.req("DELETE", `/api/communities/${cid}/channels/${secret.id}`)).status, 200);
  assert.equal((await O.req("DELETE", `/api/communities/${cid}/channels/${pub.id}`)).status, 200);
  const after = (await anon.req("GET", `/api/communities/${cid}/posts`)).posts;
  assert.ok(!after.some(p => p.id === hp.id), "members-only post stays hidden from the public");
  assert.ok(after.some(p => p.id === pp.id), "public channel posts stay public (general stream)");
  assert.equal((await anon.req("GET", `/api/posts/${hp.id}`)).status === 200 && (await anon.req("GET", `/api/posts/${hp.id}`)).post ? "leak" : "ok", "ok");
  assert.ok((await U.req("GET", `/api/communities/${cid}/posts`)).posts.some(p => p.id === hp.id), "members still see it");
  assert.ok((await O.req("GET", `/api/communities/${cid}/modlog`)).log.some(l => l.action === "channel_deleted"));
});

test("leak 4: events of private communities are invisible to outsiders (list, bootstrap, details, ics, tickets)", async () => {
  const at = new Date(Date.now() + 3 * 864e5).toISOString();
  const ev = (await O.req("POST", "/api/events/plus", { name: "لقاء النادي الخاص", startsAt: at, community: pc, capacity: 10 })).event;
  const pubEv = (await O.req("POST", "/api/events/plus", { name: "لقاء عام مفتوح", startsAt: at, community: cid })).event;
  const Z = await mk("ev_outsider"), anon = new H.Client();
  for (const c of [Z, anon]) { const l = (await c.req("GET", "/api/events")).events; assert.ok(!l.some(e => e.id === ev.id)); assert.ok(l.some(e => e.id === pubEv.id)); }
  assert.ok(!(await Z.req("GET", "/api/bootstrap")).events.some(e => e.id === ev.id));
  assert.equal((await Z.req("GET", `/api/events/${ev.id}/details`)).status, 404);
  assert.equal((await Z.req("POST", `/api/events/${ev.id}/tickets`)).status, 404);
  assert.equal((await Z.req("PUT", `/api/events/${ev.id}/rsvp/going`)).status, 404);
  assert.equal((await fetch(H.base + `/e/${ev.id}.ics`)).status, 404);
  assert.equal((await fetch(H.base + `/e/${pubEv.id}.ics`)).status, 200);
  assert.ok((await O.req("GET", "/api/events")).events.some(e => e.id === ev.id), "members see it");
  assert.equal((await O.req("GET", `/api/events/${ev.id}/details`)).status, 200);
});

test("leak 5: strict hierarchy — an admin cannot demote, ban, remove or mute an equal/higher member", async () => {
  for (const role of ["member", "moderator", "banned", "muted", "remove"]) assert.equal((await A1.req("PATCH", `/api/communities/${cid}/members/${A2.id}`, { role })).status, 403, "admin→admin " + role);
  assert.equal((await A1.req("PATCH", `/api/communities/${cid}/members/${O.id}`, { role: "member" })).status, 403, "admin→owner");
  assert.equal((await A1.req("POST", `/api/communities/${cid}/members/${A2.id}/discipline`, { action: "ban" })).status, 403);
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "mute" })).status, 403, "moderator→moderator");
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${A1.id}/discipline`, { action: "warn" })).status, 403, "moderator→admin");
  assert.equal((await A1.req("PATCH", `/api/communities/${cid}/members/${U.id}`, { role: "admin" })).status, 403, "only the owner appoints admins");
  assert.equal((await M1.req("PATCH", `/api/communities/${cid}/members/${U.id}`, { role: "moderator" })).status, 403, "moderators cannot change roles");
  assert.equal((await A2.req("PATCH", `/api/communities/${cid}/members/${A2.id}`, { role: "member" })).status, 403, "nobody acts on themselves");
  assert.equal((await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "warn", reason: "تنبيه" })).status, 200, "admin→moderator is allowed (lower rank)");
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "warn" })).status, 200, "moderator→member");
  assert.equal(Number((await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, A2.id])).warnings), 0, "nothing happened to the other admin");
});

test("leak 6: mute and ban keep the role — a muted moderator comes back a moderator (by hand and on expiry)", async () => {
  assert.equal((await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "mute", hours: 1, reason: "تهدئة" })).status, 200);
  let m = await db().get("SELECT role, status, prev_role FROM memberships WHERE community=$1 AND user_id=$2", [cid, M2.id]);
  assert.deepEqual([m.role, m.status, m.prev_role], ["muted", "muted", "moderator"]);
  assert.equal((await M2.req("GET", `/api/communities/${cid}/modqueue`)).status, 403, "a muted moderator cannot moderate");
  assert.equal((await M1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "unmute" })).status, 403, "a moderator cannot lift a sanction on a (muted) moderator");
  assert.equal((await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "unmute" })).status, 200);
  m = await db().get("SELECT role, status, prev_role FROM memberships WHERE community=$1 AND user_id=$2", [cid, M2.id]); assert.deepEqual([m.role, m.status, m.prev_role], ["moderator", "active", null]);
  // timed mute expires → role restored by the job
  await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "mute", hours: 1 });
  await db().run("UPDATE memberships SET muted_until=$1 WHERE community=$2 AND user_id=$3", [new Date(Date.now() - 1000).toISOString(), cid, M2.id]);
  assert.ok(await H.app.ctx.services.cmod.unmuteDue() >= 1);
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, M2.id])).role, "moderator");
  // a ban keeps prev_role while banned and the history is kept
  await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "ban", reason: "اختبار" });
  m = await db().get("SELECT role, prev_role FROM memberships WHERE community=$1 AND user_id=$2", [cid, M2.id]); assert.deepEqual([m.role, m.prev_role], ["banned", "moderator"]);
  assert.equal((await M2.req("POST", "/api/posts", { text: "محاولة نشر وأنا محظور", community: cid })).status, 403);
  await A1.req("POST", `/api/communities/${cid}/members/${M2.id}/discipline`, { action: "unban" });
  const sn = await db().all("SELECT kind, lifted_at FROM community_sanctions WHERE community=$1 AND user_id=$2 ORDER BY created_at", [cid, M2.id]);
  assert.ok(sn.filter(x => x.kind === "mute").length >= 2 && sn.every(x => x.kind === "warn" || x.lifted_at), "every sanction recorded and lifted");
  // the owner re-adds them for the later tests
  await M2.req("PUT", `/api/communities/${cid}/membership`); await O.req("PATCH", `/api/communities/${cid}/members/${M2.id}`, { role: "moderator" });
  // members of the public see a muted member with their role, not the sanction
  await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "mute", hours: 2 });
  const pub = (await X.req("GET", `/api/communities/${cid}/members?limit=100`)).members.find(x => x.user.id === U.id); assert.equal(pub.role, "member");
  const st = (await M1.req("GET", `/api/communities/${cid}/members?limit=100`)).members.find(x => x.user.id === U.id); assert.equal(st.role, "muted");
  await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "unmute" });
});

test("leak 7: moderation-log CSV neutralises spreadsheet formulas", async () => {
  await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "warn", reason: '=HYPERLINK("http://evil","x")' });
  await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "warn", reason: "+1+cmd" });
  await M1.req("POST", `/api/communities/${cid}/members/${U.id}/discipline`, { action: "warn", reason: "@SUM(A1)" });
  const r = await fetch(H.base + `/api/communities/${cid}/modlog?format=csv`, { headers: { Cookie: M1.cookie, "X-Requested-With": "mujtama" } }); const csv = await r.text();
  assert.equal(r.status, 200); assert.match(csv, /"'=HYPERLINK\(""http:\/\/evil"",""x""\)"/); assert.match(csv, /"'\+1\+cmd"/); assert.match(csv, /"'@SUM\(A1\)"/);
  for (const line of csv.split("\r\n").slice(1)) for (const cell of line.match(/"(?:[^"]|"")*"/g) || []) assert.doesNotMatch(cell, /^"[=+\-@]/, cell);
  const { csvCell } = H.app.ctx.services.cmod; assert.equal(csvCell("-2+3"), `"'-2+3"`); assert.equal(csvCell("\tx"), `"'\tx"`); assert.equal(csvCell("عادي"), `"عادي"`);
});

test("leak 8: invite links — max_uses holds under parallel joins; code lookups are rate-limited", async () => {
  const inv = (await O.req("POST", `/api/communities/${ic}/invites`, { maxUses: 2 })).invite;
  const joiners = []; for (const h of ["race_a", "race_b", "race_c", "race_d", "race_e"]) joiners.push(await mk(h));
  const res = await Promise.all(joiners.map(j => j.req("POST", `/api/communities/${ic}/join`, { invite: inv.code, answers: ["مدعو"] })));
  assert.equal(res.filter(r => r.role === "member").length, 2, res.map(r => r.status + ":" + (r.role || r.error)).join(","));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM memberships WHERE invited_via=$1", [inv.code])).n), 2);
  // public community + invite: attribution also capped
  const inv2 = (await O.req("POST", `/api/communities/${cid}/invites`, { maxUses: 1 })).invite;
  const pj = []; for (const h of ["race_f", "race_g", "race_h"]) pj.push(await mk(h));
  await Promise.all(pj.map(j => j.req("POST", `/api/communities/${cid}/join`, { acceptRules: true, invite: inv2.code })));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM memberships WHERE invited_via=$1", [inv2.code])).n), 1);
  H.app.ctx.rl.w?.clear?.();
  const codes = []; for (let i = 0; i < 130; i++) codes.push((await fetch(H.base + "/api/invites/zzzzzz" + (i % 10))).status);
  assert.ok(codes.includes(429), "guessing invite codes at speed is throttled");
  H.app.ctx.rl.w?.clear?.();
});

test("leak 9: notes — a moderator cannot delete a note written by a higher rank; deletions are logged", async () => {
  const n1 = (await O.req("POST", `/api/communities/${cid}/members/${U.id}/notes`, { text: "ملاحظة المالك" })).id;
  const n2 = (await M1.req("POST", `/api/communities/${cid}/members/${U.id}/notes`, { text: "ملاحظة المشرف" })).id;
  const n3 = (await M2.req("POST", `/api/communities/${cid}/members/${U.id}/notes`, { text: "ملاحظة مشرف آخر" })).id;
  assert.equal((await M1.req("DELETE", `/api/communities/${cid}/notes/${n1}`)).status, 403);
  assert.equal((await M1.req("DELETE", `/api/communities/${cid}/notes/${n3}`)).status, 403, "equal rank");
  assert.equal((await M1.req("DELETE", `/api/communities/${cid}/notes/${n2}`)).status, 200, "own note");
  assert.equal((await A1.req("DELETE", `/api/communities/${cid}/notes/${n3}`)).status, 200, "admin over moderator");
  assert.equal((await U.req("DELETE", `/api/communities/${cid}/notes/${n1}`)).status, 403);
  assert.ok((await O.req("GET", `/api/communities/${cid}/modlog`)).log.filter(l => l.action === "note_deleted").length === 2);
});

test("settings: schema by section, atomic save (parallel saves keep both), audit diff", async () => {
  const s = await O.req("GET", `/api/communities/${cid}/settings`); assert.deepEqual(Object.keys(s.sections).sort(), ["content", "events", "general", "identity", "integrations", "joining", "moderation", "notify", "rewards", "safety"]); // v2.60: + events, integrations, notify, rewards
  const ms = await M1.req("GET", `/api/communities/${cid}/settings`); assert.deepEqual(Object.keys(ms.sections), ["moderation"]); assert.equal(ms.sections.moderation.editable, false);
  assert.equal((await U.req("GET", `/api/communities/${cid}/settings`)).status, 403);
  assert.equal((await A1.req("PATCH", `/api/communities/${cid}/settings/general`, { whoCanPost: "mods" })).status, 403, "general settings are the owner's");
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/settings/nope`, {})).status, 404);
  // parallel: identity + automod + general at once — none overwrites the others
  await Promise.all([
    A1.req("PATCH", `/api/communities/${cid}/identity`, { accent: "#0f766e", icon: "ع" }),
    A2.req("PATCH", `/api/communities/${cid}/automod`, { words: ["كلمةسرية", "جديدة"], blockLinks: true }),
    O.req("PATCH", `/api/communities/${cid}/settings/general`, { allowLinks: false, whoCanPost: "members" }),
    O.req("PATCH", `/api/communities/${cid}/settings/joining`, { rulesRequired: false })
  ]);
  const c = await db().get("SELECT settings FROM communities WHERE id=$1", [cid]);
  assert.equal(c.settings.accent, "#0f766e"); assert.deepEqual(c.settings.automod.words, ["كلمةسرية", "جديدة"]); assert.equal(c.settings.allowLinks, false); assert.equal(c.settings.rulesRequired, false);
  assert.deepEqual(c.settings.joinQuestions, ["سؤال خاص؟"], "untouched keys survive");
  const log = (await O.req("GET", `/api/communities/${cid}/modlog`)).log; assert.ok(log.some(l => l.action === "settings_updated"));
  const row = await db().get("SELECT category, diff FROM mod_actions WHERE community=$1 AND action='automod_updated' ORDER BY created_at DESC LIMIT 1", [cid]);
  assert.equal(row.category, "settings"); assert.equal(row.diff.automod.to.words, 2, "the diff summarises word lists, it does not copy them");
  await O.req("PATCH", `/api/communities/${cid}/settings/general`, { allowLinks: true });
});

test("permission engine: base grants equal the v2.55 matrix; role × route parity", async () => {
  const legacy = H.app.ctx.services.communities.PERMS;
  for (const [r, list] of Object.entries(legacy)) for (const [name, key] of Object.entries(CP.LEGACY)) assert.equal(CP.BASE[r].includes(key), list.includes(name), `${r} ${name}`);
  const who = { owner: O, admin: A1, moderator: M1, member: U, outsider: X };
  const routes = [
    ["PATCH", `/api/communities/${cid}/identity`, { icon: "ع" }, ["owner", "admin"]],
    ["GET", `/api/communities/${cid}/health`, null, ["owner", "admin"]],
    ["GET", `/api/communities/${cid}/modqueue`, null, ["owner", "admin", "moderator"]],
    ["GET", `/api/communities/${cid}/requests`, null, ["owner", "admin", "moderator"]],
    ["GET", `/api/communities/${cid}/automod`, null, ["owner", "admin", "moderator"]],
    ["GET", `/api/communities/${cid}/analytics`, null, ["owner", "admin", "moderator"]],
    ["GET", `/api/communities/${cid}/members/${U.id}/notes`, null, ["owner", "admin", "moderator"]],
    ["PATCH", `/api/communities/${cid}`, { desc: "اختبار" }, ["owner"]],
    ["POST", `/api/communities/${cid}/invites`, {}, ["owner", "admin", "moderator", "member"]]
  ];
  for (const [method, path, body, ok] of routes) for (const [r, c] of Object.entries(who)) {
    const st = (await c.req(method, path, body || undefined)).status;
    assert.equal(st === 200, ok.includes(r), `${r} ${method} ${path} → ${st}`);
  }
});

test("custom roles: add permissions (never owner-only ones), granted by rank, visible in the roles list", async () => {
  const W = await mk("welcomer_k"); await W.req("PUT", `/api/communities/${cid}/membership`);
  assert.equal((await M1.req("POST", `/api/communities/${cid}/roles`, { name: "مُرحِّب" })).status, 403);
  const r = (await O.req("POST", `/api/communities/${cid}/roles`, { name: "مُرحِّب", color: "#16a34a", perms: ["approve_requests", "view_notes", "edit_settings", "manage_roles", "nope"] })).role;
  assert.deepEqual(r.perms.sort(), ["approve_requests", "view_notes"], "owner-only and unknown keys are dropped");
  assert.equal((await W.req("GET", `/api/communities/${cid}/members/${U.id}/notes`)).status, 403);
  assert.equal((await A1.req("PUT", `/api/communities/${cid}/members/${W.id}/roles/${r.id}`)).status, 200);
  assert.equal((await W.req("GET", `/api/communities/${cid}/requests`)).status, 200, "the custom role grants approve_requests");
  assert.equal((await W.req("GET", `/api/communities/${cid}/members/${U.id}/notes`)).status, 200, "…and view_notes");
  assert.equal((await W.req("GET", `/api/communities/${cid}/modqueue`)).status, 403, "but not what the role does not hold");
  const list = await U.req("GET", `/api/communities/${cid}/roles`); assert.equal(list.custom[0].name, "مُرحِّب"); assert.equal(list.base.length, 4);
  // an admin cannot hand out a permission they lack, nor touch a higher member's roles
  const r2 = (await A1.req("POST", `/api/communities/${cid}/roles`, { name: "إعدادات", perms: ["edit_settings", "manage_channels"] })).role; assert.deepEqual(r2.perms, ["manage_channels"]);
  assert.equal((await A1.req("PUT", `/api/communities/${cid}/members/${A2.id}/roles/${r2.id}`)).status, 403);
  assert.equal((await O.req("DELETE", `/api/communities/${cid}/members/${W.id}/roles/${r.id}`)).status, 200);
  H.app.ctx.cperm.invalidate(cid);
  assert.equal((await W.req("GET", `/api/communities/${cid}/requests`)).status, 403);
  assert.equal((await O.req("DELETE", `/api/communities/${cid}/roles/${r2.id}`)).status, 200);
});

test("members API: server pagination with a stable cursor, search, role filter", async () => {
  for (const h of ["pg_a", "pg_b", "pg_c", "pg_d"]) { const c = await mk(h); await c.req("PUT", `/api/communities/${cid}/membership`); }
  const all = []; let cur = null, pages = 0;
  do { const r = await X.req("GET", `/api/communities/${cid}/members?limit=4${cur ? "&cursor=" + encodeURIComponent(cur) : ""}`); assert.equal(r.status, 200); all.push(...r.members); cur = r.next; pages++; } while (cur && pages < 20);
  assert.ok(pages > 1); assert.equal(new Set(all.map(m => m.user.id)).size, all.length, "no duplicates across pages");
  const total = (await X.req("GET", `/api/communities/${cid}/members?limit=1`)).total; assert.equal(all.length, total);
  assert.ok((await X.req("GET", `/api/communities/${cid}/members?q=pg_b`)).members.every(m => m.user.handle === "pg_b"));
  const staff = (await X.req("GET", `/api/communities/${cid}/members?role=staff`)).members; assert.ok(staff.every(m => ["owner", "admin", "moderator"].includes(m.role)) && staff.length >= 4);
  assert.ok(!("warnings" in all[0]), "warnings and mutes are moderator data");
});

test("member stats: reputation from community_member_stats (incremental + reconcile give the same ranking)", async () => {
  const S = H.app.ctx.services.communities;
  const p = (await U.req("POST", "/api/posts", { text: "مساهمة مفيدة جداً للمجتمع", community: cid })).post;
  await A1.req("PUT", "/api/reactions/" + p.id, { type: "like" }); await M1.req("PUT", "/api/reactions/" + p.id, { type: "like" });
  await new Promise(r => setTimeout(r, 150));
  const inc = (await S.reputation(cid)).find(x => x.user === U.id).score;
  await S.refreshStats(cid);
  const rec = (await S.reputation(cid)).find(x => x.user === U.id).score;
  assert.ok(Math.abs(inc - rec) <= 1, `incremental ${inc} ≈ reconciled ${rec}`);
  const c = await db().get("SELECT member_count FROM communities WHERE id=$1", [cid]);
  assert.equal(Number(c.member_count), Number((await db().get("SELECT COUNT(*) n FROM memberships WHERE community=$1 AND role NOT IN ('pending','banned')", [cid])).n));
  const sp = await X.req("GET", `/api/communities/${cid}/space`); assert.ok(Array.isArray(sp.featured));
});

test("migration 062: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '062_community_core' ORDER BY id")).map(r => r.id);
  const rows = Number((await db().get("SELECT COUNT(*) n FROM memberships")).n);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "062_community_core"]);
  await assert.rejects(() => db().get("SELECT 1 FROM community_roles"));
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM memberships")).n), rows, "no member row lost");
  assert.deepEqual(await mig.up(db()), ["062_community_core", ...later]);
  assert.equal((await db().get("SELECT status FROM memberships LIMIT 1")).status, "active", "new status column defaults to active");
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("062")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "062_community_core.js"));
});
