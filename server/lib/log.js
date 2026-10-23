/* Structured JSON logging (Phase 1) with request correlation. LOG_FORMAT=pretty for humans. */
const crypto = require("node:crypto");
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[process.env.LOG_LEVEL || "info"] || 20;
const pretty = process.env.LOG_FORMAT === "pretty";
function write(level, msg, fields = {}) {
  if (LEVELS[level] < min || process.env.LOG_SILENT === "1") return;
  /** @type {Record<string, any>} */
  const rec = { t: new Date().toISOString(), level, msg, ...fields };
  if (rec.err instanceof Error) rec.err = { message: rec.err.message, stack: rec.err.stack, code: /** @type {any} */ (rec.err).code };
  const line = pretty ? `${rec.t} ${level.toUpperCase().padEnd(5)} ${msg} ${Object.keys(fields).length ? JSON.stringify(fields) : ""}` : JSON.stringify(rec);
  (level === "error" || level === "warn" ? process.stderr : process.stdout).write(line + "\n");
}
const log = {
  debug: (m, f) => write("debug", m, f),
  info: (m, f) => write("info", m, f),
  warn: (m, f) => write("warn", m, f),
  error: (m, f) => write("error", m, f),
  child: base => ({
    debug: (m, f) => write("debug", m, { ...base, ...f }),
    info: (m, f) => write("info", m, { ...base, ...f }),
    warn: (m, f) => write("warn", m, { ...base, ...f }),
    error: (m, f) => write("error", m, { ...base, ...f })
  })
};
const VALID_RID = /^[A-Za-z0-9._-]{8,64}$/;
const requestId = incoming => (incoming && VALID_RID.test(incoming) ? incoming : crypto.randomBytes(9).toString("base64url"));
module.exports = { log, requestId };
