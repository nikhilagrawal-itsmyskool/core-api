/**
 * DESTRUCTIVE: wipes the migration's fee data for DBPASN in a given stage so the loader can
 * do a clean re-run. Deletes ONLY the fees tables (student/academic/etc. untouched).
 * Requires --confirm. Run yourself:  node scripts/fees-migration/wipe-prod.js --stage prod --confirm
 */
const { loadConfig, createPool } = require('../run-sql');
const stage = (() => { const i = process.argv.indexOf('--stage'); return i === -1 ? 'prod' : process.argv[i + 1]; })();
const confirm = process.argv.includes('--confirm');
const SCHOOL_CODE = (() => { const i = process.argv.indexOf('--school-code'); return i === -1 ? 'DBPASN' : process.argv[i + 1]; })();

(async () => {
  const pool = createPool(loadConfig(stage));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found in ${stage}`); process.exit(1); }
  const sid = school.uuid;
  const tables = ['fee_receipt_line', 'fee_receipt', 'fee_receipt_counter', 'student_ledger_entry'];
  // show counts first
  for (const t of tables) {
    const c = (await pool.query(`select count(*) c from ${t} where school_id=$1`, [sid])).rows[0].c;
    console.log(`${t}: ${c} rows for ${SCHOOL_CODE}`);
  }
  if (!confirm) { console.log('\nDRY-RUN. Re-run with --confirm to actually delete.'); await pool.end(); return; }
  for (const t of tables) {
    const r = await pool.query(`delete from ${t} where school_id=$1`, [sid]);
    console.log(`deleted ${t}: ${r.rowCount}`);
  }
  console.log(`\n✓ ${SCHOOL_CODE} fees data wiped in ${stage}.`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
