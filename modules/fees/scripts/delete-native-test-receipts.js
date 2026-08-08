/**
 * Delete specific NATIVE (learning/test) receipts and their ledger footprint, by receipt_no.
 * Used to remove Aradhya's FR-14881 / TR-14881 — collected in SchoolPad and replicated in itsmyskool
 * to learn the system. We delete the native copies so the incremental SchoolPad pull brings the
 * authoritative versions (no duplicate). HARD delete (these are erroneous duplicates, not cancellations).
 *
 *   node modules/fees/scripts/delete-native-test-receipts.js                 # DRY-RUN
 *   node modules/fees/scripts/delete-native-test-receipts.js --apply --yes    # write
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const TARGET_NOS = ['FR-14881', 'TR-14881']; // native receipt numbers to remove
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');

(async () => {
  // only NATIVE receipts with these exact numbers (never touch schoolpad-sourced)
  const rc = (await pool.query(`select uuid, receipt_no, type, status, total_paid, student_id, source from fee_receipt where school_id=$1 and source='native' and receipt_no = any($2)`, [SCHOOL, TARGET_NOS])).rows;
  console.log(`================ DELETE NATIVE TEST RECEIPTS ${APPLY ? 'APPLY' : 'DRY-RUN'} ================\n`);
  if (!rc.length) { console.log('no matching native receipts found (already removed?).'); await pool.end(); return; }
  const ids = rc.map((r) => r.uuid);
  const led = (await pool.query(`select uuid, kind, head_label, cycle_label, credit, debit, status, source_ref from student_ledger_entry where school_id=$1 and source_ref = any($2)`, [SCHOOL, ids])).rows;
  rc.forEach((r) => console.log(`receipt ${String(r.receipt_no).padEnd(10)} ${r.type.padEnd(10)} ${r.status.padEnd(9)} ${inr(r.total_paid).padEnd(9)} student=${r.student_id} uuid=${r.uuid}`));
  console.log(`\nledger entries tied to them (${led.length}):`);
  led.forEach((l) => console.log(`  ${l.kind} ${inr(l.credit || l.debit)} ${l.cycle_label||''}/${l.head_label||''} [${l.status}] uuid=${l.uuid}`));

  if (APPLY) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const dl = await client.query(`delete from student_ledger_entry where school_id=$1 and source_ref = any($2)`, [SCHOOL, ids]);
      const dln = await client.query(`delete from fee_receipt_line where receipt_id = any($1)`, [ids]);
      const dr = await client.query(`delete from fee_receipt where school_id=$1 and uuid = any($2)`, [SCHOOL, ids]);
      await client.query('commit');
      console.log(`\nAPPLIED: deleted ${dr.rowCount} receipts, ${dln.rowCount} receipt lines, ${dl.rowCount} ledger entries.`);
    } catch (e) { await client.query('rollback'); client.release(); throw e; }
    client.release();
  } else {
    console.log('\n(dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
