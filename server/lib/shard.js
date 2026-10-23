/* Database sharding readiness (Phase 48) — NO sharding happens today. This helper fixes the shard-key rules now so that
 * a later split is a data move, not a code rewrite. See docs/SCALING.md § sharding.
 *   • Shard key = the owning user id for user-centric rows (posts, comments, reactions, follows, notifications, messages
 *     by conversation id, media by owner, sessions), community id for community-scoped tables.
 *   • Placement = jump consistent hash (Lamping & Veach) over SHARD_COUNT (default 1 → everything on shard 0), so growing
 *     from N to N+1 shards moves only ~1/(N+1) of the keys.
 *   • Global tables (plans, settings, job_leases, audit_log, ledger) stay unsharded on the primary. */
const crypto = require("node:crypto");

/** 64-bit key from any string id (first 8 bytes of sha1, as BigInt) */
const key64 = id => crypto.createHash("sha1").update(String(id)).digest().readBigUInt64BE(0);

/** Jump consistent hash: maps key → bucket in [0, buckets) */
function jumpHash(id, buckets) {
  const n = Math.max(1, Math.floor(buckets) || 1);
  if (n === 1) return 0;
  let k = key64(id),
    b = -1,
    j = 0;
  const M = 0xffffffffffffffffn;
  while (j < n) {
    b = j;
    k = (k * 2862933555777941757n + 1n) & M;
    j = Math.floor((b + 1) * (Number(1n << 31n) / Number((k >> 33n) + 1n)));
  }
  return b;
}

/** which column carries the shard key for each sharded table (null = global/unsharded) */
const SHARD_KEYS = {
  users: "id",
  sessions: "user_id",
  posts: "author",
  comments: "post",
  reactions: "user_id",
  follows: "src",
  notifications: "user_id",
  messages: "conv",
  conversations: "id",
  media: "owner",
  communities: "id",
  memberships: "community",
  audit_log: null,
  job_leases: null,
  ai_plans: null,
  ledger_journals: null,
  ledger_entries: null
};
const shardCount = (env = process.env) => Math.max(1, Math.min(4096, +(env.SHARD_COUNT || 1) || 1));
/** shard number for an entity id (string). With SHARD_COUNT unset this is always 0. */
const shardOf = (id, n = shardCount()) => jumpHash(id, n);
/** shard for a row of `table` (looks up its shard-key column); global tables → null */
function shardForRow(table, row, n = shardCount()) {
  const col = SHARD_KEYS[table];
  if (col === undefined) throw new Error("shard: unknown table " + table);
  if (col === null) return null;
  const v = row?.[col];
  if (v == null) throw new Error(`shard: ${table}.${col} missing`);
  return shardOf(v, n);
}
/** DSN for a shard: SHARD_<n>_DATABASE_URL, else the primary DATABASE_URL (single-shard default) */
const shardDsn = (n, env = process.env) => env[`SHARD_${n}_DATABASE_URL`] || env.DATABASE_URL || null;

module.exports = { jumpHash, shardOf, shardForRow, shardCount, shardDsn, SHARD_KEYS };
