# الإرشاد — Mentorship

Phase 74 (v2.37.0) + mentorship track M1/M2 (Unreleased). Source of truth: `server/services/mentors.js` (service + routes),
`server/migrations/051_mentors.js`, `server/migrations/067_mentor_profile_ext.js`, UI chunk `mentor-ui.js` + `mentor.css`
(lazy "mentor" chunk, 0 bytes in core). Free; no external service, no keys.

UI routes (`mentor-ui.js`):

| Route | Who | What |
|---|---|---|
| `#/mentors[?tab=find\|sessions\|requests\|family]` | everyone / signed-in | directory + «اقترح لي مرشداً», my sessions (+ calendar feed), my requests, guardian-linked minors' sessions |
| `#/mentor/:handle` | per visibility | mentor profile page: rating, topics, slot picker + booking, direct request, reviews |
| `#/msession/:id` | the two sides, guardian, staff | one session: time in my zone, actions, live room, notes, rating, `.ics` |
| `#/mentoring[?tab=sessions\|requests\|profile\|availability]` | mentor | dashboard: confirm, requests (direct + open), profile, weekly grid |
| `#/admin/mentors` | staff (`role = admin`) | totals, refund-due sessions, low-rated mentors, suspend / restore |

## 1. Mentor profile fields

Saved with `PUT /api/mentor/me`. Adults only: a minor gets 403 `minor_restricted` and nothing is stored. A suspended profile cannot be saved (403 with the staff reason).

Base columns (migration 051): `headline`, `bio`, `topics` (≤ 5 keys from the fixed `TOPICS` list), `languages`, `minutes` (30/45/60/90), `price` (Pi, 0 = free), `allow_minors`, `tz` (the mentor's time zone), `open` (open / paused), `status` (`active` | `suspended`, staff only) + `status_reason`. Weekly availability: `PUT /api/mentor/me/slots` (`mentor_slots`: weekday, start/end minute, wall time in `tz`).

Extended columns (migration 067), validated strictly server-side; unknown keys are dropped, `null` resets to defaults, an omitted key keeps the stored value; a corrupt stored value is ignored at read time (defaults applied, never a 500):

| `extra` key | Rule (400 code) |
|---|---|
| `approach` | text ≤ 600 (`invalid_approach`) |
| `city` | text ≤ 60 (`invalid_city`) |
| `years` | integer 0–60 or null (`invalid_years`) |
| `skills[]` | ≤ 10, each 1–40 chars, de-duplicated (`invalid_skills`) |
| `experience[]` | ≤ 8 of `{title* ≤80, org ≤80, from* year, to year ≥ from}`; years 1950…current (`invalid_experience`) |
| `qualifications[]` | ≤ 8 of `{name* ≤100, issuer ≤80, year, link}`; `link` must be `https://`, no user/password, ≤ 300 (`invalid_link` / `invalid_qualifications`) |

Age is never stored on the profile: it is whole years computed from `age_profiles.birth_date` at read time, and the birth date itself is never sent.

`GET /api/mentor/me` returns the profile with defaults resolved plus `profileMeta { visibility, fieldLevels, fieldDefaults }`, slots, counters (`toConfirm`, `requests`), and `piEnabled`.

## 2. Visibility

### Page visibility (`mentor_profiles.visibility`)

| Value | Who may open `#/mentor/:handle` (+ `/slots`) | Listed in directory / match |
|---|---|---|
| `public` (default; existing mentors keep it) | everyone, guests included | yes |
| `members` | signed-in users | only for signed-in viewers |
| `hidden` | owner, staff, the mentor's mentees, and active guardians of those mentees | never |

Anyone not allowed gets **404 with the same body as "no profile"** (no existence leak). Any other value is 400 `invalid_visibility` (including `mentees`).

### Field levels (`mentor_profiles.fields`)

Each field is `public` (whoever sees the page) | `mentees` (owner, staff, mentees) | `off` (nobody on the page; the owner still edits it in `/api/mentor/me`). Defaults (`FIELD_DEFAULTS`):

| Field | Default | When not visible |
|---|---|---|
| `photo` | public | `user.avatar` is `null` |
| `age` | off (opt-in) | `age` absent |
| `city` | off | `city` absent |
| `experience` | public | `experience` and `years` absent |
| `qualifications` | public | `qualifications` absent |
| `communities` | off | (setting stored and reported in `shown`) |
| `stats` | public | `rating` + `sessions` absent; `distribution` is `null` |
| `contact` | public | `contact: false` and booking is refused (see §4) |

A hidden field is **absent** from the JSON, never null-filled (except the avatar). `approach` and `skills` are always sent. The response carries `shown` (the visible field keys); `visibility` and `fields` are returned only to the owner and staff.

### Contact levels

The `contact` field is the contact level: `public` = everyone who can see the page may book / contact; `mentees` = only existing mentees; `off` = nobody. It is enforced server-side in `bookBlock` (book is refused) and mirrored in the page's `me.canBook` / `me.why`.

## 3. Viewer relations

`viewerRel(viewer, profile)` returns, in this order:

1. `owner` — the mentor themself.
2. `staff` — `role = admin` (unaffected by blocks or visibility).
3. **blocked** — a block in either direction (`prefs.blocked` or `user_blocks`) → `null` → 404 on page and slots, 403 on book.
4. `guest` — not signed in.
5. `mentee` — has a `pending` / `confirmed` / `completed` session with the mentor, or an `accepted` request.
6. `guardian` — (only evaluated for `hidden` pages) an active `guardian_links` guardian of a mentee.
7. `member` — any other signed-in user.

Then: `members` + guest → `null`; `hidden` + anything but mentee/guardian → `null`. A suspended or non-active profile keeps the older rule: owner and staff only (404 for everyone else). Field level `mentees` passes for owner, staff and mentee (not guardian).

## 4. Booking rules (`bookBlock`)

`POST /api/mentors/:handle/book {startsAt, topic?, note?, requestId?}` (rate limited). `bookBlock` returns the first reason that applies (Arabic message), else `null`:

1. Booking yourself.
2. Profile not `active` or not `open` → «المرشد لا يستقبل جلسات حالياً».
3. Blocked pair.
4. No viewer relation (hidden / members-only page the viewer cannot see).
5. Contact level not passed (`off` or `mentees`).
6. Minor learner: mentor must have `allow_minors`, price must be 0, and the minor must have an active guardian link.
7. Priced mentor while Pi payments are off.

Result: Pi off + priced + adult → 501 `not_configured`; any other reason → 403 (`minor_restricted` for a minor, else `not_bookable`).

Then: `startsAt` must be one of `freeSlots()` (14-day horizon, `MENTOR_NOTICE_HOURS` notice (default 12), sessions of the mentor **and** the learner excluded) else 409; at most 3 upcoming sessions per learner–mentor pair; `topic` must be one of the mentor's topics (else the first). A linked accepted request is closed. Guardians of a minor get `mentor_guardian` notifications.

Requests: a learner asks one mentor directly or posts an open request (seen by mentors of that topic); max 5 open per learner, one open direct request per mentor; mentor accepts (with reply) or declines; learner may withdraw.

## 5. Session lifecycle

Statuses (`STATUSES`): `pending` «بانتظار التأكيد» → `confirmed` «مؤكدة» → `completed` «مكتملة» | `no_show` «لم يحضر المتعلّم»; `cancelled` «ملغاة» from pending/confirmed.

Actions (`actionsOf`, any other call → 409):

| Action | Who | When |
|---|---|---|
| `confirm`, `decline` | mentor | `pending`, pay status `none` / `held` |
| `cancel` (reason ≥ 3 chars required) | mentor or learner | `pending` / `confirmed`, before the end |
| `complete` | mentor | `confirmed`, from the start time |
| `no_show` | mentor | `confirmed`, 10 min after the start |
| `join` | mentor, learner, guardian | `confirmed`, from 10 min before to 30 min after the end; the mentor opens the private room (no follower ping); others only once it exists; not when a block exists between the sides (or guardian↔mentor) |
| `feedback` | mentor or learner | `completed`, once, within 30 days |
| `pay` | learner | `pending` with pay status `pending` (Pi on only) |

Job (`tick`, every `MENTOR_TICK_INTERVAL_MS`, default 5 min): one reminder 1 h before a confirmed session; a `pending` session still unconfirmed at its start is cancelled («انتهى الموعد قبل تأكيد المرشد»).

Rooms: `rooms.js` asks `roomAccess()` on every join/view — only the two sides and an active guardian of a minor learner; these rooms are hidden from `/api/rooms`. Notes: one per side, cancelled sessions refuse notes; a note can be shared with the other side (never with the guardian). Feedback: learner rating 1–5 required, mentor comment required and private to its author; minors' reviews show as «متعلّم». Calendar: per-session `.ics` and a private revocable feed `/mentor-feed/<token>.ics`.

## 6. Payments and refunds (Pi — off in production)

`pay_status`: `none` (free) → `pending` (intent created at booking) → `held` (`PI_PAYMENT_COMPLETED`, escrow into `platform:held`) → `released` (on `complete` / `no_show`, to the mentor minus `tips.config.feeBps`, default 500 bps). A failed payment cancels the pending session («لم يكتمل الدفع»). Cancelling a **held** session reverses the escrow journal and sets `refund_due`; a cancelled `pending` intent goes back to `none`. Staff see `refund_due` sessions at `#/admin/mentors` and refund through the Pi refund flow; `PI_PAYMENT_REFUNDED` sets `refunded`. If payment completes after the session was cancelled, it is unwound to `refund_due` immediately. While Pi is off, priced mentors are not bookable; free mentoring works.

## 7. Admin moderation — `#/admin/mentors`

`GET /api/admin/mentors` (staff): totals (active, open, suspended mentors, upcoming / completed sessions, open requests, minor sessions), up to 200 mentors (suspended first), `lowRated` (≥ 3 ratings and average < 3), `refunds` (`refund_due` sessions with `intentId`), `piEnabled`.
`POST /api/admin/mentors/:uid/status {status: active|suspended, reason}` — reason required (≥ 3) to suspend. Suspending cancels every upcoming pending/confirmed session («أوقف فريق المنصة ملف المرشد»), unwinds payments, notifies learners (+ guardians of minors), closes open requests, and audits `mentor_suspended` / `mentor_restored`. The UI route renders only for `role = admin`.

## 8. Migration 067 — `067_mentor_profile_ext`

Additive only. Adds to `mentor_profiles`: `visibility TEXT NOT NULL DEFAULT 'public'`, `fields` (JSON, NULL = defaults), `extra` (JSON), `reviewed_at` (timestamp, reserved for M5 «ملف مراجَع من الفريق»; not yet read by the service); and index `mentor_feedback_about_rating (about_user, rating)`. No backfill, no CHECK constraint (enums are checked in the service). Guarded ALTERs make a re-run a no-op; `down()` drops the index and the four columns, restoring the v2.61 schema exactly with rows kept.

## 9. API and auth

Auth legend: **open** = visitors allowed (`req.user` may be null); **auth** = signed in, visitors 401; **staff** = admin only. Sessions resolve the caller's role (mentor / learner / guardian via active link); a stranger gets 404, staff get role `staff`.

| Method & path | Auth | Notes |
|---|---|---|
| GET `/api/mentors` | open | directory; filters; hidden never listed, members-only for signed-in; blocked users filtered |
| GET `/api/mentors/match` | auth | top 3 with reasons |
| GET `/api/mentors/:handle` | open | profile page per §2–3 (404 when not allowed) |
| GET `/api/mentors/:handle/slots` | open | free slots (404 when not allowed) |
| POST `/api/mentors/:handle/book` | auth | §4 |
| GET / PUT / DELETE `/api/mentor/me` | auth | own profile |
| PUT `/api/mentor/me/slots` | auth | weekly grid |
| GET / POST `/api/mentor/requests` | auth | sent / received / open; create |
| POST `/api/mentor/requests/:id/accept\|decline\|withdraw` | auth | mentor decides / learner withdraws |
| GET `/api/mentor/sessions[?role=family]` | auth | my sessions; `family` = guardian-linked minors (no notes) |
| GET / POST / DELETE `/api/mentor/feed` | auth | get, rotate, revoke the calendar feed token |
| GET `/mentor-feed/<token>.ics` | token | private feed, 404 on unknown token, `noindex` |
| GET `/api/mentor-sessions/:id` | auth | session view (party / staff) |
| GET `/api/mentor-sessions/:id/ics` | auth | one `.ics` |
| POST `/api/mentor-sessions/:id/confirm\|decline\|cancel\|complete\|no-show\|join\|pay` | auth | §5 |
| PUT `/api/mentor-sessions/:id/note` | auth | mentor or learner only |
| POST `/api/mentor-sessions/:id/feedback` | auth | §5 |
| GET `/api/admin/mentors` | staff | §7 |
| POST `/api/admin/mentors/:uid/status` | staff | §7 |

## 10. Tests

API (`npm run test:api`): `server/test/mentors.test.js` (time zones, profile, directory/match, requests, booking → room → rating, minors, Pi escrow / refund_due, job, staff suspend, M1-1 auth audit, migration 051) · `mentor-profile-migration.test.js` (067 columns/index/defaults, re-run no-op, down/up, additive check) · `mentor-profile-save.test.js` (defaults, visibility / fields / extra validation, corrupt values) · `mentor-profile-view.test.js` (field levels per relation, members / hidden, blocked, suspended, contact gate on book) · `mentors-minors-m1.test.js` (minor profile/booking limits, note & feedback privacy, room + block) · `mentors-perf.test.js` (batched minor lookup, no N+1).
E2E (`npm run test:e2e`): `tests/e2e/p74.e2e.test.js` (full flow + admin, axe dark) · `mentor-ui-m1.e2e.test.js` (390 light AR, 360, 1440 dark EN: axe, overflow, 44px, `dir=auto`) · `mentor-i18n-rest.e2e.test.js` (en/fr/ur for `#/msession` and `#/admin/mentors`).

## Env

`MENTOR_NOTICE_HOURS` (default 12) · `MENTOR_TICK_INTERVAL_MS` (default 300000).
