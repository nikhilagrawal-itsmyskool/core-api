/**
 * Homework Module Database Setup Script
 *
 * Interactive:      node modules/homework/scripts/db-setup.js
 * Non-interactive:  node modules/homework/scripts/db-setup.js --stage local --action setup
 *                   node modules/homework/scripts/db-setup.js -s local -a rollback
 */

const path = require("path");
const readline = require("readline");
const { loadConfig, createPool, runSqlFile } = require("../../../scripts/run-sql");

const VALID_STAGES = ["local", "dev", "qa", "prod"];
const VALID_ACTIONS = ["setup", "rollback"];
const DEFAULT_STAGE = "local";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

function parseArgs(args) {
  const result = { stage: null, action: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stage" || args[i] === "-s") { result.stage = args[i + 1]; i++; }
    else if (args[i] === "--action" || args[i] === "-a") { result.action = args[i + 1]; i++; }
  }
  return result;
}

async function runSetup(stage, action) {
  const sqlFile =
    action === "setup"
      ? path.join(__dirname, "../homework-setup.sql")
      : path.join(__dirname, "../homework-setup-rollback.sql");
  let pool = null;
  try {
    console.log(`\n=== Homework Module DB ${action.toUpperCase()} ===\n`);
    console.log(`Stage: ${stage}`);
    console.log(`Action: ${action}`);
    const config = loadConfig(stage);
    console.log(`\nConnecting to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}...`);
    pool = createPool(config);
    await pool.query("SELECT 1");
    console.log("Database connection successful.");
    await runSqlFile(pool, sqlFile);
    console.log(`\n✓ Homework module ${action} completed successfully!\n`);
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}\n`);
    throw error;
  } finally {
    if (pool) await pool.end();
  }
}

async function interactive() {
  try {
    console.log("\n=== Homework Module Database Setup ===\n");
    const stageInput = await question(`Select stage (${VALID_STAGES.join("/")}) [${DEFAULT_STAGE}]: `);
    const stage = stageInput.trim().toLowerCase() || DEFAULT_STAGE;
    if (!VALID_STAGES.includes(stage)) {
      console.error(`Error: Invalid stage "${stage}". Must be one of: ${VALID_STAGES.join(", ")}`);
      process.exit(1);
    }
    console.log("\nSelect action:\n  1. Setup (create tables)\n  2. Rollback (drop tables)");
    const actionInput = await question("\nEnter choice (1/2) [1]: ");
    const actionChoice = actionInput.trim() || "1";
    let action;
    if (actionChoice === "1" || actionChoice.toLowerCase() === "setup") action = "setup";
    else if (actionChoice === "2" || actionChoice.toLowerCase() === "rollback") action = "rollback";
    else { console.error("Error: Invalid choice. Please enter 1 or 2."); process.exit(1); }
    if (action === "rollback") {
      const confirm = await question("\nThis will DROP all homework tables. Are you sure? (yes/no): ");
      if (confirm.trim().toLowerCase() !== "yes") { console.log("\nOperation cancelled."); process.exit(0); }
    }
    await runSetup(stage, action);
  } finally {
    rl.close();
  }
}

async function nonInteractive(stage, action) {
  if (!VALID_STAGES.includes(stage)) { console.error(`Error: Invalid stage "${stage}".`); process.exit(1); }
  if (!VALID_ACTIONS.includes(action)) { console.error(`Error: Invalid action "${action}".`); process.exit(1); }
  try { await runSetup(stage, action); } finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);
  if (parsed.stage && parsed.action) await nonInteractive(parsed.stage.toLowerCase(), parsed.action.toLowerCase());
  else if (args.length === 0) await interactive();
  else {
    console.log("Usage:\n  node modules/homework/scripts/db-setup.js\n  node modules/homework/scripts/db-setup.js --stage local --action setup");
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { main, runSetup };
