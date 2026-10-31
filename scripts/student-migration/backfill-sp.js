/**
 * Backfill the 49 receipt-only left students' demographics scraped from SchoolPad
 * (out/final-49.json) into prod. Fills ONLY null fields (coalesce, so idempotent and
 * never overwrites existing data) and creates father/mother guardian rows if none exist.
 *
 * DRY-RUN by default. Writes only with:  node backfill-sp.js --apply --yes
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, createPool, resolveCredentials } = require('../run-sql.js');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');
const SCHOOL = '2qy0xfycrq88';
const APPLY = process.argv.includes('--apply') && process.argv.includes('--yes');

const CAT = { obc: 'obc', general: 'general', sc: 'sc', st: 'st', ews: 'ews' };
const MT = { hindi: 'hindi', english: 'english', urdu: 'urdu', 'hindi/urdu': 'hindi/urdu' };
const code = (map, label) => { const k = String(label || '').trim().toLowerCase(); return map[k] || null; };
const gender = (g) => { const s = String(g || '').trim().toLowerCase(); return s === 'male' ? 'M' : s === 'female' ? 'F' : null; };
// DD-MM-YYYY -> YYYY-MM-DD; sentinel 30-11-0001 / invalid -> null
const ymd = (s) => { const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/); if (!m) return null; const [_, d, mo, y] = m; if (y === '0001' || Number(y) < 1950) return null; return `${y}-${mo}-${d}`; };
const nat = (n) => (String(n || '').trim().toLowerCase() === 'indian' ? 'indian' : null);

(async () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'final-49.json'), 'utf8'));
  const cfg = loadConfig('prod'); await resolveCredentials(cfg); const pool = createPool(cfg);
  console.log(`================ SchoolPad demographic backfill — ${APPLY ? 'APPLY' : 'DRY-RUN'} (${data.length} students) ================\n`);

  let upd = 0, gIns = 0, skipped = 0;
  for (const s of data) {
    const d = {
      dob: ymd(s.info.dob), gender: gender(s.info.gender), category_code: code(CAT, s.info.category),
      nationality_code: nat(s.info.nationality), mother_tongue_code: code(MT, s.info.motherTongue),
      admission_date: ymd(s.info.admDate), father_mobile: s.father.mobile || null, mother_mobile: s.mother.mobile || null,
    };
    // confirm the prod row is still sparse (safety)
    const cur = (await pool.query(`select dob, gender, category_code, nationality_code, admission_date,
        (select count(*)::int from student_guardian g where g.student_id=student.uuid and (g.status is null or g.status<>'deleted')) guardians
      from student where uuid=$1 and school_id=$2`, [s.uuid, SCHOOL])).rows[0];
    if (!cur) { console.log(`  !! ${s.adm} not found in prod — skip`); skipped++; continue; }

    const setCols = Object.entries(d).filter(([, v]) => v != null);
    console.log(`${s.adm}  ${s.info.gender||'?'} ${s.info.category||'?'} dob=${d.dob||'(none)'} adm=${d.admission_date||'?'}  F="${s.father.name}"${s.father.mobile?' '+s.father.mobile:''}  M="${s.mother.name}"${s.mother.mobile?' '+s.mother.mobile:''}  guardians=${cur.guardians}`);

    if (APPLY) {
      if (setCols.length) {
        const sets = setCols.map(([c], i) => `${c} = coalesce(${c}, $${i + 3})`).join(', ');
        await pool.query(`update student set ${sets}, updatedby_userid='sp-backfill', updated_at=now() where uuid=$1 and school_id=$2`,
          [s.uuid, SCHOOL, ...setCols.map(([, v]) => v)]);
        upd++;
      }
      if (cur.guardians === 0) {
        const mk = async (relation, g, primary) => {
          if (!g.name) return;
          await pool.query(`insert into student_guardian (uuid, school_id, student_id, relation, name, occupation, mobile, is_primary_contact, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,'active','sp-backfill',now())`,
            [generateShortUuid(12), SCHOOL, s.uuid, relation, g.name, g.occupation || null, g.mobile || null, !!primary]);
          gIns++;
        };
        await mk('father', s.father, true);
        await mk('mother', s.mother, false);
      }
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'WOULD'} update ${APPLY ? upd : data.length} students; ${APPLY ? 'inserted ' + gIns + ' guardians' : 'insert ~' + (data.length * 2) + ' guardians'}. skipped=${skipped}`);
  if (!APPLY) console.log('\n(dry-run — re-run with  --apply --yes  to write)');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
