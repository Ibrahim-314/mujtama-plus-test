/* 054 — widen phase 65 support-fund Pi amounts to BIGINT on PostgreSQL (v2.40.0 fix).
 * Amounts are 1e-7 Pi units, so INTEGER (max 2,147,483,647) overflowed above ~214.7 Pi (e.g. a 1,000 π round budget → 500).
 * SQLite INTEGER is already 64-bit, so this is a no-op there. Widening keeps every value; nothing is dropped.
 * down() is a no-op on purpose: narrowing back could fail on real data. */
const COLS = [["fund_rounds", "budget"], ["fund_rounds", "max_grant"], ["fund_applications", "amount"], ["fund_applications", "award"], ["fund_donations", "amount"]];
module.exports = {
  id: "054_fund_bigint",
  async up(db, exec) {
    if (db.dialect !== "postgres") return;
    for (const [t, c] of COLS) await exec(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE BIGINT`);
  },
  async down() { /* keep BIGINT */ }
};
