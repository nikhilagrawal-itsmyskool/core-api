const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const yaml = require('js-yaml');

function loadConfig(stage) {
  const configPath = path.join(__dirname, `../configs/${stage}/${stage}.yml`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

function createPool(config) {
  return new Pool({
    host: config.POSTGRES_ENDPOINT || config.POSTGRES_HOST,
    database: config.POSTGRES_DATABASE,
    user: config.POSTGRES_USERNAME || config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    port: parseInt(config.POSTGRES_PORT || '5432'),
    ssl: config.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

async function runSqlFile(pool, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  // Remove single-line comments before splitting by semicolon
  const sqlWithoutComments = sql
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n');
  const statements = sqlWithoutComments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  console.log(`\nExecuting ${statements.length} statements from ${path.basename(filePath)}...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pool.query(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FAILED: ${err.message}`);
      throw err;
    }
  }

  console.log(`Completed: ${path.basename(filePath)}`);
}

async function runSqlString(pool, sql, description) {
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`\nExecuting ${statements.length} statements (${description})...`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pool.query(stmt);
      console.log(`  [${i + 1}/${statements.length}] OK`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FAILED: ${err.message}`);
      throw err;
    }
  }

  console.log(`Completed: ${description}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: node run-sql.js <stage> <sql-file> [sql-file2] ...');
    console.log('Example: node run-sql.js dev modules/db/ts2-setup.sql');
    process.exit(1);
  }

  const stage = args[0];
  const sqlFiles = args.slice(1);

  try {
    const config = loadConfig(stage);
    console.log(`Connecting to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}...`);

    const pool = createPool(config);

    for (const sqlFile of sqlFiles) {
      const filePath = path.isAbsolute(sqlFile) ? sqlFile : path.join(process.cwd(), sqlFile);
      if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
      }
      await runSqlFile(pool, filePath);
    }

    await pool.end();
    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

// Export for use by other scripts
module.exports = { loadConfig, createPool, runSqlFile, runSqlString };

// Run if called directly
if (require.main === module) {
  main();
}
