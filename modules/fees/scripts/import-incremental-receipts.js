/**
 * Import incremental SchoolPad fee receipts (a delta pull) as fee_receipt rows — FEE ONLY.
 * Reads the MCP-extracted raw json, inserts new receipts (idempotent on legacy_receipt_no).
 * Transport is NOT handled here (van fee lives in remarks; a separate transport pass builds TR
 * receipts). Per instruction, receipt `remarks` are NOT stored. Payments are posted afterwards by
 * reallocate-payments.js --adm <affected>.
 *
 *   node modules/fees/scripts/import-incremental-receipts.js --file incremental-2026-08-08-raw.json
 *   node modules/fees/scripts/import-incremental-receipts.js --file incremental-2026-08-08-raw.json --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88', AY = arg('--ay', 'w3ajbki9xhbm');
const FILE = arg('--file', 'incremental-2026-08-08-raw.json');
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const num = (v) => v == null ? 0 : Number(v), inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
function toISO(d) { if (!d) return null; const m = String(d).match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : d; }
function mapMode(m) { if (!m) return null; const map = { cash:'cash', cheque:'cheque', draft:'draft', ecs:'ecs', 'bank-deposit':'bank-deposit', card:'card', neft:'neft', 'online payment':'online', online:'online', rte:'rte' }; return map[String(m).toLowerCase().trim()] || null; }

(async () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../${FILE}`), 'utf8'));
  const recs = raw.filter((r) => !r.empty && !r.error && r.type === 'fee' && !r.cancelled);
  const stuRows = (await pool.query(`select uuid, admission_number from student where school_id=$1`, [SCHOOL])).rows;
  const stuByAdm = {}; stuRows.forEach((s) => { if (s.admission_number) stuByAdm[s.admission_number] = s.uuid; });
  const existing = new Set((await pool.query(`select legacy_receipt_no from fee_receipt where school_id=$1 and legacy_receipt_no is not null`, [SCHOOL])).rows.map((r) => r.legacy_receipt_no));

  const now = new Date();
  const rCols = ['uuid','school_id','academic_year_id','student_id','receipt_no','legacy_receipt_no','receipt_date','type','payer_name','payer_class_snapshot','father_name','mother_name','admission_no_snapshot','cycle_set','total_due','total_paid','balance','concession_total','payment_mode','status','source','created_at'];
  const lCols = ['uuid','school_id','receipt_id','head_label','amount','is_concession','created_at'];
  const rVals = [], lVals = []; let matched = 0, unmatched = 0, skipped = 0; const affected = new Set(); const unmatchedList = [];

  for (const r of recs) {
    if (r.legacyReceiptNo && existing.has(r.legacyReceiptNo)) { skipped++; continue; }
    const studentId = stuByAdm[r.admissionNo] || null;
    if (studentId) { matched++; affected.add(r.admissionNo); } else { unmatched++; unmatchedList.push(`${r.legacyReceiptNo} ${r.admissionNo} ${r.studentName}`); }
    const rid = generateShortUuid(12);
    rVals.push([rid, SCHOOL, AY, studentId, r.legacyReceiptNo || generateShortUuid(12), r.legacyReceiptNo || null, toISO(r.date), 'fee', r.studentName || null, r.className || null, r.fatherName || null, r.motherName || null, r.admissionNo || null, (r.cycles || []).join(','), num(r.totalDue), num(r.totalPaid), num(r.balance), num(r.concessionTotal), mapMode(r.paymentMode), 'active', 'schoolpad', now]);
    for (const l of (r.lines || [])) lVals.push([generateShortUuid(12), SCHOOL, rid, l.head, num(l.amount), !!l.isConcession, now]);
  }

  console.log(`================ IMPORT INCREMENTAL RECEIPTS ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${FILE} ================`);
  console.log(`  fee receipts in file: ${recs.length}`);
  console.log(`  to insert: ${rVals.length}  (matched=${matched}, unmatched=${unmatched})  already-present skipped: ${skipped}`);
  console.log(`  receipt lines: ${lVals.length}  ·  distinct students affected: ${affected.size}`);
  console.log(`  total_paid to import: ${inr(rVals.reduce((a, v) => a + Number(v[15]), 0))}`);
  if (unmatchedList.length) { console.log('  UNMATCHED (no student in itsmyskool):'); unmatchedList.forEach((u) => console.log(`    ${u}`)); }

  if (APPLY && rVals.length) {
    const chunkIns = async (table, cols, vals) => { const ch = Math.max(1, Math.floor(60000 / cols.length)); for (let i = 0; i < vals.length; i += ch) { const s = vals.slice(i, i + ch); const ph = s.map((_, ri) => '(' + cols.map((__, ci) => `$${ri*cols.length+ci+1}`).join(',') + ')').join(','); await pool.query(`insert into ${table} (${cols.join(',')}) values ${ph}`, s.flat()); } };
    await chunkIns('fee_receipt', rCols, rVals);
    if (lVals.length) await chunkIns('fee_receipt_line', lCols, lVals);
    console.log(`\n  APPLIED: ${rVals.length} receipts, ${lVals.length} lines.`);
    // emit the affected admission list for reallocate --adm
    fs.writeFileSync(path.join(__dirname, '../../../incremental-affected-adm.txt'), [...affected].join(','));
    console.log(`  affected admission list -> incremental-affected-adm.txt (feed to reallocate-payments.js --adm)`);
  } else if (!APPLY) {
    console.log('\n  (dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
