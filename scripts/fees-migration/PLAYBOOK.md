# SchoolPad → ItsMySkool fees migration — PLAYBOOK & decision record

Purpose: migrate the **next** SchoolPad school in one clean pass and avoid the ~18 correction
scripts DBPASN needed. Companion to `STATUS.md` (extraction). Read this before touching the loader.

DBPASN was migrated correctly in the end (reconciled to the rupee, all 5 years), but only after
many cleanup passes. Every one of those passes traces to a single mistake — see the Golden Rule.

---

## THE GOLDEN RULE

**Carry the source's own truth faithfully in ONE deterministic, id-first pass. Never reconstruct
from labels, defs, or heuristics when the source already states the fact.**

SchoolPad gives three facts you can trust to the rupee. The DBPASN loader re-derived each and that
caused nearly all rework:

| Source fact (trust it)                                   | What we did instead              | Rework it caused |
|---------------------------------------------------------|----------------------------------|------------------|
| Receipt's **`cycle_set`** = the cycles a payment covers | spread paid total in fixed order | `reallocate-payments.js` (≈572 students mis-tagged) |
| Ledger's **actual credit/debit amounts** + running balance | dropped reversals & null-amount rows | `patch-reversals.js` (−₹24.77L outstanding) |
| Ledger's **concession credit amount** (the real ₹)      | recomputed from unreliable defs  | `reconcile`/`reattach`/`revert-reconcile.js` (−₹8.18L, reverted) |

If the loader had done these three things at load time, the correction scripts would not exist.

---

## THE CORRECT LOAD PIPELINE (order matters)

Config must exist before anything references it, so ids resolve at insert time — not via a later
backfill. Run per academic year; every step dry-run-by-default, idempotent, additive.

```
1. config      heads + cycles + structure + concession defs   (load-config.js)   → ids exist first
2. students    admission_number → student.uuid map            (+ old_admission_number + name fallback)
3. ledger      L-*.ndjson: debit→charge, neg-debit→concession credit (carry ₹), resolve fee_head_id + fee_cycle_id NOW
4. receipts    A-*.ndjson: payments allocated across the receipt's own cycle_set (chronological, honour partials + spill)
5. cancelled   D-*.ndjson: status='cancelled', preserve for record, ZERO ledger effect
6. relink      back-fill student_id on parked null-student rows (renumbered / left students)
7. AUDIT GATE  audit-fees.js must show 0 discrepancies to the rupee BEFORE calling it done
```

Load config FIRST (DBPASN loaded it last → blank Setup/Structure/Concession screens, retrofitted).

---

## DECISIONS & LESSONS (each = a cleanup script we should never need again)

1. **ID-first, not label-first.** Resolve `fee_head_id` and `fee_cycle_id` per-year at insert time
   from the config label→id map. Never store only labels and backfill (`backfill-ledger-ids.js`).
   Concession credits inherit ids from the charge they settle (via `settles_entry_id`).

2. **Payments follow the receipt's `cycle_set`.** Allocate each receipt's paid amount across the
   cycles it names, in cycle order, honouring partials, with **chronological spill** onto the next
   unpaid cycle when a receipt repeats an already-paid cycle (e.g. TOA). This is the whole of
   `reallocate-payments.js` — do it in the first load, not after.

3. **Concessions: carry the ledger amount, never recompute from defs (historical years).** Prior-year
   defs are unreliable (a 25% discount stored as `amount 25`; the real credit is ₹225). Use the def
   only for the **target head**, never the value. Def-value reconcile is **current-year only**, and
   only **after** ids are backfilled (running it on null-`fee_head_id` charges stripped ₹8.18L →
   `revert-reconcile.js`). Guard: skip any charge with null `fee_head_id`.

4. **Parse the ledger completely — silent drops understate money owed.** Two edge cases the first
   loader missed (`patch-reversals.js`):
   - **Payment reversals**: a cancelled receipt appears as the original +credit PLUS a later
     **negative-credit** row (e.g. "Month Mismatch" −10500). Post the negative as a `kind='adjust'`
     debit, **unallocated** (so it doesn't perturb FIFO).
   - **Null-amount rows**: numeric debit/credit null but the running balance moves — recover the
     amount from the **balance delta**.

5. **Transport is SEPARATE — decide it up front.** Fee ledger EXCLUDES transport. 2022-25 transport =
   its own `TR` receipts (`type='transport'`, no ledger charges). Filter `type <> 'transport'` in
   reallocate + audit from the start (retrofitting this alone dropped 2022-23 mismatches 317→7).
   **Risk:** 2025-26 & 2026-27 van fees are FREE-TEXT REMARKS on `FR` receipts, not `TR` — needs a
   manual reconcile decision per school.

6. **Concession → correct charge by (target head + own cycle).** DBPASN mis-linked the CAUTION ₹2500
   waiver onto the Registration charge (`reconcile-concessions.js`, over-application). Link id-based.

7. **Expect J↔S re-admission renumbering.** Some students exist under a NEW admission number; the old
   number is NOT in `old_admission_number` → unmatchable by number. Build the map with
   `old_admission_number` + **name fallback** + a `relink-map.json` for ambiguous cases. Parking
   unmatched as `null student_id` + snapshot and reconciling later (`relink-unmatched.js`) is fine —
   just plan for it, don't discover it.

8. **Normalise dates & enums in one shared step + unit-test the parser.** Real bugs hit:
   - pg returns `date` columns as JS `Date` → `String(date).slice(0,10)` gives garbage; use a `ymd()`
     helper (`new Date` compare), not string slicing.
   - SchoolPad dates are **DD-MM-YYYY** → `toISO()` before insert (else pg range error / silent wrong).
   - payment mode "Online Payment" → map to `'online'` (else CHECK-constraint violation).
   - "Rs.225" parse: digit-led regex, not `\d+\.?\d*` (grabbed the dot → 0.225).

9. **Idempotent + additive + dry-run-default = fixes are patches, not wipes.** This part DBPASN got
   right and it paid off: the reversal fix shipped as an additive `patch-reversals.js`, no wipe/reload.
   Keep every loader/fixer: dry-run by default, `--apply --yes` to write, keyed on a natural id
   (`legacy_receipt_no`, student+ay) so re-runs are safe. Add `--adm "no1,no2"` for surgical re-runs.

10. **Reconciliation is an ACCEPTANCE GATE, not a post-mortem.** `audit-fees.js` must show **0
    discrepancies to the rupee** (ledger balance == SchoolPad running balance, payments == receipts,
    no over-application, no orphan/cross-student credits, no null ids) **before** the migration is
    declared done. DBPASN found reversals/nulls/concession bugs *after* apply → multiple re-applies.
    Gate first.

11. **Cancelled receipts are void — kept for record only, zero ledger effect.** Load with
    `status='cancelled'`; they must not create or settle any ledger line.

---

## PER-SCHOOL PRE-FLIGHT (fill in before loading a new school)

- [ ] Which years did the school use SchoolPad fees? (DBPASN: 2022-23+; 2021-22 empty)
- [ ] Transport: separate `TR` receipts, free-text remarks on `FR`, or both? Which years? → reconcile plan
- [ ] Adhoc/general payments used? Security refunds processed? (DBPASN: both empty — confirm per school)
- [ ] Concession defs reliable for current year? (assume prior years are NOT)
- [ ] Any J↔S / re-admission renumbering? How many students absent from `old_admission_number`?
- [ ] Receipt-counter high-water mark per series/year (seed native counter past it — `seed-receipt-counters.js`)

## SIGN-OFF (migration is "done" only when)

- [ ] `audit-fees.js` (fee-only, transport filtered): **0 discrepancies, 0 integrity issues**, all years
- [ ] Every matched student ties to SchoolPad ledger balance **to the rupee**
- [ ] Parked (null student_id) list produced + owner decision recorded
- [ ] Config screens (Setup/Structure/Concessions) populated for the current year

---

## SCRIPT INDEX (what exists, so it can be folded into the one-pass loader)

Extraction (`scripts/fees-migration/`): `extract-schoolpad.js`, `roll.js`, `roll-ledgers.js`,
`load.js`, `load-config.js`, `load-concession-roster.js`, `seed-receipt-counters.js`,
`patch-reversals.js`, `relink-unmatched.js`, `wipe-prod.js`.

Cleanup that ideally the loader makes unnecessary (`modules/fees/scripts/`): `backfill-ledger-ids.js`,
`reallocate-payments.js`, `reattach-concessions.js`, `reconcile-concessions.js`, `revert-reconcile.js`,
`fix-cross-student-concessions.js`, `void-*.js`, `audit-fees.js` (keep — the gate),
`audit-left-capvoid.js`, `fix-left-cap-orphan-credits.js`, `import-incremental-receipts.js`.

**Goal for the next school: steps 1-7 of the pipeline in ~4 scripts, and the only cleanup script you
run is `audit-fees.js` — and it comes back clean the first time.**
