/**
 * Lab Item Data Sync Script
 *
 * Imports lab items from a CSV or Excel (.xlsx) file into the database using upsert.
 * Labs must already exist (not auto-created).
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-lab-items.js --stage prod --school-code DBPASN --file items.xlsx [--dry-run]
 *
 * Supports both .xlsx and .csv files.
 *
 * Columns (header required):
 *   lab_name,name,category,item_type,unit,current_stock,reorder_level,location,item_condition,cost_per_unit,comments,status
 *   Physics Lab,Voltmeter,Electrical,equipment,piece,10,2,Cabinet A,good,500,,active
 *
 * Required columns: lab_name, name, item_type, unit
 * Natural key: lower(name) + lab_id + school_id
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
      'Usage: node modules/data-sync/scripts/sync-lab-items.js --stage prod --school-code DBPASN --file items.xlsx [--dry-run]'
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
      '  lab_name*, name*, category, item_type*, unit*, current_stock, reorder_level, location, item_condition, cost_per_unit, comments, status'
    );
    console.log('');
    console.log('Valid item_type: equipment, consumable');
    console.log(
      'Valid unit: piece, set, bottle, packet, ml, gm, kg, box, roll, pair, strip, litre, dozen, ream'
    );
    console.log('Valid item_condition: new, good, fair, needs_repair, condemned');
    process.exit(1);
  }

  const filePath = resolveFile(parsed.file);
  let pool = null;

  try {
    logHeader('Lab Item', { ...parsed, file: filePath });

    // Parse data file
    const rows = await readFile(filePath, ['lab_name', 'name', 'item_type', 'unit']);
    console.log(`\nFound ${rows.length} rows`);

    // Connect to database
    pool = await connectDb(parsed.stage);

    // Look up school
    const schoolId = await getSchoolId(pool, parsed.schoolCode);
    console.log(`School ID: ${schoolId}`);

    // Cache for lab lookups
    const labCache = {};

    let inserted = 0;
    let updated = 0;
    let errorCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Look up lab by name (must exist)
        const labName = row.lab_name;
        if (!labCache[labName]) {
          const labResult = await client.query(
            'select uuid from lab where lower(name) = lower($1) and school_id = $2',
            [labName, schoolId]
          );
          if (labResult.rows.length === 0) {
            throw new Error(
              `Lab not found: "${labName}". Please sync labs first using sync-labs.js`
            );
          }
          labCache[labName] = labResult.rows[0].uuid;
        }
        const labId = labCache[labName];

        const category = row.category || null;
        const currentStock = row.current_stock ? parseInt(row.current_stock) : null;
        const reorderLevel = row.reorder_level ? parseInt(row.reorder_level) : null;
        const location = row.location || null;
        const itemCondition = row.item_condition || null;
        const costPerUnit = row.cost_per_unit ? parseFloat(row.cost_per_unit) : null;
        const comments = row.comments || null;
        const status = row.status || 'active';

        const result = await client.query(
          `insert into lab_item (uuid, lab_id, name, category, item_type, unit, current_stock, reorder_level, location, item_condition, cost_per_unit, comments, status, school_id, createdby_userid, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '0', now())
           on conflict (lower(name), lab_id, school_id) do update set
             category = coalesce(excluded.category, lab_item.category),
             item_type = excluded.item_type,
             unit = excluded.unit,
             current_stock = coalesce(excluded.current_stock, lab_item.current_stock),
             reorder_level = coalesce(excluded.reorder_level, lab_item.reorder_level),
             location = coalesce(excluded.location, lab_item.location),
             item_condition = coalesce(excluded.item_condition, lab_item.item_condition),
             cost_per_unit = coalesce(excluded.cost_per_unit, lab_item.cost_per_unit),
             comments = coalesce(excluded.comments, lab_item.comments),
             status = excluded.status,
             updatedby_userid = '0',
             updated_at = now()
           returning uuid, (xmax = 0) as is_insert`,
          [
            generateShortUuid(12),
            labId,
            row.name,
            category,
            row.item_type,
            row.unit,
            currentStock,
            reorderLevel,
            location,
            itemCondition,
            costPerUnit,
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
        console.log(`  [Row ${rowNum}] ${action} - ${row.name} (${labName}, ${row.item_type})`);
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
