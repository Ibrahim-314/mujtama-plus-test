/* Horizontal scaling adapters (Phase 48). Everything here is OPT-IN by environment variable; with none set the app
 * behaves exactly as before (in-process event bus, in-memory cache and rate limits, local realtime, ROLE=all).
 *
 *   REDIS_URL       → shared cache (L1 in-process + L2 Redis, cross-node invalidation over pub/sub), distributed rate
 *                     limits (fixed-window INCR merged with the local sliding window), realtime fan-out (SSE + WebSocket
 *                     pushes reach users connected to any node), optional session cache (REDIS_SESSION_CACHE_MS > 0).
 *   NATS_URL        → event bus over NATS: every event is handled once per cluster (queue group NATS_QUEUE, default
 *                     "mujtama"); falls back to in-process delivery whenever NATS is unreachable.
 *   ROLE            → web | worker-media | worker-notify | worker-search | all (default). Workers claim only their queue
 *                     job kinds / leased scheduled jobs and answer HTTP health probes only.
 * Clients are the zero-dependency redis-lite / nats-lite (no new packages). Any adapter that cannot connect within
 * SCALE_CONNECT_TIMEOUT_MS (default 3000) is skipped with a warning: the in-process default keeps running. */
const os = require("node:os"),
  crypto = require("node:crypto");
const { EventBus, Cache, RateLimiter, LIMITS } = require("./core");

/* ---------------- roles ---------------- */
const ROLES = ["web", "worker-media", "worker-notify", "worker-search", "all"];
/** queue job kinds owned by each worker role (the web role leaves them to the workers) */
const QUEUE_KINDS = {
  "worker-media": ["video", "audio", "transcribe", "automod.deep"],
  "worker-notify": ["notify.push", "notify.email", "mail.send"],
  "worker-search": []
};
/** leased scheduled jobs owned by each worker role */
const SCHED_JOBS = {
  "worker-media": [],
  "worker-notify": ["weeklyDigest", "eventsTick", "readLater", "modDigest"],
  "worker-search": ["searchSync", "savedSearchAlerts", "trendsCompute", "assistant.index"]
};
const OWNED_KINDS = new Set(Object.values(QUEUE_KINDS).flat()),
  OWNED_JOBS = new Set(Object.values(SCHED_JOBS).flat());
const parseRole = v => (ROLES.includes(String(v || "").trim()) ? String(v).trim() : "all");
const isWorker = role => role.startsWith("worker-");
/** does this role run queue job `kind` / scheduled job `name`? */
function runsKind(role, kind) {
  if (role === "all") return true;
  if (role === "web") return !OWNED_KINDS.has(kind);
  return (QUEUE_KINDS[role] || []).includes(kind);
}
function runsJob(role, name) {
  if (role === "all") return true;
  if (role === "web") return !OWNED_JOBS.has(name);
  return (SCHED_JOBS[role] || []).includes(name);
}
/** HTTP surface of a role: workers expose health/readiness only */
const HEALTH_PATHS = new Set(["/api/health", "/healthz", "/readyz"]);
function allowsHttp(role, pathname) {
  return !isWorker(role) || HEALTH_PATHS.has(pathname);
}

/* ---------------- helpers ---------------- */
/** JSON-safe plain data only (no Date/Buffer/Map/class instances/functions), bounded depth & size */
function isPlain(v, depth = 0) {
  if (depth > 12) return false;
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(x => isPlain(x, depth + 1));
  if (typeof v === "object") {
    const p = Object.getPrototypeOf(v);
    if (p !== Object.prototype && p !== null) return false;
    return Object.values(v).every(x => x !== undefined && isPlain(x, depth + 1));
  }
  return false;
}
const plainJson = (v, max = 512 * 1024) => {
  if (!isPlain(v)) return undefined;
  const s = JSON.stringify(v);
  return s.length <= max ? s : undefined;
};
const noop = () => {};

/* ---------------- Redis-backed cache ---------------- */
class SharedCache extends Cache {
  /** @param {any} redis @param {any} [opts] */
  constructor(redis, { prefix = "mp:c:", nodeId, channel = "mp:inv" } = {}) {
    super();
    this.redis = redis;
    this.prefix = prefix;
    this.nodeId = nodeId;
    this.channel = channel;
    this.stats = { l2hit: 0, l2miss: 0, inv: 0 };
  }
  async listen() {
    await this.redis.subscribe(this.channel, msg => {
      try {
        const m = JSON.parse(msg);
        if (m.o !== this.nodeId) {
          Cache.prototype.del.call(this, m.p);
          this.stats.inv++;
        }
      } catch {
        /* ignore */
      }
    });
  }
  set(k, v, ttlMs = 30e3) {
    super.set(k, v, ttlMs);
    const j = plainJson(v);
    if (j !== undefined) this.redis.set(this.prefix + k, j, ttlMs).catch(noop);
    return v;
  }
  del(prefix) {
    super.del(prefix);
    this.redis.publish(this.channel, JSON.stringify({ o: this.nodeId, p: prefix })).catch(noop);
    this.redis.delPrefix(this.prefix + prefix).catch(noop);
  }
  /* single-flight per node; L1 → L2 (another node's warm value) → compute */
  async wrap(k, ttl, fn) {
    const v = this.get(k);
    if (v !== undefined) return v;
    if (!this.inflight) this.inflight = new Map();
    if (this.inflight.has(k)) return this.inflight.get(k);
    const p = (async () => {
      const s = await this.redis.get(this.prefix + k).catch(() => null);
      if (s != null) {
        try {
          const val = JSON.parse(s);
          this.stats.l2hit++;
          return Cache.prototype.set.call(this, k, val, ttl);
        } catch {
          /* recompute */
        }
      }
      this.stats.l2miss++;
      return this.set(k, await fn(), ttl);
    })().finally(() => this.inflight.delete(k));
    this.inflight.set(k, p);
    return p;
  }
}

/* ---------------- distributed rate limiter ----------------
 * hit() stays synchronous (every service and the automod wrapper call it inline). Each allowed hit is also counted in a
 * Redis fixed window (INCR + PEXPIRE); the latest cluster count for the key is remembered and merged with the local
 * sliding window, so a key is limited cluster-wide after at most one Redis round trip per node. hitAsync() is exact. */
class DistributedRateLimiter extends RateLimiter {
  /** @param {any} bus @param {any} redis @param {any} [opts] */
  constructor(bus, redis, { prefix = "mp:rl:" } = {}) {
    super(bus);
    this.redis = redis;
    this.prefix = prefix;
    this.remote = new Map();
    this.errors = 0;
  }
  _win(action) {
    const [max, ms] = LIMITS[action] || LIMITS.default,
      t = Date.now();
    return { max, ms, t, win: Math.floor(t / ms) };
  }
  _count(action, key, win, ms) {
    const rk = `${this.prefix}${action}:${key}:${win}`,
      k = action + ":" + key;
    const r = this.remote.get(k) || { win, n: 0, pending: 0 };
    if (r.win !== win) {
      r.win = win;
      r.n = 0;
      r.pending = 0;
    }
    r.pending++;
    this.remote.set(k, r);
    const done = () => {
      if (r.win === win) r.pending = Math.max(0, r.pending - 1);
    };
    this.redis
      .incr(rk)
      .then(n => {
        if (r.win === win) r.n = Math.max(r.n, n);
        done();
        if (n === 1) this.redis.pexpire(rk, ms * 2).catch(noop);
      })
      .catch(() => {
        this.errors++;
        done();
      });
    if (this.remote.size > 20000) this.remote.delete(this.remote.keys().next().value);
  }
  hit(action, key) {
    const { max, ms, win } = this._win(action),
      k = action + ":" + key,
      r = this.remote.get(k);
    const cluster = r && r.win === win ? r.n + r.pending : 0;
    if (this.redis.ready && cluster >= max) {
      if (cluster === max) this.bus?.emit("ABUSE_DETECTED", { action, key, cluster: true });
      return false;
    }
    const ok = super.hit(action, key);
    if (ok && this.redis.ready) this._count(action, key, win, ms);
    return ok;
  }
  /** exact cluster-wide check (one round trip); falls back to the local limiter when Redis is unavailable */
  async hitAsync(action, key) {
    const { max, ms, win } = this._win(action);
    if (!this.redis.ready) return super.hit(action, key);
    try {
      const rk = `${this.prefix}${action}:${key}:${win}`,
        n = await this.redis.incr(rk);
      if (n === 1) this.redis.pexpire(rk, ms * 2).catch(noop);
      return n <= max;
    } catch {
      return super.hit(action, key);
    }
  }
}

/* ---------------- NATS event bus ---------------- */
class NatsEventBus extends EventBus {
  /** @param {any} nats @param {any} [opts] */
  constructor(nats, { subjectPrefix = "mujtama.evt.", queue = "mujtama", nodeId, log = console } = {}) {
    super();
    this.nats = nats;
    this.subjectPrefix = subjectPrefix;
    this.queue = queue;
    this.nodeId = nodeId;
    this.logger = log;
    this.stats = { published: 0, received: 0, local: 0 };
  }
  listen() {
    this.nats.subscribe(
      this.subjectPrefix + ">",
      (msg, subject) => {
        let m;
        try {
          m = JSON.parse(msg);
        } catch {
          return;
        }
        this.stats.received++;
        this.deliver(subject.slice(this.subjectPrefix.length), m.p);
      },
      { queue: this.queue }
    );
  }
  deliver(evt, payload) {
    super.emit(evt, payload);
  }
  emit(evt, payload) {
    const j = payload === undefined ? "null" : plainJson(payload, 256 * 1024);
    if (j !== undefined && this.nats.publish(this.subjectPrefix + evt, `{"o":${JSON.stringify(this.nodeId)},"p":${j}}`)) {
      this.stats.published++;
      this.log.push({ evt, at: Date.now(), via: "nats" });
      if (this.log.length > 500) this.log.shift();
      return;
    }
    this.stats.local++;
    super.emit(evt, payload); // not connected / non-JSON payload → in-process delivery
  }
}

/* ---------------- realtime fan-out ---------------- */
/** @param {any} rt @param {any} redis @param {any} [opts] */
function fanoutRealtime(rt, redis, { nodeId, channel = "mp:rt" } = {}) {
  const localSend = rt.send.bind(rt),
    localBroadcast = rt.broadcast.bind(rt),
    stats = { out: 0, in: 0 };
  rt.send = (userId, type, data = {}) => {
    localSend(userId, type, data);
    const j = plainJson(data);
    if (j !== undefined && redis.ready) {
      stats.out++;
      redis.publish(channel, `{"o":${JSON.stringify(nodeId)},"u":${JSON.stringify(userId)},"t":${JSON.stringify(type)},"d":${j}}`).catch(noop);
    }
  };
  rt.broadcast = (type, data = {}) => {
    localBroadcast(type, data);
    const j = plainJson(data);
    if (j !== undefined && redis.ready) {
      stats.out++;
      redis.publish(channel, `{"o":${JSON.stringify(nodeId)},"t":${JSON.stringify(type)},"d":${j}}`).catch(noop);
    }
  };
  const p = redis.subscribe(channel, msg => {
    let m;
    try {
      m = JSON.parse(msg);
    } catch {
      return;
    }
    if (m.o === nodeId) return;
    stats.in++;
    if (m.u) localSend(m.u, m.t, m.d);
    else localBroadcast(m.t, m.d);
  });
  return { stats, ready: p };
}

/* ---------------- session cache (opt-in, short TTL) ---------------- */
function sessionCache(redis, db, { ttlMs, prefix = "mp:s:", sha }) {
  const key = th => prefix + th;
  const dropFor = async (sql, params) => {
    const rows = await db.all(sql, params).catch(() => []);
    if (rows.length) await redis.del(...rows.map(r => key(r.token_hash))).catch(noop);
  };
  return base => ({
    ...base,
    async userByToken(t) {
      const k = key(sha(t)),
        s = await redis.get(k).catch(() => null);
      if (s != null) {
        try {
          return JSON.parse(s);
        } catch {
          /* fall through */
        }
      }
      const row = await base.userByToken(t);
      const j = row ? plainJson(row) : undefined;
      if (j !== undefined) redis.set(k, j, ttlMs).catch(noop);
      return row;
    },
    async deleteByToken(t) {
      const r = await base.deleteByToken(t);
      await redis.del(key(sha(t))).catch(noop);
      return r;
    },
    async revoke(uid, sid) {
      const q = ["SELECT token_hash FROM sessions WHERE user_id=$1 AND sid=$2", [uid, sid]];
      const rows = await db.all(...q).catch(() => []);
      const r = await base.revoke(uid, sid);
      if (rows.length) await redis.del(...rows.map(x => key(x.token_hash))).catch(noop);
      return r;
    },
    async revokeOthers(uid, keepSid) {
      const rows = await db.all("SELECT token_hash FROM sessions WHERE user_id=$1 AND (sid IS NULL OR sid<>$2)", [uid, keepSid || ""]).catch(() => []);
      const r = await base.revokeOthers(uid, keepSid);
      if (rows.length) await redis.del(...rows.map(x => key(x.token_hash))).catch(noop);
      return r;
    },
    async revokeAllExcept(keepSid) {
      const rows = await db.all("SELECT token_hash FROM sessions WHERE sid IS NULL OR sid<>$1", [keepSid || ""]).catch(() => []);
      const r = await base.revokeAllExcept(keepSid);
      for (let i = 0; i < rows.length; i += 500) await redis.del(...rows.slice(i, i + 500).map(x => key(x.token_hash))).catch(noop);
      return r;
    },
    dropFor
  });
}

/* ---------------- CDN cache headers (Cloudflare-friendly) ---------------- */
/** extra headers for a static file when CDN_CACHE=1: CDN-Cache-Control lets the edge keep assets longer than browsers */
function cdnHeaders({ html = false, hashed = false, sw = false } = {}, env = process.env) {
  if (env.CDN_CACHE !== "1") return {};
  if (html || sw) return { "CDN-Cache-Control": "no-store" };
  if (hashed) return { "CDN-Cache-Control": "public, max-age=31536000, immutable" };
  const edge = Math.max(60, +(env.CDN_EDGE_TTL || 86400));
  return { "CDN-Cache-Control": `public, max-age=${edge}, stale-while-revalidate=${edge}` };
}

/* ---------------- wiring ---------------- */
/** Build the core primitives for a new app. Returns {bus, cache, rl, scale}. Defaults are the in-process classes. */
/** @param {any} [opts] */
async function createScale({ env = process.env, log = console, overrides = {} } = {}) {
  const role = parseRole(overrides.role ?? env.ROLE),
    nodeId = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
  const timeout = +(env.SCALE_CONNECT_TIMEOUT_MS || 3000),
    redisUrl = overrides.redisUrl ?? env.REDIS_URL,
    natsUrl = overrides.natsUrl ?? env.NATS_URL;
  const scale = {
    role,
    nodeId,
    redis: null,
    nats: null,
    adapters: { bus: "memory", cache: "memory", rateLimit: "memory", realtime: "local", sessions: "db" },
    closers: []
  };
  /** @type {any} */ let bus = new EventBus();
  if (natsUrl) {
    const { createNats } = require("./nats-lite");
    const nats = createNats(natsUrl, { log, name: `mujtama-${role}` });
    if (await nats.waitReady(timeout)) {
      bus = new NatsEventBus(nats, { nodeId, log, queue: env.NATS_QUEUE || "mujtama", subjectPrefix: env.NATS_SUBJECT_PREFIX || "mujtama.evt." });
      bus.listen();
      await nats.flush(timeout);
      scale.nats = nats;
      scale.adapters.bus = "nats";
      scale.closers.push(() => nats.close());
    } else {
      log.warn?.("NATS_URL set but unreachable — using the in-process event bus", { url: nats.url });
      nats.close();
    }
  }
  /** @type {any} */ let cache = new Cache();
  /** @type {any} */ let rl = new RateLimiter(bus);
  if (redisUrl) {
    const { createRedis } = require("./redis-lite");
    const redis = createRedis(redisUrl, { log, timeoutMs: +(env.REDIS_TIMEOUT_MS || 1000) });
    if (await redis.waitReady(timeout)) {
      const prefix = env.REDIS_PREFIX || "mp:";
      scale.redis = redis;
      scale.closers.push(() => redis.close());
      cache = new SharedCache(redis, { prefix: prefix + "c:", nodeId, channel: prefix + "inv" });
      await cache.listen();
      scale.adapters.cache = "redis";
      if (env.REDIS_RATE_LIMIT !== "0") {
        rl = new DistributedRateLimiter(bus, redis, { prefix: prefix + "rl:" });
        scale.adapters.rateLimit = "redis";
      }
      scale.prefix = prefix;
    } else {
      log.warn?.("REDIS_URL set but unreachable — using in-memory cache and rate limits", { url: redis.url });
      redis.close();
    }
  }
  return { bus, cache, rl, scale };
}

/** Second step, after ctx exists: role gating of queue/scheduler (call before services register). */
function applyRole(ctx) {
  const { role } = ctx.scale;
  if (role === "all") return;
  const q = ctx.queue,
    s = ctx.scheduler,
    qOn = q.on.bind(q),
    sEvery = s.every.bind(s);
  q.on = (kind, fn) => {
    if (runsKind(role, kind)) qOn(kind, fn);
  };
  s.every = function (name, ms, fn) {
    if (runsJob(role, name)) sEvery(name, ms, fn);
    return this;
  };
}
/** Session cache hook (call before services register): repos/sessions reads db.sessionCache. */
function applySessions(ctx, env = process.env) {
  const ttl = +(env.REDIS_SESSION_CACHE_MS || 0),
    redis = ctx.scale.redis;
  if (!redis || !(ttl > 0)) return;
  ctx.db.sessionCache = sessionCache(redis, ctx.db, { ttlMs: Math.min(ttl, 60e3), prefix: (ctx.scale.prefix || "mp:") + "s:", sha: require("./core").sha });
  ctx.scale.adapters.sessions = "redis";
}
/** Last step, after all services (and the WebSocket hub) are wired: realtime fan-out + admin status route. */
async function wireScale(ctx) {
  const { scale } = ctx;
  if (scale.redis && ctx.realtime) {
    const f = fanoutRealtime(ctx.realtime, scale.redis, { nodeId: scale.nodeId, channel: (scale.prefix || "mp:") + "rt" });
    await f.ready;
    scale.realtimeStats = f.stats;
    scale.adapters.realtime = "redis";
  }
  ctx.router?.get?.("/api/admin/scale", async req => {
    if (!req.user) throw require("./core").E.auth();
    if (req.user.role !== "admin") throw require("./core").E.forbid();
    return status(ctx);
  });
}
function status(ctx) {
  const s = ctx.scale;
  return {
    role: s.role,
    node: s.nodeId,
    adapters: { ...s.adapters },
    redis: s.redis ? { ready: s.redis.ready } : null,
    nats: s.nats ? { ready: s.nats.ready } : null,
    stats: { bus: ctx.bus.stats || null, cache: ctx.cache.stats || null, rateLimitErrors: ctx.rl.errors ?? null, realtime: s.realtimeStats || null }
  };
}
async function closeScale(scale) {
  for (const c of scale?.closers || []) {
    try {
      await c();
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  ROLES,
  QUEUE_KINDS,
  SCHED_JOBS,
  parseRole,
  isWorker,
  runsKind,
  runsJob,
  allowsHttp,
  isPlain,
  plainJson,
  SharedCache,
  DistributedRateLimiter,
  NatsEventBus,
  fanoutRealtime,
  sessionCache,
  cdnHeaders,
  createScale,
  applyRole,
  applySessions,
  wireScale,
  status,
  closeScale
};
