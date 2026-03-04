/**
 * Student Data Sync Script
 *
 * Imports students from a CSV or Excel (.xlsx) file into the database using upsert.
 * Auto-creates academic years and classes if they don't exist.
 * Supports admission number changes via old_admission_number column.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-students.js --stage prod --school-code DBPASN --file students.xlsx [--dry-run]
 *
 * Supports both .xlsx and .csv files.
 *
 * Columns (header required):
 *   admission_number,name,class,academic_session,gender,dob,father_mobile,mother_mobile,old_admission_number,status
 *   S001,Rahul Kumar,IX-A,2025-26,M,2010-05-15,9876543210,9876543211,,active
 *
 * Required columns: admission_number, name, class, academic_session
 * Natural key: admission_number + school_id
 */

const {
  parseArgs,
  readFile,
  getSchoolId,
  logHeader,
  logSummary,
  resolveFile,
  connectDb,
  generateShortUuid,
} = require('./lib/sync-utils');

/**
 * Derive start_date and end_date from academic session code.
 * Format: "YYYY-YY" -> start = YYYY-04-01, end = 20YY-03-31
 * Example: "2025-26" -> start = 2025-04-01, end = 2026-03-31
 */
function deriveAcademicDates(sessionCode) {
  const match = sessionCode.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid academic session format: ${sessionCode} (expected YYYY-YY)`);
  }

  const startYear = parseInt(match[1]);
  const endYearShort = parseInt(match[2]);
  const endYear = Math.floor(startYear / 100) * 100 + endYearShort;

  return {
    startDate: `${startYear}-04-01`,
    endDate: `${endYear}-03-31`,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode || !parsed.file) {
    console.log(
      'Usage: node modules/data-sync/scripts/sync-students.js --stage prod --school-code DBPASN --file students.xlsx [--dry-run]'
    );
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         Data file path (.xlsx or .csv)');
    console.log('  --dry-run          Preview changes without committing');
    console.log('');
    console.log('Columns (required marked with *):');
    console.log(
      '  admission_number*, name*, class*, academic_session*, gender, dob, father_mobile, mother_mobile, old_admission_number, status'
    );
    process.exit(1);
  }

  const filePath = resolveFile(parsed.file);
  let pool = null;

  try {
    logHeader('Student', { ...parsed, file: filePath });

    // Parse data file
    const rows = await readFile(filePath, ['admission_number', 'name', 'class', 'academic_session']);
    console.log(`\nFound ${rows.length} rows`);

    // Connect to database
    pool = await connectDb(parsed.stage);

    // Look up school
    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    // Caches for lookups
    const academicYearCache = {};
    const classCache = {};

    let inserted = 0;
    let updated = 0;
    let admissionChanges = 0;
    let errorCount = 0;
    let academicYearsCreated = 0;
    let classesCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Look up or auto-create academic year
        const ayCode = row.academic_session;
        if (!academicYearCache[ayCode]) {
          const ayResult = await client.query(
            'select uuid from academic_year where lower(code) = lower($1) and school_id = $2',
            [ayCode, schoolId]
          );
          if (ayResult.rows.length === 0) {
            const ayUuid = generateShortUuid(12);
            const { startDate, endDate } = deriveAcademicDates(ayCode);
            await client.query(
              `insert into academic_year (uuid, name, code, start_date, end_date, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, $5, $6, '0', now())
               on conflict (code, school_id) do nothing`,
              [ayUuid, ayCode, ayCode, startDate, endDate, schoolId]
            );
            const refetch = await client.query(
              'select uuid from academic_year where lower(code) = lower($1) and school_id = $2',
              [ayCode, schoolId]
            );
            academicYearCache[ayCode] = refetch.rows[0].uuid;
            academicYearsCreated++;
            console.log(`  [Academic Year] Auto-created: ${ayCode} (${startDate} to ${endDate})`);
          } else {
            academicYearCache[ayCode] = ayResult.rows[0].uuid;
          }
        }
        const academicYearId = academicYearCache[ayCode];

        // Look up or auto-create class
        const classCode = row.class;
        if (!classCache[classCode]) {
          const classResult = await client.query(
            'select uuid from class where lower(code) = lower($1) and school_id = $2',
            [classCode, schoolId]
          );
          if (classResult.rows.length === 0) {
            const classUuid = generateShortUuid(12);
            await client.query(
              `insert into class (uuid, name, code, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, '0', now())
               on conflict (code, school_id) do nothing`,
              [classUuid, classCode, classCode, schoolId]
            );
            const refetch = await client.query(
              'select uuid from class where lower(code) = lower($1) and school_id = $2',
              [classCode, schoolId]
            );
            classCache[classCode] = refetch.rows[0].uuid;
            classesCreated++;
            console.log(`  [Class] Auto-created: ${classCode}`);
          } else {
            classCache[classCode] = classResult.rows[0].uuid;
          }
        }
        const classId = classCache[classCode];

        const admissionNumber = row.admission_number;
        const oldAdmissionNumber = row.old_admission_number || '';
        const status = row.status || 'active';
        const gender = row.gender || null;
        const dob = row.dob || null;
        const fatherMobile = row.father_mobile || null;
        const motherMobile = row.mother_mobile || null;

        let studentUuid = null;
        let isInsert = true;

        // Handle admission number change
        if (oldAdmissionNumber) {
          const oldResult = await client.query(
            'select uuid from student where admission_number = $1 and school_id = $2',
            [oldAdmissionNumber, schoolId]
          );
          if (oldResult.rows.length > 0) {
            // Found by old admission number - update it
            studentUuid = oldResult.rows[0].uuid;
            await client.query(
              `update student set
                 admission_number = $1,
                 old_admission_number = $2,
                 name = $3,
                 gender = coalesce($4, gender),
                 dob = coalesce($5, dob),
                 father_mobile = coalesce($6, father_mobile),
                 mother_mobile = coalesce($7, mother_mobile),
                 status = $8,
                 updatedby_userid = '0',
                 updated_at = now()
               where uuid = $9`,
              [
                admissionNumber,
                oldAdmissionNumber,
                row.name,
                gender,
                dob,
                fatherMobile,
                motherMobile,
                status,
                studentUuid,
              ]
            );
            isInsert = false;
            admissionChanges++;
            console.log(
              `  [Row ${rowNum}] ADMISSION CHANGE - ${row.name} (${oldAdmissionNumber} -> ${admissionNumber})`
            );
          }
        }

        // Standard upsert if not handled by admission change
        if (!studentUuid) {
          const stuResult = await client.query(
            `insert into student (uuid, admission_number, name, gender, dob, father_mobile, mother_mobile, status, school_id, createdby_userid, created_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, '0', now())
             on conflict (admission_number, school_id) do update set
               name = excluded.name,
               gender = coalesce(excluded.gender, student.gender),
               dob = coalesce(excluded.dob, student.dob),
               father_mobile = coalesce(excluded.father_mobile, student.father_mobile),
               mother_mobile = coalesce(excluded.mother_mobile, student.mother_mobile),
               status = excluded.status,
               updatedby_userid = '0',
               updated_at = now()
             returning uuid, (xmax = 0) as is_insert`,
            [
              generateShortUuid(12),
              admissionNumber,
              row.name,
              gender,
              dob,
              fatherMobile,
              motherMobile,
              status,
              schoolId,
            ]
          );
          studentUuid = stuResult.rows[0].uuid;
          isInsert = stuResult.rows[0].is_insert;
        }

        if (isInsert) {
          inserted++;
        } else if (!oldAdmissionNumber) {
          // Only count as update if not already counted as admission change
          updated++;
        }

        // UPSERT student_class
        await client.query(
          `insert into student_class (uuid, student_id, academic_year_id, class_id, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, '0', now())
           on conflict (student_id, academic_year_id, class_id, school_id) do nothing`,
          [generateShortUuid(12), studentUuid, academicYearId, classId, schoolId]
        );

        if (parsed.dryRun) {
          await client.query('ROLLBACK');
        } else {
          await client.query('COMMIT');
        }

        if (!oldAdmissionNumber) {
          const action = isInsert ? 'INSERT' : 'UPDATE';
          console.log(
            `  [Row ${rowNum}] ${action} - ${row.name} (${admissionNumber}, ${classCode}, ${ayCode})`
          );
        }
      } catch (err) {
        await client.query('ROLLBACK');
        errorCount++;
        console.error(`  [Row ${rowNum}] FAILED - ${row.name}: ${err.message}`);
      } finally {
        client.release();
      }
    }

    logSummary({
      inserted,
      updated,
      'admission changes': admissionChanges,
      errors: errorCount,
      'academic years auto-created': academicYearsCreated,
      'classes auto-created': classesCreated,
      total: rows.length,
    });

    if (parsed.dryRun) {
      console.log('\n(Dry run - no data was committed)');
    }
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
