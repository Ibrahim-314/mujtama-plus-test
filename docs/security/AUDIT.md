# Security audit — phase 50 (launch readiness)

**Status:** internal automated audit done. **External penetration test: PENDING** (cannot be bought from this environment;
no vendor, budget or contract exists). Do not describe the app as "externally audited" until it has been done.

## What ran (local only, never production)
`node tools/security-audit.mjs --json docs/security/audit-latest.json` boots an in-memory server on 127.0.0.1 and runs:

| Check | Result (2026-10-16, base v2.15.0 + p50) |
|---|---|
| `npm audit --omit=dev` (root) | 0 vulnerabilities |
| `npm audit` (server/) | not run: server/ has no lockfile (ENOLOCK). Gap, see below |
| CSP on HTML + API | present; scripts `'self'` + Pi SDK + sha256 hashes only; no `unsafe-eval`; `object-src 'none'`, `base-uri 'self'`, `frame-ancestors` set |
| nosniff / Referrer-Policy / Permissions-Policy | present |
| Session cookie | HttpOnly; SameSite=Lax (dev) / None+Secure (production, needed for Pi Browser frames) |
| CSRF | every state-changing route without `X-Requested-With: mujtama` is refused (except documented beacon / Pi-token routes) |
| Authz probe | 589 API routes × (anonymous, ordinary user against another user's ids, no CSRF header), 1,497 requests |

### Findings and fixes
| Sev | Finding | Status |
|---|---|---|
| HIGH | `POST /api/auth/passkey` and `POST /api/security/passkeys` returned **500** on malformed `clientDataJSON` (JSON.parse threw outside the try) | **Fixed** in `server/services/security.js` (`takeChallenge` → 400 `bad_request`) |
| HIGH (tool) | First probe run lost the probe user's session at `POST /api/auth/sign-out-all`, which masked every later authenticated probe | Fixed in the tool (skip session-ending routes, re-login + retry). Re-run: 0 high |
| LOW | No `Strict-Transport-Security` from the app | Accepted: TLS ends at the Railway edge. Check HSTS at the edge before launch (`curl -I https://<prod>`). Adding it in-app is a 1-line change to `SEC_HEADERS` behind `NODE_ENV=production` |
| LOW | CSP `style-src 'unsafe-inline'` | Accepted: lazy chunks inject `<style>`. Scripts stay hash/self-only |
| INFO | 501 `not_configured` on Pi/e-mail webhook routes when not configured | Expected |

After the fixes: **0 high · 0 medium · 3 low**. Raw output: `docs/security/audit-latest.json`.

## Known limits of this audit (hand these to the external testers)
- The probe fills path params with sample ids and sends empty bodies. It catches crashes, missing auth, admin routes open to users, and missing CSRF checks. It does **not** do business-logic abuse (payments, escrow, refunds), race conditions, IDOR with valid bodies on every route, or fuzzing.
- WebSocket (`/ws`) and SSE (`/api/stream`) were not probed beyond the connection.
- server/ dependencies have no lockfile, so `npm audit` cannot run there. Generate one (`npm i --package-lock-only` in server/) and audit before launch.
- Ticket attachments use the existing public-by-unguessable-name `/media/*` URLs. They are not access-controlled per ticket. Warn users not to attach IDs or documents (the UI says so).
- No DAST against a deployed staging host (OWASP ZAP baseline etc.). This should be part of the external test.

## External pen-test: what to buy (pending)
Scope: web app + REST API + WebSocket on a staging copy; Pi payment flows (approve/complete/cancel, webhooks, reconciliation);
marketplace escrow + disputes; paid content gating; E2EE key handling; minors' protections; admin/staff panels; rate limits;
file upload (magic bytes, image processing). Deliverable: report with CVSS + retest. Track it in ROADMAP Phase 50 item 1.

See also `docs/security/OWASP-CHECKLIST.md`.
