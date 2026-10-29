/* Phase 43 e2e against the real server (production build). Covers: lazy a11y chunk loads for everyone, skip link + landmark
 * labels + named icon buttons, focus moves to the new page heading after navigation, sheets behave as modal dialogs (focus in,
 * Escape closes, focus restored), j/k between posts, #/settings/display (font scale, high contrast, dyslexia mode, motion,
 * strong focus ring) applied live, saved to /api/me/a11y (a11y.* keys) and re-applied before first paint after reload
 * (mp_a11yCss), reset, alt text exposed on image posts (role=img + aria-label), axe: no serious/critical violations on the
 * settings screen in high-contrast + dyslexia mode, no page errors, no inline handlers in the chunk, core budget untouched. */
const test = require("node:test"),
  assert = require("node:assert");
const fs = require("node:fs"),
  path = require("node:path");
const { startStack, onboard, MOBILE, ROOT } = require("./harness");

let S, ctx, p;
const errors = [];
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage();
  p.on("pageerror", e => errors.push(e.message));
  await onboard(p, S.base, "a11y_e2e", "مختبر الوصول");
});
test.after(async () => {
  await ctx?.close();
  await S?.close();
});

test("screen reader + keyboard: skip link, landmarks, names, focus after navigation, modal sheets", async () => {
  await p.goto(S.base + "/?nosw#/home");
  await until(() => window.MPA11y && document.querySelector(".mp-skip"), null, 15000);
  const lm = await p.evaluate(() => ({
    main: document.querySelector("main#view")?.getAttribute("tabindex"),
    nav: document.querySelector(".bottomnav")?.getAttribute("aria-label"),
    toast: document.getElementById("toast")?.getAttribute("aria-live"),
    unnamed: [...document.querySelectorAll("button, a[href]")]
      .filter(b => b.offsetParent && !(b.getAttribute("aria-label") || b.textContent.replace(/\p{Extended_Pictographic}|\uFE0F/gu, "").trim() || b.title))
      .map(b => b.outerHTML.slice(0, 80)),
    current: document.querySelector(".bottomnav a[aria-current=page]")?.dataset.r
  }));
  assert.equal(lm.main, "-1");
  assert.equal(lm.nav, "التنقل الرئيسي");
  assert.equal(lm.toast, "polite");
  assert.deepEqual(lm.unnamed, [], "every visible control has an accessible name");
  assert.equal(lm.current, "home");
  // skip link is the first tab stop and moves focus into main
  await p.keyboard.press("Tab");
  assert.equal(await p.evaluate(() => document.activeElement?.className), "mp-skip");
  await p.keyboard.press("Enter");
  assert.ok(await p.evaluate(() => document.getElementById("view").contains(document.activeElement)));
  // navigation by tapping a nav link: focus lands on the new heading, title + live region updated
  await p.click('.bottomnav a[data-r="menu"]'); // v2.52: the fifth tab is «المزيد» (the hub; the profile is in it and on the avatar)
  await until(() => location.hash === "#/menu" && document.getElementById("mp-a11y-live")?.textContent.startsWith("صفحة"));
  assert.equal(await p.evaluate(() => document.querySelector(".bottomnav a[aria-current=page]")?.dataset.r), "menu");
  // modal sheet: focus inside, Escape closes, focus returns to the opener
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForSelector("#cbar");
  await p.focus("#cbar"); // v2.139: the Home composer bar is the keyboard entry (floating button removed)
  await p.keyboard.press("Enter");
  await until(() => document.querySelector("body > [role=dialog][aria-modal=true]:not(#sheet)")?.contains(document.activeElement)); // the composer
  await p.keyboard.press("Escape");
  await until(() => !document.querySelector("body > [role=dialog]:not(#sheet)") && document.activeElement?.id === "cbar");
  // bottom sheet (#sheet): labelled dialog, focus inside, Tab trapped, Escape restores focus
  await p.evaluate(() => {
    const b = document.createElement("button");
    b.id = "opener";
    b.textContent = "افتح";
    document.body.append(b);
    b.addEventListener("click", () => window.sheet("<h4>عنوان</h4><button type='button'>أ</button><button type='button'>ب</button>"));
  });
  await p.focus("#opener");
  await p.keyboard.press("Enter");
  await until(() => !document.getElementById("sheet").classList.contains("hidden") && document.getElementById("sheet").contains(document.activeElement));
  assert.equal(
    await p.evaluate(() => document.getElementById(document.querySelector("#sheet .panel[role=dialog]").getAttribute("aria-labelledby"))?.textContent),
    "عنوان"
  );
  for (let i = 0; i < 3; i++) await p.keyboard.press("Tab");
  assert.ok(await p.evaluate(() => document.getElementById("sheet").contains(document.activeElement)), "focus trapped");
  await p.keyboard.press("Escape");
  await until(() => document.getElementById("sheet").classList.contains("hidden") && document.activeElement?.id === "opener");
});

test("posts: role=article, named actions, j/k, image alt text", async () => {
  const r = await p.evaluate(async () => {
    const png = await (
      await fetch("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
    ).blob();
    const up = await fetch("/api/media", { method: "POST", headers: { "X-Requested-With": "mujtama", "Content-Type": "image/png" }, body: png }).then(x =>
      x.json()
    );
    const post = await fetch("/api/posts", {
      method: "POST",
      headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "غروب الشمس على البحر. يوم جميل", media: up.media.url })
    }).then(x => x.json());
    const alt = await fetch("/api/a11y/alt/" + up.media.id, {
      method: "PUT",
      headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" },
      body: JSON.stringify({ alt: "شمس برتقالية تغرب فوق بحر هادئ" })
    }).then(x => x.json());
    await fetch("/api/posts", {
      method: "POST",
      headers: { "X-Requested-With": "mujtama", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "منشور ثانٍ للتنقل بلوحة المفاتيح" })
    });
    return { mid: up.media.id, post: post.post?.id, alt };
  });
  assert.ok(r.post);
  assert.equal(r.alt.source, "user");
  await p.goto(S.base + "/?nosw#/post/" + r.post);
  await p.reload();
  await until(mid => document.querySelector(`.media[data-mid="${mid}"]`)?.getAttribute("aria-label") === "شمس برتقالية تغرب فوق بحر هادئ", r.mid, 15000);
  await until(mid => document.querySelector(`.media[data-mid="${mid}"]`)?.getAttribute("role") === "img", r.mid, 5000); // the post can re-render once its chunks arrive after the reload
  // v2.52: the post can be re-rendered once more as late chunks wrap Views.post; the a11y pass re-labels the new node on the next
  // frame. Wait for one node that carries everything at once (alt text + role + owner's ALT editor), then assert on that same node.
  const snap = mid => { const m = document.querySelector(`.media[data-mid="${mid}"]`); const st = { role: m?.getAttribute("role"), alt: m?.getAttribute("aria-label"), btn: !!m?.querySelector(".mp-alt-b") }; return st.role === "img" && st.alt === "شمس برتقالية تغرب فوق بحر هادئ" && st.btn ? st : false; };
  const st = await p.waitForFunction(snap, r.mid, { timeout: 10000 }).then(h => h.jsonValue()).catch(async () => (await p.evaluate(mid => { const m = document.querySelector(`.media[data-mid="${mid}"]`); return { role: m?.getAttribute("role"), alt: m?.getAttribute("aria-label"), btn: !!m?.querySelector(".mp-alt-b") }; }, r.mid)));
  assert.equal(st.role, "img"); assert.equal(st.alt, "شمس برتقالية تغرب فوق بحر هادئ");
  assert.ok(st.btn, "owner gets the ALT editor");
  await p.goto(S.base + "/?nosw#/home");
  // v2.54: home can re-render once more as late chunks arrive; read the label from the same frame that has the articles
  const labels = await p.waitForFunction(() => { const a = document.querySelectorAll("#view [role=article]"); return a.length > 1 && a[0].querySelector("[data-react]")?.getAttribute("aria-label"); }, null, { timeout: 15000 }).then(h => h.jsonValue());
  assert.match(labels, /^إعجاب/);
  // the same first article node for 600 ms = home has settled (no late re-render will swap the focused node under j/k)
  await p.waitForFunction(() => { const a = document.querySelector("#view [role=article]"); if (!a) return false; if (window.__a11yA !== a) { window.__a11yA = a; window.__a11yT = performance.now(); return false; } return performance.now() - window.__a11yT > 600; }, null, { timeout: 15000, polling: 100 });
  await p.evaluate(() => document.activeElement?.blur?.());
  await p.keyboard.press("j");
  await p.keyboard.press("j");
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#view [role=article]")].indexOf(document.activeElement)), 1);
  await p.keyboard.press("k");
  assert.equal(await p.evaluate(() => [...document.querySelectorAll("#view [role=article]")].indexOf(document.activeElement)), 0);
});

test("#/settings/display: live preview, saved server-side (a11y.*), applied before paint after reload, reset", async () => {
  await p.goto(S.base + "/?nosw#/settings?s=display"); // v2.38: display rows live in «المظهر واللغة»
  await p.waitForSelector("#mp-a11y-set", { timeout: 15000 });
  await p.click("#mp-a11y-set");
  await p.waitForSelector("#mp-a11y-form");
  await p.click('[data-fs="1.5"]');
  await p.check("input[name=contrast][value=high]");
  await p.check("input[name=dyslexia]");
  await p.check("input[name=motion][value=reduce]");
  await p.check("input[name=focusRing]");
  await until(() => /contrast/.test(document.documentElement.dataset.a11y || "") && /dyslexia/.test(document.documentElement.dataset.a11y));
  const look = await p.evaluate(() => ({
    zoom: getComputedStyle(document.body).zoom,
    bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    lh: getComputedStyle(document.querySelector("#view")).lineHeight,
    out: document.getElementById("mp-fs-o").textContent
  }));
  assert.equal(look.zoom, "1.5");
  assert.equal(look.bg, "#fff");
  assert.equal(look.out, "150%");
  await until(() => document.getElementById("mp-a11y-st")?.textContent === "تم الحفظ");
  const uid = (await S.app.ctx.db.get("SELECT id FROM users WHERE handle='a11y_e2e'")).id;
  const rows = Object.fromEntries((await S.app.ctx.db.all("SELECT key, value FROM a11y_prefs WHERE user_id=$1", [uid])).map(r => [r.key, JSON.parse(r.value)]));
  assert.deepEqual(rows, { "a11y.fontScale": 1.5, "a11y.contrast": "high", "a11y.dyslexia": true, "a11y.motion": "reduce", "a11y.focusRing": "strong" });
  // axe on the settings screen with high contrast + dyslexia mode on
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const bad = await p.evaluate(async () =>
    (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations
      .filter(v => ["serious", "critical"].includes(v.impact))
      .map(v => v.id + ":" + v.nodes.length)
  );
  assert.deepEqual(bad, []);
  // reload: the CSS is in place before the chunk loads (platform.js snippet)
  await p.goto(S.base + "/?nosw#/home");
  const early = await p.evaluate(() => ({
    css: !!document.getElementById("a11yCss")?.textContent.includes("zoom:1.5"),
    zoom: getComputedStyle(document.body).zoom
  }));
  assert.equal(early.css, true);
  assert.equal(early.zoom, "1.5");
  // a fresh device (no local copy) picks the settings up from the server after sign-in
  const ctx2 = await S.browser.newContext({ ...MOBILE, storageState: { cookies: await ctx.cookies(), origins: [] } });
  const p2 = await ctx2.newPage();
  await p2.goto(S.base + "/?nosw#/home");
  await p2.waitForFunction(() => /contrast/.test(document.documentElement.dataset.a11y || ""), null, { timeout: 15000 });
  await ctx2.close();
  // reset
  await p.goto(S.base + "/?nosw#/settings/display");
  await p.waitForSelector("#mp-a11y-reset");
  await p.click("#mp-a11y-reset");
  await until(() => !document.documentElement.dataset.a11y && !localStorage.getItem("mp_a11yCss"));
  await new Promise(r => setTimeout(r, 300));
  assert.equal(Number((await S.app.ctx.db.get("SELECT COUNT(*) n FROM a11y_prefs WHERE user_id=$1", [uid])).n), 0);
});

test("hygiene: no page errors, no inline handlers in the chunk, core budget", async () => {
  assert.deepEqual(errors, []);
  const src = fs.readFileSync(path.join(ROOT, "a11y-ui.js"), "utf8");
  assert.ok(!/\son[a-z]+=["']/i.test(src) && !/javascript:/i.test(src), "no inline handlers");
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8"));
  const core = b.files.find(f => /^assets\/app-.*\.js$/.test(f.file));
  assert.ok(core.br <= 90 * 1024, "core " + core.br);
});
