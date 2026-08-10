/**
 * Close the receipt-reconciliation loop (2026-08-10):
 *  1. CANCEL FR-14379-0107-2 — active here but cancelled in SchoolPad (voids its payment; dues rise).
 *  2. ADD 3 SchoolPad-cancelled receipts we never had, as cancelled stubs (zero ledger footprint) so
 *     the numbers resolve. Parsed from the cancelledreceipt-*.xls exports.
 * Reversible; dry-run default.
 *
 *   node modules/fees/scripts/close-loop-cancelled-2026-08-10.js
 *   node modules/fees/scripts/close-loop-cancelled-2026-08-10.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88', AY2627 = 'w3ajbki9xhbm';
// FR-14379's original payment was reallocated; its live ₹1,700 credit now sits under this batch.
const FR14379_BATCH = 'v9vv6a9ypnjc';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const uq = (s) => String(s || '').replace(/^"|"$/g, '').trim();
const isoOf = (d) => { const m = String(d||'').match(/(\d{1,2})-(\d{1,2})-(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null; };
const TARGETS = ['FR-14908-2403-5', 'FR-14909-2403-6', 'FR-14910-2404-5'];

// parse cancelledreceipt-2026-27.xls into a map of receiptNo -> {cols by header}
function parseCancelled() {
  const p = 'C:/Users/nikhi/Downloads/cancelledreceipt-2026-27.xls';
  const t = fs.readFileSync(p, 'latin1'); const lines = t.split(/\r?\n/);
  const hi = lines.findIndex((l) => /receiptNo/i.test(l));
  const hdr = lines[hi].split('\t').map(uq);
  const idx = (name) => hdr.findIndex((h) => h.toLowerCase().includes(name));
  const col = { rn: idx('receiptno'), date: idx('receiptdate'), adm: idx('regno'), student: idx('studentname'), amt: idx('amountpaid') };
  const map = {};
  for (let i = hi + 1; i < lines.length; i++) { const c = lines[i].split('\t').map(uq); const rn = c[col.rn]; if (!/^FR-/.test(rn || '')) continue; map[rn] = { rn, date: c[col.date], adm: c[col.adm], student: c[col.student], amt: c[col.amt] }; }
  return { hdr, map };
}

(async () => {
  console.log(`================ CLOSE LOOP ${APPLY ? 'APPLY' : 'DRY-RUN'} ================`);
  // 1) FR-14379 cancel
  const f = (await pool.query(`select uuid, status, total_paid, payer_name from fee_receipt where school_id=$1 and receipt_no='FR-14379-0107-2'`, [SCHOOL])).rows[0];
  const credits = (await pool.query(`select count(*) n, coalesce(sum(credit),0) c from student_ledger_entry where school_id=$1 and source_ref=$2 and kind='payment' and status='active'`, [SCHOOL, FR14379_BATCH])).rows[0];
  console.log(`\n1) CANCEL FR-14379-0107-2 (${f?f.payer_name:'?'}) — receipt status=${f?f.status:'?'}; void reallocated payment batch ${FR14379_BATCH}: ${credits.n} rows = ${inr(credits.c)}`);

  // 2) 3 cancelled stubs
  const { map } = parseCancelled();
  console.log('\n2) ADD cancelled stubs:');
  const stubs = [];
  for (const rn of TARGETS) {
    const x = map[rn]; if (!x) { console.log(`  ${rn}: not found in XLS`); continue; }
    const s = (await pool.query(`select uuid, name from student where school_id=$1 and lower(admission_number)=lower($2)`, [SCHOOL, x.adm])).rows[0];
    const exists = (await pool.query(`select 1 from fee_receipt where school_id=$1 and receipt_no=$2`, [SCHOOL, rn])).rows.length;
    console.log(`  ${rn}  adm=${x.adm}  ${x.student}  ${inr(x.amt)}  date=${x.date}  student=${s?'✓':'NOT FOUND'}${exists?'  (already exists)':''}`);
    if (s && !exists) stubs.push({ rn, sid: s.uuid, name: s.name, adm: x.adm, amt: Number(x.amt || 0), date: isoOf(x.date) });
  }

  if (APPLY) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      // cancel FR-14379: void its active payment/adjust credits + mark the receipt cancelled
      await client.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [cancelled-in-schoolpad FR-14379 2026-08-10]', updated_at=now() where school_id=$1 and source_ref=$2 and kind='payment' and status='active'`, [SCHOOL, FR14379_BATCH]);
      await client.query(`update fee_receipt set status='cancelled', cancel_reason=coalesce(cancel_reason,'Cancelled in SchoolPad'), cancelled_at=now(), updated_at=now() where school_id=$1 and receipt_no='FR-14379-0107-2' and status<>'cancelled'`, [SCHOOL]);
      // add cancelled stubs (no ledger footprint)
      for (const st of stubs) {
        await client.query(`insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, receipt_date, type, payer_name, admission_no_snapshot, total_due, total_paid, balance, concession_total, status, cancel_reason, source, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,'fee',$7,$8,$9,$9,0,0,'cancelled','Cancelled in SchoolPad','schoolpad','0',now())`, [generateShortUuid(12), SCHOOL, AY2627, st.sid, st.rn, st.date, st.name, st.adm, st.amt]);
      }
      await client.query('commit');
    } catch (e) { await client.query('rollback'); client.release(); throw e; }
    client.release();
    console.log(`\nAPPLIED: cancelled FR-14379 (voided ${credits.n} credit rows) + added ${stubs.length} cancelled stubs.`);
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
