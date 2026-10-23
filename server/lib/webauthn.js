/* Minimal, dependency-free WebAuthn relying party (passkeys). Supports "none"/self attestation
 * formats for registration (no attestation trust chain needed for consumer passkeys) and verifies
 * assertions with ES256 (P-256) or RS256 public keys. CBOR decoder covers the subset WebAuthn uses. */
const crypto = require("node:crypto");
const b64u = b => Buffer.from(b).toString("base64url");
const fromB64u = s => Buffer.from(String(s), "base64url");

function cbor(buf) {
  let p = 0;
  const u = n => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[p++];
    return v;
  };
  function item() {
    const ib = buf[p++],
      mt = ib >> 5,
      ai = ib & 31;
    const len =
      ai < 24
        ? ai
        : ai === 24
          ? u(1)
          : ai === 25
            ? u(2)
            : ai === 26
              ? u(4)
              : ai === 27
                ? u(8)
                : (() => {
                    throw new Error("cbor: indefinite length unsupported");
                  })();
    switch (mt) {
      case 0:
        return len;
      case 1:
        return -1 - len;
      case 2: {
        const b = buf.subarray(p, p + len);
        p += len;
        return Buffer.from(b);
      }
      case 3: {
        const s = buf.toString("utf8", p, p + len);
        p += len;
        return s;
      }
      case 4: {
        const a = [];
        for (let i = 0; i < len; i++) a.push(item());
        return a;
      }
      case 5: {
        const m = new Map();
        for (let i = 0; i < len; i++) {
          const k = item();
          m.set(k, item());
        }
        return m;
      }
      case 7:
        return ai === 20 ? false : ai === 21 ? true : null;
      default:
        throw new Error("cbor: unsupported major type " + mt);
    }
  }
  const v = item();
  return { value: v, length: p };
}
function parseAuthData(ad) {
  const rpIdHash = ad.subarray(0, 32),
    flags = ad[32],
    signCount = ad.readUInt32BE(33);
  const out = { rpIdHash, flags, up: !!(flags & 1), uv: !!(flags & 4), signCount };
  if (flags & 64) {
    let p = 37;
    p += 16;
    const idLen = ad.readUInt16BE(p);
    p += 2;
    out.credentialId = ad.subarray(p, p + idLen);
    p += idLen;
    const { value, length } = cbor(ad.subarray(p));
    out.cose = value;
    out.coseLength = length;
  }
  return out;
}
function coseToJwk(cose) {
  const kty = cose.get(1),
    alg = cose.get(3);
  if (kty === 2 && alg === -7) return { alg, jwk: { kty: "EC", crv: "P-256", x: b64u(cose.get(-2)), y: b64u(cose.get(-3)) } };
  if (kty === 3 && alg === -257) return { alg, jwk: { kty: "RSA", n: b64u(cose.get(-1)), e: b64u(cose.get(-2)) } };
  throw new Error("unsupported key algorithm");
}
function checkClient(clientDataJSON, type, challenge, origins) {
  const c = JSON.parse(fromB64u(clientDataJSON).toString("utf8"));
  if (c.type !== type) throw new Error("bad type");
  if (c.challenge !== challenge) throw new Error("bad challenge");
  if (!origins.includes(c.origin)) throw new Error("bad origin " + c.origin);
  return c;
}
const sha256 = b => crypto.createHash("sha256").update(b).digest();
function verifyRegistration({ response, challenge, rpId, origins }) {
  checkClient(response.clientDataJSON, "webauthn.create", challenge, origins);
  const att = cbor(fromB64u(response.attestationObject)).value;
  if (!["none", "packed"].includes(att.get("fmt"))) throw new Error("unsupported attestation format");
  const ad = parseAuthData(att.get("authData"));
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error("bad rpId");
  if (!ad.up) throw new Error("user not present");
  if (!ad.credentialId) throw new Error("no credential");
  const { alg, jwk } = coseToJwk(ad.cose);
  return { credentialId: b64u(ad.credentialId), publicKey: JSON.stringify(jwk), alg, signCount: ad.signCount };
}
function verifyAssertion({ response, challenge, rpId, origins, publicKey, alg, signCount }) {
  checkClient(response.clientDataJSON, "webauthn.get", challenge, origins);
  const authData = fromB64u(response.authenticatorData),
    ad = parseAuthData(authData);
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error("bad rpId");
  if (!ad.up) throw new Error("user not present");
  const data = Buffer.concat([authData, sha256(fromB64u(response.clientDataJSON))]);
  const key = crypto.createPublicKey({ key: JSON.parse(publicKey), format: "jwk" });
  const ok =
    alg === -7
      ? crypto.verify("sha256", data, { key, dsaEncoding: "der" }, fromB64u(response.signature))
      : crypto.verify("RSA-SHA256", data, key, fromB64u(response.signature));
  if (!ok) throw new Error("bad signature");
  if (ad.signCount && signCount && ad.signCount <= signCount) throw new Error("cloned authenticator suspected");
  return { signCount: ad.signCount };
}
module.exports = { verifyRegistration, verifyAssertion, cbor, parseAuthData, b64u, fromB64u };
