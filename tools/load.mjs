/* Load test (Phase 2): autocannon against a running server with seeded data.
 *   BASE=http://localhost:8080 HANDLE=demo_xxxx_1 node tools/load.mjs
 * Scenarios: public health, authenticated personalised feed, bootstrap, search, posting.
 * A k6 equivalent for CI/cloud runs lives in tools/k6-load.js. */
import autocannon from "autocannon";
const BASE = process.env.BASE || "http://127.0.0.1:8080",
  CONN = +(process.env.CONNECTIONS || 100),
  DUR = +(process.env.DURATION || 10);
async function login(handle) {
  const r = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" },
    body: JSON.stringify({ handle, password: process.env.PASSWORD || "demo1234" })
  });
  if (!r.ok) throw new Error("login failed " + r.status);
  return r.headers.get("set-cookie").split(";")[0];
}
const cookie = await login(process.env.HANDLE);
const run = (title, opts) =>
  new Promise((res, rej) =>
    autocannon({ url: BASE, connections: CONN, duration: DUR, ...opts }, (e, r) =>
      e
        ? rej(e)
        : res({
            title,
            rps: Math.round(r.requests.average),
            p50: r.latency.p50,
            p97_5: r.latency.p97_5,
            p99: r.latency.p99,
            errors: r.errors + r.non2xx,
            total: r.requests.total
          })
    )
  );
const H = { Cookie: cookie, "X-Requested-With": "mujtama", "Content-Type": "application/json" };
const results = [];
results.push(await run("GET /api/health", { requests: [{ method: "GET", path: "/api/health" }] }));
results.push(await run("GET /api/feed (personalised)", { requests: [{ method: "GET", path: "/api/feed?mode=for", headers: H }] }));
results.push(await run("GET /api/feed?mode=following", { requests: [{ method: "GET", path: "/api/feed?mode=following", headers: H }] }));
results.push(await run("GET /api/search?q=برمجة", { requests: [{ method: "GET", path: "/api/search?q=" + encodeURIComponent("برمجة"), headers: H }] }));
console.table(results);
console.log(JSON.stringify({ base: BASE, connections: CONN, durationSec: DUR, results }));
