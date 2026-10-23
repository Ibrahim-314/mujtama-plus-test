/* Phase 58 — digital products store on top of the phase 39 market: private files in media storage (never via /media/),
 * product create/read/preview, instant delivery after Pi payment, license keys, library «مشترياتي», expiring buyer-bound
 * download links + limits, refund policy (escrow refund), creator stats, minors excluded, reports → takedown (+ sha block),
 * disabled when Pi payments are off. PostgreSQL. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const { piStub, users } = require("./pi-stub");

const stub = piStub("sk_test_dg_58");
let H, U, admin, sel, buy, buy2, kid, img, pdf, zip, prev, prodA, prodB;
const db = () => H.app.ctx.db, S = () => H.app.ctx.services;
const settle = () => S().digital.settle();
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n% مجتمع بلس كتاب\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("template-bundle-contents")]);
const up = async (c, buf, q = "") => c.req("POST", "/api/digital/files" + q, buf);
test.before(async () => {
  H = await boot({ piOpts: { env: stub.env, fetch: stub.fetch, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, creatorSubsOpts: { jobs: false }, pricingOpts: { jobs: false } });
  U = users(H, stub);
  admin = await U.mk("dg_admin"); sel = await U.mk("dg_sel"); buy = await U.mk("dg_buy"); buy2 = await U.mk("dg_buy2"); kid = await U.mk("dg_kid");
  await db().run("UPDATE users SET role='admin' WHERE id=$1", [admin.id]);
  assert.equal((await kid.req("POST", "/api/age", { birthDate: "2013-05-01" })).status, 200);
  const m = await sel.req("POST", "/api/media", PNG, { "Content-Type": "image/png" }); assert.equal(m.status, 200, m.error); img = m.media.id;
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 038: down/up reversible, additive, data map", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '038_digital' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "038_digital"]);
  await assert.rejects(() => db().get("SELECT 1 FROM digital_products"));
  assert.deepEqual(await mig.up(db()), ["038_digital", ...later]);
  const s = require("../scripts/verify-migrations").staticCheck(); assert.equal(s.ok, true, s.problems.join("\n"));
  for (const m of require("../lib/compliance-lib").DATA_MAP.filter((x) => x.t.startsWith("digital_"))) await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [buy.id]);
});

test("files: types, minors, private storage (never via /media/), disabled when Pi is off", async () => {
  const cfg = await buy.req("GET", "/api/digital/config"); assert.equal(cfg.enabled, true); assert.equal(cfg.limits.maxFiles, 10);
  assert.equal((await up(sel, Buffer.from("just some text file"))).code, "type_unsupported");
  assert.equal((await up(kid, PDF)).code, "minor_restricted");
  const f = await up(sel, PDF, "?name=" + encodeURIComponent("دليل المبتدئ.pdf")); assert.equal(f.status, 200, f.error); pdf = f.file;
  assert.equal(pdf.mime, "application/pdf"); assert.equal(pdf.name, "دليل المبتدئ.pdf");
  zip = (await up(sel, ZIP, "?name=template.docx")).file; assert.match(zip.mime, /wordprocessingml/);
  prev = (await up(sel, PNG, "?name=preview.png&role=preview")).file; assert.equal(prev.role, "preview");
  const key = (await db().get("SELECT storage_key FROM digital_files WHERE id=$1", [pdf.id])).storage_key; assert.match(key, /^dg_/);
  assert.equal((await buy.req("GET", "/media/" + key)).status, 403);
  assert.equal((await sel.req("GET", "/media/" + key)).status, 403);
  const piSvc = S().pi, orig = piSvc.enabled; piSvc.enabled = () => false;
  try { assert.equal((await buy.req("GET", "/api/digital/config")).enabled, false); assert.equal((await up(sel, PDF)).code, "not_configured"); }
  finally { piSvc.enabled = orig; }
  assert.equal((await sel.req("GET", "/api/me/digital/files")).files.length, 3);
});

test("products: create (market listing kind digital), read, preview, store, market guards", async () => {
  assert.equal((await sel.req("POST", "/api/digital/products", { title: "كتاب", price: 2, images: [img], files: [] })).code, "files_invalid");
  assert.equal((await buy.req("POST", "/api/digital/products", { title: "سرقة", price: 2, images: [img], files: [pdf.id] })).code, "files_invalid");
  const a = await sel.req("POST", "/api/digital/products", { title: "كتاب ريادة الأعمال", description: "دليل عملي", price: 2, images: [img], type: "ebook", files: [pdf.id], previewFile: prev.id, sampleText: "الفصل الأول…", license: true, downloadLimit: 2, refundPolicy: "none" });
  assert.equal(a.status, 200, a.error); prodA = a.listing.id;
  assert.equal(a.listing.kind, "digital"); assert.equal(a.listing.delivery, "digital"); assert.equal(a.product.type, "ebook"); assert.equal(a.product.license, true);
  const b = await sel.req("POST", "/api/digital/products", { title: "قالب سيرة ذاتية", price: 1, images: [img], type: "template", files: [zip.id], refundPolicy: "undownloaded" }); assert.equal(b.status, 200, b.error); prodB = b.listing.id;
  const r = await buy.req("GET", "/api/digital/products/" + prodA); assert.equal(r.status, 200, r.error);
  assert.equal(r.product.files[0].name, "دليل المبتدئ.pdf"); assert.equal(r.product.files[0].id, undefined, "file ids are private"); assert.equal(r.listing.canBuy, true);
  const pv = await buy.req("GET", r.product.preview); assert.equal(pv.status, 200); assert.equal(pv.headers.get("content-type"), "image/png"); assert.match(pv.headers.get("content-security-policy"), /sandbox/);
  const st = await buy.req("GET", "/api/digital/store?type=ebook"); assert.deepEqual(st.items.map((x) => x.id), [prodA]);
  assert.ok((await buy.req("GET", "/api/market/listings")).items.some((x) => x.id === prodA), "digital products appear in the market");
  assert.equal((await sel.req("POST", "/api/market/listings", { kind: "digital", title: "التفاف", price: 1, images: [img], category: "digital" })).status, 400);
  assert.equal((await sel.req("PATCH", "/api/market/listings/" + prodA, { kind: "product" })).status, 400);
  assert.equal((await sel.req("PATCH", "/api/digital/products/" + prodA, { downloadLimit: 99 })).code, "limit_invalid");
  assert.equal((await sel.req("DELETE", "/api/digital/files/" + pdf.id)).code, "file_in_use");
});

test("buy → instant delivery + license; one per buyer; library links, buyer-bound, expiring, limited; minors refused", async () => {
  assert.equal((await kid.req("POST", `/api/market/listings/${prodA}/order`, {})).code, "minor_restricted");
  assert.equal((await buy.req("POST", `/api/market/listings/${prodA}/order`, { qty: 2 })).code, "qty_invalid");
  const o = await buy.req("POST", `/api/market/listings/${prodA}/order`, {}); assert.equal(o.status, 200, o.error);
  assert.equal((await db().get("SELECT purpose FROM pi_transactions WHERE id=$1", [o.intent.id])).purpose, "market");
  await U.payIntent(buy, o.intent); await settle();
  const ord = await db().get("SELECT * FROM market_orders WHERE id=$1", [o.order.id]); assert.equal(ord.status, "delivered");
  assert.ok(await db().get("SELECT 1 x FROM messages WHERE conv=$1 AND text LIKE $2", [ord.conversation_id, "%مشترياتي%"]));
  assert.equal((await buy.req("POST", `/api/market/listings/${prodA}/order`, {})).code, "owned");
  assert.equal((await buy.req("GET", "/api/digital/products/" + prodA)).listing.buyReason, "owned");
  const lib = await buy.req("GET", "/api/me/digital/library"); assert.equal(lib.items.length, 1);
  const it = lib.items[0]; assert.match(it.licenseKey, /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/); assert.equal(it.downloadsLeft, 2); assert.equal(it.refund.allowed, false);
  const fid = it.product.files[0].id;
  const l1 = await buy.req("POST", `/api/digital/library/${it.id}/link`, { fileId: fid }); assert.equal(l1.status, 200, l1.error); assert.equal(l1.downloadsLeft, 1);
  assert.equal((await buy2.req("GET", l1.url)).code, "not_owner");
  const dl = await buy.req("GET", l1.url); assert.equal(dl.status, 200); assert.ok(dl.buf.equals(PDF)); assert.match(dl.headers.get("content-disposition"), /attachment/);
  assert.equal(dl.headers.get("content-type"), "application/octet-stream");
  await db().run("UPDATE digital_downloads SET expires_at=$1", [new Date(Date.now() - 1000).toISOString()]);
  assert.equal((await buy.req("GET", l1.url)).code, "link_expired");
  assert.equal((await buy.req("POST", `/api/digital/library/${it.id}/link`, { fileId: fid })).status, 200);
  assert.equal((await buy.req("POST", `/api/digital/library/${it.id}/link`, { fileId: fid })).code, "download_limit");
  assert.equal((await buy2.req("POST", `/api/digital/library/${it.id}/link`, { fileId: fid })).status, 404);
  const lic = await sel.req("GET", "/api/me/digital/licenses?listingId=" + prodA); assert.equal(lic.items[0].buyer, "dg_buy");
  assert.equal((await sel.req("GET", "/api/me/digital/licenses?key=" + it.licenseKey)).valid, true);
  assert.equal((await buy.req("GET", "/api/me/digital/licenses?key=" + it.licenseKey)).valid, false, "only the seller verifies own keys");
});

test("refund policy: undownloaded refund within window → escrow refunded, access revoked; ledger balanced; seller stats", async () => {
  const o = await buy2.req("POST", `/api/market/listings/${prodB}/order`, {}); assert.equal(o.status, 200, o.error);
  await U.payIntent(buy2, o.intent); await settle();
  let it = (await buy2.req("GET", "/api/me/digital/library")).items[0]; assert.equal(it.refund.allowed, true); assert.equal(it.licenseKey, null);
  const rf = await buy2.req("POST", `/api/digital/library/${it.id}/refund`, { reason: "اشتريته بالخطأ" }); assert.equal(rf.status, 200, rf.error);
  assert.equal((await db().get("SELECT status FROM market_orders WHERE id=$1", [o.order.id])).status, "refunded");
  assert.equal((await db().get("SELECT state FROM market_escrow WHERE order_id=$1", [o.order.id])).state, "refunded");
  it = (await buy2.req("GET", "/api/me/digital/library")).items[0]; assert.equal(it.status, "refunded"); assert.equal(it.product, null);
  assert.equal((await buy2.req("POST", `/api/digital/library/${it.id}/link`, { fileId: zip.id })).code, "revoked");
  const a = (await buy.req("GET", "/api/me/digital/library")).items[0];
  assert.equal((await buy.req("POST", `/api/digital/library/${a.id}/refund`, {})).code, "refund_not_allowed");
  const chk = await admin.req("GET", "/api/admin/ledger/check"); assert.equal(chk.balanced, true, JSON.stringify(chk.imbalances));
  const s = await sel.req("GET", "/api/me/digital/sales"); assert.equal(s.status, 200, s.error);
  const A = s.items.find((x) => x.listingId === prodA), B = s.items.find((x) => x.listingId === prodB);
  assert.equal(A.sales, 1); assert.equal(A.gross, 2); assert.equal(A.downloads, 2); assert.equal(B.sales, 0); assert.equal(B.refunds, 1);
  assert.equal(s.series.length, 30); assert.equal(s.series.at(-1).sales, 1);
});

test("copyright report → moderation queue → takedown blocks sales, downloads and re-uploads", async () => {
  assert.equal((await buy2.req("POST", `/api/digital/products/${prodA}/report`, { reason: "spam" })).code, "reason_invalid");
  const r = await buy2.req("POST", `/api/digital/products/${prodA}/report`, { reason: "copyright", details: "هذا كتابي المنشور" }); assert.equal(r.status, 200, r.error);
  assert.equal((await db().get("SELECT kind FROM reports WHERE target=$1 AND by_user=$2", [prodA, buy2.id])).kind, "listing");
  assert.equal((await sel.req("GET", "/api/admin/digital/reports")).status, 403);
  const q = await admin.req("GET", "/api/admin/digital/reports"); assert.equal(q.items[0].reason, "copyright");
  assert.equal((await admin.req("POST", `/api/admin/digital/reports/${q.items[0].id}/resolve`, { action: "takedown", revoke: true })).status, 200);
  assert.equal((await db().get("SELECT status FROM market_listings WHERE id=$1", [prodA])).status, "removed");
  assert.equal((await buy.req("GET", "/api/digital/products/" + prodA)).status, 404);
  const it = (await buy.req("GET", "/api/me/digital/library")).items[0]; assert.notEqual(it.status, "active");
  assert.equal((await db().get("SELECT status FROM reports WHERE target=$1", [prodA])).status, "actioned");
  assert.equal((await up(sel, PDF, "?name=again.pdf")).code, "file_blocked");
});
