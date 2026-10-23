# Privacy / data-safety answers (derived from `server/lib/compliance-lib.js` DATA_MAP)

| Data type | Collected | Purpose | Linked to user | Optional | Notes |
|---|---|---|---|---|---|
| Name, username, profile photo, bio | Yes | App functionality | Yes | Photo/bio optional | |
| Email | Optional | Account recovery, notifications | Yes | Yes | |
| Pi username / uid | If you sign in with Pi | Sign-in, payments | Yes | Yes | Server verifies with Pi; no wallet keys |
| User content (posts, comments, media) | Yes | App functionality | Yes | — | |
| Messages | Yes | App functionality | Yes | — | E2EE chats: server stores ciphertext only |
| Purchases (Pi payments) | If used | Payments, legal | Yes | Yes | Kept as financial records |
| Support tickets, waitlist contact, ambassador application | If used (p50) | Support, rollout | Yes | Yes | Waitlist contact deleted after rollout |
| Coarse location (country) | Inferred | Safety, ads targeting by country only | No | — | No precise location |
| Diagnostics (client errors) | Yes | App stability | No | — | 90 days |
| Tracking across apps/sites | **No** | — | — | — | No ad SDKs, no third-party trackers |

Data deletion: in-app (Settings → My data). Export: JSON download. Encryption in transit: yes (HTTPS).
