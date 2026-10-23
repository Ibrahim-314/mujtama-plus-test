/* DKIM key generator (Phase 29): node server/scripts/dkim-keygen.js <selector> <domain>
 * Prints the private key (store it as DKIM_PRIVATE_KEY / DKIM_PRIVATE_KEY_FILE) and the DNS TXT record to publish. */
const crypto = require("node:crypto");
const { dnsRecord } = require("../lib/dkim");
const [selector = "mp1", domain = "mujtama.plus"] = process.argv.slice(2);
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const rec = dnsRecord({ privateKey, selector, domain });
console.log("# DKIM_PRIVATE_KEY (keep secret):\n" + privateKey);
console.log(`# env:\nDKIM_SELECTOR=${selector}\nDKIM_DOMAIN=${domain}\n`);
console.log(`# DNS: ${rec.name}  ${rec.type}\n"${rec.value}"`);
