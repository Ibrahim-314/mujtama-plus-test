/* Minimal NATS client — Phase 48. Zero dependencies: plain-text NATS protocol (INFO/CONNECT/PUB/SUB/MSG/PING/PONG),
 * enough for the opt-in event-bus adapter. Activated only when NATS_URL is set: nats://[user:pass@|token@]host:4222.
 * TLS-required servers are not supported by this minimal client (run NATS in-cluster, plaintext on a private network).
 * While disconnected publish() returns false so the caller delivers in-process; reconnects with capped backoff and
 * re-subscribes (queue groups included). */
const net = require("node:net");

function parseUrl(url) {
  const u = new URL(url),
    user = u.username ? decodeURIComponent(u.username) : null,
    pass = u.password ? decodeURIComponent(u.password) : null;
  return { host: u.hostname || "127.0.0.1", port: +(u.port || 4222), user: pass ? user : null, pass, token: user && !pass ? user : null };
}

function createNats(url, { log = console, name = "mujtama", maxPending = 8 * 1024 * 1024 } = {}) {
  const o = parseUrl(url),
    subs = new Map(); // sid → {subject, queue, fn}
  let sock = null,
    ready = false,
    closed = false,
    backoff = 100,
    timer = null,
    nextSid = 1,
    buf = Buffer.alloc(0);
  const readyWaiters = [],
    pongWaiters = [];
  function write(s) {
    if (sock && !sock.destroyed) sock.write(s);
  }
  function onLine() {
    for (;;) {
      const nl = buf.indexOf("\r\n");
      if (nl < 0) return;
      const line = buf.toString("utf8", 0, nl);
      if (line.startsWith("MSG ")) {
        const parts = line.split(" "),
          bytes = +parts[parts.length - 1];
        if (buf.length < nl + 2 + bytes + 2) return; // wait for the payload
        const payload = buf.toString("utf8", nl + 2, nl + 2 + bytes);
        buf = buf.subarray(nl + 2 + bytes + 2);
        const s = subs.get(+parts[2]);
        if (s) {
          try {
            s.fn(payload, parts[1]);
          } catch (e) {
            log.error?.("nats handler", { err: e.message });
          }
        }
        continue;
      }
      buf = buf.subarray(nl + 2);
      if (line.startsWith("INFO ")) {
        const info = (() => {
          try {
            return JSON.parse(line.slice(5));
          } catch {
            return {};
          }
        })();
        if (info.tls_required) {
          log.warn?.("nats: server requires TLS (unsupported by the minimal client)");
          sock.destroy();
          return;
        }
        const c = {
          verbose: false,
          pedantic: false,
          lang: "node-lite",
          version: "1.0.0",
          protocol: 1,
          name,
          ...(o.user ? { user: o.user, pass: o.pass } : {}),
          ...(o.token ? { auth_token: o.token } : {})
        };
        write("CONNECT " + JSON.stringify(c) + "\r\n");
        for (const [sid, s] of subs) write(`SUB ${s.subject}${s.queue ? " " + s.queue : ""} ${sid}\r\n`);
        write("PING\r\n");
      } else if (line === "PING") write("PONG\r\n");
      else if (line === "PONG") {
        if (!ready) {
          ready = true;
          backoff = 100;
          while (readyWaiters.length) readyWaiters.shift()();
        } else {
          const w = pongWaiters.shift();
          if (w) w();
        }
      } else if (line.startsWith("-ERR")) log.warn?.("nats error", { err: line.slice(5) });
    }
  }
  function connect() {
    if (closed) return;
    buf = Buffer.alloc(0);
    sock = net.connect({ host: o.host, port: o.port });
    sock.setNoDelay(true);
    sock.on("data", chunk => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      onLine();
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      ready = false;
      while (pongWaiters.length) pongWaiters.shift()();
      if (closed) return;
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    });
  }
  connect();
  return {
    url: url.replace(/\/\/[^@]*@/, "//***@"),
    get ready() {
      return ready;
    },
    waitReady(ms = 2000) {
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
    /** returns false when not connected or the socket is backed up (caller falls back to in-process delivery) */
    publish(subject, data) {
      if (!ready || !sock || sock.writableLength > maxPending) return false;
      const b = Buffer.from(String(data));
      write(`PUB ${subject} ${b.length}\r\n`);
      write(b);
      write("\r\n");
      return true;
    },
    /** @param {string} subject @param {(msg: string, subject: string) => void} fn @param {{queue?: string}} [opts] */
    subscribe(subject, fn, { queue } = {}) {
      const sid = nextSid++;
      subs.set(sid, { subject, queue, fn });
      if (ready) write(`SUB ${subject}${queue ? " " + queue : ""} ${sid}\r\n`);
      return sid;
    },
    /** round-trip barrier: resolves once the server processed everything written before it */
    flush(ms = 2000) {
      if (!ready) return Promise.resolve(false);
      return new Promise(res => {
        const t = setTimeout(() => res(false), ms);
        pongWaiters.push(() => {
          clearTimeout(t);
          res(true);
        });
        write("PING\r\n");
      });
    },
    close() {
      closed = true;
      clearTimeout(timer);
      ready = false;
      sock?.destroy();
    }
  };
}
module.exports = { createNats, parseUrl };
