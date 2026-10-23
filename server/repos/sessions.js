/* Sessions repository (Phase 3): the only place that knows the sessions table's SQL. */
const { sha, now } = require("../lib/core");
module.exports = (db) => (db.sessionCache ? db.sessionCache : (x) => x)({
  create: (s) => db.run("INSERT INTO sessions(token_hash,user_id,ip,ua,created_at,expires_at,sid,last_seen,mfa) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [s.tokenHash, s.userId, s.ip, s.ua, now(), s.expiresAt, s.sid, now(), s.mfa ? 1 : 0]),
  userByToken: (t) => db.get("SELECT u.*, s.sid AS session_sid, s.last_seen AS session_seen, s.mfa AS session_mfa FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at > $2", [sha(t), now()]),
  touch: (sid) => db.run("UPDATE sessions SET last_seen=$1 WHERE sid=$2", [now(), sid]),
  listForUser: (uid) => db.all("SELECT sid, ip, ua, created_at, last_seen, mfa FROM sessions WHERE user_id=$1 AND expires_at > $2 ORDER BY COALESCE(last_seen, created_at) DESC", [uid, now()]),
  revoke: (uid, sid) => db.run("DELETE FROM sessions WHERE user_id=$1 AND sid=$2", [uid, sid]),
  revokeOthers: (uid, keepSid) => db.run("DELETE FROM sessions WHERE user_id=$1 AND (sid IS NULL OR sid<>$2)", [uid, keepSid || ""]),
  revokeAllExcept: (keepSid) => db.run("DELETE FROM sessions WHERE sid IS NULL OR sid<>$1", [keepSid || ""]), // v2.79: incident response, staff only
  deleteByToken: (t) => db.run("DELETE FROM sessions WHERE token_hash=$1", [sha(t)]),
  purgeExpired: () => db.run("DELETE FROM sessions WHERE expires_at < $1", [now()])
}); // Phase 48: db.sessionCache (REDIS_SESSION_CACHE_MS) wraps lookups
