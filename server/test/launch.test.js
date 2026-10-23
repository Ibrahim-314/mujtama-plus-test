/* Phase 50 — launch readiness. SQLite by default, PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 033 (down/up, static additive), help center (seeded Arabic articles + FAQ, normalised Arabic search, drafts hidden,
 * staff-only editing, slug clash), support tickets (open with own media only, owner/staff visibility, other user 404, internal notes hidden,
 * staff reply → answered, user reply reopens, status rules, queue counts, assignment), ambassadors (apply, staff review with reasons,
 * ref code + referral on sign-up, stats, invites, revoke, public list), LAUNCH_MODE (default open; invite: register needs a valid code,
 * codes are single-use/expire/revoke, waitlist sign-up + position, invite-from-waitlist, NEW Pi accounts parked until a code is given,
 * existing accounts untouched), data-map registration. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const ENV = {};
let H, admin, mod, sara, bob;
const db = () => H.app.ctx.db;
const clear = () => H.app.ctx.rl.w.clear();
const mk = async (handle, extra = {}) => {
  clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123", ...extra });
  if (r.status !== 200) return Object.assign(c, { res: r });
  c.id = r.user.id; c.handle = handle; return c;
};

test.before(async () => {
  H = await boot({ piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { jobs: false, env: {} }, translateOpts: { env: {} }, assistantOpts: { jobs: false, env: {} }, launchOpts: { env: ENV } });
  admin = await mk("ln_admin"); mod = await mk("ln_mod"); sara = await mk("ln_sara"); bob = await mk("ln_bob");
  await db().run("UPDATE users SET role='moderator' WHERE id=$1", [mod.id]);
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 033: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '033_launch' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "033_launch"]);
  await assert.rejects(() => db().get("SELECT 1 FROM support_tickets"));
  assert.deepEqual(await mig.up(db()), ["033_launch", ...later]);
  for (const t of ["help_articles", "support_tickets", "support_messages", "ambassadors", "ambassador_referrals", "launch_invites", "launch_invite_uses", "launch_waitlist", "launch_meta"])
    assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  const L = require("../lib/compliance-lib");
  const mapped = new Set([...L.DATA_MAP.map((m) => m.t), ...L.SYSTEM_RECORDS.flatMap((m) => m.t.split(" / "))]);
  for (const t of ["support_tickets", "support_messages", "ambassadors", "ambassador_referrals", "launch_waitlist", "launch_invite_uses", "help_articles", "launch_invites", "launch_meta"]) assert.ok(mapped.has(t), t);
  for (const m of L.DATA_MAP.filter((x) => ["support_tickets", "support_messages", "ambassadors", "ambassador_referrals", "launch_waitlist", "launch_invite_uses"].includes(x.t)))
    await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [sara.id]);
});

test("help center: Arabic seed, normalised search, FAQ bodies, drafts hidden, staff-only editing", async () => {
  const anon = new H.Client();
  const all = await anon.req("GET", "/api/helpcenter/articles");
  assert.equal(all.status, 200, all.error); assert.ok(all.items.length >= 10);
  const faq = await anon.req("GET", "/api/helpcenter/articles?kind=faq");
  assert.ok(faq.items.length >= 5 && faq.items.every((a) => a.kind === "faq" && a.body));
  const s = await anon.req("GET", "/api/helpcenter/articles?q=" + encodeURIComponent("الإبلاغ عن الاساءة"));
  assert.ok(s.items.some((a) => a.slug === "report-abuse"), "hamza-insensitive search");
  assert.equal((await anon.req("GET", "/api/helpcenter/articles?q=zzzzqq")).items.length, 0);
  const one = await anon.req("GET", "/api/helpcenter/articles/getting-started"); assert.ok(one.article.body.length > 20);
  assert.equal((await sara.req("POST", "/api/admin/helpcenter/articles", { title: "x", body: "y" })).status, 403);
  assert.equal((await anon.req("POST", "/api/admin/helpcenter/articles", { title: "xx", body: "yy" })).status, 401);
  const c = await mod.req("POST", "/api/admin/helpcenter/articles", { title: "مقالة تجريبية للمحفظة", body: "شرح المحفظة الجديدة", kind: "article", category: "pi", status: "draft", slug: "wallet-draft" });
  assert.equal(c.status, 200, c.error);
  assert.equal((await anon.req("GET", "/api/helpcenter/articles/wallet-draft")).status, 404, "draft hidden");
  assert.ok(!(await anon.req("GET", "/api/helpcenter/articles?q=" + encodeURIComponent("المحفظه الجديده"))).items.length);
  assert.ok((await mod.req("GET", "/api/helpcenter/articles?all=1")).items.some((a) => a.slug === "wallet-draft"));
  assert.equal((await mod.req("POST", "/api/admin/helpcenter/articles", { title: "تكرار", body: "تكرار", slug: "wallet-draft" })).status, 409);
  assert.equal((await mod.req("PUT", "/api/admin/helpcenter/articles/" + c.article.id, { status: "published" })).status, 200);
  assert.ok((await anon.req("GET", "/api/helpcenter/articles?q=" + encodeURIComponent("المحفظه الجديده"))).items.some((a) => a.slug === "wallet-draft"), "edit re-indexes");
  assert.equal((await mod.req("PUT", "/api/admin/helpcenter/articles/" + c.article.id, { category: "nope" })).status, 400);
  assert.equal((await admin.req("DELETE", "/api/admin/helpcenter/articles/" + c.article.id)).status, 200);
  assert.equal((await admin.req("DELETE", "/api/admin/helpcenter/articles/" + c.article.id)).status, 404);
  await H.app.ctx.services.launch.seed();
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM help_articles WHERE slug='wallet-draft'")).n), 0, "never re-seeded");
});

test("support tickets: open, visibility, internal notes, staff replies, statuses, attachments, queue", async () => {
  const t0 = new Date().toISOString();
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES('m_sara1',$1,'image','image/png',10,'k1','ready',$2,$3)", [sara.id, JSON.stringify({ full: "/media/k1.png" }), t0]);
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES('m_bob1',$1,'image','image/png',10,'k2','ready',$2,$3)", [bob.id, JSON.stringify({}), t0]);
  assert.equal((await new H.Client().req("POST", "/api/tickets", { subject: "مشكلة", body: "تفاصيل" })).status, 401);
  assert.equal((await sara.req("POST", "/api/tickets", { subject: "لا أستطيع الدفع", body: "تظهر رسالة خطأ", attachments: ["m_bob1"] })).code, "attachment_invalid");
  const o = await sara.req("POST", "/api/tickets", { subject: "لا أستطيع الدفع", body: "تظهر رسالة خطأ عند الدفع", category: "pi", attachments: ["m_sara1"] });
  assert.equal(o.status, 200, o.error); const tid = o.ticket.id;
  assert.equal(o.ticket.status, "open"); assert.equal(o.messages[0].attachments[0].id, "m_sara1");
  assert.equal((await bob.req("GET", "/api/tickets/" + tid)).status, 404, "other user: no existence oracle");
  assert.equal((await bob.req("POST", "/api/tickets/" + tid + "/messages", { body: "x" })).status, 404);
  assert.equal((await bob.req("GET", "/api/staff/tickets")).status, 403);
  const q = await mod.req("GET", "/api/staff/tickets"); assert.ok(q.items.some((t) => t.id === tid)); assert.equal(q.counts.open >= 1, true);
  assert.equal((await mod.req("POST", "/api/staff/tickets/" + tid + "/assign", { assignee: "me" })).ticket.status, "pending");
  await mod.req("POST", "/api/tickets/" + tid + "/messages", { body: "ملاحظة داخلية: تحقق من سجل Pi", internal: true });
  const r = await mod.req("POST", "/api/tickets/" + tid + "/messages", { body: "مرحباً، جرّب مرة أخرى الآن" });
  assert.equal(r.ticket.status, "answered"); assert.equal(r.messages.length, 3);
  const mine = await sara.req("GET", "/api/tickets/" + tid);
  assert.equal(mine.messages.length, 2, "internal note hidden from the user");
  assert.ok(!JSON.stringify(mine).includes("ملاحظة داخلية")); assert.equal(mine.messages[1].author.name, "فريق الدعم"); assert.equal(mine.messages[1].author.handle, undefined);
  assert.equal((await sara.req("POST", "/api/tickets/" + tid + "/messages", { body: "ما زالت المشكلة" })).ticket.status, "open", "user reply reopens");
  assert.equal((await sara.req("POST", "/api/tickets/" + tid + "/status", { status: "answered" })).status, 403);
  assert.equal((await mod.req("POST", "/api/tickets/" + tid + "/status", { status: "pending", priority: "urgent" })).ticket.priority, "urgent");
  assert.equal((await sara.req("POST", "/api/tickets/" + tid + "/status", { status: "closed" })).ticket.status, "closed");
  assert.equal((await sara.req("POST", "/api/tickets/" + tid + "/messages", { body: "مرحبا" })).code, "ticket_closed");
  assert.equal((await sara.req("GET", "/api/tickets")).items[0].id, tid);
  assert.equal((await bob.req("GET", "/api/tickets")).items.length, 0);
  assert.equal((await mod.req("GET", "/api/staff/tickets?status=closed")).items[0].id, tid);
  const ex = await db().get("SELECT COUNT(*) n FROM support_messages WHERE author_id=$1 AND internal=0", [mod.id]); assert.equal(Number(ex.n), 1);
});

test("ambassadors: apply → review → badge, ref code, referral stats, invites, revoke", async () => {
  assert.equal((await sara.req("POST", "/api/ambassadors/apply", { motivation: "قصير" })).status, 400);
  const a = await sara.req("POST", "/api/ambassadors/apply", { motivation: "أنشط مجتمع المطورين العرب وأود دعوة أصدقائي للمنصة", region: "جدة", links: ["https://example.com/me", "javascript:alert(1)"] });
  assert.equal(a.status, 200, a.error); assert.equal(a.ambassador.status, "pending"); assert.equal(a.ambassador.refCode, null, "no code before approval");
  assert.equal((await sara.req("POST", "/api/ambassadors/apply", { motivation: "مرة أخرى أود الانضمام إلى البرنامج فعلاً" })).code, "already_applied");
  assert.equal((await sara.req("POST", "/api/ambassadors/me/invites")).status, 403);
  assert.equal((await bob.req("GET", "/api/admin/ambassadors")).status, 403);
  const list = await mod.req("GET", "/api/admin/ambassadors"); const row = list.items.find((x) => x.userId === sara.id);
  assert.deepEqual(row.links, ["https://example.com/me"]);
  assert.equal((await mod.req("POST", `/api/admin/ambassadors/${sara.id}/review`, { decision: "reject" })).status, 400, "reject needs a reason");
  const ok = await mod.req("POST", `/api/admin/ambassadors/${sara.id}/review`, { decision: "approve" }); assert.equal(ok.ambassador.status, "approved");
  assert.ok((await new H.Client().req("GET", "/api/ambassadors")).items.some((x) => x.handle === "ln_sara"), "public badge list");
  const me = await sara.req("GET", "/api/ambassadors/me"); const ref = me.ambassador.refCode; assert.match(ref, /^A[A-Z0-9]{7}$/);
  const r1 = await mk("ln_ref1", { ref }); clear();
  await r1.req("POST", "/api/posts", { text: "أول منشور لي هنا في المنصة" });
  await mk("ln_ref2", { ref: ref.toLowerCase() });
  await mk("ln_noref", { ref: "AXXXXXXX" });
  const inv = await sara.req("POST", "/api/ambassadors/me/invites"); assert.equal(inv.status, 200, inv.error); assert.equal(inv.invite.maxUses, 5);
  ENV.LAUNCH_MODE = "invite";
  const r3 = await mk("ln_ref3", { invite: inv.invite.code.toLowerCase() }); assert.ok(r3.id, JSON.stringify(r3.res || {}));
  delete ENV.LAUNCH_MODE;
  const st = (await sara.req("GET", "/api/ambassadors/me")).stats;
  assert.deepEqual({ ...st }, { referrals: 3, last30d: 3, activeLast30d: 1, invitesIssued: 1, invitesUsed: 1 });
  assert.equal((await mk("ln_self", { ref })).id ? 1 : 0, 1);
  assert.equal((await mod.req("POST", `/api/admin/ambassadors/${sara.id}/review`, { decision: "revoke", note: "مخالفة شروط البرنامج" })).ambassador.status, "revoked");
  assert.equal(Number((await db().get("SELECT revoked FROM launch_invites WHERE code=$1", [inv.invite.code])).revoked), 1);
  assert.ok(!(await new H.Client().req("GET", "/api/ambassadors")).items.some((x) => x.handle === "ln_sara"));
  assert.equal((await sara.req("POST", "/api/ambassadors/apply", { motivation: "أريد العودة إلى برنامج السفراء مرة أخرى" })).code, "revoked");
});

test("launch mode: open by default; invite mode gates new accounts only; codes, waitlist, Pi parking", async () => {
  const anon = new H.Client();
  assert.equal((await anon.req("GET", "/api/launch/config")).mode, "open");
  assert.ok((await mk("ln_open1")).id, "open mode: no code needed");
  ENV.LAUNCH_MODE = "invite";
  try {
    assert.deepEqual((await anon.req("GET", "/api/launch/config")).inviteRequired, true);
    const no = await mk("ln_inv0"); assert.equal(no.res.status, 403); assert.equal(no.res.code, "invite_required"); assert.equal(no.res.waitlist, true);
    assert.equal((await mk("ln_inv0", { invite: "NOPE-NOPE" })).res.reason, "unknown");
    assert.equal((await sara.req("POST", "/api/admin/launch/invites", { count: 1 })).status, 403);
    const g = await admin.req("POST", "/api/admin/launch/invites", { count: 2, maxUses: 1, days: 7 }); assert.equal(g.codes.length, 2);
    assert.deepEqual(await anon.req("GET", "/api/launch/invites/" + g.codes[0]).then((r) => r.valid), true);
    assert.ok((await mk("ln_inv1", { invite: g.codes[0] })).id);
    assert.equal((await mk("ln_inv2", { invite: g.codes[0] })).res.reason, "used", "single use");
    await admin.req("POST", "/api/admin/launch/invites/" + g.codes[1] + "/revoke");
    assert.equal((await mk("ln_inv2", { invite: g.codes[1] })).res.reason, "revoked");
    const e = await admin.req("POST", "/api/admin/launch/invites", { count: 1, days: 1 });
    await db().run("UPDATE launch_invites SET expires_at=$1 WHERE code=$2", [new Date(Date.now() - 1000).toISOString(), e.codes[0]]);
    assert.equal((await mk("ln_inv2", { invite: e.codes[0] })).res.reason, "expired");
    // existing accounts keep signing in
    clear(); assert.equal((await new H.Client().req("POST", "/api/auth/login", { handle: "ln_bob", password: "secret123" })).status, 200);
    // waitlist
    assert.equal((await anon.req("POST", "/api/launch/waitlist", { contact: "x!" })).status, 400);
    const w1 = await anon.req("POST", "/api/launch/waitlist", { contact: "Lina@Example.com", name: "لينا" }); assert.equal(w1.position, 1);
    clear(); const w2 = await new H.Client().req("POST", "/api/launch/waitlist", { contact: "@pi_omar" }); assert.equal(w2.position, 2);
    clear(); const w1b = await new H.Client().req("POST", "/api/launch/waitlist", { contact: "lina@example.com" }); assert.equal(w1b.already, true); assert.equal(w1b.position, 1);
    assert.equal((await bob.req("GET", "/api/admin/launch/waitlist")).status, 403);
    const wl = await mod.req("GET", "/api/admin/launch/waitlist"); assert.equal(wl.items[0].contact, "lina@example.com");
    const sent = await mod.req("POST", "/api/admin/launch/waitlist/" + wl.items[0].id + "/invite", {}); const code = sent.invited[0].code;
    assert.equal((await mod.req("POST", "/api/admin/launch/waitlist/" + wl.items[0].id + "/invite", {})).code, "invalid_state");
    const lina = await mk("ln_lina", { invite: code }); assert.ok(lina.id);
    assert.equal((await db().get("SELECT status, user_id FROM launch_waitlist WHERE id=$1", [wl.items[0].id])).status, "joined");
    // Pi: a NEW account without a code is parked; signing in again with a code activates it; existing Pi accounts untouched
    const pi = H.app.ctx.services.pi; const v0 = pi.verify, a0 = pi.authEnabled;
    pi.authEnabled = () => true; pi.verify = async (t) => ({ uid: "uid_" + t, username: "pi_" + t });
    try {
      const c = new H.Client(); const p1 = await c.req("POST", "/api/auth/pi", { accessToken: "newbie" });
      assert.equal(p1.status, 403); assert.equal(p1.code, "invite_required"); assert.equal(p1.parked, true);
      assert.equal((await c.req("GET", "/api/me")).status === 200 && (await c.req("GET", "/api/me")).user ? "in" : "out", "out", "no usable session");
      const u = await db().get("SELECT id, status FROM users WHERE pi_uid='uid_newbie'"); assert.equal(u.status, "waitlist");
      assert.ok(await db().get("SELECT 1 x FROM launch_waitlist WHERE user_id=$1", [u.id]));
      clear(); assert.equal((await new H.Client().req("POST", "/api/auth/pi", { accessToken: "newbie" })).code, "invite_required", "still parked without a code");
      const k = (await admin.req("POST", "/api/admin/launch/invites", { count: 1 })).codes[0];
      clear(); const c2 = new H.Client(); const p2 = await c2.req("POST", "/api/auth/pi", { accessToken: "newbie", invite: k });
      assert.equal(p2.status, 200, p2.error); assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [u.id])).status, "active");
      clear(); assert.equal((await new H.Client().req("POST", "/api/auth/pi", { accessToken: "newbie" })).status, 200, "active Pi account signs in without a code");
      const stats = await mod.req("GET", "/api/launch/stats"); assert.equal(stats.mode, "invite"); assert.ok(stats.invitesRedeemed >= 3);
    } finally { pi.verify = v0; pi.authEnabled = a0; }
  } finally { delete ENV.LAUNCH_MODE; }
  assert.ok((await mk("ln_open2")).id, "back to open");
});
