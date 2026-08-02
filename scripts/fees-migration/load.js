/**
 * Fees migration loader — loads the extracted SchoolPad data (out/*.ndjson) into the
 * core-api fees tables (student_ledger_entry + fee_receipt + fee_receipt_line).
 *
 *   node scripts/fees-migration/load.js --stage dev --school-code DBPASN [--years 2024-2025,2025-2026] [--apply]
 *
 * Default is DRY-RUN (reports counts + unmatched admission numbers, writes nothing).
 * Pass --apply to actually insert. Idempotent on fee_receipt.legacy_receipt_no.
 *
 * What it does per year (see modules/fees/DESIGN.md §5):
 *  - maps admission_number -> student.uuid, and the SchoolPad session -> academic_year.uuid;
 *  - LEDGER (L-<year>.ndjson): debit rows -> 'charge' lines; negative-debit rows -> 'concession'
 *    credits (settled to a charge of the same cycle); credit rows are lump receipt payments that
 *    are FIFO-reconstructed (oldest charge first, allocation='fifo-reconstructed') so per-line
 *    paid/partial is faithful and the student balance is exact;
 *  - RECEIPTS (A-<year>.ndjson): loaded into fee_receipt(+lines), source='schoolpad',
 *    legacy_receipt_no preserved; cancelled (D-cancelled.ndjson) -> status='cancelled'.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../run-sql');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const OUT = path.join(__dirname, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const APPLY = !!arg('apply', false);
const num = (v) => (v == null ? 0 : Number(v));
const readNdjson = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query("select uuid from school where lower(code)=lower($1)", [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found in ${STAGE}`); process.exit(1); }
  const schoolId = school.uuid;

  // maps
  const ayRows = (await pool.query('select uuid, name from academic_year where school_id=$1', [schoolId])).rows;
  const ayByStartYear = {};
  ayRows.forEach((a) => { const m = String(a.name || '').match(/(20\d\d)/); if (m) ayByStartYear[m[1]] = a.uuid; });
  const stuRows = (await pool.query('select uuid, admission_number from student where school_id=$1', [schoolId])).rows;
  const stuByAdm = {}; stuRows.forEach((s) => { if (s.admission_number) stuByAdm[s.admission_number] = s.uuid; });

  const yearFiles = fs.readdirSync(OUT).filter((f) => /^L-\d{4}-\d{4}\.ndjson$/.test(f)).map((f) => f.slice(2, 11));
  const wantYears = arg('years', null);
  const years = wantYears ? String(wantYears).split(',') : yearFiles;

  const report = { years: {}, unmatchedAdm: new Set(), apply: APPLY };
  const now = new Date();
  const receiptByLegacy = {}; // legacy no -> already exists

  // preload existing legacy receipt numbers for idempotency
  const existing = (await pool.query("select legacy_receipt_no from fee_receipt where school_id=$1 and legacy_receipt_no is not null", [schoolId])).rows;
  existing.forEach((r) => (receiptByLegacy[r.legacy_receipt_no] = true));
  // preload (student, year) combos already loaded, so a re-run/resume can't double the ledger
  const ledgerDoneRows = (await pool.query("select distinct student_id, academic_year_id from student_ledger_entry where school_id=$1 and legacy_source='schoolpad' and student_id is not null", [schoolId])).rows;
  const ledgerDone = new Set(ledgerDoneRows.map((r) => `${r.student_id}|${r.academic_year_id}`));
  // also guard already-loaded UNMATCHED students (student_id null) by admission-no from the remarks snapshot
  const unmatchedDoneRows = (await pool.query("select distinct remarks, academic_year_id from student_ledger_entry where school_id=$1 and legacy_source='schoolpad' and student_id is null", [schoolId])).rows;
  const unmatchedDone = new Set(unmatchedDoneRows.map((r) => { const m = String(r.remarks || '').match(/^adm:(\S+)/); return m ? `${m[1]}|${r.academic_year_id}` : null; }).filter(Boolean));

  for (const year of years) {
    const startYear = year.slice(0, 4);
    const ay = ayByStartYear[startYear];
    const ledgers = readNdjson(`L-${year}.ndjson`);
    const receipts = readNdjson(`A-${year}.ndjson`);
    const cancelled = new Set(readNdjson('D-cancelled.ndjson').filter((c) => c.session === year).map((c) => c.legacyReceiptNo));
    const y = { ay: ay || null, ledgerStudents: ledgers.length, receipts: receipts.length, cancelledInYear: cancelled.size, ledgerRows: 0, unmatched: 0, receiptsLoaded: 0, receiptsSkipped: 0 };

    if (!ay) { y.error = `no academic_year matching ${startYear} for ${SCHOOL_CODE}`; report.years[year] = y; continue; }

    // ---- LEDGER reconstruction ----
    for (const s of ledgers) {
      const studentId = stuByAdm[s.admissionNo] || null;
      if (!studentId) { report.unmatchedAdm.add(s.admissionNo); y.unmatched++; }
      if (studentId && ledgerDone.has(`${studentId}|${ay}`)) { y.ledgerSkipped = (y.ledgerSkipped || 0) + 1; continue; }
      if (!studentId && unmatchedDone.has(`${s.admissionNo}|${ay}`)) { y.ledgerSkipped = (y.ledgerSkipped || 0) + 1; continue; }
      const entries = s.entries || [];
      // Some SchoolPad rows carry a null debit AND null/0 credit but the running-balance column
      // still moves (a payment/concession whose numeric was lost). Recover the amount from the
      // balance delta and classify by head text: balance-up => charge (debit), balance-down =>
      // concession if the head says so, else a payment (credit).
      let prevBal = 0;
      for (const e of entries) {
        const thisBal = num(e.balance);
        if (num(e.debit) === 0 && num(e.credit) === 0) {
          const delta = Math.round((thisBal - prevBal) * 100) / 100;
          if (Math.abs(delta) >= 0.01) {
            if (delta > 0) e.debit = delta;
            else if (/concession/i.test(String(e.head || ''))) e.debit = delta; // negative debit => concession
            else e.credit = -delta; // balance-down, not a concession => payment
          }
        }
        prevBal = thisBal;
      }
      const charges = entries.filter((e) => num(e.debit) > 0).map((e) => ({ id: generateShortUuid(12), head: e.head, cycle: e.cycle, date: e.date, debit: num(e.debit), remaining: num(e.debit) }));
      const concessions = entries.filter((e) => num(e.debit) < 0).map((e) => ({ head: e.head, cycle: e.cycle, date: e.date, amount: -num(e.debit) }));
      const payments = entries.filter((e) => num(e.credit) > 0).map((e) => ({ amount: num(e.credit), date: e.date, ref: (String(e.head || '').match(/((FR|TR)-\d+-\d+-\d+)/) || [])[1] || null }));
      // negative-credit rows are SchoolPad payment/receipt REVERSALS (e.g. "Month Mismatch"): the
      // reversed receipt still appears as a positive credit above, so post the reversal as an
      // 'adjust' debit that restores the balance the cancellation created (keeps outstanding correct).
      const reversals = entries.filter((e) => num(e.credit) < 0).map((e) => ({ head: e.head, cycle: e.cycle, date: e.date, amount: -num(e.credit), ref: (String(e.head || '').match(/((FR|TR)-\d+-\d+-\d+)/) || [])[1] || null }));

      const rows = []; // ledger rows to insert for this student
      const mk = (o) => rows.push({ uuid: o.uuid || generateShortUuid(12), studentId, ay, ...o });
      // charges
      charges.forEach((c) => mk({ uuid: c.id, entryDate: c.date, category: 'fee', headLabel: c.head, cycleLabel: c.cycle, kind: 'charge', debit: c.debit }));
      // concessions -> settle to a charge of the same cycle (best-effort)
      concessions.forEach((cn) => {
        const target = charges.find((c) => c.cycle === cn.cycle && c.remaining > 0) || charges.find((c) => c.cycle === cn.cycle);
        mk({ entryDate: cn.date, category: 'fee', headLabel: cn.head, cycleLabel: cn.cycle, kind: 'concession', credit: cn.amount, settlesEntryId: target ? target.id : null });
        if (target) target.remaining = Math.max(0, target.remaining - cn.amount);
      });
      // payments FIFO oldest-charge-first
      const ordered = [...charges].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      payments.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      for (const pmt of payments) {
        let left = pmt.amount;
        for (const c of ordered) {
          if (left <= 0) break;
          if (c.remaining <= 0) continue;
          const apply = Math.min(left, c.remaining);
          mk({ entryDate: pmt.date, category: 'fee', headLabel: c.head, cycleLabel: c.cycle, kind: 'payment', credit: apply, settlesEntryId: c.id, sourceRef: pmt.ref, allocation: 'fifo-reconstructed' });
          c.remaining -= apply; left -= apply;
        }
        if (left > 0.01) { // overpayment / advance — unallocated credit
          mk({ entryDate: pmt.date, category: 'fee', headLabel: 'Advance', kind: 'payment', credit: left, sourceRef: pmt.ref, allocation: 'fifo-reconstructed' });
        }
      }
      // reversals -> debit that undoes a cancelled receipt (restores what is owed)
      reversals.forEach((rv) => mk({ entryDate: rv.date, category: 'fee', headLabel: rv.head || 'Receipt reversal', cycleLabel: rv.cycle, kind: 'adjust', debit: rv.amount, sourceRef: rv.ref, allocation: 'reversal', remarks: 'receipt reversal' }));
      y.ledgerRows += rows.length;

      if (APPLY && rows.length) {
        const cols = ['uuid', 'school_id', 'student_id', 'academic_year_id', 'entry_date', 'category', 'head_label', 'cycle_label', 'kind', 'debit', 'credit', 'settles_entry_id', 'source_module', 'source_ref', 'remarks', 'legacy_source', 'allocation', 'status', 'created_at'];
        const snap = studentId ? null : `adm:${s.admissionNo} ${s.name || ''}`.trim();
        const vals = rows.map((r) => [r.uuid, schoolId, r.studentId, r.ay, toISO(r.entryDate), r.category, r.headLabel || null, r.cycleLabel || null, r.kind, r.debit ?? null, r.credit ?? null, r.settlesEntryId || null, 'fees', r.sourceRef || null, snap, 'schoolpad', r.allocation || 'explicit', 'active', now]);
        await insertMany(pool, 'student_ledger_entry', cols, vals); // one multi-row insert per student (atomic)
      }
    }

    // ---- RECEIPTS (batched) ----
    const rCols = ['uuid', 'school_id', 'academic_year_id', 'student_id', 'receipt_no', 'legacy_receipt_no', 'receipt_date', 'type', 'payer_name', 'payer_class_snapshot', 'father_name', 'mother_name', 'admission_no_snapshot', 'cycle_set', 'total_due', 'total_paid', 'balance', 'payment_mode', 'transport_remark', 'status', 'source', 'created_at'];
    const lCols = ['uuid', 'school_id', 'receipt_id', 'head_label', 'amount', 'is_concession', 'created_at'];
    const rVals = []; const lVals = [];
    for (const r of receipts) {
      if (r.legacyReceiptNo && receiptByLegacy[r.legacyReceiptNo]) { y.receiptsSkipped++; continue; }
      const studentId = stuByAdm[r.admissionNo] || null;
      const type = r.type === 'transport' ? 'transport' : 'fee';
      const receiptId = generateShortUuid(12);
      rVals.push([receiptId, schoolId, ay, studentId, r.legacyReceiptNo || generateShortUuid(12), r.legacyReceiptNo || null, toISO(r.date), type, r.studentName || null, r.className || null, r.fatherName || null, r.motherName || null, r.admissionNo || null, (r.cycles || []).join(','), num(r.totalDue), num(r.totalPaid), num(r.balance), mapMode(r.paymentMode), r.transportRemark || null, cancelled.has(r.legacyReceiptNo) ? 'cancelled' : 'active', 'schoolpad', now]);
      for (const l of (r.lines || [])) lVals.push([generateShortUuid(12), schoolId, receiptId, l.head, num(l.amount), /concession/i.test(l.head || ''), now]);
      if (r.legacyReceiptNo) receiptByLegacy[r.legacyReceiptNo] = true;
      y.receiptsLoaded++;
    }
    if (APPLY) { await insertMany(pool, 'fee_receipt', rCols, rVals); await insertMany(pool, 'fee_receipt_line', lCols, lVals); }

    report.years[year] = y;
    console.log(`${year}: ay=${ay ? 'ok' : 'MISSING'} ledgerStudents=${y.ledgerStudents} ledgerRows=${y.ledgerRows} unmatched=${y.unmatched} receipts=${y.receiptsLoaded}(skip ${y.receiptsSkipped})`);
  }

  // write unmatched report
  const unmatched = [...report.unmatchedAdm].filter(Boolean).sort();
  fs.writeFileSync(path.join(OUT, 'unmatched-admission.txt'), unmatched.join('\n'));
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (nothing written — pass --apply)'} | unmatched admission numbers: ${unmatched.length} -> out/unmatched-admission.txt`);
  await pool.end();

})().catch((e) => { console.error(e); process.exit(1); });

// SchoolPad payment-mode label -> our enum (unknown -> null; CHECK passes on null)
function mapMode(m) {
  if (!m) return null;
  const map = { 'cash': 'cash', 'cheque': 'cheque', 'draft': 'draft', 'ecs': 'ecs', 'bank-deposit': 'bank-deposit', 'card': 'card', 'neft': 'neft', 'online payment': 'online', 'online': 'online', 'rte': 'rte' };
  return map[String(m).toLowerCase().trim()] || null;
}

// DD-MM-YYYY -> YYYY-MM-DD (SchoolPad emits day-first dates)
function toISO(d) {
  if (!d) return null;
  const m = String(d).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : d;
}

// Bulk multi-row insert, chunked to stay under Postgres' 65535-param limit.
async function insertMany(pool, table, cols, rows) {
  if (!rows.length) return;
  const chunk = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((_, ri) => '(' + cols.map((__, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')').join(',');
    await pool.query(`insert into ${table} (${cols.join(',')}) values ${values}`, slice.flat());
  }
}

async function runTx(pool, queries, params) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); for (let i = 0; i < queries.length; i++) await client.query(queries[i], params[i]); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}
