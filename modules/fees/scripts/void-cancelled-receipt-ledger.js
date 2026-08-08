/**
 * Correct, uniform handling of a cancelled receipt's ledger footprint.
 *
 * RULE: a cancelled receipt must have ZERO active ledger lines. So cancel EVERY active
 * student_ledger_entry (both 'payment' credits AND 'adjust'/reversal debits) whose source_ref
 * matches a receipt that is status='cancelled'. Then outstanding = charges - active-receipt
 * payments - concessions, uniformly.
 *
 * This SUPERSEDES/COMPLETES void-reversals.js:
 *   - years already run through void-reversals: the adjust debits are already cancelled, so this
 *     only catches leftover 'paid' credit lines that reallocate-payments.js never removed (the
 *     students it skipped because they had no active FEE receipt, e.g. Krishti).
 *   - 2022-23 (not yet touched): does BOTH sides in one correct pass.
 *
 * Idempotent (only touches status='active'). Reversible (sets status='cancelled', never deletes).
 *
 *   node modules/fees/scripts/void-cancelled-receipt-ledger.js --all                 # DRY-RUN all years
 *   node modules/fees/scripts/void-cancelled-receipt-ledger.js --ay <id> --apply --yes
 *   node modules/fees/scripts/void-cancelled-receipt-ledger.js --all --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes'), ALL = has('--all');
const SCHOOL = '2qy0xfycrq88', AY = arg('--ay', null);
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const YR = { w3ajbki9xhbm: '2026-27', '3fm049m0jsbh': '2025-26', h31h8xoqwuhc: '2024-25', s38z2s46ee9o: '2023-24', kxv65myuppgc: '2022-23' };

(async () => {
  if (!ALL && !AY) { console.log('pass --ay <id> or --all'); await pool.end(); return; }
  const p = [SCHOOL]; let ayf = '';
  if (!ALL) { p.push(AY); ayf = ' and l.academic_year_id = $2'; }

  // every ACTIVE ledger line (payment credit or adjust debit) pointing at a CANCELLED receipt
  const rows = (await pool.query(`
    select l.uuid, l.academic_year_id ay, l.student_id, s.admission_number adm, s.name,
           l.kind, l.source_ref, coalesce(l.debit,0) debit, coalesce(l.credit,0) credit
    from student_ledger_entry l
    join fee_receipt r on r.school_id = l.school_id and r.legacy_receipt_no = l.source_ref and r.status = 'cancelled'
    left join student s on s.uuid = l.student_id
    where l.school_id = $1 and l.status = 'active' and l.kind in ('payment','adjust')${ayf}
    order by l.academic_year_id, l.student_id`, p)).rows;

  // group by year
  const byYr = {};
  rows.forEach((r) => {
    const y = byYr[r.ay] || (byYr[r.ay] = { payN: 0, payAmt: 0, adjN: 0, adjAmt: 0, real: new Set(), ghost: 0 });
    if (r.kind === 'payment') { y.payN++; y.payAmt += Number(r.credit); } else { y.adjN++; y.adjAmt += Number(r.debit); }
    if (r.student_id) y.real.add(r.student_id); else y.ghost++;
  });

  console.log(`================ VOID CANCELLED-RECEIPT LEDGER ${APPLY ? 'APPLY' : 'DRY-RUN'} — ${ALL ? 'ALL YEARS' : (YR[AY] || AY)} ================\n`);
  console.log('year      paid-lines(₹)          owes-back-lines(₹)      real students  ghost lines');
  Object.keys(byYr).sort().forEach((y) => {
    const b = byYr[y];
    console.log(`  ${(YR[y] || y).padEnd(8)} ${(`${b.payN} (${inr(b.payAmt)})`).padEnd(22)} ${(`${b.adjN} (${inr(b.adjAmt)})`).padEnd(22)} ${String(b.real.size).padStart(6)}        ${b.ghost}`);
  });

  // per affected REAL student: net before -> after
  const perStu = {};
  rows.forEach((r) => {
    if (!r.student_id) return;
    const k = `${r.student_id}|${r.ay}`;
    const s = perStu[k] || (perStu[k] = { adm: r.adm, name: r.name, ay: r.ay, pay: 0, adj: 0 });
    if (r.kind === 'payment') s.pay += Number(r.credit); else s.adj += Number(r.debit);
  });
  console.log('\naffected real students (net now → net after):');
  let anyNeg = false;
  for (const k of Object.keys(perStu)) {
    const s = perStu[k]; const [sid] = k.split('|');
    const net = (await pool.query(`select coalesce(sum(debit),0)-coalesce(sum(credit),0) b from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and status='active'`, [SCHOOL, sid, s.ay])).rows[0];
    const after = Number(net.b) + s.pay - s.adj; // remove credits (+), remove debits (-)
    if (after < -0.5) anyNeg = true;
    console.log(`  ${(YR[s.ay] || s.ay)} ${String(s.adm || '?').padEnd(12)} ${String(s.name || '').slice(0, 20).padEnd(20)}  ${inr(net.b)} → ${inr(after)}${after < -0.5 ? '  !!! NEGATIVE' : ''}   (cancel paid ${inr(s.pay)}, owes-back ${inr(s.adj)})`);
  }
  console.log(`  safety: real students that would go negative = ${anyNeg ? 'YES (!!! REVIEW)' : '0 (OK)'}`);

  const ghostLines = rows.filter((r) => !r.student_id).length;
  const ghostAmt = rows.filter((r) => !r.student_id).reduce((a, r) => a + Number(r.credit) + Number(r.debit), 0);
  console.log(`\nghost (null-student) lines: ${ghostLines}  (${inr(ghostAmt)}) — no 360 impact, cleaned for consistency`);
  console.log(`TOTAL lines to cancel: ${rows.length}`);

  if (APPLY && rows.length) {
    if (anyNeg) { console.log('\nABORT: a real student would go negative — not writing.'); await pool.end(); return; }
    const ids = rows.map((r) => r.uuid);
    const res = await pool.query(`update student_ledger_entry set status='cancelled', remarks=coalesce(remarks,'')||' [void-cancelled-rcpt 2026-08-08]' where uuid = any($1)`, [ids]);
    console.log(`\nAPPLIED: ${res.rowCount} lines set status='cancelled'.`);
  } else if (!APPLY) {
    console.log('\n(dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
