/* global MPChunks, MPRoutes, MPMenu, MPPrefs, __ls:writable, __maxW:writable */
/* v2.52 navigation e2e against the real server (production build, 390 px Arabic RTL, touch):
 * tab bar (5 destinations, labels, icons, 44 px targets, active + owner state, aria-current, badges, re-tap → top),
 * top app bar (brand + avatar on tab roots; back button + title on deep screens, title appears once the heading scrolls away),
 * back behaviour (in-app history with scroll restore; a fresh deep link goes to its logical parent with location.replace and never
 * leaves the app), direction-aware transitions, bars hide on scroll down / return on scroll up, edge swipe back (RTL),
 * «المزيد» hub (profile card, shortcuts, categories as keyboard-operable disclosures, search with Arabic normalisation + English
 * aliases, Enter opens the first hit, Escape clears, empty state, Pi tags while Pi is off, admin category for staff only),
 * every registered route is reachable from the hub (or is a content page that needs an id), legacy nav order "me" → "menu",
 * desktop rail secondary links, keyboard shortcut g m, no page errors. */
const test = require("node:test"),
  assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");

let S, ctx, p;
const errors = [];
const until = async (fn, arg, ms = 10000) => p.waitForFunction(fn, arg, { timeout: ms });
const go = async (h) => { await p.evaluate((h) => { location.hash = h; }, h); await until((h) => location.hash === h, h); };
const settle = (pg = p) => pg.waitForFunction(() => !document.querySelector("#view .skel") && document.querySelector("#view")?.textContent.trim().length > 0, null, { timeout: 15000 });
/* content screens that need an id (a post, a person, a community, a job, …): reached from the content itself, not from the hub */
const PARAM = new Set(["c", "u", "post", "topic", "tag", "follows", "chat", "chatinfo", "event", "list", "collection", "sc", "receipt", "support", "cmod", "cappeal", "cset", "chealth", "wiki", "join",
  "safety", "unsubscribe", "reset", "investigation", "inv-user", "org", "invoice", "place", "city", "course", "season", "exam", "attempt", "cert", "mentor", "msession", "campaign",
  "organisation", "opportunity", "job", "application", "contract", "team", "room", "oauth"]);
const CORE = ["home", "explore", "communities", "c", "notifications", "me", "u", "post", "topic", "tag", "follows", "messages", "chat", "library", "settings", "menu"];

test.before(async () => {
  S = await startStack();
  ctx = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await onboard(p, S.base, "nav_admin", "مديرة التنقل"); // first real account → platform admin
});
test.after(async () => { await ctx?.close(); await S?.close(); });

test("tab bar: five labelled destinations, 44 px targets, active + aria-current, owner tab on deep screens, badges, re-tap scrolls to top", async () => {
  await go("#/home"); await settle();
  const nav = await p.evaluate(() => [...document.querySelectorAll(".bottomnav a[data-r]")].filter((a) => a.offsetParent).map((a) => {
    const r = a.getBoundingClientRect(); return { r: a.dataset.r, label: a.querySelector("small").textContent.trim(), aria: a.getAttribute("aria-label"), w: r.width, h: r.height, icons: a.querySelectorAll("svg use").length }; }));
  assert.deepEqual(nav.map((x) => x.r), ["home", "explore", "communities", "notifications", "menu"]);
  assert.deepEqual(nav.map((x) => x.label), ["الرئيسية", "استكشف", "المجتمعات", "الإشعارات", "المزيد"]);
  for (const x of nav) { assert.equal(x.aria, x.label); assert.ok(x.w >= 44 && x.h >= 44, x.r + " target " + x.w + "×" + x.h); assert.equal(x.icons, 2, x.r + " outline + filled icon"); }
  assert.equal(await p.evaluate(() => !!document.querySelector('.bottomnav a[data-r="notifications"] #notifBadge')), true, "notifications badge lives on its tab");
  assert.equal(await p.evaluate(() => !!document.querySelector(".top-actions #msgBadge")), true, "messages badge in the top bar");
  for (const r of ["explore", "communities", "notifications", "menu", "home"]) {
    await p.click(`.bottomnav a[data-r="${r}"]`); await until((r) => location.hash === "#/" + r, r); await settle();
    await until((r) => document.querySelector(".bottomnav a.active")?.dataset.r === r && document.querySelector(".bottomnav a[aria-current=page]")?.dataset.r === r, r);
  }
  // a deep screen keeps the tab it was opened from (owner), without aria-current
  await p.click('.bottomnav a[data-r="menu"]'); await until(() => location.hash === "#/menu"); await p.waitForSelector("#mn-q");
  await p.click('details.mn-cat[data-cat="work"] summary'); await p.click('details.mn-cat[data-cat="work"] a[href="#/jobs"]');
  await until(() => location.hash === "#/jobs"); await settle();
  assert.deepEqual(await p.evaluate(() => { const a = document.querySelector(".bottomnav a.active"); return [a?.dataset.r, a?.classList.contains("owner"), !!document.querySelector(".bottomnav a[aria-current=page]")]; }), ["menu", true, false]);
  // re-tapping the active tab scrolls back to the top
  await go("#/home"); await settle(); await p.evaluate(() => { for (let i = 0; i < 12; i++) document.querySelector("#view .wrap")?.insertAdjacentHTML("beforeend", '<div class="card" style="height:300px" data-pad></div>'); scrollTo(0, 1500); });
  await until(() => scrollY > 1000);
  await p.waitForTimeout(150); await p.evaluate(() => scrollBy(0, -40)); await until(() => !document.body.classList.contains("bars-off")); // a small scroll up brings the bars back
  await p.click('.bottomnav a[data-r="home"]');
  await until(() => scrollY < 5, null, 5000);
});

test("top bar: brand + shortcuts + avatar on tab roots; back + title on deep screens (title shows once the heading scrolls away)", async () => {
  await go("#/home"); await settle();
  const root = await p.evaluate(() => ({ back: getComputedStyle(document.getElementById("tbBack")).display, brand: getComputedStyle(document.querySelector(".topbar .brand")).display, me: document.getElementById("tbMe")?.getAttribute("href"),
    meVisible: !!document.getElementById("tbMe")?.offsetParent, av: document.querySelector("#tbMe .tb-av")?.textContent.trim(), over: document.querySelector(".top-actions").getBoundingClientRect().left }));
  assert.equal(root.back, "none"); assert.notEqual(root.brand, "none"); assert.equal(root.me, "#/me"); assert.ok(root.meVisible); assert.equal(root.av, "م"); assert.ok(root.over >= 0, "top actions fit the bar");
  await p.click("#tbMe"); await until(() => location.hash === "#/me"); await settle();
  assert.equal(await p.evaluate(() => document.getElementById("tbBack").offsetParent !== null), true, "profile is a deep screen with a back button");
  await go("#/jobs"); await settle();
  const deep = await p.evaluate(() => ({ back: !!document.getElementById("tbBack").offsetParent, label: document.getElementById("tbBack").getAttribute("aria-label"), brand: getComputedStyle(document.querySelector(".topbar .brand")).display,
    title: document.getElementById("tbTitle").textContent, titled: document.querySelector(".topbar").classList.contains("titled"), deep: document.body.classList.contains("nav-deep") }));
  assert.ok(deep.back); assert.match(deep.label, /^رجوع/); assert.equal(deep.brand, "none"); assert.equal(deep.title, "الوظائف والعمل الحر"); assert.equal(deep.titled, false); assert.ok(deep.deep);
  await p.evaluate(() => { for (let i = 0; i < 6; i++) document.querySelector("#view .wrap")?.insertAdjacentHTML("beforeend", '<div class="card" style="height:300px" data-pad></div>'); scrollTo(0, 500); });
  await until(() => document.querySelector(".topbar").classList.contains("titled"));
  await p.evaluate(() => scrollTo(0, 0)); await until(() => !document.querySelector(".topbar").classList.contains("titled"));
  // 44 px back button, RTL chevron points to the start side (right)
  const bb = await p.evaluate(() => { const r = document.getElementById("tbBack").getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, tf: getComputedStyle(document.querySelector("#tbBack .ic")).transform }; });
  assert.ok(bb.w >= 44 && bb.h >= 44); assert.ok(bb.right > 340, "back sits at the start (right) in RTL"); assert.match(bb.tf, /^matrix\(-1/);
});

test("back: in-app history restores the scroll position; a fresh deep link goes to its parent with replace and never leaves the app", async () => {
  await go("#/menu"); await p.waitForSelector("#mn-q");
  await p.waitForSelector("#mn-hub[data-full]"); await p.evaluate(() => document.querySelectorAll("details.mn-cat").forEach((d) => { d.open = true; }));
  await p.evaluate(() => scrollTo(0, 1400)); await until(() => scrollY > 1300); await p.waitForTimeout(150);
  const y0 = await p.evaluate(() => scrollY);
  await p.evaluate(() => document.querySelector('#mn-hub a[href="#/courses"]').click()); await until(() => location.hash === "#/courses"); await settle();
  assert.equal(await p.evaluate(() => scrollY), 0, "a new screen starts at the top");
  assert.equal(await p.evaluate(() => document.getElementById("view").dataset.nav), "push");
  await p.click("#tbBack"); await until(() => location.hash === "#/menu"); await p.waitForSelector("#mn-q");
  await until((y) => Math.abs(scrollY - y) < 30, y0, 5000);
  assert.equal(await p.evaluate(() => document.getElementById("view").dataset.nav), "pop");
  // a fresh tab opened straight on a deep screen: back follows the page's own «→ parent» link, replacing the entry
  const q = await ctx.newPage(); q.on("pageerror", (e) => errors.push("q: " + e.message));
  await q.goto(S.base + "/?nosw#/contracts"); await settle(q);
  const len0 = await q.evaluate(() => history.length);
  await q.click("#tbBack"); await q.waitForFunction(() => location.hash === "#/jobs");
  assert.equal(await q.evaluate(() => history.length), len0, "parent replaced the entry: nothing to go back out of the app to");
  await settle(q); await q.click("#tbBack"); await q.waitForFunction(() => location.hash === "#/menu");
  assert.equal(await q.evaluate(() => getComputedStyle(document.getElementById("tbBack")).display), "none", "the hub is a tab root");
  await q.close();
  const q2 = await ctx.newPage(); q2.on("pageerror", (e) => errors.push("q2: " + e.message)); // settings section → settings hub → «المزيد»
  await q2.goto(S.base + "/?nosw#/settings?s=money"); await settle(q2); await q2.click("#tbBack"); await q2.waitForFunction(() => location.hash === "#/settings");
  await settle(q2); await q2.click("#tbBack"); await q2.waitForFunction(() => location.hash === "#/menu");
  await q2.close();
});

test("bars hide while reading down and return on the way up; edge swipe goes back (RTL)", async () => {
  await go("#/home"); await settle();
  await p.evaluate(() => { for (let i = 0; i < 12; i++) document.querySelector("#view .wrap")?.insertAdjacentHTML("beforeend", '<div class="card" style="height:300px" data-pad></div>'); scrollTo(0, 0); });
  for (const y of [200, 420, 700]) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(80); }
  await until(() => document.body.classList.contains("bars-off"));
  assert.ok(await p.evaluate(() => document.querySelector(".bottomnav").getBoundingClientRect().top >= innerHeight - 2), "tab bar slid away");
  await p.evaluate(() => scrollTo(0, 500)); await until(() => !document.body.classList.contains("bars-off"));
  // edge swipe from the right edge (RTL start) towards the content = back
  await go("#/menu"); await p.waitForSelector("#mn-q"); await go("#/courses"); await settle();
  await p.evaluate(() => {
    const W = innerWidth, t = (x) => new Touch({ identifier: 1, target: document.body, clientX: x, clientY: 400 });
    dispatchEvent(new TouchEvent("touchstart", { touches: [t(W - 6)], bubbles: true }));
    for (const x of [W - 40, W - 80, W - 130]) dispatchEvent(new TouchEvent("touchmove", { touches: [t(x)], bubbles: true }));
    dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
  });
  await until(() => location.hash === "#/menu");
});

test("«المزيد» hub: profile card, shortcuts, disclosures by keyboard, search (normalised + aliases), Enter / Escape, empty state, Pi tags, admin for staff", async () => {
  await go("#/menu"); await p.waitForSelector("#mn-q"); await settle();
  const hub = await p.evaluate(() => ({ h2: document.querySelector(".page-head h2").textContent, me: document.querySelector("#mn-me")?.getAttribute("href"), short: [...document.querySelectorAll(".mn-tile")].map((a) => a.getAttribute("href")),
    cats: [...document.querySelectorAll("details.mn-cat")].map((d) => d.dataset.cat), tiles: [...document.querySelectorAll(".mn-tile, details.mn-cat > summary")].map((e) => e.getBoundingClientRect().height) }));
  assert.equal(hub.h2, "المزيد"); assert.equal(hub.me, "#/me");
  assert.deepEqual(hub.short, ["#/messages", "#/library", "#/mjt", "#/events", "#/studio", "#/jobs", "#/courses", "#/settings"]);
  assert.deepEqual(hub.cats, ["you", "connect", "discover", "community", "create", "learn", "work", "money", "safety", "help", "settings", "admin"]);
  assert.ok(hub.tiles.every((h) => h >= 44));
  // keyboard: focus a category, Enter opens it, Enter again closes it
  await p.evaluate(() => sessionStorage.removeItem("mp.menu.open")); await p.reload(); await p.waitForSelector("#mn-q"); await settle();
  await p.focus('details.mn-cat[data-cat="learn"] summary'); await p.keyboard.press("Enter");
  assert.equal(await p.evaluate(() => document.querySelector('details.mn-cat[data-cat="learn"]').open), true);
  assert.ok(await p.evaluate(() => !!document.querySelector('details.mn-cat[data-cat="learn"] a[href="#/courses"]').offsetParent));
  await p.keyboard.press("Enter"); assert.equal(await p.evaluate(() => document.querySelector('details.mn-cat[data-cat="learn"]').open), false);
  // Pi entries carry «غير مفعّل بعد» while Pi payments are off
  await until(() => document.querySelector('#mn-hub a[href="#/wallet"] .mn-tag')?.textContent === "غير مفعّل بعد");
  assert.equal(await p.evaluate(() => !!document.querySelector('#mn-hub a[href="#/mjt"] .mn-tag')), false, "MJT is live, no tag");
  // search: hamza / ta marbuta normalised, English alias, live count
  await p.fill("#mn-q", "محفظه");
  await until(() => !document.getElementById("mn-find").hidden && document.getElementById("mn-hub").hidden);
  const hits = await p.evaluate(() => [...document.querySelectorAll("#mn-find a.li")].map((a) => a.getAttribute("href")));
  assert.ok(hits.includes("#/wallet") && hits.includes("#/settings?s=money"), hits.join());
  assert.match(await p.textContent("#mn-live"), /نتيجة/);
  await p.fill("#mn-q", "dark mode"); await until(() => document.querySelector("#mn-find a.li")?.getAttribute("href") === "#/settings/appearance");
  await p.fill("#mn-q", "الاختبارات"); await until(() => document.querySelector("#mn-find a.li")?.getAttribute("href") === "#/exams");
  await p.press("#mn-q", "Enter"); await until(() => location.hash === "#/exams"); await settle();
  await go("#/menu"); await p.waitForSelector("#mn-q");
  assert.equal(await p.inputValue("#mn-q"), "الاختبارات", "the query survives a round trip");
  await p.press("#mn-q", "Escape"); await until(() => document.getElementById("mn-find").hidden && !document.getElementById("mn-hub").hidden);
  await p.fill("#mn-q", "zzqqxx"); await until(() => /لا نتائج في القائمة/.test(document.getElementById("mn-find").textContent));
  await p.fill("#mn-q", "");
  // recently visited entries
  assert.ok(await p.evaluate(() => [...document.querySelectorAll("#mn-hub .list a.li")].slice(0, 4).some((a) => a.getAttribute("href") === "#/exams")));
  // a regular member does not see the admin category
  const c2 = await S.browser.newContext({ ...MOBILE, reducedMotion: "reduce" }); const m = await c2.newPage(); m.on("pageerror", (e) => errors.push("m: " + e.message));
  await onboard(m, S.base, "nav_member", "عضو عادي");
  await m.evaluate(() => { location.hash = "#/menu"; }); await m.waitForSelector("#mn-q");
  assert.equal(await m.evaluate(() => !!document.querySelector('details.mn-cat[data-cat="admin"]')), false);
  await m.fill("#mn-q", "لوحة الإدارة"); await m.waitForFunction(() => /لا نتائج/.test(document.getElementById("mn-find").textContent));
  await c2.close();
});

test("smooth: real-motion tab switches and push/pop never widen the page or shift layout; reduced motion turns the entrance off", async () => {
  const c = await S.browser.newContext({ ...MOBILE, reducedMotion: "no-preference" }); const m = await c.newPage(); m.on("pageerror", (e) => errors.push("motion: " + e.message));
  await m.goto(S.base + "/?nosw"); await m.fill("#a-handle", "nav_admin"); await m.fill("#a-pass", "secret1234"); await m.click("#a-go"); await m.waitForSelector(".bottomnav a[data-r=home]");
  await m.evaluate(() => { window.__ls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) __ls += e.value; }).observe({ type: "layout-shift" });
    window.__maxW = 0; const f = () => { __maxW = Math.max(__maxW, document.documentElement.scrollWidth); requestAnimationFrame(f); }; f(); });
  for (const [sel, h] of [['.bottomnav a[data-r="explore"]', "#/explore"], ['.bottomnav a[data-r="communities"]', "#/communities"], ['.bottomnav a[data-r="notifications"]', "#/notifications"], ['.bottomnav a[data-r="menu"]', "#/menu"], ['.bottomnav a[data-r="home"]', "#/home"]]) {
    await m.click(sel); await m.waitForFunction((h) => location.hash === h, h); await m.waitForTimeout(450);
  }
  for (const h of ["#/settings", "#/jobs", "#/post/x", "#/courses"]) { await m.evaluate((h) => { location.hash = h; }, h); await m.waitForTimeout(450); await m.evaluate(() => history.back()); await m.waitForTimeout(450); }
  const r = await m.evaluate(() => ({ w: __maxW, cls: __ls, anim: getComputedStyle(document.documentElement).getPropertyValue("--nav-dx").trim() }));
  assert.ok(r.w <= 390, "page width during transitions " + r.w); assert.equal(r.cls, 0, "layout shift " + r.cls); assert.equal(r.anim, "-18px");
  await c.close();
  // reduced motion (the main context): the entrance animation is effectively instant
  await go("#/settings"); await go("#/jobs");
  const d = await p.evaluate(() => { const x = document.querySelector("#view > *"); return x ? parseFloat(getComputedStyle(x).animationDuration) : 0; });
  assert.ok(d <= 0.001, "animation " + d + "s under prefers-reduced-motion");
});

test("every registered route is reachable from the hub (or is a content page that needs an id); hub entries are real routes", async () => {
  await go("#/menu"); await p.waitForSelector("#mn-hub[data-full]");
  const r = await p.evaluate(async () => {
    for (const n of Object.keys(window.__CHUNKS || {})) { try { await MPChunks.load(n); } catch { /* optional */ } }
    return { keys: Object.keys(MPRoutes.table("", "")), hub: MPMenu.items().map((x) => x.r), aliases: MPMenu.aliases(), hrefs: [...document.querySelectorAll("#mn-hub a[href^='#/']")].map((a) => a.getAttribute("href")) };
  });
  const keys = [...new Set([...CORE, ...r.keys])];
  const reach = new Set(["home", "menu", ...r.hub.map((h) => h.split("?")[0].split("/")[0]), ...Object.keys(r.aliases)]);
  const missing = keys.filter((k) => !PARAM.has(k) && !reach.has(k));
  assert.deepEqual(missing, [], "routes with no way in from the hub");
  for (const h of r.hub) { const top = h.split("?")[0].split("/")[0]; assert.ok(keys.includes(top), "hub entry " + h + " is a registered route"); }
  for (const h of r.hub) assert.ok(r.hrefs.includes("#/" + h), "#/" + h + " is a link in the hub page");
  assert.ok(r.hub.length >= 140, "hub size " + r.hub.length);
  assert.equal(new Set(r.hub).size, r.hub.length, "each entry once");
});

test("legacy nav order with «me» reads as «menu»; g m opens the hub; desktop rail has messages + profile; no page errors", async () => {
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem("mp.prefs") || "{}"); s.v = { ...(s.v || {}), nav: ["me", "home", "explore", "communities", "notifications"] }; localStorage.setItem("mp.prefs", JSON.stringify(s)); });
  await p.reload(); await p.waitForSelector(".bottomnav a[data-r=home]");
  await until(() => window.MPPrefs && MPPrefs.get().nav.join() === "menu,home,explore,communities,notifications");
  await p.evaluate(() => MPPrefs.set("nav", ["home", "explore", "communities", "notifications", "menu"]));
  await go("#/home"); await settle(); await p.evaluate(() => document.activeElement?.blur()); /* v2.139: the page centre may now be a challenge step button, so no click */ await p.keyboard.press("g"); await p.keyboard.press("m"); await until(() => location.hash === "#/menu");
  const d = await S.browser.newContext({ ...DESKTOP, reducedMotion: "reduce" }); const w = await d.newPage(); w.on("pageerror", (e) => errors.push("w: " + e.message));
  await w.goto(S.base + "/?nosw"); await w.fill("#a-handle", "nav_admin"); await w.fill("#a-pass", "secret1234"); await w.click("#a-go"); await w.waitForSelector(".bottomnav a[data-r=home]");
  const rail = await w.evaluate(() => [...document.querySelectorAll(".bottomnav a, .bottomnav button")].filter((a) => a.offsetParent).sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top).map((a) => a.dataset.r || a.dataset.side || a.className));
  assert.deepEqual(rail.slice(0, 1), ["side-brand"]); // brand first, «المزيد» after the personal links, then «منشور جديد»
  assert.deepEqual(rail.slice(1, 9), ["home", "explore", "communities", "notifications", "messages", "me", "menu", "btn block side-compose"]);
  await w.click('.bottomnav a[data-side="messages"]'); await w.waitForFunction(() => location.hash === "#/messages" && document.querySelector('.bottomnav a[data-side="messages"]').classList.contains("active"));
  await d.close();
  assert.deepEqual(errors, []);
});
