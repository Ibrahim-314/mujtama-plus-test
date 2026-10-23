# Store assets — specs and shot list (no binaries committed)

## Graphics
- App icon: 512×512 PNG (Pi / Play) and 1024×1024 (App Store), no transparency on iOS, crescent 🌙 mark on brand accent. Source: theme tokens in `theme.css`.
- Feature graphic: 1024×500 PNG, Arabic tagline «مجتمعات عربية على Pi Network», RTL layout.
- Screenshots: phone 1080×2340 (portrait) ×6–8, Arabic UI, light and dark. Optional 7" tablet 1200×1920 ×2.

## Shot list (capture from a seeded staging build: `SEED_DEMO=1`, Arabic, light theme unless noted)
1. Home feed «لك», with a community post and a reaction bar
2. Community page (header, rules tab visible)
3. Post safety menu 🛡 open (mute / block / report)
4. Messages: E2EE chat with the lock indicator
5. Pi tip sheet (Pi window mocked on staging; never show real wallet data)
6. Marketplace listing with the escrow explanation
7. Help center `#/faq` with search results (phase 50)
8. Dark mode: profile with the ambassador badge 🎖 (phase 50)

Rules: demo accounts only, no real names or faces, no real Pi amounts or wallet addresses, status bar cleaned.
Automate with the existing Playwright shot scripts (`tools/shots-*.js`) when a staging URL exists.
