/* Phases 1/3/5 — operations: health/status, request ids, client errors, RUM beacons, feature flags,
 * data export, reversible migrations, static asset caching. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers"); const M = require("../lib/migrations");
let H, A, B;
test.before(async () => { H = await boot(); A = new H.Client(); B = new H.Client(); await A.req("POST", "/api/auth/register", { name: "مدير", handle: "admin1", password: "secret123" }); await B.req("POST", "/api/auth/register", { name: "سلمى", handle: "salma", password: "secret123" }); });
test.after(() => H.app.close());

test("health is public, status is admin-only and reports services/jobs/migrations", async () => {
  let r = await B.req("GET", "/api/health"); assert.equal(r.ok, true); assert.ok(r.headers.get("x-request-id"));
  assert.equal((await B.req("GET", "/api/status")).status, 403);
  r = await A.req("GET", "/api/status"); assert.equal(r.status, 200); assert.equal(r.services.database.ok, true); assert.ok(r.migrations.every(m => m.applied));
  const rid = "test-request-123456"; r = await B.req("GET", "/api/nope", null, { "X-Request-Id": rid }); assert.equal(r.headers.get("x-request-id"), rid); assert.equal(r.requestId, rid);
});

test("client errors are grouped by fingerprint; RUM accepts header-less beacons", async () => {
  for (let i = 0; i < 3; i++) await B.req("POST", "/api/client-errors", { message: "TypeError: x is undefined", stack: "TypeError\n at render (app.js:10)", url: "/#/home", release: "2.2.0" });
  let r = await A.req("GET", "/api/admin/errors"); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].count, 3);
  const beacon = await fetch(H.base + "/api/rum", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ metrics: [{ name: "LCP", value: 1234 }, { name: "CLS", value: .02 }, { name: "EVIL", value: 1 }], device: "mobile" }) });
  assert.equal(beacon.status, 200);
  r = await A.req("GET", "/api/status"); assert.equal(r.webVitals.LCP.n, 1); assert.equal(r.webVitals.EVIL, undefined);
  const csrf = await fetch(H.base + "/api/posts", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }); assert.equal(csrf.status, 403, "non-beacon routes still need the CSRF header");
});

test("feature flags: defaults, percentage rollout, allow-list, admin-only edits", async () => {
  await new Promise(r => setTimeout(r, 50));
  const r = await B.req("GET", "/api/flags"); assert.equal(r.flags.passkeys, true); assert.equal(r.flags.stories, false);
  assert.equal((await B.req("PUT", "/api/admin/flags/stories", { enabled: true, rollout: 100 })).status, 403);
  const salma = (await B.req("GET", "/api/me")).user.id;
  assert.equal((await A.req("PUT", "/api/admin/flags/stories", { enabled: true, rollout: 0, allow: [salma] })).status, 200);
  assert.equal((await B.req("GET", "/api/flags")).flags.stories, true, "allow-listed user sees it");
  assert.equal((await A.req("GET", "/api/flags")).flags.stories, false, "others do not at 0%");
});

test("data export returns the user's own data without secrets", async () => {
  await B.req("POST", "/api/posts", { text: "منشور للتصدير #برمجة" });
  const r = await fetch(H.base + "/api/me/export", { headers: { Cookie: B.cookie } });
  assert.match(r.headers.get("content-disposition"), /attachment/);
  const j = await r.json(); assert.equal(j.profile.handle, "salma"); assert.equal(j.posts.length, 1); assert.equal(j.profile.password_hash, undefined);
});

test("migrations roll back and re-apply cleanly", async () => {
  const db = H.app.ctx.db;
  const ids = (await M.status(db)).map(m => m.id), last2 = ids.slice(-2);
  assert.deepEqual(await M.down(db, 2), [...last2].reverse());
  assert.equal((await M.status(db)).find(m => m.id === last2[0]).applied, false);
  assert.deepEqual(await M.up(db), last2);
});

test("static assets: hashed files are immutable, HTML is no-cache, br served when accepted", async () => {
  const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
  const root = H.app.ctx.config.webRoot, dir = path.join(root, "assets"); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "test-AbCdEfGh12.js"); fs.writeFileSync(f, "console.log(1)"); fs.writeFileSync(f + ".br", zlib.brotliCompressSync("console.log(1)"));
  try {
    let r = await fetch(H.base + "/assets/test-AbCdEfGh12.js", { headers: { "Accept-Encoding": "br" } });
    assert.match(r.headers.get("cache-control"), /immutable/); assert.equal(r.headers.get("content-encoding"), "br");
    r = await fetch(H.base + "/"); assert.equal(r.headers.get("cache-control"), "no-cache");
  } finally { fs.rmSync(f); fs.rmSync(f + ".br"); }
});
