const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const r = await p.query(
    "select employee_number, device_number, to_char(date_of_joining,'YYYY-MM-DD') as doj, name " +
    "from employee where school_id=$1 and employee_number like 'DBPASN/%' order by (split_part(employee_number,'/',2))::int", [s]);
  console.table(r.rows.map(x => ({ emp: x.employee_number, dev: x.device_number, doj: x.doj, name: x.name })));
  console.log('total numbered:', r.rows.length);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
