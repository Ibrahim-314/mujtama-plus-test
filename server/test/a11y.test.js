/* Phase 43 — full accessibility. SQLite by default and PostgreSQL with TEST_DATABASE_URL.
 * Covers: migration 026 (down/up, static additive), pure helpers (heuristic alt, segments → WebVTT), display settings
 * (whitelisted a11y.* keys, validation, defaults removed, reset, free/no entitlement), alt text (user > auto > heuristic,
 * privacy: nothing for private media, vision only for public images and never over user text, no key → heuristic),
 * captions (WebVTT/SRT upload, edit, list, .vtt serving, mirrored into media variants + post, delete, owner only,
 * auto captions with a stub ASR, no key → 503 manual only), periodic audit (counts, CI report, admin only, job). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

let H, admin, sara, omar;
const db = () => H.app.ctx.db;
const svc = () => H.app.ctx.services.a11y;
const visionCalls = [];
const vision = { name: "stub-vision", async describe(buf, mime, o) { visionCalls.push({ size: buf.length, mime, hint: o.hint }); return "قطة برتقالية تجلس على نافذة"; } };
const captioner = { name: "stub-asr", async transcribe() { return { segments: [{ start: 0, end: 1.5, text: "مرحبا بكم" }, { start: 1.5, end: 3.2, text: "في مجتمع بلس" }] }; } };
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]);
const mk = async (handle) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
};
const upload = async (c) => { const r = await fetch(H.base + "/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "image/png", Cookie: c.cookie, Origin: H.base }, body: png }); const j = await r.json(); assert.equal(r.status, 200, j.error); return j.media; };
const post = async (c, body) => { H.app.ctx.rl.w.clear(); const r = await c.req("POST", "/api/posts", body); assert.equal(r.status, 200, r.error); return r.post; };
async function video(owner) {
  const mid = "md_vid" + Math.random().toString(36).slice(2, 8), at = new Date().toISOString();
  const buf = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
  await H.app.ctx.services.media.storage.put(mid + ".mp4", buf, "video/mp4");
  await db().run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'video','video/mp4',$3,$4,'ready',$5,$6)", [mid, owner.id, buf.length, mid + ".mp4", { original: "/media/" + mid + ".mp4" }, at]);
  return mid;
}

/** a second app without keys on its own in-memory SQLite (never resets the shared PostgreSQL test schema) */
async function bootKeyless() {
  const saved = process.env.TEST_DATABASE_URL; delete process.env.TEST_DATABASE_URL;
  try { return await boot({ databaseUrl: "sqlite::memory:", a11yOpts: { vision: null, captioner: null, jobs: false, env: {} }, piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { jobs: false }, translateOpts: { jobs: false, env: {} } }); }
  finally { if (saved !== undefined) process.env.TEST_DATABASE_URL = saved; }
}

test.before(async () => {
  H = await boot({ a11yOpts: { vision, captioner, jobs: false, env: {} }, piOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false }, aiOpts: { jobs: false }, translateOpts: { jobs: false, env: {} } });
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { j = { raw: text }; }
    return { ...j, status: r.status, headers: r.headers };
  };
  admin = await mk("a11y_admin"); sara = await mk("a11y_sara"); omar = await mk("a11y_omar");
  assert.equal((await db().get("SELECT role FROM users WHERE id=$1", [admin.id])).role, "admin");
});
test.after(async () => {
  for (let i = 0; i < 50; i++) { const n = Number((await db().get("SELECT COUNT(*) n FROM media_jobs WHERE status IN ('queued','running')")).n); if (!n) break; await new Promise((r) => setTimeout(r, 100)); }
  await H.app.close();
});
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("migration 026: down/up reversible and purely additive", async () => {
  const mig = require("../lib/migrations");
  const later = (await db().all("SELECT id FROM schema_migrations WHERE id > '026_a11y' ORDER BY id")).map((r) => r.id);
  assert.deepEqual(await mig.down(db(), later.length + 1), [...[...later].reverse(), "026_a11y"]);
  await assert.rejects(() => db().get("SELECT 1 FROM a11y_prefs"));
  assert.ok(Number((await db().get("SELECT COUNT(*) n FROM ui_strings")).n) >= 0, "024 tables untouched");
  assert.deepEqual(await mig.up(db()), ["026_a11y", ...later]);
  for (const t of ["a11y_prefs", "media_alt", "video_captions", "a11y_audits"]) assert.equal(Number((await db().get(`SELECT COUNT(*) n FROM ${t}`)).n), 0, t);
  const s = require("../scripts/verify-migrations").staticCheck();
  assert.equal(s.ok, true, s.problems.join("\n"));
  assert.ok(s.seen.some((x) => x.file === "026_a11y.js"));
});

test("pure helpers: heuristic alt text and segments → WebVTT", () => {
  const S = require("../services/a11y");
  assert.equal(S.heuristicAlt("غروب الشمس على كورنيش جدة. كان يوماً جميلاً #جدة #غروب", "sara"), "صورة من منشور @sara: غروب الشمس على كورنيش جدة.");
  assert.equal(S.heuristicAlt("", null), "صورة");
  assert.equal(S.heuristicAlt("https://x.y/z", "a"), "صورة من منشور @a");
  const v = S.segmentsToVtt([{ start: 0, end: 1.25, text: "مرحبا <b>x</b>" }, { start: 61, end: 61, text: "a --> b" }, { start: 2, end: 3, text: "  " }]);
  assert.match(v, /^WEBVTT\n\n1\n00:00:00\.000 --> 00:00:01\.250\nمرحبا bx\/b\n\n2\n00:01:01\.000 --> 00:01:01\.500\na → b\n$/);
});

test("display settings: free, whitelisted a11y.* keys, validation, defaults, reset", async () => {
  const cfg = await omar.req("GET", "/api/a11y/config");
  assert.equal(cfg.free, true); assert.equal(cfg.vision, true); assert.equal(cfg.autoCaptions, true);
  assert.ok(cfg.keys.every((k) => k.startsWith("a11y.")));
  assert.equal((await new H.Client().req("GET", "/api/me/a11y")).status, 401);
  let r = await sara.req("GET", "/api/me/a11y");
  assert.deepEqual(r.prefs, cfg.defaults);
  r = await sara.req("PUT", "/api/me/a11y", { prefs: { fontScale: 1.333, contrast: "high", dyslexia: true, spacing: "wider", motion: "reduce", underlineLinks: true, focusRing: "strong", captions: true } });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.prefs.fontScale, 1.35); assert.equal(r.prefs.contrast, "high"); assert.equal(r.prefs.dyslexia, true); assert.equal(r.prefs.spacing, "wider");
  const rows = await db().all("SELECT key FROM a11y_prefs WHERE user_id=$1 ORDER BY key", [sara.id]);
  assert.equal(rows.length, 8); assert.ok(rows.every((x) => x.key.startsWith("a11y.")));
  assert.equal((await sara.req("PUT", "/api/me/a11y", { prefs: { theme: "oled" } })).code, "pref_unknown", "phase 44 keys are not ours");
  for (const bad of [{ fontScale: 5 }, { fontScale: "2" }, { contrast: "max" }, { dyslexia: "yes" }]) assert.equal((await sara.req("PUT", "/api/me/a11y", { prefs: bad })).code, "pref_invalid");
  assert.equal((await sara.req("PUT", "/api/me/a11y", { prefs: [] })).status, 400);
  r = await sara.req("PUT", "/api/me/a11y", { contrast: "normal" }); // bare body accepted; default value removes the row
  assert.equal(r.prefs.contrast, "normal");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM a11y_prefs WHERE user_id=$1 AND key='a11y.contrast'", [sara.id])).n), 0);
  assert.equal((await omar.req("GET", "/api/me/a11y")).prefs.dyslexia, false, "per user");
  r = await sara.req("DELETE", "/api/me/a11y");
  assert.deepEqual(r.prefs, cfg.defaults);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM a11y_prefs WHERE user_id=$1", [sara.id])).n), 0);
});

test("alt text: user > auto (public only) > heuristic; private media stays private", async () => {
  const pub = await upload(sara), priv = await upload(sara), draft = await upload(sara);
  await post(sara, { text: "غروب الشمس على كورنيش جدة. يوم جميل", media: pub.url });
  await post(sara, { text: "صورة للمتابعين فقط", media: priv.url, visibility: "followers" });
  const anon = new H.Client();
  // heuristic for public image (computed, not stored)
  let r = await anon.req("GET", "/api/a11y/alt?ids=" + [pub.id, priv.id, draft.id, "bad id"].join(","));
  assert.deepEqual(Object.keys(r.alts), [pub.id], "private and unattached media reveal nothing");
  assert.equal(r.alts[pub.id].source, "heuristic"); assert.match(r.alts[pub.id].alt, /^صورة من منشور @a11y_sara: غروب الشمس/);
  assert.equal((await anon.req("GET", "/api/a11y/alt/" + priv.id)).status, 404);
  assert.equal((await sara.req("GET", "/api/a11y/alt/" + priv.id)).source, "heuristic", "owner sees own");
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM media_alt")).n), 0);
  // vision only for public images
  visionCalls.length = 0;
  r = await sara.req("POST", `/api/a11y/alt/${priv.id}/auto`);
  assert.equal(r.source, "heuristic"); assert.equal(visionCalls.length, 0, "private image never sent to the provider");
  r = await sara.req("POST", `/api/a11y/alt/${pub.id}/auto`);
  assert.equal(r.status, 200, r.error); assert.equal(r.source, "auto"); assert.equal(r.alt, "قطة برتقالية تجلس على نافذة");
  assert.equal(visionCalls.length, 1); assert.equal(visionCalls[0].mime, "image/png");
  assert.equal((await omar.req("POST", `/api/a11y/alt/${pub.id}/auto`)).status, 404, "owner only");
  assert.equal((await anon.req("GET", "/api/a11y/alt/" + pub.id)).source, "auto");
  // user text wins and is never overwritten
  assert.equal((await omar.req("PUT", "/api/a11y/alt/" + pub.id, { alt: "x" })).status, 404);
  assert.equal((await sara.req("PUT", "/api/a11y/alt/" + pub.id, { alt: "<img>" })).code, "alt_invalid");
  r = await sara.req("PUT", "/api/a11y/alt/" + pub.id, { alt: "  قطتي   مشمش على النافذة " });
  assert.equal(r.alt, "قطتي مشمش على النافذة"); assert.equal(r.source, "user");
  r = await sara.req("POST", `/api/a11y/alt/${pub.id}/auto`);
  assert.equal(r.source, "user", "auto does not replace user text unless asked");
  assert.equal(await svc().autoAlt(pub.id, { force: true }), null);
  assert.equal((await anon.req("GET", "/api/a11y/alt?ids=" + pub.id)).alts[pub.id].alt, "قطتي مشمش على النافذة");
  r = await sara.req("POST", `/api/a11y/alt/${pub.id}/auto`, { replace: true });
  assert.equal(r.source, "auto");
  r = await sara.req("PUT", "/api/a11y/alt/" + pub.id, { alt: "" });
  assert.equal(r.source, "heuristic", "clearing falls back to the heuristic");
});

test("alt text without a vision key → heuristic only (nothing sent anywhere)", async () => {
  const H2 = await bootKeyless();
  try {
    const s = H2.app.ctx.services.a11y;
    assert.equal(s.vision(), false); assert.equal(s.captioner(), false);
    const cfg = await (await fetch(H2.base + "/api/a11y/config")).json();
    assert.equal(cfg.vision, false); assert.equal(cfg.autoCaptions, false);
  } finally { await H2.app.close(); }
  const r = require("../services/a11y");
  assert.equal(typeof r, "function");
});

test("captions: WebVTT/SRT upload + edit, serving, mirrored into variants, delete, owner only", async () => {
  const mid = await video(sara);
  const p = await post(sara, { type: "video", text: "فيديو تعليمي", video: { mediaId: mid, duration: 10 } });
  await db().run("UPDATE posts SET status='published' WHERE id=$1", [p.id]);
  assert.equal((await omar.req("PUT", `/api/a11y/captions/${mid}/ar`, { vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nx" })).status, 404, "owner only");
  assert.equal((await sara.req("PUT", `/api/a11y/captions/${mid}/ar`, { vtt: "not captions" })).status, 400);
  assert.equal((await sara.req("PUT", `/api/a11y/captions/${mid}/arabic`, { vtt: "WEBVTT" })).code, "lang_invalid");
  let r = await sara.req("PUT", `/api/a11y/captions/${mid}/ar`, { vtt: "1\n00:00:00,000 --> 00:00:02,000\nمرحبا <script>x</script>\n" });
  assert.equal(r.status, 200, r.error); assert.equal(r.source, "manual"); assert.equal(r.label, "العربية");
  assert.match(r.vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:02\.000\nمرحبا x/); assert.ok(!r.vtt.includes("<script>"));
  r = await sara.req("PUT", `/api/a11y/captions/${mid}/ar`, { vtt: "WEBVTT\n\n00:00.000 --> 00:02.000\nأهلاً وسهلاً" });
  assert.match(r.vtt, /أهلاً وسهلاً/);
  assert.equal(Number((await db().get("SELECT COUNT(*) n FROM video_captions WHERE media_id=$1", [mid])).n), 1, "edit replaces");
  // serving + listing (public post → anyone)
  const anon = new H.Client();
  r = await anon.req("GET", "/api/a11y/captions/" + mid);
  assert.equal(r.captions.length, 1); assert.equal(r.captions[0].url, `/api/a11y/captions/${mid}/ar.vtt`);
  const f = await fetch(H.base + r.captions[0].url);
  assert.equal(f.status, 200); assert.match(f.headers.get("content-type"), /text\/vtt/); assert.match(await f.text(), /^WEBVTT[\s\S]*أهلاً وسهلاً/);
  assert.equal((await sara.req("GET", `/api/a11y/captions/${mid}/ar/source`)).vtt.includes("أهلاً"), true);
  // mirrored into media variants and the post so the existing player renders <track>
  const m = await db().get("SELECT variants FROM media WHERE id=$1", [mid]);
  const v = typeof m.variants === "string" ? JSON.parse(m.variants) : m.variants;
  assert.equal(v.captions[0].lang, "ar"); assert.equal(v.original, "/media/" + mid + ".mp4", "other variants kept");
  const pv = (await sara.req("GET", "/api/posts/" + p.id)).post.video;
  assert.equal(pv.variants.captions[0].url, `/api/a11y/captions/${mid}/ar.vtt`);
  // auto (stub ASR)
  r = await sara.req("POST", `/api/a11y/captions/${mid}/auto`, { lang: "en" });
  assert.equal(r.status, 200, r.error); assert.equal(r.source, "auto"); assert.match(r.vtt, /00:00:01\.500 --> 00:00:03\.200\nفي مجتمع بلس/);
  assert.equal((await anon.req("GET", "/api/a11y/captions/" + mid)).captions.length, 2);
  // private (unpublished) video: nothing for strangers
  const hidden = await video(sara);
  await sara.req("PUT", `/api/a11y/captions/${hidden}/ar`, { vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nسر" });
  assert.equal((await anon.req("GET", "/api/a11y/captions/" + hidden)).status, 404);
  assert.equal((await fetch(H.base + `/api/a11y/captions/${hidden}/ar.vtt`)).status, 404);
  // delete
  r = await sara.req("DELETE", `/api/a11y/captions/${mid}/en`);
  assert.deepEqual(r.captions.map((c) => c.lang), ["ar"]);
});

test("auto captions without a speech-to-text key → 503, manual only", async () => {
  const H2 = await bootKeyless();
  try {
    const c = new H2.Client(); const reg = await c.req("POST", "/api/auth/register", { name: "عضو", handle: "a11y_solo", password: "secret123" });
    const mid = "md_solo" + Math.random().toString(36).slice(2, 8);
    await H2.app.ctx.db.run("INSERT INTO media(id,owner,kind,mime,size,storage_key,status,variants,created_at) VALUES($1,$2,'video','video/mp4',10,$3,'ready',$4,$5)", [mid, reg.user.id, mid + ".mp4", {}, new Date().toISOString()]);
    const r = await c.req("POST", `/api/a11y/captions/${mid}/auto`, { lang: "ar" });
    assert.equal(r.status, 503); assert.equal(r.code, "not_configured");
  } finally { await H2.app.close(); }
});

test("periodic audit: cheap counts, CI reports, admin only, maintenance job", async () => {
  assert.equal((await sara.req("POST", "/api/admin/a11y/audits/run")).status, 403);
  let r = await admin.req("POST", "/api/admin/a11y/audits/run");
  assert.equal(r.status, 200, r.error); assert.equal(r.kind, "server");
  assert.ok(r.summary.images >= 3); assert.ok(r.summary.videos >= 2); const withAlt = Number((await db().get("SELECT COUNT(*) n FROM media_alt")).n);
  assert.equal(r.summary.imagesWithAlt, withAlt);
  assert.equal(r.summary.missingAlt, r.summary.images - withAlt); assert.ok(r.summary.videosWithCaptions >= 2);
  assert.equal(r.ok, false); assert.equal(r.issues, r.summary.missingAlt + r.summary.missingCaptions);
  assert.equal((await admin.req("POST", "/api/admin/a11y/audits", { pages: "x" })).status, 400);
  r = await admin.req("POST", "/api/admin/a11y/audits", { release: "2.16.0", pages: [{ route: "#/home", violations: 0, rules: [] }, { route: "#/me", violations: 2, rules: ["color-contrast", "bad rule!"] }] });
  assert.equal(r.kind, "ci"); assert.equal(r.issues, 2); assert.deepEqual(r.summary.pages[1].rules, ["color-contrast"]);
  r = await admin.req("GET", "/api/admin/a11y/audits?kind=ci");
  assert.equal(r.items.length, 1); assert.equal(r.items[0].ok, false);
  const out = await svc().maintain();
  assert.equal(out.audit.summary.lastCi.issues, 2);
  assert.ok(out.described >= 1, "vision describes recent public images missing alt");
  assert.ok(visionCalls.length >= 2);
  assert.equal((await admin.req("GET", "/api/admin/a11y/audits")).items.length, 3);
  assert.equal((await sara.req("GET", "/api/admin/a11y/audits")).status, 403);
});
