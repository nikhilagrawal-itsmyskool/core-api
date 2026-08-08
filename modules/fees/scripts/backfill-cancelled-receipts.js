/**
 * Backfill cancelled SchoolPad receipts as visible fee_receipt rows (status='cancelled').
 *
 * WHY: the original migration read the ACTIVE-receipts register, so cancelled receipts were never
 * loaded (0 rows) — a cancellation is invisible in the 360 Receipts view. This loads them from
 * D-cancelled.ndjson so a cancelled receipt shows struck-through with its reason, making it clear
 * WHY a re-issued receipt exists (e.g. Kushagra: FR-10723 cancelled → FR-10726 active).
 *
 * Cancelled receipts carry ZERO ledger footprint (no payment credit, no debit) — outstanding stays
 * charges - active payments - concessions. Pair with void-reversals.js which removes the erroneous
 * reversal debits. "Paid this year" already sums status='active' only, so these never inflate it.
 *
 * Idempotent on legacy_receipt_no (unique index). cancel_reason enriched from the reversal head_label.
 *
 *   node modules/fees/scripts/backfill-cancelled-receipts.js --ay w3ajbki9xhbm                 # DRY-RUN
 *   node modules/fees/scripts/backfill-cancelled-receipts.js --ay w3ajbki9xhbm --apply --yes    # write
 *   node modules/fees/scripts/backfill-cancelled-receipts.js --all --apply --yes                # all years
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes'), ALL = has('--all');
const SCHOOL = '2qy0xfycrq88', AY = arg('--ay', null);
const OUT = path.join(__dirname, '../../../scripts/fees-migration/out');
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const num = (v) => v == null ? 0 : Number(v), inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');

function toISO(d) { if (!d) return null; const m = String(d).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : d; }
function toTS(s) { if (!s) return null; const m = String(s).match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i); if (!m) return null; let h = parseInt(m[4]); const ap = (m[6]||'').toUpperCase(); if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0; return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')} ${String(h).padStart(2,'0')}:${m[5]}:00`; }
function mapMode(m) { if (!m) return null; const map = { cash:'cash', cheque:'cheque', draft:'draft', ecs:'ecs', 'bank-deposit':'bank-deposit', card:'card', neft:'neft', 'online payment':'online', online:'online', rte:'rte' }; return map[String(m).toLowerCase().trim()] || null; }
function readNdjson(f) { const p = path.join(OUT, f); if (!fs.existsSync(p)) return []; return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }

(async () => {
  if (!ALL && !AY) { console.log('pass --ay <id> or --all'); await pool.end(); return; }
  const ayRows = (await pool.query(`select uuid, name from academic_year where school_id=$1`, [SCHOOL])).rows;
  const ayByStartYear = {}; ayRows.forEach((a) => { const m = String(a.name||'').match(/(20\d\d)/); if (m) ayByStartYear[m[1]] = a.uuid; });
  const stuRows = (await pool.query(`select uuid, admission_number from student where school_id=$1`, [SCHOOL])).rows;
  const stuByAdm = {}; stuRows.forEach((s) => { if (s.admission_number) stuByAdm[s.admission_number] = s.uuid; });

  // reason enrichment: source_ref -> reason text parsed from reversal head_label
  const revRows = (await pool.query(`select distinct source_ref, head_label from student_ledger_entry where school_id=$1 and kind='adjust' and allocation='reversal' and source_ref is not null`, [SCHOOL])).rows;
  const reasonByRef = {}; revRows.forEach((r) => { const m = String(r.head_label||'').match(/Cancelled with Reason:\s*(.+)$/i); if (m) reasonByRef[r.source_ref] = m[1].trim().slice(0, 256); });

  const existing = new Set((await pool.query(`select legacy_receipt_no from fee_receipt where school_id=$1 and legacy_receipt_no is not null`, [SCHOOL])).rows.map((r) => r.legacy_receipt_no));

  const all = readNdjson('D-cancelled.ndjson');
  const now = new Date();
  const cols = ['uuid','school_id','academic_year_id','student_id','receipt_no','legacy_receipt_no','receipt_date','type','payer_name','payer_class_snapshot','admission_no_snapshot','total_due','total_paid','balance','payment_mode','remarks','status','cancel_reason','cancelled_at','source','created_at'];
  const vals = []; const byYr = {}; let matched = 0, unmatched = 0, skipped = 0, withReason = 0;

  for (const c of all) {
    const startYear = String(c.session || '').slice(0, 4);
    const ay = ayByStartYear[startYear];
    if (!ay) continue;
    if (!ALL && ay !== AY) continue;
    if (c.legacyReceiptNo && existing.has(c.legacyReceiptNo)) { skipped++; continue; }
    const studentId = stuByAdm[c.admissionNo] || null;
    if (studentId) matched++; else unmatched++;
    const type = String(c.legacyReceiptNo || '').startsWith('TR') ? 'transport' : 'fee';
    const reason = reasonByRef[c.legacyReceiptNo] || null; if (reason) withReason++;
    const remarks = `Cancelled by ${c.cancelledBy || '?'} on ${c.cancelledOn || '?'}`.slice(0, 1024);
    const y = byYr[ay] || (byYr[ay] = { n: 0, amt: 0, unmatched: 0 }); y.n++; y.amt += num(c.amount); if (!studentId) y.unmatched++;
    vals.push([generateShortUuid(12), SCHOOL, ay, studentId, c.legacyReceiptNo || generateShortUuid(12), c.legacyReceiptNo || null, toISO(c.receiptDate), type, c.studentName || null, c.className || null, c.admissionNo || null, num(c.amount), num(c.amount), 0, mapMode(c.paymentMode), remarks, 'cancelled', reason, toTS(c.cancelledOn), 'schoolpad', now]);
  }

  console.log(`================ BACKFILL CANCELLED RECEIPTS ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${ALL ? 'ALL YEARS' : AY} ================`);
  Object.keys(byYr).sort().forEach((y) => console.log(`  ${y}  receipts=${String(byYr[y].n).padStart(3)}  amount=${inr(byYr[y].amt).padEnd(12)} unmatched(no student)=${byYr[y].unmatched}`));
  console.log(`\n  to insert: ${vals.length}  (matched=${matched}, unmatched=${unmatched})  reason enriched: ${withReason}  already-present skipped: ${skipped}`);

  if (APPLY && vals.length) {
    const chunk = Math.max(1, Math.floor(60000 / cols.length));
    for (let i = 0; i < vals.length; i += chunk) {
      const slice = vals.slice(i, i + chunk);
      const ph = slice.map((_, ri) => '(' + cols.map((__, ci) => `$${ri*cols.length+ci+1}`).join(',') + ')').join(',');
      await pool.query(`insert into fee_receipt (${cols.join(',')}) values ${ph}`, slice.flat());
    }
    console.log(`\n  APPLIED: inserted ${vals.length} cancelled receipts.`);
  } else if (!APPLY) {
    console.log('\n  (dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
