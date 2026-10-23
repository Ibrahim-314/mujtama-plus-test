# المحرر — Composer architecture (v2.50)

Two editors, one core. Before v2.50 the app had **two separate editors** that users saw one after the other: the
full-screen v3 editor (post / article / audio / story, `content-ui.js`) and the older bottom-sheet v2 editor (`v12.js`,
itself overriding a v1 editor in `app.js`) that opened for poll, question, discussion, event, thread, video, quotes and
offline — including from the «⋯» button *inside* the v3 editor, which closed it and opened the old sheet with its own type
tabs. Posting in a community wrapped the creative editor again (`community-ui.js`) and hijacked the API client; editing a
post used `prompt()`. v2.50 replaces all of that.

## Files

| File | Chunk | Role |
|---|---|---|
| `app.js` (core) | — | `openComposer(init)` / `window.MPComposer(init)`: the only entry point. Loads the `composer` chunk on first use (it is also prefetched on idle) and calls `MPEditor.open(init)`. Defines `window.MPComposerHooks`. |
| `composer-core.js` | `composercore` | Pure logic, no DOM (unit-tested in `tests/unit/composer-core.test.js`): `resolveMode`, `normalize` (every entry shape, legacy drafts included), `validate`, `plan` (requests for `POST /api/posts`, `POST /api/events` first for events, a numbered series for threads), `toLocal` (offline post through `Cmd.createPost`), `draftData` (synced draft payload). |
| `composer-ui.js` | `composer` | One shell `#composer3` (close · title · saved state · publish) with three front-ends. Loaded after `composercore` (chunks.js). |
| `composer.css` | `composer` | Shell + both editors, tokens only. |

## Modes

`resolveMode(init)`: explicit `init.mode` → `init.edit` → **community** when `init.community` is set and the type is one the
simple editor knows (post / poll / question) and it is not a quote → otherwise **general**.

- **community** (simple): community card (name, «يراجع المشرفون…» when approval is required and the author is not a
  moderator), optional channel select and tag chips (from the community page), big text area, images, poll or question
  toggles, community rules, publish («إرسال للمراجعة» when it will be queued). Sends `community`, `channel`, `ctag` only —
  no topic / schedule / audience. The server keeps enforcing who can post, links / media, automod and approval.
- **general** (creative): type picker (post, article, poll, question, discussion, thread, event, video, audio, story),
  formatting toolbar + write / preview (side-by-side live preview ≥ 1100px), images (10, drag to reorder, alt text, paste,
  drop), @mentions, spelling / hashtag assistant (`/api/compose/assist`) and the AI assistant button
  (`textarea[data-mp-assist]`), «خيارات النشر» (audience, list, topic, place, schedule + best time, article series,
  sensitive flag, save as template), drafts and templates pickers. Quotes open here with the type picker hidden.
- **edit**: own post text only (`Cmd.editPost` → synced `PATCH`), simple layout.

## Entry points

| Where | Call | Mode |
|---|---|---|
| FAB, home bar, «منشور جديد», `data-ui=compose` | `openComposer()` | general |
| Community page «اكتب في …» | `openComposer({community, channel, channels, tags, role, icon})` | community |
| Quote | `openComposer({quoteOf})` | general (quote) |
| Post menu «تعديل» (app.js and v12.js menus) | `openComposer({edit, text})` | edit |
| #/drafts «متابعة», drafts sheet | `openComposer({draftId, data})` | the draft's own mode (`data.x.mode`) |
| Story ring, explore prompt, topic page, events «حدث», studio calendar / templates, PWA share target | `openComposer({type / text / topic / data})` | general |

## Drafts

Autosave 1.5 s after a change (`PUT /api/drafts/:id`, conflict check across devices); closing with content saves and says
«حُفظت كمسودة». v2.50 adds a whitelisted `x` object to the draft JSON (mode, community, channel, tag, topic, place,
sensitive, list, quote, poll, stances, thread parts, event) so a draft reopens in the same editor — additive, no migration.
Offline drafts stay in the local `DB.drafts`.

## Extending the editor

Other chunks push a hook instead of observing the DOM or wrapping `Remote.api`:

```js
(window.MPComposerHooks = window.MPComposerHooks || []).push({
  id: "paid", modes: ["general"],
  mount(cx) { cx.slot("options").append(…) },   // slots: "content", "options"
  onType(type, cx) { … },                         // type changed
  check(cx) { return "error" | null },            // before publishing (blocks with a message)
  apply(body, cx) { body.paid = … }               // the main POST /api/posts body
});
```

Used by `paid-ui.js` («الوصول»: free / supporters / pay-per-view; disabled while Pi payments are off) and `minors-ui.js`
(content labels → `labels`). A hook registered after the editor opened is mounted into it.
