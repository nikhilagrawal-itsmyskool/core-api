/**
 * Comprehensive fees ledger audit (READ-ONLY) — checks each derived value against its source
 * and reports every discrepancy in one pass. Writes nothing.
 *
 * Checks (DBPASN 2026-27):
 *   1. Concessions   vs concession definitions (right head, right amount per charge)
 *   2. Payments      vs receipts (per-student total)
 *   3. Over-application (credits on a charge exceed its debit)
 *   4. Orphan / cross-student credits (settles_entry_id integrity)
 *   5. Missing head/cycle ids (post-backfill)
 *   6. Negative net (paid+concession beyond what was charged)
 *
 *   node modules/fees/scripts/audit-fees.js [--stage prod]
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const STAGE = arg('--stage', 'prod');
const SCHOOL = '2qy0xfycrq88', AY = 'w3ajbki9xhbm';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const n = v => v==null?0:Number(v), r2 = x => Math.round(x*100)/100, inr = x => '₹'+Math.round(Number(x||0)).toLocaleString('en-IN');
const EPS = 0.5, P = [SCHOOL, AY];

(async () => {
  const charges = (await pool.query(`select uuid, student_id, fee_head_id, cycle_id, head_label, cycle_label, debit from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='charge' and status='active'`, P)).rows;
  const credits = (await pool.query(`select uuid, student_id, settles_entry_id, kind, credit, head_label from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind in ('concession','waiver','payment') and status='active'`, P)).rows;
  const defs = (await pool.query(`select cs.student_id, c.fee_head_id, c.value_type, c.value from fee_concession_student cs join fee_concession c on c.uuid=cs.concession_id and c.status='active' where cs.school_id=$1 and c.academic_year_id=$2 and cs.status='active'`, P)).rows;
  const receipts = {}; (await pool.query(`select student_id, coalesce(sum(total_paid),0) t from fee_receipt where school_id=$1 and academic_year_id=$2 and status='active' and student_id is not null group by student_id`, P)).rows.forEach(r => receipts[r.student_id] = n(r.t));

  const chargeById = {}; charges.forEach(c => chargeById[c.uuid] = c);
  const concByStuHead = {}; defs.forEach(d => ((concByStuHead[d.student_id] ||= {})[d.fee_head_id] = d));
  const credByCharge = {}; // chargeUuid -> {concession,waiver,payment}
  let orphan = 0, crossStudent = 0, unlinked = 0;
  credits.forEach(cr => {
    if (!cr.settles_entry_id) { unlinked++; return; }
    const ch = chargeById[cr.settles_entry_id];
    if (!ch) { orphan++; return; }
    if (ch.student_id !== cr.student_id) { crossStudent++; }
    (credByCharge[cr.settles_entry_id] ||= { concession:0, waiver:0, payment:0 })[cr.kind] += n(cr.credit);
  });

  // per-student aggregates + flags
  const S = {}; // studentId -> {charged, conc, waiver, pay, expConc, over, concMisHead, concMissing, concWrongAmt}
  const stu = (id) => (S[id] ||= { charged:0, conc:0, waiver:0, pay:0, expConc:0, over:0, flags:new Set() });
  let nullIdCharges = 0;
  for (const c of charges) {
    if (!c.fee_head_id || !c.cycle_id) nullIdCharges++;
    const cc = credByCharge[c.uuid] || { concession:0, waiver:0, payment:0 };
    const s = stu(c.student_id);
    s.charged += n(c.debit); s.conc += cc.concession; s.waiver += cc.waiver; s.pay += cc.payment;
    const def = concByStuHead[c.student_id]?.[c.fee_head_id];
    const exp = def ? r2(def.value_type==='percent' ? n(c.debit)*n(def.value)/100 : Math.min(n(def.value), n(c.debit))) : 0;
    s.expConc += exp;
    if (Math.abs(exp - cc.concession) > EPS) {
      if (cc.concession > 0 && !def) s.flags.add('concession-on-wrong-head');   // discount on a head the student has no concession for
      else if (exp > 0 && cc.concession < EPS) s.flags.add('concession-missing');
      else s.flags.add('concession-amount');
    }
    if (cc.concession + cc.waiver + cc.payment > n(c.debit) + EPS) { s.over += (cc.concession+cc.waiver+cc.payment - n(c.debit)); s.flags.add('over-applied'); }
  }
  // payment vs receipts
  for (const id of new Set([...Object.keys(S), ...Object.keys(receipts)])) {
    const s = stu(id); const rec = receipts[id] || 0;
    if (Math.abs(s.pay - rec) > EPS) s.flags.add('paid!=receipts');
    const net = r2(s.charged - s.conc - s.waiver - s.pay);
    if (net < -EPS) s.flags.add('negative-net');
    s.net = net;
  }

  const flagged = Object.entries(S).filter(([, s]) => s.flags.size);
  // names/class for flagged
  const ids = flagged.map(([id]) => id);
  const info = {}; if (ids.length) (await pool.query(`select s.uuid, s.name, s.admission_number, c.name cls from student s left join student_class sc on sc.student_id=s.uuid and sc.academic_year_id=$2 and sc.school_id=$1 left join class c on c.uuid=sc.class_id where s.uuid = any($3)`, [SCHOOL, AY, ids])).rows.forEach(r => info[r.uuid] = r);

  // tally by flag
  const tally = {}; flagged.forEach(([, s]) => s.flags.forEach(f => tally[f] = (tally[f]||0)+1));

  console.log(`================ FEES LEDGER AUDIT (READ-ONLY) — DBPASN 2026-27 ================`);
  console.log(`charges: ${charges.length}   credits: ${credits.length}   students with charges: ${Object.keys(S).length}`);
  console.log(`\nINTEGRITY:`);
  console.log(`  orphan credits (settles a missing charge): ${orphan}`);
  console.log(`  cross-student credits (settles another student's charge): ${crossStudent}`);
  console.log(`  unlinked credits (no settles_entry_id): ${unlinked}`);
  console.log(`  charges still missing head/cycle id: ${nullIdCharges}`);
  console.log(`\nDISCREPANCIES (students affected):`);
  Object.entries(tally).sort((a,b)=>b[1]-a[1]).forEach(([f,c]) => console.log(`  ${f.padEnd(24)} ${c}`));
  console.log(`  ${'TOTAL students flagged'.padEnd(24)} ${flagged.length}`);

  const rows = [['admissionNo','class','name','issues','concActual','concExpected','concDelta','overApplied','paid','receipts','paidDelta','net']];
  flagged.sort((a,b)=> (b[1].over - a[1].over) || (Math.abs(b[1].expConc-b[1].conc)-Math.abs(a[1].expConc-a[1].conc)));
  flagged.forEach(([id, s]) => { const i = info[id]||{}; rows.push([i.admission_number||'', i.cls||'', i.name||'', [...s.flags].join('; '), Math.round(s.conc), Math.round(s.expConc), Math.round(s.expConc-s.conc), Math.round(s.over), Math.round(s.pay), Math.round(receipts[id]||0), Math.round(s.pay-(receipts[id]||0)), Math.round(s.net)]); });
  const outDir = path.join(__dirname, '../reports'); fs.mkdirSync(outDir, { recursive:true });
  const out = path.join(outDir, `fees-audit-${STAGE}-2026-27.csv`);
  fs.writeFileSync(out, rows.map(r => r.map(v => { const t=String(v==null?'':v); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; }).join(',')).join('\n'), 'utf8');
  console.log(`\nper-student detail: ${out}`);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
