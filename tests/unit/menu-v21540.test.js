/* v2.154.0 «المزيد» stage 1: six sections, each with at most six core rows; the rest fold under «أدوات أخرى». Nothing removed. */
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs"), path = require("node:path");
const load = () => { const ctx = { UI: { icon: () => "", num: String }, MPRoutes: { extend() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, location: { hash: "" } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, "../../menu-ui.js"), "utf8"), ctx); return ctx.MPMenu; };
/* every member destination «المزيد» listed before v2.154.0 */
const BEFORE = ["me","city","aihub","library","lists","interests","purchases","points","leaderboard","verify","integrity","orgs","beta","messages","notifications","calls","newgroup","message-requests","e2ee","devices","explore","search","trends","digest","shorts","clips/challenges","rooms","nearby","places","cities","hijri","communities","cadmin","events","giving","ambassadors","studio","analytics","drafts","scheduled","series","collabs","creator-program","fund","creator","subscribers","me/paid-posts","ads","study","courses","exams","certificates","verify-cert","knowledge","mentors","mentoring","mentor-certs","cv","talent","jobs","contracts","teams","reviews","biz","mjt","wallet","transfers","statement","annual","market","digital","subs","supporting","earnings","ai","finance-report","security","privacy","protection","mydata","my-reports","account-log","age","family","urgent","wellbeing","help","faq","tickets","policies","legal","transparency","about","versions","waitlist","app","developers","settings","settings?s=acct","settings?s=privacy","settings?s=notif","settings?s=content","settings?s=display","settings?s=money","settings?s=family","settings?s=help","settings/appearance","settings/display","settings/language","settings/translate","settings/ads","notifsettings","emailprefs","feedprefs"];

test("every destination listed before stays in the hub (moved, never removed), once each", () => {
  const m = load(), member = m.items().filter((x) => !x.staff).map((x) => x.r);
  assert.deepEqual(BEFORE.filter((r) => !member.includes(r)), []);
  assert.equal(new Set(member).size, member.length, "no duplicate rows");
  assert.equal(member.length, 117); // v2.156.0: + membership; v2.160.0: + rewards; v2.161.0: + mjt/services
});

test("six member sections, each showing at most six core rows; the rest sit under «أدوات أخرى»", () => {
  const m = load(), cats = m.categories().filter((c) => !c.staff), items = m.items().filter((x) => !x.staff);
  assert.deepEqual([...cats.map((c) => String(c.id))], ["you", "connect", "discover", "create", "money", "settings"]);
  for (const c of cats) { const core = items.filter((x) => x.cat === c.id && !x.x); assert.ok(core.length >= 5 && core.length <= 6, c.id + " core " + core.length); }
  assert.ok(items.filter((x) => !x.x).length <= 40);
  for (const r of ["messages", "notifications", "wallet", "market", "settings", "security", "help", "urgent", "jobs", "courses"]) assert.equal(items.find((x) => x.r === r).x, false, r + " stays visible");
  assert.equal(items.find((x) => x.r === "wallet").pi, true, "Pi rows keep their «غير مفعّل بعد» flag");
});
