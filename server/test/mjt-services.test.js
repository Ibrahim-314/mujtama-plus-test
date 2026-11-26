/* v2.161 — phase 5 «خدمات MJT» (services/mjt-services.js, migration 091) on the phase-4 engine (services/mjt-rewards.js).
 * catalog seeded disabled with no cost · admin 403 · purchase with MJT · insufficient balance · idempotency (replay, parallel
 * different keys, parallel same key) · re-access never debits · price versions (old purchase keeps its price, stale version
 * rejected) · API price tampering rejected · disable from admin · time-limited expiry · Free vs Plus (Plus-included → no debit)
 * · course content unlock (paid courses only; free courses stay free) · failure inside the transaction → nothing debited ·
 * delivery failure after debit → automatic refund · manual refund policy · frozen wallet · free services unaffected · quotas
 * unchanged · the shared ledger still verifies. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { UNIT } = require("../lib/mjt-ledger");

let H, admin, teacher, free1, free2, plusM, gid, course, freeCourse, lessonId, faultOn = false;
const db = () => H.app.ctx.db;
const RW = () => H.app.ctx.services.mjtRewards;
const SV = () => H.app.ctx.services.mjtServices;
const clear = () => H.app.ctx.rl.w.clear();
const n = async (sql, p = []) => Number((await db().get(sql, p)).n);
const bal = async (uid) => Number((await db().get("SELECT balance FROM mjt_accounts WHERE id=$1", ["user:" + uid]))?.balance || 0);
let k = 0; const key = (p = "t") => `${p}_${Date.now()}_${k++}`;
const fund = (uid, mjt) => RW().credit(uid, { amount: mjt * UNIT, source: "admin", reason: "test funding", ikey: key("fund") });
const mk = async (handle) => {
  clear(); const cl = new H.Client(); const r = await cl.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); cl.id = r.user.id; cl.handle = handle;
  await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * 864e5).toISOString(), cl.id]);
  return cl;
};
const edit = async (sid, body) => { clear(); const r = await admin.req("PUT", "/api/admin/mjt/services/" + sid, body); assert.equal(r.status, 200, r.error); return r.service; };
const buy = async (cl, sid, body) => { clear(); return cl.req("POST", `/api/mjt/services/${sid}/purchase`, body); };
const svcOf = async (cl, sid) => { clear(); const r = await cl.req("GET", "/api/mjt/services"); assert.equal(r.status, 200, r.error); return r.services.find((x) => x.id === sid || x.key === sid); };
const STUDIO = "svc_studio_extended";

test.before(async () => {
  H = await boot({ mjtOpts: { autoConvert: false, jobs: false }, studyOpts: { jobs: false }, mjtServicesOpts: { faultAfterGrant: async () => { if (faultOn) throw new Error("injected failure inside the transaction"); } } });
  admin = await mk("sv_admin"); teacher = await mk("sv_teacher"); free1 = await mk("sv_free1"); free2 = await mk("sv_free2"); plusM = await mk("sv_plus");
  await RW().ready; await SV().ready;
  clear(); const g = await admin.req("POST", "/api/admin/ai/grants", { user: plusM.handle, days: 30 }); assert.equal(g.status, 200, g.error);
  // a study group with one paid («product») course and one free course, both published
  clear(); const sg = await teacher.req("POST", "/api/study/groups", { name: "مجموعة خدمات MJT", type: "public", mode: "group", subject: "برمجة" }); assert.equal(sg.status, 200, sg.error); gid = sg.group.id;
  const mkCourse = async (title) => {
    clear(); const c = await teacher.req("POST", "/api/courses", { communityId: gid, title }); assert.equal(c.status, 200, c.error);
    clear(); const l = await teacher.req("POST", `/api/courses/${c.course.id}/lessons`, { moduleId: c.outline[0].id, title: "الدرس الأول", kind: "text", body: "محتوى الدرس" }); assert.equal(l.status, 200, l.error);
    clear(); assert.equal((await teacher.req("PATCH", "/api/courses/" + c.course.id, { status: "published" })).status, 200);
    return { id: c.course.id, lesson: l.lesson.id };
  };
  const pc = await mkCourse("دورة مدفوعة متقدمة"); course = pc.id; lessonId = pc.lesson;
  freeCourse = (await mkCourse("دورة مجانية للجميع")).id;
  const at = new Date().toISOString();
  await db().run("INSERT INTO market_listings(id,seller_id,kind,title,description,price,currency,category,status,created_at,updated_at) VALUES('ml_sv1',$1,'digital','حزمة الدورة','',3,'PI','education','active',$2,$2)", [teacher.id, at]);
  await db().run("INSERT INTO digital_products(listing_id,seller_id,ptype,files,created_at,updated_at) VALUES('ml_sv1',$1,'course','[]',$2,$2)", [teacher.id, at]);
  clear(); const pr = await teacher.req("PATCH", "/api/courses/" + course, { access: "product", listingId: "ml_sv1" }); assert.equal(pr.status, 200, pr.error);
});
test.after(() => H.app.close());
test.beforeEach(clear);

test("migration 091 is additive and reversible; compliance data map lists the member tables", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '091_mjt_services' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "091_mjt_services"]);
  await assert.rejects(() => db().get("SELECT 1 FROM mjt_services"));
  await db().get("SELECT 1 FROM mjt_reward_entries"); await db().get("SELECT 1 FROM mjt_accounts"); // phase 4 + ledger untouched
  assert.deepEqual(await mig.up(db()), ["091_mjt_services", ...later]);
  const s2 = require("../services/mjt-services"); assert.equal(typeof s2, "function");
  // re-seed exactly as boot does
  await db().run("INSERT INTO mjt_services(id,key,kind,target,title,benefit,access_mode,eligible,cost,term,duration_days,price_version,enabled,created_by,updated_by,created_at,updated_at) VALUES('svc_studio_extended','studio_extended','feature','studio_extended','تحليلات الاستوديو الممتدة','x','plus_mjt','all',NULL,NULL,NULL,1,0,'system','system',$1,$1)", [new Date().toISOString()]);
  await db().run("INSERT INTO mjt_service_prices(service_id,version,cost,term,duration_days,set_by,created_at) VALUES('svc_studio_extended',1,NULL,NULL,NULL,'system',$1)", [new Date().toISOString()]);
  const L = require("../lib/compliance-lib");
  for (const t of ["mjt_service_purchases", "mjt_entitlements"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [free1.id]); }
});

test("catalog ships disabled with no cost and no term; only real capabilities can be registered; free courses stay free", async () => {
  const r = await admin.req("GET", "/api/admin/mjt/services"); assert.equal(r.status, 200, r.error);
  assert.deepEqual(r.services.map((s) => s.key), ["studio_extended"]);
  const s = r.services[0]; assert.equal(s.enabled, false); assert.equal(s.cost, null); assert.equal(s.term, null); assert.equal(s.accessMode, "plus_mjt");
  assert.ok(r.policy.length >= 4, "refund policy is shown to admins");
  clear(); assert.deepEqual((await free1.req("GET", "/api/mjt/services")).services, [], "members see nothing while disabled");
  assert.equal((await buy(free1, STUDIO, { priceVersion: 1, ikey: key() })).code, "service_disabled");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/services/" + STUDIO, { enabled: true })).code, "cost_required", "no enabling without a cost");
  clear(); assert.equal((await admin.req("PUT", "/api/admin/mjt/services/" + STUDIO, { cost: 5, enabled: true })).code, "cost_required", "no enabling without a term");
  for (const f of ["translate", "assistant", "appearance", "post", "messages"]) { clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/services", { kind: "feature", target: f })).code, "not_wireable", f); }
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/services", { kind: "course", target: freeCourse })).code, "not_premium");
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/services", { kind: "post", target: "x" })).code, "bad_kind");
  clear(); const c = await admin.req("GET", "/api/admin/mjt/services/candidates?kind=course"); assert.deepEqual(c.items.map((x) => x.target), [course], "only paid courses are candidates");
  assert.equal((await RW().listSources()).sources.every((x) => !x.enabled && x.amount === null), true, "phase-4 sources untouched");
});

test("admin endpoints: members 403, signed out 401", async () => {
  for (const [m, p, b] of [["GET", "/api/admin/mjt/services"], ["GET", "/api/admin/mjt/services/candidates?kind=course"], ["GET", "/api/admin/mjt/services/purchases"], ["GET", "/api/admin/mjt/services/" + STUDIO],
    ["POST", "/api/admin/mjt/services", { kind: "course", target: course }], ["PUT", "/api/admin/mjt/services/" + STUDIO, { cost: 1, term: "permanent", enabled: true }], ["POST", "/api/admin/mjt/services/purchases/x/refund", { reason: "محاولة عضو عادي" }]]) {
    clear(); assert.equal((await free1.req(m, p, b)).status, 403, `${m} ${p}`);
    clear(); assert.equal((await new H.Client().req(m, p, b)).status, 401, `${m} ${p} signed out`);
  }
  const s = await admin.req("GET", "/api/admin/mjt/services/" + STUDIO); assert.equal(s.service.enabled, false, "member attempts changed nothing");
  clear(); assert.equal((await new H.Client().req("GET", "/api/mjt/services")).status, 401);
});

test("purchase with MJT (feature unlock, time-limited): debit once, entitlement recorded, studio > 90 days opens, history everywhere", async () => {
  const s = await edit(STUDIO, { cost: 5, term: "days", durationDays: 30, enabled: true });
  assert.equal(s.priceVersion, 2, "cost / term change = new price version"); assert.equal(s.cost, "5");
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=180")).status, 402, "Plus feature before purchase");
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=90")).status, 200, "up to 90 days stays free");
  await fund(free1.id, 12);
  const v = await svcOf(free1, STUDIO); assert.equal(v.canBuy, true); assert.equal(v.cost, "5"); assert.equal(v.priceVersion, 2); assert.equal(v.hasAccess, false); assert.equal(v.durationDays, 30);
  const r = await buy(free1, STUDIO, { priceVersion: 2, ikey: key("p") }); assert.equal(r.status, 200, r.error);
  assert.equal(r.purchased, true); assert.equal(r.purchase.cost, "5"); assert.equal(r.purchase.priceVersion, 2); assert.equal(r.balanceAfter, "7"); assert.equal(r.wallet.balance, "7");
  assert.ok(r.expiresAt && Math.abs(Date.parse(r.expiresAt) - Date.now() - 30 * 864e5) < 60e3, "expires in 30 days");
  assert.equal(await bal(free1.id), 7 * UNIT);
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=180")).status, 200, "unlocked server-side");
  clear(); const mine = await free1.req("GET", "/api/mjt/services/mine"); assert.equal(mine.items.length, 1); assert.equal(mine.items[0].state, "active"); assert.equal(mine.items[0].permanent, false);
  clear(); const hist = await free1.req("GET", "/api/mjt/services/history"); assert.equal(hist.items.length, 1); assert.equal(hist.items[0].status, "active");
  clear(); const wh = await free1.req("GET", "/api/mjt/wallet/history"); const sp = wh.items.find((x) => x.kind === "spend"); assert.ok(sp, "appears in wallet history"); assert.equal(sp.label, "خدمة مجتمع كوين"); assert.equal(sp.source, "خدمات مجتمع كوين"); // v2.164 one name
  assert.ok(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action='service_purchase' AND actor_id=$1", [free1.id]) === 1);
  // re-access an owned service: never debits again
  const again = await buy(free1, STUDIO, { priceVersion: 2, ikey: key("p") }); assert.equal(again.status, 200); assert.equal(again.alreadyHasAccess, true); assert.equal(again.reason, "owned");
  assert.equal(await bal(free1.id), 7 * UNIT);
  const v2 = await svcOf(free1, STUDIO); assert.equal(v2.hasAccess, true); assert.equal(v2.canBuy, false); assert.ok(v2.expiresAt);
});

test("insufficient balance: refused, nothing debited, nothing granted", async () => {
  await fund(free2.id, 2);
  const r = await buy(free2, STUDIO, { priceVersion: 2, ikey: key("i") }); assert.equal(r.status, 409); assert.equal(r.code, "insufficient_balance");
  assert.equal(await bal(free2.id), 2 * UNIT);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_service_purchases WHERE user_id=$1", [free2.id]), 0);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_entitlements WHERE user_id=$1", [free2.id]), 0);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1 AND kind='spend'", [free2.id]), 0);
});

test("API price tampering: amounts in the body are rejected; missing / stale price version rejected; old purchases keep their price", async () => {
  await fund(free2.id, 20); const before = await bal(free2.id);
  for (const forged of [{ amount: 1 }, { cost: "1" }, { price: 0 }, { units: 1 }]) {
    const r = await buy(free2, STUDIO, { priceVersion: 2, ikey: key("x"), ...forged }); assert.equal(r.status, 400); assert.equal(r.code, "amount_not_accepted");
  }
  assert.equal((await buy(free2, STUDIO, { ikey: key("x") })).code, "price_version_required");
  assert.equal((await buy(free2, STUDIO, { priceVersion: 1, ikey: key("x") })).code, "price_changed");
  await edit(STUDIO, { cost: 8 }); // → version 3
  const stale = await buy(free2, STUDIO, { priceVersion: 2, ikey: key("x") }); assert.equal(stale.status, 409); assert.equal(stale.code, "price_changed"); assert.equal(stale.current.priceVersion, 3); assert.equal(stale.current.cost, "8");
  assert.equal(await bal(free2.id), before, "nothing debited by any rejected call");
  const ok = await buy(free2, STUDIO, { priceVersion: 3, ikey: key("x") }); assert.equal(ok.status, 200, ok.error); assert.equal(ok.purchase.cost, "8"); assert.equal(ok.purchase.priceVersion, 3);
  assert.equal(before - (await bal(free2.id)), 8 * UNIT, "server read the cost itself");
  const old = await db().get("SELECT cost, price_version FROM mjt_service_purchases WHERE user_id=$1", [free1.id]);
  assert.equal(Number(old.cost), 5 * UNIT); assert.equal(Number(old.price_version), 2, "the earlier purchase keeps the price it confirmed");
  const d = await admin.req("GET", "/api/admin/mjt/services/" + STUDIO); assert.deepEqual(d.prices.map((p) => p.version), [3, 2, 1]);
});

test("Free vs Plus: Plus-included → «already have access», no debit; plus-only modes refuse Free members", async () => {
  await fund(plusM.id, 20); const before = await bal(plusM.id);
  const v = await svcOf(plusM, STUDIO); assert.equal(v.hasAccess, true); assert.equal(v.accessReason, "plus_included"); assert.equal(v.canBuy, false);
  const r = await buy(plusM, STUDIO, { priceVersion: 3, ikey: key("pl") }); assert.equal(r.status, 200); assert.equal(r.alreadyHasAccess, true); assert.equal(r.reason, "plus_included");
  assert.equal(await bal(plusM.id), before, "Plus member never charged for what Plus includes");
  // mode «plus» (Plus only, not purchasable): a Free member gets 402, never a debit
  await edit(STUDIO, { accessMode: "plus" });
  const f = await mk("sv_free3"); await fund(f.id, 20);
  const p = await buy(f, STUDIO, { priceVersion: 3, ikey: key("pl") }); assert.equal(p.status, 402); assert.equal(p.code, "plus_required");
  // mode «mjt» with eligible = plus: Free refused; Plus already has the feature natively → no debit
  await edit(STUDIO, { accessMode: "mjt", eligible: "plus" });
  assert.equal((await buy(f, STUDIO, { priceVersion: 3, ikey: key("pl") })).code, "plus_required");
  const pn = await buy(plusM, STUDIO, { priceVersion: 3, ikey: key("pl") }); assert.equal(pn.alreadyHasAccess, true); assert.equal(pn.reason, "native");
  assert.equal(await bal(f.id), 20 * UNIT); assert.equal(await bal(plusM.id), before);
  await edit(STUDIO, { accessMode: "plus_mjt", eligible: "all" });
});

test("free-for-all mode: nothing is ever debited", async () => {
  await edit(STUDIO, { accessMode: "free" });
  const f = await mk("sv_free4"); await fund(f.id, 20);
  const r = await buy(f, STUDIO, { priceVersion: 3, ikey: key("fr") }); assert.equal(r.alreadyHasAccess, true); assert.equal(r.reason, "free");
  clear(); assert.equal((await f.req("GET", "/api/studio/overview?days=365")).status, 200);
  assert.equal(await bal(f.id), 20 * UNIT);
  await edit(STUDIO, { accessMode: "plus_mjt" });
  clear(); assert.equal((await f.req("GET", "/api/studio/overview?days=365")).status, 402, "back to gated once the free mode ends");
});

test("disable from admin: purchases refused, members' list hides it, owners keep what they bought", async () => {
  await edit(STUDIO, { enabled: false });
  const f = await mk("sv_free5"); await fund(f.id, 20);
  assert.equal((await buy(f, STUDIO, { priceVersion: 3, ikey: key("d") })).code, "service_disabled");
  assert.equal(await svcOf(f, STUDIO), undefined);
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=180")).status, 200, "owner keeps access while disabled");
  assert.equal(await bal(f.id), 20 * UNIT);
  await edit(STUDIO, { enabled: true });
});

test("time-limited entitlement: expiry enforced server-side, then buying again debits once more", async () => {
  await db().run("UPDATE mjt_entitlements SET expires_at=$1 WHERE user_id=$2", [new Date(Date.now() - 1000).toISOString(), free1.id]);
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=180")).status, 402, "expired → gated again");
  clear(); const mine = await free1.req("GET", "/api/mjt/services/mine"); assert.equal(mine.items[0].state, "expired");
  const v = await svcOf(free1, STUDIO); assert.equal(v.hasAccess, false); assert.equal(v.canBuy, true);
  await fund(free1.id, 10); const before = await bal(free1.id);
  const r = await buy(free1, STUDIO, { priceVersion: 3, ikey: key("re") }); assert.equal(r.status, 200, r.error); assert.equal(r.purchase.cost, "8");
  assert.equal(before - (await bal(free1.id)), 8 * UNIT);
  clear(); assert.equal((await free1.req("GET", "/api/studio/overview?days=180")).status, 200);
});

let courseSvc;
test("course content unlock: admin registers a paid course (disabled), sets a permanent cost; purchase enrols; re-access never debits", async () => {
  clear(); const reg = await admin.req("POST", "/api/admin/mjt/services", { kind: "course", target: course }); assert.equal(reg.status, 200, reg.error);
  courseSvc = reg.service; assert.equal(courseSvc.enabled, false); assert.equal(courseSvc.cost, null); assert.equal(courseSvc.term, null);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/services", { kind: "course", target: course })).code, "exists");
  courseSvc = await edit(courseSvc.id, { cost: 4, term: "permanent", enabled: true });
  clear(); assert.equal((await free2.req("POST", `/api/courses/${course}/enrol`)).code, "needs_purchase");
  const v = await svcOf(free2, courseSvc.id); assert.equal(v.canBuy, true); assert.equal(v.href, `#/course/${course}`);
  // the teacher (native access) and a digital-store buyer are never charged
  await fund(teacher.id, 10);
  const t = await buy(teacher, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("c") }); assert.equal(t.alreadyHasAccess, true); assert.equal(t.reason, "native");
  const before = await bal(free2.id);
  const r = await buy(free2, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("c") }); assert.equal(r.status, 200, r.error); assert.equal(r.expiresAt, null, "permanent");
  assert.equal(before - (await bal(free2.id)), 4 * UNIT);
  clear(); const d = await free2.req("GET", "/api/courses/" + course); assert.equal(d.me.enrolled, true, "delivery = enrolment"); assert.equal(d.me.locked, false);
  clear(); assert.equal((await free2.req("GET", "/api/course-lessons/" + lessonId)).status, 200);
  const again = await buy(free2, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("c") }); assert.equal(again.reason, "owned");
  assert.equal(before - (await bal(free2.id)), 4 * UNIT, "no second debit");
  assert.equal(await bal(teacher.id), 10 * UNIT);
});

test("idempotency: same key replays without a second debit; parallel purchases (different or same key) debit exactly once", async () => {
  const u = await mk("sv_par"); await fund(u.id, 50);
  const pv = courseSvc.priceVersion;
  clear(); const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => u.req("POST", `/api/mjt/services/${courseSvc.id}/purchase`, { priceVersion: pv, ikey: key("par" + i) })));
  assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status + r.code).join(","));
  assert.equal(rs.filter((r) => r.purchased).length, 1, "one purchase"); assert.equal(rs.filter((r) => r.alreadyHasAccess).length, 5);
  assert.equal(await bal(u.id), 46 * UNIT); assert.equal(await n("SELECT COUNT(*) n FROM mjt_service_purchases WHERE user_id=$1", [u.id]), 1);
  const u2 = await mk("sv_par2"); await fund(u2.id, 50); const same = key("same");
  clear(); const rs2 = await Promise.all(Array.from({ length: 5 }, () => u2.req("POST", `/api/mjt/services/${courseSvc.id}/purchase`, { priceVersion: pv, ikey: same })));
  assert.ok(rs2.every((r) => r.status === 200 && r.purchased), rs2.map((r) => r.status + r.code).join(","));
  assert.equal(new Set(rs2.map((r) => r.purchase.id)).size, 1, "same purchase every time");
  assert.equal(await bal(u2.id), 46 * UNIT); assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1 AND kind='spend'", [u2.id]), 1);
  const rp = await buy(u2, courseSvc.id, { priceVersion: pv, ikey: same }); assert.equal(rp.replayed, true); assert.equal(await bal(u2.id), 46 * UNIT);
  assert.equal((await buy(u2, STUDIO, { priceVersion: 3, ikey: same })).code, "ikey_reused", "a key can't be reused for another service");
  assert.equal((await buy(u2, STUDIO, { priceVersion: 3, ikey: "short" })).code, "ikey_required");
});

test("a failure inside the purchase transaction rolls everything back: no debit, no purchase, no entitlement", async () => {
  const u = await mk("sv_fault"); await fund(u.id, 10);
  faultOn = true;
  try { const r = await buy(u, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("f") }); assert.equal(r.status, 500); }
  finally { faultOn = false; }
  assert.equal(await bal(u.id), 10 * UNIT);
  for (const t of ["mjt_service_purchases", "mjt_entitlements"]) assert.equal(await n(`SELECT COUNT(*) n FROM ${t} WHERE user_id=$1`, [u.id]), 0, t);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1 AND kind='spend'", [u.id]), 0);
});

test("delivery failure after the debit → automatic full refund (compensating, append-only), entitlement revoked, audited", async () => {
  const u = await mk("sv_deliv"); await fund(u.id, 10);
  const orig = SV().H.course.deliver; SV().H.course.deliver = async () => { throw new Error("enrolment service unavailable"); };
  let r; try { r = await buy(u, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("dl") }); } finally { SV().H.course.deliver = orig; }
  assert.equal(r.status, 409); assert.equal(r.code, "delivery_failed_refunded"); assert.equal(r.refunded, true); assert.equal(r.wallet.balance, "10");
  assert.equal(await bal(u.id), 10 * UNIT, "no balance lost");
  const p = await db().get("SELECT * FROM mjt_service_purchases WHERE user_id=$1", [u.id]); assert.equal(p.status, "refunded"); assert.match(p.refund_reason, /تعذّر تسليم/);
  assert.equal((await db().get("SELECT status FROM mjt_entitlements WHERE purchase_id=$1", [p.id])).status, "revoked");
  const j = await db().all("SELECT kind, source, status FROM mjt_reward_entries WHERE user_id=$1 AND kind<>'earn' ORDER BY created_at", [u.id]);
  assert.deepEqual(j.map((x) => [x.kind, x.source]), [["spend", "service:" + courseSvc.key], ["adjust_credit", "service_refund"]], "debit kept, refund appended");
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_audit WHERE action='service_refund_auto' AND target=$1", [u.id]), 1);
  clear(); assert.equal((await u.req("POST", `/api/courses/${course}/enrol`)).code, "needs_purchase", "no access after the refund");
  clear(); const wh = await u.req("GET", "/api/mjt/wallet/history"); assert.ok(wh.items.some((x) => x.label === "استرداد خدمة"));
});

test("manual refund: admin only, reason mandatory, full confirmed amount, once, revokes access, audited", async () => {
  const p = await db().get("SELECT * FROM mjt_service_purchases WHERE user_id=$1 AND service_id=$2 AND status='active'", [free2.id, courseSvc.id]);
  clear(); assert.equal((await free2.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, { reason: "أريد استرداد المبلغ" })).status, 403);
  clear(); assert.equal((await admin.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, {})).status, 400, "reason required");
  clear(); assert.equal((await admin.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, { reason: "قص" })).status, 400, "≥ 5 chars");
  const before = await bal(free2.id);
  clear(); const r = await admin.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, { reason: "الدورة لم تعمل كما وُصفت" }); assert.equal(r.status, 200, r.error);
  assert.equal(r.purchase.status, "refunded"); assert.equal((await bal(free2.id)) - before, Number(p.cost));
  clear(); assert.equal((await admin.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, { reason: "مرة ثانية للتجربة" })).code, "already_refunded");
  assert.equal((await bal(free2.id)) - before, Number(p.cost), "refunded once");
  clear(); const lz = await free2.req("GET", "/api/course-lessons/" + lessonId); assert.equal(lz.code, "needs_purchase", "lessons closed after the refund (expiry / refund checked on every lesson)");
  const a = await db().get("SELECT * FROM mjt_audit WHERE action='service_refund' AND target=$1", [free2.id]); assert.ok(a); assert.equal(a.actor_id, admin.id); assert.match(a.detail, /الدورة لم تعمل/);
  clear(); const list = await admin.req("GET", "/api/admin/mjt/services/purchases?status=refunded"); assert.ok(list.items.some((x) => x.id === p.id && x.refundReason));
  clear(); const st = await admin.req("GET", "/api/admin/mjt/services"); const cs = st.services.find((x) => x.id === courseSvc.id);
  assert.equal(cs.usage.purchases, 4); assert.equal(cs.usage.refunded, 2); assert.equal(cs.usage.spent, "8", "total MJT spent excludes refunded purchases");
});

test("frozen wallet: cannot spend (nothing debited); a refund still reaches a frozen wallet", async () => {
  const u = await mk("sv_frz"); await fund(u.id, 30);
  const ok = await buy(u, courseSvc.id, { priceVersion: courseSvc.priceVersion, ikey: key("z") }); assert.equal(ok.status, 200, ok.error);
  clear(); assert.equal((await admin.req("POST", "/api/admin/mjt/rewards/wallets/sv_frz/freeze", { frozen: true, reason: "مراجعة أمنية للحساب" })).status, 200);
  const before = await bal(u.id);
  const r = await buy(u, STUDIO, { priceVersion: 3, ikey: key("z") }); assert.equal(r.status, 409); assert.equal(r.code, "account_frozen");
  assert.equal(await bal(u.id), before);
  const p = await db().get("SELECT id FROM mjt_service_purchases WHERE user_id=$1", [u.id]);
  clear(); const rf = await admin.req("POST", `/api/admin/mjt/services/purchases/${p.id}/refund`, { reason: "استرداد أثناء المراجعة" }); assert.equal(rf.status, 200, rf.error);
  assert.equal((await bal(u.id)) - before, 4 * UNIT);
  clear(); await admin.req("POST", "/api/admin/mjt/rewards/wallets/sv_frz/freeze", { frozen: false, reason: "انتهت المراجعة الأمنية" });
});

test("free resources stay free: free courses enrol and open lessons with no MJT; basic actions never touch the wallet", async () => {
  const u = await mk("sv_freeres");
  clear(); assert.equal((await u.req("POST", `/api/courses/${freeCourse}/enrol`)).status, 200);
  clear(); const p = await u.req("POST", "/api/posts", { text: "منشور عادي مجاني تماماً" }); assert.ok([200, 201].includes(p.status), p.error);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_reward_entries WHERE user_id=$1", [u.id]), 0);
  assert.equal(await n("SELECT COUNT(*) n FROM mjt_service_purchases WHERE user_id=$1", [u.id]), 0);
});

test("rate limit on purchases", async () => {
  const u = await mk("sv_rl"); clear(); let limited = false;
  for (let i = 0; i < 25 && !limited; i++) { const r = await u.req("POST", `/api/mjt/services/${STUDIO}/purchase`, { priceVersion: 1, ikey: key("rl") }); if (r.status === 429) limited = true; }
  assert.equal(limited, true);
});

test("Free / Plus quotas unchanged; shared ledger still verifies", async () => {
  clear(); const L = await admin.req("GET", "/api/admin/membership/limits"); assert.equal(L.status, 200, L.error);
  assert.deepEqual(Object.fromEntries(Object.entries(L.limits).map(([kk, x]) => [kk, [x.free, x.plus]])), { saved_searches: [25, 100], collections: [50, 200], quiz_attempts_daily: [10, 30], teams_owned: [5, 20], team_members: [50, 150] });
  const v = await H.app.ctx.services.mjt.verify(); assert.equal(v.ok, true, v.problems.join(","));
});
