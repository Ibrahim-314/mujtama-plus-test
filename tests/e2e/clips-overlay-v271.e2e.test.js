/* v2.71 — «لقطات» info overlay: avatar + name (<bdi>) + verified mark, Follow (hidden on own clips, flips in place via the
 * app-wide [data-follow] handler), caption clamped to 2 lines with «المزيد/أقل» (aria-expanded), hashtags → #/tag/…,
 * «الصوت:» line (original sound by the author when the post has none), bottom gradient, inline-end column kept free for the
 * action rail, 44px targets, keyboard, axe 0 serious/critical at 390 light / 1440 dark / 390 LTR.
 * OV_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { ensureBuild, startStack, onboard, meId, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.OV_SHOTS;
let S, author;
const LONG = "هذه لقطة طويلة جداً عن رحلة التصوير في جبال عسير مع الأصدقاء، شاهدوا كيف تغيّر الضوء عند الغروب وكيف بدت الغيوم فوق القمم الخضراء في نهاية اليوم #سفر #تصوير";
test.before(async () => {
  ensureBuild(); S = await startStack();
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage(); // a second real account = the clip author
  await onboard(p, S.base, "clips_ov_author", "سارة المصوّرة");
  author = await meId(p);
  await c.close();
});
test.after(async () => { await S.close(); });
const seed = (p, a) => p.evaluate(({ a, LONG }) => {
  let u = DB.users.find(x => x.id === a); if (!u) DB.users.push(u = { id: a, name: "سارة المصوّرة", handle: "clips_ov_author", color: "#5b2bd6", topics: [] });
  u.badge = "صانعة محتوى"; // a verified creator
  const v = (i) => ({ short: true, duration: 12, variants: { "360p": "/media/none-ov-" + i + ".mp4", poster: "" } });
  DB.posts.push({ id: "clipov_0", author: a, type: "video", status: "published", visibility: "public", text: LONG, createdAt: new Date().toISOString(), media: "#2a3b55", video: v(0) });
  DB.posts.push({ id: "clipov_1", author: a, type: "video", status: "published", visibility: "public", text: "قصيرة #لقطات", sound: { title: "أغنية الصباح", author: "فرقة الجبل" }, createdAt: new Date(Date.now() - 60e3).toISOString(), media: "#f2f2f2", video: v(1) });
  DB.posts.push({ id: "clipov_2", author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطتي", createdAt: new Date(Date.now() - 120e3).toISOString(), media: "#334", video: v(2) });
}, { a, LONG });
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
const open = async (p) => { await p.evaluate(() => { location.hash = "#/clips"; }); await p.waitForSelector('.short[data-short="clipov_0"] .cl-ov-name'); await p.waitForTimeout(400); };
const sec = (id) => `.short[data-short="${id}"]`;
const show = async (p, id) => { await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "start" }), sec(id)); await p.waitForTimeout(450); };
/* geometry: overlay above the nav, inside the clip, clear of the action rail, every control ≥44px, no horizontal overflow */
const geo = async (p, id) => {
  await show(p, id);
  const r = await p.evaluate((s) => {
    const el = document.querySelector(s), b = (x) => x.getBoundingClientRect();
    const info = b(el.querySelector(".short-info")), act = b(el.querySelector(".short-actions")), nav = b(document.querySelector(".bottomnav")), clip = b(el);
    const hit = (a, c) => a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
    const small = [...el.querySelectorAll(".cl-ov a:not([tabindex='-1']), .cl-ov button:not([hidden])")].filter(x => x.offsetParent && !x.closest(".cl-ov-cap")).map(x => ({ c: x.className, ...JSON.parse(JSON.stringify(b(x))) })).filter(x => x.height < 44 || x.width < 44);
    const grad = getComputedStyle(el, "::after").backgroundImage;
    return { railHit: hit(info, act), navHit: hit(info, nav), inside: info.top >= clip.top - 1 && info.bottom <= clip.bottom + 1, small, grad, ox: document.documentElement.scrollWidth > innerWidth, color: getComputedStyle(el.querySelector(".cl-ov-name")).color };
  }, sec(id));
  assert.ok(!r.railHit, "overlay overlaps the action rail"); assert.ok(!r.navHit, "overlay overlaps the bottom nav"); assert.ok(r.inside, "overlay inside the clip");
  assert.deepEqual(r.small, [], "touch targets ≥44px"); assert.match(r.grad, /linear-gradient/, "bottom gradient"); assert.ok(!r.ox, "no horizontal overflow");
  assert.equal(r.color, "rgb(255, 255, 255)", "white text over video");
};
test("390 light: overlay content, follow, more/less, tags, sound, own clip, keyboard, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clips_ov_a", "مشاهد اللقطات"); await seed(p, author);
  await open(p); await show(p, "clipov_0");
  const s0 = sec("clipov_0");
  assert.equal(await p.textContent(`${s0} .cl-ov-name bdi`), "سارة المصوّرة");
  assert.equal(await p.getAttribute(`${s0} .cl-ov-name`, "href"), "#/clips/@clips_ov_author"); // v2.75: the name opens the creator's فيديوتك profile
  assert.ok(await p.$(`${s0} .cl-ov-badge[role="img"][aria-label]`), "verified mark");
  assert.equal(await p.getAttribute(`${s0} .cl-ov-av`, "aria-hidden"), "true");
  const clamp = await p.$eval(`${s0} .cl-ov-cap`, (e) => { const lh = parseFloat(getComputedStyle(e).lineHeight); return { h: e.clientHeight, lh, sh: e.scrollHeight }; });
  assert.ok(clamp.h <= clamp.lh * 2 + 2 && clamp.sh > clamp.h, "caption clamped to 2 lines " + JSON.stringify(clamp));
  assert.equal(await p.getAttribute(`${s0} .cl-ov-cap a.tag`, "href"), "#/clips/tag/" + encodeURIComponent("سفر")); // v2.73: hashtags in a clip open the clips hashtag page (it links the general #/tag page)
  const more = `${s0} .cl-ov-more`;
  assert.equal(await p.isVisible(more), true); assert.equal(await p.getAttribute(more, "aria-expanded"), "false");
  assert.equal((await p.textContent(more)).trim(), "المزيد");
  await p.focus(more); await p.keyboard.press("Enter");
  assert.equal(await p.getAttribute(more, "aria-expanded"), "true"); assert.equal((await p.textContent(more)).trim(), "أقل");
  assert.ok(await p.$eval(`${s0} .cl-ov-cap`, (e, h) => e.clientHeight > h + 10, clamp.h), "caption expanded");
  await geo(p, "clipov_0");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/overlay-390-light-open.png" });
  await p.focus(more); await p.keyboard.press("Space"); assert.equal(await p.getAttribute(more, "aria-expanded"), "false");
  assert.match((await p.textContent(`${s0} .cl-ov-snd`)).replace(/\s+/g, " "), /الصوت: صوت أصلي · سارة المصوّرة/);
  assert.match((await p.textContent(`${sec("clipov_1")} .cl-ov-snd`)).replace(/\s+/g, " "), /الصوت: أغنية الصباح · فرقة الجبل/);
  await show(p, "clipov_1"); assert.equal(await p.isVisible(`${sec("clipov_1")} .cl-ov-more`), false, "short caption: no toggle");
  assert.equal(await p.$(`${sec("clipov_2")} .cl-ov-follow`), null, "no follow on own clip");
  await geo(p, "clipov_0");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/overlay-390-light.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  // follow (last: the app re-syncs after a follow, which may rebuild the feed): flips in place, synchronously, on every clip of that author
  const fb = `${s0} .cl-ov-follow`;
  assert.equal((await p.textContent(fb)).trim(), "تابع"); assert.equal(await p.getAttribute(fb, "aria-pressed"), "false");
  const after = await p.evaluate(({ a, b }) => { const x = document.querySelector(a); x.click(); const y = document.querySelector(b); return [x.getAttribute("aria-pressed"), x.textContent.trim(), y?.getAttribute("aria-pressed")]; }, { a: fb, b: `${sec("clipov_1")} .cl-ov-follow` });
  assert.deepEqual(after, ["true", "تتابعه", "true"]);
  assert.deepEqual(errs, []);
  await c.close();
});
test("1440 dark: overlay readable, clear of the rail, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, colorScheme: "dark" }); const p = await c.newPage();
  await onboard(p, S.base, "clips_ov_b", "مشاهد"); await seed(p, author);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await open(p); await geo(p, "clipov_0");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/overlay-1440-dark.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
test("390 LTR English: Follow / More / Sound strings, mirrored layout, axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, locale: "en-US" }); const p = await c.newPage();
  await onboard(p, S.base, "clips_ov_c", "Clip Viewer");
  await p.evaluate(() => window.MPI18n.setLang("en")); await p.waitForFunction(() => document.documentElement.dir === "ltr");
  await p.waitForTimeout(1500); await seed(p, author);
  await open(p); await show(p, "clipov_0"); await p.waitForTimeout(500);
  const s0 = sec("clipov_0");
  assert.match(await p.textContent(`${s0} .cl-ov-snd`), /Sound:.*Original sound/);
  assert.match(await p.textContent(`${s0} .cl-ov-more`), /More/);
  assert.match(await p.textContent(`${s0} .cl-ov-follow`), /Follow/);
  assert.equal(await p.textContent(`${s0} .cl-ov-name bdi`), "سارة المصوّرة", "names are never translated");
  await p.click(`${s0} .cl-ov-more`); await p.waitForTimeout(300); assert.match(await p.textContent(`${s0} .cl-ov-more`), /Less/);
  const side = await p.evaluate((s) => { const el = document.querySelector(s), i = el.querySelector(".short-info").getBoundingClientRect(), a = el.querySelector(".short-actions").getBoundingClientRect(); return i.left < a.left; }, s0);
  assert.ok(side, "LTR: overlay on the left, rail on the right");
  await geo(p, "clipov_0");
  if (SHOTS) await p.screenshot({ path: SHOTS + "/overlay-390-ltr.png" });
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await c.close();
});
