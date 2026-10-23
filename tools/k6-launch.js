/* global __ENV, __VU, __ITER */
// Phase 50 launch load test — 10,000 concurrent virtual users (k6). NEVER point this at production.
// Run against a staging copy sized like production (same DB tier, same instance count), from a load generator outside it:
//   k6 run -e BASE=https://staging.example -e HANDLES=load_1,load_2,... -e PASSWORD=... tools/k6-launch.js
// Mix (per VU iteration, ~1 request every 2–4 s per user, i.e. ~3,000 req/s at 10k VUs): health, launch config, help-center search,
// personalised feed, notifications count, post page; 2 % write a comment-sized post. Thresholds fail the run.
import http from "k6/http"; import { check, sleep } from "k6";
export const options = {
  scenarios: { launch: { executor: "ramping-vus", startVUs: 0, stages: [{ duration: "2m", target: 2000 }, { duration: "3m", target: 6000 }, { duration: "3m", target: 10000 }, { duration: "5m", target: 10000 }, { duration: "2m", target: 0 }], gracefulRampDown: "30s" } },
  thresholds: { http_req_failed: ["rate<0.01"], "http_req_duration{name:feed}": ["p(95)<800"], "http_req_duration{name:help}": ["p(95)<300"], "http_req_duration{name:health}": ["p(95)<150"] }
};
const BASE = __ENV.BASE;
if (!BASE || /mujtama|railway\.app|up\.railway/.test(BASE) && !__ENV.I_AM_ON_STAGING) throw new Error("set BASE to a staging host (production-looking hosts need I_AM_ON_STAGING=1)");
const H = { "Content-Type": "application/json", "X-Requested-With": "mujtama" };
export function setup() {
  const handles = (__ENV.HANDLES || "").split(",").filter(Boolean); const cookies = [];
  for (const h of handles.slice(0, 500)) { const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ handle: h, password: __ENV.PASSWORD || "demo1234" }), { headers: H }); if (r.status === 200) cookies.push(r.headers["Set-Cookie"].split(";")[0]); }
  if (!cookies.length) throw new Error("no load accounts could sign in");
  return { cookies };
}
export default function (d) {
  const h = { headers: { ...H, Cookie: d.cookies[__VU % d.cookies.length] } };
  check(http.get(`${BASE}/api/health`, { tags: { name: "health" } }), { ok: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/launch/config`, { ...h, tags: { name: "config" } }), { ok: (r) => r.status === 200 });
  check(http.get(`${BASE}/api/feed?mode=for`, { ...h, tags: { name: "feed" } }), { ok: (r) => r.status === 200 });
  if (Math.random() < 0.3) check(http.get(`${BASE}/api/helpcenter/articles?q=${encodeURIComponent("حساب")}`, { ...h, tags: { name: "help" } }), { ok: (r) => r.status === 200 });
  if (Math.random() < 0.02) http.post(`${BASE}/api/posts`, JSON.stringify({ text: "اختبار حمل " + __VU + "-" + __ITER }), { ...h, tags: { name: "post" } });
  sleep(2 + Math.random() * 2);
}
