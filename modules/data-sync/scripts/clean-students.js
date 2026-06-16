/**
 * Clean Student Data Script
 *
 * Deletes all student_class and student rows for a given school.
 * Intended to be run before a full re-sync from a fresh data file.
 *
 * Usage:
 *   node modules/data-sync/scripts/clean-students.js --stage prod --school-code DBPASN [--dry-run]
 */

const { parseArgs, getSchoolId, connectDb } = require('./lib/sync-utils');

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode) {
    console.log(
      'Usage: node modules/data-sync/scripts/clean-students.js --stage prod --school-code DBPASN [--dry-run]'
    );
    process.exit(1);
  }

  let pool = null;

  try {
    console.log('\n=== Clean Student Data ===\n');
    console.log(`Stage: ${parsed.stage}`);
    console.log(`School Code: ${parsed.schoolCode}`);
    if (parsed.dryRun) {
      console.log('Mode: DRY RUN (no data will be deleted)');
    }

    pool = await connectDb(parsed.stage);

    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    const studentClassCount = await pool.query(
      'select count(*) from student_class where school_id = $1',
      [schoolId]
    );
    const studentCount = await pool.query(
      'select count(*) from student where school_id = $1',
      [schoolId]
    );

    console.log(`\nstudent_class rows: ${studentClassCount.rows[0].count}`);
    console.log(`student rows: ${studentCount.rows[0].count}`);

    if (parsed.dryRun) {
      console.log('\n(Dry run - no data was deleted)');
      return;
    }

    const delClass = await pool.query('delete from student_class where school_id = $1', [schoolId]);
    console.log(`\nDeleted ${delClass.rowCount} rows from student_class`);

    const delStudent = await pool.query('delete from student where school_id = $1', [schoolId]);
    console.log(`Deleted ${delStudent.rowCount} rows from student`);
  } catch (error) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
