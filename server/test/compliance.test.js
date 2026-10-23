/* Track 7 — Phase 34 (transparency & compliance): reporter-facing report status + notifications, account decision
 * log with appeal links, transparency report generation (aggregates, small-count suppression, idempotent job,
 * public API + server-rendered page), data export (JSON + ZIP with media, secrets excluded, cooldown), account
 * deletion with grace period → anonymisation (cancel, re-auth, admin guard, media blobs kept by default), consents,
 * other data-subject requests with the 30-day deadline and one extension, breach log with the 72-hour clock,
 * retention dry-run by default / enforce only with RETENTION_ENFORCE=1 / media blobs opt-in.
 * The service is registered here exactly as INTEGRATION.md tells the integrator to register it in server.js. */
const test = require("node:test"),
  assert = require("node:assert");
const { boot } = require("./helpers");
const L = require("../lib/compliance-lib");

let H, ADMIN, A, B, C, svc;
const db = () => H.app.ctx.db;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mk = async (handle, name) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client();
  const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error);
  c.id = r.user.id;
  return c;
};
async function until(fn, ms = 5000, label = "condition") {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await sleep(40);
  }
  throw new Error("timeout: " + label);
}
const iso = msAgo => new Date(Date.now() - msAgo).toISOString();
async function raw(c, path) {
  const r = await fetch(H.base + path, { headers: { Cookie: c.cookie, "X-Requested-With": "mujtama" } });
  return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), buf: Buffer.from(await r.arrayBuffer()) };
}
function fakeRes() {
  const o = { status: 0, headers: {}, body: "" };
  return {
    o,
    writeHead(s, h) {
      o.status = s;
      o.headers = h;
    },
    end(b) {
      o.body = String(b || "");
    }
  };
}

test.before(async () => {
  process.env.COMPLIANCE_EXPORT_COOLDOWN_S = "0";
  process.env.TRANSPARENCY_MIN_COUNT = "3";
  delete process.env.RETENTION_ENFORCE;
  delete process.env.RETENTION_MEDIA_BLOBS;
  delete process.env.COMPLIANCE_DELETE_MEDIA_BLOBS;
  H = await boot();
  svc = H.app.ctx.services.compliance ||= require("../services/compliance")(H.app.ctx); // INTEGRATION.md step 1
  ADMIN = await mk("cmp_admin", "المشرف");
  A = await mk("cmp_a", "أحمد");
  B = await mk("cmp_b", "سارة");
  C = await mk("cmp_c", "خالد");
  const me = await ADMIN.req("GET", "/api/me");
  assert.equal(me.user.role, "admin", "first account is the admin");
});
test.after(async () => {
  await H.app.close();
});
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("policies, processing register and readable /legal pages are public; plain-language summary first", async () => {
  const anon = new H.Client();
  const list = await anon.req("GET", "/api/legal");
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.policies.map(p => p.slug),
    ["terms", "privacy", "retention"]
  );
  const pr = await anon.req("GET", "/api/legal/privacy");
  assert.ok(pr.policy.summary.length >= 3 && pr.policy.sections.find(s => s.id === "rights"));
  assert.match(pr.policy.sections.find(s => s.id === "rights").body.join(" "), /30 يوماً/);
  assert.equal((await anon.req("GET", "/api/legal/nope")).status, 404);
  const reg = await anon.req("GET", "/api/privacy/register");
  assert.ok(reg.purposes.find(p => p.key === "analytics" && p.basis === "consent" && !p.required));
  assert.ok(reg.activities.find(a => a.table === "messages") && reg.activities.find(a => a.table === "audit_log"));
  assert.match(reg.disclaimer, /ليس استشارة قانونية/);
  const res = fakeRes();
  assert.equal(await svc.ssr({}, res, new URL("http://x/legal/terms")), true);
  assert.equal(res.o.status, 200);
  assert.match(res.o.headers["Content-Type"], /text\/html/);
  assert.match(res.o.body, /<html lang="ar" dir="rtl">/);
  assert.match(res.o.body, /باختصار/);
  assert.match(res.o.body, /تخطَّ إلى المحتوى/);
  assert.ok(!/undefined|\[object/.test(res.o.body));
  assert.equal(await svc.ssr({}, fakeRes(), new URL("http://x/somewhere-else")), false);
});

let postA, reportB;
test("report status for the reporter: timeline while open, notification + timeline when actioned", async () => {
  postA = (await A.req("POST", "/api/posts", { text: "منشور سيُبلَّغ عنه للاختبار" })).post;
  const r = await B.req("POST", "/api/reports", { target: postA.id, kind: "post", reason: "إساءة" });
  assert.equal(r.status, 200, r.error);
  reportB = r.id;
  await until(async () => await db().get("SELECT 1 x FROM report_updates WHERE report_id=$1 AND status='open'", [reportB]), 3000, "open update recorded");
  const mine = await B.req("GET", "/api/me/reports");
  assert.equal(mine.reports.length, 1);
  const v = mine.reports[0];
  assert.equal(v.status, "open");
  assert.equal(v.kindLabel, "منشور");
  assert.equal(v.timeline.find(s => s.current).key, "review");
  assert.equal((await A.req("GET", `/api/me/reports/${reportB}`)).status, 404, "only the reporter sees the report");
  const res = await ADMIN.req("POST", `/api/admin/reports/${reportB}`, { action: "remove" });
  assert.equal(res.status, 200, res.error);
  const n = await until(async () => db().get("SELECT * FROM notifications WHERE user_id=$1 AND kind='report_update'", [B.id]), 4000, "reporter notified");
  assert.equal(n.ref, reportB);
  const one = (await B.req("GET", `/api/me/reports/${reportB}`)).report;
  assert.equal(one.status, "actioned");
  assert.equal(one.timeline.at(-1).outcome, "actioned");
  assert.equal(one.href, null, "removed content is not linked");
  assert.equal((await svc.syncReportUpdates()).notified, 0, "never notified twice");
});

test("dismissed reports reach the reporter through the scheduled sync; old decisions are back-filled silently", async () => {
  const p2 = (await A.req("POST", "/api/posts", { text: "منشور عادي لا يخالف" })).post;
  const r = await C.req("POST", "/api/reports", { target: p2.id, kind: "post", reason: "لا يعجبني" });
  await ADMIN.req("POST", `/api/admin/reports/${r.id}`, { action: "keep" });
  const s = await svc.syncReportUpdates();
  assert.equal(s.notified, 1);
  assert.ok(await db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='report_update' AND ref=$2", [C.id, r.id]));
  const v = (await C.req("GET", `/api/me/reports/${r.id}`)).report;
  assert.equal(v.timeline.at(-1).outcome, "dismissed");
  assert.equal(v.href, `/#/post/${p2.id}`);
  await db().run(
    "INSERT INTO reports(id,target,kind,reason,by_user,status,resolved_by,resolved_at,created_at) VALUES('r_oldreport1','p_x','post','قديم',$1,'dismissed',$2,$3,$3)",
    [C.id, ADMIN.id, iso(10 * L.DAY)]
  );
  const s2 = await svc.syncReportUpdates();
  assert.equal(s2.backfilled, 1);
  assert.equal(s2.notified, 0);
  assert.ok(!(await db().get("SELECT 1 x FROM notifications WHERE ref='r_oldreport1'")));
});

test("account decision log: platform decision with appeal link, community actions, account status; appeal flows", async () => {
  const cid = "c_cmplog01";
  await db().run("INSERT INTO communities(id,name,owner,created_at) VALUES($1,'مجتمع الاختبار',$2,$3)", [cid, ADMIN.id, iso(0)]);
  await db().run("INSERT INTO mod_actions(id,community,actor,target_user,action,reason,created_at) VALUES('ma_cmp00001',$1,$2,$3,'warn','لغة غير لائقة',$4)", [
    cid,
    ADMIN.id,
    A.id,
    iso(1000)
  ]);
  await db().run(
    "INSERT INTO mod_actions(id,community,actor,target_user,action,reason,created_at) VALUES('ma_cmp00002',$1,'system',$2,'automod_reject','كلمات محظورة',$3)",
    [cid, A.id, iso(500)]
  );
  await db().run("INSERT INTO mod_actions(id,community,actor,target_user,action,created_at) VALUES('ma_cmp00003',$1,$2,$3,'note',$4)", [
    cid,
    ADMIN.id,
    A.id,
    iso(400)
  ]);
  await H.app.ctx.audit("USER_SUSPENDED", A.id, "سبام متكرر", ADMIN.id);
  await H.app.ctx.audit("USER_ACTIVE", A.id, null, ADMIN.id);
  await sleep(30);
  let log = await A.req("GET", "/api/me/account-log");
  assert.equal(log.status, 200, log.error);
  const dec = log.items.find(i => i.source === "platform");
  assert.ok(dec && dec.canAppeal && dec.reason === "إساءة" && /appeal=/.test(dec.appealHref));
  assert.ok(log.items.find(i => i.action === "warn" && i.community.name === "مجتمع الاختبار" && !i.canAppeal && i.appealNote));
  assert.ok(log.items.find(i => i.action === "automod_reject" && /قواعد مجتمع/.test(i.sourceLabel)));
  assert.ok(!log.items.find(i => i.action === "note"), "private moderator notes are not shown");
  assert.ok(log.items.find(i => i.action === "USER_SUSPENDED" && i.reason === "سبام متكرر"));
  assert.equal(log.summary.appealable, 1);
  const ap = await A.req("POST", "/api/appeals", { decision: dec.id, text: "المنشور كان نقاشاً لا إساءة" });
  assert.equal(ap.status, 200, ap.error);
  log = await A.req("GET", "/api/me/account-log");
  const d2 = log.items.find(i => i.id === dec.id);
  assert.equal(d2.appeal.status, "open");
  assert.equal(d2.canAppeal, false);
  assert.equal(log.summary.openAppeals, 1);
  assert.equal((await B.req("GET", "/api/me/account-log")).items.length, 0, "each user sees only their own log");
  // a later accepted appeal shows on the reporter's timeline as a reviewed decision
  await ADMIN.req("POST", `/api/admin/appeals/${ap.id}`, { action: "accept" });
  const v = (await B.req("GET", `/api/me/reports/${reportB}`)).report;
  assert.equal(v.timeline.at(-1).key, "appeal");
  // other phases can contribute entries
  svc.registerDecisionSource(async uid =>
    uid === A.id ? [{ id: "x1", source: "automated", label: "تأخير نشر مؤقت", reason: "اختبار", at: iso(0), canAppeal: false }] : []
  );
  assert.ok((await A.req("GET", "/api/me/account-log")).items.find(i => i.id === "x1"));
});

test("transparency report: aggregates for a finished period, small buckets suppressed, idempotent job, public API + page", async () => {
  const prev = L.previousPeriod("month"),
    rg = L.periodRange(prev),
    mid = new Date((Date.parse(rg.start) + Date.parse(rg.end)) / 2),
    at = h => new Date(mid.getTime() + h * 3600e3).toISOString();
  for (let i = 0; i < 5; i++)
    await db().run("INSERT INTO reports(id,target,kind,reason,by_user,status,resolved_by,resolved_at,created_at) VALUES($1,$2,'post','سبام',$3,$4,$5,$6,$7)", [
      `r_tr0000${i}`,
      `p_t${i}`,
      B.id,
      i < 3 ? "actioned" : "dismissed",
      ADMIN.id,
      at(i + 2),
      at(0)
    ]);
  await db().run("INSERT INTO reports(id,target,kind,reason,by_user,status,created_at) VALUES('r_tr000099','u_x','user','انتحال',$1,'open',$2)", [B.id, at(1)]);
  for (let i = 0; i < 3; i++)
    await db().run("INSERT INTO decisions(id,target,user_id,action,reason,by_user,restored,created_at) VALUES($1,$2,$3,'REMOVED','سبام',$4,$5,$6)", [
      `dc_tr0000${i}`,
      `p_t${i}`,
      A.id,
      ADMIN.id,
      i === 0 ? 1 : 0,
      at(3)
    ]);
  await db().run("INSERT INTO appeals(id,decision_id,text,by_user,status,resolved_at,created_at) VALUES('ap_tr00001','dc_tr00000','خطأ',$1,'accepted',$2,$3)", [
    A.id,
    at(30),
    at(5)
  ]);
  await H.app.ctx.audit("USER_SUSPENDED", C.id, "x", ADMIN.id);
  const out = await svc.generateTransparency(prev);
  assert.ok(out.generated);
  const t = out.data;
  assert.equal(t.reports.received, 6);
  assert.equal(t.reports.actioned, 3);
  assert.equal(t.reports.dismissed, 2);
  assert.equal(t.reports.stillOpen, 1);
  assert.equal(t.reports.byKind.post, 5);
  assert.equal(t.reports.byKind.user, "<3", "a single 'user' report is suppressed");
  assert.equal(t.reports.medianHoursToDecision, 4);
  assert.equal(t.decisions.total, 3);
  assert.equal(t.decisions.reversedOnAppeal, 1);
  assert.equal(t.appeals.accepted, 1);
  assert.equal(t.appeals.medianHoursToDecision, 25);
  assert.ok(!JSON.stringify(t).includes(B.id) && !JSON.stringify(t).includes(A.id), "no identifiers in the report");
  const again = await svc.transparencyJob();
  assert.ok(
    again.find(x => x.period === prev && x.skipped),
    "job does not regenerate an existing period"
  );
  const anon = new H.Client();
  const list = await anon.req("GET", "/api/transparency");
  assert.ok(list.reports.find(r => r.period === prev && r.reports === 6));
  assert.equal((await anon.req("GET", `/api/transparency/${prev}`)).report.decisions.total, 3);
  assert.equal((await anon.req("GET", "/api/transparency/1999-01")).status, 404);
  const future = L.previousPeriod("month", new Date(Date.now() + 70 * L.DAY));
  assert.equal((await ADMIN.req("POST", "/api/admin/transparency/generate", { period: future })).status, 400, "unfinished periods cannot be published");
  assert.equal((await A.req("POST", "/api/admin/transparency/generate", { period: prev })).status, 403);
  assert.equal((await ADMIN.req("POST", "/api/admin/transparency/generate", { period: prev })).status, 200);
  const page = fakeRes();
  await svc.ssr({}, page, new URL(`http://x/transparency/${prev}`));
  assert.equal(page.o.status, 200);
  assert.match(page.o.body, /تقرير الشفافية/);
  assert.match(page.o.body, /&lt;3|<3/);
  const idx = fakeRes();
  await svc.ssr({}, idx, new URL("http://x/transparency"));
  assert.match(idx.o.body, new RegExp(`/transparency/${prev}`));
});

test("data export: JSON and ZIP (with media), secrets excluded, request recorded, cooldown", async () => {
  await H.app.ctx.storage.put("cmpexport1.png", Buffer.from("fake-png-bytes"), "image/png");
  await db().run(
    "INSERT INTO media(id,owner,kind,mime,size,storage_key,status,created_at) VALUES('m_cmpexp01',$1,'image','image/png',14,'cmpexport1.png','ready',$2)",
    [B.id, iso(0)]
  );
  await B.req("POST", "/api/messages", { to: A.id, text: "رسالة خاصة للاختبار" }).catch(() => {});
  const j = await raw(B, "/api/me/privacy/export?format=json");
  assert.equal(j.status, 200);
  assert.match(j.type, /application\/json/);
  assert.match(j.disp, /attachment; filename="mujtama-plus-cmp_b-.*\.json"/);
  const data = JSON.parse(j.buf.toString());
  assert.equal(data.users.handle, "cmp_b");
  assert.ok(!("password_hash" in data.users));
  assert.ok(Array.isArray(data.reports) && data.reports.length >= 1);
  assert.ok(data.meta.register.find(r => r.table === "reports"));
  assert.ok(Array.isArray(data.sessions) && data.sessions.every(s => !("token_hash" in s)));
  assert.ok(!j.buf.toString().includes("scrypt") && !j.buf.toString().includes("token_hash"));
  const z = await raw(B, "/api/me/privacy/export?format=zip");
  assert.equal(z.status, 200);
  assert.equal(z.type, "application/zip");
  const files = L.unzip(z.buf);
  const names = files.map(f => f.name);
  assert.ok(
    names.includes("README.txt") && names.includes("meta.json") && names.includes("data/users.json") && names.includes("media/cmpexport1.png"),
    names.join(",")
  );
  assert.ok(files.every(f => f.crcOk));
  assert.equal(files.find(f => f.name === "media/cmpexport1.png").data.toString(), "fake-png-bytes");
  const reqs = await db().all("SELECT * FROM dsr_requests WHERE user_id=$1 AND kind='export'", [B.id]);
  assert.equal(reqs.length, 2);
  assert.ok(reqs.every(r => r.status === "completed"));
  process.env.COMPLIANCE_EXPORT_COOLDOWN_S = "300";
  try {
    assert.equal((await raw(B, "/api/me/privacy/export")).status, 429);
  } finally {
    process.env.COMPLIANCE_EXPORT_COOLDOWN_S = "0";
  }
  assert.equal((await raw(new H.Client(), "/api/me/privacy/export")).status, 401);
});

test("consents: defaults, withdraw optional purposes, required ones locked, append-only history, terms acceptance", async () => {
  let c = await B.req("GET", "/api/me/consents");
  const by = k => c.consents.find(x => x.purpose === k);
  assert.equal(by("analytics").granted, true);
  assert.equal(by("marketing_email").granted, false);
  assert.equal(by("service").required, true);
  assert.equal(await svc.hasConsent(B.id, "analytics"), true);
  c = await B.req("PUT", "/api/me/consents", { purposes: { analytics: false, service: false, nonsense: true } });
  assert.deepEqual(c.changed, ["analytics"]);
  assert.equal(by("analytics").granted, false);
  assert.equal(by("service").granted, true);
  assert.equal(await svc.hasConsent(B.id, "analytics"), false);
  H.app.ctx.track(B.id, "first_follow", {});
  H.app.ctx.track(A.id, "first_follow", {});
  await sleep(60);
  assert.ok(
    !(await db().get("SELECT 1 x FROM analytics_events WHERE user_id=$1 AND name='first_follow'", [B.id])),
    "no usage events after analytics consent is withdrawn"
  );
  assert.ok(await db().get("SELECT 1 x FROM analytics_events WHERE user_id=$1 AND name='first_follow'", [A.id]), "other users unaffected");
  await B.req("PUT", "/api/me/consents", { purposes: { analytics: true }, acceptTerms: true });
  const rows = await db().all("SELECT purpose, granted FROM consents WHERE user_id=$1 ORDER BY id", [B.id]);
  assert.deepEqual(
    rows.map(r => `${r.purpose}:${r.granted}`),
    ["analytics:0", "analytics:1", "terms:1"]
  );
  const p = await B.req("GET", "/api/me/privacy");
  assert.equal(p.terms.upToDate, true);
  assert.equal(p.deadlineDays, 30);
});

test("other data-subject requests: 30-day deadline, one extension, answer notifies the user", async () => {
  const r = await C.req("POST", "/api/me/privacy/requests", { kind: "rectify", text: "تاريخ انضمامي يظهر خطأ" });
  assert.equal(r.status, 200, r.error);
  assert.equal((await C.req("POST", "/api/me/privacy/requests", { kind: "hack", text: "xxxxxx" })).status, 400);
  let q = await ADMIN.req("GET", "/api/admin/compliance");
  const row = q.requests.find(x => x.id === r.id);
  assert.equal(row.deadline, "ok");
  assert.equal(Math.round((Date.parse(row.dueAt) - Date.now()) / L.DAY), 30);
  assert.equal((await C.req("GET", "/api/admin/compliance")).status, 403);
  assert.equal((await ADMIN.req("POST", `/api/admin/compliance/requests/${r.id}`, { status: "extended", response: "نحتاج تحققاً إضافياً" })).status, 200);
  assert.equal((await ADMIN.req("POST", `/api/admin/compliance/requests/${r.id}`, { status: "extended", response: "مرة ثانية" })).status, 409);
  q = await ADMIN.req("GET", "/api/admin/compliance");
  assert.equal(Math.round((Date.parse(q.requests.find(x => x.id === r.id).dueAt) - Date.now()) / L.DAY), 60);
  assert.equal((await ADMIN.req("POST", `/api/admin/compliance/requests/${r.id}`, { status: "completed", response: "صُحّح التاريخ" })).status, 200);
  await until(
    async () => db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='privacy_request' AND ref=$2", [C.id, r.id]),
    3000,
    "requester notified"
  );
  const mine = await C.req("GET", "/api/me/privacy");
  assert.equal(mine.requests.find(x => x.id === r.id).response, "صُحّح التاريخ");
});

test("breach log: 72-hour authority clock, updates with notes, notify affected users, admin only", async () => {
  assert.equal((await A.req("POST", "/api/admin/breaches", { title: "x" })).status, 403);
  const b = await ADMIN.req("POST", "/api/admin/breaches", {
    title: "تسرّب سجلات بريد",
    severity: "high",
    detectedAt: iso(80 * 3600e3),
    affectedCount: 12,
    categories: ["البريد الإلكتروني"],
    measures: "تدوير المفاتيح"
  });
  assert.equal(b.status, 200, b.error);
  assert.equal(b.breach.authorityDeadline, "overdue");
  assert.equal(b.breach.categories[0], "البريد الإلكتروني");
  const fresh = await ADMIN.req("POST", "/api/admin/breaches", { title: "حادثة جديدة", severity: "medium" });
  assert.equal(fresh.breach.authorityDeadline, "ok");
  const low = await ADMIN.req("POST", "/api/admin/breaches", { title: "حادثة بسيطة", severity: "low" });
  assert.equal(low.breach.authorityDeadline, "n/a");
  const u = await ADMIN.req("PATCH", `/api/admin/breaches/${b.breach.id}`, {
    authorityNotifiedAt: iso(0),
    status: "contained",
    note: "أُبلغت سدايا عبر المنصة الوطنية"
  });
  assert.equal(u.breach.authorityDeadline, "done");
  assert.ok(u.breach.containedAt);
  assert.equal(u.breach.notes.length, 1);
  assert.equal((await ADMIN.req("PATCH", `/api/admin/breaches/${b.breach.id}`, { detectedAt: "x", containedAt: "not-a-date" })).status, 400);
  const n = await ADMIN.req("POST", `/api/admin/breaches/${b.breach.id}/notify`, { userIds: [A.id, B.id, "u_missing"] });
  assert.equal(n.notified, 2);
  await until(async () => db().get("SELECT 1 x FROM notifications WHERE user_id=$1 AND kind='security_breach'", [A.id]), 3000, "affected user notified");
  assert.ok((await ADMIN.req("GET", "/api/admin/breaches")).breaches.find(x => x.id === b.breach.id).usersNotifiedAt);
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='BREACH_LOGGED' AND target=$1", [b.breach.id]));
});

test("retention: dry-run by default, enforce only with RETENTION_ENFORCE=1, recent rows kept, media blobs opt-in, audit log untouched", async () => {
  await db().run("INSERT INTO analytics_events(user_id,name,props,at) VALUES($1,'old',NULL,$2)", [B.id, iso(400 * L.DAY)]);
  await db().run("INSERT INTO analytics_events(user_id,name,props,at) VALUES($1,'new',NULL,$2)", [B.id, iso(L.DAY)]);
  await db().run("INSERT INTO search_history(id,user_id,q,at) VALUES('sh_cmpold1',$1,'قديم',$2)", [B.id, iso(200 * L.DAY)]);
  await db().run("INSERT INTO notifications(id,user_id,kind,read,created_at) VALUES('n_cmpold01',$1,'welcome',1,$2)", [B.id, iso(200 * L.DAY)]);
  await db().run("INSERT INTO notifications(id,user_id,kind,read,created_at) VALUES('n_cmpold02',$1,'welcome',0,$2)", [B.id, iso(200 * L.DAY)]);
  await H.app.ctx.storage.put("cmpgone1.png", Buffer.from("gone"), "image/png");
  await db().run(
    "INSERT INTO media(id,owner,kind,mime,size,storage_key,status,created_at) VALUES('m_cmpgone1',$1,'image','image/png',4,'cmpgone1.png','deleted',$2)",
    [B.id, iso(60 * L.DAY)]
  );
  const auditBefore = (await db().get("SELECT COUNT(*) n FROM audit_log")).n;
  const pv = await ADMIN.req("GET", "/api/admin/retention/preview");
  assert.equal(pv.mode, "dry-run");
  const r = t => pv.results.find(x => x.type === t);
  assert.ok(r("analytics_events").matched >= 1);
  assert.equal(r("search_history").matched, 1);
  assert.equal(r("notifications_read").matched, 1);
  assert.equal(r("media_blobs").skipped, "disabled");
  assert.ok(await db().get("SELECT 1 x FROM search_history WHERE id='sh_cmpold1'"), "dry run deletes nothing");
  assert.equal((await ADMIN.req("POST", "/api/admin/retention/run", { enforce: true })).status, 501);
  assert.equal((await ADMIN.req("PUT", "/api/admin/retention/media_blobs", { enabled: true, days: 7 })).rule.enabled, true);
  assert.equal((await ADMIN.req("PUT", "/api/admin/retention/search_history", { days: 0 })).status, 400);
  process.env.RETENTION_ENFORCE = "1";
  try {
    const run = await ADMIN.req("POST", "/api/admin/retention/run", { enforce: true });
    assert.equal(run.mode, "enforce", run.error);
    assert.ok(!(await db().get("SELECT 1 x FROM search_history WHERE id='sh_cmpold1'")));
    assert.ok(!(await db().get("SELECT 1 x FROM analytics_events WHERE name='old'")));
    assert.ok(await db().get("SELECT 1 x FROM analytics_events WHERE name='new'"));
    assert.ok(
      !(await db().get("SELECT 1 x FROM notifications WHERE id='n_cmpold01'")) && (await db().get("SELECT 1 x FROM notifications WHERE id='n_cmpold02'")),
      "unread notification kept until the 365-day rule"
    );
    assert.match(run.results.find(x => x.type === "media_blobs").skipped, /RETENTION_MEDIA_BLOBS=1/);
    assert.ok(await H.app.ctx.storage.get("cmpgone1.png"), "blob kept without explicit config");
    process.env.RETENTION_MEDIA_BLOBS = "1";
    const run2 = await ADMIN.req("POST", "/api/admin/retention/run", { enforce: true });
    assert.equal(run2.results.find(x => x.type === "media_blobs").affected, 1);
    assert.equal(await H.app.ctx.storage.get("cmpgone1.png"), null);
    assert.equal((await db().get("SELECT status FROM media WHERE id='m_cmpgone1'")).status, "purged");
  } finally {
    delete process.env.RETENTION_ENFORCE;
    delete process.env.RETENTION_MEDIA_BLOBS;
  }
  assert.ok((await db().get("SELECT COUNT(*) n FROM audit_log")).n >= auditBefore, "audit log is never purged");
  assert.ok((await db().get("SELECT COUNT(*) n FROM retention_runs")).n >= 3);
});

test("account deletion: re-auth + confirm, grace period, cancel, then anonymisation; admins cannot self-delete", async () => {
  assert.equal((await ADMIN.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "secret123" })).status, 403);
  assert.equal((await C.req("POST", "/api/me/privacy/deletion", { password: "secret123" })).status, 400, "typed confirmation required");
  assert.equal((await C.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "wrong-pass" })).status, 403);
  const s = await C.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "secret123" });
  assert.equal(s.status, 200, s.error);
  assert.equal(s.graceDays, 30);
  assert.equal(Math.round((Date.parse(s.scheduledFor) - Date.now()) / L.DAY), 30);
  assert.equal((await C.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "secret123" })).status, 409);
  assert.equal((await C.req("GET", "/api/me/privacy")).deletion.id, s.id);
  assert.equal((await C.req("DELETE", "/api/me/privacy/deletion")).status, 200);
  assert.equal((await C.req("DELETE", "/api/me/privacy/deletion")).status, 404);
  assert.equal((await C.req("GET", "/api/me/privacy")).deletion, null);
  // schedule again, follow, post, upload — then let the grace period pass
  const s2 = await C.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "secret123" });
  const post = (await C.req("POST", "/api/posts", { text: "منشور سيُمحى نصه" })).post;
  await C.req("PUT", `/api/follows/${A.id}`);
  await H.app.ctx.storage.put("cmpdel1.png", Buffer.from("keep-me"), "image/png");
  await db().run(
    "INSERT INTO media(id,owner,kind,mime,size,storage_key,status,created_at) VALUES('m_cmpdel01',$1,'image','image/png',7,'cmpdel1.png','ready',$2)",
    [C.id, iso(0)]
  );
  assert.deepEqual(await svc.processDueDeletions(), [], "nothing before the grace period ends");
  await db().run("UPDATE dsr_requests SET scheduled_for=$1 WHERE id=$2", [iso(1000), s2.id]);
  assert.deepEqual(await svc.processDueDeletions(), [C.id]);
  const u = await db().get("SELECT * FROM users WHERE id=$1", [C.id]);
  assert.equal(u.name, L.DELETED_NAME);
  assert.equal(u.status, "deleted");
  assert.match(u.handle, /^deleted_/);
  assert.equal(u.password_hash, null);
  assert.equal(u.bio, "");
  assert.equal((await C.req("GET", "/api/me")).status, 401, "sessions are gone");
  const p = await db().get("SELECT * FROM posts WHERE id=$1", [post.id]);
  assert.equal(p.status, "deleted");
  assert.equal(p.text, "");
  assert.ok(!(await db().get("SELECT 1 x FROM follows WHERE src=$1", [C.id])));
  assert.equal((await db().get("SELECT status FROM media WHERE id='m_cmpdel01'")).status, "deleted");
  assert.ok(await H.app.ctx.storage.get("cmpdel1.png"), "media blobs untouched without COMPLIANCE_DELETE_MEDIA_BLOBS=1");
  const d = await db().get("SELECT * FROM dsr_requests WHERE id=$1", [s2.id]);
  assert.equal(d.status, "completed");
  assert.deepEqual(
    Object.entries(d.meta.steps).filter(([, v]) => String(v).startsWith("error")),
    [],
    "every erasure step ran"
  );
  assert.ok(d.meta.steps.sessions >= 1);
  assert.ok(await db().get("SELECT 1 x FROM reports WHERE by_user=$1", [C.id]), "moderation records stay (pseudonymous)");
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='ACCOUNT_ANONYMISED' AND target=$1", [C.id]));
  const login = await new H.Client().req("POST", "/api/auth/login", { handle: "cmp_c", password: "secret123" });
  assert.equal(login.status, 401, "the old handle no longer signs in");
  const v = await H.app.ctx.verifyAudit();
  assert.equal(v.ok, true, "audit chain intact");
});

test("grace period 0 erases immediately (COMPLIANCE_DELETION_GRACE_DAYS)", async () => {
  const D = await mk("cmp_d", "مؤقت");
  process.env.COMPLIANCE_DELETION_GRACE_DAYS = "0";
  try {
    const r = await D.req("POST", "/api/me/privacy/deletion", { confirm: "حذف", password: "secret123" });
    assert.equal(r.status, 200, r.error);
  } finally {
    delete process.env.COMPLIANCE_DELETION_GRACE_DAYS;
  }
  assert.equal((await db().get("SELECT status FROM users WHERE id=$1", [D.id])).status, "deleted");
});
