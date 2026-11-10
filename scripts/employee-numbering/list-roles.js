const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const r = await p.query('select uuid, code, name from role where school_id=$1 order by code', [s]);
  console.table(r.rows.map(x => ({ code: x.code, name: x.name, uuid: x.uuid })));
  console.log('roles:', r.rows.length);
  // Does a Rinku already exist?
  const rk = await p.query("select uuid,name,employee_number,status from employee where school_id=$1 and name ilike '%rinku%'", [s]);
  console.log('existing Rinku-ish:', rk.rows);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
