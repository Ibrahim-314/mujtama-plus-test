/* v2.51 — HEAD = GET, HSTS, TRUST_PROXY client address, admin bootstrap only for the very first real account. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
let H;
test.before(async () => { H = await boot(); });
test.after(() => H.app.close());

test("HEAD answers like GET (status + headers, no body) for /api/health, / and static files", async () => {
  for (const p of ["/api/health", "/", "/index.html"]) {
    const g = await fetch(H.base + p); await g.arrayBuffer();
    const h = await fetch(H.base + p, { method: "HEAD" });
    assert.equal(h.status, g.status, p); assert.equal(h.status, 200, p);
    assert.equal(h.headers.get("content-type"), g.headers.get("content-type"), p);
    assert.equal((await h.arrayBuffer()).byteLength, 0, "no body for HEAD " + p);
  }
  assert.equal((await fetch(H.base + "/api/nope-v251", { method: "HEAD" })).status, 404, "unknown API route still 404");
});

test("HSTS: header built only for production (or HSTS=1)", () => {
  const load = (env) => {
    const keep = { NODE_ENV: process.env.NODE_ENV, HSTS: process.env.HSTS };
    Object.assign(process.env, env); for (const k of Object.keys(env)) if (env[k] === undefined) delete process.env[k];
    delete require.cache[require.resolve("../lib/http")];
    try { return require("../lib/http").SEC_HEADERS["Strict-Transport-Security"]; }
    finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } delete require.cache[require.resolve("../lib/http")]; require("../lib/http"); }
  };
  assert.match(load({ NODE_ENV: "production", HSTS: undefined }), /max-age=31536000/);
  assert.equal(load({ NODE_ENV: "test", HSTS: undefined }), undefined);
  assert.match(load({ NODE_ENV: "test", HSTS: "1" }), /max-age/);
  assert.equal(load({ NODE_ENV: "production", HSTS: "0" }), undefined);
});

test("TRUST_PROXY: client address from X-Real-IP / leftmost X-Forwarded-For only when trusted", async () => {
  const cfg = H.app.ctx.config, prev = cfg.trustProxy;
  let seen = null;
  H.app.ctx.router.add("GET", "/api/test-v251-ip", (req) => { seen = req.ip; return { ok: true }; });
  try {
    cfg.trustProxy = 0;
    await fetch(H.base + "/api/test-v251-ip", { headers: { "X-Real-IP": "203.0.113.9", "X-Forwarded-For": "198.51.100.1" } });
    assert.ok(!["203.0.113.9", "198.51.100.1"].includes(seen), "headers ignored when not trusted: " + seen);
    cfg.trustProxy = 1;
    await fetch(H.base + "/api/test-v251-ip", { headers: { "X-Real-IP": "203.0.113.9", "X-Forwarded-For": "198.51.100.1, 100.64.0.2" } });
    assert.equal(seen, "203.0.113.9");
    await fetch(H.base + "/api/test-v251-ip", { headers: { "X-Forwarded-For": "198.51.100.1, 100.64.0.2" } });
    assert.equal(seen, "198.51.100.1", "leftmost X-Forwarded-For (Railway overwrites the header; the right entry is its own hop)");
  } finally { cfg.trustProxy = prev; }
});

test("admin bootstrap: only the very first real account; never again after the admin is gone", async () => {
  const db = H.app.ctx.db;
  // demo seed accounts do not count as "real"
  await db.run("INSERT INTO users(id,handle,name,color,role,prefs,created_at) VALUES('u_demo9999','demo_x','Demo','#000','user','{}',$1)", ["2020-01-01T00:00:00.000Z"]);
  const A = new H.Client(), B = new H.Client(), C = new H.Client();
  const a = await A.req("POST", "/api/auth/register", { name: "الأول", handle: "first_v251", password: "secret1234" });
  assert.equal(a.status, 200);
  assert.equal((await db.get("SELECT role FROM users WHERE handle='first_v251'")).role, "admin", "first real account is admin");
  await B.req("POST", "/api/auth/register", { name: "الثاني", handle: "second_v251", password: "secret1234" });
  assert.equal((await db.get("SELECT role FROM users WHERE handle='second_v251'")).role, "user");
  // the only admin is demoted (or deleted): the next sign-up must NOT take over
  await db.run("UPDATE users SET role='user' WHERE handle='first_v251'");
  await C.req("POST", "/api/auth/register", { name: "الثالث", handle: "third_v251", password: "secret1234" });
  assert.equal((await db.get("SELECT role FROM users WHERE handle='third_v251'")).role, "user", "no takeover after the admin is gone");
  // operator recovery: ADMIN_BOOTSTRAP_HANDLE promotes that handle on sign-up, only while no admin exists
  process.env.ADMIN_BOOTSTRAP_HANDLE = "owner_v251";
  try {
    const D = new H.Client(); await D.req("POST", "/api/auth/register", { name: "المالك", handle: "owner_v251", password: "secret1234" });
    assert.equal((await db.get("SELECT role FROM users WHERE handle='owner_v251'")).role, "admin");
    const E = new H.Client(); process.env.ADMIN_BOOTSTRAP_HANDLE = "other_v251";
    await E.req("POST", "/api/auth/register", { name: "آخر", handle: "other_v251", password: "secret1234" });
    assert.equal((await db.get("SELECT role FROM users WHERE handle='other_v251'")).role, "user", "an admin exists → no bootstrap");
  } finally { delete process.env.ADMIN_BOOTSTRAP_HANDLE; }
});

test("admin bootstrap: two parallel first sign-ups → exactly one admin", async () => {
  const H2 = await boot();
  try {
    const cs = [0, 1, 2, 3].map(() => new H2.Client());
    await Promise.all(cs.map((c, i) => c.req("POST", "/api/auth/register", { name: "متزامن " + i, handle: "par_v251_" + i, password: "secret1234" })));
    assert.equal((await H2.app.ctx.db.get("SELECT COUNT(*) n FROM users WHERE role='admin'")).n, 1);
  } finally { await H2.app.close(); }
});
