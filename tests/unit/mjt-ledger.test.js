/* v2.47 unit — MJT ledger primitives (server/lib/mjt-ledger.js): exact decimal parsing/formatting (no floats), request
 * fingerprints, lock order, and journal validation that rejects a bad transaction BEFORE any SQL runs. */
const test = require("node:test"), assert = require("node:assert");
const L = require("../../server/lib/mjt-ledger");

test("parseAmount ↔ format round-trip over random decimal strings (no float drift)", () => {
  let x = 42; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 5000; i++) {
    const int = String(Math.floor(rnd() * 1e8)), dec = rnd() < 0.7 ? String(Math.floor(rnd() * 1e7)).padStart(7, "0").replace(/0+$/, "") : "";
    const s = dec ? `${int}.${dec}` : int;
    if (s === "0") continue;
    const u = L.parseAmount(s); assert.ok(Number.isSafeInteger(u)); assert.equal(L.format(u), s.replace(/^0+(?=\d)/, ""));
  }
  assert.equal(L.parseAmount("0.1") + L.parseAmount("0.2"), L.parseAmount("0.3"), "0.1 + 0.2 = 0.3 exactly in units");
  assert.equal(L.format(L.parseAmount("99999999.9999999")), "99999999.9999999");
});

test("accounts, lock order, fingerprints", () => {
  assert.equal(L.userAcc("u_1"), "user:u_1"); assert.ok(L.isUserAcc("user:u_1")); assert.ok(!L.isUserAcc("user:../x")); assert.ok(L.isSysAcc("sys:mint")); assert.ok(!L.isSysAcc("sys:other"));
  const sorted = ["sys:mint", "user:b", "sys:burn", "user:a"].sort(L.lockOrder); assert.deepEqual(sorted, ["user:a", "user:b", "sys:burn", "sys:mint"]);
  const j = { kind: "transfer", userId: "a", otherId: "b", lines: [{ account: "user:a", amount: -5 }, { account: "user:b", amount: 5 }] };
  assert.equal(L.reqHash(j), L.reqHash({ ...j, lines: [...j.lines].reverse(), memo: "ignored" }), "line order and memo do not matter");
  assert.notEqual(L.reqHash(j), L.reqHash({ ...j, lines: [{ account: "user:a", amount: -6 }, { account: "user:b", amount: 6 }] }));
});

test("post() rejects bad transactions before touching the database", async () => {
  const db = { dialect: "sqlite", run: async () => { throw new Error("SQL must not run"); }, get: async () => { throw new Error("SQL must not run"); }, all: async () => [] };
  const led = L.createMjtLedger(db, { now: () => new Date().toISOString() });
  const bad = [
    { ikey: "", kind: "transfer", lines: [{ account: "user:a", amount: -1 }, { account: "user:b", amount: 1 }] },
    { ikey: "k1", kind: "Transfer!", lines: [{ account: "user:a", amount: -1 }, { account: "user:b", amount: 1 }] },
    { ikey: "k2", kind: "transfer", lines: [{ account: "user:a", amount: -1 }] },
    { ikey: "k3", kind: "transfer", lines: [{ account: "user:a", amount: -1 }, { account: "user:b", amount: 2 }] },
    { ikey: "k4", kind: "transfer", lines: [{ account: "user:a", amount: -1.5 }, { account: "user:b", amount: 1.5 }] },
    { ikey: "k5", kind: "transfer", lines: [{ account: "user:a", amount: 0 }, { account: "user:b", amount: 0 }] },
    { ikey: "k6", kind: "transfer", lines: [{ account: "user:a", amount: -1 }, { account: "user:a", amount: 1 }] },
    { ikey: "k7", kind: "transfer", lines: [{ account: "bank:x", amount: -1 }, { account: "user:b", amount: 1 }] },
    { ikey: "k8", kind: "mint", lines: [{ account: "sys:mint", amount: -(L.MAX_LINE + 1) }, { account: "user:b", amount: L.MAX_LINE + 1 }] }
  ];
  for (const j of bad) await assert.rejects(() => led.post(db, j), (e) => /MJT:/.test(e.message), j.ikey);
});
