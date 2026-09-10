// Seed (or refresh) the Staff Leave, Attendance & Punctuality Policy as employee_document
// v1 for a school. Idempotent: re-running updates the body/title in place (same version) so
// existing signatures stay valid; it never duplicates. To force everyone to re-sign, bump
// the version from the portal editor instead.
//
//   node modules/employee/scripts/seed-leave-policy.js --stage prod --school 2qy0xfycrq88
//
// Defaults to the DBPASN prod school uuid when --school is omitted.

const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../../../scripts/run-sql.js');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

const DEFAULTS = {
  code: 'staff_leave_policy',
  title: 'Staff Leave, Attendance & Punctuality Policy',
  category: 'policy',
  summary: 'Leave, attendance & punctuality rules for all teaching & non-teaching staff (Session 2026–27).',
  effectiveFrom: '2026-09-01',
  audience: 'all',
  signModes: 'both',
  requiresAck: true,
  status: 'published',
};

function parseArgs(argv) {
  const out = { stage: null, school: '2qy0xfycrq88' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--stage' || argv[i] === '-s') out.stage = argv[++i];
    else if (argv[i] === '--school') out.school = argv[++i];
  }
  return out;
}

async function main() {
  const { stage, school } = parseArgs(process.argv.slice(2));
  if (!stage) { console.error('Usage: --stage <local|dev|prod> [--school <uuid>]'); process.exit(1); }

  const bodyHtml = fs.readFileSync(path.join(__dirname, '../policy-seed/staff-leave-policy.html'), 'utf8').trim();

  const config = loadConfig(stage);
  const pool = createPool(config);
  console.log(`Connected to ${config.POSTGRES_ENDPOINT || config.POSTGRES_HOST}/${config.POSTGRES_DATABASE}`);

  try {
    const existing = await pool.query(
      `select uuid, version from employee_document where school_id = $1 and lower(code) = lower($2) and status <> 'archived' order by version desc limit 1`,
      [school, DEFAULTS.code],
    );
    const now = new Date();

    if (existing.rows.length) {
      const row = existing.rows[0];
      await pool.query(
        `update employee_document set title = $1, category = $2, summary = $3, body_html = $4,
           effective_from = $5, audience = $6, sign_modes = $7, requires_ack = $8, status = $9,
           updated_at = $10 where uuid = $11`,
        [DEFAULTS.title, DEFAULTS.category, DEFAULTS.summary, bodyHtml, DEFAULTS.effectiveFrom,
          DEFAULTS.audience, DEFAULTS.signModes, DEFAULTS.requiresAck, DEFAULTS.status, now, row.uuid],
      );
      console.log(`Refreshed existing document ${row.uuid} (v${row.version}) — body updated in place.`);
    } else {
      const id = generateShortUuid(12);
      await pool.query(
        `insert into employee_document
          (uuid, school_id, employee_id, code, title, category, version, summary, body_html, pdf_file_id,
           effective_from, audience, sign_modes, requires_ack, status, createdby_userid, created_at, updatedby_userid, updated_at)
         values ($1,$2,null,$3,$4,$5,1,$6,$7,null,$8,$9,$10,$11,$12,'seed',$13,'seed',$13)`,
        [id, school, DEFAULTS.code, DEFAULTS.title, DEFAULTS.category, DEFAULTS.summary, bodyHtml,
          DEFAULTS.effectiveFrom, DEFAULTS.audience, DEFAULTS.signModes, DEFAULTS.requiresAck, DEFAULTS.status, now],
      );
      console.log(`Inserted new document ${id} (v1) for school ${school}.`);
    }
  } finally {
    await pool.end();
  }
  console.log('Done.');
}

main().catch((err) => { console.error('Error:', err.message); process.exit(1); });
