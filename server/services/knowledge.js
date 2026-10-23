/* Collective Knowledge (Phase 18): member-edited wiki with full revision history, diffs and revert;
 * pinned FAQ; Q&A with best answers; categorised resource library with votes; duplicate-question
 * detection that surfaces previous answers; and search scoped to one community. */
const { E, str, oneOf, id, now } = require("../lib/core");
const RT = require("../../richtext.js");
const Tox = require("../lib/toxicity");
const MOD = ["owner", "admin", "moderator"];
const STOP = new Set(["في", "من", "على", "الى", "إلى", "عن", "ما", "ماذا", "كيف", "هل", "هو", "هي", "او", "أو", "و", "ثم", "لا", "مع", "هذا", "هذه", "ذلك", "التي", "الذي", "كل", "اي", "أي", "انا", "انت", "the", "a", "an", "is", "to", "of", "in", "how", "what", "do", "i", "and", "or", "for"]);
const tokens = (s) => new Set(Tox.norm(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).map(w => w.replace(/^(وال|ال|و)/, "")).filter(w => w.length > 1 && !STOP.has(w)));
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n); };
const slugify = (t) => String(t || "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60);
/* line diff (LCS) — returns [{op:'=', '+', '-', text}] */
function diffLines(a, b) {
  const x = a.split("\n"), y = b.split("\n"), n = x.length, m = y.length;
  if (n * m > 4e6) return [...x.map(t => ({ op: "-", text: t })), ...y.map(t => ({ op: "+", text: t }))];
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { out.push({ op: "=", text: x[i] }); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "-", text: x[i++] }); else out.push({ op: "+", text: y[j++] }); }
  while (i < n) out.push({ op: "-", text: x[i++] }); while (j < m) out.push({ op: "+", text: y[j++] });
  return out;
}

module.exports = (ctx) => {
  const { db, router: R, rl } = ctx; const A = ctx.requireUser;
  const role = async (cid, uid) => uid ? (await db.get("SELECT role FROM memberships WHERE community=$1 AND user_id=$2", [cid, uid]))?.role : null;
  const member = (r) => r && !["pending", "banned"].includes(r);
  const P = ctx.cperm, has = (cid, uid, k) => P.has(cid, uid, k); // v2.56: lib/cperm.js keys (same grants as before)
  async function canRead(cid, uid) { const c = await db.get("SELECT type FROM communities WHERE id=$1", [cid]); if (!c) throw E.nf(); if (c.type !== "public" && !member(await role(cid, uid))) throw E.forbid("للأعضاء فقط"); }
  const pageClient = (p, full) => ({ id: p.id, slug: p.slug, title: p.title, kind: p.kind, position: p.position, version: p.version, locked: !!p.locked, section: p.section || null, updatedAt: p.updated_at, updatedBy: p.updated_by, ...(full ? { body: p.body, html: RT.toHTML(RT.parse(p.body), { anchors: false }), toc: RT.toc(RT.parse(p.body)), readingMin: RT.readingMinutes(RT.parse(p.body)) } : {}) });

  /* ---------- wiki ---------- */
  R.get("/api/communities/:id/wiki", async (req) => { await canRead(req.params.id, req.user?.id); return { pages: (await db.all("SELECT * FROM wiki_pages WHERE community=$1 AND kind='page' ORDER BY position, title", [req.params.id])).map(p => pageClient(p)) }; });
  R.get("/api/communities/:id/wiki/:slug", async (req) => {
    await canRead(req.params.id, req.user?.id); const p = await db.get("SELECT * FROM wiki_pages WHERE community=$1 AND slug=$2", [req.params.id, req.params.slug]); if (!p) throw E.nf("الصفحة غير موجودة");
    const editor = await db.get("SELECT name, handle FROM users WHERE id=$1", [p.updated_by]);
    return { page: { ...pageClient(p, true), editor } };
  });
  R.put("/api/communities/:id/wiki/:slug", A(async (req) => {
    const cid = req.params.id; if (!(await has(cid, req.user.id, "wiki_edit"))) throw E.forbid("التحرير للأعضاء");
    if (!rl.hit("default", "wiki:" + req.user.id)) throw E.rate();
    const b = req.body, title = str(b.title, 120, { required: true }), body = String(b.body || "").slice(0, 100000), summary = str(b.summary, 200) || null, kind = oneOf(b.kind, ["page", "faq"], "page");
    if (!body.trim()) throw E.bad("المحتوى فارغ");
    const slug = req.params.slug === "new" ? slugify(b.slug || title) : req.params.slug; if (!slug) throw E.bad("عنوان غير صالح");
    const ex = await db.get("SELECT * FROM wiki_pages WHERE community=$1 AND slug=$2", [cid, slug]); const at = now();
    if (ex) {
      if (ex.locked && !(await has(cid, req.user.id, "wiki_lock"))) throw E.forbid("الصفحة مقفلة للمشرفين");
      if (b.baseVersion !== undefined && +b.baseVersion !== ex.version) throw Object.assign(E.conflict("عدّل شخص آخر الصفحة أثناء تحريرك"), { code: "wiki_conflict", details: { current: pageClient(ex, true) } });
      if (ex.title === title && ex.body === body) return { page: pageClient(ex, true) };
      const v = ex.version + 1;
      await db.tx(async t => { await t.run("UPDATE wiki_pages SET title=$1, body=$2, version=$3, updated_by=$4, updated_at=$5 WHERE id=$6", [title, body, v, req.user.id, at, ex.id]); await t.run("INSERT INTO wiki_revisions(id,page,version,title,body,author,summary,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id("wr"), ex.id, v, title, body, req.user.id, summary, at]); });
    } else {
      if (kind === "faq" && !(await has(cid, req.user.id, "faq_edit"))) throw E.forbid("الأسئلة الشائعة يضيفها المشرفون");
      const pid = id("wk"), pos = (await db.get("SELECT COALESCE(MAX(position),0)+1 n FROM wiki_pages WHERE community=$1 AND kind=$2", [cid, kind])).n;
      await db.tx(async t => { await t.run("INSERT INTO wiki_pages(id,community,slug,title,body,kind,position,version,updated_by,updated_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$9)", [pid, cid, slug, title, body, kind, pos, req.user.id, at]); await t.run("INSERT INTO wiki_revisions(id,page,version,title,body,author,summary,created_at) VALUES($1,$2,1,$3,$4,$5,$6,$7)", [id("wr"), pid, title, body, req.user.id, summary || "إنشاء الصفحة", at]); });
    }
    return { page: pageClient(await db.get("SELECT * FROM wiki_pages WHERE community=$1 AND slug=$2", [cid, slug]), true) };
  }));
  const pageOr404 = async (cid, slug) => { const p = await db.get("SELECT * FROM wiki_pages WHERE community=$1 AND slug=$2", [cid, slug]); if (!p) throw E.nf(); return p; };
  R.get("/api/communities/:id/wiki/:slug/history", async (req) => {
    await canRead(req.params.id, req.user?.id); const p = await pageOr404(req.params.id, req.params.slug);
    const rows = await db.all("SELECT r.version, r.title, r.summary, r.created_at, LENGTH(r.body) size, u.name, u.handle FROM wiki_revisions r JOIN users u ON u.id=r.author WHERE r.page=$1 ORDER BY r.version DESC", [p.id]);
    return { revisions: rows.map((x, i) => ({ version: x.version, title: x.title, summary: x.summary, at: x.created_at, author: { name: x.name, handle: x.handle }, size: Number(x.size), delta: i < rows.length - 1 ? Number(x.size) - Number(rows[i + 1].size) : Number(x.size) })) };
  });
  R.get("/api/communities/:id/wiki/:slug/diff", async (req) => {
    await canRead(req.params.id, req.user?.id); const p = await pageOr404(req.params.id, req.params.slug);
    const to = +req.query.to || p.version, from = +req.query.from || Math.max(1, to - 1);
    const [a, b] = await Promise.all([from, to].map(v => db.get("SELECT version, title, body FROM wiki_revisions WHERE page=$1 AND version=$2", [p.id, v])));
    if (!a || !b) throw E.nf("النسخة غير موجودة");
    const d = diffLines(a.body, b.body);
    return { from, to, titleChanged: a.title !== b.title ? { from: a.title, to: b.title } : null, lines: d, added: d.filter(x => x.op === "+").length, removed: d.filter(x => x.op === "-").length };
  });
  R.post("/api/communities/:id/wiki/:slug/revert", A(async (req) => {
    if (!(await has(req.params.id, req.user.id, "wiki_lock"))) throw E.forbid(); const p = await pageOr404(req.params.id, req.params.slug);
    const old = await db.get("SELECT title, body FROM wiki_revisions WHERE page=$1 AND version=$2", [p.id, +req.body.version]); if (!old) throw E.nf();
    const v = p.version + 1, at = now();
    await db.tx(async t => { await t.run("UPDATE wiki_pages SET title=$1, body=$2, version=$3, updated_by=$4, updated_at=$5 WHERE id=$6", [old.title, old.body, v, req.user.id, at, p.id]); await t.run("INSERT INTO wiki_revisions(id,page,version,title,body,author,summary,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [id("wr"), p.id, v, old.title, old.body, req.user.id, `استرجاع النسخة ${req.body.version}`, at]); });
    await ctx.services.cmod.log(req.params.id, req.user.id, { action: "wiki_revert", reason: `${p.title} ← v${req.body.version}` });
    return { page: pageClient(await db.get("SELECT * FROM wiki_pages WHERE id=$1", [p.id]), true) };
  }));
  R.patch("/api/communities/:id/wiki/:slug", A(async (req) => {
    if (!(await has(req.params.id, req.user.id, "wiki_lock"))) throw E.forbid(); const p = await pageOr404(req.params.id, req.params.slug);
    await db.run("UPDATE wiki_pages SET locked=$1, position=$2 WHERE id=$3", [req.body.locked !== undefined ? (req.body.locked ? 1 : 0) : p.locked, Number.isInteger(req.body.position) ? req.body.position : p.position, p.id]);
    return { ok: true };
  }));
  R.del("/api/communities/:id/wiki/:slug", A(async (req) => { if (!(await has(req.params.id, req.user.id, "wiki_lock"))) throw E.forbid(); await db.run("DELETE FROM wiki_pages WHERE community=$1 AND slug=$2", [req.params.id, req.params.slug]); return { ok: true }; }));

  /* ---------- FAQ (pinned) ---------- */
  R.get("/api/communities/:id/faq", async (req) => { await canRead(req.params.id, req.user?.id); return { faq: (await db.all("SELECT * FROM wiki_pages WHERE community=$1 AND kind='faq' ORDER BY position", [req.params.id])).map(p => ({ slug: p.slug, q: p.title, a: p.body, html: RT.toHTML(RT.parse(p.body)) })) }; });

  /* ---------- Q&A ---------- */
  async function questions(cid, viewer, filter) {
    const rows = await db.all("SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post=p.id AND c.status='published') answers FROM posts p WHERE p.community=$1 AND p.type='question' AND p.status='published' ORDER BY p.created_at DESC LIMIT 200", [cid]);
    const vis = await ctx.services.content.filterVisible(rows, viewer);
    return vis.filter(p => filter === "open" ? !p.data?.acceptedAnswer : filter === "answered" ? !!p.data?.acceptedAnswer : true).map(p => ({ id: p.id, title: p.title || p.text.slice(0, 120), text: p.text.slice(0, 240), author: p.author, at: p.created_at, answers: Number(p.answers), accepted: p.data?.acceptedAnswer || null, views: p.views }));
  }
  R.get("/api/communities/:id/questions", async (req) => { await canRead(req.params.id, req.user?.id); return { questions: await questions(req.params.id, req.user?.id, oneOf(req.query.filter, ["open", "answered", "all"], "all")) }; });
  /* duplicate detection: before posting a question, show similar ones with their best answer */
  R.post("/api/communities/:id/similar", async (req) => {
    await canRead(req.params.id, req.user?.id); const q = tokens(String(req.body.text || "").slice(0, 2000)); if (q.size < 2) return { similar: [] };
    const qs = await db.all("SELECT id, title, text, data FROM posts WHERE community=$1 AND type='question' AND status='published' ORDER BY created_at DESC LIMIT 500", [req.params.id]);
    const faq = await db.all("SELECT slug, title, body FROM wiki_pages WHERE community=$1 AND kind='faq'", [req.params.id]);
    const scored = [
      ...qs.map(p => ({ kind: "question", id: p.id, title: p.title || p.text.slice(0, 120), score: jaccard(q, tokens((p.title || "") + " " + p.text)), accepted: p.data?.acceptedAnswer || null })),
      ...faq.map(f => ({ kind: "faq", id: f.slug, title: f.title, score: jaccard(q, tokens(f.title + " " + f.body)) * 1.15, answer: f.body.slice(0, 300) }))
    ].filter(x => x.score >= 0.2).sort((a, b) => b.score - a.score).slice(0, 5);
    const acc = scored.filter(s => s.accepted).map(s => s.accepted);
    const texts = acc.length ? Object.fromEntries((await db.all(`SELECT id, text FROM comments WHERE id IN (${acc.map((_, i) => "$" + (i + 1)).join(",")})`, acc)).map(c => [c.id, c.text])) : {};
    return { similar: scored.map(s => ({ kind: s.kind, id: s.id, title: s.title, score: Math.round(s.score * 100), answer: s.answer || (s.accepted ? (texts[s.accepted] || "").slice(0, 300) : null) })) };
  });

  /* ---------- resources library ---------- */
  R.get("/api/communities/:id/resources", async (req) => {
    await canRead(req.params.id, req.user?.id);
    const rows = await db.all("SELECT r.*, u.name adder FROM community_resources r JOIN users u ON u.id=r.added_by WHERE r.community=$1 ORDER BY r.votes DESC, r.created_at DESC", [req.params.id]);
    const mine = req.user ? new Set((await db.all("SELECT v.resource FROM resource_votes v JOIN community_resources r ON r.id=v.resource WHERE r.community=$1 AND v.user_id=$2", [req.params.id, req.user.id])).map(v => v.resource)) : new Set();
    const cats = [...new Set(rows.map(r => r.category))];
    return { categories: cats, resources: rows.map(r => ({ id: r.id, title: r.title, url: r.url, category: r.category, desc: r.descr, votes: r.votes, voted: mine.has(r.id), addedBy: r.adder, at: r.created_at, host: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })() })) };
  });
  R.post("/api/communities/:id/resources", A(async (req) => {
    if (!(await has(req.params.id, req.user.id, "post"))) throw E.forbid();
    const url = String(req.body.url || "").trim(); if (!/^https?:\/\/[^\s]{3,500}$/.test(url)) throw E.bad("رابط غير صالح");
    if (await db.get("SELECT 1 x FROM community_resources WHERE community=$1 AND url=$2", [req.params.id, url])) throw E.conflict("المورد مضاف مسبقاً");
    const res = { id: id("rs"), title: str(req.body.title, 120, { required: true }), category: str(req.body.category, 30) || "عام", descr: str(req.body.desc, 300) || "" };
    await db.run("INSERT INTO community_resources(id,community,title,url,category,descr,added_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [res.id, req.params.id, res.title, url, res.category, res.descr, req.user.id, now()]);
    return { resource: { ...res, url, votes: 0 } };
  }));
  R.put("/api/communities/:id/resources/:rid/vote", A(async (req) => {
    if (!member(await role(req.params.id, req.user.id))) throw E.forbid();
    const ins = await db.run("INSERT INTO resource_votes(resource,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.params.rid, req.user.id]);
    if (ins.changes) await db.run("UPDATE community_resources SET votes=votes+1 WHERE id=$1", [req.params.rid]); return { ok: true };
  }));
  R.del("/api/communities/:id/resources/:rid/vote", A(async (req) => { const d = await db.run("DELETE FROM resource_votes WHERE resource=$1 AND user_id=$2", [req.params.rid, req.user.id]); if (d.changes) await db.run("UPDATE community_resources SET votes=votes-1 WHERE id=$1", [req.params.rid]); return { ok: true }; }));
  R.del("/api/communities/:id/resources/:rid", A(async (req) => { const r = await role(req.params.id, req.user.id); const res = await db.get("SELECT added_by FROM community_resources WHERE id=$1 AND community=$2", [req.params.rid, req.params.id]); if (!res) throw E.nf(); if (res.added_by !== req.user.id && !(MOD.includes(r) && await has(req.params.id, req.user.id, "remove_content"))) throw E.forbid(); await db.run("DELETE FROM community_resources WHERE id=$1", [req.params.rid]); return { ok: true }; }));

  /* ---------- search inside one community ---------- */
  R.get("/api/communities/:id/search", async (req) => {
    const cid = req.params.id; await canRead(cid, req.user?.id); const q = String(req.query.q || "").trim().slice(0, 100); if (q.length < 2) return { posts: [], pages: [], resources: [] };
    const like = "%" + q.toLowerCase() + "%";
    const posts = await ctx.services.content.filterVisible(await db.all("SELECT * FROM posts WHERE community=$1 AND status='published' AND (LOWER(text) LIKE $2 OR LOWER(COALESCE(title,'')) LIKE $2) ORDER BY created_at DESC LIMIT 30", [cid, like]), req.user?.id);
    const pages = await db.all("SELECT slug, title, body, kind FROM wiki_pages WHERE community=$1 AND (LOWER(title) LIKE $2 OR LOWER(body) LIKE $2) LIMIT 20", [cid, like]);
    const resources = await db.all("SELECT id, title, url, category FROM community_resources WHERE community=$1 AND (LOWER(title) LIKE $2 OR LOWER(descr) LIKE $2 OR LOWER(category) LIKE $2) LIMIT 20", [cid, like]);
    const snip = (t) => { const i = t.toLowerCase().indexOf(q.toLowerCase()); return (i > 40 ? "…" : "") + t.slice(Math.max(0, i - 40), i + q.length + 80) + "…"; };
    return { posts: posts.map(p => ({ id: p.id, title: p.title || null, snippet: snip(p.text), type: p.type, at: p.created_at })), pages: pages.map(p => ({ slug: p.slug, title: p.title, kind: p.kind, snippet: snip(p.body) })), resources };
  });
  return { diffLines, tokens, jaccard };
};
