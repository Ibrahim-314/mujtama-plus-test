# MJT scenarios — ASSUMED — افتراضي، ليست بيانات إنتاج

> مسودة داخلية — غير معتمدة وليست إعلانًا للأعضاء. أرقام رصيد داخلي فقط: لا سعر، لا قيمة، لا عائد.

Baseline source: **ASSUMED (no production export available to Hark)**

## Baseline (one 30-day month)

| field | value |
|---|---|
| `active_wallets_30d` | 1000 |
| `wallets` | 3000 |
| `balances.total` | 250000.0 |
| `all_time.minted` | 300000.0 |
| `period.issuedNew` | 0.0 |
| `period.spent` | 0.0 |
| `period.refunded` | 0.0 |
| `legacy.mining` | 18000.0 |
| `legacy.checkin` | 6000.0 |
| `legacy.points_reward` | 2000.0 |
| `legacy.points_conversion` | 0.0 |
| `legacy.owner_grant` | 0.0 |
| `concentration.top10_share_pct` | — |

## Scenario parameters

| scenario | active-wallet growth / month | activity multiplier |
|---|---|---|
| conservative | 2.0% | 0.9 |
| medium | 6.0% | 1.0 |
| high_growth | 15.0% | 1.1 |

Policy B assumptions (ASSUMED owner decisions): phase-4 issuance 10.0 MJT per active wallet per month; services use 4.0% of outstanding balances per month; mining + check-in OFF.

## Results

| scenario | policy | active wallets m12 | issued m12 (MJT/month) | member balances m12 | member balances m24 | balance / active m24 | cumulative use rate m24 | months until total minted hits the 100M internal cap |
|---|---|---|---|---|---|---|---|---|
| conservative | A_current | 1,268 | 29,677 | 570,120 | 976,109 | 606.9 | 0.0% | 225 |
| conservative | B_legacy_off | 1,268 | 13,697 | 268,719 | 311,181 | 193.5 | 81.7% | 263 |
| medium | A_current | 2,012 | 52,317 | 714,936 | 1,650,477 | 407.6 | 0.0% | 93 |
| medium | B_legacy_off | 2,012 | 24,146 | 324,072 | 542,434 | 134.0 | 54.8% | 106 |
| high_growth | A_current | 5,350 | 153,017 | 1,203,865 | 6,307,280 | 220.3 | 0.0% | 44 |
| high_growth | B_legacy_off | 5,350 | 70,623 | 516,542 | 2,260,580 | 79.0 | 28.1% | 50 |

Reading guide: *member balances* is the unused overhang (MJT held, never a liability of the project). *use rate* = MJT spent on services ÷ MJT issued over the horizon. A use rate of 0% means every issued MJT is still sitting in wallets.

Full monthly series: `scenarios.csv` (same folder).
