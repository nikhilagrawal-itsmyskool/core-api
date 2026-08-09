/**
 * READ-ONLY. Consolidated list of every admission that originated OUTSIDE itsmyskool — i.e. present
 * in the SchoolPad withdrawal register but either (a) still has no student record, or (b) was just
 * imported thin (created today with only name/class/withdrawal, no demographics). Both sets need a
 * full profile fetch from SchoolPad. Writes a CSV keyed by admission number for that fetch.
 *
 *   node modules/fees/scripts/list-students-not-in-itsmyskool.js
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const OUT = path.join(__dirname, '../../../scripts/fees-migration/out', 'students-not-in-itsmyskool-2026-08-09.csv');
const clsPrefix = (c) => { const m=String(c||'').match(/^([^(]+?)\s*(?:\(|$)/); return m?m[1].trim():''; };

(async () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/fees-migration/out/withdrawal-la-map.json'), 'utf8'));
  const today = new Date().toISOString().slice(0,10);

  // existing students (for created-today = imported-thin flag + name)
  const stu = (await pool.query(`select admission_number adm, lower(admission_number) la, name, status, created_at::date=current_date imported_today from student where school_id=$1`,[SCHOOL])).rows;
  const byLower = new Map(); stu.forEach(s=>byLower.set(s.la, s));

  // fee footprint per admission (works for imported students via student_id, and any residual null-ledger)
  const fp = {};
  (await pool.query(`
    select coalesce(lower(s.admission_number), lower(substring(le.remarks from 'adm:(\\S+)'))) adm,
      coalesce(sum(le.debit) filter (where le.kind='charge'),0) ch,
      coalesce(sum(le.credit) filter (where le.kind='payment'),0) pay,
      coalesce(sum(le.debit),0)-coalesce(sum(le.credit),0) net
    from student_ledger_entry le left join student s on s.uuid=le.student_id
    where le.school_id=$1 and le.status='active'
    group by 1`,[SCHOOL])).rows.forEach(r=>{ if(r.adm) fp[r.adm]={ch:+r.ch,pay:+r.pay,net:+r.net}; });

  const rows = [];
  for (const adm of Object.keys(reg)) {
    const s = byLower.get(adm.toLowerCase());
    // include only those that originated outside itsmyskool: missing, or imported-thin today
    if (s && !s.imported_today) continue;
    const r = reg[adm];
    let cls='', la='', laDate='', wd='';
    for (const [y,v] of Object.entries(r)) { if(v.cls&&!cls)cls=clsPrefix(v.cls); if(v.la){la=`${y}:${v.la}`; laDate=v.la;} if(v.wd&&!wd)wd=v.wd; }
    const f = fp[adm.toLowerCase()] || {};
    rows.push({
      adm, name: s?s.name:'', cls, status: s?'IMPORTED_THIN':'MISSING',
      action: s?'fetch full profile (enrich)':'fetch full profile (create)',
      lastLA: laDate||'', lastLAyear: la||'', wd: wd||'',
      ch: f.ch||0, pay: f.pay||0, net: f.net||0,
    });
  }
  rows.sort((a,b)=> (a.status<b.status?-1:a.status>b.status?1:0) || (a.adm<b.adm?-1:1));

  const lines = ['admission_number,name,class,status_in_itsmyskool,action_needed,last_attendance,last_attendance_year,withdrawal_date,charged,paid,net_due'];
  rows.forEach(r=>lines.push([r.adm,'"'+r.name+'"',r.cls,r.status,'"'+r.action+'"',r.lastLA,r.lastLAyear,r.wd,Math.round(r.ch),Math.round(r.pay),Math.round(r.net)].join(',')));
  fs.mkdirSync(path.dirname(OUT),{recursive:true});
  try { fs.writeFileSync(OUT, lines.join('\n')); } catch(e){ console.log(`  (couldn't write ${e.code}; close it in Excel and re-run)`); }

  const thin = rows.filter(r=>r.status==='IMPORTED_THIN'), missing = rows.filter(r=>r.status==='MISSING');
  console.log('================ STUDENTS NOT ORIGINALLY IN ITSMYSKOOL ================');
  console.log(`total: ${rows.length}`);
  console.log(`  IMPORTED_THIN (created today, need demographic enrich): ${thin.length}  ·  fee net ${inr(thin.reduce((s,r)=>s+r.net,0))}`);
  console.log(`  MISSING (no record, need full create): ${missing.length}  ·  fee net ${inr(missing.reduce((s,r)=>s+r.net,0))}`);
  console.log(`\n  MISSING (${missing.length}):`);
  missing.forEach(r=>console.log(`    ${r.adm.padEnd(14)} cls=${(r.cls||'?').padEnd(12)} lastLA=${r.lastLA||'-'}  wd=${r.wd||'-'}`));
  console.log(`\nCSV -> ${OUT}`);
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1);});
