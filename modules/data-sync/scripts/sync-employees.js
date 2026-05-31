/**
 * Employee Data Sync Script
 *
 * Imports employees from a CSV or Excel (.xlsx) file into the database using upsert.
 * Creates employee, employee_login (with default password), and employee_role records.
 * Auto-creates roles if they don't exist.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-employees.js --stage prod --school-code DBPASN --file employees.xlsx [--dry-run]
 *
 * Supports both .xlsx and .csv files.
 *
 * Columns (header required):
 *   name,phone_number,role,gender,dob,email,whatsapp,status
 *   Jane Doe,9876543210,teacher,F,1985-06-15,jane@example.com,9876543210,active
 *
 * Required columns: name, phone_number, role
 * Natural key: phone_number -> family_unique_number + school_id
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

const DEFAULT_PASSWORD = 'Itsmyskool@123';

function toTitleCase(str) {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize dob to YYYY-MM-DD.
 * Handles:
 *   - dd-mm-yyyy text:   "15-06-1985"  → "1985-06-15"
 *   - Already ISO:       "1985-06-15"  → "1985-06-15"
 *   - null / empty       → null
 */
function parseDob(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // dd-mm-yyyy (the Excel text format for this school)
  const ddmmyyyy = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }

  // Already YYYY-MM-DD
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode || !parsed.file) {
    console.log(
      'Usage: node modules/data-sync/scripts/sync-employees.js --stage prod --school-code DBPASN --file employees.xlsx [--dry-run]'
    );
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         Data file path (.xlsx or .csv)');
    console.log('  --dry-run          Preview changes without committing');
    console.log('');
    console.log('Columns (required marked with *):');
    console.log('  name*, phone_number*, role*, gender, dob, email, whatsapp, status');
    process.exit(1);
  }

  const filePath = resolveFile(parsed.file);
  let pool = null;

  try {
    logHeader('Employee', { ...parsed, file: filePath });

    // Parse data file
    const rows = await readFile(filePath, ['name', 'phone_number', 'role']);
    console.log(`\nFound ${rows.length} rows`);

    // Connect to database
    pool = await connectDb(parsed.stage);

    // Look up school
    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    // Cache for role lookups
    const roleCache = {};

    let inserted = 0;
    let updated = 0;
    let errorCount = 0;
    let rolesCreated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for 1-indexed + header row
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Look up or auto-create role
        const roleCode = row.role;
        if (!roleCache[roleCode]) {
          const roleResult = await client.query(
            'select uuid from role where lower(code) = lower($1) and school_id = $2',
            [roleCode, schoolId]
          );
          if (roleResult.rows.length === 0) {
            const roleUuid = generateShortUuid(12);
            const roleName = toTitleCase(roleCode);
            await client.query(
              `insert into role (uuid, name, code, school_id, createdby_userid, created_at)
               values ($1, $2, $3, $4, '0', now())
               on conflict (code, school_id) do nothing`,
              [roleUuid, roleName, roleCode, schoolId]
            );
            // Re-fetch in case of race condition
            const refetch = await client.query(
              'select uuid from role where lower(code) = lower($1) and school_id = $2',
              [roleCode, schoolId]
            );
            roleCache[roleCode] = refetch.rows[0].uuid;
            rolesCreated++;
            console.log(`  [Role] Auto-created: ${roleCode} -> ${roleName}`);
          } else {
            roleCache[roleCode] = roleResult.rows[0].uuid;
          }
        }
        const roleId = roleCache[roleCode];

        const phoneNumber = row.phone_number;
        const status = row.status || 'active';
        const gender = row.gender || null;
        const dob = parseDob(row.dob);
        const email = row.email || null;
        const whatsapp = row.whatsapp || null;

        // UPSERT employee (natural key: family_unique_number + school_id)
        const empResult = await client.query(
          `insert into employee (uuid, employee_number, name, family_unique_number, mobile, gender, dob, email, whatsapp, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, '0', now())
           on conflict (family_unique_number, school_id) do update set
             name = excluded.name,
             mobile = excluded.mobile,
             gender = coalesce(excluded.gender, employee.gender),
             dob = coalesce(excluded.dob, employee.dob),
             email = coalesce(excluded.email, employee.email),
             whatsapp = coalesce(excluded.whatsapp, employee.whatsapp),
             status = excluded.status,
             updatedby_userid = '0',
             updated_at = now()
           returning uuid, (xmax = 0) as is_insert`,
          [
            generateShortUuid(12),
            generateShortUuid(12),
            row.name,
            phoneNumber,
            phoneNumber,
            gender,
            dob,
            email,
            whatsapp,
            status,
            schoolId,
          ]
        );

        const employeeUuid = empResult.rows[0].uuid;
        const isInsert = empResult.rows[0].is_insert;

        if (isInsert) {
          inserted++;
        } else {
          updated++;
        }

        // INSERT employee_login if not exists
        await client.query(
          `insert into employee_login (uuid, username, password, display_name, must_change_password, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, true, $5, '0', now())
           on conflict (username, school_id) do nothing`,
          [generateShortUuid(12), phoneNumber, DEFAULT_PASSWORD, row.name, schoolId]
        );

        // INSERT employee_role if not exists
        const existingRole = await client.query(
          'select uuid from employee_role where employee_id = $1 and role_id = $2 and school_id = $3',
          [employeeUuid, roleId, schoolId]
        );
        if (existingRole.rows.length === 0) {
          await client.query(
            `insert into employee_role (uuid, employee_id, role_id, school_id, createdby_userid, created_at)
             values ($1, $2, $3, $4, '0', now())`,
            [generateShortUuid(12), employeeUuid, roleId, schoolId]
          );
        }

        if (parsed.dryRun) {
          await client.query('ROLLBACK');
        } else {
          await client.query('COMMIT');
        }

        const action = isInsert ? 'INSERT' : 'UPDATE';
        console.log(`  [Row ${rowNum}] ${action} - ${row.name} (${phoneNumber}, ${roleCode})`);
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
      errors: errorCount,
      'roles auto-created': rolesCreated,
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
