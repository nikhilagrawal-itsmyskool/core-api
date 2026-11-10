const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const r = await p.query(
    "select employee_number, device_number, employee_type, name from employee " +
    "where school_id=$1 and employee_number ~ '^DBPASN/[0-9]+$' order by employee_number", [s]);
  console.table(r.rows.map(x => ({ emp: x.employee_number, dev: x.device_number, type: x.employee_type, name: x.name })));
  console.log('bare DBPASN/<n> count:', r.rows.length);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
