/* Zero-dependency WebSocket server (RFC 6455), Phase 26.
 * Handshake (Sec-WebSocket-Accept), frame codec (7/16/64-bit lengths, masking, fragmentation with
 * continuation frames), control frames (ping/pong/close), payload limits and a keep-alive ping.
 * Used for chat + call signalling; the SSE stream stays as the automatic fallback. */
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa };

/** @param {string} key */
const acceptKey = key => crypto.createHash("sha1").update(key + GUID).digest("base64");

/** Encode one frame. Servers send unmasked frames; clients (tests) pass mask=true.
 * @param {number} opcode @param {Buffer|string} payload @param {{ mask?: boolean, fin?: boolean }} [o] */
function encodeFrame(opcode, payload = Buffer.alloc(0), { mask = false, fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  const len = data.length;
  const ext = len < 126 ? 0 : len < 65536 ? 2 : 8;
  const head = Buffer.alloc(2 + ext + (mask ? 4 : 0));
  head[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);
  head[1] = (mask ? 0x80 : 0) | (ext === 0 ? len : ext === 2 ? 126 : 127);
  if (ext === 2) head.writeUInt16BE(len, 2);
  else if (ext === 8) head.writeBigUInt64BE(BigInt(len), 2);
  if (!mask) return Buffer.concat([head, data]);
  const key = crypto.randomBytes(4);
  key.copy(head, 2 + ext);
  const out = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) out[i] = data[i] ^ key[i & 3];
  return Buffer.concat([head, out]);
}

/** Incremental frame parser: push() raw bytes, receive complete messages/control frames via callbacks.
 * Reassembles fragmented messages; enforces maxPayload; requireMask for server-side parsing. */
class FrameParser {
  /** @param {{ maxPayload?: number, requireMask?: boolean, onMessage: (op: number, data: Buffer) => void, onControl: (op: number, data: Buffer) => void, onError: (code: number, reason: string) => void }} o */
  constructor(o) {
    this.o = { maxPayload: 1 << 20, requireMask: true, ...o };
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
    this.frag = null; // { op, parts, size }
    this.dead = false;
  }
  /** @param {Buffer} chunk */
  push(chunk) {
    if (this.dead) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), rsv = b[0] & 0x70, op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (rsv) return this.fail(1002, "rsv bits");
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(this.o.maxPayload)) return this.fail(1009, "too big"); len = Number(big); off = 10; }
      if (this.o.requireMask && !masked) return this.fail(1002, "unmasked client frame");
      const control = op >= 0x8;
      if (control && (len > 125 || !fin)) return this.fail(1002, "bad control frame");
      if (len > this.o.maxPayload) return this.fail(1009, "too big");
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) return;
      let data = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const k = b.subarray(off, off + 4), out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = data[i] ^ k[i & 3];
        data = out;
      } else data = Buffer.from(data);
      this.buf = b.subarray(need);
      if (control) { this.o.onControl(op, data); continue; }
      if (op === OP.CONT) {
        if (!this.frag) return this.fail(1002, "unexpected continuation");
        this.frag.parts.push(data); this.frag.size += len;
        if (this.frag.size > this.o.maxPayload) return this.fail(1009, "too big");
        if (fin) { const f = this.frag; this.frag = null; this.o.onMessage(f.op, Buffer.concat(f.parts)); }
        continue;
      }
      if (op !== OP.TEXT && op !== OP.BIN) return this.fail(1002, "bad opcode");
      if (this.frag) return this.fail(1002, "interleaved message");
      if (fin) this.o.onMessage(op, data);
      else this.frag = { op, parts: [data], size: len };
    }
  }
  fail(code, reason) { this.dead = true; this.o.onError(code, reason); }
}

/** A single server-side connection. Events: "message" (string|Buffer), "close" ({ code, reason }). */
class WsConnection extends EventEmitter {
  /** @param {import("node:net").Socket} socket @param {{ maxPayload?: number, pingMs?: number }} [o] */
  constructor(socket, { maxPayload = 256 * 1024, pingMs = 25e3 } = {}) {
    super();
    this.socket = socket; this.open = true; this.alive = true;
    this.parser = new FrameParser({
      maxPayload, requireMask: true,
      onMessage: (op, data) => { if (op === OP.TEXT) { const s = data.toString("utf8"); this.emit("message", s); } else this.emit("message", data); },
      onControl: (op, data) => {
        if (op === OP.PING) this.raw(OP.PONG, data);
        else if (op === OP.PONG) this.alive = true;
        else if (op === OP.CLOSE) { const code = data.length >= 2 ? data.readUInt16BE(0) : 1005; this.close(code === 1005 ? 1000 : code); }
      },
      onError: (code, reason) => this.close(code, reason)
    });
    socket.setNoDelay(true);
    socket.on("data", d => this.parser.push(d));
    socket.on("error", () => this.destroy());
    socket.on("close", () => this.destroy());
    this.timer = setInterval(() => { if (!this.alive) return this.destroy(); this.alive = false; this.raw(OP.PING, Buffer.alloc(0)); }, pingMs);
    this.timer.unref?.();
  }
  raw(op, data) { if (this.open && !this.socket.destroyed) this.socket.write(encodeFrame(op, data)); }
  /** @param {string|Buffer|object} msg */
  send(msg) { if (Buffer.isBuffer(msg)) this.raw(OP.BIN, msg); else this.raw(OP.TEXT, Buffer.from(typeof msg === "string" ? msg : JSON.stringify(msg))); }
  close(code = 1000, reason = "") {
    if (!this.open) return;
    const p = Buffer.alloc(2 + Buffer.byteLength(reason)); p.writeUInt16BE(code, 0); p.write(reason, 2);
    this.raw(OP.CLOSE, p);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref?.();
    this.finish(code, reason);
  }
  destroy() { this.open = false; if (!this.socket.destroyed) this.socket.destroy(); this.finish(1006, ""); }
  finish(code, reason) { if (this.done) return; this.done = true; clearInterval(this.timer); this.emit("close", { code, reason }); }
}

/** Complete the HTTP upgrade handshake. Returns a WsConnection, or null after rejecting the socket.
 * @param {import("node:http").IncomingMessage} req @param {import("node:net").Socket} socket @param {Buffer} head */
function handshake(req, socket, head, opts = {}) {
  const key = req.headers["sec-websocket-key"];
  const ok = req.method === "GET" && /websocket/i.test(req.headers.upgrade || "") && /upgrade/i.test(req.headers.connection || "") && req.headers["sec-websocket-version"] === "13" && typeof key === "string" && Buffer.from(key, "base64").length === 16;
  if (!ok) { reject(socket, 400, "Bad Request"); return null; }
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
  const conn = new WsConnection(socket, opts);
  if (head && head.length) conn.parser.push(head);
  return conn;
}
function reject(socket, status, text) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
/** Realtime hub shared by every service (ctx.ws):
 *   ctx.ws.send(userId, type, payload)    push {type, data} to all of the user's sockets
 *   ctx.ws.broadcast(type, payload)       push to every connected user
 *   ctx.ws.on(type, (user, data, conn) => …)  handle inbound {t: type, …} frames from clients
 *   ctx.ws.online(userId) / ctx.ws.count()
 * It also wraps ctx.realtime (the SSE hub) so every existing realtime.send()/broadcast() reaches
 * WebSocket clients too; SSE keeps working unchanged as the fallback transport.
 * Upgrade: GET /api/ws (cookie session, same-origin Origin header required). */
function createHub(ctx, { path: wsPath = "/api/ws", maxPayload = 256 * 1024, rate = [40, 5000] } = {}) {
  const clients = new Map(), handlers = new Map();
  const rt = ctx.realtime;
  const sseSend = rt.send.bind(rt);
  const hub = {
    clients,
    send(userId, type, data = {}) { const set = clients.get(userId); if (!set) return 0; const msg = JSON.stringify({ type, data }); for (const c of set) c.send(msg); return set.size; },
    broadcast(type, data = {}) { const msg = JSON.stringify({ type, data }); for (const set of clients.values()) for (const c of set) c.send(msg); },
    on(type, fn) { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); return hub; },
    online: userId => clients.has(userId),
    count: () => clients.size,
    closeAll() { for (const set of clients.values()) for (const c of [...set]) { c.close(1001, "shutdown"); c.socket.destroy(); } },
    /** @param {import("node:http").IncomingMessage} req @param {import("node:net").Socket} socket @param {Buffer} head */
    async upgrade(req, socket, head) {
      try {
        const url = new URL(req.url, "http://x");
        if (url.pathname !== wsPath) return reject(socket, 404, "Not Found");
        let originOk = false; try { originOk = new URL(req.headers.origin || "").host === req.headers.host; } catch { /* missing/invalid */ }
        if (!originOk) return reject(socket, 403, "Forbidden");
        const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(s => s.trim().split("=")).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
        const user = await ctx.services.users.resolve(Object.assign(req, { cookies }));
        if (!user) return reject(socket, 401, "Unauthorized");
        const conn = handshake(req, socket, head, { maxPayload });
        if (!conn) return;
        const set = clients.get(user.id) || new Set(); set.add(conn); clients.set(user.id, set);
        let win = [];
        conn.on("message", async (raw) => {
          const t = Date.now(); win = win.filter(x => t - x < rate[1]); win.push(t);
          if (win.length > rate[0]) return conn.close(1008, "rate");
          let m; try { m = JSON.parse(String(raw)); } catch { return; }
          if (!m || typeof m.t !== "string") return;
          if (m.t === "ping") return conn.send({ type: "pong", data: { at: t } });
          for (const fn of handlers.get(m.t) || []) Promise.resolve().then(() => fn(user, m, conn)).catch(() => { });
        });
        conn.on("close", () => { set.delete(conn); if (!set.size) clients.delete(user.id); });
        conn.send({ type: "hello", data: { user: user.id } });
      } catch { reject(socket, 500, "Error"); }
    }
  };
  rt.send = (userId, type, data = {}) => { sseSend(userId, type, data); hub.send(userId, type, data); };
  rt.broadcast = (type, data = {}) => { for (const uid of rt.clients.keys()) sseSend(uid, type, data); hub.broadcast(type, data); };
  return hub;
}
module.exports = { OP, GUID, acceptKey, encodeFrame, FrameParser, WsConnection, handshake, reject, createHub };
