/** Thorough same-child analysis for the 7 name-clash missing students. For each, read identity
 * fields from its detail CSV, then pull from prod EVERY candidate that could be the same child —
 * by exact/like name, by father/mother mobile, or by DOB — and show a side-by-side with match
 * flags. READ-ONLY. Decides nothing; surfaces evidence so a human can judge link vs insert. */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getCreds } = require('./db-creds');

const DETAIL = path.join(__dirname, 'out', 'raw', 'detail');
const SCHOOL = '2qy0xfycrq88';
const TARGETS = ['195/J/2K21', '1030/S/2K21', '313/S/2K21', '1071/S/2K21', '107/S/2K18', '143/S/2K19', '1037/S/2K21'];
const admKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
const clean = (v) => { const s = String(v ?? '').trim(); return s === '---' || s === '' ? '' : s; };
const norm = (v) => clean(v).toLowerCase().replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
const digits = (v) => clean(v).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const pdate = (raw) => { const s = clean(raw).replace(/'/g, ''); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''); };
const badDob = (d) => !d || d < '1950-01-01';

// index detail files by adm
const detailByAdm = {};
for (const n of fs.readdirSync(DETAIL)) {
  if (!/\.csv$/i.test(n) || n.startsWith('_')) continue;
  const raw = fs.readFileSync(path.join(DETAIL, n), 'utf8'); const s = raw.indexOf('"Sr. No."'); if (s < 0) continue;
  for (const r of parse(raw.slice(s), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true })) {
    const k = admKey(r['Adm. No.']); if (k) detailByAdm[k] = r;
  }
}

(async () => {
  const pool = new Pool({ ...(await getCreds('prod')), max: 2 });
  pool.on('error', () => {});

  for (const adm of TARGETS) {
    const d = detailByAdm[admKey(adm)];
    console.log('\n' + '='.repeat(100));
    if (!d) { console.log(adm, '— NO DETAIL FILE'); continue; }
    const me = {
      adm: clean(d['Adm. No.']), name: clean(d['Student Name']), gender: clean(d['Gender']),
      dob: pdate(d['D.O.B']), father: clean(d["Father's Name"]), mother: clean(d["Mother's Name"]),
      fMob: digits(d['Father Mobile No.']), mMob: digits(d['Mother Mobile No.']), gMob: digits(d['Guardian Mobile No.']),
      admDate: pdate(d['Date Of Admission']), wd: pdate(d['Date Of Withdrawal']), addr: clean(d['Permanent Address']).replace(/\s+/g, ' '),
    };
    console.log(`MISSING  ${me.adm}  ${me.name}  (${me.gender})  DOB ${me.dob || '—(bad)'}`);
    console.log(`  father: ${me.father || '—'} | mob ${me.fMob || '—'}    mother: ${me.mother || '—'} | mob ${me.mMob || '—'}  ${me.gMob ? '| guardianMob ' + me.gMob : ''}`);
    console.log(`  admitted ${me.admDate || '—'}  withdrawn ${me.wd || '—'}  | addr: ${me.addr || '—'}`);

    // candidate search: name token OR mobile OR dob
    const firstTok = norm(me.name).split(' ')[0] || '';
    const mobiles = [me.fMob, me.mMob, me.gMob].filter(Boolean);
    const q = `
      select s.admission_number, s.old_admission_number, s.name, to_char(s.dob,'YYYY-MM-DD') dob, s.status,
             to_char(s.admission_date,'YYYY-MM-DD') adm_date, to_char(s.withdrawal_date,'YYYY-MM-DD') wd,
             s.father_mobile, s.mother_mobile,
             max(case when g.relation='father' then g.name end) f_name,
             max(case when g.relation='father' then g.mobile end) f_mob,
             max(case when g.relation='mother' then g.name end) m_name,
             max(case when g.relation='mother' then g.mobile end) m_mob
      from student s
      left join student_guardian g on g.student_id=s.uuid and g.school_id=s.school_id and g.status='active'
      where s.school_id=$1 and s.status<>'deleted' and lower(s.admission_number) <> lower($5)
        and ( lower(s.name) like $2
              or ($3 <> '' and (regexp_replace(coalesce(s.father_mobile,''),'\\D','','g') like '%'||$3 or regexp_replace(coalesce(s.mother_mobile,''),'\\D','','g') like '%'||$3))
              or ($4 <> '' and to_char(s.dob,'YYYY-MM-DD') = $4) )
      group by s.uuid, s.admission_number, s.old_admission_number, s.name, s.dob, s.status, s.admission_date, s.withdrawal_date, s.father_mobile, s.mother_mobile
      order by s.name`;
    const mobTok = mobiles[0] ? mobiles[0].slice(-10) : '';
    const r = await pool.query(q, [SCHOOL, '%' + firstTok + '%', mobTok, badDob(me.dob) ? '' : me.dob, me.adm]);
    if (!r.rows.length) { console.log('  >> NO candidates by name/mobile/DOB  => looks GENUINELY NEW'); continue; }
    console.log(`  candidates (${r.rows.length}):`);
    for (const c of r.rows) {
      const cfMob = digits(c.f_mob || c.father_mobile), cmMob = digits(c.m_mob || c.mother_mobile);
      const flags = [];
      if (!badDob(me.dob) && c.dob === me.dob) flags.push('DOB-MATCH'); else if (!badDob(me.dob) && c.dob && c.dob !== me.dob) flags.push('DOB-mismatch');
      if (me.father && c.f_name && norm(me.father) === norm(c.f_name)) flags.push('father-OK');
      if (me.mother && c.m_name && norm(me.mother) === norm(c.m_name)) flags.push('mother-OK');
      if (me.fMob && (cfMob === me.fMob || cmMob === me.fMob)) flags.push('fMob-OK');
      if (me.mMob && (cmMob === me.mMob || cfMob === me.mMob)) flags.push('mMob-OK');
      console.log(`    - ${c.admission_number} [${c.status}]  ${c.name}  DOB ${c.dob || '—'}  adm ${c.adm_date || '—'} wd ${c.wd || '—'}  ${c.old_admission_number ? 'oldAdm=' + c.old_admission_number + ' ' : ''}${flags.length ? ' >> ' + flags.join(' ') : ' >> (name-only)'}`);
      console.log(`        father: ${clean(c.f_name) || '—'} | ${cfMob || '—'}    mother: ${clean(c.m_name) || '—'} | ${cmMob || '—'}`);
    }
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
