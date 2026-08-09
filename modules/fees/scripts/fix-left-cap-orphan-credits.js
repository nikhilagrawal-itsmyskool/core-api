/**
 * Remediate orphan credits created by apply-withdrawal-register.js's CAP path.
 *
 * The cap voided a charge whenever the uncovered remainder (debit - all credits) > 0.5, which
 * also caught charges carrying a real PARTIAL PAYMENT — orphaning that payment (a credit that now
 * settles a cancelled charge). Two fixes:
 *   1. charge cancelled with a [left-...] tag that still has an active PAYMENT settling it
 *        -> RESTORE the charge (un-cancel, strip the [left-...] tag). The cap should never have
 *           voided a paid cycle. The partial payment is real; the cycle stays on the books.
 *   2. charge cancelled with a [left-...] tag whose only settling credits are CONCESSION/WAIVER
 *        -> CANCEL those credits too (a discount on a genuinely-voided phantom charge is itself
 *           phantom). Charge stays cancelled.
 * Reversible (status flips only). Dry-run default; --apply --yes writes.
 *
 *   node modules/fees/scripts/fix-left-cap-orphan-credits.js
 *   node modules/fees/scripts/fix-left-cap-orphan-credits.js --apply --yes
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
  // cancelled left- charges that have an active payment settling them -> restore
  const restore = (await pool.query(`
    select distinct ch.uuid, ch.debit, s.admission_number adm, s.name, ay.name yr
    from student_ledger_entry ch
    join student_ledger_entry cr on cr.settles_entry_id=ch.uuid and cr.status='active' and cr.kind='payment'
    join student s on s.uuid=ch.student_id
    join academic_year ay on ay.uuid=ch.academic_year_id
    where ch.school_id=$1 and ch.status='cancelled' and ch.remarks like '%left-%' and ch.kind='charge'`,[SCHOOL])).rows;
  const restoreIds = restore.map(r=>r.uuid);

  // active concession/waiver settling a still-cancelled left- charge that is NOT being restored -> cancel
  const cancelCr = (await pool.query(`
    select cr.uuid, cr.kind, cr.credit, s.admission_number adm, s.name, ay.name yr
    from student_ledger_entry cr
    join student_ledger_entry ch on ch.uuid=cr.settles_entry_id
    join student s on s.uuid=cr.student_id
    join academic_year ay on ay.uuid=cr.academic_year_id
    where cr.school_id=$1 and cr.status='active' and cr.kind in ('concession','waiver')
      and ch.status='cancelled' and ch.remarks like '%left-%'
      and not (ch.uuid = any($2::text[]))`,[SCHOOL, restoreIds.length?restoreIds:['']])).rows;

  console.log(`================ FIX LEFT-CAP ORPHAN CREDITS ${APPLY?'APPLY':'DRY-RUN'} ================`);
  console.log(`RESTORE charges (had a real payment): ${restore.length} · ${inr(restore.reduce((s,r)=>s+Number(r.debit),0))}`);
  restore.forEach(r=>console.log(`  restore ${String(r.adm).padEnd(12)} ${r.yr} ${inr(r.debit)} ${String(r.name).slice(0,18)}`));
  console.log(`CANCEL orphan concession/waiver (discount on voided phantom): ${cancelCr.length} · ${inr(cancelCr.reduce((s,r)=>s+Number(r.credit),0))}`);
  cancelCr.forEach(r=>console.log(`  cancel  ${String(r.adm).padEnd(12)} ${r.yr} ${r.kind} ${inr(r.credit)} ${String(r.name).slice(0,18)}`));

  if (APPLY) {
    const client=await pool.connect(); let rC=0,cC=0;
    try{ await client.query('begin');
      for(const r of restore){ const x=await client.query(`update student_ledger_entry set status='active', remarks=regexp_replace(coalesce(remarks,''),'\\s*\\[left-(void|cap)[^\\]]*\\]','','g') where uuid=$1 and status='cancelled'`,[r.uuid]); rC+=x.rowCount; }
      for(const r of cancelCr){ const x=await client.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [left-orphan-concession 2026-08-09]' where uuid=$1 and status='active'`,[r.uuid]); cC+=x.rowCount; }
      await client.query('commit'); }catch(e){await client.query('rollback');client.release();throw e;}
    client.release();
    console.log(`\nAPPLIED: restored ${rC} charges, cancelled ${cC} orphan concession/waiver rows.`);
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
