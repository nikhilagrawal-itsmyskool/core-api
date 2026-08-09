/**
 * READ-ONLY. Reconstruct the left-student VOID/CAP audit from the DB truth (rows tagged
 * [left-void ...] / [left-cap ...]) joined with the SchoolPad register's Date-of-Last-Attendance,
 * so the decisions can be cross-checked against LA. Rewrites the review CSV from what is actually
 * in the ledger (the apply script clobbers that file on every dry-run; this is the reliable record).
 *
 * One row per (student, affected year, action): net due removed, the LA date that set the boundary,
 * the student's full per-year LA/WD from the register, and whether the student was imported today.
 *
 *   node modules/fees/scripts/audit-left-capvoid.js
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const OUT = path.join(__dirname, '../../../scripts/fees-migration/out', 'left-students-cap-void-AUDIT-2026-08-09.csv');
const dparts = (s) => { const m=String(s||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m?{d:+m[1],mo:+m[2],y:+m[3]}:null; };
const yStart = (yr) => { const m=String(yr).match(/(20\d\d)/); return m?+m[1]:null; };

(async () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/fees-migration/out/withdrawal-la-map.json'), 'utf8'));
  // all cancelled rows tagged left-void / left-cap, aggregated per student/year/action
  const rows = (await pool.query(`
    select s.admission_number adm, s.name, ay.name yr, s.created_at::date=current_date imported,
      case when le.remarks like '%[left-void%' then 'VOID' else 'CAP' end action,
      coalesce(sum(le.debit) filter (where le.kind='charge'),0) charges,
      coalesce(sum(le.credit) filter (where le.kind in ('concession','waiver')),0) conc,
      count(*) filter (where le.kind='charge') ncyc
    from student_ledger_entry le
    join student s on s.uuid=le.student_id
    join academic_year ay on ay.uuid=le.academic_year_id
    where le.school_id=$1 and le.status='cancelled' and (le.remarks like '%[left-void%' or le.remarks like '%[left-cap%')
    group by s.admission_number, s.name, ay.name, action, s.created_at::date
    order by s.admission_number, ay.name`,[SCHOOL])).rows;

  const laStr = (adm) => { const r=reg[String(adm).toUpperCase()]||{}; return Object.entries(r).filter(([,v])=>v.la).map(([y,v])=>`${y}:${v.la}`).join(' '); };
  const wdStr = (adm) => { const r=reg[String(adm).toUpperCase()]||{}; for(const v of Object.values(r)){ if(v.wd) return v.wd; } return ''; };
  const basisOf = (adm) => { const r=reg[String(adm).toUpperCase()]||{}; let b=null; for(const [y,v] of Object.entries(r)){ if(v.la&&dparts(v.la)){ const ys=yStart(y); if(ys&&(!b||ys>b.y)) b={y:ys,la:v.la,type:'LA'}; } } if(!b){ const w=wdStr(adm),d=dparts(w); if(d) b={y:(d.mo>=4?d.y:d.y-1),la:w,type:'WD'}; } return b; };

  const lines = ['action,adm,name,year,net_removed,charges_cancelled,concession_cancelled,cycles,basis_la_date,basis_year,basis_type,all_last_attendance,withdrawal_date,imported_today'];
  let vN=0,vAmt=0,cN=0,cAmt=0;
  rows.forEach(r=>{ const net=Number(r.charges)-Number(r.conc); const b=basisOf(r.adm)||{};
    if(r.action==='VOID'){vN++;vAmt+=net;}else{cN++;cAmt+=net;}
    lines.push([r.action,r.adm,'"'+r.name+'"',yStart(r.yr),Math.round(net),Math.round(r.charges),Math.round(r.conc),r.ncyc,b.la||'',b.y||'',b.type||'',(laStr(r.adm)||'').replace(/,/g,';'),wdStr(r.adm),r.imported?'Y':''].join(','));
  });
  fs.writeFileSync(OUT, lines.join('\n'));

  console.log('================ LEFT-STUDENT VOID/CAP AUDIT (reconstructed from DB) ================');
  console.log(`VOID cells: ${vN} · ${inr(vAmt)}`);
  console.log(`CAP  cells: ${cN} · ${inr(cAmt)}`);
  console.log(`distinct students affected: ${new Set(rows.map(r=>r.adm)).size}  |  imported-today among them: ${new Set(rows.filter(r=>r.imported).map(r=>r.adm)).size}`);
  console.log(`\nrewritten -> ${OUT}  (${rows.length} rows)`);
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
