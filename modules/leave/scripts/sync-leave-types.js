// Align a school's leave_type rows with the current policy seed:
//   - insert any missing type (e.g. Bereavement / BER),
//   - backfill annual_quota + attachment_over_days ONLY where currently null (so admin edits
//     are never clobbered).
// Idempotent. Run after deploying the annual-quota columns.
//
//   node modules/leave/scripts/sync-leave-types.js --stage prod --school-code DBPASN
//
// Options: --stage (required), --school-code (default DBPASN) or --school-id.

const { loadConfig, createPool } = require('../../../scripts/run-sql.js');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

// Mirror of LEAVE_TYPE_SEED in leave-constants.ts (kept inline — this is a plain JS script).
const SEED = [
  { code: 'CL', name: 'Casual Leave', paid: 'yes', countsVsQuota: true, requiresAttachment: false, waivable: false, sortOrder: 1, annualQuota: 8, attachmentOverDays: null },
  { code: 'ML', name: 'Medical Leave', paid: 'yes', countsVsQuota: true, requiresAttachment: false, waivable: true, sortOrder: 2, annualQuota: 4, attachmentOverDays: 2 },
  { code: 'BER', name: 'Bereavement Leave', paid: 'yes', countsVsQuota: false, requiresAttachment: false, waivable: true, sortOrder: 3, annualQuota: 3, attachmentOverDays: null },
  { code: 'OD', name: 'On Duty (Exam / Official)', paid: 'yes', countsVsQuota: false, requiresAttachment: false, waivable: true, sortOrder: 4, annualQuota: null, attachmentOverDays: null },
  { code: 'COMP', name: 'Compensatory Off', paid: 'yes', countsVsQuota: false, requiresAttachment: false, waivable: false, sortOrder: 5, annualQuota: null, attachmentOverDays: null },
  { code: 'EMERG', name: 'Emergency / Family', paid: 'discretionary', countsVsQuota: false, requiresAttachment: false, waivable: true, sortOrder: 6, annualQuota: null, attachmentOverDays: null },
  { code: 'LWP', name: 'Leave Without Pay', paid: 'no', countsVsQuota: false, requiresAttachment: false, waivable: false, sortOrder: 7, annualQuota: null, attachmentOverDays: null },
];

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function main() {
  const stage = arg('stage');
  if (!stage) { console.error('Missing --stage'); process.exit(1); }
  const schoolCode = arg('school-code', 'DBPASN');
  let schoolId = arg('school-id', null);

  const pool = createPool(loadConfig(stage));
  try {
    if (!schoolId) {
      const r = await pool.query('select uuid from school where lower(code) = lower($1)', [schoolCode]);
      if (!r.rows.length) { console.error(`School not found for code ${schoolCode}`); process.exit(1); }
      schoolId = r.rows[0].uuid;
    }
    console.log(`Syncing leave types for ${schoolCode} = ${schoolId}`);
    const now = new Date();
    for (const s of SEED) {
      const ex = await pool.query(
        `select uuid from leave_type where school_id = $1 and lower(code) = lower($2) and status <> 'deleted'`,
        [schoolId, s.code],
      );
      if (!ex.rows.length) {
        await pool.query(
          `insert into leave_type
            (uuid, school_id, code, name, paid, counts_vs_quota, requires_attachment, waivable, approver_role, sort_order, annual_quota, attachment_over_days, status, createdby_userid, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'god',$9,$10,$11,'active','sync',$12)`,
          [generateShortUuid(12), schoolId, s.code, s.name, s.paid, s.countsVsQuota, s.requiresAttachment, s.waivable, s.sortOrder, s.annualQuota, s.attachmentOverDays, now],
        );
        console.log(`  + inserted ${s.code} (quota ${s.annualQuota ?? '—'})`);
      } else {
        await pool.query(
          `update leave_type set annual_quota = coalesce(annual_quota, $1), attachment_over_days = coalesce(attachment_over_days, $2), updated_at = $3
             where uuid = $4`,
          [s.annualQuota, s.attachmentOverDays, now, ex.rows[0].uuid],
        );
        console.log(`  ~ ${s.code}: backfilled quota/threshold where null`);
      }
    }
    console.log('Done.');
  } catch (err) {
    console.error('Sync failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
