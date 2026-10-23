// k6 scenario (Phase 2): ramp to 1,000 virtual users browsing the feed; thresholds fail the run.
//   k6 run -e BASE=https://staging.example -e HANDLE=demo_xxxx_1 tools/k6-load.js
import http from "k6/http"; import { check, sleep } from "k6";
export const options = {
  stages: [{ duration: "1m", target: 200 }, { duration: "3m", target: 1000 }, { duration: "1m", target: 0 }],
  thresholds: { http_req_failed: ["rate<0.01"], "http_req_duration{name:feed}": ["p(95)<400"], "http_req_duration{name:health}": ["p(95)<100"] }
};
const BASE = __ENV.BASE;
export function setup() { const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ handle: __ENV.HANDLE, password: __ENV.PASSWORD || "demo1234" }), { headers: { "Content-Type": "application/json", "X-Requested-With": "mujtama" } }); return { cookie: r.headers["Set-Cookie"].split(";")[0] }; }
export default function (d) {
  const h = { headers: { Cookie: d.cookie, "X-Requested-With": "mujtama" } };
  check(http.get(`${BASE}/api/health`, { tags: { name: "health" } }), { ok: r => r.status === 200 });
  check(http.get(`${BASE}/api/feed?mode=for`, { ...h, tags: { name: "feed" } }), { ok: r => r.status === 200 });
  sleep(1 + Math.random() * 2);
}
