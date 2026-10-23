/* Secrets loader (Phase 4): every secret can come from NAME or NAME_FILE (Docker/K8s secrets,
 * Vault agent, etc.). Rotation: NAME_PREVIOUS keeps the old value valid during a rollover window. */
const fs = require("node:fs");
function secret(name, def = null) {
  const file = process.env[name + "_FILE"];
  if (file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch (e) {
      throw new Error(`cannot read ${name}_FILE: ${e.message}`);
    }
  }
  return process.env[name] ?? def;
}
const secretSet = name => [secret(name), secret(name + "_PREVIOUS")].filter(Boolean);
module.exports = { secret, secretSet };
