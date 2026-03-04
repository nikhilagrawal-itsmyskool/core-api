/**
 * Medical Item Data Sync Script
 *
 * Imports medical items from a CSV or Excel (.xlsx) file into the database using upsert.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-medical-items.js --stage prod --school-code DBPASN --file items.xlsx [--dry-run]
 *
 * Supports both .xlsx and .csv files.
 *
 * Columns (header required):
 *   name,unit,reorder_level,current_stock,comments,status
 *   Paracetamol,tablet,50,200,General use,active
 *
 * Required columns: name, unit
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
      'Usage: node modules/data-sync/scripts/sync-medical-items.js --stage prod --school-code DBPASN --file items.xlsx [--dry-run]'
    );
    console.log('');
    console.log('Options:');
    console.log('  --stage, -s        Stage (local, dev, qa, prod)');
    console.log('  --school-code, -c  School code');
    console.log('  --file, -f         Data file path (.xlsx or .csv)');
    console.log('  --dry-run          Preview changes without committing');
    console.log('');
    console.log('Columns (required marked with *):');
    console.log('  name*, unit*, reorder_level, current_stock, comments, status');
    process.exit(1);
  }

  const filePath = resolveFile(parsed.file);
  let pool = null;

  try {
    logHeader('Medical Item', { ...parsed, file: filePath });

    // Parse data file
    const rows = await readFile(filePath, ['name', 'unit']);
    console.log(`\nFound ${rows.length} rows`);

    // Connect to database
    pool = await connectDb(parsed.stage);

    // Look up school
    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    let inserted = 0;
    let updated = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const reorderLevel = row.reorder_level ? parseInt(row.reorder_level) : null;
        const currentStock = row.current_stock ? parseInt(row.current_stock) : null;
        const comments = row.comments || null;
        const status = row.status || 'active';

        const result = await client.query(
          `insert into medical_item (uuid, name, unit, reorder_level, current_stock, comments, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, '0', now())
           on conflict (lower(name), school_id) do update set
             unit = excluded.unit,
             reorder_level = coalesce(excluded.reorder_level, medical_item.reorder_level),
             current_stock = coalesce(excluded.current_stock, medical_item.current_stock),
             comments = coalesce(excluded.comments, medical_item.comments),
             status = excluded.status,
             updatedby_userid = '0',
             updated_at = now()
           returning uuid, (xmax = 0) as is_insert`,
          [
            generateShortUuid(12),
            row.name,
            row.unit,
            reorderLevel,
            currentStock,
            comments,
            status,
            schoolId,
          ]
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
        console.log(`  [Row ${rowNum}] ${action} - ${row.name} (${row.unit})`);
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
