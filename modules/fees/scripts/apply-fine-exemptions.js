/**
 * Import SchoolPad "Fine Exemption" records so our ledger mirrors SchoolPad's late-fee reality.
 *
 * SchoolPad auto-levies a Late Fee (₹10/day, cap ₹1,010) on overdue cycles, then staff EXEMPT it at
 * collect time (Fine Exempted Students Report: Original -> Exempted -> Final 0). Our migration
 * captured fines that were still owed at snapshot time (head_label='Late Fee Fine') but not the
 * exemptions. This reconciles both directions:
 *
 *  1. Give late fees a real fee_head ("Late Fee Fine") and backfill fee_head_id on existing fine lines.
 *  2. For each exemption row (student, cycle):
 *       - fine charge EXISTS in our ledger  -> add a waiver for the full fine (Final 0).
 *           if a payment sits on that fine (my 2026-08-10 import mis-allocated it), move that money to
 *           the student's unpaid BASE charges (earliest-due first) so the balance matches SchoolPad.
 *       - fine charge ABSENT (SchoolPad exempted it before our snapshot) -> CREATE the fine + waive it
 *           (net-zero) so the ledger carries the full "levied -> exempted" record.
 *  Existing fines NOT in the report are left untouched (genuinely owed).
 *
 * Per-student transaction, idempotent (skips already-waived fines), dry-run default.
 *
 *   node modules/fees/scripts/apply-fine-exemptions.js
 *   node modules/fees/scripts/apply-fine-exemptions.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const AYS = { '2024-25': 'h31h8xoqwuhc', '2025-26': '3fm049m0jsbh' };
const FILES = { '2024-25': 'C:/Users/nikhi/Downloads/FineExemptedStudentsReport-2024-25.xls', '2025-26': 'C:/Users/nikhi/Downloads/FineExemptedStudentsReport-2025-26.xls' };
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const n = (x) => Number(x || 0);
const round2 = (x) => Math.round(x * 100) / 100;
const uq = (s) => String(s || '').replace(/^"|"$/g, '').trim();
const HEAD_NAME = 'Late Fee Fine';

async function ensureHead(client, ay) {
  const ex = (await client.query(`select uuid from fee_head where school_id=$1 and academic_year_id=$2 and lower(name)=lower($3) and status='active'`, [SCHOOL, ay, HEAD_NAME])).rows[0];
  if (ex) return ex.uuid;
  const uuid = generateShortUuid(12);
  if (APPLY) await client.query(`insert into fee_head (uuid, school_id, academic_year_id, name, kind, refundable, one_time, status, createdby_userid, created_at) values ($1,$2,$3,$4,'other',false,false,'active','fine-import',now())`, [uuid, SCHOOL, ay, HEAD_NAME]);
  return uuid;
}

(async () => {
  console.log(`Fine-exemption import  ·  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const client = await pool.connect();
  const report = { heads: 0, backfill: 0, waived: 0, created: 0, reallocated: 0, skipped: 0, unmatchedNoStudent: 0, students: 0 };
  try {
    // ---- phase 1: head + fee_head_id backfill (all years with fine lines) ----
    const fineYears = (await client.query(`select distinct academic_year_id from student_ledger_entry where school_id=$1 and head_label ilike '%late%' and status='active'`, [SCHOOL])).rows.map((r) => r.academic_year_id);
    const headByAy = {};
    for (const ay of fineYears) {
      const h = await ensureHead(client, ay); headByAy[ay] = h; report.heads++;
      const cnt = n((await client.query(`select count(*) c from student_ledger_entry where school_id=$1 and academic_year_id=$2 and head_label ilike '%late%' and fee_head_id is null and status='active'`, [SCHOOL, ay])).rows[0].c);
      report.backfill += cnt;
      if (APPLY && cnt) await client.query(`update student_ledger_entry set fee_head_id=$1, updated_at=now() where school_id=$2 and academic_year_id=$3 and head_label ilike '%late%' and fee_head_id is null and status='active'`, [headByAy[ay], SCHOOL, ay]);
    }
    // ensure head exists for the exemption years too (in case a year had no fines yet)
    for (const ay of Object.values(AYS)) if (!headByAy[ay]) headByAy[ay] = await ensureHead(client, ay);

    // ---- phase 2: parse exemptions -> group by (year, student) ----
    const byStu = {}; // key `${ay}|${adm}` -> {ay, adm, rows:[{cycle, orig, exe, by, on}]}
    for (const [yr, file] of Object.entries(FILES)) {
      if (!fs.existsSync(file)) { console.log(`(${yr} file not found)`); continue; }
      const lines = fs.readFileSync(file, 'latin1').split(/\r?\n/).filter((l) => l.trim());
      const hi = lines.findIndex((l) => /regno|cyclename|cycle name/i.test(l));
      const hdr = lines[hi].split('\t').map(uq);
      const norm = (h) => h.toLowerCase().replace(/[^a-z]/g, '');
      const idx = (...names) => hdr.findIndex((h) => names.some((nm) => norm(h).includes(nm)));
      const iAdm = idx('regno', 'admno', 'adm'), iCyc = idx('cyclename', 'cycle'), iExe = idx('exemptedamount'), iOrig = idx('originalamount', 'original'), iBy = idx('exemptedby'), iOn = idx('exemptedon');
      for (let i = hi + 1; i < lines.length; i++) {
        const c = lines[i].split('\t').map(uq); const adm = c[iAdm]; if (!/2k\d\d/i.test(String(adm || ''))) continue;
        const key = `${AYS[yr]}|${adm.toLowerCase()}`;
        (byStu[key] ||= { ay: AYS[yr], adm: adm.toLowerCase(), rows: [] }).rows.push({ cycle: c[iCyc], orig: n(c[iOrig] || c[iExe]), exe: n(c[iExe] || c[iOrig]), by: c[iBy], on: c[iOn] });
      }
    }

    const detail = []; const flags = [];
    const balOf = async (sid, ay) => n((await client.query(`select coalesce(sum(debit) filter(where kind='charge'),0)-coalesce(sum(credit) filter(where kind in('payment','concession','waiver')),0) b from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active'`, [SCHOOL, sid, ay])).rows[0].b);

    for (const key of Object.keys(byStu)) {
      const { ay, adm, rows } = byStu[key];
      const st = (await client.query(`select uuid, name from student where school_id=$1 and lower(admission_number)=lower($2)`, [SCHOOL, adm])).rows[0];
      if (!st) { report.unmatchedNoStudent++; detail.push(`  ${adm}: NO STUDENT (${rows.length} rows skipped)`); continue; }
      report.students++;

      const beforeBal = await balOf(st.uuid, ay);
      // ---- plan this student (read-only), then decide before writing ----
      let existingWaive = 0, createCount = 0, misPayTotal = 0; const refs = []; const plan = [];
      const cycRow = async (cyc) => (await client.query(`select uuid from fee_cycle where school_id=$1 and academic_year_id=$2 and status='active' and lower(trim(name))=lower(trim($3))`, [SCHOOL, ay, cyc])).rows[0];
      for (const r of rows) {
        const ch = (await client.query(
          `select uuid, cycle_id, debit,
             coalesce((select sum(credit) from student_ledger_entry w where w.settles_entry_id=c.uuid and w.kind='waiver' and w.status='active'),0) waived
           from student_ledger_entry c where c.school_id=$1 and c.student_id=$2 and c.academic_year_id=$3 and c.kind='charge' and c.status='active' and c.head_label ilike '%late%' and lower(trim(c.cycle_label))=lower(trim($4))`,
          [SCHOOL, st.uuid, ay, r.cycle])).rows[0];
        if (ch) {
          if (n(ch.waived) > 0.5) { report.skipped++; continue; } // already exempted
          const pays = (await client.query(`select uuid, credit, source_ref from student_ledger_entry where school_id=$1 and settles_entry_id=$2 and kind='payment' and status='active'`, [SCHOOL, ch.uuid])).rows;
          const paid = pays.reduce((a, p) => a + n(p.credit), 0); misPayTotal += paid; pays.forEach((p) => refs.push(p.source_ref || 'realloc'));
          existingWaive += n(ch.debit);
          plan.push({ kind: 'waive', fineId: ch.uuid, cycId: ch.cycle_id, amt: n(ch.debit), cycle: r.cycle, r, cancelPays: pays.map((p) => p.uuid) });
        } else {
          const cy = await cycRow(r.cycle);
          plan.push({ kind: 'create', cycId: cy ? cy.uuid : null, amt: r.orig || 1010, cycle: r.cycle, r });
          createCount++;
        }
      }

      // ---- safety proof (before writing) ----
      const afterExpected = round2(beforeBal - existingWaive); // created fines net 0; realloc is balance-neutral
      // does the freed money fully fit on unpaid base charges?
      const base = (await client.query(
        `select c.uuid, c.debit, coalesce(fc.due_date, fc.from_date) due,
           coalesce((select sum(credit) from student_ledger_entry p where p.settles_entry_id=c.uuid and p.kind in('payment','concession','waiver') and p.status='active'),0) settled
         from student_ledger_entry c left join fee_cycle fc on fc.uuid=c.cycle_id and fc.status='active'
         where c.school_id=$1 and c.student_id=$2 and c.academic_year_id=$3 and c.kind='charge' and c.status='active' and c.head_label not ilike '%late%'
         order by due nulls last, c.created_at`, [SCHOOL, st.uuid, ay])).rows;
      let baseRoom = base.reduce((a, b) => a + Math.max(0, n(b.debit) - n(b.settled)), 0);
      const lostMoney = round2(misPayTotal - Math.min(misPayTotal, baseRoom));
      let flag = '';
      if (afterExpected < -0.5) flag = `OVER-WAIVE (after ${inr(afterExpected)})`;
      else if (lostMoney > 0.5) flag = `LOST-MONEY (${inr(lostMoney)} freed payment can't fit base room ${inr(baseRoom)})`;
      if (flag) { flags.push(`  ${adm.padEnd(12)} ${String(st.name).slice(0,16).padEnd(16)} ${flag} — SKIPPED`); continue; }

      // ---- write (guarded) ----
      if (APPLY) {
        await client.query('begin');
        try {
          for (const p of plan) {
            let fineId = p.fineId;
            if (p.kind === 'create') {
              fineId = generateShortUuid(12);
              await client.query(`insert into student_ledger_entry (uuid,school_id,student_id,academic_year_id,entry_date,category,fee_head_id,cycle_id,head_label,cycle_label,kind,debit,source_module,legacy_source,allocation,status,createdby_userid,created_at) values ($1,$2,$3,$4,now(),'fee',$5,$6,$7,$8,'charge',$9,'fees','schoolpad','explicit','active','fine-import',now())`, [fineId, SCHOOL, st.uuid, ay, headByAy[ay], p.cycId, HEAD_NAME, p.cycle, p.amt]);
              report.created++;
            } else {
              for (const pid of p.cancelPays) await client.query(`update student_ledger_entry set status='cancelled', updatedby_userid='fine-import', updated_at=now() where uuid=$1`, [pid]);
            }
            await client.query(`insert into student_ledger_entry (uuid,school_id,student_id,academic_year_id,entry_date,category,fee_head_id,cycle_id,head_label,cycle_label,kind,credit,settles_entry_id,source_module,allocation,status,remarks,createdby_userid,created_at) values ($1,$2,$3,$4,now(),'fee',$5,$6,$7,$8,'waiver',$9,$10,'fees','explicit','active',$11,'fine-import',now())`, [generateShortUuid(12), SCHOOL, st.uuid, ay, headByAy[ay], p.cycId, HEAD_NAME, p.cycle, p.amt, fineId, `fine exemption ${p.r.by || ''} ${p.r.on || ''}`.trim()]);
            report.waived++;
          }
          // re-allocate freed money to base
          let left = misPayTotal; const ref = refs[0] || 'realloc';
          for (const b of base) { const room = n(b.debit) - n(b.settled); if (room < 0.5) continue; const take = Math.min(room, left); if (take < 0.5) continue;
            await client.query(`insert into student_ledger_entry (uuid,school_id,student_id,academic_year_id,entry_date,category,cycle_id,head_label,cycle_label,kind,credit,settles_entry_id,source_module,source_ref,allocation,status,createdby_userid,created_at) select $1,$2,$3,$4,now(),'fee',c.cycle_id,c.head_label,c.cycle_label,'payment',$5,c.uuid,'fees',$6,'explicit','active','fine-import',now() from student_ledger_entry c where c.uuid=$7`, [generateShortUuid(12), SCHOOL, st.uuid, ay, take, ref, b.uuid]);
            left -= take; if (left < 0.5) break; }
          report.reallocated += (misPayTotal - left);
          // post-write proof: actual balance must equal the pre-computed expectation
          const actual = await balOf(st.uuid, ay);
          if (Math.abs(actual - afterExpected) > 0.5) throw new Error(`balance check failed: expected ${afterExpected} got ${actual}`);
          await client.query('commit');
        } catch (e) { await client.query('rollback'); flags.push(`  ${adm.padEnd(12)} ${String(st.name).slice(0,16)} ROLLBACK: ${e.message}`); continue; }
      } else {
        report.waived += plan.filter((p) => true).length; report.created += createCount; report.reallocated += Math.min(misPayTotal, baseRoom);
      }
      if (plan.length || misPayTotal) detail.push(`  ${adm.padEnd(12)} ${String(st.name).slice(0,16).padEnd(16)} bal ${inr(beforeBal)}→${inr(afterExpected)}  ·  waive ${plan.filter(p=>p.kind==='waive').length} · create ${createCount} · realloc ${inr(misPayTotal)}`);
    }
    report._flags = flags;

    console.log('=== HEAD / BACKFILL ===');
    console.log(`  heads ensured: ${report.heads}  ·  fee_head_id backfilled on: ${report.backfill} fine lines`);
    console.log('\n=== EXEMPTIONS ===');
    console.log(`  students: ${report.students}  ·  fines waived: ${report.waived}  ·  fines created(+waived net0): ${report.created}  ·  already-waived skipped: ${report.skipped}  ·  no-student: ${report.unmatchedNoStudent}`);
    console.log(`  payment re-allocated fine→base: ${inr(report.reallocated)}`);
    console.log('\nper-student (with a change):');
    detail.forEach((d) => console.log(d));
    if (report._flags && report._flags.length) { console.log(`\n!!! FLAGGED / SKIPPED (${report._flags.length}) — investigate, not written:`); report._flags.forEach((f) => console.log(f)); }
    else console.log('\nno safety flags — every student nets non-negative and no money lost.');
    if (!APPLY) console.log('\nDRY-RUN only. Re-run with --apply --yes to write.');
  } catch (e) { if (APPLY) await client.query('rollback').catch(() => {}); throw e; }
  finally { client.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
