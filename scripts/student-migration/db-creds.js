/**
 * Resolve prod DB credentials for the migration scripts WITHOUT any checked-in password.
 * Mirrors shared/lib/db.ts: when POSTGRES_SSM_PASSWORD_PARAM is set in the stage config we
 * connect as POSTGRES_SSM_USERNAME (app_user) with the password fetched from SSM at runtime
 * (WithDecryption), using the ambient AWS creds (export your SSO creds first — same as photos).
 *
 * Precedence:
 *   1. env override  POSTGRES_PASSWORD (+ optional POSTGRES_USERNAME) — for a hand-set password
 *   2. SSM           app_user + /.../app_user_password  (preferred; no secret on disk)
 * The stale plaintext POSTGRES_PASSWORD in configs/prod/prod.yml is intentionally NOT used.
 *
 * Non-secret connection bits (host/db/port/ssl) still come from the stage yml.
 */
const fs = require('fs');
const path = require('path');

function loadYml(stage) {
  const cfg = {};
  for (const line of fs.readFileSync(path.join(__dirname, `../../configs/${stage}/${stage}.yml`), 'utf8').split('\n')) {
    const m = line.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/);
    if (m) cfg[m[1]] = m[2];
  }
  return cfg;
}

async function getCreds(stage = 'prod') {
  const cfg = loadYml(stage);
  const base = {
    host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST,
    database: cfg.POSTGRES_DATABASE,
    port: parseInt(cfg.POSTGRES_PORT || '5432', 10),
    ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  };
  // 1) explicit env override (user hands the password via the environment)
  if (process.env.POSTGRES_PASSWORD) {
    return { ...base, user: process.env.POSTGRES_USERNAME || cfg.POSTGRES_USERNAME, password: process.env.POSTGRES_PASSWORD, _source: 'env' };
  }
  // 2) SSM. Migration/setup scripts may do DDL, so prefer the MASTER/owner role when a
  //    master param is configured (app_user can't ALTER tables it doesn't own); fall back
  //    to the least-privilege app_user param otherwise. Mirrors scripts/run-sql.js.
  const masterParam = cfg.POSTGRES_SSM_MASTER_PASSWORD_PARAM;
  const param = masterParam || cfg.POSTGRES_SSM_PASSWORD_PARAM;
  if (param) {
    const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
    const ssm = new SSMClient({ region: process.env.AWS_REGION || 'ap-south-1' });
    const res = await ssm.send(new GetParameterCommand({ Name: param, WithDecryption: true }));
    const password = res.Parameter && res.Parameter.Value;
    if (!password) throw new Error(`SSM parameter ${param} returned no value`);
    const user = masterParam ? (cfg.POSTGRES_SSM_MASTER_USERNAME || cfg.POSTGRES_USERNAME) : cfg.POSTGRES_SSM_USERNAME;
    return { ...base, user, password, _source: `ssm:${param}` };
  }
  throw new Error('No DB password available. Export SSO creds (so SSM can be read) or set POSTGRES_PASSWORD in the environment. The checked-in plaintext password is not used.');
}

module.exports = { getCreds, loadYml };
