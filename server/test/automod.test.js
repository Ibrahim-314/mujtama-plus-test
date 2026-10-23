/* Track 7 — Phase 31 automatic moderation: classifier verdicts through the API, quarantine instead of
 * deletion (author-only visibility, gentle explanation), smart delay → auto release / escalation on reports,
 * author edit releases, threats escalate into the admin report queue, removal → appealable decision,
 * malicious links + admin domain list, held comments, flagged private messages, image screening through
 * the durable queue (sensitive blur + hash block list), optional model on borderline content,
 * adaptive rate limits by account age, the «هل أنت متأكد؟» check endpoint, and the automod migration. */
const test = require("node:test"), assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { boot } = require("./helpers");

let H, ctx, AM, ADM, U, V, W;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = () => ctx.db;
const mk = async (handle) => { const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" }); assert.equal(r.status, 200, r.error); c.id = r.user.id; return c; };
const settle = async () => { await sleep(120); await ctx.queue.drain(20e3); await sleep(60); };
const status = async (table, id) => (await db().get(`SELECT status FROM ${table} WHERE id=$1`, [id]))?.status;
const age = (uid, days) => db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - days * 864e5).toISOString(), uid]);

test.before(async () => {
  H = await boot({ adaptiveRateLimits: true, automodEnv: { AUTOMOD_DELAY_MIN: "10" }, queuePollMs: 100 });
  ctx = H.app.ctx;
  AM = ctx.services.automod || (ctx.services.automod = require("../services/automod")(ctx)); // registered by server.js after integration
  ADM = await mk("am_admin"); await db().run("UPDATE users SET role='admin' WHERE id=$1", [ADM.id]);
  U = await mk("am_user"); V = await mk("am_viewer"); W = await mk("am_writer");
  await age(U.id, 20); await age(V.id, 20); // established (standard tier); W stays brand new
});
test.after(() => H.app.close());
test.beforeEach(() => ctx.rl.w.clear());

test("migration 014 is applied and additive", async () => {
  assert.ok((await db().get("SELECT id FROM schema_migrations WHERE id='014_automod'")));
  for (const t of ["automod_items", "automod_domains", "automod_hashes", "automod_nudges"]) assert.ok(await db().all(`SELECT * FROM ${t} LIMIT 1`));
});

test("check endpoint: hostile reply → nudge with gentle Arabic copy; friendly text → none; nothing stored", async () => {
  let r = await U.req("POST", "/api/automod/check", { text: "انت غبي وما تفهم شي" });
  assert.equal(r.nudge, true); assert.ok(["gentle", "strong"].includes(r.level)); assert.match(r.message, /مراجعته|إعادة صياغته/); assert.ok(r.explanations.length);
  r = await U.req("POST", "/api/automod/check", { text: "راح اقتلك" }); assert.equal(r.level, "strong");
  r = await U.req("POST", "/api/automod/check", { text: "شكراً على الشرح الرائع 🌷" }); assert.equal(r.nudge, false); assert.equal(r.message, null);
  r = await U.req("POST", "/api/automod/check", { text: "ادخل https://minep1.com/wallet وأرسل عبارة المرور" }); assert.equal(r.level, "risky");
  assert.equal((await U.req("POST", "/api/automod/nudge", { level: "gentle", outcome: "edited" })).status, 200);
  assert.equal((await U.req("POST", "/api/automod/nudge", { level: "x", outcome: "edited" })).status, 400);
  assert.equal((await new H.Client().req("POST", "/api/automod/check", { text: "x" })).status, 401);
});

test("clean post is untouched; abusive post is quarantined (author-only) with a gentle explanation", async () => {
  const ok = (await U.req("POST", "/api/posts", { text: "صباح الخير يا أصدقاء، يوم موفق" })).post; await settle();
  assert.equal(await status("posts", ok.id), "published"); assert.equal(await AM.itemFor("post", ok.id), null);
  const bad = (await U.req("POST", "/api/posts", { text: "انت حقير ووسخ يا كلب" })).post; await settle();
  assert.equal(await status("posts", bad.id), "held");
  assert.equal((await V.req("GET", "/api/posts/" + bad.id)).status, 404, "hidden from others");
  assert.equal((await U.req("GET", "/api/posts/" + bad.id)).post.status, "held", "visible to its author");
  const mine = await U.req("GET", "/api/automod/mine"); const it = mine.items.find(i => i.target === bad.id);
  assert.ok(it && ["held", "escalated"].includes(it.state)); assert.match(it.explanations.join(" "), /إساءة/); assert.match(it.help, /لن يُحذف دون مراجعة بشرية/);
  assert.equal((await V.req("GET", "/api/automod/explain/" + bad.id)).status, 404, "explanations are private");
  assert.ok((await db().get("SELECT 1 x FROM posts WHERE id=$1", [bad.id])), "never deleted");
});

test("author edits a held post into something acceptable → released automatically", async () => {
  const p = (await U.req("POST", "/api/posts", { text: "انت غبي وتافه" })).post; await settle();
  assert.equal(await status("posts", p.id), "held");
  assert.equal((await U.req("PATCH", "/api/posts/" + p.id, { text: "أختلف معك في الرأي، وهذا وجهة نظري" })).status, 200); await settle();
  assert.equal(await status("posts", p.id), "published");
  assert.equal((await AM.itemFor("post", p.id)).state, "released");
});

test("threat → escalated with a system report for admins; admin removal creates an appealable decision", async () => {
  const p = (await U.req("POST", "/api/posts", { text: "اعرف وين ساكن وراح اذبحك" })).post; await settle();
  const item = await AM.itemFor("post", p.id); assert.equal(item.state, "escalated"); assert.ok(item.reasons.includes("threat"));
  const dash = await ADM.req("GET", "/api/admin/dashboard"); assert.ok(dash.reports.some(r => r.target === p.id && r.by_user === "system"));
  const q = await ADM.req("GET", "/api/admin/automod"); const qi = q.items.find(i => i.target === p.id); assert.ok(qi && qi.categories.threat >= 0.8);
  assert.equal((await U.req("GET", "/api/admin/automod")).status, 403);
  const r = await ADM.req("POST", "/api/admin/automod/" + qi.id, { action: "remove", reason: "تهديد صريح" }); assert.ok(r.decision);
  assert.equal(await status("posts", p.id), "removed");
  assert.equal((await ADM.req("POST", "/api/admin/automod/" + qi.id, { action: "release" })).status, 409);
  const ap = await U.req("POST", "/api/appeals", { decision: r.decision, text: "كنت أمزح مع صديقي" }); assert.ok(ap.id, "the normal appeal flow applies");
});

test("smart delay: borderline post waits, then publishes; a reported one escalates instead", async () => {
  const a = (await W.req("POST", "/api/posts", { text: "صراحة كلامك غ ب ي" })).post; await settle();
  let it = await AM.itemFor("post", a.id); assert.equal(it.state, "delayed", "new account + borderline → delay"); assert.ok(it.release_at);
  assert.equal((await V.req("GET", "/api/posts/" + a.id)).status, 404);
  const b = (await W.req("POST", "/api/posts", { text: "رأيك غ.ب.ي يا صاحبي" })).post; await settle();
  assert.equal((await AM.itemFor("post", b.id)).state, "delayed");
  assert.equal((await V.req("POST", "/api/reports", { target: b.id, kind: "post", reason: "إساءة" })).status, 200);
  await db().run("UPDATE automod_items SET release_at=$1 WHERE target_id IN ($2,$3)", [new Date(Date.now() - 1000).toISOString(), a.id, b.id]);
  const r = await AM.releaseDue(); assert.equal(r.released, 1); assert.equal(r.escalated, 1);
  assert.equal(await status("posts", a.id), "published"); assert.equal((await V.req("GET", "/api/posts/" + a.id)).status, 200);
  assert.equal(await status("posts", b.id), "held"); assert.equal((await AM.itemFor("post", b.id)).state, "escalated");
  it = (await ADM.req("GET", "/api/admin/automod")).items.find(i => i.target === b.id);
  await ADM.req("POST", "/api/admin/automod/" + it.id, { action: "release", reason: "نقد مقبول" });
  assert.equal(await status("posts", b.id), "published");
});

test("malicious links: mismatched display text, shorteners from new accounts, admin domain list", async () => {
  const a = (await W.req("POST", "/api/posts", { text: "حدّث محفظتك من هنا [minepi.com](https://minepi-update.example/login)" })).post; await settle();
  const it = await AM.itemFor("post", a.id); assert.ok(["held", "escalated"].includes(it.state)); assert.ok(it.reasons.includes("link"));
  assert.ok(it.signals.links.some(l => l.codes.includes("mismatch")));
  const mine = (await W.req("GET", "/api/automod/mine")).items.find(i => i.target === a.id); assert.match(mine.explanations.join(" "), /رابطاً/);
  const b = (await W.req("POST", "/api/posts", { text: "شوفوا bit.ly/3xYz12" })).post; await settle();
  assert.equal((await AM.itemFor("post", b.id)).state, "delayed");
  const c = (await U.req("POST", "/api/posts", { text: "مقال جميل https://news-site.example/a" })).post; await settle();
  assert.equal(await status("posts", c.id), "published");
  const dr = await ADM.req("POST", "/api/admin/automod/domains", { domain: "https://www.news-site.example/x", reason: "تصيّد" }); assert.equal(dr.domain, "news-site.example", JSON.stringify(dr));
  const d = (await U.req("POST", "/api/posts", { text: "مقال آخر https://news-site.example/b" })).post; await settle();
  assert.equal((await AM.itemFor("post", d.id)).state, "escalated", "known-bad domain escalates");
  assert.ok((await ADM.req("GET", "/api/admin/automod/lists")).domains.some(x => x.domain === "news-site.example"));
});

test("comments are held too (not listed for others); private messages are flagged for recipients, never hidden", async () => {
  const p = (await V.req("POST", "/api/posts", { text: "ما رأيكم في التحديث الجديد؟" })).post;
  const cm = (await U.req("POST", "/api/comments", { post: p.id, text: "انت حمار ومتخلف" })).comment; await settle();
  assert.equal(await status("comments", cm.id), "held");
  assert.ok(!(await V.req("GET", `/api/posts/${p.id}/comments`)).comments.some(c => c.id === cm.id));
  assert.ok((await U.req("GET", "/api/automod/mine")).items.some(i => i.target === cm.id && i.kind === "comment"));
  await U.req("PUT", `/api/follows/${V.id}`);
  const conv = (await V.req("POST", "/api/conversations", { user: U.id })).conversation.id;
  const m = await V.req("POST", `/api/chat/conversations/${conv}/messages`, { text: "مبروك ربحت! أكد حسابك هنا https://minep1.com/claim" }); assert.equal(m.status, 200, m.error); await settle();
  const flags = await U.req("GET", "/api/automod/flags/" + conv); assert.equal(flags.flags.length, 1); assert.ok(flags.flags[0].links.length);
  assert.equal((await V.req("GET", "/api/automod/flags/" + conv)).flags.length, 0, "the sender is not shown their own flag");
  assert.equal((await W.req("GET", "/api/automod/flags/" + conv)).status, 404, "only members");
});

test("images: skin-heavy image marks the post sensitive (blur, not hidden); a blocked hash escalates re-uploads", async (t) => {
  let png;
  try { png = execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xD99A7A:s=96x96", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]); } catch { return t.skip("ffmpeg not available"); }
  const up = async (c) => { const r = await fetch(H.base + "/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "image/png", Cookie: c.cookie }, body: png }); return (await r.json()).media; };
  const m1 = await up(U);
  const p = (await U.req("POST", "/api/posts", { text: "صورة من رحلتي", images: [m1.url] })).post; await settle();
  const row = await db().get("SELECT status, sensitive FROM posts WHERE id=$1", [p.id]);
  assert.equal(row.status, "published"); assert.equal(Number(row.sensitive), 1);
  const rec = await AM.itemFor("post", p.id); assert.equal(rec.state, "cleared"); assert.ok(rec.signals.images[0].reasons.some(r => r.startsWith("skin")));
  const h = await ADM.req("POST", "/api/admin/automod/hashes", { media: m1.id, label: "اختبار" }); assert.match(String(h.sha256), /^[0-9a-f]{64}$/, JSON.stringify(h)); assert.match(h.sha256, /^[0-9a-f]{64}$/);
  const m2 = await up(V);
  const p2 = (await V.req("POST", "/api/posts", { text: "صورة", images: [m2.url] })).post; await settle();
  const it = await AM.itemFor("post", p2.id); assert.equal(it.state, "escalated"); assert.ok(it.reasons.includes("image"));
  assert.equal(await status("posts", p2.id), "held");
});

test("optional model refines borderline content (released early when it says clean)", async () => {
  ctx.config.automodEnv.AUTOMOD_LLM = "1";
  ctx.llm.classify = async ({ text }) => ({ score: /اقتراح/.test(text) ? 0.05 : 0.9, provider: "fake" });
  try {
    const p = (await W.req("POST", "/api/posts", { text: "اقتراح غ ب ي لكن مفيد" })).post; await settle();
    const it = await AM.itemFor("post", p.id); assert.equal(it.state, "released"); assert.equal(it.signals.llm?.score ?? 0.05, 0.05);
    assert.equal(await status("posts", p.id), "published");
  } finally { delete ctx.config.automodEnv.AUTOMOD_LLM; delete ctx.llm.classify; }
});

test("adaptive rate limits: new accounts get calmer limits, trusted ones looser; transparency endpoint", async () => {
  const N = await mk("am_newbie");
  const lim = await N.req("GET", "/api/automod/limits"); assert.equal(lim.tier, "new"); assert.equal(lim.limits.post.max, 6); assert.match(lim.note, /الحسابات الجديدة/);
  let ok = 0, limited = false;
  for (let i = 0; i < 8; i++) { const r = await N.req("POST", "/api/posts", { text: "تجربة النشر رقم " + i }); if (r.status === 200) ok++; if (r.status === 429) limited = true; }
  assert.equal(ok, 6); assert.ok(limited);
  assert.equal((await ADM.req("GET", "/api/automod/limits")).limits.post.max, 16, "trusted ×2");
  assert.equal((await V.req("GET", "/api/automod/limits")).tier, "standard");
  const r = await U.req("GET", "/api/automod/limits"); assert.equal(r.tier, "restricted", "several holds this week → calmer limits"); assert.equal(r.limits.post.max, 4);
  const stats = await ADM.req("GET", "/api/admin/automod/stats"); assert.ok(Object.values(stats.states).reduce((a, b) => a + b, 0) >= 8, JSON.stringify(stats.states)); assert.ok(stats.states.released >= 3); assert.equal(stats.nudges.shown, 1); assert.equal(stats.adaptiveRateLimits, true);
});

test("zero-window gate (optional content.js hook): held before insert, released emits POST_PUBLISHED once", async () => {
  const user = await db().get("SELECT * FROM users WHERE id=$1", [V.id]);
  assert.equal(await AM.gate(user, { kind: "post", id: "p_gate000001", text: "مرحبا بالجميع", status: "published" }), "published");
  assert.equal(await AM.gate({ ...user, role: "admin" }, { kind: "post", id: "p_gate000003", text: "انت حقير ووسخ" }), "published");
  // simulate content.js with the hook: status decided before INSERT, POST_PUBLISHED not emitted while held
  const pid = "p_gate000002", text = "انت حقير ووسخ وتافه";
  const st = await AM.gate(user, { kind: "post", id: pid, text, status: "published" }); assert.equal(st, "held");
  await db().run("INSERT INTO posts(id,author,type,text,visibility,status,data,created_at) VALUES($1,$2,'post',$3,'public',$4,$5,$6)", [pid, V.id, text, st, {}, new Date().toISOString()]);
  const published = []; ctx.bus.on("POST_PUBLISHED", e => published.push(e.post?.id));
  ctx.bus.emit("POST_CREATED", { post: await db().get("SELECT * FROM posts WHERE id=$1", [pid]), actor: V.id }); await settle();
  const it = await AM.itemFor("post", pid); assert.equal(it.source, "precheck"); assert.equal(it.prev_status, "published"); assert.equal(published.length, 0);
  const qi = (await ADM.req("GET", "/api/admin/automod")).items.find(i => i.target === pid);
  await ADM.req("POST", "/api/admin/automod/" + qi.id, { action: "release" }); await sleep(50);
  assert.equal(await status("posts", pid), "published"); assert.deepEqual(published, [pid]);
});
