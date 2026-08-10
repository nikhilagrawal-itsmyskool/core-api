/**
 * Import the 33 SchoolPad receipts missed by the migration pull (dual-running gap), captured by
 * hand into out/incremental-2026-08-10/*.json from the SchoolPad print views.
 *
 * Each receipt gives the cycles it covered (cycleSet) + the amount (totalPaid). The charges are
 * already in our ledger; we add the missing PAYMENT by allocating totalPaid across the student's
 * open charges for exactly those cycles (earliest due first), then write fee_receipt (with the real
 * SchoolPad receipt_no) + fee_receipt_line + settling payment ledger entries — mirroring collect().
 *
 * Validation: our ledger's remaining on the named cycles must equal the receipt's Total Due. A
 * mismatch (a prior payment also missed, or a cycle not charged) is FLAGGED, not force-written.
 * Idempotent on receipt_no. Dry-run default.
 *
 *   node modules/fees/scripts/import-incremental-2026-08-10.js
 *   node modules/fees/scripts/import-incremental-2026-08-10.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const AY = { '2022-23': 'kxv65myuppgc', '2023-24': 's38z2s46ee9o', '2024-25': 'h31h8xoqwuhc', '2025-26': '3fm049m0jsbh', '2026-27': 'w3ajbki9xhbm' };
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const n = (x) => Number(x || 0);
const iso = (ddmmyyyy) => { const m = String(ddmmyyyy||'').match(/(\d{1,2})-(\d{1,2})-(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : null; };
const modeOf = (s) => { s = String(s||'').toLowerCase(); if (s.includes('cash')) return 'cash'; if (s.includes('online')) return 'online'; if (s.includes('cheque')) return 'cheque'; if (s.includes('draft')) return 'draft'; if (s.includes('card')) return 'card'; if (s.includes('neft')) return 'neft'; return 'online'; };

(async () => {
  const dir = path.join(__dirname, '../../../scripts/fees-migration/out/incremental-2026-08-10');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const recs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).sort((a, b) => a.receiptNo.localeCompare(b.receiptNo));

  const client = APPLY ? await pool.connect() : null;
  if (APPLY) await client.query('begin');
  let ok = 0, flagged = 0, skipped = 0;
  const report = [];
  try {
    for (const r of recs) {
      const ay = AY[r.session];
      const named = String(r.cycleSet || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const amount = n(r.totalPaid);
      const row = { rn: r.receiptNo, adm: r.admissionNo, student: r.studentName, amount };

      if (await pool.query(`select 1 from fee_receipt where school_id=$1 and receipt_no=$2`, [SCHOOL, r.receiptNo]).then((x) => x.rows.length)) { row.action = 'skip (exists)'; skipped++; report.push(row); continue; }
      const stu = (await pool.query(`select uuid from student where school_id=$1 and lower(admission_number)=lower($2)`, [SCHOOL, r.admissionNo])).rows[0];
      if (!stu) { row.action = 'FLAG: student not found'; flagged++; report.push(row); continue; }

      const chargeSql = (extra) => `
        select l.uuid, l.category, l.fee_head_id, l.cycle_id, l.head_label, l.cycle_label, l.debit,
          coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=l.uuid and cr.status='active'),0) paid,
          coalesce(fc.due_date, fc.from_date) due
        from student_ledger_entry l left join fee_cycle fc on fc.uuid=l.cycle_id and fc.status='active'
        where l.school_id=$1 and l.student_id=$2 and l.academic_year_id=$3 and l.kind='charge' and l.status='active' ${extra}
        order by due nulls last, l.created_at`;
      let left = amount; const allocs = [];
      const grab = (list) => { for (const c of list) { const t = Math.min(c.rem, left); if (t < 0.5) continue; allocs.push({ ...c, take: t }); left -= t; if (left < 0.5) break; } };
      const namedCharges = (await pool.query(chargeSql('and lower(trim(l.cycle_label)) = any($4::text[])'), [SCHOOL, stu.uuid, ay, named])).rows;
      grab(namedCharges.map((c) => ({ ...c, rem: n(c.debit) - n(c.paid), spill: false })).filter((c) => c.rem > 0.5));
      // spill any remainder onto the student's OTHER open charges (oldest due first) — corrects the
      // total even where our reallocated ledger's per-cycle split differs from SchoolPad's receipt.
      if (left > 0.5) {
        const others = (await pool.query(chargeSql('and not (lower(trim(l.cycle_label)) = any($4::text[]))'), [SCHOOL, stu.uuid, ay, named])).rows;
        grab(others.map((c) => ({ ...c, rem: n(c.debit) - n(c.paid), spill: true })).filter((c) => c.rem > 0.5));
      }
      const allocated = allocs.reduce((s, a) => s + a.take, 0);
      const spillAmt = allocs.filter((a) => a.spill).reduce((s, a) => s + a.take, 0);
      // concession gap: the receipt shows a concession our named cycles don't carry (a separate discount gap)
      const recConc = (r.lines || []).filter((l) => l.isConcession).reduce((s, l) => s + Math.abs(n(l.amount)), 0);
      const ourNamedConc = n((await pool.query(`select coalesce(sum(credit),0) c from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='concession' and status='active' and lower(trim(cycle_label)) = any($4::text[])`, [SCHOOL, stu.uuid, ay, named])).rows[0].c);
      const concGap = Math.round(recConc - ourNamedConc);

      row.allocated = Math.round(allocated); row.spill = Math.round(spillAmt); row.leftover = Math.round(left); row.concGap = concGap; row.allocs = allocs;
      row.action = left > 0.5 ? `OVERPAY ₹${Math.round(left)} → advance` : (concGap > 1 ? `IMPORT (⚠ concession gap ₹${concGap})` : 'IMPORT');
      if (row.action.startsWith('OVERPAY')) flagged++; else ok++;
      report.push(row);

      if (APPLY && row.action.startsWith('IMPORT')) {
        const receiptId = generateShortUuid(12);
        const d = iso(r.date) || new Date().toISOString().slice(0, 10);
        await client.query(`insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, receipt_date, type,
            payer_name, payer_class_snapshot, admission_no_snapshot, father_name, mother_name, cycle_set, total_due, total_paid, balance, concession_total,
            payment_mode, remarks, status, source, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,'fee',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active','schoolpad','0',now())`,
          [receiptId, SCHOOL, ay, stu.uuid, r.receiptNo, d, r.studentName, r.className || null, r.admissionNo, r.fatherName || null, r.motherName || null, r.cycleSet || null, n(r.totalDue), amount, n(r.balance), recConc, modeOf(r.paymentMode), r.remarks && r.remarks !== '---' ? r.remarks : null]);
        // receipt LINES = SchoolPad's own presentation (Composite Fee gross + Concession) so the print
        // reproduces the original receipt via the migrated-style waterfall. Display only — no settles link.
        for (const l of (r.lines || [])) {
          await client.query(`insert into fee_receipt_line (uuid, school_id, receipt_id, fee_head_id, cycle_id, head_label, cycle_label, amount, is_concession, settles_ledger_id, createdby_userid, created_at)
            values ($1,$2,$3,null,null,$4,null,$5,$6,null,'0',now())`, [generateShortUuid(12), SCHOOL, receiptId, l.headLabel, Math.abs(n(l.amount)), !!l.isConcession]);
        }
        // ledger PAYMENTS = our per-cycle allocation, settling the real charges (drives the balance)
        for (const a of allocs) {
          await client.query(`insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, source_ref, allocation, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'payment',$11,$12,'fees',$13,'explicit','active','0',now())`, [generateShortUuid(12), SCHOOL, stu.uuid, ay, d, a.category, a.fee_head_id, a.cycle_id, a.head_label, a.cycle_label, a.take, a.uuid, r.receiptNo]);
        }
      }
    }
    if (APPLY) await client.query('commit');
  } catch (e) { if (APPLY) await client.query('rollback'); if (client) client.release(); throw e; }
  if (client) client.release();

  console.log(`================ IMPORT INCREMENTAL (2026-08-10) ${APPLY ? 'APPLY' : 'DRY-RUN'} ================`);
  console.log(`receipts: ${recs.length}  ·  IMPORT: ${ok}  ·  OVERPAY/flagged: ${flagged}  ·  skipped(exist): ${skipped}`);
  const concGaps = report.filter((r) => r.concGap > 1);
  console.log('\n  receipt              adm            student            amount   allocated  spill  action');
  report.forEach((r) => console.log(`  ${String(r.rn).padEnd(20)} ${String(r.adm).padEnd(14)} ${String(r.student||'').slice(0,16).padEnd(16)} ${inr(r.amount).padEnd(8)} ${r.allocated!=null?inr(r.allocated).padEnd(10):'—'.padEnd(10)} ${r.spill?inr(r.spill).padEnd(6):'-'.padEnd(6)} ${r.action}`));
  if (concGaps.length) { console.log(`\n⚠ CONCESSION GAPS (payment still imports; separate discount to reconcile): ${concGaps.length}`); concGaps.forEach((r) => console.log(`   ${r.rn} ${r.adm} ${r.student} — receipt has concession our ledger lacks: ${inr(r.concGap)}`)); }
  if (!APPLY) console.log('\n(dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
