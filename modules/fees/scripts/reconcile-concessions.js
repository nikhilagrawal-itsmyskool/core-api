/**
 * Reconcile concession credits to the concession definitions (bulk, id-based) — one-time fix for
 * migration mis-applications (e.g. CAUTION linked to the Registration charge instead of Caution Fee).
 *
 * For every student on a concession (or holding a concession credit), for each of their charges:
 *   expected = their active concession for that charge's fee_head_id (min(value,debit) | percent), else 0
 *   if expected != current concession on that charge -> void the current concession credit(s) and,
 *   if expected>0, post a fresh one (settles_entry_id = charge, real fee_head_id/cycle_id).
 * Idempotent — a no-op once in sync. Mirrors ConcessionService.syncConcessions.
 *
 *   node modules/fees/scripts/reconcile-concessions.js               # DRY-RUN
 *   node modules/fees/scripts/reconcile-concessions.js --apply --yes # write
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const STAGE = arg('--stage', 'prod');
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88', AY = 'w3ajbki9xhbm';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const n = v => v==null?0:Number(v), r2 = x => Math.round(x*100)/100, inr = x => '₹'+Math.round(Number(x||0)).toLocaleString('en-IN');
const EPS = 0.5, P = [SCHOOL, AY];
const INSERT = `insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','reconciled','active','reconcile',$13)`;
const VOID = `update student_ledger_entry set status='cancelled', updatedby_userid='reconcile', updated_at=$1 where uuid=$2`;

(async () => {
  const ids = (await pool.query(`select distinct student_id from (
      select cs.student_id from fee_concession_student cs join fee_concession c on c.uuid=cs.concession_id and c.status='active' where cs.school_id=$1 and c.academic_year_id=$2 and cs.status='active'
      union select student_id from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active'
    ) t where student_id is not null`, P)).rows.map(r => r.student_id);
  const charges = (await pool.query(`select uuid, student_id, fee_head_id, cycle_id, category, head_label, cycle_label, debit from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='charge' and status='active' and student_id = any($3)`, [SCHOOL, AY, ids])).rows;
  const concRows = (await pool.query(`select uuid, settles_entry_id, credit from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active' and settles_entry_id is not null and student_id = any($3)`, [SCHOOL, AY, ids])).rows;
  const defs = (await pool.query(`select cs.student_id, c.fee_head_id, c.value_type, c.value, c.name from fee_concession_student cs join fee_concession c on c.uuid=cs.concession_id and c.status='active' where cs.school_id=$1 and c.academic_year_id=$2 and cs.status='active' and cs.student_id = any($3)`, [SCHOOL, AY, ids])).rows;

  const byCharge = {}; concRows.forEach(r => { const e = (byCharge[r.settles_entry_id] ||= { sum:0, ids:[] }); e.sum += n(r.credit); e.ids.push(r.uuid); });
  const byStuHead = {}; defs.forEach(d => ((byStuHead[d.student_id] ||= {})[d.fee_head_id] = d));
  const chByStu = {}; charges.forEach(c => (chByStu[c.student_id] ||= []).push(c));

  let studChanged = 0, voided = 0, posted = 0, addAmt = 0, remAmt = 0;
  const perStu = []; // {sid, changes:[{void:[], insert:{}}], oldConc, newConc}
  for (const sid of ids) {
    const chs = chByStu[sid] || [];
    let changed = 0, oldC = 0, newC = 0; const voids = []; const inserts = [];
    for (const ch of chs) {
      const cur = r2(byCharge[ch.uuid]?.sum || 0);
      const def = byStuHead[sid]?.[ch.fee_head_id];
      const exp = def ? r2(def.value_type==='percent' ? n(ch.debit)*n(def.value)/100 : Math.min(n(def.value), n(ch.debit))) : 0;
      oldC += cur;
      if (Math.abs(exp - cur) < EPS) { newC += cur; continue; }
      changed++;
      for (const eid of (byCharge[ch.uuid]?.ids || [])) voids.push(eid);
      if (cur > 0) remAmt = r2(remAmt + cur);
      if (exp > EPS) { inserts.push({ ch, amount: exp, name: def.name }); addAmt = r2(addAmt + exp); newC += exp; }
    }
    if (changed) { studChanged++; voided += voids.length; posted += inserts.length; perStu.push({ sid, voids, inserts, oldC: r2(oldC), newC: r2(newC) }); }
  }

  console.log(`================ RECONCILE CONCESSIONS ${APPLY ? 'APPLY' : 'DRY-RUN'} ================`);
  console.log(`students on concessions considered: ${ids.length}`);
  console.log(`students changed: ${studChanged}   credits voided: ${voided}   credits posted: ${posted}`);
  console.log(`concession added: ${inr(addAmt)}   removed: ${inr(remAmt)}   net: ${inr(addAmt - remAmt)}`);

  // CSV
  const info = {}; const flagIds = perStu.map(p => p.sid);
  if (flagIds.length) (await pool.query(`select s.uuid, s.name, s.admission_number, c.name cls from student s left join student_class sc on sc.student_id=s.uuid and sc.academic_year_id=$2 and sc.school_id=$1 left join class c on c.uuid=sc.class_id where s.uuid = any($3)`, [SCHOOL, AY, flagIds])).rows.forEach(r => info[r.uuid] = r);
  const rows = [['admissionNo','class','name','oldConcession','newConcession','delta','creditsVoided','creditsPosted']];
  perStu.sort((a,b)=> (b.newC-b.oldC)-(a.newC-a.oldC));
  perStu.forEach(p => { const i = info[p.sid]||{}; rows.push([i.admission_number||'', i.cls||'', i.name||'', Math.round(p.oldC), Math.round(p.newC), Math.round(p.newC-p.oldC), p.voids.length, p.inserts.length]); });
  const outDir = path.join(__dirname, '../reports'); fs.mkdirSync(outDir, { recursive:true });
  const out = path.join(outDir, `concession-reconcile-${STAGE}-2026-27.csv`);
  fs.writeFileSync(out, rows.map(r => r.map(v => { const t=String(v==null?'':v); return /[",\n]/.test(t)?'"'+t.replace(/"/g,'""')+'"':t; }).join(',')).join('\n'), 'utf8');
  console.log(`per-student detail: ${out}`);

  if (APPLY) {
    const client = await pool.connect(); let done = 0, failed = 0;
    for (const p of perStu) {
      try {
        await client.query('begin');
        for (const eid of p.voids) await client.query(VOID, [new Date(), eid]);
        for (const ins of p.inserts) await client.query(INSERT, [generateShortUuid(12), SCHOOL, p.sid, AY, new Date().toISOString().slice(0,10), ins.ch.category, ins.ch.fee_head_id, ins.ch.cycle_id, ins.name, ins.ch.cycle_label, ins.amount, ins.ch.uuid, new Date()]);
        await client.query('commit'); done++;
      } catch (e) { await client.query('rollback'); failed++; console.error(`  FAILED ${p.sid}: ${e.message}`); }
    }
    client.release();
    console.log(`\nAPPLIED: ${done} students, ${failed} failed.`);
  } else {
    console.log('\n(dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
