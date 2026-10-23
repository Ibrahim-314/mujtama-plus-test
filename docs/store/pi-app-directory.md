# Pi App Directory / Pi Browser submission

| Field | Value |
|---|---|
| App name | مجتمع بلس (Mujtama+) |
| Category | Social |
| One-line pitch | منصة اجتماعية عربية: مجتمعات وحوار محترم ودعم صناع المحتوى بعملة Pi |
| Pi features used | Pi sign-in (`Pi.authenticate`, username scope), U2A payments (tips, monthly support, paid posts, marketplace escrow, AI plan), receipts + server-side reconciliation |
| Validation file | `public/pi-app-validation.txt` (served at the dist root, no trailing whitespace; enforced by the build) |
| Website / landing | `/about.html` (static) · in-app `/#/about` |
| Support | in-app help center `/#/faq` and tickets `/#/tickets/new` |
| Privacy policy / terms | `/#/legal` |
| Sandbox → mainnet checklist | Pi keys only in env/secrets. `PI_ENABLED=1`. Run payment reconciliation. Check incomplete-payment recovery in the Pi Browser |
| Rollout lever | `LAUNCH_MODE=invite` (waitlist + invite codes, ambassador codes) → `open` |
