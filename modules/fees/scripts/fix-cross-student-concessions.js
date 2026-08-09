/**
 * Fix cross-student concession links surfaced by the receipt-only import.
 *
 * The migration created concession credits with the correct owner in `remarks` (adm:<no> <name>)
 * but a `settles_entry_id` pointing to ANOTHER student's charge (one anchor charge per year received
 * everyone's concessions). Net balances are unaffected (net is summed per student_id), but the
 * mis-link makes the anchor charge look partly paid and can skew per-cycle logic (e.g. the cap).
 *
 * Fix: for each active concession/waiver whose settles_entry_id points to a DIFFERENT student's
 * charge, re-point it to a charge of the SAME student (the concession's own student_id) in the SAME
 * academic year — the largest-debit charge (typically tuition). If that student has no charge that
 * year, null the link (still a valid student-level credit). Reversible via the audit CSV.
 *
 *   node modules/fees/scripts/fix-cross-student-concessions.js
 *   node modules/fees/scripts/fix-cross-student-concessions.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');

(async () => {
  const cross = (await pool.query(`
    select cr.uuid, cr.credit, cr.kind, cr.student_id, cr.academic_year_id,
           sc.admission_number cr_adm, sh.admission_number ch_adm
    from student_ledger_entry cr
    join student_ledger_entry ch on ch.uuid=cr.settles_entry_id
    join student sc on sc.uuid=cr.student_id
    join student sh on sh.uuid=ch.student_id
    where cr.school_id=$1 and cr.status='active' and ch.status='active'
      and cr.student_id<>ch.student_id and cr.kind in ('concession','waiver')
    order by cr.credit desc`,[SCHOOL])).rows;

  const plan = [];
  for (const c of cross) {
    const tgt = (await pool.query(`select uuid, debit from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='charge' and status='active' order by debit desc limit 1`,[SCHOOL, c.student_id, c.academic_year_id])).rows[0];
    plan.push({ ...c, newTarget: tgt ? tgt.uuid : null });
  }

  console.log(`================ FIX CROSS-STUDENT CONCESSIONS ${APPLY?'APPLY':'DRY-RUN'} ================`);
  console.log(`cross-student concession/waiver links: ${plan.length} · ${inr(plan.reduce((s,c)=>s+ +c.credit,0))}`);
  console.log(`  re-point to own charge: ${plan.filter(p=>p.newTarget).length}  |  null link (no own charge): ${plan.filter(p=>!p.newTarget).length}`);
  plan.slice(0,8).forEach(p=>console.log(`  ${p.kind} ${inr(p.credit).padEnd(8)} ${p.cr_adm} (was settling ${p.ch_adm}) -> ${p.newTarget?'own charge':'NULL'}`));
  if (plan.length>8) console.log(`  … ${plan.length-8} more`);

  if (APPLY) {
    const client = await pool.connect(); let n=0;
    try { await client.query('begin');
      for (const p of plan) { const x=await client.query(`update student_ledger_entry set settles_entry_id=$1, updated_at=now() where uuid=$2 and status='active'`,[p.newTarget, p.uuid]); n+=x.rowCount; }
      await client.query('commit');
    } catch(e){ await client.query('rollback'); client.release(); throw e; }
    client.release();
    console.log(`\nAPPLIED: re-pointed ${n} concession/waiver links.`);
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
