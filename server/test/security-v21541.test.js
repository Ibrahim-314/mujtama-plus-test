/* v2.154.1 security fixes: (1) repository internals are never served as static files, (2) raw upload routes refuse
 * anonymous callers before reading the body, (3) password checks are async, single and constant-time for unknown handles. */
const test = require("node:test"), assert = require("node:assert");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os");
const { boot } = require("./helpers");
const { isForbiddenStatic } = require("../lib/http");
const core = require("../lib/core");

test("static deny-list refuses repository internals", () => {
  for (const p of ["/server/data.sqlite", "/server/lib/secrets.js", "/.env", "/.git/config", "/a/.hidden", "/data.sqlite", "/x.db",
    "/package.json", "/Dockerfile", "/docker-compose.yml", "/deploy/k8s/web.yaml", "/tools/build.mjs", "/tests/e2e/harness.js",
    "/docs/PI.md", "/README.md", "/CHANGELOG.md", "/tmp-prologue-shots/d-0040.png", "/node_modules/x/index.js", "/nabd/engine/index.wasm.gz.part0"])
    assert.equal(isForbiddenStatic(p), true, p);
  for (const p of ["/index.html", "/app.js", "/theme.css", "/assets/brand/logo-master.png", "/sw.js", "/manifest.json",
    "/pi-app-validation.txt", "/.well-known/assetlinks.json", "/nabd/index.html", "/public/icons/icon-192.png"])
    assert.equal(isForbiddenStatic(p), false, p);
});

test("server never serves the database or dotfiles from the web root", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mp-root-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>x</title>");
  fs.mkdirSync(path.join(root, "server")); fs.writeFileSync(path.join(root, "server", "data.sqlite"), "SQLite format 3\0secret");
  fs.writeFileSync(path.join(root, ".env"), "SECRET=1");
  const H = await boot({ webRoot: root });
  try {
    for (const p of ["/server/data.sqlite", "/.env", "/%2eenv", "/server%2fdata.sqlite"]) {
      const r = await fetch(H.base + p); const body = await r.text();
      assert.ok(!body.includes("SQLite format") && !body.includes("SECRET=1"), p + " leaked");
    }
    const ok = await fetch(H.base + "/index.html"); assert.equal(ok.status, 200);
  } finally { await H.app.close(); }
});

test("raw upload routes refuse anonymous callers before reading the body", async () => {
  const H = await boot();
  try {
    const r = await fetch(H.base + "/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "application/octet-stream" }, body: Buffer.alloc(2 * 1024 * 1024) });
    assert.equal(r.status, 401);
    const j = await r.json(); assert.equal(j.code, "auth_required");
  } finally { await H.app.close(); }
});

test("password helpers: async verify, malformed hash is false, dummy never matches", async () => {
  const h = await core.hashPasswordAsync("correct horse");
  assert.equal(await core.verifyPasswordAsync("correct horse", h), true);
  assert.equal(await core.verifyPasswordAsync("wrong", h), false);
  assert.equal(core.verifyPassword("correct horse", h), true); // sync and async hashes are interchangeable
  assert.equal(await core.verifyPasswordAsync("x", null), false);
  assert.equal(await core.verifyPasswordAsync("x", "scrypt$zz$zz"), false);
  assert.equal(core.verifyPassword("x", "scrypt$00$00"), false); // used to throw (timingSafeEqual length) → 500
  assert.equal(await core.verifyPasswordAsync("", "scrypt$" + "0".repeat(32) + "$" + "0".repeat(128)), false);
});

test("login: wrong password and unknown handle both answer 401 bad_credentials", async () => {
  const H = await boot();
  try {
    const a = new H.Client();
    const reg = await a.req("POST", "/api/auth/register", { name: "سارة", handle: "sara_sec", password: "password123" });
    assert.equal(reg.status, 200);
    const b = new H.Client();
    const wrong = await b.req("POST", "/api/auth/login", { handle: "sara_sec", password: "nope-nope" });
    const none = await b.req("POST", "/api/auth/login", { handle: "nobody_here", password: "nope-nope" });
    assert.equal(wrong.status, 401); assert.equal(none.status, 401);
    assert.equal(wrong.code, "bad_credentials"); assert.equal(none.code, "bad_credentials");
    const good = await b.req("POST", "/api/auth/login", { handle: "SARA_sec", password: "password123" });
    assert.equal(good.status, 200);
  } finally { await H.app.close(); }
});
