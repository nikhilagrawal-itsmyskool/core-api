const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
(async () => {
  const p = new Pool(await getCreds('prod'));
  const s = (await p.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;
  const emp = (await p.query("select uuid,name,employee_number,device_number,employee_type,status from employee where school_id=$1 and family_unique_number='rinku'", [s])).rows[0];
  console.log('employee:', emp);
  const login = (await p.query("select username,must_change_password,session_version from employee_login where school_id=$1 and username='rinku'", [s])).rows[0];
  console.log('login:', login);
  const roles = (await p.query("select r.code,r.name from employee_role er join role r on r.uuid=er.role_id where er.employee_id=$1", [emp.uuid])).rows;
  console.log('roles:', roles.map(r => r.code));
  const ov = (await p.query("select action,effect from authz_permission_override where role='uniform-incharge' order by action")).rows;
  console.log('override grants (' + ov.length + '):', ov.map(o => `${o.action}=${o.effect}`).join(', '));
  await p.end();
})().catch(e => { console.error(e.message); process.exit(1); });
