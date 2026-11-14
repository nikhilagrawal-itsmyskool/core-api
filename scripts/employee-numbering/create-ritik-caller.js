// Create non-teaching test employee "Ritik" with login = mobile 123456789 and the fee-caller
// (tele-caller) role. Ensures the fee-caller role row exists in DBPASN + a GLOBAL override grant
// for fee.manager.view so already-deployed modules + the override-aware frontend honor it.
// Dry-run by default; pass --write to apply.
const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const WRITE = process.argv.includes('--write');
const ROLE_CODE = 'fee-caller';
const ROLE_NAME = 'Fee Caller';
const GRANT_ACTIONS = ['fee.manager.view']; // the only action fee-caller holds
const NAME = 'Ritik';
const USERNAME = '123456789'; // mobile = login username (staff convention)
const PASSWORD = 'Itsmyskool@123';

(async () => {
  const pool = new Pool(await getCreds('prod'));
  const client = await pool.connect();
  try {
    const schoolId = (await client.query("select uuid from school where lower(code)='dbpasn'")).rows[0].uuid;

    const nt = await client.query("select employee_number from employee where school_id=$1 and employee_number like 'DBPASN/NT/%'", [schoolId]);
    let maxN = 100; for (const r of nt.rows) { const n = parseInt(String(r.employee_number).slice('DBPASN/NT/'.length), 10); if (n > maxN) maxN = n; }
    const dev = await client.query("select device_number from employee where school_id=$1 and device_number ~ '^[0-9]+$'", [schoolId]);
    let maxD = 100; for (const r of dev.rows) { const d = parseInt(r.device_number, 10); if (d > maxD) maxD = d; }
    const empNo = `DBPASN/NT/${maxN + 1}`;
    const device = String(maxD + 1);

    const existing = await client.query('select uuid from employee where school_id=$1 and family_unique_number=$2', [schoolId, USERNAME]);
    console.log('plan:', { name: NAME, username: USERNAME, employeeNumber: empNo, deviceNumber: device, type: 'non_teaching', role: ROLE_CODE, grants: GRANT_ACTIONS, alreadyExists: existing.rows.length > 0 });
    if (existing.rows.length) { console.log('An employee with mobile', USERNAME, 'already exists — aborting.'); process.exit(0); }
    if (!WRITE) { console.log('\nDRY RUN — pass --write to apply.'); process.exit(0); }

    await client.query('BEGIN');
    let role = (await client.query('select uuid from role where school_id=$1 and code=$2', [schoolId, ROLE_CODE])).rows[0];
    if (!role) {
      const uuid = generateShortUuid(12);
      await client.query('insert into role (uuid,name,code,school_id,created_at) values ($1,$2,$3,$4,now())', [uuid, ROLE_NAME, ROLE_CODE, schoolId]);
      role = { uuid };
      console.log('created role', ROLE_CODE, uuid);
    } else console.log('role exists', role.uuid);

    for (const action of GRANT_ACTIONS) {
      await client.query(
        "insert into authz_permission_override (uuid,role,action,effect,setby_userid,set_at,reason) values ($1,$2,$3,'grant','setup',now(),$4) on conflict (role,action) do update set effect='grant'",
        [generateShortUuid(12), ROLE_CODE, action, 'fee-caller base grant']
      );
    }
    console.log('granted', GRANT_ACTIONS.length, 'action(s) to', ROLE_CODE);

    const empUuid = generateShortUuid(12);
    await client.query(
      "insert into employee (uuid,employee_number,name,family_unique_number,mobile,device_number,employee_type,status,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,$5,$6,'non_teaching','active',$7,'setup',now())",
      [empUuid, empNo, NAME, USERNAME, USERNAME, device, schoolId]
    );
    await client.query(
      "insert into employee_login (uuid,username,password,display_name,must_change_password,session_version,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,true,1,$5,'setup',now())",
      [generateShortUuid(12), USERNAME, PASSWORD, NAME, schoolId]
    );
    await client.query(
      'insert into employee_role (uuid,employee_id,role_id,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,$5,now())',
      [generateShortUuid(12), empUuid, role.uuid, schoolId, 'setup']
    );
    await client.query('COMMIT');
    console.log(`\n✅ Created ${NAME}: employee ${empUuid}, ${empNo}, device ${device}, login '${USERNAME}' / ${PASSWORD} (must change on first login), role ${ROLE_CODE}.`);
  } catch (e) {
    await client.query('ROLLBACK'); console.error(e.message); process.exit(1);
  } finally { client.release(); await pool.end(); }
})();
