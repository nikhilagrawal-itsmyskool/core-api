/**
 * Lab Data Sync Script
 *
 * Imports labs from a CSV or Excel (.xlsx) file into the database using upsert.
 * Optionally links in_charge_phone to an employee via family_unique_number.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-labs.js --stage prod --school-code DBPASN --file labs.xlsx [--dry-run]
 *
 * Supports both .xlsx and .csv files.
 *
 * Columns (header required):
 *   name,type,location,in_charge_phone,status
 *   Physics Lab,physics,Block A Room 101,9876543210,active
 *
 * Required columns: name, type
 * Natural key: lower(name) + school_id
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

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode || !parsed.file) {
    console.log(
      'Usage: node modules/data-sync/scripts/sync-labs.js --stage prod --school-code DBPASN --file labs.xlsx [--dry-run]'
    );
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         Data file path (.xlsx or .csv)');
    console.log('  --dry-run          Preview changes without committing');
    console.log('');
    console.log('Columns (required marked with *):');
    console.log('  name*, type*, location, in_charge_phone, status');
    console.log('');
    console.log('Valid types: physics, chemistry, biology, computer, language, mathematics, other');
    process.exit(1);
  }

  const filePath = resolveFile(parsed.file);
  let pool = null;

  try {
    logHeader('Lab', { ...parsed, file: filePath });

    // Parse data file
    const rows = await readFile(filePath, ['name', 'type']);
    console.log(`\nFound ${rows.length} rows`);

    // Connect to database
    pool = await connectDb(parsed.stage);

    // Look up school
    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    // Cache for employee lookups by phone
    const employeeCache = {};

    let inserted = 0;
    let updated = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const location = row.location || null;
        const status = row.status || 'active';
        let inChargeId = null;

        // Look up in-charge employee by phone number
        if (row.in_charge_phone) {
          const phone = row.in_charge_phone;
          if (!employeeCache[phone]) {
            const empResult = await client.query(
              'select uuid from employee where family_unique_number = $1 and school_id = $2',
              [phone, schoolId]
            );
            employeeCache[phone] = empResult.rows.length > 0 ? empResult.rows[0].uuid : null;
          }
          inChargeId = employeeCache[phone];
          if (!inChargeId) {
            console.log(
              `  [Row ${rowNum}] WARNING - In-charge employee not found for phone: ${phone}`
            );
          }
        }

        const result = await client.query(
          `insert into lab (uuid, name, type, location, in_charge_id, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, '0', now())
           on conflict (lower(name), school_id) do update set
             type = excluded.type,
             location = coalesce(excluded.location, lab.location),
             in_charge_id = coalesce(excluded.in_charge_id, lab.in_charge_id),
             status = excluded.status,
             updatedby_userid = '0',
             updated_at = now()
           returning uuid, (xmax = 0) as is_insert`,
          [generateShortUuid(12), row.name, row.type, location, inChargeId, status, schoolId]
        );

        const isInsert = result.rows[0].is_insert;
        if (isInsert) {
          inserted++;
        } else {
          updated++;
        }

        if (parsed.dryRun) {
          await client.query('ROLLBACK');
        } else {
          await client.query('COMMIT');
        }

        const action = isInsert ? 'INSERT' : 'UPDATE';
        console.log(`  [Row ${rowNum}] ${action} - ${row.name} (${row.type})`);
      } catch (err) {
        await client.query('ROLLBACK');
        errorCount++;
        console.error(`  [Row ${rowNum}] FAILED - ${row.name}: ${err.message}`);
      } finally {
        client.release();
      }
    }

    logSummary({ inserted, updated, errors: errorCount, total: rows.length });

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
