/* Phase 61 — advanced creator analytics: attention beacon (caps, own posts, anonymous), audience growth with unfollows,
 * returning viewers + follower cohorts, k-anonymous demographics (country / language / device), content performance
 * (per post, per type, medians, best time), earnings from the ledger across streams (fees, reversals, ad spend),
 * period comparisons, CSV exports (BOM, formula-injection safe), auth and migration 042 reversibility. PostgreSQL + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { createLedger, ACC } = require("../lib/ledger");
const CA = require("../services/canalytics");

let H, cre, other; const V = [];
const db = () => H.app.ctx.db;
const L = createLedger({ now: () => new Date().toISOString() });
const post = (j) => db().tx((t) => L.postJournal(t, j));
const DAY = 864e5;
const UAS = ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148 Safari/604.1", "Mozilla/5.0 (Linux; Android 14) Mobile Safari/537.36", "Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36", "Mozilla/5.0 (iPad; CPU OS 17_0) Safari/605", "Mozilla/5.0 (Linux; Android 13) PiBrowser/1.0 Mobile"];
async function mk(handle, ua) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(ua); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clearCache = () => H.app.ctx.cache.del("can:");
const posts = [];
test.before(async () => {
  H = await boot({ canalyticsOpts: { env: { CREATOR_K_ANON: "5" } } });
  cre = await mk("ca_creator"); other = await mk("ca_other");
  for (let i = 0; i < 7; i++) V.push(await mk("ca_v" + i, UAS[i % UAS.length]));
  // 6 viewers in Saudi Arabia (5 Arabic UI + 1 English), 1 in Egypt
  for (let i = 0; i < 7; i++) await db().run("UPDATE users SET country=$1, location=$2, lang=$3 WHERE id=$4", [i === 6 ? "EG" : "SA", i === 6 ? "القاهرة" : "جدة", i === 5 ? "en" : "ar", V[i].id]);
  H.app.ctx.rl.w.clear();
  posts.push((await cre.req("POST", "/api/posts", { type: "article", title: "دليل المبتدئين في Pi", text: "مقال طويل عن الشبكة ".repeat(20) })).post);
  posts.push((await cre.req("POST", "/api/posts", { type: "post", text: "=HYPERLINK(\"http://x\") منشور قصير" })).post);
  posts.push((await cre.req("POST", "/api/posts", { type: "post", text: "منشور ثالث عن المجتمع" })).post);
  for (const p of posts) assert.ok(p?.id, "post created");
});
test.after(() => H.app.close());
test.beforeEach(() => { H.app.ctx.rl.w.clear(); clearCache(); });

test("migration 042 reversible + additive; data map entries readable; 401 when signed out", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '042_creator_analytics' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "042_creator_analytics"]);
  await assert.rejects(() => db().get("SELECT 1 FROM content_attention"));
  assert.deepEqual(await mig.up(db()), ["042_creator_analytics", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const t of ["content_attention", "audience_events"]) { const m = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [V[0].id]); }
  const anon = new H.Client();
  for (const p of ["overview", "audience", "content", "earnings", "compare", "export.csv"]) assert.equal((await anon.req("GET", "/api/creator/analytics/" + p)).status, 401, p);
  const b = await anon.req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 5000 }); assert.equal(b.status, 200); assert.equal(b.recorded, false, "anonymous viewers are never recorded");
});

test("attention beacon: records per viewer and day, caps time, keeps the furthest progress, ignores own posts", async () => {
  const own = await cre.req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 9000, progress: 50 }); assert.equal(own.recorded, false); assert.equal(own.reason, "own");
  assert.equal((await V[0].req("POST", "/api/analytics/attention", { post: "p_nope", ms: 9000 })).status, 404);
  assert.equal((await V[0].req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 300 })).recorded, false, "a glance is not attention");
  assert.equal((await V[0].req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 60000, progress: 40 })).recorded, true);
  assert.equal((await V[0].req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 99 * 60e3, progress: 95 })).recorded, true);
  assert.equal((await V[0].req("POST", "/api/analytics/attention", { post: posts[0].id, ms: 1000, progress: 10 })).recorded, true);
  const rows = await db().all("SELECT * FROM content_attention WHERE post=$1 AND user_id=$2", [posts[0].id, V[0].id]);
  assert.equal(rows.length, 1, "one row per viewer per day");
  assert.equal(Number(rows[0].ms), 60000 + 30 * 60e3 + 1000, "a single beacon is capped at 30 min");
  assert.equal(Number(rows[0].progress), 95, "furthest progress kept");
  assert.equal(rows[0].author, cre.id);
  // a few more viewers, some finishing the article
  for (const [i, ms, pr] of [[1, 120000, 100], [2, 30000, 30], [3, 45000, 92]]) assert.equal((await V[i].req("POST", "/api/analytics/attention", { post: posts[0].id, ms, progress: pr })).recorded, true);
  assert.equal((await V[4].req("POST", "/api/analytics/attention", { post: posts[1].id, kind: "video", mediaMs: 20000, progress: 100 })).recorded, true);
});

test("overview: KPIs, follower flow with unfollows, previous-period deltas, daily series, week trend", async () => {
  for (let i = 0; i < 7; i++) for (const p of posts.slice(0, i % 3 + 1)) assert.equal((await V[i].req("POST", `/api/posts/${p.id}/view`, { source: "feed" })).status, 200);
  for (let i = 0; i < 6; i++) assert.equal((await V[i].req("PUT", "/api/follows/" + cre.id)).status, 200);
  assert.equal((await V[5].req("DELETE", "/api/follows/" + cre.id)).status, 200);
  await wait(150); // bus delivery is async
  const ev = await db().all("SELECT kind FROM audience_events WHERE creator_id=$1", [cre.id]);
  assert.equal(ev.filter((e) => e.kind === "follow").length, 6); assert.equal(ev.filter((e) => e.kind === "unfollow").length, 1);
  // a previous period: 2 older views (40 days ago) by V0 and V1
  const old = new Date(Date.now() - 40 * DAY).toISOString();
  for (const v of [V[0], V[1]]) await db().run("INSERT INTO post_views(post,user_id,source,at) VALUES($1,$2,'feed',$3)", [posts[0].id, v.id, old]);
  clearCache();
  const o = await cre.req("GET", "/api/creator/analytics/overview?days=28&tz=180"); assert.equal(o.status, 200, o.error);
  const views = (await db().all("SELECT COUNT(*) n FROM post_views v JOIN posts p ON p.id=v.post WHERE p.author=$1 AND v.at > $2", [cre.id, new Date(Date.now() - 28 * DAY).toISOString()]))[0].n;
  assert.equal(o.kpis.views, Number(views)); assert.equal(o.kpis.reach, 7);
  assert.equal(o.kpis.followersGained, 6); assert.equal(o.kpis.followersLost, 1); assert.equal(o.kpis.followersNet, 5);
  assert.equal(o.previous.views, 2); assert.equal(o.previous.reach, 2);
  assert.equal(o.deltas.views, Math.round((o.kpis.views - 2) / 2 * 100));
  assert.ok(o.kpis.avgAttentionSeconds > 0); assert.ok(o.kpis.completionRate > 0 && o.kpis.completionRate <= 100);
  assert.ok(o.daily.views.length >= 28 && o.daily.views.length <= 29, String(o.daily.views.length)); assert.equal(o.daily.views.reduce((a, d) => a + d.value, 0), o.kpis.views);
  assert.ok(Array.isArray(o.weekly) && o.weekly.length >= 4); assert.equal(typeof o.weekTrend, "number");
  assert.equal((await cre.req("GET", "/api/creator/analytics/overview?from=2026-02-01&to=2025-01-01")).status, 400);
  assert.equal((await cre.req("GET", "/api/creator/analytics/overview?from=2024-01-01&to=2026-01-01")).status, 400, "≤ 1 year");
  const other0 = await other.req("GET", "/api/creator/analytics/overview"); assert.equal(other0.kpis.views, 0, "another creator sees only their own numbers");
});

test("audience: growth series ends at today's follower total, returning viewers, cohorts, k-anonymous demographics", async () => {
  const a = await cre.req("GET", "/api/creator/analytics/audience?days=28"); assert.equal(a.status, 200, a.error);
  assert.equal(a.followers, 5); assert.equal(a.growth[a.growth.length - 1].total, 5);
  assert.equal(a.growth.reduce((s, g) => s + g.net, 0), 5); assert.equal(a.gained, 6); assert.equal(a.lost, 1);
  assert.equal(a.retention.previousViewers, 2); assert.equal(a.retention.returning, 2); assert.equal(a.retention.returningRate, 100); assert.equal(a.retention.newViewers, 5);
  assert.equal(a.retention.cohorts.length >= 1, true); const c = a.retention.cohorts[a.retention.cohorts.length - 1]; assert.equal(c.gained, 6); assert.equal(c.retained, 5);
  assert.equal(a.activeFollowers.count, 5);
  const D = a.demographics; assert.equal(D.k, 5);
  assert.equal(D.countries.shown, true); assert.deepEqual(D.countries.buckets.map((b) => b.key), ["SA"], "Egypt (1 viewer) is folded and suppressed");
  assert.equal(D.countries.suppressed, 1); assert.equal(D.countries.buckets[0].label, "السعودية");
  assert.deepEqual(D.languages.buckets.map((b) => b.key), ["ar"], "1 English viewer is not shown on its own");
  assert.ok(!JSON.stringify(a).includes("ca_v"), "no viewer handles anywhere");
  assert.ok(!JSON.stringify(D).includes(V[6].id));
  // fewer than K viewers in total → nothing shown at all
  H.app.ctx.rl.w.clear();
  const op = (await other.req("POST", "/api/posts", { type: "post", text: "منشور للآخر" })).post;
  for (const v of V.slice(0, 3)) await v.req("POST", `/api/posts/${op.id}/view`, {});
  const o = await other.req("GET", "/api/creator/analytics/audience");
  assert.equal(o.demographics.countries.shown, false); assert.deepEqual(o.demographics.countries.buckets, []); assert.equal(o.demographics.devices.shown, false);
});

test("content: per-post metrics, attention + completion, medians, type filter, sorting, best time from own results", async () => {
  const c = await cre.req("GET", "/api/creator/analytics/content?days=28&sort=attention"); assert.equal(c.status, 200, c.error);
  assert.equal(c.count, 3); const art = c.posts.find((p) => p.id === posts[0].id);
  assert.equal(art.type, "article"); assert.equal(art.typeLabel, "مقال"); assert.equal(art.attentionSessions, 4);
  assert.equal(art.completionRate, 75, "3 of 4 readers reached ≥ 90 %"); assert.ok(art.avgAttentionSeconds > 60);
  assert.equal(c.posts[0].id, posts[0].id, "sorted by attention");
  assert.equal(art.reach, 7); assert.ok(art.views >= 7);
  assert.ok(typeof art.vsMedian.views === "number"); assert.ok(c.medians.views > 0);
  const byType = Object.fromEntries(c.byType.map((t) => [t.type, t])); assert.equal(byType.article.posts, 1); assert.equal(byType.post.posts, 2);
  const f = await cre.req("GET", "/api/creator/analytics/content?type=article"); assert.equal(f.count, 1);
  assert.equal(c.bestTime.source, "own", "3 posts in the same slot"); assert.equal(c.bestTime.slots[0].posts, 3);
  const e = await other.req("GET", "/api/creator/analytics/content"); assert.ok(["audience", "none", "own"].includes(e.bestTime.source));
});

test("earnings: every stream from the ledger (gross = net + fee), reversals, ad spend, supporters, previous period", async () => {
  const s1 = V[0].id, s2 = V[1].id, tip = 20000000, fee = 1000000;
  await post({ ikey: "t61:tip", kind: "tip", source: "tip", refId: "tip_61", creatorId: cre.id, senderId: s1, lines: [{ account: ACC.out(s1), userId: s1, debit: tip }, { account: ACC.earn(cre.id), userId: cre.id, credit: tip - fee }, { account: ACC.fees, credit: fee }] });
  await post({ ikey: "t61:sup", kind: "support", source: "support", refId: "sup_61", creatorId: cre.id, senderId: s2, lines: [{ account: ACC.out(s2), userId: s2, debit: 30000000 }, { account: ACC.earn(cre.id), userId: cre.id, credit: 30000000 }] });
  await post({ ikey: "t61:ppv", kind: "ppv", source: "ppv", refId: "ppv_61", creatorId: cre.id, senderId: s2, lines: [{ account: ACC.out(s2), userId: s2, debit: 5000000 }, { account: ACC.earn(cre.id), userId: cre.id, credit: 5000000 }] });
  await post({ ikey: "t61:mkt", kind: "market_release", source: "market", refId: "ord_61", senderId: s1, lines: [{ account: "escrow:market", debit: 8000000 }, { account: `seller:${cre.id}:earnings`, userId: cre.id, credit: 7600000 }, { account: ACC.fees, credit: 400000 }] });
  await post({ ikey: "t61:ads", kind: "ads_fund", source: "ads", refId: "ad_61", senderId: cre.id, lines: [{ account: ACC.out(cre.id), userId: cre.id, debit: 3000000 }, { account: "platform:ads_budget", credit: 3000000 }] });
  // the ppv was refunded: a reversal debits the creator's earnings
  await post({ ikey: "t61:ppv:rev", kind: "reversal", source: "ppv", refId: "ppv_61", creatorId: cre.id, senderId: s2, reverses: "x", lines: [{ account: ACC.earn(cre.id), userId: cre.id, debit: 5000000 }, { account: ACC.out(s2), userId: s2, credit: 5000000 }] });
  // previous period: an older tip, 40 days ago
  const jid = await post({ ikey: "t61:old", kind: "tip", source: "tip", refId: "tip_61o", creatorId: cre.id, senderId: s1, lines: [{ account: ACC.out(s1), userId: s1, debit: 10000000 }, { account: ACC.earn(cre.id), userId: cre.id, credit: 10000000 }] });
  await db().run("UPDATE ledger_journals SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 40 * DAY).toISOString(), jid]);
  const e = await cre.req("GET", "/api/creator/analytics/earnings?days=28"); assert.equal(e.status, 200, e.error);
  const S = Object.fromEntries(e.streams.map((s) => [s.key, s]));
  assert.equal(S.tips.net, 1.9); assert.equal(S.tips.fees, 0.1); assert.equal(S.tips.gross, 2);
  assert.equal(S.subs.net, 3); assert.equal(S.paid.net, 0); assert.equal(S.paid.reversed, 0.5); assert.equal(S.market.net, 0.76); assert.equal(S.market.fees, 0.04);
  assert.equal(e.totals.net, 1.9 + 3 + 0.76); assert.equal(e.totals.adSpend, 0.3); assert.equal(e.totals.afterAds, Math.round((5.66 - 0.3) * 1e7) / 1e7);
  assert.equal(e.totals.supporters, 2); assert.equal(e.previous.net, 1); assert.equal(e.deltas.net, Math.round((5.66 - 1) / 1 * 100));
  assert.equal(e.daily.reduce((a, d) => a + d.value, 0).toFixed(4), (5.66).toFixed(4));
  assert.equal(S.tips.previousNet, 1);
  assert.equal(e.piEnabled, false); assert.ok(e.note, "explains Pi payments are off");
  const o = await other.req("GET", "/api/creator/analytics/earnings"); assert.equal(o.totals.net, 0, "nobody else's earnings leak");
});

test("compare two ranges; CSV exports with BOM, headers, formula-injection guard", async () => {
  const day = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10);
  const c = await cre.req("GET", `/api/creator/analytics/compare?aFrom=${day(-60)}&aTo=${day(-30)}&bFrom=${day(-29)}&bTo=${day(0)}`); assert.equal(c.status, 200, c.error);
  assert.equal(c.a.kpis.views, 2); assert.ok(c.b.kpis.views > 2); assert.ok(c.deltas.views > 0); assert.ok(c.keys.includes("earningsNet"));
  assert.equal((await cre.req("GET", "/api/creator/analytics/compare?aFrom=2026-01-01")).status, 400);
  for (const [rep, head] of [["audience", "day,gained,lost,net,total_followers"], ["content", "published_at,type,title"], ["earnings", "stream,gross_pi"]]) {
    const r = await fetch(H.base + "/api/creator/analytics/export.csv?report=" + rep, { headers: { Cookie: cre.cookie, "X-Requested-With": "mujtama" } });
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /text\/csv/); assert.match(r.headers.get("content-disposition"), new RegExp(`creator-${rep}-`));
    const buf = Buffer.from(await r.arrayBuffer()); assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM");
    const t = buf.toString("utf8").slice(1); assert.ok(t.startsWith(head), t.slice(0, 80));
    if (rep === "content") { assert.match(t, /"'=HYPERLINK/); assert.ok(!/,=HYPERLINK/.test(t)); }
    if (rep === "earnings") assert.match(t, /الإكراميات/);
  }
  assert.equal((await cre.req("GET", "/api/creator/analytics/export.csv?report=nope")).status, 400);
});

test("pure helpers: kAnon folding / suppression, device classes, csv cells", () => {
  assert.deepEqual(CA.kAnon({ SA: 3 }, 5), { total: 3, shown: false, buckets: [], suppressed: 1 });
  const k = CA.kAnon({ SA: 10, EG: 5, AE: 2, KW: 3 }, 5); assert.deepEqual(k.buckets.map((b) => b.key), ["SA", "EG", "other"]); assert.equal(k.buckets[2].share, 25); assert.equal(k.suppressed, 0);
  const k2 = CA.kAnon({ SA: 10, EG: 2 }, 5); assert.deepEqual(k2.buckets.map((b) => b.key), ["SA"]); assert.equal(k2.suppressed, 1);
  assert.equal(CA.deviceOf(UAS[0]), "mobile"); assert.equal(CA.deviceOf(UAS[2]), "desktop"); assert.equal(CA.deviceOf(UAS[3]), "tablet"); assert.equal(CA.deviceOf(UAS[4]), "pi");
  assert.equal(CA.csvCell("=1+1"), `"'=1+1"`); assert.equal(CA.csvCell("@x"), `"'@x"`); assert.equal(CA.csvCell('a,"b"'), `"a,""b"""`); assert.equal(CA.csvCell("نص"), "نص");
});

test("v2.29 post drilldown: owner only, totals, daily series since publication, depth buckets, sources, rank vs own posts", async () => {
  const id = posts[0].id;
  assert.equal((await other.req("GET", "/api/creator/analytics/post/" + id)).status, 404, "someone else's post is not drillable");
  assert.equal((await new H.Client().req("GET", "/api/creator/analytics/post/" + id)).status, 401);
  const d = await cre.req("GET", "/api/creator/analytics/post/" + id);
  assert.equal(d.status, 200, d.error);
  assert.equal(d.post.id, id); assert.equal(d.post.typeLabel, "مقال");
  assert.ok(d.totals.views >= 7 && d.totals.reach === 7, JSON.stringify(d.totals));
  assert.ok(d.daily.views.length >= 1 && d.daily.views.length <= 30);
  assert.equal(d.daily.views.reduce((a, x) => a + x.value, 0) <= d.totals.views, true);
  assert.ok(Array.isArray(d.sources) && d.sources.length >= 1 && d.sources.every((s) => s.label && !("user" in s)), "sources are screens, never people");
  if (d.totals.attentionSessions >= 3) { assert.equal(d.depth.length, 5); assert.ok(Math.abs(d.depth.reduce((a, b) => a + b.share, 0) - 100) < 1); }
  assert.ok(d.versus.rank >= 1 && d.versus.of >= 3, JSON.stringify(d.versus));
  assert.ok(Array.isArray(d.tips));
});

test("v2.29 goals: set / update / delete, live progress, validation; insights: plain tips, empty-state for a new creator", async () => {
  assert.equal((await cre.req("PUT", "/api/creator/analytics/goals", { metric: "nope", target: 5 })).status, 400);
  assert.equal((await cre.req("PUT", "/api/creator/analytics/goals", { metric: "followers", target: -1 })).status, 400);
  let g = await cre.req("PUT", "/api/creator/analytics/goals", { metric: "followers", target: 100 }); assert.equal(g.status, 200, g.error);
  g = await cre.req("PUT", "/api/creator/analytics/goals", { metric: "posts", target: 2 });
  assert.deepEqual(g.goals.map((x) => x.metric).sort(), ["followers", "posts"]);
  const pg = g.goals.find((x) => x.metric === "posts"); assert.ok(pg.current >= 0 && pg.percent <= 100);
  const fg = g.goals.find((x) => x.metric === "followers"); assert.equal(fg.current, Number((await db().get("SELECT COUNT(*) n FROM follows WHERE dst=$1", [cre.id])).n));
  g = await cre.req("PUT", "/api/creator/analytics/goals", { metric: "followers", target: 1 }); assert.equal(g.goals.find((x) => x.metric === "followers").target, 1);
  g = await cre.req("DELETE", "/api/creator/analytics/goals/posts"); assert.deepEqual(g.goals.map((x) => x.metric), ["followers"]);
  assert.equal((await other.req("GET", "/api/creator/analytics/goals")).goals.length, 0, "goals are per creator");
  const i = await cre.req("GET", "/api/creator/analytics/insights"); assert.equal(i.status, 200, i.error); assert.equal(i.empty, false);
  assert.ok(i.insights.length >= 1 && i.insights.every((x) => x.title && x.body && ["good", "tip", "warn"].includes(x.tone)), JSON.stringify(i.insights));
  const fresh = await mk("ca_fresh"); const e = await fresh.req("GET", "/api/creator/analytics/insights"); assert.equal(e.empty, true); assert.equal(e.insights[0].id, "first");
  const ex = require("../lib/compliance-lib").DATA_MAP.find((x) => x.t === "creator_goals"); assert.ok(ex, "goals are in the data map");
});
