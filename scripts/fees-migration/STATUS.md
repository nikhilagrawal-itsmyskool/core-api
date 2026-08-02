# SchoolPad → ItsMySkool fee-data extraction — STATUS (2026-08-02)

## COMPLETE (all cross-validated, in out/, gitignored PII)
- **Receipts (Sweep A)** — 17,952 fee+transport receipts, 5 years, head-level detail. `A-<year>.ndjson`
- **Cancelled receipts (Sweep D)** — 693 voided receipts (header-level). `D-cancelled.ndjson`
- **Student ledgers (Sweep L)** — every student's charged/paid/outstanding + line entries, all 5 years.
  `L-<year>.ndjson`. Students/yr: 22-23=533, 23-24=568, 24-25=692, 25-26=678, 26-27=772.
  Total outstanding as-of extraction: 2026-27 = Rs 1.38cr (still collecting); prior years Rs 0.11-0.37cr.
- **Config — ALL 5 years** — structure, heads, cycles (w/ due dates), concessions. `config-*-<year>.json`

## CROSS-CHECK (independent validation — receipts vs ledgers)
- 2026-27: ledger paid-total matches receipts 572/572 ✓
- 2025-26: 649/650 ✓
- 2024-25: fee-only 630/632 ✓ (fee ledger EXCLUDES transport; TR transport receipts are separate 2022-25 — held in A-*.ndjson type='transport')
=> both datasets validated; numbers reconcile.

## EMPTY / N-A (confirmed, nothing to migrate)
- 2021-22 fees: none (school started SchoolPad fees in 2022-23)
- Adhoc/general payments: none used
- Security refunds: none processed in SchoolPad

## OPTIONAL REMAINING
- (none — historical config now pulled too)

## KEY FACTS FOR THE LOAD STEP
- Join to itsmyskool by **admission_number** (receipts + ledgers both carry it). SchoolPad internal
  student id (ledger URL) is NOT the admission no.
- Left/unmatched students: keep the name/class snapshot, null student_id, flag.
- Ledger = authoritative owed+paid+balance per student/year (the "opening position").
- Receipts = payment detail (mode, date, head split, receipt no).
- Data lives in out/ (gitignored); state/manifest.json (committed) tracks counts+watermarks for re-runs.

## HOW IT WAS PULLED (for re-runs)
MCP browser, session-bound endpoints. Login is flaky + Cloudflare-protected (needs a human to clear),
so this ran interactively, not headless. roll.js / roll-ledgers.js consolidate chunk files + update manifest.
