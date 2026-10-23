/* «مجتمع كوين» (MJT) stage 1 — the in-app double-entry ledger. NOT on any blockchain; no withdrawal.
 *
 * Money rules (every one is enforced here, below the services, and covered by tests/property tests):
 *  1. Integer minor units only: 1 MJT = 10,000,000 units (UNIT, the same 7 decimals a Pi/Stellar asset has, so stage 2 maps
 *     1:1). Amounts typed by people are parsed from decimal STRINGS digit by digit (parseAmount) — never through floats.
 *  2. Double entry: a transaction is ≥ 2 signed lines on distinct accounts whose amounts sum to exactly 0.
 *  3. Idempotency: every mutation carries an idempotency key; mjt_tx.ikey is UNIQUE. Posting an ikey twice is a replay that
 *     returns the first transaction (and refuses — 409 idempotency_conflict — if the request was different).
 *  4. No negative balances, no double spend: balances change only through a conditional UPDATE
 *     (`balance + delta >= 0` unless the account is sys:mint) inside the caller's DB transaction; zero rows → the whole
 *     transaction rolls back. A CHECK constraint on mjt_accounts is the second line of defence.
 *     Lock order (PostgreSQL): user accounts first (sorted by id), then system accounts (sorted) — the same order every
 *     transaction takes, so concurrent posts cannot deadlock.
 *  5. The cached balance equals SUM(entries) of the account; verify() re-derives everything from the entries.
 *  6. Accounts: user:<id> (≥ 0), sys:mint (the only account allowed below 0: minus everything ever issued), sys:burn
 *     (everything destroyed), sys:treasury (MJT the platform received, e.g. from purchases). Total supply in circulation =
 *     −balance(sys:mint) − balance(sys:burn) = Σ user balances + treasury. Σ of ALL balances is always 0. */
const { HttpError, id, sha } = require("./core");

const UNIT = 10_000_000; // minor units per 1 MJT
const DECIMALS = 7;
const MAX_LINE = 100_000_000 * UNIT; // 1e15 < Number.MAX_SAFE_INTEGER (9.007e15): one line never exceeds 100M MJT
const MAX_SUPPLY = 100_000_000 * UNIT; // total issued (−sys:mint) can never exceed 100M MJT
const SYS = { mint: "sys:mint", burn: "sys:burn", treasury: "sys:treasury" };
const SYS_NEG = new Set([SYS.mint]);
const userAcc = (uid) => "user:" + uid;
const isUserAcc = (a) => typeof a === "string" && /^user:[A-Za-z0-9_-]{1,64}$/.test(a);
const isSysAcc = (a) => Object.values(SYS).includes(a);

const fail = (status, code, msg, details) => Object.assign(new HttpError(status, msg, code), details ? { details } : {});

/** "12.5" | "0.0000001" | 3 → integer minor units. Rejects floats-with-exponent, > 7 decimals, ≤ 0 (unless allowNegative /
 *  allowZero), more than 8 integer digits. Throws 400 bad_amount. */
function parseAmount(v, { allowNegative = false, allowZero = false } = {}) {
  let s;
  if (typeof v === "number") { if (!Number.isFinite(v)) throw fail(400, "bad_amount", "مبلغ غير صالح"); s = String(v); }
  else if (typeof v === "string") s = v.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".");
  else throw fail(400, "bad_amount", "مبلغ غير صالح");
  const m = /^(-)?(\d{1,8})(?:\.(\d{1,7}))?$/.exec(s);
  if (!m) throw fail(400, "bad_amount", s.includes(".") && /\.\d{8,}$/.test(s) ? "أقصى دقة ٧ منازل عشرية" : "مبلغ غير صالح");
  const units = (Number(m[2]) * UNIT + Number((m[3] || "").padEnd(DECIMALS, "0"))) * (m[1] ? -1 : 1);
  if (!Number.isSafeInteger(units)) throw fail(400, "bad_amount", "مبلغ غير صالح");
  if (units < 0 && !allowNegative) throw fail(400, "bad_amount", "المبلغ يجب أن يكون موجباً");
  if (units === 0 && !allowZero) throw fail(400, "bad_amount", "المبلغ يجب أن يكون أكبر من صفر");
  return units;
}
/** integer minor units → "12.5" (exact, trailing zeros trimmed) */
function format(units) {
  const n = BigInt(Math.trunc(Number(units) || 0)), neg = n < 0n, a = neg ? -n : n, U = BigInt(UNIT);
  const int = a / U, frac = (a % U).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + int.toString() + (frac ? "." + frac : "");
}
/** canonical request fingerprint: same ikey + different request → 409 */
const reqHash = (j) => sha(JSON.stringify([j.kind, j.userId || null, j.otherId || null, j.refType || null, j.refId || null, [...j.lines].map((l) => [l.account, l.amount]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))]));
/** user accounts first, then system accounts; each group sorted — the global lock order */
const lockOrder = (a, b) => { const ua = isUserAcc(a) ? 0 : 1, ub = isUserAcc(b) ? 0 : 1; return ua - ub || (a < b ? -1 : a > b ? 1 : 0); };

/** @param {any} db @param {{ now: () => string }} opts */
function createMjtLedger(db, { now }) {
  const pg = db.dialect === "postgres";
  async function ensureAccount(t, account, at = now()) {
    if (isUserAcc(account)) await t.run("INSERT INTO mjt_accounts(id,kind,user_id,balance,allow_negative,status,receive,created_at,updated_at) VALUES($1,'user',$2,0,0,'active',1,$3,$3) ON CONFLICT DO NOTHING", [account, account.slice(5), at]);
    else if (isSysAcc(account)) await t.run("INSERT INTO mjt_accounts(id,kind,user_id,balance,allow_negative,status,receive,created_at,updated_at) VALUES($1,'system',NULL,0,$2,'active',0,$3,$3) ON CONFLICT DO NOTHING", [account, SYS_NEG.has(account) ? 1 : 0, at]);
    else throw new Error("unknown MJT account " + account);
  }
  async function ensureSystem() { for (const a of Object.values(SYS)) await ensureAccount(db, a); }
  /** row-lock user accounts (sorted) before reading balances / limits inside transaction t (PostgreSQL; SQLite transactions are
   *  already serialized on its single connection). Creates missing accounts. Returns Map id → { balance, status, receive }. */
  async function lock(t, accounts) {
    const out = new Map();
    for (const a of [...new Set(accounts)].sort(lockOrder)) {
      await ensureAccount(t, a);
      const r = await t.get(`SELECT id, balance, status, receive FROM mjt_accounts WHERE id=$1${pg ? " FOR UPDATE" : ""}`, [a]);
      out.set(a, { balance: Number(r.balance), status: r.status, receive: Number(r.receive) === 1 });
    }
    return out;
  }
  /** Post one balanced transaction inside DB transaction t.
   *  j = { ikey, kind, lines: [{ account, amount }] (signed), actorId?, userId?, otherId?, refType?, refId?, batchId?, reverses?,
   *        memo?, allowFrozen? }
   *  → { tx, replayed } ; throws 409 insufficient_balance / account_frozen / supply_cap / idempotency_conflict, 400 on a bad journal. */
  async function post(t, j) {
    if (typeof j.ikey !== "string" || !j.ikey || j.ikey.length > 200) throw new Error("MJT: idempotency key required");
    if (typeof j.kind !== "string" || !/^[a-z_]{2,32}$/.test(j.kind)) throw new Error("MJT: bad kind");
    const lines = j.lines || [];
    if (lines.length < 2) throw new Error("MJT: a transaction needs at least two lines");
    const seen = new Set(); let sum = 0, gross = 0;
    for (const l of lines) {
      if (!isUserAcc(l.account) && !isSysAcc(l.account)) throw new Error("MJT: unknown account " + l.account);
      if (seen.has(l.account)) throw new Error("MJT: account twice in one transaction " + l.account);
      seen.add(l.account);
      if (!Number.isSafeInteger(l.amount) || l.amount === 0 || Math.abs(l.amount) > MAX_LINE) throw new Error("MJT: bad line amount " + l.amount);
      sum += l.amount; if (l.amount > 0) gross += l.amount;
    }
    if (sum !== 0) throw new Error("MJT: unbalanced transaction " + j.ikey);
    const hash = reqHash(j), at = now(), txId = id("mt");
    const ins = await t.run("INSERT INTO mjt_tx(id,ikey,kind,amount,actor_id,user_id,other_id,ref_type,ref_id,batch_id,reverses,memo,req_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING",
      [txId, j.ikey, j.kind, gross, j.actorId || null, j.userId || null, j.otherId || null, j.refType || null, j.refId || null, j.batchId || null, j.reverses || null, j.memo ? String(j.memo).slice(0, 300) : null, hash, at]);
    if (!ins.changes) {
      const prev = await t.get("SELECT * FROM mjt_tx WHERE ikey=$1", [j.ikey]);
      if (!prev) throw fail(409, "idempotency_conflict", "تعذّر إتمام العملية، أعد المحاولة");
      if (prev.req_hash !== hash) throw fail(409, "idempotency_conflict", "مفتاح العملية مستخدم لطلب مختلف");
      return { tx: prev, replayed: true };
    }
    for (const l of [...lines].sort((a, b) => lockOrder(a.account, b.account))) {
      await ensureAccount(t, l.account, at);
      const r = await t.get(
        `UPDATE mjt_accounts SET balance = balance + $1, updated_at = $2 WHERE id = $3 AND (allow_negative = 1 OR balance + $1 >= 0)${l.amount < 0 && !j.allowFrozen ? " AND status = 'active'" : ""} RETURNING balance`,
        [l.amount, at, l.account]
      );
      if (!r) {
        const a = await t.get("SELECT balance, status FROM mjt_accounts WHERE id=$1", [l.account]);
        if (a && a.status !== "active" && l.amount < 0 && !j.allowFrozen) throw fail(409, "account_frozen", "المحفظة موقوفة مؤقتاً — تواصل مع الدعم");
        throw fail(409, "insufficient_balance", "رصيدك من مجتمع كوين لا يكفي", isUserAcc(l.account) ? { account: l.account } : undefined);
      }
      const bal = Number(r.balance);
      if (l.account === SYS.mint && -bal > MAX_SUPPLY) throw fail(409, "supply_cap", "تجاوز الحد الأعلى للإصدار");
      await t.run("INSERT INTO mjt_entries(tx_id,account_id,user_id,amount,balance_after,created_at) VALUES($1,$2,$3,$4,$5,$6)", [txId, l.account, isUserAcc(l.account) ? l.account.slice(5) : null, l.amount, bal, at]);
    }
    await t.run("INSERT INTO mjt_audit(action,actor_id,target,tx_id,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)", ["tx:" + j.kind, j.actorId || null, j.userId || null, txId, JSON.stringify({ ikey: j.ikey, gross: format(gross), ref: j.refId || null }), at]);
    return { tx: await t.get("SELECT * FROM mjt_tx WHERE id=$1", [txId]), replayed: false };
  }
  /** a transaction's lines, swapped → reversal lines */
  async function reversalLines(t, txId) {
    return (await t.all("SELECT account_id, amount FROM mjt_entries WHERE tx_id=$1 ORDER BY id", [txId])).map((e) => ({ account: e.account_id, amount: -Number(e.amount) }));
  }
  const balanceOf = async (q, account) => Number((await q.get("SELECT balance FROM mjt_accounts WHERE id=$1", [account]))?.balance || 0);
  const derivedOf = async (q, account) => Number((await q.get("SELECT COALESCE(SUM(amount),0) s FROM mjt_entries WHERE account_id=$1", [account]))?.s || 0);
  /** supply figures (minor units) */
  async function supply(q = db) {
    const minted = -(await balanceOf(q, SYS.mint)), burned = await balanceOf(q, SYS.burn), treasury = await balanceOf(q, SYS.treasury);
    const u = await q.get("SELECT COALESCE(SUM(balance),0) s, COUNT(*) n, COALESCE(SUM(CASE WHEN balance > 0 THEN 1 ELSE 0 END),0) h FROM mjt_accounts WHERE kind='user'");
    return { minted, burned, circulating: minted - burned, treasury, users: Number(u?.s || 0), holders: Number(u?.h || 0), accounts: Number(u?.n || 0) };
  }
  /** full integrity check, re-derived from mjt_entries. ok=false lists every problem. */
  async function verify(q = db) {
    const problems = [];
    const mism = await q.all("SELECT a.id, a.balance, COALESCE(SUM(e.amount),0) s FROM mjt_accounts a LEFT JOIN mjt_entries e ON e.account_id=a.id GROUP BY a.id, a.balance");
    for (const r of mism) if (Number(r.balance) !== Number(r.s)) problems.push(`balance_mismatch:${r.id}:${r.balance}≠${r.s}`);
    for (const r of await q.all("SELECT tx_id, COALESCE(SUM(amount),0) s, COUNT(*) n FROM mjt_entries GROUP BY tx_id")) if (Number(r.s) !== 0 || Number(r.n) < 2) problems.push(`unbalanced_tx:${r.tx_id}`);
    for (const r of await q.all("SELECT t.id FROM mjt_tx t LEFT JOIN mjt_entries e ON e.tx_id=t.id WHERE e.id IS NULL")) problems.push(`empty_tx:${r.id}`);
    for (const r of await q.all("SELECT e.id FROM mjt_entries e LEFT JOIN mjt_tx t ON t.id=e.tx_id WHERE t.id IS NULL")) problems.push(`orphan_entry:${r.id}`);
    for (const r of await q.all("SELECT id, balance FROM mjt_accounts WHERE allow_negative=0 AND balance < 0")) problems.push(`negative:${r.id}`);
    for (const r of await q.all("SELECT e.account_id, e.balance_after, a.balance FROM mjt_entries e JOIN mjt_accounts a ON a.id=e.account_id WHERE e.id IN (SELECT MAX(id) FROM mjt_entries GROUP BY account_id)")) if (Number(r.balance_after) !== Number(r.balance)) problems.push(`last_entry_mismatch:${r.account_id}`);
    const total = Number((await q.get("SELECT COALESCE(SUM(balance),0) s FROM mjt_accounts"))?.s || 0);
    if (total !== 0) problems.push(`total_not_zero:${total}`);
    const s = await supply(q);
    if (s.circulating !== s.users + s.treasury) problems.push(`supply_mismatch:${s.circulating}≠${s.users + s.treasury}`);
    return { ok: problems.length === 0, problems: problems.slice(0, 50), accounts: mism.length, supply: s, checkedAt: now() };
  }
  return { post, lock, ensureAccount, ensureSystem, reversalLines, balanceOf, derivedOf, supply, verify };
}

module.exports = { UNIT, DECIMALS, MAX_LINE, MAX_SUPPLY, SYS, userAcc, isUserAcc, isSysAcc, parseAmount, format, reqHash, lockOrder, createMjtLedger };
