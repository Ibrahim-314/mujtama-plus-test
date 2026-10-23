/* Phase 63 — creator ↔ brand collaborations and sponsorships.
 * Media kit (open / closed, stats, private + minors hidden), brand profile (allowed categories, prohibited terms), campaigns
 * (prohibited-terms hold for staff review, staff approve / remove, apply once, slots), offers (needs brand + open kit, no
 * minors, no blocks, one open offer per pair, collab must be unpaid), negotiation (turns, counter, accept / decline, cancel
 * with reason), deliverables (own post only, AUTO-LABEL locked on the post — visible in the post payload — cannot be
 * removed), brand review → completed, paid marks are a record only, report totals, self-disclosure (removable unless
 * locked), undisclosed-ad reports → staff label (locked), public library honours visibility, admin brand suspension
 * closes campaigns, migration 048 reversible + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, staff, brand, cr, cr2, other, kid, camp, dealId, postId;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const DL = [{ format: "video", label: "فيديو مراجعة مدته دقيقة", due: "2030-01-10" }, { format: "story", label: "قصة مع رابط المتجر" }];
test.before(async () => {
  H = await boot();
  staff = await mk("cb_staff", "فريق المنصة"); brand = await mk("cb_brand", "متجر التقنية"); cr = await mk("cb_creator", "ليان القحطاني"); cr2 = await mk("cb_creator2", "خالد"); other = await mk("cb_other"); kid = await mk("cb_kid", "طفل");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("media kit: open with categories, stats, listing; minors and closed kits hidden", async () => {
  assert.equal((await cr.req("PUT", "/api/collabs/kit", { open: true, categories: [] })).status, 400);
  const k = await cr.req("PUT", "/api/collabs/kit", { open: true, headline: "صانعة محتوى تقني بالعربية", categories: ["tech", "education", "bogus"], formats: ["video", "short"], rateFrom: 50, rateNote: "حسب المدة" });
  assert.equal(k.status, 200, k.error); assert.deepEqual(k.kit.categories.map((c) => c.key), ["tech", "education"]); assert.equal(k.kit.rateFrom, 50);
  await cr2.req("PUT", "/api/collabs/kit", { open: true, categories: ["gaming"] });
  assert.equal((await kid.req("PUT", "/api/collabs/kit", { open: true, categories: ["tech"] })).status, 403);
  const pub = await new H.Client().req("GET", "/api/collabs/kits/cb_creator");
  assert.equal(pub.status, 200, pub.error); assert.equal(pub.kit.stats.followers, 0); assert.ok(!JSON.stringify(pub).match(/email|phone/i));
  const list = await brand.req("GET", "/api/collabs/creators?category=tech");
  assert.deepEqual(list.creators.map((c) => c.user.handle), ["cb_creator"]);
  assert.equal((await new H.Client().req("GET", "/api/collabs/kits/cb_other")).status, 404);
});

test("brand profile + campaigns: prohibited terms held for staff; approve; apply once; staff-only admin", async () => {
  assert.equal((await brand.req("POST", "/api/collabs/campaigns", { title: "حملة", summary: "x".repeat(30), deliverables: DL })).code, "no_brand");
  assert.equal((await brand.req("PUT", "/api/collabs/brand", { name: "كازينو الحظ", category: "other" })).status, 400);
  assert.equal((await brand.req("PUT", "/api/collabs/brand", { name: "متجر", category: "nope" })).status, 400);
  assert.equal((await kid.req("PUT", "/api/collabs/brand", { name: "متجر الطفل", category: "tech" })).status, 403);
  const b = await brand.req("PUT", "/api/collabs/brand", { name: "متجر التقنية", category: "tech", website: "https://tech.example.com", about: "إلكترونيات أصلية بضمان" });
  assert.equal(b.status, 200, b.error); assert.equal(b.brand.categoryLabel, "تقنية");
  const held = await brand.req("POST", "/api/collabs/campaigns", { title: "عرض خاص للمراهنات", summary: "روّج لتطبيق مراهنات رياضية مع مكافأة تسجيل للمتابعين", deliverables: DL });
  assert.equal(held.status, 200, held.error); assert.equal(held.campaign.status, "review");
  assert.ok(!(await cr.req("GET", "/api/collabs/campaigns")).campaigns.some((c) => c.id === held.campaign.id));
  assert.equal((await cr.req("GET", "/api/admin/collabs")).status, 403);
  const adm = await staff.req("GET", "/api/admin/collabs"); assert.equal(adm.held.length, 1);
  await staff.req("POST", `/api/admin/collabs/campaigns/${held.campaign.id}`, { decision: "reject", note: "مراهنات" });
  const c = await brand.req("POST", "/api/collabs/campaigns", { title: "إطلاق سماعات لاسلكية", summary: "نبحث عن صنّاع تقنية لمراجعة سماعاتنا الجديدة بصدق، مع ذكر المزايا والعيوب.", deliverables: DL, categories: ["tech"], formats: ["video"], fee: 120, slots: 1, deadline: "2030-01-01" });
  assert.equal(c.campaign.status, "open"); camp = c.campaign;
  const found = await cr.req("GET", "/api/collabs/campaigns?category=tech&q=سماعات"); assert.ok(found.campaigns.some((x) => x.id === camp.id));
  assert.equal((await brand.req("POST", `/api/collabs/campaigns/${camp.id}/apply`, { pitch: "x".repeat(30) })).status, 400);
  assert.equal((await kid.req("POST", `/api/collabs/campaigns/${camp.id}/apply`, { pitch: "x".repeat(30) })).status, 403);
  const ap = await cr.req("POST", `/api/collabs/campaigns/${camp.id}/apply`, { pitch: "أراجع السماعات منذ ثلاث سنوات ولدي جمهور مهتم بالتقنية", fee: 150 });
  assert.equal(ap.status, 200, ap.error); assert.equal(ap.deal.turn, "brand"); assert.equal(ap.deal.fee, 150); assert.equal(ap.deal.deliverables.length, 2);
  dealId = ap.deal.id;
  assert.equal((await cr.req("POST", `/api/collabs/campaigns/${camp.id}/apply`, { pitch: "x".repeat(30) })).status, 409);
  const view = await brand.req("GET", "/api/collabs/campaigns/" + camp.id); assert.equal(view.applications.length, 1);
  assert.equal((await other.req("GET", "/api/collab-deals/" + dealId)).status, 404);
});

test("negotiation: turns, counter, accept; slots; offers need brand + open kit; collab unpaid; no minors", async () => {
  assert.equal((await cr.req("POST", `/api/collab-deals/${dealId}/accept`)).status, 400); // not their turn
  const co = await brand.req("POST", `/api/collab-deals/${dealId}/counter`, { fee: 130, message: "نقترح ١٣٠ مع شحن مجاني" });
  assert.equal(co.status, 200, co.error); assert.equal(co.deal.turn, "creator"); assert.equal(co.deal.fee, 130); assert.ok(co.messages.some((m) => m.kind === "event" && /130 Pi/.test(m.body)));
  const acc = await cr.req("POST", `/api/collab-deals/${dealId}/accept`); assert.equal(acc.deal.status, "active");
  // offers
  assert.equal((await other.req("POST", "/api/collabs/offers", { creator: "cb_creator", title: "عرض جديد", summary: "x".repeat(30), deliverables: DL })).code, "no_brand");
  assert.equal((await brand.req("POST", "/api/collabs/offers", { creator: "cb_other", title: "عرض جديد", summary: "x".repeat(30), deliverables: DL })).status, 400); // closed kit
  assert.equal((await brand.req("POST", "/api/collabs/offers", { creator: "cb_kid", title: "عرض جديد", summary: "x".repeat(30), deliverables: DL })).status, 404);
  assert.equal((await cr2.req("POST", "/api/collabs/offers", { creator: "cb_creator", kind: "collab", fee: 10, title: "تعاون", summary: "x".repeat(30), deliverables: DL })).status, 400);
  const col = await cr2.req("POST", "/api/collabs/offers", { creator: "cb_creator", kind: "collab", title: "حلقة مشتركة", summary: "نصوّر حلقة مشتركة عن أفضل ألعاب السنة", deliverables: [{ format: "video", label: "حلقة مشتركة" }] });
  assert.equal(col.status, 200, col.error); assert.equal(col.deal.label, "تعاون مع خالد");
  assert.equal((await cr2.req("POST", "/api/collabs/offers", { creator: "cb_creator", kind: "collab", title: "حلقة أخرى", summary: "x".repeat(30), deliverables: DL })).status, 409);
  const dec = await cr.req("POST", `/api/collab-deals/${col.deal.id}/decline`, { reason: "جدولي ممتلئ" }); assert.equal(dec.deal.status, "declined");
  // blocks
  await db().run("INSERT INTO user_blocks(owner,target,at) VALUES($1,$2,$3)", [cr2.id, brand.id, new Date().toISOString()]).catch(() => null);
  const blk = await brand.req("POST", "/api/collabs/offers", { creator: "cb_creator2", title: "عرض", summary: "x".repeat(30), deliverables: DL });
  assert.ok([403, 400].includes(blk.status), "blocked pair: " + blk.status);
});

test("deliver: own post only, auto-label LOCKED on the post payload; review → completed; paid is a record; report", async () => {
  H.app.ctx.rl.w.clear();
  const p = await cr.req("POST", "/api/posts", { type: "post", text: "جرّبت سماعات متجر التقنية لمدة أسبوع، وهذه تجربتي بصراحة" }); postId = p.post.id;
  const notMine = await other.req("POST", "/api/posts", { type: "post", text: "منشور آخر" });
  const d0 = (await cr.req("GET", "/api/collab-deals/" + dealId)).deal.deliverables;
  assert.equal((await cr.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[0].id, postId: notMine.post.id })).status, 400);
  assert.equal((await brand.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[0].id, postId })).status, 403);
  const dv = await cr.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[0].id, postId });
  assert.equal(dv.status, 200, dv.error); assert.equal(dv.deal.deliverables[0].status, "submitted");
  // the label rides on the post everywhere it is rendered
  const post = await new H.Client().req("GET", "/api/posts/" + postId);
  const pp = post.post || post; assert.equal(pp.partner.kind, "sponsored"); assert.equal(pp.partner.label, "محتوى مدفوع · شراكة مع متجر التقنية"); assert.equal(pp.partner.paid, true);
  assert.equal((await cr.req("DELETE", `/api/posts/${postId}/partnership`)).status, 400); // locked
  assert.equal((await cr.req("PUT", `/api/posts/${postId}/partnership`, { kind: "gifted", brand: "غيره" })).status, 400);
  // review
  const ch = await brand.req("POST", `/api/collab-deals/${dealId}/review`, { deliverableId: d0[0].id, decision: "changes", note: "اذكر مدة البطارية" });
  assert.equal(ch.deal.deliverables[0].status, "changes");
  await cr.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[0].id, postId });
  await brand.req("POST", `/api/collab-deals/${dealId}/review`, { deliverableId: d0[0].id, decision: "approve" });
  H.app.ctx.rl.w.clear(); const p2 = await cr.req("POST", "/api/posts", { type: "post", text: "قصة: رابط متجر التقنية" });
  assert.equal((await cr.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[1].id, postId })).status, 400); // same post for another item
  await cr.req("POST", `/api/collab-deals/${dealId}/deliver`, { deliverableId: d0[1].id, postId: p2.post.id });
  const fin = await brand.req("POST", `/api/collab-deals/${dealId}/review`, { deliverableId: d0[1].id, decision: "approve" });
  assert.equal(fin.deal.status, "completed"); assert.ok(fin.deal.completedAt);
  const paid = await brand.req("POST", `/api/collab-deals/${dealId}/paid`); assert.equal(paid.deal.paid.brand, true); assert.ok(paid.messages.some((m) => /تسجيل فقط/.test(m.body)));
  assert.equal((await cr.req("POST", `/api/collab-deals/${dealId}/paid`)).deal.paid.creator, true);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM pi_payments").catch(() => ({ n: 0 }))).n), 0); // nothing moved
  const rep = await brand.req("GET", `/api/collab-deals/${dealId}/report`); assert.equal(rep.totals.posts, 2);
  const mine = await cr.req("GET", "/api/collabs/deals?tab=done"); assert.ok(mine.deals.some((d) => d.id === dealId));
  // campaign slot now full
  H.app.ctx.rl.w.clear(); assert.equal((await cr2.req("POST", `/api/collabs/campaigns/${camp.id}/apply`, { pitch: "x".repeat(30) })).status, 400);
});

test("self-disclosure (removable), undisclosed-ad reports → staff label (locked), library visibility, brand suspension", async () => {
  H.app.ctx.rl.w.clear();
  const p = await cr2.req("POST", "/api/posts", { type: "post", text: "هدية وصلتني من متجر العطور" });
  const sd = await cr2.req("PUT", `/api/posts/${p.post.id}/partnership`, { kind: "gifted", brand: "متجر العطور" });
  assert.equal(sd.status, 200, sd.error); assert.equal(sd.partner.label, "هدية من متجر العطور · إفصاح");
  assert.equal((await cr2.req("DELETE", `/api/posts/${p.post.id}/partnership`)).status, 200);
  const pz = await new H.Client().req("GET", "/api/posts/" + p.post.id); assert.equal((pz.post || pz).partner, undefined);
  // report → label
  const sus = await other.req("POST", "/api/posts", { type: "post", text: "أفضل مطعم في جدة!! اطلبوا الآن بالكود" });
  assert.equal((await other.req("POST", `/api/posts/${sus.post.id}/undisclosed-report`, {})).status, 400); // own post
  assert.equal((await cr.req("POST", `/api/posts/${sus.post.id}/undisclosed-report`, { brand: "مطعم البيت", note: "يبدو إعلاناً" })).status, 200);
  assert.equal((await cr.req("POST", `/api/posts/${sus.post.id}/undisclosed-report`, {})).status, 409);
  const adm = await staff.req("GET", "/api/admin/collabs"); assert.equal(adm.reports[0].postId, sus.post.id);
  await staff.req("POST", `/api/admin/collabs/reports/${sus.post.id}`, { decision: "label", kind: "sponsored", brand: "مطعم البيت" });
  assert.equal((await other.req("DELETE", `/api/posts/${sus.post.id}/partnership`)).status, 400);
  // library: public posts only
  H.app.ctx.rl.w.clear(); const priv = await cr.req("POST", "/api/posts", { type: "post", text: "للمتابعين فقط", visibility: "followers" });
  await cr.req("PUT", `/api/posts/${priv.post.id}/partnership`, { kind: "affiliate", brand: "متجر التقنية" });
  const lib = await new H.Client().req("GET", "/api/collabs/library");
  assert.ok(lib.items.some((i) => i.postId === postId)); assert.ok(lib.items.some((i) => i.postId === sus.post.id && i.source === "staff"));
  assert.ok(!lib.items.some((i) => i.postId === priv.post.id));
  const bp = await new H.Client().req("GET", "/api/collabs/brands/" + brand.id); assert.equal(bp.brand.completedDeals, 1);
  // suspension closes campaigns + blocks new ones
  await staff.req("POST", `/api/admin/collabs/brands/${brand.id}`, { status: "suspended" });
  assert.equal((await db().get("SELECT status FROM collab_campaigns WHERE id=$1", [camp.id])).status, "closed");
  assert.equal((await brand.req("POST", "/api/collabs/campaigns", { title: "حملة أخرى", summary: "x".repeat(30), deliverables: DL })).status, 403);
});

test("migration 048 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '048_collabs' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "048_collabs"]);
  await assert.rejects(() => db().get("SELECT 1 FROM collab_deals"));
  assert.deepEqual(await mig.up(db()), ["048_collabs", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["collab_profiles", "collab_brands", "collab_campaigns", "collab_deals", "collab_messages", "post_partnerships", "collab_reports"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [cr.id]); }
});
