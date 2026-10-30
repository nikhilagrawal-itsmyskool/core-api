/** Ad-hoc prod query helper for the migration (creds via SSM/env, never checked-in). Usage: node q.js "<sql>" [p1 p2 ...] */
const { Pool } = require('pg');
const { getCreds } = require('./db-creds');
const sql = process.argv[2]; const params = process.argv.slice(3);
(async () => {
  const pool = new Pool({ ...(await getCreds('prod')), max: 2 });
  pool.on('error', () => {});
  const r = await pool.query(sql, params);
  console.table(r.rows);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
