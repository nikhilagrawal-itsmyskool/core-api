/**
 * SAFETY PROOF for the B2 concession engine. Replicates the new syncConcessions reconcile (per-scheme
 * stacking + effective_from + cycle_scope) over the ENTIRE concession population, using the
 * assignment list AS IT WILL BE AFTER the roster backfill (existing assignments + the proposed
 * backfill rows). If it reports ZERO mismatches, then deploying the engine + applying the backfill is
 * a no-op on every existing ledger credit — nothing gets stripped or altered — so the portal is safe
 * to use. Read-only.
 *
 *   node modules/fees/scripts/verify-concession-sync.js
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const SCHOOL = '2qy0xfycrq88';
const AY = 'w3ajbki9xhbm';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const n = (v) => (v == null ? 0 : Number(v));
const round2 = (x) => Math.round(x * 100) / 100;
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

(async () => {
  const schemes = (await pool.query(`select uuid, name, fee_head_id, value_type, value from fee_concession where school_id=$1 and academic_year_id=$2 and status='active'`, [SCHOOL, AY])).rows;
  const schemeById = {}; const schemeByName = {}; schemes.forEach((s) => { schemeById[s.uuid] = s; schemeByName[s.name] = s; });

  // existing active assignments
  const asg = (await pool.query(`select student_id, concession_id, cycle_scope, effective_from from fee_concession_student where school_id=$1 and status='active' and concession_id = any($2)`, [SCHOOL, schemes.map((s) => s.uuid)])).rows;
  const assignedKey = new Set(asg.map((a) => `${a.student_id}|${a.concession_id}`));

  // proposed backfill: (student, scheme) with ledger credits but no assignment (mirror backfill script)
  const ledgerAgg = (await pool.query(`select student_id, head_label, array_agg(distinct cycle_label) cycles from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active' group by student_id, head_label`, [SCHOOL, AY])).rows;
  const proposed = [];
  for (const row of ledgerAgg) {
    const scheme = schemeByName[row.head_label]; if (!scheme) continue;
    if (assignedKey.has(`${row.student_id}|${scheme.uuid}`)) continue;
    const allCycles = (await pool.query(`select distinct cycle_label from student_ledger_entry where school_id=$1 and student_id=$2 and academic_year_id=$3 and kind='charge' and status='active' and fee_head_id=$4`, [SCHOOL, row.student_id, AY, scheme.fee_head_id])).rows.map((x) => x.cycle_label);
    const covered = row.cycles.filter(Boolean);
    const isFull = allCycles.length > 0 && covered.length >= allCycles.length;
    proposed.push({ student_id: row.student_id, concession_id: scheme.uuid, cycle_scope: isFull ? null : covered.join(','), effective_from: null });
  }
  console.log(`schemes: ${schemes.length}  ·  existing assignments: ${asg.length}  ·  proposed backfill: ${proposed.length}`);

  // effective assignment set -> defs per (student, fee_head)
  const defsByStuHead = {};
  [...asg, ...proposed].forEach((a) => {
    const s = schemeById[a.concession_id]; if (!s) return;
    (((defsByStuHead[a.student_id] ||= {})[s.fee_head_id] ||= [])).push({ name: s.name, value: n(s.value), value_type: s.value_type, cycle_scope: a.cycle_scope, effective_from: a.effective_from });
  });

  const studentIds = [...new Set([...Object.keys(defsByStuHead), ...ledgerAgg.map((r) => r.student_id)])];

  // charges (+ cycle due)
  const charges = (await pool.query(`select l.uuid, l.student_id, l.fee_head_id, l.cycle_id, l.cycle_label, l.debit, coalesce(fc.due_date, fc.from_date) cycle_due
     from student_ledger_entry l left join fee_cycle fc on fc.uuid=l.cycle_id and fc.status='active'
     where l.school_id=$1 and l.academic_year_id=$2 and l.kind='charge' and l.status='active' and l.student_id = any($3)`, [SCHOOL, AY, studentIds])).rows;

  // existing concession credits keyed by charge -> scheme
  const conc = (await pool.query(`select settles_entry_id, head_label, sum(credit) credit from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active' and settles_entry_id is not null and student_id=any($3) group by settles_entry_id, head_label`, [SCHOOL, AY, studentIds])).rows;
  const byChargeScheme = {}; conc.forEach((r) => { (byChargeScheme[r.settles_entry_id] ||= {})[r.head_label] = n(r.credit); });

  let mismatches = 0; const detail = [];
  for (const ch of charges) {
    if (!ch.fee_head_id) continue;
    const applicable = (defsByStuHead[ch.student_id]?.[ch.fee_head_id] || []).filter((d) => {
      if (d.effective_from && ch.cycle_due && new Date(ch.cycle_due) < new Date(d.effective_from)) return false;
      if (d.cycle_scope) { const scope = String(d.cycle_scope).split(',').map(norm).filter(Boolean); if (scope.length && !scope.includes(norm(ch.cycle_label)) && !scope.includes(norm(ch.cycle_id))) return false; }
      return true;
    });
    const sorted = [...applicable].sort((a, b) => n(b.value) - n(a.value) || String(a.name).localeCompare(String(b.name)));
    const desired = {}; let remaining = n(ch.debit);
    for (const d of sorted) { const raw = d.value_type === 'percent' ? (n(ch.debit) * n(d.value)) / 100 : n(d.value); const amt = round2(Math.max(0, Math.min(raw, remaining))); if (amt <= 0.005) continue; desired[d.name] = round2((desired[d.name] || 0) + amt); remaining = round2(remaining - amt); }
    const cur = byChargeScheme[ch.uuid] || {};
    const names = new Set([...Object.keys(desired), ...Object.keys(cur)]);
    for (const nm of names) {
      const want = round2(desired[nm] || 0), have = round2(cur[nm] || 0);
      if (Math.abs(want - have) >= 0.005) { mismatches++; if (detail.length < 40) detail.push({ student: ch.student_id, cycle: ch.cycle_label, scheme: nm, have, want }); }
    }
  }

  console.log(`\nstudents checked: ${studentIds.length}  ·  charges: ${charges.length}`);
  if (mismatches === 0) {
    console.log('\n*** ZERO mismatches — the engine + backfill is a no-op on every existing credit. SAFE to deploy + apply. ***');
  } else {
    console.log(`\n!!! ${mismatches} mismatches — NOT safe yet. Sample:`);
    detail.forEach((d) => console.log(`   ${d.student} ${d.cycle} ${d.scheme}: have ${d.have} want ${d.want}`));
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
