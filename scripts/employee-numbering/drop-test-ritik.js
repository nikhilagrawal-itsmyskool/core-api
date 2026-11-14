// Hard-delete the just-created test caller "Ritik" (DBPASN/NT/102, login 123456789). Removes the
// employee + login + role assignment; KEEPS the shared fee-caller role row + its override grant.
// Dry-run by default; pass --write to apply.
const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
const WRITE = process.argv.includes('--write');
const USERNAME = '123456789';
(async () => {
  const pool = new Pool(await getCreds('prod'));
  const client = await pool.connect();
  try {
    const s = (await client.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
    const emp = (await client.query("select uuid,name,employee_number,device_number from employee where school_id=$1 and family_unique_number=$2", [s, USERNAME])).rows[0];
    if (!emp) { console.log('No employee with mobile', USERNAME, '— nothing to drop.'); process.exit(0); }
    console.log('will drop:', emp);
    if (!WRITE) { console.log('\nDRY RUN — pass --write to apply.'); process.exit(0); }
    await client.query('BEGIN');
    await client.query('delete from employee_role where employee_id=$1', [emp.uuid]);
    await client.query("delete from employee_login where school_id=$1 and username=$2", [s, USERNAME]);
    await client.query('delete from employee where uuid=$1', [emp.uuid]);
    await client.query('COMMIT');
    console.log(`✅ Dropped ${emp.name} (${emp.employee_number}, login ${USERNAME}). fee-caller role + grant kept.`);
  } catch (e) { await client.query('ROLLBACK'); console.error(e.message); process.exit(1); } finally { client.release(); await pool.end(); }
})();
