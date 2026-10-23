/* v2.68: malformed %-escapes in the path or a cookie must never take the process down (regression for audit C1/C2). */
const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { boot } = require("./helpers");

const raw = (base, path, headers = {}) => new Promise((res, rej) => {
  const u = new URL(base);
  const r = http.request({ host: u.hostname, port: u.port, path, method: "GET", headers }, (s) => { s.resume(); s.on("end", () => res(s.statusCode)); });
  r.on("error", rej); r.end();
});

test("malformed path and cookie escapes answer 4xx and the server keeps serving", async () => {
  const { app, base } = await boot();
  try {
    for (const p of ["/api/profiles/%E0%A4%A", "/api/posts/%E0%A4%A/comments", "/u/%E0%A4%A", "/%E0%A4%A"]) {
      const s = await raw(base, p);
      assert.ok(s < 500, `${p} -> ${s}`);
      await new Promise((r) => setTimeout(r, 30)); // let the response 'close' listeners (metrics) run
    }
    const c = await raw(base, "/api/health", { Cookie: "sid=%E0%A4%A; other=%ZZ" });
    assert.ok(c < 500, "malformed cookie -> " + c);
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(await raw(base, "/api/health"), 200, "server still up after malformed requests");
  } finally { await app.close(); }
});
