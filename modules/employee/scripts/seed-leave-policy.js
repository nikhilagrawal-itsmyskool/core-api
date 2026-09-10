// Seed (or refresh) the Staff Leave, Attendance & Punctuality Policy as an
// employee_document for a school. Idempotent: first run inserts v1 (published, both sign
// modes); a re-run refreshes the body/title of the current version in place (cosmetic —
// it does NOT bump the version, so existing signatures stay valid). To publish a genuine
// new version that everyone must re-sign, use the portal's "Publish new version".
//
//   node modules/employee/scripts/seed-leave-policy.js --stage prod --school-code DBPASN
//
// Options: --stage (required), --school-code (default DBPASN) or --school-id, --code
// (default staff_leave_policy), --effective (default 2026-09-01).

const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../../../scripts/run-sql.js');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const stage = arg('stage');
  if (!stage) { console.error('Missing --stage'); process.exit(1); }
  const schoolCode = arg('school-code', 'DBPASN');
  let schoolId = arg('school-id', null);
  const code = arg('code', 'staff_leave_policy');
  const effective = arg('effective', '2026-09-01');
  const title = 'Staff Leave, Attendance & Punctuality Policy';

  const bodyPath = path.join(__dirname, '..', 'policy-seed', 'staff-leave-policy.html');
  const bodyHtml = fs.readFileSync(bodyPath, 'utf8');

  const pool = createPool(loadConfig(stage));
  try {
    if (!schoolId) {
      const r = await pool.query('select uuid from school where lower(code) = lower($1)', [schoolCode]);
      if (!r.rows.length) { console.error(`School not found for code ${schoolCode}`); process.exit(1); }
      schoolId = r.rows[0].uuid;
    }
    console.log(`School ${schoolCode} = ${schoolId}; document code = ${code}`);

    const existing = await pool.query(
      `select uuid, version, status from employee_document where school_id = $1 and lower(code) = lower($2) and status <> 'archived' order by version desc limit 1`,
      [schoolId, code],
    );
    const now = new Date();

    if (existing.rows.length) {
      const row = existing.rows[0];
      await pool.query(
        `update employee_document set title = $1, category = 'policy', summary = $2, body_html = $3,
            effective_from = $4, audience = 'all', sign_modes = 'both', requires_ack = true, status = 'published',
            updated_at = $5 where uuid = $6`,
        [title, 'Annual staff leave, attendance & punctuality rules — read and sign.', bodyHtml, effective, now, row.uuid],
      );
      console.log(`Refreshed existing document ${row.uuid} (v${row.version}, ${row.status}) in place — signatures preserved.`);
    } else {
      const id = generateShortUuid(12);
      await pool.query(
        `insert into employee_document
          (uuid, school_id, employee_id, code, title, category, version, summary, body_html, pdf_file_id,
           effective_from, audience, sign_modes, requires_ack, status, createdby_userid, created_at, updatedby_userid, updated_at)
         values ($1,$2,null,$3,$4,'policy',1,$5,$6,null,$7,'all','both',true,'published','seed',$8,'seed',$8)`,
        [id, schoolId, code, title, 'Annual staff leave, attendance & punctuality rules — read and sign.', bodyHtml, effective, now],
      );
      console.log(`Inserted new document ${id} (v1, published, sign modes: both).`);
    }
    console.log('Done.');
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
