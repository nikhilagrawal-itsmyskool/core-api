/**
 * Backfill the concession ASSIGNMENT LIST (fee_concession_student) to match the LEDGER.
 *
 * The migration + repair scripts wrote concession credits straight into student_ledger_entry but did
 * not always create the matching fee_concession_student assignment row. syncConcessions derives the
 * expected discount from the assignment list, so any student with ledger credits but no assignment
 * would have those credits STRIPPED the next time the portal touches concessions. This closes that
 * gap: for every (student, scheme) that has active concession credits but no active assignment, it
 * inserts the assignment — with cycle_scope set to the exact cycles the credits cover, so a student
 * on a partial-year (Option-B) discount is reproduced faithfully instead of being "completed" to 12
 * months. Full-coverage students get cycle_scope = null (whole year).
 *
 * Idempotent (skips students already assigned). Dry-run default.
 *
 *   node modules/fees/scripts/backfill-concession-roster.js
 *   node modules/fees/scripts/backfill-concession-roster.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const AY = 'w3ajbki9xhbm'; // 2026-27
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });

(async () => {
  console.log(`Backfill concession assignment list  ·  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  // schemes: name -> {uuid, fee_head_id}
  const schemes = (await pool.query(`select uuid, name, fee_head_id from fee_concession where school_id=$1 and academic_year_id=$2 and status='active'`, [SCHOOL, AY])).rows;
  const schemeByName = {}; schemes.forEach((s) => { schemeByName[s.name] = s; });

  // (student, scheme) pairs that have active ledger credits
  const ledger = (await pool.query(
    `select student_id, head_label, array_agg(distinct cycle_label) cycles, sum(credit) tot
     from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active'
     group by student_id, head_label`, [SCHOOL, AY])).rows;

  // existing assignments: set of "student_id|concession_id"
  const assigned = new Set((await pool.query(
    `select cs.student_id, cs.concession_id from fee_concession_student cs
     join fee_concession c on c.uuid=cs.concession_id and c.academic_year_id=$2
     where cs.school_id=$1 and cs.status='active'`, [SCHOOL, AY])).rows.map((r) => `${r.student_id}|${r.concession_id}`));

  const now = new Date();
  let inserted = 0, skipped = 0, flagged = 0;
  const report = [];

  for (const row of ledger) {
    const scheme = schemeByName[row.head_label];
    const r = { student: row.student_id, scheme: row.head_label };
    if (!scheme) { r.action = 'FLAG: no matching active scheme'; flagged++; report.push(r); continue; }
    if (assigned.has(`${row.student_id}|${scheme.uuid}`)) { skipped++; continue; } // already on the list

    // all the student's active charges for this scheme's fee head -> full cycle set
    const allCycles = (await pool.query(
      `select distinct cycle_label from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='charge' and status='active' and fee_head_id=$4`,
      [SCHOOL, row.student_id, AY, scheme.fee_head_id])).rows.map((x) => x.cycle_label);
    const covered = row.cycles.filter(Boolean);
    const isFull = allCycles.length > 0 && covered.length >= allCycles.length;
    const cycleScope = isFull ? null : covered.join(',');

    const adm = (await pool.query(`select admission_number, name from student where uuid=$1`, [row.student_id])).rows[0] || {};
    r.adm = adm.admission_number; r.name = adm.name;
    r.action = APPLY ? 'ADD' : 'would add';
    r.cycleScope = cycleScope; r.covered = covered.length; r.all = allCycles.length;
    inserted++; report.push(r);

    if (APPLY) {
      await pool.query(
        `insert into fee_concession_student (uuid, school_id, concession_id, student_id, cycle_scope, effective_from, remarks, status, createdby_userid, created_at)
         values ($1,$2,$3,$4,$5,null,$6,'active','backfill',$7)`,
        [generateShortUuid(12), SCHOOL, scheme.uuid, row.student_id, cycleScope, 'assignment backfill to match ledger 2026-08-11', now]);
    }
  }

  console.log(`${APPLY ? 'ADDED' : 'WOULD ADD'}: ${inserted}  ·  already assigned: ${skipped}  ·  flagged: ${flagged}\n`);
  report.filter((r) => /add|FLAG/i.test(r.action)).forEach((r) =>
    console.log(`  ${String(r.adm || r.student).padEnd(13)} ${String(r.name || '').slice(0, 18).padEnd(18)} ${String(r.scheme).padEnd(28)} ${r.cycleScope ? `scope=[${r.cycleScope}] (${r.covered}/${r.all})` : `full year (${r.covered}/${r.all})`} [${r.action}]`));
  if (!APPLY) console.log('\nDRY-RUN only. Re-run with --apply --yes to write.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
