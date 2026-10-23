/* Phase 75 — open knowledge library: create with an open licence (agreement required, Markdown validated, sources checked)
 * → review queue → reviewer approves (not their own) → published; edits on the current version (stale refused at submit and
 * at approval), reviewers' edits direct, minors always reviewed and anonymous in public history; history, revision view and
 * line diff; revert; search (Arabic-normalised), categories, tags, sort; helpful votes; reports → flag hides from minors;
 * staff hide / restore / sensitive; reviewer roles; migration 055 reversible + data map. PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, adminC, ali, rev, kid, reader, art;
const db = () => H.app.ctx.db;
async function mk(handle, name) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: name || "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle; return c;
}
const kinds = async (uid) => (await db().all("SELECT kind FROM notifications WHERE user_id=$1", [uid])).map((r) => r.kind);
const BODY = "## ما هي الطاقة الشمسية؟\nالطاقة الشمسية هي الطاقة المستمدة من أشعة الشمس، وتُحوَّل إلى كهرباء بالألواح الكهروضوئية أو إلى حرارة بالمجمّعات الشمسية.\n\n## الاستخدامات\n- توليد الكهرباء في المنازل والمزارع\n- تسخين المياه\n- تحلية مياه البحر\n\nتتميز المملكة بإشعاع شمسي مرتفع طوال العام، ما يجعلها من أنسب المواقع لهذه التقنية.";
const ART = { title: "الطاقة الشمسية: مدخل مبسّط", summary: "تعريف مختصر بالطاقة الشمسية واستخداماتها.", body: BODY, category: "science", tags: ["طاقة", "#بيئة"], sources: ["https://example.org/solar"], license: "cc-by-sa-4.0", agree: true };

test.before(async () => {
  H = await boot({ openlibOpts: {} });
  adminC = await mk("kb_admin"); ali = await mk("kb_ali", "علي"); rev = await mk("kb_rev", "ريم"); kid = await mk("kb_kid", "يافع"); reader = await mk("kb_reader");
  const real = H.app.ctx.services.minors.isMinorUser; H.app.ctx.services.minors.isMinorUser = async (uid) => uid === kid.id || real(uid);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("contribute: licence + agreement required, validation, review queue; reviewer roles", async () => {
  assert.equal((await ali.req("POST", "/api/knowledge", { ...ART, agree: false })).code, "license_required");
  assert.equal((await ali.req("POST", "/api/knowledge", { ...ART, license: "all-rights" })).status, 400);
  assert.equal((await ali.req("POST", "/api/knowledge", { ...ART, body: "قصير" })).status, 400);
  assert.equal((await ali.req("POST", "/api/knowledge", { ...ART, sources: ["javascript:alert(1)"] })).status, 400);
  assert.equal((await new H.Client().req("POST", "/api/knowledge", ART)).status, 401);
  const r = await ali.req("POST", "/api/knowledge", ART); assert.equal(r.status, 200, r.error); assert.equal(r.state, "review"); art = r.id;
  assert.equal((await reader.req("GET", "/api/knowledge/articles/" + art)).status, 404); // not public before review
  assert.equal((await ali.req("GET", "/api/knowledge/articles/" + art)).article.status, "review"); // the author sees it
  assert.equal((await ali.req("GET", "/api/knowledge/review")).status, 403);
  assert.equal((await rev.req("POST", "/api/admin/knowledge/reviewers", { handle: "kb_rev" })).status, 403);
  assert.equal((await adminC.req("POST", "/api/admin/knowledge/reviewers", { handle: "kb_kid" })).code, "minor_restricted");
  const g = await adminC.req("POST", "/api/admin/knowledge/reviewers", { handle: "kb_rev" }); assert.equal(g.status, 200, g.error); assert.equal(g.reviewers.length, 1);
  assert.ok((await kinds(rev.id)).includes("kb_reviewer"));
  const q = await rev.req("GET", "/api/knowledge/review"); assert.equal(q.revisions.length, 1); assert.equal(q.revisions[0].article.isNew, true);
  const rid = q.revisions[0].id;
  assert.equal((await rev.req("POST", `/api/knowledge/revisions/${rid}/reject`, {})).status, 400);
  const ok = await rev.req("POST", `/api/knowledge/revisions/${rid}/approve`, {}); assert.equal(ok.status, 200, ok.error);
  assert.equal((await rev.req("POST", `/api/knowledge/revisions/${rid}/approve`, {})).status, 409);
  assert.ok((await kinds(ali.id)).includes("kb_decision"));
  const v = await reader.req("GET", "/api/knowledge/articles/" + art);
  assert.equal(v.status, 200); assert.equal(v.article.status, "published"); assert.equal(v.article.rev, 1); assert.equal(v.article.license.label, "CC BY-SA 4.0");
  assert.deepEqual(v.article.tags, ["طاقة", "بيئة"]); assert.deepEqual(v.article.sources, ["https://example.org/solar"]); assert.equal(v.article.contributors[0].user.handle, "kb_ali");
});

test("edits: base revision, stale refused, reviewer edits direct, minors reviewed + anonymous, diff, history, revert", async () => {
  const body2 = BODY + "\n\n## التحديات\nتحتاج الألواح إلى تنظيف دوري من الغبار.";
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, body: body2, base: 0, note: "إضافة التحديات" })).code, "stale");
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, base: 1, note: "لا شيء" })).status, 400); // nothing changed
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, body: body2, base: 1 })).status, 400); // note required
  const e1 = await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, body: body2, base: 1, note: "إضافة قسم التحديات" }); assert.equal(e1.status, 200, e1.error); assert.equal(e1.state, "pending");
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, body: body2 + "\nسطر", base: 1, note: "ثانٍ" })).status, 409); // one pending per member
  // minor proposes too (always pending)
  const ek = await kid.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, body: BODY + "\n\nتستخدم الطاقة الشمسية أيضاً في إنارة الطرق.", base: 1, note: "إنارة الطرق" }); assert.equal(ek.status, 200, ek.error); assert.equal(ek.state, "pending");
  // reviewer's own edit is direct
  const er = await rev.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, summary: "مدخل مبسّط إلى الطاقة الشمسية واستخداماتها في المنطقة.", base: 1, note: "تحسين الملخّص" }); assert.equal(er.status, 200, er.error); assert.equal(er.state, "approved");
  // the two pending edits were written on rev 1 → stale now
  const q = await rev.req("GET", "/api/knowledge/review"); assert.equal(q.revisions.length, 2); assert.ok(q.revisions.every((r) => r.stale));
  assert.equal((await rev.req("POST", `/api/knowledge/revisions/${e1.revision}/approve`, {})).code, "stale");
  const rv = await rev.req("GET", "/api/knowledge/revisions/" + e1.revision); assert.equal(rv.revision.stale, true); assert.ok(rv.diff.added >= 2); assert.ok(rv.diff.ops.some((o) => o.op === "+" && /التحديات/.test(o.t)));
  assert.equal((await reader.req("GET", "/api/knowledge/revisions/" + ek.revision)).status, 404); // pending + not own
  assert.equal((await rev.req("POST", `/api/knowledge/revisions/${e1.revision}/reject`, { reason: "أعد التعديل على النسخة الحالية" })).status, 200);
  // the member redoes it on rev 2; the minor's edit is redone on the latest version and approved
  const e2 = await reader.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, summary: "مدخل مبسّط إلى الطاقة الشمسية واستخداماتها في المنطقة.", body: body2, base: 2, note: "إضافة قسم التحديات" }); assert.equal(e2.status, 200, e2.error);
  assert.equal((await rev.req("POST", `/api/knowledge/revisions/${e2.revision}/approve`, {})).status, 200);
  await rev.req("POST", `/api/knowledge/revisions/${ek.revision}/reject`, { reason: "قديمة" });
  const ek2 = await kid.req("POST", `/api/knowledge/articles/${art}/edits`, { ...ART, summary: "مدخل مبسّط إلى الطاقة الشمسية واستخداماتها في المنطقة.", body: body2 + "\nتستخدم أيضاً في إنارة الطرق.", base: 3, note: "إنارة الطرق" });
  assert.equal(ek2.status, 200, ek2.error); assert.equal((await rev.req("POST", `/api/knowledge/revisions/${ek2.revision}/approve`, {})).status, 200);
  assert.ok((await kinds(ali.id)).includes("kb_edited"));
  const h = await reader.req("GET", `/api/knowledge/articles/${art}/history`); assert.deepEqual(h.revisions.map((r) => r.n), [4, 3, 2, 1]);
  assert.equal(h.revisions[0].author.name, "مساهم يافع"); assert.equal(h.revisions[0].author.handle, null); assert.equal(h.revisions[0].current, true);
  const v = await reader.req("GET", "/api/knowledge/articles/" + art); assert.equal(v.article.contributors.length, 4); assert.ok(v.article.contributors.some((c) => c.user.minor));
  const r1 = h.revisions.find((r) => r.n === 1);
  const old = await reader.req("GET", "/api/knowledge/revisions/" + r1.id); assert.equal(old.revision.body, BODY);
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/revert`, { n: 1 })).status, 403);
  const rb = await rev.req("POST", `/api/knowledge/articles/${art}/revert`, { n: 1, reason: "تخريب" }); assert.equal(rb.status, 200, rb.error); assert.equal(rb.article.rev, 5); assert.equal(rb.article.body, BODY);
  await rev.req("POST", `/api/knowledge/articles/${art}/revert`, { n: 4 });
  const me = await reader.req("GET", "/api/knowledge/me"); assert.equal(me.approved, 1); assert.equal(me.revisions.length, 2);
  assert.equal(H.app.ctx.services.openlib.diff("أ\nب\nج", "أ\nج\nد").added, 1);
});

test("search, categories, tags, sort; helpful votes; reports flag and hide from minors; staff moderation", async () => {
  const b2 = await rev.req("POST", "/api/knowledge", { ...ART, title: "مدخل إلى البرمجة بلغة بايثون", summary: "أساسيات بايثون للمبتدئين.", body: "## لماذا بايثون؟\n" + "بايثون لغة برمجة سهلة القراءة ومناسبة للمبتدئين، وتستخدم في تحليل البيانات والذكاء الاصطناعي وتطوير الويب. ".repeat(3), category: "tech", tags: ["برمجة"], license: "cc-by-4.0" });
  assert.equal(b2.status, 200, b2.error); assert.equal(b2.state, "published"); const py = b2.id;
  assert.equal((await rev.req("GET", "/api/knowledge/articles/" + py)).article.status, "published"); // reviewer's own article is direct
  const l = await new H.Client().req("GET", "/api/knowledge"); assert.equal(l.total, 2); assert.equal(l.counts.science, 1); assert.equal(l.totals.articles, 2);
  assert.equal((await new H.Client().req("GET", "/api/knowledge?q=" + encodeURIComponent("الطاقه الشمسيه"))).articles[0].id, art); // ة/ه normalised
  assert.equal((await new H.Client().req("GET", "/api/knowledge?q=" + encodeURIComponent("بايثون"))).articles[0].id, py);
  assert.equal((await new H.Client().req("GET", "/api/knowledge?category=tech")).total, 1);
  assert.equal((await new H.Client().req("GET", "/api/knowledge?tag=" + encodeURIComponent("بيئة"))).total, 1);
  assert.ok(l.tags.some((t) => t.tag === "طاقة"));
  // votes
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${py}/vote`, { vote: 1 })).helpful.up, 1);
  assert.equal((await ali.req("POST", `/api/knowledge/articles/${py}/vote`, { vote: -1 })).helpful.down, 1);
  assert.equal((await ali.req("POST", `/api/knowledge/articles/${py}/vote`, { vote: 1 })).helpful.up, 2);
  assert.equal((await new H.Client().req("GET", "/api/knowledge?sort=helpful")).articles[0].id, py);
  // reports: own article refused; 3 → flagged → hidden from minors
  assert.equal((await ali.req("POST", `/api/knowledge/articles/${art}/report`, { reason: "spam" })).status, 400);
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/report`, { reason: "nope" })).status, 400);
  for (const u of [reader, kid, adminC]) assert.equal((await u.req("POST", `/api/knowledge/articles/${art}/report`, { reason: "inaccurate", note: "رقم خاطئ" })).status, 200);
  assert.equal((await reader.req("POST", `/api/knowledge/articles/${art}/report`, { reason: "spam" })).status, 409);
  assert.equal((await reader.req("GET", "/api/knowledge/articles/" + art)).article.flagged, true);
  assert.equal((await kid.req("GET", "/api/knowledge/articles/" + art)).status, 404);
  assert.equal((await kid.req("GET", "/api/knowledge")).total, 1);
  const q = await rev.req("GET", "/api/knowledge/review"); assert.equal(q.reports.length, 3);
  for (const r of q.reports) assert.equal((await rev.req("POST", "/api/knowledge/reports/" + r.id, { action: "dismiss" })).status, 200);
  assert.equal((await kid.req("GET", "/api/knowledge/articles/" + art)).status, 200);
  // staff: sensitive (adults only), hide / restore
  assert.equal((await rev.req("POST", `/api/admin/knowledge/articles/${py}`, { action: "hide", reason: "x" })).status, 403);
  await adminC.req("POST", `/api/admin/knowledge/articles/${py}`, { action: "sensitive" });
  assert.equal((await kid.req("GET", "/api/knowledge/articles/" + py)).status, 404); assert.equal((await reader.req("GET", "/api/knowledge/articles/" + py)).status, 200);
  assert.equal((await adminC.req("POST", `/api/admin/knowledge/articles/${py}`, { action: "hide" })).status, 400);
  await adminC.req("POST", `/api/admin/knowledge/articles/${py}`, { action: "hide", reason: "نقل حرفي من مصدر محفوظ الحقوق" });
  assert.equal((await reader.req("GET", "/api/knowledge/articles/" + py)).status, 404);
  const adm = await adminC.req("GET", "/api/admin/knowledge"); assert.ok(adm.articles.some((a) => a.id === py && a.status === "hidden"));
  await adminC.req("POST", `/api/admin/knowledge/articles/${py}`, { action: "restore" });
  assert.equal((await reader.req("GET", "/api/knowledge/articles/" + py)).status, 200);
  await new Promise((res) => setTimeout(res, 50));
  assert.ok(await db().get("SELECT 1 x FROM audit_log WHERE action='kb_hide' AND target=$1", [py]));
});

test("withdraw a first version archives it; rejected first version archives it", async () => {
  const r = await reader.req("POST", "/api/knowledge", { ...ART, title: "مسودة ستُسحب" }); assert.equal(r.status, 200, r.error);
  assert.equal((await reader.req("POST", `/api/knowledge/revisions/${r.revision}/withdraw`)).status, 200);
  assert.equal((await db().get("SELECT status FROM kb_articles WHERE id=$1", [r.id])).status, "archived");
  const r2 = await reader.req("POST", "/api/knowledge", { ...ART, title: "مقالة ستُرفض" });
  await rev.req("POST", `/api/knowledge/revisions/${r2.revision}/reject`, { reason: "منقولة دون مصدر" });
  assert.equal((await db().get("SELECT status FROM kb_articles WHERE id=$1", [r2.id])).status, "archived");
  assert.equal((await reader.req("GET", "/api/knowledge/revisions/" + r2.revision)).revision.reason, "منقولة دون مصدر");
});

test("migration 055 reversible + additive; data map", async () => {
  const mig = require("../lib/migrations");
  const after = (await db().all("SELECT id FROM schema_migrations WHERE id > '055_knowledge' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), after.length + 1), [...[...after].reverse(), "055_knowledge"]);
  await assert.rejects(() => db().get("SELECT 1 FROM kb_articles"));
  assert.deepEqual(await mig.up(db()), ["055_knowledge", ...after]);
  const L = require("../lib/compliance-lib");
  for (const t of ["kb_articles", "kb_revisions", "kb_votes", "kb_reports", "kb_reviewers"]) { const m = L.DATA_MAP.find((x) => x.t === t); assert.ok(m, t); await db().get(`SELECT ${m.cols.join(",")} FROM ${m.t} WHERE ${m.user} LIMIT 1`, [ali.id]); }
});
