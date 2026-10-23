/* Phase 51 — Pi payments activation readiness. Covers: checklist while off (exact missing keys, never the key value),
 * checklist when configured (testnet, mainnet without confirm stays testnet + flagged, mainnet needs wallet), App Directory
 * items (privacy, terms, manifest name/description/icon), admin-only routes, live key probe (accepted / refused), the in-memory
 * dry run (all steps pass, production tables untouched), recovery on sign-in (stuck approved payment completed), the
 * /validation-key.txt route, and the public readiness summary. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");

const KEY = "sk_test_act_51";
const payments = new Map();
const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
async function fakeFetch(url, o = {}) {
  const u = new URL(url), auth = o.headers?.Authorization || "";
  if (u.pathname === "/pi/auth/v1/login") { const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || "")); return m ? res(200, { user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {}); }
  if (auth !== "Key " + KEY) return res(401, {});
  const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(u.pathname), p = mm && payments.get(decodeURIComponent(mm[1]));
  if (!p) return res(404, {});
  if (mm[2] === "approve") p.status.developer_approved = true;
  if (mm[2] === "complete") p.status.developer_completed = true;
  if (mm[2] === "cancel") p.status.cancelled = true;
  return res(200, JSON.parse(JSON.stringify(p)));
}
const mk = async (H, handle, role) => {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
  if (role) await H.app.ctx.db.run("UPDATE users SET role=$1 WHERE id=$2", [role, c.id]);
  return c;
};
const OFF_OPTS = { piOpts: { env: {}, jobs: false }, tipsOpts: { jobs: false }, marketOpts: { jobs: false }, adsOpts: { jobs: false } };

test("off: checklist names exactly what is missing, admin only, dry run passes without touching the database", async () => {
  const H = await boot({ ...OFF_OPTS, piActivationOpts: { env: {} } });
  try {
    const admin = await mk(H, "pa_admin", "admin"), user = await mk(H, "pa_user");
    assert.equal((await user.req("GET", "/api/admin/pi/activation")).status, 403);
    const c = await admin.req("GET", "/api/admin/pi/activation"); assert.equal(c.status, 200, c.error);
    assert.equal(c.mode, "off"); assert.equal(c.paymentsReady, false);
    for (const k of ["pi_enabled", "api_key", "domain"]) assert.ok(c.missing.includes(k), k);
    assert.ok(!c.missing.includes("wallet"), "wallet only blocks on mainnet");
    const it = (k) => c.items.find((i) => i.key === k);
    for (const k of ["privacy", "terms", "app_name", "app_description", "app_icon", "validation"]) assert.equal(it(k).ok, true, k);
    assert.ok(it("api_key").fix.includes("PI_API_KEY")); assert.equal(c.steps.length, 4);
    assert.equal((await admin.req("POST", "/api/admin/pi/activation/probe")).reason, "no_key");
    const before = Number((await H.app.ctx.db.get("SELECT COUNT(*) n FROM pi_transactions")).n);
    const d = await admin.req("POST", "/api/admin/pi/dryrun"); assert.equal(d.status, 200, d.error);
    assert.equal(d.ok, true, JSON.stringify(d.steps)); assert.equal(d.steps.length, 6); assert.equal(d.touchedNetwork, false);
    assert.equal(Number((await H.app.ctx.db.get("SELECT COUNT(*) n FROM pi_transactions")).n), before);
    assert.equal((await user.req("POST", "/api/admin/pi/dryrun")).status, 403);
    const rd = await new H.Client().req("GET", "/api/pi/readiness"); assert.equal(rd.mode, "off"); assert.equal(rd.paymentsReady, false); assert.equal(rd.items, undefined);
    const rec = await user.req("POST", "/api/pi/recover"); assert.equal(rec.status, 501); assert.equal(rec.code, "not_configured");
    assert.equal((await fetch(H.base + "/validation-key.txt")).headers.get("content-type").includes("text/plain"), false);
  } finally { await H.app.close(); }
});

test("configured: testnet ready over https, mainnet guarded, key probe, validation key, recovery on sign-in", async () => {
  const env = { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub", PI_NETWORK: "mainnet" }; // mainnet asked, not confirmed
  const H = await boot({ ...OFF_OPTS, piOpts: { env, fetch: fakeFetch, jobs: false }, piActivationOpts: { env: { ...env, PUBLIC_URL: "https://mjt.example", PI_VALIDATION_KEY: "abc123validation" } } });
  try {
    const admin = await mk(H, "pb_admin", "admin"), user = await mk(H, "pb_user");
    const c = await admin.req("GET", "/api/admin/pi/activation");
    assert.equal(c.mode, "sandbox"); assert.equal(c.network, "testnet");
    assert.deepEqual(c.missing, ["network"], JSON.stringify(c.missing)); // mainnet asked without PI_MAINNET_CONFIRM
    assert.ok(!JSON.stringify(c).includes(KEY), "never leaks the key");
    assert.equal(c.items.find((i) => i.key === "domain").value, "mjt.example");
    const p = await admin.req("POST", "/api/admin/pi/activation/probe"); assert.equal(p.ok, true); assert.equal(p.reason, "key_accepted");
    const v = await fetch(H.base + "/validation-key.txt"); assert.equal(await v.text(), "abc123validation");
    // recovery on sign-in: a payment approved earlier whose txid Pi has since verified gets completed
    const ln = await user.req("POST", "/api/pi/auth", { accessToken: "at-secret-pbuser-pb_user", link: true }); assert.equal(ln.status, 200, ln.error);
    const it = await user.req("POST", "/api/pi/payments", { amount: 1, memo: "m", purpose: "test" }); assert.equal(it.status, 200, it.error);
    payments.set("act_1", { identifier: "act_1", user_uid: "uid_pbuser", amount: 1, memo: "m", metadata: it.metadata, network: "Pi Testnet", direction: "user_to_app", status: { developer_approved: false, developer_completed: false, cancelled: false, transaction_verified: false }, transaction: null });
    assert.equal((await user.req("POST", "/api/pi/payments/approve", { paymentId: "act_1" })).status, "approved");
    Object.assign(payments.get("act_1"), { transaction: { txid: "tx_act_1", verified: true } });
    await H.app.ctx.db.run("UPDATE pi_transactions SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 5 * 60e3).toISOString(), it.id]);
    const r = await user.req("POST", "/api/pi/recover"); assert.ok(!r.error, r.error);
    assert.equal(r.checked, 1); assert.equal(r.results[0].status, "completed");
    assert.equal((await H.app.ctx.db.get("SELECT status FROM pi_transactions WHERE id=$1", [it.id])).status, "completed");
    assert.equal((await user.req("POST", "/api/pi/recover")).checked, 0);
    const cfg = await new H.Client().req("GET", "/api/pi/config"); assert.equal(cfg.network, "testnet");
  } finally { await H.app.close(); }
});

test("mainnet confirmed: wallet address becomes required; refused key is reported", async () => {
  const env = { PI_ENABLED: "1", PI_API_KEY: "wrong", PI_API_URL: "https://pi.stub", PI_NETWORK: "mainnet", PI_MAINNET_CONFIRM: "1" };
  const H = await boot({ ...OFF_OPTS, piOpts: { env, fetch: fakeFetch, jobs: false }, piActivationOpts: { env: { ...env, PUBLIC_URL: "https://mjt.example", PI_WALLET_ADDRESS: "nope" } } });
  try {
    const admin = await mk(H, "pc_admin", "admin");
    const c = await admin.req("GET", "/api/admin/pi/activation");
    assert.equal(c.mode, "mainnet"); assert.ok(c.missing.includes("wallet")); assert.ok(c.items.find((i) => i.key === "wallet").fix.includes("G"));
    assert.equal((await admin.req("POST", "/api/admin/pi/activation/probe")).reason, "key_refused");
  } finally { await H.app.close(); }
});
