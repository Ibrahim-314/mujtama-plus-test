/* Minimal Redis (RESP2) client — Phase 48. Zero dependencies: just enough for the opt-in scale adapters
 * (GET/SET PX/DEL/INCR/PEXPIRE/SCAN/PUBLISH + a separate SUBSCRIBE connection). Activated only when REDIS_URL is set.
 * redis://[:password@]host:port[/db] or rediss:// (TLS). While disconnected every command rejects fast, so callers
 * fall back to their in-process behaviour; the client reconnects with capped backoff and re-subscribes. */
const net = require("node:net"),
  tls = require("node:tls");

function encode(args) {
  let out = "*" + args.length + "\r\n";
  for (const a of args) {
    const b = Buffer.from(String(a));
    out += "$" + b.length + "\r\n" + b.toString("binary") + "\r\n";
  }
  return Buffer.from(out, "binary");
}

/** Incremental RESP2 parser: feed(buf) → array of complete replies (errors as Error instances). */
function createParser() {
  let buf = Buffer.alloc(0);
  function parse(off) {
    if (off >= buf.length) return null;
    const nl = buf.indexOf("\r\n", off);
    if (nl < 0) return null;
    const type = String.fromCharCode(buf[off]),
      line = buf.toString("utf8", off + 1, nl),
      next = nl + 2;
    if (type === "+") return { v: line, end: next };
    if (type === "-") return { v: new Error(line), end: next };
    if (type === ":") return { v: Number(line), end: next };
    if (type === "$") {
      const n = Number(line);
      if (n < 0) return { v: null, end: next };
      if (buf.length < next + n + 2) return null;
      return { v: buf.toString("utf8", next, next + n), end: next + n + 2 };
    }
    if (type === "*") {
      const n = Number(line);
      if (n < 0) return { v: null, end: next };
      const arr = [];
      let p = next;
      for (let i = 0; i < n; i++) {
        const r = parse(p);
        if (!r) return null;
        arr.push(r.v);
        p = r.end;
      }
      return { v: arr, end: p };
    }
    throw new Error("resp: bad type " + type);
  }
  return {
    feed(chunk) {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      const out = [];
      for (;;) {
        const r = parse(0);
        if (!r) break;
        out.push(r.v);
        buf = buf.subarray(r.end);
      }
      return out;
    }
  };
}

function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || "127.0.0.1",
    port: +(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : null,
    username: u.username ? decodeURIComponent(u.username) : null,
    db: +(u.pathname.slice(1) || 0),
    tls: u.protocol === "rediss:"
  };
}

/** One connection. mode "cmd" (request/response FIFO) or "sub" (pub/sub push messages). */
/** @param {string} url @param {{mode?: string, log?: any, onMessage?: (ch: string, msg: string) => void, timeoutMs?: number}} [opts] */
function createConnection(url, { mode = "cmd", log = console, onMessage = () => {}, timeoutMs = 2000 } = {}) {
  const o = parseUrl(url);
  let sock = null,
    ready = false,
    closed = false,
    backoff = 100,
    timer = null;
  const pending = [],
    channels = new Set(),
    readyWaiters = [];
  function failAll(err) {
    while (pending.length) pending.shift().reject(err);
  }
  function connect() {
    if (closed) return;
    const parser = createParser();
    sock = o.tls ? tls.connect({ host: o.host, port: o.port, servername: o.host }) : net.connect({ host: o.host, port: o.port });
    sock.setNoDelay(true);
    sock.on(o.tls ? "secureConnect" : "connect", async () => {
      backoff = 100;
      const init = [];
      if (o.password) init.push(o.username ? ["AUTH", o.username, o.password] : ["AUTH", o.password]);
      if (o.db && mode === "cmd") init.push(["SELECT", o.db]);
      if (mode === "sub" && channels.size) init.push(["SUBSCRIBE", ...channels]);
      // init replies are consumed by marker entries so they never reach user callbacks
      for (const c of init) {
        pending.push({
          init: true,
          cmd: c[0],
          count: c[0] === "SUBSCRIBE" ? c.length - 1 : 1,
          resolve: () => {},
          reject: e => log.warn?.("redis init failed", { cmd: c[0], err: e.message })
        });
        sock.write(encode(c));
      }
      ready = true;
      while (readyWaiters.length) readyWaiters.shift()();
    });
    sock.on("data", chunk => {
      let replies;
      try {
        replies = parser.feed(chunk);
      } catch (e) {
        sock.destroy(e);
        return;
      }
      for (const r of replies) {
        if (mode === "sub" && Array.isArray(r) && r[0] === "message") {
          try {
            onMessage(r[1], r[2]);
          } catch (e) {
            log.error?.("redis sub handler", { err: e.message });
          }
          continue;
        }
        if (mode === "sub" && Array.isArray(r) && (r[0] === "subscribe" || r[0] === "unsubscribe")) {
          const p = pending[0];
          if (p && (p.init || p.cmd === "SUBSCRIBE" || p.cmd === "UNSUBSCRIBE")) {
            p.left = (p.left ?? (p.count || 1)) - 1;
            if (p.left <= 0) {
              pending.shift();
              p.resolve(r);
            }
          }
          continue;
        }
        const p = pending.shift();
        if (!p) continue;
        if (r instanceof Error) p.reject(r);
        else p.resolve(r);
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      ready = false;
      failAll(new Error("redis: connection closed"));
      if (closed) return;
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    });
  }
  connect();
  function send(args, extra = {}) {
    if (!ready || !sock) return Promise.reject(new Error("redis: not connected"));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        const i = pending.indexOf(entry);
        if (i >= 0) pending[i].resolve = pending[i].reject = () => {};
        reject(new Error("redis: timeout"));
      }, timeoutMs);
      const entry = {
        cmd: String(args[0]).toUpperCase(),
        ...extra,
        resolve: v => {
          clearTimeout(t);
          resolve(v);
        },
        reject: e => {
          clearTimeout(t);
          reject(e);
        }
      };
      pending.push(entry);
      sock.write(encode(args));
    });
  }
  return {
    get ready() {
      return ready;
    },
    waitReady(ms = timeoutMs) {
      return ready
        ? Promise.resolve(true)
        : new Promise(res => {
            const t = setTimeout(() => res(false), ms);
            readyWaiters.push(() => {
              clearTimeout(t);
              res(true);
            });
          });
    },
    send,
    subscribe(...chs) {
      for (const c of chs) channels.add(c);
      return ready ? send(["SUBSCRIBE", ...chs], { count: chs.length }) : Promise.resolve();
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ready = false;
      failAll(new Error("redis: closed"));
      sock?.destroy();
    }
  };
}

/** Client with a command connection and a lazily opened subscriber connection. */
function createRedis(url, { log = console, timeoutMs = 2000 } = {}) {
  const handlers = new Map();
  let sub = null;
  const cmd = createConnection(url, { mode: "cmd", log, timeoutMs });
  const api = {
    url: url.replace(/\/\/[^@]*@/, "//***@"),
    get ready() {
      return cmd.ready;
    },
    waitReady: ms => cmd.waitReady(ms),
    cmd: (...args) => cmd.send(args),
    get: k => cmd.send(["GET", k]),
    set: (k, v, ttlMs) => cmd.send(ttlMs ? ["SET", k, v, "PX", Math.max(1, Math.round(ttlMs))] : ["SET", k, v]),
    del: (...keys) => (keys.length ? cmd.send(["DEL", ...keys]) : Promise.resolve(0)),
    incr: k => cmd.send(["INCR", k]),
    pexpire: (k, ms) => cmd.send(["PEXPIRE", k, Math.max(1, Math.round(ms))]),
    publish: (ch, msg) => cmd.send(["PUBLISH", ch, msg]),
    /** SCAN MATCH prefix* and DEL in batches (cache prefix invalidation; bounded per call) */
    async delPrefix(prefix, { max = 10000 } = {}) {
      let cursor = "0",
        n = 0;
      do {
        const [next, keys] = await cmd.send(["SCAN", cursor, "MATCH", prefix.replace(/([*?[\]\\])/g, "\\$1") + "*", "COUNT", 500]);
        cursor = String(next);
        if (keys.length) n += await cmd.send(["DEL", ...keys]);
      } while (cursor !== "0" && n < max);
      return n;
    },
    async subscribe(channel, fn) {
      if (!sub)
        sub = createConnection(url, {
          mode: "sub",
          log,
          timeoutMs,
          onMessage: (ch, msg) => {
            for (const h of handlers.get(ch) || []) h(msg, ch);
          }
        });
      if (!handlers.has(channel)) handlers.set(channel, []);
      handlers.get(channel).push(fn);
      await sub.waitReady();
      await sub.subscribe(channel).catch(() => {});
    },
    close() {
      cmd.close();
      sub?.close();
    }
  };
  return api;
}

module.exports = { createRedis, createParser, encode, parseUrl };
