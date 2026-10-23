# Subscriptions & paid content (phase 38, v2.11.0)

Server: `server/services/paid.js` · migration `server/migrations/021_paid.js` · shared ledger `server/lib/ledger.js` ·
tests `server/test/paid.test.js` (stubbed Pi API + App Studio login, SQLite and PostgreSQL).
Built on the Pi service (`docs/PI.md`, payments) and the tips service (`docs/TIPS.md`: creator opt-in, support tiers,
supporter state, double-entry ledger). This service never calls the Pi API.

## Two kinds of paid post
| mode | who sees the body | how a viewer unlocks |
|---|---|---|
| `supporters` | active supporters of the creator (P37 monthly support) whose paid tier amount ≥ the post's minimum tier amount (no minimum = any tier) | `POST /api/support/intent` (P37) |
| `ppv` | buyers of that post (one-time Pi payment, unlocks forever) | `POST /api/paid/:postId/intent` |

Always entitled: the author, and admins (`role=admin`, for moderation). A PPV purchase keeps working if the creator later
changes the price or the mode. Supporter state: `active` and `due` unlock; a `cancelled` support keeps its perks until
`active_until`; `lapsed` (or a refunded month) locks again. "Higher tier" = higher amount: the minimum follows the tier's
current amount (a retired tier keeps counting with its last amount).

## Protection model (why nothing leaks)
1. **The locked body is never stored in `posts`.** `posts.text` holds only the public teaser; the body (text + rich document)
   lives in `paid_content`. Every code path that reads `posts` directly — search index and SQL search, OG/SSR article pages,
   sitemap, weekly/daily digests, summaries, trends, collections, studio, moderation previews, other users' exports — can only
   ever see the teaser. Hashtags and mentions are taken from the teaser only (a body mention notifies nobody).
2. **Rendering fails closed.** `content.filterVisible` calls `paid.annotate(rows, viewer)`, which records per (row object,
   viewer) whether the viewer is entitled (and loads the body) in a `WeakMap` — never serialised. `content.toClient` calls
   `paid.render`: a paid post without an "entitled" annotation for exactly that viewer is rendered locked.
   Paths that re-read rows (the ranked feed) annotate again (`ranking.js`).
3. **Media**: the media ids of a paid post (images, `media`, cover, video/audio `mediaId`) are listed in `paid_media` and must be the
   creator's own uploads (`paid_media_owner`), not used by another paid post (`paid_media_used`). `/media/<id>…` (every variant:
   HLS playlists/segments, posters, m4a, captions) answers **403 `paid_locked`** to non-entitled viewers (session cookie checked)
   and is served with `Cache-Control: private, no-store` (no `Access-Control-Allow-Origin: *`) to entitled ones, so no CDN or proxy
   keeps a copy. `GET /api/media/:id` (variants incl. audio transcripts) is gated the same way. Collections show no paid thumbnails.
   Media references stay in `posts.data` (the video/audio pipeline updates them in place) but `render` strips them when locked.
4. **Locked rendering** removes: `doc, media (null), images, alts, video, audio, cover, poll (null), stances, translations`, and
   `text` = teaser; `GET /api/posts/:id` returns `history: []` for every paid post (versions only ever hold teasers anyway).
   The translation layer never caches or serves cached translations of a paid post. SSR article pages of paid articles show the
   teaser and no `og:image`. SSE carries no post bodies (only `changed` scopes and notifications, which carry no text).

## Creating and editing
`POST /api/posts` accepts, in addition to the normal fields:
```jsonc
{ "text": "…full body…", "images": ["/media/md_…"],            // as usual; body may also come as doc/markdown (articles)
  "paid": { "mode": "ppv", "price": 2.5, "teaser": "optional" } } // or { "mode": "supporters", "minTierId": "tier_…", "teaser"? }
// alias: "visibility": "supporters"  ⇒ paid.mode = "supporters" (no minimum), stored visibility "public"
```
Rules: creator mode on (`creator_settings.enabled`, P37), adult (minors → 403), types `post | article | video | audio` only, not in a
community, not a repost/poll; PPV price 0.01 – `PAID_MAX_PRICE` (100) Pi, 7 decimals; `supporters` needs ≥ 1 active tier.
Teaser: `paid.teaser` (≤ 500 chars; `""` = none) or automatic: the first `PAID_TEASER_CHARS` (200) characters cut at a word, never more
than 40 % of the body; a body under 40 characters gets no automatic teaser (then `text` shows `🔒` unless there is a title/media).
The response is the full post for the author (`locked:false`). Duplicate check (same author, same body, 24 h) runs on the body.

`PATCH /api/posts/:id` (author):
- `{text}` → the body is replaced (the teaser is recomputed unless it is custom); counts as an **edit** for refunds when the body changed.
- `{paid:{price?|minTierId?|mode?|teaser?}}` → settings change (new price applies to new buyers only).
- `{paid:null}` → back to a normal post: body becomes `posts.text`, media public again, buyers keep nothing extra to lose.
- `{status:"archived"}` on a paid post counts as a change for refunds; `DELETE` → change `deleted`; a moderation removal
  (`CONTENT_REMOVED`, automod/safety/community mods) → change `removed`.
- Making an existing free post paid → 400 `paid_on_create_only` (its body was already public).

## Post shape (every API that returns posts)
Paid posts always carry `paid:{mode, price|null, minTierId|null}` and `teaser`. Then either
```jsonc
{ "locked": false, "text": "…full body…", "doc"?: {…}, "images": [...], … }           // entitled
{ "locked": true, "text": "<teaser>", "teaser": "<teaser>", "media": null, "poll": null,
  "lock": { "mode": "ppv"|"supporters", "price": 2.5|null,
            "minTier": {"id","name","amount"}|null,
            "tiers": [{"id","name","amount","perks"}],   // supporters: the creator's active tiers that unlock it (≥ minimum)
            "purchasable": true|false,                    // ppv: Pi on and not a minor; supporters: a tier exists and not a minor
            "reason": null|"sign_in"|"minor_restricted"|"not_configured",
            "media": {"images": 1, "media": false, "cover": false, "video": false, "audio": false} } } // for blurred placeholders
```
Free posts are unchanged (no `paid`, `locked`, `teaser` keys). `title`, `type`, counts, author, `readingMin` stay visible.

## API (session cookie + `X-Requested-With: mujtama` on non-GET)
- `GET /api/paid/:postId` (public; 404 if the viewer cannot see the post) →
  `{postId, paid:false, unlocked:true}` or `{postId, paid:true, mode, price|null, unlocked, lock|null, purchase:{id,postId,amount,status,createdAt,completedAt,refundedAt}|null}`.
- `POST /api/paid/:postId/intent` → `{intent:{id, amount, memo, metadata:{intentId}}, purchaseId}` (purpose `ppv`, refId = post id).
  Errors: 401; 404 `not_found` (missing / not published / not visible — blocked or age-gated posts are invisible); 400 `not_paid`,
  `own_post`, `not_ppv`; 403 `minor_restricted`, `blocked`; 409 `creator_disabled`, `already_unlocked`, `pi_not_linked`;
  429 `rate_limited`; 501 `not_configured` (Pi payments off — checked first).
  Then the normal Pi flow (`Pi.createPayment(intent)` → `/api/pi/payments/approve` → `/complete`). The post unlocks when the server
  sees the completed payment (show success on `complete` → `receipt.status:"completed"`, then re-fetch the post).
- `GET /api/me/purchases?all=1` → `{items:[{id, postId, amount, status:"completed"|"duplicate"|"refunded"(|"pending"|"cancelled" with all=1),
  createdAt, completedAt, refundedAt, post:{id, title, teaser, type, status, author:{handle,name,avatar}}|null, refundEligible, refundUntil|null,
  refundRequest:{id, purchaseId, postId, kind, reason, status, note, createdAt, decidedAt}|null}]}`.
- `POST /api/paid/purchases/:id/refund-request {reason? ≤500}` → `{request:{id, purchaseId, postId, kind:"edited"|"deleted"|"archived"|"removed", reason, status:"pending", note:null, createdAt, decidedAt:null}}`.
  Errors: 404 (not yours); 409 `refund_pending`, `not_refundable` (not a completed purchase), `refund_not_eligible` (no edit/delete/removal
  after your purchase), `refund_window_passed` (more than `PAID_REFUND_WINDOW_HOURS`=24 h after that change).
- `GET /api/me/paid-posts` (creator) → `{currency:"Pi", feeBps, items:[{postId, title, teaser, type, status, state:"active"|"free", mode, price|null,
  minTier|null, unlocks, revenue, net, refunds, createdAt}]}` (`unlocks` = completed purchases; `revenue` gross of completed + duplicate;
  `net` = revenue − platform fee; refunded purchases are excluded and counted in `refunds`).
- Earnings (P37) `GET /api/me/earnings` → `bySource:{tips, support, ppv}`; CSV rows of kind «محتوى مدفوع»; `topPosts` include PPV posts;
  `topSupporters` include buyers. The public honour roll / wall never show purchases.
- Admin: `GET /api/admin/paid/refunds?status=pending|approved|rejected|all` → `{status, items:[{id, purchaseId, postId, kind, reason, status, note,
  createdAt, decidedAt, amount, intentId, purchase:{id,status,completedAt}, buyer:{id,handle,name}, creator:{id,handle,name}, post:{id,title,status}}]}`;
  `POST /api/admin/paid/refunds/:id/approve {note?, txid?}` → `{ok, id, status:"approved", purchase:{…status:"refunded"}}` (records the refund on the
  Pi transaction through `pi.refund` — the Pi itself is sent back by the operator outside the app, as for every Pi refund; reversing journal;
  access revoked); `POST …/:id/reject {note?}` → `{ok, id, status:"rejected"}`. Repeating the same decision is idempotent; the opposite → 409.
  A staff refund through `POST /api/admin/pi/payments/:intentId/refund` has the same effect (the service listens to `PI_PAYMENT_REFUNDED`).

Response bodies of the decide routes contain a field named `status` — do not spread it over the HTTP status.

## Purchases and the ledger
`paid_purchases`: `pending → completed | cancelled`, `completed → refunded`. A second paid purchase of the same post (two intents both paid)
is stored as `duplicate`: the money is booked, access is unchanged, and an automatic refund request (`kind:"duplicate"`) is queued for staff.
Every effect is a conditional status update plus a journal with a unique idempotency key in one transaction (replays never double-credit):

| journal kind | source | lines (A = price, F = floor(A·CREATOR_FEE_BPS/10000)) | ikey |
|---|---|---|---|
| `ppv` | `ppv` | D `user:B:pi_out` A · C `creator:C:earnings` A−F · C `platform:fees` F | `ppv:<purchase>:credit` |
| `reversal` | `ppv` | swapped lines, `reverses` = original | `rev:<journal>` |

`ref_id` = purchase id, `post_id` = post id. `GET /api/admin/ledger/check` covers these journals. The P37 helpers were moved verbatim to
`server/lib/ledger.js` (`postJournal`, `creditLines`, `reverseAll`, `ACC`, `toUnits`, `pi`) and are used by both services.

## Events & notifications
Bus: `PPV_PURCHASED {purchase, post, creator, buyer, amount}`, `PAID_ACCESS_REVOKED {purchase, post, user, creator, reason:"refund"}`.
Notification kinds: `ppv_purchased` (to the creator, actor = buyer, `post` set → opens the post; groups), `paid_refundable` (to each buyer
when the post changes; `ref` = purchase), `ppv_refunded`, `paid_refund_rejected` (to the buyer) → `/#/purchases`.

## Minors
A minor (minors service band < 18) cannot create paid posts (403 `minor_restricted`), cannot buy (403), never unlocks supporter posts
(P37 already forbids supporting), and sees paid posts locked with `lock.purchasable:false, reason:"minor_restricted"`.
Adult-labelled posts (`labels:["adult"|"graphic"|"gambling"]`, or the legacy sensitive flag) stay hidden from minors by the minors service,
paid or not — a hidden post answers 404, also on the intent route.

## Compliance
Data map: `paid_posts`, `paid_media` (creator, deleted on erasure), `paid_content` (the creator's locked bodies — exported to the creator,
deleted on erasure), `paid_purchases` (buyer, legal, kept; exported), `paid_refund_requests` (buyer, legal, kept; the free-text reason is
cleared on `USER_ANONYMISED`). Ledger rows are kept as for tips.

## Environment
| var | default | meaning |
|---|---|---|
| `PAID_MAX_PRICE` | `100` | max PPV price (Pi); min is 0.01 |
| `PAID_REFUND_WINDOW_HOURS` | `24` | refund request window after an edit / delete / archive / removal |
| `PAID_TEASER_CHARS` | `200` | automatic teaser length (40–1000) |
| `CREATOR_FEE_BPS` | `0` | platform fee (shared with tips) |
`PI_PURPOSES` default now includes `ppv`. Tests inject `config.paidOpts = { env, now }`.

## Known limits
- Paid posts are not available inside communities, for polls/stories/reposts, and existing posts cannot be made paid.
- Entitlement is evaluated per request; a row object cached across requests is re-annotated by every `filterVisible` call, and a viewer
  without a fresh annotation always gets the locked view.
- Only admins bypass the lock (not community moderators or the minors-safety staff role); moderation previews show the teaser.
- Media referenced by a paid post is locked everywhere, including if the creator had already used the same upload in a public post.
- Each `/media/…` request does one indexed lookup in `paid_media`.
- No bundles (optional item 6 skipped).
