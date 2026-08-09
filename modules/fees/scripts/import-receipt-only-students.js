/**
 * Import the "receipt-only" left students — admissions that exist in the fee ledger/receipts
 * (as student_id=null rows tagged `adm:<no> <name>` in remarks) but have no `student` record.
 *
 * These are single-year historical students who left; the migration loaded their charges/payments
 * with student_id=null because the student record was never created. Every such admission is in
 * the SchoolPad withdrawal register, so we have a departure signal for the tail-cap that follows.
 *
 * Per admission (idempotent on admission_number):
 *   1. create student (status='inactive') — name from the receipt payer/ledger remark, withdrawal_date
 *      from the register; demographics (dob/gender/category/…) left null for a later rich backfill.
 *   2. create ONE student_class enrolment (the single ledger year + class from payer_class_snapshot).
 *   3. re-point their null-student ledger rows  (split_part(remarks,' ',1) = 'adm:'||no)  -> new uuid.
 *   4. re-point their null-student fee_receipt rows (admission_no_snapshot = no, active+cancelled).
 * The phantom post-departure tail is NOT touched here — run apply-withdrawal-register.js afterwards
 * (these students then appear as inactive-with-charges and get the same cap/void as everyone else).
 *
 *   node modules/fees/scripts/import-receipt-only-students.js
 *   node modules/fees/scripts/import-receipt-only-students.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const REPORT = path.join(__dirname, '../../../scripts/fees-migration/out', 'import-receipt-only-students-2026-08-09.csv');
const admOf = (r) => { const m = String(r||'').match(/^adm:(\S+)/); return m ? m[1] : null; };
const nameOf = (r) => { const m = String(r||'').match(/^adm:\S+\s+(.*)$/); return m ? m[1].trim() : null; };
const dparts = (s) => { const m=String(s||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m?new Date(Date.UTC(+m[3],+m[2]-1,+m[1])):null; };

(async () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/fees-migration/out/withdrawal-la-map.json'), 'utf8'));
  // null-student ledger grouped by admission
  const led = (await pool.query(`select remarks, kind, debit, credit, academic_year_id, status from student_ledger_entry where school_id=$1 and student_id is null`,[SCHOOL])).rows;
  const stu = {};
  for (const r of led) { const a = admOf(r.remarks); if (!a) continue;
    const s = stu[a] = stu[a] || { adm:a, name:nameOf(r.remarks), years:new Set(), ch:0, pay:0, conc:0, ledN:0 };
    s.ledN++; s.years.add(r.academic_year_id);
    if (r.status==='active') { if(r.kind==='charge')s.ch+=+r.debit||0; else if(r.kind==='payment')s.pay+=+r.credit||0; else if(r.kind==='concession')s.conc+=+r.credit||0; }
  }
  // receipt info per admission (class snapshot, better name, receipt count)
  const rc = (await pool.query(`select admission_no_snapshot adm, min(payer_name) nm, max(payer_class_snapshot) cls, count(*) rn from fee_receipt where school_id=$1 and student_id is null group by admission_no_snapshot`,[SCHOOL])).rows;
  const rcMap = {}; rc.forEach(r=>rcMap[r.adm]=r);
  // class name -> uuid (non-cohort)
  const classes = (await pool.query(`select uuid,name,class_group_id from class where school_id=$1`,[SCHOOL])).rows;
  const clsByName = {}; classes.forEach(c=>{ if(!c.class_group_id) clsByName[String(c.name).toLowerCase()]=c.uuid; });
  const ays = (await pool.query(`select uuid,name from academic_year where school_id=$1`,[SCHOOL])).rows;
  const ayName = {}; ays.forEach(a=>ayName[a.uuid]=a.name);
  // existing students (idempotency)
  const existing = new Set((await pool.query(`select lower(admission_number) a from student where school_id=$1`,[SCHOOL])).rows.map(r=>r.a));

  const adms = Object.keys(stu).sort();
  const plan = [];
  for (const a of adms) {
    const s = stu[a]; const r = rcMap[a] || {};
    const yr = [...s.years][0];
    const regRow = reg[a.toUpperCase()] || {};
    // class: prefer the receipt snapshot; fall back to the register's class (strip the " (2025-2026)" suffix)
    let clsSnap = r.cls || null;
    if (!clsSnap) { for (const v of Object.values(regRow)) { const m=String(v.cls||'').match(/^([^(]+?)\s*(?:\(|$)/); if(m&&m[1]){ clsSnap=m[1].trim(); break; } } }
    const clsId = clsSnap ? clsByName[String(clsSnap).toLowerCase()] : null;
    let wd = null; for (const v of Object.values(regRow)) { const d=dparts(v.wd); if(d){wd=d;break;} }
    plan.push({
      adm:a, name:(r.nm||s.name||'').trim(), yr, ayName:ayName[yr], clsSnap, clsId,
      ch:s.ch, pay:s.pay, conc:s.conc, net:s.ch-s.pay-s.conc, ledN:s.ledN, rn:r.rn||0, wd,
      exists: existing.has(a.toLowerCase()), multiYear:s.years.size>1,
    });
  }
  const toCreate = plan.filter(p=>!p.exists);
  const skip = plan.filter(p=>p.exists);
  const noClass = toCreate.filter(p=>!p.clsId);
  const multi = toCreate.filter(p=>p.multiYear);

  console.log(`================ IMPORT RECEIPT-ONLY STUDENTS ${APPLY?'APPLY':'DRY-RUN'} ================`);
  console.log(`admissions in null-ledger: ${plan.length}  |  to create: ${toCreate.length}  |  already exist (skip): ${skip.length}`);
  console.log(`  multi-year (should be 0): ${multi.length}  |  unresolved class: ${noClass.length}`);
  console.log(`  totals to import: charged ${inr(toCreate.reduce((s,p)=>s+p.ch,0))}  paid ${inr(toCreate.reduce((s,p)=>s+p.pay,0))}  net ${inr(toCreate.reduce((s,p)=>s+p.net,0))}`);
  if (noClass.length) { console.log('\n  !! UNRESOLVED CLASS (enrolment class_id will be null):'); noClass.forEach(p=>console.log(`     ${p.adm} "${p.clsSnap}"`)); }
  console.log('\n  adm            name                  year     class   ledN rcpt  charged     paid       net');
  toCreate.forEach(p=>console.log(`  ${String(p.adm).padEnd(14)} ${String(p.name).slice(0,20).padEnd(20)} ${p.ayName||'?'}  ${String(p.clsSnap||'?').padEnd(7)} ${String(p.ledN).padStart(3)} ${String(p.rn).padStart(4)}  ${inr(p.ch).padEnd(10)} ${inr(p.pay).padEnd(9)} ${inr(p.net)}`));

  // review CSV
  try {
    const lines = ['adm,name,year,class,class_resolved,ledger_rows,receipts,charged,paid,concession,net,withdrawal_date,exists'];
    plan.forEach(p=>{ const wdStr = p.wd ? p.wd.toISOString().slice(0,10) : '';
      lines.push([p.adm, '"'+p.name+'"', p.ayName||'', p.clsSnap||'', p.clsId?'Y':'N', p.ledN, p.rn, Math.round(p.ch), Math.round(p.pay), Math.round(p.conc), Math.round(p.net), wdStr, p.exists?'Y':''].join(',')); });
    fs.mkdirSync(path.dirname(REPORT),{recursive:true}); fs.writeFileSync(REPORT, lines.join('\n'));
    console.log(`\nreview CSV -> ${REPORT}`);
  } catch(e){ console.log(`  (couldn't write review CSV — ${e.code}; continuing)`); }

  if (APPLY) {
    const client = await pool.connect(); let created=0, enrol=0, ledRepoint=0, rcRepoint=0;
    try { await client.query('begin');
      for (const p of toCreate) {
        const sid = generateShortUuid(12);
        await client.query(`insert into student (uuid, admission_number, name, school_id, status, withdrawal_date, createdby_userid, created_at, updatedby_userid, updated_at)
          values ($1,$2,$3,$4,'inactive',$5,'0',now(),'0',now())`, [sid, p.adm, p.name, SCHOOL, p.wd]);
        created++;
        await client.query(`insert into student_class (uuid, student_id, academic_year_id, class_id, school_id, status, createdby_userid, created_at, updatedby_userid, updated_at)
          values ($1,$2,$3,$4,$5,'active','0',now(),'0',now())`, [generateShortUuid(12), sid, p.yr, p.clsId, SCHOOL]);
        enrol++;
        const l = await client.query(`update student_ledger_entry set student_id=$1, updated_at=now() where school_id=$2 and student_id is null and split_part(remarks,' ',1)=$3`, [sid, SCHOOL, 'adm:'+p.adm]);
        ledRepoint += l.rowCount;
        const r = await client.query(`update fee_receipt set student_id=$1, updated_at=now() where school_id=$2 and student_id is null and admission_no_snapshot=$3`, [sid, SCHOOL, p.adm]);
        rcRepoint += r.rowCount;
      }
      await client.query('commit');
    } catch(e){ await client.query('rollback'); client.release(); throw e; }
    client.release();
    console.log(`\nAPPLIED: created ${created} students + ${enrol} enrolments; re-pointed ${ledRepoint} ledger rows, ${rcRepoint} receipts.`);
    console.log('NEXT: run apply-withdrawal-register.js --apply --yes to cap/void their post-departure phantom tail.');
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
