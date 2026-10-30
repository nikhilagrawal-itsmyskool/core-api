/** Sweep the 15 imported left-students for an existing SAME-CHILD record under a different
 * (usually newer/active) admission number that wasn't auto-linked (e.g. spelling variant dodged
 * name+DOB). Match on DOB (valid) + father/mother name + parent mobiles. READ-ONLY — prints a
 * ranked verdict per student; links nothing. */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { getCreds } = require('./db-creds');
const SCHOOL = '2qy0xfycrq88';
const ADMS = ['1072/S/2K21', '184/J/2K21', '198/S/2K19', '212/S/2K20', '213/S/2K20', '225/S/2K20', '255/S/2K21', '265/S/2K21', '273/S/2K21', '274/S/2K21', '306/S/2K21', '312/S/2K21', '332/S/2K21', '52/S/2K17', '53/S/2K17'];
const clean = (v) => String(v ?? '').trim();
const norm = (v) => clean(v).toLowerCase().replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
const digits = (v) => clean(v).replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const badDob = (d) => !d || d < '1950-01-01';

const SEL = `select s.uuid, s.admission_number adm, s.old_admission_number old, s.name, to_char(s.dob,'YYYY-MM-DD') dob, s.status,
  to_char(s.admission_date,'YYYY-MM-DD') adm_date,
  regexp_replace(coalesce(s.father_mobile,''),'\\D','','g') fmob, regexp_replace(coalesce(s.mother_mobile,''),'\\D','','g') mmob,
  max(case when g.relation='father' then g.name end) f_name, max(case when g.relation='mother' then g.name end) m_name
  from student s left join student_guardian g on g.student_id=s.uuid and g.school_id=s.school_id and g.status='active'
  where s.school_id=$1 and s.status<>'deleted'`;

(async () => {
  const pool = new Pool({ ...(await getCreds('prod')), max: 2 });
  pool.on('error', () => {});
  const me = (await pool.query(SEL + ' and s.admission_number = any($2) group by s.uuid', [SCHOOL, ADMS])).rows;
  const strong = [];
  for (const m of me) {
    const mFmob = digits(m.fmob), mMmob = digits(m.mmob);
    // candidates: other students sharing DOB (valid) OR a parent mobile
    const q = SEL + ` and s.uuid <> $2 and (
        ($3 <> '' and to_char(s.dob,'YYYY-MM-DD') = $3)
        or ($4 <> '' and (regexp_replace(coalesce(s.father_mobile,''),'\\D','','g') like '%'||$4 or regexp_replace(coalesce(s.mother_mobile,''),'\\D','','g') like '%'||$4))
        or ($5 <> '' and (regexp_replace(coalesce(s.father_mobile,''),'\\D','','g') like '%'||$5 or regexp_replace(coalesce(s.mother_mobile,''),'\\D','','g') like '%'||$5))
      ) group by s.uuid order by s.status, s.admission_number`;
    const cands = (await pool.query(q, [SCHOOL, m.uuid, badDob(m.dob) ? '' : m.dob, mFmob ? mFmob.slice(-10) : '', mMmob ? mMmob.slice(-10) : ''])).rows;
    if (!cands.length) continue;
    console.log(`\n${m.adm} [${m.status}] ${m.name}  DOB ${m.dob}  father ${clean(m.f_name) || '—'} / ${mFmob || '—'}`);
    for (const c of cands) {
      const cFmob = digits(c.fmob), cMmob = digits(c.mmob);
      const f = [];
      if (!badDob(m.dob) && c.dob === m.dob) f.push('DOB');
      if (m.f_name && c.f_name && norm(m.f_name) === norm(c.f_name)) f.push('father');
      if (m.m_name && c.m_name && norm(m.m_name) === norm(c.m_name)) f.push('mother');
      if (mFmob && (cFmob === mFmob || cMmob === mFmob)) f.push('fMob');
      if (mMmob && (cMmob === mMmob || cFmob === mMmob)) f.push('mMob');
      const isStrong = (f.includes('DOB') && (f.includes('father') || f.includes('fMob') || f.includes('mMob'))) || (f.includes('fMob') && (f.includes('father') || f.includes('mother')));
      console.log(`   ${isStrong ? '>>> SAME-CHILD?' : '   maybe     '}  ${c.adm} [${c.status}] ${c.name}  DOB ${c.dob}  father ${clean(c.f_name) || '—'} / ${cFmob || '—'}  ${c.old ? 'old=' + c.old : ''}  [${f.join('+') || 'weak'}]`);
      // pick the newest active strong candidate as the link target
      if (isStrong) strong.push({ old: m.adm, oldName: m.name, target: c.adm, targetName: c.name, targetStatus: c.status, targetOld: c.old, flags: f.join('+') });
    }
  }
  console.log('\n\n================ STRONG SAME-CHILD CANDIDATES (would link old -> current) ================');
  if (!strong.length) console.log('  none beyond what is already linked.');
  for (const s of strong) console.log(`  ${s.old} (${s.oldName})  ->  ${s.target} [${s.targetStatus}] (${s.targetName})  [${s.flags}]${s.targetOld ? '  ALREADY old=' + s.targetOld : ''}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
