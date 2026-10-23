/* Track 2 — identity journeys in the browser: tour, challenges, profile editing with the image
 * cropper, privacy center & view-as, organisations with act-as posting, hover cards. */
const test = require("node:test"),
  assert = require("node:assert"),
  { execFileSync } = require("node:child_process"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { startStack, onboard, dismissTour, MOBILE, DESKTOP } = require("./harness");
let S;
const errors = [];
test.before(async () => {
  S = await startStack();
});
test.after(async () => {
  await S.close();
  assert.deepEqual(errors, [], "no uncaught page errors");
});
const page = async opts => {
  const c = await S.browser.newContext({ ...opts, reducedMotion: "reduce" });
  const p = await c.newPage();
  p.on("pageerror", e => errors.push(e.message));
  return p;
};
const login = async (p, handle) => {
  await p.goto(S.base + "/?nosw");
  await p.fill("#a-handle", handle);
  await p.fill("#a-pass", "secret1234");
  await p.click("#a-go");
  await p.waitForSelector(".bottomnav a[data-r=home]");
  await dismissTour(p);
};

test("guided tour appears after onboarding and walks through the app", async () => {
  const p = await page(MOBILE);
  await p.goto(S.base + "/?nosw");
  await p.click("[data-m=register]");
  await p.fill("#a-name", "ريم");
  await p.fill("#a-handle", "reem_tour");
  await p.fill("#a-pass", "secret1234");
  await p.click("#a-go");
  await p.waitForSelector(".ob-art");
  await p.click("#n1");
  for (const t of ["ai", "dev", "pi"]) await p.click(`[data-i="${t}"]`);
  await p.click("#n2");
  await p.waitForSelector("#n3");
  await p.click("#n3");
  const first = await p.waitForSelector(".tour-card b, .tour-card h3", { timeout: 6000 });
  assert.ok(await first.textContent());
  if (await p.$("#t-next")) {
    for (let i = 0; i < 6 && (await p.$("#t-next")); i++) await p.click("#t-next");
  } else await p.click("#t-ok");
  await p.waitForSelector(".tour", { state: "detached" });
  await p.waitForSelector(".challenges");
  assert.match(await p.textContent(".challenges"), /تحديات أسبوعك الأول/);
  await p.context().close();
});

test("profile: edit location/links/expertise, crop and upload an avatar, completion meter", async () => {
  const p = await page(MOBILE);
  await onboard(p, S.base, "hala_prof", "هلا");
  await p.goto(S.base + "/?nosw#/me");
  await p.waitForSelector(".complete");
  await p.click("#edit2");
  await p.waitForSelector("#ep-loc");
  await p.fill("#ep-loc", "جدة");
  await p.fill("#ep-exp", "تصميم، تطوير الويب");
  await p.fill(".l-url", "https://example.com");
  await p.fill(".l-label", "معرض أعمالي");
  await p.click("#ep-save");
  await p.waitForSelector(".pmeta");
  assert.match(await p.textContent(".pmeta"), /جدة/);
  assert.match(await p.textContent(".expertise"), /تصميم/);
  const png = path.join(os.tmpdir(), "av.png");
  fs.writeFileSync(
    png,
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=s=600x400",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-c:v",
      "png",
      "-"
    ])
  );
  const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click(".profile-top .av-cam")]);
  await chooser.setFiles(png);
  await p.waitForSelector("#crop");
  await p.fill("#cz", "1.6");
  await p.click("#cr");
  await p.click("#cs");
  await p.waitForSelector('.profile-top .av.lg img[src*="/media/pf-"]', { timeout: 10000 });
  await p.context().close();
});

test("privacy: private account, view-as preview, and a follow request flow", async () => {
  const a = await page(MOBILE);
  await onboard(a, S.base, "private_one", "منى");
  await a.goto(S.base + "/?nosw#/privacy");
  await a.waitForSelector("#pv-private");
  await a.check("#pv-private");
  await a.waitForTimeout(300);
  await a.selectOption('[data-pv="dm"]', "following");
  await a.waitForTimeout(200);
  await a.goto(S.base + "/?nosw#/me?as=public");
  await a.waitForSelector(".viewas-bar");
  const b = await page(MOBILE);
  await onboard(b, S.base, "curious_one", "سعد");
  await b.goto(S.base + "/?nosw#/u/private_one");
  await b.waitForSelector(".locked");
  await b.click(".profile-top [data-follow]");
  await b.waitForTimeout(500);
  await a.goto(S.base + "/?nosw#/privacy");
  await a.waitForSelector('[data-fr][data-d="approve"]');
  await a.click('[data-fr][data-d="approve"]');
  await a.waitForTimeout(400);
  await b.waitForTimeout(1700);
  await b.goto(S.base + "/?nosw#/u/curious_one");
  await b.goto(S.base + "/?nosw#/u/private_one");
  await b.waitForTimeout(1000);
  assert.equal(await b.$(".locked"), null, "approved follower sees the profile");
  await a.context().close();
  await b.context().close();
});

test("organisations: create, open dashboard, post as the org", async () => {
  const p = await page(DESKTOP);
  await login(p, "hala_prof");
  await p.goto(S.base + "/?nosw#/orgs");
  await p.waitForSelector("#o-name");
  await p.fill("#o-name", "استوديو هلا");
  await p.fill("#o-handle", "hala_studio");
  await p.click("#o-go");
  await p.waitForSelector(".org-hero");
  await p.click("#act");
  await p.waitForSelector("#act-banner");
  assert.match(await p.textContent("#act-banner"), /استوديو هلا/);
  await dismissTour(p);
  await p.evaluate(() => document.getElementById("fab").click());
  await p.fill("#c3-text", "أول منشور باسم الاستوديو");
  await p.click("#c3-pub");
  await p.waitForTimeout(800);
  const author = await p.evaluate(async () => {
    const r = await fetch("/api/feed?mode=latest", { headers: { "X-Requested-With": "mujtama" } });
    const j = await r.json();
    return j.posts.find(x => x.text.includes("باسم الاستوديو"))?.author;
  });
  const org = await p.evaluate(() => JSON.parse(localStorage.getItem("mp_actAs")).id);
  assert.equal(author, org, "post authored by the organisation");
  await p.click("#act-exit");
  await p.waitForSelector(".bottomnav a[data-r=home]");
  assert.equal(await p.$("#act-banner"), null);
  await p.context().close();
});

test("desktop: hover card previews a profile; account switcher opens", async () => {
  const p = await page(DESKTOP);
  await login(p, "curious_one");
  await p.goto(S.base + "/?nosw#/u/hala_prof");
  await p.waitForSelector(".post-card a.name, .profile-top");
  await p.goto(S.base + "/?nosw#/home");
  await p.waitForTimeout(400);
  const nm = await p.$(".post-card a.name");
  if (nm) {
    await nm.hover();
    await p.waitForSelector(".hovercard", { timeout: 4000 });
  }
  await p.click(".nav-switch");
  await p.waitForSelector(".sw-row");
  assert.ok(await p.$("#sw-add"));
  await p.context().close();
});
