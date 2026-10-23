/* Phase 4 — security: TOTP 2FA, backup codes, sessions, new-device alerts, passkeys, audit chain. */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const { boot } = require("./helpers"); const TOTP = require("../lib/totp"); const WA = require("../lib/webauthn");
let H, A;
test.before(async () => { H = await boot(); A = new H.Client(); await A.req("POST", "/api/auth/register", { name: "إبراهيم", handle: "ibrahim", password: "secret123" }); });
test.after(() => H.app.close());
const wait = (ms) => new Promise(r => setTimeout(r, ms));

test("2FA: setup → enable → login requires code → backup code works once → disable", async () => {
  let r = await A.req("POST", "/api/security/2fa/setup"); assert.equal(r.status, 200); assert.match(r.uri, /^otpauth:\/\/totp\//);
  const secret = r.secret;
  assert.equal((await A.req("POST", "/api/security/2fa/enable", { code: "123456" })).status, 400);
  r = await A.req("POST", "/api/security/2fa/enable", { code: TOTP.generate(secret) }); assert.equal(r.status, 200); assert.equal(r.backupCodes.length, 10);
  const backup = r.backupCodes;
  const L = new H.Client();
  r = await L.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123" }); assert.equal(r.status, 401); assert.equal(r.code, "2fa_required");
  r = await L.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123", code: "000000" }); assert.equal(r.code, "2fa_invalid");
  r = await L.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123", code: backup[0] }); assert.equal(r.status, 200);
  const L2 = new H.Client(); r = await L2.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123", code: backup[0] }); assert.equal(r.code, "2fa_invalid", "backup code is single-use");
  r = await A.req("GET", "/api/security"); assert.equal(r.twoFactor.enabled, true); assert.equal(r.twoFactor.backupCodesLeft, 9); assert.ok(r.score >= 70);
  assert.equal((await A.req("POST", "/api/security/2fa/disable", { password: "wrong" })).status, 401);
  assert.equal((await A.req("POST", "/api/security/2fa/disable", { password: "secret123" })).status, 200);
});

test("sessions: list, revoke one, revoke others; new device alert", async () => {
  const D = new H.Client("Mozilla/5.0 (Windows NT 10.0) Chrome/120"); await D.req("POST", "/api/auth/login", { handle: "ibrahim", password: "secret123" });
  await wait(80);
  const kinds = (await A.req("GET", "/api/notifications")).notifications.map(n => n.kind);
  assert.ok(kinds.includes("security_login"), kinds.join());
  let r = await A.req("GET", "/api/security/sessions"); assert.ok(r.sessions.length >= 3); assert.equal(r.sessions.filter(s => s.current).length, 1);
  const other = r.sessions.find(s => !s.current);
  assert.equal((await A.req("DELETE", "/api/security/sessions/" + other.sid)).status, 200);
  r = await A.req("POST", "/api/security/sessions/revoke-others"); assert.ok(r.revoked >= 1);
  assert.equal((await D.req("GET", "/api/me")).status, 401, "revoked device is signed out");
  assert.equal((await A.req("GET", "/api/me")).status, 200, "current device stays signed in");
});

/* Software authenticator: builds real WebAuthn payloads (CBOR + ES256) to exercise the verifier. */
function cborEnc(v) {
  const head = (mt, n) => n < 24 ? Buffer.from([mt << 5 | n]) : n < 256 ? Buffer.from([mt << 5 | 24, n]) : Buffer.from([mt << 5 | 25, n >> 8, n & 255]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cborEnc(k), cborEnc(x)])]);
}
function authenticator(origin, rpId) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }); const credId = crypto.randomBytes(16); let count = 0;
  const rpHash = crypto.createHash("sha256").update(rpId).digest();
  const cd = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin }));
  return {
    id: WA.b64u(credId),
    create(challenge) {
      const cose = cborEnc(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]));
      const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
      const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, cose]);
      return { clientDataJSON: WA.b64u(cd("webauthn.create", challenge)), attestationObject: WA.b64u(cborEnc(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))) };
    },
    get(challenge) {
      const c = Buffer.alloc(4); c.writeUInt32BE(++count);
      const authData = Buffer.concat([rpHash, Buffer.from([0x05]), c]); const client = cd("webauthn.get", challenge);
      const sig = crypto.sign("sha256", Buffer.concat([authData, crypto.createHash("sha256").update(client).digest()]), privateKey);
      return { clientDataJSON: WA.b64u(client), authenticatorData: WA.b64u(authData), signature: WA.b64u(sig) };
    }
  };
}
test("passkeys: register then sign in without a password; replayed challenge rejected", async () => {
  const auth = authenticator(H.base, "127.0.0.1");
  let r = await A.req("POST", "/api/security/passkeys/options"); assert.equal(r.publicKey.rp.id, "127.0.0.1");
  r = await A.req("POST", "/api/security/passkeys", { name: "آيفون", response: auth.create(r.publicKey.challenge) }); assert.equal(r.status, 200, r.error);
  assert.equal((await A.req("GET", "/api/security")).passkeys.length, 1);
  const P = new H.Client();
  r = await P.req("POST", "/api/auth/passkey/options", { handle: "ibrahim" }); assert.equal(r.publicKey.allowCredentials.length, 1);
  const assertion = auth.get(r.publicKey.challenge);
  r = await P.req("POST", "/api/auth/passkey", { id: auth.id, response: assertion }); assert.equal(r.status, 200, r.error); assert.equal(r.user.handle, "ibrahim");
  assert.equal((await P.req("GET", "/api/me")).status, 200);
  r = await new H.Client().req("POST", "/api/auth/passkey", { id: auth.id, response: assertion }); assert.equal(r.status, 400, "challenge cannot be replayed");
});

test("audit log is a verifiable hash chain and detects tampering", async () => {
  await wait(50);
  let r = await A.req("GET", "/api/admin/audit/verify"); assert.equal(r.ok, true); assert.ok(r.checked >= 3, JSON.stringify(r));
  await H.app.ctx.db.run("UPDATE audit_log SET reason='edited' WHERE id=(SELECT MIN(id) FROM audit_log WHERE hash IS NOT NULL)");
  r = await A.req("GET", "/api/admin/audit/verify"); assert.equal(r.ok, false);
});
