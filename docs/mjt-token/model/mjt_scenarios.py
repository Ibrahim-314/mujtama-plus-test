#!/usr/bin/env python3
"""MJT sustainability scenarios — internal analysis only (مسودة داخلية — غير معتمدة).

WHAT THIS IS
  A parameterised projection of the INTERNAL MJT rewards balance (not a token, no price, no returns).
  It answers: at the current issuance rules, how fast do member balances (the "overhang") grow, how much of what
  is issued is ever used, and how long until the internal ledger's hard cap on everything ever minted (MAX_SUPPLY = 100,000,000 MJT,
  server/lib/mjt-ledger.js: −balance(sys:mint) may never exceed it) would be reached. It never forecasts a price, a value or a return.

INPUTS (exactly what the admin export produces)
  The owner exports three CSV tables from #/admin/mjt-economy  →  GET /api/admin/mjt/economy/export.csv
      ?table=summary&period=month   columns: metric,value   (all_time.*, balances.total (not issued), wallets,
                                                             active_wallets_30d, period.*, concentration.top10_share_pct)
      ?table=legacy&period=month    columns: sub,label,period_in,period_out,period_tx,all_in,all_out,all_tx
      ?table=flows&period=month     columns: metric,value   (inflow, outflow, gap, inflow.*, outflow.*, unused.*, ...)
  and runs:   python3 mjt_scenarios.py --data <folder with the three CSV files>
  File names are matched by the words "summary", "legacy", "flows" in the name (the export's default names
  mjt-economy-<table>-month-<date>.csv work as-is).

  With no --data the script runs on ASSUMED_BASELINE below. Those numbers are NOT production data: Hark has no
  admin session on the production database. Every output produced from them is labelled ASSUMED.

OUTPUT
  model/output/scenarios.md and model/output/scenarios.csv (or --out <folder>).

Policies compared for every growth scenario (they are what-ifs for the owner's decision, not decisions):
  A_current   legacy paths exactly as in v2.163.0 (all switches ON by default), phase-4 sources and services OFF
              (their real state today: amounts NULL, costs NULL).
  B_legacy_off  mining + daily check-in switched OFF from month 1 (mjt_settings key 'legacy'), point rewards kept,
              phase-4 sources ON at an assumed per-active rate, services ON at an assumed monthly use rate.
"""
import argparse, csv, glob, math, os, sys

MAX_SUPPLY = 100_000_000  # MJT — server/lib/mjt-ledger.js (internal ledger hard cap)
MINING_PER_DAY = 5        # MJT — server/services/mining.js DEFAULTS.rate
CHECKIN_PER_DAY = 1       # MJT — server/services/mining.js DEFAULTS.checkin
POINTS_DAILY_CAP = 150    # MJT — server/services/mjt.js DEFAULTS.rewards.dailyCap (1 point = 1 MJT)

# ---------------------------------------------------------------------------------------------------------------
# ASSUMED baseline (one 30-day month). Replace by running with --data. Field names mirror the export.
# ---------------------------------------------------------------------------------------------------------------
ASSUMED_BASELINE = {
    "source": "ASSUMED (no production export available to Hark)",
    "active_wallets_30d": 1000,          # wallets with >= 1 ledger movement in 30 days
    "wallets": 3000,
    "balances.total": 250_000.0,         # MJT held by members today (NOT issued; never added to issuance)
    "all_time.minted": 300_000.0,        # all_time.issuedNew + all_time.issuedLegacy + all_time.adminCredits (gross mint)
    "period.issuedNew": 0.0,             # REAL STATE: every phase-4 source ships disabled with amount NULL
    "period.spent": 0.0,                 # REAL STATE: every MJT service ships disabled with cost NULL
    "period.refunded": 0.0,
    # legacy issuance in the month, by sub (export table=legacy, period_in − period_out)
    "legacy.mining": 1000 * 0.30 * 12 * MINING_PER_DAY,     # 30% of active wallets mine ~12 days a month
    "legacy.checkin": 1000 * 0.40 * 15 * CHECKIN_PER_DAY,   # 40% check in ~15 days a month
    "legacy.points_reward": 2_000.0,                          # contribution points minted 1:1
    "legacy.points_conversion": 0.0,                          # one-time batch, already applied (if at all)
    "legacy.owner_grant": 0.0,
    "concentration.top10_share_pct": None,
}

SCENARIOS = {
    # monthly growth of active wallets; activity multiplier per active wallet
    "conservative": {"growth_pct": 2.0, "activity": 0.9},
    "medium": {"growth_pct": 6.0, "activity": 1.0},
    "high_growth": {"growth_pct": 15.0, "activity": 1.1},
}
# assumptions used ONLY by policy B (owner decisions that do not exist yet)
POLICY_B = {"new_issuance_per_active": 10.0,   # MJT per active wallet per month from phase-4 sources (ASSUMED)
            "service_use_pct_of_balance": 4.0}  # % of outstanding member balance spent on services per month (ASSUMED)
MONTHS = 24


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def load_export(folder):
    """Read the admin CSV export (summary, legacy, flows) into the baseline dict."""
    def find(word):
        hits = [p for p in glob.glob(os.path.join(folder, "*.csv")) if word in os.path.basename(p).lower()]
        if not hits:
            sys.exit(f"missing the '{word}' CSV in {folder} (export it from #/admin/mjt-economy, period=month)")
        return sorted(hits)[-1]

    def kv(path):
        with open(path, encoding="utf-8-sig") as f:
            return {r["metric"]: r["value"] for r in csv.DictReader(f)}

    s, fl = kv(find("summary")), kv(find("flows"))
    if s.get("period") not in (None, "month"):
        print(f"warning: summary period is '{s.get('period')}', the model expects period=month", file=sys.stderr)
    b = {"source": f"EXPORT {os.path.basename(find('summary'))} ({s.get('from', '?')} → {s.get('to', '?')})",
         "active_wallets_30d": _num(s.get("active_wallets_30d")) or 0,
         "wallets": _num(s.get("wallets")) or 0,
         "balances.total": _num(s.get("balances.total (not issued)")) or 0,
         "all_time.minted": sum(_num(s.get(k)) or 0 for k in ("all_time.issuedNew", "all_time.issuedLegacy", "all_time.adminCredits")),
         "period.issuedNew": _num(s.get("period.issuedNew")) or 0,
         "period.spent": _num(s.get("period.spent")) or 0,
         "period.refunded": _num(s.get("period.refunded")) or 0,
         "concentration.top10_share_pct": _num(s.get("concentration.top10_share_pct")),
         "flows.unused.accumulated": _num(fl.get("unused.accumulated"))}
    with open(find("legacy"), encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            b["legacy." + r["sub"]] = (_num(r["period_in"]) or 0) - (_num(r["period_out"]) or 0)
    return b


def project(base, scen, policy):
    act0 = max(1.0, base["active_wallets_30d"])
    per_active = {k: v / act0 for k, v in base.items() if k.startswith("legacy.") and v}
    new_per_active = base["period.issuedNew"] / act0
    spend_rate = (base["period.spent"] - base["period.refunded"]) / base["balances.total"] if base["balances.total"] > 0 else 0.0
    if policy == "B_legacy_off":
        per_active.pop("legacy.mining", None)
        per_active.pop("legacy.checkin", None)
        new_per_active = POLICY_B["new_issuance_per_active"]
        spend_rate = POLICY_B["service_use_pct_of_balance"] / 100
    bal, issued_cum, spent_cum, rows, cap_month = base["balances.total"], 0.0, 0.0, [], None
    minted0 = base.get("all_time.minted") or 0.0
    for m in range(1, MONTHS + 1):
        active = act0 * (1 + scen["growth_pct"] / 100) ** m
        legacy = sum(v for v in per_active.values()) * active * scen["activity"]
        new = new_per_active * active * scen["activity"]
        issued = legacy + new
        spent = min(bal + issued, (bal + issued) * spend_rate)
        bal = bal + issued - spent
        issued_cum += issued
        spent_cum += spent
        if cap_month is None and minted0 + issued_cum >= MAX_SUPPLY:
            cap_month = m
        rows.append({"month": m, "active_wallets": round(active), "issued_legacy": round(legacy), "issued_new": round(new),
                     "issued_total": round(issued), "spent_net": round(spent), "member_balances_end": round(bal),
                     "balance_per_active": round(bal / active, 1),
                     "use_rate_pct": round(100 * spent_cum / issued_cum, 1) if issued_cum else 0.0,
                     "minted_share_of_internal_cap_pct": round(100 * (minted0 + issued_cum) / MAX_SUPPLY, 3)})
    return rows, cap_month


def months_to_cap(base, scen, policy):
    """extend the same rules up to 50 years to find when everything ever minted would reach the 100M internal cap"""
    global MONTHS
    keep, MONTHS = MONTHS, 600
    try:
        _, m = project(base, scen, policy)
    finally:
        MONTHS = keep
    return m


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="folder with the admin CSV export (summary, legacy, flows; period=month)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "output"))
    a = ap.parse_args()
    base = load_export(a.data) if a.data else dict(ASSUMED_BASELINE)
    label = "REAL EXPORT" if a.data else "ASSUMED — افتراضي، ليست بيانات إنتاج"
    os.makedirs(a.out, exist_ok=True)
    all_rows, summary = [], []
    for sname, scen in SCENARIOS.items():
        for policy in ("A_current", "B_legacy_off"):
            rows, _ = project(base, scen, policy)
            for r in rows:
                all_rows.append({"scenario": sname, "policy": policy, **r})
            last, m12 = rows[-1], rows[11]
            cap = months_to_cap(base, scen, policy)
            summary.append((sname, policy, m12, last, cap))
    with open(os.path.join(a.out, "scenarios.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        w.writeheader(); w.writerows(all_rows)
    L = [f"# MJT scenarios — {label}", "",
         "> مسودة داخلية — غير معتمدة وليست إعلانًا للأعضاء. أرقام رصيد داخلي فقط: لا سعر، لا قيمة، لا عائد.", "",
         f"Baseline source: **{base['source']}**", "",
         "## Baseline (one 30-day month)", "", "| field | value |", "|---|---|"]
    for k, v in base.items():
        if k != "source":
            L.append(f"| `{k}` | {v if v is not None else '—'} |")
    L += ["", "## Scenario parameters", "", "| scenario | active-wallet growth / month | activity multiplier |", "|---|---|---|"]
    for k, s in SCENARIOS.items():
        L.append(f"| {k} | {s['growth_pct']}% | {s['activity']} |")
    L += ["", f"Policy B assumptions (ASSUMED owner decisions): phase-4 issuance {POLICY_B['new_issuance_per_active']} MJT per active wallet per month; "
          f"services use {POLICY_B['service_use_pct_of_balance']}% of outstanding balances per month; mining + check-in OFF.", "",
          "## Results", "",
          "| scenario | policy | active wallets m12 | issued m12 (MJT/month) | member balances m12 | member balances m24 | balance / active m24 | cumulative use rate m24 | months until total minted hits the 100M internal cap |",
          "|---|---|---|---|---|---|---|---|---|"]
    for sname, policy, m12, last, cap in summary:
        L.append(f"| {sname} | {policy} | {m12['active_wallets']:,} | {m12['issued_total']:,} | {m12['member_balances_end']:,} | {last['member_balances_end']:,} | "
                 f"{last['balance_per_active']:,} | {last['use_rate_pct']}% | {cap if cap else '> 600'} |")
    L += ["", "Reading guide: *member balances* is the unused overhang (MJT held, never a liability of the project). "
          "*use rate* = MJT spent on services ÷ MJT issued over the horizon. A use rate of 0% means every issued MJT is still sitting in wallets.",
          "", "Full monthly series: `scenarios.csv` (same folder).", ""]
    with open(os.path.join(a.out, "scenarios.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L))
    print("\n".join(L))


if __name__ == "__main__":
    main()
