/* مسار الإرشاد M2-1 — PUT/GET /api/mentor/me with the full-profile fields from migration 067: visibility (public | members |
 * hidden), per-field visibility `fields` ({field: public | mentees | off}) and `extra` (approach, skills, experience,
 * qualifications, years, city). Strict validation: enum checks, text lengths, list caps, https-only links, year bounds,
 * unknown keys dropped; partial patches merge over what is stored; null resets; myProfile always returns defaults applied.
 * Viewer filtering is M2-2 (not tested here). PG + SQLite. */
const test = require("node:test"), assert = require("node:assert");
const { boot } = require("./helpers");
const m067 = require("../migrations/067_mentor_profile_ext");

let H, mentor, fresh;
const NOW = Date.parse("2027-01-03T06:00:00Z");
const BASE = { headline: "مطوّرة ويب منذ عشر سنوات", topics: ["programming"] };
const put = (c, b) => c.req("PUT", "/api/mentor/me", { ...BASE, ...b });
async function mk(handle) {
  H.app.ctx.rl.w.clear();
  const c = new H.Client(); const r = await c.req("POST", "/api/auth/register", { name: "عضو " + handle, handle, password: "secret123" });
  assert.equal(r.status, 200, r.error); c.id = r.user.id; return c;
}
const bad = async (b, code) => { const r = await put(mentor, b); assert.equal(r.status, 400, JSON.stringify(b)); if (code) assert.equal(r.code, code, JSON.stringify(b)); };

test.before(async () => {
  H = await boot({ mentorsOpts: { jobs: false, now: () => NOW } });
  mentor = await mk("mps_mentor"); fresh = await mk("mps_fresh");
  const r = await put(mentor, {}); assert.equal(r.status, 200, r.error);
});
test.after(() => H.app.close());
test.beforeEach(() => H.app.ctx.rl.w.clear());

test("defaults: an existing mentor with NULL columns gets public + FIELD_DEFAULTS + empty extra; meta lists the enums", async () => {
  const r = await mentor.req("GET", "/api/mentor/me");
  assert.equal(r.status, 200, r.error);
  assert.equal(r.profile.visibility, "public");
  assert.deepEqual(r.profile.fields, { ...m067.FIELD_DEFAULTS });
  assert.deepEqual(r.profile.extra, { approach: "", skills: [], experience: [], qualifications: [], years: null, city: "", templates: [] });
  assert.deepEqual(r.profileMeta.visibility, ["public", "members", "hidden"]);
  assert.deepEqual(r.profileMeta.fieldLevels, ["public", "mentees", "off"]);
  assert.equal(r.profile.fields.age, "off");
  const none = await fresh.req("GET", "/api/mentor/me");
  assert.equal(none.status, 200); assert.equal(none.profile, null);
  assert.equal((await new H.Client().req("GET", "/api/mentor/me")).status, 401);
});

test("visibility: every enum value saves; anything else (incl. 'mentees') is 400; omitted keeps the stored value", async () => {
  for (const v of m067.VISIBILITY) { const r = await put(mentor, { visibility: v }); assert.equal(r.status, 200, r.error); assert.equal(r.profile.visibility, v); }
  for (const v of ["mentees", "PUBLIC", "", 1, null, ["public"]]) await bad({ visibility: v }, "invalid_visibility");
  const keep = await put(mentor, { bio: "نبذة" }); assert.equal(keep.profile.visibility, "hidden");
  assert.equal((await put(mentor, { visibility: "public" })).profile.visibility, "public");
});

test("fields: partial patch merges over stored, unknown keys dropped, bad level 400, null resets to defaults", async () => {
  let r = await put(mentor, { fields: { age: "public", city: "mentees", hacker: "public", __proto__x: "off" } });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.profile.fields.age, "public"); assert.equal(r.profile.fields.city, "mentees");
  assert.ok(!("hacker" in r.profile.fields)); assert.deepEqual(Object.keys(r.profile.fields).sort(), Object.keys(m067.FIELD_DEFAULTS).sort());
  r = await put(mentor, { fields: { communities: "public" } });
  assert.equal(r.profile.fields.age, "public"); assert.equal(r.profile.fields.communities, "public");
  const row = await H.app.ctx.db.get("SELECT fields FROM mentor_profiles WHERE user_id=$1", [mentor.id]);
  const stored = typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields;
  assert.deepEqual(stored, { age: "public", city: "mentees", communities: "public" });
  for (const f of [{ age: "everyone" }, { photo: true }, { age: null }, "age=public", ["age"]]) await bad({ fields: f }, "invalid_fields");
  r = await put(mentor, { fields: null });
  assert.deepEqual(r.profile.fields, { ...m067.FIELD_DEFAULTS });
  assert.equal((await H.app.ctx.db.get("SELECT fields FROM mentor_profiles WHERE user_id=$1", [mentor.id])).fields, null);
});

test("extra: full valid payload round-trips trimmed; unknown keys (top-level and per item) dropped", async () => {
  const r = await put(mentor, { extra: {
    approach: "  جلسات عملية قصيرة مع مهمة أسبوعية  ", city: "جدة", years: 10, birth_date: "1990-01-01", evil: "<script>",
    skills: ["React", "Node.js", "React", " SQL "],
    experience: [{ title: "مطوّرة أولى", org: "شركة", from: 2015, to: 2020, salary: 1 }, { title: "قائدة فريق", from: "2020", to: null }],
    qualifications: [{ name: "AWS Certified", issuer: "Amazon", year: 2022, link: "https://aws.amazon.com/certification/" }, { name: "بكالوريوس حاسب" }]
  } });
  assert.equal(r.status, 200, r.error);
  const x = r.profile.extra;
  assert.equal(x.approach, "جلسات عملية قصيرة مع مهمة أسبوعية"); assert.equal(x.city, "جدة"); assert.equal(x.years, 10);
  assert.deepEqual(x.skills, ["React", "Node.js", "SQL"]);
  assert.deepEqual(x.experience, [{ title: "مطوّرة أولى", org: "شركة", from: 2015, to: 2020 }, { title: "قائدة فريق", org: "", from: 2020, to: null }]);
  assert.deepEqual(x.qualifications, [{ name: "AWS Certified", issuer: "Amazon", year: 2022, link: "https://aws.amazon.com/certification/" }, { name: "بكالوريوس حاسب", issuer: "", year: null, link: null }]);
  assert.ok(!("birth_date" in x) && !("evil" in x));
  assert.ok(!JSON.stringify(r).includes("1990-01-01"));
  // partial patch keeps the other keys
  const p = await put(mentor, { extra: { city: "الرياض" } });
  assert.equal(p.profile.extra.city, "الرياض"); assert.equal(p.profile.extra.years, 10); assert.equal(p.profile.extra.experience.length, 2);
  // a key set to null clears only that key; a profile save without extra keeps it
  const q = await put(mentor, { extra: { skills: null, city: null } });
  assert.deepEqual(q.profile.extra.skills, []); assert.equal(q.profile.extra.city, ""); assert.equal(q.profile.extra.years, 10);
  const keep = await put(mentor, { headline: "مطوّرة ويب ومرشدة مهنية" });
  assert.equal(keep.profile.extra.years, 10);
});

test("extra: strict validation — lengths, list caps, https-only links, year bounds, types", async () => {
  const long = (n) => "ا".repeat(n);
  await bad({ extra: { approach: long(601) } }, "invalid_approach");
  assert.equal((await put(mentor, { extra: { approach: long(600) } })).status, 200);
  await bad({ extra: { city: long(61) } }, "invalid_city");
  await bad({ extra: { approach: 5 } }, "invalid_approach");
  for (const y of [-1, 61, 3.5, "ten", "100", true]) await bad({ extra: { years: y } }, "invalid_years");
  assert.equal((await put(mentor, { extra: { years: "0" } })).profile.extra.years, 0);
  await bad({ extra: { skills: Array.from({ length: 11 }, (_, i) => "s" + i) } }, "invalid_skills");
  await bad({ extra: { skills: [long(41)] } }, "invalid_skills");
  await bad({ extra: { skills: [""] } }, "invalid_skills");
  await bad({ extra: { skills: "React,Node" } }, "invalid_skills");
  const exp = (o) => ({ title: "مطوّرة", from: 2015, ...o });
  await bad({ extra: { experience: Array.from({ length: 9 }, () => exp()) } }, "invalid_experience");
  assert.equal((await put(mentor, { extra: { experience: Array.from({ length: 8 }, () => exp()) } })).profile.extra.experience.length, 8);
  for (const e of [exp({ title: "" }), exp({ title: long(81) }), exp({ org: long(81) }), exp({ from: 1949 }), exp({ from: 2028 }), exp({ from: undefined }), exp({ from: 2016.5 }), exp({ to: 2014 }), exp({ to: "x" }), "مطوّرة", null])
    await bad({ extra: { experience: [e] } }, "invalid_experience");
  assert.equal((await put(mentor, { extra: { experience: [exp({ to: 2027 })] } })).status, 200); // current year allowed
  const q = (o) => ({ name: "شهادة", ...o });
  await bad({ extra: { qualifications: Array.from({ length: 9 }, () => q()) } }, "invalid_qualifications");
  for (const v of [q({ name: "" }), q({ name: long(101) }), q({ issuer: long(81) }), q({ year: 1900 }), q({ year: 2030 }), 7])
    await bad({ extra: { qualifications: [v] } }, "invalid_qualifications");
  for (const link of ["http://example.com", "javascript:alert(1)", "data:text/html,x", "ftp://x.com/a", "https://user:pw@example.com", "https://localhost/x", "//example.com", "not a url", "https://e.com/" + "a".repeat(300), 42])
    await bad({ extra: { qualifications: [q({ link })] } }, "invalid_link");
  await bad({ extra: "approach" }, "invalid_extra");
  await bad({ extra: [1] }, "invalid_extra");
  // nothing from a rejected save was stored
  const now = await mentor.req("GET", "/api/mentor/me");
  assert.equal(now.profile.extra.experience.length, 1);
});

test("new profile can be created with all three at once; null extra resets; existing mentor API unchanged", async () => {
  const r = await put(fresh, { visibility: "members", fields: { age: "mentees" }, extra: { years: 3, skills: ["Figma"] } });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.profile.visibility, "members"); assert.equal(r.profile.fields.age, "mentees"); assert.deepEqual(r.profile.extra.skills, ["Figma"]);
  assert.equal(r.profile.headline, BASE.headline); assert.equal(r.profile.open, true);
  const z = await put(fresh, { extra: null });
  assert.deepEqual(z.profile.extra, { approach: "", skills: [], experience: [], qualifications: [], years: null, city: "", templates: [] });
  assert.equal(z.profile.visibility, "members");
  const row = await H.app.ctx.db.get("SELECT visibility, extra FROM mentor_profiles WHERE user_id=$1", [fresh.id]);
  assert.equal(row.visibility, "members"); assert.equal(row.extra, null);
});

test("a corrupt stored value is ignored at read time (defaults applied), not a 500", async () => {
  await H.app.ctx.db.run("UPDATE mentor_profiles SET visibility='weird', fields=$1, extra=$2 WHERE user_id=$3", [JSON.stringify({ age: "bogus", city: "public" }), JSON.stringify({ years: 999, city: "أبها", skills: "x" }), fresh.id]);
  const r = await fresh.req("GET", "/api/mentor/me");
  assert.equal(r.status, 200, r.error);
  assert.equal(r.profile.visibility, "public"); assert.equal(r.profile.fields.age, "off"); assert.equal(r.profile.fields.city, "public");
  assert.equal(r.profile.extra.years, null); assert.equal(r.profile.extra.city, "أبها"); assert.deepEqual(r.profile.extra.skills, []);
});
