/* v2.73 slice 1 — «لقطات» features: sound / hashtag pages (#/clips/sound/<key>, #/clips/tag/<tag>: grid + count, tile →
 * viewer at that clip), series chip «الجزء N من M» + «الجزء التالي» (existing /api/cseries/for-post, mocked here) and the
 * «أضفها إلى سلسلة» link on the creator's own clip, resume watching (window.MPResume rules + the «تابع المشاهدة» row on
 * #/explore). Bottom nav hidden inside the viewer, visible on the grid pages. axe 0 serious/critical at 390 light,
 * 1440 dark and 390 LTR. CLIPS_SHOTS=dir → screenshots. */
const test = require("node:test"), assert = require("node:assert");
const { startStack, onboard, MOBILE, DESKTOP } = require("./harness");
const SHOTS = process.env.CLIPS_SHOTS;
let S;
test.before(async () => { S = await startStack(); });
test.after(async () => { await S.close(); });

const POSTER = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#5b21b6"/><circle cx="90" cy="160" r="40" fill="#f472b6"/></svg>');
const seed = (p) => p.evaluate((POSTER) => {
  const mk = (id, i, text, sound) => { if (!S.post(id)) DB.posts.push({ id, author: DB.me, type: "video", status: "published", visibility: "public", text, sound, createdAt: new Date(Date.now() - i * 60000).toISOString(), media: "#223", video: { short: true, duration: 12 + i, variants: { "360p": "/media/none-" + id + ".mp4", poster: i % 2 ? POSTER : "" } } }); };
  mk("cp_0", 0, "رحلة الصحراء #سفر", { id: "snd1", title: "نغمة الصحراء" });
  mk("cp_1", 1, "غروب جميل #سفر #طبيعة", { id: "snd1", title: "نغمة الصحراء" });
  mk("cp_2", 2, "مقطع ثالث #سفر", { id: "snd1", title: "نغمة الصحراء" });
  mk("cp_3", 3, "لقطة بصوت أصلي", null);
}, POSTER);
const axe = async (p) => {
  await p.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  return p.evaluate(async () => (await window.axe.run(document.getElementById("view"), { resultTypes: ["violations"] })).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id + ": " + v.nodes.slice(0, 3).map(n => n.target.join(" ")).join(" | ")));
};
const navShown = (p) => p.evaluate(() => { const n = document.querySelector(".bottomnav"); if (!n) return false; const s = getComputedStyle(n), b = n.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && b.height > 0; });
const mockFeedEmpty = (p) => p.route(/\/api\/clips\/feed/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], next: null }) })); // local store pages the seeded clips
const mockSeries = async (p) => {
  await p.route(/\/api\/cseries\/for-post\//, (r) => {
    const id = decodeURIComponent(r.request().url().split("/for-post/")[1]);
    const body = id === "cp_1" ? { series: { id: "ser1", title: "رحلتي" }, episode: 1, total: 3, next: { id: "cp_2", title: "ج2", episode: 2 }, prev: null, upcoming: 1 } : { series: null };
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await p.route(/\/api\/cseries\/ser1(\/follow)?$/, (r) => {
    if (r.request().method() !== "GET") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ series: { id: "ser1", title: "رحلتي", author: { name: "صانع" } },
      items: [{ id: "cp_1", episode: 1, title: "ج1", status: "published", seen: true }, { id: "cp_2", episode: 2, title: "ج2", status: "published", seen: false }, { id: "cp_3", episode: 3, title: "ج3", status: "published", seen: false }, { id: "cp_9", episode: null, title: "ج4", status: "scheduled", seen: false }],
      me: { owner: false, following: false, seen: 1, resume: { id: "cp_2", episode: 2, title: "ج2" } } }) });
  });
};
const openClips = async (p, hash = "#/clips") => {
  for (let k = 0; k < 3; k++) {
    await seed(p); await p.evaluate((h) => { location.hash = h; }, hash);
    try { await p.waitForSelector(".shorts .short .cl-snd-a", { timeout: 8000 }); await p.waitForTimeout(400); return; } catch { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(600); }
  }
  throw new Error("clips did not render");
};
const openPage = async (p, hash) => {
  for (let k = 0; k < 3; k++) {
    await seed(p); await p.evaluate((h) => { location.hash = h; }, hash);
    try { await p.waitForSelector(".clp-pg .clp-grid .clp-tile", { timeout: 8000 }); await p.waitForTimeout(300); return; } catch { await p.evaluate(() => { location.hash = "#/home"; }); await p.waitForTimeout(600); }
  }
  throw new Error("page did not render: " + hash);
};
const grid = (p) => p.evaluate(() => ({ n: +document.querySelector(".clp-pg-n")?.textContent, tiles: [...document.querySelectorAll(".clp-grid .clp-tile")].map(a => a.getAttribute("href")), title: document.querySelector(".clp-pg h1")?.textContent, shorts: document.body.classList.contains("shorts-mode"), ox: document.documentElement.scrollWidth > innerWidth, minH: Math.min(...[...document.querySelectorAll(".clp-tile,.clp-pg-back")].map(e => e.getBoundingClientRect().height)) }));

test("390 light: sound + hashtag links in the clip open the grid pages; tile opens the viewer at that clip; axe", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clpg_a", "صانع الصوت"); await mockFeedEmpty(p); await mockSeries(p);
  await p.route(/\/api\/tags\//, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tag: "سفر", posts: [{ id: "cp_srv", author: "u_srv", type: "video", status: "published", text: "من الخادم #سفر", createdAt: new Date(Date.now() - 9e6).toISOString(), video: { short: true, duration: 20, variants: { "360p": "/media/x.mp4" } } }, { id: "cp_txt", type: "text", status: "published", text: "نص #سفر" }] }) }));
  await openClips(p);
  const links = await p.evaluate(() => { const sec = document.querySelector('.short[data-short="cp_0"]'); return { snd: sec.querySelector(".cl-snd-a")?.getAttribute("href"), tag: sec.querySelector(".cl-ov-cap a.tag")?.getAttribute("href"), orig: document.querySelector('.short[data-short="cp_3"] .cl-snd-a')?.getAttribute("href") }; });
  assert.equal(links.snd, "#/clips/sound/" + encodeURIComponent("s:snd1"));
  assert.equal(decodeURIComponent(links.tag), "#/clips/tag/سفر");
  assert.equal(links.orig, "#/clips/sound/" + encodeURIComponent("o:cp_3"), "original sound → that clip's own key");
  assert.equal(await navShown(p), false, "bottom nav still hidden inside the viewer");
  // sound page
  await p.click('.short[data-short="cp_0"] .cl-snd-a');
  await p.waitForSelector(".clp-pg .clp-grid .clp-tile");
  let g = await grid(p);
  assert.equal(g.n, 3); assert.deepEqual(g.tiles.sort(), ["#/clips?start=cp_0", "#/clips?start=cp_1", "#/clips?start=cp_2"]);
  assert.ok(/نغمة الصحراء/.test(g.title)); assert.equal(g.shorts, false); assert.ok(!g.ox); assert.ok(g.minH >= 44);
  assert.ok(await navShown(p), "bottom nav visible on the grid page");
  let v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/sound-390-light.png", fullPage: true });
  // tile → viewer at that clip
  await p.click('.clp-tile[href="#/clips?start=cp_2"]');
  await p.waitForFunction(() => document.body.classList.contains("shorts-mode") && document.querySelector(".shorts .short"), null, { timeout: 8000 });
  await p.waitForFunction(() => { const f = document.querySelector(".shorts"), s = document.querySelector('.short[data-short="cp_2"]'); if (!f || !s) return false; const a = s.getBoundingClientRect(), b = f.getBoundingClientRect(); return Math.abs(a.top - b.top) < 4; }, null, { timeout: 8000 });
  // hashtag page (local 3 + 1 server video; the server text post is ignored)
  await openPage(p, "#/clips/tag/" + encodeURIComponent("سفر"));
  await p.waitForFunction(() => document.querySelectorAll(".clp-grid .clp-tile").length === 4, null, { timeout: 8000 });
  g = await grid(p); assert.equal(g.n, 4); assert.ok(g.tiles.includes("#/clips?start=cp_srv")); assert.ok(/#سفر/.test(g.title));
  assert.equal(await p.getAttribute(".clp-pg-more a", "href"), "#/tag/" + encodeURIComponent("سفر"), "general hashtag page stays reachable");
  v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/tag-390-light.png", fullPage: true });
  assert.deepEqual(errs, []); await c.close();
});

test("390: series ribbon (story segments) + episodes sheet + up-next; own clip without a series → quiet «أضفها إلى سلسلة» link", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clpg_b", "صانع السلسلة"); await mockFeedEmpty(p); await mockSeries(p);
  await openClips(p, "#/clips?start=cp_1");
  await p.waitForSelector('.short[data-short="cp_1"] .cl-ser .cl-ser-chip', { timeout: 8000 });
  const r = await p.evaluate(() => { const s = document.querySelector('.short[data-short="cp_1"] .cl-ser'); const b = s.querySelector(".cl-ser-next").getBoundingClientRect(); return { title: s.querySelector(".cl-sr-txt b").textContent.trim(), part: s.querySelector(".cl-sr-txt small").textContent.trim(), segs: s.querySelectorAll(".cl-sr-segs i").length, now: [...s.querySelectorAll(".cl-sr-segs i")].findIndex((i) => i.classList.contains("now")), op: getComputedStyle(s).opacity, label: s.querySelector(".cl-ser-chip").textContent.replace(/\s+/g, " ").trim(), next: s.querySelector(".cl-ser-next").getAttribute("aria-label"), h: b.height }; });
  assert.equal(r.title, "رحلتي"); assert.equal(r.part, "الجزء 1 من 3"); assert.equal(r.segs, 3); assert.equal(r.now, 0);
  assert.match(r.label, /رحلتي ?الجزء 1 من 3/); assert.match(r.next, /^الجزء التالي — الجزء 2$/); assert.ok(r.h >= 44); await p.waitForFunction(() => getComputedStyle(document.querySelector('.short[data-short="cp_1"] .cl-ser')).opacity === "1", null, { timeout: 3000 });
  let v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/series-ribbon-390-light.png" });
  // episodes sheet
  await p.click('.short[data-short="cp_1"] .cl-ser-chip');
  await p.waitForSelector(".cl-srs.open .cl-sr-card", { timeout: 8000 });
  const sh = await p.evaluate(() => { const e = document.querySelector(".cl-srs"); return { cards: e.querySelectorAll(".cl-sr-card").length, now: e.querySelector(".cl-sr-card.now")?.dataset.part, seenMarks: e.querySelectorAll(".cl-sr-seen").length, soon: e.querySelector(".cl-sr-card:disabled .cl-sr-ep")?.textContent.trim(), res: e.querySelector(".cl-srs-res b")?.textContent.trim(), all: e.querySelector(".cl-srs-all").getAttribute("href"), focus: document.activeElement?.classList.contains("cl-srs-x"), fol: e.querySelector(".cl-srs-fol").textContent.trim() }; });
  assert.equal(sh.cards, 4); assert.equal(sh.now, "cp_1"); assert.equal(sh.seenMarks, 0, "current part shows «الآن», not a check"); assert.equal(sh.soon, "قريباً");
  assert.equal(sh.res, "تابع من حيث توقفت"); assert.equal(sh.all, "#/series/ser1"); assert.ok(sh.focus, "focus moves into the sheet"); assert.equal(sh.fol, "تابع السلسلة");
  v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) { await p.waitForTimeout(300); await p.screenshot({ path: SHOTS + "/series-sheet-390-light.png" }); }
  await p.click(".cl-srs-fol"); await p.waitForFunction(() => document.querySelector(".cl-srs-fol")?.getAttribute("aria-pressed") === "true");
  assert.equal((await p.textContent(".cl-srs-fol")).trim(), "تتابع السلسلة");
  await p.keyboard.press("Escape"); await p.waitForFunction(() => !document.querySelector(".cl-srs"));
  assert.ok(await p.evaluate(() => document.activeElement?.classList.contains("cl-ser-chip")), "focus back on the ribbon");
  // up-next card (forced; the timeupdate trigger needs a real 80% play)
  await p.evaluate(() => window.Clips.series.upNext.show());
  await p.waitForSelector('.short[data-short="cp_1"] .cl-up.in', { timeout: 4000 });
  assert.equal((await p.textContent(".cl-up-go")).trim(), "شاهد الآن");
  if (SHOTS) { await p.waitForTimeout(1500); await p.screenshot({ path: SHOTS + "/series-upnext-390-light.png" }); }
  v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  await p.click(".cl-up-x"); await p.waitForFunction(() => !document.querySelector(".cl-up"));
  // next part
  await p.click('.short[data-short="cp_1"] .cl-ser-next');
  await p.waitForFunction(() => { const f = document.querySelector(".shorts"), s = document.querySelector('.short[data-short="cp_2"]'); return f && s && Math.abs(s.getBoundingClientRect().top - f.getBoundingClientRect().top) < 4; }, null, { timeout: 8000 }); // next part is in this feed: scrolled to
  await p.waitForSelector('.short[data-short="cp_2"] .cl-ov-snd + .cl-ser-add', { timeout: 8000 });
  assert.equal(await p.getAttribute('.short[data-short="cp_2"] .cl-ser-add', "href"), "#/series");
  assert.equal(await p.locator('.short[data-short="cp_2"] .cl-ser').count(), 0, "no ribbon on a clip outside a series");
  assert.deepEqual(errs, []); await c.close();
});

test("series: 1440 dark sheet + 390 LTR English ribbon/sheet, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clpg_sd", "صانع داكن"); await mockFeedEmpty(p); await mockSeries(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await openClips(p, "#/clips?start=cp_1");
  await p.waitForSelector('.short[data-short="cp_1"] .cl-ser .cl-ser-chip', { timeout: 8000 });
  await p.click('.short[data-short="cp_1"] .cl-ser-chip'); await p.waitForSelector(".cl-srs.open .cl-sr-card", { timeout: 8000 }); await p.waitForTimeout(300);
  let v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/series-sheet-1440-dark.png" });
  // same account in a fresh phone context: registration is rate-limited (5/hour/IP), so the session is reused
  const q = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh", storageState: await c.storageState() }).then((x) => x.newPage());
  q.on("pageerror", (e) => errs.push(e.message));
  await q.goto(S.base + "/?nosw"); await q.waitForSelector(".bottomnav a[data-r=home]"); await mockFeedEmpty(q); await mockSeries(q);
  await q.waitForFunction(() => window.MPI18n && window.MPI18n.setLang, null, { timeout: 15000 }); await q.evaluate(() => window.MPI18n.setLang("en")); await q.waitForFunction(() => document.documentElement.dir === "ltr"); await q.waitForTimeout(800);
  await openClips(q, "#/clips?start=cp_1");
  await q.waitForSelector('.short[data-short="cp_1"] .cl-ser .cl-ser-chip', { timeout: 8000 });
  assert.equal((await q.textContent('.short[data-short="cp_1"] .cl-sr-txt small')).trim(), "Part 1 of 3");
  if (SHOTS) await q.screenshot({ path: SHOTS + "/series-ribbon-390-ltr.png" });
  await q.click('.short[data-short="cp_1"] .cl-ser-chip'); await q.waitForSelector(".cl-srs.open .cl-sr-card", { timeout: 8000 }); await q.waitForTimeout(300);
  assert.equal((await q.textContent(".cl-srs-res b")).trim(), "Continue where you left off");
  v = await axe(q); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await q.screenshot({ path: SHOTS + "/series-sheet-390-ltr.png" });
  assert.deepEqual(errs, []); await q.context().close(); await c.close();
});

test("resume watching: MPResume rules + «تابع المشاهدة» row on explore (clip → viewer, long video → post)", async () => {
  const c = await S.browser.newContext({ ...MOBILE, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clpg_c", "مشاهد متابع");
  const rules = await p.evaluate(() => {
    const R = window.MPResume; const out = {};
    R.set("rz_a", 1, 100); out.early = R.get("rz_a");
    R.set("rz_a", 50, 100); out.mid = R.get("rz_a")?.t;
    R.set("rz_a", 98, 100); out.end = R.get("rz_a");
    R.set("rz_b", 5, 12); out.short = R.get("rz_b");
    return out;
  });
  assert.equal(rules.early, null, "<3 s is not saved"); assert.equal(rules.mid, 50); assert.equal(rules.end, null, "near the end clears it"); assert.equal(rules.short, null, "<20 s videos are not tracked");
  // a long video and a ≥20 s clip left part-way
  await p.evaluate(() => {
    DB.posts.push({ id: "rz_long", author: DB.me, type: "video", status: "published", visibility: "public", text: "محاضرة طويلة", createdAt: new Date().toISOString(), video: { duration: 600, variants: { "360p": "/media/l.mp4" } } });
    DB.posts.push({ id: "rz_clip", author: DB.me, type: "video", status: "published", visibility: "public", text: "لقطة طويلة", createdAt: new Date().toISOString(), video: { short: true, duration: 45, variants: { "360p": "/media/c.mp4" } } });
    window.MPResume.set("rz_long", 125, 600); window.MPResume.set("rz_clip", 20, 45);
    location.hash = "#/explore";
  });
  await p.waitForSelector("#x-res .x-clip", { timeout: 10000 });
  const row = await p.evaluate(() => [...document.querySelectorAll("#x-res a.x-clip")].map(a => [a.getAttribute("href"), a.querySelector(".x-clip-dur").textContent, a.querySelector(".x-res-bar i").style.width]));
  assert.deepEqual(row.map(x => x[0]).sort(), ["#/clips?start=rz_clip", "#/post/rz_long"]);
  assert.ok(row.some(x => x[1] === "2:05 / 10:00" && x[2] === "21%"), JSON.stringify(row));
  const v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  assert.deepEqual(errs, []); await c.close();
});

test("1440 dark + 390 LTR English: sound page, axe", async () => {
  const c = await S.browser.newContext({ ...DESKTOP, timezoneId: "Asia/Riyadh" }); const p = await c.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await onboard(p, S.base, "clpg_d", "صانع سطح المكتب"); await mockFeedEmpty(p);
  await p.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await openPage(p, "#/clips/sound/" + encodeURIComponent("s:snd1"));
  const g = await grid(p); assert.equal(g.n, 3); assert.ok(!g.ox);
  let v = await axe(p); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await p.screenshot({ path: SHOTS + "/sound-1440-dark.png" });
  const st = await c.storageState(); assert.deepEqual(errs, []); await c.close();
  const c2 = await S.browser.newContext({ ...MOBILE, locale: "en-US", storageState: st }); const q = await c2.newPage();
  await q.goto(S.base + "/?nosw"); await q.waitForSelector(".bottomnav a[data-r=home]"); await mockFeedEmpty(q);
  await q.waitForFunction(() => window.MPI18n && window.MPI18n.setLang, null, { timeout: 15000 }); await q.evaluate(() => window.MPI18n.setLang("en")); await q.waitForFunction(() => document.documentElement.dir === "ltr"); await q.waitForTimeout(1000);
  await openPage(q, "#/clips/tag/" + encodeURIComponent("سفر"));
  await q.waitForTimeout(800);
  const t = await q.evaluate(() => ({ more: document.querySelector(".clp-pg-more a")?.textContent.trim(), back: document.querySelector(".clp-pg-back")?.getAttribute("aria-label") }));
  assert.equal(t.more, "All posts with this hashtag"); assert.equal(t.back, "Back to Vidtik");
  v = await axe(q); assert.deepEqual(v, [], v.join("\n"));
  if (SHOTS) await q.screenshot({ path: SHOTS + "/tag-390-ltr.png" });
  await c2.close();
});
