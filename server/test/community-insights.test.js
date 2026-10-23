/* v2.60.0 «المجتمع 3.0» stage 5 — insights, growth, integrations and member notifications (API):
 * migration 066 additive / idempotent / reversible; the live incremental counters equal the reconciler (every column, the
 * active set), computeMetrics() keeps working; insights shape + permissions; the CSV export carries member data only for
 * the owner; community webhooks signed like phase 47 (verified with the same lib), private communities send no text,
 * reports never name the reporter; MJT rewards paid by the owner through the ledger with member + community daily caps,
 * reversal on delete / un-accept (partial when the member already spent), nothing minted, ledger verify() ok; member
 * notification levels (highlights / muted / digest) + the admin default for new members; events section + the community
 * calendar (public only) + default reminders; partner search; the Pi features stay OFF «غير مفعّل بعد». */
const test = require("node:test"), assert = require("node:assert");
const http = require("node:http");
const { boot } = require("./helpers");
const L = require("../lib/devapi-lib");
const M = require("../lib/mjt-ledger");
let H, O, AD, MO, U, V, W, X, cid, pcid;
const db = () => H.app.ctx.db;
const S = () => H.app.ctx.services;
const clear = () => H.app.ctx.rl.w?.clear?.();
const mk = async (handle) => { clear(); const c = new H.Client(); await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); c.id = (await c.req("GET", "/api/me")).user.id; c.handle = handle; return c; };
const today = () => new Date().toISOString().slice(0, 10);
const post = (c, text, extra = {}) => c.req("POST", "/api/posts", { text, community: cid, ...extra });
const COLS = ["posts", "comments", "reactions", "active_users", "new_members", "left_members", "views", "questions", "answered", "invite_joins", "mod_actions", "automod_caught"];
const pick = (r) => Object.fromEntries(COLS.map(k => [k, Number(r?.[k] || 0)]));
const settle = () => new Promise(r => setTimeout(r, 60)); // bus handlers are async: let them land

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, pointsOpts: { jobs: false }, cintegrationsOpts: { jobs: false, backoffMs: 50 } });
  [O, AD, MO, U, V, W, X] = [await mk("in_own"), await mk("in_adm"), await mk("in_mod"), await mk("in_usr"), await mk("in_v"), await mk("in_w"), await mk("in_out")];
  cid = (await O.req("POST", "/api/communities", { name: "مجتمع الرؤى", desc: "مجتمع لاختبار التحليلات والتكاملات", rules: ["الاحترام"] })).community.id;
  for (const c of [AD, MO, U, V]) { clear(); await c.req("PUT", `/api/communities/${cid}/membership`); }
  await O.req("PATCH", `/api/communities/${cid}/members/${AD.id}`, { role: "admin" });
  await O.req("PATCH", `/api/communities/${cid}/members/${MO.id}`, { role: "moderator" });
  pcid = (await O.req("POST", "/api/communities", { name: "مجتمع خاص للرؤى", desc: "خاص", type: "private" })).community.id;
});
test.after(() => H.app.close());
test.beforeEach(() => clear());

test("migration 066: tables and columns exist, re-running up() is a no-op, down/up reversible and purely additive", async () => {
  for (const t of ["community_daily_actives", "community_member_prefs", "community_webhooks", "community_webhook_deliveries", "community_mjt_rewards"]) assert.ok(await db().get(`SELECT COUNT(*) n FROM ${t}`), t);
  const cols = (await db().all("PRAGMA table_info(community_metrics)").catch(() => [])).map(r => r.name);
  if (cols.length) for (const c of ["views", "questions", "answered", "invite_joins", "mod_actions", "automod_caught", "reconciled_at"]) assert.ok(cols.includes(c), c);
  const m066 = require("../migrations/066_insights");
  const exec = (sql) => (async () => { for (const s of require("../lib/migrations").render(sql, db().dialect).split(";").map(x => x.trim()).filter(Boolean)) await db().exec(s); })();
  await m066.up(db(), exec); // second run: guarded ALTERs + IF NOT EXISTS → nothing fails, nothing changes
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '066_insights' ORDER BY id")).map(r => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "066_insights"]);
  assert.ok(!(await db().get("SELECT name FROM sqlite_master WHERE name='community_mjt_rewards'").catch(() => null)));
  const back = (await db().all("PRAGMA table_info(community_metrics)").catch(() => [])).map(r => r.name);
  if (back.length) assert.deepEqual(back.filter(c => ["views", "reconciled_at"].includes(c)), [], "down() restores the v2.59 columns");
  assert.deepEqual(await mig.up(db()), ["066_insights", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.ok(!s.problems.some(p => p.startsWith("066")), s.problems.join("\n"));
  assert.ok(s.seen.some(x => x.file === "066_insights.js"));
  /* verify-migrations --static records statements synchronously (it does not await up()), so the guarded ALTERs here are
   * checked with the same rules on an AWAITED capture */
  const stmts = [], fake = { dialect: "postgres", exec: async (x) => stmts.push(x), run: async () => ({ changes: 0 }), all: async () => [], get: async () => undefined };
  await m066.up(fake, async (sql) => { for (const x of mig.render(sql, "postgres").split(";").map(y => y.trim()).filter(Boolean)) stmts.push(x); });
  assert.ok(stmts.length >= 17, "every statement captured: " + stmts.length);
  for (const one of stmts.map(x => x.replace(/\s+/g, " ").trim())) {
    const add = /^ALTER TABLE \w+ ADD COLUMN \w+ (.*)$/i.exec(one);
    const ok = (add && (!/NOT NULL/i.test(add[1]) || /DEFAULT/i.test(add[1]))) || /^CREATE TABLE IF NOT EXISTS \w+ ?\(/i.test(one) || /^CREATE (UNIQUE )?INDEX IF NOT EXISTS \w+ ON \w+ ?\(/i.test(one);
    assert.ok(ok && !/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i.test(one.replace(/ON DELETE CASCADE/gi, "")), "additive: " + one.slice(0, 120));
  }
});

test("incremental counters == reconciler for today (every column + the active set); computeMetrics() still writes today", async () => {
  /* a fresh community so nothing from other tests leaks in */
  const c2 = (await O.req("POST", "/api/communities", { name: "مجتمع العدادات", desc: "عدادات حية" })).community.id;
  const inv = (await O.req("POST", `/api/communities/${c2}/invites`, { label: "تويتر" })).invite;
  clear(); await U.req("POST", `/api/communities/${c2}/join`, { invite: inv.code });
  clear(); await V.req("PUT", `/api/communities/${c2}/membership`);
  clear(); await W.req("PUT", `/api/communities/${c2}/membership`);
  await O.req("PATCH", `/api/communities/${c2}/members/${MO.id}`, { role: "moderator" }).catch(() => {});
  const p1 = (await U.req("POST", "/api/posts", { text: "أول منشور في العدادات", community: c2 })).post;
  const q1 = (await V.req("POST", "/api/posts", { text: "سؤال: كيف أبدأ؟", type: "question", community: c2 })).post;
  const p3 = (await W.req("POST", "/api/posts", { text: "منشور سيُحذف", community: c2 })).post;
  await O.req("POST", "/api/comments", { post: q1.id, text: "ابدأ من الأساسيات" });
  await U.req("POST", "/api/comments", { post: p1.id, text: "تعليقي على منشوري" });
  await V.req("PUT", "/api/reactions/" + p1.id, { type: "like" });
  await O.req("PUT", "/api/reactions/" + p1.id, { type: "like" });
  await V.req("POST", `/api/posts/${p1.id}/view`, { source: "community" });
  await O.req("POST", `/api/posts/${q1.id}/view`, { source: "community" });
  await W.req("DELETE", "/api/posts/" + p3.id); // W was active only through this post → leaves today's active set
  clear(); await V.req("DELETE", `/api/communities/${c2}/membership`);
  await S().cmod.log(c2, O.id, { action: "warn", user: U.id, reason: "تنبيه" });
  await S().cmod.log(c2, "system", { action: "automod_queue", user: U.id, reason: "كلمة" });
  await settle();
  const live = pick(await db().get("SELECT * FROM community_metrics WHERE community=$1 AND day=$2", [c2, today()]));
  const truth = await S().cinsights.computeDay(c2, today());
  assert.deepEqual(live, pick(truth), "live counters equal the reconciler");
  assert.equal(live.posts, 2); assert.equal(live.questions, 1); assert.equal(live.answered, 1); assert.equal(live.invite_joins, 1); assert.equal(live.left_members, 1); assert.equal(live.views, 2); assert.equal(live.mod_actions, 1); assert.equal(live.automod_caught, 1);
  const actives = (await db().all("SELECT user_id FROM community_daily_actives WHERE community=$1 AND day=$2 ORDER BY user_id", [c2, today()])).map(r => r.user_id);
  assert.deepEqual(actives, [...truth.actors].sort());
  assert.ok(!actives.includes(W.id), "W's only activity was deleted");
  /* the reconciler rewrites the row to the same values and stamps it */
  const r = await S().cspace.computeMetrics(); assert.ok(r.communities >= 1);
  const after = await db().get("SELECT * FROM community_metrics WHERE community=$1 AND day=$2", [c2, today()]);
  assert.deepEqual(pick(after), live); assert.ok(after.reconciled_at);
  /* a drifted row (a missed hook) is repaired */
  await db().run("UPDATE community_metrics SET posts=99, active_users=0 WHERE community=$1 AND day=$2", [c2, today()]);
  await S().cinsights.computeMetrics(today(), { community: c2 });
  assert.deepEqual(pick(await db().get("SELECT * FROM community_metrics WHERE community=$1 AND day=$2", [c2, today()])), live);
  /* nightly reconciles yesterday only */
  const n1 = await S().cinsights.nightly(); assert.equal(typeof n1.communities, "number"); assert.deepEqual(await S().cinsights.nightly(), { skipped: true });
});

test("insights: shape, periods, permissions (member 403, moderator ok), health card only with view_health", async () => {
  await post(U, "منشور للتحليلات"); await post(V, "منشور ثانٍ للتحليلات");
  for (const d of [7, 30, 90]) { const r = await MO.req("GET", `/api/communities/${cid}/insights?days=${d}`); assert.equal(r.status, 200); assert.equal(r.days, d); assert.equal(r.series.length, d); }
  const r = await O.req("GET", `/api/communities/${cid}/insights?days=30&tz=Asia/Riyadh`);
  for (const k of ["growth", "engagement", "actives", "series", "cohorts", "topPosts", "contributors", "channels", "heatmap", "funnel", "moderation"]) assert.ok(k in r, k);
  assert.equal(r.heatmap.grid.length, 7); assert.equal(r.heatmap.grid[0].length, 24); assert.equal(r.cohorts.length, 8); assert.ok(r.health && typeof r.health.score === "number");
  assert.ok(r.engagement.posts.value >= 2); assert.ok(r.actives.dau >= 2); assert.ok(r.contributors.length >= 2);
  assert.equal((await MO.req("GET", `/api/communities/${cid}/insights`)).health, null, "moderators: no health card (view_health)");
  assert.equal((await U.req("GET", `/api/communities/${cid}/insights`)).status, 403);
  assert.equal((await new H.Client().req("GET", `/api/communities/${cid}/insights`)).status, 401);
  assert.equal((await O.req("GET", `/api/communities/${cid}/insights?days=999`)).days, 30);
});

test("export: aggregates for the team, member data (handles / names) only for the owner; CSV cells neutralised", async () => {
  await post(U, "=HYPERLINK(\"x\") منشور خطِر");
  const own = await O.req("GET", `/api/communities/${cid}/insights/export?days=30`);
  assert.equal(own.status, 200); assert.equal(own.members, true); assert.match(own.csv, /contributor_handle/); assert.ok(own.csv.includes(U.handle));
  assert.ok(!/\n"=/.test(own.csv) && !/,"=/.test(own.csv), "formula cells are neutralised");
  for (const who of [AD, MO]) {
    const r = await who.req("GET", `/api/communities/${cid}/insights/export?days=30`); assert.equal(r.status, 200); assert.equal(r.members, false);
    for (const h of [U.handle, V.handle, O.handle, AD.handle, MO.handle]) assert.ok(!r.csv.includes(h), `no handle ${h} for a non-owner`);
    for (const nm of ["عضو in_usr", "عضو in_v"]) assert.ok(!r.csv.includes(nm), "no member names");
    assert.ok(!/contributor_|author_handle/.test(r.csv));
  }
  assert.equal((await U.req("GET", `/api/communities/${cid}/insights/export`)).status, 403);
  assert.ok((await O.req("GET", `/api/communities/${cid}/modlog`)).log.some(l => l.action === "insights_exported"));
});

test("webhooks: signed like phase 47 (verifySignature), member.joined + post.created + report.created; private: no text, never the reporter", async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", d => (b += d)); req.on("end", () => { got.push({ h: req.headers, body: b }); res.writeHead(200); res.end("ok"); }); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r)); const url = `http://127.0.0.1:${srv.address().port}/hook`;
  try {
    assert.equal((await U.req("POST", `/api/communities/${cid}/webhooks`, { url, events: ["post.created"] })).status, 403, "members cannot");
    assert.equal((await MO.req("POST", `/api/communities/${cid}/webhooks`, { url, events: ["post.created"] })).status, 403, "moderators cannot (manage_integrations)");
    assert.equal((await O.req("POST", `/api/communities/${cid}/webhooks`, { url: "ftp://x", events: ["post.created"] })).status, 400);
    assert.equal((await O.req("POST", `/api/communities/${cid}/webhooks`, { url, events: ["nope"] })).status, 400);
    const cr = await O.req("POST", `/api/communities/${cid}/webhooks`, { url, events: ["member.joined", "post.created", "report.created"], label: "خادمي" });
    assert.ok(cr.secret?.startsWith("whsec_")); const secret = cr.secret;
    const list = await AD.req("GET", `/api/communities/${cid}/webhooks`); assert.equal(list.webhooks.length, 1); assert.ok(!JSON.stringify(list).includes(secret), "the secret is shown once");
    clear(); await W.req("PUT", `/api/communities/${cid}/membership`);
    const p = (await post(U, "منشور للويب هوك العام")).post;
    await V.req("POST", "/api/reports", { target: p.id, kind: "post", reason: "إزعاج" });
    for (let i = 0; i < 50 && got.length < 3; i++) await new Promise(r => setTimeout(r, 40));
    const ev = Object.fromEntries(got.map(g => [g.h["x-mujtama-event"], g]));
    for (const k of ["member.joined", "post.created", "report.created"]) {
      assert.ok(ev[k], k); assert.ok(L.verifySignature(secret, ev[k].h["x-mujtama-signature"], ev[k].body), "signature verifies: " + k);
      assert.ok(!L.verifySignature("whsec_wrong", ev[k].h["x-mujtama-signature"], ev[k].body)); assert.equal(ev[k].h["x-mujtama-community"], cid);
    }
    assert.equal(JSON.parse(ev["member.joined"].body).data.member.handle, W.handle);
    assert.equal(JSON.parse(ev["post.created"].body).data.post.text, "منشور للويب هوك العام", "public community: text included");
    const rep = ev["report.created"].body; assert.ok(!rep.includes(V.id) && !rep.includes(V.handle), "the reporter is never named");
    /* rotate → the old secret no longer verifies */
    const rot = await O.req("POST", `/api/communities/${cid}/webhooks/${cr.webhook.id}/rotate`); assert.ok(rot.secret && rot.secret !== secret);
    got.length = 0; await O.req("POST", `/api/communities/${cid}/webhooks/${cr.webhook.id}/test`);
    for (let i = 0; i < 50 && !got.length; i++) await new Promise(r => setTimeout(r, 40));
    assert.ok(L.verifySignature(rot.secret, got[0].h["x-mujtama-signature"], got[0].body)); assert.ok(!L.verifySignature(secret, got[0].h["x-mujtama-signature"], got[0].body));
    /* paused → nothing is delivered */
    await O.req("PATCH", `/api/communities/${cid}/webhooks/${cr.webhook.id}`, { status: "paused" }); got.length = 0; await post(U, "بعد الإيقاف"); await new Promise(r => setTimeout(r, 200)); assert.equal(got.length, 0);
    /* private community: post.created has no text */
    const ph = await O.req("POST", `/api/communities/${pcid}/webhooks`, { url, events: ["post.created"] }); got.length = 0;
    await O.req("POST", "/api/posts", { text: "سر داخلي للأعضاء", community: pcid });
    for (let i = 0; i < 50 && !got.length; i++) await new Promise(r => setTimeout(r, 40));
    assert.ok(got.length && !got[0].body.includes("سر داخلي"), "no text from a private community"); assert.ok(L.verifySignature(ph.secret, got[0].h["x-mujtama-signature"], got[0].body));
    const dl = await O.req("GET", `/api/communities/${cid}/webhooks/deliveries`); assert.ok(dl.items.some(d => d.status === "ok"));
    assert.equal((await O.req("DELETE", `/api/communities/${cid}/webhooks/${cr.webhook.id}`)).ok, true);
  } finally { srv.close(); }
});

test("MJT rewards: owner-funded through the ledger, member + community daily caps, reversal on delete / un-accept, partial when spent, nothing minted", async () => {
  const mjt = S().mjt, led = mjt.ledger; await mjt.ready;
  const old = new Date(Date.now() - 30 * 864e5).toISOString();
  await db().run("UPDATE users SET created_at=$1 WHERE id IN ($2,$3,$4)", [old, U.id, V.id, O.id]); // past the transfer account-age rule
  const admin = { id: AD.id, role: "admin" };
  await mjt.adjust(admin, { ikey: "fund-owner-0001", handle: O.handle, amount: "20", reason: "تمويل اختبار المكافآت" });
  const supply0 = (await led.supply()).minted;
  const bal = async (c) => led.balanceOf(db(), M.userAcc(c.id));
  /* off by default */
  assert.equal((await S().cintegrations.reward(cid, U.id, "post", "x_none")).reason, "off");
  assert.equal((await AD.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true })).status, 403, "the owner's money: owner only");
  assert.equal((await O.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true, perPost: "99" })).status, 400, "bounded");
  const set = await O.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true, perPost: "1", perAnswer: "2", memberDailyCap: "2.5", communityDailyCap: "4" });
  assert.equal(set.settings.perPost, "1"); assert.equal(set.settings.memberDailyCap, "2.5");
  const o0 = await bal(O), u0 = await bal(U);
  const ps = []; for (let i = 0; i < 4; i++) { ps.push((await post(U, "منشور مكافأة " + i)).post); await settle(); }
  assert.equal(await bal(U) - u0, 2.5 * M.UNIT, "member cap: 1 + 1 + 0.5, the 4th is capped");
  assert.equal(o0 - await bal(O), 2.5 * M.UNIT, "paid by the owner");
  const rows = await db().all("SELECT status, amount FROM community_mjt_rewards WHERE community=$1 AND user_id=$2 ORDER BY created_at", [cid, U.id]);
  assert.deepEqual(rows.map(r => r.status), ["paid", "paid", "paid", "capped"]);
  /* the owner's own posts are not rewarded; a second payment for the same post is impossible */
  await post(O, "منشور المالك"); await settle(); assert.equal((await S().cintegrations.reward(cid, U.id, "post", ps[0].id)).reason, "duplicate");
  /* community cap: V gets only what is left of 4 */
  await post(V, "منشور V أول"); await post(V, "منشور V ثانٍ"); await settle();
  assert.equal(Number((await db().get("SELECT COALESCE(SUM(amount),0) s FROM community_mjt_rewards WHERE community=$1 AND tx_id IS NOT NULL", [cid])).s), 4 * M.UNIT);
  /* delete → reversed to the owner */
  const ob = await bal(O); await U.req("DELETE", "/api/posts/" + ps[0].id); await settle();
  assert.equal(await bal(O) - ob, 1 * M.UNIT); assert.equal((await db().get("SELECT status FROM community_mjt_rewards WHERE ref_id=$1", [ps[0].id])).status, "reversed");
  /* the member already spent part of it → partial reversal, never below 0, shortfall recorded */
  await mjt.adjust(admin, { ikey: "burn-member-0001", handle: U.handle, amount: "-" + M.format(await bal(U) - 0.25 * M.UNIT), reason: "محاكاة إنفاق العضو" });
  await U.req("DELETE", "/api/posts/" + ps[1].id); await settle();
  const pr = await db().get("SELECT status, reversed, reason FROM community_mjt_rewards WHERE ref_id=$1", [ps[1].id]);
  assert.equal(pr.status, "partially_reversed"); assert.equal(Number(pr.reversed), 0.25 * M.UNIT); assert.match(pr.reason, /shortfall/); assert.equal(await bal(U), 0);
  /* accepted answer → reward; un-accept → reversed (a re-accept does not pay twice) */
  await db().run("DELETE FROM community_mjt_rewards WHERE community=$1", [cid]); // a new UTC day for the caps
  await O.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true, perPost: "0", perAnswer: "2", memberDailyCap: "5", communityDailyCap: "10" });
  const q = (await post(V, "سؤال: ما أفضل كتاب؟", { type: "question" })).post; const a = (await U.req("POST", "/api/comments", { post: q.id, text: "كتاب الأيام" })).comment;
  const ua = await bal(U); await V.req("POST", `/api/posts/${q.id}/accept`, { comment: a.id }); await settle();
  assert.equal(await bal(U) - ua, 2 * M.UNIT);
  await V.req("POST", `/api/posts/${q.id}/accept`, { comment: null }); await settle(); assert.equal(await bal(U), ua);
  await V.req("POST", `/api/posts/${q.id}/accept`, { comment: a.id }); await settle(); assert.equal(await bal(U), ua, "no second payment");
  /* nothing minted by rewards; the ledger is consistent; kinds are the new ones */
  assert.equal((await led.supply()).minted, supply0, "rewards never mint");
  const v = await led.verify(); assert.ok(v.ok, v.problems.join(","));
  assert.ok(await db().get("SELECT 1 x FROM mjt_tx WHERE kind='community_reward'")); assert.ok(await db().get("SELECT 1 x FROM mjt_tx WHERE kind='community_reward_reversal'"));
  /* reconcile: a paid reward whose post is gone without a hook gets reversed */
  const p5 = (await post(V, "منشور للمصالحة")).post; await O.req("PUT", `/api/communities/${cid}/mjt-rewards`, { enabled: true, perPost: "1", memberDailyCap: "5", communityDailyCap: "10" });
  await S().cintegrations.reward(cid, V.id, "post", p5.id);
  await db().run("UPDATE posts SET status='removed' WHERE id=$1", [p5.id]);
  const rc = await S().cintegrations.reconcileRewards(); assert.ok(rc.reversed >= 1); assert.notEqual((await db().get("SELECT status FROM community_mjt_rewards WHERE ref_id=$1", [p5.id])).status, "paid");
  const iv = await O.req("GET", `/api/communities/${cid}/integrations`); assert.ok(iv.mjt.canEdit); assert.ok(iv.mjt.ownerBalance); assert.ok(iv.mjt.recent.length);
  const ia = await AD.req("GET", `/api/communities/${cid}/integrations`); assert.equal(ia.mjt.canEdit, false); assert.equal(ia.mjt.ownerBalance, null, "the owner's balance is the owner's");
  /* the platform switch wins */
  await db().run("INSERT INTO mjt_settings(key,value,updated_by,updated_at) VALUES('rules',$1,'t',$2) ON CONFLICT (key) DO UPDATE SET value=$1", [JSON.stringify({ rewards: { enabled: false, dailyCap: 150 * M.UNIT } }), new Date().toISOString()]);
  await new Promise(r => setTimeout(r, 5100)); // mjt settings cache (5 s)
  const q2 = (await post(V, "سؤال آخر؟", { type: "question" })).post; const a2 = (await U.req("POST", "/api/comments", { post: q2.id, text: "جواب" })).comment;
  await V.req("POST", `/api/posts/${q2.id}/accept`, { comment: a2.id }); await settle();
  assert.equal((await db().get("SELECT reason FROM community_mjt_rewards WHERE ref_id=$1", [a2.id])).reason, "rewards_off");
  await db().run("DELETE FROM mjt_settings WHERE key='rules'"); // (cache expires on its own)
});

test("member notifications per community: highlights drops reactions, mute drops announcements, personal notices always pass; default for new members; digest", async () => {
  const p = (await post(U, "منشور للإشعارات")).post;
  const count = async (uid, kind) => Number((await db().get("SELECT COUNT(*) n FROM notifications WHERE user_id=$1 AND kind=$2", [uid, kind])).n);
  assert.equal((await U.req("GET", `/api/communities/${cid}/notify`)).prefs.level, "all");
  assert.equal((await X.req("GET", `/api/communities/${cid}/notify`)).status, 403, "members only");
  await U.req("PUT", `/api/communities/${cid}/notify`, { level: "highlights" });
  const r0 = await count(U.id, "reaction"); await V.req("PUT", "/api/reactions/" + p.id, { type: "like" }); await settle();
  assert.equal(await count(U.id, "reaction"), r0, "highlights: no reaction notification");
  const ci = S().cinsights;
  assert.equal(await ci.suppressNotify(U.id, "community_announcement", { ref: cid }), false, "announcements pass on highlights");
  assert.equal(await ci.suppressNotify(U.id, "approved", { ref: cid }), false);
  const m = await U.req("PUT", `/api/communities/${cid}/notify`, { level: "all", muteHours: 8 }); assert.ok(m.prefs.muted && m.prefs.mutedUntil);
  assert.equal(await ci.suppressNotify(U.id, "community_announcement", { ref: cid }), true, "muted: announcements dropped");
  for (const k of ["approved", "removed", "mod_warning", "event_1h"]) assert.equal(await ci.suppressNotify(U.id, k, { ref: cid }), false, "personal: " + k);
  await U.req("PUT", `/api/communities/${cid}/notify`, { level: "all", muteHours: 0 }); const r1 = await count(U.id, "reaction");
  await W.req("PUT", "/api/reactions/" + p.id, { type: "like" }).catch(() => {}); await O.req("PUT", "/api/reactions/" + p.id, { type: "like" }); await settle();
  assert.ok(await count(U.id, "reaction") > r1, "all: reactions notify again");
  /* the admin default for new members */
  assert.equal((await O.req("PATCH", `/api/communities/${cid}/settings/notify`, { notifyDefault: "digest" })).values.notifyDefault, "digest");
  clear(); await X.req("PUT", `/api/communities/${cid}/membership`); await settle();
  const xp = (await X.req("GET", `/api/communities/${cid}/notify`)).prefs; assert.equal(xp.level, "highlights"); assert.equal(xp.digest, true); assert.equal(xp.communityDefault, "digest");
  assert.equal((await U.req("GET", `/api/communities/${cid}/notify`)).prefs.level, "all", "existing members keep theirs");
  const sum = await O.req("GET", `/api/communities/${cid}/notify/summary`); assert.ok(sum.digest >= 1); assert.ok(!JSON.stringify(sum).includes(X.id), "counts only, never who");
  /* digest: activity since the last one → one community_digest */
  await post(U, "نشاط جديد للملخص"); const d0 = await count(X.id, "community_digest");
  const dg = await ci.digests(); assert.ok(dg.sent >= 1); assert.equal(await count(X.id, "community_digest"), d0 + 1);
  assert.equal((await ci.digests()).sent, 0, "once a day");
  await O.req("PATCH", `/api/communities/${cid}/settings/notify`, { notifyDefault: "all" });
});

test("events section: server list with attendance, community calendar (public only), default reminders", async () => {
  const ev = (await O.req("POST", "/api/events/plus", { name: "لقاء المجتمع", startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), community: cid, capacity: 2 })).event;
  await U.req("POST", `/api/events/${ev.id}/tickets`);
  const m = await MO.req("GET", `/api/communities/${cid}/events/manage`); assert.equal(m.status, 200);
  const row = m.events.find(e => e.id === ev.id); assert.ok(row); assert.equal(row.capacity, 2); assert.equal(row.confirmed, 1);
  assert.equal(m.ics, `/c/${cid}/events.ics`); assert.equal((await U.req("GET", `/api/communities/${cid}/events/manage`)).status, 403);
  const ics = await fetch(H.base + `/c/${cid}/events.ics`); assert.equal(ics.status, 200); const t = await ics.text(); assert.match(t, /BEGIN:VCALENDAR/); assert.match(t, /لقاء المجتمع/);
  assert.equal((await fetch(H.base + `/c/${pcid}/events.ics`)).status, 404, "private communities have no public calendar");
  assert.equal((await O.req("GET", `/api/communities/${pcid}/events/manage`)).ics, null);
  assert.equal(await S().cinsights.reminderOn(ev.id, "1h"), true);
  await O.req("PATCH", `/api/communities/${cid}/settings/events`, { eventReminders: { day: true, hour: false } });
  assert.equal(await S().cinsights.reminderOn(ev.id, "1h"), false); assert.equal(await S().cinsights.reminderOn(ev.id, "24h"), true);
});

test("growth: partner search (no invite-only, marks existing partners); integrations view: Pi features shown OFF «غير مفعّل بعد»", async () => {
  const inviteOnly = (await X.req("POST", "/api/communities", { name: "مجتمع سري للبحث", desc: "بالدعوة", type: "invite" })).community.id;
  const other = (await X.req("POST", "/api/communities", { name: "مجتمع شريك للبحث", desc: "عام" })).community.id;
  const s = await AD.req("GET", `/api/communities/${cid}/partners/search?q=للبحث`);
  assert.ok(s.results.some(r => r.id === other)); assert.ok(!s.results.some(r => r.id === inviteOnly)); assert.ok(!s.results.some(r => r.id === cid));
  await AD.req("POST", `/api/communities/${cid}/partners`, { community: other });
  assert.equal((await AD.req("GET", `/api/communities/${cid}/partners/search?q=شريك`)).results.find(r => r.id === other).partner, "pending");
  assert.equal((await MO.req("GET", `/api/communities/${cid}/partners/search?q=x`)).status, 403);
  const iv = await AD.req("GET", `/api/communities/${cid}/integrations`);
  assert.equal(iv.pi.enabled, false); assert.equal(iv.pi.label, "غير مفعّل بعد"); assert.equal(iv.pi.features.length, 4); assert.ok(iv.pi.features.every(f => f.enabled === false));
  assert.equal(iv.bots.available, true); assert.ok(Array.isArray(iv.webhooks));
  assert.equal((await O.req("GET", `/api/communities/${pcid}/integrations`)).bots.available, false);
  assert.equal((await U.req("GET", `/api/communities/${cid}/integrations`)).status, 403);
  const mt = await AD.req("PATCH", `/api/communities/${cid}/settings/integrations`, { marketTab: true }); assert.equal(mt.values.marketTab, true);
  assert.equal((await new H.Client().req("GET", `/api/communities/${cid}/space`)).community.marketTab, true, "public setting");
});
