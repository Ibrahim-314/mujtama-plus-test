# المكتبة المعرفية المفتوحة — Open knowledge library (phase 75, v2.41.0)

Service: `server/services/openlib.js` · migration `055_knowledge` (5 tables) · UI chunk `knowledge-ui.js` + `knowledge.css` (articles rendered by the shared `richtext.js`) · tests `server/test/openlib.test.js`, `tests/e2e/p75.e2e.test.js`.

## Contributing
- `POST /api/knowledge` — any signed-in member: title, summary, body (lightweight Markdown, 200–60,000 characters, parsed and sanitised by RichText), category (11), up to 8 tags, up to 12 source links (http/https only), licence `cc-by-sa-4.0` | `cc-by-4.0` | `cc0`, and `agree: true` (own work or properly attributed, published under the licence). At most 10 pending contributions per member.
- `POST /api/knowledge/articles/:id/edits` — propose an edit on the current version (`base` = current revision number; otherwise 409 `stale`), with an edit note. One pending edit per member per article. Edits inherit the article's licence.
- `POST /api/knowledge/revisions/:id/withdraw` — the author withdraws a pending version (a never-published article is archived).

## Review
- Trusted reviewers are granted by staff (`POST /api/admin/knowledge/reviewers {handle, remove}`, adults only, notified `kb_reviewer`). Staff are reviewers too.
- `GET /api/knowledge/review` — pending versions (new / edit, stale flag, minor flag) and open reports.
- `POST /api/knowledge/revisions/:id/approve` | `/reject {reason}` — reviewers cannot approve their own pending version; approving a version written on an older revision is refused (409 `stale`). The first approved version publishes the article. Reviewers' and staff's own new articles and edits are approved directly (never minors').
- `POST /api/knowledge/articles/:id/revert {n}` — reviewers restore any approved version as a new version (nothing is deleted; audited).
- Notifications: `kb_decision` (author), `kb_edited` (article creator when someone else's edit is approved), `kb_reviewer`.

## History, search, feedback
- `GET /api/knowledge/articles/:id/history`, `GET /api/knowledge/revisions/:id` (full content + line diff against the previous / base version; pending versions only for their author and reviewers).
- `GET /api/knowledge?q=&category=&tag=&sort=recent|popular|helpful&page=` — Arabic-normalised search (title ×5, tags ×3, summary ×2, body ×1), category counts, popular tags, totals.
- Article page: table of contents, sources, licence with attribution (contributors), «هل كانت مفيدة؟» votes (`POST …/vote {vote: 1|-1|0}`), related articles, view counts.

## Moderation
- `POST /api/knowledge/articles/:id/report {reason, note}` (inaccurate, copyright, harmful, spam, other; one per member) → review queue; `KB_FLAG_REPORTS` (3) open reports flag the article (banner, hidden from minors) until reviewers close the reports (`POST /api/knowledge/reports/:id {action}`).
- Staff `POST /api/admin/knowledge/articles/:id {action: hide|restore|archive|sensitive|unsensitive|unflag, reason}` — hide/archive need a reason; all audited. `GET /api/admin/knowledge` — totals, reviewers, moderated articles.

## Minors (phase 35)
Read published articles that are not adults-only (`sensitive`) and not flagged; may contribute, always through review; shown as «مساهم يافع» (no name or handle) in public history and contributor lists; cannot be reviewers.

## Data
Articles and approved versions stay published under their open licence when an account is deleted (`erase: keep` — pseudonymous id only); votes, reports and reviewer roles are deleted.
