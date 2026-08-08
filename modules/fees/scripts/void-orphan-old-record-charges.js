/**
 * Void orphan duplicate charges left under OLD (renumbered) admission records.
 *
 * The J->S renumbering created a second student record (old, inactive) linked from the active one
 * via old_admission_number. In some cases the migration also created fee CHARGES under the OLD
 * record for a year in which that record has NO enrolment (the real enrolment + charges moved to
 * the new record). Those orphan charges are never paid, double-count in the Dues prev-years, and
 * misstate the old record's 360.
 *
 * An orphan (old-record, year) cell = the old record has active ledger charges in that year AND
 * no student_class enrolment that year AND the linked current record IS enrolled that year.
 * Voiding = set status='cancelled' on ALL active ledger rows for the old record in that year.
 * Cells with any payment/concession/waiver are FLAGGED and skipped (need review) unless --force.
 *
 *   node modules/fees/scripts/void-orphan-old-record-charges.js                       # DRY-RUN (all)
 *   node modules/fees/scripts/void-orphan-old-record-charges.js --adm 724/S/2K24      # DRY-RUN one
 *   node modules/fees/scripts/void-orphan-old-record-charges.js --apply --yes         # write (all)
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes'), FORCE = has('--force');
const SCHOOL = '2qy0xfycrq88', ADM = arg('--adm', null);
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');

(async () => {
  const p = [SCHOOL]; let admFilter = '';
  if (ADM) { p.push(ADM); admFilter = ` and lower(cur.admission_number) = lower($${p.length})`; }

  const cells = (await pool.query(`
    with pairs as (
      select cur.uuid cur_id, cur.admission_number cur_adm, prev.uuid prev_id, prev.admission_number prev_adm, prev.name
      from student cur
      join student prev on prev.school_id = cur.school_id and lower(prev.admission_number) = lower(cur.old_admission_number)
      where cur.school_id = $1 and cur.old_admission_number is not null${admFilter}
    ),
    prev_years as (
      -- years the OLD record has any active charges OR active fee receipts
      select distinct pr.prev_id, pr.cur_id, pr.prev_adm, pr.cur_adm, pr.name, l.academic_year_id
      from pairs pr join student_ledger_entry l on l.student_id=pr.prev_id and l.school_id=$1 and l.status='active' and l.kind='charge'
      union
      select distinct pr.prev_id, pr.cur_id, pr.prev_adm, pr.cur_adm, pr.name, fr.academic_year_id
      from pairs pr join fee_receipt fr on fr.student_id=pr.prev_id and fr.school_id=$1 and fr.status='active' and fr.type='fee'
    ),
    prev_charge_years as (
      select py.prev_id, py.cur_id, py.prev_adm, py.cur_adm, py.name, py.academic_year_id, ay.name yr,
             coalesce((select sum(l.debit) from student_ledger_entry l where l.student_id=py.prev_id and l.school_id=$1 and l.academic_year_id=py.academic_year_id and l.kind='charge' and l.status='active'),0) charges,
             coalesce((select sum(l.credit) from student_ledger_entry l where l.student_id=py.prev_id and l.school_id=$1 and l.academic_year_id=py.academic_year_id and l.kind in ('payment','concession','waiver') and l.status='active'),0) paid,
             coalesce((select sum(fr.total_paid) from fee_receipt fr where fr.student_id=py.prev_id and fr.school_id=$1 and fr.academic_year_id=py.academic_year_id and fr.status='active' and fr.type='fee'),0) receipts
      from prev_years py join academic_year ay on ay.uuid = py.academic_year_id
    )
    select pcy.* from prev_charge_years pcy
    where (pcy.charges > 0 or pcy.receipts > 0)
      and not exists (select 1 from student_class sc where sc.student_id=pcy.prev_id and sc.school_id=$1 and sc.academic_year_id=pcy.academic_year_id and (sc.status is null or sc.status<>'deleted'))
      and exists (select 1 from student_class sc where sc.student_id=pcy.cur_id and sc.school_id=$1 and sc.academic_year_id=pcy.academic_year_id and (sc.status is null or sc.status<>'deleted'))
    order by pcy.yr, pcy.prev_adm`, p)).rows;

  const clean = cells.filter((c) => Number(c.paid) < 0.5);
  const withPaid = cells.filter((c) => Number(c.paid) >= 0.5);
  const students = new Set(cells.map((c) => c.prev_id));
  const totalCharges = cells.reduce((a, c) => a + Number(c.charges), 0);
  const cleanCharges = clean.reduce((a, c) => a + Number(c.charges), 0);

  console.log(`================ VOID ORPHAN OLD-RECORD CHARGES ${APPLY ? 'APPLY' : 'DRY-RUN'}${ADM ? ` — ${ADM}` : ''} ================`);
  console.log(`orphan cells: ${cells.length}  ·  old records: ${students.size}  ·  charges: ${inr(totalCharges)}`);
  console.log(`  clean (₹0 paid, safe to void): ${clean.length} cells (${inr(cleanCharges)})`);
  console.log(`  FLAGGED (has payment/concession/waiver): ${withPaid.length} cells${withPaid.length ? ' — skipped unless --force' : ''}`);
  const show = ADM ? cells : cells.slice(0, 30);
  console.log('\n  old-adm        current-adm    year     charges      paid       name');
  show.forEach((c) => console.log(`  ${String(c.prev_adm).padEnd(14)} ${String(c.cur_adm).padEnd(14)} ${c.yr}  ${inr(c.charges).padEnd(11)} ${inr(c.paid).padEnd(9)} ${String(c.name || '').slice(0, 22)}${Number(c.paid) >= 0.5 ? '  ⚠FLAGGED' : ''}`));
  if (!ADM && cells.length > 30) console.log(`  … ${cells.length - 30} more`);

  const toVoid = FORCE ? cells : clean;
  if (APPLY && toVoid.length) {
    const client = await pool.connect();
    let voided = 0;
    try {
      await client.query('begin');
      let rcVoided = 0;
      for (const c of toVoid) {
        const r = await client.query(
          `update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [void-orphan-renumber 2026-08-08]' where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active'`,
          [SCHOOL, c.prev_id, c.academic_year_id]);
        voided += r.rowCount;
        // also cancel the duplicate fee_receipt rows under the old record for that year (verified amount-subset of the senior record)
        const rr = await client.query(
          `update fee_receipt set status='cancelled', cancel_reason=coalesce(cancel_reason,'duplicate of senior record (renumbering)'), updated_at=$4 where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active' and type='fee'`,
          [SCHOOL, c.prev_id, c.academic_year_id, new Date()]);
        rcVoided += rr.rowCount;
      }
      console.log(`  (also cancelled ${rcVoided} duplicate fee_receipt rows)`);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); client.release(); throw e; }
    client.release();
    console.log(`\nAPPLIED: voided ${voided} ledger rows across ${toVoid.length} orphan cells.`);
  } else if (!APPLY) {
    console.log('\n(dry-run — pass --apply --yes to write; add --force to also void flagged cells)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
