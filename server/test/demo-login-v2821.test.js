/* v2.82.1: «دخول تجريبي» — demo sign-in exists only when config.demoLogin is on (Render test copy). */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

test("demo login: off by default → 404 and not advertised in health", async () => {
  const { app, Client } = await boot({ demoLogin: false });
  try {
    const c = new Client();
    const h = await c.req("GET", "/api/health"); assert.equal(h.demo, undefined);
    const r = await c.req("POST", "/api/auth/demo", {}); assert.equal(r.status, 404);
    assert.equal((await c.req("GET", "/api/me")).status, 401);
  } finally { await app.close(); }
});

test("demo login: on → fixed fake account, plain user, reused, no password login", async () => {
  const { app, Client } = await boot({ demoLogin: true });
  try {
    const a = new Client(), b = new Client();
    assert.equal((await a.req("GET", "/api/health")).demo, true);
    const r1 = await a.req("POST", "/api/auth/demo", {}); assert.equal(r1.status, 200); assert.equal(r1.demo, true);
    const me = await a.req("GET", "/api/me"); assert.equal(me.status, 200); assert.equal(me.user.id, "u_demo_tester");
    const r2 = await b.req("POST", "/api/auth/demo", {}); assert.equal(r2.user.id, "u_demo_tester");
    const row = await app.ctx.db.get("SELECT role, password_hash FROM users WHERE id='u_demo_tester'");
    assert.equal(row.role, "user"); assert.equal(row.password_hash, null);
    const bad = await new Client().req("POST", "/api/auth/login", { handle: r1.user.handle, password: "" }); assert.equal(bad.status, 401);
  } finally { await app.close(); }
});

test("demo login: config refuses Railway env even with DEMO_LOGIN=1", () => {
  const saved = { ...process.env };
  try {
    process.env.DEMO_LOGIN = "1"; process.env.RAILWAY_ENVIRONMENT = "production";
    delete require.cache[require.resolve("../server")];
    const cfgOn = require("../server").config;
    if (cfgOn) assert.equal(cfgOn.demoLogin, false);
  } finally { process.env = saved; delete require.cache[require.resolve("../server")]; }
});
