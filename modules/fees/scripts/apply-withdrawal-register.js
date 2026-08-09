/**
 * Cap & void dues for LEFT (inactive) students using per-(student,year) Date of Last Attendance,
 * combined from SchoolPad's Admission Withdrawal Register exported once per session
 * (out/withdrawal-la-map.json, built from the 6 per-session CSVs).
 *
 * Per INACTIVE student:  lastLAyear = latest academic year with a recorded last-attendance.
 *   - charged years  > lastLAyear  -> VOID (didn't attend after leaving)      [high confidence]
 *   - the lastLAyear year          -> CAP: void unpaid cycles due after the LA month  [flag]
 *   - years <= lastLAyear          -> KEEP (attended)
 *   - no LA in any year but a Withdrawal Date exists -> use WD year/month the same way
 *   - no LA and no WD              -> UNKNOWN, leave for manual review (listed)
 * Never voids a real payment (a to-void year with a payment is FLAGGED, not voided).
 * Only touches status='inactive' students. Dry-run default; --apply --yes writes (reversible).
 *
 *   node modules/fees/scripts/apply-withdrawal-register.js
 *   node modules/fees/scripts/apply-withdrawal-register.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const REPORT = path.join(__dirname, '../../../scripts/fees-migration/out', 'left-students-cap-void-2026-08-09.csv');
const dparts = (s) => { const m=String(s||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m?{d:+m[1],mo:+m[2],y:+m[3]}:null; };
const yStart = (yr) => { const m=String(yr).match(/(20\d\d)/); return m?+m[1]:null; }; // "2023-24" -> 2023

(async () => {
  const laMap = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/fees-migration/out/withdrawal-la-map.json'), 'utf8'));
  // academic year id -> start year, and cycle due month per cycle
  const ays = (await pool.query(`select uuid,name from academic_year where school_id=$1`,[SCHOOL])).rows;
  const ayStart={}; ays.forEach(a=>{const m=String(a.name).match(/(20\d\d)/); if(m) ayStart[a.uuid]=+m[1];});
  const cycleDue={}; (await pool.query(`select uuid, coalesce(due_date,from_date) dt from fee_cycle where school_id=$1 and status='active'`,[SCHOOL])).rows.forEach(c=>{if(c.dt){const d=new Date(c.dt);cycleDue[c.uuid]={abs:d.getFullYear()*12+d.getMonth()+1};}});

  // inactive students' charged years
  const cy=(await pool.query(`
    select l.student_id, l.academic_year_id, s.admission_number adm, s.name,
      coalesce(sum(l.debit) filter(where l.kind='charge'),0) charged,
      coalesce(sum(l.credit) filter(where l.kind='payment'),0) paid,
      coalesce(sum(l.debit),0)-coalesce(sum(l.credit),0) net
    from student_ledger_entry l join student s on s.uuid=l.student_id
    where l.school_id=$1 and l.status='active' and s.status='inactive'
    group by l.student_id,l.academic_year_id,s.admission_number,s.name`,[SCHOOL])).rows;

  // group by student
  const byStu={}; cy.forEach(r=>{(byStu[r.student_id]=byStu[r.student_id]||{adm:r.adm,name:r.name,years:[]}).years.push(r);});

  const voidCells=[], capCells=[], flagged=[], unknown=[];
  for (const sid of Object.keys(byStu)) {
    const st=byStu[sid]; const reg=laMap[String(st.adm).toUpperCase()]||{};
    // last attended year (max session with an LA date)
    let lastLA=null; for(const [yr,v] of Object.entries(reg)){ if(v.la && dparts(v.la)){ const ys=yStart(yr); if(ys && (!lastLA||ys>lastLA.y)) lastLA={y:ys, dep:dparts(v.la)}; } }
    let basis=lastLA;
    if(!basis){ // fall back to withdrawal date
      let wd=null; for(const v of Object.values(reg)){ if(v.wd&&dparts(v.wd)) wd=dparts(v.wd); } if(wd) basis={y:(wd.mo>=4?wd.y:wd.y-1), dep:wd, fromWD:true};
    }
    if(!basis){ st.years.forEach(r=>{ if(Number(r.charged)>0) unknown.push(r); }); continue; }
    const depAbs = basis.dep.y*12 + basis.dep.mo;
    const laStr = `${String(basis.dep.d).padStart(2,'0')}/${String(basis.dep.mo).padStart(2,'0')}/${basis.dep.y}`;
    const basisType = basis.fromWD ? 'WD' : 'LA';
    for(const r of st.years){ const ys=ayStart[r.academic_year_id]; if(!ys||Number(r.charged)<=0) continue;
      const meta={ la:laStr, basisYear:basis.y, basisType };
      if(ys>basis.y){ if(Number(r.paid)>0.5) flagged.push({...r,...meta}); else voidCells.push({...r,ys,...meta}); }
      else if(ys===basis.y){ // cap unpaid cycles after departure month (never touch a cycle carrying a real payment)
        const rows=(await pool.query(`select l.uuid,l.cycle_id,l.debit,
            coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=l.uuid and cr.status='active' and cr.kind='payment'),0) pay,
            coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=l.uuid and cr.status='active'),0) paid
          from student_ledger_entry l where l.school_id=$1 and l.student_id=$2 and l.academic_year_id=$3 and l.kind='charge' and l.status='active'`,[SCHOOL,sid,r.academic_year_id])).rows;
        let cn=0; rows.forEach(cr=>{const cd=cycleDue[cr.cycle_id]; if(cd && cd.abs>depAbs && Number(cr.pay)<0.5){ const rem=Number(cr.debit)-Number(cr.paid); if(rem>0.5) cn+=rem; }});
        if(cn>0.5) capCells.push({...r,ys,capNet:cn,dep:basis.dep,fromWD:basis.fromWD,...meta});
      }
    }
  }
  const sum=a=>a.reduce((s,r)=>s+Math.max(0,Number(r.net||r.capNet||0)),0);
  const voidNet=voidCells.reduce((s,r)=>s+Math.max(0,Number(r.net)),0);
  const capNet=capCells.reduce((s,r)=>s+r.capNet,0);
  fs.mkdirSync(path.dirname(REPORT),{recursive:true});
  // dry-runs write a *-preview file so they can never clobber the applied audit (rebuild that from the
  // DB with audit-left-capvoid.js — it reflects the tagged [left-void]/[left-cap] rows actually cancelled)
  const OUTFILE = APPLY ? REPORT : REPORT.replace(/\.csv$/, '-preview.csv');
  const lines=['action,adm,name,year,net_or_cap,paid,last_attendance,basis_year,basis_type'];
  voidCells.forEach(r=>lines.push(`VOID,${r.adm},"${r.name}",${r.ys},${Math.round(Math.max(0,r.net))},${Math.round(r.paid)},${r.la},${r.basisYear},${r.basisType}`));
  capCells.forEach(r=>lines.push(`CAP,${r.adm},"${r.name}",${r.ys},${Math.round(r.capNet)},,${r.la},${r.basisYear},${r.basisType}`));
  flagged.forEach(r=>lines.push(`FLAG_PAID,${r.adm},"${r.name}",${ayStart[r.academic_year_id]},${Math.round(r.net)},${Math.round(r.paid)},${r.la||''},${r.basisYear||''},${r.basisType||''}`));
  unknown.forEach(r=>lines.push(`UNKNOWN,${r.adm},"${r.name}",${ayStart[r.academic_year_id]},${Math.round(Math.max(0,r.net))},${Math.round(r.paid)},,,`));
  try { fs.writeFileSync(OUTFILE,lines.join('\n')); } catch(e){ console.log(`  (couldn't rewrite review CSV — ${e.code}; likely open in Excel — continuing)`); }

  console.log(`================ LEFT-STUDENT CAP/VOID ${APPLY?'APPLY':'DRY-RUN'} (inactive only) ================`);
  console.log(`VOID  (years after last-attendance, unpaid): ${voidCells.length} cells · ${inr(voidNet)}`);
  console.log(`CAP   (last year, cycles after departure month, unpaid): ${capCells.length} cells · ${inr(capNet)}`);
  console.log(`FLAG  (to-void year has a payment — review): ${flagged.length}`);
  console.log(`UNKNOWN (no last-attendance & no withdrawal date — manual): ${unknown.length} cells · ${inr(sum(unknown))}`);
  console.log(`review CSV -> ${OUTFILE}`);
  const spot=(adm)=>{const r=Object.values(byStu).find(s=>s.adm===adm); if(!r)return `${adm}: not inactive/charged`;
    const reg=laMap[adm.toUpperCase()]||{}; const las=Object.entries(reg).filter(([,v])=>v.la).map(([y,v])=>`${y}:${v.la}`).join(', ');
    const v=voidCells.filter(x=>x.adm===adm).map(x=>x.ys), c=capCells.filter(x=>x.adm===adm).map(x=>`${x.ys}@${inr(x.capNet)}`);
    return `${adm} (${r.name}) LA[${las||'none'}] -> VOID ${v.join(',')||'-'} · CAP ${c.join(',')||'-'}`; };
  console.log('\nspot checks:'); ['207/S/2K19','500/S/2K22','102/S/2K18'].forEach(a=>console.log('  '+spot(a)));

  if (APPLY) {
    const client=await pool.connect(); let led=0;
    try{ await client.query('begin');
      for(const r of voidCells){ const x=await client.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [left-void 2026-08-09]' where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active' and kind in ('charge','concession')`,[SCHOOL,r.student_id,r.academic_year_id]); led+=x.rowCount; }
      for(const r of capCells){ const rows=(await client.query(`select l.uuid,l.cycle_id,l.debit,
            coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=l.uuid and cr.status='active' and cr.kind='payment'),0) pay,
            coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=l.uuid and cr.status='active'),0) paid
          from student_ledger_entry l where l.school_id=$1 and l.student_id=$2 and l.academic_year_id=$3 and l.kind='charge' and l.status='active'`,[SCHOOL,r.student_id,r.academic_year_id])).rows;
        for(const cr of rows){ const cd=cycleDue[cr.cycle_id]; if(cd && cd.abs> (r.dep.y*12+r.dep.mo) && Number(cr.pay)<0.5 && (Number(cr.debit)-Number(cr.paid))>0.5){
          const x=await client.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [left-cap 2026-08-09]' where uuid=$1 and status='active'`,[cr.uuid]); led+=x.rowCount;
          // also cancel any concession/waiver discount that settled this now-voided phantom charge
          const y=await client.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [left-cap 2026-08-09]' where school_id=$1 and settles_entry_id=$2 and status='active' and kind in ('concession','waiver')`,[SCHOOL,cr.uuid]); led+=y.rowCount;
        } } }
      await client.query('commit'); }catch(e){await client.query('rollback');client.release();throw e;}
    client.release();
    console.log(`\nAPPLIED: ${led} ledger rows cancelled (void+cap). Flagged/unknown left untouched.`);
  } else console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
