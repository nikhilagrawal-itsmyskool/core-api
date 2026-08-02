# Fees Module — DESIGN

Status: **design** (rev. 2026-08-02). Not built. Reverse-engineered from the legacy SchoolPad
fees system (https://dbpasn.schoolpad.in/fees) and validated against the **full** DBPASN
extraction: 17,952 fee/transport receipts + 693 cancelled + per-student **ledgers** for all
5 active years + config, all cross-checked (ledger paid ↔ receipts reconcile). Owner wants:
**all features preserved, model simplified**, a **simple admin UI** (few screens/clicks), and
**all history migrated**.

Related: [transport DESIGN](../transport/DESIGN.md) (km per stop, student→stop assignment),
[fine module](../fine/) (disciplinary fines — post into the shared ledger).

---

## 0. Architecture decision — a shared ledger, not a fee-only one

The single most important thing the extraction revealed: SchoolPad's fee data is fundamentally a
**per-student running ledger** (charges posted as debits, concessions as negative debits, payments
as credits, running balance) — and it is **itemized** by head+cycle. So we do NOT "compute dues
from structure"; we **post charges and settle payments** against a ledger.

Split by **payment semantics**, unify by **student view**:

- **Postpaid dues → `student_ledger`** (a SHARED settlement ledger): school **fees**, **transport**,
  **library dues**, **disciplinary fines** all post charge lines here. One balance the parent sees.
- **Prepaid consumables → `student_wallet`** (separate): stationery/**supplies** — top-up then spend.
  Different mechanic; do NOT club into the dues ledger. (Escape hatch: a specific postpaid/overdraft
  supply charge may post a `category='misc'` line into `student_ledger`.)

**Ownership (v1 decision):** the ledger lives **inside the `fees` module for v1** — simplest to ship.
But it's modeled as neutral (`student_ledger_entry` with a `category` field + `source_module`/
`source_ref`), so when `fine`/`library`/`supplies` need to post into it, it can be **extracted into a
shared `student-account` module later without a rename**. For v1, fees posts fee + transport lines;
fines are surfaced read-only (as today). Design for the shared future, house it in fees for now.

So conceptually: **"fee" = tuition/annual/exam/admission/caution + transport** (scheduled, recurring).
Fines and library dues are their own domains that merely *settle into the same ledger*.

---

## 1. Concept

- **Fee Cycle** — a billing period in a session (monthly Apr–Mar, Biannual-1/2, Full Term,
  TOA=time-of-admission), each with from/to/**due** dates.
- **Fee Head** — a charge type (Tuition, Old/New Annual, Examination, Registration, Admission,
  **Caution**=refundable, **Transport**). Per academic year (heads vary by year).
- **Fee Structure** — amount a class owes per head per cycle (itemized config).
- **Concession** — reusable discount template (Sibling / Staff / EWS / Other; ₹ or %) → student roster.
- **Waiver** — zero out specific (student, head, cycle) dues.
- **Charge run** — posts structure(−concession/−waiver) as **debit** ledger lines per student per
  head per cycle (SchoolPad pre-posts the whole year; we can post per cycle or upfront).
- **Receipt** — a payment event → posts **credit** ledger line(s) + keeps mode / receipt-no / detail.
  Types: fee / transport / adhoc / refund; may be **cancelled**.
- **Payment allocation** — a receipt's amount is **allocated across specific charge lines**
  (which head×cycle it pays, and how much). Supports **partial payment** (pay part of a line) and
  **custom allocation** (staff decide the split). A line's remaining = `charge − concession − Σ
  credits allocated to it`; a line with `0 < paid < net` is **partially paid** and re-appears with
  its remaining next time Collect Fee is opened.
- **Student Ledger** — the running debit/credit/balance at the (head×cycle) grain = the single
  source of **outstanding** (and of each line's partially-paid remainder).
- **Wallet** — separate prepaid balance for consumable supplies.

### Reality learned from the full historical data (drives the model)
1. **The ledger is itemized (charges), even though receipts are coarse.** `print_view` receipts lump
   recurring fees as one **"Composite Fee"**, BUT the per-student **ledger** breaks charges into real
   heads per cycle — `Tuition Fee(April)`, `Examination Fee(Biannual-1)`, `Old Annual Fee(TOA)`,
   `Tuition Fee Discount(300)(April) -300`. → **Historical per-head/cycle charges ARE recoverable**
   (from the ledger), not just coarse composite. This corrects the earlier "store coarse" assumption.
2. **Charges are pre-posted for the whole year** (debits dated through March even when unpaid);
   balance = Σdebit − Σcredit. Confirms the posted-ledger model.
3. **Partial payments / carry-forward** are normal (Balance on receipts; running balance in ledger).
4. **Concession = negative-debit line** per head per cycle in the ledger (lump only on the receipt).
5. **Transport is separate from the fee ledger.** 2021-25 = own **TR receipts** (a separate transport
   ledger, EXCLUDED from the fee ledger — proven: fee ledger matches fee-only receipts 630/632, not
   fee+transport). 2025-27 = no TR; transport is a **free-text van-fee remark** on the fee receipt.
   ⇒ historical transport has **no structured slab data**; `fee_transport_slab` is **forward-only**.
6. **Advance** = a credit balance (overpayment) in the ledger; not a separate concept.
7. **Late fee** exists, historically applied loosely via remark.
8. Join key to core-api students = **admission_number** (`<serial>/S/2K<yy>`). SchoolPad's internal
   student id (used by the ledger endpoint) is NOT the admission number.

---

## 2. Data model (tables)

Conventions (per repo): `varchar(12)` uuids via `generateShortUuid`, `school_id` on every row,
**no FKs**, soft-delete `status`, audit columns, lowercase SQL, CHECK enums, defaults in app code.
Amounts `numeric(12,2)`. Additive+idempotent setup files.

### A. Shared settlement ledger — belongs in a `student-account` module (NOT fees)
- **`student_ledger_entry`** — the AR spine, at the **(head × cycle)** grain so charges and the
  payments that settle them line up:
  `uuid, school_id, student_id, academic_year_id, entry_date,
   category varchar(12) check (category in ('fee','transport','library','fine','misc')),
   fee_head_id, cycle_id,                           -- structured refs (nullable for non-fee categories)
   head_label, cycle_label,                         -- human labels for display / non-fee categories
   kind varchar(10) check (kind in ('charge','concession','payment','waiver','adjust')),
   debit numeric(12,2), credit numeric(12,2),
   settles_entry_id varchar(12),                    -- for a payment/concession: the charge line it applies to
   source_module varchar(24), source_ref varchar(64),  -- e.g. ('fees','FR-14870-...'), ('fine','<incident>')
   remarks, status varchar(12) check (status in ('active','cancelled')),
   legacy_source varchar(12)`.                      -- 'schoolpad' for migrated rows
  **Line balance** (a charge's remaining) = `charge.debit − Σ(credit where settles_entry_id = charge.uuid)`.
  **Student balance** = `Σdebit − Σcredit` over active rows; advance = negative. A charge line with
  `0 < settled < debit` is **partially paid**. Each domain module posts its own lines; `fees` posts
  fee/transport charges + the payment credits allocated to them.
- **`student_wallet`** + **`wallet_txn`** (prepaid consumables, separate mechanic):
  `student_wallet(uuid, school_id, student_id, balance, status)`;
  `wallet_txn(uuid, school_id, wallet_id, txn_date, type check in ('topup','purchase','refund','adjust'),
   amount, source_module, source_ref, remarks)`. Used by `supplies`; NOT part of dues.

### B. Fees config (owned by fees module)
- **`fee_cycle`** — `uuid, school_id, academic_year_id, name, abbreviation, from_date, to_date,
  due_date, sort_order, status`.
- **`fee_head`** — `uuid, school_id, academic_year_id, name, abbreviation,
  kind check (kind in ('recurring','admission','caution','transport','exam','annual','other')),
  refundable bool, one_time bool, sort_order, status`. (Per year — heads vary by year.)
- **`fee_structure`** — `uuid, school_id, academic_year_id, class_id, fee_head_id, cycle_id, amount,
  status`. Unique `(academic_year_id, class_id, fee_head_id, cycle_id) where status='active'`.
- **`fee_structure_student`** — per-student override: `…student_id, fee_head_id, cycle_id, amount…`.
- **`fee_transport_slab`** — **forward-only** km-band pricing: `uuid, school_id, academic_year_id,
  name, from_km, to_km, amount_per_month, status`. Student km from `transport_student_assignment`
  → `transport_stop.km`, billed on **max(morning, evening)**. (Historical transport is NOT slab-based.)
- **`fee_late_fee_rule`** — auto late fee: `…grace_days, mode check ('flat','perday','pct'), amount, cap…`.

### C. Discounts / relief (fees)
- **`fee_concession`** — template: `…name, type check ('sibling','sibling_elder','sibling_younger',
  'staff','ews','other'), value_type check ('amount','percent'), value, fee_head_id, status`.
- **`fee_concession_student`** — roster: `…concession_id, student_id, cycle_scope, remarks,
  attachment_file_id, status`.
- **`fee_waiver`** — `…student_id, fee_head_id, cycle_id, reason, status`.

### D. Collection (fees) — payment detail; each receipt posts credit(s) into `student_ledger`
- **`fee_receipt`** — `uuid, school_id, academic_year_id, student_id (nullable for adhoc/outsider),
  receipt_no, legacy_receipt_no, receipt_date, type check ('fee','transport','adhoc','refund'),
  payer_name, payer_class_snapshot, father_name, mother_name,   -- snapshot for unlinked/left students
  cycle_set text, total_due, total_paid, balance, concession_total,
  payment_mode check ('cash','cheque','draft','ecs','bank-deposit','card','neft','online','rte'),
  txn_ref, received_from check ('father','mother','guardian','other'),
  remarks, transport_remark, status check ('active','cancelled'), cancel_reason,
  source check ('native','schoolpad')`.
- **`fee_receipt_line`** — one row per component the payment covers:
  `uuid, school_id, receipt_id, fee_head_id, cycle_id, head_label, cycle_label, amount,
   settles_ledger_id`. `amount` may be **less than the line's remaining** (partial); `settles_ledger_id`
  points at the charge line it pays. Collecting posts a matching `kind='payment'` credit into
  `student_ledger_entry`. On re-open, each charge's remaining is recomputed → partially-paid
  components reappear with their leftover. (This is what makes partial + custom allocation work.)
- **`fee_refund`** — caution/security refund on leaving: `…student_id, fee_head_id, amount, refund_date,
  refund_status check ('not_refunded','refunded','dispersed'), reference_receipt_id, remarks, status`.
  (DBPASN's SchoolPad refund register is empty; forward-use.)

> No separate `fee_advance` table — advance = a credit balance in `student_ledger`.
> **Outstanding is read from `student_ledger`**, not recomputed from structure.

---

## 3. API (base `/fees`; ledger reads via the account module)

Config: CRUD `/cycles`, `/heads`, `/structure` (+`/structure/bulk`, `/structure/copy`),
`/structure/students`, `/transport-slabs`, `/late-fee-rules`.
Concessions/waivers: CRUD `/concessions` (+`/concessions/{id}/students`), `/waivers`.
Charge run: `POST /charge-run` (post structure−concession/waiver as ledger debits for a year/cycle).
Collection: `POST /receipts` — body carries **per-line allocations** `[{ledgerId, amount}]` (partial
amounts allowed; total may be < total outstanding) → creates the receipt + posts allocated credits;
`GET /receipts`, `GET /receipts/{id}`,
`POST /receipts/{id}/cancel`, `GET /receipts/{id}/print`, `POST /receipts/adhoc`, `POST /refunds`.
Ledger (account module): `GET /students/{id}/ledger` (unified: fee+transport+library+fine),
`GET /students/{id}/summary` (outstanding, advance, wallet balance, next-due).
Migration: `POST /migration/import`.
Auth: verify-token; write=`fee.manage`, read=`fee.view`.

---

## 4. UI (admin portal only — admin + god)

Desktop admin portal (`../../admin-portal`, React+MUI ngx-admin). Not on the student app.
Add `fee.view`/`fee.manage` to `ACTIONS`; grant `fee.*` to `admin` (god has `*`). Sidebar group "Fees".

Screens (approved mockup, still valid — the Collect ledger view **matches SchoolPad's real ledger**):
**Overview**, **Setup** (heads+cycles), **Fee Structure** (class×head grid), **Concessions**,
**Collect Fees** (student → **unified ledger** by head/cycle → pay; shows fines + advance + late-fee),
**Transport Slabs** (forward-only). Add an **opening / carried-forward balance** row on the student
ledger (migration lands each student with a real outstanding). Templates: medical `ItemList`/`ItemForm`,
`MedicalDashboard`, `ResponsiveDataGrid`, `medicalService`.

**Student 360°:** `StudentFeesPanel.jsx` into `StudentDetail.jsx` (the "dues coming later"
placeholder), gated `fee.view`. Shows outstanding (from ledger), advance, wallet, mini-ledger, "Collect →".

---

## 5. Migration — DATA ALREADY EXTRACTED (scripts/fees-migration/out, gitignored PII)

Pulled via MCP browser (SchoolPad is Cloudflare-protected → not headless), consolidated by
`roll.js` / `roll-ledgers.js`; `state/manifest.json` (committed) tracks counts+watermarks. Full
run summary in `scripts/fees-migration/STATUS.md`. Datasets:

- **`A-<year>.ndjson`** — 17,952 receipts (fee+transport), 5 yrs, head lines, mode, receipt-no,
  cycles, balance. From `printStudentReceipt/print_view/<id>` (session-bound).
- **`D-cancelled.ndjson`** — 693 voided receipts (header-level: rec-no, adm, class, amount,
  reason, cancelledBy/On). Separate `cancelledReceipt` register (main grid does NOT include them).
- **`L-<year>.ndjson`** — **per-student ledgers**, all 5 yrs (533–772 students/yr): itemized
  debit/credit/balance entries + Totals (charged/paid/outstanding). From
  `studentInfo/printLedger/<internalStudentId>`. **This is the owed side + opening balance.**
- **`config-{cycles,heads,structure,concessions}-<year>.json`** — all 5 yrs (definitions).
- Adhoc, security-refund, 2021-22 fees = confirmed **empty**.

**Cross-check (validates the data):** ledger paid-total ↔ receipts paid-total — 2026-27 572/572,
2025-26 649/650, 2024-25 fee-only 630/632 (gap = transport, which the fee ledger excludes → held in
A-* `type='transport'`).

### Load plan → `student_ledger` + fees tables
1. **Map** `admission_number` → `student.uuid`. Unmatched (left/older) → keep name/class snapshot,
   null `student_id`, flag.
2. **Ledger (owed side):** load `L-*` itemized debit/credit lines into `student_ledger_entry`
   (`category='fee'`/`'transport'`, `legacy_source='schoolpad'`, `source_ref`=receipt-no where a
   credit maps to a receipt). This carries each student's **exact opening/outstanding** per year.
3. **Receipts (payment detail):** load `A-*` into `fee_receipt`(+lines), preserving `legacy_receipt_no`,
   snapshot, `cycle_set`; each ties to its ledger credit(s) via receipt-no. Idempotent on `legacy_receipt_no`.
4. **Cancelled:** `D-*` → `fee_receipt.status='cancelled'` + reason (+ cancel the matching ledger credit).
5. **Config:** `config-*` → `fee_cycle`/`fee_head`/`fee_structure`/`fee_concession` per year (for the
   live system to post future charge runs). Concession rosters from ledger discount lines + config.
6. **Transport:** 2021-25 structured TR → `type='transport'` receipts + `category='transport'` ledger
   lines. 2025-27 van remarks → best-effort parse into a transport line **and** keep the raw remark
   (`fee_receipt.transport_remark`) for manual reconcile. Nothing discarded.
7. **Fines:** NOT here — the `fine` module posts its own `category='fine'` lines into `student_ledger`.

**Payment allocation in history (important nuance).** SchoolPad's ledger stores payments as **lump
credits** tagged with the receipt-no (`cycle=null`) against a **running balance** — it does NOT record
which head/cycle each rupee settled (verified: a fully-paid student's credits are `"FR-… Cash" → 900`
etc.). So per-line allocation can't be imported. We **reconstruct** it: allocate each receipt's amount
to the charges of its declared `cycle_set`, **oldest-first (FIFO)** — which mirrors how the running
balance behaved. Outcome: **student-level balance is exact**; per-line paid/partial is a faithful
reconstruction (moot for closed years; used for the current-year opening position so Collect shows the
right components as due). From the **first native payment onward, allocation is explicit and precise**
(`settles_entry_id`). Store `legacy_source='schoolpad'` + `allocation='fifo-reconstructed'` on migrated
credits so the distinction is auditable.

**Reversals & null-amount rows (two edge cases that affect the balance).** (1) A **cancelled/reversed
receipt** shows in SchoolPad's ledger as the original positive credit **plus** a later **negative-credit**
row (e.g. `"… Month Mismatch" → −10500`); the net is zero. The loader keeps the original payment and
posts the negative-credit as an **`adjust` debit** (`allocation='reversal'`) that restores what is owed —
otherwise the student is over-credited. (2) A few rows carry a **null numeric debit/credit** while the
**running-balance column still moves** (the amount was lost in export). The loader recovers the amount
from the balance delta and classifies it by head text (balance-up ⇒ charge; balance-down ⇒ concession if
the head says "Concession", else a payment). With both handled, **every migrated student's `Σdebit −
Σcredit` equals SchoolPad's ledger balance to the rupee** (verified across all 3,243 student-years).

Re-runnable incrementally (manifest watermarks): a weekly pull only fetches ids beyond the watermark.
