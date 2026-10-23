/* Test helpers for realtime transports: a minimal WebSocket client built on lib/ws.js's own codec
 * (client frames are masked, server frames must be unmasked) and an SSE reader for /api/stream. */
const http = require("node:http");
const crypto = require("node:crypto");
const { encodeFrame, FrameParser, OP, acceptKey } = require("../lib/ws");

function waiter(list) {
  const pending = new Set();
  return {
    push(x) { list.push(x); for (const p of [...pending]) if (p.pred(x)) { pending.delete(p); clearTimeout(p.t); p.res(x); } },
    wait(pred, ms = 3000, label = "event") {
      const hit = list.find(pred); if (hit) return Promise.resolve(hit);
      return new Promise((res, rej) => { const p = { pred, res }; p.t = setTimeout(() => { pending.delete(p); rej(new Error("timeout waiting for " + label + "; got " + JSON.stringify(list.slice(-5)).slice(0, 600))); }, ms); pending.add(p); });
    }
  };
}

/** open a WebSocket to base+path. Resolves { status, ws? }. ws: { msgs, wait(pred), send(obj), sendRaw(buf), close(), closed:Promise<{code}> } */
function wsConnect(base, { cookie = "", origin = base, path = "/api/ws", key = crypto.randomBytes(16).toString("base64"), headers = {} } = {}) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: "GET", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key, ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    req.on("response", (res) => { res.resume(); resolve({ status: res.statusCode }); });
    req.on("error", reject);
    req.on("upgrade", (res, socket, head) => {
      const msgs = [], w = waiter(msgs);
      let closeRes; const closed = new Promise(r => (closeRes = r));
      const parser = new FrameParser({
        requireMask: false, maxPayload: 4 << 20,
        onMessage: (op, data) => { const s = data.toString("utf8"); let m; try { m = JSON.parse(s); } catch { m = { raw: s }; } w.push(m); },
        onControl: (op, data) => { if (op === OP.PING) socket.write(encodeFrame(OP.PONG, data, { mask: true })); else if (op === OP.CLOSE) { closeRes({ code: data.length >= 2 ? data.readUInt16BE(0) : 1005, reason: data.subarray(2).toString() }); socket.end(); } else if (op === OP.PONG) w.push({ type: "__pong", data: data.toString() }); },
        onError: (code, reason) => closeRes({ code, reason, parseError: true })
      });
      socket.on("data", d => parser.push(d));
      socket.on("close", () => closeRes({ code: 1006 }));
      socket.on("error", () => { });
      if (head?.length) parser.push(head);
      resolve({
        status: res.statusCode, accept: res.headers["sec-websocket-accept"], expectedAccept: acceptKey(key),
        ws: {
          msgs, wait: w.wait, closed, socket,
          send(obj) { socket.write(encodeFrame(OP.TEXT, JSON.stringify(obj), { mask: true })); },
          sendRaw(buf) { socket.write(buf); },
          close() { try { socket.write(encodeFrame(OP.CLOSE, Buffer.from([0x03, 0xe8]), { mask: true })); } catch { /* gone */ } setTimeout(() => socket.destroy(), 50); }
        }
      });
    });
    req.end();
  });
}

/** subscribe to the SSE fallback stream. Resolves { events, wait(pred), close() } once headers arrive */
async function sseConnect(base, cookie) {
  const ac = new AbortController();
  const r = await fetch(base + "/api/stream", { headers: { Cookie: cookie, Accept: "text/event-stream", "X-Requested-With": "mujtama" }, signal: ac.signal });
  const events = [], w = waiter(events);
  (async () => {
    const dec = new TextDecoder(); let buf = "";
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (ev) w.push({ type: ev, data: data ? JSON.parse(data) : null });
        }
      }
    } catch { /* aborted */ }
  })();
  return { status: r.status, contentType: r.headers.get("content-type"), events, wait: w.wait, close: () => ac.abort() };
}
module.exports = { wsConnect, sseConnect };
