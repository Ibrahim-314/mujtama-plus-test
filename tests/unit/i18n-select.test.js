/* i18n-select-template: the DOM translator translates <option> text and <optgroup>/<option> label attributes in LTR, never
 * option values, never data-noi18n options or selects, restores Arabic in RTL, and picks up options added later
 * (MutationObserver). Runs i18n-ui.js in a real Chromium page with a tiny shell shim. */
/* global document, window */
const test = require("node:test"),
  assert = require("node:assert"),
  fs = require("node:fs"),
  path = require("node:path");
const { chromium } = require("playwright-core");
const ROOT = path.join(__dirname, "..", "..");
const { resolveChromium } = require(path.join(ROOT, "tools", "chromium.js"));
const SRC = fs.readFileSync(path.join(ROOT, "i18n-ui.js"), "utf8");

let browser, page;
test.before(async () => {
  browser = await chromium.launch({ ...resolveChromium(), args: ["--no-sandbox", "--disable-gpu"] });
  page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ar" dir="rtl"><body><div id="view">
    <p>قبول</p>
    <select id="s1" aria-label="ترتيب الطابور"><option value="risk">الأخطر أولاً</option><option value="old">الأقدم أولاً</option>
      <optgroup label="الإجراءات"><option value="queue">تحويل للمراجعة</option></optgroup><option value="u" data-noi18n>تحويل للمراجعة</option>
      <option value="lab" label="الأخطر أولاً">x</option></select>
    <select id="s2" data-noi18n><option value="a">الأخطر أولاً</option></select>
    <div class="body"><select id="s3"><option value="a">الأخطر أولاً</option></select></div>
  </div></body></html>`);
  await page.evaluate(() => {
    window.DB = { settings: { lang: "ar" } };
    window.MPRoutes = { add() {}, extend() {} };
    window.MPSettings = { add() {} };
    window.MPI18N = {
      en: {
        قبول: "Approve",
        "الأخطر أولاً": "Riskiest first",
        "الأقدم أولاً": "Oldest first",
        "تحويل للمراجعة": "Send to review",
        الإجراءات: "Actions",
        "ترتيب الطابور": "Sort queue",
        منع: "Block"
      }
    };
  });
  await page.addScriptTag({ content: SRC });
});
test.after(async () => {
  await browser?.close();
});

const state = () =>
  page.evaluate(() => {
    const s1 = document.getElementById("s1");
    return {
      p: document.querySelector("p").textContent,
      opts: [...s1.options].map(o => [o.value, o.textContent, o.getAttribute("label")]),
      group: s1.querySelector("optgroup").label,
      aria: s1.getAttribute("aria-label"),
      s2: document.querySelector("#s2 option").textContent,
      s3: document.querySelector("#s3 option").textContent,
      value: s1.value
    };
  });

test("LTR: option text, option/optgroup labels and select aria-label are translated; values untouched", async () => {
  await page.evaluate(() => window.MPI18n.setLang("en", { save: false }));
  await page.evaluate(() => (document.getElementById("s1").value = "old"));
  const st = await state();
  assert.equal(st.p, "Approve");
  assert.deepEqual(st.opts, [
    ["risk", "Riskiest first", null],
    ["old", "Oldest first", null],
    ["queue", "Send to review", null],
    ["u", "تحويل للمراجعة", null],
    ["lab", "x", "Riskiest first"]
  ]);
  assert.equal(st.group, "Actions");
  assert.equal(st.aria, "Sort queue");
  assert.equal(st.value, "old", "the selected value survives translation");
});

test("data-noi18n select and selects inside user content are never translated", async () => {
  const st = await state();
  assert.equal(st.s2, "الأخطر أولاً");
  assert.equal(st.s3, "الأخطر أولاً");
});

test("MutationObserver: options added or relabelled later are translated", async () => {
  await page.evaluate(() => {
    const s1 = document.getElementById("s1");
    s1.insertAdjacentHTML("beforeend", `<option value="block">منع</option>`);
    s1.querySelector("optgroup").setAttribute("label", "تحويل للمراجعة");
  });
  await page.waitForFunction(() => document.querySelector('#s1 option[value="block"]').textContent === "Block");
  await page.waitForFunction(() => document.querySelector("#s1 optgroup").label === "Send to review");
  assert.equal(await page.evaluate(() => document.querySelector('#s1 option[value="block"]').value), "block");
});

test("RTL (ar): Arabic source restored exactly", async () => {
  await page.evaluate(() => window.MPI18n.setLang("ar", { save: false }));
  const st = await state();
  assert.equal(st.p, "قبول");
  assert.deepEqual(
    st.opts.map(o => o[1]),
    ["الأخطر أولاً", "الأقدم أولاً", "تحويل للمراجعة", "تحويل للمراجعة", "x", "منع"]
  );
  assert.equal(st.opts[4][2], "الأخطر أولاً");
  assert.equal(st.aria, "ترتيب الطابور");
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
});
