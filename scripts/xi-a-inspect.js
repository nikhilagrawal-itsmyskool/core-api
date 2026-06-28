// One-off: inspect the current XI-A setup so we can write the composite-class
// migration with real ids. Prints rows (run-sql.js can't show SELECT output).
//
//   node scripts/xi-a-inspect.js --stage <local|dev|qa|prod> --school <SCHOOL_CODE>
//
// Optional: --class "<name like>"  (defaults to matching '%XI%A%').
const { loadConfig, createPool } = require('./run-sql');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function table(title, rows) {
  console.log(`\n=== ${title} (${rows.length}) ===`);
  if (rows.length === 0) { console.log('  (none)'); return; }
  console.table(rows);
}

async function q(pool, sql, params) {
  try {
    const r = await pool.query(sql, params);
    return r.rows;
  } catch (e) {
    console.error(`  query failed: ${e.message}`);
    return [];
  }
}

async function main() {
  const stage = arg('--stage') || arg('-s');
  const schoolCode = arg('--school') || arg('-c');
  const classLike = arg('--class', '%XI%A%');
  if (!stage || !schoolCode) {
    console.log('Usage: node scripts/xi-a-inspect.js --stage <stage> --school <CODE> [--class "<name like>"]');
    process.exit(1);
  }

  const cfg = loadConfig(stage);
  console.log(`Connecting to ${cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST}/${cfg.POSTGRES_DATABASE} ...`);
  const pool = createPool(cfg);

  const schoolRows = await q(pool, `select uuid, code, name from school where lower(code) = lower($1)`, [schoolCode]);
  table('SCHOOL', schoolRows);
  if (schoolRows.length === 0) { await pool.end(); return; }
  const schoolId = schoolRows[0].uuid;

  // academic years (to pick the right year id)
  table('ACADEMIC YEARS', await q(pool,
    `select uuid, name from academic_year where school_id = $1 order by name`, [schoolId]));

  // candidate XI-A class row(s)
  const classes = await q(pool,
    `select uuid, name, code, seq, class_group_id from class where school_id = $1 and name ilike $2 order by name`,
    [schoolId, classLike]);
  table('CANDIDATE CLASSES (XI-A)', classes);
  const classIds = classes.map((c) => c.uuid);

  if (classIds.length > 0) {
    table('CLASS_SUBJECTS on these classes', await q(pool,
      `select cs.class_id, c.name as class_name, cs.academic_year_id, cs.subject_id,
              s.name as subject_name, s.code as subject_code, cs.periods_per_week, cs.status, cs.block_rules
       from class_subject cs
       join class c on c.uuid = cs.class_id
       left join subject s on s.uuid = cs.subject_id
       where cs.school_id = $1 and cs.class_id = any($2)
       order by c.name, s.name`, [schoolId, classIds]));

    table('TEACHING_ASSIGNMENTS on these classes', await q(pool,
      `select ta.class_id, ta.academic_year_id, ta.subject_id, s.name as subject_name,
              ta.teacher_id, e.name as teacher_name, ta.period_share, ta.status
       from teaching_assignment ta
       left join subject s on s.uuid = ta.subject_id
       left join employee e on e.uuid = ta.teacher_id
       where ta.school_id = $1 and ta.class_id = any($2)
       order by ta.class_id, s.name`, [schoolId, classIds]));

    table('CLASS_TEACHER on these classes', await q(pool,
      `select ct.class_id, ct.academic_year_id, ct.teacher_id, e.name as teacher_name,
              ct.first_period_subject_id, ct.first_period_days, ct.status
       from class_teacher ct
       left join employee e on e.uuid = ct.teacher_id
       where ct.school_id = $1 and ct.class_id = any($2)`, [schoolId, classIds]));

    table('ELECTIVE_BANDS on these classes', await q(pool,
      `select uuid, class_id, class_group_id, name, periods_per_week, academic_year_id, status
       from elective_band where school_id = $1 and class_id = any($2)`, [schoolId, classIds]));
  }

  // full subject catalogue (need ids/codes for the shared + commerce subjects)
  table('SUBJECT CATALOGUE', await q(pool,
    `select uuid, name, code, kind, status from subject where school_id = $1 and status = 'active' order by name`,
    [schoolId]));

  // employees (to pick teacher ids)
  table('EMPLOYEES (teachers)', await q(pool,
    `select uuid, name, code from employee where school_id = $1 order by name`, [schoolId]));

  await pool.end();
  console.log('\nDone.');
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
