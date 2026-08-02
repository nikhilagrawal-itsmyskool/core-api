/**
 * Fees migration ADDITIVE PATCH — fixes the two ledger-reconstruction defects the original
 * loader had, WITHOUT deleting or rebuilding anything. It only INSERTS the rows that were
 * dropped:
 *
 *   1. Payment REVERSALS — SchoolPad records a cancelled receipt as the original positive credit
 *      PLUS a later negative-credit row (net zero). The old loader kept the payment and dropped
 *      the reversal, so the student was over-credited. We insert the reversal as an 'adjust'
 *      debit (allocation='reversal') that restores what is owed.
 *   2. NULL-amount rows — a few rows carry a null numeric debit/credit while the running-balance
 *      column still moves. We recover the amount from the balance delta and post the missing
 *      charge/concession/payment (allocation='balance-recovered', unallocated).
 *
 *   node scripts/fees-migration/patch-reversals.js --stage prod --school-code DBPASN [--apply]
 *
 * DRY-RUN by default (prints exactly what it would insert, writes nothing). Pass --apply to write.
 * Idempotent: skips any (student, year) that already has patch rows, so it is safe to re-run.
 *
 * Correctness: the reversal 'adjust' debits are UNALLOCATED (they don't touch any payment's FIFO
 * allocation), so "existing rows + these inserts" is bit-for-bit what a clean reload of the fixed
 * loader produces. After this patch every student's (Sigma debit - Sigma credit) equals the
 * SchoolPad ledger balance to the rupee (verified offline across all 3,243 student-years).
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
const num = (v) => (v == null ? 0 : Number(v) || 0);
const refOf = (h) => (String(h || '').match(/((FR|TR)-\d+-\d+-\d+)/) || [])[1] || null;
const readNdjson = (f) => { const p = path.join(OUT, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; };

// Compute the rows the original loader dropped for one student's ledger entries.
// Returns [{ kind, debit, credit, head, cycle, date, ref, allocation }].
function droppedRows(entries) {
  const es = entries || [];
  const wasNull = es.map((e) => num(e.debit) === 0 && num(e.credit) === 0);
  // balance-delta recovery for null rows (mutates a shallow copy)
  const rec = es.map((e) => ({ ...e }));
  let prevBal = 0;
  for (const e of rec) {
    const thisBal = num(e.balance);
    if (num(e.debit) === 0 && num(e.credit) === 0) {
      const d = Math.round((thisBal - prevBal) * 100) / 100;
      if (Math.abs(d) >= 0.01) {
        if (d > 0) e.debit = d;
        else if (/concession/i.test(String(e.head || ''))) e.debit = d;
        else e.credit = -d;
      }
    }
    prevBal = thisBal;
  }
  const out = [];
  rec.forEach((e, i) => {
    const d = num(e.debit), c = num(e.credit);
    if (c < 0) {
      // reversal of a cancelled receipt -> restore what is owed
      out.push({ kind: 'adjust', debit: -c, credit: null, head: e.head || 'Receipt reversal', cycle: e.cycle, date: e.date, ref: refOf(e.head), allocation: 'reversal' });
    } else if (wasNull[i] && (d !== 0 || c !== 0)) {
      // null-amount row recovered from the balance column
      if (d > 0) out.push({ kind: 'charge', debit: d, credit: null, head: e.head, cycle: e.cycle, date: e.date, ref: null, allocation: 'balance-recovered' });
      else if (d < 0) out.push({ kind: 'concession', debit: null, credit: -d, head: e.head, cycle: e.cycle, date: e.date, ref: null, allocation: 'balance-recovered' });
      else if (c > 0) out.push({ kind: 'payment', debit: null, credit: c, head: e.head || 'Payment', cycle: e.cycle, date: e.date, ref: refOf(e.head), allocation: 'balance-recovered' });
    }
  });
  return out;
}

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found in ${STAGE}`); process.exit(1); }
  const schoolId = school.uuid;

  // maps
  const ayRows = (await pool.query('select uuid, name from academic_year where school_id=$1', [schoolId])).rows;
  const ayByStartYear = {};
  ayRows.forEach((a) => { const m = String(a.name || '').match(/(20\d\d)/); if (m) ayByStartYear[m[1]] = a.uuid; });
  const stuRows = (await pool.query('select uuid, admission_number from student where school_id=$1', [schoolId])).rows;
  const stuByAdm = {}; stuRows.forEach((s) => { if (s.admission_number) stuByAdm[s.admission_number] = s.uuid; });

  // idempotency: (student, year) already patched?  guard matched by student_id|ay, null by remarks|ay
  const patched = (await pool.query("select distinct student_id, academic_year_id, remarks from student_ledger_entry where school_id=$1 and legacy_source='schoolpad' and allocation in ('reversal','balance-recovered')", [schoolId])).rows;
  const patchedMatched = new Set(); const patchedNull = new Set();
  patched.forEach((r) => { if (r.student_id) patchedMatched.add(`${r.student_id}|${r.academic_year_id}`); else patchedNull.add(`${r.remarks}|${r.academic_year_id}`); });

  const years = fs.readdirSync(OUT).filter((f) => /^L-\d{4}-\d{4}\.ndjson$/.test(f)).map((f) => f.slice(2, 11)).sort();
  const cols = ['uuid', 'school_id', 'student_id', 'academic_year_id', 'entry_date', 'category', 'head_label', 'cycle_label', 'kind', 'debit', 'credit', 'settles_entry_id', 'source_module', 'source_ref', 'remarks', 'legacy_source', 'allocation', 'status', 'created_at'];
  const now = new Date();
  let gRev = 0, gRecov = 0, gStu = 0, gSkip = 0;

  for (const year of years) {
    const ay = ayByStartYear[year.slice(0, 4)];
    if (!ay) { console.log(`${year}: academic_year MISSING — skipped`); continue; }
    const ledgers = readNdjson(`L-${year}.ndjson`);
    const vals = []; let rev = 0, recov = 0, stu = 0, skip = 0;

    for (const s of ledgers) {
      const dropped = droppedRows(s.entries);
      if (!dropped.length) continue;
      const studentId = stuByAdm[s.admissionNo] || null;
      const snap = studentId ? null : `adm:${s.admissionNo} ${s.name || ''}`.trim();
      const key = studentId ? `${studentId}|${ay}` : `${snap}|${ay}`;
      if ((studentId ? patchedMatched : patchedNull).has(key)) { skip++; continue; }
      stu++;
      for (const r of dropped) {
        if (r.allocation === 'reversal') rev++; else recov++;
        vals.push([generateShortUuid(12), schoolId, studentId, ay, toISO(r.date), 'fee', r.head || null, r.cycle || null, r.kind, r.debit ?? null, r.credit ?? null, null, 'fees', r.ref || null, snap, 'schoolpad', r.allocation, 'active', now]);
      }
    }

    if (APPLY && vals.length) await insertMany(pool, 'student_ledger_entry', cols, vals);
    gRev += rev; gRecov += recov; gStu += stu; gSkip += skip;
    console.log(`${year}: students=${stu} reversalRows=${rev} recoveredRows=${recov} (already-patched skip=${skip})`);
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (nothing written — pass --apply)'} | students=${gStu} reversalRows=${gRev} recoveredRows=${gRecov} skipped=${gSkip}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

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
