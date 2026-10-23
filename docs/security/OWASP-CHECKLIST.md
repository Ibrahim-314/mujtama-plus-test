# OWASP Top 10 (2021) + ASVS-lite checklist — phase 50

Legend: ✅ in place (with where) · ⚠️ partial / needs action · ⏳ pending the external test

| # | Risk | Status | Evidence / action |
|---|---|---|---|
| A01 | Broken access control | ✅⏳ | `requireUser` on every user route. Admin/staff routes check the role (probe: 0 open to ordinary users). Owner-scoped reads return 404, not 403 (tickets, DMs, receipts). Org "act as" is audited. ⏳ IDOR with valid bodies everywhere |
| A02 | Cryptographic failures | ✅ | scrypt password hashes. Sessions stored as a token hash. TOTP + WebAuthn. E2EE keys stay on the client. Secrets come from env/files (`lib/secrets.js`) only. ⚠️ HSTS at the edge (see AUDIT.md) |
| A03 | Injection | ✅ | Parameterised SQL everywhere (`$1…`). LIKE input escaped in search/help. HTML escaped on the client (`esc`/`h`). No `eval`. CSP blocks inline script |
| A04 | Insecure design | ⚠️ | Threat-model notes live in docs/*.md per feature. Abuse limits: RateLimiter + adaptive limits, open-ticket cap (10), invite-code caps. ⏳ external review of payment/escrow logic |
| A05 | Security misconfiguration | ✅ | CSP, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors restricted to Pi. Error bodies never include stacks (500 → generic Arabic message + requestId) |
| A06 | Vulnerable components | ⚠️ | root `npm audit --omit=dev`: 0. server/ has no lockfile → add it and audit. Dependabot/Renovate not configured |
| A07 | Identification & auth failures | ✅ | Login/register rate limits. 2FA (TOTP/passkey). "Sign out everywhere". Session listing. Pi token verified server-side only. Passkey malformed-input 500 fixed in p50 |
| A08 | Software & data integrity | ✅ | Pi payments reconciled server-side. Hash-chained audit log. Double-entry ledger. Hashed build assets + SW versioning |
| A09 | Logging & monitoring failures | ✅ | Structured logs with requestId. Audit log for sensitive actions. Client error beacon. (Phase 49 adds observability) |
| A10 | SSRF | ✅⏳ | Server-side fetches go only to configured hosts (Pi API, translation/LLM providers, SMTP from env). `lib/linkscan.js` classifies URLs without fetching them. ⏳ external verification of any URL-fetching path |
| — | CSRF | ✅ | Custom header required on all state changes. SameSite cookies |
| — | File upload | ✅ | Magic-byte validation, size caps, image re-encode, malware/CSAM hooks (`lib/imgscan.js`) |
| — | Privacy (PDPL/GDPR) | ✅ | Data map covers every user table, including p50's tickets/ambassadors/waitlist. Export + erasure (`lib/compliance-lib.js`) |

Re-run the automated part on every release: `node tools/security-audit.mjs` (exits 1 on any HIGH).
