const test = require("node:test"), assert = require("node:assert");
const { badgeFor, annivAt } = require("../../server/lib/member-badges");
const D = 864e5, at = (s) => Date.parse(s);
test("new-member badge: 7-day boundary", () => {
  const j = "2026-10-01T10:00:00Z";
  assert.deepStrictEqual(badgeFor(j, at(j)), { kind: "new" });
  assert.deepStrictEqual(badgeFor(j, at(j) + 7 * D - 1), { kind: "new" });
  assert.strictEqual(badgeFor(j, at(j) + 7 * D), null);
  assert.strictEqual(badgeFor(j, at(j) - 1), null, "future join → no badge");
  assert.strictEqual(badgeFor(null), null); assert.strictEqual(badgeFor("garbage"), null);
});
test("anniversary window: the week starting on each anniversary", () => {
  const j = "2024-03-10T08:00:00Z";
  assert.strictEqual(badgeFor(j, at("2025-03-10T07:59:59Z")), null);
  assert.deepStrictEqual(badgeFor(j, at("2025-03-10T08:00:00Z")), { kind: "anniv", years: 1 });
  assert.deepStrictEqual(badgeFor(j, at("2025-03-17T07:59:59Z")), { kind: "anniv", years: 1 });
  assert.strictEqual(badgeFor(j, at("2025-03-17T08:00:00Z")), null);
  assert.deepStrictEqual(badgeFor(j, at("2026-03-12T00:00:00Z")), { kind: "anniv", years: 2 });
  assert.deepStrictEqual(badgeFor("2014-01-01T00:00:00Z", at("2026-01-03T00:00:00Z")), { kind: "anniv", years: 12 });
  assert.strictEqual(badgeFor(j, at("2025-09-01T00:00:00Z")), null);
});
test("anniversary across new year", () => {
  assert.deepStrictEqual(badgeFor("2024-12-29T00:00:00Z", at("2026-01-02T00:00:00Z")), { kind: "anniv", years: 1 });
});
test("leap year: Feb 29 join celebrates Feb 28 in common years, Feb 29 in leap years", () => {
  const j = "2024-02-29T12:00:00Z";
  assert.strictEqual(new Date(annivAt(new Date(j), 1)).toISOString(), "2025-02-28T12:00:00.000Z");
  assert.strictEqual(new Date(annivAt(new Date(j), 4)).toISOString(), "2028-02-29T12:00:00.000Z");
  assert.deepStrictEqual(badgeFor(j, at("2025-02-28T12:00:00Z")), { kind: "anniv", years: 1 });
  assert.deepStrictEqual(badgeFor(j, at("2025-03-06T12:00:00Z")), { kind: "anniv", years: 1 });
  assert.strictEqual(badgeFor(j, at("2025-03-07T12:00:00Z")), null);
});
test("owner: no «عضو جديد» badge, anniversary still shown", () => {
  const j = "2026-10-01T10:00:00Z";
  assert.strictEqual(badgeFor(j, at(j) + D, "owner"), null);
  assert.deepStrictEqual(badgeFor(j, at(j) + D, "admin"), { kind: "new" });
  assert.deepStrictEqual(badgeFor("2024-03-10T08:00:00Z", at("2025-03-11T08:00:00Z"), "owner"), { kind: "anniv", years: 1 });
});
