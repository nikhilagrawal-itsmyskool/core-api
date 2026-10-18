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

// Build a pg Pool from a (possibly credential-resolved) config. SYNCHRONOUS — every
// module db-setup.js and migration script calls this directly, so it must not become a
// Promise. For SSM-backed stages (prod) call `await resolveCredentials(config)` first.
function createPool(config) {
  return new Pool({
    host: config.POSTGRES_ENDPOINT || config.POSTGRES_HOST,
    database: config.POSTGRES_DATABASE,
    user: config.POSTGRES_USERNAME || config.POSTGRES_USER,
    password: String(config.POSTGRES_PASSWORD == null ? '' : config.POSTGRES_PASSWORD),
    port: parseInt(config.POSTGRES_PORT || '5432'),
    ssl: config.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

// Resolve DB credentials INTO `config` (mutates POSTGRES_USERNAME/POSTGRES_PASSWORD) so the
// synchronous createPool can use them. These are SETUP / MIGRATION scripts, which do DDL —
// so on SSM stages they connect as the MASTER/owner role, not the least-privilege app_user
// (app_user can't ALTER tables it doesn't own). Precedence:
//   1. env override POSTGRES_PASSWORD (+ optional POSTGRES_USERNAME) — a hand-set password
//   2. SSM master param (POSTGRES_SSM_MASTER_PASSWORD_PARAM) → connect as POSTGRES_USERNAME (postgres)
//   3. SSM app_user param (POSTGRES_SSM_PASSWORD_PARAM) → connect as POSTGRES_SSM_USERNAME (fallback)
//   4. otherwise leave the yml plaintext in place (local/dev/qa)
// The STALE plaintext POSTGRES_PASSWORD in prod.yml is intentionally ignored on SSM stages.
// SSM needs AWS creds that can read the param (export SSO creds first).
async function resolveCredentials(config) {
  if (process.env.POSTGRES_PASSWORD) {
    config.POSTGRES_USERNAME = process.env.POSTGRES_USERNAME || config.POSTGRES_USERNAME || config.POSTGRES_USER;
    config.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
    return config;
  }
  const masterParam = config.POSTGRES_SSM_MASTER_PASSWORD_PARAM;
  const param = masterParam || config.POSTGRES_SSM_PASSWORD_PARAM;
  if (param) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const ssm = new SSMClient({ region: config.AWS_REGION || process.env.AWS_REGION || 'ap-south-1' });
    const res = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }));
    const password = res.Parameter && res.Parameter.Value;
    if (!password) throw new Error(`SSM parameter ${param} returned no value`);
    config.POSTGRES_USERNAME = masterParam
      ? (config.POSTGRES_SSM_MASTER_USERNAME || config.POSTGRES_USERNAME || 'postgres')
      : (config.POSTGRES_SSM_USERNAME || config.POSTGRES_USERNAME || config.POSTGRES_USER);
    config.POSTGRES_PASSWORD = password;
  }
  return config;
}

async function runSqlFile(pool, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function parseArgs(args) {
  const result = { stage: null, files: [] };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' || args[i] === '-s') {
      result.stage = args[i + 1];
      i++;
    } else if (args[i] === '--file' || args[i] === '-f') {
      result.files.push(args[i + 1]);
      i++;
    }
  }

  return result;
}

function showUsage() {
  console.log('Usage: node run-sql.js --stage <stage> --file <sql-file> [--file <sql-file2>] ...');
  console.log('       node run-sql.js -s <stage> -f <sql-file> [-f <sql-file2>] ...');
  console.log('');
  console.log('Options:');
  console.log('  --stage, -s  Stage (local, dev, qa, prod)');
  console.log('  --file, -f   SQL file to execute (can be specified multiple times)');
  console.log('');
  console.log('Examples:');
  console.log('  node run-sql.js -s dev -f modules/db/db-1.sql');
  console.log('  node run-sql.js --stage local --file modules/db/db-1.sql');
  console.log('  node run-sql.js -s dev -f file1.sql -f file2.sql');
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (!parsed.stage || parsed.files.length === 0) {
    showUsage();
    process.exit(1);
  }

  const stage = parsed.stage;
  const sqlFiles = parsed.files;

  try {
    const config = loadConfig(stage);
    await resolveCredentials(config);
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
module.exports = { loadConfig, createPool, resolveCredentials, runSqlFile, runSqlString };

// Run if called directly
if (require.main === module) {
  main();
}
