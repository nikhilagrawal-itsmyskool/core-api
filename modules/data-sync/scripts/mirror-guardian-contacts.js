// Backfill: mirror student_guardian phone numbers into the denormalised
// student.{father,mother,guardian}_{mobile,whatsapp} columns — the ONLY columns
// the communication ladder reads. Fixes students whose guardians have numbers but
// whose denormalised columns are blank (the "reachable but shown unreachable" gap).
//
// Fill-only: a relation's columns are written from its first active guardian row
// (by created_at); a relation with no active guardian row is left untouched, so
// this can never wipe existing denormalised values.
//
// Usage:
//   node modules/data-sync/scripts/mirror-guardian-contacts.js --stage prod --school-code DBPASN            (dry-run)
//   node modules/data-sync/scripts/mirror-guardian-contacts.js --stage prod --school-code DBPASN --apply --yes
const path = require('path');
const { loadConfig, createPool } = require('../../../scripts/run-sql.js');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
}
const STAGE = arg('--stage', 'prod');
const SCHOOL_CODE = arg('--school-code', 'DBPASN');
const APPLY = !!arg('--apply', false) && !!arg('--yes', false); // write only with --apply --yes

function mask(v) {
  if (!v || !String(v).trim()) return '(blank)';
  const s = String(v).trim();
  return s.length <= 4 ? s : s.slice(0, 2) + '****' + s.slice(-2);
}
const norm = (v) => (v && String(v).trim() ? String(v).trim() : null);

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const sch = await pool.query(`select uuid from school where code = $1`, [SCHOOL_CODE]);
  if (sch.rows.length === 0) throw new Error(`school ${SCHOOL_CODE} not found`);
  const schoolId = sch.rows[0].uuid;

  // Students where all 6 denormalised comms columns are blank but an active
  // guardian has a number (the gap). Widen to "any relation blank while its
  // guardian has a number" is possible, but we target the reported gap set only.
  const gap = await pool.query(
    `select s.uuid, s.name, s.admission_number
       from student s
      where s.school_id = $1 and s.status <> 'deleted'
        and coalesce(trim(s.father_mobile),'')='' and coalesce(trim(s.father_whatsapp),'')=''
        and coalesce(trim(s.mother_mobile),'')='' and coalesce(trim(s.mother_whatsapp),'')=''
        and coalesce(trim(s.guardian_mobile),'')='' and coalesce(trim(s.guardian_whatsapp),'')=''
        and exists (select 1 from student_guardian g
                     where g.student_id = s.uuid and g.status='active'
                       and (coalesce(trim(g.mobile),'')<>'' or coalesce(trim(g.whatsapp),'')<>''))
      order by s.admission_number`,
    [schoolId]
  );

  console.log(`\n${APPLY ? 'APPLY' : 'DRY-RUN'} — ${SCHOOL_CODE} (${STAGE}) — ${gap.rows.length} student(s) with the mirror gap\n`);

  let updated = 0;
  for (const s of gap.rows) {
    const gs = await pool.query(
      `select relation, mobile, whatsapp from student_guardian
        where student_id = $1 and school_id = $2 and status='active'
        order by case relation when 'father' then 1 when 'mother' then 2 when 'guardian' then 3 else 4 end, created_at`,
      [s.uuid, schoolId]
    );
    const set = {};
    for (const rel of ['father', 'mother', 'guardian']) {
      const g = gs.rows.find((r) => r.relation === rel);
      if (!g) continue;
      set[`${rel}_mobile`] = norm(g.mobile);
      set[`${rel}_whatsapp`] = norm(g.whatsapp);
    }
    const cols = Object.keys(set);
    if (cols.length === 0) continue;

    console.log(`• ${s.name} (${s.admission_number}): ${cols.map((c) => `${c}=${mask(set[c])}`).join(', ')}`);

    if (APPLY) {
      const params = cols.map((c) => set[c]);
      const assigns = cols.map((c, i) => `${c} = $${i + 1}`);
      params.push(new Date(), s.uuid, schoolId);
      await pool.query(
        `update student set ${assigns.join(', ')}, updated_at = $${params.length - 2}
          where uuid = $${params.length - 1} and school_id = $${params.length}`,
        params
      );
      updated++;
    }
  }

  console.log(`\n${APPLY ? `Updated ${updated} student(s).` : 'Dry-run only. Re-run with --apply --yes to write.'}`);
  await pool.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
