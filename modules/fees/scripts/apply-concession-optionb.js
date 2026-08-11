/**
 * Option B (SchoolPad-faithful) concession backfill for 2026-27.
 *
 * For each targeted student+scheme, apply the per-month tuition discount (or one-time caution
 * waiver) ONLY to cycles the student has NOT already paid in full. "Paid full" is derived from the
 * student's own SchoolPad receipts: any cycle that appears on a receipt with ZERO concession was
 * collected at full price, so we do not retroactively credit it (matches SchoolPad, which applies a
 * concession from its grant date forward). Cycles that were paid at a discount, or not yet paid, get
 * the concession.
 *
 * This is a reconcile to the Option-B target: it ADDS missing concession rows AND CANCELS any that
 * sit on a paid-full cycle (e.g. Aadhya's accidental full-year apply -> trimmed to her 9 unpaid
 * months). Idempotent, per-student transaction, dry-run default.
 *
 *   node modules/fees/scripts/apply-concession-optionb.js
 *   node modules/fees/scripts/apply-concession-optionb.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const AY = 'w3ajbki9xhbm'; // 2026-27
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const n = (x) => Number(x || 0);
const norm = (s) => String(s || '').trim().toLowerCase();

// Curated target set (verified against the concession master + each student's SchoolPad receipts).
// `skip` = tuition months the student PAID IN FULL with no tuition discount — Option B does not
// retroactively credit these. Derived by reading the receipts directly (the reallocation makes
// per-cycle paid/conc auto-detection unreliable), so it is stated explicitly for audit.
const TARGETS = [
  { adm: '389/j/2k24', scheme: 'Tuition Fee Discount (225)', rate: 225, head: 'tuition', skip: [] },
  { adm: '448/j/2k25', scheme: 'Tuition Fee Discount (225)', rate: 225, head: 'tuition', skip: [] },
  { adm: '1121/2k26', scheme: 'Tuition Fee Discount (225)', rate: 225, head: 'tuition', skip: ['May', 'June', 'July'] },
  { adm: '317/j/2k22', scheme: 'Tuition Fee Discount (250)', rate: 250, head: 'tuition', skip: ['April', 'May', 'June'] },
  { adm: '743/s/2k24', scheme: 'Tuition Fee Discount (275)', rate: 275, head: 'tuition', skip: ['April', 'May', 'June'] },
  { adm: '643/s/2k24', scheme: 'Tuition Fee Discount (275)', rate: 275, head: 'tuition', skip: [] },
  { adm: '661/s/2k24', scheme: 'Tuition Fee Discount (300)', rate: 300, head: 'tuition', skip: [] },
  { adm: '63/s/2k17',  scheme: 'Tuition Fee Discount (300)', rate: 300, head: 'tuition', skip: [] },
  { adm: '635/s/2k24', scheme: 'Tuition Fee commerce',       rate: 300, head: 'tuition', skip: ['April', 'May', 'June'] },
  { adm: '152/s/2k19', scheme: 'Tuition Fee commerce',       rate: 300, head: 'tuition', skip: [] }, // stack on top of existing 350
  { adm: '473/s/2k22', scheme: 'Staff Fee Discount (550)',   rate: 550, head: 'tuition', skip: [] },
  { adm: '1125/2k26', scheme: 'CAUTION', rate: 2500, head: 'caution', skip: [] },
  { adm: '1126/2k26', scheme: 'CAUTION', rate: 2500, head: 'caution', skip: [] },
  { adm: '985/2k26',  scheme: 'CAUTION', rate: 2500, head: 'caution', skip: [] },
  { adm: '966/2k26',  scheme: 'CAUTION', rate: 2500, head: 'caution', skip: [] },
  { adm: '1079/2k26', scheme: 'CAUTION', rate: 2500, head: 'caution', skip: [] }, // caution WAS waived (line proves it)
];

(async () => {
  console.log(`Option-B concession reconcile  ·  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const report = [];
  let totAdd = 0, totRemove = 0;

  for (const t of TARGETS) {
    const stu = (await pool.query(`select uuid, name from student where school_id=$1 and lower(admission_number)=lower($2)`, [SCHOOL, t.adm])).rows[0];
    if (!stu) { console.log(`  ${t.adm}: NOT FOUND`); continue; }

    // charges for the relevant head
    const headFilter = t.head === 'caution' ? `head_label ilike '%caution%'` : `head_label = 'Tuition Fee'`;
    const charges = (await pool.query(
      `select uuid, fee_head_id, cycle_id, cycle_label, entry_date, debit from student_ledger_entry
       where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='charge' and status='active' and ${headFilter} order by entry_date`,
      [SCHOOL, stu.uuid, AY])).rows;

    // paid-full cycles: explicit, receipt-verified skip list (Option B — no retroactive credit)
    const paidFull = new Set((t.skip || []).map(norm));

    // current concession on these charges under this scheme
    const curRows = (await pool.query(
      `select settles_entry_id, uuid, credit from student_ledger_entry
       where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='concession' and status='active' and head_label=$4 and settles_entry_id is not null`,
      [SCHOOL, stu.uuid, AY, t.scheme])).rows;
    const curByCharge = {}; curRows.forEach((r) => { const k = r.settles_entry_id; (curByCharge[k] ||= { sum: 0, ids: [] }); curByCharge[k].sum += n(r.credit); curByCharge[k].ids.push(r.uuid); });

    const adds = [], removes = [], skips = [];
    for (const ch of charges) {
      const isPaidFull = paidFull.has(norm(ch.cycle_label));
      const desired = isPaidFull ? 0 : Math.min(t.rate, n(ch.debit));
      const cur = curByCharge[ch.uuid]?.sum || 0;
      if (isPaidFull) skips.push(ch.cycle_label);
      if (Math.abs(desired - cur) < 0.5) continue;
      if (desired > cur) adds.push({ ch, amt: desired - cur });
      else removes.push({ ch, ids: curByCharge[ch.uuid].ids, amt: cur - desired });
    }
    const addAmt = adds.reduce((a, x) => a + x.amt, 0), remAmt = removes.reduce((a, x) => a + x.amt, 0);
    totAdd += addAmt; totRemove += remAmt;

    // balance guard
    const bal = (await pool.query(
      `select coalesce(sum(debit) filter(where kind='charge'),0)-coalesce(sum(credit) filter(where kind in ('concession','payment','waiver')),0) b
       from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active'`,
      [SCHOOL, stu.uuid, AY])).rows[0].b;
    const balAfter = n(bal) - (addAmt - remAmt);

    report.push({ t, stu, paidFull: [...paidFull], skips, adds, removes, addAmt, remAmt, balNow: n(bal), balAfter, curTotal: curRows.reduce((a, r) => a + n(r.credit), 0) });

    if (APPLY && (adds.length || removes.length) && balAfter >= -0.5) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (const rm of removes) for (const id of rm.ids) await client.query(`update student_ledger_entry set status='cancelled', updatedby_userid='optionb', updated_at=now() where uuid=$1`, [id]);
        for (const a of adds) await client.query(
          `insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, credit, settles_entry_id, source_module, source_ref, remarks, legacy_source, allocation, status, created_at)
           values ($1,$2,$3,$4,$5,'fee',$6,$7,$8,$9,'concession',null,$10,$11,'fees',null,$12,'schoolpad','explicit','active',now())`,
          [generateShortUuid(12), SCHOOL, stu.uuid, AY, a.ch.entry_date, a.ch.fee_head_id, a.ch.cycle_id, t.scheme, a.ch.cycle_label, a.amt, a.ch.uuid, 'concession optionB (receipt-derived) 2026-08-11']);
        await client.query('commit');
      } catch (e) { await client.query('rollback'); report[report.length - 1].error = e.message; }
      finally { client.release(); }
    }
  }

  // ---- print ----
  for (const r of report) {
    const tag = r.error ? `ERROR ${r.error}` : (r.balAfter < -0.5 ? '*** would go NEGATIVE — skipped' : '');
    console.log(`${r.t.adm.padEnd(12)} ${String(r.stu.name).slice(0, 18).padEnd(18)} ${r.t.scheme.padEnd(28)} @ ${inr(r.t.rate)}`);
    console.log(`   paid-full (skip): ${r.skips.length ? r.skips.join(', ') : '(none — full year)'}`);
    console.log(`   apply to ${r.adds.length} cycle(s) = ${inr(r.addAmt)}${r.removes.length ? `   ·   CANCEL ${r.removes.length} paid-full cycle(s) = ${inr(r.remAmt)} [${r.removes.map((x) => x.ch.cycle_label).join(', ')}]` : ''}`);
    console.log(`   current ${inr(r.curTotal)} -> target ${inr(r.curTotal + r.addAmt - r.remAmt)}   ·   bal ${inr(r.balNow)} -> ${inr(r.balAfter)}   ${tag}`);
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'WOULD'}  add ${inr(totAdd)}  ·  cancel ${inr(totRemove)}  across ${report.length} students`);
  if (!APPLY) console.log('\nDRY-RUN only. Re-run with --apply --yes to write.');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
