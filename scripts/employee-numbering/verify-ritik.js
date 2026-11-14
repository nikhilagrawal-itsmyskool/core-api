const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const e = (await p.query("select uuid,name,employee_number,device_number,employee_type,mobile from employee where school_id=$1 and family_unique_number='123456789'", [s])).rows[0];
  console.log('employee:', e);
  const login = (await p.query("select username,must_change_password from employee_login where school_id=$1 and username='123456789'", [s])).rows[0];
  console.log('login:', login);
  const r = (await p.query('select r.code from employee_role er join role r on r.uuid=er.role_id where er.employee_id=$1', [e.uuid])).rows.map((x) => x.code);
  console.log('roles:', r);
  const o = (await p.query("select action,effect from authz_permission_override where role='fee-caller'")).rows;
  console.log('fee-caller overrides:', o.map((x) => `${x.action}=${x.effect}`).join(', '));
  await p.end();
})().catch((x) => { console.error(x.message); process.exit(1); });
