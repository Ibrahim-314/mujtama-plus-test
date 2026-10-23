/* Shared stubbed Pi Platform API + test users for phase 53/58 tests (same stub as transfers.test.js / creatorsubs.test.js). */
const assert = require("node:assert");
const DAY = 864e5;
function piStub(KEY) {
  const payments = new Map(); let seq = 0;
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const pay = (o) => { const p = { identifier: "stp_" + (++seq), user_uid: o.uid, amount: o.amount, memo: "m", metadata: o.metadata || {}, direction: "user_to_app", network: "Pi Testnet", status: { developer_approved: false, transaction_verified: false, developer_completed: false, cancelled: false, user_cancelled: false }, transaction: null }; payments.set(p.identifier, p); return p; };
  async function fetch(url, o = {}) {
    if (new URL(url).pathname === "/pi/auth/v1/login") { const m = /^at-secret-([^-]+)-(.+)$/.exec(String(JSON.parse(o.body || "{}").accessToken || "")); return m ? res(200, { sessionToken: "s", user: { uid: "uid_" + m[1], username: m[2] } }) : res(401, {}); }
    const path = new URL(url).pathname, auth = o.headers?.Authorization || "";
    if (auth !== "Key " + KEY) return res(401, {});
    const mm = /^\/v2\/payments\/([^/]+)(?:\/(approve|complete|cancel))?$/.exec(path), p = mm && payments.get(decodeURIComponent(mm[1]));
    if (!p) return res(404, {});
    const body = o.body ? JSON.parse(o.body) : {};
    if (mm[2] === "approve") p.status.developer_approved = true;
    if (mm[2] === "complete") { if (!p.transaction || p.transaction.txid !== body.txid) return res(400, {}); p.status.developer_completed = true; }
    if (mm[2] === "cancel") p.status.cancelled = true;
    return res(200, JSON.parse(JSON.stringify(p)));
  }
  return { fetch, pay, env: { PI_ENABLED: "1", PI_API_KEY: KEY, PI_API_URL: "https://pi.stub" } };
}
function users(H, stub) {
  const db = () => H.app.ctx.db;
  H.Client.prototype.req = async function (method, path, body, headers = {}) {
    const raw = Buffer.isBuffer(body);
    const r = await fetch(H.base + path, { method, headers: { "X-Requested-With": "mujtama", "Content-Type": raw ? "application/octet-stream" : "application/json", "User-Agent": this.ua, Cookie: this.cookie, Origin: H.base, ...headers }, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch { j = {}; }
    return { ...j, body: j, buf, status: r.status, headers: r.headers };
  };
  const mk = async (handle) => {
    H.app.ctx.rl.w.clear();
    const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
    assert.equal(r.status, 200, r.error); c.id = r.user.id; c.handle = handle;
    await db().run("UPDATE users SET created_at=$1 WHERE id=$2", [new Date(Date.now() - 30 * DAY).toISOString(), c.id]);
    const l = await c.req("POST", "/api/pi/auth", { accessToken: `at-secret-${handle.replace(/_/g, "")}-${handle}`, link: true }); assert.equal(l.status, 200, l.error); c.uid = "uid_" + handle.replace(/_/g, "");
    return c;
  };
  async function payIntent(c, intent, settle) {
    const p = stub.pay({ uid: c.uid, amount: intent.amount, metadata: intent.metadata });
    const a = await c.req("POST", "/api/pi/payments/approve", { paymentId: p.identifier }); assert.equal(a.status, 200, a.error);
    p.transaction = { txid: "tx_" + p.identifier, verified: true }; p.status.transaction_verified = true;
    const d = await c.req("POST", "/api/pi/payments/complete", { paymentId: p.identifier, txid: "tx_" + p.identifier }); assert.equal(d.status, 200, d.error);
    if (settle) await settle(); return p;
  }
  return { mk, payIntent, db };
}
module.exports = { piStub, users, DAY };
