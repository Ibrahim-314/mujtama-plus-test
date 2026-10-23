/* Phase 70 — volunteering, verified charities and transparent campaigns: organisation registration (adults only, one
 * pending) → staff verify / reject / suspend; editors; opportunities (verified only) → sign-up → accept / decline →
 * attended hours → signed volunteer certificate; minors only on minor-friendly opportunities with an active guardian link
 * (guardian notified); campaigns draft → review → live, edits locked after submit; transparency figures; Pi off → donate /
 * disburse 501 not_configured; Pi on → donation journal, disbursement with txid, spending reports capped by raised,
 * refund reversal, ledger balanced; reports flag a campaign and stop donations; end job; migration 053 reversible +
 * data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adminC, owner, editor, vol, donor, kid, parent, NOW = Date.parse("2027-03-01T09:00:00Z");
const db = () => H.app.ctx.db;
const C = () => H.app.ctx.services.charity;
const DAY = 864e5;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const ORG = { name: "جمعية البر الأهلية", kind: "charity", registry: "المركز الوطني لتنمية القطاع غير الربحي", licenseNo: "1234", city: "جدة", country: "السعودية", website: "https://example.org", email: "info@example.org", descr: "جمعية خيرية مرخّصة تعمل في جدة منذ عشر سنوات على السلال الغذائية والكسوة." };
const CAMP = { title: "سلال رمضان لـ ٥٠٠ أسرة", story: "نجمع لتوفير سلال غذائية متكاملة لخمسمئة أسرة متعففة في أحياء جنوب جدة خلال شهر رمضان، وتشمل كل سلة مواد أساسية تكفي الأسرة شهراً كاملاً.", category: "food", beneficiaries: "٥٠٠ أسرة متعففة", goal: 1000 };
let org, camp, opp, minorOpp;

test.before(async () => {
  H = await boot({ charityOpts: { jobs: false, now: () => NOW } });
  adminC = await mk("ch_admin"); owner = await mk("ch_owner", "سارة"); editor = await mk("ch_editor"); vol = await mk("ch_vol", "مها"); donor = await mk("ch_donor", "خالد");
  kid = await mk("ch_kid"); parent = await mk("ch_parent");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("organisations: adults register → one pending → staff verify; editors; minors refused", async () => {
  assert.equal((await owner.req("POST", "/api/charity/orgs", { ...ORG, licenseNo: "" })).status, 400);
  assert.equal((await owner.req("POST", "/api/charity/orgs", { ...ORG, website: "javascript:alert(1)" })).status, 400);
  assert.equal((await kid.req("POST", "/api/charity/orgs", ORG)).code, "minor_restricted");
  const r = await owner.req("POST", "/api/charity/orgs", ORG); assert.equal(r.status, 200, r.error); org = r.org; assert.equal(org.status, "pending");
  assert.equal((await owner.req("POST", "/api/charity/orgs", ORG)).status, 409);
  assert.equal((await new H.Client().req("GET", "/api/charity/orgs/" + org.id)).status, 404); // pending orgs are private
  assert.equal((await owner.req("POST", `/api/charity/orgs/${org.id}/campaigns`, { ...CAMP, startsAt: new Date(NOW).toISOString(), endsAt: new Date(NOW + 30 * DAY).toISOString() })).code, "org_unverified");
  assert.equal((await owner.req("GET", "/api/admin/charity")).status, 403);
  const adm = await adminC.req("GET", "/api/admin/charity"); assert.equal(adm.totals.pendingOrgs, 1); assert.equal(adm.orgs[0].owner.handle, "ch_owner");
  assert.equal((await adminC.req("POST", `/api/admin/charity/orgs/${org.id}`, { status: "rejected" })).status, 400); // reason required
  assert.equal((await adminC.req("POST", `/api/admin/charity/orgs/${org.id}`, { status: "verified" })).status, 200);
  assert.ok((await kinds(owner.id)).includes("charity_org"));
  const pub = await new H.Client().req("GET", "/api/charity/orgs/" + org.id); assert.equal(pub.status, 200); assert.equal(pub.org.verified, true); assert.equal(pub.org.licenseNo, "1234"); assert.equal(pub.members, undefined);
  assert.equal((await new H.Client().req("GET", "/api/charity/orgs?q=البر")).orgs.length, 1);
  assert.equal((await owner.req("POST", `/api/charity/orgs/${org.id}/members`, { handle: "ch_kid" })).code, "minor_restricted");
  const m = await owner.req("POST", `/api/charity/orgs/${org.id}/members`, { handle: "ch_editor" }); assert.equal(m.status, 200, m.error); assert.equal(m.members.length, 2);
  assert.equal((await editor.req("POST", `/api/charity/orgs/${org.id}/members`, { handle: "ch_vol" })).status, 403); // owner only
  // changing the licence of a verified organisation sends it back to verification
  const e = await owner.req("PUT", "/api/charity/orgs/" + org.id, { licenseNo: "9999" }); assert.equal(e.org.status, "pending");
  await adminC.req("POST", `/api/admin/charity/orgs/${org.id}`, { status: "verified" });
});

test("volunteering: opportunity → sign-up → accept → attended hours → signed certificate; withdraw; full slots", async () => {
  const body = { title: "فرز السلال الغذائية", descr: "نحتاج متطوعين لفرز وتعبئة السلال في مستودع الجمعية بجدة.", city: "جدة", startsAt: new Date(NOW + 2 * DAY).toISOString(), endsAt: new Date(NOW + 2 * DAY + 4 * 36e5).toISOString(), slots: 1, hours: 4, skills: "تنظيم" };
  assert.equal((await vol.req("POST", `/api/charity/orgs/${org.id}/opportunities`, body)).status, 403);
  assert.equal((await editor.req("POST", `/api/charity/orgs/${org.id}/opportunities`, { ...body, city: "" })).status, 400);
  const r = await editor.req("POST", `/api/charity/orgs/${org.id}/opportunities`, body); assert.equal(r.status, 200, r.error); opp = r.opportunity; assert.equal(opp.left, 1);
  const list = await new H.Client().req("GET", "/api/charity/opportunities?mode=onsite&city=جدة"); assert.equal(list.opportunities.length, 1);
  assert.equal((await new H.Client().req("GET", "/api/charity/opportunities?mode=online")).opportunities.length, 0);
  const s = await vol.req("POST", `/api/charity/opportunities/${opp.id}/signup`, { note: "لدي خبرة في المستودعات" }); assert.equal(s.status, 200, s.error); assert.equal(s.me.signup.status, "applied");
  assert.equal((await vol.req("POST", `/api/charity/opportunities/${opp.id}/signup`, {})).status, 409);
  assert.ok((await kinds(owner.id)).includes("vol_signup"));
  const v = await editor.req("GET", "/api/charity/opportunities/" + opp.id); assert.equal(v.signups.length, 1);
  const sid = v.signups[0].id;
  assert.equal((await vol.req("POST", "/api/charity/signups/" + sid, { action: "accept" })).status, 403);
  assert.equal((await editor.req("POST", "/api/charity/signups/" + sid, { action: "attended" })).status, 409); // not accepted yet
  assert.equal((await editor.req("POST", "/api/charity/signups/" + sid, { action: "accept" })).status, 200);
  assert.ok((await kinds(vol.id)).includes("vol_decision"));
  // slot is now taken
  const d = await donor.req("GET", "/api/charity/opportunities/" + opp.id); assert.equal(d.me.canSignUp, false); assert.match(d.me.why, /اكتملت/);
  assert.equal((await editor.req("POST", "/api/charity/signups/" + sid, { action: "attended", hours: 4 })).status, 409); // before start
  NOW += 3 * DAY;
  const a = await editor.req("POST", "/api/charity/signups/" + sid, { action: "attended", hours: 3.5 }); assert.equal(a.status, 200, a.error);
  const mine = await vol.req("GET", "/api/charity/me"); assert.equal(mine.hours, 3.5); assert.equal(mine.signups[0].status, "attended"); assert.ok(mine.signups[0].certCode);
  const cert = await new H.Client().req("GET", "/api/certs/" + encodeURIComponent(mine.signups[0].certCode));
  if (cert.status === 200) { assert.equal((cert.certificate || cert.cert || cert).kind, "volunteer"); }
  const page = await fetch(H.base + "/cert/" + mine.signups[0].certCode); const html = await page.text(); assert.equal(page.status, 200); assert.match(html, /شهادة تطوّع/); assert.match(html, /3.5 ساعة تطوّع/);
  assert.ok((await kinds(vol.id)).includes("vol_hours"));
  // cancelling an opportunity declines open sign-ups
  const o2 = await editor.req("POST", `/api/charity/orgs/${org.id}/opportunities`, { ...body, title: "توزيع السلال على الأسر", startsAt: new Date(NOW + 5 * DAY).toISOString(), endsAt: new Date(NOW + 5 * DAY + 36e5).toISOString(), slots: 5 });
  await donor.req("POST", `/api/charity/opportunities/${o2.opportunity.id}/signup`, {});
  assert.equal((await donor.req("POST", `/api/charity/opportunities/${o2.opportunity.id}/signup`, { withdraw: true })).me.signup.status, "withdrawn");
  assert.equal((await donor.req("POST", `/api/charity/opportunities/${o2.opportunity.id}/signup`, {})).me.signup.status, "applied"); // re-apply
  await editor.req("PUT", "/api/charity/opportunities/" + o2.opportunity.id, { status: "cancelled" });
  assert.equal((await donor.req("GET", "/api/charity/me")).signups.find((x) => x.opportunity.id === o2.opportunity.id).status, "declined");
  assert.equal((await new H.Client().req("GET", "/api/charity/opportunities/" + o2.opportunity.id)).status, 404);
});

test("minors: only minor-friendly opportunities, only with a guardian link; guardian notified; never donate", async () => {
  const r = await owner.req("POST", `/api/charity/orgs/${org.id}/opportunities`, { title: "تنظيف شاطئ الحمراء", descr: "حملة تنظيف عائلية لشاطئ الحمراء بجدة مع إشراف الجمعية.", city: "جدة", startsAt: new Date(NOW + 4 * DAY).toISOString(), endsAt: new Date(NOW + 4 * DAY + 3 * 36e5).toISOString(), slots: 20, hours: 3, minors: true });
  minorOpp = r.opportunity; assert.equal(minorOpp.minors, true);
  const l = await kid.req("GET", "/api/charity/opportunities"); assert.equal(l.minor, true); assert.ok(l.opportunities.every((o) => o.minors));
  const adultOnly = await kid.req("POST", `/api/charity/opportunities/${opp.id}/signup`, {}); assert.equal(adultOnly.code, "minor_restricted");
  const noGuardian = await kid.req("POST", `/api/charity/opportunities/${minorOpp.id}/signup`, {}); assert.equal(noGuardian.code, "minor_restricted"); assert.match(noGuardian.error, /وليّ أمر/);
  await db().run("INSERT INTO guardian_links(id,guardian_id,minor_id,status,initiated_by,settings,created_at) VALUES('gl_ch',$1,$2,'active',$1,'{}',$3)", [parent.id, kid.id, new Date().toISOString()]);
  const ok = await kid.req("POST", `/api/charity/opportunities/${minorOpp.id}/signup`, {}); assert.equal(ok.status, 200, ok.error); assert.equal(ok.me.signup.minor, true);
  assert.ok((await kinds(parent.id)).includes("charity_guardian"));
});

test("campaigns: draft → review → live; edits locked; Pi off → donate / disburse 501; reports flag", async () => {
  const body = { ...CAMP, startsAt: new Date(NOW - DAY).toISOString(), endsAt: new Date(NOW + 30 * DAY).toISOString() };
  assert.equal((await owner.req("POST", `/api/charity/orgs/${org.id}/campaigns`, { ...body, story: "قصير" })).status, 400);
  assert.equal((await owner.req("POST", `/api/charity/orgs/${org.id}/campaigns`, { ...body, endsAt: new Date(NOW + 400 * DAY).toISOString() })).status, 400);
  const r = await owner.req("POST", `/api/charity/orgs/${org.id}/campaigns`, body); assert.equal(r.status, 200, r.error); camp = r.campaign; assert.equal(camp.status, "draft");
  assert.equal((await donor.req("GET", "/api/charity/campaigns/" + camp.id)).status, 404);
  assert.equal((await owner.req("PUT", "/api/charity/campaigns/" + camp.id, { goal: 800 })).campaign.goal, 800);
  assert.equal((await owner.req("PUT", "/api/charity/campaigns/" + camp.id, { submit: true })).campaign.status, "review");
  assert.equal((await owner.req("PUT", "/api/charity/campaigns/" + camp.id, { goal: 900 })).status, 409);
  assert.equal((await adminC.req("GET", "/api/admin/charity")).review.length, 1);
  assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}`, { action: "reject" })).status, 400);
  assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}`, { action: "approve" })).status, 200);
  assert.ok((await kinds(owner.id)).includes("charity_review"));
  const list = await new H.Client().req("GET", "/api/charity/campaigns?category=food"); assert.equal(list.campaigns.length, 1); assert.equal(list.counts.food, 1); assert.equal(list.piEnabled, false); assert.match(list.piNotice, /مدفوعات Pi/);
  assert.equal(list.totals.orgs, 1); assert.equal(list.totals.hours, 3.5);
  const v = await donor.req("GET", "/api/charity/campaigns/" + camp.id); assert.equal(v.me.canDonate, false); assert.match(v.me.why, /مدفوعات Pi/); assert.equal(v.campaign.goal, 800); assert.equal(v.campaign.raised, 0);
  const d = await donor.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 5 }); assert.equal(d.status, 501); assert.equal(d.code, "not_configured");
  assert.equal((await kid.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 5 })).code, "minor_restricted");
  assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}/disburse`, { amount: 1, txid: "pitx_disb_0001" })).status, 501);
  // updates only by the organisation; spending can't exceed raised
  assert.equal((await donor.req("POST", `/api/charity/campaigns/${camp.id}/updates`, { body: "تحديث من شخص آخر" })).status, 403);
  assert.equal((await owner.req("POST", `/api/charity/campaigns/${camp.id}/updates`, { body: "بدأنا شراء المواد الغذائية من المورّد." })).status, 200);
  assert.equal((await owner.req("POST", `/api/charity/campaigns/${camp.id}/updates`, { kind: "spending", body: "شراء أرز وزيت", amount: 10, receipt: "https://example.org/r1.pdf" })).status, 400);
  // reports: owner can't report own org; duplicates refused; 3 open reports flag and stop donations
  assert.equal((await owner.req("POST", `/api/charity/campaigns/${camp.id}/report`, { reason: "fraud" })).status, 400);
  assert.equal((await donor.req("POST", `/api/charity/campaigns/${camp.id}/report`, { reason: "nope" })).status, 400);
  for (const u of [donor, vol, parent]) assert.equal((await u.req("POST", `/api/charity/campaigns/${camp.id}/report`, { reason: "misleading" })).status, 200);
  assert.equal((await donor.req("POST", `/api/charity/campaigns/${camp.id}/report`, { reason: "fraud" })).status, 409);
  assert.equal((await donor.req("GET", "/api/charity/campaigns/" + camp.id)).campaign.flagged, true);
  const adm = await adminC.req("GET", "/api/admin/charity"); assert.equal(adm.totals.flagged, 1); assert.equal(adm.reports.length, 3);
  assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}`, { action: "unflag" })).status, 200);
  assert.equal((await adminC.req("GET", "/api/admin/charity")).reports.length, 0);
});

test("Pi on: donation → raised; disbursement with txid; spending reports; refund reversal; ledger balanced", async () => {
  const pis = H.app.ctx.services.pi, en = pis.enabled, ci = pis.createIntent; let k = 0;
  pis.enabled = () => true; pis.createIntent = async (u, b) => ({ id: "pitx_ch" + ++k, amount: b.amount, memo: b.memo, metadata: { purpose: b.purpose } });
  try {
    assert.equal((await donor.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 0 })).status, 400);
    const d1 = await donor.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 100 }); assert.equal(d1.status, 200, d1.error);
    const d2 = await vol.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 50, anonymous: true });
    for (const d of [d1, d2]) { H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: d.intent.id, purpose: "charity", amount: d.intent.amount }); await C().settle(); }
    H.app.ctx.bus.emit("PI_PAYMENT_COMPLETED", { tx: d1.intent.id, purpose: "charity", amount: 100 }); await C().settle(); // idempotent
    let v = await new H.Client().req("GET", "/api/charity/campaigns/" + camp.id);
    assert.equal(v.campaign.raised, 150); assert.equal(v.campaign.donors, 2); assert.equal(v.campaign.percent, 19);
    assert.equal(v.donations.filter((x) => x.by === null).length, 1);
    assert.ok((await kinds(owner.id)).length);
    assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}/disburse`, { amount: 500, txid: "pitx_disb_0001" })).code, "insufficient_balance");
    assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}/disburse`, { amount: 120 })).status, 400);
    assert.equal((await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}/disburse`, { amount: 120, txid: "pitx_disb_0001", memo: "دفعة أولى" })).status, 200);
    const sp = await owner.req("POST", `/api/charity/campaigns/${camp.id}/updates`, { kind: "spending", body: "شراء أرز وزيت لـ ٢٠٠ سلة", amount: 90, receipt: "https://example.org/r1.pdf" }); assert.equal(sp.status, 200, sp.error);
    assert.ok((await kinds(donor.id)).includes("charity_update"));
    v = await new H.Client().req("GET", "/api/charity/campaigns/" + camp.id);
    assert.equal(v.campaign.disbursed, 120); assert.equal(v.campaign.spent, 90); assert.equal(v.campaign.unreported, 30); assert.equal(v.campaign.balance, 30);
    assert.equal(v.disbursements[0].txid, "pitx_disb_0001"); assert.equal(v.updates.find((u) => u.kind === "spending").receipt, "https://example.org/r1.pdf");
    const tot = await db().get("SELECT SUM(debit) d, SUM(credit) c FROM ledger_entries"); assert.equal(Number(tot.d), Number(tot.c));
    H.app.ctx.bus.emit("PI_PAYMENT_REFUNDED", { tx: d2.intent.id, purpose: "charity" }); await C().settle();
    v = await new H.Client().req("GET", "/api/charity/campaigns/" + camp.id); assert.equal(v.campaign.raised, 100); assert.equal(v.campaign.donors, 1);
    const me = await donor.req("GET", "/api/charity/me"); assert.equal(me.donations.length, 1); assert.equal(me.donations[0].amount, 100);
    assert.equal((await kid.req("POST", `/api/charity/campaigns/${camp.id}/donate`, { amount: 1 })).code, "minor_restricted");
  } finally { pis.enabled = en; pis.createIntent = ci; }
});

test("suspend pauses campaigns and closes opportunities; end job; audit", async () => {
  assert.equal((await adminC.req("POST", `/api/admin/charity/orgs/${org.id}`, { status: "suspended", reason: "مراجعة الترخيص" })).status, 200);
  assert.equal((await new H.Client().req("GET", "/api/charity/campaigns/" + camp.id)).campaign.status, "paused");
  assert.equal((await new H.Client().req("GET", "/api/charity/orgs/" + org.id)).status, 404);
  assert.equal((await owner.req("PUT", "/api/charity/orgs/" + org.id, { name: "اسم جديد للجمعية" })).status, 403);
  await adminC.req("POST", `/api/admin/charity/orgs/${org.id}`, { status: "verified" });
  await adminC.req("POST", `/api/admin/charity/campaigns/${camp.id}`, { action: "resume" });
  NOW += 40 * DAY;
  assert.equal((await C().tick()).ended, 1);
  assert.equal((await new H.Client().req("GET", "/api/charity/campaigns/" + camp.id)).campaign.status, "ended");
  assert.equal((await new H.Client().req("GET", "/api/charity/campaigns?status=ended")).campaigns.length, 1);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='charity_org_suspended' AND target=$1", [org.id]));
});

test("054: phase 65 fund amounts above 214.7 π no longer overflow on PostgreSQL", async () => {
  const r = await adminC.req("POST", "/api/admin/fund/rounds", { title: "جولة كبيرة للمحتوى التعليمي", descr: "منح لدعم سلاسل تعليمية عربية مفتوحة للجميع.", categories: ["education"], budget: 5000, maxGrant: 1000, opensAt: new Date(Date.now() - DAY).toISOString(), closesAt: new Date(Date.now() + 20 * DAY).toISOString() });
  assert.equal(r.status, 200, r.error); assert.equal(r.round.budget, 5000);
});

test("migration 053 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '053_charity' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "053_charity"]);
  await assert.rejects(() => db().get("SELECT 1 FROM charity_campaigns"));
  assert.deepEqual(await mig.up(db()), ["053_charity", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["charity_orgs", "charity_org_members", "vol_signups", "charity_donations", "charity_updates", "charity_reports"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [owner.id]); }
});
