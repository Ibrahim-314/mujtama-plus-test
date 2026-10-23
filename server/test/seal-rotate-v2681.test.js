/* v2.68.1: setting PROVIDER_SEAL_KEY later keeps the certificate signing key usable (legacy unseal + re-seal). */
const test = require("node:test"), assert = require("node:assert"), crypto = require("node:crypto");
const P = require("../lib/providers");
test("legacy-sealed value opens with the stored key and re-seals with the env key", () => {
  const legacy = crypto.randomBytes(32).toString("base64url"), primary = crypto.createHash("sha256").update("env-key").digest("base64url");
  const blob = P.seal(legacy, "PRIVATE");
  assert.equal(P.unseal(primary, blob), null);
  const pem = P.unseal(legacy, blob); assert.equal(pem, "PRIVATE");
  assert.equal(P.unseal(primary, P.seal(primary, pem)), "PRIVATE");
});
