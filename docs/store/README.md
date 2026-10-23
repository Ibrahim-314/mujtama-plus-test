# Store & listing materials — مجتمع بلس (phase 50)

Text-only kit (no screenshots are committed; see `ASSETS.md` for the shots to capture). Files:
- `listing-ar.md`: Arabic store listing (primary)
- `listing-en.md`: English store listing
- `pi-app-directory.md`: Pi Browser / Pi App Directory submission fields
- `ASSETS.md`: icon/feature-graphic/screenshot specs + the exact screens and states to capture
- `privacy-labels.md`: data-safety / privacy-nutrition answers derived from `server/lib/compliance-lib.js` DATA_MAP

Landing page: in-app `#/about` (also opened by the path `/about`; works signed-out), plus static `public/about.html`
(copied to the dist root as `/about.html`; no JS, CSP-safe) for crawlers and store "website" fields.
Support URL: `/#/faq` (help center) · Privacy: `/#/legal` · Contact: in-app ticket (`/#/tickets/new`).
