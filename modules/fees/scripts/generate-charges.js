/**
 * Generate fee charges for specific students (by admission number) from the class fee structure —
 * standalone mirror of ledger chargeRun (full-year, id-based). For new admissions with 0 charges.
 * Idempotent: skips (head,cycle) a student already has. Applies the student's active concessions/waivers.
 *
 *   node modules/fees/scripts/generate-charges.js --adm "1125/2K26,1126/2K26"                 # DRY-RUN
 *   node modules/fees/scripts/generate-charges.js --adm "1125/2K26,1126/2K26" --apply --yes    # write
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod'), APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88', AY = arg('--ay', 'w3ajbki9xhbm');
const ADM = String(arg('--adm', '')).split(',').map((s) => s.trim()).filter(Boolean);
// new admissions pay "New Annual", never "Old Annual" (re-admission) — skip it by head-name substring
const SKIP = String(arg('--skipHead', 'Old Annual')).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const asOf = new Date().toISOString().slice(0, 10);
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const n = (v) => v==null?0:Number(v), inr = (x) => '₹'+Number(x||0).toLocaleString('en-IN');

(async () => {
  if (!ADM.length) { console.log('--adm required'); await pool.end(); return; }
  const cycles = (await pool.query(`select uuid, name, from_date from fee_cycle where school_id=$1 and academic_year_id=$2 and status='active'`, [SCHOOL, AY])).rows;
  const cycleById = {}; cycles.forEach(c => cycleById[c.uuid] = c);
  const heads = (await pool.query(`select uuid, name, one_time, kind from fee_head where school_id=$1 and academic_year_id=$2 and status='active'`, [SCHOOL, AY])).rows;
  const headById = {}; heads.forEach(h => headById[h.uuid] = h);

  const students = (await pool.query(
    `select s.uuid, s.name, s.admission_number, sc.class_id, c.name class_name
     from student s join student_class sc on sc.student_id=s.uuid and sc.academic_year_id=$2 and sc.school_id=s.school_id
     left join class c on c.uuid=sc.class_id
     where s.school_id=$1 and s.admission_number = any($3)`, [SCHOOL, AY, ADM])).rows;

  const queries = [], params = []; let posted = 0, conc = 0, skipped = 0, totalCharge = 0; const perStu = [];
  for (const s of students) {
    const cls = (await pool.query(`select fee_head_id, cycle_id, amount from fee_structure where school_id=$1 and academic_year_id=$2 and class_id=$3 and status='active'`, [SCHOOL, AY, s.class_id])).rows;
    const ov = (await pool.query(`select fee_head_id, cycle_id, amount from fee_structure_student where school_id=$1 and academic_year_id=$2 and student_id=$3 and status='active'`, [SCHOOL, AY, s.uuid])).rows;
    const amt = {}; cls.forEach(r => amt[`${r.fee_head_id}|${r.cycle_id}`] = n(r.amount)); ov.forEach(r => amt[`${r.fee_head_id}|${r.cycle_id}`] = n(r.amount));
    const existing = (await pool.query(`select fee_head_id, cycle_id from student_ledger_entry where school_id=$1 and academic_year_id=$2 and student_id=$3 and kind='charge' and status='active'`, [SCHOOL, AY, s.uuid])).rows;
    const done = new Set(existing.map(e => `${e.fee_head_id}|${e.cycle_id}`));
    const cDefs = (await pool.query(`select c.fee_head_id, c.value_type, c.value, c.name from fee_concession_student cs join fee_concession c on c.uuid=cs.concession_id and c.status='active' where cs.school_id=$1 and cs.student_id=$2 and c.academic_year_id=$3 and cs.status='active'`, [SCHOOL, s.uuid, AY])).rows;
    const concByHead = {}; cDefs.forEach(c => concByHead[c.fee_head_id] = c);
    let sCharges = 0, sAmt = 0;
    for (const key of Object.keys(amt)) {
      if (done.has(key)) continue;
      const [headId, cycleId] = key.split('|');
      const head = headById[headId], cyc = cycleById[cycleId];
      if (!head) continue;
      if (SKIP.some((k) => String(head.name).toLowerCase().includes(k))) { skipped++; continue; }
      const amount = amt[key]; if (!(amount > 0)) continue; const now = new Date(); const category = head.kind === 'transport' ? 'transport' : 'fee';
      const chargeId = generateShortUuid(12);
      posted++; totalCharge += amount; sCharges++; sAmt += amount;
      if (APPLY) { queries.push(`insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, source_module, allocation, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'charge',$11,'fees','explicit','active','gencharge',$12)`);
        params.push([chargeId, SCHOOL, s.uuid, AY, asOf, category, headId, cycleId, head.name, cyc?cyc.name:null, amount, now]); }
      const c = concByHead[headId];
      if (c) { const cval = c.value_type==='percent' ? amount*n(c.value)/100 : Math.min(n(c.value), amount);
        if (cval > 0) { conc++; if (APPLY) { queries.push(`insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','explicit','active','gencharge',$13)`);
          params.push([generateShortUuid(12), SCHOOL, s.uuid, AY, asOf, category, headId, cycleId, c.name, cyc?cyc.name:null, cval, chargeId, new Date()]); } } }
    }
    perStu.push({ adm: s.admission_number, name: s.name, cls: s.class_name, charges: sCharges, amount: sAmt });
  }
  if (APPLY && queries.length) { const client = await pool.connect(); try { await client.query('begin'); for (let i=0;i<queries.length;i++) await client.query(queries[i], params[i]); await client.query('commit'); } catch(e){ await client.query('rollback'); client.release(); throw e; } client.release(); }

  console.log(`================ GENERATE CHARGES ${APPLY?'APPLY':'DRY-RUN'} — ${AY} ================`);
  perStu.forEach(p => console.log(`  ${String(p.adm).padEnd(12)} ${String(p.name).slice(0,22).padEnd(22)} ${p.cls||'—'} → ${p.charges} charges, ${inr(p.amount)}`));
  console.log(`\n  students: ${students.length}  charges: ${posted}  total: ${inr(totalCharge)}  concessions: ${conc}  skipped(${SKIP.join('/')}): ${skipped}`);
  if (!APPLY) console.log('  (dry-run — pass --apply --yes to write)');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
