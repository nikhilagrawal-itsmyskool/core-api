/**
 * Student Data Sync Script
 *
 * Imports students from a CSV file into the database.
 * Auto-creates academic years and classes if they don't exist.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-students.js --stage prod --school-code DBPASN --file students.csv
 *
 * CSV format (header required):
 *   name,class,academic_session,status
 *   John Doe,IX-A,2025-26,active
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../../../scripts/run-sql');
const { generateShortUuid } = require('../../../scripts/generate-uuid');

function parseArgs(args) {
  const result = { stage: null, schoolCode: null, file: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' || args[i] === '-s') {
      result.stage = args[i + 1];
      i++;
    } else if (args[i] === '--school-code' || args[i] === '-c') {
      result.schoolCode = args[i + 1];
      i++;
    } else if (args[i] === '--file' || args[i] === '-f') {
      result.file = args[i + 1];
      i++;
    }
  }

  return result;
}

function parseCsv(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const requiredHeaders = ['name', 'class', 'academic_session', 'status'];

  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      throw new Error(`Missing required CSV header: ${required}`);
    }
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

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
    console.log('Usage: node modules/data-sync/scripts/sync-students.js --stage prod --school-code DBPASN --file students.csv');
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         CSV file path');
    console.log('');
    console.log('CSV format (header required):');
    console.log('  name,class,academic_session,status');
    console.log('  John Doe,IX-A,2025-26,active');
    process.exit(1);
  }

  const filePath = path.isAbsolute(parsed.file) ? parsed.file : path.join(process.cwd(), parsed.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let pool = null;

  try {
    console.log('\n=== Student Data Sync ===\n');
    console.log(`Stage: ${parsed.stage}`);
    console.log(`School Code: ${parsed.schoolCode}`);
    console.log(`File: ${filePath}`);

    // Parse CSV
    const rows = parseCsv(filePath);
    console.log(`\nFound ${rows.length} rows in CSV`);

    // Connect to database
    const config = loadConfig(parsed.stage);
    console.log(`\nConnecting to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}...`);
    pool = createPool(config);
    await pool.query('SELECT 1');
    console.log('Database connection successful.');

    // Look up school
    const schoolResult = await pool.query('select uuid from school where lower(code) = lower($1)', [parsed.schoolCode]);
    if (schoolResult.rows.length === 0) {
      throw new Error(`School not found with code: ${parsed.schoolCode}`);
    }
    const schoolId = schoolResult.rows[0].uuid;
    console.log(`School ID: ${schoolId}`);

    // Cache for lookups
    const academicYearCache = {};
    const classCache = {};

    let successCount = 0;
    let errorCount = 0;
    let academicYearsCreated = 0;
    let classesCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for 1-indexed + header row
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Look up academic year - auto-create if not found
        const ayCode = row.academic_session;
        if (!academicYearCache[ayCode]) {
          const ayResult = await client.query(
            'select uuid from academic_year where lower(code) = lower($1) and school_id = $2',
            [ayCode, schoolId]
          );
          if (ayResult.rows.length === 0) {
            // Auto-create academic year
            const ayUuid = generateShortUuid(12);
            const { startDate, endDate } = deriveAcademicDates(ayCode);
            await client.query(
              `insert into academic_year (uuid, name, code, start_date, end_date, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, $5, $6, '0', now())`,
              [ayUuid, ayCode, ayCode, startDate, endDate, schoolId]
            );
            academicYearCache[ayCode] = ayUuid;
            academicYearsCreated++;
            console.log(`  [Academic Year] Auto-created: ${ayCode} (${startDate} to ${endDate})`);
          } else {
            academicYearCache[ayCode] = ayResult.rows[0].uuid;
          }
        }
        const academicYearId = academicYearCache[ayCode];

        // Look up class - auto-create if not found
        const classCode = row.class;
        if (!classCache[classCode]) {
          const classResult = await client.query(
            'select uuid from class where lower(code) = lower($1) and school_id = $2',
            [classCode, schoolId]
          );
          if (classResult.rows.length === 0) {
            // Auto-create class
            const classUuid = generateShortUuid(12);
            await client.query(
              `insert into class (uuid, name, code, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, '0', now())`,
              [classUuid, classCode, classCode, schoolId]
            );
            classCache[classCode] = classUuid;
            classesCreated++;
            console.log(`  [Class] Auto-created: ${classCode}`);
          } else {
            classCache[classCode] = classResult.rows[0].uuid;
          }
        }
        const classId = classCache[classCode];

        // Generate UUIDs
        const studentUuid = generateShortUuid(12);
        const studentClassUuid = generateShortUuid(12);

        // INSERT student
        await client.query(
          `insert into student (uuid, name, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, '0', now())`,
          [studentUuid, row.name, row.status || 'active', schoolId]
        );

        // INSERT student_class
        await client.query(
          `insert into student_class (uuid, student_id, academic_year_id, class_id, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, '0', now())`,
          [studentClassUuid, studentUuid, academicYearId, classId, schoolId]
        );

        await client.query('COMMIT');
        successCount++;
        console.log(`  [Row ${rowNum}] OK - ${row.name} (${classCode}, ${ayCode})`);
      } catch (err) {
        await client.query('ROLLBACK');
        errorCount++;
        console.error(`  [Row ${rowNum}] FAILED - ${row.name}: ${err.message}`);
      } finally {
        client.release();
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Academic years auto-created: ${academicYearsCreated}`);
    console.log(`Classes auto-created: ${classesCreated}`);
    console.log(`Total: ${rows.length}`);

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
