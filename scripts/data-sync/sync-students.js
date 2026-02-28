/**
 * Student Data Sync Script
 *
 * Imports students from a CSV file into the database.
 *
 * Usage:
 *   node scripts/data-sync/sync-students.js --stage dev --school-code SS1 --file students.csv
 *
 * CSV format (header required):
 *   name,class_code,academic_year_code,status
 *   John Doe,IX-A,2025-26,active
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../run-sql');
const { generateShortUuid } = require('../generate-uuid');

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
  const requiredHeaders = ['name', 'class_code', 'academic_year_code', 'status'];

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

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode || !parsed.file) {
    console.log('Usage: node scripts/data-sync/sync-students.js --stage dev --school-code SS1 --file students.csv');
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         CSV file path');
    console.log('');
    console.log('CSV format (header required):');
    console.log('  name,class_code,academic_year_code,status');
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

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for 1-indexed + header row

      try {
        // Look up academic year
        const ayCode = row.academic_year_code;
        if (!academicYearCache[ayCode]) {
          const ayResult = await pool.query(
            'select uuid from academic_year where lower(code) = lower($1) and school_id = $2',
            [ayCode, schoolId]
          );
          if (ayResult.rows.length === 0) {
            throw new Error(`Academic year not found: ${ayCode}`);
          }
          academicYearCache[ayCode] = ayResult.rows[0].uuid;
        }
        const academicYearId = academicYearCache[ayCode];

        // Look up class
        const classCode = row.class_code;
        if (!classCache[classCode]) {
          const classResult = await pool.query(
            'select uuid from class where lower(code) = lower($1) and school_id = $2',
            [classCode, schoolId]
          );
          if (classResult.rows.length === 0) {
            throw new Error(`Class not found: ${classCode}`);
          }
          classCache[classCode] = classResult.rows[0].uuid;
        }
        const classId = classCache[classCode];

        // Generate UUIDs
        const studentUuid = generateShortUuid(12);
        const studentClassUuid = generateShortUuid(12);

        // INSERT student
        await pool.query(
          `insert into student (uuid, name, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, '0', now())`,
          [studentUuid, row.name, row.status || 'active', schoolId]
        );

        // INSERT student_class
        await pool.query(
          `insert into student_class (uuid, student_id, academic_year_id, class_id, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, '0', now())`,
          [studentClassUuid, studentUuid, academicYearId, classId, schoolId]
        );

        successCount++;
        console.log(`  [Row ${rowNum}] OK - ${row.name}`);
      } catch (err) {
        errorCount++;
        console.error(`  [Row ${rowNum}] FAILED - ${row.name}: ${err.message}`);
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Success: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
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
