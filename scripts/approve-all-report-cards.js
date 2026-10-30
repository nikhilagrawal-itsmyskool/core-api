// One-time: approve ("OK") every report card in the system so parents can see them in
// the app (the parent endpoint gates on approved_at). Keeps the approval gate intact —
// this just marks existing cards approved.
//
// Connects to the stage DB exactly like shared/lib/db.ts: when POSTGRES_SSM_PASSWORD_PARAM
// is set, it reads POSTGRES_SSM_USERNAME + the password from SSM Parameter Store.
//
// Run (prod): you need AWS creds that can read the SSM param (SSO works with SDK v3):
//   aws sso login --sso-session itsmyskool            # if the token has expired
//   AWS_PROFILE=prod-itsmyskool-nikhil.agrawal node scripts/approve-all-report-cards.js --stage prod
// Dry run (count only, writes nothing): add --dry

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const yaml = require('js-yaml');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { generateShortUuid } = require('../shared/util/generate-uuid.js');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : def;
}

async function main() {
  const stage = arg('--stage', 'prod');
  const dry = !!arg('--dry', false);
  const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../configs/${stage}/${stage}.yml`), 'utf8'));

  let user = cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER;
  let password = cfg.POSTGRES_PASSWORD;
  if (cfg.POSTGRES_SSM_PASSWORD_PARAM) {
    user = cfg.POSTGRES_SSM_USERNAME;
    const ssm = new SSMClient({ region: cfg.AWS_REGION || 'ap-south-1' });
    const res = await ssm.send(new GetParameterCommand({ Name: cfg.POSTGRES_SSM_PASSWORD_PARAM, WithDecryption: true }));
    password = res.Parameter && res.Parameter.Value;
    if (!password) throw new Error(`SSM param ${cfg.POSTGRES_SSM_PASSWORD_PARAM} returned no value`);
  }

  const pool = new Pool({
    host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST,
    database: cfg.POSTGRES_DATABASE,
    user,
    password: String(password),
    port: parseInt(cfg.POSTGRES_PORT || '5432'),
    ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  try {
    // 1. Existing active report headers not yet approved.
    const pending = (await pool.query(
      `select count(*)::int c from exam_report where status = 'active' and approved_at is null`,
    )).rows[0].c;

    // 2. (year, term, class, student) combos that have marks but no active header at all.
    const missing = (await pool.query(
      `select distinct m.school_id, m.academic_year_id, m.term, m.class_id, m.student_id
         from exam_report_mark m
        where not exists (
          select 1 from exam_report r
           where r.school_id = m.school_id and r.academic_year_id = m.academic_year_id
             and r.term = m.term and r.class_id = m.class_id and r.student_id = m.student_id
             and r.status = 'active')`,
    )).rows;

    console.log(`Stage ${stage} · will approve ${pending} existing header(s) and create ${missing.length} approved header(s)${dry ? ' [DRY RUN]' : ''}.`);
    if (dry) return;

    await pool.query(
      `update exam_report set approved_by = 'system', approved_at = now(), updated_at = now()
         where status = 'active' and approved_at is null`,
    );

    const now = new Date();
    let created = 0;
    for (const r of missing) {
      await pool.query(
        `insert into exam_report (uuid, school_id, academic_year_id, term, student_id, class_id, approved_by, approved_at, status, createdby_userid, created_at)
           values ($1,$2,$3,$4,$5,$6,'system',$7,'active','system',$7)`,
        [generateShortUuid(12), r.school_id, r.academic_year_id, r.term, r.student_id, r.class_id, now],
      );
      created++;
    }
    console.log(`Done. Approved ${pending} existing + created ${created} approved headers.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
