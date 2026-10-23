/* Double-entry ledger helpers shared by the Phase 37 tips service and the Phase 38 paid-content service.
 * Extracted verbatim from services/tips.js (behaviour unchanged). Append-only: nothing updates or deletes ledger rows.
 * Amounts are integer units of 1e-7 Pi (Pi has 7 decimals); balances are derived from the entries.
 * Accounts: `user:<id>:pi_out`, `creator:<id>:earnings`, `platform:fees`, `platform:held`. */
const { id } = require("./core");

const U = 1e7; // 1 Pi = 1e7 units
const toUnits = x => Math.round(Number(x) * U);
const pi = u => Math.round(Number(u || 0)) / U;
const ACC = { out: uid => `user:${uid}:pi_out`, earn: uid => `creator:${uid}:earnings`, fees: "platform:fees", held: "platform:held",
  // phase 59 — contribution rewards: the platform funds `platform:rewards_pool` (from `platform:rewards_funding`); an approved
  // points redemption moves pool → `user:<id>:rewards` (owed to the user); a staff payout with the Pi txid moves it → `platform:payouts`.
  rewardsFunding: "platform:rewards_funding", rewardsPool: "platform:rewards_pool", rewards: uid => `user:${uid}:rewards`, payouts: "platform:payouts",
  // phase 65 — creator support fund: staff funding (`platform:creator_fund_funding`) and members' donations fill `platform:creator_fund`;
  // an approved grant moves fund → `creator:<id>:grants` (owed); the staff payout with the Pi txid moves it → `platform:payouts`.
  fundFunding: "platform:creator_fund_funding", fundPool: "platform:creator_fund", grants: uid => `creator:${uid}:grants`,
  // phase 70 — transparent charity campaigns: donations (user pi_out) → `charity:<campaignId>:raised`; a staff disbursement to the
  // verified organisation's wallet, recorded with the Pi txid, moves raised → `platform:payouts`.
  campaign: cid => `charity:${cid}:raised` };

/** @param {{ now: () => string }} opts  now() returns the ISO timestamp written on journals and entries */
function createLedger({ now }) {
  /** Posts one balanced journal inside transaction `t`. Returns the journal id, or null when `ikey` was already posted. */
  async function postJournal(t, j) {
    const lines = j.lines.filter(l => (l.debit || 0) > 0 || (l.credit || 0) > 0);
    const d = lines.reduce((s, l) => s + (l.debit || 0), 0),
      c = lines.reduce((s, l) => s + (l.credit || 0), 0);
    if (
      lines.length < 2 ||
      d !== c ||
      lines.some(l => (l.debit || 0) < 0 || (l.credit || 0) < 0 || !Number.isInteger(l.debit || 0) || !Number.isInteger(l.credit || 0))
    )
      throw new Error("unbalanced journal " + j.ikey);
    const jid = id("jr"),
      at = now();
    const ins = await t.run(
      "INSERT INTO ledger_journals(id,ikey,kind,source,ref_id,creator_id,sender_id,post_id,anonymous,show_amount,reverses,pi_tx,memo,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING",
      [
        jid,
        j.ikey,
        j.kind,
        j.source,
        j.refId,
        j.creatorId || null,
        j.senderId || null,
        j.postId || null,
        j.anonymous ? 1 : 0,
        j.showAmount ? 1 : 0,
        j.reverses || null,
        j.piTx || null,
        j.memo || null,
        at
      ]
    );
    if (!ins.changes) return null;
    for (const l of lines)
      await t.run("INSERT INTO ledger_entries(journal_id,account,user_id,debit,credit,created_at) VALUES($1,$2,$3,$4,$5,$6)", [
        jid,
        l.account,
        l.userId || null,
        l.debit || 0,
        l.credit || 0,
        at
      ]);
    return jid;
  }
  /** payer → creator (+ platform fee) */
  const creditLines = (amount, fee, senderId, creatorId, fromHeld = false) => [
    fromHeld ? { account: ACC.held, debit: amount } : { account: ACC.out(senderId), userId: senderId, debit: amount },
    { account: ACC.earn(creatorId), userId: creatorId, credit: amount - fee },
    { account: ACC.fees, credit: fee }
  ];
  /** reverse every not-yet-reversed journal of a ref (tip / support payment / purchase): swap debit and credit */
  async function reverseAll(t, refId, memo) {
    const js = await t.all("SELECT * FROM ledger_journals WHERE ref_id=$1 AND kind<>'reversal' ORDER BY created_at, id", [refId]);
    let n = 0;
    for (const j of js) {
      if (await t.get("SELECT 1 x FROM ledger_journals WHERE reverses=$1", [j.id])) continue;
      const lines = (await t.all("SELECT account, user_id, debit, credit FROM ledger_entries WHERE journal_id=$1 ORDER BY id", [j.id])).map(e => ({
        account: e.account,
        userId: e.user_id,
        debit: Number(e.credit),
        credit: Number(e.debit)
      }));
      if (
        await postJournal(t, {
          ikey: "rev:" + j.id,
          kind: "reversal",
          source: j.source,
          refId: j.ref_id,
          creatorId: j.creator_id,
          senderId: j.sender_id,
          postId: j.post_id,
          anonymous: j.anonymous,
          showAmount: j.show_amount,
          reverses: j.id,
          piTx: j.pi_tx,
          memo,
          lines
        })
      )
        n++;
    }
    return n;
  }
  return { postJournal, creditLines, reverseAll };
}

/* Phase 57 — proration rules for creator subscription tier changes (Pi has no auto-debit: every charge is a payment the
 * subscriber confirms). Recorded here, next to the ledger, so every service applies the same money rules:
 *  1. Upgrade inside a paid period: pay only the difference for the time left —
 *       charge = ceil((newAmount − oldAmount) × remaining / period), remaining = activeUntil − now (0…period),
 *     rounded UP to a whole 0.01 π (PRORATION.step) so the amount is exact everywhere (pi_transactions.amount is REAL).
 *     The new tier applies when that payment completes; the period end does not move. A charge below PRORATION.minCharge
 *     (0.01 π) is waived and the upgrade applies at once for free.
 *  2. Downgrade: no refund and no credit for the unused part of the higher tier; it is scheduled and takes effect at the
 *     next renewal (the subscriber keeps the higher tier's benefits until activeUntil).
 *  3. Outside a paid period (lapsed, or in the grace window after activeUntil) there is nothing to prorate: the subscriber
 *     simply renews at the tier they choose (full monthly price).
 *  4. Cancel: benefits continue until activeUntil; no automatic refund (the phase 37 rule — staff may refund within 24 h of a
 *     payment — still applies, and a refunded upgrade payment reverts the tier).
 *  5. Fees: CREATOR_FEE_BPS applies to an upgrade charge exactly as to a monthly payment (creditLines).
 * Ledger: an upgrade charge is one journal (kind `support`, source `support`, ref = the sub_changes id); a refund reverses it. */
const PRORATION = { minCharge: 100000 /* 0.01 π */, step: 100000 /* charges are whole 0.01 π */ };
/** @returns {{ kind: "upgrade"|"downgrade"|"same"|"renew", charge: number, remainingMs: number, effectiveAt: string|null, waived?: boolean }} */
function prorate({ fromAmount, toAmount, activeUntil, at, periodMs, inPeriod = true }) {
  const from = Math.round(Number(fromAmount) || 0), to = Math.round(Number(toAmount) || 0);
  const until = activeUntil ? Date.parse(activeUntil) : 0;
  if (!inPeriod || !until || at >= until) return { kind: "renew", charge: to, remainingMs: 0, effectiveAt: null };
  if (to === from) return { kind: "same", charge: 0, remainingMs: until - at, effectiveAt: null };
  const remainingMs = Math.max(0, Math.min(periodMs, until - at));
  if (to < from) return { kind: "downgrade", charge: 0, remainingMs, effectiveAt: new Date(until).toISOString() };
  let charge = Math.ceil(((to - from) * remainingMs) / periodMs);
  const waived = charge < PRORATION.minCharge / 2; // below half a cent: free
  charge = Math.ceil(charge / PRORATION.step) * PRORATION.step;
  if (waived) charge = 0;
  return { kind: "upgrade", charge, remainingMs, effectiveAt: new Date(at).toISOString(), waived };
}

/* Phase 59 — rewards pool journals (all amounts integer 1e-7 Pi units). Balances: pool = credits − debits on ACC.rewardsPool. */
const REWARDS = {
  fund: (amount) => [{ account: ACC.rewardsFunding, debit: amount }, { account: ACC.rewardsPool, credit: amount }],
  reserve: (amount, uid) => [{ account: ACC.rewardsPool, debit: amount }, { account: ACC.rewards(uid), userId: uid, credit: amount }],
  payout: (amount, uid) => [{ account: ACC.rewards(uid), userId: uid, debit: amount }, { account: ACC.payouts, credit: amount }]
};
/* Phase 65 — creator support fund journals (integer 1e-7 Pi units). Pool balance = credits − debits on ACC.fundPool. */
const FUND = {
  fund: (amount) => [{ account: ACC.fundFunding, debit: amount }, { account: ACC.fundPool, credit: amount }],
  donate: (amount, uid) => [{ account: ACC.out(uid), userId: uid, debit: amount }, { account: ACC.fundPool, credit: amount }],
  reserve: (amount, uid) => [{ account: ACC.fundPool, debit: amount }, { account: ACC.grants(uid), userId: uid, credit: amount }],
  payout: (amount, uid) => [{ account: ACC.grants(uid), userId: uid, debit: amount }, { account: ACC.payouts, credit: amount }]
};
/* Phase 70 — charity campaign journals. Raised balance = credits − debits on ACC.campaign(cid). */
const CHARITY = {
  donate: (amount, uid, cid) => [{ account: ACC.out(uid), userId: uid, debit: amount }, { account: ACC.campaign(cid), credit: amount }],
  disburse: (amount, cid) => [{ account: ACC.campaign(cid), debit: amount }, { account: ACC.payouts, credit: amount }]
};
/** balance of one account (credits − debits) inside db or transaction `q` */
async function balance(q, account) {
  const r = await q.get("SELECT COALESCE(SUM(credit),0) c, COALESCE(SUM(debit),0) d FROM ledger_entries WHERE account=$1", [account]);
  return Number(r?.c || 0) - Number(r?.d || 0);
}

module.exports = { U, toUnits, pi, ACC, createLedger, PRORATION, prorate, REWARDS, FUND, CHARITY, balance };
