/* Phase 78 — contracts, milestones & escrow: offers (validation, direct and from an «offered» job application, accept →
 * application hired, decline, withdraw), unpaid flow (submit → revision → approve → completed), paid flow with Pi off (fund
 * 501 not_configured, submit blocked until funded) and on (fund intent → PI_PAYMENT_COMPLETED → escrow hold journal →
 * submit → approve → release journal to work:<id>:earnings with fee), revision cap, disputes (freeze, staff split / refund),
 * worker ends the contract → held funds refunded, client cannot cancel with held funds, auto-release sweep, messages with
 * scam warning, minors (no paid contracts, unpaid allowed), access control, notifications, migration 058 + data map.
 * PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adminC, cli, wrk, other, kid; let clock = null;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const SCOPE = "تصميم وتنفيذ واجهة متجر عربي متجاوبة مع لوحة تحكم بسيطة، وتسليم الملفات المصدرية مع توثيق مختصر.";
const bal = async (acc) => { const r = await db().get("SELECT COALESCE(SUM(credit),0) c, COALESCE(SUM(debit),0) d FROM ledger_entries WHERE account=$1", [acc]); return Number(r.c) - Number(r.d); };
const pis = () => H.app.ctx.services.pi;
async function piOn(fn) {
  const s = pis(), en = s.enabled, ci = s.createIntent; let n = 0;
  s.enabled = () => true; s.createIntent = async (u, o) => ({ id: "tx_ct_" + (++n) + "_" + Date.now(), amount: o.amount, memo: o.memo });
  try { return await fn(); } finally { s.enabled = en; s.createIntent = ci; }
}
async function settleFund(r) {
  H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { purpose: "contract", tx: r.intent.id, amount: r.amount });
  for (let i = 0; i < 40 && !(await db().get("SELECT 1 x FROM contract_milestones WHERE intent_id=$1 AND status='funded'", [r.intent.id])); i++) { await H.app.ctx.services.contracts.flush(); await new Promise((x) => setTimeout(x, 25)); }
}

test.before(async () => {
  H = await boot({ contractsOpts: { now: () => clock ?? Date.now(), jobs: false, env: { CONTRACT_FEE_PCT: "10" } } });
  adminC = await mk("ct_admin"); cli = await mk("ct_cli", "شركة نور"); wrk = await mk("ct_wrk", "سارة"); other = await mk("ct_other"); kid = await mk("ct_kid", "يافع");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("offers: validation, direct offer, decline / withdraw, access control, minors", async () => {
  const base = { to: "ct_wrk", title: "واجهة متجر عربي", scope: SCOPE, maxRevisions: 1, milestones: [{ title: "التصميم", amount: 0 }] };
  assert.equal((await new H.Client().req("POST", "/api/contracts", base)).status, 401);
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, scope: "قصير" })).code, "too_short");
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, milestones: [] })).code, "milestones");
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, milestones: [{ title: "x1x", amount: -1 }] })).code, "bad_amount");
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, milestones: [{ title: "مرحلة", due: "2000-01-01" }] })).code, "bad_date");
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, to: "ct_cli" })).status, 400);
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, to: "nobody_here" })).code, "no_user");
  // minors: paid → 403 (either side); unpaid allowed
  assert.equal((await cli.req("POST", "/api/contracts", { ...base, to: "ct_kid", milestones: [{ title: "مرحلة", amount: 5 }] })).code, "minor_restricted");
  assert.equal((await kid.req("POST", "/api/contracts", { ...base, milestones: [{ title: "مرحلة", amount: 5 }] })).code, "minor_restricted");
  const ku = await cli.req("POST", "/api/contracts", { ...base, to: "ct_kid", title: "تطوع: تنسيق مكتبة" }); assert.equal(ku.status, 200, ku.error);
  // decline
  let r = await cli.req("POST", "/api/contracts", base); assert.equal(r.status, 200, r.error); assert.equal(r.state, "offer"); const c1 = r.id;
  assert.equal((await other.req("GET", "/api/contracts/" + c1)).status, 404);
  assert.equal((await cli.req("POST", `/api/contracts/${c1}/respond`, { accept: true })).status, 404, "only the worker responds");
  r = await wrk.req("POST", `/api/contracts/${c1}/respond`, { accept: false, note: "لست متاحة هذا الشهر" }); assert.equal(r.contract.status, "declined");
  assert.ok((await kinds(wrk.id)).includes("contract_offer")); assert.ok((await kinds(cli.id)).includes("contract_status"));
  // withdraw
  r = await cli.req("POST", "/api/contracts", base); const c2 = r.id;
  r = await cli.req("POST", `/api/contracts/${c2}/withdraw`); assert.equal(r.contract.status, "cancelled");
  assert.equal((await wrk.req("POST", `/api/contracts/${c2}/respond`, { accept: true })).code, "not_offer");
  const l = await wrk.req("GET", "/api/contracts"); assert.ok(l.open.some((c) => c.id === ku.id) === false); assert.equal(l.closed.length, 2);
});

test("unpaid contract: submit, revision cap, approve → completed; messages warn the recipient", async () => {
  let r = await cli.req("POST", "/api/contracts", { to: "ct_wrk", title: "مراجعة نصوص تطوعية", scope: SCOPE, maxRevisions: 1, milestones: [{ title: "المسودة الأولى" }, { title: "النسخة النهائية" }] });
  const cid = r.id; r = await wrk.req("POST", `/api/contracts/${cid}/respond`, { accept: true }); assert.equal(r.contract.status, "active");
  const [m1, m2] = r.milestones; assert.deepEqual(m1.actions, ["submit"]); assert.equal(m1.paid, false);
  assert.equal((await cli.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "تسليم من العميل؟" })).status, 403);
  assert.equal((await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "قصير" })).status, 400);
  assert.equal((await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "المسودة الأولى جاهزة", links: ["javascript:alert(1)"] })).code, "bad_link");
  r = await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "المسودة الأولى جاهزة للمراجعة", links: ["https://example.com/draft"] });
  assert.equal(r.milestones[0].status, "submitted"); assert.equal(r.milestones[0].deliverables[0].links[0], "https://example.com/draft");
  r = await cli.req("POST", `/api/contract-milestones/${m1.id}/review`, { action: "revision", note: "عدّلي المقدمة لتكون أقصر" }); assert.equal(r.milestones[0].status, "revision");
  await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "عدّلت المقدمة كما طلبت" });
  assert.equal((await cli.req("POST", `/api/contract-milestones/${m1.id}/review`, { action: "revision", note: "مرة أخرى" })).code, "no_revisions");
  r = await cli.req("POST", `/api/contract-milestones/${m1.id}/review`, { action: "approve" }); assert.equal(r.milestones[0].status, "approved"); assert.equal(r.contract.status, "active");
  // messages: risky text warns the recipient only
  r = await cli.req("POST", `/api/contracts/${cid}/messages`, { body: "كمّلي معي على واتساب أسرع" });
  assert.equal(r.events.at(-1).warn, false);
  const wv = await wrk.req("GET", "/api/contracts/" + cid); assert.equal(wv.events.at(-1).warn, true);
  assert.ok((await kinds(wrk.id)).includes("contract_msg"));
  await wrk.req("POST", `/api/contract-milestones/${m2.id}/submit`, { note: "النسخة النهائية مرفقة" });
  r = await cli.req("POST", `/api/contract-milestones/${m2.id}/review`, { action: "approve" }); assert.equal(r.contract.status, "completed");
  assert.equal((await cli.req("POST", `/api/contracts/${cid}/messages`, { body: "شكراً" })).code, "closed");
  assert.equal((await H.app.ctx.services.contracts.completedFor(wrk.id)).length, 1);
});

test("paid contract from a job application: Pi off → 501; Pi on → escrow hold, release with fee, application hired", async () => {
  // a job + application moved to «offered»
  for (const c of [cli, wrk]) await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), c.id]);
  await wrk.req("PUT", "/api/pro/me", { headline: "مطوّرة واجهات", visibility: "members" });
  const job = await cli.req("POST", "/api/jobs", { kind: "freelance", title: "واجهة متجر إلكتروني", body: SCOPE + " نحتاج خبرة سابقة في المتاجر.", category: "tech", payType: "fixed", payMin: 100, payMax: 200 });
  assert.equal(job.status, 200, job.error);
  const app = await wrk.req("POST", `/api/jobs/${job.id}/apply`, { cover: "عملت على متاجر عربية كثيرة وأستطيع التسليم خلال أسبوعين.", bid: 150, days: 14 }); assert.equal(app.status, 200, app.error);
  const d0 = await cli.req("GET", "/api/contracts/draft?app=" + app.id); assert.equal(d0.draft.ready, false); assert.equal(d0.draft.bid, 150);
  const terms = { appId: app.id, title: "واجهة متجر إلكتروني", scope: SCOPE, maxRevisions: 2, milestones: [{ title: "التصميم", amount: 50 }, { title: "التنفيذ", amount: 100 }] };
  assert.equal((await cli.req("POST", "/api/contracts", terms)).code, "not_offered");
  await cli.req("POST", `/api/job-applications/${app.id}/status`, { status: "offered" });
  assert.equal((await wrk.req("POST", "/api/contracts", terms)).status, 404, "only the employer");
  let r = await cli.req("POST", "/api/contracts", terms); assert.equal(r.status, 200, r.error); assert.equal(r.total, 150); const cid = r.id;
  assert.equal((await cli.req("POST", "/api/contracts", terms)).code, "exists");
  r = await wrk.req("POST", `/api/contracts/${cid}/respond`, { accept: true }); assert.equal(r.contract.status, "active");
  assert.equal((await db().get("SELECT status FROM job_applications WHERE id=$1", [app.id])).status, "hired");
  const [m1, m2] = r.milestones; assert.deepEqual(m1.actions, []); assert.match(r.piNotice, /مدفوعات Pi غير مفعّلة/);
  const cv = await cli.req("GET", "/api/contracts/" + cid); assert.deepEqual(cv.milestones[0].actions, ["fund"]);
  // Pi off
  const off = await cli.req("POST", `/api/contract-milestones/${m1.id}/fund`); assert.equal(off.status, 501); assert.equal(off.code, "not_configured"); assert.match(off.error, /مدفوعات Pi غير مفعّلة/);
  assert.equal((await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "سلّمت التصميم الأولي" })).code, "not_funded");
  // Pi on
  await piOn(async () => {
    assert.equal((await wrk.req("POST", `/api/contract-milestones/${m1.id}/fund`)).status, 403);
    const f = await cli.req("POST", `/api/contract-milestones/${m1.id}/fund`); assert.equal(f.status, 200, f.error); assert.equal(f.amount, 50);
    await settleFund(f);
  });
  assert.equal(await bal("escrow:contracts"), 50e7);
  assert.ok((await kinds(wrk.id)).includes("contract_funded"));
  assert.equal((await cli.req("POST", `/api/contracts/${cid}/cancel`)).code, "held", "client cannot cancel with held funds");
  r = await wrk.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "التصميم جاهز", links: ["https://example.com/figma"] }); assert.equal(r.milestones[0].status, "submitted");
  r = await cli.req("POST", `/api/contract-milestones/${m1.id}/review`, { action: "approve" }); assert.equal(r.milestones[0].status, "released"); assert.equal(r.milestones[0].workerAmount, 50);
  assert.equal(await bal("escrow:contracts"), 0); assert.equal(await bal(`work:${wrk.id}:earnings`), 45e7, "10% fee"); assert.equal(await bal("platform:fees"), 5e7);
  assert.ok(await db().get("SELECT 1 x FROM ledger_journals WHERE ikey=$1", [`contract:${m1.id}:release`]));
  // second milestone: funded, worker ends the contract → refund to client
  await piOn(async () => { const f = await cli.req("POST", `/api/contract-milestones/${m2.id}/fund`); await settleFund(f); });
  assert.equal(await bal("escrow:contracts"), 100e7);
  r = await wrk.req("POST", `/api/contracts/${cid}/cancel`, { note: "ظرف طارئ" }); assert.equal(r.milestones[1].status, "refunded"); assert.equal(r.contract.status, "completed", "one milestone paid out → completed");
  assert.equal(await bal("escrow:contracts"), 0);
  const back = await db().get("SELECT COALESCE(SUM(credit),0) c FROM ledger_entries WHERE account=$1", [`user:${cli.id}:pi_out`]); assert.equal(Number(back.c), 100e7);
  // finance statement sees the earnings account
  const st = await wrk.req("GET", "/api/finance/statement"); assert.equal(st.status, 200, st.error);
});

test("disputes freeze a milestone; staff split; auto-release sweep; data map; migration", async () => {
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), other.id]);
  let r = await cli.req("POST", "/api/contracts", { to: "ct_other", title: "ترجمة دليل المستخدم", scope: SCOPE, maxRevisions: 0, milestones: [{ title: "الفصل الأول", amount: 40 }, { title: "الفصل الثاني", amount: 20 }] });
  const cid = r.id; r = await other.req("POST", `/api/contracts/${cid}/respond`, { accept: true }); const [m1, m2] = r.milestones;
  await piOn(async () => { for (const m of [m1, m2]) { const f = await cli.req("POST", `/api/contract-milestones/${m.id}/fund`); assert.equal(f.status, 200, f.error); await settleFund(f); } });
  await other.req("POST", `/api/contract-milestones/${m1.id}/submit`, { note: "الفصل الأول مترجم بالكامل" });
  r = await cli.req("GET", "/api/contracts/" + cid); assert.deepEqual(r.milestones[0].actions, ["approve", "dispute"], "no revisions allowed");
  assert.equal((await cli.req("POST", `/api/contract-milestones/${m1.id}/dispute`, { reason: "quality", body: "قصير" })).status, 400);
  r = await cli.req("POST", `/api/contract-milestones/${m1.id}/dispute`, { reason: "quality", body: "الترجمة آلية وفيها أخطاء كثيرة لا تطابق الاتفاق" }); assert.equal(r.milestones[0].disputed, true);
  assert.equal((await cli.req("POST", `/api/contract-milestones/${m1.id}/review`, { action: "approve" })).code, "disputed");
  assert.equal((await other.req("POST", `/api/contracts/${cid}/cancel`)).code, "disputed");
  assert.ok((await kinds(other.id)).includes("contract_dispute"));
  assert.equal((await cli.req("GET", "/api/admin/contracts")).status, 403);
  let a = await adminC.req("GET", "/api/admin/contracts"); assert.equal(a.disputes.length, 1); assert.equal(a.totals.escrow, 60); assert.equal(a.disputes[0].deliverables.length, 1);
  const did = a.disputes[0].id;
  assert.equal((await adminC.req("POST", `/api/admin/contract-disputes/${did}`, { outcome: "split", workerShare: 40, note: "قرار التقسيم" })).code, "bad_share");
  a = await adminC.req("POST", `/api/admin/contract-disputes/${did}`, { outcome: "split", workerShare: 25, note: "الترجمة تحتاج مراجعة؛ تقسيم عادل" }); assert.equal(a.disputes.length, 0);
  assert.equal(await bal(`work:${other.id}:earnings`), 22.5e7);
  assert.equal((await adminC.req("POST", `/api/admin/contract-disputes/${did}`, { outcome: "refund", note: "مرة ثانية" })).code, "resolved");
  assert.ok((await kinds(cli.id)).includes("contract_resolved"));
  r = await cli.req("GET", "/api/contracts/" + cid); assert.equal(r.disputes[0].outcome, "split"); assert.equal(r.milestones[0].status, "released");
  // auto-release after 14 days of silence
  await other.req("POST", `/api/contract-milestones/${m2.id}/submit`, { note: "الفصل الثاني مترجم" });
  clock = Date.now() + 15 * 864e5; const n = await H.app.ctx.services.contracts.sweep(); clock = null; assert.equal(n, 1);
  r = await cli.req("GET", "/api/contracts/" + cid); assert.equal(r.milestones[1].status, "released"); assert.equal(r.contract.status, "completed");
  assert.ok(r.events.some((e) => e.kind === "auto_approved"));
  assert.equal(await bal("escrow:contracts"), 0); assert.equal(await bal(`work:${other.id}:earnings`), 40.5e7);
  // migration + data map
  const mig = require("../migrations/058_contracts.js"), d = db().dialect, exec = async (sql) => { for (const s of sql.replace(/\{TS\}/g, d === "postgres" ? "TIMESTAMPTZ" : "TEXT").split(";").map((x) => x.trim()).filter(Boolean)) await db().exec(s); };
  await mig.up(db(), exec, d); // idempotent re-run keeps data
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM contracts")).n) > 0);
  await mig.down(db(), exec, d); await mig.up(db(), exec, d);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM contracts")).n), 0);
  const map = JSON.stringify(require("../lib/compliance-lib").DATA_MAP.map((m) => m.t));
  for (const t of ["\"contracts\"", "contract_deliverables", "contract_events", "contract_disputes"]) assert.ok(map.includes(t), t);
});
