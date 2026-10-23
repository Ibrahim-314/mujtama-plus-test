/* v2.59.0 «المجتمع 3.0» stage 4 — moderation v2 + automod v2 API: golden non-regression (default settings give the
 * v2.58 result), v2 rules end to end (queue / reject / report, comments held as 'pending'), legacy PATCH keeps v2,
 * the tester stores nothing, stats, concurrent claims, assignment, bulk, macros, appeals → penalty lifted → role
 * restored, the penalty ladder (off by default), moderator preferences, guests get 401. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const Tox = require("../lib/toxicity");
let H, O, AD, MO, M2, U, V, X, cid;
const mk = async (handle) => { H.app.ctx.rl.w?.clear?.(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; c.handle = handle; return c; };
const db = () => H.app.ctx.db;
const setAm = (am) => db().run("UPDATE communities SET settings=$1 WHERE id=$2", [{ ...(H._s || {}), automod: am }, cid]);
const post = (c, text) => c.req("POST", "/api/posts", { text, community: cid });
const clear = () => H.app.ctx.rl.w?.clear?.();

/* the v2.58 legacy automod, frozen verbatim (minus logging) — the reference for the golden set */
const DEF = { words: [], blockLinks: false, newAccountDays: 0, toxicity: "queue", action: "queue" };
function v258(am, text, ageMs) {
  const cfg = { ...DEF, ...(am || {}) }, reasons = []; let hard = false;
  const low = Tox.norm(text);
  const words = (cfg.words || []).filter(w => w && low.includes(Tox.norm(w))); if (words.length) reasons.push(`كلمات محظورة: ${words.slice(0, 3).join("، ")}`);
  if (cfg.blockLinks && /https?:\/\/|www\./i.test(text)) reasons.push("يحتوي رابطاً");
  if (cfg.newAccountDays > 0) { if (ageMs < cfg.newAccountDays * 864e5) reasons.push(`حساب أحدث من ${cfg.newAccountDays} أيام`); }
  if (cfg.toxicity !== "off") { const t = Tox.score(text); if (t.score >= 0.6) { reasons.push(`محتوى مسيء محتمل (${Math.round(t.score * 100)}٪)`); if (cfg.toxicity === "reject" && t.score >= 0.8) hard = true; } }
  if (!reasons.length) return null;
  const action = hard || cfg.action === "reject" ? "reject" : "queue";
  return { action, reasons, message: "القواعد الآلية للمجتمع منعت هذا المنشور: " + reasons.join("، ") };
}
const GOLDEN = ["صباح الخير يا جماعة", "ما رأيكم في الكتاب الجديد؟", "انت غبي وحقير", "سأقتلك", "اعرف وين ساكن انتظرني برا", "زوروا موقعي https://example.com", "www.test.sa عرض", "STOP SHOUTING AT EVERYONE NOW", "!!!!! ماذا؟؟؟؟", "you are an idiot loser", "غَبِيّ", "كلب", "الكلب وفي", "تافه", "مرحبا @sara @ali", "t.me/group انضموا", "ههههههههههههههههه", "😀😀😀😀😀😀😀😀😀😀😀😀😀😀", "", "عرض خاص اربح المال الآن واتساب wa.me/966500000000", "kys", "shut up nobody asked"];
const CONFIGS = [undefined, {}, DEF, { ...DEF, words: ["حقير", "تافه"] }, { ...DEF, blockLinks: true }, { ...DEF, toxicity: "off" }, { ...DEF, toxicity: "reject" }, { ...DEF, action: "reject", words: ["كلب"] }, { ...DEF, newAccountDays: 7 }];

test.before(async () => {
  H = await boot();
  [O, AD, MO, M2, U, V, X] = [await mk("mv_own"), await mk("mv_adm"), await mk("mv_mod"), await mk("mv_mod2"), await mk("mv_usr"), await mk("mv_v"), await mk("mv_out")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع الإشراف الثاني", desc: "اختبار الإشراف", rules: ["الاحترام"] })).community.id;
  for (const c of [AD, MO, M2, U, V]) { clear(); await c.req("PUT", `/api/communities/${cid}/membership`); }
  await O.req("PATCH", `/api/communities/${cid}/members/${AD.id}`, { role: "admin" });
  await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" });
  await O.req("PATCH", `/api/communities/${cid}/members/${M2.id}`, { role: "moderator" });
  H._s = (await db().get("SELECT settings FROM communities WHERE id=$1", [cid])).settings || {};
});
test.after(() => H.app.close());
test.beforeEach(() => clear());

test("migration 065: tables exist; comments keep TEXT status (the 'pending' value needs no schema change)", async () => {
  for (const t of ["mod_claims", "community_appeals", "mod_macros", "mod_prefs", "content_fingerprints"]) assert.ok(await db().get(`SELECT COUNT(*) n FROM ${t}`), t);
  assert.ok(await db().get("SELECT id FROM schema_migrations WHERE id='065_moderation'"));
});

test("golden set: under default settings (and with v2 present but all off) automod gives the v2.58 result exactly", async () => {
  const cmod = H.app.ctx.services.cmod, cm2 = H.app.ctx.services.cmod2;
  const user = { id: U.id }, ageMs = Date.now() - new Date((await db().get("SELECT created_at FROM users WHERE id=$1", [U.id])).created_at).getTime();
  const allOff = require("../lib/automod-rules").parseV2({});
  let n = 0;
  for (const am of CONFIGS) for (const variant of [am, am && { ...am, v2: allOff, ladder: { enabled: false, steps: [] } }]) {
    const community = { id: cid, settings: variant === undefined ? {} : { automod: variant } };
    for (const text of GOLDEN) {
      const ref = v258(am, text, ageMs);
      assert.deepEqual(await cmod.automod(community, user, "member", text), ref, `${JSON.stringify(am)} / ${text}`);
      assert.deepEqual(await cmod.legacyAutomod(community, user, "member", text), ref);
      const t = cm2.legacyTest(variant, text, ageMs / 864e5); assert.deepEqual(t ? { action: t.action, reasons: t.reasons } : null, ref ? { action: ref.action, reasons: ref.reasons } : null, "tester parity");
      n++;
    }
  }
  assert.ok(n >= 300);
  await db().run("DELETE FROM mod_actions WHERE community=$1 AND action='automod_reject'", [cid]);
  for (const r of ["owner", "admin", "moderator"]) assert.equal(await cmod.automod({ id: cid, settings: { automod: { ...DEF, words: ["غبي"], v2: require("../lib/automod-rules").parseV2({ words: { enabled: true, words: ["غبي"], action: "reject" } }) } } }, user, r, "غبي"), null, "staff are exempt");
});

test("default settings through the API: statuses identical to v2.58 for the golden texts", async () => {
  await setAm(undefined);
  for (const text of GOLDEN.filter(Boolean)) {
    clear(); const r = await post(U, text + " " + Math.random().toString(36).slice(2, 6)); const ref = v258(undefined, text, 1e12);
    if (r.code === "spam") continue; // the platform spam filter (unchanged, runs before community automod)
    if (ref?.action === "reject") assert.equal(r.status, 400, text); else { assert.equal(r.status, 200, text + JSON.stringify(r)); assert.equal(r.post.status, ref ? "pending" : "published", text); }
  }
});

test("automod v2: queue / reject / report for posts; legacy PATCH keeps the v2 rules; stats count by rule", async () => {
  const S = await O.req("PATCH", `/api/communities/${cid}/automod`, { ...DEF, toxicity: "off", v2: { words: { enabled: true, words: ["ممنوعة*"], action: "queue" }, invites: { enabled: true, action: "reject" }, mentions: { enabled: true, max: 2, action: "report" } } });
  assert.equal(S.status, 200); assert.equal(S.automod.v2.words.enabled, true);
  const q = await post(U, "هذه كلمةٌ مَمْنُوعَةٌ هنا"); assert.equal(q.post.status, "pending");
  const rj = await post(U, "انضموا t.me/abcdef"); assert.equal(rj.status, 400); assert.match(rj.error?.message || rj.message || JSON.stringify(rj), /دعوة/);
  const rp = await post(U, "مرحبا @mv_mod @mv_adm @mv_own"); assert.equal(rp.post.status, "published");
  assert.ok(await db().get("SELECT 1 x FROM reports WHERE target=$1 AND by_user='system' AND status='open'", [rp.post.id]), "report-only rule opens a system report");
  assert.equal((await post(U, "منشور عادي تماماً")).post.status, "published");
  const legacy = await O.req("PATCH", `/api/communities/${cid}/automod`, { words: ["x1"], blockLinks: false, newAccountDays: 0, toxicity: "off", action: "queue" }); // a v2.58 client
  assert.equal(legacy.status, 200); assert.deepEqual(legacy.automod.words, ["x1"]); assert.equal(legacy.automod.v2.words.enabled, true, "the legacy form never wipes v2");
  const sec = await O.req("PATCH", `/api/communities/${cid}/settings/moderation`, { automod: { words: ["x2"], toxicity: "off" } });
  assert.equal(sec.status, 200); assert.equal(sec.values.automod.v2.invites.enabled, true, "the settings section keeps v2 too");
  const g = await MO.req("GET", `/api/communities/${cid}/automod`); assert.equal(g.automod.v2.mentions.max, 2);
  const st = await MO.req("GET", `/api/communities/${cid}/automod/stats`); assert.equal(st.status, 200);
  assert.ok(st.byAction.automod_queue >= 1 && st.byAction.automod_reject >= 1 && st.byAction.automod_flag >= 1); assert.ok(st.byRule.some(r => r.rule === "words")); assert.equal(st.series.length, 14);
  assert.equal((await U.req("GET", `/api/communities/${cid}/automod/stats`)).status, 403);
});

test("«جرّب القاعدة»: evaluates a draft config, stores and logs nothing", async () => {
  const before = Number((await db().get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1", [cid])).n);
  const r = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "انت غَـبِـيّ جداً", config: { words: [], toxicity: "off", v2: { words: { enabled: true, words: ["غبي"], action: "reject" } } } });
  assert.equal(r.status, 200); assert.equal(r.final, "reject"); assert.equal(r.v2[0].rule, "words"); assert.match(r.normalized, /غبي/);
  const ok = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "صباح الخير", config: { toxicity: "off", v2: {} } }); assert.equal(ok.final, "allow");
  const nm = await MO.req("POST", `/api/communities/${cid}/automod/test`, { text: "أول منشور", memberPosts: 0, config: { toxicity: "off", v2: { newMember: { enabled: true } } } }); assert.equal(nm.final, "queue");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM mod_actions WHERE community=$1", [cid])).n), before, "nothing logged");
  const saved = (await db().get("SELECT settings FROM communities WHERE id=$1", [cid])).settings.automod; assert.equal(saved.v2.words.action, "queue", "the draft was not saved");
  assert.equal((await U.req("POST", `/api/communities/${cid}/automod/test`, { text: "x" })).status, 403);
  const meta = await MO.req("GET", `/api/communities/${cid}/automod/meta`); assert.ok(meta.rules.words && meta.presets.balanced && meta.defaults.ladder.enabled === false);
});

test("comments: held as 'pending' only when «التعليقات» is on; hidden from everyone; approve publishes", async () => {
  const p = await post(V, "منشور للتعليقات"); assert.equal(p.post.status, "published");
  await setAm({ ...DEF, toxicity: "off", v2: require("../lib/automod-rules").parseV2({ words: { enabled: true, words: ["سيء"] } }) });
  const c0 = await U.req("POST", "/api/comments", { post: p.post.id, text: "تعليق سيء" }); assert.equal(c0.comment.status, "published", "comments off → published");
  await setAm({ ...DEF, toxicity: "off", v2: require("../lib/automod-rules").parseV2({ words: { enabled: true, words: ["سيء"] }, comments: { enabled: true } }) });
  const c1 = await U.req("POST", "/api/comments", { post: p.post.id, text: "تعليق سيء جداً" }); assert.equal(c1.comment.status, "pending"); assert.ok(c1.comment.review);
  const ok = await U.req("POST", "/api/comments", { post: p.post.id, text: "تعليق لطيف" }); assert.equal(ok.comment.status, "published");
  const list = await V.req("GET", `/api/posts/${p.post.id}/comments`); assert.ok(!list.comments.some(c => c.id === c1.comment.id), "pending comment hidden");
  const q = await MO.req("GET", `/api/communities/${cid}/modqueue/v2?kind=comment`); const it = q.items.find(i => i.id === c1.comment.id); assert.ok(it); assert.equal(it.kind, "comment"); assert.match(it.reason, /سيء/);
  assert.equal((await MO.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "comment", id: c1.comment.id, action: "approve" })).status, 200);
  assert.ok((await V.req("GET", `/api/posts/${p.post.id}/comments`)).comments.some(c => c.id === c1.comment.id));
  assert.equal((await MO.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "comment", id: c1.comment.id, action: "approve" })).status, 404, "already decided");
  await setAm({ ...DEF, toxicity: "off" });
});

test("claims: two moderators at once → exactly one wins; the other cannot act; release; expired claim taken over", async () => {
  const p = await U.req("POST", "/api/posts", { text: "ينتظر " + Date.now(), community: cid });
  await db().run("UPDATE posts SET status='pending' WHERE id=$1", [p.post.id]);
  const [a, b] = await Promise.all([MO.req("POST", `/api/communities/${cid}/modqueue/claim`, { kind: "post", id: p.post.id }), M2.req("POST", `/api/communities/${cid}/modqueue/claim`, { kind: "post", id: p.post.id })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const [win, lose] = a.status === 200 ? [MO, M2] : [M2, MO];
  const q = await lose.req("GET", `/api/communities/${cid}/modqueue/v2`); const it = q.items.find(i => i.id === p.post.id); assert.ok(it.claim && !it.claim.mine);
  assert.equal((await win.req("GET", `/api/communities/${cid}/modqueue/v2?kind=mine`)).items.some(i => i.id === p.post.id), true);
  assert.equal((await lose.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: p.post.id, action: "approve" })).status, 409);
  assert.equal((await lose.req("POST", `/api/communities/${cid}/modqueue/release`, { kind: "post", id: p.post.id })).status, 403, "same rank cannot release");
  await db().run("UPDATE mod_claims SET expires_at=$1 WHERE item_id=$2", [new Date(Date.now() - 1000).toISOString(), p.post.id]);
  assert.equal((await lose.req("POST", `/api/communities/${cid}/modqueue/claim`, { kind: "post", id: p.post.id })).status, 200, "expired claim taken over");
  assert.equal((await lose.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: p.post.id, action: "approve" })).status, 200);
  assert.equal(await db().get("SELECT 1 x FROM mod_claims WHERE item_id=$1", [p.post.id]), undefined, "claim cleared after the decision");
  assert.equal((await U.req("POST", `/api/communities/${cid}/modqueue/claim`, { kind: "post", id: p.post.id })).status, 403);
  // assignment
  const p2 = await U.req("POST", "/api/posts", { text: "إسناد " + Date.now(), community: cid }); await db().run("UPDATE posts SET status='pending' WHERE id=$1", [p2.post.id]);
  assert.equal((await AD.req("POST", `/api/communities/${cid}/modqueue/assign`, { kind: "post", id: p2.post.id, to: U.id })).status, 400, "only staff");
  assert.equal((await AD.req("POST", `/api/communities/${cid}/modqueue/assign`, { kind: "post", id: p2.post.id, to: MO.id })).status, 200);
  assert.equal((await M2.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: p2.post.id, action: "approve" })).status, 409);
  assert.equal((await AD.req("POST", `/api/communities/${cid}/modqueue/release`, { kind: "post", id: p2.post.id })).status, 200, "a higher rank may release");
});

test("bulk: approve several, skip what does not apply, report per item; macro reason used", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) { const p = await U.req("POST", "/api/posts", { text: "جماعي " + i + " " + Date.now(), community: cid }); await db().run("UPDATE posts SET status='pending' WHERE id=$1", [p.post.id]); ids.push(p.post.id); }
  await M2.req("POST", `/api/communities/${cid}/modqueue/claim`, { kind: "post", id: ids[2] });
  const r = await MO.req("POST", `/api/communities/${cid}/modqueue/bulk`, { action: "approve", items: [...ids.map(id => ({ kind: "post", id })), { kind: "report", id: "rp_none" }] });
  assert.equal(r.status, 200); assert.equal(r.done, 2); assert.equal(r.failed, 1); assert.equal(r.skipped, 1);
  assert.equal(r.results.find(x => x.id === ids[2]).status, 409, "claimed by another moderator");
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [ids[0]])).status, "published");
  const mac = await MO.req("POST", `/api/communities/${cid}/macros`, { title: "رفض: خارج الموضوع", action: "reject", reason: "خارج موضوع المجتمع" }); assert.equal(mac.status, 200);
  const p = await U.req("POST", "/api/posts", { text: "قالب " + Date.now(), community: cid }); await db().run("UPDATE posts SET status='pending' WHERE id=$1", [p.post.id]);
  const r2 = await MO.req("POST", `/api/communities/${cid}/modqueue/bulk`, { macro: mac.macro.id, items: [{ kind: "post", id: p.post.id }] }); assert.equal(r2.done, 1);
  assert.ok(await db().get("SELECT 1 x FROM mod_actions WHERE target_post=$1 AND action='reject' AND reason='خارج موضوع المجتمع'", [p.post.id]));
  assert.equal((await MO.req("POST", `/api/communities/${cid}/modqueue/bulk`, { action: "approve", items: [] })).status, 400);
});

test("macros: CRUD, permissions, apply = queue action + penalty", async () => {
  assert.equal((await MO.req("POST", `/api/communities/${cid}/macros`, { title: "فارغ" })).status, 400);
  const m = await MO.req("POST", `/api/communities/${cid}/macros`, { title: "حذف وإنذار", action: "remove", penalty: "warn", reason: "إساءة", message: "نرجو الالتزام بالقواعد" });
  assert.equal(m.macro.action, "remove"); assert.equal(m.macro.penalty, "warn");
  assert.equal((await M2.req("PATCH", `/api/communities/${cid}/macros/${m.macro.id}`, { title: "x" })).status, 403, "another moderator's macro");
  assert.equal((await AD.req("PATCH", `/api/communities/${cid}/macros/${m.macro.id}`, { title: "حذف وإنذار (معدّل)" })).macro.title, "حذف وإنذار (معدّل)");
  const p = await V.req("POST", "/api/posts", { text: "سيبلَّغ عنه " + Date.now(), community: cid });
  await U.req("POST", "/api/reports", { target: p.post.id, kind: "post", reason: "إساءة" });
  const rp = await db().get("SELECT id FROM reports WHERE target=$1 AND status='open'", [p.post.id]); assert.ok(rp, "report created");
  const w0 = (await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, V.id])).warnings;
  const ap = await MO.req("POST", `/api/communities/${cid}/macros/${m.macro.id}/apply`, { kind: "report", id: rp.id, user: V.id }); assert.equal(ap.status, 200); assert.equal(ap.action, "remove"); assert.equal(ap.penalty, "warn");
  assert.equal((await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, V.id])).warnings, w0 + 1);
  assert.equal((await db().get("SELECT reason FROM community_sanctions WHERE community=$1 AND user_id=$2 AND kind='warn' ORDER BY created_at DESC", [cid, V.id])).reason, "نرجو الالتزام بالقواعد");
  assert.ok((await MO.req("GET", `/api/communities/${cid}/macros`)).macros.find(x => x.id === m.macro.id).uses >= 1);
  assert.equal((await U.req("GET", `/api/communities/${cid}/macros`)).status, 403);
  assert.equal((await AD.req("DELETE", `/api/communities/${cid}/macros/${m.macro.id}`)).status, 200);
});

test("appeals: ban → appeal → the moderator who banned cannot decide → admin accepts → previous role restored", async () => {
  clear(); const B = await mk("mv_ban"); await B.req("PUT", `/api/communities/${cid}/membership`);
  await O.req("PATCH", `/api/communities/${cid}/members/${B.id}`, { role: "moderator" }); // B was a moderator before the ban
  assert.equal((await AD.req("POST", `/api/communities/${cid}/members/${B.id}/discipline`, { action: "ban", reason: "مخالفة" })).status, 200);
  const mine = await B.req("GET", `/api/communities/${cid}/appeals/mine`); const ban = mine.items.find(i => i.kind === "ban"); assert.ok(ban?.canAppeal); assert.equal(mine.membership.role, "banned");
  assert.equal((await B.req("POST", `/api/communities/${cid}/appeals`, { kind: "ban", ref: ban.ref, text: "قصير" })).status, 400);
  const a = await B.req("POST", `/api/communities/${cid}/appeals`, { kind: "ban", ref: ban.ref, text: "أرجو مراجعة الحظر، لم أقصد المخالفة" }); assert.equal(a.status, 200);
  assert.equal((await B.req("POST", `/api/communities/${cid}/appeals`, { kind: "ban", ref: ban.ref, text: "مرة ثانية لنفس القرار" })).status, 409);
  assert.equal((await X.req("POST", `/api/communities/${cid}/appeals`, { kind: "ban", ref: ban.ref, text: "ليس قراري أصلاً" })).status, 404, "an outsider cannot appeal someone else's ban");
  const list = await MO.req("GET", `/api/communities/${cid}/appeals`); assert.ok(list.appeals.some(x => x.id === a.appeal.id && x.decision?.reason === "مخالفة"));
  assert.equal((await MO.req("POST", `/api/communities/${cid}/appeals/${a.appeal.id}/decide`, { decision: "accept" })).status, 403, "a moderator does not outrank a banned moderator");
  assert.equal((await AD.req("POST", `/api/communities/${cid}/appeals/${a.appeal.id}/decide`, { decision: "accept" })).status, 403, "the admin who banned cannot decide");
  const [d1, d2] = await Promise.all([O.req("POST", `/api/communities/${cid}/appeals/${a.appeal.id}/decide`, { decision: "accept", note: "قُبل" }), O.req("POST", `/api/communities/${cid}/appeals/${a.appeal.id}/decide`, { decision: "reject" })]);
  assert.deepEqual([d1.status, d2.status].sort(), [200, 409], "decided exactly once");
  const m = await db().get("SELECT role, prev_role FROM memberships WHERE community=$1 AND user_id=$2", [cid, B.id]);
  const st = (await db().get("SELECT status FROM community_appeals WHERE id=$1", [a.appeal.id])).status;
  if (st === "accepted") { assert.equal(m.role, "moderator", "previous role restored"); assert.equal(m.prev_role, null); assert.ok((await db().get("SELECT lifted_at FROM community_sanctions WHERE id=$1", [ban.ref])).lifted_at); }
  else assert.equal(m.role, "banned");
  assert.ok((await O.req("GET", `/api/communities/${cid}/appeals?status=closed`)).appeals.some(x => x.id === a.appeal.id));
});

test("appeals: mute → accept → role restored; warning → accept → count decremented; removal → accept → post back", async () => {
  await AD.req("POST", `/api/communities/${cid}/members/${V.id}/discipline`, { action: "mute", hours: 5, reason: "حدة" });
  const mute = (await V.req("GET", `/api/communities/${cid}/appeals/mine`)).items.find(i => i.kind === "mute" && i.active);
  const a = await V.req("POST", `/api/communities/${cid}/appeals`, { kind: "mute", ref: mute.ref, text: "كان سوء فهم وأعتذر عنه" });
  assert.equal((await O.req("POST", `/api/communities/${cid}/appeals/${a.appeal.id}/decide`, { decision: "accept" })).restoredRole, "member");
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, V.id])).role, "member");
  const warn = (await V.req("GET", `/api/communities/${cid}/appeals/mine`)).items.find(i => i.kind === "warn" && i.active);
  const w0 = (await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, V.id])).warnings;
  const aw = await V.req("POST", `/api/communities/${cid}/appeals`, { kind: "warn", ref: warn.ref, text: "الإنذار لم يكن في محله" });
  assert.equal((await MO.req("POST", `/api/communities/${cid}/appeals/${aw.appeal.id}/decide`, { decision: "accept" })).status, 403, "the moderator who warned cannot decide");
  assert.equal((await O.req("POST", `/api/communities/${cid}/appeals/${aw.appeal.id}/decide`, { decision: "accept" })).status, 200);
  assert.equal((await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, V.id])).warnings, w0 - 1);
  const p = await V.req("POST", "/api/posts", { text: "سيُرفض ثم يُستأنف " + Date.now(), community: cid }); await db().run("UPDATE posts SET status='pending' WHERE id=$1", [p.post.id]);
  await MO.req("POST", `/api/communities/${cid}/modqueue/act`, { kind: "post", id: p.post.id, action: "reject" });
  const rem = (await V.req("GET", `/api/communities/${cid}/appeals/mine`)).items.find(i => i.kind === "removal" && i.ref === p.post.id); assert.ok(rem?.canAppeal);
  const ar = await V.req("POST", `/api/communities/${cid}/appeals`, { kind: "removal", ref: p.post.id, text: "المنشور ضمن موضوع المجتمع" });
  const rr = await MO.req("POST", `/api/communities/${cid}/appeals/${ar.appeal.id}/decide`, { decision: "reject", note: "يبقى مرفوضاً" }); assert.equal(rr.status, 200);
  assert.equal((await db().get("SELECT status FROM posts WHERE id=$1", [p.post.id])).status, "rejected");
  assert.equal((await V.req("GET", `/api/communities/${cid}/appeals/mine`)).items.find(i => i.ref === p.post.id).appeal.status, "rejected");
});

test("penalty ladder: off by default; when on, the N-th automod hit applies its step once", async () => {
  clear(); const L = await mk("mv_lad"); await L.req("PUT", `/api/communities/${cid}/membership`);
  const AR = require("../lib/automod-rules");
  await setAm({ ...DEF, toxicity: "off", v2: AR.parseV2({ words: { enabled: true, words: ["محظورة"] } }) });
  for (let i = 0; i < 3; i++) { clear(); await post(L, "كلمة محظورة " + i); }
  assert.equal((await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, L.id])).warnings, 0, "ladder off → no penalty");
  await setAm({ ...DEF, toxicity: "off", v2: AR.parseV2({ words: { enabled: true, words: ["محظورة"] } }), ladder: AR.parseLadder({ enabled: true, windowDays: 30, steps: [{ at: 4, action: "warn" }, { at: 5, action: "mute", hours: 2 }] }) });
  clear(); await post(L, "كلمة محظورة 4");
  assert.equal((await db().get("SELECT warnings FROM memberships WHERE community=$1 AND user_id=$2", [cid, L.id])).warnings, 1);
  clear(); await post(L, "كلمة محظورة 5");
  assert.equal((await db().get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, L.id])).role, "muted");
  assert.ok(await db().get("SELECT 1 x FROM mod_actions WHERE community=$1 AND target_user=$2 AND action='automod_penalty'", [cid, L.id]));
  const mine = await L.req("GET", `/api/communities/${cid}/appeals/mine`); assert.ok(mine.items.some(i => i.kind === "mute" && i.automatic));
  await setAm({ ...DEF, toxicity: "off" });
});

test("duplicate rule: fingerprints only while on; same text twice → queued", async () => {
  const AR = require("../lib/automod-rules");
  await db().run("DELETE FROM content_fingerprints"); await setAm({ ...DEF, toxicity: "off" });
  await post(U, "نص للتجربة بلا قاعدة التكرار"); assert.equal(Number((await db().get("SELECT COUNT(*) n FROM content_fingerprints")).n), 0);
  await setAm({ ...DEF, toxicity: "off", v2: AR.parseV2({ duplicate: { enabled: true, windowMin: 30 } }) });
  const a = await post(U, "عرض اليوم على الكتب المستعملة"); assert.equal(a.post.status, "published");
  clear(); const b = await post(U, "عرضُ اليوم على الكُتُب المستعمَلة"); assert.equal(b.post.status, "pending", "tashkeel does not hide a duplicate");
  await setAm({ ...DEF, toxicity: "off" });
});

test("moderator preferences: defaults keep the 6 h digest; off skips; guests get 401 on every new endpoint", async () => {
  const d = await MO.req("GET", `/api/communities/${cid}/modprefs`); assert.deepEqual(d.prefs, { digest: "6h", appeals: true, assigned: true });
  assert.equal((await MO.req("PUT", `/api/communities/${cid}/modprefs`, { digest: "off", appeals: false })).prefs.digest, "off");
  assert.equal((await U.req("GET", `/api/communities/${cid}/modprefs`)).status, 403);
  const map = await H.app.ctx.services.cmod2.prefsMap(cid); assert.equal(map[MO.id].digest, "off");
  await MO.req("PUT", `/api/communities/${cid}/modprefs`, { digest: "6h" });
  const G = new H.Client();
  for (const [m, u] of [["GET", "modqueue/v2"], ["POST", "modqueue/claim"], ["POST", "modqueue/release"], ["POST", "modqueue/assign"], ["POST", "modqueue/bulk"], ["GET", "macros"], ["POST", "macros"], ["GET", "appeals"], ["GET", "appeals/mine"], ["POST", "appeals"], ["GET", "modprefs"], ["PUT", "modprefs"], ["GET", "automod/meta"], ["POST", "automod/test"], ["GET", "automod/stats"]])
    assert.equal((await G.req(m, `/api/communities/${cid}/${u}`, m === "GET" ? undefined : {})).status, 401, m + " " + u);
});
