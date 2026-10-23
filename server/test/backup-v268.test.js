/* v2.68: /api/ops/backup is absent without config (SQLite / no env) and the openssl-format cipher round-trips. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const B = require("../services/backup");
test("backup route hidden without BACKUP_TOKEN/PostgreSQL; cipher round-trip", async () => {
  const { app, base } = await boot();
  try { assert.equal((await fetch(base + "/api/ops/backup", { headers: { Authorization: "Bearer " + "x".repeat(40) } })).status, 404); }
  finally { await app.close(); }
  const { header, cipher } = B.opensslCipher("secret-passphrase-123");
  const enc = Buffer.concat([cipher.update("hello backup"), cipher.final()]);
  const d = B.opensslDecipher("secret-passphrase-123", header);
  assert.equal(Buffer.concat([d.update(enc), d.final()]).toString(), "hello backup");
});
