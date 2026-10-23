# التطوّع والجمعيات والحملات الخيرية الشفافة — Volunteering, charities, transparent campaigns (phase 70, v2.40.0)

Service: `server/services/charity.js` · migration `053_charity` (9 tables) · ledger `CHARITY` journals in `server/lib/ledger.js` · certificates kind `volunteer` (`server/services/certs.js`) · UI chunk `charity-ui.js` + `charity.css` · tests `server/test/charity.test.js`, `tests/e2e/p70.e2e.test.js`.

## Organisations
- `POST /api/charity/orgs` (adults only, one pending at a time): name, kind (charity / association / initiative / team), registry, licence number, country, city, website, email, description → `pending`. Pending / rejected / suspended organisations are visible only to their managers and staff.
- Staff `POST /api/admin/charity/orgs/:id {status: verified|rejected|suspended, reason}` — reason required except for verify; audited; owner notified (`charity_org`). Suspension pauses live campaigns and closes open opportunities.
- Owner adds / removes editors by handle (`POST /api/charity/orgs/:id/members`, adults only). Changing the registry or licence of a verified organisation sends it back to `pending`.

## Volunteering
- Verified organisations publish opportunities (`POST /api/charity/orgs/:id/opportunities`): place or online, start/end, slots, expected hours, skills, `minors` flag. `PUT /api/charity/opportunities/:id` edits or sets `status` open / closed / cancelled (cancel declines open sign-ups and notifies them).
- Members sign up with a note (`POST …/signup`, `{withdraw:true}` to withdraw, re-apply allowed). Managers `POST /api/charity/signups/:id {action: accept|decline|attended|no_show, hours}`; attendance only after the start; `attended` issues a signed certificate (`/cert/<code>`, kind `volunteer`, hours + date + place) and notifies (`vol_hours`).
- `GET /api/charity/me`: confirmed hours, sign-ups with certificate codes, completed donations, own organisations.

## Campaigns + transparency
- Verified organisations write a campaign (title, story ≥ 80 letters, category, beneficiaries, goal in Pi, dates ≤ 180 days) → draft → `PUT {submit:true}` → staff review (`approve` / `reject` with reason) → live. After submission the campaign is not edited; the organisation posts updates instead.
- Staff: `pause` (reason) / `resume` / `end` / `unflag`. Job `charity.tick` (every `CHARITY_TICK_INTERVAL_MS`, 30 min) ends campaigns at their end date.
- Every campaign page shows goal, raised (ledger), donors, **disbursed to the organisation** (each transfer with its Pi txid), **spending reported** by the organisation (amount + receipt link per item; total can't exceed raised), and **disbursed but not yet reported**; news updates; the organisation's registry and licence.
- Reports on a campaign or an organisation (fraud, misleading, unregistered, misuse, other) go to the staff queue; `CHARITY_FLAG_REPORTS` (3) open reports flag a live campaign and stop donations until staff decide.

## Money (off in production)
Pi purpose `charity`. Donation: `user:<id>:pi_out` → `charity:<campaignId>:raised`. Staff disbursement to the organisation's wallet, recorded with the Pi txid (no A2U): raised → `platform:payouts`. Refunded donations are reversed. While `PI_ENABLED` is off, `POST /api/charity/campaigns/:id/donate` and `POST /api/admin/charity/campaigns/:id/disburse` answer **501 `not_configured`**, and every screen says «مدفوعات Pi غير مفعّلة بعد».

## Minors (phase 35)
Read campaigns and organisations; never donate, register or manage an organisation. Volunteer only on opportunities marked for minors and only with an active guardian link; the guardian is notified of every step (`charity_guardian`). Minors' names never appear in public donor lists; their certificates are unlisted.

## Notifications
`vol_signup`, `vol_decision`, `vol_hours`, `charity_update`, `charity_review`, `charity_org`, `charity_guardian`.
