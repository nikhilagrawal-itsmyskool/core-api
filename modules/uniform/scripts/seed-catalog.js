/**
 * Uniform Catalog Seed Script
 * Seeds the 19 standard uniform items for a school (without sizes/pricing).
 * School admins then add sizes and pricing via the catalog UI.
 *
 * Usage:
 *   node modules/uniform/scripts/seed-catalog.js --stage local --school <school-code>
 *   node modules/uniform/scripts/seed-catalog.js -s local -c DEMO
 */

const { loadConfig, createPool } = require('../../../scripts/run-sql');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

const VALID_STAGES = ['local', 'dev', 'qa', 'prod'];

const SEEDED_ITEMS = [
  { name: 'Full Shirt (Boys)', category: 'summer', gender: 'male' },
  { name: 'Half Shirt (Boys)', category: 'summer', gender: 'male' },
  { name: 'Full Pant (Boys)', category: 'summer', gender: 'male' },
  { name: 'Half Pant (Boys)', category: 'summer', gender: 'male' },
  { name: 'Full Shirt (Girls)', category: 'summer', gender: 'female' },
  { name: 'Half Shirt (Girls)', category: 'summer', gender: 'female' },
  { name: 'Skirt', category: 'summer', gender: 'female' },
  { name: 'Salwar Kameez', category: 'summer', gender: 'female' },
  { name: 'White Pant', category: 'summer', gender: 'unisex' },
  { name: 'Tie', category: 'general', gender: 'unisex' },
  { name: 'Belt', category: 'general', gender: 'unisex' },
  { name: 'Socks', category: 'general', gender: 'unisex' },
  { name: 'Shoes', category: 'general', gender: 'unisex' },
  { name: 'PT Shoes', category: 'sports', gender: 'unisex' },
  { name: 'House T-Shirt', category: 'sports', gender: 'unisex' },
  { name: 'Full Sweater (Boys)', category: 'winter', gender: 'male' },
  { name: 'Half Sweater (Boys)', category: 'winter', gender: 'male' },
  { name: 'Full Sweater (Girls)', category: 'winter', gender: 'female' },
  { name: 'Half Sweater (Girls)', category: 'winter', gender: 'female' },
];

function parseArgs(args) {
  const result = { stage: null, schoolCode: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' || args[i] === '-s') { result.stage = args[i + 1]; i++; }
    else if (args[i] === '--school' || args[i] === '-c') { result.schoolCode = args[i + 1]; i++; }
  }
  return result;
}

async function seedCatalog(stage, schoolCode) {
  let pool = null;
  try {
    console.log(`\n=== Uniform Catalog Seed ===`);
    console.log(`Stage: ${stage}, School: ${schoolCode}\n`);

    const config = loadConfig(stage);
    pool = createPool(config);
    await pool.query('SELECT 1');
    console.log('Database connection successful.');

    // Get school ID
    const schoolResult = await pool.query(`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
    if (schoolResult.rows.length === 0) {
      throw new Error(`School not found with code: ${schoolCode}`);
    }
    const schoolId = schoolResult.rows[0].uuid;
    console.log(`School ID: ${schoolId}`);

    let inserted = 0;
    let skipped = 0;
    const now = new Date();

    for (const item of SEEDED_ITEMS) {
      // Check if already exists
      const existing = await pool.query(
        `select uuid from uniform_item where lower(name) = lower($1) and school_id = $2 and gender = $3 and status = 'active'`,
        [item.name, schoolId, item.gender]
      );

      if (existing.rows.length > 0) {
        console.log(`  ⊘ Skip: ${item.name} (${item.gender}) — already exists`);
        skipped++;
        continue;
      }

      const uuid = generateShortUuid(12);
      await pool.query(
        `insert into uniform_item (uuid, school_id, name, category, gender, is_seeded, status, createdby_userid, created_at)
         values ($1, $2, $3, $4, $5, true, 'active', 'seed', $6)`,
        [uuid, schoolId, item.name, item.category, item.gender, now]
      );
      console.log(`  ✓ Added: ${item.name} (${item.gender}, ${item.category})`);
      inserted++;
    }

    console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}\n`);
    console.log('Next step: Go to Uniform → Catalog to add sizes and pricing for each item.\n');

  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    throw error;
  } finally {
    if (pool) await pool.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || !parsed.schoolCode) {
    console.log('Usage:');
    console.log('  node modules/uniform/scripts/seed-catalog.js --stage local --school DEMO');
    console.log('  node modules/uniform/scripts/seed-catalog.js -s local -c MYSCHOOL');
    process.exit(1);
  }

  if (!VALID_STAGES.includes(parsed.stage.toLowerCase())) {
    console.error(`Error: Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}`);
    process.exit(1);
  }

  await seedCatalog(parsed.stage.toLowerCase(), parsed.schoolCode);
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { seedCatalog };
