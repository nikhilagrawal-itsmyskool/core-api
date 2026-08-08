/**
 * Seed the native receipt counters past the migrated SchoolPad numbers, so the first
 * receipt we issue reads e.g. FR-14881 (continuing the sequence) instead of restarting at
 * FR-1 next to the imported FR-14880-... receipts.
 *
 *   node scripts/fees-migration/seed-receipt-counters.js --stage prod --school-code DBPASN [--year 2026-27] [--apply]
 *
 * Seeds only the given academic year's counters (FR/TR/AR/RF) to the global max legacy
 * receipt id. DRY-RUN by default. Idempotent-ish: re-running only raises a counter, never
 * lowers it (guarded by greatest()).
 */
const { loadConfig, createPool } = require('../run-sql');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const YEAR = arg('year', '2026-27');
const APPLY = !!arg('apply', false);
const SERIES = ['FR', 'TR', 'AR', 'RF'];

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found`); process.exit(1); }
  const sid = school.uuid;
  const ay = (await pool.query('select uuid, name from academic_year where school_id=$1 and name=$2', [sid, YEAR])).rows[0];
  if (!ay) { console.error(`academic year ${YEAR} not found`); process.exit(1); }

  // max numeric id from the second segment of any receipt_no (e.g. FR-14880-0108-14 -> 14880)
  const maxRow = await pool.query(
    "select coalesce(max((split_part(receipt_no,'-',2))::int),0) as maxid from fee_receipt where school_id=$1 and receipt_no ~ '^[A-Za-z]+-[0-9]+'",
    [sid]
  );
  const dbMax = Number(maxRow.rows[0].maxid) || 0;
  const override = Number(arg('last-no', 0)) || 0;
  const maxId = override > dbMax ? override : dbMax; // allow a manual gap above SchoolPad's ongoing numbers
  console.log(`db max legacy receipt id: ${dbMax}${override ? `  (overridden to ${override} for a collision gap)` : ''}`);
  console.log(`global max legacy receipt id: ${maxId}  → next native receipts will be <SERIES>-${maxId + 1}`);
  console.log(`seeding counters for ${YEAR} (${ay.uuid}) to last_no=${maxId}:`);

  for (const series of SERIES) {
    const cur = (await pool.query('select last_no from fee_receipt_counter where school_id=$1 and series=$2 and academic_year_id=$3', [sid, series, ay.uuid])).rows[0];
    console.log(`  ${series}: current=${cur ? cur.lastNo : '(none)'} -> ${maxId}`);
    if (APPLY) {
      await pool.query(
        `insert into fee_receipt_counter (uuid, school_id, series, academic_year_id, last_no, updated_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (school_id, series, academic_year_id)
         do update set last_no = greatest(fee_receipt_counter.last_no, $5), updated_at = $6`,
        [generateShortUuid(12), sid, series, ay.uuid, maxId, new Date()]
      );
    }
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (pass --apply to write)'}`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
