/**
 * Employee Data Sync Script
 *
 * Imports employees from a CSV file into the database.
 * Creates employee, employee_login (with default password), and employee_role records.
 * Auto-creates roles if they don't exist.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-employees.js --stage prod --school-code DBPASN --file employees.csv
 *
 * CSV format (header required):
 *   name,phone_number,role,status
 *   Jane Doe,9876543210,teacher,active
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../../../scripts/run-sql');
const { generateShortUuid } = require('../../../scripts/generate-uuid');

const DEFAULT_PASSWORD = 'Itsmyskool@123';

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
  const requiredHeaders = ['name', 'phone_number', 'role', 'status'];

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

function toTitleCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode || !parsed.file) {
    console.log('Usage: node modules/data-sync/scripts/sync-employees.js --stage prod --school-code DBPASN --file employees.csv');
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         CSV file path');
    console.log('');
    console.log('CSV format (header required):');
    console.log('  name,phone_number,role,status');
    console.log('  Jane Doe,9876543210,teacher,active');
    process.exit(1);
  }

  const filePath = path.isAbsolute(parsed.file) ? parsed.file : path.join(process.cwd(), parsed.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  let pool = null;

  try {
    console.log('\n=== Employee Data Sync ===\n');
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

    // Cache for role lookups
    const roleCache = {};

    let successCount = 0;
    let errorCount = 0;
    let rolesCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for 1-indexed + header row
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Look up role - auto-create if not found
        const roleCode = row.role;
        if (!roleCache[roleCode]) {
          const roleResult = await client.query(
            'select uuid from role where lower(code) = lower($1) and school_id = $2',
            [roleCode, schoolId]
          );
          if (roleResult.rows.length === 0) {
            // Auto-create role
            const roleUuid = generateShortUuid(12);
            const roleName = toTitleCase(roleCode);
            await client.query(
              `insert into role (uuid, name, code, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, '0', now())`,
              [roleUuid, roleName, roleCode, schoolId]
            );
            roleCache[roleCode] = roleUuid;
            rolesCreated++;
            console.log(`  [Role] Auto-created: ${roleCode} -> ${roleName}`);
          } else {
            roleCache[roleCode] = roleResult.rows[0].uuid;
          }
        }
        const roleId = roleCache[roleCode];

        // Generate UUIDs
        const employeeUuid = generateShortUuid(12);
        const loginUuid = generateShortUuid(12);
        const employeeRoleUuid = generateShortUuid(12);
        const employeeNumber = generateShortUuid(12);
        const phoneNumber = row.phone_number;

        // INSERT employee
        await client.query(
          `insert into employee (uuid, employee_number, name, family_unique_number, mobile, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, '0', now())`,
          [employeeUuid, employeeNumber, row.name, phoneNumber, phoneNumber, row.status || 'active', schoolId]
        );

        // INSERT employee_login
        await client.query(
          `insert into employee_login (uuid, username, password, display_name, must_change_password, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, true, $5, '0', now())`,
          [loginUuid, phoneNumber, DEFAULT_PASSWORD, row.name, schoolId]
        );

        // INSERT employee_role
        await client.query(
          `insert into employee_role (uuid, employee_id, role_id, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, '0', now())`,
          [employeeRoleUuid, employeeUuid, roleId, schoolId]
        );

        await client.query('COMMIT');
        successCount++;
        console.log(`  [Row ${rowNum}] OK - ${row.name} (${phoneNumber}, ${roleCode})`);
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
    console.log(`Roles auto-created: ${rolesCreated}`);
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
