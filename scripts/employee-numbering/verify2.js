const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const r = await p.query(
    "select employee_number, device_number, employee_type, to_char(date_of_joining,'YYYY-MM-DD') doj, name " +
    "from employee where school_id=$1 and employee_number like 'DBPASN/T/%' order by (regexp_replace(employee_number,'\\D','','g'))::int", [s]);
  const show = [r.rows[0], r.rows[16], r.rows[r.rows.length - 1]];
  console.table(show.map(x => ({ emp: x.employee_number, dev: x.device_number, type: x.employee_type, doj: x.doj, name: x.name })));
  const allTeaching = r.rows.every(x => x.employee_type === 'teaching');
  const band = r.rows.every(x => +x.employee_number.split('/')[2] >= 101);
  console.log('teaching count:', r.rows.length, '| all type=teaching:', allTeaching, '| all >=101:', band);
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
