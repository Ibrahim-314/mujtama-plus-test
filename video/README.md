# مجتمع بلس — Video architecture (`video/`)

Videos are the heart of the app. Since **v2.73** every piece of video code lives here, one file per job, so a new video
feature is a new file — never an edit inside someone else's loop.

```
video/
  player/            core bundle (always loaded) — the player every surface shares
    sources.js       MPVideoSources.pick(variants) → ordered sources + "use hls.js?"   (pure, unit-tested)
    player.js        MPPlayer.mount / destroy / hlsJs / use(plugin)                      (HLS → MP4 720 → 360 → original)
    resume.js        MPResume — «تابع المشاهدة», registered as an MPPlayer plugin
    qoe.js           MPQoE — startup / stalls / watch time → POST /api/video/qoe        (lazy chunk "qoe")
  clips/             lazy chunk "clips" — the full-screen «لقطات» screen (#/clips, #/shorts)
    core.js          feed paging, ≤3 live players, preload, watch + view beacons, window.Clips API
    snap.js          one-clip navigation (keys, wheel), desktop backdrop
    tabs.js          «لك» | «المتابَعون» + ?start=<id>  (sets Clips.ext feed policies)
    overlay.js       creator info over each clip
    scrub.js         progress scrubber, tap / long-press gestures
    rail.js          side action rail (like, comments, save, share, support — Pi «غير مفعّل بعد»)
    comments.js      comments sheet over the clip
    pages.js         sound / hashtag pages, series chip
    boot.js          LAST file: renders when the app opened straight on #/clips (development)
    *.css            one stylesheet per feature (core.css first)
```

## How the files ship

`index.html` lists every file. Tags that share a `data-chunk` name are **concatenated in index.html order into one hashed
file** by `tools/build.mjs` (`chunk-clips-*.js` / `chunk-clips-*.css`), so splitting costs nothing at runtime. Core files
(`video/player/*.js`, no `data-chunk`) go into the main bundle right before `content-ui.js`.

## Adding a video feature

**A clips feature** (e.g. duet, stitch, chapters overlay):

1. Create `video/clips/<feature>.js`:
   ```js
   (function ClipsFeature() {
     const { ic, api, online, fmtDur } = Clips.util;   // shared helpers
     Clips.onSection((sec, post) => { /* decorate each clip */ });
     Clips.onCurrent((sec, index, post) => { /* the clip on screen changed */ });
     Clips.onView(() => { /* new visit */ });
     Clips.onLeave(() => { /* clean up listeners */ });
   })();
   ```
2. Optional `video/clips/<feature>.css`.
3. Add both to `index.html` **before** `video/clips/boot.js` with `data-chunk="clips"`.
4. Add `tests/e2e/clips-<feature>-vXYZ.e2e.test.js`, English strings in `i18n-enplus.js`.

**A player feature** that every video gets (feed, post page, clips) — e.g. chapters, quality menu, analytics:

```js
MPPlayer.use(({ video, box, post, opts, flash }) => { /* runs on every mount, before autoplay */ });
```

Put it in `video/player/<feature>.js` (core) or in a lazy chunk if it is heavy. A plugin that throws is logged and
skipped, so it can never break playback.

## Rules (all releases)

- Never remove or hide a feature; Pi features stay «غير مفعّل بعد».
- Arabic + English only; RTL/LTR, light/dark, 390 and 1440 px, axe clean.
- Class names: clips features use `cl-*` / `clp-*`; avoid bare `.cl-grid` / `.cl-tile` (used by calls-ui.js).
- Inside the full-screen viewer the bottom nav is hidden (`body.shorts-mode`, v2.72).
- Keep the core loop (`core.js`) small: features talk to it only through `Clips.on*`, `Clips.api`, `Clips.util`, `Clips.ext`.
