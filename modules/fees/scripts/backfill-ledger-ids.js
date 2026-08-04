/**
 * Backfill fee_head_id + cycle_id on migrated ledger entries so relationships are id-based.
 *
 * The SchoolPad migration left fee_head_id / cycle_id NULL (kept only labels). Two phases:
 *   1. CHARGES  — resolve head_label -> fee_head.uuid and cycle_label -> fee_cycle.uuid
 *                 (per school+year, whitespace/case-insensitive).
 *   2. CREDITS  — payment/concession/waiver rows inherit fee_head_id + cycle_id from the CHARGE
 *                 they settle (settles_entry_id), because a credit's head/cycle IS its charge's.
 * Amounts and settles_entry_id links are never touched. Rows that are neither (standalone
 * adjust/misc with note-like labels) are left null and reported.
 *
 *   node modules/fees/scripts/backfill-ledger-ids.js               # DRY-RUN
 *   node modules/fees/scripts/backfill-ledger-ids.js --apply --yes # write
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod');
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88', AY = 'w3ajbki9xhbm';

const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });

const N = (x) => `regexp_replace(lower(btrim(${x})),'\\s+',' ','g')`;
const headJoin = `${N('le.head_label')} = ${N('h.name')}`;
const cycJoin = `${N('le.cycle_label')} = ${N('c.name')}`;
const P = [SCHOOL, AY];

(async () => {
  const cnt = async (sql) => (await pool.query(sql, P)).rows[0].n;
  // phase 1: charges resolvable by label
  const chHead = await cnt(`select count(*) n from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.fee_head_id is null and exists (select 1 from fee_head h where h.school_id=$1 and h.academic_year_id=$2 and h.status='active' and ${headJoin})`);
  const chCyc = await cnt(`select count(*) n from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.cycle_id is null and exists (select 1 from fee_cycle c where c.school_id=$1 and c.academic_year_id=$2 and c.status='active' and ${cycJoin})`);
  const badChHead = (await pool.query(`select distinct head_label from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.fee_head_id is null and le.head_label is not null and not exists (select 1 from fee_head h where h.school_id=$1 and h.academic_year_id=$2 and h.status='active' and ${headJoin})`, P)).rows;
  const badChCyc = (await pool.query(`select distinct cycle_label from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.cycle_id is null and le.cycle_label is not null and not exists (select 1 from fee_cycle c where c.school_id=$1 and c.academic_year_id=$2 and c.status='active' and ${cycJoin})`, P)).rows;
  // phase 2: credits that settle a charge
  const credN = await cnt(`select count(*) n from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and le.settles_entry_id is not null and (le.fee_head_id is null or le.cycle_id is null)`);
  // leftover: null-id rows that are neither a charge nor a settling credit (standalone adjust/misc)
  const leftover = (await pool.query(`select kind, count(*) n from student_ledger_entry le where le.school_id=$1 and le.academic_year_id=$2 and (le.fee_head_id is null or le.cycle_id is null) and le.settles_entry_id is null and le.kind <> 'charge' group by kind order by kind`, P)).rows;

  console.log(`================ BACKFILL LEDGER IDS ${APPLY ? 'APPLY' : 'DRY-RUN'} ================`);
  console.log(`phase 1 (charges by label): fee_head_id -> ${chHead} rows, cycle_id -> ${chCyc} rows`);
  console.log(`  unmatched charge head_labels: ${badChHead.length ? badChHead.map(r=>`"${r.head_label}"`).join(', ') : 'none ✓'}`);
  console.log(`  unmatched charge cycle_labels: ${badChCyc.length ? badChCyc.map(r=>`"${r.cycle_label}"`).join(', ') : 'none ✓'}`);
  console.log(`phase 2 (credits inherit head/cycle from settled charge): ${credN} rows`);
  console.log(`left null (standalone non-charge adjust/misc): ${leftover.length ? leftover.map(r=>`${r.kind}=${r.n}`).join(', ') : 'none'}`);

  if (APPLY) {
    if (badChHead.length || badChCyc.length) { console.log('\nABORTING — unmatched CHARGE labels; resolve first.'); await pool.end(); return; }
    const h = await pool.query(`update student_ledger_entry le set fee_head_id=h.uuid from fee_head h where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.fee_head_id is null and h.school_id=$1 and h.academic_year_id=$2 and h.status='active' and ${headJoin}`, P);
    const c = await pool.query(`update student_ledger_entry le set cycle_id=c.uuid from fee_cycle c where le.school_id=$1 and le.academic_year_id=$2 and le.kind='charge' and le.cycle_id is null and c.school_id=$1 and c.academic_year_id=$2 and c.status='active' and ${cycJoin}`, P);
    const cr = await pool.query(`update student_ledger_entry le set fee_head_id=coalesce(le.fee_head_id, ch.fee_head_id), cycle_id=coalesce(le.cycle_id, ch.cycle_id) from student_ledger_entry ch where le.school_id=$1 and le.academic_year_id=$2 and le.settles_entry_id=ch.uuid and (le.fee_head_id is null or le.cycle_id is null)`, P);
    console.log(`\nAPPLIED: charges fee_head_id=${h.rowCount}, cycle_id=${c.rowCount}; credits inherited=${cr.rowCount}.`);
  } else {
    console.log('\n(dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
