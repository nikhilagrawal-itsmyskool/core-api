/**
 * Payment re-allocation — fixes migration mis-tagging of which cycles a payment settled.
 *
 * The SchoolPad migration reconstructed per-cycle payment allocation WITHOUT using each
 * receipt's `cycle_set` (the field recording which cycles were actually paid). Per-student
 * totals are correct, but the per-cycle tagging is wrong, corrupting per-cycle "due now".
 *
 * This recomputes the CORRECT allocation from MIGRATED receipts (chronological) + cycle_set
 * (each receipt's amount filled across its listed cycles, in cycle order, honouring partials),
 * on top of any NATIVE payments (from the live Collect flow), which are left untouched.
 *
 *   node modules/fees/scripts/reallocate-payments.js               # DRY-RUN (default) — writes nothing
 *   node modules/fees/scripts/reallocate-payments.js --apply --yes # APPLY — voids migrated payments, re-posts
 *
 * Apply is per-student transactional and idempotent: it voids kind='payment' rows with
 * legacy_source='schoolpad' and re-posts them from the receipts, so it can be re-run safely.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod');
const APPLY = has('--apply') && has('--yes'); // both required to write
const SPILL = !has('--no-spill'); // spill a receipt's leftover onto next unpaid cycles (default on)
const ADM = String(arg('--adm', '')).split(',').map((s) => s.trim()).filter(Boolean); // limit to these admission numbers
const SCHOOL = '2qy0xfycrq88';   // DBPASN
const AY = arg('--ay', 'w3ajbki9xhbm'), LABEL = arg('--label', '2026-27'); // 2026-27 default
const TODAY = new Date().toISOString().slice(0, 10);

const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({
  host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE,
  user: cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD,
  port: parseInt(cfg.POSTGRES_PORT || '5432'),
  ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const ymd = (v) => !v ? null : (v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v).slice(0, 10));
const inr = (n) => Math.round(Number(n || 0)).toLocaleString('en-IN');
const round2 = (n) => Math.round(n * 100) / 100;

const INSERT_SQL = `insert into student_ledger_entry
  (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label,
   kind, credit, settles_entry_id, source_module, source_ref, remarks, legacy_source, allocation, status, createdby_userid, created_at)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'payment',$11,$12,'fees',$13,'reallocated from cycle_set','schoolpad','reallocated','active','reallocate',$14)`;
const VOID_SQL = `update student_ledger_entry set status='cancelled', updatedby_userid='reallocate', updated_at=$1
  where school_id=$2 and student_id=$3 and academic_year_id=$4 and kind='payment' and status='active' and legacy_source='schoolpad'`;

(async () => {
  // ---- batch loads (a few queries, then work in memory) ----
  const cycles = (await pool.query(
    `select name, from_date, due_date from fee_cycle where school_id=$1 and academic_year_id=$2 and status='active'`, [SCHOOL, AY])).rows;
  const cycleOrder = {}, cycleDue = {};
  cycles.slice().sort((a, b) => new Date(ymd(a.from_date) || ymd(a.due_date) || '2100-01-01') - new Date(ymd(b.from_date) || ymd(b.due_date) || '2100-01-01'))
    .forEach((c, i) => { cycleOrder[norm(c.name)] = i; });
  cycles.forEach((c) => { cycleDue[norm(c.name)] = ymd(c.due_date); });

  const charges = (await pool.query(
    `select uuid, student_id, category, fee_head_id, cycle_id, cycle_label, head_label, debit from student_ledger_entry
     where school_id=$1 and academic_year_id=$2 and kind='charge' and status='active'`, [SCHOOL, AY])).rows;

  // concession/waiver per charge (for net)
  const cw = {}; // chargeUuid -> {concession, waiver}
  (await pool.query(
    `select settles_entry_id, kind, sum(credit) as c from student_ledger_entry
     where school_id=$1 and academic_year_id=$2 and status='active' and kind in ('concession','waiver') and settles_entry_id is not null
     group by settles_entry_id, kind`, [SCHOOL, AY])).rows.forEach((r) => { (cw[r.settles_entry_id] ||= {})[r.kind] = Number(r.c); });

  // payments per charge, split migrated vs native
  const payBy = {}; // chargeUuid -> {mig, native}
  (await pool.query(
    `select settles_entry_id, case when legacy_source='schoolpad' then 'mig' else 'native' end as src, sum(credit) as c
     from student_ledger_entry where school_id=$1 and academic_year_id=$2 and status='active' and kind='payment' and settles_entry_id is not null
     group by settles_entry_id, src`, [SCHOOL, AY])).rows.forEach((r) => { (payBy[r.settles_entry_id] ||= {})[r.src] = Number(r.c); });

  // only MIGRATED, NON-TRANSPORT receipts drive re-allocation (transport stays separate — it has no
  // charges in this ledger); native receipts (live Collect) are left as-is
  const receipts = (await pool.query(
    `select uuid, student_id, legacy_receipt_no, receipt_date, total_paid, cycle_set, source from fee_receipt
     where school_id=$1 and academic_year_id=$2 and status='active' and student_id is not null and source='schoolpad'
       and (type is null or type <> 'transport')
     order by student_id, receipt_date, legacy_receipt_no`, [SCHOOL, AY])).rows;

  const studInfo = {};
  (await pool.query(
    `select s.uuid, s.name, s.admission_number, c.name as class_name from student s
     left join student_class sc on sc.student_id=s.uuid and sc.academic_year_id=$2 and sc.school_id=$1
     left join class c on c.uuid=sc.class_id
     where s.uuid in (select distinct student_id from fee_receipt where school_id=$1 and academic_year_id=$2 and status='active' and student_id is not null and source='schoolpad')`,
    [SCHOOL, AY])).rows.forEach((r) => { studInfo[r.uuid] = r; });

  const chByStu = {}; charges.forEach((c) => (chByStu[c.student_id] ||= []).push(c));
  const rcByStu = {}; receipts.forEach((r) => (rcByStu[r.student_id] ||= []).push(r));

  // optional --adm filter: restrict processing to specific students (keeps re-runs surgical)
  const admSet = new Set(ADM);
  const targetSids = Object.keys(rcByStu).filter((sid) => !ADM.length || admSet.has(studInfo[sid]?.admission_number));

  const net = (c) => round2(Number(c.debit) - (cw[c.uuid]?.concession || 0) - (cw[c.uuid]?.waiver || 0));
  const nativePaid = (c) => payBy[c.uuid]?.native || 0;
  const oldMigPaid = (c) => payBy[c.uuid]?.mig || 0;

  let studChanged = 0, studSame = 0, dueNowOld = 0, dueNowNew = 0, recLeftover = 0, leftoverAmt = 0;
  let applied = 0, failed = 0, entriesPosted = 0;
  const rows = [['studentId', 'admissionNo', 'class', 'name', 'oldDueNow', 'newDueNow', 'changed', 'unallocated', 'oldPaidCycles', 'newPaidCycles']];
  const spotlight = ['gvxso7lnqvn0', 't6k5ykqksdbg'];

  const client = APPLY ? await pool.connect() : null;

  for (const sid of targetSids) {
    const chs = chByStu[sid] || [];
    const byCycle = {}; chs.forEach((c) => (byCycle[norm(c.cycle_label)] ||= []).push(c));
    Object.values(byCycle).forEach((arr) => arr.sort((a, b) => String(a.head_label).localeCompare(String(b.head_label))));
    // charges in chronological cycle order (for spilling leftover onto the next unpaid cycle)
    const chsOrdered = chs.slice().sort((a, b) =>
      (cycleOrder[norm(a.cycle_label)] ?? 999) - (cycleOrder[norm(b.cycle_label)] ?? 999) || String(a.head_label).localeCompare(String(b.head_label)));

    // fill migrated receipts on top of native payments
    const posted = {}; chs.forEach((c) => (posted[c.uuid] = 0)); // migrated allocation this run
    const allocations = []; // {c, amount, receipt}
    let unalloc = 0;

    for (const r of rcByStu[sid]) {
      let amt = Number(r.total_paid);
      const cyc = String(r.cycle_set || '').split(',').map(norm).filter(Boolean)
        .sort((a, b) => (cycleOrder[a] ?? 999) - (cycleOrder[b] ?? 999));
      for (const cn of cyc) {
        for (const c of (byCycle[cn] || [])) {
          if (amt <= 0.001) break;
          const remaining = round2(net(c) - nativePaid(c) - posted[c.uuid]);
          if (remaining <= 0) continue;
          const take = Math.min(amt, remaining);
          posted[c.uuid] = round2(posted[c.uuid] + take);
          amt = round2(amt - take);
          allocations.push({ c, amount: take, receipt: r });
        }
      }
      // spill leftover (e.g. receipt cycle_set repeats an already-paid cycle like TOA) onto the
      // next unpaid cycles in chronological order — the money was paid, the receipt just under-named it.
      if (amt > 0.001 && SPILL) {
        for (const c of chsOrdered) {
          if (amt <= 0.001) break;
          const remaining = round2(net(c) - nativePaid(c) - posted[c.uuid]);
          if (remaining <= 0) continue;
          const take = Math.min(amt, remaining);
          posted[c.uuid] = round2(posted[c.uuid] + take);
          amt = round2(amt - take);
          allocations.push({ c, amount: take, receipt: r });
        }
      }
      if (amt > 0.5) unalloc = round2(unalloc + amt);
    }
    if (unalloc > 0.5) { recLeftover++; leftoverAmt = round2(leftoverAmt + unalloc); }

    // audit: old vs new due-now and paid-cycles
    let dOld = 0, dNew = 0; const oldCycles = [], newCycles = [];
    for (const c of chs) {
      const nt = net(c);
      const remOld = Math.max(0, round2(nt - nativePaid(c) - oldMigPaid(c)));
      const remNew = Math.max(0, round2(nt - nativePaid(c) - posted[c.uuid]));
      const dd = cycleDue[norm(c.cycle_label)];
      const due = !dd || dd <= TODAY;
      if (due) { dOld += remOld; dNew += remNew; }
      if (nativePaid(c) + oldMigPaid(c) > 0.5) oldCycles.push(c.cycle_label);
      if (nativePaid(c) + posted[c.uuid] > 0.5) newCycles.push(c.cycle_label);
    }
    dueNowOld += dOld; dueNowNew += dNew;
    const changed = oldCycles.slice().sort().join('|') !== newCycles.slice().sort().join('|');
    if (changed) studChanged++; else studSame++;

    const info = studInfo[sid] || {};
    rows.push([sid, info.admission_number || '', info.class_name || '', info.name || '',
      Math.round(dOld), Math.round(dNew), changed ? 'YES' : 'no', Math.round(unalloc), oldCycles.join(' '), newCycles.join(' ')]);
    if (spotlight.includes(sid)) {
      console.log(`\n--- ${info.name} (${info.admission_number}) ---`);
      console.log(`  old paid cycles: ${oldCycles.join(', ')}`);
      console.log(`  NEW paid cycles: ${newCycles.join(', ')}`);
      console.log(`  due-now  old ₹${inr(dOld)}  ->  new ₹${inr(dNew)}${unalloc > 0.5 ? `   (unallocated ₹${inr(unalloc)})` : ''}`);
    }

    // ---- APPLY: void migrated payments, re-post corrected ones (per-student transaction) ----
    if (APPLY) {
      try {
        await client.query('begin');
        await client.query(VOID_SQL, [new Date(), SCHOOL, sid, AY]);
        for (const a of allocations) {
          await client.query(INSERT_SQL, [
            generateShortUuid(12), SCHOOL, sid, AY, ymd(a.receipt.receipt_date), a.c.category,
            a.c.fee_head_id, a.c.cycle_id, a.c.head_label, a.c.cycle_label, a.amount, a.c.uuid, a.receipt.uuid, new Date(),
          ]);
          entriesPosted++;
        }
        await client.query('commit');
        applied++;
      } catch (e) {
        await client.query('rollback');
        failed++;
        console.error(`  APPLY FAILED for ${sid} (${info.name}): ${e.message}`);
      }
    }
  }
  if (client) client.release();

  // ---- CSV audit ----
  const outDir = path.join(__dirname, '../reports');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `payment-reallocation-audit-${STAGE}-${LABEL}${ADM.length ? '-adm' : ''}.csv`);
  fs.writeFileSync(outFile, rows.map((r) => r.map((v) => {
    const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n'), 'utf8');

  console.log(`\n================ PAYMENT RE-ALLOCATION ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'} ================`);
  console.log(`migrated-receipt students : ${targetSids.length}${ADM.length ? ` (filtered to --adm)` : ''}`);
  console.log(`  allocation CHANGES      : ${studChanged}`);
  console.log(`  unchanged               : ${studSame}`);
  console.log(`receipts w/ unallocated leftover (overpay / cycle_set gap): ${recLeftover}  (₹${inr(leftoverAmt)})`);
  console.log(`\n"due now" (this cohort):  BEFORE ₹${inr(dueNowOld)}  ->  AFTER ₹${inr(dueNowNew)}   (−₹${inr(dueNowOld - dueNowNew)})`);
  if (APPLY) console.log(`\nAPPLIED: ${applied} students, ${entriesPosted} payment entries re-posted, ${failed} failed.`);
  else console.log(`\n(dry-run — pass --apply --yes to write)`);
  console.log(`audit CSV: ${outFile}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
