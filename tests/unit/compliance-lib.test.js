/* Track 7 — Phase 34 unit tests (pure logic): periods and labels, small-count suppression, medians, PDPL deadlines,
 * reporter timeline, consent state, retention rules, export column cleaning, the dependency-free ZIP writer (verified
 * independently with Python's zipfile when available) and the plain-language policy documents. */
const test = require("node:test"),
  assert = require("node:assert"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const L = require("../../server/lib/compliance-lib");
const P = require("../../server/lib/compliance-policies");

test("periods: month and quarter ranges (UTC, end exclusive), previous finished period, Arabic labels", () => {
  assert.deepEqual(L.periodRange("2026-09"), { period: "2026-09", kind: "month", start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" });
  assert.equal(L.periodRange("2026-12").end, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(L.periodRange("2026-Q4"), { period: "2026-Q4", kind: "quarter", start: "2026-10-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" });
  for (const bad of ["2026-13", "2026-00", "2026-Q5", "x", "", null]) assert.equal(L.periodRange(bad), null, String(bad));
  assert.equal(L.previousPeriod("month", new Date("2026-10-16T03:00:00Z")), "2026-09");
  assert.equal(L.previousPeriod("month", new Date("2026-01-05T00:00:00Z")), "2025-12");
  assert.equal(L.previousPeriod("quarter", new Date("2026-10-16T00:00:00Z")), "2026-Q3");
  assert.equal(L.previousPeriod("quarter", new Date("2026-02-01T00:00:00Z")), "2025-Q4");
  assert.equal(L.periodLabel("2026-09"), "سبتمبر 2026");
  assert.equal(L.periodLabel("2026-Q3"), "الربع الثالث 2026");
});

test("aggregation: suppression keeps zeros and totals honest, median, countBy", () => {
  assert.deepEqual(L.suppress({ post: 12, user: 1, message: 0, comment: 2 }, 3), { post: 12, user: "<3", message: 0, comment: "<3" });
  assert.deepEqual(L.suppress({ a: 1 }, 0), { a: 1 });
  assert.equal(L.median([5, 1, 3]), 3);
  assert.equal(L.median([4, 1, 3, 2]), 2.5);
  assert.equal(L.median([]), null);
  assert.equal(L.median([NaN, 2]), 2);
  assert.deepEqual(L.countBy([{ k: "a" }, { k: "b" }, { k: "a" }, {}], "k"), { a: 2, b: 1, other: 1 });
});

test("deadlines: data-subject requests 30 days, breach notification 72 hours, deadline states", () => {
  assert.equal(L.dsrDue("2026-10-01T00:00:00.000Z"), "2026-10-31T00:00:00.000Z");
  assert.equal(L.breachDue("2026-10-01T00:00:00.000Z"), "2026-10-04T00:00:00.000Z");
  const now = Date.parse("2026-10-03T00:00:00Z"),
    W = 72 * 3600e3;
  assert.equal(L.deadlineState("2026-10-04T00:00:00Z", null, W, now), "ok");
  assert.equal(L.deadlineState("2026-10-03T12:00:00Z", null, W, now), "soon");
  assert.equal(L.deadlineState("2026-10-02T00:00:00Z", null, W, now), "overdue");
  assert.equal(L.deadlineState("2026-10-02T00:00:00Z", "2026-10-01T10:00:00Z", W, now), "done");
});

test("reporter timeline: open → review current; actioned / dismissed outcomes; reversed on appeal", () => {
  const open = L.reportTimeline({ status: "open", created_at: "2026-10-01T00:00:00Z" }, { hidden: true });
  assert.deepEqual(
    open.map(s => s.key),
    ["received", "review", "decision"]
  );
  assert.equal(open[1].current, true);
  assert.match(open[1].detail, /أُخفي/);
  const act = L.reportTimeline({ status: "actioned", created_at: "a", resolved_at: "b" });
  assert.equal(act.at(-1).outcome, "actioned");
  assert.ok(act.every(s => s.done));
  assert.equal(L.reportTimeline({ status: "dismissed", created_at: "a", resolved_at: "b" }).at(-1).outcome, "dismissed");
  assert.equal(L.reportTimeline({ status: "actioned", created_at: "a", resolved_at: "b" }, { restored: true }).at(-1).key, "appeal");
});

test("consents: required purposes always on, optional defaults, latest row wins, unknown purposes ignored", () => {
  const s0 = L.consentState([]);
  assert.equal(s0.service.granted, true);
  assert.equal(s0.analytics.granted, true);
  assert.equal(s0.marketing_email.granted, false);
  assert.equal(s0.analytics.explicit, false);
  const s1 = L.consentState([
    { id: 1, purpose: "analytics", granted: 0, at: "2026-10-01" },
    { id: 2, purpose: "analytics", granted: 1, at: "2026-10-02" },
    { id: 3, purpose: "service", granted: 0, at: "2026-10-03" },
    { id: 4, purpose: "zzz", granted: 1, at: "x" }
  ]);
  assert.equal(s1.analytics.granted, true);
  assert.equal(s1.analytics.at, "2026-10-02");
  assert.equal(s1.service.granted, true);
  assert.ok(!s1.zzz);
  const same = L.consentState([
    { id: 7, purpose: "analytics", granted: 1, at: "t" },
    { id: 8, purpose: "analytics", granted: 0, at: "t" }
  ]);
  assert.equal(same.analytics.granted, false, "same timestamp: higher id wins");
  for (const P0 of Object.values(L.PURPOSES)) assert.ok(L.BASIS_LABEL[P0.basis]);
});

test("retention rules: defaults, overrides, media blobs opt-in, nothing for audit log; data map is consistent", () => {
  const def = L.retentionRules();
  assert.ok(
    def.find(r => r.type === "media_blobs" && !r.enabled),
    "media blobs disabled by default"
  );
  assert.ok(!def.find(r => r.t === "audit_log"), "audit log has no retention rule");
  const o = L.retentionRules({ search_history: { days: 30, enabled: 1 }, analytics_events: { enabled: 0 }, email_log: { days: 0 } });
  assert.equal(o.find(r => r.type === "search_history").days, 30);
  assert.equal(o.find(r => r.type === "analytics_events").enabled, false);
  assert.equal(o.find(r => r.type === "email_log").days, 365, "invalid override falls back to the default");
  const ident = /^[a-z_]+$/;
  for (const r of L.RETENTION) {
    assert.match(r.t, ident);
    assert.match(r.at, ident);
    if (r.key) assert.match(r.key, ident);
    assert.ok(r.label);
  }
  const tables = new Set();
  for (const m of L.DATA_MAP) {
    assert.ok(!tables.has(m.t), "one entry per table: " + m.t);
    tables.add(m.t);
    assert.ok(L.PURPOSES[m.purpose], m.t);
    assert.ok(["delete", "scrub", "keep", "anon"].includes(m.erase), m.t);
    assert.match(m.user, /\$1/);
    assert.ok(m.category && m.retention);
  }
  assert.equal(L.cutoff(1, Date.parse("2026-10-02T00:00:00Z")), "2026-10-01T00:00:00.000Z");
});

test("export cleaning drops secrets and limits columns", () => {
  assert.deepEqual(L.cleanRow({ id: 1, password_hash: "x", token_hash: "y", name: "n" }, null), { id: 1, name: "n" });
  assert.deepEqual(L.cleanRow({ id: 1, ip: "1.2.3.4", token_hash: "y", ua: "u" }, ["ip", "ua"]), { ip: "1.2.3.4", ua: "u" });
});

test("ZIP writer: round-trips UTF-8 names and binary, CRC32 matches the standard check value, readable by Python zipfile", () => {
  assert.equal(L.crc32(Buffer.from("123456789")), 0xcbf43926);
  const files = [
    { name: "README.txt", data: "نسخة من بياناتك ✓" },
    { name: "data/منشورات.json", data: JSON.stringify([{ a: 1 }]) },
    { name: "media/x.bin", data: Buffer.from([0, 1, 2, 255]) }
  ];
  const z = L.zip(files, new Date(2026, 9, 16, 12, 30, 10));
  const back = L.unzip(z);
  assert.deepEqual(
    back.map(f => f.name),
    files.map(f => f.name)
  );
  assert.ok(back.every(f => f.crcOk));
  assert.equal(back[0].data.toString(), "نسخة من بياناتك ✓");
  assert.deepEqual([...back[2].data], [0, 1, 2, 255]);
  const tmp = path.join(os.tmpdir(), `cmp-${process.pid}.zip`);
  fs.writeFileSync(tmp, z);
  let py = null;
  try {
    py = execFileSync(
      "python3",
      [
        "-c",
        "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps([i.filename for i in z.infolist()],ensure_ascii=False))",
        tmp
      ],
      { encoding: "utf8" }
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  if (py)
    assert.deepEqual(
      JSON.parse(py),
      files.map(f => f.name)
    );
  fs.unlinkSync(tmp);
});

test("grace period: default 30, env override, clamped to 0–90", () => {
  assert.equal(L.GRACE_DAYS({}), 30);
  assert.equal(L.GRACE_DAYS({ COMPLIANCE_DELETION_GRACE_DAYS: "14" }), 14);
  assert.equal(L.GRACE_DAYS({ COMPLIANCE_DELETION_GRACE_DAYS: "0" }), 0);
  assert.equal(L.GRACE_DAYS({ COMPLIANCE_DELETION_GRACE_DAYS: "400" }), 90);
  assert.equal(L.GRACE_DAYS({ COMPLIANCE_DELETION_GRACE_DAYS: "abc" }), 30);
  assert.ok(L.anonHandle("AbC-123_xyz!!").startsWith("deleted_abc123"));
});

test("policies: plain-language documents with summaries, unique section ids, deployment facts from env only", () => {
  const docs = P.documents({});
  assert.deepEqual(
    docs.map(d => d.slug),
    ["terms", "privacy", "retention"]
  );
  for (const d of docs) {
    assert.ok(d.title && d.version && /^\d{4}-\d{2}-\d{2}$/.test(d.effective));
    assert.ok(d.summary.length >= 3 && d.summary.every(s => s.length < 140), d.slug + ": summary is short");
    const ids = d.sections.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of d.sections) {
      assert.ok(s.heading && s.body.length, d.slug + "/" + s.id);
      for (const p of s.body) assert.ok(typeof p === "string" && p.length && !/undefined|null|\[object/.test(p), d.slug + "/" + s.id + ": " + p);
    }
  }
  const privacy = docs[1].sections.map(s => s.body.join(" ")).join(" ");
  assert.match(privacy, /72 ساعة/);
  assert.match(privacy, /30 يوماً/);
  assert.match(privacy, /سدايا/);
  assert.match(privacy, /خارج المملكة/, "no hosting region configured: the text does not claim in-Kingdom storage");
  const withEnv = P.documents({
    COMPLIANCE_CONTACT_EMAIL: "privacy@example.sa",
    COMPLIANCE_HOSTING_REGION: "المملكة العربية السعودية",
    COMPLIANCE_DELETION_GRACE_DAYS: "14"
  });
  const all = JSON.stringify(withEnv);
  assert.match(all, /privacy@example\.sa/);
  assert.match(all, /تُخزَّن البيانات لدى مزوّد الاستضافة في: المملكة العربية السعودية/);
  assert.match(all, /مهلة 14 يوماً/);
});
